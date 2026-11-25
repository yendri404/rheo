import { afterEach, describe, expect, it } from 'vitest';
import type { buildApp } from '../src/http/app.ts';
import { appWorld } from './support.ts';

const ADMIN_PASSWORD = 'correct-horse-battery-staple';
const apps: Awaited<ReturnType<typeof buildApp>>[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

async function setup(adminPassword: string = ADMIN_PASSWORD) {
  const base = await appWorld({ adminPassword });
  const { app } = base;
  apps.push(app);
  const inEureka = `?companyId=${base.eureka.id}`;
  const inAcme = `?companyId=${base.acme.id}`;

  async function call(method: string, url: string, token?: string, payload?: object, ip = '10.0.0.1') {
    return app.inject({
      method: method as 'GET',
      url,
      payload,
      remoteAddress: ip,
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });
  }
  async function adminLogin(): Promise<string> {
    const response = await call('POST', '/admin/login', undefined, { password: ADMIN_PASSWORD });
    expect(response.statusCode).toBe(200);
    return response.json().token;
  }
  async function userLogin(email: string): Promise<string> {
    return (await call('POST', '/auth/login', undefined, { email, password: 'secret123' })).json().token;
  }
  return { ...base, call, adminLogin, userLogin, inEureka, inAcme };
}

describe('admin access', () => {
  it('logs in with the master password and rejects a wrong one', async () => {
    const { call } = await setup();
    expect((await call('POST', '/admin/login', undefined, { password: ADMIN_PASSWORD })).json().token).toEqual(expect.any(String));
    const wrong = await call('POST', '/admin/login', undefined, { password: 'nope' });
    expect(wrong.statusCode).toBe(401);
    expect(wrong.json().error.code).toBe('INVALID_CREDENTIALS');
  });

  it('locks an address out after 5 failed attempts, without affecting other addresses', async () => {
    const { call } = await setup();
    for (let i = 0; i < 5; i++) await call('POST', '/admin/login', undefined, { password: `guess-${i}` });

    const blocked = await call('POST', '/admin/login', undefined, { password: ADMIN_PASSWORD });
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json().error.code).toBe('TOO_MANY_ATTEMPTS');

    expect((await call('POST', '/admin/login', undefined, { password: ADMIN_PASSWORD }, '10.0.0.2')).statusCode).toBe(200);
  });

  it('does not exist at all when no master password is configured', async () => {
    const { call } = await setup(''); // empty ADMIN_PASSWORD = panel disabled
    expect((await call('POST', '/admin/login', undefined, { password: 'anything' })).statusCode).toBe(404);
    expect((await call('GET', '/admin/users')).statusCode).toBe(404);
    expect((await call('GET', '/admin')).statusCode).toBe(404);
  });

  it('rejects requests without an admin session, including app sessions', async () => {
    const { call, userLogin } = await setup();
    expect((await call('GET', '/admin/users')).statusCode).toBe(401);
    const session = await userLogin('driver@test.dev');
    expect((await call('GET', '/admin/users', session)).statusCode).toBe(401);
    expect((await call('GET', '/admin/companies', session)).statusCode).toBe(401);
    expect((await call('POST', '/admin/companies', session, { name: 'Mine' })).statusCode).toBe(401);
  });

  it('does not accept an admin session in the app', async () => {
    const { call, adminLogin } = await setup();
    const admin = await adminLogin();
    expect((await call('GET', '/me', admin)).statusCode).toBe(401);
    expect((await call('POST', '/trips', admin)).statusCode).toBe(401);
    expect((await call('GET', '/admin/companies')).statusCode).toBe(401);
  });

  it('serves the admin page', async () => {
    const { call } = await setup();
    const page = await call('GET', '/admin');
    expect(page.statusCode).toBe(200);
    expect(page.headers['content-type']).toContain('text/html');
    expect(page.headers['content-security-policy']).toContain("default-src 'self'");
  });
});

describe('admin user management', () => {
  it('lists passengers and drivers with their companies, without password hashes', async () => {
    const { call, adminLogin, eureka, acme } = await setup();
    const response = await call('GET', '/admin/users', await adminLogin());

    expect(response.statusCode).toBe(200);
    type Listed = { email: string; role: string; companies: { id: string }[] };
    expect(response.json().users.map((user: Listed) => [user.email, user.role, user.companies.map((c) => c.id)])).toEqual([
      ['driver@test.dev', 'driver', [acme.id, eureka.id]],
      ['ana@test.dev', 'passenger', [eureka.id]],
      ['beto@test.dev', 'passenger', [eureka.id]],
      ['carla@test.dev', 'passenger', [acme.id]],
    ]);
    expect(JSON.stringify(response.json())).not.toContain('passwordHash');
  });

  it('creates a driver who can then log in to the app', async () => {
    const { call, adminLogin, eureka, acme } = await setup();
    const response = await call('POST', '/admin/users', await adminLogin(), {
      name: ' Carlos ',
      email: 'CARLOS@test.dev',
      address: '',
      role: 'driver',
      password: 'carlos-pass-1',
      companyIds: [eureka.id, acme.id],
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().user).toEqual({
      id: expect.any(String),
      email: 'carlos@test.dev',
      name: 'Carlos',
      address: '',
      role: 'driver',
      companies: [
        { id: acme.id, name: 'Acme' },
        { id: eureka.id, name: 'Eureka' },
      ],
      createdAt: expect.any(String),
    });
    const login = await call('POST', '/auth/login', undefined, { email: 'carlos@test.dev', password: 'carlos-pass-1' });
    expect(login.json().user.role).toBe('driver');
    expect(login.json().user.companies).toHaveLength(2);
  });

  it('requires an address for passengers and validates the rest of the fields', async () => {
    const { call, adminLogin, eureka, acme } = await setup();
    const admin = await adminLogin();
    const base = {
      name: 'X',
      email: 'x@test.dev',
      address: 'Calle 2',
      role: 'passenger',
      password: 'long-enough',
      companyIds: [eureka.id],
    };
    for (const payload of [
      { ...base, address: '  ' },
      { ...base, companyIds: [] },
      { ...base, companyIds: [eureka.id, acme.id] },
      { ...base, companyIds: undefined },
      { ...base, companyIds: ['not-a-uuid'] },
      { ...base, role: 'driver', address: '', companyIds: [] },
      { ...base, password: 'short' },
      { ...base, email: 'nope' },
      { ...base, role: 'admin' },
      { ...base, name: '' },
    ]) {
      const response = await call('POST', '/admin/users', admin, payload);
      expect(response.statusCode, JSON.stringify(payload)).toBe(400);
    }
    const unknownCompany = await call('POST', '/admin/users', admin, {
      ...base,
      companyIds: ['00000000-0000-0000-0000-000000000000'],
    });
    expect(unknownCompany.statusCode).toBe(404);
    expect(unknownCompany.json().error.code).toBe('COMPANY_NOT_FOUND');
    expect((await call('GET', '/admin/users', admin)).json().users).toHaveLength(4);
  });

  it('rejects creating a user with an existing email', async () => {
    const { call, adminLogin, eureka } = await setup();
    const response = await call('POST', '/admin/users', await adminLogin(), {
      name: 'Ana 2',
      email: 'ANA@test.dev',
      address: 'Calle 9',
      role: 'passenger',
      password: 'long-enough',
      companyIds: [eureka.id],
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('EMAIL_TAKEN');
  });

  it('edits a user, promotes them to driver and resets their password', async () => {
    const { call, adminLogin, ana } = await setup();
    const response = await call('PATCH', `/admin/users/${ana.id}`, await adminLogin(), {
      address: 'Calle Nueva 5',
      role: 'driver',
      password: 'brand-new-pass',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().user).toMatchObject({ address: 'Calle Nueva 5', role: 'driver' });
    expect((await call('POST', '/auth/login', undefined, { email: 'ana@test.dev', password: 'secret123' })).statusCode).toBe(401);
    expect((await call('POST', '/auth/login', undefined, { email: 'ana@test.dev', password: 'brand-new-pass' })).statusCode).toBe(200);
  });

  it('deletes a user, whose app session then stops working', async () => {
    const { call, adminLogin, userLogin, ana } = await setup();
    const session = await userLogin('ana@test.dev');

    expect((await call('DELETE', `/admin/users/${ana.id}`, await adminLogin())).statusCode).toBe(204);
    expect((await call('GET', '/me', session)).statusCode).toBe(401);
  });

  it('returns 404 for unknown users', async () => {
    const { call, adminLogin } = await setup();
    const admin = await adminLogin();
    const missing = '00000000-0000-0000-0000-000000000000';
    expect((await call('PATCH', `/admin/users/${missing}`, admin, { name: 'X' })).json().error.code).toBe('USER_NOT_FOUND');
    expect((await call('DELETE', `/admin/users/${missing}`, admin)).statusCode).toBe(404);
  });

  it('refuses to delete or change the role of a passenger in the active trip, but allows other edits', async () => {
    const { call, adminLogin, userLogin, ana, acme, inEureka } = await setup();
    await call('POST', `/trips${inEureka}`, await userLogin('driver@test.dev'));
    await call('POST', '/trips/current/passengers', await userLogin('ana@test.dev'));
    const admin = await adminLogin();
    expect((await call('PATCH', `/admin/users/${ana.id}`, admin, { companyIds: [acme.id] })).json().error.code).toBe(
      'USER_IN_ACTIVE_TRIP',
    );

    const deletion = await call('DELETE', `/admin/users/${ana.id}`, admin);
    expect(deletion.statusCode).toBe(409);
    expect(deletion.json().error.code).toBe('USER_IN_ACTIVE_TRIP');
    expect((await call('PATCH', `/admin/users/${ana.id}`, admin, { role: 'driver' })).json().error.code).toBe('USER_IN_ACTIVE_TRIP');
    expect((await call('PATCH', `/admin/users/${ana.id}`, admin, { address: 'Otra 1' })).statusCode).toBe(200);
  });

  it('refuses to delete or demote a driver while a trip is running, so the trip never loses its driver', async () => {
    const { call, adminLogin, userLogin, driver, eureka, acme, inEureka } = await setup();
    await call('POST', `/trips${inEureka}`, await userLogin('driver@test.dev'));
    const admin = await adminLogin();

    // Leaving the company whose trip is running is refused; leaving the idle one is fine.
    expect((await call('PATCH', `/admin/users/${driver.id}`, admin, { companyIds: [acme.id] })).json().error.code).toBe(
      'USER_IN_ACTIVE_TRIP',
    );
    expect((await call('PATCH', `/admin/users/${driver.id}`, admin, { companyIds: [eureka.id] })).statusCode).toBe(200);

    expect((await call('DELETE', `/admin/users/${driver.id}`, admin)).json().error.code).toBe('USER_IN_ACTIVE_TRIP');
    expect(
      (await call('PATCH', `/admin/users/${driver.id}`, admin, { role: 'passenger', address: 'Calle 3' })).json().error.code,
    ).toBe('USER_IN_ACTIVE_TRIP');
  });

  it('requires an address when turning a driver into a passenger', async () => {
    const { call, adminLogin, driver } = await setup();
    const response = await call('PATCH', `/admin/users/${driver.id}`, await adminLogin(), { role: 'passenger' });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION_FAILED');
  });
});

describe('admin company membership', () => {
  it('moves a passenger to another company, which is then the only one they can see', async () => {
    const { call, adminLogin, userLogin, ana, eureka, acme, inEureka } = await setup();
    const session = await userLogin('ana@test.dev');
    const response = await call('PATCH', `/admin/users/${ana.id}`, await adminLogin(), { companyIds: [acme.id] });

    expect(response.statusCode).toBe(200);
    expect(response.json().user.companies).toEqual([{ id: acme.id, name: 'Acme' }]);
    expect((await call('GET', '/trips/current', session)).json().companyId).toBe(acme.id);
    expect((await call('GET', `/trips/current${inEureka}`, session)).statusCode).toBe(403);
    expect((await call('GET', '/me', session)).json().companies).toEqual([{ id: acme.id, name: 'Acme' }]);
    expect(eureka.id).not.toBe(acme.id);
  });

  it('keeps passengers in exactly one company and drivers in at least one', async () => {
    const { call, adminLogin, ana, driver, eureka, acme } = await setup();
    const admin = await adminLogin();
    const both = [eureka.id, acme.id];

    expect((await call('PATCH', `/admin/users/${ana.id}`, admin, { companyIds: both })).statusCode).toBe(400);
    expect((await call('PATCH', `/admin/users/${ana.id}`, admin, { companyIds: [] })).statusCode).toBe(400);
    expect((await call('PATCH', `/admin/users/${driver.id}`, admin, { companyIds: [] })).statusCode).toBe(400);
    // A driver of two companies cannot become a passenger without choosing one.
    const demoted = await call('PATCH', `/admin/users/${driver.id}`, admin, { role: 'passenger', address: 'Calle 3' });
    expect(demoted.statusCode).toBe(400);
    expect(
      (await call('PATCH', `/admin/users/${ana.id}`, admin, { companyIds: ['00000000-0000-0000-0000-000000000000'] })).json().error
        .code,
    ).toBe('COMPANY_NOT_FOUND');

    const promoted = await call('PATCH', `/admin/users/${ana.id}`, admin, { role: 'driver', companyIds: both });
    expect(promoted.statusCode).toBe(200);
    expect(promoted.json().user.companies).toHaveLength(2);
    expect((await call('GET', '/admin/users', admin)).json().users.find((u: { id: string }) => u.id === driver.id).companies).toHaveLength(2);
  });

  it('drops the live connection of a user whose companies change, so they stop watching the old one', async () => {
    const { app, call, adminLogin, userLogin, ana, beto, acme } = await setup();
    const sockets = [];
    const closes: Record<string, number | null> = { ana: null, beto: null };
    for (const name of ['ana', 'beto'] as const) {
      const ws = await app.injectWS('/ws');
      ws.on('close', (code: number) => (closes[name] = code));
      ws.send(JSON.stringify({ type: 'auth', token: await userLogin(`${name}@test.dev`) }));
      sockets.push(ws);
    }
    await new Promise((resolve) => setTimeout(resolve, 60));
    const admin = await adminLogin();

    await call('PATCH', `/admin/users/${beto.id}`, admin, { name: 'Beto B.' });
    await call('PATCH', `/admin/users/${ana.id}`, admin, { companyIds: [acme.id] });
    await new Promise((resolve) => setTimeout(resolve, 60));

    expect(closes).toEqual({ ana: 1012, beto: null });
    for (const ws of sockets) ws.terminate();
  });
});

describe('admin company management', () => {
  it('lists companies with their routes in rotation order', async () => {
    const { call, adminLogin, eureka, acme } = await setup();
    const response = await call('GET', '/admin/companies', await adminLogin());

    expect(response.statusCode).toBe(200);
    expect(response.json().companies).toEqual([
      { id: acme.id, name: 'Acme', routes: [{ id: expect.any(String), name: 'Centro', kind: 'pickup' }] },
      {
        id: eureka.id,
        name: 'Eureka',
        routes: [
          { id: expect.any(String), name: 'Mañana', kind: 'pickup' },
          { id: expect.any(String), name: 'Norte', kind: 'dropoff' },
          { id: expect.any(String), name: 'Sur', kind: 'dropoff' },
        ],
      },
    ]);
  });

  it('creates a company with routes that a driver assigned to it can run', async () => {
    const { call, adminLogin, userLogin, driver, eureka } = await setup();
    const admin = await adminLogin();
    const created = await call('POST', '/admin/companies', admin, {
      name: ' Globex ',
      routes: [
        { name: ' Turno 1 ', kind: 'pickup' },
        { name: 'Turno 2', kind: 'dropoff' },
      ],
    });

    expect(created.statusCode).toBe(201);
    const company = created.json().company;
    expect(company).toEqual({
      id: expect.any(String),
      name: 'Globex',
      routes: [
        { id: expect.any(String), name: 'Turno 1', kind: 'pickup' },
        { id: expect.any(String), name: 'Turno 2', kind: 'dropoff' },
      ],
    });

    await call('PATCH', `/admin/users/${driver.id}`, admin, { companyIds: [eureka.id, company.id] });
    const started = await call('POST', `/trips?companyId=${company.id}`, await userLogin('driver@test.dev'));
    expect(started.statusCode).toBe(201);
    expect(started.json()).toMatchObject({ activeTrip: { route: { name: 'Turno 1' } }, nextRoute: { name: 'Turno 2' } });
  });

  it('creates a company without routes, where no trip can start until it has one', async () => {
    const { call, adminLogin, userLogin, driver, eureka } = await setup();
    const admin = await adminLogin();
    const company = (await call('POST', '/admin/companies', admin, { name: 'Empty' })).json().company;
    expect(company.routes).toEqual([]);
    await call('PATCH', `/admin/users/${driver.id}`, admin, { companyIds: [eureka.id, company.id] });
    const session = await userLogin('driver@test.dev');

    expect((await call('GET', `/trips/current?companyId=${company.id}`, session)).json().nextRoute).toBeNull();
    const refused = await call('POST', `/trips?companyId=${company.id}`, session);
    expect(refused.statusCode).toBe(409);
    expect(refused.json().error.code).toBe('NO_ROUTES');
  });

  it('validates company names and routes', async () => {
    const { call, adminLogin } = await setup();
    const admin = await adminLogin();
    const route = { name: 'Turno', kind: 'pickup' };
    for (const payload of [
      { name: '  ' },
      { name: 'x'.repeat(61) },
      { name: 'Ok', routes: [{ ...route, kind: 'express' }] },
      { name: 'Ok', routes: [{ ...route, name: '' }] },
      { name: 'Ok', routes: [{ ...route, name: 'x'.repeat(25) }] },
      { name: 'Ok', routes: [route, { ...route, name: 'TURNO' }] },
      { name: 'Ok', routes: Array.from({ length: 21 }, (_, i) => ({ ...route, name: `R${i}` })) },
    ]) {
      const response = await call('POST', '/admin/companies', admin, payload);
      expect(response.statusCode, JSON.stringify(payload).slice(0, 80)).toBe(400);
    }
    const duplicate = await call('POST', '/admin/companies', admin, { name: 'eureka' });
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json().error.code).toBe('COMPANY_NAME_TAKEN');
    expect((await call('GET', '/admin/companies', admin)).json().companies).toHaveLength(2);
  });

  it('renames a company and reorders, renames, adds and removes its routes', async () => {
    const { call, adminLogin, userLogin, eureka, inEureka } = await setup();
    const admin = await adminLogin();
    const [manana, norte, sur] = eureka.routes;

    const response = await call('PATCH', `/admin/companies/${eureka.id}`, admin, {
      name: 'Eureka C.A.',
      routes: [
        { id: norte!.id, name: 'Norte', kind: 'dropoff' },
        { id: manana!.id, name: 'Amanecer', kind: 'pickup' },
        { name: 'Este', kind: 'dropoff' },
      ],
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().company).toEqual({
      id: eureka.id,
      name: 'Eureka C.A.',
      routes: [
        { id: norte!.id, name: 'Norte', kind: 'dropoff' },
        { id: manana!.id, name: 'Amanecer', kind: 'pickup' },
        { id: expect.any(String), name: 'Este', kind: 'dropoff' },
      ],
    });
    expect(response.json().company.routes.map((r: { id: string }) => r.id)).not.toContain(sur!.id);
    const view = (await call('GET', `/trips/current${inEureka}`, await userLogin('driver@test.dev'))).json();
    expect(view.nextRoute).toEqual({ name: 'Norte', kind: 'dropoff' });
    expect((await call('GET', '/me', await userLogin('ana@test.dev'))).json().companies).toEqual([
      { id: eureka.id, name: 'Eureka C.A.' },
    ]);

    expect((await call('PATCH', `/admin/companies/${eureka.id}`, admin, {})).statusCode).toBe(400);
    expect((await call('PATCH', `/admin/companies/${eureka.id}`, admin, { name: 'acme' })).json().error.code).toBe(
      'COMPANY_NAME_TAKEN',
    );
    const missing = '00000000-0000-0000-0000-000000000000';
    expect((await call('PATCH', `/admin/companies/${missing}`, admin, { name: 'X' })).json().error.code).toBe('COMPANY_NOT_FOUND');
  });

  it('only deletes a company that has no members and no running trip', async () => {
    const { call, adminLogin, userLogin, driver, carla, eureka, acme, inAcme } = await setup();
    const admin = await adminLogin();

    const withMembers = await call('DELETE', `/admin/companies/${acme.id}`, admin);
    expect(withMembers.statusCode).toBe(409);
    expect(withMembers.json().error.code).toBe('COMPANY_HAS_MEMBERS');

    await call('POST', `/trips${inAcme}`, await userLogin('driver@test.dev'));
    const running = await call('DELETE', `/admin/companies/${acme.id}`, admin);
    expect(running.statusCode).toBe(409);
    expect(running.json().error.code).toBe('COMPANY_IN_ACTIVE_TRIP');
    await call('POST', `/trips/current/finish${inAcme}`, await userLogin('driver@test.dev'));

    await call('PATCH', `/admin/users/${driver.id}`, admin, { companyIds: [eureka.id] });
    await call('PATCH', `/admin/users/${carla.id}`, admin, { companyIds: [eureka.id] });
    expect((await call('DELETE', `/admin/companies/${acme.id}`, admin)).statusCode).toBe(204);
    expect((await call('GET', '/admin/companies', admin)).json().companies.map((c: { name: string }) => c.name)).toEqual(['Eureka']);
    expect((await call('DELETE', `/admin/companies/${acme.id}`, admin)).statusCode).toBe(404);
  });
});
