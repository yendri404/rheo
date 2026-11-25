import { useEffect, useState } from 'react';
import { wsUrl } from '../api/api-url';

export type DriverPosition = { lat: number; lng: number; heading: number | null; at: string };

/** No update for this long means the location on screen may be outdated. */
export const STALE_AFTER_MS = 20_000;
const MAX_BACKOFF_MS = 15_000;

/**
 * Live driver position from /ws/location. Only connects while `enabled` (the passenger joined the
 * trip); the server also enforces that, this just avoids an idle connection.
 */
export function useDriverLocation(token: string, enabled: boolean) {
  const [position, setPosition] = useState<DriverPosition | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!enabled) {
      setPosition(null);
      return;
    }
    let socket: WebSocket | null = null;
    let disposed = false;
    let attempt = 0;
    let retry: ReturnType<typeof setTimeout> | undefined;

    function connect() {
      const current = new WebSocket(wsUrl('/ws/location'));
      socket = current;
      current.onopen = () => current.send(JSON.stringify({ type: 'auth', token }));
      current.onmessage = (event) => {
        const message = JSON.parse(String(event.data));
        if (message.type !== 'driver-position') return;
        attempt = 0;
        setPosition({ lat: message.lat, lng: message.lng, heading: message.heading ?? null, at: message.at });
      };
      current.onclose = (event) => {
        if (disposed || socket !== current || event.code === 4401) return;
        retry = setTimeout(connect, Math.min(MAX_BACKOFF_MS, 1000 * 2 ** attempt++));
      };
    }

    connect();
    return () => {
      disposed = true;
      clearTimeout(retry);
      socket?.close();
    };
  }, [token, enabled]);

  // Re-evaluate staleness even when no message arrives.
  useEffect(() => {
    if (!enabled) return;
    const timer = setInterval(() => setNow(Date.now()), 5_000);
    return () => clearInterval(timer);
  }, [enabled]);

  const stale = position !== null && now - new Date(position.at).getTime() > STALE_AFTER_MS;
  return { position, stale };
}
