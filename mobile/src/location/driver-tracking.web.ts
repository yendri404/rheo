import { ApiError, authenticatedApi } from '../api/client';
import { readStoredToken } from '../session/stored-session';
import { GPS_INTERVAL_MS, HEARTBEAT_MS, shouldReport, shouldStopTracking, toPositionReport, type SentReport } from './position-report';

/** Web build: browsers cannot track in the background, so the driver is shared only while the tab is open. */
export type TrackingMode = 'background' | 'foreground' | 'denied';

let watchId: number | null = null;
let heartbeat: ReturnType<typeof setInterval> | null = null;
let latest: GeolocationCoordinates | null = null;
let lastSent: SentReport | null = null;

/** Sends the latest fix when `shouldReport` says so. Called on every fix and by the parked-driver heartbeat. */
function maybeSend(): void {
  if (!latest) return;
  const now = Date.now();
  const next = { lat: latest.latitude, lng: latest.longitude };
  if (!shouldReport(lastSent, next, now)) return;
  lastSent = { ...next, at: now };
  void sendPosition(latest);
}

export async function startDriverTracking(): Promise<TrackingMode> {
  if (typeof navigator === 'undefined' || !navigator.geolocation) return 'denied';
  if (watchId !== null) return 'foreground';
  latest = null;
  lastSent = null;
  watchId = navigator.geolocation.watchPosition(
    ({ coords }) => {
      latest = coords;
      maybeSend();
    },
    () => {},
    { enableHighAccuracy: true, maximumAge: GPS_INTERVAL_MS },
  );
  // Browsers only fire the watch when the position changes, so a parked driver needs a timer to keep reporting.
  heartbeat = setInterval(maybeSend, HEARTBEAT_MS / 2);
  return 'foreground';
}

export async function stopDriverTracking(): Promise<void> {
  if (watchId !== null) navigator.geolocation.clearWatch(watchId);
  if (heartbeat !== null) clearInterval(heartbeat);
  watchId = null;
  heartbeat = null;
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
    // A report that did not get through (no signal, timeout) is retried with the next fix instead of waiting for the heartbeat.
    else lastSent = null;
  }
}
