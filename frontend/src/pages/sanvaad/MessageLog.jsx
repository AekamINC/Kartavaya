/**
 * MessageLog.jsx — date separators, the unread divider, consecutive grouping,
 * and the jump-to-latest pill.
 */
import React from 'react';
import { EmptyState, SkeletonChat } from '../../components/ui';
import Message from './Message';
import { ChatArt, SvIcons } from './icons';
import { dayKey, dayLabel, isContinuation } from './messageUtils';
import useStickyScroll from './useStickyScroll';

export default function MessageLog({
  messages, loading, meId, lastReadAt, onReact, onOpenThread, onReply, emptyTitle, emptyBody,
}) {
  // A cheap signature, so a re-render that changes nothing about the messages
  // does not re-run the scroll decision.
  const sig = `${messages.length}:${messages[messages.length - 1]?.id || ''}`;
  const { logRef, pinned, jump } = useStickyScroll(sig);

  const readMs = lastReadAt ? new Date(lastReadAt).getTime() : 0;
  let dividerShown = false;

  return (
    <div className="sv__logwrap">
      <div className="sv__log" ref={logRef}>
        {loading && <SkeletonChat rows={5} />}

        {!loading && messages.length === 0 && (
          <EmptyState
            icon={ChatArt}
            title={{ en: emptyTitle || 'No messages yet', hi: 'अभी कोई संदेश नहीं' }}
            description={emptyBody || 'Say something to start the conversation. Everyone in the channel will see it.'}
          />
        )}

        {!loading && messages.map((m, i) => {
          const prev = messages[i - 1];
          const newDay = !prev || dayKey(prev.created_at) !== dayKey(m.created_at);
          // The unread divider goes above the first message the reader has not
          // seen, and only above their own first unseen one — a message they sent
          // themselves is not unread.
          const unread = !dividerShown
            && readMs > 0
            && new Date(m.created_at).getTime() > readMs
            && String(m.sender_id) !== String(meId);
          if (unread) dividerShown = true;

          return (
            <React.Fragment key={m.id}>
              {newDay && <div className="sv__sep">{dayLabel(m.created_at)}</div>}
              {unread && <div className="sv__newline">New</div>}
              <Message
                msg={m}
                continuation={!newDay && !unread && isContinuation(m, prev)}
                meId={meId}
                onReact={onReact}
                onOpenThread={onOpenThread}
                onReply={onReply}
              />
            </React.Fragment>
          );
        })}

      </div>

      {/* 06 §1: "When they're not near the bottom, show the jump-to-latest pill
          instead of moving them." */}
      {!loading && !pinned && messages.length > 0 && (
        <button type="button" className="sv__jump" onClick={jump}>
          {SvIcons.down}
          Jump to latest
        </button>
      )}
    </div>
  );
}
