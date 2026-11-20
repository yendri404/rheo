import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { shouldStopTracking, toPositionReport } from './position-report.ts';

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
