/**
 * Refresher — pull-to-refresh, with the Android half wired up.
 *
 * ── The bug ─────────────────────────────────────────────────────────────────
 *
 * Fourteen call sites, every one of them written as
 *
 *     <RefreshControl refreshing={…} onRefresh={…} tintColor={t.primary} />
 *
 * and `tintColor` is **iOS only**. Android reads `colors` (an array) and
 * `progressBackgroundColor`. Neither was ever set anywhere in this app, so every
 * pull-to-refresh spinner on Android has been rendering in the platform default
 * — Material's stock blue — on a product whose accent is teal, in both themes,
 * on the gesture users perform more than any other.
 *
 * It is invisible in exactly the way that kept it alive: `tintColor` is present,
 * spelled correctly, and pointing at the right token, so the line reads as done.
 *
 * Several other call sites passed `onRefresh`/`refreshing` straight to the
 * FlatList instead, which builds a RefreshControl internally and exposes no
 * colour props at all — the same defect with no line to correct.
 *
 * ── Motion ──────────────────────────────────────────────────────────────────
 *
 * The spinner itself is a platform control. Its duration is not ours to set and
 * there is no `Animated` value behind it, which is the one place in this app
 * where an indefinite animation is genuinely out of reach — `UIRefreshControl`
 * and `SwipeRefreshLayout` both keep spinning under Reduce Motion because the OS
 * treats them as progress indicators rather than decoration. That is the correct
 * platform behaviour and the reason this file does not try to gate it: a
 * progress indicator that stops is a hang.
 *
 * What IS in our gift is `progressViewOffset`, so the Android spinner clears a
 * header rather than appearing behind it.
 */
import React from 'react';
import { RefreshControl } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';

export interface RefresherProps {
  refreshing: boolean;
  onRefresh: () => void;
  /** Push the Android spinner down past a sticky header. */
  offset?: number;
}

export default function Refresher({ refreshing, onRefresh, offset }: RefresherProps) {
  const { t } = useTheme();
  return (
    <RefreshControl
      refreshing={refreshing}
      onRefresh={onRefresh}
      // iOS
      tintColor={t.primary}
      // Android — the half that was missing everywhere.
      colors={[t.primary]}
      progressBackgroundColor={t.surface}
      progressViewOffset={offset}
    />
  );
}
