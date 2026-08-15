/**
 * CrashGuard — the app had no way to tell anyone why it died.
 *
 * A grep across `src/` for `componentDidCatch`, `ErrorBoundary`,
 * `getDerivedStateFromError`, Sentry and Crashlytics returned NOTHING before
 * this file. So a render-time throw anywhere in the tree unmounted the whole
 * app, and an unhandled exception on a timer or a floating promise took the
 * PROCESS down — which on Android is indistinguishable, from the user's side,
 * from the launcher reappearing. That is the "it goes back to home screen every
 * 1 min or so" reported on 2026-08-15, and it was unfixable by construction: no
 * message was written down anywhere, on the device or off it.
 *
 * This does not stop crashes. It makes them SAY something.
 *
 * ── TWO DIFFERENT FAILURES, BOTH CAUGHT ─────────────────────────────────────
 *
 *   1. A throw during render — React hands it to `componentDidCatch`, and the
 *      boundary swaps in the panel below. The app stays alive and the user can
 *      carry on, which for a single bad screen is the difference between "one
 *      screen is broken" and "the app is broken".
 *
 *   2. A throw OUTSIDE render — a `setInterval` callback, an unawaited promise.
 *      React never sees these, and in a release bundle RN's default handler
 *      kills the process. `ErrorUtils.setGlobalHandler` gets there first and
 *      writes the record before handing back to the default, so the crash
 *      survives the process that caused it.
 *
 * Either way the last one is persisted to MMKV under `last_crash` and shown on
 * next launch, so a crash that happened on a user's phone in the field can be
 * read back off it rather than reproduced.
 *
 * ── WHY THE PANEL IS UNSTYLED ───────────────────────────────────────────────
 *
 * No `useTheme`, no tokens, no fonts — literal colours only. This has to render
 * when the thing that broke IS the theme provider or the font loader. A
 * boundary that depends on the tree it is guarding is a boundary that fails
 * exactly when it is needed.
 */
import React from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { storage } from '../lib/storage';

const CRASH_KEY = 'last_crash';

export interface CrashRecord {
  message: string;
  stack: string;
  /** ISO. Absolute, because "2 hours ago" is useless in a report sent tomorrow. */
  at: string;
  /** 'render' — React caught it. 'global' — it killed the process. */
  origin: 'render' | 'global';
}

function record(err: unknown, origin: CrashRecord['origin']): void {
  try {
    const e = err as Error | undefined;
    const entry: CrashRecord = {
      message: String(e?.message ?? err ?? 'unknown'),
      // Bounded: a stack can run to tens of kilobytes and this is written on a
      // path that is already failing. The top of a stack is the part that names
      // the cause anyway.
      stack:   String(e?.stack ?? '').slice(0, 4000),
      at:      new Date().toISOString(),
      origin,
    };
    storage.set(CRASH_KEY, JSON.stringify(entry));
  } catch {
    // Writing the crash must never be the thing that crashes.
  }
}

/** The last recorded crash, or null. Read it, then `clearLastCrash()`. */
export function getLastCrash(): CrashRecord | null {
  try {
    const raw = storage.getString(CRASH_KEY);
    return raw ? (JSON.parse(raw) as CrashRecord) : null;
  } catch {
    return null;
  }
}

export function clearLastCrash(): void {
  try { storage.delete(CRASH_KEY); } catch { /* nothing useful to do */ }
}

/**
 * Installed once, at module load, so it is in place before any screen mounts.
 *
 * The default handler is CALLED, not replaced. Swallowing a fatal would leave
 * the app running on a broken JS state, which is worse than the crash — the
 * goal here is a crash that is recorded, not a crash that is hidden.
 */
declare const ErrorUtils: {
  getGlobalHandler(): (e: unknown, isFatal?: boolean) => void;
  setGlobalHandler(fn: (e: unknown, isFatal?: boolean) => void): void;
} | undefined;

if (typeof ErrorUtils !== 'undefined' && ErrorUtils) {
  const previous = ErrorUtils.getGlobalHandler();
  ErrorUtils.setGlobalHandler((e, isFatal) => {
    record(e, 'global');
    previous?.(e, isFatal);
  });
}

interface Props { children: React.ReactNode }
interface State { err: Error | null }

export default class CrashGuard extends React.Component<Props, State> {
  state: State = { err: null };

  static getDerivedStateFromError(err: Error): State {
    return { err };
  }

  componentDidCatch(err: Error) {
    record(err, 'render');
  }

  render() {
    const { err } = this.state;
    if (!err) return this.props.children;

    return (
      <View style={s.root}>
        <Text style={s.title}>Something broke</Text>
        <Text style={s.body}>
          This screen stopped working. Tap Try again — if it keeps happening,
          send this text to support.
        </Text>
        <ScrollView style={s.box} contentContainerStyle={s.boxPad}>
          <Text style={s.mono} selectable>
            {err.message}
            {'\n\n'}
            {String(err.stack ?? '').slice(0, 2000)}
          </Text>
        </ScrollView>
        <TouchableOpacity
          style={s.btn}
          onPress={() => this.setState({ err: null })}
          accessibilityRole="button"
          accessibilityLabel="Try again"
        >
          <Text style={s.btnText}>Try again</Text>
        </TouchableOpacity>
      </View>
    );
  }
}

const s = StyleSheet.create({
  root:    { flex: 1, backgroundColor: '#0C0E11', padding: 24, paddingTop: 72, gap: 12 },
  title:   { color: '#FFFFFF', fontSize: 22, fontWeight: '700' },
  body:    { color: '#A8B0BA', fontSize: 14, lineHeight: 20 },
  box:     { flex: 1, backgroundColor: '#15181D', borderRadius: 12, marginTop: 8 },
  boxPad:  { padding: 12 },
  mono:    { color: '#C9D1D9', fontSize: 11, lineHeight: 16 },
  btn:     { backgroundColor: '#04837A', borderRadius: 999, paddingVertical: 14, alignItems: 'center' },
  btnText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
});
