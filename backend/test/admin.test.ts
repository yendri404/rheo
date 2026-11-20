import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/http/app.ts';
import { InMemoryTripRepository } from '../src/infrastructure/memory/in-memory-trip-repository.ts';
import { InMemoryUserRepository } from '../src/infrastructure/memory/in-memory-user-repository.ts';
import { WsHub } from '../src/infrastructure/realtime/ws-hub.ts';
import { TripService } from '../src/trips/trip-service.ts';
import { AuthService } from '../src/users/auth-service.ts';
import { hashPassword } from '../src/users/password.ts';
import { RecordingNotifier } from './support.ts';

const ADMIN_PASSWORD = 'correct-horse-battery-staple';
const apps: Awaited<ReturnType<typeof buildApp>>[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

async function setup(adminPassword: string = ADMIN_PASSWORD) {
  const users = new InMemoryUserRepository();
  const hub = new WsHub();
  const tripService = new TripService({ trips: new InMemoryTripRepository(users), users, events: hub, notifier: new RecordingNotifier() });
  const app = await buildApp({ users, hub, tripService, authService: new AuthService(users), jwtSecret: 'test-secret', adminPassword });
  apps.push(app);
  await app.ready();
  const passwordHash = await hashPassword('secret123');
  const driver = await users.create({ email: 'driver@test.dev', passwordHash, name: 'Driver', address: '', role: 'driver' });
  const ana = await users.create({ email: 'ana@test.dev', passwordHash, name: 'Ana', address: 'Calle 1', role: 'passenger' });

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
  return { app, users, call, adminLogin, userLogin, driver, ana };
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
    expect((await call('GET', '/admin/users', await userLogin('driver@test.dev'))).statusCode).toBe(401);
  });

  it('does not accept an admin session in the app', async () => {
    const { call, adminLogin } = await setup();
    const admin = await adminLogin();
    expect((await call('GET', '/me', admin)).statusCode).toBe(401);
    expect((await call('POST', '/trips', admin)).statusCode).toBe(401);
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
  it('lists passengers and drivers without password hashes', async () => {
    const { call, adminLogin } = await setup();
    const response = await call('GET', '/admin/users', await adminLogin());

    expect(response.statusCode).toBe(200);
    expect(response.json().users.map((user: { email: string; role: string }) => [user.email, user.role])).toEqual([
      ['driver@test.dev', 'driver'],
      ['ana@test.dev', 'passenger'],
    ]);
    expect(JSON.stringify(response.json())).not.toContain('passwordHash');
  });

  it('creates a driver who can then log in to the app', async () => {
    const { call, adminLogin } = await setup();
    const response = await call('POST', '/admin/users', await adminLogin(), {
      name: ' Carlos ',
      email: 'CARLOS@test.dev',
      address: '',
      role: 'driver',
      password: 'carlos-pass-1',
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().user).toEqual({
      id: expect.any(String),
      email: 'carlos@test.dev',
      name: 'Carlos',
      address: '',
      role: 'driver',
      createdAt: expect.any(String),
    });
    const login = await call('POST', '/auth/login', undefined, { email: 'carlos@test.dev', password: 'carlos-pass-1' });
    expect(login.json().user.role).toBe('driver');
  });

  it('requires an address for passengers and validates the rest of the fields', async () => {
    const { call, adminLogin } = await setup();
    const admin = await adminLogin();
    const base = { name: 'X', email: 'x@test.dev', address: 'Calle 2', role: 'passenger', password: 'long-enough' };
    for (const payload of [
      { ...base, address: '  ' },
      { ...base, password: 'short' },
      { ...base, email: 'nope' },
      { ...base, role: 'admin' },
      { ...base, name: '' },
    ]) {
      const response = await call('POST', '/admin/users', admin, payload);
      expect(response.statusCode, JSON.stringify(payload)).toBe(400);
    }
  });

  it('rejects creating a user with an existing email', async () => {
    const { call, adminLogin } = await setup();
    const response = await call('POST', '/admin/users', await adminLogin(), {
      name: 'Ana 2',
      email: 'ANA@test.dev',
      address: 'Calle 9',
      role: 'passenger',
      password: 'long-enough',
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
    const { call, adminLogin, userLogin, ana } = await setup();
    await call('POST', '/trips', await userLogin('driver@test.dev'));
    await call('POST', '/trips/current/passengers', await userLogin('ana@test.dev'));
    const admin = await adminLogin();

    const deletion = await call('DELETE', `/admin/users/${ana.id}`, admin);
    expect(deletion.statusCode).toBe(409);
    expect(deletion.json().error.code).toBe('USER_IN_ACTIVE_TRIP');
    expect((await call('PATCH', `/admin/users/${ana.id}`, admin, { role: 'driver' })).json().error.code).toBe('USER_IN_ACTIVE_TRIP');
    expect((await call('PATCH', `/admin/users/${ana.id}`, admin, { address: 'Otra 1' })).statusCode).toBe(200);
  });

  it('refuses to delete or demote a driver while a trip is running, so the trip never loses its driver', async () => {
    const { call, adminLogin, userLogin, driver } = await setup();
    await call('POST', '/trips', await userLogin('driver@test.dev'));
    const admin = await adminLogin();

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
