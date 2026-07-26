import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, ActivityIndicator, StyleSheet, StatusBar,
  TouchableOpacity, Alert, Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import NetInfo from '@react-native-community/netinfo';

import { ThemeProvider, useTheme } from './theme/ThemeProvider';
import { AuthProvider } from './hooks/useAuth';
import { queryClient, persister, setupQueryPersistence } from './offline/queryClient';
import { useFonts } from './theme/fonts';
import { flushQueue, getQueueCount, clearQueue, friendlyFlushError } from './offline/mutationQueue';
import { flushPunches, getPunchCount } from './offline/punchQueue';
import { usePushNotifications } from './hooks/usePushNotifications';
import { NotificationProvider } from './context/NotificationContext';
import { NotificationBannerContainer } from './components/NotificationBanner';
import { restoreToken } from './api/auth';
import RootStack from './nav/RootStack';
import { BRAND } from './theme/tokens';

// Restore JWT from MMKV into axios headers before any component mounts
restoreToken();

// ── Offline banner ────────────────────────────────────────────────────────────
interface BannerProps {
  message:    string | null;
  kind:       'error' | 'warn' | 'info' | 'syncing';
  onRetry?:   () => void;
  onClear?:   () => void;
}
function OfflineBanner({ message, kind, onRetry, onClear }: BannerProps) {
  if (!message) return null;

  // Colours matched to iOS pill / Android strip spec
  const bg =
    kind === 'error'   ? 'rgba(186,26,26,0.92)'   :
    kind === 'warn'    ? 'rgba(255,159,10,0.14)'   :
    kind === 'syncing' ? 'rgba(4,131,122,0.12)'    :
                         'rgba(4,131,122,0.12)';
  const textColor =
    kind === 'error'   ? '#fff'     :
    kind === 'warn'    ? '#92400e'  :
                         BRAND.blue;
  const borderColor =
    kind === 'error'   ? 'rgba(186,26,26,0.3)'   :
    kind === 'warn'    ? 'rgba(255,159,10,0.35)'  :
                         'rgba(4,131,122,0.3)';

  const iconName =
    kind === 'error'   ? 'alert-circle-outline'  :
    kind === 'warn'    ? 'wifi-outline'           :
    kind === 'syncing' ? 'sync-outline'           : 'wifi-outline';

  return (
    <View style={s.bannerRow}>
      <View style={[s.bannerPill, { backgroundColor: bg, borderColor }]}>
        <Ionicons name={iconName as any} size={13} color={textColor} />
        <Text style={[s.bannerText, { color: textColor, flex: 1 }]} numberOfLines={2}>
          {message}
        </Text>
        {onRetry && (
          <TouchableOpacity onPress={onRetry} style={[s.bannerBtn, { borderColor }]}
            accessibilityLabel="Retry syncing offline changes" accessibilityRole="button">
            <Text style={[s.bannerBtnText, { color: textColor }]}>Retry</Text>
          </TouchableOpacity>
        )}
        {onClear && (
          <TouchableOpacity onPress={onClear} style={[s.bannerBtn, { borderColor, marginLeft: 4 }]}
            accessibilityLabel="Discard offline changes" accessibilityRole="button">
            <Text style={[s.bannerBtnText, { color: textColor }]}>Discard</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

// ── Splash screen (shown while auth is resolving) ─────────────────────────────
export function Splash() {
  return (
    <View style={s.splash}>
      <Text style={s.splashBrand}>Kartavaya</Text>
      <Text style={s.splashSub}>BY AEKAM INC</Text>
      <ActivityIndicator color={BRAND.blue} size="large" style={{ marginTop: 32 }} />
    </View>
  );
}

// ── Inner app (needs ThemeProvider) ──────────────────────────────────────────
type BannerState = { message: string; kind: BannerProps['kind']; canRetry: boolean; canClear: boolean } | null;

function InnerApp() {
  const { scheme } = useTheme();
  const [banner, setBanner] = useState<BannerState>(null);

  // Push notification registration + tap-to-navigate
  usePushNotifications();

  const doFlush = useCallback(async () => {
    const count = getQueueCount();
    const punchCount = getPunchCount();
    // Both queues, or the early return silently strands attendance: a device with
    // no pending edits but three unsent punches would never flush them.
    if (count === 0 && punchCount === 0) { setBanner(null); return; }

    if (count > 0 || punchCount > 0) {
      const parts: string[] = [];
      if (punchCount > 0) parts.push(`${punchCount} clock-in${punchCount === 1 ? '' : 's'}`);
      if (count > 0) parts.push(`${count} change${count === 1 ? '' : 's'}`);
      setBanner({
        message:  `Syncing ${parts.join(' and ')}…`,
        kind:     'syncing',
        canRetry: false,
        canClear: false,
      });
    }

    const result = count > 0
      ? await flushQueue()
      : { failed: [] as Awaited<ReturnType<typeof flushQueue>>['failed'] };

    // Punches replay from their own queue, separately and unconditionally.
    // 17: "A dropped punch is an unpaid day" — so a failure in the mutation
    // queue must not skip attendance, and vice versa. Failures here are carried
    // forward rather than surfaced as errors, because the punch is not lost;
    // expiry is the only thing worth interrupting someone about.
    const punchResult = await flushPunches();
    if (punchResult.expired.length > 0) {
      // A punch that aged out past 72 hours cannot be recovered by retrying, and
      // only the employee knows it happened. They have to raise a regularisation,
      // so this is the one queue outcome that gets a persistent, blocking notice.
      Alert.alert(
        'A clock-in could not be sent',
        `${punchResult.expired.length} punch${punchResult.expired.length === 1 ? '' : 'es'} `
        + 'stayed unsent for more than 72 hours and can no longer be submitted. '
        + 'Ask your manager to add the time manually.',
        [{ text: 'Understood' }],
      );
    }

    if (result.failed.length > 0) {
      const permanent = result.failed.filter(f => f.permanent);
      const transient = result.failed.filter(f => !f.permanent);
      if (permanent.length > 0) {
        setBanner({
          message:  `${permanent.length} change${permanent.length > 1 ? 's' : ''} couldn't sync: ${friendlyFlushError(permanent[0].error)}`,
          kind:     'error',
          canRetry: false,
          canClear: false,
        });
        setTimeout(() => setBanner(null), 7000);
      } else if (transient.length > 0) {
        setBanner({
          message:  `Sync incomplete — ${transient.length} change${transient.length > 1 ? 's' : ''} will retry.`,
          kind:     'warn',
          canRetry: true,
          canClear: true,
        });
      }
    } else {
      setBanner(null);
      // Scope to affected query keys; a global invalidation thrashes all caches
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    }
  }, []);

  const handleRetry = useCallback(() => {
    doFlush();
  }, [doFlush]);

  const handleClear = useCallback(() => {
    const count = getQueueCount();
    Alert.alert(
      'Discard offline changes?',
      `You have ${count} unsynced change${count === 1 ? '' : 's'}. This cannot be undone.`,
      [
        { text: 'Keep', style: 'cancel' },
        {
          text: 'Discard', style: 'destructive',
          onPress: () => { clearQueue(); setBanner(null); },
        },
      ]
    );
  }, []);

  // Flush offline queue when connectivity restored
  useEffect(() => {
    setupQueryPersistence();

    const unsub = NetInfo.addEventListener(async (state) => {
      const online = !!(state.isConnected && state.isInternetReachable !== false);
      if (online) {
        await doFlush();
      } else {
        // 17: "The offline banner must state which mutations are queued, not just
        // that the device is offline. '3 changes waiting to sync' is actionable;
        // a grey cloud is not." Punches are counted separately and named
        // separately — a queued clock-in is the one item where the employee needs
        // to know it is still pending, because their pay depends on it arriving.
        const queued = getQueueCount();
        const punches = getPunchCount();
        const parts: string[] = [];
        if (punches > 0) parts.push(`${punches} clock-in${punches === 1 ? '' : 's'}`);
        if (queued > 0) parts.push(`${queued} change${queued === 1 ? '' : 's'}`);
        setBanner({
          message: parts.length
            ? `You're offline — ${parts.join(' and ')} waiting to sync.`
            : "You're offline — changes will sync when reconnected.",
          kind:     'info',
          canRetry: false,
          // Discarding must never offer to throw away a punch. canClear drives
          // clearQueue(), which only touches the mutation queue, so it is offered
          // on changes alone.
          canClear: queued > 0,
        });
      }
    });

    return () => unsub();
  }, [doFlush]);

  return (
    <>
      <StatusBar
        barStyle={scheme === 'dark' ? 'light-content' : 'dark-content'}
        translucent
        backgroundColor="transparent"
      />
      <OfflineBanner
        message={banner?.message ?? null}
        kind={banner?.kind ?? 'info'}
        onRetry={banner?.canRetry ? handleRetry : undefined}
        onClear={banner?.canClear ? handleClear : undefined}
      />
      <RootStack />
      <NotificationBannerContainer />
    </>
  );
}

// ── Root ──────────────────────────────────────────────────────────────────────
export default function App() {
  const [fontsLoaded] = useFonts();
  // Show splash until custom fonts load to prevent FOUT (flash of unstyled text)
  if (!fontsLoaded) return <Splash />;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
      <PersistQueryClientProvider
        client={queryClient}
        persistOptions={{ persister }}
        onSuccess={() => queryClient.resumePausedMutations()}
      >
        <ThemeProvider>
          <AuthProvider>
            <NotificationProvider>
              <InnerApp />
            </NotificationProvider>
          </AuthProvider>
        </ThemeProvider>
      </PersistQueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const s = StyleSheet.create({
  splash: {
    flex: 1,
    backgroundColor: '#020d1a',
    alignItems: 'center',
    justifyContent: 'center',
  },
  splashBrand: {
    color: '#fff',
    fontSize: 28,
    fontWeight: '900',
    letterSpacing: 5,
  },
  splashSub: {
    color: '#05b7aa',
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 4,
    marginTop: 6,
  },
  // Offline banner — pill design matching iOS/Android spec
  bannerRow: {
    position:        'absolute',
    top:             Platform.OS === 'ios' ? 56 : 36,
    left:            0,
    right:           0,
    zIndex:          999,
    alignItems:      'center',
    pointerEvents:   'box-none',
  },
  bannerPill: {
    flexDirection:   'row',
    alignItems:      'center',
    gap:             6,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius:    12,
    borderWidth:     1,
    maxWidth:        340,
    marginHorizontal: 20,
    shadowColor:     '#000',
    shadowOffset:    { width: 0, height: 2 },
    shadowOpacity:   0.12,
    shadowRadius:    6,
    elevation:       4,
  },
  bannerText: {
    fontSize: 12,
    fontWeight: '600',
  },
  bannerBtn: {
    borderRadius:    6,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderWidth:     1,
    marginLeft:      4,
  },
  bannerBtnText: {
    fontSize: 11,
    fontWeight: '800',
  },
});
