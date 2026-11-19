import type { User } from '../users/user.ts';
import type { TripState } from './ports.ts';
import type { RouteName } from './route.ts';
import { allStopsConfirmed } from './trip.ts';

export type DriverTripView = {
  id: string;
  route: RouteName;
  startedAt: string;
  passengers: { userId: string; name: string; address: string; confirmed: boolean }[];
  canFinish: boolean;
};

/** Passengers never see other passengers' names or addresses. */
export type PassengerTripView = {
  id: string;
  route: RouteName;
  startedAt: string;
  joined: boolean;
  /** The driver confirmed this passenger's stop (picked up); cancelling is no longer allowed. */
  confirmed: boolean;
};

export type StateView =
  | { role: 'driver'; nextRoute: RouteName; activeTrip: DriverTripView | null }
  | { role: 'passenger'; nextRoute: RouteName; activeTrip: PassengerTripView | null };

export function viewFor(state: TripState, user: User): StateView {
  const trip = state.activeTrip;
  if (user.role === 'driver') {
    return {
      role: 'driver',
      nextRoute: state.nextRoute,
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
    nextRoute: state.nextRoute,
    activeTrip: trip && {
      id: trip.id,
      route: trip.route,
      startedAt: trip.startedAt.toISOString(),
      joined: own !== undefined,
      confirmed: own?.confirmedAt != null,
    },
  };
}
