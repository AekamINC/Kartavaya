import React from 'react';
import { View, Text, Pressable, ActivityIndicator, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeProvider';
import { a11yButton } from './a11y';

/**
 * The decision lives in `screenStatus.ts`, which imports nothing — see the
 * header there for why (this file cannot be loaded outside a bundler, so the
 * one primitive every module screen renders through had no test). Re-exported
 * here so every existing `from '../components/ScreenState'` import is unchanged.
 *
 * `stale` is not a state but a modifier: when the cache has data and the device
 * is offline, the screen shows the DATA with a stale marker rather than an
 * offline placeholder. Query results are persisted to MMKV, so yesterday's
 * outstanding total is far more useful than a cloud icon. See `StaleBar` below.
 */
export type { ScreenStatus, ResolveArgs } from './screenStatus';
export { statusOf, resolveScreenState, isRequestFault } from './screenStatus';

import type { ScreenStatus } from './screenStatus';

// ─────────────────────────────────────────────────────────────────────────────

interface Props {
  status:   Exclude<ScreenStatus, 'ready'>;
  /** Overrides the default copy for the current status. */
  title?:   string;
  body?:    string;
  /** Shown on error and offline. Omitted where retrying cannot help. */
  onRetry?: () => void;
  /** Icon override — module surfaces pass their own for the empty state. */
  icon?:    keyof typeof Ionicons.glyphMap;
}

const DEFAULTS: Record<Exclude<ScreenStatus, 'ready' | 'loading'>, {
  icon: keyof typeof Ionicons.glyphMap; title: string; body: string;
}> = {
  offline: {
    icon:  'cloud-offline-outline',
    title: "You're offline",
    // Names what will happen rather than telling the user to do something they
    // may not be able to do — there is no wifi to go and check on a highway.
    body:  'This screen needs a connection the first time. It loads as soon as you have one, and anything you change meanwhile is queued.',
  },
  forbidden: {
    icon:  'lock-closed-outline',
    title: 'Not available to you',
    body:  'Either your organisation does not have this module, or you have not been granted access to it. An admin can change that from the web app.',
  },
  error: {
    icon:  'alert-circle-outline',
    title: "Couldn't load",
    body:  'Something went wrong on our end. Pull down or tap retry.',
  },
  /* A 4xx. The wording is the web's, verbatim (`ui/ErrorState.jsx` COPY.request)
     so the two products say the same sentence about the same condition. It does
     NOT claim the server broke, and it does not invite a retry that will be
     refused identically — `ScreenState` omits the retry button for this status
     unless a caller passes one, because pulling to refresh a 422 just replays
     it. */
  request: {
    icon:  'close-circle-outline',
    title: 'That request wasn’t accepted',
    body:  'Nothing was changed. Going back and starting again usually clears it.',
  },
  empty: {
    icon:  'file-tray-outline',
    title: 'Nothing here yet',
    body:  '',
  },
};

/**
 * The non-ready half of a screen. Deliberately not a wrapper around the ready
 * case: screens render lists, grids and scroll views that have nothing in
 * common, and a component that owned both would end up taking a render prop for
 * every one of them.
 */
export default function ScreenState({ status, title, body, onRetry, icon }: Props) {
  const { t } = useTheme();

  if (status === 'loading') {
    return (
      <View style={s.centre} accessibilityLabel="Loading">
        <ActivityIndicator color={t.primary} />
      </View>
    );
  }

  const d = DEFAULTS[status];
  const heading = title ?? d.title;
  const detail  = body  ?? d.body;

  return (
    <View style={s.centre}>
      <Ionicons
        name={icon ?? d.icon}
        size={30}
        // A 403 is not a failure, so it does not get the alarm colour. Offline
        // is not one either — the app is behaving correctly with no network.
        // Nor is `request`: the server answered, and it answered about the
        // request. `error` is the only status that means WE broke.
        color={status === 'error' ? t.error : t.ink3}
      />
      <Text style={[s.title, { color: t.ink }]}>{heading}</Text>
      {!!detail && <Text style={[s.body, { color: t.ink3 }]}>{detail}</Text>}
      {!!onRetry && (
        <Pressable
          onPress={onRetry}
          {...a11yButton('Retry')}
          style={({ pressed }) => [
            s.retry,
            { borderColor: t.outline, backgroundColor: pressed ? t.surface2 : 'transparent' },
          ]}
        >
          <Text style={[s.retryText, { color: t.primaryText }]}>Retry</Text>
        </Pressable>
      )}
    </View>
  );
}

/**
 * The stale-cache marker. Shown above real data that was loaded before the
 * connection dropped, so a figure someone is about to quote in a meeting is
 * never silently out of date.
 */
export function StaleBar({ label }: { label?: string }) {
  const { t } = useTheme();
  return (
    <View style={[s.stale, { backgroundColor: t.approvalBg, borderColor: t.approval }]}>
      <Ionicons name="cloud-offline-outline" size={13} color={t.onApprovalContainer} />
      <Text style={[s.staleText, { color: t.onApprovalContainer }]}>
        {label ?? 'Offline — showing the last figures this device downloaded.'}
      </Text>
    </View>
  );
}

const s = StyleSheet.create({
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 32, paddingVertical: 40 },
  title:  { fontSize: 15, fontWeight: '700', marginTop: 4, textAlign: 'center' },
  body:   { fontSize: 13, lineHeight: 19, textAlign: 'center' },
  retry:  { marginTop: 10, borderWidth: 1, borderRadius: 10, paddingHorizontal: 18, paddingVertical: 8 },
  retryText: { fontSize: 13, fontWeight: '700' },
  stale: {
    flexDirection: 'row', alignItems: 'center', gap: 7,
    borderWidth: 1, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8,
  },
  staleText: { flex: 1, fontSize: 11.5, lineHeight: 16 },
});
