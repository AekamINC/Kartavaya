/**
 * useAppUpdate — an update that waits for the user instead of ambushing them.
 *
 * ── WHAT WAS WRONG ──────────────────────────────────────────────────────────
 *
 * `app.json` shipped `checkAutomatically: "ON_LOAD"`, which prebuild compiles to
 * `EXPO_UPDATES_CHECK_ON_LAUNCH=ALWAYS`. Every single cold start therefore made
 * a blocking round-trip to `u.expo.dev` before the first screen could be
 * trusted, on a phone, in India, on whatever signal the user happened to have.
 * That is the "it keeps updating all the time and it's slow" the owner reported
 * on 2026-08-15 — not a bug in the update itself but in WHEN it is asked for.
 *
 * ── THE RULE NOW ────────────────────────────────────────────────────────────
 *
 * Owner's decision, 2026-08-15: "I need app where it doesnt update everytime u
 * in the app. but get sync on background and top it ask user to pull down to
 * refresh updates available."
 *
 * So, in order:
 *
 *   1. Launch NEVER waits. `checkAutomatically` is `ON_ERROR_RECOVERY` — the
 *      only check at boot is the one that rescues a bundle which failed to load.
 *   2. The check runs in the BACKGROUND, on foreground, and no more than once
 *      every `CHECK_EVERY_MS`. The throttle is persisted, so quitting and
 *      reopening the app six times in a minute is still one check.
 *   3. The download also runs in the background. Nothing on screen moves.
 *   4. Only when a new bundle is downloaded and staged does anything appear —
 *      and then it is an offer, not an action. The user applies it by pulling
 *      down, which is the gesture they already use to refresh.
 *
 * A reload is never called for the user. `reloadAsync()` tears down JS mid-
 * session; doing that because a timer fired is how you lose a half-typed
 * message. The pull IS the consent.
 *
 * ── WHY EVERY CALL IS WRAPPED ───────────────────────────────────────────────
 *
 * `Updates.isEnabled` is false in Expo Go and in a dev client, and the module's
 * functions THROW rather than resolve false when the controller is absent. This
 * hook is mounted by `Refresher`, which is on twelve screens, so an unguarded
 * throw here is an unhandled rejection on most of the app. Every path returns
 * quietly instead: an update that cannot be checked for is not an error the user
 * has any part in.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import * as Updates from 'expo-updates';
import { storage } from '../lib/storage';

/** At most one check per hour, however many times the app is opened. */
const CHECK_EVERY_MS = 60 * 60 * 1000;

/** Persisted so the throttle survives the process, which is the point of it. */
const LAST_CHECK_KEY = 'ota_last_check_at';

export interface AppUpdate {
  /** A new bundle is downloaded and staged. Show the offer. */
  ready: boolean;
  /** Apply it — reloads into the new bundle. Safe to call when nothing is ready. */
  apply: () => Promise<void>;
}

/**
 * Module-level, not per-hook.
 *
 * Twelve screens mount a `Refresher`, and a tab switch can have two alive at
 * once. Per-instance state would let each of them run its own check and its own
 * download of the same bundle. `ready` is lifted to a tiny store so every
 * consumer sees one answer and only one check is ever in flight.
 */
let staged = false;
let inFlight = false;
const listeners = new Set<(v: boolean) => void>();

function publish(v: boolean) {
  staged = v;
  for (const fn of listeners) fn(v);
}

function due(now: number): boolean {
  const last = Number(storage.getString(LAST_CHECK_KEY) ?? 0);
  return !Number.isFinite(last) || now - last >= CHECK_EVERY_MS;
}

async function checkInBackground(): Promise<void> {
  if (inFlight || staged) return;
  // `isEnabled` is false in a dev client and in Expo Go. Nothing below is
  // meaningful there and `checkForUpdateAsync` would throw.
  if (!Updates.isEnabled) return;

  const now = Date.now();
  if (!due(now)) return;

  inFlight = true;
  try {
    // Stamped BEFORE the request, not after. A check that times out on bad
    // signal must still count against the throttle, or a user with no
    // connectivity retries every foreground — the exact behaviour being fixed.
    storage.set(LAST_CHECK_KEY, String(now));

    const result = await Updates.checkForUpdateAsync();
    if (!result.isAvailable) return;

    await Updates.fetchUpdateAsync();
    publish(true);
  } catch {
    // Offline, a 404 on the manifest, no channel configured — all of them mean
    // "no update today", none of them mean anything to the person holding the
    // phone.
  } finally {
    inFlight = false;
  }
}

export function useAppUpdate(): AppUpdate {
  const [ready, setReady] = useState(staged);
  const appState = useRef<AppStateStatus>(AppState.currentState);

  useEffect(() => {
    listeners.add(setReady);
    return () => { listeners.delete(setReady); };
  }, []);

  useEffect(() => {
    // Fire and forget on mount, and again on each genuine foreground. The
    // throttle inside is what makes both of these cheap.
    void checkInBackground();

    const sub = AppState.addEventListener('change', next => {
      const cameForward = !!appState.current.match(/inactive|background/) && next === 'active';
      appState.current = next;
      if (cameForward) void checkInBackground();
    });
    return () => sub.remove();
  }, []);

  const apply = useCallback(async () => {
    if (!staged || !Updates.isEnabled) return;
    try {
      await Updates.reloadAsync();
    } catch {
      // The reload failed, so the staged bundle is still staged. Leave the
      // offer up rather than clearing it — the next pull can try again.
    }
  }, []);

  return { ready, apply };
}
