import type { PassengerState } from '../api/types';

/**
 * Native: the server push (backend expo-push-notifier) announces started routes, even with the app closed,
 * and permission is requested at login (see push.ts). Nothing to do here; see the .web.ts version.
 */
export function useTripStartedNotification(_state: PassengerState | null): void {}

export function useNotificationPrompt(): { canAsk: boolean; ask: () => void } {
  return { canAsk: false, ask: () => {} };
}
