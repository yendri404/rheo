import assert from 'node:assert/strict';
import { test } from 'node:test';

import { tripStartedNotice } from './trip-started.ts';

const idle = { activeTrip: null };
const started = { activeTrip: { id: 't1', route: { name: 'Norte' } } };

test('announces a route that starts while the app is watching', () => {
  assert.deepEqual(tripStartedNotice(idle, started), {
    title: 'Ruta Norte iniciada',
    body: 'El chofer comenzó la ruta. Abre la app si vas a usar el transporte.',
  });
});

test('stays quiet when the first snapshot already has a route in progress', () => {
  assert.equal(tripStartedNotice(null, started), null);
});

test('stays quiet while the same route goes on', () => {
  assert.equal(tripStartedNotice(started, { activeTrip: { id: 't1', route: { name: 'Norte' } } }), null);
});

test('announces the next route when one ends and another starts', () => {
  assert.deepEqual(tripStartedNotice(started, { activeTrip: { id: 't2', route: { name: 'Sur' } } })?.title, 'Ruta Sur iniciada');
});

test('stays quiet when a route ends or nothing is running', () => {
  assert.equal(tripStartedNotice(started, idle), null);
  assert.equal(tripStartedNotice(idle, idle), null);
});
