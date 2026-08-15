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
 *      and then it is an offer, not an action. The user applies it by tapping
 *      the offer, or by pulling to refresh on screens that have a pull.
 *
 * A reload is never called mid-session without the user asking. Be honest
 * about the boundary of that promise though: expo-updates launches the newest
 * STAGED bundle on the next cold start regardless of any of this —
 * `checkAutomatically` only governs network checks, not what boots. So the
 * offer accelerates an update that would otherwise land at the next process
 * death. What the user is spared is the mid-session teardown, not the update.
 *
 * ── WHY EVERY CALL IS WRAPPED ───────────────────────────────────────────────
 *
 * `Updates.isEnabled` is false in Expo Go and in a dev client, and the module's
 * functions THROW rather than resolve false when the controller is absent.
 * Every path returns quietly instead: an update that cannot be checked for is
 * not an error the user has any part in.
 *
 * NOTE ON CONSUMERS: today only `UpdateOffer` (App root) mounts this hook.
 * `Refresher` is also wired but currently renders NOWHERE — every screen
 * stripped its refreshControl for the RN 0.81 list-blanking bug — so the
 * pull path resumes working the day those come back, and until then the
 * offer's tap is the apply.
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
 * Any number of consumers may mount (UpdateOffer today; every Refresher once
 * refreshControls return). Per-instance state would let each run its own check
 * and its own download of the same bundle. `ready` is lifted to a tiny store so
 * every consumer sees one answer and only one check is ever in flight.
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
  // `last > now` — a stamp in the FUTURE means the device clock was fast when
  // it was written and has since been corrected. Without this, one bad stamp
  // silences every check until real time catches up to it (a clock a year
  // fast = no updates for a year), and nothing would ever rewrite the stamp
  // because the write lives behind this very gate.
  return !Number.isFinite(last) || last > now || now - last >= CHECK_EVERY_MS;
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
    // A published ROLLBACK directive arrives as isAvailable=false with
    // isRollBackToEmbedded=true. It is fetched and applied exactly like an
    // update — dropping it here would make a bad-but-bootable bundle
    // impossible to recall on healthy devices, the ones that matter.
    if (!result.isAvailable && !result.isRollBackToEmbedded) return;

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
    // Re-sync AFTER subscribing: `publish(true)` fires exactly once per
    // process, and a consumer whose render→commit window straddled it would
    // otherwise hold ready=false for its whole life — it initialized from a
    // pre-publish snapshot and the only notification is already gone.
    setReady(staged);
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
