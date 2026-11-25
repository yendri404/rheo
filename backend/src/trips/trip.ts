import type { RouteKind } from '../companies/company.ts';

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
  companyId: string;
  /** Who started it; only this driver's position is shared. Null for trips started before drivers were tracked. */
  driverId: string | null;
  /** Snapshot taken at start, so editing or deleting the company route never changes a running trip. */
  route: { name: string; kind: RouteKind };
  startedAt: Date;
  passengers: TripPassenger[];
};

export function allStopsConfirmed(trip: ActiveTrip): boolean {
  return trip.passengers.every((passenger) => passenger.confirmedAt !== null);
}
