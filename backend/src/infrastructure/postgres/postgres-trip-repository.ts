import { AppError } from '../../shared/app-error.ts';
import type { TripRepository } from '../../trips/ports.ts';
import type { RouteName } from '../../trips/route.ts';
import type { ActiveTrip } from '../../trips/trip.ts';
import { isUniqueViolation, type Sql } from './database.ts';

type TripRow = {
  id: string;
  route: RouteName;
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

  async findActive(): Promise<ActiveTrip | null> {
    const rows = await this.#sql<TripRow[]>`
      SELECT t.id, t.route, t.started_at, tp.user_id, u.name, u.address, tp.joined_at, tp.confirmed_at
      FROM trips t
      LEFT JOIN trip_passengers tp ON tp.trip_id = t.id
      LEFT JOIN users u ON u.id = tp.user_id
      WHERE t.status = 'active'
      ORDER BY tp.joined_at, u.name`;
    const first = rows[0];
    if (!first) return null;
    return {
      id: first.id,
      route: first.route,
      startedAt: first.started_at,
      passengers: rows
        .filter((row) => row.user_id !== null)
        .map((row) => ({
          userId: row.user_id!,
          name: row.name ?? '',
          address: row.address ?? '',
          joinedAt: row.joined_at!,
          confirmedAt: row.confirmed_at,
        })),
    };
  }

  async lastRoute(): Promise<RouteName | null> {
    const [row] = await this.#sql<{ route: RouteName }[]>`SELECT route FROM trips ORDER BY seq DESC LIMIT 1`;
    return row?.route ?? null;
  }

  async start(route: RouteName, at: Date): Promise<void> {
    try {
      await this.#sql`INSERT INTO trips (route, status, started_at) VALUES (${route}, 'active', ${at})`;
    } catch (error) {
      if (isUniqueViolation(error, 'trips_one_active')) {
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
}
