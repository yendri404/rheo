import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { wsUrl } from '../api/api-url';
import { ApiError, type AuthenticatedApi } from '../api/client';
import type { TripStateView } from '../api/types';

const MAX_BACKOFF_MS = 30_000;
const WS_UNAUTHORIZED = 4401;
/** The session is valid but the company is not available to this user (removed from it, or none assigned). */
const WS_FORBIDDEN = 4403;
const COMPANY_ERRORS = new Set(['FORBIDDEN', 'NO_COMPANY', 'COMPANY_REQUIRED']);

type Options = {
  onUnauthorized: () => void;
  /**
   * Company to watch. Drivers registered in several pass the one they selected; passengers omit it
   * and the server uses their own.
   */
  companyId?: string;
  /** The server refused that company: the profile is probably stale, so the caller should refresh it. */
  onCompanyUnavailable?: () => void;
};

/**
 * Live trip state of one company: the server pushes a full snapshot on connect and on every change.
 * Reconnects with exponential backoff and immediately when the app returns to the foreground.
 * Changing `companyId` drops the old state and connects to the new company.
 */
export function useTripState<T extends TripStateView>(token: string, api: AuthenticatedApi, options: Options) {
  const { companyId } = options;
  const [state, setState] = useState<T | null>(null);
  const [connected, setConnected] = useState(false);
  /** True while the server says this user has no access to the company (or has no company at all). */
  const [unavailable, setUnavailable] = useState(false);
  const callbacks = useRef(options);
  callbacks.current = options;

  useEffect(() => {
    let socket: WebSocket | null = null;
    let disposed = false;
    let attempt = 0;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;

    setState(null);
    setUnavailable(false);

    // HTTP fallback so the screen renders even if the socket is slow to connect.
    api.currentTrip(companyId).then(
      (view) => !disposed && setState((current) => current ?? (view as T)),
      (error) => {
        if (!disposed && error instanceof ApiError && COMPANY_ERRORS.has(error.code)) setUnavailable(true);
      },
    );

    function connect() {
      const current = new WebSocket(wsUrl('/ws'));
      socket = current;
      current.onopen = () => current.send(JSON.stringify({ type: 'auth', token, ...(companyId ? { companyId } : {}) }));
      current.onmessage = (event) => {
        const message = JSON.parse(String(event.data));
        if (message.type !== 'state') return;
        attempt = 0;
        setConnected(true);
        setUnavailable(false);
        setState(message.data as T);
      };
      current.onclose = (event) => {
        if (socket !== current || disposed) return;
        setConnected(false);
        if (event.code === WS_UNAUTHORIZED) {
          callbacks.current.onUnauthorized();
          return;
        }
        if (event.code === WS_FORBIDDEN) {
          setUnavailable(true);
          setState(null);
          callbacks.current.onCompanyUnavailable?.();
        }
        // Keeps retrying after a refusal too: an administrator may assign the company at any moment.
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
  }, [token, api, companyId]);

  return { state, setState, connected, unavailable };
}
