import assert from 'node:assert/strict';
import { test } from 'node:test';

import { selectedCompany } from './selected-company.ts';

const acme = { id: 'a', name: 'Acme' };
const eureka = { id: 'e', name: 'Eureka' };

test('uses the company the driver picked', () => {
  assert.deepEqual(selectedCompany([acme, eureka], 'e'), eureka);
});

test('starts on the first company before the driver picks one', () => {
  assert.deepEqual(selectedCompany([acme, eureka], null), acme);
});

test('falls back to the first company when the picked one is no longer theirs', () => {
  assert.deepEqual(selectedCompany([acme], 'e'), acme);
});

test('has no company when the driver is not registered in any', () => {
  assert.equal(selectedCompany([], 'e'), null);
});
