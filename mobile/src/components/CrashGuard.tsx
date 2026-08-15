/**
 * CrashGuard — the visible half of crash handling.
 *
 * The recording half lives in `lib/crashRecorder.ts`, imported as the first
 * line of `index.js` so it is installed before any other module can throw.
 * This file is only the render boundary: it catches a throw during render,
 * writes it through the recorder, and swaps in the panel below.
 *
 * ── WHAT "TRY AGAIN" REALLY IS ──────────────────────────────────────────────
 *
 * This is the app's single boundary and it sits at the root, so a render
 * throw ANYWHERE unmounts the entire tree — navigation state, providers,
 * half-typed drafts. "Try again" is therefore a full UI restart from zero,
 * not a retry of one screen. That is still worth having (it beats a dead
 * process, and the record survives either way), but the panel's copy is
 * honest about it, and after repeated immediate re-crashes it stops promising
 * anything and says to close and reopen the app instead.
 *
 * ── WHY THE PANEL USES RAW PALETTE CONSTANTS ────────────────────────────────
 *
 * No `useTheme` — this must render when the thing that broke IS the theme
 * provider. But `palette.generated.ts` is a zero-import `as const` data
 * module with no provider and no side effects, so the DARK palette values are
 * imported from there rather than hand-transcribed. That file's own header
 * records that hand-copied literals went stale twice before generation fixed
 * it; the panel must not reintroduce the same failure mode.
 */
import React from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { darkPalette } from '../theme/palette.generated';
import { record } from '../lib/crashRecorder';

interface Props { children: React.ReactNode }
interface State { err: Error | null; streak: number }

export default class CrashGuard extends React.Component<Props, State> {
  state: State = { err: null, streak: 0 };

  /** When the previous catch happened — 0 until the first one. */
  private lastCatchAt = 0;

  static getDerivedStateFromError(err: Error): Partial<State> {
    return { err };
  }

  componentDidCatch(err: Error) {
    record(err, 'render');
    // Streak counts RAPID re-catches only: "Try again" landing straight back
    // here means the crash is deterministic on the mount path, and the copy
    // below stops promising a retry will help. Recency-gated, not forever —
    // two unrelated crashes hours apart are two first crashes, and disabling
    // the retry affordance for the second one would punish the wrong thing.
    const now = Date.now();
    const rapid = now - this.lastCatchAt < 10_000;
    this.lastCatchAt = now;
    this.setState(s => ({ streak: rapid ? s.streak + 1 : 1 }));
  }

  render() {
    const { err, streak } = this.state;
    if (!err) return this.props.children;

    const looping = streak >= 2;
    return (
      <View style={s.root}>
        <Text style={s.title}>Something broke</Text>
        <Text style={s.body}>
          {looping
            ? 'The same error keeps happening. Close the app fully and open it '
              + 'again — and send this text to support.'
            : 'The app hit an error and has to restart its screens — anything '
              + 'half-typed is lost. Tap Try again; if this keeps happening, '
              + 'send this text to support.'}
        </Text>
        <ScrollView style={s.box} contentContainerStyle={s.boxPad}>
          <Text style={s.mono} selectable>
            {err.message}
            {'\n\n'}
            {String(err.stack ?? '').slice(0, 2000)}
          </Text>
        </ScrollView>
        {!looping && (
          <TouchableOpacity
            style={s.btn}
            onPress={() => this.setState({ err: null })}
            accessibilityRole="button"
            accessibilityLabel="Try again"
          >
            <Text style={s.btnText}>Try again</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  }
}

// Dark palette on purpose: matches the splash, and a crash panel that flashes
// bright white at night would be one more insult.
const s = StyleSheet.create({
  root:    { flex: 1, backgroundColor: darkPalette.bg, padding: 24, paddingTop: 72, gap: 12 },
  title:   { color: darkPalette.ink, fontSize: 22, fontWeight: '700' },
  body:    { color: darkPalette.ink2, fontSize: 14, lineHeight: 20 },
  box:     { flex: 1, backgroundColor: darkPalette.surface, borderRadius: 12, marginTop: 8 },
  boxPad:  { padding: 12 },
  mono:    { color: darkPalette.ink2, fontSize: 11, lineHeight: 16 },
  btn:     { backgroundColor: darkPalette.primary, borderRadius: 999, paddingVertical: 14, alignItems: 'center' },
  btnText: { color: darkPalette.onPrimary, fontSize: 15, fontWeight: '700' },
});
