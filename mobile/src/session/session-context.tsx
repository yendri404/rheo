import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ApiError, authenticatedApi, login, type AuthenticatedApi, type AuthResult } from '../api/client';
import type { User } from '../api/types';
import { registerForPushNotifications } from '../notifications/push';
import { secureStorage } from './secure-storage';
import { SESSION_STORAGE_KEY as STORAGE_KEY } from './stored-session';

type Session = { token: string; user: User };

type SessionContextValue = {
  /** undefined while the stored session is being restored. */
  session: Session | null | undefined;
  api: AuthenticatedApi | null;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  /** Re-reads the profile: picks up a new role or a change in the user's companies. */
  refreshUser: () => Promise<void>;
};

const SessionContext = createContext<SessionContextValue | null>(null);

function sameUser(a: User, b: User): boolean {
  return (
    a.id === b.id &&
    a.role === b.role &&
    a.name === b.name &&
    a.address === b.address &&
    a.email === b.email &&
    a.companies.length === b.companies.length &&
    a.companies.every((company, index) => company.id === b.companies[index]!.id && company.name === b.companies[index]!.name)
  );
}

/** Sessions stored before companies existed have no list yet; the profile refresh on start fills it in. */
function restore(stored: string): Session {
  const session = JSON.parse(stored) as Session;
  return { ...session, user: { ...session.user, companies: session.user.companies ?? [] } };
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
      .then((stored) => {
        setSession(stored ? restore(stored) : null);
        // Re-save once so sessions stored before the accessibility change become readable while locked.
        if (stored) secureStorage.set(STORAGE_KEY, stored).catch(() => {});
      })
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

  const refreshUser = useCallback(async () => {
    if (!api || !token) return;
    const user = await api.me().catch(() => null);
    if (!user) return;
    setSession((current) => {
      if (!current || current.token !== token || sameUser(current.user, user)) return current;
      const next = { token, user };
      secureStorage.set(STORAGE_KEY, JSON.stringify(next)).catch(() => {});
      return next;
    });
  }, [api, token]);

  // On every app start: validate the session, pick up profile, role or company changes
  // (a passenger promoted to driver switches screens), and register for push.
  useEffect(() => {
    if (!api || !token) return;
    refreshUser();
    registerForPushNotifications()
      .then((pushToken) => (pushToken ? api.setPushToken(pushToken) : undefined))
      .catch((error) => console.warn('Push registration failed', error));
  }, [api, token, refreshUser]);

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
    () => ({ session, api, signIn, signOut, refreshUser }),
    [session, api, signIn, signOut, refreshUser],
  );
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession must be used inside SessionProvider');
  return value;
}

/** For screens that only render with a session. */
export function useAuthenticated(): {
  session: Session;
  api: AuthenticatedApi;
  signOut: () => Promise<void>;
  refreshUser: () => Promise<void>;
} {
  const { session, api, signOut, refreshUser } = useSession();
  if (!session || !api) throw new Error('useAuthenticated requires a session');
  return { session, api, signOut, refreshUser };
}
