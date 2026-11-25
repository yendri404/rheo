import type { FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';
import { z } from 'zod';
import { AppError } from '../shared/app-error.ts';
import type { ActiveTrip } from '../trips/trip.ts';
import type { TripService } from '../trips/trip-service.ts';
import { isMember, type User } from '../users/user.ts';

/**
 * Live driver location, isolated from the trip flow: positions live only in memory (never in the
 * database), are relayed only while a trip is active, and only to passengers who joined that trip.
 * With several companies running at once, a driver's position only reaches the trips they started.
 */

const WS_AUTH_TIMEOUT_MS = 5_000;
const WS_UNAUTHORIZED = 4401;
/** Drop updates that arrive faster than this, so a buggy client cannot flood passengers. */
const MIN_INTERVAL_MS = 500;

const authMessage = z.object({ type: z.literal('auth'), token: z.string() });
const positionFields = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  heading: z.number().min(0).max(360).nullish(),
});
const positionMessage = positionFields.extend({ type: z.literal('position') });

export type PositionReport = z.infer<typeof positionFields>;
/** `relayed`/`throttled` both mean "keep sending"; `no-trip` means the driver should stop tracking. */
export type ReportOutcome = 'relayed' | 'throttled' | 'no-trip';

type DriverPosition = { lat: number; lng: number; heading: number | null; at: Date };
type Client = { socket: WebSocket; user: User };

export function canSeeDriver(trip: ActiveTrip | null, user: User): trip is ActiveTrip {
  return trip !== null && user.role === 'passenger' && trip.passengers.some((passenger) => passenger.userId === user.id);
}

/** Trips started before drivers were recorded belong to any driver of their company. */
export function drives(trip: ActiveTrip, driver: User): boolean {
  if (trip.driverId !== null) return trip.driverId === driver.id;
  return isMember(driver, trip.companyId);
}

export class LocationRelay {
  readonly #clients = new Set<Client>();
  readonly #tripService: TripService;
  /** Latest position per running trip. */
  readonly #last = new Map<string, DriverPosition>();
  /** Time of the latest accepted report per driver, for throttling. */
  readonly #reportedAt = new Map<string, number>();

  constructor(tripService: TripService) {
    this.#tripService = tripService;
  }

  async add(socket: WebSocket, user: User): Promise<void> {
    const client: Client = { socket, user };
    this.#clients.add(client);
    socket.on('close', () => this.#clients.delete(client));
    if (user.role === 'driver') {
      socket.on('message', (raw) => {
        this.#onPosition(user, raw.toString()).catch(() => {});
      });
      return;
    }
    // Late joiners see the driver right away instead of waiting for the next update.
    for (const trip of await this.#tripService.activeTrips()) {
      const last = this.#last.get(trip.id);
      if (last && canSeeDriver(trip, user)) send(client, last);
    }
  }

  close(): void {
    for (const { socket } of this.#clients) socket.close(1001, 'Server shutting down');
    this.#clients.clear();
  }

  /** Shared by the WebSocket and the HTTP endpoint the phone uses while the app is in the background. */
  async report(driver: User, position: PositionReport): Promise<ReportOutcome> {
    const now = new Date();
    const previous = this.#reportedAt.get(driver.id);
    if (previous !== undefined && now.getTime() - previous < MIN_INTERVAL_MS) return 'throttled';

    const active = await this.#tripService.activeTrips();
    // Nothing is kept for trips that are over.
    for (const tripId of this.#last.keys()) {
      if (!active.some((trip) => trip.id === tripId)) this.#last.delete(tripId);
    }
    const own = active.filter((trip) => drives(trip, driver));
    if (own.length === 0) {
      this.#reportedAt.delete(driver.id); // Nothing to share outside a trip.
      return 'no-trip';
    }

    this.#reportedAt.set(driver.id, now.getTime());
    const { lat, lng, heading } = position;
    const last: DriverPosition = { lat, lng, heading: heading ?? null, at: now };
    for (const trip of own) {
      this.#last.set(trip.id, last);
      for (const client of this.#clients) {
        if (canSeeDriver(trip, client.user)) send(client, last);
      }
    }
    return 'relayed';
  }

  async #onPosition(driver: User, raw: string): Promise<void> {
    const parsed = positionMessage.safeParse(safeJson(raw));
    if (parsed.success) await this.report(driver, parsed.data);
  }
}

function send(client: Client, position: DriverPosition): void {
  if (client.socket.readyState !== client.socket.OPEN) return;
  const { lat, lng, heading, at } = position;
  client.socket.send(JSON.stringify({ type: 'driver-position', lat, lng, heading, at: at.toISOString() }));
}

function safeJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * `/ws/location`: same first-message auth as `/ws`. Drivers send positions; passengers receive them.
 * `POST /location`: the same driver report over HTTP, for the background task (a locked phone
 * suspends WebSockets). It answers 409 NO_ACTIVE_TRIP so the phone stops tracking on its own.
 */
export function registerLocationRoutes(
  app: FastifyInstance,
  deps: { authenticate: (token: string) => Promise<User>; tripService: TripService },
): void {
  const relay = new LocationRelay(deps.tripService);

  app.get('/ws/location', { websocket: true }, (socket) => {
    const timeout = setTimeout(() => socket.close(WS_UNAUTHORIZED, 'Authentication timeout'), WS_AUTH_TIMEOUT_MS);
    socket.once('message', async (raw) => {
      clearTimeout(timeout);
      try {
        const { token } = authMessage.parse(safeJson(raw.toString()));
        await relay.add(socket, await deps.authenticate(token));
      } catch {
        socket.close(WS_UNAUTHORIZED, 'Unauthorized');
      }
    });
    socket.once('close', () => clearTimeout(timeout));
  });

  app.post('/location', async (request, reply) => {
    const header = request.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw new AppError('UNAUTHENTICATED', 'Missing session.');
    const user = await deps.authenticate(header.slice('Bearer '.length));
    if (user.role !== 'driver') throw new AppError('FORBIDDEN', 'Only the driver shares a location.');
    const outcome = await relay.report(user, positionFields.parse(request.body));
    if (outcome === 'no-trip') throw new AppError('NO_ACTIVE_TRIP', 'No active trip.');
    return reply.status(204).send();
  });

  app.addHook('onClose', async () => relay.close());
}
