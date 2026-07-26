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
 * `GET /messaging/messages/:id/thread` returns the replies oldest-first.
 * `06` §4 lists it as new; it is not.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { ErrorState, errorKind, SkeletonChat, useToast } from '../../components/ui';
import Message from './Message';
import Composer from './Composer';
import { SvIcons } from './icons';
import { isContinuation, parseReactions, toggleReactionLocal } from './messageUtils';

export default function ThreadPanel({ channelId, root, meId, onClose, onReplied }) {
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
      const r = await api.get(`/messaging/messages/${root.id}/thread`);
      setReplies(Array.isArray(r.data) ? r.data : []);
      setError(null);
    } catch (e) {
      setError(e);
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [root.id]);

  useEffect(() => { load(); }, [load]);

  const send = async (content) => {
    try {
      await api.post(`/messaging/channels/${channelId}/messages`, {
        content,
        parent_message_id: root.id,
      });
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
      if (mine) await api.delete(`/messaging/messages/${msg.id}/reactions/${encodeURIComponent(emoji)}`);
      else await api.post(`/messaging/messages/${msg.id}/reactions?emoji=${encodeURIComponent(emoji)}`);
    } catch {
      apply(before);
    }
  };

  return (
    <aside className="sv__thread" aria-label="Thread">
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
        <Message msg={rootMsg} meId={meId} onReact={react} />
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
            onReact={react}
          />
        ))}
      </div>

      <Composer
        onSend={send}
        label="Reply in thread"
        placeholder="Reply…  उत्तर दें"
      />
    </aside>
  );
}
