import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/http/app.ts';
import { WsHub } from '../src/infrastructure/realtime/ws-hub.ts';
import { InMemoryTripRepository } from '../src/infrastructure/memory/in-memory-trip-repository.ts';
import { InMemoryUserRepository } from '../src/infrastructure/memory/in-memory-user-repository.ts';
import { TripService } from '../src/trips/trip-service.ts';
import { AuthService } from '../src/users/auth-service.ts';
import { hashPassword } from '../src/users/password.ts';
import { RecordingNotifier } from './support.ts';

const apps: Awaited<ReturnType<typeof buildApp>>[] = [];

async function setupApp() {
  const users = new InMemoryUserRepository();
  const hub = new WsHub();
  const tripService = new TripService({
    trips: new InMemoryTripRepository(users),
    users,
    events: hub,
    notifier: new RecordingNotifier(),
  });
  const app = await buildApp({ users, hub, tripService, authService: new AuthService(users), jwtSecret: 'test-secret' });
  apps.push(app);
  await app.ready();
  const passwordHash = await hashPassword('secret123');
  const driver = await users.create({ email: 'driver@test.dev', passwordHash, name: 'Driver', address: '', role: 'driver' });
  const ana = await users.create({ email: 'ana@test.dev', passwordHash, name: 'Ana', address: 'Calle 1', role: 'passenger' });

  async function login(email: string): Promise<string> {
    const response = await app.inject({ method: 'POST', url: '/auth/login', payload: { email, password: 'secret123' } });
    expect(response.statusCode).toBe(200);
    return response.json().token;
  }

  async function call(method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, token?: string, payload?: object) {
    return app.inject({ method, url, payload, headers: token ? { authorization: `Bearer ${token}` } : {} });
  }

  return { app, users, driver, ana, login, call };
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe('HTTP API', () => {
  it('logs in with valid credentials and returns the user without the password hash', async () => {
    const { call } = await setupApp();
    const response = await call('POST', '/auth/login', undefined, { email: ' ANA@test.dev ', password: 'secret123' });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.token).toEqual(expect.any(String));
    expect(body.user).toEqual({ id: expect.any(String), email: 'ana@test.dev', name: 'Ana', address: 'Calle 1', role: 'passenger' });
  });

  it('rejects invalid credentials with the same error for unknown emails', async () => {
    const { call } = await setupApp();
    const wrongPassword = await call('POST', '/auth/login', undefined, { email: 'ana@test.dev', password: 'nope' });
    const unknownEmail = await call('POST', '/auth/login', undefined, { email: 'ghost@test.dev', password: 'nope' });

    expect(wrongPassword.statusCode).toBe(401);
    expect(unknownEmail.statusCode).toBe(401);
    expect(wrongPassword.json()).toEqual(unknownEmail.json());
    expect(wrongPassword.json().error.code).toBe('INVALID_CREDENTIALS');
  });

  it('registers a passenger, logs them in, and lets them log in again later', async () => {
    const { call } = await setupApp();
    const response = await call('POST', '/auth/register', undefined, {
      name: ' Carla ',
      email: ' Carla@Test.dev ',
      password: 'secret123',
      address: 'Calle 9 #10',
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.token).toEqual(expect.any(String));
    expect(body.user).toEqual({ id: expect.any(String), email: 'carla@test.dev', name: 'Carla', address: 'Calle 9 #10', role: 'passenger' });
    expect((await call('GET', '/me', body.token)).json().email).toBe('carla@test.dev');
    expect((await call('POST', '/auth/login', undefined, { email: 'carla@test.dev', password: 'secret123' })).statusCode).toBe(200);
  });

  it('never lets registration choose the driver role', async () => {
    const { call } = await setupApp();
    const response = await call('POST', '/auth/register', undefined, {
      name: 'Mallory',
      email: 'mallory@test.dev',
      password: 'secret123',
      address: 'Calle 1',
      role: 'driver',
    });
    expect(response.statusCode).toBe(201);
    expect(response.json().user.role).toBe('passenger');
  });

  it('rejects registering an email that already exists, case-insensitively', async () => {
    const { call } = await setupApp();
    const response = await call('POST', '/auth/register', undefined, {
      name: 'Ana 2',
      email: 'ANA@test.dev',
      password: 'secret123',
      address: 'Calle 1',
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('EMAIL_TAKEN');
  });

  it.each([
    ['a short password', { name: 'X', email: 'x@test.dev', password: 'short', address: 'Calle 1' }],
    ['a missing address', { name: 'X', email: 'x@test.dev', password: 'secret123', address: '   ' }],
    ['a missing name', { name: '', email: 'x@test.dev', password: 'secret123', address: 'Calle 1' }],
    ['an invalid email', { name: 'X', email: 'nope', password: 'secret123', address: 'Calle 1' }],
  ])('rejects registration with %s', async (_case, payload) => {
    const { call } = await setupApp();
    const response = await call('POST', '/auth/register', undefined, payload);
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION_FAILED');
  });

  it('rejects malformed bodies with 400', async () => {
    const { call } = await setupApp();
    const response = await call('POST', '/auth/login', undefined, { email: 'not-an-email' });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION_FAILED');
  });

  it('requires a valid token on protected routes', async () => {
    const { call } = await setupApp();
    expect((await call('GET', '/trips/current')).statusCode).toBe(401);
    expect((await call('GET', '/trips/current', 'garbage')).statusCode).toBe(401);
  });

  it('returns the current user', async () => {
    const { call, login } = await setupApp();
    const response = await call('GET', '/me', await login('driver@test.dev'));
    expect(response.statusCode).toBe(200);
    expect(response.json().role).toBe('driver');
  });

  it('registers and clears a push token', async () => {
    const { call, login, users } = await setupApp();
    const token = await login('ana@test.dev');

    expect((await call('PUT', '/me/push-token', token, { token: 'ExponentPushToken[abc]' })).statusCode).toBe(204);
    expect(await users.pushTokensFor('passenger')).toEqual(['ExponentPushToken[abc]']);

    expect((await call('PUT', '/me/push-token', token, { token: null })).statusCode).toBe(204);
    expect(await users.pushTokensFor('passenger')).toEqual([]);
  });

  it('runs a full trip and returns role-specific views', async () => {
    const { call, login, ana } = await setupApp();
    const driver = await login('driver@test.dev');
    const passenger = await login('ana@test.dev');

    expect((await call('GET', '/trips/current', passenger)).json()).toEqual({ role: 'passenger', nextRoute: 'manana', activeTrip: null });

    const started = await call('POST', '/trips', driver);
    expect(started.statusCode).toBe(201);
    expect(started.json().activeTrip.route).toBe('manana');

    const joined = await call('POST', '/trips/current/passengers', passenger);
    expect(joined.statusCode).toBe(200);
    expect(joined.json().activeTrip).toEqual({
      id: expect.any(String),
      route: 'manana',
      startedAt: expect.any(String),
      joined: true,
      confirmed: false,
    });

    const driverView = (await call('GET', '/trips/current', driver)).json();
    expect(driverView.activeTrip.passengers).toEqual([{ userId: ana.id, name: 'Ana', address: 'Calle 1', confirmed: false }]);
    expect(driverView.activeTrip.canFinish).toBe(false);

    const pending = await call('POST', '/trips/current/finish', driver);
    expect(pending.statusCode).toBe(409);
    expect(pending.json().error.code).toBe('PENDING_STOPS');

    const confirmed = await call('POST', `/trips/current/passengers/${ana.id}/confirm`, driver);
    expect(confirmed.json().activeTrip.canFinish).toBe(true);

    const finished = await call('POST', '/trips/current/finish', driver);
    expect(finished.statusCode).toBe(200);
    expect(finished.json()).toEqual({ role: 'driver', nextRoute: 'norte', activeTrip: null });
  });

  it('lets a passenger cancel and shows whether their stop was confirmed', async () => {
    const { call, login, ana } = await setupApp();
    const driver = await login('driver@test.dev');
    const passenger = await login('ana@test.dev');
    await call('POST', '/trips', driver);

    const joined = (await call('POST', '/trips/current/passengers', passenger)).json();
    expect(joined.activeTrip).toMatchObject({ joined: true, confirmed: false });

    const cancelled = await call('DELETE', '/trips/current/passengers', passenger);
    expect(cancelled.statusCode).toBe(200);
    expect(cancelled.json().activeTrip).toMatchObject({ joined: false, confirmed: false });
    expect((await call('GET', '/trips/current', driver)).json().activeTrip.passengers).toEqual([]);

    await call('POST', '/trips/current/passengers', passenger);
    await call('POST', `/trips/current/passengers/${ana.id}/confirm`, driver);
    expect((await call('GET', '/trips/current', passenger)).json().activeTrip).toMatchObject({ joined: true, confirmed: true });

    const tooLate = await call('DELETE', '/trips/current/passengers', passenger);
    expect(tooLate.statusCode).toBe(409);
    expect(tooLate.json().error.code).toBe('STOP_ALREADY_CONFIRMED');
  });

  it('maps domain errors to HTTP status codes', async () => {
    const { call, login } = await setupApp();
    const driver = await login('driver@test.dev');
    const passenger = await login('ana@test.dev');

    expect((await call('POST', '/trips', passenger)).statusCode).toBe(403);
    expect((await call('POST', '/trips/current/passengers', passenger)).statusCode).toBe(409);
    await call('POST', '/trips', driver);
    expect((await call('POST', '/trips', driver)).statusCode).toBe(409);
    expect((await call('POST', '/trips/current/passengers/00000000-0000-0000-0000-000000000000/confirm', driver)).statusCode).toBe(404);
  });

  it.each(['GET', 'POST', 'PUT', 'DELETE'])('allows %s in CORS preflight so the web client can call it', async (method) => {
    const { app } = await setupApp();
    const response = await app.inject({
      method: 'OPTIONS',
      url: '/trips/current/passengers',
      headers: { origin: 'http://localhost:8081', 'access-control-request-method': method },
    });
    expect(response.statusCode).toBe(204);
    expect(String(response.headers['access-control-allow-methods']).split(/,\s*/)).toContain(method);
  });

  it('answers the health check without auth', async () => {
    const { call } = await setupApp();
    expect((await call('GET', '/health')).json()).toEqual({ ok: true });
  });
});

describe('realtime', () => {
  function nextMessage(ws: { once(event: 'message', listener: (data: Buffer) => void): unknown }): Promise<any> {
    return new Promise((resolve) => ws.once('message', (data) => resolve(JSON.parse(data.toString()))));
  }

  it('authenticates with the first message, sends a snapshot, and pushes passenger joins to the driver', async () => {
    const { app, call, login, ana } = await setupApp();
    const driver = await login('driver@test.dev');
    const passenger = await login('ana@test.dev');
    await call('POST', '/trips', driver);

    const ws = await app.injectWS('/ws');
    const snapshot = nextMessage(ws);
    ws.send(JSON.stringify({ type: 'auth', token: driver }));
    expect((await snapshot).data.activeTrip.passengers).toEqual([]);

    const update = nextMessage(ws);
    await call('POST', '/trips/current/passengers', passenger);
    expect((await update).data.activeTrip.passengers).toEqual([{ userId: ana.id, name: 'Ana', address: 'Calle 1', confirmed: false }]);
    ws.terminate();
  });

  it('closes the socket when the auth message is invalid', async () => {
    const { app } = await setupApp();
    const ws = await app.injectWS('/ws');
    const closed = new Promise<number>((resolve) => ws.once('close', (code) => resolve(code)));
    ws.send(JSON.stringify({ type: 'auth', token: 'garbage' }));
    expect(await closed).toBe(4401);
  });
});
