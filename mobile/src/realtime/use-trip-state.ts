import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { WS_URL, type AuthenticatedApi } from '../api/client';
import type { TripStateView } from '../api/types';

const MAX_BACKOFF_MS = 30_000;
const WS_UNAUTHORIZED = 4401;

/**
 * Live trip state: the server pushes a full snapshot on connect and on every change.
 * Reconnects with exponential backoff and immediately when the app returns to the foreground.
 */
export function useTripState<T extends TripStateView>(token: string, api: AuthenticatedApi, onUnauthorized: () => void) {
  const [state, setState] = useState<T | null>(null);
  const [connected, setConnected] = useState(false);
  const onUnauthorizedRef = useRef(onUnauthorized);
  onUnauthorizedRef.current = onUnauthorized;

  useEffect(() => {
    let socket: WebSocket | null = null;
    let disposed = false;
    let attempt = 0;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;

    // HTTP fallback so the screen renders even if the socket is slow to connect.
    api.currentTrip().then((view) => !disposed && setState((current) => current ?? (view as T)), () => {});

    function connect() {
      const current = new WebSocket(WS_URL);
      socket = current;
      current.onopen = () => current.send(JSON.stringify({ type: 'auth', token }));
      current.onmessage = (event) => {
        const message = JSON.parse(String(event.data));
        if (message.type !== 'state') return;
        attempt = 0;
        setConnected(true);
        setState(message.data as T);
      };
      current.onclose = (event) => {
        if (socket !== current || disposed) return;
        setConnected(false);
        if (event.code === WS_UNAUTHORIZED) {
          onUnauthorizedRef.current();
          return;
        }
        const delay = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** attempt++);
        retryTimer = setTimeout(connect, delay);
      };
    }

    connect();

    const subscription = AppState.addEventListener('change', (status) => {
      if (status !== 'active' || socket?.readyState === WebSocket.OPEN) return;
      clearTimeout(retryTimer);
      attempt = 0;
      const stale = socket;
      socket = null;
      stale?.close();
      connect();
    });

    return () => {
      disposed = true;
      clearTimeout(retryTimer);
      subscription.remove();
      socket?.close();
    };
  }, [token, api]);

  return { state, setState, connected };
}
