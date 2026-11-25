import { InMemoryCompanyRepository } from '../src/infrastructure/memory/in-memory-company-repository.ts';
import { InMemoryTripRepository } from '../src/infrastructure/memory/in-memory-trip-repository.ts';
import { InMemoryUserRepository } from '../src/infrastructure/memory/in-memory-user-repository.ts';
import type { RouteInput } from '../src/companies/company.ts';
import { buildApp } from '../src/http/app.ts';
import { WsHub } from '../src/infrastructure/realtime/ws-hub.ts';
import { AuthService } from '../src/users/auth-service.ts';
import { hashPassword } from '../src/users/password.ts';
import type { TripEvents, TripNotifier, TripState } from '../src/trips/ports.ts';
import { TripService } from '../src/trips/trip-service.ts';
import type { NewUser, Role, User } from '../src/users/user.ts';

export class RecordingEvents implements TripEvents {
  readonly published: TripState[] = [];
  publish(state: TripState): void {
    this.published.push(state);
  }
}

export class RecordingNotifier implements TripNotifier {
  readonly calls: { route: string; tokens: string[] }[] = [];
  fail = false;
  async tripStarted(routeName: string, tokens: string[]): Promise<void> {
    if (this.fail) throw new Error('push service down');
    this.calls.push({ route: routeName, tokens });
  }
}

export const EUREKA_ROUTES: RouteInput[] = [
  { name: 'Mañana', kind: 'pickup' },
  { name: 'Norte', kind: 'dropoff' },
  { name: 'Sur', kind: 'dropoff' },
];

/**
 * Two companies: Eureka (three rotating routes) and Acme (a single route). The driver works for
 * both, Ana and Beto ride with Eureka, Carla rides with Acme.
 */
export async function world(passwordHash = 'x') {
  const companies = new InMemoryCompanyRepository();
  const users = new InMemoryUserRepository(companies);
  const trips = new InMemoryTripRepository(users);
  const eureka = await companies.create('Eureka', EUREKA_ROUTES);
  const acme = await companies.create('Acme', [{ name: 'Centro', kind: 'pickup' }]);

  const person = (name: string, role: Role, address: string, companyIds: string[]): NewUser => ({
    email: `${name.toLowerCase()}@test.dev`,
    passwordHash,
    name,
    address,
    role,
    companyIds,
  });
  const driver = await users.create(person('Driver', 'driver', '', [eureka.id, acme.id]));
  const ana = await users.create(person('Ana', 'passenger', 'Calle 1', [eureka.id]));
  const beto = await users.create(person('Beto', 'passenger', 'Calle 2', [eureka.id]));
  const carla = await users.create(person('Carla', 'passenger', 'Calle 3', [acme.id]));
  return { companies, users, trips, eureka, acme, driver, ana, beto, carla };
}

export async function setup() {
  const base = await world();
  const events = new RecordingEvents();
  const notifier = new RecordingNotifier();
  const errors: unknown[] = [];
  const service = new TripService({
    trips: base.trips,
    users: base.users,
    companies: base.companies,
    events,
    notifier,
    now: () => new Date('2026-11-19T12:00:00Z'),
    onBackgroundError: (error) => errors.push(error),
  });
  return { ...base, events, notifier, errors, service };
}

/** The same world behind the real HTTP app. Everyone logs in with the password "secret123". */
export async function appWorld(options: { adminPassword?: string } = {}) {
  const base = await world(await hashPassword('secret123'));
  const { users, companies, trips } = base;
  const hub = new WsHub();
  const tripService = new TripService({ trips, users, companies, events: hub, notifier: new RecordingNotifier() });
  const app = await buildApp({
    users,
    companies,
    hub,
    tripService,
    authService: new AuthService(users),
    jwtSecret: 'test-secret',
    adminPassword: options.adminPassword,
  });
  await app.ready();
  return { ...base, app, hub, tripService };
}

export async function flush(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
}

export type Actors = { driver: User; ana: User; beto: User };
