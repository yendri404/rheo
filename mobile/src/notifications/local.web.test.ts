import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import { notifyNow } from './local.web.ts';

type Shown = { title: string; options: NotificationOptions };

const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');

function installNotification(permission: NotificationPermission, constructed: Shown[], throws = false) {
  const FakeNotification = function (this: unknown, title: string, options: NotificationOptions) {
    if (throws) throw new TypeError("Failed to construct 'Notification': Illegal constructor.");
    constructed.push({ title, options });
  } as unknown as typeof Notification;
  Object.defineProperty(FakeNotification, 'permission', { value: permission });
  Object.defineProperty(globalThis, 'Notification', { value: FakeNotification, configurable: true });
}

function installServiceWorker(registration: { showNotification: (t: string, o: NotificationOptions) => Promise<void> } | undefined) {
  Object.defineProperty(globalThis, 'navigator', {
    value: { serviceWorker: { getRegistration: async () => registration } },
    configurable: true,
  });
}

afterEach(() => {
  delete (globalThis as { Notification?: unknown }).Notification;
  if (originalNavigator) Object.defineProperty(globalThis, 'navigator', originalNavigator);
});

test('shows the notification through the service worker registration (required on Android Chrome)', async () => {
  const constructed: Shown[] = [];
  const shown: Shown[] = [];
  installNotification('granted', constructed, true);
  installServiceWorker({ showNotification: async (title, options) => void shown.push({ title, options }) });

  await notifyNow('Ruta iniciada', 'El chofer va en camino');

  assert.deepEqual(shown, [{ title: 'Ruta iniciada', options: { body: 'El chofer va en camino', icon: '/icon-192.png' } }]);
  assert.deepEqual(constructed, []);
});

test('falls back to the Notification constructor when no service worker is registered', async () => {
  const constructed: Shown[] = [];
  installNotification('granted', constructed);
  installServiceWorker(undefined);

  await notifyNow('Ruta iniciada', 'El chofer va en camino');

  assert.deepEqual(constructed, [{ title: 'Ruta iniciada', options: { body: 'El chofer va en camino', icon: '/icon-192.png' } }]);
});

test('never rejects when the browser refuses to show the notification', async () => {
  installNotification('granted', [], true);
  installServiceWorker(undefined);

  await assert.doesNotReject(notifyNow('Ruta iniciada', 'El chofer va en camino'));
});

test('shows nothing without notification permission', async () => {
  const constructed: Shown[] = [];
  const shown: Shown[] = [];
  installNotification('denied', constructed);
  installServiceWorker({ showNotification: async (title, options) => void shown.push({ title, options }) });

  await notifyNow('Ruta iniciada', 'El chofer va en camino');

  assert.deepEqual(shown, []);
  assert.deepEqual(constructed, []);
});
