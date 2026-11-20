import { secureStorage } from './secure-storage';

export const SESSION_STORAGE_KEY = 'session';

/** For code running outside React (the background location task), which cannot use the session context. */
export async function readStoredToken(): Promise<string | null> {
  const stored = await secureStorage.get(SESSION_STORAGE_KEY);
  if (!stored) return null;
  try {
    return (JSON.parse(stored) as { token?: string }).token ?? null;
  } catch {
    return null;
  }
}
