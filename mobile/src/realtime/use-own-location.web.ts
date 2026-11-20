import { useEffect, useState } from 'react';
import type { LatLng } from '../map/proximity';
import type { OwnLocation } from './use-own-location';

/** Web version: the browser's Geolocation API. The position never leaves the device. */
export function useOwnLocation(enabled: boolean): OwnLocation {
  const [position, setPosition] = useState<LatLng | null>(null);
  const [denied, setDenied] = useState(false);

  useEffect(() => {
    if (!enabled || typeof navigator === 'undefined' || !navigator.geolocation) {
      setPosition(null);
      return;
    }
    const watchId = navigator.geolocation.watchPosition(
      ({ coords }) => {
        setDenied(false);
        setPosition({ lat: coords.latitude, lng: coords.longitude });
      },
      (error) => {
        if (error.code === error.PERMISSION_DENIED) setDenied(true);
      },
      { enableHighAccuracy: true, maximumAge: 5_000 },
    );
    return () => navigator.geolocation.clearWatch(watchId);
  }, [enabled]);

  return { position, denied };
}
