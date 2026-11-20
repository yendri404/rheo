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
