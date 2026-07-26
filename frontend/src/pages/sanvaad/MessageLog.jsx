/**
 * MessageLog.jsx — date separators, the unread divider, consecutive grouping,
 * and the jump-to-latest pill.
 */
import React, { useMemo } from 'react';
import { EmptyState, SkeletonChat } from '../../components/ui';
import Message from './Message';
import { ChatArt, SvIcons } from './icons';
import { dayKey, dayLabel, isContinuation } from './messageUtils';
import useStickyScroll from './useStickyScroll';

/**
 * "Today · आज" — the Devanagari half needs `--font-indic`, so it is its own
 * node. One wrapper, because `.sv__sep` is a flex row whose `gap` separates the
 * two hairline rules: leaving the label as two loose flex items would put that
 * same 12px between the word and its own translation.
 */
export function DayLabel({ iso }) {
  const { en, hi } = dayLabel(iso);
  return (
    <span className="sv__sep-t">
      {en}{hi && <span className="sv__hi" lang="hi">{hi}</span>}
    </span>
  );
}

export default function MessageLog({
  messages, loading, meId, meName, lastReadAt, onReact, onOpenThread, onReply, emptyTitle, emptyBody,
}) {
  // A cheap signature, so a re-render that changes nothing about the messages
  // does not re-run the scroll decision.
  const sig = `${messages.length}:${messages[messages.length - 1]?.id || ''}`;
  const { logRef, pinned, jump } = useStickyScroll(sig);

  // Everyone who has spoken here, which is the mention vocabulary this surface
  // can build without a second request. `list_members` would be more complete
  // and is noted rather than fetched — a mention of somebody who has not posted
  // still matches through the bare-handle fallback in `splitMentions`.
  const names = useMemo(
    () => [...new Set(messages.map(m => m.sender_name).filter(Boolean))],
    [messages]
  );

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
              {newDay && <div className="sv__sep"><DayLabel iso={m.created_at} /></div>}
              {/* "New messages · नए संदेश" — `ScreensSanvaad.jsx`'s `mdiv--new`.
                  A bare "New" reads as a label on the message under it rather
                  than as a rule across the log. */}
              {unread && (
                <div className="sv__newline">
                  <span className="sv__sep-t">
                    New messages<span className="sv__hi" lang="hi">नए संदेश</span>
                  </span>
                </div>
              )}
              <Message
                msg={m}
                continuation={!newDay && !unread && isContinuation(m, prev)}
                meId={meId}
                meName={meName}
                names={names}
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
