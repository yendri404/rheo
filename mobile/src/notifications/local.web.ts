/**
 * Web version: the browser Notification API. Browsers only allow asking for permission from a user
 * gesture, so call prepareLocalNotifications() from a tap (e.g. "Usaré el transporte").
 */
export async function prepareLocalNotifications(): Promise<void> {
  if (typeof Notification === 'undefined' || Notification.permission !== 'default') return;
  await Notification.requestPermission().catch(() => 'denied');
}

/**
 * Shows through the service worker registration when there is one: Android Chrome (and installed PWAs)
 * throw "Illegal constructor" for `new Notification()`. The constructor is only a fallback for desktop
 * pages without a service worker. A notification the browser refuses is dropped, never thrown.
 */
export async function notifyNow(title: string, body: string): Promise<void> {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  // `badge` is the small monochrome symbol Android shows in the status bar; without it Chrome uses its own bell.
  const options: NotificationOptions = { body, icon: '/icon-192.png', badge: '/badge-96.png' };
  try {
    const registration = await navigator.serviceWorker?.getRegistration();
    if (registration) {
      await registration.showNotification(title, options);
      return;
    }
    new Notification(title, options);
  } catch {
    // The browser refused to show it; a missed local notification must not break the screen.
  }
}
