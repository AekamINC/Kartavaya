/**
 * crashRecorder — the crash log that installs before anything can crash.
 *
 * This module is imported as THE FIRST LINE of `mobile/index.js`, ahead of
 * App.tsx and its ~25-module import chain. The first version of this code
 * lived inside `components/CrashGuard.tsx`, which Metro reaches last — after
 * the theme, the API layer, MMKV and every screen have already run their
 * top-level code. An import-time throw in any of them (the react-native-mmkv
 * "stuck at logo" class this repo has already lived through) died unrecorded,
 * in the one window the recorder existed to cover.
 *
 * Two rules keep this installable that early:
 *
 *   1. NOTHING is imported at module scope except types. `storage` (MMKV) is
 *      require()d lazily inside each function, so a broken native module can
 *      fail INSIDE record()'s try/catch instead of preventing the install.
 *   2. No React. The visible boundary stays in `components/CrashGuard.tsx`;
 *      this file only ever writes and reads the record.
 *
 * ── WHAT IS ACTUALLY CAUGHT ─────────────────────────────────────────────────
 *
 *   'render'   — a throw during React render, written by the CrashGuard
 *                boundary. The UI resets; the process survives.
 *   'global'   — a FATAL JS error outside render (event handler, timer
 *                callback). The previous handler then kills the process, so
 *                this record is read back on the next launch. Non-fatal
 *                invocations are deliberately NOT recorded: RN routes benign
 *                errors through the same handler, and a single-slot log that
 *                lets a warning overwrite a real crash is worse than no log.
 *   'promise'  — an unhandled promise rejection. These NEVER reach
 *                ErrorUtils: Hermes only installs its rejection tracker in
 *                dev (a console.warn), and in release a floating rejection
 *                simply vanishes. The tracker below is what makes this class
 *                visible at all.
 */

const CRASH_KEY = 'last_crash';

export interface CrashRecord {
  message: string;
  stack: string;
  /** ISO. Absolute, because "2 hours ago" is useless in a report sent tomorrow. */
  at: string;
  /** 'render' — caught by the boundary. 'global' — fatal, killed the process.
   *  'promise' — an unhandled rejection (process survived). */
  origin: 'render' | 'global' | 'promise';
}

/** Lazy: a broken MMKV import must fail in here, not at install time. */
function getStorage(): { set: (k: string, v: string) => void; getString: (k: string) => string | undefined; delete: (k: string) => void } | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('./storage').storage;
  } catch {
    return null;
  }
}

export function record(err: unknown, origin: CrashRecord['origin']): void {
  try {
    const e = err as Error | undefined;
    const entry: CrashRecord = {
      message: String(e?.message ?? err ?? 'unknown'),
      // Bounded: a stack can run to tens of kilobytes and this is written on a
      // path that is already failing. The top names the cause anyway.
      stack:   String(e?.stack ?? '').slice(0, 4000),
      at:      new Date().toISOString(),
      origin,
    };
    getStorage()?.set(CRASH_KEY, JSON.stringify(entry));
  } catch {
    // Writing the crash must never be the thing that crashes.
  }
}

/** The last recorded crash, or null. Read it, then `clearLastCrash()`. */
export function getLastCrash(): CrashRecord | null {
  try {
    const raw = getStorage()?.getString(CRASH_KEY);
    return raw ? (JSON.parse(raw) as CrashRecord) : null;
  } catch {
    return null;
  }
}

export function clearLastCrash(): void {
  try { getStorage()?.delete(CRASH_KEY); } catch { /* nothing useful to do */ }
}

/* ── Install, at module evaluation ─────────────────────────────────────────── */

declare const ErrorUtils: {
  getGlobalHandler(): (e: unknown, isFatal?: boolean) => void;
  setGlobalHandler(fn: (e: unknown, isFatal?: boolean) => void): void;
} | undefined;

if (typeof ErrorUtils !== 'undefined' && ErrorUtils) {
  const previous = ErrorUtils.getGlobalHandler();
  ErrorUtils.setGlobalHandler((e, isFatal) => {
    // Fatal and unknown-fatality only — see the header. The default handler
    // is CALLED, never replaced: swallowing a fatal would leave the app
    // running on broken state, which is worse than the crash.
    if (isFatal !== false) record(e, 'global');
    previous?.(e, isFatal);
  });
}

// Hermes ships its own Promise and only wires rejection tracking in dev. In a
// release build this is the only listener an unhandled rejection ever gets.
// In dev, RN's own setup may replace this with the LogBox warner afterwards —
// which is fine: dev has an on-screen warning, release has this record.
try {
  const hermes = (globalThis as { HermesInternal?: { hasPromise?: () => boolean; enablePromiseRejectionTracker?: (opts: unknown) => void } }).HermesInternal;
  if (hermes?.hasPromise?.() && hermes.enablePromiseRejectionTracker) {
    hermes.enablePromiseRejectionTracker({
      allRejections: true,
      onUnhandled: (_id: number, err: unknown) => record(err, 'promise'),
      onHandled: () => { /* a late catch retracts the complaint; the record stays, honestly */ },
    });
  }
} catch {
  // A Hermes internals change must never take the launch down.
}
