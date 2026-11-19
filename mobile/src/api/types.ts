// Mirrors backend/src/trips/views.ts and backend/src/users/user.ts.
export type RouteName = 'manana' | 'norte' | 'sur';
export type Role = 'driver' | 'passenger';

export type User = {
  id: string;
  email: string;
  name: string;
  address: string;
  role: Role;
};

export type DriverPassenger = { userId: string; name: string; address: string; confirmed: boolean };

export type DriverTrip = {
  id: string;
  route: RouteName;
  startedAt: string;
  passengers: DriverPassenger[];
  canFinish: boolean;
};

export type PassengerTrip = {
  id: string;
  route: RouteName;
  startedAt: string;
  joined: boolean;
  /** The driver confirmed this stop (picked up); cancelling is no longer allowed. */
  confirmed: boolean;
};

export type DriverState = { role: 'driver'; nextRoute: RouteName; activeTrip: DriverTrip | null };
export type PassengerState = { role: 'passenger'; nextRoute: RouteName; activeTrip: PassengerTrip | null };
export type TripStateView = DriverState | PassengerState;

export const ROUTE_LABELS: Record<RouteName, string> = {
  manana: 'Mañana',
  norte: 'Norte',
  sur: 'Sur',
};
