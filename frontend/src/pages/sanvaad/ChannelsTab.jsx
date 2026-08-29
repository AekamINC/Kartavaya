/**
 * ChannelsTab.jsx — the TWO-pane shell: rail · conversation, plus the search and
 * mentions panels that cover the second of them.
 *
 * THE THREAD COLUMN IS GONE. THE PANEL IS NOT.
 * `28-messaging-v2.md` §2: a thread reply now renders INSIDE the log, under the
 * message it belongs to. `ThreadPanel` was the grid's third track and a SIBLING
 * of the chat pane, which is why a reply was write-only in practice — you could
 * send into a thread from the composer and the replies lived in a column that
 * had to be opened separately. `.m2th` and `.m2th__body` are the replacement on
 * a desktop and `Message` owns them.
 *
 * What §2 asks for is that the panel stop being the ONLY way to read a reply —
 * it says in as many words "**Do not delete `ThreadPanel`**", because a phone
 * has no room to indent. So the panel survives as the PHONE presentation and
 * `ChatPane` renders it: `.sv__thread` is already `position: absolute; inset: 0`
 * below 900px (sanvaad.css:2428, unscoped) against `.m2c`, so it is an overlay
 * inside the conversation column rather than a track of this grid. Nothing about
 * it reaches this file any more.
 *
 * Two things did go with the column and both are recorded here rather than
 * quietly dropped: the `channelMembers` lift (the panel is now a child of the
 * pane whose hook already fetched the member list, and the inline composer is
 * inside `Message`, which is inside `MessageLog`, which has the same list), and
 * `.sv--thread`, the modifier that widened the grid to three tracks. The
 * `svThreadOut` exit animation and its `animationend` bookkeeping did NOT go:
 * they moved to `ChatPane`, which drives them through `useExitAnimation`.
 *
 * SEARCH IS NOT A GRID COLUMN EITHER and this file adds no modifier for it.
 * `.sv__srch` is `position: absolute; inset: 0 0 0 264px` — it starts at the
 * rail's right edge and covers the conversation. `sanvaad.css` states why: a
 * fourth track would take the message log below the width a conversation is
 * readable at, and a result is read INSTEAD of the log rather than beside it.
 * The `264px` in that rule is the old rail; `.m2--rail` is 296px. See the note
 * at the render site.
 *
 * THIS FILE IS ALSO WHERE A MENTION NOTIFICATION LANDS. `notifications.url` is
 * `/sanvaad?channel=<uuid>&message=<uuid>[&thread=<uuid>]` and
 * `InboxPage`/`NotificationsModal` navigate it through react-router; nothing
 * read those parameters, so the link opened the module at whatever channel
 * happened to be selected and the message it named was never shown. The rail is
 * loaded here and nowhere else, which is why the deep link resolves here.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../../lib/api';
import { currentUser } from '../../lib/auth';
import { EmptyState, useToast } from '../../components/ui';
import useMediaQuery from '../../hooks/useMediaQuery';
import ChannelList from './ChannelList';
import ChatPane, { PHONE } from './ChatPane';
import MentionsPanel from './MentionsPanel';
import SahayakAside from './SahayakAside';
import SearchPanel from './SearchPanel';
import useSahayak from './useSahayak';
import { ChatArt, SvIcons } from './icons';
import useSanvaadAccess from './useSanvaadAccess';
import usePresence from './usePresence';
import { apiErrorText } from '../../lib/apiError';

/**
 * `PHONE` is IMPORTED, not declared here.
 *
 * It used to be this file's constant, and it stopped being only this file's
 * question the moment `ChatPane` had to answer it too: the shell uses it to
 * decide which grid column is rendered, the pane uses it to decide whether a
 * thread opens inline or as `ThreadPanel`. Two literals would be one layout
 * constant in two files, and the state they could drift into — a shell already
 * collapsed to one column while the log is still indenting replies — is exactly
 * the one §2 says a phone has no room for. See the docblock at its declaration
 * for why it lives in the leaf and travels up rather than the other way.
 */

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
  // The archived set is a second request and the "Archived" chip is what fires
  // it. The fetch stays up here because `jumpTo` needs the rows returned to it
  // in the same tick to resolve a search hit into a channel that is not on the
  // rail — reading `archived` back after `setArchived` would read the render
  // before this one.
  const [showAll, setShowAll] = useState(false);
  // On a phone the grid is one column, so the rail and the conversation take
  // turns. See `PHONE`.
  const [pane, setPane] = useState('list');
  const phone = useMediaQuery(PHONE);

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
   * SAHAYAK — `28-messaging-v2.md` §7. Both halves are held HERE and not in
   * `ChatPane`, and each for its own reason.
   *
   * THE OPEN FLAG, because the class that makes the panel's column exist is
   * `.m2--aside` on `.m2` — this component's own element. `ChatPane` fills the
   * middle track and cannot widen the grid it sits in.
   *
   * THE HOOK, because all three of §7's entry points share one answer: the card
   * in the log and the panel must never be able to show two different summaries
   * of the same conversation. `ChatPane` renders the card, `SahayakAside`
   * renders the panel, and both read this one state.
   *
   * The panel is NOT rendered on a phone. `.m2--mob` forces the grid to a single
   * track and only one of the three children is rendered at a time; a 336px
   * reference column beside a conversation is a desktop affordance and on a
   * phone it would be a second full screen with no way back to the first.
   */
  const [asideOpen, setAsideOpen] = useState(false);
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
   * which inline thread expands, `message` is the row to highlight once it has.
   *
   * Null for the ordinary case, which is every mention written straight into a
   * channel.
   */
  const [focusThreadId, setFocusThreadId] = useState(null);

  /**
   * Opening a thread used to close search, and no longer needs to.
   *
   * The old asymmetry existed because the panel was painted OVER the thread
   * COLUMN, so a thread opened underneath it would have been invisible until the
   * panel closed. An inline thread expands inside the log, and the log is under
   * the same panel as everything else in that column — there is no third surface
   * left for one to hide the other on. Both directions are now the same
   * direction, which is why there is no `openThread` here at all: `Message` owns
   * its own expansion and this file never hears about it.
   */
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
      setPane('chat');
      // `useToast()` returns { pushToast, error, success, warning, info } — the
      // handover's headline defect is that this file called a nonexistent
      // `addToast`. It does not: every call site here was already `pushToast`.
      pushToast({ type: 'success', title: 'Channel created' });
      return r.data;
    } catch (e) {
      pushToast({ type: 'error', title: apiErrorText(e, 'Failed to create channel') });
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
      pushToast({ type: 'error', title: apiErrorText(e, 'Failed to open direct message') });
      return null;
    }
  };

  const select = (ch) => {
    setSelected(ch);
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

  /* One assistant per open conversation. Keyed on the channel id, so switching
     rooms starts a fresh one rather than leaving the previous room's summary on
     screen under a different name — the answer states no channel, so nothing on
     screen would have revealed it. */
  const sahayak = useSahayak(selected?.id || null);
  const wipe = sahayak.clear;
  useEffect(() => { wipe(); }, [selected?.id, wipe]);
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

  /**
   * The grid, and which column is on screen at a given width.
   *
   * `.m2--rail` ships as the DEFAULT and `.m2--sections` / `.m2--focus` are not
   * rendered at all — §10 picks the unified rail, and the two alternatives stay
   * in `messaging.css` as the recorded comparison. `.m2--aside` is the Sahayak
   * panel's third track and is now rendered — see `SahayakAside` and §7.
   *
   * On a phone `.m2--mob` collapses the grid to one track AND only one of the
   * two columns is rendered, because a single track with both children in it is
   * a channel list the reader has to scroll past to reach the message they
   * tapped. `.m2--mob-chat` is deliberately NOT rendered: `Messaging v2.html`
   * puts it on three elements and `messaging.css` declares no rule for it at
   * all, and a class with no rule is a FATAL `check-classes` failure rather than
   * a harmless one.
   */
  const showRail = !phone || pane === 'list';
  const showChat = !phone || pane === 'chat';
  // Desktop only, and only with a conversation open — the class widens the grid
  // to a third track, so it must never be on when nothing fills it.
  const showAside = !phone && asideOpen && !!selected;

  return (
    <div
      className={`m2 m2--rail${showAside ? ' m2--aside' : ''}${phone ? ' m2--mob' : ''}`}
      id="m2panel-msg"
      role="tabpanel"
      aria-labelledby="m2tab-msg"
    >
      {showRail && (
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
          onOpenMentions={openMentions}
          mentionsOpen={mentionsOpen}
          mentionUnread={mentionUnread}
          /* The poll has stopped answering and every number in the rail is older
             than it looks.

             `.sv__banner` and not a badge, a spinner or a toast. It is the same
             shape the archived channel uses in the column beside it — a quiet
             tonal strip that qualifies what is under it — and this is the same
             kind of statement: not "something went wrong", but "read the
             following with a caveat". A toast would be an alarm that expires
             while the condition it describes is still true; a spinner would
             promise activity where there is a failing request.

             It goes ABOVE the Mentions row because it qualifies that row's badge
             too — `mention_unread` rides the same payload as the per-channel
             counts and freezes with them.

             No `aria-live`, deliberately. A region announces on MUTATION, so one
             mounted with its content is silent anyway (`ChatPane`'s typing line
             documents the same trap from the other side), and the fix — an
             always-mounted empty region — would interrupt a screen-reader user
             mid-sentence to report a network blip. */
          notice={liveStale ? (
            <div className="sv__banner">
              <span className="ch__ic" aria-hidden="true">{SvIcons.clock}</span>
              Live updates are not getting through. The counts here are from the
              last successful check and will catch up on their own.
            </div>
          ) : null}
        />
      )}

      {showChat && (selected ? (
        <ChatPane
          key={selected.id}
          channel={selected}
          me={me}
          meId={meId}
          meName={meName}
          access={access}
          onSent={loadChannels}
          onChannelChanged={channelChanged}
          /* Only on a phone. On a desktop the rail is beside the conversation
             and a Back control would move nothing. */
          onBack={phone ? () => setPane('list') : undefined}
          presence={presence || undefined}
          typing={live?.typing || undefined}
          focusMessageId={focusMessageId}
          /* Set only by a deep link that named a thread. The ID is enough to
             send across this boundary now, at both widths: `ChatPane` holds the
             log, so it resolves the id to the ROW itself and hands that to
             `ThreadPanel` on a phone, or hands the id to `MessageLog` to expand
             in place on a desktop. When this file owned the panel it had to be
             given the whole root ROW, because the panel draws a header above the
             replies and an id alone would have rendered an "Unknown" author over
             an invalid date. */
          focusThreadId={focusThreadId}
          onOpenSearch={() => openSearch(selected.id)}
          /* `setTyping` only sets a ref inside `usePresence`; the flag rides the
             NEXT scheduled `/live` poll rather than firing a request of its own.
             That is the whole rate-limit defence — a dedicated typing POST at
             3s is 20 writes a minute per person against a budget of 120 per
             client IP, which four colleagues behind one office NAT share. */
          onTyping={live?.setTyping}
          /* §7 — the assistant's three entry points. The hook and the open flag
             are held here; see the state declaration for why each one is.
             `onToggleSahayak` is withheld on a phone, which is what removes
             both the header toggle and the composer's `.m2cp__ai`: there is no
             third track to open on a single-column grid, and a button that
             opens nothing is worse than no button. */
          sahayak={sahayak}
          sahayakOpen={showAside}
          onToggleSahayak={phone ? undefined : (
            next => setAsideOpen(v => (typeof next === 'boolean' ? next : !v))
          )}
        />
      ) : (
        <div className="m2__col sv__blank">
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
      ))}

      {/* §7's second entry point, in `.m2--aside`'s 336px track.

          A SIBLING OF `ChatPane`, not a child of it, because the track is a
          column of this grid — nesting it inside the conversation would put it
          in the middle track and it would take width from the log instead of
          from the module.

          A CITE IS A CONTROL HERE TOO, and it goes through `jumpTo` — the same
          path the mention deep link uses, given the same three arguments
          (channel, message, thread root). The panel is a SIBLING of `ChatPane`
          and cannot reach into its log, its thread state or its focus loop;
          `jumpTo` is the door that already exists for exactly that, and reusing
          it means a cited reply opens its thread by the code that was written
          and tested to open one. */}
      {showAside && (
        <SahayakAside
          channelName={selected.type === 'dm' ? (selected.name || 'this direct message') : selected.name}
          isDm={selected.type === 'dm'}
          sahayak={sahayak}
          since={selected.my_last_read || null}
          onClose={() => setAsideOpen(false)}
          onCite={c => jumpTo(selected.id, c.message_id, c.parent_message_id)}
        />
      )}

      {/* Mounted whether or not it is open — it returns null when closed, which
          keeps the query and the results the reader already has. Unmounting it
          would throw both away every time they clicked a result and came back,
          and re-running the search is a round trip for something the component
          was already holding.

          BOTH PANELS ARE ABSOLUTELY POSITIONED AGAINST THE GRID, and that is a
          dependency this file cannot satisfy on its own. `.sv__srch` and
          `.sv__mnp` are `inset: 0 0 0 264px` and need a positioned ancestor;
          `.sv` carried `position: relative` for exactly that and `.m2` is a bare
          grid in `messaging.css`. The `264px` was the old rail and `.m2--rail`
          is 296px, so the offset is stale by 32px as well. Both are stylesheet
          facts, reported rather than patched from here with an inline style that
          would put a layout constant in two files. */}
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
