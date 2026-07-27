import React, { useCallback, useMemo, useState } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet,
  ActivityIndicator, ScrollView, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { format, isToday, isYesterday } from 'date-fns';
import { useTheme } from '../theme/ThemeProvider';
import Refresher from '../components/Refresher';
import { a11yButton, a11ySelected } from '../components/a11y';
import ScreenState, { resolveScreenState } from '../components/ScreenState';
import { useOnline } from '../hooks/useOnline';
import { notificationsApi } from '../api/notifications';
import { avatarColor, userInitials } from '../theme/tokens';
import { FAMILY } from '../theme/fonts';
import type { Notification, NotifKind } from '../api/types';
import type { RootStackParamList } from '../nav/RootStack';

type Nav = NativeStackNavigationProp<RootStackParamList, 'Main'>;
type Filter = 'all' | 'mentions' | 'approvals' | 'status' | 'comments';

const IS_ANDROID = Platform.OS === 'android';

// Map notification kind → tone → visual config
const KIND_TONE: Record<NotifKind, string> = {
  mention:          'mention',
  approval_request: 'approval',
  approved:         'success',
  rejected:         'danger',
  assigned:         'assigned',
  comment:          'comment',
  status_changed:   'status',
  done:             'success',
  created:          'neutral',
};

// For each tone: Ionicons icon name
const TONE_ICON: Record<string, string> = {
  mention:  'at',
  approval: 'checkmark',
  assigned: 'person-outline',
  comment:  'chatbubble-outline',
  status:   'swap-horizontal-outline',
  success:  'checkmark-done',
  danger:   'flag-outline',
  neutral:  'ellipse-outline',
};

const FILTER_CHIPS: Array<{ id: Filter; label: string; kinds: NotifKind[] | null }> = [
  { id: 'all',       label: 'All',       kinds: null },
  { id: 'mentions',  label: 'Mentions',  kinds: ['mention'] },
  { id: 'approvals', label: 'Approvals', kinds: ['approval_request', 'approved', 'rejected'] },
  { id: 'status',    label: 'Status',    kinds: ['status_changed', 'done', 'created'] },
  { id: 'comments',  label: 'Comments',  kinds: ['comment'] },
];

const FILTER_COUNTS: Record<Filter, number> = {
  all: 12, mentions: 2, approvals: 3, status: 3, comments: 2,
};

function relTime(iso: string): string {
  const d = new Date(iso);
  if (isToday(d))     return format(d, 'h:mm a');
  if (isYesterday(d)) return 'Yesterday';
  return format(d, 'd MMM');
}

function dayLabel(iso: string): { label: string; hi: string } {
  const d = new Date(iso);
  if (isToday(d))     return { label: 'Today',     hi: 'आज' };
  if (isYesterday(d)) return { label: 'Yesterday', hi: 'कल' };
  return { label: format(d, 'd MMMM'), hi: '' };
}

export default function InboxScreen() {
  const { t }   = useTheme();
  const nav     = useNavigation<Nav>();
  const insets  = useSafeAreaInsets();
  const qc      = useQueryClient();
  const [filter, setFilter] = useState<Filter>('all');

  const online = useOnline();

  const query = useQuery<Notification[]>({
    queryKey: ['notifications'],
    queryFn:  () => notificationsApi.list(),
    staleTime: 30_000,
  });
  const { isLoading, refetch, isFetching } = query;
  // Not a destructuring default: `= []` made a failed fetch indistinguishable
  // from an empty inbox, so a server error rendered "You're all caught up!".
  const notifications = query.data ?? [];

  const { mutate: markRead } = useMutation({
    mutationFn: (id: string) => notificationsApi.markRead([id]),
    onSuccess:  () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  });

  const filtered = useMemo(() => {
    const chip = FILTER_CHIPS.find(c => c.id === filter);
    if (!chip?.kinds) return notifications;
    // API returns 'type' field (NotifKind)
    return notifications.filter((n: Notification) => chip.kinds!.includes(n.type as any));
  }, [notifications, filter]);

  // Group by day
  type Group = { dayLabel: string; dayHi: string; dayKey: string; items: Notification[] };
  const groups = useMemo((): Group[] => {
    const map = new Map<string, Group>();
    filtered.forEach((n: Notification) => {
      const key = format(new Date(n.created_at), 'yyyy-MM-dd');
      if (!map.has(key)) {
        const dl = dayLabel(n.created_at);
        map.set(key, { dayLabel: dl.label, dayHi: dl.hi, dayKey: key, items: [] });
      }
      map.get(key)!.items.push(n);
    });
    return Array.from(map.values());
  }, [filtered]);

  const unreadCount = notifications.filter((n: Notification) => !n.read_at).length;

  const status = resolveScreenState({
    isLoading,
    isError: query.isError,
    error:   query.error,
    online,
    hasData: query.data !== undefined,
    isEmpty: query.data !== undefined && groups.length === 0,
  });

  return (
    <View style={[s.root, { backgroundColor: t.bg }]}>
      <FlatList
        data={groups}
        keyExtractor={g => g.dayKey}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 32 }}
        refreshControl={
          <Refresher refreshing={isFetching && !isLoading} onRefresh={refetch} />
        }
        ListHeaderComponent={
          <View>
            {/* ── Header ───────────────────────────────────────── */}
            <View style={[s.header, {
              backgroundColor: IS_ANDROID ? t.surface : t.bg,
              paddingTop: insets.top + (IS_ANDROID ? 8 : 54),
            }]}>
              <View style={s.kickerRow}>
                <Text style={[s.kicker, { color: t.primary }]}>Inbox</Text>
                <Text style={[s.kickerHi, { color: t.ink3 }]}>सूचना</Text>
              </View>
              <Text style={[s.screenTitle, { color: t.ink }]}>
                {unreadCount > 0 ? `${unreadCount} unread` : 'All caught up'}
              </Text>
            </View>

            {/* ── Filter chips ─────────────────────────────────── */}
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={s.chipsRow}
            >
              {FILTER_CHIPS.map(chip => {
                const active = filter === chip.id;
                const count  = FILTER_COUNTS[chip.id];
                return (
                  <TouchableOpacity
                    key={chip.id}
                    onPress={() => setFilter(chip.id)}
                    activeOpacity={0.7}
                    style={[
                      s.chip,
                      IS_ANDROID
                        ? {
                            backgroundColor: active ? t.secondaryContainer : 'transparent',
                            borderWidth: 1,
                            borderColor: active ? 'transparent' : t.outline,
                          }
                        : {
                            backgroundColor: active ? t.primary : t.surfaceLow,
                            borderWidth: 0,
                          },
                    ]}
                    {...a11ySelected(`${chip.label}, ${count}`, active)}
                  >
                    <Text style={[s.chipLabel, {
                      color: IS_ANDROID
                        ? (active ? t.onSecondaryContainer : t.ink2)
                        : (active ? '#fff' : t.ink2),
                    }]}>{chip.label}</Text>
                    <View style={[s.chipBadge, {
                      backgroundColor: IS_ANDROID
                        ? (active ? 'rgba(0,0,0,0.1)' : t.surface2)
                        : (active ? 'rgba(255,255,255,0.2)' : t.surface),
                    }]}>
                      <Text style={[s.chipBadgeText, {
                        color: IS_ANDROID
                          ? (active ? t.onSecondaryContainer : t.ink3)
                          : (active ? '#fff' : t.ink3),
                      }]}>{count}</Text>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>

          </View>
        }
        ListEmptyComponent={
          status === 'ready' ? null : status === 'empty' ? (
            <View style={s.empty}>
              <Text style={[s.emptyTitle, { color: t.ink }]}>No notifications</Text>
              <Text style={[s.emptyBody, { color: t.ink3 }]}>You're all caught up!</Text>
            </View>
          ) : (
            <ScreenState
              status={status}
              onRetry={() => refetch()}
              {...(status === 'error'
                ? {
                    title: "Couldn't load your inbox",
                    body:  'The server didn’t answer, so this is not an empty inbox — there may be notifications waiting.',
                  }
                : {})}
            />
          )
        }
        renderItem={({ item: group }) => (
          <View>
            {/* Day header */}
            <View style={s.dayHead}>
              <Text style={[s.dayLabel, { color: t.ink2 }]}>{group.dayLabel}</Text>
              {group.dayHi ? (
                <Text style={[s.dayHi, { color: t.ink3 }]}>{group.dayHi}</Text>
              ) : null}
              <Text style={[s.dayCount, { color: t.ink2 }]}>{group.items.length}</Text>
            </View>
            {/* Rows */}
            {group.items.map(n => (
              <InboxRow
                key={n.notification_id}
                n={n}
                t={t}
                onPress={() => {
                  if (!n.read_at) markRead(n.notification_id);
                  if (n.task_id) nav.navigate('TaskDetail', { taskId: n.task_id });
                }}
              />
            ))}
          </View>
        )}
      />
    </View>
  );
}

function InboxRow({
  n, t, onPress,
}: {
  n: Notification;
  t: any;
  onPress: () => void;
}) {
  const tone    = KIND_TONE[n.type] ?? 'neutral';
  const iconName = TONE_ICON[tone] ?? 'ellipse-outline';
  // Extract actor name: title is typically "Name did something"
  const actorName = (n as any).actor_name ?? n.title?.split(' ')[0] ?? 'Someone';
  const initials  = userInitials(actorName);
  const bgColor   = avatarColor((n as any).actor_id ?? actorName);

  // Badge container colors per tone (Android M3 containers)
  const badgeColors: Record<string, { bg: string; fg: string }> = {
    mention:  { bg: t.secondaryContainer,  fg: t.onSecondaryContainer },
    approval: { bg: t.tertiaryContainer,   fg: t.onTertiaryContainer },
    assigned: { bg: t.purpleContainer,     fg: t.purple },
    comment:  { bg: t.primaryContainer,    fg: t.onPrimaryContainer },
    status:   { bg: t.secondaryContainer,  fg: t.onSecondaryContainer },
    success:  { bg: t.primaryContainer,    fg: t.onPrimaryContainer },
    danger:   { bg: t.errorBg,             fg: t.error },
    neutral:  { bg: t.surface2,            fg: t.ink2 },
  };
  const badge = badgeColors[tone] ?? badgeColors.neutral;

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.75}
      style={[
        s.row,
        IS_ANDROID
          ? {
              backgroundColor: !n.read_at ? t.surfaceLow : 'transparent',
              borderLeftColor: (n as any).priority === 'urgent' ? t.error : 'transparent',
            }
          : {
              backgroundColor: t.surface,
              borderRadius: 14,
              marginHorizontal: 16,
              marginBottom: 6,
              borderLeftColor: (n as any).priority === 'urgent' ? '#FF453A' : 'transparent',
              shadowColor: '#000',
              shadowOffset: { width: 0, height: 1 },
              shadowOpacity: 0.04,
              shadowRadius: 2,
            },
      ]}
      /* Unread was a coloured bar and nothing else, and urgent was a coloured
         left border — both invisible to a screen reader. Read state goes in
         the label, which is the only carrier that survives (00 §12: never
         encode state in colour alone). */
      {...a11yButton(
        [
          n.read_at ? '' : 'Unread',
          (n as any).priority === 'urgent' ? 'Urgent' : '',
          `${actorName} ${n.message ?? ''}`.trim(),
          n.title ?? '',
          relTime(n.created_at),
        ].filter(Boolean).join(', '),
      )}
    >
      {/* Unread indicator */}
      {!n.read_at && (
        <View style={[
          s.unreadDot,
          IS_ANDROID
            ? { left: 8, top: '50%' as any, width: 4, height: 28, borderRadius: 2, backgroundColor: t.primary }
            : { left: 2, top: 18, width: 6, height: 6, borderRadius: 99, backgroundColor: t.primary },
        ]} />
      )}

      {/* Avatar col */}
      <View style={s.avatarCol}>
        <View style={[s.avatar, { backgroundColor: bgColor }]}>
          <Text style={s.avatarText}>{initials}</Text>
        </View>
        {/* Type badge */}
        <View style={[s.typeBadge, {
          backgroundColor: badge.bg,
          borderColor: t.surfaceLow,
        }]}>
          <Ionicons name={iconName as any} size={IS_ANDROID ? 12 : 11} color={badge.fg} />
        </View>
      </View>

      {/* Content */}
      <View style={s.content}>
        <Text style={[s.rowText, { color: t.ink }]} numberOfLines={2}>
          <Text style={s.actorName}>{actorName}</Text>
          <Text style={{ color: t.ink2 }}> {n.message ?? ''}</Text>
        </Text>
        {n.title ? (
          <View style={s.taskChip}>
            <View style={[s.taskDot, { backgroundColor: t.primary }]} />
            <Text style={[s.taskChipText, { color: t.ink3 }]} numberOfLines={1}>{n.title}</Text>
          </View>
        ) : null}
      </View>

      {/* Timestamp */}
      <Text style={[s.timestamp, { color: t.ink3 }]}>
        {relTime(n.created_at)}
      </Text>
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },

  header: {
    paddingHorizontal: 16,
    paddingBottom: 4,
  },
  kickerRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 8,
    marginBottom: 4,
  },
  kicker: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.4,
    textTransform: 'uppercase',
  },
  kickerHi: {
    fontSize: 12,
    fontFamily: FAMILY.devanagari,
  },
  screenTitle: {
    fontSize: IS_ANDROID ? 30 : 34,
    fontWeight: IS_ANDROID ? '500' : '400',
    lineHeight: IS_ANDROID ? 36 : 40,
    letterSpacing: -0.5,
    marginBottom: 2,
    fontFamily: IS_ANDROID ? undefined : FAMILY.display,
  },

  chipsRow: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: IS_ANDROID ? 10 : 8,
    gap: 8,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: IS_ANDROID ? 6 : 6,
    borderRadius: 99,
  },
  chipLabel: {
    fontSize: 13,
    fontWeight: IS_ANDROID ? '500' : '600',
    letterSpacing: IS_ANDROID ? 0.1 : -0.1,
  },
  chipBadge: {
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 99,
  },
  chipBadgeText: {
    fontSize: 10.5,
    fontFamily: FAMILY.mono,
  },

  dayHead: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 8,
    paddingHorizontal: IS_ANDROID ? 16 : 20,
    paddingTop: IS_ANDROID ? 16 : 12,
    paddingBottom: IS_ANDROID ? 4 : 6,
  },
  dayLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  dayHi: {
    fontSize: 12,
    fontFamily: FAMILY.devanagari,
    textTransform: 'none' as any,
    letterSpacing: 0,
  },
  dayCount: {
    marginLeft: 'auto' as any,
    fontSize: 12,
    fontFamily: FAMILY.mono,
  },

  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    paddingHorizontal: IS_ANDROID ? 16 : 12,
    paddingVertical: 12,
    borderLeftWidth: 3,
    position: 'relative',
  },
  unreadDot: {
    position: 'absolute',
  },
  avatarCol: {
    position: 'relative',
    flexShrink: 0,
  },
  avatar: {
    width: IS_ANDROID ? 40 : 34,
    height: IS_ANDROID ? 40 : 34,
    borderRadius: 99,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    color: '#fff',
    fontSize: IS_ANDROID ? 15 : 13,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
  typeBadge: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    width: IS_ANDROID ? 20 : 18,
    height: IS_ANDROID ? 20 : 18,
    borderRadius: 99,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
  },
  content: {
    flex: 1,
    minWidth: 0,
    gap: 4,
  },
  rowText: {
    fontSize: IS_ANDROID ? 14 : 13.5,
    lineHeight: 20,
  },
  actorName: {
    fontWeight: '600',
  },
  taskChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  taskDot: {
    width: 6,
    height: 6,
    borderRadius: 2,
    flexShrink: 0,
  },
  taskChipText: {
    fontSize: IS_ANDROID ? 12 : 11.5,
    flex: 1,
  },
  timestamp: {
    fontSize: IS_ANDROID ? 11.5 : 11,
    fontFamily: FAMILY.mono,
    paddingTop: 4,
  },

  empty: { alignItems: 'center', paddingTop: 60, gap: 8 },
  emptyTitle: { fontSize: 17, fontWeight: '600' },
  emptyBody:  { fontSize: 13 },
});
