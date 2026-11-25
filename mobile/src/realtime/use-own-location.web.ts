import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
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
    const onPosition = ({ coords }: GeolocationPosition) => {
      setDenied(false);
      setPosition({ lat: coords.latitude, lng: coords.longitude });
    };
    const onError = (error: GeolocationPositionError) => {
      if (error.code === error.PERMISSION_DENIED) setDenied(true);
    };
    const watchId = navigator.geolocation.watchPosition(onPosition, onError, { enableHighAccuracy: true, maximumAge: 5_000 });
    // Browsers pause the watch in the background and may take a while to resume it. Ask for a
    // fresh fix as soon as the PWA is back on screen, instead of showing where the passenger was.
    const subscription = AppState.addEventListener('change', (status) => {
      if (status === 'active') {
        navigator.geolocation.getCurrentPosition(onPosition, onError, { enableHighAccuracy: true, maximumAge: 0, timeout: 15_000 });
      }
    });
    return () => {
      navigator.geolocation.clearWatch(watchId);
      subscription.remove();
    };
  }, [enabled]);

  return { position, denied };
}
