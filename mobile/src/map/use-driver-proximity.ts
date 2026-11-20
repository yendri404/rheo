import { useEffect, useRef, useState } from 'react';
import { notifyNow } from '../notifications/local';
import { distanceMeters, INITIAL_PROXIMITY, nextProximity, type LatLng, type ProximityState } from './proximity';

/**
 * Compares the driver's live position with the passenger's own and reports when the driver is near.
 * Notifies once per trip (see proximity.ts). The rules live in pure functions; this hook only wires
 * them to React and to the platform notification.
 */
export function useDriverProximity(driver: LatLng | null, self: LatLng | null, tripId: string | null) {
  const stateRef = useRef<ProximityState>(INITIAL_PROXIMITY);
  const [near, setNear] = useState(false);
  const distance = driver && self ? distanceMeters(driver, self) : null;

  // A new trip starts from scratch: it may notify again.
  useEffect(() => {
    stateRef.current = INITIAL_PROXIMITY;
    setNear(false);
  }, [tripId]);

  useEffect(() => {
    const { state, notify } = nextProximity(stateRef.current, distance);
    stateRef.current = state;
    setNear(state.near);
    if (notify && distance !== null) {
      notifyNow('El chofer está cerca', `Está a unos ${Math.round(distance)} m. Prepárate para salir.`).catch(() => {});
    }
  }, [distance]);

  return { near, distance };
}
