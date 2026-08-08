import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { apiLogin, apiLogout, apiMe, getCachedUser, tokenRestored } from '../api/auth';
import { queryClient } from '../offline/queryClient';
import { notificationsApi } from '../api/notifications';
import { getDeviceId } from './usePushNotifications';
import type { User } from '../api/types';

interface AuthContextValue {
  user:    User | null;
  loading: boolean;
  login:   (email: string, password: string) => Promise<User>;
  logout:  () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser]       = useState<User | null>(getCachedUser);
  const [loading, setLoading] = useState(true);

  // On mount: verify session against server
  useEffect(() => {
    (async () => {
      try {
        // WAIT for the stored token to reach the axios client before asking who
        // we are. Without this the request raced SecureStore, went out with no
        // Authorization header, and a signed-in user was shown the login
        // screen — only on release builds, because __DEV__ set the header
        // synchronously and hid the race. See `tokenRestored` in api/auth.ts.
        await tokenRestored;
        const u = await apiMe();
        setUser(u);
      } catch (err) {
        // ONLY a 401 means signed out. This used to catch everything, so a
        // timeout on a slow train, a 500, or a DNS failure all logged the user
        // out of the UI while their token remained valid. A network fault is
        // not a credential fault: keep the cached user and let the screens fall
        // back to cached data, which is what the offline layer is for.
        const status = (err as { response?: { status?: number } })?.response?.status;
        if (status === 401 || status === 403) {
          setUser(null);
        }
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const login = useCallback(async (email: string, password: string): Promise<User> => {
    const u = await apiLogin(email, password);
    setUser(u);
    return u;
  }, []);

  const logout = useCallback(async () => {
    // Deregister push token before credentials are cleared
    try {
      await notificationsApi.unregisterToken(getDeviceId());
    } catch {
      // Non-fatal — proceed with logout regardless
    }
    await apiLogout();
    setUser(null);
    queryClient.clear();
  }, []);

  const refresh = useCallback(async () => {
    try {
      const u = await apiMe();
      setUser(u);
    } catch (err) {
      // Same rule as on mount: only a rejected credential signs anyone out.
      // This one is worse than the mount case if got wrong — `refresh` is
      // called from screens while the app is in use, so a single dropped
      // request would throw a working user back to the login screen mid-task.
      const status = (err as { response?: { status?: number } })?.response?.status;
      if (status === 401 || status === 403) {
        setUser(null);
      }
    }
  }, []);

  const value: AuthContextValue = { user, loading, login, logout, refresh };

  return React.createElement(AuthContext.Provider, { value }, children);
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
