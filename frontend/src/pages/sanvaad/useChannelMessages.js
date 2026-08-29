/**
 * useChannelMessages.js — load, poll, send, react.
 *
 * `06-sanvaad-varta.md` §2b asks for Supabase Realtime on `messages`, with
 * cursor polling as the short-term fallback. Realtime is **not** wired here.
 *
 * One of the three reasons previously given in this comment was WRONG and is
 * corrected: `migrations/058_sanvaad_messaging.sql:83` ends with
 * `ALTER PUBLICATION supabase_realtime ADD TABLE staging.samvada_messages`, so
 * the table IS published. The two that survive are the decisive ones:
 *
 *   · The browser client holds the anon key (`lib/supabase.js`). RLS is never
 *     enabled on any `staging.*` table — `migrations/007` turns it on for
 *     `public.*` only — so `postgres_changes` has no policy to authorise the
 *     subscription against, and the API reaches these rows through a service
 *     pool with an explicit org gate instead. Publishing a table whose rows the
 *     anon role cannot be scoped to would be a cross-tenant leak, not a feature.
 *   · A `postgres_changes` payload is the raw row. It has no `sender_name`,
 *     no `sender_avatar`, no `thread_count` and no `reactions` — all four are
 *     joins and sub-selects in `list_messages` (`routers/messaging.py:295-299`)
 *     — so every event would need a follow-up fetch anyway.
 *
 * So polling stays, with the three things `06` actually objects to fixed:
 * `loading` is never touched after the first load, the page is **merged** rather
 * than assigned, and the timer backs off while the tab is hidden — see the
 * cadence block below, which replaced the single 5000ms interval this comment
 * was originally written against. `?after=` is not available — `list_messages`
 * takes `before` only — so the poll re-reads the newest page and merges it;
 * that is one page, not a growing history.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../lib/api';
import {
  dropSettled, mergeById, optimisticMessage, parseReactions, toggleReactionLocal,
} from './messageUtils';

/* ── Poll cadence ──────────────────────────────────────────────────────────
 *
 * One interval used to serve every state: 5000ms, skipped while the tab was
 * hidden. That is two wrongs at once — too slow to read as a conversation when
 * somebody is actually in it, and, because the timer kept firing on a hidden
 * tab only to be discarded, a wake-up every five seconds for the life of the
 * page in a tab nobody has looked at since lunch.
 *
 * Four regimes now, and the reason each exists:
 *
 *   ACTIVE  3000  the reader is looking at this channel and the window has
 *                 focus. This is the number that decides whether the product
 *                 feels like a chat. It is not lower because there is no
 *                 websocket to fall back to (see below) and 20 reads/min/user
 *                 is already the ceiling of what this pool should carry.
 *   BLUR    8000  the tab is visible but the window is behind something else —
 *                 a second monitor, a PDF on top. Messages still need to be
 *                 there when the eye comes back; they do not need to be there
 *                 within three seconds.
 *   HIDDEN 30000  another tab is in front. The log is kept warm so returning is
 *                 instant, at 2 requests/min instead of 20.
 *   PARKED    off  the tab has been hidden for five minutes. At that point
 *                 nobody is coming back soon enough for a warm log to matter,
 *                 and `visibilitychange` gives us an immediate load the moment
 *                 they do. A browser with forty background tabs is the single
 *                 biggest source of pointless load this API sees.
 *
 * THIS IS A POLL AND IT STAYS A POLL. Supabase's pooler runs in transaction
 * mode on :6543, where `LISTEN/NOTIFY` does not work, and the service runs
 * several gunicorn workers, so an in-process broadcast would reach one worker's
 * clients only. The two reasons Realtime is not used are in the header above.
 */
const ACTIVE_MS = 3000;
const BLUR_MS = 8000;
const HIDDEN_MS = 30000;
const HIDDEN_PARK_MS = 5 * 60 * 1000;

/**
 * `visibilitychange` and `focus` both fire when a tab is brought forward, and
 * on some platforms so does a click into the page. Without a floor, coming back
 * to a tab costs three identical reads in the same frame.
 */
const WAKE_FLOOR_MS = 1500;

/**
 * `POST /channels/:id/read` is a WRITE and it counts against the 120/min budget
 * (`server.py:238`), so it cannot be fired on every wake. Once every 30s is
 * enough for the thing it now does — clearing this channel's unread mentions
 * server-side — while costing at most 2 of the 120.
 */
const READ_MARK_MS = 30000;

/** `list_messages` caps at `Query(50, le=100)`; a short page means no more. */
const PAGE = 50;

/** A message id, whether the caller handed over the id or the whole row. See
 *  the note on `pin` below for why this exists rather than a stricter contract. */
const pinId = (x) => (x && typeof x === 'object' ? x.id : x);

export function useChannelMessages(channelId, meId, me = null) {
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  // Pinned messages and the channel's member list. Both belong here rather than
  // in `ChatPane` because both are per-channel state that the pin/unpin path
  // has to keep in step with `messages`, and splitting them across two owners is
  // how a pinned row ends up in one list and not the other.
  const [pins, setPins] = useState([]);
  const [members, setMembers] = useState([]);
  // Scrollback. `list_messages` has always accepted `?before=<message_id>` and
  // no client had ever sent it, so only the newest 50 messages in a channel
  // were reachable — everything older was on the server and unreadable through
  // the UI. `more` starts true and is cleared by the first short page.
  const [more, setMore] = useState(true);
  const [older, setOlder] = useState(false);
  const first = useRef(true);

  /**
   * A mirror of `messages` for the callbacks that need to read the CURRENT row
   * before they change it — `pin` needs the old `pinned_at` to roll back to.
   * Reading it out of a `setMessages` updater instead would be a side effect
   * inside an updater, which React is explicitly allowed to run twice.
   */
  const msgsRef = useRef([]);
  useEffect(() => { msgsRef.current = messages; }, [messages]);

  /**
   * The server returns newest-first (`ORDER BY created_at DESC LIMIT 50`), so
   * the client reverses. `06` §4 asks the API to return oldest-first instead;
   * that is a backend change and is noted rather than made.
   *
   * ── `include_reply_counts=1`, on BOTH list calls ─────────────────────────
   *
   * IT DOES NOT GATE THE COUNTS, despite the name. `thread_count` and
   * `last_reply_at` are on every row of every call with no parameter at all and
   * always have been — `Message.jsx` reads both and decides whether the thread
   * disclosure renders from the first. What the flag actually adds is one key:
   * `thread_faces`, up to three distinct repliers with `user_id`, `full_name`
   * and `avatar`, which is the stack `.m2th__faces` draws beside the count.
   * Without it the array is `undefined` and `Message` renders the summary line
   * with no faces; the guard there is on the array rather than on the flag, so
   * this is the only edit that turns the stack on.
   *
   * It is passed on BOTH arms because a message reached by scrollback has a
   * thread as often as one on the first page, and a face stack that appears on
   * the newest fifty rows and vanishes above them reads as a rendering fault.
   */
  const fetchPage = useCallback(async () => {
    const r = await api.get(`/v1/messaging/channels/${channelId}/messages`, {
      params: { include_reply_counts: 1 },
    });
    return (Array.isArray(r.data) ? r.data : []).slice().reverse();
  }, [channelId]);

  /**
   * The pinned set. Its own read rather than a filter over `messages`, because
   * a pin can be older than the fifty rows currently held — the whole point of
   * pinning something is that it stays reachable after it has scrolled away.
   *
   * A failure keeps the last good list. An empty pinned bar is a claim ("nobody
   * pinned anything here"), and a request that did not answer cannot make it.
   */
  const reloadPins = useCallback(async () => {
    if (!channelId) return;
    try {
      const r = await api.get(`/v1/messaging/channels/${channelId}/pins`);
      setPins(Array.isArray(r.data) ? r.data : []);
    } catch { /* keep what we had; see above */ }
  }, [channelId]);

  /**
   * The channel's members, which is the mention vocabulary. `MessageLog` used
   * to derive names from whoever had already spoken, so a colleague who had
   * never posted in the channel could not be `@`-mentioned and, worse, an
   * existing `@Name` in a body rendered as plain text until they did.
   *
   * `list_members` returns `cm.*` joined to `users`, so each row carries
   * `user_id`, `role`, `muted`, `full_name`, `email` and `avatar_url` — the
   * shape `MentionInput` and the channel-admin check both read directly.
   *
   * NOTE for a public channel: only people who have actually joined have a
   * `samvada_channel_members` row, so this is the joined set, not everyone who
   * can read the channel. The server's resolver unions in org members for a
   * public channel when it fans out mentions, so typing a name that is not in
   * this list still notifies — the autocomplete just will not suggest it.
   */
  const reloadMembers = useCallback(async () => {
    if (!channelId) return;
    try {
      const r = await api.get(`/v1/messaging/channels/${channelId}/members`);
      setMembers(Array.isArray(r.data) ? r.data : []);
    } catch { /* an empty popup is better than a wrong one; keep the last good */ }
  }, [channelId]);

  useEffect(() => {
    let dead = false;
    first.current = true;
    setLoading(true);
    setError(null);
    setMessages([]);
    setMore(true);
    setPins([]);
    setMembers([]);

    let timer = null;
    let inflight = false;
    let hiddenSince = document.hidden ? Date.now() : null;
    let lastLoadAt = 0;
    let lastReadPost = 0;

    const load = async () => {
      try {
        const page = await fetchPage();
        if (dead) return;
        // Merge, never assign — an optimistic send that landed between the
        // request and the response must survive. `dropSettled` first, so a
        // placeholder whose real row is in this page is retired rather than
        // rendered beside its own echo; `markFresh` is what gives the rows that
        // genuinely just arrived their entrance animation, and it is deliberately
        // NOT passed on the first load or on `loadOlder`.
        setMessages(prev => mergeById(dropSettled(prev, page), page, {
          markFresh: !first.current,
        }));
        if (first.current && page.length < PAGE) setMore(false);
        setError(null);
      } catch (e) {
        if (!dead && first.current) setError(e);
      } finally {
        lastLoadAt = Date.now();
        if (!dead && first.current) { first.current = false; setLoading(false); }
      }
    };

    /**
     * `document.hasFocus()` rather than a `focused` flag seeded from a guess:
     * a component that mounts into a background window has to start at the slow
     * cadence, and a boolean initialised to `true` would spend the first
     * interval polling as though somebody were watching. Guarded because jsdom
     * and older embedded webviews do not all implement it.
     */
    const isFocused = () =>
      (typeof document.hasFocus === 'function' ? document.hasFocus() !== false : true);

    const delayMs = () => {
      if (document.hidden) return HIDDEN_MS;
      return isFocused() ? ACTIVE_MS : BLUR_MS;
    };

    const parked = () =>
      document.hidden && hiddenSince != null && Date.now() - hiddenSince > HIDDEN_PARK_MS;

    const schedule = () => {
      clearTimeout(timer);
      // Parked: no timer at all, not a slow one. `wake` below is what starts it
      // again, and it does so with an immediate load rather than an interval.
      if (dead || parked()) return;
      timer = setTimeout(tick, delayMs());
    };

    const tick = async () => {
      if (dead) return;
      // A slow network must not stack requests: six in flight answer at once
      // and the last to land wins, which is how a log briefly loses the message
      // that arrived while the earlier request was still open.
      if (!inflight) {
        inflight = true;
        try { await load(); } finally { inflight = false; }
      }
      schedule();
    };

    /**
     * DEVIATION, stated rather than hidden: the read marker also fires when the
     * reader comes back to the tab, not only on channel open.
     *
     * `POST /channels/:id/read` now also clears this channel's unread mention
     * rows server-side, which is what stops the `@` badge in the rail. Posting
     * it only on mount would mean sitting in a channel, watching a mention
     * arrive, reading it — and keeping the badge until you navigated away and
     * came back. Throttled to READ_MARK_MS because it is a write.
     */
    const markRead = () => {
      const now = Date.now();
      if (now - lastReadPost < READ_MARK_MS) return;
      lastReadPost = now;
      api.post(`/v1/messaging/channels/${channelId}/read`).catch(() => {});
    };

    const wake = () => {
      if (dead) return;
      if (document.hidden) {
        if (hiddenSince == null) hiddenSince = Date.now();
        schedule();
        return;
      }
      hiddenSince = null;
      if (!inflight && Date.now() - lastLoadAt >= WAKE_FLOOR_MS) tick();
      else schedule();
      markRead();
    };

    load();
    markRead();
    reloadPins();
    reloadMembers();
    schedule();

    document.addEventListener('visibilitychange', wake);
    window.addEventListener('focus', wake);
    // Losing focus only changes the CADENCE, so it reschedules rather than
    // waking: firing a read here would double every alt-tab.
    window.addEventListener('blur', schedule);

    return () => {
      dead = true;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', wake);
      window.removeEventListener('focus', wake);
      window.removeEventListener('blur', schedule);
    };
  }, [channelId, fetchPage, reloadPins, reloadMembers]);

  /** Replace one message in place — used by the reaction path. */
  const patch = useCallback((id, fields) => {
    setMessages(prev => prev.map(m => (String(m.id) === String(id) ? { ...m, ...fields } : m)));
  }, []);

  /**
   * `MOTION-SPEC.md` §7.1 — the row goes up FIRST, at `opacity: .6`, and only
   * goes solid when the server acknowledges it. Awaiting the POST before
   * rendering anything is the "lie about state" the rule names: on a slow
   * network the text left the composer and appeared nowhere.
   *
   * A failed send removes the placeholder and rethrows, so `ChatPane` still
   * raises the server's own reason and `Composer` puts the draft back in the box
   * rather than losing what somebody just typed.
   */
  const send = useCallback(async (content, parentId) => {
    // A reply belongs to the thread panel, not the log, so it gets no
    // placeholder here — `ThreadPanel` renders its own.
    const optimistic = parentId ? null : optimisticMessage(content, { meId, me });
    if (optimistic) setMessages(prev => mergeById(prev, [optimistic]));

    let r;
    try {
      r = await api.post(`/v1/messaging/channels/${channelId}/messages`, {
        content,
        parent_message_id: parentId || null,
      });
    } catch (e) {
      if (optimistic) setMessages(prev => prev.filter(m => m.id !== optimistic.id));
      throw e;
    }

    // Its parent's `thread_count` has just gone up and the poll is up to five
    // seconds away.
    if (parentId) {
      setMessages(prev => prev.map(m => (
        String(m.id) === String(parentId)
          ? { ...m, thread_count: (Number(m.thread_count) || 0) + 1 }
          : m
      )));
    } else {
      // `send_message` ends `RETURNING *` on `samvada_messages` — no
      // `sender_name`, no `sender_avatar`, because both are joins onto
      // `staging.users` that only `list_messages` performs. Merging the response
      // raw therefore rendered YOUR OWN message as "Unknown" behind a "?"
      // avatar for up to five seconds, on every send. We know who we are;
      // stamping the two fields costs nothing and the poll overwrites them with
      // the server's values on the next tick.
      const mine = me
        ? { sender_name: me.full_name || me.name || undefined, sender_avatar: me.avatar_url || undefined }
        : {};
      // The placeholder is dropped in the same update the real row lands in, so
      // the two never coexist for a frame. No `__fresh`: the placeholder has
      // already occupied that space and the reader's own message must not
      // animate in twice.
      setMessages(prev => mergeById(
        prev.filter(m => m.id !== optimistic.id),
        [{ ...r.data, ...mine }],
      ));
    }
    return r.data;
  }, [channelId, me, meId]);

  /**
   * Scrollback. `?before=` is a MESSAGE ID, not a timestamp — `list_messages`
   * resolves it with a sub-select on `created_at` — so the cursor is the oldest
   * row currently held, which is `messages[0]` because the page is reversed on
   * arrival.
   *
   * The poll only ever re-reads the NEWEST page and merges, so an older page
   * pulled in here is never discarded by the next tick; `mergeById` keeps both.
   */
  const loadOlder = useCallback(async () => {
    const oldest = messages[0];
    if (!oldest || older || !more) return;
    setOlder(true);
    try {
      const r = await api.get(`/v1/messaging/channels/${channelId}/messages`, {
        params: { before: oldest.id, limit: PAGE, include_reply_counts: 1 },
      });
      const page = (Array.isArray(r.data) ? r.data : []).slice().reverse();
      if (page.length < PAGE) setMore(false);
      if (page.length) setMessages(prev => mergeById(page, prev));
    } catch {
      // A failed page is not a failed channel: the log the reader already has
      // stays on screen and the control stays available to try again.
    } finally {
      setOlder(false);
    }
  }, [channelId, messages, older, more]);

  /**
   * `PATCH /v1/messaging/messages/:id` and `DELETE /v1/messaging/messages/:id` have
   * existed since migration 058 and NO client had ever called either one, so
   * `is_edited` and `is_deleted` were columns the UI could render but never
   * produce. `MESSAGING-ATTENDANCE-SPEC.md:24` requires both.
   *
   * The server owns authorship ("Can only edit your own messages", 403) and the
   * menu that reaches these is already gated on `sender_id === meId`; the check
   * exists in both places on purpose, because the client-side one is a
   * courtesy and the server-side one is the rule.
   */
  const edit = useCallback(async (msg, content) => {
    const r = await api.patch(`/v1/messaging/messages/${msg.id}`, { content });
    // `edit_message` returns the bare row — no `sender_name`, no `reactions`,
    // no `thread_count`, because those are joins only `list_messages` performs.
    // Merging it raw would blank all three until the next poll, so only the
    // three fields the edit actually changed are taken.
    patch(msg.id, {
      content: r.data?.content ?? content,
      is_edited: true,
      updated_at: r.data?.updated_at,
    });
    return r.data;
  }, [patch]);

  const remove = useCallback(async (msg) => {
    await api.delete(`/v1/messaging/messages/${msg.id}`);
    // `list_messages` filters `is_deleted = FALSE`, so the next poll drops the
    // row entirely. Until then the tombstone is what the deleter sees, which is
    // the acknowledgement that the delete landed.
    patch(msg.id, { is_deleted: true });
  }, [patch]);

  /**
   * `06` §7: "One emoji reaction costs a full history refetch. react() ends with
   * loadMessages(). Update the single message from the mutation response."
   *
   * The endpoints return `{ok: true}` rather than the message, so the single
   * message is updated from the *request* instead — optimistically, and rolled
   * back if the call fails. Which of the two endpoints to call is now knowable,
   * because `groupReactions` keeps `user_ids`.
   */
  const react = useCallback(async (msg, emoji) => {
    const before = msg.reactions;
    const mine = parseReactions(before)
      .some(r => r.emoji === emoji && String(r.user_id) === String(meId));
    patch(msg.id, { reactions: toggleReactionLocal(before, emoji, meId) });
    try {
      if (mine) {
        await api.delete(`/v1/messaging/messages/${msg.id}/reactions/${encodeURIComponent(emoji)}`);
      } else {
        // `emoji` is a query parameter server-side. `06` §4 wants it moved into
        // the body; that is a backend change and is noted rather than made.
        await api.post(`/v1/messaging/messages/${msg.id}/reactions?emoji=${encodeURIComponent(emoji)}`);
      }
    } catch {
      patch(msg.id, { reactions: before });
    }
  }, [meId, patch]);

  /* ── Pins ───────────────────────────────────────────────────────────────
   *
   * Optimistic on `pinned_at` with a rollback, using the same surgical `patch`
   * the reaction path uses — for the same reason. The pin chip appearing three
   * seconds after the click reads as the click having missed.
   *
   * BOTH RETHROW. `POST .../pin` answers 400 when the channel already holds
   * fifty pins, and `DELETE .../pin` answers 403 when somebody else did the
   * pinning; both sentences are more use to the reader than a silent no-op, and
   * `ChatPane` is the layer that turns them into a toast.
   *
   * BOTH TAKE AN ID OR A MESSAGE. `Message`'s four existing action props are all
   * `(msg) => …` and these two are documented as `(msgId) => …`, so the call
   * site is one `.id` away from passing an object into a template string and
   * requesting `/messages/[object Object]/pin`. That is a 404 with no clue in
   * it, at the far end of a boundary between two people's files. `pinId` costs
   * one expression and removes the whole class. It is module-scope so the two
   * callbacks below need not carry it as a dependency.
   */
  const pin = useCallback(async (arg) => {
    const msgId = pinId(arg);
    const cur = msgsRef.current.find(m => String(m.id) === String(msgId));
    // Idempotent server-side (`WHERE ... AND pinned_at IS NULL`), so a
    // double-tap must not steal attribution — and it must not roll the first
    // pin back either, which is why an already-pinned row leaves early.
    if (cur?.pinned_at) return null;
    const before = {
      pinned_at: cur?.pinned_at ?? null,
      pinned_by: cur?.pinned_by ?? null,
      pinned_by_name: cur?.pinned_by_name ?? null,
    };
    patch(msgId, { pinned_at: new Date().toISOString(), pinned_by: meId });
    try {
      const r = await api.post(`/v1/messaging/messages/${msgId}/pin`);
      // The server's own `pinned_at` wins: the optimistic one came off this
      // machine's clock and the pinned bar sorts on this field.
      patch(msgId, { pinned_at: r.data?.pinned_at || before.pinned_at || new Date().toISOString() });
      reloadPins();
      return r.data;
    } catch (e) {
      patch(msgId, before);
      throw e;
    }
  }, [meId, patch, reloadPins]);

  const unpin = useCallback(async (arg) => {
    const msgId = pinId(arg);
    const cur = msgsRef.current.find(m => String(m.id) === String(msgId));
    const before = {
      pinned_at: cur?.pinned_at ?? null,
      pinned_by: cur?.pinned_by ?? null,
      pinned_by_name: cur?.pinned_by_name ?? null,
    };
    patch(msgId, { pinned_at: null, pinned_by: null, pinned_by_name: null });
    // The bar empties in the same frame as the row un-highlights; the two are
    // one action and must not land a poll apart.
    setPins(prev => prev.filter(p => String(p.id) !== String(msgId)));
    try {
      const r = await api.delete(`/v1/messaging/messages/${msgId}/pin`);
      reloadPins();
      return r.data;
    } catch (e) {
      patch(msgId, before);
      reloadPins();
      throw e;
    }
  }, [patch, reloadPins]);

  return {
    messages, loading, error, send, react, patch, edit, remove, loadOlder, more, older,
    // Added, never renamed. `ChatPane` is the only caller and it destructures
    // by name, so every existing key still means exactly what it meant.
    pin, unpin, pins, reloadPins, members,
    /**
     * ⚠ EXPOSED BECAUSE ADDING A MEMBER DID NOT REFRESH ANYTHING IN THE PANE.
     *
     * `reloadMembers` was called in exactly one place — the mount effect keyed
     * on `channelId` — so `members` was fixed for the life of the open
     * conversation. `ChannelDetails` signals a change with
     * `onChanged(null, { members: true })`, and `ChannelsTab.channelChanged`
     * answers it with `loadChannels()`, which reloads the RAIL and never this.
     *
     * Three things went stale together and the third is the one that bites:
     * the header's member count, the face stack, and — because
     * `MentionInput.people` IS this array — THE @MENTION VOCABULARY. So a
     * person added to a private channel could not be mentioned in it until the
     * channel was navigated away from and re-opened, which is precisely the
     * thing somebody adds a colleague in order to do. Measured 2026-08-29 by
     * Suite 13.05: four members added through the sheet, and `@Ana` opened no
     * picker for fifteen seconds afterwards.
     */
    reloadMembers,
  };
}

export default useChannelMessages;
