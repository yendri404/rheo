import type { Route } from '../companies/company.ts';
import type { ActiveTrip } from './trip.ts';

/** The trip state of one company. */
export type TripState = {
  companyId: string;
  activeTrip: ActiveTrip | null;
  /** Route the next started trip will use; null while the company has no routes. */
  nextRoute: Route | null;
};

export type NewTrip = { companyId: string; route: Route; driverId: string; at: Date };

/**
 * Persistence port. Conditional writes are atomic in the adapter so concurrent requests cannot
 * break the invariants (one active trip per company, finish only when all stops are confirmed).
 */
export interface TripRepository {
  findActive(companyId: string): Promise<ActiveTrip | null>;
  /** Every running trip, across companies. */
  listActive(): Promise<ActiveTrip[]>;
  /** Route of the company's latest trip; null when it never ran one or that route was deleted. */
  lastRouteId(companyId: string): Promise<string | null>;
  /** Throws AppError TRIP_ALREADY_ACTIVE when the company already has a running trip. */
  start(trip: NewTrip): Promise<void>;
  /** Idempotent: joining twice keeps the original join. */
  addPassenger(tripId: string, userId: string, at: Date): Promise<'added' | 'trip_not_active'>;
  /** A passenger whose stop was already confirmed (picked up) cannot be removed. */
  removePassenger(tripId: string, userId: string): Promise<'removed' | 'not_in_trip' | 'already_confirmed' | 'trip_not_active'>;
  /** Idempotent: confirming twice keeps the original confirmation time. */
  confirmStop(tripId: string, userId: string, at: Date): Promise<'confirmed' | 'not_in_trip'>;
  finish(tripId: string, at: Date): Promise<'finished' | 'pending_stops' | 'trip_not_active'>;
}

/** Realtime fan-out of a company's current state to its connected members. */
export interface TripEvents {
  publish(state: TripState): void;
}

/** Push notifications for users who are not looking at the app. */
export interface TripNotifier {
  tripStarted(routeName: string, pushTokens: string[]): Promise<void>;
}
