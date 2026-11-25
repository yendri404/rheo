import { nextRoute, type CompanyRepository } from '../companies/company.ts';
import { AppError } from '../shared/app-error.ts';
import { isMember, type Role, type User, type UserRepository } from '../users/user.ts';
import type { TripEvents, TripNotifier, TripRepository, TripState } from './ports.ts';
import type { ActiveTrip } from './trip.ts';

type Dependencies = {
  trips: TripRepository;
  users: UserRepository;
  companies: CompanyRepository;
  events: TripEvents;
  notifier: TripNotifier;
  now?: () => Date;
  onBackgroundError?: (error: unknown) => void;
};

/** Every company has its own trip and its own route rotation; users only reach the companies they belong to. */
export class TripService {
  readonly #trips: TripRepository;
  readonly #users: UserRepository;
  readonly #companies: CompanyRepository;
  readonly #events: TripEvents;
  readonly #notifier: TripNotifier;
  readonly #now: () => Date;
  readonly #onBackgroundError: (error: unknown) => void;

  constructor(deps: Dependencies) {
    this.#trips = deps.trips;
    this.#users = deps.users;
    this.#companies = deps.companies;
    this.#events = deps.events;
    this.#notifier = deps.notifier;
    this.#now = deps.now ?? (() => new Date());
    this.#onBackgroundError = deps.onBackgroundError ?? (() => {});
  }

  /** Does not check membership: callers resolve the company for the user first. */
  async state(companyId: string): Promise<TripState> {
    const [activeTrip, lastRouteId, company] = await Promise.all([
      this.#trips.findActive(companyId),
      this.#trips.lastRouteId(companyId),
      this.#companies.findById(companyId),
    ]);
    return { companyId, activeTrip, nextRoute: nextRoute(company?.routes ?? [], lastRouteId) };
  }

  /** Every running trip, across companies. */
  activeTrips(): Promise<ActiveTrip[]> {
    return this.#trips.listActive();
  }

  async start(actor: User, companyId: string): Promise<TripState> {
    requireAccess(actor, 'driver', companyId);
    const { nextRoute: route } = await this.state(companyId);
    if (!route) throw new AppError('NO_ROUTES', 'This company has no routes yet.');
    await this.#trips.start({ companyId, route, driverId: actor.id, at: this.#now() });
    // Notifications must never block or fail the start itself.
    this.#notifyPassengers(companyId, route.name).catch(this.#onBackgroundError);
    return this.#publish(companyId);
  }

  async join(actor: User, companyId: string): Promise<TripState> {
    requireAccess(actor, 'passenger', companyId);
    const trip = await this.#requireActive(companyId);
    const result = await this.#trips.addPassenger(trip.id, actor.id, this.#now());
    if (result === 'trip_not_active') throw noActiveTrip();
    return this.#publish(companyId);
  }

  /** Passenger cancels their seat. Idempotent; refused once the driver picked them up. */
  async leave(actor: User, companyId: string): Promise<TripState> {
    requireAccess(actor, 'passenger', companyId);
    const trip = await this.#requireActive(companyId);
    const result = await this.#trips.removePassenger(trip.id, actor.id);
    if (result === 'trip_not_active') throw noActiveTrip();
    if (result === 'already_confirmed') {
      throw new AppError('STOP_ALREADY_CONFIRMED', 'The driver already confirmed this stop.');
    }
    return result === 'removed' ? this.#publish(companyId) : this.state(companyId);
  }

  async confirmStop(actor: User, companyId: string, passengerId: string): Promise<TripState> {
    requireAccess(actor, 'driver', companyId);
    const trip = await this.#requireActive(companyId);
    const result = await this.#trips.confirmStop(trip.id, passengerId, this.#now());
    if (result === 'not_in_trip') {
      throw new AppError('PASSENGER_NOT_IN_TRIP', 'The passenger is not part of the active trip.');
    }
    return this.#publish(companyId);
  }

  async finish(actor: User, companyId: string): Promise<TripState> {
    requireAccess(actor, 'driver', companyId);
    const trip = await this.#requireActive(companyId);
    const result = await this.#trips.finish(trip.id, this.#now());
    if (result === 'trip_not_active') throw noActiveTrip();
    if (result === 'pending_stops') {
      throw new AppError('PENDING_STOPS', 'Every passenger stop must be confirmed before finishing the trip.');
    }
    return this.#publish(companyId);
  }

  async #requireActive(companyId: string): Promise<ActiveTrip> {
    const trip = await this.#trips.findActive(companyId);
    if (!trip) throw noActiveTrip();
    return trip;
  }

  async #publish(companyId: string): Promise<TripState> {
    const state = await this.state(companyId);
    this.#events.publish(state);
    return state;
  }

  async #notifyPassengers(companyId: string, routeName: string): Promise<void> {
    const tokens = await this.#users.pushTokensFor('passenger', companyId);
    if (tokens.length > 0) await this.#notifier.tripStarted(routeName, tokens);
  }
}

function requireAccess(actor: User, role: Role, companyId: string): void {
  if (actor.role !== role) throw new AppError('FORBIDDEN', `Only a ${role} can do this.`);
  if (!isMember(actor, companyId)) throw new AppError('FORBIDDEN', 'You are not registered in this company.');
}

function noActiveTrip(): AppError {
  return new AppError('NO_ACTIVE_TRIP', 'There is no active trip.');
}
