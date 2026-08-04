import React, { useCallback, useMemo, useState } from 'react';
import {
  View, Text, FlatList, Pressable, StyleSheet, ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeProvider';
import { hindi, FAMILY } from '../theme/fonts';
import { useAuth } from '../hooks/useAuth';
import { useMentionUnread } from '../hooks/useLive';
import { useOnline } from '../hooks/useOnline';
import Refresher from '../components/Refresher';
import RichText from '../components/RichText';
import ScreenState, { resolveScreenState } from '../components/ScreenState';
import { a11yButton } from '../components/a11y';
import { avatarColor, userInitials, withAlpha } from '../theme/tokens';
import { messagesApi, isUuid, type Mention, type MentionKind } from '../api/messages';
import type { RootStackParamList } from '../nav/RootStack';

/**
 * Mentions — every message that named me, newest first.
 *
 * ── Why this is not a filter on the Inbox ────────────────────────────────────
 *
 * `InboxScreen` already has a "Mentions" chip, and it filters `NotifKind ===
 * 'mention'` over `GET /api/notifications`. That is a different feed: a
 * notification row is a *summary* with a `task_id`, and the inbox's tap handler
 * navigates only `if (n.task_id)` — which is `NULL` on every mention, so every
 * mention in that list has always been a dead row. This screen reads
 * `GET /v1/messaging/mentions`, which carries the message body, the channel, and
 * `parent_message_id`, and it lands the reader on the actual message.
 *
 * ── Paging ───────────────────────────────────────────────────────────────────
 *
 * KEYSET on a MENTION id, not a message id and not a timestamp. `before` is
 * `mention.id`, and the server compares `(created_at, id)` as a pair because
 * `fan_out_mentions` writes one row per recipient inside a single statement —
 * a whole batch shares `created_at` to the microsecond, so ordering on the
 * timestamp alone leaves a cursor sitting mid-batch able to drop or repeat its
 * neighbours.
 *
 * END OF FEED IS A SHORT PAGE. There is no `more` flag on this endpoint and no
 * total; a page shorter than `limit` is the only signal, which is why
 * `getNextPageParam` tests the length rather than reading a field that does not
 * exist.
 */

type Nav = NativeStackNavigationProp<RootStackParamList, 'Mentions'>;
type Glyph = keyof typeof Ionicons.glyphMap;

/** One server page. Also the "is there more" threshold — see the header. */
const PAGE = 30;

/**
 * `@here` and `@channel` are addressed to a room, not to a person, and a reader
 * scanning for the one message that actually needs them has to be able to tell
 * the two apart at a glance. The glyph is the only thing that does that before
 * the body is read.
 */
const KIND_ICON: Record<MentionKind, Glyph> = {
  user:    'at',
  here:    'people',
  channel: 'megaphone',
};

/** Rendered beside the channel for the two broadcast kinds. '' for a direct one. */
const KIND_LABEL: Record<MentionKind, string> = {
  user:    '',
  here:    '@here',
  channel: '@channel',
};

const iconFor = (kind: MentionKind): Glyph => KIND_ICON[kind] ?? 'at';

function relTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const mins = Math.floor((Date.now() - then) / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

export default function MentionsScreen() {
  const { t } = useTheme();
  const insets = useSafeAreaInsets();
  const nav = useNavigation<Nav>();
  const qc = useQueryClient();
  const { user } = useAuth();
  const online = useOnline();
  const liveUnread = useMentionUnread();

  /** Set when a row cannot be opened. See `open` below — silence is the defect. */
  const [notice, setNotice] = useState<string | null>(null);

  const meName = user?.full_name ?? user?.name ?? null;

  const query = useInfiniteQuery({
    queryKey: ['messaging', 'mentions'],
    queryFn: ({ pageParam }) => messagesApi.mentions({ limit: PAGE, before: pageParam }),
    // v5 requires the first cursor explicitly. `undefined` is "from the top".
    initialPageParam: undefined as string | undefined,
    // A short page is the end of the feed; see the header. The `?.id` guard is
    // for the empty first page, where `last[last.length - 1]` is undefined.
    getNextPageParam: (last: Mention[]) =>
      (last.length < PAGE ? undefined : last[last.length - 1]?.id),
    staleTime: 30_000,
  });

  // `?? []` rather than a destructuring default: `= []` erases the difference
  // between "no mentions" and "the request failed" before `hasData` can see it.
  const items = useMemo(
    () => (query.data?.pages ?? []).flat(),
    [query.data],
  );

  /**
   * Display names known on this surface, so a mention of a colleague inside a
   * quoted body highlights even when they are not the sender of the row.
   * `meName` is passed separately — `RichText` renders it in the "me" tone, and
   * on THIS screen every row contains it by definition.
   */
  const names = useMemo(() => {
    const set = new Set<string>();
    for (const m of items) if (m.sender_name) set.add(m.sender_name);
    if (meName) set.add(meName);
    return [...set];
  }, [items, meName]);

  const loadedUnread = items.filter(m => !m.read_at).length;
  const canMarkAll = loadedUnread > 0 || liveUnread > 0;

  /**
   * Both marks invalidate `['messaging','mentions']` and nothing else.
   *
   * Named prefixes only — `invalidateQueries({queryKey:['messaging']})` would
   * take the /live poll, the search cache and the directory with it, and restart
   * the poll out of phase.
   *
   * The Messages TAB badge is not invalidated here on purpose: it is fed by the
   * single /live poll, which refreshes it within one interval (≤20s with no
   * channel open). Reaching into that query from a screen is how two owners of
   * one cadence start fighting.
   *
   * Plain `useMutation`, NOT `useOfflineMutation`. A read-marker that replays
   * out of a queue two hours later clears a badge for messages the user never
   * saw, which is worse than the mark simply not happening.
   */
  const invalidateMentions = () =>
    qc.invalidateQueries({ queryKey: ['messaging', 'mentions'] });

  const markAll = useMutation({
    // `{mark_all: true}` with NO channel_id — the whole org. `markMentionsRead`
    // throws rather than sending an invalid channel_id, because the server
    // silently DROPS a malformed one and then marks everything read anyway.
    mutationFn: () => messagesApi.markMentionsRead({ mark_all: true }),
    onSuccess: invalidateMentions,
  });

  const markOne = useMutation({
    mutationFn: (id: string) => messagesApi.markMentionsRead({ mention_ids: [id] }),
    onSuccess: invalidateMentions,
  });

  /**
   * Open the message this row is quoting.
   *
   * `parent_message_id` is the THREAD ROOT when the mention was written inside a
   * reply. Threads are flat, so the parent IS the root and there is nothing to
   * walk. Passing it is what makes ChatScreen open the thread sheet rather than
   * scrolling the channel hunting for a message `list_messages` never returns —
   * `parent_message_id IS NULL` is in that query's WHERE clause, so a reply is
   * simply not in the channel's history.
   *
   * A malformed `message_id` is dropped and the reader still lands in the right
   * room. A malformed `channel_id` has nowhere to land, so it SAYS SO: this list
   * is quoting the message's text at the reader, and refusing to show it without
   * a word is indistinguishable from a slow network.
   */
  const open = useCallback((m: Mention) => {
    if (!isUuid(m.channel_id)) {
      setNotice('That conversation can’t be opened from here. It may have been deleted.');
      return;
    }
    if (!m.read_at) markOne.mutate(m.id);
    nav.navigate('Chat', {
      channelId:   m.channel_id,
      channelName: m.channel_name,
      message:     isUuid(m.message_id) ? m.message_id : undefined,
      thread:      isUuid(m.parent_message_id) ? m.parent_message_id : undefined,
    });
  }, [nav, markOne]);

  const status = resolveScreenState({
    isLoading: query.isLoading,
    isError:   query.isError,
    error:     query.error,
    online,
    hasData:   query.data !== undefined,
    isEmpty:   query.data !== undefined && items.length === 0,
  });

  const loadMore = useCallback(() => {
    if (query.hasNextPage && !query.isFetchingNextPage) query.fetchNextPage();
  }, [query]);

  return (
    <View style={[s.root, { backgroundColor: t.bg, paddingTop: insets.top }]}>
      <View style={s.header}>
        <Pressable onPress={() => nav.goBack()} hitSlop={10} {...a11yButton('Back')}>
          <Ionicons name="chevron-back" size={24} color={t.ink2} />
        </Pressable>

        <View style={s.headerTitles}>
          <Text style={[s.title, { color: t.ink }]}>Mentions</Text>
          <Text style={[s.titleHi, { color: t.primaryText }]}>उल्लेख</Text>
        </View>

        {canMarkAll && (
          <Pressable
            onPress={() => markAll.mutate()}
            disabled={markAll.isPending}
            hitSlop={8}
            {...a11yButton('Mark all mentions read')}
            style={({ pressed }) => [
              s.markAll,
              { borderColor: t.outline, backgroundColor: pressed ? t.surface2 : 'transparent' },
            ]}
          >
            {markAll.isPending
              ? <ActivityIndicator size="small" color={t.primaryText} />
              : <Text style={[s.markAllText, { color: t.primaryText }]}>Mark all read</Text>}
          </Pressable>
        )}
      </View>

      {notice && (
        <View style={[s.notice, { backgroundColor: t.tertiaryContainer }]}>
          <Ionicons name="alert-circle-outline" size={16} color={t.onTertiaryContainer} />
          <Text style={[s.noticeText, { color: t.onTertiaryContainer }]}>{notice}</Text>
          <Pressable onPress={() => setNotice(null)} hitSlop={8} {...a11yButton('Dismiss')}>
            <Ionicons name="close" size={16} color={t.onTertiaryContainer} />
          </Pressable>
        </View>
      )}

      <FlatList
        data={items}
        keyExtractor={(m) => m.id}
        contentContainerStyle={[s.listPad, items.length === 0 && s.listGrow]}
        showsVerticalScrollIndicator={false}
        onEndReached={loadMore}
        onEndReachedThreshold={0.4}
        refreshControl={
          <Refresher
            refreshing={query.isRefetching && !query.isFetchingNextPage}
            onRefresh={query.refetch}
          />
        }
        ListEmptyComponent={
          status === 'ready' ? null : status === 'empty' ? (
            <View style={s.empty}>
              <Ionicons name="at-outline" size={30} color={t.ink3} />
              <Text style={[s.emptyTitle, { color: t.ink }]}>No one has mentioned you</Text>
              <Text style={[s.emptyBody, { color: t.ink3 }]}>
                When a colleague types your name in a channel, the message lands here.
              </Text>
            </View>
          ) : (
            <ScreenState
              status={status}
              onRetry={() => query.refetch()}
              {...(status === 'error'
                ? {
                    title: "Couldn't load your mentions",
                    body:  'The server didn’t answer, so this is not an empty list — someone may be waiting on you.',
                  }
                : {})}
            />
          )
        }
        ListFooterComponent={
          query.isFetchingNextPage ? (
            <View style={s.footer}><ActivityIndicator size="small" color={t.primary} /></View>
          ) : null
        }
        renderItem={({ item }) => (
          <MentionRow
            m={item}
            t={t}
            names={names}
            meName={meName}
            onPress={() => open(item)}
          />
        )}
      />
    </View>
  );
}

/**
 * One mention.
 *
 * Local to this file rather than exported, per the spec's rule about
 * sub-components: a prop chain that crosses a file boundary is a prop chain two
 * agents can rewrite both ends of while nobody touches the middle.
 */
function MentionRow({
  m, t, names, meName, onPress,
}: {
  m: Mention;
  t: ReturnType<typeof useTheme>['t'];
  names: string[];
  meName: string | null;
  onPress: () => void;
}) {
  const unread = !m.read_at;
  const who = m.sender_name ?? 'Someone';
  const kindLabel = KIND_LABEL[m.kind] ?? '';

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        s.row,
        {
          // Unread is carried by THREE things — fill, the left rule, and the
          // word "Unread" in the accessibility label. Colour alone is not a
          // state anyone can rely on.
          backgroundColor: pressed ? t.surface2 : (unread ? withAlpha(t.primary, 0.07) : t.surface),
          borderColor:     unread ? t.primaryContainer : t.outlineVar,
          borderLeftColor: unread ? t.primary : 'transparent',
        },
      ]}
      {...a11yButton(
        [
          unread ? 'Unread' : '',
          kindLabel,
          `${who} in ${m.channel_name}`,
          m.content,
          relTime(m.created_at),
        ].filter(Boolean).join(', '),
        'Opens the message',
      )}
    >
      <View style={s.avatarCol}>
        <View style={[s.avatar, { backgroundColor: avatarColor(m.sender_id) }]}>
          <Text style={s.avatarText}>{userInitials(who)}</Text>
        </View>
        <View style={[s.kindBadge, { backgroundColor: t.secondaryContainer, borderColor: t.bg }]}>
          <Ionicons name={iconFor(m.kind)} size={11} color={t.onSecondaryContainer} />
        </View>
      </View>

      <View style={s.rowBody}>
        <View style={s.rowHead}>
          <Text
            style={[s.channel, { color: t.ink, fontWeight: unread ? '700' : '600' }]}
            numberOfLines={1}
          >
            {m.channel_name}
          </Text>
          <Text style={[s.when, { color: t.ink4 }]}>{relTime(m.created_at)}</Text>
        </View>

        <View style={s.metaRow}>
          <Text style={[s.sender, { color: t.ink3 }]} numberOfLines={1}>{who}</Text>
          {!!kindLabel && (
            <Text style={[s.kindText, { color: t.onSecondaryContainer }]}>{kindLabel}</Text>
          )}
          {!!m.parent_message_id && (
            // Says up front that the tap lands inside a thread rather than in
            // the channel — otherwise the reader arrives somewhere they did not
            // expect and reads it as the app losing its place.
            <Text style={[s.kindText, { color: t.ink3 }]}>in a thread</Text>
          )}
        </View>

        {/* `compact` AND `numberOfLines` together. `compact` alone collapses the
            blocks but still renders a full-height paragraph inside a list row;
            `numberOfLines` alone leaves a code fence drawing its box here. */}
        <RichText
          text={m.content}
          names={names}
          meName={meName}
          color={t.ink2}
          fontSize={13.5}
          lineHeight={19}
          compact
          numberOfLines={2}
        />
      </View>
    </Pressable>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 16, paddingTop: 6, paddingBottom: 12,
  },
  headerTitles: { flex: 1 },
  title: { fontSize: 24, fontWeight: '700', letterSpacing: -0.4 },
  // No fontWeight and no letterSpacing: Tiro ships one weight, and RN tracks
  // after shaping, which breaks the shirorekha.
  titleHi: { fontSize: 13, marginTop: 1, ...hindi() },
  markAll: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 7 },
  markAllText: { fontSize: 12.5, fontWeight: '700' },

  notice: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    marginHorizontal: 16, marginBottom: 8,
    borderRadius: 10, paddingHorizontal: 10, paddingVertical: 9,
  },
  noticeText: { flex: 1, fontSize: 12.5, lineHeight: 18 },

  listPad: { paddingHorizontal: 16, paddingBottom: 32, gap: 8 },
  listGrow: { flexGrow: 1 },

  row: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 12,
    borderWidth: 1, borderLeftWidth: 3, borderRadius: 12, padding: 12,
  },
  avatarCol: { position: 'relative', flexShrink: 0 },
  avatar: {
    width: 36, height: 36, borderRadius: 18,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarText: { color: '#FFFFFF', fontSize: 13, fontWeight: '600', letterSpacing: 0.2 },
  kindBadge: {
    position: 'absolute', bottom: -3, right: -4,
    width: 18, height: 18, borderRadius: 9, borderWidth: 2,
    alignItems: 'center', justifyContent: 'center',
  },

  rowBody: { flex: 1, minWidth: 0, gap: 3 },
  rowHead: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  channel: { flex: 1, fontSize: 14.5 },
  when: { fontSize: 11, fontFamily: FAMILY.mono },
  metaRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' },
  sender: { fontSize: 12, flexShrink: 1 },
  kindText: { fontSize: 11, fontWeight: '700' },

  footer: { paddingVertical: 18, alignItems: 'center' },
  empty: { alignItems: 'center', justifyContent: 'center', flex: 1, gap: 8, paddingHorizontal: 32 },
  emptyTitle: { fontSize: 15, fontWeight: '700', marginTop: 4, textAlign: 'center' },
  emptyBody: { fontSize: 13, lineHeight: 19, textAlign: 'center' },
});
