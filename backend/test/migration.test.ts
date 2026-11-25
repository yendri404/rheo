import postgres from 'postgres';
import { afterAll, describe, expect, it } from 'vitest';
import { nextRoute } from '../src/companies/company.ts';
import { migrate, type Sql } from '../src/infrastructure/postgres/database.ts';
import { PostgresCompanyRepository } from '../src/infrastructure/postgres/postgres-company-repository.ts';
import { PostgresTripRepository } from '../src/infrastructure/postgres/postgres-trip-repository.ts';
import { PostgresUserRepository } from '../src/infrastructure/postgres/postgres-user-repository.ts';

const databaseUrl = process.env.TEST_DATABASE_URL;

/** The schema as it was before companies existed: one global trip and three fixed routes. */
const LEGACY_SCHEMA = `
  CREATE TABLE users (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email         text NOT NULL UNIQUE,
    password_hash text NOT NULL,
    name          text NOT NULL,
    address       text NOT NULL DEFAULT '',
    role          text NOT NULL CHECK (role IN ('driver', 'passenger')),
    push_token    text UNIQUE,
    created_at    timestamptz NOT NULL DEFAULT now()
  );
  CREATE TABLE trips (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    seq         bigint GENERATED ALWAYS AS IDENTITY,
    route       text NOT NULL CHECK (route IN ('manana', 'norte', 'sur')),
    status      text NOT NULL CHECK (status IN ('active', 'finished')),
    started_at  timestamptz NOT NULL,
    finished_at timestamptz
  );
  CREATE UNIQUE INDEX trips_one_active ON trips ((true)) WHERE status = 'active';
  CREATE INDEX trips_seq ON trips (seq DESC);
  CREATE TABLE trip_passengers (
    trip_id      uuid NOT NULL REFERENCES trips (id) ON DELETE CASCADE,
    user_id      uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    joined_at    timestamptz NOT NULL,
    confirmed_at timestamptz,
    PRIMARY KEY (trip_id, user_id)
  );
`;

const connections: Sql[] = [];
afterAll(async () => {
  await Promise.all(connections.map((sql) => sql.end()));
});

/** A connection confined to its own empty schema, so these tests never touch the tables other test files use. */
async function isolated(schema: string): Promise<Sql> {
  const sql = postgres(databaseUrl!, { max: 1, onnotice: () => {}, connection: { search_path: schema } });
  connections.push(sql);
  await sql.unsafe(`DROP SCHEMA IF EXISTS ${schema} CASCADE; CREATE SCHEMA ${schema}`);
  return sql;
}

describe.skipIf(!databaseUrl)('schema migration (set TEST_DATABASE_URL to run)', () => {
  it('moves a database from before companies into the company Eureka, keeping users, trips and rotation', async () => {
    const sql = await isolated('migration_legacy_test');
    await sql.unsafe(LEGACY_SCHEMA);
    const [driver] = await sql<{ id: string }[]>`
      INSERT INTO users (email, password_hash, name, role) VALUES ('driver@test.dev', 'h', 'Driver', 'driver') RETURNING id`;
    const [ana] = await sql<{ id: string }[]>`
      INSERT INTO users (email, password_hash, name, address, role, push_token)
      VALUES ('ana@test.dev', 'h', 'Ana', 'Calle 1', 'passenger', 'ana-token') RETURNING id`;
    await sql`
      INSERT INTO trips (route, status, started_at, finished_at) VALUES
        ('manana', 'finished', '2026-11-01T10:00:00Z', '2026-11-01T11:00:00Z'),
        ('norte', 'finished', '2026-11-01T20:00:00Z', '2026-11-01T21:00:00Z')`;
    const [running] = await sql<{ id: string }[]>`
      INSERT INTO trips (route, status, started_at) VALUES ('sur', 'active', '2026-11-02T20:00:00Z') RETURNING id`;
    await sql`
      INSERT INTO trip_passengers (trip_id, user_id, joined_at) VALUES (${running!.id}, ${ana!.id}, '2026-11-02T20:05:00Z')`;

    await migrate(sql);
    await migrate(sql); // Applied on every boot: the second run must change nothing.

    const companies = new PostgresCompanyRepository(sql);
    const users = new PostgresUserRepository(sql);
    const trips = new PostgresTripRepository(sql);
    const all = await companies.list();
    expect(all).toHaveLength(1);
    const eureka = all[0]!;
    expect(eureka.name).toBe('Eureka');
    expect(eureka.routes.map((route) => [route.name, route.kind])).toEqual([
      ['Mañana', 'pickup'],
      ['Norte', 'dropoff'],
      ['Sur', 'dropoff'],
    ]);

    const membership = [{ id: eureka.id, name: 'Eureka' }];
    expect((await users.findById(driver!.id))!.companies).toEqual(membership);
    expect(await users.findByEmail('ana@test.dev')).toMatchObject({ name: 'Ana', address: 'Calle 1', passwordHash: 'h', companies: membership });
    expect(await users.pushTokensFor('passenger', eureka.id)).toEqual(['ana-token']);

    // The trip that was running keeps running, on its route, with its passenger.
    expect(await trips.findActive(eureka.id)).toEqual({
      id: running!.id,
      companyId: eureka.id,
      driverId: null,
      route: { name: 'Sur', kind: 'dropoff' },
      startedAt: new Date('2026-11-02T20:00:00Z'),
      passengers: [
        { userId: ana!.id, name: 'Ana', address: 'Calle 1', joinedAt: new Date('2026-11-02T20:05:00Z'), confirmedAt: null },
      ],
    });
    // Rotation continues where it was: after Sur comes Mañana.
    expect(nextRoute(eureka.routes, await trips.lastRouteId(eureka.id))?.name).toBe('Mañana');
    const history = await sql<{ route_name: string; company_id: string }[]>`SELECT route_name, company_id FROM trips ORDER BY seq`;
    expect(history.map((trip) => trip.route_name)).toEqual(['Mañana', 'Norte', 'Sur']);
    expect(history.every((trip) => trip.company_id === eureka.id)).toBe(true);

    // The old single-trip rule is gone: another company can run while Eureka does, Eureka still cannot run two.
    const acme = await companies.create('Acme', [{ name: 'Centro', kind: 'pickup' }]);
    await trips.start({ companyId: acme.id, route: acme.routes[0]!, driverId: driver!.id, at: new Date() });
    await expect(
      trips.start({ companyId: eureka.id, route: eureka.routes[0]!, driverId: driver!.id, at: new Date() }),
    ).rejects.toMatchObject({ code: 'TRIP_ALREADY_ACTIVE' });
    expect(await trips.finish(running!.id, new Date())).toBe('pending_stops');
  });

  it('creates no company on a brand-new database, and stays empty after a second run', async () => {
    const sql = await isolated('migration_fresh_test');

    await migrate(sql);
    await migrate(sql);

    expect(await new PostgresCompanyRepository(sql).list()).toEqual([]);
    expect(await new PostgresTripRepository(sql).listActive()).toEqual([]);
  });
});
