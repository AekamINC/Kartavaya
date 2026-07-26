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
import type { Notification, NotifKind } from '../api/types';
import { AVATAR_COLORS } from '../theme/tokens';

// ── Tone → icon + colours (mirrors M_NOTIF_TONE_STYLES from mobile-shared.jsx) ──
const TONE: Record<string, { icon: string; fg: string; bg: string }> = {
  mention:  { icon: 'at',                   fg: '#04837A', bg: 'rgba(4,131,122,0.16)' },
  approval: { icon: 'shield-checkmark',      fg: '#B06A00', bg: 'rgba(255,159,10,0.18)' },
  assigned: { icon: 'person',               fg: '#6750A4', bg: 'rgba(167,139,250,0.18)' },
  comment:  { icon: 'chatbubble',           fg: '#0A7A6E', bg: 'rgba(5,183,170,0.16)' },
  status:   { icon: 'layers',               fg: '#3E5C8A', bg: 'rgba(62,92,138,0.14)' },
  success:  { icon: 'checkmark-circle',     fg: '#0A7A6E', bg: 'rgba(5,183,170,0.18)' },
  danger:   { icon: 'flag',                 fg: '#C0392B', bg: 'rgba(192,57,43,0.14)' },
  neutral:  { icon: 'layers',               fg: '#6E7B91', bg: 'rgba(60,60,67,0.10)' },
};

const KIND_TONE: Record<NotifKind, string> = {
  mention:          'mention',
  comment:          'comment',
  approval_request: 'approval',
  approved:         'success',
  rejected:         'danger',
  assigned:         'assigned',
  status_changed:   'status',
  done:             'success',
  created:          'neutral',
};

// AVATAR_COLORS now comes from theme/tokens — this file kept a private copy that
// led with the retired #0082c6, so the same user had two different avatar
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
  const slideY    = useRef(new Animated.Value(-120)).current;
  const progress  = useRef(new Animated.Value(1)).current;
  const tone      = TONE[KIND_TONE[notif.type]] ?? TONE.neutral;
  const avatarBg  = colorFromId(notif.user_id);
  const senderInitials = initials(notif.title.split(' ').slice(0, 2).join(' ') || 'KA');

  useEffect(() => {
    Animated.spring(slideY, { toValue: 0, useNativeDriver: true, tension: 80, friction: 12 }).start();
    Animated.timing(progress, {
      toValue: 0, duration: AUTO_DISMISS_MS, useNativeDriver: false,
    }).start();
    const timer = setTimeout(onDismiss, AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, []);

  const handlePress = () => {
    onDismiss();
    if (notif.task_id && navigationRef.isReady()) {
      navigationRef.navigate('TaskDetail', { taskId: notif.task_id });
    }
  };

  const s = styles(t);

  return (
    <Animated.View style={[s.card, { transform: [{ translateY: slideY }] }]}>
      <Pressable onPress={handlePress} style={s.inner}>
        {/* Left urgent rail */}
        <View style={[s.leftRail, { backgroundColor: notif.type === 'approval_request' ? '#FF453A' : 'transparent' }]} />

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

        {/* Dismiss */}
        <TouchableOpacity onPress={onDismiss} hitSlop={10} style={s.closeBtn}>
          <Ionicons name="close" size={14} color={t.ink3} />
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
