import assert from 'node:assert/strict';
import { test } from 'node:test';

import { normalizeApiUrl } from './normalize-api-url.ts';

test('adds http:// to a bare LAN address', () => {
  assert.equal(normalizeApiUrl('192.168.1.20:3000'), 'http://192.168.1.20:3000');
  assert.equal(normalizeApiUrl('  mi-pc.local:3000  '), 'http://mi-pc.local:3000');
});

test('keeps the scheme that was typed and drops trailing slashes', () => {
  assert.equal(normalizeApiUrl('https://api.example.com/'), 'https://api.example.com');
  assert.equal(normalizeApiUrl('HTTP://10.0.0.5:3000//'), 'http://10.0.0.5:3000');
});

test('keeps a path prefix', () => {
  assert.equal(normalizeApiUrl('https://example.com/rheo/api/'), 'https://example.com/rheo/api');
});

test('rejects empty input and anything that is not an http(s) address', () => {
  for (const input of ['', '   ', 'ftp://host', 'ws://host:3000', 'http://', 'not a url', 'http://host?x=1', 'http://user:pw@host']) {
    assert.equal(normalizeApiUrl(input), null, input);
  }
});
