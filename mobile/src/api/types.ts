// Mirrors backend/src/trips/views.ts, backend/src/companies/company.ts and backend/src/users/user.ts.
export type Role = 'driver' | 'passenger';

/** `pickup` routes collect passengers and show the driver on a map; `dropoff` routes take them home. */
export type RouteKind = 'pickup' | 'dropoff';
export type Route = { name: string; kind: RouteKind };

export type Company = { id: string; name: string };

export type User = {
  id: string;
  email: string;
  name: string;
  address: string;
  role: Role;
  /** Companies the user is registered in, sorted by name. */
  companies: Company[];
};

export type DriverPassenger = { userId: string; name: string; address: string; confirmed: boolean };

export type DriverTrip = {
  id: string;
  route: Route;
  startedAt: string;
  passengers: DriverPassenger[];
  canFinish: boolean;
};

export type PassengerTrip = {
  id: string;
  route: Route;
  startedAt: string;
  joined: boolean;
  /** The driver confirmed this stop (picked up); cancelling is no longer allowed. */
  confirmed: boolean;
};

/** `nextRoute` is null while the company has no routes. */
export type DriverState = { role: 'driver'; companyId: string; nextRoute: Route | null; activeTrip: DriverTrip | null };
export type PassengerState = {
  role: 'passenger';
  companyId: string;
  nextRoute: Route | null;
  activeTrip: PassengerTrip | null;
};
export type TripStateView = DriverState | PassengerState;
