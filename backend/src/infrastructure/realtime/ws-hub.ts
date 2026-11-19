import type { WebSocket } from 'ws';
import type { TripEvents, TripState } from '../../trips/ports.ts';
import { viewFor } from '../../trips/views.ts';
import type { User } from '../../users/user.ts';

type Client = { socket: WebSocket; user: User; alive: boolean };

/**
 * Pushes the full role-specific state snapshot on every change.
 * Snapshots are tiny (one trip, tens of passengers), and clients never drift out of sync.
 */
export class WsHub implements TripEvents {
  readonly #clients = new Set<Client>();
  #heartbeat: NodeJS.Timeout | undefined;

  add(socket: WebSocket, user: User, state: TripState): void {
    const client: Client = { socket, user, alive: true };
    this.#clients.add(client);
    socket.on('pong', () => {
      client.alive = true;
    });
    socket.on('close', () => this.#clients.delete(client));
    send(client, state);
  }

  publish(state: TripState): void {
    for (const client of this.#clients) send(client, state);
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
