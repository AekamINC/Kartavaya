import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  View, Text, ActivityIndicator, StyleSheet, StatusBar,
  TouchableOpacity, Alert, Platform, Animated,
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
import { flushQueue, getQueueCount, getQueueSummary, clearQueue, friendlyFlushError } from './offline/mutationQueue';
import { flushPunches, getPunchCount, getPunchSummary } from './offline/punchQueue';
import { agoLabel } from './hooks/useQueueStatus';
import { amplitude, duration, useReducedMotion, DUR, EASE } from './theme/motion';
import { usePushNotifications } from './hooks/usePushNotifications';
import { NotificationProvider } from './context/NotificationContext';
import { NotificationBannerContainer } from './components/NotificationBanner';
import { restoreToken } from './api/auth';
import RootStack from './nav/RootStack';
import { BRAND, tokens, withAlpha } from './theme/tokens';

// Restore JWT from MMKV into axios headers before any component mounts
restoreToken();

// ── Offline banner ────────────────────────────────────────────────────────────
interface BannerProps {
  message:    string | null;
  kind:       'error' | 'warn' | 'info' | 'syncing' | 'synced';
  onRetry?:   () => void;
  onClear?:   () => void;
}
/**
 * The banner's colours were six rgba literals and three hexes, tuned for the
 * cream canvas and applied unchanged in dark mode. Measured over the real dark
 * surface, the warn variant — dark brown `#92400e` on a 14%-orange pill that
 * composites to near-black — came out at **2.03:1**. That is the banner telling
 * you your writes are queued offline, and it was the least readable thing in the
 * app in the mode where readability mattered most.
 *
 * Replaced with the container pairs, which exist for exactly this and are
 * defined in both themes. Measured, foreground on background:
 *
 *     kind           light      dark
 *     error          6.57:1     7.40:1     onError on error
 *     warn          10.10:1     9.49:1     onApprovalContainer on approvalBg
 *     info/syncing  13.63:1     7.01:1     onPrimaryContainer on primaryContainer
 *
 * The border keeps its translucent treatment, but derived from the same token
 * via withAlpha rather than restating the channel values — `'rgba(4,131,122,0.3)'`
 * was the light-mode primary hardcoded, so the border stayed teal-on-teal in
 * dark where the fill had moved to the container.
 */
function OfflineBanner({ message, kind, onRetry, onClear }: BannerProps) {
  const { t } = useTheme();
  const reduced = useReducedMotion();

  /**
   * The banner had no entrance and no exit — `if (!message) return null`, which
   * is the same `if (!open) return null` MOTION-SPEC §9 lists as the defect on
   * every web overlay. It appeared and vanished between two frames, over
   * whatever was on screen, which is the single most startling way to deliver
   * "you are offline".
   *
   * `shown` trails `message` so the pill can animate out before it unmounts, and
   * the last non-null message is held during that exit — otherwise the text
   * disappears on the first frame of the fade and what slides away is an empty
   * pill.
   */
  const [shown, setShown] = useState<{ message: string; kind: BannerProps['kind'] } | null>(
    message ? { message, kind } : null,
  );
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (message) {
      setShown({ message, kind });
      Animated.timing(anim, {
        toValue: 1,
        duration: duration(DUR.base, reduced),
        easing: EASE.enter,
        useNativeDriver: true,
      }).start();
      return;
    }
    // §7.3 — decisive out. 180ms against the 220ms in.
    Animated.timing(anim, {
      toValue: 0,
      duration: duration(DUR.exit, reduced),
      easing: EASE.exit,
      useNativeDriver: true,
    }).start(({ finished }) => { if (finished) setShown(null); });
  }, [message, kind, reduced, anim]);

  if (!shown) return null;

  const k = message ? kind : shown.kind;

  // `synced` uses the success container pair, which is the one MOTION-SPEC §6
  // maps to "success, complete, approved". `successBg` with `onSuccessContainer`
  // and never with `success` — tokens.ts measured that mismatch at 2.37:1.
  const bg =
    k === 'error'   ? t.error            :
    k === 'warn'    ? t.approvalBg       :
    k === 'synced'  ? t.successBg        :
                      t.primaryContainer;
  const textColor =
    k === 'error'   ? t.onError              :
    k === 'warn'    ? t.onApprovalContainer  :
    k === 'synced'  ? t.onSuccessContainer   :
                      t.onPrimaryContainer;
  const borderColor =
    k === 'error'   ? withAlpha(t.error,    0.30) :
    k === 'warn'    ? withAlpha(t.approval, 0.35) :
    k === 'synced'  ? withAlpha(t.success,  0.30) :
                      withAlpha(t.primary,  0.30);

  const iconName =
    k === 'error'   ? 'alert-circle-outline' :
    k === 'warn'    ? 'wifi-outline'         :
    k === 'syncing' ? 'sync-outline'         :
    k === 'synced'  ? 'checkmark-circle'     : 'wifi-outline';

  return (
    <Animated.View
      style={[
        s.bannerRow,
        {
          opacity: anim,
          // Enters from above, which is where it lives. The travel collapses to
          // 0 under reduced motion while the opacity change — the part carrying
          // the information — is kept.
          transform: [{
            translateY: anim.interpolate({
              inputRange: [0, 1],
              outputRange: [-amplitude(16, reduced), 0],
            }),
          }],
        },
      ]}
      // Announced as a live region so a screen-reader user is told the device
      // went offline without having to find the pill. `polite`, not `assertive`:
      // this interrupts nothing the user is doing.
      accessibilityLiveRegion="polite"
      accessibilityRole="alert"
    >
      <View style={[s.bannerPill, { backgroundColor: bg, borderColor }]}>
        <Ionicons name={iconName as any} size={13} color={textColor} />
        <Text style={[s.bannerText, { color: textColor, flex: 1 }]} numberOfLines={3}>
          {shown.message}
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
    </Animated.View>
  );
}

/**
 * Splash — shown while the fonts load, and again while auth resolves.
 *
 * This one renders OUTSIDE ThemeProvider (see `App` below: it returns before the
 * providers mount), so it cannot call useTheme() and has to reach into `tokens`
 * directly. That is the reason it drifted: with no hook to pull it back to the
 * palette it kept `backgroundColor: '#020d1a'`, a navy from the retired-blue era.
 *
 * app.json's NATIVE splash is `backgroundColor: "#0C0E11"`. So every cold launch
 * showed the native splash in one dark blue, then swapped to this one in a
 * different dark blue, then swapped again to the real canvas — two visible
 * flashes before the first screen. `tokens.dark.bg` IS `#0C0E11`, so pinning it
 * there removes the first seam and cannot drift from app.json again without the
 * token moving.
 *
 * Dark in both schemes on purpose: the native splash config is a single colour
 * with no light/dark variant, so matching it beats matching the user's scheme.
 */
export function Splash() {
  return (
    <View style={s.splash}>
      <Text style={s.splashBrand}>Kartavaya</Text>
      <Text style={s.splashSub}>BY AEKAM INC</Text>
      <ActivityIndicator color={BRAND.teal} size="large" style={{ marginTop: 32 }} />
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

  /**
   * Clears the banner after `ms`, and cancels a pending clear when a new one is
   * scheduled. Without the ref, an error banner scheduled to clear at +7s and a
   * synced banner scheduled at +3.5s race, and whichever fires second wipes a
   * message the user has not read.
   */
  const clearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearAfter = useCallback((ms: number) => {
    if (clearTimer.current) clearTimeout(clearTimer.current);
    clearTimer.current = setTimeout(() => setBanner(null), ms);
  }, []);
  useEffect(() => () => { if (clearTimer.current) clearTimeout(clearTimer.current); }, []);

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
      : { succeeded: 0, failed: [] as Awaited<ReturnType<typeof flushQueue>>['failed'] };

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
        clearAfter(7000);
      } else if (transient.length > 0) {
        setBanner({
          message:  `Sync incomplete — ${transient.length} change${transient.length > 1 ? 's' : ''} will retry.`,
          kind:     'warn',
          canRetry: true,
          canClear: true,
        });
      }
    } else {
      /**
       * A successful flush used to be silent: `setBanner(null)` and nothing
       * else. The user watched "Syncing 3 changes…" appear and then vanish, with
       * no statement that it worked — so a flush that succeeded and a flush that
       * was cancelled looked identical, and the only way to find out which had
       * happened was to go and check the record.
       *
       * Confirmations are the cheap half of §7.1. It says what landed, then
       * clears itself: this is an acknowledgement, not a state, and a banner
       * that stays is a banner that gets ignored the next time it means
       * something.
       */
      const landed: string[] = [];
      if (punchResult.sent > 0) {
        landed.push(`${punchResult.sent} clock-in${punchResult.sent === 1 ? '' : 's'}`);
      }
      if (result.succeeded > 0) {
        landed.push(`${result.succeeded} change${result.succeeded === 1 ? '' : 's'}`);
      }

      if (landed.length > 0) {
        setBanner({
          message:  `Synced ${landed.join(' and ')}.`,
          kind:     'synced',
          canRetry: false,
          canClear: false,
        });
        // Long enough to read a short sentence, short enough not to sit over the
        // screen the user came back to.
        clearAfter(3500);
      } else {
        setBanner(null);
      }

      // Scope to affected query keys; a global invalidation thrashes all caches
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
      // The punch queue feeds attendance surfaces, which were not being
      // refreshed after a flush — a clocked-in employee whose punch finally
      // landed kept seeing the pre-sync figure until they pulled to refresh.
      if (punchResult.sent > 0) queryClient.invalidateQueries({ queryKey: ['pahchan'] });
    }
  }, [clearAfter]);

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
        const changes = getQueueSummary();
        const punches = getPunchSummary();
        const parts: string[] = [];
        if (punches.count > 0) parts.push(`${punches.count} clock-in${punches.count === 1 ? '' : 's'}`);
        if (changes.count > 0) parts.push(`${changes.count} change${changes.count === 1 ? '' : 's'}`);

        // The age, which the reference banner carries and this one did not:
        // `Offline. 3 changes queued · oldest 12 min` (Mobile.jsx:82). A count
        // alone reads the same at minute one and hour seventy-one.
        const oldestIso = [changes.oldestAt, punches.oldestCapturedAt]
          .filter((v): v is string => !!v)
          .sort()[0] ?? null;
        const oldest = agoLabel(oldestIso);

        // The 72-hour promise, stated while the window is still open rather than
        // as an Alert after a punch has already aged out. Only inside the last
        // day, so it is a warning rather than wallpaper.
        const punchWindow =
          punches.count > 0 && punches.hoursLeft != null && punches.hoursLeft <= 24
            ? ` Attendance is held for 72 hours — about ${punches.hoursLeft} h left on the oldest.`
            : '';

        setBanner({
          message: parts.length
            ? `You're offline — ${parts.join(' and ')} waiting to sync`
              + (oldest ? `, oldest ${oldest}.` : '.')
              + punchWindow
            : "You're offline — changes will sync when reconnected.",
          kind:     'info',
          canRetry: false,
          // Discarding must never offer to throw away a punch. canClear drives
          // clearQueue(), which only touches the mutation queue, so it is offered
          // on changes alone.
          canClear: changes.count > 0,
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
    // Must equal app.json's native splash backgroundColor, or the cold launch
    // shows two different dark blues in sequence. Both are #0C0E11.
    backgroundColor: tokens.dark.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  splashBrand: {
    color: tokens.dark.ink,
    fontSize: 28,
    fontWeight: '900',
    letterSpacing: 5,
  },
  splashSub: {
    color: BRAND.teal,
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
