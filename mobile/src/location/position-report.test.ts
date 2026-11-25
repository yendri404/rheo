import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { HEARTBEAT_MS, MIN_REPORT_INTERVAL_MS, shouldReport, shouldStopTracking, toPositionReport } from './position-report.ts';

const coords = (heading: number | null) => ({ latitude: 10.5, longitude: -66.9, heading });

describe('toPositionReport', () => {
  it('keeps a valid heading', () => {
    assert.deepEqual(toPositionReport(coords(90)), { lat: 10.5, lng: -66.9, heading: 90 });
  });

  it('drops the heading when the device does not know it (iOS reports -1)', () => {
    assert.equal(toPositionReport(coords(-1)).heading, null);
    assert.equal(toPositionReport(coords(null)).heading, null);
    assert.equal(toPositionReport(coords(Number.NaN)).heading, null);
  });
});

describe('shouldStopTracking', () => {
  it('stops when there is no trip, no session, or the user is not the driver', () => {
    for (const status of [401, 403, 409]) assert.equal(shouldStopTracking(status), true);
  });

  it('keeps tracking on success and transient failures', () => {
    for (const status of [0, 204, 400, 429, 500, 503]) assert.equal(shouldStopTracking(status), false);
  });
});

describe('shouldReport', () => {
  const T0 = 1_800_000_000_000;
  const here = { lat: 10.5, lng: -66.9 };
  // About 11 m and 5 m north of `here`.
  const moved = { lat: 10.5001, lng: -66.9 };
  const jitter = { lat: 10.500045, lng: -66.9 };
  const last = { ...here, at: T0 };

  it('reports the first position right away', () => {
    assert.equal(shouldReport(null, here, T0), true);
  });

  it('reports a moving driver about every 5 seconds, tolerating GPS fixes that arrive a little early', () => {
    assert.equal(shouldReport(last, moved, T0 + 4_800), true);
    assert.equal(shouldReport(last, moved, T0 + MIN_REPORT_INTERVAL_MS), true);
  });

  it('never reports faster than the minimum interval, however far the driver moved', () => {
    assert.equal(shouldReport(last, moved, T0 + MIN_REPORT_INTERVAL_MS - 1), false);
  });

  it('skips a parked driver between heartbeats, ignoring GPS jitter', () => {
    assert.equal(shouldReport(last, here, T0 + 5_000), false);
    assert.equal(shouldReport(last, jitter, T0 + 9_000), false);
  });

  it('still reports a parked driver every heartbeat, so passengers know the position is current', () => {
    assert.equal(shouldReport(last, here, T0 + HEARTBEAT_MS), true);
    assert.equal(shouldReport(last, jitter, T0 + 60_000), true);
  });
});
