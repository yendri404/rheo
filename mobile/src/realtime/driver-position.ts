// Pure rules for the passenger's view of the driver (no React, no platform APIs), unit-tested with `node --test`.

/**
 * The driver's phone reports at least every 10 s, even when parked (see location/position-report.ts).
 * Three missed reports in a row mean the position on screen can no longer be trusted.
 */
export const STALE_AFTER_MS = 30_000;

/** With reports every 10 s at most, this much silence on an open socket means it died without closing. */
export const SILENT_SOCKET_MS = 45_000;

/**
 * When the position was true, on THIS phone's clock. The server says how old the position was when
 * it sent it (`ageMs`), so the answer never depends on the phone and the server agreeing on the time.
 * Servers that do not send an age only relay fresh positions, hence the 0.
 */
export function measuredAt(ageMs: unknown, now: number): number {
  const age = typeof ageMs === 'number' && Number.isFinite(ageMs) && ageMs > 0 ? ageMs : 0;
  return now - age;
}

export function isStale(measured: number, now: number): boolean {
  return now - measured > STALE_AFTER_MS;
}
