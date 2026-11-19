import type { RouteName } from './route.ts';
import type { ActiveTrip } from './trip.ts';

export type TripState = {
  activeTrip: ActiveTrip | null;
  /** Route the next started trip will use. */
  nextRoute: RouteName;
};

/**
 * Persistence port. Conditional writes are atomic in the adapter so concurrent
 * requests cannot break the invariants (one active trip, finish only when all stops are confirmed).
 */
export interface TripRepository {
  findActive(): Promise<ActiveTrip | null>;
  lastRoute(): Promise<RouteName | null>;
  /** Throws AppError TRIP_ALREADY_ACTIVE when a trip is already running. */
  start(route: RouteName, at: Date): Promise<void>;
  /** Idempotent: joining twice keeps the original join. */
  addPassenger(tripId: string, userId: string, at: Date): Promise<'added' | 'trip_not_active'>;
  /** A passenger whose stop was already confirmed (picked up) cannot be removed. */
  removePassenger(tripId: string, userId: string): Promise<'removed' | 'not_in_trip' | 'already_confirmed' | 'trip_not_active'>;
  /** Idempotent: confirming twice keeps the original confirmation time. */
  confirmStop(tripId: string, userId: string, at: Date): Promise<'confirmed' | 'not_in_trip'>;
  finish(tripId: string, at: Date): Promise<'finished' | 'pending_stops' | 'trip_not_active'>;
}

/** Realtime fan-out of the current state to connected clients. */
export interface TripEvents {
  publish(state: TripState): void;
}

/** Push notifications for users who are not looking at the app. */
export interface TripNotifier {
  tripStarted(route: RouteName, pushTokens: string[]): Promise<void>;
}
