import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, Animated, FlatList, KeyboardAvoidingView, Platform,
  Pressable, ScrollView, StyleSheet, Text, View,
  type ListRenderItemInfo, type TextInput,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useIsFocused, useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';

import { useTheme } from '../theme/ThemeProvider';
import { hindi } from '../theme/fonts';
import { DUR, EASE, duration, useReducedMotion } from '../theme/motion';
import { avatarColor, userInitials, withAlpha } from '../theme/tokens';
import { useAuth } from '../hooks/useAuth';
import { useOnline } from '../hooks/useOnline';
import { useOfflineMutation } from '../hooks/useOfflineMutation';
import { useLive, useLiveChannel, useTypingPing } from '../hooks/useLive';
import Refresher from '../components/Refresher';
import Sheet from '../components/Sheet';
import PulseDot from '../components/PulseDot';
import ScreenState, { resolveScreenState } from '../components/ScreenState';
import RichText from '../components/RichText';
import MentionInput from '../components/MentionInput';
import { a11yButton } from '../components/a11y';
import {
  messagesApi, isUuid,
  type Channel, type Message, type PinnedMessage, type Reaction,
  type SanvaadAccess, type TypingUser,
} from '../api/messages';
import type { RootStackParamList } from '../nav/RootStack';

/**
 * Chat — one channel.
 *
 * 17-mobile-app.md lists this screen as "reactions, thread affordance, read
 * ticks, hold-to-record mic replacing send when empty". Three of those four are
 * here. The mic is NOT, deliberately: `backend/routers/messaging.py` has no
 * voice-note endpoint and `MessageCreate` accepts only `content` and `type`, so
 * a record button could capture audio and then have nowhere to put it. A control
 * that looks like it works and silently discards a recording is worse than no
 * control. The gap is reported rather than faked.
 *
 * There is no attachment control either, and that one is a scope decision rather
 * than a missing endpoint: the owner excluded file attachments from this work.
 * Nothing here touches `samvada_message_attachments`.
 *
 * The list is INVERTED. The server returns newest-first
 * (`ORDER BY m.created_at DESC`, messaging.py:317) and an inverted FlatList
 * consumes that order directly, opens pinned to the newest message, and grows
 * upward as older pages load — no reversing, no scrollToEnd on mount, and no
 * jump when the keyboard opens. Two consequences everything below has to
 * respect: `messages[index + 1]` is the OLDER message, and anything rendered
 * INSIDE the list needs `transform: [{ scaleY: -1 }]` or it draws upside down
 * (the empty state does; the notice bar above the composer is outside the list
 * and does not).
 *
 * ── Live state is a POLL, and that is the design, not a shortfall ────────────
 *
 * Typing, presence and the badge counts all arrive on `GET /v1/messaging/live`,
 * polled once for the whole app by `LiveProvider`. There is no websocket because
 * there cannot be one: Supabase's pooler runs in transaction mode on :6543 where
 * LISTEN/NOTIFY does not work at all, and the API runs several workers, so an
 * in-process broadcast would reach the clients attached to one worker and
 * silently miss the rest. This screen therefore never calls `messagesApi.live`
 * itself — it declares which channel is open with `useLiveChannel` and reads the
 * shared payload with `useLive`. Adding a second poll here would double the
 * request rate for every user on the product.
 *
 * The typing ping rides that same GET. `useTypingPing` sets a flag the NEXT
 * scheduled poll carries as `typing=1`; it never issues a request of its own.
 * That is not an optimisation — the write limiter is 120/IP/minute and a typing
 * POST every three seconds is 20 writes a minute per user, so four colleagues
 * behind one office NAT would spend two-thirds of the whole office's write
 * budget on animated dots.
 */

type Route = RouteProp<RootStackParamList, 'Chat'>;
type Nav = NativeStackNavigationProp<RootStackParamList, 'Chat'>;

/**
 * A row the screen owes the reader, and whether it may buy pages to reach it.
 *
 * `hunt: false` is the thread case and nothing else: the row is CONTEXT behind
 * an open sheet, so if it is already loaded the channel lands on it and if it is
 * not, nothing is fetched and nothing is called missing.
 */
type Wanted = { id: string; hunt: boolean } | null;

/** Offered on long-press. Kept short: a long grid is slower than typing. */
const QUICK_REACTIONS = ['👍', '✅', '🙏', '👀', '🎉'];

const PAGE = 50;

/**
 * How many extra pages a deep link may pull while hunting for its message.
 * Three at 50 a page is 150 messages — deep enough for anything posted the same
 * week, shallow enough that a link to a message from March does not silently
 * download the channel.
 */
const HUNT_PAGES = 3;

/** How long the deep-linked row stays lit before it fades. */
const HIGHLIGHT_MS = 2500;

function timeOf(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true });
}

function dayOf(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const today = new Date();
  const yest = new Date(today);
  yest.setDate(today.getDate() - 1);
  const same = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  if (same(d, today)) return 'Today';
  if (same(d, yest)) return 'Yesterday';
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

/**
 * The sentence `api/client.ts` already wrote onto the error.
 *
 * Every refusal in this file surfaces this rather than `e.message`: the
 * interceptor turns the server's `detail` into the words the user should read,
 * and axios's own `message` is "Request failed with status code 403".
 */
function friendly(e: unknown): string | undefined {
  const m = (e as { friendlyMessage?: unknown } | null | undefined)?.friendlyMessage;
  return typeof m === 'string' && m ? m : undefined;
}

/** Collapse a reaction array into counts, preserving first-seen order. */
function tallyReactions(reactions: Reaction[] | undefined, meId: string) {
  if (!reactions?.length) return [];
  const order: string[] = [];
  const byEmoji = new Map<string, { count: number; mine: boolean }>();
  for (const r of reactions) {
    const prev = byEmoji.get(r.emoji);
    if (!prev) {
      order.push(r.emoji);
      byEmoji.set(r.emoji, { count: 1, mine: r.user_id === meId });
    } else {
      prev.count += 1;
      prev.mine = prev.mine || r.user_id === meId;
    }
  }
  return order.map(emoji => ({ emoji, ...byEmoji.get(emoji)! }));
}

/**
 * Where a reply must actually hang.
 *
 * `POST /channels/{id}/messages` refuses a nested reply outright — "Replies
 * cannot be nested. Reply to the message the thread hangs off." — so tapping
 * Reply on a message that is ITSELF a reply has to thread under its root. The
 * server's threads are flat, which is why `parent_message_id` IS the root and
 * there is no chain to walk.
 */
function rootIdOf(m: Message): string {
  return m.parent_message_id ?? m.id;
}

/** "Seen by Aanya, Rohan +3". `seen_by` is capped at four names; `seen_count` is not. */
function seenLabel(m: Message): string | null {
  const total = m.seen_count ?? 0;
  if (total <= 0) return null;
  const names = m.seen_by ?? [];
  if (names.length === 0) return `Seen by ${total}`;
  const shown = names.slice(0, 2);
  const rest = total - shown.length;
  return rest > 0 ? `Seen by ${shown.join(', ')} +${rest}` : `Seen by ${shown.join(', ')}`;
}

/**
 * The typing line's words.
 *
 * The server caps `typing` at five and excludes the caller, so the only cases
 * are one, two, and "enough that naming them is noise".
 */
function typingLabel(users: TypingUser[]): string | null {
  if (!users.length) return null;
  const names = users
    .map(u => (u.full_name ?? '').trim())
    .filter(n => n.length > 0);
  if (names.length === 0) return 'Someone is typing…';
  if (names.length === 1) return `${names[0]} is typing…`;
  if (names.length === 2) return `${names[0]} and ${names[1]} are typing…`;
  return 'Several people are typing…';
}

export default function ChatScreen() {
  const { t } = useTheme();
  const insets = useSafeAreaInsets();
  const nav = useNavigation<Nav>();
  const route = useRoute<Route>();
  const qc = useQueryClient();
  const online = useOnline();
  const reduced = useReducedMotion();
  const { user } = useAuth();
  const meId = user?.user_id ?? '';
  const meName = user?.full_name ?? user?.name ?? null;

  const { channelId, channelName } = route.params;
  const linkMessageId = route.params.message;
  const linkThreadId = route.params.thread;

  const [draft, setDraft] = useState('');
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  /**
   * The message the composer is currently rewriting, or `null` for a new one.
   *
   * Editing borrows the composer rather than opening a second field: it is the
   * only place with a caret, the `@` picker, the character cap and the send
   * button, and a modal with its own TextInput would have to grow all four
   * again. `stashedDraft` is what the box held when the edit began — a
   * half-written message must survive somebody fixing a typo three rows up.
   */
  const [editing, setEditing] = useState<Message | null>(null);
  const stashedDraft = useRef('');
  const composerRef = useRef<TextInput>(null);
  const listRef = useRef<FlatList<Message>>(null);

  // Overlays. Each is a boolean rather than a nullable object so the Sheet's
  // exit animation still has something to draw while it plays — Sheet holds the
  // Modal mounted for the length of the dismissal, and content that vanishes on
  // the caller's flag makes an exit animation impossible.
  const [actionFor, setActionFor] = useState<Message | null>(null);
  const [pinsOpen, setPinsOpen] = useState(false);
  const [channelSheetOpen, setChannelSheetOpen] = useState(false);
  const [threadRoot, setThreadRoot] = useState<string | null>(null);
  const [threadOpen, setThreadOpen] = useState(false);
  // The reply inside the thread that a mention link points at. Only a deep link
  // knows which one that is; a thread opened by hand points at all of it.
  const [threadHighlight, setThreadHighlight] = useState<string | null>(null);

  // Deep-link landing state.
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);

  /**
   * ONE-TIME PURGE OF THE PRE-INFINITE CACHE ENTRY. Do not delete this.
   *
   * This screen used to hold `['messaging','messages',channelId]` as a plain
   * `useQuery`, so its persisted value in MMKV is a bare `Message[]`. The key is
   * unchanged (it is frozen, and three other invalidations name it), but the
   * SHAPE is not: an infinite query expects `{ pages, pageParams }`.
   *
   * That mismatch is not a cosmetic one. `hasNextPage()` in query-core v5
   * destructures `{ pages }` off the restored data and reads `pages.length` with
   * no guard, so an upgrading install whose cache still holds the old array
   * crashes on the first render of this screen — before any of our own code sees
   * the data. A cache buster would also fix it, but the buster lives in
   * `offline/queryClient.ts` and in `App.tsx`, which this agent does not own and
   * which currently disagree with each other about what it is.
   *
   * Done during render rather than in an effect because the `useInfiniteQuery`
   * below runs in this same render pass; an effect would fire after the crash.
   * Safe to write the cache here: this key has no observer until the hook two
   * lines down creates one, so nothing is being re-rendered underneath us. Keyed
   * on channelId so it also covers a param change without a remount.
   */
  const purgedFor = useRef<string | null>(null);
  if (purgedFor.current !== channelId) {
    purgedFor.current = channelId;
    const cached = qc.getQueryData(['messaging', 'messages', channelId]);
    if (cached && !Array.isArray((cached as { pages?: unknown }).pages)) {
      qc.removeQueries({ queryKey: ['messaging', 'messages', channelId], exact: true });
    }
  }

  // ── Queries ────────────────────────────────────────────────────────────────

  const messagesQuery = useInfiniteQuery({
    queryKey: ['messaging', 'messages', channelId],
    queryFn: ({ pageParam }) => messagesApi.list(channelId, { before: pageParam, limit: PAGE }),
    initialPageParam: undefined as string | undefined,
    // A page shorter than the limit is the end of the feed; there is no `more`
    // flag and no total. The cursor is the OLDEST id on the page, because the
    // server orders newest-first and resolves `before` to that row's created_at.
    getNextPageParam: (last: Message[]) =>
      last.length < PAGE ? undefined : last[last.length - 1]?.id,
    staleTime: 10_000,
  });

  /**
   * EVERY QUERY RESULT IN THIS FILE IS ANNOTATED ON THE WAY OUT. Do not drop it.
   *
   * `tsconfig` inherits `moduleResolution: "node"` from expo's base, which
   * resolves @tanstack/react-query to a build whose `useQuery` declaration leaks
   * `TData` unbound — probe it and the compiler prints
   * `UseQueryResult<NoInfer<TData>, Error>`. The practical effect is that every
   * `query.data` in this codebase is `any`, a type parameter on the hook does
   * nothing to fix it, and a typo in a field name compiles silently. Annotating
   * the extracted local is the only thing that restores checking, and it is what
   * every other screen here does (`InboxScreen` for one). The generics on the
   * hooks are kept as the statement of intent, and start working for free on the
   * day the resolution setting is fixed.
   */
  const pages: Message[][] | undefined = messagesQuery.data?.pages;

  // Pulled out as primitives so the effects below can depend on the VALUES
  // rather than on the query object, which is a fresh reference every render —
  // an effect keyed on it re-runs on every keystroke in the composer.
  // `fetchNextPage` is a bound method and stable across renders.
  const hasOlder: boolean = messagesQuery.hasNextPage;
  const isFetchingAny: boolean = messagesQuery.isFetching;
  const isFetchingOlder: boolean = messagesQuery.isFetchingNextPage;
  const fetchOlder: () => void = messagesQuery.fetchNextPage;

  const messages = useMemo<Message[]>(() => {
    if (!pages) return [];
    const out: Message[] = [];
    for (const page of pages) out.push(...page);
    return out;
  }, [pages]);

  /**
   * The channel rail's own query, subscribed to rather than re-fetched.
   *
   * Same key and same fetcher as MessagesScreen, so react-query serves one
   * request for both. It is what supplies the header name when a deep link
   * arrives with no `channelName` in its params, and the mute state for the
   * overflow sheet.
   */
  const channelsQuery = useQuery<Channel[]>({
    queryKey: ['messaging', 'channels'],
    queryFn: () => messagesApi.channels(),
    staleTime: 30_000,
  });
  const channels: Channel[] | undefined = channelsQuery.data;
  const channel = useMemo(
    () => channels?.find(c => c.id === channelId),
    [channels, channelId],
  );

  /**
   * Whether this channel is known to still accept writes.
   *
   * `GET /channels` filters `is_archived = $3` and this screen only ever asks
   * for the live set, so an ARCHIVED channel is simply absent from `channels` —
   * `channel?.is_archived` would read `undefined` and any `!archived` test on it
   * would answer "not archived" for the one case it exists to catch. The fact is
   * therefore taken from PRESENCE, and the `is_archived` check is kept beside it
   * so this stays right on the day the rail merges the two lists.
   *
   * Absence is not proof of archival — the query may simply not have answered
   * yet — which is exactly why this is phrased as "known writable" and starts
   * out FALSE. It gates the Edit row and nothing else, and the wrong answer in
   * each direction is not symmetric: a row withheld for the beat before a cached
   * 30-second query resolves costs a second long-press, while a row offered in
   * an archived room costs a 403 on work the user has already retyped.
   *
   * Everything else the caller cannot do in an archived room stays offered and
   * lets the server refuse it, which is this file's existing convention (pin
   * says so in as many words). Edit is the exception because it is the only one
   * where the refusal arrives AFTER the user has done the work.
   */
  const channelWritable = !!channel && !channel.is_archived;

  /**
   * Whether this room's mention universe is members-only.
   *
   * The server resolves a mention against `_readable_by`
   * (`services/samvaad_mentions.py`), and for a `private` channel or a `dm` that
   * is the MEMBER ROWS AND NOTHING ELSE. A public channel is the opposite case:
   * `_readable_by` unions in every org member, so telling the reader that only
   * this conversation can be named would hide people who genuinely can be.
   *
   * NOT `=== 'private' || === 'dm'`, WHICH WAS THE BUG. `channel` comes from the
   * `['messaging','channels']` query, so it is `undefined` until that answers —
   * and permanently, for a channel the rail does not list. Testing for the two
   * closed types made every unknown channel read as public, which is the
   * permissive answer to the one question where permissive is the failure: on a
   * cold open, the first `@` in a private room offered the whole org. Asking
   * `!== 'public'` inverts the default, so an unanswered query and an unlisted
   * channel both fall to the careful side.
   *
   * The candidate set itself is no longer computed here. `GET /directory` takes
   * a `channel_id` and scopes it server-side, which removed both the member
   * query this screen used to run and the window in which its answer had not
   * arrived — the scope goes down as a route param, so it is right from the
   * first keystroke rather than one fetch later. All this flag now decides is
   * whether an empty picker gets a sentence; see `MentionInput`.
   */
  const restricted = channel?.type !== 'public';

  /** The only way to learn whether to render a composer or a locked one. */
  const meQuery = useQuery<SanvaadAccess>({
    queryKey: ['messaging', 'me'],
    queryFn: () => messagesApi.me(),
    staleTime: 5 * 60_000,
  });
  // Optimistic until it answers. A composer that locks itself for the second it
  // takes /me to land reads as "you are not allowed", which is a worse lie than
  // a send that 403s once.
  const access: SanvaadAccess | undefined = meQuery.data;
  const canPost = access ? access.can_post : true;

  const pinsQuery = useQuery<PinnedMessage[]>({
    queryKey: ['messaging', 'pins', channelId],
    queryFn: () => messagesApi.pins(channelId),
    staleTime: 60_000,
  });
  const pins: PinnedMessage[] = pinsQuery.data ?? [];
  const pinnedIds = useMemo(() => new Set(pins.map(p => p.id)), [pins]);

  const threadQuery = useQuery<Message[]>({
    queryKey: ['messaging', 'thread', threadRoot],
    queryFn: () => messagesApi.thread(threadRoot!),
    enabled: threadOpen && isUuid(threadRoot),
    staleTime: 10_000,
  });
  const threadReplies: Message[] | undefined = threadQuery.data;

  // ── Live: presence, typing, and the ping ───────────────────────────────────

  /**
   * Tells the single app-wide poll which room is open.
   *
   * Without this call the poll never asks for `typing`, the list is `[]` on
   * every response, and the typing line below never renders — a green build with
   * a dead feature, which is the exact shape of the defect this build is meant
   * to avoid repeating.
   *
   * `null` while unfocused is the contract `useLiveChannel` documents: with
   * Search or a task pushed on top of this screen there is nobody watching the
   * dots, and the poll drops from four seconds back to twenty. The screen stays
   * mounted the whole time, so without the focus check it would hold the fast
   * cadence for as long as the user was somewhere else.
   */
  const isFocused = useIsFocused();
  useLiveChannel(isFocused ? channelId : null);
  const live = useLive();
  // `useTypingPing` lowers the flag on ITS OWN unmount, so a screen popped
  // mid-word cannot leave somebody typing forever. Nothing extra is needed here.
  const setTyping = useTypingPing();

  const typingText = typingLabel(live.typing);

  /**
   * Who the other half of a DM is.
   *
   * `Channel` carries no participant id — for a DM its `name` is '' and the
   * membership is not in the payload — so the peer is read off the messages,
   * which is the only place their id appears. Group channels get no dot: a
   * header has one line and a 200-person room has no single presence to state.
   */
  const dmPeer = useMemo(() => {
    if (channel?.type !== 'dm') return null;
    for (const m of messages) {
      if (m.sender_id && m.sender_id !== meId) {
        return { id: m.sender_id, name: m.sender_name ?? null };
      }
    }
    return null;
  }, [channel, messages, meId]);

  // AN ABSENT KEY MEANS OFFLINE. The server omits anyone staler than five
  // minutes rather than sending "offline", so `undefined` is rendered as no dot
  // at all — never as a grey "unknown".
  const peerPresence = dmPeer ? live.presence[dmPeer.id] : undefined;

  // ── Header title ───────────────────────────────────────────────────────────

  /**
   * Route param → the rail's copy → the DM peer → an ellipsis.
   *
   * `channelName` is optional precisely so a URL can build a link to a channel,
   * and a URL cannot supply a name. Rendering it bare would open every
   * deep-linked channel with an empty header. `||` rather than `??` because a
   * DM's `name` is the empty string, not null.
   */
  const headerTitle =
    channelName || channel?.name || dmPeer?.name || (channelsQuery.isLoading ? '…' : 'Channel');

  // ── Read marking ───────────────────────────────────────────────────────────

  /**
   * Mark read on open, and again whenever the newest message changes.
   *
   * Keyed on the newest id rather than run on an interval: the server stores one
   * last_read_at per member, so re-posting the same state is wasted work, and
   * marking read on every render would fight the unread badge.
   */
  const newestId = messages[0]?.id;
  const markedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!newestId || markedRef.current === newestId) return;
    markedRef.current = newestId;
    messagesApi.markRead(channelId)
      .then(() => {
        // The rail's unread pill, and the mentions feed — the same call clears
        // this channel's mention rows server-side, so the Mentions screen and
        // the tab badge are both stale until they are told.
        qc.invalidateQueries({ queryKey: ['messaging', 'channels'] });
        qc.invalidateQueries({ queryKey: ['messaging', 'mentions'] });
      })
      .catch(() => {
        // A failed read-receipt must not interrupt reading. It retries on the
        // next new message.
        markedRef.current = null;
      });
  }, [newestId, channelId, qc]);

  // ── Invalidation helpers ───────────────────────────────────────────────────

  // Never `['messaging']` on its own: the bare prefix takes the live poll, the
  // search cache and the directory with it, and restarts the poll out of phase.
  const invalidateMessages = useCallback(() => {
    qc.invalidateQueries({ queryKey: ['messaging', 'messages', channelId] });
  }, [qc, channelId]);

  const invalidateThreadOf = useCallback((m: Message) => {
    if (m.parent_message_id) {
      qc.invalidateQueries({ queryKey: ['messaging', 'thread', m.parent_message_id] });
    }
  }, [qc]);

  // ── Mutations ──────────────────────────────────────────────────────────────

  /**
   * Sending survives a tunnel. Reacting and read-marking do not, and that split
   * is deliberate: a queued reaction replaying two hours later lands on a
   * conversation that has moved on, and a queued read-marker clears a badge for
   * messages the user never saw.
   */
  const sendMut = useOfflineMutation<{ content: string; parent?: string }>({
    method: 'POST',
    urlBuilder: () => `/v1/messaging/channels/${channelId}/messages`,
    bodyBuilder: v => ({ content: v.content, type: 'text', parent_message_id: v.parent ?? null }),
    mutationFn: v => messagesApi.send(channelId, v.content, v.parent),
    onlineOptions: {
      onSuccess: (_data, vars) => {
        invalidateMessages();
        qc.invalidateQueries({ queryKey: ['messaging', 'channels'] });
        if (vars.parent) {
          qc.invalidateQueries({ queryKey: ['messaging', 'thread', vars.parent] });
        }
      },
    },
  });

  const react = useMutation({
    mutationFn: ({ id, emoji, mine }: { id: string; emoji: string; mine: boolean; msg: Message }) =>
      mine ? messagesApi.unreact(id, emoji) : messagesApi.react(id, emoji),
    onSuccess: (_d, vars) => { invalidateMessages(); invalidateThreadOf(vars.msg); },
    onError: (e: unknown) =>
      Alert.alert('Reaction failed', friendly(e) ?? 'Try again.'),
  });

  /**
   * NOT `useOfflineMutation`, and that is the same split the comment above
   * draws. A queued send replaying on reconnect adds a message to a conversation
   * — late, but true. A queued EDIT replaying two hours later overwrites text
   * that may have been edited again since, on a message that may have been
   * deleted, with words written against a conversation that has moved on. It is
   * a last-write-wins overwrite of somebody's record, which is not a thing to
   * replay unattended. Offline this fails, says so, and leaves the text in the
   * box.
   */
  const editMut = useMutation({
    mutationFn: ({ msg, content }: { msg: Message; content: string }) =>
      messagesApi.edit(msg.id, content),
    onSuccess: (_d, vars) => {
      invalidateMessages();
      invalidateThreadOf(vars.msg);
      // `/pins` carries its OWN copy of `content` — the bar and the sheet render
      // that copy, not the message row — so an edited pin reads as the old text
      // until this lands.
      qc.invalidateQueries({ queryKey: ['messaging', 'pins', channelId] });
    },
    onError: (e: unknown) =>
      Alert.alert('Not saved', friendly(e) ?? 'Could not save that edit.'),
  });

  const remove = useMutation({
    mutationFn: ({ msg }: { msg: Message }) => messagesApi.remove(msg.id),
    onSuccess: (_d, vars) => {
      invalidateMessages();
      invalidateThreadOf(vars.msg);
      qc.invalidateQueries({ queryKey: ['messaging', 'pins', channelId] });
    },
    onError: (e: unknown) =>
      Alert.alert('Not deleted', friendly(e) ?? 'Could not delete that message.'),
  });

  const afterPinChange = useCallback(() => {
    qc.invalidateQueries({ queryKey: ['messaging', 'pins', channelId] });
    invalidateMessages();
  }, [qc, channelId, invalidateMessages]);

  const pinMut = useOfflineMutation<{ id: string }>({
    method: 'POST',
    urlBuilder: v => `/v1/messaging/messages/${v.id}/pin`,
    bodyBuilder: () => ({}),
    mutationFn: v => messagesApi.pin(v.id),
    onlineOptions: {
      onSuccess: afterPinChange,
      // Pin is one of the two endpoints left deliberately unguarded before
      // migration 093: it answers 500 rather than an empty list, because a click
      // that fails should fail loudly. It is also 400 at the fifty-pin cap and
      // 403 on an archived channel, and all three sentences are worth reading.
      onError: (e: unknown) =>
        Alert.alert('Not pinned', friendly(e) ?? 'Could not pin that message.'),
    },
  });

  const unpinMut = useOfflineMutation<{ id: string }>({
    method: 'DELETE',
    urlBuilder: v => `/v1/messaging/messages/${v.id}/pin`,
    mutationFn: v => messagesApi.unpin(v.id),
    onlineOptions: {
      onSuccess: afterPinChange,
      onError: (e: unknown) =>
        Alert.alert('Still pinned', friendly(e) ?? 'Could not unpin that message.'),
    },
  });

  const muteMut = useOfflineMutation<{ muted: boolean }>({
    method: 'PUT',
    urlBuilder: () => `/v1/messaging/channels/${channelId}/mute`,
    bodyBuilder: v => ({ muted: v.muted }),
    mutationFn: v => messagesApi.setMute(channelId, v.muted),
    onlineOptions: {
      onSuccess: () => qc.invalidateQueries({ queryKey: ['messaging', 'channels'] }),
      onError: (e: unknown) =>
        Alert.alert('Not changed', friendly(e) ?? 'Could not change notifications for this channel.'),
    },
  });

  // ── Composing ──────────────────────────────────────────────────────────────

  const replyRootId = replyTo ? rootIdOf(replyTo) : undefined;

  /**
   * Leave edit mode and hand back whatever the box held before it began.
   *
   * The typing flag is deliberately NOT touched. `MentionInput` keeps its own
   * `typingOn` ref and only re-reports on a change, so calling `setTyping(false)`
   * here while restoring a non-empty draft would desync the two and leave the
   * dots stuck off for the rest of the session. Restoring an EMPTY draft needs
   * no help — the composer's own "value went empty" effect lowers the flag, which
   * is the one case where anybody was watching.
   */
  const endEdit = useCallback(() => {
    setEditing(null);
    setDraft(stashedDraft.current);
    stashedDraft.current = '';
  }, []);

  const send = useCallback(async () => {
    const content = draft.trim();
    if (!content || sendMut.isPending || editMut.isPending) return;

    /* An edit, not a new message. */
    if (editing) {
      const target = editing;
      // Unchanged text is still a WRITE on the server: it stamps
      // `is_edited = TRUE` and re-runs the mention fan-out. Backing out of an
      // edit you decided against must not mark the message as edited.
      //
      // Both sides trimmed. `edit_message` and `send_message` each `.strip()`
      // before storing, so surrounding whitespace is not a difference the server
      // would keep even if this sent it — and a row written before those strips
      // existed would otherwise read as changed on every open.
      if (content === target.content.trim()) { endEdit(); return; }
      try {
        await editMut.mutateAsync({ msg: target, content });
        endEdit();
      } catch {
        // The alert is the mutation's. The text stays in the box, still in edit
        // mode, so it can be retried or cancelled — the send path can afford to
        // clear optimistically because a lost draft is one message, and this
        // cannot, because a lost edit is somebody's rewrite of an existing one.
      }
      return;
    }

    // Clear optimistically so a slow network does not invite a double-send.
    setDraft('');
    // The draft going empty is what flips the ping off for everybody else. The
    // composer reports its own blur and its own emptying, but this clear is
    // programmatic, so it is stated here too rather than assumed.
    setTyping(false);
    const parent = replyRootId;
    setReplyTo(null);
    try {
      await sendMut.mutateAsync({ content, parent });
    } catch (e: unknown) {
      // Hand the text back rather than losing it.
      setDraft(content);
      Alert.alert('Not sent', friendly(e) ?? 'Could not send that message.');
    }
  }, [draft, sendMut, editMut, editing, endEdit, replyRootId, setTyping]);

  const startReply = useCallback((m: Message) => {
    // Reply and edit both own the one composer, so entering either leaves the
    // other — and leaving the edit is what hands the stashed draft back, rather
    // than the reply being typed on top of somebody's message text.
    if (editing) endEdit();
    setReplyTo(m);
    // Reaches the real inner TextInput through MentionInput's `inputRef`. If
    // that forwarding is ever dropped this is a silent no-op and "Reply in
    // thread" looks like it does nothing.
    composerRef.current?.focus();
  }, [editing, endEdit]);

  /**
   * Take the composer over to rewrite an existing message.
   *
   * `stashedDraft` is why this is not just `setDraft(m.content)`: somebody
   * mid-sentence who spots a typo three rows up and fixes it must get their
   * sentence back, not an empty box. Reply is cleared for the same reason
   * `startReply` clears this — one composer, one job at a time.
   */
  const startEdit = useCallback((m: Message) => {
    setReplyTo(null);
    stashedDraft.current = draft;
    setEditing(m);
    setDraft(m.content);
    composerRef.current?.focus();
  }, [draft]);

  const openThread = useCallback((m: Message) => {
    setThreadRoot(rootIdOf(m));
    // Opened by hand: there is no one reply to point at, and leaving a stale
    // deep-link highlight in place would mark a row for no stated reason.
    setThreadHighlight(null);
    setThreadOpen(true);
  }, []);

  /**
   * The message the thread hangs off.
   *
   * `GET /messages/{id}/thread` returns the DIRECT CHILDREN and not the root, so
   * without this the sheet shows replies to something it never renders. The
   * channel log is the only place to read it from — the router has no
   * `GET /messages/{id}` — and `list_messages` returns roots only, so anything
   * opened from the channel is here by construction. A deep-linked root older
   * than the loaded window is the one case that is not, and the sheet says so
   * rather than letting the first reply pass for the start of the conversation.
   */
  const threadRootMessage = useMemo<Message | null>(
    () => (threadRoot ? messages.find(m => m.id === threadRoot) ?? null : null),
    [messages, threadRoot],
  );

  // ── Landing on a row: find it, or say why not ──────────────────────────────

  /**
   * What the screen is trying to land on.
   *
   * ONE mechanism for two entry points, because they are the same request — put
   * me on that row. The pin path used to stop at `setHighlightId`, and the
   * scroll effect below returns silently when the row is not in the loaded
   * window, so tapping a pin older than the window closed the sheet, moved
   * nothing and said nothing. Anything that wants a row asks for it here.
   */
  const [wanted, setWanted] = useState<Wanted>(null);

  /**
   * The deep link's target — AND WITH A THREAD ROOT IT IS NOT THE LINKED ID.
   *
   * `_deep_link` appends `&thread=<root>` only when the mentioned message is
   * itself a reply, and `list_messages` returns roots only
   * (`parent_message_id IS NULL`). So whenever `thread` is present the mentioned
   * id is GUARANTEED to be absent from the channel log: hunting for it is three
   * round trips and 150 messages of somebody's mobile data that cannot contain
   * it, ending in the amber "couldn't find that message" bar — for a message the
   * reader is at that moment looking at in the thread sheet.
   *
   * The ROOT is a channel-log row, so that is what the screen aims at instead,
   * and with `hunt: false`: the destination is the sheet and the row behind it
   * is context. Free when it is already loaded, nothing spent when it is not.
   */
  useEffect(() => {
    if (isUuid(linkThreadId)) { setWanted({ id: linkThreadId, hunt: false }); return; }
    if (isUuid(linkMessageId)) setWanted({ id: linkMessageId, hunt: true });
  }, [linkMessageId, linkThreadId]);

  /**
   * A mention written inside a reply carries its root, and the sheet opens on
   * it. `threadHighlight` is the reply that named the reader: `/thread` returns
   * every direct child, so without it a thirty-reply thread asks somebody to
   * find their own name in a list.
   */
  useEffect(() => {
    if (!isUuid(linkThreadId)) return;
    setThreadRoot(linkThreadId);
    setThreadHighlight(isUuid(linkMessageId) ? linkMessageId : null);
    setThreadOpen(true);
  }, [linkThreadId, linkMessageId]);

  /**
   * Hunt backwards for the wanted row, then stop and admit it.
   *
   * Runs again as each page lands, which is what makes it a loop without being
   * one. `huntRef` counts the pages this particular target has cost so nothing
   * can walk the channel to its beginning, and `missing` is the visible outcome
   * — a link that quietly leaves the user staring at the newest fifty messages
   * wondering why nothing is highlighted is the failure this whole branch
   * exists to prevent.
   */
  const huntRef = useRef<{ target: string | null; pulled: number }>({ target: null, pulled: 0 });
  useEffect(() => {
    if (!wanted) return;
    if (huntRef.current.target !== wanted.id) {
      huntRef.current = { target: wanted.id, pulled: 0 };
      setMissing(false);
    }
    if (messages.some(m => m.id === wanted.id)) {
      setHighlightId(wanted.id);
      setMissing(false);
      return;
    }
    // Context, not a destination. Absent from the window is not a failure here
    // and must not paint the notice bar over a sheet that has the answer.
    if (!wanted.hunt) return;
    if (isFetchingAny) return;
    if (!hasOlder || huntRef.current.pulled >= HUNT_PAGES) {
      setMissing(true);
      return;
    }
    huntRef.current.pulled += 1;
    fetchOlder();
  }, [wanted, messages, hasOlder, isFetchingAny, fetchOlder]);

  /**
   * Scroll to the highlighted row.
   *
   * `onScrollToIndexFailed` is MANDATORY here and not defensive programming:
   * the list is inverted with variable row heights, so a target outside the
   * measured window cannot be reached in one hop, and FlatList throws rather
   * than degrading when the handler is absent.
   */
  const scrolledFor = useRef<string | null>(null);
  const retriedScroll = useRef(false);
  useEffect(() => {
    if (!highlightId || scrolledFor.current === highlightId) return;
    const index = messages.findIndex(m => m.id === highlightId);
    if (index < 0) return;
    scrolledFor.current = highlightId;
    retriedScroll.current = false;
    // One frame for the newly-appended page to lay out before we measure it.
    const h = setTimeout(() => {
      listRef.current?.scrollToIndex({ index, viewPosition: 0.5, animated: true });
    }, 60);
    return () => clearTimeout(h);
  }, [highlightId, messages]);

  const onScrollToIndexFailed = useCallback((info: { index: number }) => {
    // Offset 0 on an inverted list is the NEWEST row. Going there forces the
    // rows between here and the target to measure, and one retry is the whole
    // budget — a second failure leaves the highlight in place and says nothing
    // else. The row is still there; the user can scroll.
    listRef.current?.scrollToOffset({ offset: 0, animated: false });
    if (retriedScroll.current) return;
    retriedScroll.current = true;
    setTimeout(() => {
      listRef.current?.scrollToIndex({ index: info.index, viewPosition: 0.5, animated: false });
    }, 120);
  }, []);

  /**
   * The highlight itself. `backgroundColor` cannot run on the native driver, so
   * this one animation is on the JS thread — it is a single row, once, for the
   * length of one fade.
   */
  const glow = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!highlightId) return;
    glow.setValue(1);
    const h = setTimeout(() => {
      Animated.timing(glow, {
        toValue: 0,
        duration: duration(DUR.slow, reduced),
        easing: EASE.exit,
        useNativeDriver: false,
      }).start();
    }, HIGHLIGHT_MS);
    return () => clearTimeout(h);
  }, [highlightId, glow, reduced]);

  const glowColor = useMemo(
    () => glow.interpolate({
      inputRange: [0, 1],
      // Both ends are the same hue so the fade is an alpha ramp rather than a
      // colour change through whatever RN would interpolate towards.
      outputRange: [withAlpha(t.primary, 0), withAlpha(t.primary, 0.14)],
    }),
    [glow, t.primary],
  );

  const loadOlder = useCallback(() => {
    if (hasOlder && !isFetchingOlder) {
      // Resetting the budget is the point of the button: the user has asked for
      // the hunt to keep going past the three pages it stops at on its own.
      huntRef.current.pulled = 0;
      setMissing(false);
      fetchOlder();
    }
  }, [hasOlder, isFetchingOlder, fetchOlder]);

  // ── Rendering ──────────────────────────────────────────────────────────────

  /**
   * Display names known on this surface.
   *
   * The parser highlights a mention only when it can match a name, so feeding it
   * everyone who has posted in the loaded pages — plus the reader themselves —
   * is what makes `@Aanya Sharma` render as one token rather than as two words
   * and a stray '@'.
   */
  const knownNames = useMemo(() => {
    const set = new Set<string>();
    for (const m of messages) if (m.sender_name) set.add(m.sender_name);
    if (meName) set.add(meName);
    return [...set];
  }, [messages, meName]);

  const isPinned = useCallback(
    (m: Message) => pinnedIds.has(m.id) || !!m.pinned_at,
    [pinnedIds],
  );

  const renderItem = useCallback(({ item, index }: ListRenderItemInfo<Message>) => {
    const mine = item.sender_id === meId;
    const name = item.sender_name ?? 'Unknown';
    // Inverted list: the NEXT index is the older message, so a day divider
    // belongs above this row when the older one falls on a different day.
    const older = messages[index + 1];
    const showDay = !older || dayOf(older.created_at) !== dayOf(item.created_at);
    // Group consecutive messages from one sender inside the same day.
    const grouped = !!older
      && older.sender_id === item.sender_id
      && dayOf(older.created_at) === dayOf(item.created_at);

    const tally = tallyReactions(item.reactions, meId);
    const threadCount = item.thread_count ?? 0;
    const seen = mine && index === 0 ? seenLabel(item) : null;
    const lit = item.id === highlightId;

    return (
      <View>
        <Animated.View style={lit ? { backgroundColor: glowColor, borderRadius: 10 } : undefined}>
          <Pressable
            onLongPress={() => setActionFor(item)}
            delayLongPress={280}
            accessibilityRole="button"
            accessibilityLabel={`${name} at ${timeOf(item.created_at)}. ${item.content}`}
            accessibilityHint="Long press for reactions, reply, pin and delete"
            style={({ pressed }) => [
              s.row,
              grouped && s.rowGrouped,
              pressed && { backgroundColor: t.surface2 },
            ]}
          >
            {grouped ? (
              <View style={s.avatarSpacer} />
            ) : (
              <View style={[s.avatar, { backgroundColor: avatarColor(item.sender_id) }]}>
                <Text style={s.avatarText}>{userInitials(name)}</Text>
              </View>
            )}

            <View style={s.body}>
              {!grouped && (
                <View style={s.head}>
                  <Text style={[s.name, { color: mine ? t.primaryText : t.ink }]} numberOfLines={1}>
                    {mine ? 'You' : name}
                  </Text>
                  <Text style={[s.when, { color: t.ink4 }]}>{timeOf(item.created_at)}</Text>
                  {isPinned(item) && (
                    <Ionicons name="pin" size={11} color={t.ink4} accessibilityLabel="Pinned" />
                  )}
                </View>
              )}

              {/* Slack's subset, not CommonMark's: *bold*, _italic_, ~strike~,
                  `code`, fences, > quote, lists, bare URLs and mentions. A
                  message with none of them produces exactly the single <Text>
                  this row used to render, which is why nothing moves for the
                  overwhelming majority of messages that are plain text. */}
              <RichText
                text={item.content}
                names={knownNames}
                meName={meName}
                color={t.ink2}
                fontSize={14.5}
                lineHeight={20}
              />

              {/* The server has no `edited_at` and never did — `is_edited` is the
                  flag and `updated_at` is the time. */}
              {item.is_edited ? (
                <Text style={[s.edited, { color: t.ink4 }]}>edited</Text>
              ) : null}

              {(tally.length > 0 || threadCount > 0) && (
                <View style={s.metaRow}>
                  {tally.map(r => (
                    <Pressable
                      key={r.emoji}
                      onPress={() => react.mutate({ id: item.id, emoji: r.emoji, mine: r.mine, msg: item })}
                      accessibilityRole="button"
                      accessibilityLabel={`${r.emoji} ${r.count}${r.mine ? ', you reacted' : ''}`}
                      style={[
                        s.reaction,
                        {
                          backgroundColor: r.mine ? t.primaryContainer : t.surface3,
                          borderColor: r.mine ? t.primary : 'transparent',
                        },
                      ]}
                    >
                      <Text style={s.reactionEmoji}>{r.emoji}</Text>
                      <Text style={[s.reactionCount, { color: r.mine ? t.onPrimaryContainer : t.ink3 }]}>
                        {r.count}
                      </Text>
                    </Pressable>
                  ))}

                  {threadCount > 0 && (
                    <Pressable
                      onPress={() => openThread(item)}
                      accessibilityRole="button"
                      accessibilityLabel={`${threadCount} ${threadCount === 1 ? 'reply' : 'replies'}, open thread`}
                      style={s.threadBtn}
                    >
                      <Ionicons name="chatbubble-ellipses-outline" size={13} color={t.primaryText} />
                      <Text style={[s.threadText, { color: t.primaryText }]}>
                        {threadCount} {threadCount === 1 ? 'reply' : 'replies'}
                      </Text>
                    </Pressable>
                  )}
                </View>
              )}

              {seen && (
                <Text style={[s.seen, { color: t.ink4 }]} numberOfLines={1}>{seen}</Text>
              )}
            </View>
          </Pressable>
        </Animated.View>

        {showDay && (
          <View style={s.dayRow}>
            <View style={[s.dayLine, { backgroundColor: t.outlineVar }]} />
            <Text style={[s.dayText, { color: t.ink4, backgroundColor: t.bg }]}>
              {dayOf(item.created_at)}
            </Text>
            <View style={[s.dayLine, { backgroundColor: t.outlineVar }]} />
          </View>
        )}
      </View>
    );
  }, [meId, messages, t, react, openThread, knownNames, meName, highlightId, glowColor, isPinned]);

  const canSend =
    draft.trim().length > 0 && !sendMut.isPending && !editMut.isPending && canPost;

  const header = (
    <View style={[s.header, { paddingTop: insets.top + 6, borderBottomColor: t.outlineVar, backgroundColor: t.surface }]}>
      <Pressable
        onPress={() => nav.goBack()}
        hitSlop={10}
        {...a11yButton('Back to messages')}
      >
        <Ionicons name="chevron-back" size={24} color={t.ink2} />
      </Pressable>

      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={s.titleRow}>
          <Text style={[s.headerTitle, { color: t.ink }]} numberOfLines={1}>{headerTitle}</Text>
          {/* Presence, and only the three states the server can actually mean.
              An absent key is offline and draws nothing — a grey dot per absent
              colleague would be two hundred grey dots in a real org. */}
          {peerPresence === 'online' && <PulseDot color={t.success} size={8} label="Online" />}
          {peerPresence === 'away' && (
            <View
              style={[s.awayDot, { backgroundColor: t.ink4 }]}
              accessible
              accessibilityLabel="Away"
            />
          )}
          {channel?.muted && (
            <Ionicons name="notifications-off-outline" size={13} color={t.ink4} accessibilityLabel="Muted" />
          )}
        </View>
        <Text style={[s.headerSub, { color: t.ink4 }]} numberOfLines={1}>संवाद</Text>
      </View>

      <Pressable
        onPress={() => nav.navigate('Search', { channelId, channelName: headerTitle })}
        hitSlop={8}
        {...a11yButton('Search this channel')}
      >
        <Ionicons name="search-outline" size={19} color={t.ink2} />
      </Pressable>

      <Pressable
        onPress={() => setChannelSheetOpen(true)}
        hitSlop={8}
        {...a11yButton('Channel options')}
      >
        <Ionicons name="ellipsis-horizontal" size={20} color={t.ink2} />
      </Pressable>
    </View>
  );

  /**
   * The pinned bar. This is the ENTRY POINT pinning did not have on the web —
   * the feature shipped there with nowhere to see a pin from, on a fully green
   * build. One collapsed row that states the count and previews the newest pin;
   * tapping it opens the list.
   */
  const pinBar = pins.length > 0 ? (
    <Pressable
      onPress={() => setPinsOpen(true)}
      style={[s.pinBar, { backgroundColor: t.surface2, borderBottomColor: t.outlineVar }]}
      {...a11yButton(
        `${pins.length} pinned ${pins.length === 1 ? 'message' : 'messages'}`,
        'Opens the pinned list',
      )}
    >
      <Ionicons name="pin" size={13} color={t.primaryText} />
      <Text style={[s.pinBarCount, { color: t.primaryText }]}>{pins.length}</Text>
      <Text style={[s.pinBarText, { color: t.ink3 }]} numberOfLines={1}>
        {pins[0].content}
      </Text>
      <Ionicons name="chevron-forward" size={14} color={t.ink4} />
    </Pressable>
  ) : null;

  const status = resolveScreenState({
    isLoading: messagesQuery.isLoading,
    isError:   messagesQuery.isError,
    error:     messagesQuery.error,
    online,
    // Definedness, not length. `[]` from a successful fetch and `undefined` from
    // a failed one have to stay distinguishable, or a 500 renders as "no
    // messages yet" and tells someone their colleague never wrote.
    hasData:   pages !== undefined,
    isEmpty:   pages !== undefined && messages.length === 0,
  });

  /**
   * A composer over a channel that refused us is an invitation to fail.
   *
   * Hidden for the three states that mean the server answered and the answer was
   * no. Kept for `loading` (hiding it would jump the layout for the length of
   * one fetch) and for `offline` — a message written with no signal is queued by
   * `useOfflineMutation` and sent on reconnect, which is the whole point of the
   * offline layer.
   */
  const composerUsable = status !== 'forbidden' && status !== 'request' && status !== 'error';

  return (
    <View style={[s.root, { backgroundColor: t.bg }]}>
      {header}
      {pinBar}

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={0}
      >
        {status === 'ready' || status === 'empty' ? (
          <FlatList
            ref={listRef}
            data={messages}
            keyExtractor={m => m.id}
            renderItem={renderItem}
            inverted
            contentContainerStyle={s.listPad}
            keyboardShouldPersistTaps="handled"
            onScrollToIndexFailed={onScrollToIndexFailed}
            onEndReachedThreshold={0.4}
            onEndReached={() => {
              // Inverted, so "the end" is the TOP of the conversation.
              if (hasOlder && !isFetchingOlder) fetchOlder();
            }}
            refreshControl={
              <Refresher
                refreshing={messagesQuery.isRefetching && !isFetchingOlder}
                onRefresh={messagesQuery.refetch}
              />
            }
            // On an inverted list the footer draws at the top, which is exactly
            // where "loading older" belongs.
            ListFooterComponent={
              isFetchingOlder
                ? <ActivityIndicator style={s.olderSpinner} color={t.primary} />
                : null
            }
            ListEmptyComponent={
              <View style={[s.centre, s.emptyInverted]}>
                <Ionicons name="chatbubbles-outline" size={30} color={t.ink3} />
                <Text style={[s.emptyTitle, { color: t.ink }]}>No messages yet</Text>
                <Text style={[s.emptyBody, { color: t.ink3 }]}>Say something to start the channel.</Text>
              </View>
            }
          />
        ) : (
          <ScreenState
            status={status}
            onRetry={() => messagesQuery.refetch()}
            {...(status === 'forbidden'
              ? {
                  title: 'You don’t have permission',
                  body: friendly(messagesQuery.error)
                    ?? 'This channel is private and you are not a member of it.',
                }
              : status === 'request'
                ? { body: friendly(messagesQuery.error) }
                : {})}
          />
        )}

        {composerUsable && (
        <View style={[s.composer, { backgroundColor: t.surface, borderTopColor: t.outlineVar, paddingBottom: insets.bottom || 10 }]}>
          {/* Outside the list, so no scaleY(-1) — an in-list banner would need
              one or it draws upside down. */}
          {missing && (
            <View style={[s.noticeBar, { backgroundColor: t.tertiaryContainer }]}>
              <Ionicons name="search-outline" size={14} color={t.onTertiaryContainer} />
              <Text style={[s.noticeText, { color: t.onTertiaryContainer }]}>
                Couldn’t find that message — it may be older than the loaded history.
              </Text>
              {hasOlder && (
                <Pressable onPress={loadOlder} hitSlop={6} {...a11yButton('Load older messages')}>
                  <Text style={[s.noticeAction, { color: t.onTertiaryContainer }]}>Load older</Text>
                </Pressable>
              )}
              <Pressable onPress={() => setMissing(false)} hitSlop={8} {...a11yButton('Dismiss')}>
                <Ionicons name="close" size={15} color={t.onTertiaryContainer} />
              </Pressable>
            </View>
          )}

          {/* The typing line. PulseDot rather than a hand-rolled Animated.loop:
              it is already reduced-motion correct, and a repeating animation
              built here would not be. */}
          {typingText && (
            <View style={s.typingRow} accessibilityLiveRegion="polite">
              <PulseDot color={t.primaryText} size={7} label="typing" />
              <Text style={[s.typingText, { color: t.ink3 }]} numberOfLines={1}>{typingText}</Text>
            </View>
          )}

          {/* Edit and reply are mutually exclusive by construction — each entry
              point leaves the other — so the two bars cannot stack. Edit takes
              the tertiary container rather than the primary one the reply bar
              uses, because "you are rewriting something that already exists" is
              a different state from "this will be a new message" and they must
              not be told apart only by their words. */}
          {editing && (
            <View style={[s.replyBar, { backgroundColor: t.tertiaryContainer }]}>
              <Ionicons name="pencil-outline" size={14} color={t.onTertiaryContainer} />
              <Text style={[s.replyText, { color: t.onTertiaryContainer }]} numberOfLines={1}>
                Editing your message
              </Text>
              <Pressable onPress={endEdit} hitSlop={8} {...a11yButton('Cancel edit')}>
                <Ionicons name="close" size={15} color={t.onTertiaryContainer} />
              </Pressable>
            </View>
          )}

          {replyTo && !editing && (
            <View style={[s.replyBar, { backgroundColor: t.primaryContainer }]}>
              <Ionicons name="return-down-forward-outline" size={14} color={t.onPrimaryContainer} />
              <Text style={[s.replyText, { color: t.onPrimaryContainer }]} numberOfLines={1}>
                Replying to {replyTo.sender_name ?? 'message'}
              </Text>
              <Pressable onPress={() => setReplyTo(null)} hitSlop={8} {...a11yButton('Cancel reply')}>
                <Ionicons name="close" size={15} color={t.onPrimaryContainer} />
              </Pressable>
            </View>
          )}

          <View style={s.composerRow}>
            {/* The wrapper carries the flex; the suggestion overlay MentionInput
                draws above the field is positioned against its own root, so the
                root has to be the thing that occupies the row. */}
            <View style={s.inputWrap}>
              <MentionInput
                value={draft}
                onChangeText={setDraft}
                placeholder={editing ? 'Edit message…' : replyTo ? 'Reply…' : 'Message…'}
                inputRef={composerRef}
                onTypingChange={setTyping}
                /* The scope the server narrows the candidate set with. It is a
                   route param, so it is right from the first keystroke — unlike
                   the member list this screen used to fetch and hand down. */
                channelId={channelId}
                restricted={restricted}
                locked={!canPost}
                lockedLabel="You have read-only access to Sanvaad."
                style={[s.input, { backgroundColor: t.bg, borderColor: t.outline, color: t.ink }]}
                maxLength={4000}
              />
            </View>

            {canPost && (
              <Pressable
                onPress={send}
                disabled={!canSend}
                accessibilityState={{ disabled: !canSend }}
                {...a11yButton(editing ? 'Save edit' : 'Send message')}
                style={[
                  s.send,
                  { backgroundColor: canSend ? t.primary : withAlpha(t.primary, 0.35) },
                ]}
              >
                {sendMut.isPending || editMut.isPending
                  ? <ActivityIndicator size="small" color={t.onPrimary} />
                  /* A paper plane over an edit would promise a new message. */
                  : <Ionicons name={editing ? 'checkmark' : 'send'} size={16} color={t.onPrimary} />}
              </Pressable>
            )}
          </View>
        </View>
        )}
      </KeyboardAvoidingView>

      <MessageActionSheet
        message={actionFor}
        meId={meId}
        canPost={canPost}
        channelWritable={channelWritable}
        pinned={actionFor ? isPinned(actionFor) : false}
        t={t}
        onClose={() => setActionFor(null)}
        onReact={(m, emoji, mine) => react.mutate({ id: m.id, emoji, mine, msg: m })}
        onReply={startReply}
        onEdit={startEdit}
        onOpenThread={openThread}
        onPin={m => pinMut.mutate({ id: m.id })}
        onUnpin={m => unpinMut.mutate({ id: m.id })}
        onDelete={m => remove.mutate({ msg: m })}
      />

      <PinsSheet
        visible={pinsOpen}
        pins={pins}
        loading={pinsQuery.isLoading}
        canPost={canPost}
        t={t}
        onClose={() => setPinsOpen(false)}
        onUnpin={id => unpinMut.mutate({ id })}
        onGoTo={id => {
          setPinsOpen(false);
          // `/pins` does not return `parent_message_id`, so a pinned thread reply
          // cannot be resolved to its root. Landing in the channel with the row
          // lit is the honest outcome; nothing is said about a thread.
          //
          // It goes through `wanted` rather than setting `highlightId` on its
          // own so that a pin older than the loaded window gets the paging and
          // the notice bar the deep link already had. A deliberate second tap is
          // a fresh request, so the page budget is handed back too.
          huntRef.current = { target: null, pulled: 0 };
          scrolledFor.current = null;
          // Cleared first because the scroll effect is keyed on the VALUE:
          // re-tapping the pin the screen is already lit on would otherwise set
          // `highlightId` to what it already holds, which is not a change and
          // scrolls nothing.
          setHighlightId(null);
          setWanted({ id, hunt: true });
        }}
      />

      <ThreadSheet
        visible={threadOpen}
        rootId={threadRoot}
        root={threadRootMessage}
        replies={threadReplies}
        highlightId={threadHighlight}
        isLoading={threadQuery.isLoading}
        isError={threadQuery.isError}
        meId={meId}
        meName={meName}
        names={knownNames}
        canPost={canPost}
        t={t}
        onClose={() => setThreadOpen(false)}
        onReply={() => {
          setThreadOpen(false);
          const root = threadRootMessage ?? threadReplies?.[0] ?? null;
          if (root) startReply(root);
          else composerRef.current?.focus();
        }}
      />

      <ChannelSheet
        visible={channelSheetOpen}
        muted={!!channel?.muted}
        pinCount={pins.length}
        canPost={canPost}
        t={t}
        onClose={() => setChannelSheetOpen(false)}
        onToggleMute={() => {
          setChannelSheetOpen(false);
          muteMut.mutate({ muted: !channel?.muted });
        }}
        onPins={() => { setChannelSheetOpen(false); setPinsOpen(true); }}
        onSearch={() => {
          setChannelSheetOpen(false);
          nav.navigate('Search', { channelId, channelName: headerTitle });
        }}
      />
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components. All local, all in this file, on purpose: a prop chain that
// crosses a file boundary is the shape that cost the web build three rounds —
// two agents rewrote both ends and nobody touched the component in the middle.
// ─────────────────────────────────────────────────────────────────────────────

type Tokens = ReturnType<typeof useTheme>['t'];

/**
 * The long-press menu.
 *
 * THIS WAS AN `Alert.alert` WITH EIGHT BUTTONS, AND ON ANDROID THAT MEANT THREE.
 * React Native's Android Alert maps only positive / negative / neutral and
 * silently drops the rest, so the menu offered three emoji and nothing else — no
 * Reply, no Delete, not even Cancel — on the platform this product ships on. It
 * had to become a Sheet BEFORE anything was added to it, or Pin and Open thread
 * would have been invisible controls on a fully green build.
 */
function MessageActionSheet({
  message, meId, canPost, channelWritable, pinned, t,
  onClose, onReact, onReply, onEdit, onOpenThread, onPin, onUnpin, onDelete,
}: {
  message: Message | null;
  meId: string;
  canPost: boolean;
  /** Whether this channel is KNOWN to still accept writes — see the derivation
   *  in ChatScreen. Only Edit consults it, and only because Edit is the one
   *  action here whose refusal would arrive after the user had retyped the
   *  message. */
  channelWritable: boolean;
  pinned: boolean;
  t: Tokens;
  onClose: () => void;
  onReact: (m: Message, emoji: string, mine: boolean) => void;
  onReply: (m: Message) => void;
  onEdit: (m: Message) => void;
  onOpenThread: (m: Message) => void;
  onPin: (m: Message) => void;
  onUnpin: (m: Message) => void;
  onDelete: (m: Message) => void;
}) {
  // Held through the dismissal so the panel still has something to draw while
  // it animates out.
  const last = useRef<Message | null>(null);
  if (message) last.current = message;
  const m = message ?? last.current;
  if (!m) return null;

  const mine = m.sender_id === meId;
  const tally = tallyReactions(m.reactions, meId);
  const act = (fn: () => void) => { onClose(); fn(); };

  return (
    <Sheet
      visible={!!message}
      onClose={onClose}
      closeLabel="Close message actions"
      panelStyle={[s.sheet, { backgroundColor: t.surface }]}
    >
      <View style={[s.handle, { backgroundColor: t.outline }]} />

      <Text style={[s.sheetTitle, { color: t.ink }]} numberOfLines={1}>
        {m.sender_name ?? 'Message'}
      </Text>
      <Text style={[s.sheetPreview, { color: t.ink3 }]} numberOfLines={2}>{m.content}</Text>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.emojiRow}>
        {QUICK_REACTIONS.map(emoji => {
          const mineOnThis = tally.find(r => r.emoji === emoji)?.mine ?? false;
          return (
            <Pressable
              key={emoji}
              onPress={() => act(() => onReact(m, emoji, mineOnThis))}
              style={[
                s.emojiBtn,
                {
                  backgroundColor: mineOnThis ? t.primaryContainer : t.surface2,
                  borderColor: mineOnThis ? t.primary : 'transparent',
                },
              ]}
              {...a11yButton(mineOnThis ? `Remove ${emoji}` : `React ${emoji}`)}
            >
              <Text style={s.emojiGlyph}>{emoji}</Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {(m.thread_count ?? 0) > 0 && (
        <SheetRow
          t={t}
          icon="chatbubble-ellipses-outline"
          label={`Open thread (${m.thread_count})`}
          onPress={() => act(() => onOpenThread(m))}
        />
      )}

      {canPost && (
        <SheetRow
          t={t}
          icon="return-down-forward-outline"
          label="Reply in thread"
          onPress={() => act(() => onReply(m))}
        />
      )}

      {/* Absent for a viewer rather than disabled: a greyed control reads as
          broken, and the server would refuse this one anyway. */}
      {canPost && (
        <SheetRow
          t={t}
          icon={pinned ? 'pin-outline' : 'pin'}
          label={pinned ? 'Unpin from channel' : 'Pin to channel'}
          onPress={() => act(() => (pinned ? onUnpin(m) : onPin(m)))}
        />
      )}

      {/* EDITING HAD NO WAY IN. `PATCH /messages/{id}` has existed since 058,
          `messagesApi.edit` has been typed and callable the whole time, and this
          screen already renders the "edited" marker off `is_edited` — a marker
          nothing in the app could ever set.

          The three conditions are the three the server enforces, in the order it
          checks them: `sender_id != caller` is a 403 "Can only edit your own
          messages", `_assert_not_archived` refuses an edit in a closed room, and
          `_require_editor` is what `canPost` already stands for. Offering a row
          the server will refuse is worse here than anywhere else in this sheet,
          because the refusal lands only after the message has been rewritten —
          so this one is withheld rather than left to fail loudly. */}
      {mine && canPost && channelWritable && (
        <SheetRow
          t={t}
          icon="create-outline"
          label="Edit message"
          onPress={() => act(() => onEdit(m))}
        />
      )}

      {mine && (
        <SheetRow
          t={t}
          icon="trash-outline"
          label="Delete message"
          tone={t.error}
          onPress={() => act(() => onDelete(m))}
        />
      )}

      <Pressable onPress={onClose} style={[s.cancelBtn, { borderColor: t.outline }]} {...a11yButton('Cancel')}>
        <Text style={[s.cancelText, { color: t.ink3 }]}>Cancel</Text>
      </Pressable>
    </Sheet>
  );
}

function SheetRow({
  t, icon, label, onPress, tone,
}: {
  t: Tokens;
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  tone?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [s.sheetRow, pressed && { backgroundColor: t.surface2 }]}
      {...a11yButton(label)}
    >
      <Ionicons name={icon} size={18} color={tone ?? t.ink2} />
      <Text style={[s.sheetRowText, { color: tone ?? t.ink }]}>{label}</Text>
    </Pressable>
  );
}

/** The pinned list. Unpaged because the server caps a channel at fifty pins. */
function PinsSheet({
  visible, pins, loading, canPost, t, onClose, onUnpin, onGoTo,
}: {
  visible: boolean;
  pins: PinnedMessage[];
  loading: boolean;
  canPost: boolean;
  t: Tokens;
  onClose: () => void;
  onUnpin: (id: string) => void;
  onGoTo: (id: string) => void;
}) {
  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      closeLabel="Close pinned messages"
      panelStyle={[s.sheet, { backgroundColor: t.surface }]}
    >
      <View style={[s.handle, { backgroundColor: t.outline }]} />
      <Text style={[s.sheetTitle, { color: t.ink }]}>Pinned</Text>
      <Text style={[s.sheetSub, { color: t.ink4 }]}>पिन</Text>

      {loading ? (
        <ActivityIndicator color={t.primary} style={s.sheetSpinner} />
      ) : pins.length === 0 ? (
        <Text style={[s.sheetEmpty, { color: t.ink3 }]}>
          Nothing pinned here yet. Long-press a message to pin it.
        </Text>
      ) : (
        <ScrollView style={s.pinScroll} showsVerticalScrollIndicator={false}>
          {pins.map(p => (
            <View key={p.id} style={[s.pinRow, { borderBottomColor: t.outlineVar }]}>
              <Pressable
                style={s.pinRowBody}
                onPress={() => onGoTo(p.id)}
                {...a11yButton(
                  `Pinned by ${p.pinned_by_name ?? 'someone'}: ${p.content}`,
                  'Goes to the message',
                )}
              >
                <Text style={[s.pinRowWho, { color: t.ink }]} numberOfLines={1}>
                  {p.sender_name ?? 'Unknown'}
                </Text>
                <Text style={[s.pinRowText, { color: t.ink2 }]} numberOfLines={3}>{p.content}</Text>
                <Text style={[s.pinRowMeta, { color: t.ink4 }]} numberOfLines={1}>
                  Pinned by {p.pinned_by_name ?? 'someone'}
                </Text>
              </Pressable>
              {canPost && (
                <Pressable onPress={() => onUnpin(p.id)} hitSlop={8} {...a11yButton('Unpin this message')}>
                  <Ionicons name="close-circle-outline" size={19} color={t.ink3} />
                </Pressable>
              )}
            </View>
          ))}
        </ScrollView>
      )}
    </Sheet>
  );
}

/**
 * A thread.
 *
 * It opens even when there is nothing to show. §4.6: a sheet that silently does
 * not appear is indistinguishable from a broken tap, so a 404 or an empty list
 * gets a sentence rather than nothing.
 *
 * TWO THINGS ARE RENDERED HERE THAT `/thread` DOES NOT RETURN, and both are the
 * reason a mention link used to land somebody in a list of strangers' replies:
 * the ROOT the thread hangs off (the endpoint returns direct children only), and
 * a mark on the reply the link points at (the endpoint returns all of them, in
 * order, with nothing to say which one was about you).
 */
function ThreadSheet({
  visible, rootId, root, replies, highlightId, isLoading, isError,
  meId, meName, names, canPost, t, onClose, onReply,
}: {
  visible: boolean;
  rootId: string | null;
  /** The message the replies hang off, or `null` when it is older than the
   *  loaded channel window — see `threadRootMessage`. */
  root: Message | null;
  replies: Message[] | undefined;
  /** The reply a mention link points at. `null` when the thread was opened by
   *  hand, where there is no one reply to single out. */
  highlightId: string | null;
  isLoading: boolean;
  isError: boolean;
  meId: string;
  meName: string | null;
  names: string[];
  canPost: boolean;
  t: Tokens;
  onClose: () => void;
  onReply: () => void;
}) {
  const scrollRef = useRef<ScrollView>(null);

  /**
   * Move the marked reply into view, once per opening.
   *
   * A mark alone is not the fix for "find your own name in thirty replies" — it
   * is only the thing that makes the arrival readable once the list has moved.
   * Reset on close because `Sheet` unmounts its children after the exit
   * animation, so a reopened thread starts at the top again.
   */
  const scrolledTo = useRef<string | null>(null);
  useEffect(() => { if (!visible) scrolledTo.current = null; }, [visible]);

  const markedLaidOut = useCallback((id: string, y: number) => {
    if (scrolledTo.current === id) return;
    scrolledTo.current = id;
    // One frame for the rest of the thread to lay out before the ScrollView is
    // asked to move; 24px of headroom so the marked row is not flush against
    // the top edge with no sign that anything precedes it.
    setTimeout(() => scrollRef.current?.scrollTo({ y: Math.max(0, y - 24), animated: true }), 60);
  }, []);

  const gone = isError || (!isLoading && (replies?.length ?? 0) === 0);
  const replyCount = replies?.length ?? 0;

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      closeLabel="Close thread"
      panelStyle={[s.sheet, { backgroundColor: t.surface }]}
    >
      <View style={[s.handle, { backgroundColor: t.outline }]} />
      <Text style={[s.sheetTitle, { color: t.ink }]}>Thread</Text>
      <Text style={[s.sheetSub, { color: t.ink4 }]}>सूत्र</Text>

      {isLoading && !!rootId ? (
        <ActivityIndicator color={t.primary} style={s.sheetSpinner} />
      ) : gone ? (
        <Text style={[s.sheetEmpty, { color: t.ink3 }]}>
          That conversation is no longer available.
        </Text>
      ) : (
        <ScrollView ref={scrollRef} style={s.pinScroll} showsVerticalScrollIndicator={false}>
          {root ? (
            <View style={[s.threadRoot, { borderBottomColor: t.outlineVar }]}>
              <View style={s.threadRow}>
                <View style={[s.avatarSmall, { backgroundColor: avatarColor(root.sender_id) }]}>
                  <Text style={s.avatarText}>{userInitials(root.sender_name ?? 'Unknown')}</Text>
                </View>
                <View style={s.body}>
                  <View style={s.head}>
                    <Text
                      style={[s.name, { color: root.sender_id === meId ? t.primaryText : t.ink }]}
                      numberOfLines={1}
                    >
                      {root.sender_id === meId ? 'You' : (root.sender_name ?? 'Unknown')}
                    </Text>
                    <Text style={[s.when, { color: t.ink4 }]}>{timeOf(root.created_at)}</Text>
                  </View>
                  <RichText
                    text={root.content}
                    names={names}
                    meName={meName}
                    color={t.ink2}
                    fontSize={14}
                    lineHeight={19}
                  />
                </View>
              </View>
              <Text style={[s.threadRootMeta, { color: t.ink4 }]}>
                {replyCount} {replyCount === 1 ? 'reply' : 'replies'}
              </Text>
            </View>
          ) : (
            /* Stated rather than hidden. The root is read off the channel log
               and a deep-linked one can be older than the loaded window; letting
               the first reply pass for the start of the conversation is the lie
               this sentence exists to avoid. */
            <Text style={[s.threadNoRoot, { color: t.ink4, borderBottomColor: t.outlineVar }]}>
              The message this thread hangs off isn’t in the loaded history.
            </Text>
          )}

          {(replies ?? []).map(r => {
            const marked = !!highlightId && r.id === highlightId;
            return (
              <View
                key={r.id}
                onLayout={marked ? e => markedLaidOut(r.id, e.nativeEvent.layout.y) : undefined}
                // Collapsed into one node only when marked: the whole point is
                // that a screen reader announces WHICH reply this arrival was
                // about, and per-child announcement cannot say that.
                accessible={marked}
                accessibilityLabel={
                  marked
                    ? `Linked reply. ${r.sender_name ?? 'Unknown'} at ${timeOf(r.created_at)}. ${r.content}`
                    : undefined
                }
                style={[
                  s.threadRow,
                  // Same hue as the channel's landing glow, and steady rather
                  // than fading: the sheet can be scrolled away from and come
                  // back to, and a mark that had timed out would leave the
                  // reader hunting again.
                  marked && { backgroundColor: withAlpha(t.primary, 0.14), borderRadius: 10, paddingHorizontal: 6 },
                ]}
              >
                <View style={[s.avatarSmall, { backgroundColor: avatarColor(r.sender_id) }]}>
                  <Text style={s.avatarText}>{userInitials(r.sender_name ?? 'Unknown')}</Text>
                </View>
                <View style={s.body}>
                  <View style={s.head}>
                    <Text style={[s.name, { color: r.sender_id === meId ? t.primaryText : t.ink }]} numberOfLines={1}>
                      {r.sender_id === meId ? 'You' : (r.sender_name ?? 'Unknown')}
                    </Text>
                    <Text style={[s.when, { color: t.ink4 }]}>{timeOf(r.created_at)}</Text>
                  </View>
                  <RichText
                    text={r.content}
                    names={names}
                    meName={meName}
                    color={t.ink2}
                    fontSize={14}
                    lineHeight={19}
                  />
                </View>
              </View>
            );
          })}
        </ScrollView>
      )}

      {canPost && !gone && (
        <Pressable onPress={onReply} style={[s.cancelBtn, { borderColor: t.outline }]} {...a11yButton('Reply in this thread')}>
          <Text style={[s.cancelText, { color: t.primaryText }]}>Reply in thread</Text>
        </Pressable>
      )}
      <Pressable onPress={onClose} style={[s.cancelBtn, { borderColor: t.outline }]} {...a11yButton('Close thread')}>
        <Text style={[s.cancelText, { color: t.ink3 }]}>Close</Text>
      </Pressable>
    </Sheet>
  );
}

/** Channel-level actions: mute, pins, search. */
function ChannelSheet({
  visible, muted, pinCount, canPost, t, onClose, onToggleMute, onPins, onSearch,
}: {
  visible: boolean;
  muted: boolean;
  pinCount: number;
  canPost: boolean;
  t: Tokens;
  onClose: () => void;
  onToggleMute: () => void;
  onPins: () => void;
  onSearch: () => void;
}) {
  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      closeLabel="Close channel options"
      panelStyle={[s.sheet, { backgroundColor: t.surface }]}
    >
      <View style={[s.handle, { backgroundColor: t.outline }]} />
      <Text style={[s.sheetTitle, { color: t.ink }]}>Channel options</Text>
      <Text style={[s.sheetSub, { color: t.ink4 }]}>विकल्प</Text>

      <SheetRow
        t={t}
        icon="pin-outline"
        label={pinCount > 0 ? `Pinned messages (${pinCount})` : 'Pinned messages'}
        onPress={onPins}
      />
      <SheetRow t={t} icon="search-outline" label="Search this channel" onPress={onSearch} />

      {/* Muting is a write and the server gates it on editor, so a viewer does
          not get the control. Muting NEVER hides the mention badge — the server
          still writes the mention row and suppresses only the push, which is why
          the sentence below says notifications rather than "hide". */}
      {canPost && (
        <SheetRow
          t={t}
          icon={muted ? 'notifications-outline' : 'notifications-off-outline'}
          label={muted ? 'Turn notifications back on' : 'Mute notifications'}
          onPress={onToggleMute}
        />
      )}

      <Pressable onPress={onClose} style={[s.cancelBtn, { borderColor: t.outline }]} {...a11yButton('Close')}>
        <Text style={[s.cancelText, { color: t.ink3 }]}>Close</Text>
      </Pressable>
    </Sheet>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
  // The list is inverted, so its empty state would render upside down.
  emptyInverted: { transform: [{ scaleY: -1 }], paddingVertical: 60 },

  header: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 14, paddingBottom: 10, borderBottomWidth: StyleSheet.hairlineWidth,
  },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  headerTitle: { fontSize: 17, fontWeight: '700', flexShrink: 1 },
  headerSub: { fontSize: 11.5, marginTop: 1, ...hindi() },
  awayDot: { width: 8, height: 8, borderRadius: 4 },

  pinBar: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 14, paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  pinBarCount: { fontSize: 12, fontWeight: '700' },
  pinBarText: { flex: 1, fontSize: 12 },

  listPad: { paddingHorizontal: 12, paddingVertical: 10 },
  olderSpinner: { paddingVertical: 14 },

  row: { flexDirection: 'row', gap: 10, paddingVertical: 6, paddingHorizontal: 4, borderRadius: 10 },
  rowGrouped: { paddingVertical: 2 },
  avatar: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  avatarSmall: { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  avatarSpacer: { width: 32 },
  avatarText: { color: '#FFFFFF', fontSize: 12, fontWeight: '700' },
  body: { flex: 1, minWidth: 0 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  name: { fontSize: 13.5, fontWeight: '700', flexShrink: 1 },
  when: { fontSize: 11 },
  edited: { fontSize: 10.5, marginTop: 1 },
  seen: { fontSize: 10.5, marginTop: 3 },

  metaRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6, marginTop: 6 },
  reaction: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: 99, borderWidth: 1,
  },
  reactionEmoji: { fontSize: 12 },
  reactionCount: { fontSize: 11, fontWeight: '700' },
  threadBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 3, paddingHorizontal: 4 },
  threadText: { fontSize: 11.5, fontWeight: '700' },

  dayRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 10, paddingHorizontal: 4 },
  dayLine: { flex: 1, height: StyleSheet.hairlineWidth },
  dayText: { fontSize: 11, fontWeight: '700', paddingHorizontal: 8 },

  composer: { borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: 12, paddingTop: 8 },
  noticeBar: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7, marginBottom: 8,
  },
  noticeText: { flex: 1, fontSize: 11.5, lineHeight: 16 },
  noticeAction: { fontSize: 11.5, fontWeight: '700', textDecorationLine: 'underline' },
  typingRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingBottom: 6, paddingHorizontal: 2 },
  typingText: { flex: 1, fontSize: 11.5 },
  replyBar: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, marginBottom: 8,
  },
  replyText: { flex: 1, fontSize: 12 },
  composerRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  inputWrap: { flex: 1, minWidth: 0 },
  input: {
    alignSelf: 'stretch', borderWidth: 1, borderRadius: 20,
    paddingHorizontal: 14, paddingTop: 9, paddingBottom: 9,
    fontSize: 14.5, maxHeight: 120,
  },
  send: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },

  emptyTitle: { fontSize: 15, fontWeight: '700', marginTop: 4 },
  emptyBody: { fontSize: 13, textAlign: 'center', lineHeight: 19 },

  // ── Sheets ────────────────────────────────────────────────────────────────
  sheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingBottom: Platform.OS === 'ios' ? 34 : 22,
    paddingHorizontal: 18,
    maxHeight: '80%',
  },
  handle: {
    width: 36, height: 4, borderRadius: 2,
    alignSelf: 'center', marginTop: 10, marginBottom: 6,
  },
  sheetTitle: { fontSize: 16, fontWeight: '700', textAlign: 'center', marginTop: 6 },
  sheetSub: { fontSize: 11.5, textAlign: 'center', marginBottom: 10, ...hindi() },
  sheetPreview: { fontSize: 12.5, lineHeight: 17, textAlign: 'center', marginBottom: 12 },
  sheetSpinner: { paddingVertical: 28 },
  sheetEmpty: { fontSize: 13, lineHeight: 19, textAlign: 'center', paddingVertical: 24, paddingHorizontal: 10 },
  sheetRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingVertical: 13, paddingHorizontal: 6, borderRadius: 10,
  },
  sheetRowText: { fontSize: 14.5, fontWeight: '600' },
  emojiRow: { gap: 8, paddingVertical: 4, paddingHorizontal: 2 },
  emojiBtn: {
    width: 46, height: 46, borderRadius: 23, borderWidth: 1,
    alignItems: 'center', justifyContent: 'center',
  },
  emojiGlyph: { fontSize: 22 },
  cancelBtn: {
    borderRadius: 12, borderWidth: 1,
    paddingVertical: 12, alignItems: 'center', marginTop: 8,
  },
  cancelText: { fontSize: 14, fontWeight: '700' },

  pinScroll: { maxHeight: 380 },
  pinRow: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth,
  },
  pinRowBody: { flex: 1, minWidth: 0, gap: 2 },
  pinRowWho: { fontSize: 13, fontWeight: '700' },
  pinRowText: { fontSize: 13, lineHeight: 18 },
  pinRowMeta: { fontSize: 10.5, marginTop: 2 },

  threadRow: { flexDirection: 'row', gap: 10, paddingVertical: 8 },
  threadRoot: { paddingBottom: 8, marginBottom: 6, borderBottomWidth: StyleSheet.hairlineWidth },
  // Indented past the small avatar and its gap so the count sits under the body
  // it counts, not under the face.
  threadRootMeta: { fontSize: 10.5, fontWeight: '700', marginLeft: 36 },
  threadNoRoot: {
    fontSize: 11.5, lineHeight: 16, textAlign: 'center',
    paddingVertical: 10, marginBottom: 6, borderBottomWidth: StyleSheet.hairlineWidth,
  },
});
