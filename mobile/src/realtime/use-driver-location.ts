import { useEffect, useState } from 'react';
import { wsUrl } from '../api/api-url';
import { isStale, measuredAt, SILENT_SOCKET_MS } from './driver-position';

/** `measuredAt`: when the position was true, on this phone's clock (see driver-position.ts). */
export type DriverPosition = { lat: number; lng: number; heading: number | null; at: string; measuredAt: number };

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
    let lastActivity = Date.now();

    function connect() {
      const current = new WebSocket(wsUrl('/ws/location'));
      socket = current;
      lastActivity = Date.now();
      current.onopen = () => {
        lastActivity = Date.now();
        current.send(JSON.stringify({ type: 'auth', token }));
      };
      current.onmessage = (event) => {
        const message = JSON.parse(String(event.data));
        if (message.type !== 'driver-position') return;
        attempt = 0;
        lastActivity = Date.now();
        setPosition({
          lat: message.lat,
          lng: message.lng,
          heading: message.heading ?? null,
          at: message.at,
          measuredAt: measuredAt(message.ageMs, Date.now()),
        });
      };
      current.onclose = (event) => {
        if (disposed || socket !== current || event.code === 4401) return;
        retry = setTimeout(connect, Math.min(MAX_BACKOFF_MS, 1000 * 2 ** attempt++));
      };
    }

    connect();

    // A phone that changed network keeps a socket that looks open but receives nothing. The driver
    // reports every 10 s at most, so a long silence means this socket is dead: open a new one,
    // which also brings the last known position.
    const watchdog = setInterval(() => {
      if (Date.now() - lastActivity < SILENT_SOCKET_MS) return;
      lastActivity = Date.now();
      clearTimeout(retry);
      attempt = 0;
      const silent = socket;
      socket = null;
      silent?.close();
      connect();
    }, 10_000);

    return () => {
      disposed = true;
      clearTimeout(retry);
      clearInterval(watchdog);
      socket?.close();
    };
  }, [token, enabled]);

  // Re-evaluate staleness even when no message arrives.
  useEffect(() => {
    if (!enabled) return;
    const timer = setInterval(() => setNow(Date.now()), 5_000);
    return () => clearInterval(timer);
  }, [enabled]);

  const stale = position !== null && isStale(position.measuredAt, now);
  return { position, stale };
}
