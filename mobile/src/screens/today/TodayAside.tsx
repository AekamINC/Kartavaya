import React from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';

import { useTheme } from '../../theme/ThemeProvider';
import { hindi } from '../../theme/fonts';
import { useLive } from '../../hooks/useLive';
import { approvalsApi, approvalTitle, type PendingApproval } from '../../api/approvals';
import { messagesApi } from '../../api/messages';
import { activityApi, activityVerb, activityIcon } from '../../api/activity';
import type { RootStackParamList } from '../../nav/RootStack';

type Nav = NativeStackNavigationProp<RootStackParamList>;

/**
 * Today's second column — 31-tablet.md §3.
 *
 * "Today | two columns, no detail | A summary, not a list of things you open.
 * Work and clock-in on the left, approvals, activity and unread on the right."
 *
 * ── WHY THIS IS A NEW COMPONENT AND NOT A LAYOUT CHANGE ─────────────────────
 *
 * §9 promises "no new screen components — every screen is the phone screen from
 * 17-mobile-app.md, placed in a pane", and that holds for Tasks, Messages,
 * Inbox and Approvals. It does NOT hold here, and pretending otherwise was the
 * trap: mobile's `TodayScreen` is a SectionList of TASKS only — Overdue, Due
 * today, This week, Later. The three things §3 puts in the right-hand column
 * simply do not exist on this platform.
 *
 * So a two-column Today was never a rearrangement. It was either this, or
 * splitting one task list down the middle — which reads worse than one column
 * and is not what §3 describes. Owner chose to build the surfaces, 2026-08-07.
 *
 * ── EVERY SOURCE HERE ALREADY EXISTED ───────────────────────────────────────
 *
 * Nothing is invented and no endpoint was added:
 *
 *   approvals  `GET /approvals/pending` — the Approvals screen's own query,
 *              same key, so react-query serves it from cache when that screen
 *              has been open and the column costs no request.
 *   activity   `GET /api/activity/feed` — the web dashboard's source. New to
 *              MOBILE, not new to the product.
 *   unread     the single `/live` poll already mounted in App.tsx, joined onto
 *              the channel list. NOT a new poll.
 *
 * ── THE JOIN IS DELIBERATE AND THE COMMENT IN messages.ts SAYS WHY ──────────
 *
 * `LivePayload.channels` includes public channels the caller never joined and
 * archived ones, because it is not filtered the way `GET /channels` is. Its own
 * doc is emphatic: "JOIN ON THE RAIL'S LIST; never iterate these keys to build
 * one." Iterating the payload would surface channels the user has never opened
 * as unread work waiting for them.
 */
export default function TodayAside() {
  const { t } = useTheme();
  const nav = useNavigation<Nav>();
  const live = useLive();

  // Same key as ApprovalsScreen, so this is a cache read whenever that screen
  // has been visited rather than a second request.
  const approvals = useQuery<PendingApproval[]>({
    queryKey: ['approvals', 'pending'],
    queryFn: approvalsApi.pending,
  });

  const activity = useQuery({
    queryKey: ['activity', 'feed', 6],
    queryFn: () => activityApi.feed(6),
    // A summary column, not a live feed. The Activity page is where you go to
    // watch; here a stale-by-a-minute list is the right trade for not
    // re-requesting every time Today regains focus.
    staleTime: 60_000,
  });

  const channels = useQuery({
    queryKey: ['messaging', 'channels'],
    // Not `queryFn: messagesApi.channels` — react-query passes its own context
    // object as the first argument, which is truthy, and the method's parameter
    // is `archived`. The rail hit exactly this and it silently returned the
    // ARCHIVED set. Same mistake, same file, so the same explicit wrapper.
    queryFn: () => messagesApi.channels(false),
  });

  /** Unread, joined onto the rail's list. See the header. */
  const unread = React.useMemo(() => {
    const rows = channels.data ?? [];
    return rows
      .map(ch => ({ ch, counts: live.channels[ch.id] }))
      .filter(x => (x.counts?.unread ?? 0) > 0 && !x.counts?.muted)
      .slice(0, 5);
  }, [channels.data, live.channels]);

  const section = (label: string, hi: string, count?: number) => (
    <View style={s.secHead}>
      <Text style={[s.sec, { color: t.ink3 }]}>{label}</Text>
      <Text style={[s.secHi, { color: t.ink4 }]}>{hi}</Text>
      {count !== undefined && count > 0 && (
        <Text style={[s.secCount, { color: t.primaryText }]}>{count}</Text>
      )}
    </View>
  );

  const pending = approvals.data ?? [];
  const events  = activity.data ?? [];

  return (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={s.pad}
      showsVerticalScrollIndicator={false}
    >
      {/* ── Waiting on you ─────────────────────────────────────────────── */}
      {section('Waiting on you', 'सम्मति', pending.length)}
      {pending.length === 0 ? (
        <Text style={[s.quiet, { color: t.ink4 }]}>Nothing needs your decision.</Text>
      ) : (
        pending.slice(0, 3).map(a => (
          <Pressable
            /*
             * `approval_id`, NOT `approvalTitle(a)`. The title was the key and
             * the tablet reported "each child in a list should have a unique
             * key" on every launch — `task_title` is typed `string` but the
             * synthesised task-approval rows arrive without it, so the key was
             * `undefined`. Two approvals on the same task would also have
             * collided. The id is the identity; the title is a label.
             */
            key={a.approval_id}
            onPress={() => nav.navigate('Approvals')}
            accessibilityRole="button"
            style={({ pressed }) => [s.row, { backgroundColor: pressed ? t.surface2 : 'transparent' }]}
          >
            <View style={[s.dot, { backgroundColor: t.approval }]} />
            <Text style={[s.rowText, { color: t.ink }]} numberOfLines={2}>{approvalTitle(a)}</Text>
          </Pressable>
        ))
      )}

      {/* ── Activity ───────────────────────────────────────────────────── */}
      {section('Activity', 'गतिविधि')}
      {activity.isError ? (
        // A FAILED LOAD IS NOT AN EMPTY FEED. The web dashboard's own header
        // records this exact defect: a swallowed error left the list at [] and
        // the page told the user there had been no activity.
        <Text style={[s.quiet, { color: t.ink4 }]}>Couldn't load recent activity.</Text>
      ) : events.length === 0 ? (
        <Text style={[s.quiet, { color: t.ink4 }]}>Nothing has happened yet today.</Text>
      ) : (
        events.map(e => (
          <View key={e.event_id} style={s.row}>
            <View style={[s.actIcon, { backgroundColor: t.surface2 }]}>
              <Ionicons name={activityIcon(e.type)} size={13} color={t.ink3} />
            </View>
            <Text style={[s.rowText, { color: t.ink2 }]} numberOfLines={2}>
              {/* "System" rather than blank: a deleted actor is not nobody, and
                  the web renders the same word for the same case. */}
              <Text style={{ fontWeight: '700', color: t.ink }}>{e.actor_name ?? 'System'}</Text>
              {' '}{activityVerb(e.type)}
              {!!e.task_title && <Text style={{ color: t.ink }}> · {e.task_title}</Text>}
            </Text>
          </View>
        ))
      )}

      {/* ── Unread ─────────────────────────────────────────────────────── */}
      {section('Unread', 'संवाद', unread.length)}
      {unread.length === 0 ? (
        <Text style={[s.quiet, { color: t.ink4 }]}>You are caught up.</Text>
      ) : (
        unread.map(({ ch, counts }) => (
          <Pressable
            key={ch.id}
            onPress={() => nav.navigate('Chat', { channelId: ch.id, channelName: ch.name ?? undefined })}
            accessibilityRole="button"
            accessibilityLabel={`${ch.name ?? 'Channel'}, ${counts?.unread ?? 0} unread`}
            style={({ pressed }) => [s.row, { backgroundColor: pressed ? t.surface2 : 'transparent' }]}
          >
            <Ionicons name="chatbubbles-outline" size={15} color={t.ink3} />
            <Text style={[s.rowText, { color: t.ink }]} numberOfLines={1}>{ch.name ?? 'Channel'}</Text>
            <Text
              style={[
                s.count,
                // A mention is a different KIND of unread — somebody typed your
                // name. The rail draws the same distinction.
                { color: (counts?.mentions ?? 0) > 0 ? t.error : t.ink3 },
              ]}
            >
              {(counts?.mentions ?? 0) > 0 ? '@' : ''}{counts?.unread ?? 0}
            </Text>
          </Pressable>
        ))
      )}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  pad: { paddingHorizontal: 18, paddingBottom: 32, paddingTop: 4 },
  secHead: {
    flexDirection: 'row', alignItems: 'baseline', gap: 7,
    paddingTop: 20, paddingBottom: 8,
  },
  sec:      { fontSize: 10.5, fontWeight: '700', letterSpacing: 1.3, textTransform: 'uppercase' },
  secHi:    { fontSize: 11, ...hindi() },
  secCount: { marginLeft: 'auto', fontSize: 12, fontWeight: '700' },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingVertical: 8, paddingHorizontal: 6, borderRadius: 8,
  },
  rowText: { flex: 1, fontSize: 13, lineHeight: 18 },
  quiet:   { fontSize: 12.5, lineHeight: 18, paddingHorizontal: 6 },
  dot:     { width: 7, height: 7, borderRadius: 4 },
  actIcon: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  count:   { fontSize: 12, fontWeight: '700' },
});
