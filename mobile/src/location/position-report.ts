import { distanceMeters, type LatLng } from '../map/proximity.ts';

/** Body of `POST /location`. Kept free of Expo imports so it runs under `node --test`. */
export type PositionReport = { lat: number; lng: number; heading: number | null };

type Coords = { latitude: number; longitude: number; heading?: number | null };

/** iOS reports -1 (and some devices NaN) when the heading is unknown; the server only accepts 0-360. */
export function toPositionReport({ latitude, longitude, heading }: Coords): PositionReport {
  const valid = typeof heading === 'number' && Number.isFinite(heading) && heading >= 0 && heading <= 360;
  return { lat: latitude, lng: longitude, heading: valid ? heading : null };
}

/**
 * 409: the trip is over. 401/403: no valid driver session. Any of them means tracking is pointless,
 * so the phone stops instead of burning battery and data. Network errors (0) and 5xx are retried
 * naturally by the next position.
 */
export function shouldStopTracking(status: number): boolean {
  return status === 401 || status === 403 || status === 409;
}

/**
 * How often the phone asks the OS for a GPS fix while a trip is open. The OS delivers one this
 * often even when the vehicle is not moving; `shouldReport` decides which ones are sent.
 */
export const GPS_INTERVAL_MS = 5_000;
/** Never report faster than this. Below GPS_INTERVAL_MS on purpose: a fix that arrives a little early must not be dropped. */
export const MIN_REPORT_INTERVAL_MS = 3_000;
/** A fix this far from the last report counts as movement (below it, it is GPS jitter). */
export const MOVED_METERS = 10;
/**
 * A parked driver still reports this often. Without it passengers cannot tell "stopped at a
 * traffic light" from "the driver's phone lost connection", and the map called it outdated.
 */
export const HEARTBEAT_MS = 10_000;

export type SentReport = LatLng & { at: number };

/** Whether a new GPS fix is worth sending, given the last one that was sent. */
export function shouldReport(last: SentReport | null, next: LatLng, now: number): boolean {
  if (!last) return true;
  const elapsed = now - last.at;
  if (elapsed < MIN_REPORT_INTERVAL_MS) return false;
  if (elapsed >= HEARTBEAT_MS) return true;
  return distanceMeters(last, next) >= MOVED_METERS;
}
