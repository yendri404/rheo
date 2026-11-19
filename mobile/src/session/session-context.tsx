import * as SecureStore from 'expo-secure-store';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ApiError, authenticatedApi, login, type AuthenticatedApi } from '../api/client';
import type { User } from '../api/types';
import { registerForPushNotifications } from '../notifications/push';

const STORAGE_KEY = 'session';

type Session = { token: string; user: User };

type SessionContextValue = {
  /** undefined while the stored session is being restored. */
  session: Session | null | undefined;
  api: AuthenticatedApi | null;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
};

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null | undefined>(undefined);

  const clear = useCallback(async () => {
    setSession(null);
    await SecureStore.deleteItemAsync(STORAGE_KEY);
  }, []);

  useEffect(() => {
    SecureStore.getItemAsync(STORAGE_KEY)
      .then((stored) => setSession(stored ? (JSON.parse(stored) as Session) : null))
      .catch(() => setSession(null));
  }, []);

  const api = useMemo(() => {
    if (!session) return null;
    const raw = authenticatedApi(session.token);
    // Any 401 means the session is gone (expired or user removed): send the user back to login.
    const guarded = {} as AuthenticatedApi;
    for (const [name, call] of Object.entries(raw) as [keyof AuthenticatedApi, (...args: never[]) => Promise<unknown>][]) {
      (guarded as Record<string, unknown>)[name] = async (...args: never[]) => {
        try {
          return await call(...args);
        } catch (error) {
          if (error instanceof ApiError && error.status === 401) await clear();
          throw error;
        }
      };
    }
    return guarded;
  }, [session, clear]);

  // Validate a restored session and register this device for push notifications.
  useEffect(() => {
    if (!api) return;
    api.me().catch(() => {});
    registerForPushNotifications()
      .then((pushToken) => (pushToken ? api.setPushToken(pushToken) : undefined))
      .catch((error) => console.warn('Push registration failed', error));
  }, [api]);

  const signIn = useCallback(async (email: string, password: string) => {
    const result = await login(email.trim(), password);
    await SecureStore.setItemAsync(STORAGE_KEY, JSON.stringify(result));
    setSession(result);
  }, []);

  const signOut = useCallback(async () => {
    // Stop notifications for this device before forgetting the session.
    await api?.setPushToken(null).catch(() => {});
    await clear();
  }, [api, clear]);

  const value = useMemo(() => ({ session, api, signIn, signOut }), [session, api, signIn, signOut]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession must be used inside SessionProvider');
  return value;
}

/** For screens that only render with a session. */
export function useAuthenticated(): { session: Session; api: AuthenticatedApi; signOut: () => Promise<void> } {
  const { session, api, signOut } = useSession();
  if (!session || !api) throw new Error('useAuthenticated requires a session');
  return { session, api, signOut };
}
