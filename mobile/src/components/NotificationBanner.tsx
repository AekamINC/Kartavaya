/**
 * NotificationBanner — in-app toast that slides in from the top.
 * Design matches ios-screens.jsx IOSInboxRow / android-screens.jsx AndInboxRow:
 *  - Avatar (34px) with tone-icon badge (18px circle) bottom-right
 *  - Urgent left rail #FF453A, unread dot teal
 *  - White/dark surface card, borderRadius 14
 *  - Project colour dot + task name below message
 *  - Timestamp monospace top-right
 *  - Auto-dismisses after 5s with animated progress rail
 */
import React, { useEffect, useRef } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Platform,
  Animated, Pressable,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../theme/ThemeProvider';
import { useNotifications } from '../context/NotificationContext';
import { navigationRef } from '../nav/navigationRef';
import type { Notification } from '../api/types';
import { AVATAR_COLORS } from '../theme/tokens';
import { toneFor } from '../theme/tones';
import { amplitude, duration, useReducedMotion, DUR, EASE } from '../theme/motion';
import { a11yButton, hitSlopTo } from './a11y';

// The tone map used to live here as eight hardcoded hexes with translucent
// washes tuned for the cream canvas. It did not flip with the theme, so on the
// near-black dark surface four of the eight icons fell under the 3:1 non-text
// floor — `assigned` at 2.14:1, `status` at 2.45:1, `success` at 2.63:1,
// `comment` at 2.73:1. It was also the third copy of a map that InboxScreen and
// MeScreen already had, token-driven and correct. All three now read
// theme/tones.ts. See that file for the measurements.
//
// AVATAR_COLORS likewise comes from theme/tokens — this file kept a private copy
// that led with the retired #0082c6, so the same user had two different avatar
// colours depending on which surface rendered them.
const AUTO_DISMISS_MS = 5000;

function initials(name: string) {
  return name.split(' ').map(w => w[0] ?? '').join('').slice(0, 2).toUpperCase();
}
function colorFromId(id: string) {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = id.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

// ── Single banner card ────────────────────────────────────────────────────────
function BannerCard({ notif, onDismiss }: { notif: Notification; onDismiss: () => void }) {
  const { t }     = useTheme();
  const reduced   = useReducedMotion();
  // 0 → 1. The travel is applied by interpolation so `amplitude()` can collapse
  // it without the animation itself having to know.
  const enter     = useRef(new Animated.Value(0)).current;
  const progress  = useRef(new Animated.Value(1)).current;
  const tone      = toneFor(t, notif.type);
  const avatarBg  = colorFromId(notif.user_id);
  const senderInitials = initials(notif.title.split(' ').slice(0, 2).join(' ') || 'KA');

  useEffect(() => {
    /**
     * MOTION-SPEC §3, Toast row: in `translateX(16px)` + fade over `--dur-base`,
     * "mobile: `translateY(12px)`". Twelve pixels.
     *
     * This was `Animated.spring` from **-120px** — ten times the spec's travel,
     * on an unsourced `tension: 80, friction: 12` pair that no document
     * anywhere in this project contains, and with no duration for reduced
     * motion to collapse. A spring is the one animation shape where
     * `duration()` has nothing to act on, which is why the old code needed an
     * explicit `if (reduced) setValue(0)` branch to get the accessibility case
     * right at all. With a timing, both scalars apply and the branch is gone.
     */
    Animated.timing(enter, {
      toValue: 1,
      duration: duration(DUR.base, reduced),
      easing: EASE.emph,
      useNativeDriver: true,
    }).start();
    // The progress rail is kept in both cases. It is a 5-second linear width
    // change reporting how long is left before auto-dismiss — information, not
    // decoration — and removing it would leave the banner vanishing without
    // warning. It is also not the kind of motion reduced-motion targets: no
    // translation, no scale, no repetition.
    Animated.timing(progress, {
      toValue: 0, duration: AUTO_DISMISS_MS, useNativeDriver: false,
    }).start();
    const timer = setTimeout(onDismiss, AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [reduced]);

  const handlePress = () => {
    onDismiss();
    if (notif.task_id && navigationRef.isReady()) {
      navigationRef.navigate('TaskDetail', { taskId: notif.task_id });
    }
  };

  const s = styles(t);

  return (
    <Animated.View
      style={[
        s.card,
        {
          opacity: enter,
          transform: [{
            translateY: enter.interpolate({
              inputRange:  [0, 1],
              // §3's 12px for the mobile toast, negative because this one enters
              // from above rather than below.
              outputRange: [-amplitude(12, reduced), 0],
            }),
          }],
        },
      ]}
    >
      <Pressable onPress={handlePress} style={s.inner}>
        {/* Left urgent rail. `t.error` rather than the iOS system red #FF453A:
            MOTION-SPEC §6 gives destructive/urgent to --danger, and the literal
            was the same colour in dark mode as in light. */}
        <View style={[s.leftRail, { backgroundColor: notif.type === 'approval_request' ? t.error : 'transparent' }]} />

        {/* Avatar + tone badge */}
        <View style={s.avatarWrap}>
          <View style={[s.avatar, { backgroundColor: avatarBg }]}>
            <Text style={s.avatarText}>{senderInitials}</Text>
          </View>
          <View style={[s.toneBadge, { backgroundColor: tone.bg, borderColor: t.surface }]}>
            <Ionicons name={tone.icon as any} size={9} color={tone.fg} />
          </View>
        </View>

        {/* Content */}
        <View style={s.content}>
          <Text style={[s.title, { color: t.ink }]} numberOfLines={1}>{notif.title}</Text>
          <Text style={[s.message, { color: t.ink3 }]} numberOfLines={2}>{notif.message}</Text>
        </View>

        {/* Dismiss. 14px icon + 4px padding either side = 22px drawn; hitSlopTo
            takes it to MOTION-SPEC §5's 44px without growing the box. The
            previous `hitSlop={10}` landed at 42 — close enough to look right and
            not close enough to be right. It also had no accessibility label, so
            a screen reader announced the dismiss control as an unlabelled
            button on a toast that auto-dismisses in five seconds. */}
        <TouchableOpacity
          onPress={onDismiss}
          hitSlop={hitSlopTo(22)}
          style={s.closeBtn}
          {...a11yButton('Dismiss notification')}
        >
          <Ionicons name="close" size={14} color={t.ink3} accessibilityElementsHidden />
        </TouchableOpacity>
      </Pressable>

      {/* Progress rail */}
      <Animated.View style={[s.progressRail, {
        width: progress.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }),
        backgroundColor: tone.fg,
      }]} />
    </Animated.View>
  );
}

// ── Container — renders all fresh banners stacked from top ────────────────────
export function NotificationBannerContainer() {
  const { fresh, dismissFresh } = useNotifications();
  const insets = useSafeAreaInsets();

  if (fresh.length === 0) return null;

  return (
    <View style={[containerStyles.wrap, { top: insets.top + (Platform.OS === 'android' ? 8 : 4) }]}
      pointerEvents="box-none"
    >
      {fresh.slice(0, 3).map(n => (
        <BannerCard
          key={n.notification_id}
          notif={n}
          onDismiss={() => dismissFresh(n.notification_id)}
        />
      ))}
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const styles = (t: ReturnType<typeof useTheme>['t']) => StyleSheet.create({
  card: {
    backgroundColor: t.surface,
    borderRadius: 14,
    marginBottom: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: Platform.OS === 'ios' ? 0.14 : 0.22,
    shadowRadius: 12,
    elevation: 8,
    overflow: 'hidden',
  },
  inner: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingRight: 12,
    gap: 10,
  },
  leftRail: {
    width: 3,
    alignSelf: 'stretch',
    borderRadius: 2,
    marginRight: 2,
  },
  avatarWrap: {
    position: 'relative',
    marginLeft: 10,
  },
  avatar: {
    width: 34, height: 34, borderRadius: 17,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarText: {
    fontSize: 12, fontWeight: '700', color: '#fff',
  },
  toneBadge: {
    position: 'absolute', bottom: -3, right: -4,
    width: 18, height: 18, borderRadius: 9,
    borderWidth: 2,
    alignItems: 'center', justifyContent: 'center',
  },
  content: {
    flex: 1, minWidth: 0,
  },
  title: {
    fontSize: 13.5, fontWeight: '600', lineHeight: 18,
  },
  message: {
    fontSize: 12.5, lineHeight: 17, marginTop: 1,
  },
  closeBtn: {
    padding: 4,
  },
  progressRail: {
    height: 2,
    borderRadius: 1,
  },
});

const containerStyles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 12, right: 12,
    zIndex: 999,
  },
});
