import { useEffect, useState } from 'react';
import { startDriverTracking, stopDriverTracking, type TrackingMode } from './driver-tracking';

/**
 * Shares the driver's GPS only while `tripOpen`. Closing the trip or leaving the driver screen
 * (sign-out) stops it; locking the phone does not. Returns null while no trip is open.
 */
export function useDriverTracking(tripOpen: boolean): TrackingMode | null {
  const [mode, setMode] = useState<TrackingMode | null>(null);

  useEffect(() => {
    if (!tripOpen) {
      setMode(null);
      // Also cleans up tracking left running by an earlier session whose trip already ended.
      stopDriverTracking().catch(() => {});
      return;
    }
    let cancelled = false;
    startDriverTracking()
      .then((next) => (cancelled ? undefined : setMode(next)))
      .catch(() => (cancelled ? undefined : setMode('denied')));
    return () => {
      cancelled = true;
      stopDriverTracking().catch(() => {});
    };
  }, [tripOpen]);

  return mode;
}
