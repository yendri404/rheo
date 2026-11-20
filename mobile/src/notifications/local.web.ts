/**
 * Web version: the browser Notification API. Browsers only allow asking for permission from a user
 * gesture, so call prepareLocalNotifications() from a tap (e.g. "Usaré el transporte").
 */
export async function prepareLocalNotifications(): Promise<void> {
  if (typeof Notification === 'undefined' || Notification.permission !== 'default') return;
  await Notification.requestPermission().catch(() => 'denied');
}

export async function notifyNow(title: string, body: string): Promise<void> {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  new Notification(title, { body, icon: '/favicon.ico' });
}
