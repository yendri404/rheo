import { randomUUID } from 'node:crypto';
import type { RouteKind } from '../../companies/company.ts';
import { AppError } from '../../shared/app-error.ts';
import type { NewTrip, TripRepository } from '../../trips/ports.ts';
import type { ActiveTrip } from '../../trips/trip.ts';
import type { UserRepository } from '../../users/user.ts';

type StoredPassenger = { userId: string; joinedAt: Date; confirmedAt: Date | null };
type StoredTrip = {
  id: string;
  companyId: string;
  driverId: string;
  routeId: string;
  route: { name: string; kind: RouteKind };
  startedAt: Date;
  finishedAt: Date | null;
  passengers: StoredPassenger[];
};

/** Test and local-dev adapter. Single-threaded JS keeps every method atomic. */
export class InMemoryTripRepository implements TripRepository {
  readonly #trips: StoredTrip[] = [];
  readonly #users: UserRepository;

  constructor(users: UserRepository) {
    this.#users = users;
  }

  async findActive(companyId: string): Promise<ActiveTrip | null> {
    const trip = this.#trips.find((candidate) => candidate.companyId === companyId && candidate.finishedAt === null);
    return trip ? this.#toActive(trip) : null;
  }

  async listActive(): Promise<ActiveTrip[]> {
    return Promise.all(this.#trips.filter((trip) => trip.finishedAt === null).map((trip) => this.#toActive(trip)));
  }

  async lastRouteId(companyId: string): Promise<string | null> {
    return this.#trips.findLast((trip) => trip.companyId === companyId)?.routeId ?? null;
  }

  async start({ companyId, route, driverId, at }: NewTrip): Promise<void> {
    if (this.#trips.some((trip) => trip.companyId === companyId && trip.finishedAt === null)) {
      throw new AppError('TRIP_ALREADY_ACTIVE', 'A trip is already active.');
    }
    this.#trips.push({
      id: randomUUID(),
      companyId,
      driverId,
      routeId: route.id,
      route: { name: route.name, kind: route.kind },
      startedAt: at,
      finishedAt: null,
      passengers: [],
    });
  }

  async addPassenger(tripId: string, userId: string, at: Date): Promise<'added' | 'trip_not_active'> {
    const trip = this.#activeById(tripId);
    if (!trip) return 'trip_not_active';
    if (!trip.passengers.some((passenger) => passenger.userId === userId)) {
      trip.passengers.push({ userId, joinedAt: at, confirmedAt: null });
    }
    return 'added';
  }

  async removePassenger(
    tripId: string,
    userId: string,
  ): Promise<'removed' | 'not_in_trip' | 'already_confirmed' | 'trip_not_active'> {
    const trip = this.#activeById(tripId);
    if (!trip) return 'trip_not_active';
    const index = trip.passengers.findIndex((passenger) => passenger.userId === userId);
    if (index === -1) return 'not_in_trip';
    if (trip.passengers[index]!.confirmedAt !== null) return 'already_confirmed';
    trip.passengers.splice(index, 1);
    return 'removed';
  }

  async confirmStop(tripId: string, userId: string, at: Date): Promise<'confirmed' | 'not_in_trip'> {
    const passenger = this.#activeById(tripId)?.passengers.find((candidate) => candidate.userId === userId);
    if (!passenger) return 'not_in_trip';
    passenger.confirmedAt ??= at;
    return 'confirmed';
  }

  async finish(tripId: string, at: Date): Promise<'finished' | 'pending_stops' | 'trip_not_active'> {
    const trip = this.#activeById(tripId);
    if (!trip) return 'trip_not_active';
    if (trip.passengers.some((passenger) => passenger.confirmedAt === null)) return 'pending_stops';
    trip.finishedAt = at;
    return 'finished';
  }

  #activeById(tripId: string): StoredTrip | undefined {
    return this.#trips.find((trip) => trip.id === tripId && trip.finishedAt === null);
  }

  async #toActive(trip: StoredTrip): Promise<ActiveTrip> {
    const passengers = await Promise.all(
      trip.passengers.map(async (passenger) => {
        const user = await this.#users.findById(passenger.userId);
        return { ...passenger, name: user?.name ?? '', address: user?.address ?? '' };
      }),
    );
    return {
      id: trip.id,
      companyId: trip.companyId,
      driverId: trip.driverId,
      route: { ...trip.route },
      startedAt: trip.startedAt,
      passengers,
    };
  }
}
