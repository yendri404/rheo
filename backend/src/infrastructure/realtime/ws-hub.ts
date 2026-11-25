import type { WebSocket } from 'ws';
import type { TripEvents, TripState } from '../../trips/ports.ts';
import { viewFor } from '../../trips/views.ts';
import type { User } from '../../users/user.ts';

type Client = { socket: WebSocket; user: User; companyId: string; alive: boolean };

/** Standard "service restart" close code: clients reconnect and authenticate again. */
const WS_RECONNECT = 1012;

/**
 * Pushes the full role-specific state snapshot of a company to the clients watching that company.
 * Snapshots are tiny (one trip, tens of passengers), and clients never drift out of sync.
 */
export class WsHub implements TripEvents {
  readonly #clients = new Set<Client>();
  #heartbeat: NodeJS.Timeout | undefined;

  /** The caller has already checked that the user belongs to the company of `state`. */
  add(socket: WebSocket, user: User, state: TripState): void {
    const client: Client = { socket, user, companyId: state.companyId, alive: true };
    this.#clients.add(client);
    socket.on('pong', () => {
      client.alive = true;
    });
    socket.on('close', () => this.#clients.delete(client));
    send(client, state);
  }

  publish(state: TripState): void {
    for (const client of this.#clients) {
      if (client.companyId === state.companyId) send(client, state);
    }
  }

  /**
   * Call when a user's role or companies change, or the user is deleted: their sockets are dropped
   * so they come back through authentication instead of still watching a company they left.
   */
  disconnectUser(userId: string): void {
    for (const client of this.#clients) {
      if (client.user.id !== userId) continue;
      this.#clients.delete(client);
      client.socket.close(WS_RECONNECT, 'Account changed');
    }
  }

  get size(): number {
    return this.#clients.size;
  }

  /** Drops connections that stopped answering pings (phones that lost signal). */
  startHeartbeat(intervalMs = 30_000): void {
    this.#heartbeat = setInterval(() => {
      for (const client of this.#clients) {
        if (!client.alive) {
          client.socket.terminate();
          this.#clients.delete(client);
          continue;
        }
        client.alive = false;
        client.socket.ping();
      }
    }, intervalMs);
    this.#heartbeat.unref();
  }

  close(): void {
    clearInterval(this.#heartbeat);
    for (const client of this.#clients) client.socket.close(1001, 'Server shutting down');
    this.#clients.clear();
  }
}

function send(client: Client, state: TripState): void {
  if (client.socket.readyState !== client.socket.OPEN) return;
  client.socket.send(JSON.stringify({ type: 'state', data: viewFor(state, client.user) }));
}
