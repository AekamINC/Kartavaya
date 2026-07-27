/**
 * ThreadPanel.jsx — the panel that makes thread replies readable.
 *
 * `06-sanvaad-varta.md` §4: "setThreadMsg(m) sets a 'replying to' bar above the
 * composer and posts parent_message_id. There is no thread panel. So a reply is
 * sent into a thread, thread_count increments, and clicking '💬 3 replies' just
 * sets the reply target again — the replies are unreachable. Either build the
 * panel or drop parent_message_id and make everything flat. A thread you can
 * write to and not read is worse than no thread."
 *
 * This claim held on the branch. The panel is built rather than the feature
 * dropped, because the endpoint it needs already exists and is unused:
 * `GET /v1/messaging/messages/:id/thread` returns the replies oldest-first.
 * `06` §4 lists it as new; it is not.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../../lib/api';
import { ErrorState, errorKind, SkeletonChat, useToast } from '../../components/ui';
import Message from './Message';
import Composer from './Composer';
import { SvIcons } from './icons';
import { isContinuation, parseReactions, toggleReactionLocal } from './messageUtils';

export default function ThreadPanel({
  channelId, root, me, meId, meName, onClose, onReplied, closing = false, onAnimationEnd,
}) {
  const { pushToast } = useToast();
  const [replies, setReplies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  // The root is owned by the log's state, not this panel's, so reacting to it
  // here needs somewhere local to land or the chip would not move.
  const [rootMsg, setRootMsg] = useState(root);
  useEffect(() => { setRootMsg(root); }, [root]);

  const load = useCallback(async ({ quiet } = {}) => {
    if (!quiet) setLoading(true);
    try {
      const r = await api.get(`/v1/messaging/messages/${root.id}/thread`);
      setReplies(Array.isArray(r.data) ? r.data : []);
      setError(null);
    } catch (e) {
      setError(e);
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [root.id]);

  useEffect(() => { load(); }, [load]);

  const names = useMemo(
    () => [...new Set([rootMsg?.sender_name, ...replies.map(r => r.sender_name)].filter(Boolean))],
    [rootMsg, replies]
  );

  const send = async (content) => {
    try {
      const r = await api.post(`/v1/messaging/channels/${channelId}/messages`, {
        content,
        parent_message_id: root.id,
      });
      // `get_thread` DOES join `sender_name`/`sender_avatar`, so the reload is
      // authoritative. The optimistic row exists only so the reply appears in
      // the same frame the composer clears in; the reload replaces it by id.
      if (r?.data?.id) {
        setReplies(prev => (prev.some(x => String(x.id) === String(r.data.id)) ? prev : [...prev, {
          ...r.data,
          sender_name: me?.full_name || me?.name || undefined,
          sender_avatar: me?.avatar_url || undefined,
        }]));
      }
      await load({ quiet: true });
      onReplied?.(root.id);
    } catch (e) {
      pushToast({ type: 'error', title: e.response?.data?.detail || 'Failed to send reply' });
      throw e;
    }
  };

  /**
   * `get_thread` does not select reactions, so a reply's chips are whatever the
   * user has done in this session — the write still goes through, and the next
   * full load of the channel picks the rest up.
   */
  const react = async (msg, emoji) => {
    const before = msg.reactions;
    const mine = parseReactions(before)
      .some(r => r.emoji === emoji && String(r.user_id) === String(meId));
    const apply = reactions => {
      const hit = m => (String(m.id) === String(msg.id) ? { ...m, reactions } : m);
      setReplies(prev => prev.map(hit));
      setRootMsg(prev => hit(prev));
    };
    apply(toggleReactionLocal(before, emoji, meId));
    try {
      if (mine) await api.delete(`/v1/messaging/messages/${msg.id}/reactions/${encodeURIComponent(emoji)}`);
      else await api.post(`/v1/messaging/messages/${msg.id}/reactions?emoji=${encodeURIComponent(emoji)}`);
    } catch {
      apply(before);
    }
  };

  return (
    /* `svThreadIn` / `svThreadOut` live on this element; `ChannelsTab` owns the
       `closing` flag and unmounts on the exit's `animationend`. `aria-hidden`
       while closing so a screen reader is not still being offered a panel that
       is on its way out. */
    <aside
      className={`sv__thread${closing ? ' is-closing' : ''}`}
      aria-label="Thread"
      aria-hidden={closing || undefined}
      onAnimationEnd={onAnimationEnd}
    >
      <div className="sv__thread-hd">
        <span className="sv__thread-t">Thread</span>
        <span className="sv__thread-n">
          {replies.length} {replies.length === 1 ? 'reply' : 'replies'}
        </span>
        <button type="button" className="svbtn" onClick={onClose} aria-label="Close thread">
          {SvIcons.close}
        </button>
      </div>

      <div className="sv__thread-root">
        <Message msg={rootMsg} meId={meId} meName={meName} names={names} onReact={react} />
      </div>

      <div className="sv__log">
        {loading && <SkeletonChat rows={3} />}
        {!loading && error && (
          <ErrorState kind={errorKind(error)} onRetry={() => load()} />
        )}
        {!loading && !error && replies.length === 0 && (
          <p className="sv__none">No replies yet. Be the first.</p>
        )}
        {!loading && !error && replies.map((m, i) => (
          <Message
            key={m.id}
            msg={m}
            continuation={isContinuation(m, replies[i - 1])}
            meId={meId}
            meName={meName}
            names={names}
            onReact={react}
          />
        ))}
      </div>

      <Composer
        onSend={send}
        label="Reply in thread"
        placeholder="Reply…"
      />
    </aside>
  );
}
