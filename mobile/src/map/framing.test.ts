import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CLOSE_UP_ZOOM, DRIVER_ZOOM, framingFor } from './framing.ts';

const driver = { lat: 10.5061, lng: -66.9146 };
/** A point `meters` north-east of `from` (1 degree of latitude is ~111.32 km; Caracas is near the equator). */
const away = (meters: number) => ({ lat: driver.lat + meters / 111_320, lng: driver.lng + meters / 111_320 });

describe('framingFor', () => {
  it('centers on the driver when the passenger position is unknown', () => {
    assert.deepEqual(framingFor(driver, null), { center: [driver.lng, driver.lat], zoom: DRIVER_ZOOM });
  });

  it('fits both markers as [west, south, east, north] when they are apart', () => {
    const self = away(500);
    assert.deepEqual(framingFor(driver, self), { bounds: [driver.lng, driver.lat, self.lng, self.lat] });
  });

  it('orders the bounds correctly whichever side the passenger is on', () => {
    const self = { lat: driver.lat - 0.01, lng: driver.lng - 0.01 };
    assert.deepEqual(framingFor(driver, self), { bounds: [self.lng, self.lat, driver.lng, driver.lat] });
  });

  it('does not zoom in past street level when both are a few meters apart', () => {
    const self = away(10);
    assert.deepEqual(framingFor(driver, self), {
      center: [(driver.lng + self.lng) / 2, (driver.lat + self.lat) / 2],
      zoom: CLOSE_UP_ZOOM,
    });
  });
});
