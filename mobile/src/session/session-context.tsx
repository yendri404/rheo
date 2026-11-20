import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ApiError, authenticatedApi, login, type AuthenticatedApi, type AuthResult } from '../api/client';
import type { User } from '../api/types';
import { registerForPushNotifications } from '../notifications/push';
import { secureStorage } from './secure-storage';

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

function sameUser(a: User, b: User): boolean {
  return a.id === b.id && a.role === b.role && a.name === b.name && a.address === b.address && a.email === b.email;
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const token = session?.token;

  const persist = useCallback(async (next: AuthResult) => {
    await secureStorage.set(STORAGE_KEY, JSON.stringify(next));
    setSession(next);
  }, []);

  const clear = useCallback(async () => {
    setSession(null);
    await secureStorage.remove(STORAGE_KEY);
  }, []);

  useEffect(() => {
    secureStorage
      .get(STORAGE_KEY)
      .then((stored) => setSession(stored ? (JSON.parse(stored) as Session) : null))
      .catch(() => setSession(null));
  }, []);

  // Keyed on the token only, so refreshing the user profile does not reconnect everything.
  const api = useMemo(() => {
    if (!token) return null;
    const raw = authenticatedApi(token);
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
  }, [token, clear]);

  // On every app start: validate the session, pick up profile or role changes
  // (a passenger promoted to driver switches screens), and register for push.
  useEffect(() => {
    if (!api || !token) return;
    api
      .me()
      .then((user) => {
        setSession((current) => {
          if (!current || current.token !== token || sameUser(current.user, user)) return current;
          const next = { token, user };
          secureStorage.set(STORAGE_KEY, JSON.stringify(next)).catch(() => {});
          return next;
        });
      })
      .catch(() => {});
    registerForPushNotifications()
      .then((pushToken) => (pushToken ? api.setPushToken(pushToken) : undefined))
      .catch((error) => console.warn('Push registration failed', error));
  }, [api, token]);

  const signIn = useCallback(
    async (email: string, password: string) => persist(await login(email.trim(), password)),
    [persist],
  );

  const signOut = useCallback(async () => {
    // Stop notifications for this device before forgetting the session.
    await api?.setPushToken(null).catch(() => {});
    await clear();
  }, [api, clear]);

  const value = useMemo(
    () => ({ session, api, signIn, signOut }),
    [session, api, signIn, signOut],
  );
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
