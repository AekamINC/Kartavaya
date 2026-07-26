/**
 * Message.jsx — one message row, its reaction chips, its hover tray and its
 * thread link.
 */
import React from 'react';
import { Avatar } from '../../components/ui';
import { formatTime } from '../../lib/timeFormat';
import { groupReactions, splitMentions } from './messageUtils';
import { SvIcons } from './icons';

/**
 * The five quick reactions. `06-sanvaad-varta.md` §Plus: "The five quick
 * reactions (👍 ✅ 👀 ❤️ 😂) are content, not chrome — those stay."
 */
export const QUICK = ['👍', '✅', '👀', '❤️', '😂'];

/** Body text with `@name` lifted out of it — see `splitMentions`. */
function Body({ text, names, meName }) {
  const parts = splitMentions(text, names, meName);
  return parts.map((p, i) => (typeof p === 'string' ? p : (
    <span key={i} className={`msg__mn${p.me ? ' msg__mn--me' : ''}`}>{p.mention}</span>
  )));
}

export default function Message({
  msg, continuation = false, meId, meName, names, onReact, onOpenThread, onReply,
}) {
  const cont = continuation;
  const rx = groupReactions(msg.reactions, meId);
  const who = msg.sender_name || 'Unknown';
  const threads = Number(msg.thread_count) || 0;
  const when = formatTime(msg.created_at);

  return (
    <article className={`msg${cont ? ' msg--cont' : ''}`}>
      {/* Grouping hides the avatar with `visibility` so nothing shifts, which
          also hid the only timestamp a continuation row had. The gutter puts it
          back in that slot on hover — `00-tokens.md` §11 names
          `.msg--cont:hover .msg__gut` as a call site, and `ScreensSanvaad.jsx`
          swaps the avatar for it outright. */}
      {cont
        ? <time className="msg__gut" dateTime={msg.created_at}>{when}</time>
        : <Avatar className="msg__av" name={who} src={msg.sender_avatar} size={32} />}

      <div className="msg__c">
        {!cont && (
          <div className="msg__hd">
            <span className="msg__who">{who}</span>
            {/* `lib/timeFormat.js`, not a second date helper — 06 §5: message
                timestamps must honour the 12h/24h preference. */}
            <time className="msg__when" dateTime={msg.created_at}>{when}</time>
            {msg.is_edited && <span className="msg__when">(edited)</span>}
          </div>
        )}

        <div className="msg__b">
          {msg.is_deleted
            ? <span className="msg__gone">Message deleted</span>
            : <Body text={msg.content} names={names} meName={meName} />}
        </div>

        {rx.length > 0 && (
          <div className="rx">
            {rx.map(r => (
              <button
                key={r.emoji}
                type="button"
                className={`rx__c${r.mine ? ' mine' : ''}`}
                onClick={() => onReact(msg, r.emoji)}
                // `.mine` alone is a colour difference, so the state is also in
                // the accessible name — 23-accessibility.md.
                aria-pressed={r.mine}
                aria-label={`${r.emoji}, ${r.count} ${r.count === 1 ? 'reaction' : 'reactions'}${r.mine ? ', including yours' : ''}`}
              >
                <span aria-hidden="true">{r.emoji}</span>
                <b>{r.count}</b>
              </button>
            ))}
          </div>
        )}

        {threads > 0 && onOpenThread && (
          <button type="button" className="msg__thr" onClick={() => onOpenThread(msg)}>
            <span className="ch__ic" aria-hidden="true">{SvIcons.reply}</span>
            {threads} {threads === 1 ? 'reply' : 'replies'}
          </button>
        )}
      </div>

      {!msg.is_deleted && onReact && (
        <div className="msg__act">
          {QUICK.map(e => (
            <button
              key={e}
              type="button"
              className="msg__actb"
              onClick={() => onReact(msg, e)}
              aria-label={`React ${e}`}
            >
              <span aria-hidden="true">{e}</span>
            </button>
          ))}
          {onReply && (
            <button type="button" className="msg__actb" onClick={() => onReply(msg)} aria-label="Reply in thread">
              {SvIcons.reply}
            </button>
          )}
        </div>
      )}
    </article>
  );
}
