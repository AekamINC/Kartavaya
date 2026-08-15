/**
 * UpdateOffer — "there is a new version, take it when you're ready."
 *
 * The visible half of `useAppUpdate`. It appears only once a new bundle has
 * been downloaded and staged in the background, which means accepting it costs
 * the user a reload and not a download — the wait is already paid for by the
 * time this is on screen.
 *
 * ── IT IS A BUTTON, BECAUSE IT HAS TO BE ────────────────────────────────────
 *
 * The first version was a passive pill saying "pull down to refresh",
 * `pointerEvents="none"`, no dismiss — deferring entirely to Refresher's pull.
 * But no screen currently renders a Refresher (every refreshControl was
 * stripped for the RN 0.81 list-blanking bug), so the pill instructed a
 * gesture that existed nowhere, could never be acted on, and never left the
 * screen. The tap IS the consent now; the pull joins back in the day
 * refreshControls return. If the reload fails, the offer stays and the tap
 * can simply be made again.
 *
 * It clears itself by unmounting when the reload happens — and honestly, the
 * cold-start backstop clears it too: expo-updates boots the newest staged
 * bundle on the next process start regardless, so declining is only ever a
 * deferral, never a veto. See useAppUpdate's header.
 */
import React, { useEffect } from 'react';
import { AccessibilityInfo, StyleSheet, Text, TouchableOpacity } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { useAppUpdate } from '../hooks/useAppUpdate';

export default function UpdateOffer() {
  const { t } = useTheme();
  const { ready, apply } = useAppUpdate();

  // `accessibilityLiveRegion` is Android-only, and even there a region that
  // MOUNTS (rather than changes) frequently goes unannounced. This is the
  // only notice the user gets, so announce it explicitly on both platforms.
  useEffect(() => {
    if (ready) AccessibilityInfo.announceForAccessibility('Update ready. Tap the update button to restart and apply it.');
  }, [ready]);

  if (!ready) return null;
  return (
    <TouchableOpacity
      style={[s.wrap, { backgroundColor: t.surface, borderColor: t.primary }]}
      onPress={() => { void apply(); }}
      accessibilityRole="button"
      accessibilityLabel="Update ready. Restart now to apply it."
    >
      <Text style={[s.label, { color: t.ink2 }]}>
        Update ready — tap to restart
      </Text>
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  // Above SyncOnOpen's 78, so the two can be on screen together without one
  // covering the other. Both are bottom-anchored for the reason SyncOnOpen
  // gives: the top of every screen is a header with a title in it.
  wrap: {
    position: 'absolute', bottom: 116, alignSelf: 'center',
    paddingVertical: 6, paddingHorizontal: 12,
    borderRadius: 999, borderWidth: 1,
  },
  label: { fontSize: 12, fontWeight: '600' },
});
