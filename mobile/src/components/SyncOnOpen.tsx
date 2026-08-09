/**
 * SyncOnOpen — the lotus that spins while the app catches up.
 *
 * Owner's decision, 2026-08-09: "everytime when user opens it gets sync with
 * lotus loader in background — it actually [syncs] the data since last session."
 *
 * ── "IN BACKGROUND" IS TAKEN LITERALLY ──────────────────────────────────────
 *
 * This does NOT block the app. The screens render from cache immediately, which
 * they can because the cache is already there, and the lotus sits in the corner
 * saying that fresher data is on its way. A full-screen loader on every open
 * would make a fast app feel slow for the sake of a request that usually
 * returns nothing.
 *
 * It is deliberately quiet: it appears only while a sync is genuinely running,
 * and NOT for the sub-second case where the delta comes back empty — a badge
 * that flashes on every launch is noise, and after a week nobody reads it.
 *
 * ── AND IT DOES THE HOUSEKEEPING ────────────────────────────────────────────
 *
 * The three-day cache purge is evaluated here too, on foreground, for the
 * reason spelled out in `cachePurge`: nothing can be trusted to run at 22:00
 * inside a sleeping app, and a purge that fires while the screen is being read
 * would blank it. Purge first, then sync — in that order, so the sync refills
 * what the purge just emptied and the user never sees the gap.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, AppStateStatus, StyleSheet, Text, View } from 'react-native';
import Lotus from './Lotus';
import { useTheme } from '../theme/ThemeProvider';
import { purgeIfDue } from '../offline/cachePurge';
import { syncSession } from '../offline/sessionSync';
import { useAuth } from '../hooks/useAuth';

/** Below this, the sync finished before anyone could read the badge. */
const SHOW_AFTER_MS = 400;

export default function SyncOnOpen() {
  const { t } = useTheme();
  const { user } = useAuth();
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  const appState = useRef<AppStateStatus>(AppState.currentState);

  const run = useCallback(async () => {
    // Guarded: Android fires `change` more than once for a single foreground,
    // and two concurrent syncs would push the same queued edits twice.
    if (running.current || !user) return;
    running.current = true;
    const show = setTimeout(() => setBusy(true), SHOW_AFTER_MS);
    try {
      purgeIfDue();
      await syncSession();
    } finally {
      clearTimeout(show);
      setBusy(false);
      running.current = false;
    }
  }, [user]);

  useEffect(() => { void run(); }, [run]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', next => {
      const cameForward = appState.current.match(/inactive|background/) && next === 'active';
      appState.current = next;
      if (cameForward) void run();
    });
    return () => sub.remove();
  }, [run]);

  if (!busy) return null;
  return (
    <View style={[s.wrap, { backgroundColor: t.surface, borderColor: t.outlineVar }]}
          pointerEvents="none" accessibilityLiveRegion="polite">
      <Lotus size={18} color={t.primary} />
      <Text style={[s.label, { color: t.ink2 }]}>Syncing…</Text>
    </View>
  );
}

const s = StyleSheet.create({
  // Bottom, not top: the top of every screen is a header with a title in it,
  // and this must never sit over one.
  wrap: {
    position: 'absolute', bottom: 78, alignSelf: 'center',
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingVertical: 6, paddingHorizontal: 12,
    borderRadius: 999, borderWidth: 1,
  },
  label: { fontSize: 12, fontWeight: '600' },
});
