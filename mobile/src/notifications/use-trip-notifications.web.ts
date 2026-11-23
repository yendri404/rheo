import { useCallback, useEffect, useRef, useState } from 'react';
import type { PassengerState } from '../api/types';
import { notifyNow, prepareLocalNotifications } from './local';
import { tripStartedNotice } from './trip-started';

/**
 * Web/PWA: there is no server push, so the app announces a started route itself when the live trip
 * state shows it. This works while the page is alive (open, or recently in the background).
 */
export function useTripStartedNotification(state: PassengerState | null): void {
  const previous = useRef<PassengerState | null>(null);
  useEffect(() => {
    if (!state) return;
    const notice = tripStartedNotice(previous.current, state);
    previous.current = state;
    if (notice) notifyNow(notice.title, notice.body).catch(() => {});
  }, [state]);
}

function currentPermission(): NotificationPermission | 'unsupported' {
  return typeof Notification === 'undefined' ? 'unsupported' : Notification.permission;
}

/** Browsers only ask for notification permission from a tap, so the screen offers a button while undecided. */
export function useNotificationPrompt(): { canAsk: boolean; ask: () => void } {
  const [permission, setPermission] = useState(currentPermission);
  const ask = useCallback(() => {
    prepareLocalNotifications()
      .catch(() => {})
      .finally(() => setPermission(currentPermission()));
  }, []);
  return { canAsk: permission === 'default', ask };
}
