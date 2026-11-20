import type { FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';
import { z } from 'zod';
import type { ActiveTrip } from '../trips/trip.ts';
import type { TripService } from '../trips/trip-service.ts';
import type { User } from '../users/user.ts';

/**
 * Live driver location, isolated from the trip flow: positions live only in memory (never in the
 * database), are relayed only while a trip is active, and only to passengers who joined that trip.
 */

const WS_AUTH_TIMEOUT_MS = 5_000;
const WS_UNAUTHORIZED = 4401;
/** Drop updates that arrive faster than this, so a buggy client cannot flood passengers. */
const MIN_INTERVAL_MS = 500;

const authMessage = z.object({ type: z.literal('auth'), token: z.string() });
const positionMessage = z.object({
  type: z.literal('position'),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  heading: z.number().min(0).max(360).nullish(),
});

type DriverPosition = { tripId: string; lat: number; lng: number; heading: number | null; at: Date };
type Client = { socket: WebSocket; user: User };

export function canSeeDriver(trip: ActiveTrip | null, user: User): trip is ActiveTrip {
  return trip !== null && user.role === 'passenger' && trip.passengers.some((passenger) => passenger.userId === user.id);
}

export class LocationRelay {
  readonly #clients = new Set<Client>();
  readonly #tripService: TripService;
  #last: DriverPosition | null = null;

  constructor(tripService: TripService) {
    this.#tripService = tripService;
  }

  async add(socket: WebSocket, user: User): Promise<void> {
    const client: Client = { socket, user };
    this.#clients.add(client);
    socket.on('close', () => this.#clients.delete(client));
    if (user.role === 'driver') {
      socket.on('message', (raw) => {
        this.#onPosition(raw.toString()).catch(() => {});
      });
      return;
    }
    // Late joiners see the driver right away instead of waiting for the next update.
    const trip = (await this.#tripService.state()).activeTrip;
    if (this.#last && trip?.id === this.#last.tripId && canSeeDriver(trip, user)) send(client, this.#last);
  }

  close(): void {
    for (const { socket } of this.#clients) socket.close(1001, 'Server shutting down');
    this.#clients.clear();
  }

  async #onPosition(raw: string): Promise<void> {
    const parsed = positionMessage.safeParse(safeJson(raw));
    if (!parsed.success) return;
    const now = new Date();
    if (this.#last && now.getTime() - this.#last.at.getTime() < MIN_INTERVAL_MS) return;

    const trip = (await this.#tripService.state()).activeTrip;
    if (!trip) {
      this.#last = null; // Nothing to share outside a trip, and nothing kept for later.
      return;
    }
    const { lat, lng, heading } = parsed.data;
    this.#last = { tripId: trip.id, lat, lng, heading: heading ?? null, at: now };
    for (const client of this.#clients) {
      if (canSeeDriver(trip, client.user)) send(client, this.#last);
    }
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

/** `/ws/location`: same first-message auth as `/ws`. Drivers send positions; passengers receive them. */
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

  app.addHook('onClose', async () => relay.close());
}
