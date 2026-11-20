import { ApiError, authenticatedApi } from '../api/client';
import { readStoredToken } from '../session/stored-session';
import { shouldStopTracking, toPositionReport } from './position-report';

/** Web build: browsers cannot track in the background, so the driver is shared only while the tab is open. */
export type TrackingMode = 'background' | 'foreground' | 'denied';

const INTERVAL_MS = 5_000;

let watchId: number | null = null;
let lastSentAt = 0;

export async function startDriverTracking(): Promise<TrackingMode> {
  if (typeof navigator === 'undefined' || !navigator.geolocation) return 'denied';
  if (watchId !== null) return 'foreground';
  watchId = navigator.geolocation.watchPosition(
    ({ coords }) => {
      if (Date.now() - lastSentAt < INTERVAL_MS) return;
      lastSentAt = Date.now();
      void sendPosition(coords);
    },
    () => {},
    { enableHighAccuracy: true, maximumAge: INTERVAL_MS },
  );
  return 'foreground';
}

export async function stopDriverTracking(): Promise<void> {
  if (watchId !== null) navigator.geolocation.clearWatch(watchId);
  watchId = null;
}

async function sendPosition(coords: GeolocationCoordinates): Promise<void> {
  // A 409 for a report sent during the previous trip must not stop the watch of a new one.
  const sentFrom = watchId;
  const stopIfStillCurrent = () => (watchId === sentFrom ? stopDriverTracking() : undefined);
  const token = await readStoredToken().catch(() => null);
  if (!token) return stopIfStillCurrent();
  try {
    await authenticatedApi(token).reportLocation(toPositionReport(coords));
  } catch (error) {
    if (error instanceof ApiError && shouldStopTracking(error.status)) await stopIfStillCurrent();
  }
}
