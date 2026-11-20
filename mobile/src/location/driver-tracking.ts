import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { ApiError, authenticatedApi } from '../api/client';
import { readStoredToken } from '../session/stored-session';
import { colors } from '../ui/theme';
import { shouldStopTracking, toPositionReport } from './position-report';

/**
 * The driver's live GPS (native). Runs only while a trip is open and keeps running with the phone
 * locked or the app in the background (Android shows a persistent notification, iOS the blue pill).
 * Positions go over HTTP because the OS suspends WebSockets in the background. The web build uses
 * driver-tracking.web.ts.
 *
 * Battery and data: the phone only reports after moving DISTANCE_METERS and at most every
 * INTERVAL_MS (enforced in sendPosition, since iOS ignores timeInterval), so a parked driver sends nothing; and it stops itself as soon as the server says the
 * trip is over (409), even if the app was killed before the driver finished the trip.
 */

/** `background`: shared even with the phone locked. `foreground`: only while the app is open. */
export type TrackingMode = 'background' | 'foreground' | 'denied';

const TASK_NAME = 'driver-location';
const INTERVAL_MS = 5_000;
const DISTANCE_METERS = 20;

type TaskData = { locations: Location.LocationObject[] };

// Must run at startup (imported from the root layout): the OS can relaunch the app headless just
// to deliver locations, and the task has to be defined by then.
TaskManager.defineTask<TaskData>(TASK_NAME, async ({ data, error }) => {
  const latest = data?.locations.at(-1);
  if (error || !latest) return;
  await sendPosition(latest.coords);
});

let foregroundWatch: Location.LocationSubscription | null = null;
// Start and stop are async; chaining them keeps a quick start/stop/start in order.
let queue: Promise<unknown> = Promise.resolve();
// iOS ignores `timeInterval` (Android-only), so the interval is also enforced here.
let lastSentAt = 0;
// Bumped on every start: a 409 for a report sent during the previous trip must not stop the new one.
let generation = 0;

function serial<T>(step: () => Promise<T>): Promise<T> {
  const run = queue.then(step, step);
  queue = run.catch(() => {});
  return run;
}

async function sendPosition(coords: Location.LocationObjectCoords): Promise<void> {
  const now = Date.now();
  if (now - lastSentAt < INTERVAL_MS) return;
  lastSentAt = now;
  const sentDuring = generation;
  const stopIfStillCurrent = () => (generation === sentDuring ? stopDriverTracking() : undefined);

  const token = await readStoredToken().catch(() => null);
  if (!token) {
    await stopIfStillCurrent(); // Signed out while the task was running.
    return;
  }
  try {
    await authenticatedApi(token).reportLocation(toPositionReport(coords));
  } catch (error) {
    if (error instanceof ApiError && shouldStopTracking(error.status)) await stopIfStillCurrent();
  }
}

export function startDriverTracking(): Promise<TrackingMode> {
  return serial(async () => {
    generation += 1;
    const foreground = await Location.requestForegroundPermissionsAsync();
    if (!foreground.granted) return 'denied';

    const background = await Location.requestBackgroundPermissionsAsync().catch(() => ({ granted: false }));
    if (background.granted) {
      if (!(await Location.hasStartedLocationUpdatesAsync(TASK_NAME))) {
        await Location.startLocationUpdatesAsync(TASK_NAME, {
          accuracy: Location.Accuracy.High, // Balanced can be ~100 m off: too coarse for the 200 m alert.
          timeInterval: INTERVAL_MS,
          distanceInterval: DISTANCE_METERS,
          activityType: Location.ActivityType.AutomotiveNavigation,
          // iOS auto-pause may never resume after a long stop in traffic.
          pausesUpdatesAutomatically: false,
          showsBackgroundLocationIndicator: true,
          foregroundService: {
            notificationTitle: 'Ruta en curso',
            notificationBody: 'Compartiendo tu ubicación con los pasajeros.',
            notificationColor: colors.primary,
          },
        });
      }
      return 'background';
    }

    // "Always" was refused: still share while the app is open.
    if (!foregroundWatch) {
      foregroundWatch = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.High, timeInterval: INTERVAL_MS, distanceInterval: DISTANCE_METERS },
        ({ coords }) => void sendPosition(coords),
      );
    }
    return 'foreground';
  });
}

export function stopDriverTracking(): Promise<void> {
  return serial(async () => {
    foregroundWatch?.remove();
    foregroundWatch = null;
    if (await Location.hasStartedLocationUpdatesAsync(TASK_NAME).catch(() => false)) {
      await Location.stopLocationUpdatesAsync(TASK_NAME);
    }
  });
}
