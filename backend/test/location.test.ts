import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/http/app.ts';
import { InMemoryTripRepository } from '../src/infrastructure/memory/in-memory-trip-repository.ts';
import { InMemoryUserRepository } from '../src/infrastructure/memory/in-memory-user-repository.ts';
import { WsHub } from '../src/infrastructure/realtime/ws-hub.ts';
import { TripService } from '../src/trips/trip-service.ts';
import { AuthService } from '../src/users/auth-service.ts';
import { hashPassword } from '../src/users/password.ts';
import { RecordingNotifier } from './support.ts';

type Socket = Awaited<ReturnType<Awaited<ReturnType<typeof buildApp>>['injectWS']>>;

const apps: Awaited<ReturnType<typeof buildApp>>[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

async function setup() {
  const users = new InMemoryUserRepository();
  const hub = new WsHub();
  const tripService = new TripService({ trips: new InMemoryTripRepository(users), users, events: hub, notifier: new RecordingNotifier() });
  const app = await buildApp({ users, hub, tripService, authService: new AuthService(users), jwtSecret: 'test-secret' });
  apps.push(app);
  await app.ready();
  const passwordHash = await hashPassword('secret123');
  await users.create({ email: 'driver@test.dev', passwordHash, name: 'Driver', address: '', role: 'driver' });
  await users.create({ email: 'ana@test.dev', passwordHash, name: 'Ana', address: 'Calle 1', role: 'passenger' });
  await users.create({ email: 'beto@test.dev', passwordHash, name: 'Beto', address: 'Calle 2', role: 'passenger' });

  async function login(email: string): Promise<string> {
    return (await app.inject({ method: 'POST', url: '/auth/login', payload: { email, password: 'secret123' } })).json().token;
  }
  async function post(url: string, token: string) {
    return app.inject({ method: 'POST', url, headers: { authorization: `Bearer ${token}` } });
  }
  /** Opens /ws/location, authenticates, and collects every message received. */
  async function connect(token: string) {
    const socket = await app.injectWS('/ws/location');
    const messages: any[] = [];
    let closeCode: number | null = null;
    socket.on('message', (data: Buffer) => messages.push(JSON.parse(data.toString())));
    socket.on('close', (code: number) => (closeCode = code));
    socket.send(JSON.stringify({ type: 'auth', token }));
    await settle();
    return { socket, messages, closed: () => closeCode };
  }
  return { app, login, post, connect };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 60));
const send = (socket: Socket, message: object) => socket.send(JSON.stringify(message));
const position = (lat: number, lng: number) => ({ type: 'position', lat, lng, heading: 90 });

describe('driver location relay', () => {
  it('relays the driver position to passengers who joined the active trip', async () => {
    const { login, post, connect } = await setup();
    const driver = await login('driver@test.dev');
    const ana = await login('ana@test.dev');
    await post('/trips', driver);
    await post('/trips/current/passengers', ana);

    const anaWs = await connect(ana);
    const driverWs = await connect(driver);
    send(driverWs.socket, position(10.5, -66.9));
    await settle();

    expect(anaWs.messages).toEqual([
      { type: 'driver-position', lat: 10.5, lng: -66.9, heading: 90, at: expect.any(String) },
    ]);
    anaWs.socket.terminate();
    driverWs.socket.terminate();
  });

  it('never sends the position to passengers who did not join the trip', async () => {
    const { login, post, connect } = await setup();
    const driver = await login('driver@test.dev');
    const ana = await login('ana@test.dev');
    const beto = await login('beto@test.dev');
    await post('/trips', driver);
    await post('/trips/current/passengers', ana);

    const betoWs = await connect(beto);
    const driverWs = await connect(driver);
    send(driverWs.socket, position(10.5, -66.9));
    await settle();

    expect(betoWs.messages).toEqual([]);
    betoWs.socket.terminate();
    driverWs.socket.terminate();
  });

  it('sends the last known position to a passenger as soon as they connect', async () => {
    const { login, post, connect } = await setup();
    const driver = await login('driver@test.dev');
    const ana = await login('ana@test.dev');
    await post('/trips', driver);
    await post('/trips/current/passengers', ana);
    const driverWs = await connect(driver);
    send(driverWs.socket, position(10.5, -66.9));
    await settle();

    const anaWs = await connect(ana);

    expect(anaWs.messages).toEqual([expect.objectContaining({ type: 'driver-position', lat: 10.5, lng: -66.9 })]);
    anaWs.socket.terminate();
    driverWs.socket.terminate();
  });

  it('drops positions sent while no trip is active', async () => {
    const { login, post, connect } = await setup();
    const driver = await login('driver@test.dev');
    const ana = await login('ana@test.dev');
    const driverWs = await connect(driver);

    send(driverWs.socket, position(1, 1)); // no trip yet: must not be kept for later
    await settle();
    await post('/trips', driver);
    await post('/trips/current/passengers', ana);
    const anaWs = await connect(ana);
    expect(anaWs.messages).toEqual([]);

    send(driverWs.socket, position(2, 2));
    await settle();
    expect(anaWs.messages).toEqual([expect.objectContaining({ lat: 2, lng: 2 })]);
    anaWs.socket.terminate();
    driverWs.socket.terminate();
  });

  it('stops sharing once the trip is finished, even if the driver keeps sending', async () => {
    const { login, post, connect } = await setup();
    const driver = await login('driver@test.dev');
    const ana = await login('ana@test.dev');
    const anaId = JSON.parse(Buffer.from(ana.split('.')[1]!, 'base64url').toString()).sub as string;
    await post('/trips', driver);
    await post('/trips/current/passengers', ana);
    const anaWs = await connect(ana);
    const driverWs = await connect(driver);
    send(driverWs.socket, position(1, 1));
    await settle();
    expect(anaWs.messages).toHaveLength(1);

    await post(`/trips/current/passengers/${anaId}/confirm`, driver);
    await post('/trips/current/finish', driver);
    send(driverWs.socket, position(2, 2));
    await settle();

    expect(anaWs.messages).toHaveLength(1);
    anaWs.socket.terminate();
    driverWs.socket.terminate();
  });

  it('ignores positions sent by passengers and malformed coordinates', async () => {
    const { login, post, connect } = await setup();
    const driver = await login('driver@test.dev');
    const ana = await login('ana@test.dev');
    const beto = await login('beto@test.dev');
    await post('/trips', driver);
    await post('/trips/current/passengers', ana);
    await post('/trips/current/passengers', beto);
    const anaWs = await connect(ana);
    const betoWs = await connect(beto);
    const driverWs = await connect(driver);

    send(betoWs.socket, position(5, 5)); // a passenger pretending to be the driver
    send(driverWs.socket, { type: 'position', lat: 200, lng: 0 }); // out of range
    send(driverWs.socket, { type: 'position', lat: 'x', lng: 0 });
    await settle();

    expect(anaWs.messages).toEqual([]);
    for (const ws of [anaWs, betoWs, driverWs]) ws.socket.terminate();
  });

  it('closes the socket when authentication fails', async () => {
    const { connect } = await setup();
    const ws = await connect('garbage');
    await settle();
    expect(ws.closed()).toBe(4401);
  });
});
