import * as Location from 'expo-location';
import { useEffect, useState } from 'react';
import type { LatLng } from '../map/proximity';

export type OwnLocation = { position: LatLng | null; denied: boolean };

/**
 * The passenger's own position (native). It never leaves the device: it is only compared
 * with the driver's position to know when the driver is close. The web build uses use-own-location.web.ts.
 */
export function useOwnLocation(enabled: boolean): OwnLocation {
  const [position, setPosition] = useState<LatLng | null>(null);
  const [denied, setDenied] = useState(false);

  useEffect(() => {
    if (!enabled) {
      setPosition(null);
      return;
    }
    let subscription: Location.LocationSubscription | null = null;
    let cancelled = false;
    (async () => {
      const { granted } = await Location.requestForegroundPermissionsAsync();
      if (cancelled) return;
      if (!granted) {
        setDenied(true);
        return;
      }
      subscription = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.Balanced, distanceInterval: 20, timeInterval: 5_000 },
        ({ coords }) => setPosition({ lat: coords.latitude, lng: coords.longitude }),
      );
      if (cancelled) subscription.remove();
    })().catch(() => setDenied(true));
    return () => {
      cancelled = true;
      subscription?.remove();
    };
  }, [enabled]);

  return { position, denied };
}
