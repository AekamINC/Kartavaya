/**
 * ChannelsTab.jsx — the three-pane shell: list · chat · thread, and the search
 * panel that covers two of the three.
 *
 * SEARCH IS NOT A FOURTH GRID COLUMN and this file adds no modifier for it.
 * `.sv__srch` is `position: absolute; inset: 0 0 0 264px` — it starts at the
 * rail's right edge and covers the chat and the thread together. `sanvaad.css`
 * states why: the grid is already `264px | 1fr | 330px` at its widest, a fourth
 * track would take the message log below the width a conversation is readable
 * at, and a result is read instead of the log rather than beside it.
 *
 * THIS FILE IS ALSO WHERE A MENTION NOTIFICATION LANDS. `notifications.url` is
 * `/sanvaad?channel=<uuid>&message=<uuid>` and `InboxPage`/`NotificationsModal`
 * navigate it through react-router; nothing read those two parameters, so the
 * link opened the module at whatever channel happened to be selected and the
 * message it named was never shown. The rail is loaded here and nowhere else,
 * which is why the deep link resolves here and nowhere else.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../../lib/api';
import { currentUser } from '../../lib/auth';
import { EmptyState, useToast } from '../../components/ui';
import ChannelList from './ChannelList';
import ChatPane from './ChatPane';
import MentionsPanel from './MentionsPanel';
import SearchPanel from './SearchPanel';
import ThreadPanel from './ThreadPanel';
import { ChatArt, SvIcons } from './icons';
import useSanvaadAccess from './useSanvaadAccess';
import usePresence from './usePresence';

export default function ChannelsTab() {
  const { pushToast } = useToast();
  // `currentUser()` parses localStorage and returns a fresh object every call,
  // so it is read once — otherwise every render hands the tree a new identity.
  const me = useMemo(() => currentUser(), []);
  const meId = me?.user_id;
  const meName = me?.full_name || me?.name || null;
  const access = useSanvaadAccess();

  const [channels, setChannels] = useState([]);
  const [archived, setArchived] = useState([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState(null);
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState(null);
  const [thread, setThread] = useState(null);
  // `ScreensSanvaad.jsx:197-199` — the rail has two modes. Compact is the
  // default and shows what is live; "All" adds the archived section.
  const [showAll, setShowAll] = useState(false);
  // Below 900px the grid is one column, so the list and the chat take turns.
  const [pane, setPane] = useState('list');

  // The search panel and the message it was asked to jump to. `searchChannelId`
  // is the channel the panel opens SCOPED to; it is not the same as `selected`,
  // because the reader can widen the scope to the whole org without leaving the
  // conversation behind them.
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchChannelId, setSearchChannelId] = useState(null);
  /**
   * The mentions feed. A second panel over the same two columns as search, and
   * the two are mutually exclusive for the reason `.sv__srch` and `.sv__mnp`
   * share a `z-index` band: they occupy the identical box, so both open at once
   * is one panel silently hiding the other rather than two panels.
   */
  const [mentionsOpen, setMentionsOpen] = useState(false);
  /**
   * Which message the chat pane should scroll to once it has loaded.
   *
   * It deliberately survives the jump rather than being cleared on the next
   * frame: `ChatPane` is keyed by channel id, so a jump to another channel
   * remounts it and the prop has to still be there when the new instance's
   * first page resolves — which is one round trip after this state is set.
   */
  const [focusMessageId, setFocusMessageId] = useState(null);
  /**
   * The thread root that message sits under, when it is a thread reply.
   *
   * `services/samvaad_mentions.MENTION_URL_THREAD_PARAM` names the wire half of
   * this — the parameter is `thread` and its value is the reply's
   * `parent_message_id`. It is a SECOND piece of state rather than a flag on
   * the first because the two answer different questions: `thread` decides
   * whether the panel opens, `message` is the row to highlight once it has.
   *
   * Null for the ordinary case, which is every mention written straight into a
   * channel.
   */
  const [focusThreadId, setFocusThreadId] = useState(null);
  /**
   * The open channel's member list, reported up by `ChatPane`.
   *
   * It lives here for one reason: `ThreadPanel` is the grid's third column and
   * therefore this file's child, not the chat pane's, while the list itself is
   * fetched by the chat pane's hook. Without this the thread composer had no
   * `members`, so `MentionInput` computed an empty candidate list and its popup
   * could not open at all — a thread mention had to be typed blind and spelled
   * exactly, while the server went on resolving it out of the reply's text.
   */
  const [channelMembers, setChannelMembers] = useState([]);

  /* ── Thread panel exit ────────────────────────────────────────────────────
   *
   * `setThread(null)` unmounted the panel on the spot, so `svThreadOut` could
   * never play — the same defect `Popover.jsx` documents for `.pop.is-closing`,
   * a keyframe that sat in the stylesheet for months with nothing to set its
   * class. The panel stays mounted with `.is-closing` until the exit animation
   * ends.
   *
   * DRIVEN BY `animationend`, NOT A TIMER, for the reason Popover spells out: the
   * CSS side is `calc(220ms * var(--ix))` and `--ix` is the user's own Animations
   * preference, so no constant is right at more than one setting. The timeout
   * below is a CEILING for the case where the node is hidden mid-animation and
   * the event never arrives — it sits above the longest possible CSS duration so
   * it is a fallback rather than a race.
   *
   * `--ix` bottoms out at `.001` and not `0` precisely so `animationend` still
   * fires under reduced motion; a zero-duration animation never fires it and the
   * panel would never unmount.
   */
  const [closingThread, setClosingThread] = useState(false);
  const closingRef = useRef(false);
  const exitTimer = useRef(null);

  const finishThreadClose = useCallback(() => {
    clearTimeout(exitTimer.current);
    closingRef.current = false;
    setClosingThread(false);
    setThread(null);
  }, []);

  const closeThread = useCallback(() => {
    closingRef.current = true;
    setClosingThread(true);
    clearTimeout(exitTimer.current);
    exitTimer.current = setTimeout(finishThreadClose, 600);
  }, [finishThreadClose]);

  // A thread panel is full of other people's animations — a skeleton while the
  // replies load, a reaction chip, a message arriving. `e.target !==
  // e.currentTarget` keeps any of them from being mistaken for the panel's own
  // exit, and `closingRef` keeps the ENTRANCE finishing from closing it.
  const onThreadAnimEnd = useCallback((e) => {
    if (e.target !== e.currentTarget) return;
    if (!closingRef.current) return;
    finishThreadClose();
  }, [finishThreadClose]);

  useEffect(() => () => clearTimeout(exitTimer.current), []);

  /**
   * Cancel any pending close and set the thread in one step.
   *
   * Both callers need this and neither wants an exit animation. Opening a
   * different thread while one is closing must cancel the close, or the pending
   * unmount lands on the newly opened panel; switching channel drops the thread
   * outright, because the pane it belonged to is going away in the same frame.
   */
  const setThreadNow = useCallback((msg) => {
    clearTimeout(exitTimer.current);
    closingRef.current = false;
    setClosingThread(false);
    setThread(msg);
  }, []);

  /**
   * Opening a thread closes search, and not the other way round.
   *
   * The two directions are not symmetrical. Search is painted OVER the thread
   * column, so a thread opened underneath it would be invisible until the panel
   * closed — hence this. The reverse is not true and must not be added: leaving
   * the thread mounted under the search panel is what puts the reader back where
   * they were when they dismiss it, and dropping it would make search a way to
   * lose your place.
   */
  const openThread = useCallback((msg) => {
    setSearchOpen(false);
    setThreadNow(msg);
  }, [setThreadNow]);
  const dropThread = useCallback(() => setThreadNow(null), [setThreadNow]);

  const openSearch = useCallback((cid = null) => {
    setSearchChannelId(cid ? String(cid) : null);
    setMentionsOpen(false);
    setSearchOpen(true);
  }, []);

  // The other direction of the same exclusion. Search is deliberately NOT
  // unmounted when it is covered (it holds the query and the results the reader
  // already paid a round trip for), so closing it here rather than layering is
  // what stops a dismissed mentions panel from revealing a search the reader had
  // finished with.
  const openMentions = useCallback(() => {
    setSearchOpen(false);
    setMentionsOpen(true);
  }, []);

  /**
   * Three states, not two.
   *
   * This used to `catch { setChannels([]) }`, and an empty rail says something
   * specific: "No channels yet. Create one to start messaging." A member of nine
   * channels whose list request 500s or who is on a train was told they belong
   * to none, and offered the one action — create a channel — that is wrong in
   * every failure case. Loading, empty and failed are three different sentences
   * and the rail now knows which one it is in.
   */
  const loadChannels = useCallback(async () => {
    try {
      const r = await api.get('/v1/messaging/channels');
      setChannels(Array.isArray(r.data) ? r.data : []);
      setListError(null);
    } catch (e) {
      setChannels([]);
      setListError(e);
    } finally {
      setLoading(false);
    }
  }, []);

  /**
   * Archived channels are a second call, made only when the rail is expanded.
   * They are cold — nothing can be posted to them — so paying for them on the
   * first paint of every visit would be waste. `list_channels` hard-filtered
   * `is_archived = FALSE` until now, which is why an archived channel had no
   * route back: not in the list, so not selectable, so never unarchivable.
   */
  /**
   * Returns the rows as well as storing them, because `jumpTo` below needs the
   * answer in the same tick it asked — a search hit in an archived channel has
   * to select a row that is not in state yet, and reading `archived` back after
   * `setArchived` would read the render before this one.
   */
  const loadArchived = useCallback(async () => {
    try {
      const r = await api.get('/v1/messaging/channels', { params: { archived: true } });
      const rows = Array.isArray(r.data) ? r.data : [];
      setArchived(rows);
      return rows;
    } catch {
      setArchived([]);
      return [];
    }
  }, []);

  useEffect(() => { loadChannels(); }, [loadChannels]);
  useEffect(() => { if (showAll) loadArchived(); }, [showAll, loadArchived]);

  const createChannel = async (name, type) => {
    setCreating(true);
    try {
      const r = await api.post('/v1/messaging/channels', { name, type });
      setChannels(prev => [r.data, ...prev]);
      setSelected(r.data);
      dropThread();
      setPane('chat');
      // `useToast()` returns { pushToast, error, success, warning, info } — the
      // handover's headline defect is that this file called a nonexistent
      // `addToast`. It does not: every call site here was already `pushToast`.
      pushToast({ type: 'success', title: 'Channel created' });
      return r.data;
    } catch (e) {
      pushToast({ type: 'error', title: e.response?.data?.detail || 'Failed to create channel' });
      return null;
    } finally {
      setCreating(false);
    }
  };

  /**
   * `POST /v1/messaging/dm` — find-or-create. It had no caller, and
   * `create_channel` rejects `type='dm'` outright ("Use /dm endpoint for DM
   * channels"), so **no DM could exist**: `ChannelList` rendered a "Direct
   * messages" heading over a list that was empty by construction.
   */
  const openDm = async (person) => {
    try {
      const r = await api.post('/v1/messaging/dm', null, {
        params: { target_user_id: person.user_id },
      });
      // find-or-create, so the row may already be in the rail.
      const dm = { ...r.data, name: r.data.name || person.full_name };
      setChannels(prev => (
        prev.some(c => String(c.id) === String(dm.id)) ? prev : [dm, ...prev]
      ));
      select(dm);
      return dm;
    } catch (e) {
      pushToast({ type: 'error', title: e.response?.data?.detail || 'Failed to open direct message' });
      return null;
    }
  };

  const select = (ch) => {
    setSelected(ch);
    dropThread();
    setPane('chat');
    // A channel opened by hand is not a channel opened at a message, and it is
    // certainly not one opened at a thread inside it.
    setFocusMessageId(null);
    setFocusThreadId(null);
    // The search panel starts at the rail's right edge precisely so the channel
    // list stays reachable while a result is open — `sanvaad.css` says that is
    // the point of scoping a search to a channel. Which means clicking a
    // different channel has to MOVE the scope: leaving it behind would show
    // "Only in #accounts" over a conversation called #hr, and the next query
    // would silently answer for a channel the reader had left.
    if (searchOpen) setSearchChannelId(String(ch.id));
    // Both badges clear the moment the channel opens; the log keeps its own
    // snapshot of `last_read_at` for the unread divider. The mention badge is
    // cleared SERVER-side by the `POST /channels/:id/read` that
    // `useChannelMessages` already fires on mount — this is the local half, so
    // the count does not sit there until the next `/live` tick.
    setChannels(prev => prev.map(c => (
      c.id === ch.id ? { ...c, unread_count: 0, mention_count: 0 } : c
    )));
  };

  /**
   * A channel edited in its settings sheet. Archiving moves it between the two
   * lists rather than reloading both, so the rail does not flicker; the open
   * chat pane keeps the new row so its banner and locked composer appear at
   * once.
   */
  const channelChanged = (row, opts = {}) => {
    if (opts.members) { loadChannels(); return; }
    if (!row) return;
    /**
     * Mute is one boolean on the caller's own membership row, not a property of
     * the channel, so `PUT /channels/:id/mute` answers `{ok, muted}` rather than
     * the channel — there is no row to spread here and patching one field is
     * the whole change. It returns early for that reason: falling through to the
     * generic `{...c, ...row}` below would spread a stale channel over a fresh
     * one and undo whatever the last poll brought in.
     */
    if (typeof opts.muted === 'boolean') {
      const mute = c => (String(c.id) === String(row.id) ? { ...c, muted: opts.muted } : c);
      setChannels(prev => prev.map(mute));
      setArchived(prev => prev.map(mute));
      setSelected(s => (String(s?.id) === String(row.id) ? { ...s, muted: opts.muted } : s));
      return;
    }
    if (opts.archived === true) {
      setChannels(prev => prev.filter(c => String(c.id) !== String(row.id)));
      setArchived(prev => (prev.some(c => String(c.id) === String(row.id)) ? prev : [row, ...prev]));
      setSelected(s => (String(s?.id) === String(row.id) ? { ...s, ...row } : s));
      return;
    }
    if (opts.archived === false) {
      setArchived(prev => prev.filter(c => String(c.id) !== String(row.id)));
      setChannels(prev => (prev.some(c => String(c.id) === String(row.id)) ? prev : [row, ...prev]));
    }
    const patch = c => (String(c.id) === String(row.id) ? { ...c, ...row } : c);
    setChannels(prev => prev.map(patch));
    setArchived(prev => prev.map(patch));
    setSelected(s => (String(s?.id) === String(row.id) ? { ...s, ...row } : s));
  };

  /* ── The cross-channel poll ───────────────────────────────────────────────
   *
   * ONE `GET /v1/messaging/live` carries the unread and mention counts for every
   * channel, the typing rows for the focused one, the presence map and the
   * caller's own heartbeat. It lives here because this is the only component
   * that holds the whole channel list — a per-channel poll would be one request
   * per row in the rail, and a typing ping of its own would be a POST every
   * three seconds against a write budget of 120 per minute per client IP that
   * four colleagues behind one office NAT already share.
   *
   * It is a POLL and it stays one. Supabase's pooler runs transaction mode on
   * :6543, where `LISTEN/NOTIFY` does not work, and the service runs several
   * gunicorn workers, so an in-process broadcast would reach one worker's
   * clients and nobody else's.
   *
   * `enabled` is false while the list itself is failing: a rail that could not
   * load has no channels to count, and polling every four seconds against a
   * request that is already 403ing adds nothing but load.
   */
  const live = usePresence({ channelId: selected?.id || null, enabled: !listError });
  const liveChannels = live?.channels || null;
  const presence = live?.presence || null;
  /**
   * The org-wide unread mention count, and the force-a-tick handle.
   *
   * Both were computed and thrown away: `usePresence` returns them, the server
   * pays for the `mention_unread` subquery on every four-second poll, and this
   * file destructured neither — so the count existed nowhere on screen and every
   * mark-read waited out the interval before the rail agreed with it.
   *
   * `serverTime` used to be listed here as the one part of the payload still
   * without a consumer. It no longer exists: `/live` decides presence entirely
   * in Postgres and hands down `'online' | 'away'` per user, so there was no
   * client-side clock comparison for it to correct and no third thing left
   * computed and thrown away. `usePresence` records where the skew would come
   * back from if `relTime()` ever needs it.
   */
  const mentionUnread = Number(live?.mentionUnread) || 0;
  const refreshLive = live?.refresh;
  /**
   * Three consecutive dead polls — about twelve seconds.
   *
   * The last of the returns this file was ignoring, and the costliest to
   * ignore. `usePresence` deliberately KEEPS the last good payload through a
   * failure, because blanking every badge in the rail on one timeout would tell
   * the reader their unread messages had been read by somebody. That is the
   * right behaviour and it is only half of the bargain: frozen counts are
   * indistinguishable from a quiet afternoon, so the counter, the threshold and
   * the `error` state that `usePresence` computes to say so all existed with
   * nothing on screen reading them.
   *
   * Suppressed while the rail itself is failing. `enabled: !listError` stops
   * the poll in that case, so anything left in `error` would be a leftover
   * standing under a `ChannelList` that is already explaining the same refusal.
   */
  const liveStale = !listError && !!live?.error;

  /**
   * The rail's rows with the poll's counts folded in.
   *
   * `loadChannels` runs on mount and after a send; `/live` runs every four
   * seconds. Merging here rather than reloading the list means a badge can move
   * without re-fetching every channel's member count and last-read timestamp.
   *
   * The SELECTED channel is forced to zero. The server clears `last_read_at` and
   * the mention rows when `useChannelMessages` posts `/read` on open, but the
   * next `/live` tick can be in flight when that lands — so for a second or two
   * the poll would re-assert an unread count for the conversation the reader is
   * looking at. You are not unread in the channel that is on your screen.
   */
  const railChannels = useMemo(() => {
    if (!liveChannels && !selected) return channels;
    return channels.map((c) => {
      const key = String(c.id);
      const l = liveChannels ? liveChannels[key] : null;
      const mine = String(selected?.id || '') === key;
      if (!l && !mine) return c;
      return {
        ...c,
        unread_count: mine ? 0 : (l ? Number(l.unread) || 0 : c.unread_count),
        mention_count: mine ? 0 : (l ? Number(l.mentions) || 0 : c.mention_count),
        muted: l ? !!l.muted : c.muted,
      };
    });
  }, [channels, liveChannels, selected]);

  /**
   * Open a channel at one message — the shared tail of a search result and a
   * mention notification.
   *
   * Resolution order is the rail, then the archived list, then a reload of the
   * archived list. `GET /channels` returns every non-archived public channel in
   * the org plus the private ones and DMs this user belongs to, which is exactly
   * the set `/search` can match inside — so the one way a legitimate hit can be
   * off the rail is `is_archived = TRUE`, and that is precisely the case the
   * archived banner promises still works ("history stays readable and
   * searchable"). Anything still unresolved after that is a channel this reader
   * can no longer open, and it says so rather than selecting a stub whose header
   * would be blank and whose message log would 403.
   *
   * `threadRootId` is the third parameter and it is OPTIONAL at every call site
   * that does not have one — a search hit does not, because `/search` selects no
   * `parent_message_id`. Where it IS present the reader is being sent to a reply
   * rather than to a message in the log, and `ChatPane` is the half that knows
   * how to reach one; this layer only carries it across.
   */
  const jumpTo = async (channelId, messageId, threadRootId = null) => {
    const cid = String(channelId || '');
    if (!cid) return false;
    let row = channels.find(c => String(c.id) === cid)
      || archived.find(c => String(c.id) === cid);
    if (!row) {
      const rows = await loadArchived();
      row = rows.find(c => String(c.id) === cid);
      // The archived section is collapsed by default, so the rail would show no
      // selected row beside an open archived conversation.
      if (row) setShowAll(true);
    }
    if (!row) {
      pushToast({
        type: 'error',
        title: 'That conversation is no longer in your channel list',
      });
      return false;
    }
    setSearchOpen(false);
    // The mentions feed closes on a successful jump for the same reason search
    // does: the reader asked to be taken somewhere, and leaving the panel over
    // the message it just opened would hide the thing they clicked for.
    setMentionsOpen(false);
    select(row);
    // After `select`, which clears both — a jump is the one case that sets them.
    // Written unconditionally rather than only when there is a root, so a second
    // jump into the channel-log case cannot inherit the previous jump's thread.
    if (messageId) {
      setFocusMessageId(String(messageId));
      setFocusThreadId(threadRootId ? String(threadRootId) : null);
    }
    return true;
  };

  /* ── The mention deep link ────────────────────────────────────────────────
   *
   * `?channel=<uuid>&message=<uuid>[&thread=<uuid>]`, written by
   * `fan_out_mentions` into `notifications.url` and navigated by the inbox.
   *
   * THE THIRD PARAMETER IS `thread` AND ITS VALUE IS THE ROOT, not a flag and
   * not the reply. `services/samvaad_mentions.py` pins the name in
   * `MENTION_URL_THREAD_PARAM` and explains why it is a named constant on that
   * side and three literal `params.get` calls on this one: a url is a wire
   * format and neither half can import the other, so the string is the contract.
   * It is present only when the mentioned message is a reply — `list_messages`
   * filters `parent_message_id IS NULL`, so without it the reply is a row this
   * page can quote in the mentions feed and cannot navigate to.
   *
   * The effect waits for the first channel list to answer, because the row it
   * has to select does not exist before then, and it runs once per navigation —
   * `deepLinked` is a ref rather
   * than state, so a re-render while the jump is in flight (the archived reload
   * is a round trip) cannot fire a second one. It resets when the parameters
   * clear, which is what lets a SECOND notification click land while the reader
   * is already on this page.
   *
   * The three parameters are DELETED rather than the whole query string being
   * replaced, so a link that also carried something else keeps it. Clearing them
   * is what stops a refresh from re-jumping to a message the reader has already
   * read and scrolled away from — and `thread` has to be cleared with the other
   * two, or a later link into the same channel would reopen a panel it never
   * asked for.
   */
  const [params, setParams] = useSearchParams();
  const wantChannel = params.get('channel');
  const wantMessage = params.get('message');
  const wantThread = params.get('thread');
  const deepLinked = useRef(false);

  useEffect(() => {
    if (!wantChannel) { deepLinked.current = false; return; }
    if (deepLinked.current || loading || listError) return;
    deepLinked.current = true;
    (async () => {
      await jumpTo(wantChannel, wantMessage, wantThread);
      const next = new URLSearchParams(params);
      next.delete('channel');
      next.delete('message');
      next.delete('thread');
      setParams(next, { replace: true });
    })();
    // `jumpTo` closes over `channels`, which changes on every poll of the list;
    // depending on it would re-run this effect rather than the ref-guarded once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantChannel, wantMessage, wantThread, loading, listError]);

  const searchChannelName = useMemo(() => {
    if (!searchChannelId) return '';
    const row = channels.find(c => String(c.id) === String(searchChannelId))
      || archived.find(c => String(c.id) === String(searchChannelId));
    if (!row) return '';
    return row.type === 'dm' ? (row.name || 'this direct message') : `#${row.name}`;
  }, [searchChannelId, channels, archived]);

  return (
    <div className={`sv${thread ? ' sv--thread' : ''}`} data-pane={pane}>
      {/* `.sv__rail` is the grid's first track and `ChannelList` is what used to
          be. The wrapper exists for one reason: the Mentions entry belongs ABOVE
          the channel list — that is where every reader of a chat product looks
          for it — and the channel list is `ChannelList.jsx`'s markup, which this
          shell does not write. Wrapping keeps the track exactly 264px wide, which
          `.sv__srch`'s and `.sv__mnp`'s `left: 264px` both restate and neither
          can read off the grid. */}
      <div className="sv__rail">
        {/* The poll has stopped answering and every number below this line is
            older than it looks.

            `.sv__banner` and not a badge, a spinner or a toast. It is the same
            shape the archived channel uses two columns to the right — a quiet
            tonal strip that qualifies what is under it — and this is the same
            kind of statement: not "something went wrong", but "read the
            following with a caveat". A toast would be an alarm that expires
            while the condition it describes is still true; a spinner would
            promise activity where there is a failing request.

            It sits ABOVE the Mentions row because it qualifies that row's badge
            too — `mention_unread` rides the same payload as the per-channel
            counts and freezes with them.

            No `aria-live`, deliberately. A region announces on MUTATION, so one
            mounted with its content is silent anyway (`ChatPane`'s typing line
            documents the same trap from the other side), and the fix — an
            always-mounted empty region — would interrupt a screen-reader user
            mid-sentence to report a network blip. The sentence is ordinary text
            at the top of the rail, which is where somebody reading the rail
            reaches it. */}
        {liveStale && (
          <div className="sv__banner">
            <span className="ch__ic" aria-hidden="true">{SvIcons.clock}</span>
            Live updates are not getting through. The counts here are from the
            last successful check and will catch up on their own.
          </div>
        )}

        {/* Hidden while the rail is failing, not disabled. The whole panel reads
            `/v1/messaging/mentions` behind the same `_gate` that has just refused
            `/channels`, so the count would be zero and the panel would open onto
            the same 403 the rail is already explaining beside it — two panes of
            one screen reporting one failure twice. */}
        {!listError && (
          <button
            type="button"
            className="sv__mnb"
            onClick={openMentions}
            aria-expanded={mentionsOpen}
          >
            <span className="ch__ic" aria-hidden="true">{SvIcons.at}</span>
            <span className="sv__mnb-t">
              Mentions
              <span className="sv__hi" lang="hi">उल्लेख</span>
            </span>
            {/* `.ch__mn` and not a badge of its own. This is the same fact the
                rail's per-channel `@3` carries — "somebody said your name" — and
                `sanvaad.css` records why that badge is `--danger` where the
                unread count is `--primary`. A second mention badge in a second
                shape, eight pixels above the first, would read as two different
                things. */}
            {mentionUnread > 0 && (
              <span
                className="ch__mn"
                aria-label={`${mentionUnread} unread mention${mentionUnread === 1 ? '' : 's'}`}
              >
                {mentionUnread > 99 ? '99+' : mentionUnread}
              </span>
            )}
          </button>
        )}

        {/* No `presence` here, deliberately. `ChannelList` destructures a closed
            list of props and has never had one — React drops an undeclared prop
            without a word, so passing it read as a wired feature and rendered
            nothing, the same "computed and thrown away" shape the `/live`
            comment above describes. Presence is scoped to the member list in
            `ChannelDetails`, which is the one place a rule for the dot exists;
            there is no `.ch__` presence rule for a rail row to use. If the rail
            ever wants a dot, the CSS has to come with it. */}
        <ChannelList
          channels={railChannels}
          archived={archived}
          showAll={showAll}
          onToggleAll={() => setShowAll(v => !v)}
          loading={loading}
          selectedId={selected?.id}
          onSelect={select}
          onCreate={createChannel}
          onOpenDm={openDm}
          canPost={access.canPost}
          creating={creating}
          error={listError}
          onRetry={() => { setLoading(true); loadChannels(); }}
        />
      </div>

      {selected ? (
        <ChatPane
          key={selected.id}
          channel={selected}
          me={me}
          meId={meId}
          meName={meName}
          access={access}
          threadOpen={!!thread && !closingThread}
          onOpenThread={openThread}
          onSent={loadChannels}
          onChannelChanged={channelChanged}
          onBack={() => setPane('list')}
          presence={presence || undefined}
          typing={live?.typing || undefined}
          focusMessageId={focusMessageId}
          /* Set only by a deep link that named a thread. `ChatPane` finds the
             root in its own log and calls `onOpenThread` with it, because this
             file holds no messages and `ThreadPanel` needs the whole row — it
             renders the root above the replies, so an id alone would draw an
             "Unknown" author over an invalid date. */
          focusThreadId={focusThreadId}
          /* The setter itself, not an inline arrow: this is an effect
             dependency inside `ChatPane` and a new identity every render would
             re-run it on every poll. */
          onMembers={setChannelMembers}
          onOpenSearch={() => openSearch(selected.id)}
          /* `setTyping` only sets a ref inside `usePresence`; the flag rides the
             NEXT scheduled `/live` poll rather than firing a request of its own.
             That is the whole rate-limit defence — a dedicated typing POST at
             3s is 20 writes a minute per person against a budget of 120 per
             client IP, which four colleagues behind one office NAT share. */
          onTyping={live?.setTyping}
        />
      ) : (
        <div className="sv__blank">
          {/* Nothing to pick from, so nothing to say. When the list failed the
              rail beside this already carries the reason, and this pane went on
              printing "Pick a channel or a direct message on the left" next to a
              rail that had just said the module is not active. Measured live on
              2026-07-30: two panes of one screen contradicting each other. */}
          {!listError && (
            <EmptyState
              icon={ChatArt}
              title={{ en: 'Select a channel', hi: 'संवाद शुरू करने के लिए एक चैनल चुनें' }}
              /* F32, found in the sweep on a module not previously examined. This
                 read "…or create one to start a conversation" for everyone, while
                 the `+` that creates one is gated on `canPost` and every endpoint
                 on the page had just refused. Inviting an action the product does
                 not offer is the same defect as offering a button that fails —
                 the sentence has to agree with the control beside it. */
              description={access.canPost
                ? 'Pick a channel or a direct message on the left, or create one to start a conversation.'
                : 'Pick a channel or a direct message on the left to read the conversation.'}
              /* The other door into search. The one in the chat header only
                 exists once a channel is open, and the reader who most needs to
                 search is the one who does not know which channel the message is
                 in — that is the whole point of an org-wide search and it would
                 have been unreachable from the one screen that states it. */
              action="Search messages"
              onAction={() => openSearch(null)}
            />
          )}
        </div>
      )}

      {thread && selected && (
        <ThreadPanel
          key={thread.id}
          channelId={selected.id}
          root={thread}
          me={me}
          meId={meId}
          meName={meName}
          canPost={access.canPost && !selected.is_archived}
          lockReason={selected.is_archived ? 'archived' : 'viewer'}
          /* The chat pane's own list, handed across rather than fetched again.
             It is what gives the thread composer an `@` popup and the thread's
             replies a mention vocabulary; before it, `MentionInput.people` was
             empty here and the popup could not open for any keystroke. */
          members={channelMembers}
          closing={closingThread}
          onAnimationEnd={onThreadAnimEnd}
          onClose={closeThread}
        />
      )}

      {/* Mounted whether or not it is open — it returns null when closed, which
          keeps the query and the results the reader already has. Unmounting it
          would throw both away every time they clicked a result and came back,
          and re-running the search is a round trip for something the component
          was already holding. */}
      <SearchPanel
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        channelId={searchChannelId}
        channelName={searchChannelName}
        onJump={r => jumpTo(r.channel_id, r.id, r.parent_message_id)}
      />

      {/* `r.message_id`, NOT `r.id` — the two are different columns on the same
          row and `SearchPanel` above passes `r.id` because on a SEARCH hit the id
          IS the message's. Here `id` is the mention's, which is what the
          mark-read contract keys on, and jumping to it would look up an element
          that does not exist and silently land the reader at the bottom of the
          channel. */}
      <MentionsPanel
        open={mentionsOpen}
        onClose={() => setMentionsOpen(false)}
        meName={meName}
        // The third argument is the thread root, and it is what stops the panel
        // quoting a reply's text at the reader and then telling them it is not
        // on screen. `list_messages` filters `parent_message_id IS NULL`, so a
        // mention written inside a thread is never in the log — the email and
        // push links already carried `&thread=`; this surface did not.
        onJump={r => jumpTo(r.channel_id, r.message_id, r.parent_message_id)}
        onRead={refreshLive}
      />
    </div>
  );
}
