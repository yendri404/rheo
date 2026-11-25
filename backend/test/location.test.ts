import { afterEach, describe, expect, it } from 'vitest';
import type { buildApp } from '../src/http/app.ts';
import { appWorld } from './support.ts';

type Socket = Awaited<ReturnType<Awaited<ReturnType<typeof buildApp>>['injectWS']>>;

const apps: Awaited<ReturnType<typeof buildApp>>[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

async function setup() {
  const base = await appWorld();
  const { app, users, eureka, acme } = base;
  apps.push(app);
  // A second driver for each company, to check that positions never cross between trips.
  const passwordHash = (await users.findByEmail('driver@test.dev'))!.passwordHash;
  const second = { passwordHash, address: '', role: 'driver' as const };
  await users.create({ ...second, email: 'rival@test.dev', name: 'Rival', companyIds: [acme.id] });
  await users.create({ ...second, email: 'backup@test.dev', name: 'Backup', companyIds: [eureka.id] });

  async function login(email: string): Promise<string> {
    return (await app.inject({ method: 'POST', url: '/auth/login', payload: { email, password: 'secret123' } })).json().token;
  }
  /** Trip calls go to Eureka unless another company is named. */
  async function post(url: string, token: string, companyId: string = eureka.id) {
    return app.inject({ method: 'POST', url: `${url}?companyId=${companyId}`, headers: { authorization: `Bearer ${token}` } });
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
  return { app, login, post, connect, acme };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 60));
const send = (socket: Socket, message: object) => socket.send(JSON.stringify(message));
const position = (lat: number, lng: number) => ({ type: 'position', lat, lng, heading: 90 });
const report = (app: Awaited<ReturnType<typeof buildApp>>, token: string | null, payload: object) =>
  app.inject({
    method: 'POST',
    url: '/location',
    headers: token ? { authorization: `Bearer ${token}` } : {},
    payload,
  });

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

  it('relays positions the driver reports over HTTP (background tracking)', async () => {
    const { app, login, post, connect } = await setup();
    const driver = await login('driver@test.dev');
    const ana = await login('ana@test.dev');
    await post('/trips', driver);
    await post('/trips/current/passengers', ana);
    const anaWs = await connect(ana);

    const response = await report(app, driver, { lat: 10.5, lng: -66.9, heading: null });
    await settle();

    expect(response.statusCode).toBe(204);
    expect(anaWs.messages).toEqual([
      { type: 'driver-position', lat: 10.5, lng: -66.9, heading: null, at: expect.any(String) },
    ]);
    anaWs.socket.terminate();
  });

  it('answers 409 NO_ACTIVE_TRIP over HTTP so the phone stops tracking', async () => {
    const { app, login } = await setup();
    const driver = await login('driver@test.dev');

    const response = await report(app, driver, { lat: 10.5, lng: -66.9 });

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('NO_ACTIVE_TRIP');
  });

  it('rejects HTTP reports from passengers, without a session, or with bad coordinates', async () => {
    const { app, login, post, connect } = await setup();
    const driver = await login('driver@test.dev');
    const ana = await login('ana@test.dev');
    await post('/trips', driver);
    await post('/trips/current/passengers', ana);
    const anaWs = await connect(ana);

    expect((await report(app, ana, { lat: 5, lng: 5 })).statusCode).toBe(403);
    expect((await report(app, null, { lat: 5, lng: 5 })).statusCode).toBe(401);
    expect((await report(app, 'garbage', { lat: 5, lng: 5 })).statusCode).toBe(401);
    expect((await report(app, driver, { lat: 200, lng: 0 })).statusCode).toBe(400);
    await settle();

    expect(anaWs.messages).toEqual([]);
    anaWs.socket.terminate();
  });

  it('only shares a driver position with the trip that driver started, never with another company', async () => {
    const { app, login, post, connect, acme } = await setup();
    const driver = await login('driver@test.dev');
    const rival = await login('rival@test.dev');
    const ana = await login('ana@test.dev');
    const carla = await login('carla@test.dev');
    await post('/trips', driver);
    await post('/trips/current/passengers', ana);
    await post('/trips', rival, acme.id);
    await post('/trips/current/passengers', carla, acme.id);
    const anaWs = await connect(ana);
    const carlaWs = await connect(carla);

    // The driver also works for Acme, but Acme's running trip is the rival's.
    expect((await report(app, driver, { lat: 1, lng: 1 })).statusCode).toBe(204);
    await settle();
    expect(anaWs.messages).toEqual([expect.objectContaining({ lat: 1, lng: 1 })]);
    expect(carlaWs.messages).toEqual([]);

    expect((await report(app, rival, { lat: 2, lng: 2 })).statusCode).toBe(204);
    await settle();
    expect(carlaWs.messages).toEqual([expect.objectContaining({ lat: 2, lng: 2 })]);
    expect(anaWs.messages).toHaveLength(1);

    // A late joiner only gets the last position of their own trip.
    const lateCarla = await connect(carla);
    expect(lateCarla.messages).toEqual([expect.objectContaining({ lat: 2, lng: 2 })]);
    for (const ws of [anaWs, carlaWs, lateCarla]) ws.socket.terminate();
  });

  it('does not share the position of a driver who is not running the trip', async () => {
    const { app, login, post, connect } = await setup();
    const driver = await login('driver@test.dev');
    const backup = await login('backup@test.dev');
    const ana = await login('ana@test.dev');
    await post('/trips', driver);
    await post('/trips/current/passengers', ana);
    const anaWs = await connect(ana);

    const response = await report(app, backup, { lat: 9, lng: 9 });
    await settle();

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('NO_ACTIVE_TRIP');
    expect(anaWs.messages).toEqual([]);
    anaWs.socket.terminate();
  });

  it('closes the socket when authentication fails', async () => {
    const { connect } = await setup();
    const ws = await connect('garbage');
    await settle();
    expect(ws.closed()).toBe(4401);
  });
});
