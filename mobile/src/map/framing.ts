import { distanceMeters, type LatLng } from './proximity.ts';

/** Zoom used when only the driver is on the map. */
export const DRIVER_ZOOM = 15;
/** Street level: used instead of fitting bounds when driver and passenger are almost together. */
export const CLOSE_UP_ZOOM = 17;
/** Below this distance, fitting bounds would zoom in absurdly far, so we center at CLOSE_UP_ZOOM. */
const CLOSE_UP_METERS = 120;

type LngLat = [lng: number, lat: number];
export type Framing = { center: LngLat; zoom: number } | { bounds: [west: number, south: number, east: number, north: number] };

/**
 * Camera that keeps both the driver and the passenger in view (zooming in as the driver gets
 * closer). With no passenger position, it simply centers on the driver. Pure, so native maps
 * (whose fitBounds has no maxZoom) get the same framing rules as the web map.
 */
export function framingFor(driver: LatLng, self: LatLng | null): Framing {
  if (!self) return { center: [driver.lng, driver.lat], zoom: DRIVER_ZOOM };
  if (distanceMeters(driver, self) < CLOSE_UP_METERS) {
    return { center: [(driver.lng + self.lng) / 2, (driver.lat + self.lat) / 2], zoom: CLOSE_UP_ZOOM };
  }
  return {
    bounds: [
      Math.min(driver.lng, self.lng),
      Math.min(driver.lat, self.lat),
      Math.max(driver.lng, self.lng),
      Math.max(driver.lat, self.lat),
    ],
  };
}
