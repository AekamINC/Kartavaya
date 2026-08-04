import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, SectionList, Pressable, TextInput, StyleSheet, ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeProvider';
import { hindi, FAMILY } from '../theme/fonts';
import { useAuth } from '../hooks/useAuth';
import { useOnline } from '../hooks/useOnline';
import RichText from '../components/RichText';
import ScreenState, { resolveScreenState } from '../components/ScreenState';
import { a11yButton, a11yInput } from '../components/a11y';
import { avatarColor, userInitials } from '../theme/tokens';
import {
  messagesApi, isUuid,
  type SearchHit, type SearchPage, type ChannelType,
} from '../api/messages';
import type { RootStackParamList } from '../nav/RootStack';

/**
 * Search — across every channel this account can read, or inside one.
 *
 * ── The debounce is the feature ──────────────────────────────────────────────
 *
 * `GET /v1/messaging/search` is a GIN index scan OR-ed with a trigram scan, and
 * a phone keyboard emits a keystroke roughly every 150ms. Un-debounced, typing
 * "invoice" is seven full-text searches of which six are thrown away, and the
 * six wasted ones are the expensive ones — a two- or three-character prefix
 * matches half the corpus. 300ms is what the server's own comment assumes.
 *
 * The debounce also has to gate the QUERY KEY, not just the request. A key that
 * changes per keystroke mints a cache entry per keystroke; `search` is excluded
 * from MMKV persistence for exactly that reason, but an unbounded set of live
 * entries is still an unbounded set.
 *
 * ── Paging ───────────────────────────────────────────────────────────────────
 *
 * OFFSET, not keyset, because a result set ordered by recency within a match set
 * has no stable cursor — a new matching message shifts every page boundary. The
 * server caps `offset` at 500 and 422s above it, so this stops at 500 and says
 * so rather than inventing a cursor the endpoint does not have.
 *
 * `more` comes from a `limit + 1` look-ahead. There is no COUNT and there is no
 * total, so "247 results" is not a number this screen can honestly show.
 *
 * ── The envelope ─────────────────────────────────────────────────────────────
 *
 * This is the ONE endpoint in the messaging router that returns neither a bare
 * array nor a bare object: `{ results, more }`. Reading `.data` off it yields
 * `undefined` and a silent zero-result screen, which has already fooled one test
 * into accusing the product of losing a message. `messagesApi.search` unwraps it;
 * this screen reads `page.results`.
 */

type Nav   = NativeStackNavigationProp<RootStackParamList, 'Search'>;
type Route = RouteProp<RootStackParamList, 'Search'>;
type Glyph = keyof typeof Ionicons.glyphMap;

/** Matches the server default. Also the offset step — see `getNextPageParam`. */
const PAGE = 25;
/** `offset: int = Query(0, ge=0, le=500)`. Past this the server 422s. */
const MAX_OFFSET = 500;
/** The server's own comment assumes a 300ms debounce. */
const DEBOUNCE_MS = 300;
/** `q: str = Query(..., min_length=2, max_length=120)`. Enforced here so a
 *  validation failure never happens: a FastAPI 422 carries `detail` as an ARRAY,
 *  and `client.ts` tests `typeof detail === 'string'`, so every one of them reads
 *  "Something went wrong. Please try again." */
const MIN_Q = 2;
const MAX_Q = 120;

const CHANNEL_ICON: Record<ChannelType, Glyph> = {
  public:  'globe-outline',
  private: 'lock-closed-outline',
  dm:      'person-outline',
};

const iconFor = (type: ChannelType): Glyph => CHANNEL_ICON[type] ?? 'chatbubble-outline';

function whenOf(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

interface Group {
  key:  string;
  name: string;
  type: ChannelType;
  data: SearchHit[];
}

export default function SearchScreen() {
  const { t } = useTheme();
  const insets = useSafeAreaInsets();
  const nav = useNavigation<Nav>();
  const route = useRoute<Route>();
  const { user } = useAuth();
  const online = useOnline();

  const meName = user?.full_name ?? user?.name ?? null;

  /**
   * Scope is STATE, not a route param read straight through.
   *
   * Arriving from a channel header pre-scopes the search to that channel, and
   * the reader must be able to drop the scope without going back and starting
   * again — "it's not in this channel, where is it?" is the second thing anyone
   * searches for. The chip below the field is that control.
   */
  const [scope, setScope] = useState<{ id: string; name?: string } | null>(
    isUuid(route.params?.channelId)
      ? { id: route.params!.channelId!, name: route.params?.channelName }
      : null,
  );

  const [raw, setRaw] = useState('');
  const [q, setQ] = useState('');

  // The debounce. Trimmed here so `q` — which is both the request and the query
  // key — never differs from what was actually sent.
  useEffect(() => {
    const id = setTimeout(() => setQ(raw.trim()), DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [raw]);

  const active = q.length >= MIN_Q;

  const query = useInfiniteQuery({
    // The key's shape is fixed by the spec at [q, channelId, fromUser]. There is
    // no from-user filter on this screen yet — the directory picker belongs to
    // the composer — so the slot is held by null rather than dropped, and adding
    // the filter later does not silently collide with every cached page.
    queryKey: ['messaging', 'search', q, scope?.id ?? null, null],
    queryFn: ({ pageParam }) =>
      messagesApi.search({ q, channelId: scope?.id, limit: PAGE, offset: pageParam }),
    initialPageParam: 0,
    getNextPageParam: (last: SearchPage, all: SearchPage[]) => {
      if (!last.more) return undefined;
      const next = all.length * PAGE;
      // Stop AT the cap rather than sending 525 and taking a 422. The footer
      // says why, because a list that just stops reads as a bug.
      return next > MAX_OFFSET ? undefined : next;
    },
    enabled: active,
    staleTime: 60_000,
  });

  /**
   * Flattened, and DEDUPLICATED — which offset paging makes necessary.
   *
   * Page two is `OFFSET 25` over a predicate that is re-evaluated at request
   * time. If a new matching message arrives between the two requests everything
   * shifts down one row, so the last hit of page one comes back as the first hit
   * of page two. That is a duplicate React key, which RN reports as a warning and
   * renders as the same message twice — and the reader has no way to tell a real
   * repeated message from a paging artefact.
   *
   * Not fixable with a cursor: a result set ordered by recency within a match set
   * has no stable one, which is why the endpoint is offset-paged in the first
   * place. First occurrence wins, so the earlier (higher-ranked) position holds.
   */
  const hits = useMemo(() => {
    const seen = new Set<string>();
    const out: SearchHit[] = [];
    for (const page of query.data?.pages ?? []) {
      for (const hit of page.results) {
        if (seen.has(hit.id)) continue;
        seen.add(hit.id);
        out.push(hit);
      }
    }
    return out;
  }, [query.data]);

  /**
   * Grouped by channel, in order of first appearance.
   *
   * The server orders by recency across the whole match set, so first appearance
   * means the channel holding the most recent hit leads, and recency is
   * preserved WITHIN each group. Grouping necessarily scatters the global time
   * order — that is the trade being made deliberately: "which conversation was
   * this in" is the question a search of a chat product is actually answering,
   * and a flat recency list makes the reader reconstruct it row by row.
   *
   * Rebuilt from the whole accumulated array rather than per page, so page two
   * merges into the groups page one created instead of repeating their headers.
   */
  const sections = useMemo((): Group[] => {
    const order: string[] = [];
    const byChannel = new Map<string, Group>();
    for (const hit of hits) {
      let g = byChannel.get(hit.channel_id);
      if (!g) {
        g = { key: hit.channel_id, name: hit.channel_name, type: hit.channel_type, data: [] };
        byChannel.set(hit.channel_id, g);
        order.push(hit.channel_id);
      }
      g.data.push(hit);
    }
    return order.map(id => byChannel.get(id)!);
  }, [hits]);

  const names = useMemo(() => {
    const set = new Set<string>();
    for (const h of hits) if (h.sender_name) set.add(h.sender_name);
    if (meName) set.add(meName);
    return [...set];
  }, [hits, meName]);

  const status = resolveScreenState({
    isLoading: query.isLoading,
    isError:   query.isError,
    error:     query.error,
    online,
    hasData:   query.data !== undefined,
    isEmpty:   query.data !== undefined && hits.length === 0,
  });

  const pages = query.data?.pages ?? [];
  /** The server said there is more but the offset cap says we cannot fetch it. */
  const cappedOut = !!pages[pages.length - 1]?.more && !query.hasNextPage;

  const loadMore = useCallback(() => {
    if (query.hasNextPage && !query.isFetchingNextPage) query.fetchNextPage();
  }, [query]);

  /**
   * A hit inside a thread reply is NOT a row `list_messages` will ever return —
   * that query filters `parent_message_id IS NULL`. Passing the root is what
   * makes ChatScreen open the thread sheet instead of scrolling the channel
   * hunting for a message that is not in it. `/search` returns
   * `parent_message_id` for exactly this reason; `/pins` does not, which is why
   * a pinned reply cannot do the same.
   */
  const open = useCallback((hit: SearchHit) => {
    if (!isUuid(hit.channel_id)) return;
    nav.navigate('Chat', {
      channelId:   hit.channel_id,
      channelName: hit.channel_name,
      message:     isUuid(hit.id) ? hit.id : undefined,
      thread:      isUuid(hit.parent_message_id) ? hit.parent_message_id : undefined,
    });
  }, [nav]);

  return (
    <View style={[s.root, { backgroundColor: t.bg, paddingTop: insets.top }]}>
      <View style={s.header}>
        <Pressable onPress={() => nav.goBack()} hitSlop={10} {...a11yButton('Back')}>
          <Ionicons name="chevron-back" size={24} color={t.ink2} />
        </Pressable>

        <View style={[s.field, { backgroundColor: t.surfaceLow, borderColor: t.outlineVar }]}>
          <Ionicons name="search" size={16} color={t.ink3} />
          <TextInput
            value={raw}
            onChangeText={setRaw}
            placeholder="Search messages"
            placeholderTextColor={t.ink4}
            style={[s.input, { color: t.ink }]}
            autoFocus
            autoCorrect={false}
            autoCapitalize="none"
            returnKeyType="search"
            maxLength={MAX_Q}
            {...a11yInput('Search messages')}
          />
          {raw.length > 0 && (
            <Pressable onPress={() => setRaw('')} hitSlop={10} {...a11yButton('Clear search')}>
              <Ionicons name="close-circle" size={17} color={t.ink4} />
            </Pressable>
          )}
        </View>
      </View>

      <View style={s.subhead}>
        <Text style={[s.titleHi, { color: t.primaryText }]}>खोज</Text>
        {scope && (
          <Pressable
            onPress={() => setScope(null)}
            {...a11yButton(`Searching in ${scope.name ?? 'this channel'}. Tap to search everywhere.`)}
            style={({ pressed }) => [
              s.scopeChip,
              { backgroundColor: pressed ? t.surface3 : t.secondaryContainer },
            ]}
          >
            <Text style={[s.scopeText, { color: t.onSecondaryContainer }]} numberOfLines={1}>
              in {scope.name ?? 'this channel'}
            </Text>
            <Ionicons name="close" size={13} color={t.onSecondaryContainer} />
          </Pressable>
        )}
      </View>

      <SectionList
        sections={sections}
        keyExtractor={(hit) => hit.id}
        stickySectionHeadersEnabled={false}
        showsVerticalScrollIndicator={false}
        // Without this the first tap on a result only dismisses the keyboard,
        // and the reader has to tap the same row twice.
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        contentContainerStyle={[s.listPad, sections.length === 0 && s.listGrow]}
        onEndReached={loadMore}
        onEndReachedThreshold={0.4}
        renderSectionHeader={({ section }) => (
          <View style={s.sectionHead}>
            <Ionicons name={iconFor(section.type)} size={13} color={t.ink3} />
            <Text style={[s.sectionName, { color: t.ink2 }]} numberOfLines={1}>
              {section.name}
            </Text>
            <Text style={[s.sectionCount, { color: t.ink3 }]}>{section.data.length}</Text>
          </View>
        )}
        ListEmptyComponent={
          !active ? (
            <View style={s.empty}>
              <Ionicons name="search-outline" size={30} color={t.ink3} />
              <Text style={[s.emptyTitle, { color: t.ink }]}>
                {raw.trim().length > 0 ? 'Keep typing' : 'Search Sanvaad'}
              </Text>
              <Text style={[s.emptyBody, { color: t.ink3 }]}>
                {raw.trim().length > 0
                  ? `Searches start at ${MIN_Q} characters.`
                  : 'Find a message by what was said in it. Hindi and English both work.'}
              </Text>
            </View>
          ) : status === 'ready' ? null : status === 'empty' ? (
            <View style={s.empty}>
              <Ionicons name="file-tray-outline" size={30} color={t.ink3} />
              <Text style={[s.emptyTitle, { color: t.ink }]}>No messages matched</Text>
              <Text style={[s.emptyBody, { color: t.ink3 }]}>
                {scope
                  ? 'Nothing in this channel. Drop the channel filter above to search everywhere.'
                  : 'Only channels you can read are searched — a private channel you are not in will never appear here.'}
              </Text>
            </View>
          ) : (
            <ScreenState
              status={status}
              onRetry={() => query.refetch()}
              {...(status === 'error'
                ? {
                    title: "Couldn't run that search",
                    body:  'The server didn’t answer. This is not "no results" — try again in a moment.',
                  }
                : {})}
            />
          )
        }
        ListFooterComponent={
          query.isFetchingNextPage ? (
            <View style={s.footer}><ActivityIndicator size="small" color={t.primary} /></View>
          ) : cappedOut ? (
            <View style={s.footer}>
              <Text style={[s.footerNote, { color: t.ink3 }]}>
                There are more matches than this list can page through. Add a word, or
                search inside one channel.
              </Text>
            </View>
          ) : null
        }
        renderItem={({ item }) => (
          <HitRow
            hit={item}
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
 * One result.
 *
 * The server does NOT highlight — highlighting is a render concern and doing it
 * server-side would mean shipping markup down a JSON field. Nor does this row
 * highlight the term itself: the body goes through the same `RichText` the chat
 * uses, so `*bold*` and a code fence read the same here as they do in the
 * channel, and wrapping matched substrings would mean a second parser
 * disagreeing with the first.
 */
function HitRow({
  hit, t, names, meName, onPress,
}: {
  hit: SearchHit;
  t: ReturnType<typeof useTheme>['t'];
  names: string[];
  meName: string | null;
  onPress: () => void;
}) {
  const who = hit.sender_name ?? 'Someone';

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        s.row,
        { backgroundColor: pressed ? t.surface2 : t.surface, borderColor: t.outlineVar },
      ]}
      {...a11yButton(
        [
          `${who} in ${hit.channel_name}`,
          hit.pinned_at ? 'Pinned' : '',
          hit.parent_message_id ? 'In a thread' : '',
          hit.content,
          whenOf(hit.created_at),
        ].filter(Boolean).join(', '),
        'Opens the message',
      )}
    >
      <View style={[s.avatar, { backgroundColor: avatarColor(hit.sender_id) }]}>
        <Text style={s.avatarText}>{userInitials(who)}</Text>
      </View>

      <View style={s.rowBody}>
        <View style={s.rowHead}>
          <Text style={[s.sender, { color: t.ink }]} numberOfLines={1}>{who}</Text>
          {!!hit.pinned_at && <Ionicons name="pin" size={12} color={t.approval} />}
          {!!hit.parent_message_id && (
            <Ionicons name="return-down-forward-outline" size={13} color={t.ink3} />
          )}
          <Text style={[s.when, { color: t.ink4 }]}>{whenOf(hit.created_at)}</Text>
        </View>

        {/* Three lines rather than two: a search result has to carry enough of
            the message to tell whether it is the one being looked for. */}
        <RichText
          text={hit.content}
          names={names}
          meName={meName}
          color={t.ink2}
          fontSize={13.5}
          lineHeight={19}
          compact
          numberOfLines={3}
        />
      </View>
    </Pressable>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 16, paddingTop: 6, paddingBottom: 8,
  },
  field: {
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8,
    borderWidth: 1, borderRadius: 12, paddingHorizontal: 12,
    // 44 is the minimum touch target, and this is the control the whole screen
    // exists for.
    height: 44,
  },
  input: { flex: 1, fontSize: 15, padding: 0 },

  subhead: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 16, paddingBottom: 10,
  },
  // No fontWeight and no letterSpacing — Tiro has one weight, and RN applies
  // tracking after shaping, which pulls the shirorekha apart.
  titleHi: { fontSize: 13, ...hindi() },
  scopeChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    borderRadius: 99, paddingHorizontal: 10, paddingVertical: 5,
    flexShrink: 1,
  },
  scopeText: { fontSize: 12, fontWeight: '600', flexShrink: 1 },

  listPad: { paddingHorizontal: 16, paddingBottom: 32 },
  listGrow: { flexGrow: 1 },

  sectionHead: {
    flexDirection: 'row', alignItems: 'center', gap: 7,
    paddingTop: 16, paddingBottom: 6,
  },
  sectionName: { flex: 1, fontSize: 11.5, fontWeight: '700', letterSpacing: 0.6 },
  sectionCount: { fontSize: 11, fontFamily: FAMILY.mono },

  row: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    borderWidth: 1, borderRadius: 12, padding: 11, marginBottom: 8,
  },
  avatar: {
    width: 30, height: 30, borderRadius: 15,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  avatarText: { color: '#FFFFFF', fontSize: 11.5, fontWeight: '600', letterSpacing: 0.2 },
  rowBody: { flex: 1, minWidth: 0, gap: 3 },
  rowHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  sender: { fontSize: 13.5, fontWeight: '600', flexShrink: 1 },
  when: { fontSize: 11, fontFamily: FAMILY.mono, marginLeft: 'auto' },

  footer: { paddingVertical: 20, alignItems: 'center', paddingHorizontal: 24 },
  footerNote: { fontSize: 12, lineHeight: 18, textAlign: 'center' },
  empty: { alignItems: 'center', justifyContent: 'center', flex: 1, gap: 8, paddingHorizontal: 32 },
  emptyTitle: { fontSize: 15, fontWeight: '700', marginTop: 4, textAlign: 'center' },
  emptyBody: { fontSize: 13, lineHeight: 19, textAlign: 'center' },
});
