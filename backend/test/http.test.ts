import { afterEach, describe, expect, it } from 'vitest';
import type { buildApp } from '../src/http/app.ts';
import { appWorld } from './support.ts';

const apps: Awaited<ReturnType<typeof buildApp>>[] = [];

async function setupApp() {
  const base = await appWorld();
  const { app } = base;
  apps.push(app);

  async function login(email: string): Promise<string> {
    const response = await app.inject({ method: 'POST', url: '/auth/login', payload: { email, password: 'secret123' } });
    expect(response.statusCode).toBe(200);
    return response.json().token;
  }

  async function call(method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, token?: string, payload?: object) {
    return app.inject({ method, url, payload, headers: token ? { authorization: `Bearer ${token}` } : {} });
  }

  /** The driver works for two companies, so every driver call names one. */
  const inEureka = `?companyId=${base.eureka.id}`;
  const inAcme = `?companyId=${base.acme.id}`;

  return { ...base, login, call, inEureka, inAcme };
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe('HTTP API', () => {
  it('logs in with valid credentials and returns the user with their companies, without the password hash', async () => {
    const { call, eureka } = await setupApp();
    const response = await call('POST', '/auth/login', undefined, { email: ' ANA@test.dev ', password: 'secret123' });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.token).toEqual(expect.any(String));
    expect(body.user).toEqual({
      id: expect.any(String),
      email: 'ana@test.dev',
      name: 'Ana',
      address: 'Calle 1',
      role: 'passenger',
      companies: [{ id: eureka.id, name: 'Eureka' }],
    });
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

  it('has no self sign-up: registering is not possible and creates no user', async () => {
    const { call, users } = await setupApp();
    const response = await call('POST', '/auth/register', undefined, {
      name: 'Outsider',
      email: 'outsider@test.dev',
      password: 'secret123',
      address: 'Calle 9 #10',
      role: 'driver',
    });

    expect(response.statusCode).toBe(404);
    expect(await users.findByEmail('outsider@test.dev')).toBeNull();
    expect((await call('POST', '/auth/login', undefined, { email: 'outsider@test.dev', password: 'secret123' })).statusCode).toBe(401);
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

  it('returns the current user with the companies they can choose from, sorted by name', async () => {
    const { call, login, eureka, acme } = await setupApp();
    const response = await call('GET', '/me', await login('driver@test.dev'));
    expect(response.statusCode).toBe(200);
    expect(response.json().role).toBe('driver');
    expect(response.json().companies).toEqual([
      { id: acme.id, name: 'Acme' },
      { id: eureka.id, name: 'Eureka' },
    ]);
  });

  it('registers and clears a push token', async () => {
    const { call, login, users, eureka } = await setupApp();
    const token = await login('ana@test.dev');

    expect((await call('PUT', '/me/push-token', token, { token: 'ExponentPushToken[abc]' })).statusCode).toBe(204);
    expect(await users.pushTokensFor('passenger', eureka.id)).toEqual(['ExponentPushToken[abc]']);

    expect((await call('PUT', '/me/push-token', token, { token: null })).statusCode).toBe(204);
    expect(await users.pushTokensFor('passenger', eureka.id)).toEqual([]);
  });

  it('runs a full trip and returns role-specific views', async () => {
    const { call, login, ana, eureka, inEureka } = await setupApp();
    const driver = await login('driver@test.dev');
    const passenger = await login('ana@test.dev');

    expect((await call('GET', '/trips/current', passenger)).json()).toEqual({
      role: 'passenger',
      companyId: eureka.id,
      nextRoute: { name: 'Mañana', kind: 'pickup' },
      activeTrip: null,
    });

    const started = await call('POST', `/trips${inEureka}`, driver);
    expect(started.statusCode).toBe(201);
    expect(started.json().activeTrip.route).toEqual({ name: 'Mañana', kind: 'pickup' });

    const joined = await call('POST', '/trips/current/passengers', passenger);
    expect(joined.statusCode).toBe(200);
    expect(joined.json().activeTrip).toEqual({
      id: expect.any(String),
      route: { name: 'Mañana', kind: 'pickup' },
      startedAt: expect.any(String),
      joined: true,
      confirmed: false,
    });

    const driverView = (await call('GET', `/trips/current${inEureka}`, driver)).json();
    expect(driverView.activeTrip.passengers).toEqual([{ userId: ana.id, name: 'Ana', address: 'Calle 1', confirmed: false }]);
    expect(driverView.activeTrip.canFinish).toBe(false);

    const pending = await call('POST', `/trips/current/finish${inEureka}`, driver);
    expect(pending.statusCode).toBe(409);
    expect(pending.json().error.code).toBe('PENDING_STOPS');

    const confirmed = await call('POST', `/trips/current/passengers/${ana.id}/confirm${inEureka}`, driver);
    expect(confirmed.json().activeTrip.canFinish).toBe(true);

    const finished = await call('POST', `/trips/current/finish${inEureka}`, driver);
    expect(finished.statusCode).toBe(200);
    expect(finished.json()).toEqual({
      role: 'driver',
      companyId: eureka.id,
      nextRoute: { name: 'Norte', kind: 'dropoff' },
      activeTrip: null,
    });
  });

  it('lets a passenger cancel and shows whether their stop was confirmed', async () => {
    const { call, login, ana, inEureka } = await setupApp();
    const driver = await login('driver@test.dev');
    const passenger = await login('ana@test.dev');
    await call('POST', `/trips${inEureka}`, driver);

    const joined = (await call('POST', '/trips/current/passengers', passenger)).json();
    expect(joined.activeTrip).toMatchObject({ joined: true, confirmed: false });

    const cancelled = await call('DELETE', '/trips/current/passengers', passenger);
    expect(cancelled.statusCode).toBe(200);
    expect(cancelled.json().activeTrip).toMatchObject({ joined: false, confirmed: false });
    expect((await call('GET', `/trips/current${inEureka}`, driver)).json().activeTrip.passengers).toEqual([]);

    await call('POST', '/trips/current/passengers', passenger);
    await call('POST', `/trips/current/passengers/${ana.id}/confirm${inEureka}`, driver);
    expect((await call('GET', '/trips/current', passenger)).json().activeTrip).toMatchObject({ joined: true, confirmed: true });

    const tooLate = await call('DELETE', '/trips/current/passengers', passenger);
    expect(tooLate.statusCode).toBe(409);
    expect(tooLate.json().error.code).toBe('STOP_ALREADY_CONFIRMED');
  });

  it('maps domain errors to HTTP status codes', async () => {
    const { call, login, inEureka } = await setupApp();
    const driver = await login('driver@test.dev');
    const passenger = await login('ana@test.dev');

    expect((await call('POST', '/trips', passenger)).statusCode).toBe(403);
    expect((await call('POST', '/trips/current/passengers', passenger)).statusCode).toBe(409);
    await call('POST', `/trips${inEureka}`, driver);
    expect((await call('POST', `/trips${inEureka}`, driver)).statusCode).toBe(409);
    expect(
      (await call('POST', `/trips/current/passengers/00000000-0000-0000-0000-000000000000/confirm${inEureka}`, driver)).statusCode,
    ).toBe(404);
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

describe('companies', () => {
  it('makes a driver registered in several companies choose one', async () => {
    const { call, login, inAcme } = await setupApp();
    const driver = await login('driver@test.dev');

    const unspecified = await call('GET', '/trips/current', driver);
    expect(unspecified.statusCode).toBe(400);
    expect(unspecified.json().error.code).toBe('COMPANY_REQUIRED');
    expect((await call('POST', '/trips', driver)).json().error.code).toBe('COMPANY_REQUIRED');

    const acmeView = await call('GET', `/trips/current${inAcme}`, driver);
    expect(acmeView.json()).toMatchObject({ role: 'driver', nextRoute: { name: 'Centro', kind: 'pickup' }, activeTrip: null });
  });

  it('keeps the trips of each company apart: starting one does not start the other', async () => {
    const { call, login, acme, inEureka, inAcme } = await setupApp();
    const driver = await login('driver@test.dev');
    const carla = await login('carla@test.dev');
    await call('POST', `/trips${inEureka}`, driver);

    expect((await call('GET', `/trips/current${inAcme}`, driver)).json().activeTrip).toBeNull();
    expect((await call('GET', '/trips/current', carla)).json()).toMatchObject({ companyId: acme.id, activeTrip: null });
    expect((await call('POST', '/trips/current/passengers', carla)).json().error.code).toBe('NO_ACTIVE_TRIP');

    expect((await call('POST', `/trips${inAcme}`, driver)).statusCode).toBe(201);
    expect((await call('POST', '/trips/current/passengers', carla)).json().activeTrip.route.name).toBe('Centro');
    expect((await call('GET', `/trips/current${inEureka}`, driver)).json().activeTrip.passengers).toEqual([]);
  });

  it('refuses to show or change the trips of a company the user is not registered in', async () => {
    const { call, login, users, acme, inEureka, inAcme } = await setupApp();
    const driver = await login('driver@test.dev');
    const ana = await login('ana@test.dev');
    await call('POST', `/trips${inEureka}`, driver);
    await call('POST', `/trips${inAcme}`, driver);

    for (const [method, url] of [
      ['GET', `/trips/current${inAcme}`],
      ['POST', `/trips/current/passengers${inAcme}`],
      ['DELETE', `/trips/current/passengers${inAcme}`],
    ] as const) {
      const response = await call(method, url, ana);
      expect(response.statusCode, `${method} ${url}`).toBe(403);
      expect(response.json().error.code).toBe('FORBIDDEN');
    }
    expect((await call('GET', `/trips/current${inAcme}`, driver)).json().activeTrip.passengers).toEqual([]);

    const passwordHash = (await users.findByEmail('driver@test.dev'))!.passwordHash;
    await users.create({ email: 'rival@test.dev', passwordHash, name: 'Rival', address: '', role: 'driver', companyIds: [acme.id] });
    const rival = await login('rival@test.dev');
    expect((await call('GET', `/trips/current${inEureka}`, rival)).statusCode).toBe(403);
    expect((await call('POST', `/trips/current/finish${inEureka}`, rival)).statusCode).toBe(403);
    expect((await call('GET', `/trips/current${inEureka}`, driver)).json().activeTrip).not.toBeNull();
  });

  it('tells a user without any company that they have none, and rejects a malformed company id', async () => {
    const { call, login, users } = await setupApp();
    const passwordHash = (await users.findByEmail('ana@test.dev'))!.passwordHash;
    await users.create({ email: 'nobody@test.dev', passwordHash, name: 'Nobody', address: 'Calle 9', role: 'passenger', companyIds: [] });
    const nobody = await login('nobody@test.dev');

    const response = await call('GET', '/trips/current', nobody);
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('NO_COMPANY');
    expect((await call('GET', '/trips/current?companyId=not-a-uuid', nobody)).statusCode).toBe(400);
  });
});

describe('realtime', () => {
  type Ws = Awaited<ReturnType<Awaited<ReturnType<typeof buildApp>>['injectWS']>>;

  function nextMessage(ws: { once(event: 'message', listener: (data: Buffer) => void): unknown }): Promise<any> {
    return new Promise((resolve) => ws.once('message', (data) => resolve(JSON.parse(data.toString()))));
  }
  const closeCode = (ws: Ws) => new Promise<number>((resolve) => ws.once('close', (code: number) => resolve(code)));
  const settle = () => new Promise((resolve) => setTimeout(resolve, 60));

  it('authenticates with the first message, sends a snapshot, and pushes passenger joins to the driver', async () => {
    const { app, call, login, ana, eureka, inEureka } = await setupApp();
    const driver = await login('driver@test.dev');
    const passenger = await login('ana@test.dev');
    await call('POST', `/trips${inEureka}`, driver);

    const ws = await app.injectWS('/ws');
    const snapshot = nextMessage(ws);
    ws.send(JSON.stringify({ type: 'auth', token: driver, companyId: eureka.id }));
    expect((await snapshot).data.activeTrip.passengers).toEqual([]);

    const update = nextMessage(ws);
    await call('POST', '/trips/current/passengers', passenger);
    expect((await update).data.activeTrip.passengers).toEqual([{ userId: ana.id, name: 'Ana', address: 'Calle 1', confirmed: false }]);
    ws.terminate();
  });

  it('only pushes the changes of the company each client is watching', async () => {
    const { app, call, login, eureka, acme, inEureka } = await setupApp();
    const driver = await login('driver@test.dev');
    const messages: Record<string, any[]> = { carla: [], driverInAcme: [], ana: [] };
    const sockets: Ws[] = [];
    for (const [key, auth] of [
      ['carla', { token: await login('carla@test.dev') }],
      ['driverInAcme', { token: driver, companyId: acme.id }],
      ['ana', { token: await login('ana@test.dev') }],
    ] as const) {
      const ws = await app.injectWS('/ws');
      ws.on('message', (data: Buffer) => messages[key]!.push(JSON.parse(data.toString()).data));
      ws.send(JSON.stringify({ type: 'auth', ...auth }));
      sockets.push(ws);
    }
    await settle();
    expect(messages.carla).toEqual([expect.objectContaining({ companyId: acme.id, activeTrip: null })]);
    expect(messages.ana).toEqual([expect.objectContaining({ companyId: eureka.id, activeTrip: null })]);

    await call('POST', `/trips${inEureka}`, driver);
    await settle();

    expect(messages.ana).toHaveLength(2);
    expect(messages.ana![1].activeTrip.route.name).toBe('Mañana');
    expect(messages.carla).toHaveLength(1);
    expect(messages.driverInAcme).toHaveLength(1);
    for (const ws of sockets) ws.terminate();
  });

  it('refuses to watch a company the user is not registered in, or none when there are several to choose', async () => {
    const { app, login, acme } = await setupApp();

    const foreign = await app.injectWS('/ws');
    const foreignClosed = closeCode(foreign);
    foreign.send(JSON.stringify({ type: 'auth', token: await login('ana@test.dev'), companyId: acme.id }));
    expect(await foreignClosed).toBe(4403);

    const undecided = await app.injectWS('/ws');
    const undecidedClosed = closeCode(undecided);
    undecided.send(JSON.stringify({ type: 'auth', token: await login('driver@test.dev') }));
    expect(await undecidedClosed).toBe(4403);
  });

  it('closes the socket when the auth message is invalid', async () => {
    const { app } = await setupApp();
    const ws = await app.injectWS('/ws');
    const closed = closeCode(ws);
    ws.send(JSON.stringify({ type: 'auth', token: 'garbage' }));
    expect(await closed).toBe(4401);
  });
});
