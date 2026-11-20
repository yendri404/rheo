// Pure proximity rules (no React, no platform APIs) so they can be unit-tested with `node --test`.

export type LatLng = { lat: number; lng: number };

/** The driver counts as "near" within this distance: notify once and highlight the map. */
export const NEAR_METERS = 200;
/** Only counts as far again beyond this, so GPS jitter around 200 m does not flicker the border. */
export const FAR_METERS = 250;

const EARTH_RADIUS_METERS = 6_371_008.8;

/** Great-circle (haversine) distance in meters. */
export function distanceMeters(a: LatLng, b: LatLng): number {
  const toRad = (degrees: number) => (degrees * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(h)));
}

export type ProximityState = {
  near: boolean;
  /** Already notified during this trip: never notify twice for the same trip. */
  notified: boolean;
};

export const INITIAL_PROXIMITY: ProximityState = { near: false, notified: false };

/** Advances the proximity state with a new distance (null = unknown, e.g. no GPS fix). */
export function nextProximity(state: ProximityState, distance: number | null): { state: ProximityState; notify: boolean } {
  if (distance === null) return { state: { ...state, near: false }, notify: false };
  const near = state.near ? distance <= FAR_METERS : distance < NEAR_METERS;
  const notify = near && !state.notified;
  const next = { near, notified: state.notified || notify };
  return { state: next.near === state.near && next.notified === state.notified ? state : next, notify };
}
