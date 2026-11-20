import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { distanceMeters, FAR_METERS, INITIAL_PROXIMITY, NEAR_METERS, nextProximity } from './proximity.ts';

const caracas = { lat: 10.5061, lng: -66.9146 };
/** A point `meters` north of `from` (1 degree of latitude is ~111.32 km). */
const north = (from: { lat: number; lng: number }, meters: number) => ({ lat: from.lat + meters / 111_320, lng: from.lng });

describe('distanceMeters', () => {
  it('is zero for the same point', () => {
    assert.equal(distanceMeters(caracas, caracas), 0);
  });

  it('measures short distances within a meter', () => {
    assert.ok(Math.abs(distanceMeters(caracas, north(caracas, 200)) - 200) < 1);
    assert.ok(Math.abs(distanceMeters(caracas, north(caracas, 1000)) - 1000) < 2);
  });

  it('is symmetric', () => {
    const other = { lat: 10.49, lng: -66.88 };
    assert.equal(distanceMeters(caracas, other), distanceMeters(other, caracas));
  });
});

describe('nextProximity', () => {
  it('becomes near and asks to notify when the driver gets within 200 m', () => {
    const result = nextProximity(INITIAL_PROXIMITY, NEAR_METERS - 1);
    assert.deepEqual(result, { state: { near: true, notified: true }, notify: true });
  });

  it('stays far beyond 200 m', () => {
    assert.deepEqual(nextProximity(INITIAL_PROXIMITY, NEAR_METERS + 1), { state: INITIAL_PROXIMITY, notify: false });
  });

  it('notifies only once per trip, even if the driver leaves and comes back', () => {
    let state = INITIAL_PROXIMITY;
    const notifications: boolean[] = [];
    for (const distance of [500, 150, 400, 120, 600, 90]) {
      const result = nextProximity(state, distance);
      state = result.state;
      notifications.push(result.notify);
    }
    assert.deepEqual(notifications, [false, true, false, false, false, false]);
  });

  it('uses a margin so GPS jitter around 200 m does not make the border flicker', () => {
    let state = nextProximity(INITIAL_PROXIMITY, 190).state;
    for (const distance of [205, 215, 230, FAR_METERS]) {
      state = nextProximity(state, distance).state;
      assert.equal(state.near, true, `still near at ${distance} m`);
    }
    state = nextProximity(state, FAR_METERS + 1).state;
    assert.equal(state.near, false);
  });

  it('treats an unknown distance as far without notifying', () => {
    const near = nextProximity(INITIAL_PROXIMITY, 100).state;
    assert.deepEqual(nextProximity(near, null), { state: { near: false, notified: true }, notify: false });
  });
});
