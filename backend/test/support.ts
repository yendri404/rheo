import { InMemoryTripRepository } from '../src/infrastructure/memory/in-memory-trip-repository.ts';
import { InMemoryUserRepository } from '../src/infrastructure/memory/in-memory-user-repository.ts';
import type { TripEvents, TripNotifier, TripState } from '../src/trips/ports.ts';
import type { RouteName } from '../src/trips/route.ts';
import { TripService } from '../src/trips/trip-service.ts';
import type { User } from '../src/users/user.ts';

export class RecordingEvents implements TripEvents {
  readonly published: TripState[] = [];
  publish(state: TripState): void {
    this.published.push(state);
  }
}

export class RecordingNotifier implements TripNotifier {
  readonly calls: { route: RouteName; tokens: string[] }[] = [];
  fail = false;
  async tripStarted(route: RouteName, tokens: string[]): Promise<void> {
    if (this.fail) throw new Error('push service down');
    this.calls.push({ route, tokens });
  }
}

export async function setup() {
  const users = new InMemoryUserRepository();
  const trips = new InMemoryTripRepository(users);
  const events = new RecordingEvents();
  const notifier = new RecordingNotifier();
  const errors: unknown[] = [];
  const service = new TripService({
    trips,
    users,
    events,
    notifier,
    now: () => new Date('2026-11-19T12:00:00Z'),
    onBackgroundError: (error) => errors.push(error),
  });
  const driver = await users.create({ email: 'driver@test.dev', passwordHash: 'x', name: 'Driver', address: '', role: 'driver' });
  const ana = await users.create({ email: 'ana@test.dev', passwordHash: 'x', name: 'Ana', address: 'Calle 1', role: 'passenger' });
  const beto = await users.create({ email: 'beto@test.dev', passwordHash: 'x', name: 'Beto', address: 'Calle 2', role: 'passenger' });
  return { users, trips, events, notifier, errors, service, driver, ana, beto };
}

export async function flush(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
}

export type Actors = { driver: User; ana: User; beto: User };
