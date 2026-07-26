import React from 'react';
import { View, Text, Pressable, ActivityIndicator, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeProvider';
import { a11yButton } from './a11y';

/**
 * The four states every fetched screen has, plus the two this product needs on
 * top of them.
 *
 * Loading / empty / error are the usual three. Offline is the fourth and is a
 * first-class state here rather than a flavour of error: an Indian site office
 * or a client's basement meeting room is a normal place to open this app, not
 * an edge case, and "check your connection" is a different instruction from
 * "try again". The distinction is not cosmetic — TanStack Query retries twice
 * before surfacing `isError`, so an offline screen that renders the error state
 * makes the user wait through two doomed retries to be told the wrong thing.
 *
 * `forbidden` is the sixth, and it exists because of how the backend gates
 * modules. `require_module(code)` raises **403** both when the org has not
 * subscribed to a module and when this particular user holds no grant for it
 * (middleware/subscription.py). On a module surface that is not an error at
 * all — it is the answer. Rendering it as "something went wrong" would have
 * every user without a Vetana grant filing a bug against a screen that is
 * working exactly as designed.
 *
 * `stale` is not a state but a modifier: when the cache has data and the device
 * is offline, the screen shows the DATA with a stale marker rather than an
 * offline placeholder. Query results are persisted to MMKV, so yesterday's
 * outstanding total is far more useful than a cloud icon.
 */
export type ScreenStatus =
  | 'loading'
  | 'offline'
  | 'forbidden'
  | 'error'
  | 'empty'
  | 'ready';

interface ResolveArgs {
  isLoading: boolean;
  isError:   boolean;
  error?:    unknown;
  online:    boolean;
  /** True when the query has usable data — including data restored from cache. */
  hasData:   boolean;
  /** True when the query succeeded but returned nothing to show. */
  isEmpty?:  boolean;
}

/** HTTP status off an axios error, if this was one. */
export function statusOf(error: unknown): number | undefined {
  return (error as { response?: { status?: number } } | undefined)?.response?.status;
}

/**
 * Decide what a screen should render.
 *
 * Order matters and is deliberate:
 *
 *  1. Data wins over everything. A persisted cache is why this app is usable on
 *     a train, and blanking it to show an error would throw away the one thing
 *     offline support bought.
 *  2. `forbidden` beats `offline`, because a 403 is a real answer that arrived —
 *     the request reached the server. Losing the connection afterwards does not
 *     make the answer less true.
 *  3. `offline` beats `error`, because with no connection the error is a symptom
 *     rather than a cause, and the actionable instruction is the connection one.
 */
export function resolveScreenState(a: ResolveArgs): ScreenStatus {
  if (a.hasData) return a.isEmpty ? 'empty' : 'ready';
  if (a.isError && statusOf(a.error) === 403) return 'forbidden';
  if (a.isLoading) return 'loading';
  if (!a.online) return 'offline';
  if (a.isError) return 'error';
  return a.isEmpty ? 'empty' : 'ready';
}

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
