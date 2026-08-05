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
import LockedComposer from './LockedComposer';
import { SvIcons } from './icons';
import {
  isContinuation, optimisticMessage, parseReactions, toggleReactionLocal,
} from './messageUtils';

/**
 * A shared empty array for the `members` default, for the reason `MessageLog`
 * gives for its own: a fresh `[]` in the parameter list is a new identity on
 * every render where the prop is omitted, which would re-run the `names` memo
 * below every time and defeat the point of memoising it.
 */
const EMPTY = [];

/**
 * There is no `onReplied` and there deliberately is not one.
 *
 * It was declared here and called on every send and every delete, and NOTHING
 * passed it — `ChannelsTab` renders this panel as the grid's third column and
 * has never had the prop in its list. An optional call to a handler nobody
 * supplies is not a hook for a future caller, it is a claim that this panel
 * keeps the log's "N replies" in step, made by a file that cannot: the messages
 * live in `ChatPane`'s hook, and `ChatPane` is this panel's SIBLING.
 *
 * What actually keeps that count honest is `useChannelMessages`'s own poll,
 * which re-reads `thread_count` and `last_reply_at` off `list_messages` a few
 * seconds later. The one path that beats the poll is a reply sent from the
 * CHANNEL composer, because that one goes through the hook (`send(content,
 * parentId)` bumps the parent's `thread_count` itself) — this one posts
 * directly and cannot reach that state. Closing the gap would mean handing a
 * mutator for the log's messages across two components that do not otherwise
 * know about each other, which is more surface than a few seconds of a count
 * being one behind.
 */
export default function ThreadPanel({
  channelId, root, me, meId, meName, onClose, closing = false, onAnimationEnd,
  canPost = true, lockReason = 'viewer',
  /**
   * The channel's members — the same list `ChatPane` already holds, lifted
   * through `ChannelsTab` rather than fetched a second time here. It is the
   * mention vocabulary for the replies below AND for the composer at the foot
   * of this panel, and until it arrived neither had one.
   */
  members = EMPTY,
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

  /**
   * The mention vocabulary for the rows in this panel — everyone in the channel,
   * then everyone who has spoken in the thread.
   *
   * The member half is the half that was missing, and it is the same defect
   * `MessageLog` documents at length: a name the parser has never heard of falls
   * through to the bare `[\w.-]+` arm, so `@Aanya Mehta` renders as a bolded
   * `@Aanya` followed by loose text — while the server, which resolved the same
   * string against `COALESCE(full_name, name, email)`, has already put a mention
   * in Aanya's feed. A reply is an ordinary row in `samvada_messages`, so it had
   * every one of those failures and none of the fix.
   *
   * Senders stay in the union rather than being replaced by it: somebody who has
   * left the channel is off the member list and still owns what they wrote, and
   * `members` is empty until `list_members` lands and stays empty if it failed.
   */
  const names = useMemo(
    () => [...new Set([
      ...members.map(m => m?.full_name),
      rootMsg?.sender_name,
      ...replies.map(r => r.sender_name),
    ].filter(Boolean))],
    [members, rootMsg, replies]
  );

  /**
   * The comment this replaced called the post-response append "optimistic". It
   * was not: nothing went on screen until the round trip finished. `Composer`
   * now empties the box in the same frame the key is pressed, so without a real
   * placeholder a slow reply would leave the panel showing nothing at all —
   * which is precisely the state `MOTION-SPEC.md` §7.1 forbids.
   *
   * `get_thread` DOES join `sender_name`/`sender_avatar`, so the quiet reload is
   * authoritative and replaces the placeholder with the server's row.
   */
  const send = async (content) => {
    const optimistic = optimisticMessage(content, { meId, me });
    setReplies(prev => [...prev, optimistic]);
    const drop = () => setReplies(prev => prev.filter(x => x.id !== optimistic.id));
    try {
      const r = await api.post(`/v1/messaging/channels/${channelId}/messages`, {
        content,
        parent_message_id: root.id,
      });
      if (r?.data?.id) {
        setReplies(prev => {
          const without = prev.filter(x => x.id !== optimistic.id);
          return without.some(x => String(x.id) === String(r.data.id)) ? without : [...without, {
            ...r.data,
            sender_name: me?.full_name || me?.name || undefined,
            sender_avatar: me?.avatar_url || undefined,
          }];
        });
      } else {
        drop();
      }
      await load({ quiet: true });
    } catch (e) {
      drop();
      pushToast({ type: 'error', title: e.response?.data?.detail || 'Failed to send reply' });
      throw e;
    }
  };

  /**
   * A reply is an ordinary row in `samvada_messages`, so `PATCH` and `DELETE`
   * on `/v1/messaging/messages/:id` apply to it exactly as they do in the log.
   * The panel simply never passed the handlers, so `Message` rendered no More
   * menu and a reply — once sent — could not be corrected or withdrawn. A typo
   * in a thread was permanent while the same typo in the channel was not.
   *
   * `get_thread` returns `m.*`, so `is_edited` comes back and the `(edited)`
   * marker is correct here without any further change.
   */
  const editReply = async (msg, content) => {
    try {
      const r = await api.patch(`/v1/messaging/messages/${msg.id}`, { content });
      const next = {
        content: r.data?.content ?? content,
        is_edited: true,
        updated_at: r.data?.updated_at,
      };
      const hit = m => (String(m.id) === String(msg.id) ? { ...m, ...next } : m);
      setReplies(prev => prev.map(hit));
      setRootMsg(prev => hit(prev));
      return r.data;
    } catch (e) {
      pushToast({ type: 'error', title: e.response?.data?.detail || 'Failed to save the edit' });
      throw e;
    }
  };

  const deleteReply = async (msg) => {
    try {
      await api.delete(`/v1/messaging/messages/${msg.id}`);
      // `get_thread` filters `is_deleted = FALSE`, so the row is gone from the
      // server's answer already; dropping it locally keeps the count honest
      // rather than leaving a tombstone the next load would not reproduce.
      setReplies(prev => prev.filter(m => String(m.id) !== String(msg.id)));
    } catch (e) {
      pushToast({ type: 'error', title: e.response?.data?.detail || 'Failed to delete the message' });
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
        <Message
          msg={rootMsg}
          // The log is still mounted three columns to the left and still holds
          // this exact message, so without this the root is on screen twice as
          // `id="m-<rootId>"` twice. `ChatPane`'s jump does
          // `getElementById('m-' + focusMessageId)`, which does not fail on a
          // duplicate id — it silently returns whichever came first in document
          // order and scrolls that one. `Message` grew this prop for this call
          // site; defaulting it to `true` was right for the log and wrong here.
          anchored={false}
          meId={meId}
          meName={meName}
          names={names}
          onReact={canPost ? react : undefined}
          onEdit={canPost ? editReply : undefined}
          onDelete={canPost ? deleteReply : undefined}
        />
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
            /* The last reply of its run — the one that keeps the bubble's tail
               and its timestamp. `isContinuation` asked forwards instead of
               backwards, which is the same rule from the other side and is why
               this panel needs no grouping logic of its own. There is no date
               separator and no unread rule in a thread, so unlike `MessageLog`
               nothing else can cut a run here and the expression is the bare
               question. The last reply in the list always ends its run. */
            runEnd={!isContinuation(replies[i + 1], m)}
            meId={meId}
            meName={meName}
            names={names}
            onReact={canPost ? react : undefined}
            onEdit={canPost ? editReply : undefined}
            onDelete={canPost ? deleteReply : undefined}
          />
        ))}
      </div>

      {canPost ? (
        <Composer
          formatting
          onSend={send}
          label="Reply in thread"
          placeholder="Reply…"
          /* The `@` list, which this composer has never had. With no `members`
             `MentionInput.people` is empty, so `candidates` is empty and `open`
             is false for every keystroke ever typed here — while the server went
             on resolving mentions out of the reply's TEXT, because
             `fan_out_mentions` reads `content` and does not care that the row has
             a parent. A thread mention therefore worked, and had to be typed
             blind and spelled to the character to do so. */
          members={members}
          /* NO `@here` AND NO `@channel` HERE, passed rather than defaulted.
             `MentionInput` already says "a thread reply passes
             allowBroadcast={false}" — until the line above, that sentence
             described a branch nothing could reach, and a value nobody writes
             down is not a decision anyone can find or argue with.

             The reason is the audience. A thread is read by the few people who
             opened it; a broadcast fired from inside one pages the whole channel
             from a panel most of them never see, and the inbox row it produces
             names the channel, not the thread. Somebody who genuinely means to
             page the room has the room's own composer one click to the left.

             It HIDES the token, it does not disable it. `_resolve` is given the
             content and the channel and is told nothing about a parent, so a
             `@channel` typed into a reply by hand resolves exactly as it would
             in the channel — under the same admin-or-small-channel rule and no
             other. Making the thread a genuine exception would mean a rule in
             `services/samvaad_mentions.py`, and a rule the composer cannot show
             you is one you discover by being ignored. So the composer declines
             to suggest it and the token keeps one meaning everywhere. */
          allowBroadcast={false}
        />
      ) : (
        <LockedComposer reason={lockReason} />
      )}
    </aside>
  );
}
