import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { CompanyRepository, CompanyWithRoutes, Route } from '../src/companies/company.ts';
import { InMemoryCompanyRepository } from '../src/infrastructure/memory/in-memory-company-repository.ts';
import { InMemoryTripRepository } from '../src/infrastructure/memory/in-memory-trip-repository.ts';
import { InMemoryUserRepository } from '../src/infrastructure/memory/in-memory-user-repository.ts';
import { connect, migrate, type Sql } from '../src/infrastructure/postgres/database.ts';
import { PostgresCompanyRepository } from '../src/infrastructure/postgres/postgres-company-repository.ts';
import { PostgresTripRepository } from '../src/infrastructure/postgres/postgres-trip-repository.ts';
import { PostgresUserRepository } from '../src/infrastructure/postgres/postgres-user-repository.ts';
import type { TripRepository } from '../src/trips/ports.ts';
import type { UserRepository } from '../src/users/user.ts';

type Adapters = { users: UserRepository; trips: TripRepository; companies: CompanyRepository };

const databaseUrl = process.env.TEST_DATABASE_URL;
let sql: Sql | undefined;

const factories: [string, () => Promise<Adapters>][] = [
  [
    'in-memory',
    async () => {
      const companies = new InMemoryCompanyRepository();
      const users = new InMemoryUserRepository(companies);
      return { users, trips: new InMemoryTripRepository(users), companies };
    },
  ],
];

if (databaseUrl) {
  factories.push([
    'postgres',
    async () => {
      sql ??= connect(databaseUrl);
      await migrate(sql);
      await sql`TRUNCATE trip_passengers, trips, user_companies, routes, companies, users`;
      return {
        users: new PostgresUserRepository(sql),
        trips: new PostgresTripRepository(sql),
        companies: new PostgresCompanyRepository(sql),
      };
    },
  ]);
} else {
  it.skip('postgres contract (set TEST_DATABASE_URL to run)', () => {});
}

afterAll(async () => {
  await sql?.end();
});

const T0 = new Date('2026-11-19T12:00:00Z');
const T1 = new Date('2026-11-19T12:05:00Z');

describe.each(factories)('repository contract: %s', (_name, factory) => {
  let users: UserRepository;
  let trips: TripRepository;
  let companies: CompanyRepository;
  let eureka: CompanyWithRoutes;
  let acme: CompanyWithRoutes;
  let manana: Route;
  let norte: Route;
  let sur: Route;
  let driverId: string;

  beforeEach(async () => {
    ({ users, trips, companies } = await factory());
    eureka = await companies.create('Eureka', [
      { name: 'Mañana', kind: 'pickup' },
      { name: 'Norte', kind: 'dropoff' },
      { name: 'Sur', kind: 'dropoff' },
    ]);
    acme = await companies.create('Acme', [{ name: 'Centro', kind: 'pickup' }]);
    [manana, norte, sur] = eureka.routes as [Route, Route, Route];
    const driver = await users.create({
      email: 'driver@test.dev',
      passwordHash: 'x',
      name: 'Driver',
      address: '',
      role: 'driver',
      companyIds: [eureka.id, acme.id],
    });
    driverId = driver.id;
  });

  async function passenger(name: string) {
    return users.create({
      email: `${name}@test.dev`,
      passwordHash: 'x',
      name,
      address: `${name} street`,
      role: 'passenger',
      companyIds: [eureka.id],
    });
  }

  /** Starts a trip in Eureka (or the given company) on that route. */
  function start(route: Route, at: Date, companyId: string = eureka.id): Promise<void> {
    return trips.start({ companyId, route, driverId, at });
  }

  async function activeTripId(): Promise<string> {
    return (await trips.findActive(eureka.id))!.id;
  }

  const inEureka = () => [{ id: eureka.id, name: 'Eureka' }];

  it('finds users by normalized email and id', async () => {
    const ana = await users.create({ email: ' Ana@Test.dev ', passwordHash: 'hash', name: 'Ana', address: 'A', role: 'passenger', companyIds: [eureka.id] });
    expect(ana.companies).toEqual(inEureka());
    expect(await users.findByEmail('ANA@test.dev')).toEqual({ ...ana, passwordHash: 'hash' });
    expect(await users.findById(ana.id)).toEqual(ana);
    expect(ana.email).toBe('ana@test.dev');
  });

  it('rejects a duplicate email with EMAIL_TAKEN', async () => {
    await users.create({ email: 'ana@test.dev', passwordHash: 'x', name: 'Ana', address: 'A', role: 'passenger', companyIds: [eureka.id] });
    await expect(
      users.create({ email: ' ANA@test.dev', passwordHash: 'x', name: 'Ana 2', address: 'B', role: 'passenger', companyIds: [eureka.id] }),
    ).rejects.toMatchObject({ code: 'EMAIL_TAKEN' });
  });

  it('changes a user role by email', async () => {
    const ana = await users.create({ email: 'ana@test.dev', passwordHash: 'x', name: 'Ana', address: 'A', role: 'passenger', companyIds: [eureka.id] });
    expect(await users.setRole('ANA@test.dev', 'driver')).toBe(true);
    expect((await users.findById(ana.id))!.role).toBe('driver');
    expect(await users.setRole('ghost@test.dev', 'driver')).toBe(false);
  });

  it('lists users sorted by role then name, without password hashes', async () => {
    await users.create({ email: 'zoe@test.dev', passwordHash: 'x', name: 'Zoe', address: 'Z', role: 'passenger', companyIds: [eureka.id] });
    await users.create({ email: 'ana@test.dev', passwordHash: 'x', name: 'Ana', address: 'A', role: 'passenger', companyIds: [eureka.id] });
    await users.create({ email: 'carlos@test.dev', passwordHash: 'x', name: 'Carlos', address: '', role: 'driver', companyIds: [eureka.id] });

    const listed = await users.list();

    expect(listed.map((user) => user.name)).toEqual(['Carlos', 'Driver', 'Ana', 'Zoe']);
    expect(listed[0]).toEqual({
      id: expect.any(String),
      email: 'carlos@test.dev',
      name: 'Carlos',
      address: '',
      role: 'driver',
      companies: inEureka(),
      createdAt: expect.any(Date),
    });
    expect(listed[0]).not.toHaveProperty('passwordHash');
  });

  it('updates only the given fields, normalizing the email', async () => {
    const ana = await users.create({ email: 'ana@test.dev', passwordHash: 'old', name: 'Ana', address: 'A', role: 'passenger', companyIds: [eureka.id] });

    const updated = await users.update(ana.id, { name: 'Ana María', email: ' ANA.M@Test.dev ', passwordHash: 'new' });

    expect(updated).toEqual({ ...ana, name: 'Ana María', email: 'ana.m@test.dev' });
    expect((await users.findByEmail('ana.m@test.dev'))!.passwordHash).toBe('new');
    expect(await users.findByEmail('ana@test.dev')).toBeNull();
  });

  it('rejects updating to an email another user has, and returns null for unknown ids', async () => {
    const ana = await users.create({ email: 'ana@test.dev', passwordHash: 'x', name: 'Ana', address: 'A', role: 'passenger', companyIds: [eureka.id] });
    await users.create({ email: 'beto@test.dev', passwordHash: 'x', name: 'Beto', address: 'B', role: 'passenger', companyIds: [eureka.id] });

    await expect(users.update(ana.id, { email: 'BETO@test.dev' })).rejects.toMatchObject({ code: 'EMAIL_TAKEN' });
    expect(await users.update('00000000-0000-0000-0000-000000000000', { name: 'X' })).toBeNull();
  });

  it('deletes a user and reports whether it existed', async () => {
    const ana = await users.create({ email: 'ana@test.dev', passwordHash: 'x', name: 'Ana', address: 'A', role: 'passenger', companyIds: [eureka.id] });
    expect(await users.delete(ana.id)).toBe(true);
    expect(await users.findById(ana.id)).toBeNull();
    expect(await users.delete(ana.id)).toBe(false);
  });

  it('moves a push token to the latest user that registers it', async () => {
    const ana = await passenger('ana');
    const beto = await passenger('beto');
    await users.setPushToken(ana.id, 'tok');
    await users.setPushToken(beto.id, 'tok');
    expect(await users.pushTokensFor('passenger', eureka.id)).toEqual(['tok']);
    await users.setPushToken(beto.id, null);
    expect(await users.pushTokensFor('passenger', eureka.id)).toEqual([]);
  });

  it('only returns the push tokens of the members of the company with that role', async () => {
    const ana = await passenger('ana');
    const carla = await users.create({
      email: 'carla@test.dev',
      passwordHash: 'x',
      name: 'Carla',
      address: 'C',
      role: 'passenger',
      companyIds: [acme.id],
    });
    await users.setPushToken(ana.id, 'ana-token');
    await users.setPushToken(carla.id, 'carla-token');
    await users.setPushToken(driverId, 'driver-token');

    expect(await users.pushTokensFor('passenger', eureka.id)).toEqual(['ana-token']);
    expect(await users.pushTokensFor('passenger', acme.id)).toEqual(['carla-token']);
    expect(await users.pushTokensFor('driver', acme.id)).toEqual(['driver-token']);
  });

  it('stores the companies of a user sorted by name and replaces them on update', async () => {
    const ana = await passenger('ana');
    expect(ana.companies).toEqual(inEureka());
    expect((await users.findById(driverId))!.companies).toEqual([{ id: acme.id, name: 'Acme' }, ...inEureka()]);

    const moved = await users.update(ana.id, { companyIds: [acme.id] });
    expect(moved!.companies).toEqual([{ id: acme.id, name: 'Acme' }]);
    expect((await users.findByEmail('ana@test.dev'))!.companies).toEqual([{ id: acme.id, name: 'Acme' }]);

    const renamed = await users.update(ana.id, { name: 'Ana 2' });
    expect(renamed).toMatchObject({ name: 'Ana 2', companies: [{ id: acme.id, name: 'Acme' }] });
    expect((await users.update(ana.id, { companyIds: [] }))!.companies).toEqual([]);
  });

  it('lists companies by name with their routes in order', async () => {
    expect(await companies.list()).toEqual([acme, eureka]);
    expect(eureka.routes.map((route) => [route.name, route.kind])).toEqual([
      ['Mañana', 'pickup'],
      ['Norte', 'dropoff'],
      ['Sur', 'dropoff'],
    ]);
    expect(await companies.findById(eureka.id)).toEqual(eureka);
    expect(await companies.findById('00000000-0000-0000-0000-000000000000')).toBeNull();
  });

  it('rejects a duplicate company name regardless of case, on create and on rename', async () => {
    await expect(companies.create('EUREKA', [])).rejects.toMatchObject({ code: 'COMPANY_NAME_TAKEN' });
    await expect(companies.update(acme.id, { name: 'eureka' })).rejects.toMatchObject({ code: 'COMPANY_NAME_TAKEN' });
    expect((await companies.update(acme.id, { name: 'ACME' }))!.name).toBe('ACME');
  });

  it('replaces the routes of a company keeping the ids of the ones that stay', async () => {
    const updated = await companies.update(eureka.id, {
      routes: [
        { id: sur.id, name: 'Sur', kind: 'dropoff' },
        { name: 'Tarde', kind: 'dropoff' },
        { id: manana.id, name: 'Madrugada', kind: 'pickup' },
        { id: acme.routes[0]!.id, name: 'Ajena', kind: 'pickup' },
      ],
    });

    expect(updated!.routes.map((route) => route.name)).toEqual(['Sur', 'Tarde', 'Madrugada', 'Ajena']);
    expect(updated!.routes[0]!.id).toBe(sur.id);
    expect(updated!.routes[2]).toEqual({ id: manana.id, name: 'Madrugada', kind: 'pickup' });
    // The id of another company's route is not adopted, and that route is untouched.
    expect(updated!.routes[3]!.id).not.toBe(acme.routes[0]!.id);
    expect((await companies.findById(acme.id))!.routes).toEqual(acme.routes);
    expect(updated!.routes.map((route) => route.id)).not.toContain(norte.id);
    expect(await companies.update('00000000-0000-0000-0000-000000000000', { name: 'X' })).toBeNull();
  });

  it('deletes a company together with its memberships', async () => {
    const ana = await passenger('ana');
    expect(await companies.delete(eureka.id)).toBe(true);
    expect(await companies.delete(eureka.id)).toBe(false);
    expect((await users.findById(ana.id))!.companies).toEqual([]);
    expect((await users.findById(driverId))!.companies).toEqual([{ id: acme.id, name: 'Acme' }]);
  });

  it('has no active trip and no last route initially', async () => {
    expect(await trips.findActive(eureka.id)).toBeNull();
    expect(await trips.listActive()).toEqual([]);
    expect(await trips.lastRouteId(eureka.id)).toBeNull();
  });

  it('runs one trip per company at the same time and lists them all', async () => {
    await start(manana, T0);
    await start(acme.routes[0]!, T1, acme.id);

    expect((await trips.findActive(eureka.id))!.route).toEqual({ name: 'Mañana', kind: 'pickup' });
    expect((await trips.findActive(acme.id))!.route).toEqual({ name: 'Centro', kind: 'pickup' });
    expect((await trips.listActive()).map((trip) => trip.companyId).sort()).toEqual([acme.id, eureka.id].sort());
    expect(await trips.lastRouteId(acme.id)).toBe(acme.routes[0]!.id);

    await trips.finish(await activeTripId(), T1);
    expect((await trips.listActive()).map((trip) => trip.companyId)).toEqual([acme.id]);
  });

  it('keeps the route name and kind of a running trip after the route is deleted', async () => {
    await start(manana, T0);
    await companies.update(eureka.id, { routes: [{ id: norte.id, name: 'Norte', kind: 'dropoff' }] });

    expect((await trips.findActive(eureka.id))!.route).toEqual({ name: 'Mañana', kind: 'pickup' });
  });

  it('allows only one active trip per company at a time, even with concurrent starts', async () => {
    const results = await Promise.allSettled([start(manana, T0), start(manana, T0)]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.find((result) => result.status === 'rejected')).toMatchObject({ reason: { code: 'TRIP_ALREADY_ACTIVE' } });
  });

  it('remembers the route of the latest trip', async () => {
    await start(manana, T0);
    await trips.finish(await activeTripId(), T0);
    await start(norte, T0);
    expect(await trips.lastRouteId(eureka.id)).toBe(norte.id);
  });

  it('adds passengers idempotently with their name and address', async () => {
    const ana = await passenger('ana');
    await start(sur, T0);
    const id = await activeTripId();

    expect(await trips.addPassenger(id, ana.id, T0)).toBe('added');
    expect(await trips.addPassenger(id, ana.id, T1)).toBe('added');

    expect(await trips.findActive(eureka.id)).toEqual({
      id,
      companyId: eureka.id,
      driverId,
      route: { name: 'Sur', kind: 'dropoff' },
      startedAt: T0,
      passengers: [{ userId: ana.id, name: 'ana', address: 'ana street', joinedAt: T0, confirmedAt: null }],
    });
  });

  it('confirms stops idempotently and rejects unknown passengers', async () => {
    const ana = await passenger('ana');
    const beto = await passenger('beto');
    await start(sur, T0);
    const id = await activeTripId();
    await trips.addPassenger(id, ana.id, T0);

    expect(await trips.confirmStop(id, ana.id, T0)).toBe('confirmed');
    expect(await trips.confirmStop(id, ana.id, T1)).toBe('confirmed');
    expect(await trips.confirmStop(id, beto.id, T0)).toBe('not_in_trip');
    expect((await trips.findActive(eureka.id))!.passengers[0]!.confirmedAt).toEqual(T0);
  });

  it('removes only unconfirmed passengers', async () => {
    const ana = await passenger('ana');
    const beto = await passenger('beto');
    await start(sur, T0);
    const id = await activeTripId();
    await trips.addPassenger(id, ana.id, T0);
    await trips.addPassenger(id, beto.id, T0);
    await trips.confirmStop(id, beto.id, T0);

    expect(await trips.removePassenger(id, ana.id)).toBe('removed');
    expect(await trips.removePassenger(id, ana.id)).toBe('not_in_trip');
    expect(await trips.removePassenger(id, beto.id)).toBe('already_confirmed');
    expect((await trips.findActive(eureka.id))!.passengers.map((p) => p.userId)).toEqual([beto.id]);

    await trips.finish(id, T1);
    expect(await trips.removePassenger(id, beto.id)).toBe('trip_not_active');
  });

  it('finishes only when every stop is confirmed and rejects writes afterwards', async () => {
    const ana = await passenger('ana');
    await start(sur, T0);
    const id = await activeTripId();
    await trips.addPassenger(id, ana.id, T0);

    expect(await trips.finish(id, T1)).toBe('pending_stops');
    await trips.confirmStop(id, ana.id, T0);
    expect(await trips.finish(id, T1)).toBe('finished');

    expect(await trips.findActive(eureka.id)).toBeNull();
    expect(await trips.finish(id, T1)).toBe('trip_not_active');
    expect(await trips.addPassenger(id, ana.id, T1)).toBe('trip_not_active');
    expect(await trips.confirmStop(id, ana.id, T1)).toBe('not_in_trip');
  });

  it('never finishes a trip with an unconfirmed passenger under concurrent join and finish', async () => {
    const ana = await passenger('ana');
    for (let attempt = 0; attempt < 10; attempt++) {
      await start(sur, T0);
      const id = await activeTripId();
      const [joined, finished] = await Promise.all([trips.addPassenger(id, ana.id, T0), trips.finish(id, T0)]);
      if (joined === 'added') {
        // The passenger made it in, so the finish must not have closed the trip over them.
        expect(finished).toBe('pending_stops');
        await trips.confirmStop(id, ana.id, T0);
        expect(await trips.finish(id, T0)).toBe('finished');
      } else {
        expect(finished).toBe('finished');
      }
    }
  });
});
