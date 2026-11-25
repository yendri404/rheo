import { AppError } from '../shared/app-error.ts';

/** `pickup` routes collect passengers and share the driver's live position; `dropoff` routes take them home. */
export type RouteKind = 'pickup' | 'dropoff';

export type Route = { id: string; name: string; kind: RouteKind };

export type Company = { id: string; name: string };

/** Routes come in rotation order. */
export type CompanyWithRoutes = Company & { routes: Route[] };

/** A route without `id` (or with an id the company does not own) is created. */
export type RouteInput = { id?: string; name: string; kind: RouteKind };

export type CompanyChanges = { name?: string; routes?: RouteInput[] };

export interface CompanyRepository {
  /** Sorted by name. */
  list(): Promise<CompanyWithRoutes[]>;
  findById(id: string): Promise<CompanyWithRoutes | null>;
  /** Throws AppError COMPANY_NAME_TAKEN when another company has that name (case-insensitive). */
  create(name: string, routes: RouteInput[]): Promise<CompanyWithRoutes>;
  /**
   * `routes` replaces the whole ordered list: kept ids are updated in place, the rest are created,
   * and routes left out are deleted. Returns null for an unknown id. Throws COMPANY_NAME_TAKEN.
   */
  update(id: string, changes: CompanyChanges): Promise<CompanyWithRoutes | null>;
  /** Also removes its routes, memberships and trips. Returns false for an unknown id. */
  delete(id: string): Promise<boolean>;
}

/** Routes rotate on every started trip, wrapping around. Null when the company has no routes. */
export function nextRoute(routes: Route[], lastRouteId: string | null): Route | null {
  if (routes.length === 0) return null;
  const index = routes.findIndex((route) => route.id === lastRouteId);
  return routes[(index + 1) % routes.length]!;
}

export function companyNameTaken(): AppError {
  return new AppError('COMPANY_NAME_TAKEN', 'A company with this name already exists.');
}
