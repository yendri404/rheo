import type { RouteName } from './route.ts';

export type TripPassenger = {
  userId: string;
  name: string;
  address: string;
  joinedAt: Date;
  confirmedAt: Date | null;
};

/** A trip that is currently running. Finished trips only matter for route rotation. */
export type ActiveTrip = {
  id: string;
  route: RouteName;
  startedAt: Date;
  passengers: TripPassenger[];
};

export function allStopsConfirmed(trip: ActiveTrip): boolean {
  return trip.passengers.every((passenger) => passenger.confirmedAt !== null);
}
