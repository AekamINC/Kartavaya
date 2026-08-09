import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import {
  apiLogin, apiLogout, apiMe, apiSignOutEverywhere, getCachedUser, tokenRestored,
} from '../api/auth';
import { armPurgeClock } from '../offline/cachePurge';
import { resetSyncCursor } from '../offline/sessionSync';
import { queryClient } from '../offline/queryClient';
import { notificationsApi } from '../api/notifications';
import { getDeviceId } from './usePushNotifications';
import type { User } from '../api/types';

interface AuthContextValue {
  user:    User | null;
  loading: boolean;
  login:   (email: string, password: string, remember?: boolean) => Promise<User>;
  logout:  () => Promise<void>;
  /** End every session this person has, on every device — including this one. */
  signOutEverywhere: () => Promise<void>;
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

  const login = useCallback(
    async (email: string, password: string, remember = false): Promise<User> => {
      const u = await apiLogin(email, password, remember);
      // Start the purge clock HERE rather than on first launch: a device that
      // has never purged must not purge on the day it signs in, or it throws
      // away the cache the user just waited to download.
      armPurgeClock();
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
    // The next person to sign in on this device must not inherit a delta cursor
    // pointing at somebody else's last sync — they would receive only what has
    // changed since, and never the rest.
    resetSyncCursor();
  }, []);

  /**
   * The control that makes a year-long "Remember me" token defensible.
   *
   * Everything `logout` does, plus one server call that moves this user's
   * `sessions_valid_from` forward so every token issued before now — on the
   * lost phone, on the shared laptop, in a browser nobody remembers — stops
   * being accepted. Local clean-up runs whether or not that call succeeds:
   * refusing to sign out of THIS device because the network is down would be
   * the wrong answer to "my phone was stolen".
   */
  const signOutEverywhere = useCallback(async () => {
    try {
      await notificationsApi.unregisterToken(getDeviceId());
    } catch {
      // Non-fatal, exactly as in `logout`.
    }
    await apiSignOutEverywhere();
    setUser(null);
    queryClient.clear();
    resetSyncCursor();
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

  const value: AuthContextValue = {
    user, loading, login, logout, signOutEverywhere, refresh,
  };

  return React.createElement(AuthContext.Provider, { value }, children);
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
