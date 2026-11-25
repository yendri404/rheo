import type { RouteKind } from '../../companies/company.ts';
import { AppError } from '../../shared/app-error.ts';
import type { NewTrip, TripRepository } from '../../trips/ports.ts';
import type { ActiveTrip } from '../../trips/trip.ts';
import { isUniqueViolation, type Sql } from './database.ts';

type TripRow = {
  id: string;
  company_id: string;
  driver_id: string | null;
  route_name: string;
  route_kind: RouteKind;
  started_at: Date;
  user_id: string | null;
  name: string | null;
  address: string | null;
  joined_at: Date | null;
  confirmed_at: Date | null;
};

/**
 * Join takes a shared lock on the trip row and finish takes an exclusive one,
 * so a passenger can never slip into a trip at the instant it is being finished.
 */
export class PostgresTripRepository implements TripRepository {
  readonly #sql: Sql;

  constructor(sql: Sql) {
    this.#sql = sql;
  }

  async findActive(companyId: string): Promise<ActiveTrip | null> {
    return (await this.#active(companyId))[0] ?? null;
  }

  listActive(): Promise<ActiveTrip[]> {
    return this.#active(null);
  }

  async lastRouteId(companyId: string): Promise<string | null> {
    const [row] = await this.#sql<{ route_id: string | null }[]>`
      SELECT route_id FROM trips WHERE company_id = ${companyId} ORDER BY seq DESC LIMIT 1`;
    return row?.route_id ?? null;
  }

  async start({ companyId, route, driverId, at }: NewTrip): Promise<void> {
    try {
      await this.#sql`
        INSERT INTO trips (company_id, route_id, route_name, route_kind, driver_id, status, started_at)
        VALUES (${companyId}, ${route.id}, ${route.name}, ${route.kind}, ${driverId}, 'active', ${at})`;
    } catch (error) {
      if (isUniqueViolation(error, 'trips_one_active_per_company')) {
        throw new AppError('TRIP_ALREADY_ACTIVE', 'A trip is already active.');
      }
      throw error;
    }
  }

  async addPassenger(tripId: string, userId: string, at: Date): Promise<'added' | 'trip_not_active'> {
    return this.#sql.begin(async (tx) => {
      const [trip] = await tx`SELECT 1 FROM trips WHERE id = ${tripId} AND status = 'active' FOR SHARE`;
      if (!trip) return 'trip_not_active' as const;
      await tx`
        INSERT INTO trip_passengers (trip_id, user_id, joined_at) VALUES (${tripId}, ${userId}, ${at})
        ON CONFLICT (trip_id, user_id) DO NOTHING`;
      return 'added' as const;
    });
  }

  async removePassenger(
    tripId: string,
    userId: string,
  ): Promise<'removed' | 'not_in_trip' | 'already_confirmed' | 'trip_not_active'> {
    return this.#sql.begin(async (tx) => {
      // Same shared lock as join, so a cancel cannot interleave with finish.
      const [trip] = await tx`SELECT 1 FROM trips WHERE id = ${tripId} AND status = 'active' FOR SHARE`;
      if (!trip) return 'trip_not_active' as const;
      const removed = await tx`
        DELETE FROM trip_passengers
        WHERE trip_id = ${tripId} AND user_id = ${userId} AND confirmed_at IS NULL
        RETURNING 1`;
      if (removed.length > 0) return 'removed' as const;
      const [confirmed] = await tx`
        SELECT 1 FROM trip_passengers WHERE trip_id = ${tripId} AND user_id = ${userId}`;
      return confirmed ? ('already_confirmed' as const) : ('not_in_trip' as const);
    });
  }

  async confirmStop(tripId: string, userId: string, at: Date): Promise<'confirmed' | 'not_in_trip'> {
    const rows = await this.#sql`
      UPDATE trip_passengers tp SET confirmed_at = COALESCE(tp.confirmed_at, ${at})
      FROM trips t
      WHERE t.id = tp.trip_id AND t.id = ${tripId} AND t.status = 'active' AND tp.user_id = ${userId}
      RETURNING 1`;
    return rows.length > 0 ? 'confirmed' : 'not_in_trip';
  }

  async finish(tripId: string, at: Date): Promise<'finished' | 'pending_stops' | 'trip_not_active'> {
    return this.#sql.begin(async (tx) => {
      const [trip] = await tx`SELECT 1 FROM trips WHERE id = ${tripId} AND status = 'active' FOR UPDATE`;
      if (!trip) return 'trip_not_active' as const;
      const [pending] = await tx`
        SELECT 1 FROM trip_passengers WHERE trip_id = ${tripId} AND confirmed_at IS NULL LIMIT 1`;
      if (pending) return 'pending_stops' as const;
      await tx`UPDATE trips SET status = 'finished', finished_at = ${at} WHERE id = ${tripId}`;
      return 'finished' as const;
    });
  }

  /** Running trips with their passengers: the one of a company, or all of them. */
  async #active(companyId: string | null): Promise<ActiveTrip[]> {
    const sql = this.#sql;
    const rows = await sql<TripRow[]>`
      SELECT t.id, t.company_id, t.driver_id, t.route_name, t.route_kind, t.started_at,
        tp.user_id, u.name, u.address, tp.joined_at, tp.confirmed_at
      FROM trips t
      LEFT JOIN trip_passengers tp ON tp.trip_id = t.id
      LEFT JOIN users u ON u.id = tp.user_id
      WHERE t.status = 'active' ${companyId === null ? sql`` : sql`AND t.company_id = ${companyId}`}
      ORDER BY t.seq, tp.joined_at, u.name`;
    const trips = new Map<string, ActiveTrip>();
    for (const row of rows) {
      let trip = trips.get(row.id);
      if (!trip) {
        trip = {
          id: row.id,
          companyId: row.company_id,
          driverId: row.driver_id,
          route: { name: row.route_name, kind: row.route_kind },
          startedAt: row.started_at,
          passengers: [],
        };
        trips.set(row.id, trip);
      }
      if (row.user_id !== null) {
        trip.passengers.push({
          userId: row.user_id,
          name: row.name ?? '',
          address: row.address ?? '',
          joinedAt: row.joined_at!,
          confirmedAt: row.confirmed_at,
        });
      }
    }
    return [...trips.values()];
  }
}
