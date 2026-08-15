/**
 * UpdateOffer — "there is a new version, pull down when you're ready."
 *
 * The visible half of `useAppUpdate`. It appears only once a new bundle has
 * been downloaded and staged in the background, which means accepting it costs
 * the user a reload and not a download — the wait is already paid for by the
 * time this is on screen.
 *
 * ── IT IS A STATEMENT, NOT A BUTTON ─────────────────────────────────────────
 *
 * Deliberately not tappable. Owner's decision, 2026-08-15: the update is
 * applied by pulling down to refresh. Giving it a tap target as well would put
 * two ways to do one thing on screen, and the tap would be the one people hit
 * by accident while reaching for the tab bar — which is a reload in the middle
 * of whatever they were doing.
 *
 * `pointerEvents="none"` for the same reason: it sits over a scrolling list and
 * must never eat a touch meant for the row underneath it.
 *
 * It clears itself by unmounting when the reload happens, so there is nothing
 * to dismiss and no state to remember.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { useAppUpdate } from '../hooks/useAppUpdate';

export default function UpdateOffer() {
  const { t } = useTheme();
  const { ready } = useAppUpdate();

  if (!ready) return null;
  return (
    <View
      style={[s.wrap, { backgroundColor: t.surface, borderColor: t.primary }]}
      pointerEvents="none"
      accessibilityLiveRegion="polite"
      accessibilityRole="text"
      accessibilityLabel="An update is ready. Pull down to refresh to apply it."
    >
      <Text style={[s.label, { color: t.ink2 }]}>
        Update ready — pull down to refresh
      </Text>
    </View>
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
