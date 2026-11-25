import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isStale, measuredAt, STALE_AFTER_MS } from './driver-position.ts';

const NOW = 1_800_000_000_000;

describe('measuredAt', () => {
  it('uses the age the server reports, whatever the server clock says', () => {
    assert.equal(measuredAt(4_000, NOW), NOW - 4_000);
  });

  it('treats a position without a usable age as fresh', () => {
    for (const age of [undefined, null, 'x', Number.NaN, -5]) assert.equal(measuredAt(age, NOW), NOW);
  });
});

describe('isStale', () => {
  it('is fresh while the driver keeps reporting, including the slowest heartbeat plus one lost report', () => {
    assert.equal(isStale(NOW, NOW + 10_000), false);
    assert.equal(isStale(NOW, NOW + 20_000), false);
    assert.equal(isStale(NOW, NOW + STALE_AFTER_MS), false);
  });

  it('is stale once three reports in a row are missing', () => {
    assert.equal(isStale(NOW, NOW + STALE_AFTER_MS + 1), true);
  });

  it('marks an old position stale as soon as it arrives', () => {
    assert.equal(isStale(measuredAt(60_000, NOW), NOW), true);
  });
});
