import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { InMemoryTripRepository } from '../src/infrastructure/memory/in-memory-trip-repository.ts';
import { InMemoryUserRepository } from '../src/infrastructure/memory/in-memory-user-repository.ts';
import { connect, migrate, type Sql } from '../src/infrastructure/postgres/database.ts';
import { PostgresTripRepository } from '../src/infrastructure/postgres/postgres-trip-repository.ts';
import { PostgresUserRepository } from '../src/infrastructure/postgres/postgres-user-repository.ts';
import type { TripRepository } from '../src/trips/ports.ts';
import type { UserRepository } from '../src/users/user.ts';

type Adapters = { users: UserRepository; trips: TripRepository };

const databaseUrl = process.env.TEST_DATABASE_URL;
let sql: Sql | undefined;

const factories: [string, () => Promise<Adapters>][] = [
  [
    'in-memory',
    async () => {
      const users = new InMemoryUserRepository();
      return { users, trips: new InMemoryTripRepository(users) };
    },
  ],
];

if (databaseUrl) {
  factories.push([
    'postgres',
    async () => {
      sql ??= connect(databaseUrl);
      await migrate(sql);
      await sql`TRUNCATE trip_passengers, trips, users`;
      return { users: new PostgresUserRepository(sql), trips: new PostgresTripRepository(sql) };
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

  beforeEach(async () => {
    ({ users, trips } = await factory());
  });

  async function passenger(name: string) {
    return users.create({ email: `${name}@test.dev`, passwordHash: 'x', name, address: `${name} street`, role: 'passenger' });
  }

  async function activeTripId(): Promise<string> {
    return (await trips.findActive())!.id;
  }

  it('finds users by normalized email and id', async () => {
    const ana = await users.create({ email: ' Ana@Test.dev ', passwordHash: 'hash', name: 'Ana', address: 'A', role: 'passenger' });
    expect(await users.findByEmail('ANA@test.dev')).toEqual({ ...ana, passwordHash: 'hash' });
    expect(await users.findById(ana.id)).toEqual(ana);
    expect(ana.email).toBe('ana@test.dev');
  });

  it('rejects a duplicate email with EMAIL_TAKEN', async () => {
    await users.create({ email: 'ana@test.dev', passwordHash: 'x', name: 'Ana', address: 'A', role: 'passenger' });
    await expect(
      users.create({ email: ' ANA@test.dev', passwordHash: 'x', name: 'Ana 2', address: 'B', role: 'passenger' }),
    ).rejects.toMatchObject({ code: 'EMAIL_TAKEN' });
  });

  it('changes a user role by email', async () => {
    const ana = await users.create({ email: 'ana@test.dev', passwordHash: 'x', name: 'Ana', address: 'A', role: 'passenger' });
    expect(await users.setRole('ANA@test.dev', 'driver')).toBe(true);
    expect((await users.findById(ana.id))!.role).toBe('driver');
    expect(await users.setRole('ghost@test.dev', 'driver')).toBe(false);
  });

  it('lists users sorted by role then name, without password hashes', async () => {
    await users.create({ email: 'zoe@test.dev', passwordHash: 'x', name: 'Zoe', address: 'Z', role: 'passenger' });
    await users.create({ email: 'ana@test.dev', passwordHash: 'x', name: 'Ana', address: 'A', role: 'passenger' });
    await users.create({ email: 'carlos@test.dev', passwordHash: 'x', name: 'Carlos', address: '', role: 'driver' });

    const listed = await users.list();

    expect(listed.map((user) => user.name)).toEqual(['Carlos', 'Ana', 'Zoe']);
    expect(listed[0]).toEqual({
      id: expect.any(String),
      email: 'carlos@test.dev',
      name: 'Carlos',
      address: '',
      role: 'driver',
      createdAt: expect.any(Date),
    });
    expect(listed[0]).not.toHaveProperty('passwordHash');
  });

  it('updates only the given fields, normalizing the email', async () => {
    const ana = await users.create({ email: 'ana@test.dev', passwordHash: 'old', name: 'Ana', address: 'A', role: 'passenger' });

    const updated = await users.update(ana.id, { name: 'Ana María', email: ' ANA.M@Test.dev ', passwordHash: 'new' });

    expect(updated).toEqual({ ...ana, name: 'Ana María', email: 'ana.m@test.dev' });
    expect((await users.findByEmail('ana.m@test.dev'))!.passwordHash).toBe('new');
    expect(await users.findByEmail('ana@test.dev')).toBeNull();
  });

  it('rejects updating to an email another user has, and returns null for unknown ids', async () => {
    const ana = await users.create({ email: 'ana@test.dev', passwordHash: 'x', name: 'Ana', address: 'A', role: 'passenger' });
    await users.create({ email: 'beto@test.dev', passwordHash: 'x', name: 'Beto', address: 'B', role: 'passenger' });

    await expect(users.update(ana.id, { email: 'BETO@test.dev' })).rejects.toMatchObject({ code: 'EMAIL_TAKEN' });
    expect(await users.update('00000000-0000-0000-0000-000000000000', { name: 'X' })).toBeNull();
  });

  it('deletes a user and reports whether it existed', async () => {
    const ana = await users.create({ email: 'ana@test.dev', passwordHash: 'x', name: 'Ana', address: 'A', role: 'passenger' });
    expect(await users.delete(ana.id)).toBe(true);
    expect(await users.findById(ana.id)).toBeNull();
    expect(await users.delete(ana.id)).toBe(false);
  });

  it('moves a push token to the latest user that registers it', async () => {
    const ana = await passenger('ana');
    const beto = await passenger('beto');
    await users.setPushToken(ana.id, 'tok');
    await users.setPushToken(beto.id, 'tok');
    expect(await users.pushTokensFor('passenger')).toEqual(['tok']);
    await users.setPushToken(beto.id, null);
    expect(await users.pushTokensFor('passenger')).toEqual([]);
  });

  it('has no active trip and no last route initially', async () => {
    expect(await trips.findActive()).toBeNull();
    expect(await trips.lastRoute()).toBeNull();
  });

  it('allows only one active trip at a time, even with concurrent starts', async () => {
    const results = await Promise.allSettled([trips.start('manana', T0), trips.start('manana', T0)]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.find((result) => result.status === 'rejected')).toMatchObject({ reason: { code: 'TRIP_ALREADY_ACTIVE' } });
  });

  it('remembers the route of the latest trip', async () => {
    await trips.start('manana', T0);
    await trips.finish(await activeTripId(), T0);
    await trips.start('norte', T0);
    expect(await trips.lastRoute()).toBe('norte');
  });

  it('adds passengers idempotently with their name and address', async () => {
    const ana = await passenger('ana');
    await trips.start('sur', T0);
    const id = await activeTripId();

    expect(await trips.addPassenger(id, ana.id, T0)).toBe('added');
    expect(await trips.addPassenger(id, ana.id, T1)).toBe('added');

    expect(await trips.findActive()).toEqual({
      id,
      route: 'sur',
      startedAt: T0,
      passengers: [{ userId: ana.id, name: 'ana', address: 'ana street', joinedAt: T0, confirmedAt: null }],
    });
  });

  it('confirms stops idempotently and rejects unknown passengers', async () => {
    const ana = await passenger('ana');
    const beto = await passenger('beto');
    await trips.start('sur', T0);
    const id = await activeTripId();
    await trips.addPassenger(id, ana.id, T0);

    expect(await trips.confirmStop(id, ana.id, T0)).toBe('confirmed');
    expect(await trips.confirmStop(id, ana.id, T1)).toBe('confirmed');
    expect(await trips.confirmStop(id, beto.id, T0)).toBe('not_in_trip');
    expect((await trips.findActive())!.passengers[0]!.confirmedAt).toEqual(T0);
  });

  it('removes only unconfirmed passengers', async () => {
    const ana = await passenger('ana');
    const beto = await passenger('beto');
    await trips.start('sur', T0);
    const id = await activeTripId();
    await trips.addPassenger(id, ana.id, T0);
    await trips.addPassenger(id, beto.id, T0);
    await trips.confirmStop(id, beto.id, T0);

    expect(await trips.removePassenger(id, ana.id)).toBe('removed');
    expect(await trips.removePassenger(id, ana.id)).toBe('not_in_trip');
    expect(await trips.removePassenger(id, beto.id)).toBe('already_confirmed');
    expect((await trips.findActive())!.passengers.map((p) => p.userId)).toEqual([beto.id]);

    await trips.finish(id, T1);
    expect(await trips.removePassenger(id, beto.id)).toBe('trip_not_active');
  });

  it('finishes only when every stop is confirmed and rejects writes afterwards', async () => {
    const ana = await passenger('ana');
    await trips.start('sur', T0);
    const id = await activeTripId();
    await trips.addPassenger(id, ana.id, T0);

    expect(await trips.finish(id, T1)).toBe('pending_stops');
    await trips.confirmStop(id, ana.id, T0);
    expect(await trips.finish(id, T1)).toBe('finished');

    expect(await trips.findActive()).toBeNull();
    expect(await trips.finish(id, T1)).toBe('trip_not_active');
    expect(await trips.addPassenger(id, ana.id, T1)).toBe('trip_not_active');
    expect(await trips.confirmStop(id, ana.id, T1)).toBe('not_in_trip');
  });

  it('never finishes a trip with an unconfirmed passenger under concurrent join and finish', async () => {
    const ana = await passenger('ana');
    for (let attempt = 0; attempt < 10; attempt++) {
      await trips.start('sur', T0);
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
