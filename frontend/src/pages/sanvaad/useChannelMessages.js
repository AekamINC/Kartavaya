/**
 * useChannelMessages.js — load, poll, send, react.
 *
 * `06-sanvaad-varta.md` §2b asks for Supabase Realtime on `messages`, with
 * cursor polling as the short-term fallback. Realtime is **not** wired here, and
 * the reason is not effort:
 *
 *   · The messages live in `staging.samvada_messages`, which is not in the
 *     `supabase_realtime` publication. Adding it is a migration, and migrations
 *     are out of scope for this change — staging and production share one
 *     database.
 *   · The browser client holds the anon key. Reading those rows through it needs
 *     RLS policies that do not exist; the API reaches them through a service
 *     pool with an explicit org gate.
 *   · A `postgres_changes` payload is the raw row. It has no `sender_name`,
 *     no `sender_avatar`, no `thread_count` and no `reactions` — all four are
 *     joins and sub-selects in `list_messages` — so every event would need a
 *     follow-up fetch anyway.
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

export function useChannelMessages(channelId, meId) {
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const first = useRef(true);

  // The server returns newest-first (`ORDER BY created_at DESC LIMIT 50`), so
  // the client reverses. `06` §4 asks the API to return oldest-first instead;
  // that is a backend change and is noted rather than made.
  const fetchPage = useCallback(async () => {
    const r = await api.get(`/messaging/channels/${channelId}/messages`);
    return (Array.isArray(r.data) ? r.data : []).slice().reverse();
  }, [channelId]);

  useEffect(() => {
    let dead = false;
    first.current = true;
    setLoading(true);
    setError(null);
    setMessages([]);

    const load = async () => {
      try {
        const page = await fetchPage();
        if (dead) return;
        // Merge, never assign — an optimistic send that landed between the
        // request and the response must survive.
        setMessages(prev => mergeById(prev, page));
        setError(null);
      } catch (e) {
        if (!dead && first.current) setError(e);
      } finally {
        if (!dead && first.current) { first.current = false; setLoading(false); }
      }
    };

    load();
    api.post(`/messaging/channels/${channelId}/read`).catch(() => {});

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
    const r = await api.post(`/messaging/channels/${channelId}/messages`, {
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
      setMessages(prev => mergeById(prev, [r.data]));
    }
    return r.data;
  }, [channelId]);

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
        await api.delete(`/messaging/messages/${msg.id}/reactions/${encodeURIComponent(emoji)}`);
      } else {
        // `emoji` is a query parameter server-side. `06` §4 wants it moved into
        // the body; that is a backend change and is noted rather than made.
        await api.post(`/messaging/messages/${msg.id}/reactions?emoji=${encodeURIComponent(emoji)}`);
      }
    } catch {
      patch(msg.id, { reactions: before });
    }
  }, [meId, patch]);

  return { messages, loading, error, send, react, patch };
}

export default useChannelMessages;
