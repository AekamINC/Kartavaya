import React, { useCallback, useMemo, useState } from 'react';
import {
  View, Text, FlatList, Pressable, StyleSheet, Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeProvider';
import { hindi } from '../theme/fonts';
import { withAlpha } from '../theme/tokens';
import { channelToneColor } from '../theme/channelTone';
import Refresher from '../components/Refresher';
import SwipeRow from '../components/SwipeRow';
import ScreenState, { resolveScreenState, statusOf } from '../components/ScreenState';
import { a11yButton } from '../components/a11y';
import { useOnline } from '../hooks/useOnline';
import { useOfflineMutation } from '../hooks/useOfflineMutation';
import { useLive, useMentionUnread } from '../hooks/useLive';
import { messagesApi, type Channel, type SanvaadAccess } from '../api/messages';

/**
 * Channel list. 17-mobile-app.md gives Messages the fourth tab slot because
 * messaging is the highest-frequency mobile action, moving Inbox under More.
 *
 * Unread is rendered as a count, not a dot: "how many" is the thing that decides
 * whether to open a channel now or later, and a dot throws that away.
 *
 * ── Two badges, and the asymmetry that makes them two ────────────────────────
 *
 * Muting suppresses the unread COUNT and never the MENTION. That is server
 * behaviour, not a client courtesy — neither `list_channels`' `mention_count`
 * (`messaging.py:619`) nor `/live`'s `mentions` and `mention_unread`
 * (`messaging.py:1580`, `:1645`) carries a `muted` predicate at all, so a muted
 * channel still reports every unread `samvada_mentions` row and only the
 * notification and the push are withheld. The count is the other way round: the
 * server sends `unread_count` regardless and the RAIL is what withholds it, in
 * `showUnread` below. It is also the whole reason there are two pills rather
 * than one with two colours: an unread count is information, and muting is
 * a statement that its information can wait; a mention is an obligation, and
 * nobody mutes their own name. The web writes the same rule at
 * `ChannelList.jsx:20` and gives the mention badge `--danger` against the
 * count's `--primary`, which is the pairing reproduced below.
 *
 * ── The palette: the ordinary one. There is no scope here any more ──────────
 *
 * This screen carried a Slate / indigo ground until 2026-08-07, on the reading
 * that Sanvaad and Sahayak were the two surfaces the owner approved a different
 * ground for. That was superseded: the web stylesheet behind it was deleted on
 * "scrap my slate approved", and the reference bundle contains zero Slate. Every
 * colour here comes from `t`, and `t` is now the product's own warm set.
 *
 * ── Channel colour ───────────────────────────────────────────────────────────
 *
 * Proposal 09: "You navigate by colour, not by reading the list." The tone goes
 * ON THE GLYPH TILE and nowhere else, which the proposal is emphatic about: the
 * row's border already carries selection, so putting identity there would make
 * the open channel lose its own colour at exactly the moment you are looking at
 * it. This rail has no selected row, but the rule is kept so that a phone and a
 * laptop teach the same thing.
 *
 * MIGRATION 100 IS NOT APPLIED, so `ch.color` is null on every row today and the
 * tone is derived from the channel id instead. `theme/channelTone.ts` owns that
 * fallback and the three states it has to be correct in.
 */

import type { RootStackParamList } from '../nav/RootStack';
import PaneHost, { EmptyPane } from '../components/PaneHost';
import ChatScreen from './ChatScreen';
import { useWindowClass } from '../hooks/useWindowClass';
import { devicePlatform } from '../nav/platform';

type Nav = NativeStackNavigationProp<RootStackParamList, 'Main'>;
type Glyph = keyof typeof Ionicons.glyphMap;

const CHANNEL_ICON: Record<Channel['type'], Glyph> = {
  public:  'globe-outline',
  private: 'lock-closed-outline',
  dm:      'person-outline',
};

/** A channel type the server adds later must not crash the list. */
const iconFor = (type: Channel['type']): Glyph => CHANNEL_ICON[type] ?? 'chatbubble-outline';

/**
 * The sentence `api/client.ts` already wrote onto the error.
 *
 * A refusal surfaces this rather than `e.message`, which axios fills with
 * "Request failed with status code 403". ChatScreen has the same four lines for
 * the same reason; they are not shared because there is no error-copy module to
 * put them in yet and inventing one for two callers is the larger change.
 */
function friendly(e: unknown): string | undefined {
  const m = (e as { friendlyMessage?: unknown } | null | undefined)?.friendlyMessage;
  return typeof m === 'string' && m ? m : undefined;
}

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

/**
 * A rail row: the channel as the list endpoint returned it, with the three
 * numbers the four-second poll may have moved since.
 */
interface RailRow {
  ch:       Channel;
  unread:   number;
  mentions: number;
  muted:    boolean;
  /** What the row actually SHOWS as a count. Muting hides it; a mention is not
   *  a count and is not covered by this. */
  showUnread: boolean;
  /** Bold the name exactly when the row carries something still to deal with.
   *  Derived from what is rendered rather than from `unread` directly, so a
   *  muted channel with forty unread messages is not shouted at the reader and
   *  a bold row always has a badge on it to explain itself. */
  loud:     boolean;
}

/** The only thing this screen writes. */
interface MuteVars { channelId: string; muted: boolean }

export default function MessagesScreen() {
  // The scoped Slate / indigo palette, not the product's cream one. `scheme` is
  // read as well because `channelToneColor` resolves a tone key per theme — the
  // two module ramps are opposite temperatures rather than one being a tint of
  // the other, so there is no theme-agnostic answer to "what colour is graha".
  const { t, scheme } = useTheme();
  const insets = useSafeAreaInsets();
  const nav = useNavigation<Nav>();
  const platform = devicePlatform();
  const { split } = useWindowClass(platform);
  /**
   * The open conversation, held above `PaneHost` per §6 so it survives a resize.
   *
   * NULL ON ARRIVAL, AND THAT IS THE DESIGN. §3: "Messages does not auto-open,
   * and the difference is the whole rule: opening a conversation marks it read,
   * and a side effect the user did not ask for is worse than a placeholder."
   * Tasks opens its first row because selecting a task changes nothing; landing
   * in a channel silently clears somebody's unread count.
   */
  const [openChat, setOpenChat] = useState<{ id: string; name: string } | null>(null);

  /** A navigation below the split floor, a selection above it. */
  const openChannel = (channelId: string, channelName: string) => {
    if (split) setOpenChat({ id: channelId, name: channelName });
    else nav.navigate('Chat', { channelId, channelName });
  };
  const qc = useQueryClient();
  const online = useOnline();

  const query = useQuery({
    queryKey: ['messaging', 'channels'],
    // NOT `queryFn: messagesApi.channels`. The method takes `archived = false`,
    // and react-query calls a bare queryFn with its own context object — which
    // is truthy, so the rail would silently request the ARCHIVED set and render
    // an org's dead channels as its live ones.
    queryFn: () => messagesApi.channels(),
    staleTime: 30_000,
  });
  // Not a destructuring default: `= []` makes a failed fetch indistinguishable
  // from an org with no channels, and the screen would claim the second when it
  // means the first. `query.data` stays readable as `undefined` below, which is
  // what `hasData` is computed from.
  //
  // Annotated rather than inferred: `Channel[] | undefined ?? []` widens to
  // `Channel[] | never[]`, and a method call on a union of two array types gets
  // no contextual parameter type — so `.map(ch => …)` below silently becomes
  // `any` under `noImplicitAny`. Every other screen that reads `query.data ?? []`
  // annotates the callback instead; annotating the binding fixes it once.
  const channels: Channel[] = query.data ?? [];
  const { refetch, isFetching, isLoading } = query;

  /**
   * The single `/live` poll, read rather than started.
   *
   * `LiveProvider` owns the only interval in the app (`hooks/useLive.ts`); this
   * screen subscribes. It deliberately does NOT invalidate
   * `['messaging','channels']` — refetching every channel's member count and
   * last-read timestamp every four seconds is the exact cost this design exists
   * to avoid. The counts are overlaid instead.
   */
  const live = useLive();
  const mentionUnread = useMentionUnread();

  const rail = useMemo<RailRow[]>(() => channels.map((ch) => {
    // `/live`'s map is keyed by channel uuid and is WIDER than this list: it
    // carries archived channels and public channels this user never joined,
    // neither of which `GET /channels` returns. So the join runs over the rail's
    // rows and never over the poll's keys.
    const l = live.channels[ch.id];
    const unread   = l ? l.unread   : ch.unread_count;
    const mentions = l ? l.mentions : ch.mention_count;
    /**
     * `muted` comes from the LIST row, not from the poll — the one place this
     * screen departs from the web's merge (`ChannelsTab.jsx:437` takes the
     * poll's value).
     *
     * Muting is not a count that drifts between polls; it changes only when
     * somebody toggles it, and the only toggle that can happen under the
     * reader's thumb is the swipe below, which writes this cache optimistically.
     * Taking the poll's value means the bell the user just tapped flips back
     * within four seconds whenever the write is still queued — which is every
     * time they do it on a train, which is when they most want it. A mute set on
     * the web instead arrives with the next channels fetch rather than the next
     * poll; nobody notices thirty seconds, and everybody notices their own tap
     * being undone.
     */
    const muted = ch.muted;
    const showUnread = unread > 0 && !muted;
    return { ch, unread, mentions, muted, showUnread, loud: mentions > 0 || showUnread };
  }), [channels, live]);

  /**
   * Who is allowed to mute at all.
   *
   * `PUT /channels/{id}/mute` is a genuine write, so `require_module`'s verb gate
   * refuses a legacy `viewer` with a 403 before the handler runs
   * (`messaging.py:2127`), and `/me`'s `can_post` is that same predicate —
   * `level_satisfies(level, "editor", MODULE)` at `messaging.py:527`. So this is
   * the exact question, not an approximation of it.
   *
   * Same key, fetcher and staleTime as ChatScreen, so react-query serves one
   * request for both screens. The key is not in `offline/queryClient.ts`'s
   * `EPHEMERAL` set, so the answer is restored from MMKV on a cold start and the
   * rail knows it before the network does.
   *
   * Its failure is deliberately NOT folded into `resolveScreenState` below: `/me`
   * falling over says nothing about whether the channel list loaded, and blanking
   * a rail full of channels over it would be the false-empty defect in new
   * clothes.
   */
  const meQuery = useQuery<SanvaadAccess>({
    queryKey: ['messaging', 'me'],
    queryFn: () => messagesApi.me(),
    staleTime: 5 * 60_000,
  });
  // Optimistic until it answers, the same way ChatScreen's composer is: hiding
  // the control from an editor for the second `/me` takes is a worse lie than a
  // mute that 403s once — and that 403 now says so out loud instead of quietly
  // putting the bell back.
  const canPost = meQuery.data ? meQuery.data.can_post : true;

  /**
   * Put the rail back the way the server left it.
   *
   * Shared by `rollback` and `onError` below because only ONE of them actually
   * runs, and which one is not obvious from the call site:
   * `useOfflineMutation` builds its `useMutation` options with
   * `...opts.onlineOptions` LAST, so an `onError` supplied there REPLACES the
   * wrapper's — and the wrapper's is the only place `rollback` is ever called
   * from. Both are wired, and writing the same snapshot twice is the same
   * snapshot, so the bell comes back whichever way that precedence goes.
   */
  const revertChannels = useCallback((snapshot: Channel[] | undefined) => {
    if (snapshot) qc.setQueryData(['messaging', 'channels'], snapshot);
  }, [qc]);

  /**
   * Mute / unmute.
   *
   * Offline-queued rather than a plain mutation: this is a user-visible
   * preference, not a read marker, and it should survive a tunnel. The queue
   * squashes by `(method, url)`, so a mute-then-unmute before reconnect replays
   * as one PUT carrying the final answer rather than as two that race.
   */
  const mute = useOfflineMutation<MuteVars, unknown, Channel[]>({
    method: 'PUT',
    // The queue replays through `apiClient`, which already carries the `/api`
    // prefix — so this is the same path `messagesApi.setMute` posts to, and not
    // an absolute URL.
    urlBuilder: (v) => `/v1/messaging/channels/${v.channelId}/mute`,
    bodyBuilder: (v) => ({ muted: v.muted }),
    mutationFn: (v) => messagesApi.setMute(v.channelId, v.muted),
    optimisticId: (v) => `channel_${v.channelId}_mute`,
    entity_type: 'samvada_channel',
    entityId: (v) => v.channelId,
    snapshotKey: () => ['messaging', 'channels'],
    optimisticUpdate: (v, client) => {
      client.setQueryData<Channel[]>(['messaging', 'channels'], (old: Channel[] | undefined) =>
        old?.map((c: Channel) => (c.id === v.channelId ? { ...c, muted: v.muted } : c)));
    },
    rollback: (_v, snapshot) => revertChannels(snapshot),
    onlineOptions: {
      // Named second segment, never the bare `['messaging']` prefix — that would
      // take the live poll, the search cache and the directory with it and
      // restart the poll out of phase.
      onSettled: () => { qc.invalidateQueries({ queryKey: ['messaging', 'channels'] }); },
      /**
       * An optimistic update that reverts in silence is indistinguishable from a
       * control that does not work: the bell flips, the bell flips back, and the
       * user is left to guess whether they missed the gesture or the server said
       * no. So the refusal speaks.
       *
       * The control is hidden for a viewer below, which is where this stops
       * happening — but `/me` is cached for five minutes and a grant can be
       * lowered inside that window, so the 403 still has to have a sentence.
       * `friendlyMessage` for a 403 is the generic "You don't have permission to
       * do that", which does not say WHICH permission; this one names it.
       *
       * The snapshot arrives as the THIRD argument — v5 renamed it
       * `onMutateResult` and appended a `MutationFunctionContext` as the fourth.
       */
      onError: (err: Error, _v: MuteVars, snapshot: unknown) => {
        revertChannels(snapshot as Channel[] | undefined);
        Alert.alert(
          'Not changed',
          statusOf(err) === 403
            ? 'Muting a channel needs edit access to Sanvaad. Ask an admin to change your access.'
            : friendly(err) ?? 'Could not change notifications for this channel.',
        );
      },
    },
  });

  const status = resolveScreenState({
    isLoading,
    isError: query.isError,
    error:   query.error,
    online,
    hasData: query.data !== undefined,
    isEmpty: query.data !== undefined && rail.length === 0,
  });

  const list = (
    <View style={[s.root, { backgroundColor: t.bg, paddingTop: insets.top }]}>
      {/* Outside the list on purpose. A rail that failed to load still has to
          offer Search and Mentions — a header that lives in ListHeaderComponent
          disappears with the rows and takes both entry points with it. */}
      <View style={s.header}>
        <View style={s.headerText}>
          <Text style={[s.title, { color: t.ink }]}>Messages</Text>
          <Text style={[s.titleHi, { color: t.primaryText }]}>संवाद</Text>
        </View>

        <Pressable
          onPress={() => nav.navigate('Mentions')}
          hitSlop={8}
          {...a11yButton(
            mentionUnread > 0
              ? `Mentions, ${mentionUnread} unread`
              : 'Mentions',
          )}
          style={({ pressed }) => [
            s.headBtn,
            { backgroundColor: pressed ? t.surface2 : t.surface, borderColor: t.outlineVar },
          ]}
        >
          <Ionicons name="at" size={17} color={t.ink2} />
          {/* The count is what makes this button worth a slot: without it the
              reader has to open the screen to find out whether it is empty. */}
          {mentionUnread > 0 && (
            <View style={[s.headCount, { backgroundColor: t.error, borderColor: t.bg }]}>
              <Text style={[s.headCountText, { color: t.onError }]}>
                {mentionUnread > 99 ? '99+' : mentionUnread}
              </Text>
            </View>
          )}
        </Pressable>

        <Pressable
          onPress={() => nav.navigate('Search')}
          hitSlop={8}
          {...a11yButton('Search messages')}
          style={({ pressed }) => [
            s.headBtn,
            { backgroundColor: pressed ? t.surface2 : t.surface, borderColor: t.outlineVar },
          ]}
        >
          <Ionicons name="search" size={17} color={t.ink2} />
        </Pressable>
      </View>

      <FlatList
        data={rail}
        keyExtractor={(r) => r.ch.id}
        contentContainerStyle={[s.listPad, rail.length === 0 && s.listGrow]}
        refreshControl={
          <Refresher refreshing={isFetching && !isLoading} onRefresh={refetch} />
        }
        ListEmptyComponent={
          status === 'ready' ? null : status === 'empty' ? (
            <View style={s.centre}>
              <Ionicons name="chatbubbles-outline" size={30} color={t.ink3} />
              <Text style={[s.emptyTitle, { color: t.ink }]}>No channels yet</Text>
              <Text style={[s.emptyBody, { color: t.ink3 }]}>
                Channels are created on the web. Once you're a member, they appear here.
              </Text>
            </View>
          ) : (
            <ScreenState
              status={status}
              onRetry={() => refetch()}
              {...(status === 'error'
                ? {
                    title: "Couldn't load your channels",
                    body:  'The server didn’t answer, so this is not an empty rail — there may be messages waiting.',
                  }
                : {})}
            />
          )
        }
        renderItem={({ item }) => {
          const { ch, unread, mentions, muted, showUnread, loud } = item;
          /**
           * `samvada_channels.name` is `''` for a DM — `find_or_create_dm`
           * inserts it empty and `GET /channels` selects `c.*`, so unlike
           * `/mentions` and `/search` (which resolve the other participant
           * through `_channel_label_sql`) this endpoint hands down nothing to
           * render. Every DM row on this screen has been drawing a blank line
           * since the screen was written. The fallback is the web's, verbatim.
           */
          const name = ch.name || 'Direct message';
          const desc = ch.description?.trim();

          /**
           * The channel's identity colour, or `null` when it must not have one.
           *
           * `null` is the answer for every DM and it is a real answer rather
           * than a gap: the row renders the other person, not a `#glyph`, so
           * there is no tile to colour — and migration 100 skips DMs in its
           * backfill for the further reason that colouring them would spend the
           * rotation on tiles nobody can see it on, leaving named channels
           * colliding while eight tones sat invisible in private conversations.
           *
           * The 15% wash and the full-strength glyph are proposal 09's
           * `.ch__ic`: `color: var(--ch-c)` on
           * `color-mix(in srgb, var(--ch-c) 15%, transparent)`. `withAlpha`
           * rather than string concatenation — the generated palette carries
           * rgb() values as well as hexes, and `'rgb(47,102,144)' + '26'` is not
           * a colour at all, so RN drops the style and the tile renders
           * transparent.
           */
          const tone = channelToneColor(scheme, ch.id, ch.color, ch.type);

          const row = (
            <Pressable
              onPress={() => openChannel(ch.id, name)}
              /* State that is carried only by a coloured pill or a glyph is
                 invisible to a screen reader, and "muted" is an ABSENCE of a
                 badge, which announces nothing at all. All three go in the
                 label. */
              {...a11yButton(
                [
                  name,
                  mentions > 0 ? `${mentions} mention${mentions === 1 ? '' : 's'}` : '',
                  showUnread ? `${unread} unread` : '',
                  muted ? 'Muted' : '',
                ].filter(Boolean).join(', '),
              )}
              style={({ pressed }) => [
                s.row,
                {
                  backgroundColor: pressed ? t.surface2 : t.surface,
                  borderColor: loud ? t.primaryContainer : t.outlineVar,
                },
              ]}
            >
              <View style={[s.icon, { backgroundColor: tone ? withAlpha(tone, 0.15) : t.surface3 }]}>
                <Ionicons name={iconFor(ch.type)} size={16} color={tone ?? t.ink2} />
              </View>

              <View style={s.rowBody}>
                <View style={s.rowHead}>
                  <Text
                    style={[s.name, { color: t.ink, fontWeight: loud ? '700' : '600' }]}
                    numberOfLines={1}
                  >
                    {name}
                  </Text>
                  <Text style={[s.when, { color: t.ink4 }]}>{relTime(ch.updated_at)}</Text>
                </View>
                {/* `description`, not `topic`. There has never been a `topic`
                    column — 058 named it `description` — so this line read
                    `undefined` and fell through to the member count for every
                    channel that had a description set. */}
                <Text style={[s.sub, { color: t.ink3 }]} numberOfLines={1}>
                  {desc || `${ch.member_count} ${ch.member_count === 1 ? 'member' : 'members'}`}
                </Text>
              </View>

              {/* Order matches the web's, where it is load-bearing in CSS and
                  merely conventional here: mention, then count, then the bell.
                  Keeping it identical means a user who learned the rail on a
                  laptop reads the same row on a phone. */}
              <View style={s.badges}>
                {mentions > 0 && (
                  <View style={[s.mention, { backgroundColor: t.error }]}>
                    <Text style={[s.mentionText, { color: t.onError }]}>
                      {mentions > 99 ? '99+' : mentions}
                    </Text>
                  </View>
                )}
                {showUnread && (
                  <View style={[s.count, { backgroundColor: t.primary }]}>
                    <Text style={[s.countText, { color: t.onPrimary }]}>
                      {unread > 99 ? '99+' : unread}
                    </Text>
                  </View>
                )}
                {muted && (
                  <Ionicons name="notifications-off-outline" size={14} color={t.ink3} />
                )}
              </View>
            </Pressable>
          );

          return (
            <SwipeRow
              accessibilityLabel={name}
              /**
               * One gesture, one direction, both states. Muting is the negative
               * action so it takes the left slot, and unmute stays there rather
               * than moving to the right when the channel is already silent:
               * a control that changes SIDE with its state cannot be learned,
               * and the accessibility action carries the current verb either
               * way. `SwipeRow` exposes it in the actions rotor, so this is
               * never gesture-only.
               *
               * AND IT IS NOT OFFERED TO SOMEBODY WHO WILL BE REFUSED. The
               * server gates this write on editor, and ChatScreen's ChannelSheet
               * already hides the same control on `!canPost`; the rail used to
               * show it to everyone, so a legacy viewer swiped, watched the bell
               * flip, and watched it flip back with nothing said. `undefined`
               * rather than `disabled`, because `disabled` only stops the
               * gesture — `SwipeRow` still advertises the action in the rotor
               * and still fires `onTrigger` from it, which would hide the dead
               * control from sighted users only.
               */
              left={canPost ? {
                label: muted ? 'Unmute' : 'Mute',
                icon: muted ? 'notifications-outline' : 'notifications-off-outline',
                color: muted ? t.primaryContainer : t.surface3,
                onColor: muted ? t.onPrimaryContainer : t.ink2,
                onTrigger: () => mute.mutate({ channelId: ch.id, muted: !muted }),
              } : undefined}
            >
              {row}
            </SwipeRow>
          );
        }}
      />
    </View>
  );

  return (
    <PaneHost
      platform={platform}
      list={list}
      detail={openChat
        ? (
          <ChatScreen
            /* `key` so that choosing a DIFFERENT channel remounts rather than
               reusing the mounted instance with new props. Without it the
               composer arrives still holding the draft you were typing in the
               previous channel — one send away from posting it to the wrong
               people. `RootStack` solves the same problem for the pushed route
               with `getId`; this is that rule for the pane. */
            key={openChat.id}
            channelId={openChat.id}
            channelName={openChat.name}
            onClose={() => setOpenChat(null)}
          />
        )
        : (
          <EmptyPane
            icon="chatbubbles-outline"
            title="No conversation open"
            body="Channels and direct messages open beside the list. Unread counts keep updating while you read another thread."
          />
        )}
    />
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 32 },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 20, paddingTop: 8, paddingBottom: 12,
  },
  headerText: { flex: 1, minWidth: 0 },
  title: { fontSize: 26, fontWeight: '700', letterSpacing: -0.4 },
  titleHi: { fontSize: 14, marginTop: 2, ...hindi() },
  headBtn: {
    width: 36, height: 36, borderRadius: 10, borderWidth: 1,
    alignItems: 'center', justifyContent: 'center',
  },
  // Overlaps the glyph's top-right corner. The border is the button's own
  // background colour so the pill reads as sitting on top of it rather than
  // being clipped by it.
  headCount: {
    position: 'absolute', top: -5, right: -5,
    minWidth: 17, height: 17, borderRadius: 9, borderWidth: 1.5,
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3,
  },
  headCountText: { fontSize: 9.5, fontWeight: '800' },
  listPad: { paddingHorizontal: 16, paddingBottom: 24, gap: 8 },
  listGrow: { flexGrow: 1 },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    borderWidth: 1, borderRadius: 12, padding: 12,
  },
  icon: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  rowBody: { flex: 1, minWidth: 0 },
  rowHead: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  name: { flex: 1, fontSize: 15 },
  when: { fontSize: 11.5 },
  sub: { fontSize: 12.5, marginTop: 2 },
  badges: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 0 },
  count: { minWidth: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  countText: { fontSize: 11, fontWeight: '800' },
  // Its own style, not `count` in another colour. Two pills that differ only by
  // hue are one pill to a colour-blind reader and to anybody glancing; this one
  // is smaller and tighter so the pair is distinguishable by shape as well.
  mention: { minWidth: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5 },
  mentionText: { fontSize: 10.5, fontWeight: '800' },
  emptyTitle: { fontSize: 15, fontWeight: '700', marginTop: 4 },
  emptyBody: { fontSize: 13, textAlign: 'center', lineHeight: 19 },
});
