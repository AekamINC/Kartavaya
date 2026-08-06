import React, { useId } from 'react';
import { avatarBg } from '../ui/Avatar';
import { userInitials } from '../../lib/utils';

/**
 * InlineThread — replies in the log, under the message they belong to.
 *
 * `28-messaging-v2.md` §2, `messaging.css:193-206` (`.m2th*`). This is the
 * structural fix, not a restyle.
 *
 * THE DEFECT IT CLOSES. Threads are write-only today: you can reply into one
 * and the replies are unreachable. The cause is not the UI — `list_messages`
 * filters `AND m.parent_message_id IS NULL`, so a reply is never in the channel
 * log, and replies exist only inside `ThreadPanel`, which `ChannelsTab` owns as
 * a SIBLING of `ChatPane` in a third grid column. `ChatPane` cannot render them
 * and cannot await them, which is the entire reason its deep-link path carries
 * a six-second retry loop and three separate failure sentences.
 *
 * THE FIX IS THAT THE LOG IS THE WHOLE RECORD. A message with replies renders
 * this control — face stack, count, time of the last reply — and expanding it
 * puts the replies in place, indented behind a 2px accent rule, with reply
 * composition in the same block.
 *
 * ON `ThreadPanel`. 28 §2 is explicit — "Do not delete `ThreadPanel`" — because
 * it is the mobile presentation of the same data (a phone has no room to
 * indent) and it is what a deep link to a reply opens. What was supposed to go
 * away is it being the ONLY way to read a reply.
 *
 * MEASURED at the time this file was written: `pages/sanvaad/ThreadPanel.jsx`
 * has been deleted from the working tree by the page rewrite running alongside
 * this one, and `Composer.jsx`, `ChannelsTab.jsx` and `ChatPane.jsx` still name
 * it in their docblocks. That is that run's call and its file, not this one's,
 * and it is reported rather than reversed here. Nothing in THIS component
 * depends on which way it goes: it renders whatever nodes it is handed and
 * fetches nothing.
 *
 * ── What this component does NOT do, on purpose ─────────────────────────────
 *
 * It does not fetch, and it does not render a reply. `children` is where the
 * replies go, rendered by whatever the log already uses to render a message, so
 * a reply and its parent cannot drift apart in markup or in mention handling.
 * `.m2th__body .m2m` re-grids to a 26px avatar and a full-width bubble; that
 * happens in CSS, off the parent class, so the caller passes the same node it
 * would have passed at top level.
 *
 * ── What the face stack can and cannot know ─────────────────────────────────
 *
 * MEASURED: `list_messages` already returns `thread_count` and `last_reply_at`
 * per parent, unconditionally and org/channel-scoped — so `count` and
 * `lastReplyAt` need no new endpoint, and `include_reply_counts=1` is largely
 * redundant. The one thing this control needs and cannot get from that response
 * is WHO replied. So `repliers` is optional and the stack simply does not
 * render when it is empty. It does not render a placeholder face: a grey circle
 * standing in for a person is a claim about who is in a conversation, and this
 * component would be making it up.
 */

/** The most faces the stack shows before it stops. Four is what the header's
 *  own stack shows, and these are 19px against that one's 24px. */
const MAX_FACES = 4;

export default function InlineThread({
  count = 0,
  lastReplyAt,
  repliers = [],
  open = false,
  onToggle,
  onReply,
  replyLabel = 'Reply in this thread',
  className = '',
  children,
}) {
  const bodyId = useId();

  /* No replies, no control. A message that has never been replied to must not
     grow a "0 replies" affordance — the log is already dense and an empty
     control is a thing the eye has to dismiss on every message. */
  if (!count) return null;

  const faces = repliers.slice(0, MAX_FACES);

  return (
    <div className={['m2th', className].filter(Boolean).join(' ')}>
      <button
        type="button"
        className="m2th__open"
        aria-expanded={open}
        aria-controls={open ? bodyId : undefined}
        onClick={onToggle}
      >
        {faces.length > 0 && (
          /* Decorative: every name in it is already in the expanded thread, and
             a screen reader reading four initials before the count would bury
             the number that is the point of the control. */
          <span className="m2th__faces" aria-hidden="true">
            {faces.map((p, i) => {
              const name = p.name || p.full_name || p.display_name || '?';
              return (
                <i key={p.id ?? p.user_id ?? i} style={{ background: avatarBg(name) }} title={name}>
                  {userInitials(name).charAt(0)}
                </i>
              );
            })}
          </span>
        )}
        {count} {count === 1 ? 'reply' : 'replies'}
        {lastReplyAt && <span className="m2th__when">· last at {lastReplyAt}</span>}
        {/* The chevron turns rather than swapping glyph — the same element in
            two states reads as one control, two elements read as two. */}
        <span
          aria-hidden="true"
          style={{
            display: 'grid',
            transform: open ? 'rotate(180deg)' : 'none',
            transition: 'transform var(--dur-fast)',
          }}
        >
          <svg width="13" height="13" viewBox="0 0 20 20" fill="none" stroke="currentColor"
            strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 8l5 5 5-5" />
          </svg>
        </span>
      </button>

      {open && (
        <div className="m2th__body" id={bodyId}>
          {children}
          {typeof onReply === 'function' && (
            <button type="button" className="m2th__reply" onClick={onReply}>
              <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor"
                strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M8.5 5.5L4 10l4.5 4.5M4 10h6.5a5 5 0 015 5v.5" />
              </svg>
              {replyLabel}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
