import { AppError } from '../shared/app-error.ts';
import type { Role, User, UserRepository } from '../users/user.ts';
import type { TripEvents, TripNotifier, TripRepository, TripState } from './ports.ts';
import { nextRoute, type RouteName } from './route.ts';
import type { ActiveTrip } from './trip.ts';

type Dependencies = {
  trips: TripRepository;
  users: UserRepository;
  events: TripEvents;
  notifier: TripNotifier;
  now?: () => Date;
  onBackgroundError?: (error: unknown) => void;
};

export class TripService {
  readonly #trips: TripRepository;
  readonly #users: UserRepository;
  readonly #events: TripEvents;
  readonly #notifier: TripNotifier;
  readonly #now: () => Date;
  readonly #onBackgroundError: (error: unknown) => void;

  constructor(deps: Dependencies) {
    this.#trips = deps.trips;
    this.#users = deps.users;
    this.#events = deps.events;
    this.#notifier = deps.notifier;
    this.#now = deps.now ?? (() => new Date());
    this.#onBackgroundError = deps.onBackgroundError ?? (() => {});
  }

  async state(): Promise<TripState> {
    const [activeTrip, lastRoute] = await Promise.all([this.#trips.findActive(), this.#trips.lastRoute()]);
    return { activeTrip, nextRoute: nextRoute(lastRoute) };
  }

  async start(actor: User): Promise<TripState> {
    requireRole(actor, 'driver');
    const route = nextRoute(await this.#trips.lastRoute());
    await this.#trips.start(route, this.#now());
    // Notifications must never block or fail the start itself.
    this.#notifyPassengers(route).catch(this.#onBackgroundError);
    return this.#publish();
  }

  async join(actor: User): Promise<TripState> {
    requireRole(actor, 'passenger');
    const trip = await this.#requireActive();
    const result = await this.#trips.addPassenger(trip.id, actor.id, this.#now());
    if (result === 'trip_not_active') throw noActiveTrip();
    return this.#publish();
  }

  async confirmStop(actor: User, passengerId: string): Promise<TripState> {
    requireRole(actor, 'driver');
    const trip = await this.#requireActive();
    const result = await this.#trips.confirmStop(trip.id, passengerId, this.#now());
    if (result === 'not_in_trip') {
      throw new AppError('PASSENGER_NOT_IN_TRIP', 'The passenger is not part of the active trip.');
    }
    return this.#publish();
  }

  async finish(actor: User): Promise<TripState> {
    requireRole(actor, 'driver');
    const trip = await this.#requireActive();
    const result = await this.#trips.finish(trip.id, this.#now());
    if (result === 'trip_not_active') throw noActiveTrip();
    if (result === 'pending_stops') {
      throw new AppError('PENDING_STOPS', 'Every passenger stop must be confirmed before finishing the trip.');
    }
    return this.#publish();
  }

  async #requireActive(): Promise<ActiveTrip> {
    const trip = await this.#trips.findActive();
    if (!trip) throw noActiveTrip();
    return trip;
  }

  async #publish(): Promise<TripState> {
    const state = await this.state();
    this.#events.publish(state);
    return state;
  }

  async #notifyPassengers(route: RouteName): Promise<void> {
    const tokens = await this.#users.pushTokensFor('passenger');
    if (tokens.length > 0) await this.#notifier.tripStarted(route, tokens);
  }
}

function requireRole(actor: User, role: Role): void {
  if (actor.role !== role) throw new AppError('FORBIDDEN', `Only a ${role} can do this.`);
}

function noActiveTrip(): AppError {
  return new AppError('NO_ACTIVE_TRIP', 'There is no active trip.');
}
