import type { RouteKind } from '../companies/company.ts';
import type { User } from '../users/user.ts';
import type { TripState } from './ports.ts';
import { allStopsConfirmed } from './trip.ts';

export type RouteView = { name: string; kind: RouteKind };

export type DriverTripView = {
  id: string;
  route: RouteView;
  startedAt: string;
  passengers: { userId: string; name: string; address: string; confirmed: boolean }[];
  canFinish: boolean;
};

/** Passengers never see other passengers' names or addresses. */
export type PassengerTripView = {
  id: string;
  route: RouteView;
  startedAt: string;
  joined: boolean;
  /** The driver confirmed this passenger's stop (picked up); cancelling is no longer allowed. */
  confirmed: boolean;
};

/** `nextRoute` is null while the company has no routes. */
export type StateView =
  | { role: 'driver'; companyId: string; nextRoute: RouteView | null; activeTrip: DriverTripView | null }
  | { role: 'passenger'; companyId: string; nextRoute: RouteView | null; activeTrip: PassengerTripView | null };

export function viewFor(state: TripState, user: User): StateView {
  const trip = state.activeTrip;
  const nextRoute = state.nextRoute && { name: state.nextRoute.name, kind: state.nextRoute.kind };
  if (user.role === 'driver') {
    return {
      role: 'driver',
      companyId: state.companyId,
      nextRoute,
      activeTrip: trip && {
        id: trip.id,
        route: trip.route,
        startedAt: trip.startedAt.toISOString(),
        passengers: trip.passengers.map(({ userId, name, address, confirmedAt }) => ({
          userId,
          name,
          address,
          confirmed: confirmedAt !== null,
        })),
        canFinish: allStopsConfirmed(trip),
      },
    };
  }
  const own = trip?.passengers.find((passenger) => passenger.userId === user.id);
  return {
    role: 'passenger',
    companyId: state.companyId,
    nextRoute,
    activeTrip: trip && {
      id: trip.id,
      route: trip.route,
      startedAt: trip.startedAt.toISOString(),
      joined: own !== undefined,
      confirmed: own?.confirmedAt != null,
    },
  };
}
