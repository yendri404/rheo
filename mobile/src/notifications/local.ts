import * as Notifications from 'expo-notifications';

/** Native: permission is already requested at login (see push.ts), so nothing to do here. */
export async function prepareLocalNotifications(): Promise<void> {}

/** Shows a notification right away from the device itself (no server involved). */
export async function notifyNow(title: string, body: string): Promise<void> {
  await Notifications.scheduleNotificationAsync({ content: { title, body, sound: 'default' }, trigger: null });
}
