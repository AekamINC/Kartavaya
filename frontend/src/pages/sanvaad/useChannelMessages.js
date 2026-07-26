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
 * than assigned, and the timer stops while the tab is hidden. `?after=` is not
 * available — `list_messages` takes `before` only — so the poll re-reads the
 * newest page and merges it; that is one page, not a growing history.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../lib/api';
import { mergeById, parseReactions, toggleReactionLocal } from './messageUtils';

const POLL_MS = 5000;

/** `list_messages` caps at `Query(50, le=100)`; a short page means no more. */
const PAGE = 50;

export function useChannelMessages(channelId, meId, me = null) {
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  // Scrollback. `list_messages` has always accepted `?before=<message_id>` and
  // no client had ever sent it, so only the newest 50 messages in a channel
  // were reachable — everything older was on the server and unreadable through
  // the UI. `more` starts true and is cleared by the first short page.
  const [more, setMore] = useState(true);
  const [older, setOlder] = useState(false);
  const first = useRef(true);

  // The server returns newest-first (`ORDER BY created_at DESC LIMIT 50`), so
  // the client reverses. `06` §4 asks the API to return oldest-first instead;
  // that is a backend change and is noted rather than made.
  const fetchPage = useCallback(async () => {
    const r = await api.get(`/v1/messaging/channels/${channelId}/messages`);
    return (Array.isArray(r.data) ? r.data : []).slice().reverse();
  }, [channelId]);

  useEffect(() => {
    let dead = false;
    first.current = true;
    setLoading(true);
    setError(null);
    setMessages([]);
    setMore(true);

    const load = async () => {
      try {
        const page = await fetchPage();
        if (dead) return;
        // Merge, never assign — an optimistic send that landed between the
        // request and the response must survive.
        setMessages(prev => mergeById(prev, page));
        if (first.current && page.length < PAGE) setMore(false);
        setError(null);
      } catch (e) {
        if (!dead && first.current) setError(e);
      } finally {
        if (!dead && first.current) { first.current = false; setLoading(false); }
      }
    };

    load();
    api.post(`/v1/messaging/channels/${channelId}/read`).catch(() => {});

    const tick = () => { if (!document.hidden) load(); };
    const iv = setInterval(tick, POLL_MS);
    // A tab that comes back after ten minutes should not wait out the interval.
    document.addEventListener('visibilitychange', tick);
    return () => {
      dead = true;
      clearInterval(iv);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [channelId, fetchPage]);

  /** Replace one message in place — used by the reaction path. */
  const patch = useCallback((id, fields) => {
    setMessages(prev => prev.map(m => (String(m.id) === String(id) ? { ...m, ...fields } : m)));
  }, []);

  const send = useCallback(async (content, parentId) => {
    const r = await api.post(`/v1/messaging/channels/${channelId}/messages`, {
      content,
      parent_message_id: parentId || null,
    });
    // A reply belongs to the thread panel, not the log — but its parent's
    // `thread_count` has just gone up and the poll is up to five seconds away.
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
      setMessages(prev => mergeById(prev, [{ ...r.data, ...mine }]));
    }
    return r.data;
  }, [channelId, me]);

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
        params: { before: oldest.id, limit: PAGE },
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

  return { messages, loading, error, send, react, patch, edit, remove, loadOlder, more, older };
}

export default useChannelMessages;
