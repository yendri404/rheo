import { secureStorage } from '../session/secure-storage';
import { normalizeApiUrl } from './normalize-api-url';

/**
 * Internal test builds only (EXPO_PUBLIC_DEBUG_API=true): the API address can be changed from
 * inside the app. Regular builds always use the address baked in at build time.
 */
export const DEBUG_API = process.env.EXPO_PUBLIC_DEBUG_API === 'true';

/** Set EXPO_PUBLIC_API_URL to your machine's LAN IP when testing on a physical phone. */
export const DEFAULT_API_URL = (process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000').replace(/\/$/, '');

const STORAGE_KEY = 'debug-api-url';

let current = DEFAULT_API_URL;
let loading: Promise<void> | undefined;

/** Base URL every request goes to. Call `loadApiUrl()` first so a stored override is in place. */
export function apiUrl(): string {
  return current;
}

/** WebSocket address for a path such as `/ws`. */
export function wsUrl(path: string): string {
  return `${current.replace(/^http/, 'ws')}${path}`;
}

/**
 * Applies the address a tester saved earlier. Must finish before the first request, both when the
 * app starts and in the background location task (which the OS can launch without any screen).
 */
export function loadApiUrl(): Promise<void> {
  if (!DEBUG_API) return Promise.resolve();
  loading ??= secureStorage
    .get(STORAGE_KEY)
    .then((stored) => {
      const url = stored ? normalizeApiUrl(stored) : null;
      if (url) current = url;
    })
    .catch(() => {});
  return loading;
}

/** Switches to another API and remembers it; null goes back to the built-in address. */
export async function saveApiUrl(url: string | null): Promise<void> {
  current = url ?? DEFAULT_API_URL;
  if (url) await secureStorage.set(STORAGE_KEY, url);
  else await secureStorage.remove(STORAGE_KEY);
}
