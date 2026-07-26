import React from 'react';
import { Pencil, Trash2 } from 'lucide-react';
import MentionTextarea from '../MentionTextarea';
import Lbl from './DrawerLabel';
import { formatDate, formatTime } from '../../lib/timeFormat';

/**
 * DrawerComments — a FLAT comment list with inline edit and delete.
 *
 * Flat, not threaded. The docstring here used to say "threaded comment list"
 * and there is no `parent_comment_id` anywhere in the schema, the API or this
 * component (03 §5, bug 3). A wrong docstring on a small file is how the next
 * person loses an afternoon looking for the nesting; threading is a data-model
 * change, so the comment is corrected rather than the code.
 */

/**
 * Highlight mentions, matching how the backend resolves them.
 *
 * 03 §5 quotes this file as splitting on `/(@[\w.-]+)/g` and calls it bug 1.
 * That line is no longer here — it was replaced before this batch, and the
 * replacement is the careful version below. What REMAINS true of the finding is
 * the part underneath the quote: nothing is stored. Mentions are still resolved
 * from the body text at render time, so renaming a user still breaks every past
 * mention of them, and the body alone still cannot tell the backend who to
 * notify. Fixing that is a schema change — the comment needs
 * `mentions: [{user_id, offset, length}]` on it and `POST /v1/tasks/:id/comments`
 * needs to accept them — and neither the schema nor the API is in this batch's
 * scope. Recorded rather than half-done.
 *
 * The version that IS here: member display names matched first, longest first,
 * so a member called "Keval" cannot shadow "Keval Shah" — MentionTextarea
 * inserts the full display name, so a `[\w.-]+` match stopped at the space and
 * bolded "@Keval" with " Shah" left as plain text. Bare handles still
 * highlight, but only when not preceded by a word character, which is what
 * excludes the domain of a pasted email address.
 */
export function renderMentions(body, members = []) {
  if (!body) return body;
  const names = (members || [])
    .map(m => m.display_name)
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)
    .map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));

  const pattern = names.length
    ? `(?:${names.join('|')})|[\\w.-]+`
    : `[\\w.-]+`;
  // (^|[^\w@]) keeps "user@example.com" from matching — a mention never
  // follows a word character.
  const re = new RegExp(`(^|[^\\w@])(@(?:${pattern}))`, 'gi');

  const out = [];
  let last = 0, m;
  while ((m = re.exec(body)) !== null) {
    const start = m.index + m[1].length;
    if (start > last) out.push(body.slice(last, start));
    out.push(<strong key={start} className="dr__cm-m">{m[2]}</strong>);
    last = start + m[2].length;
  }
  if (last < body.length) out.push(body.slice(last));
  return out;
}

/**
 * `new Date(x).toLocaleString()` — 03 §5 bug 2, and it HELD: the timestamp
 * ignored the user's 12h/24h preference while `lib/timeFormat.js` existed and
 * `DueChip` already used it, so somebody who set 24-hour time still read
 * 12-hour comments. It also printed the browser's locale, which meant the same
 * comment rendered `26/07/2026` on one machine and `7/26/2026` on the next.
 */
function commentStamp(iso) {
  if (!iso) return '';
  return `${formatDate(iso)}, ${formatTime(iso)}`;
}

export default function DrawerComments({
  comments, comment, setComment, postComment,
  deleteComment, editingComment, editBody, setEditBody,
  startEditComment, saveEditComment,
  me, isSystemAdmin, mentionMembers,
}) {
  return (
    <div>
      <Lbl hi="टिप्पणियाँ">Comments</Lbl>

      {comments.length === 0 && <p className="dr__empty">No comments yet.</p>}

      {comments.map(c => (
        <div key={c.comment_id} className="dr__cm">
          <span className="dr__cm-av" aria-hidden="true">
            {c.user_name?.[0]?.toUpperCase() || '?'}
          </span>
          <div className="dr__cm-c">
            <div className="dr__cm-h">
              <span className="dr__cm-who">{c.user_name}</span>
              <time className="dr__cm-when" dateTime={c.created_at}>{commentStamp(c.created_at)}</time>
              {(c.user_id === me?.user_id || isSystemAdmin) && editingComment !== c.comment_id && (
                /* Revealed on hover AND :focus-within. A hover-only reveal is
                   unreachable by keyboard, which the always-visible version
                   this replaces at least did not break. */
                <div className="dr__cm-act">
                  <button type="button" className="dr__ico" title="Edit"
                    aria-label={`Edit comment by ${c.user_name}`}
                    onClick={() => startEditComment(c)}>
                    <Pencil size={11} />
                  </button>
                  <button type="button" className="dr__ico dr__ico--danger" title="Delete"
                    aria-label={`Delete comment by ${c.user_name}`}
                    onClick={() => deleteComment(c.comment_id)}>
                    <Trash2 size={11} />
                  </button>
                </div>
              )}
            </div>

            {editingComment === c.comment_id ? (
              <div className="dr__cm-edit">
                <textarea
                  className="dr__ta"
                  aria-label="Edit comment"
                  value={editBody}
                  onChange={e => setEditBody(e.target.value)}
                  rows={3}
                />
                <div className="dr__ap-acts">
                  <button type="button" className="btn btn--ghost btn--sm" onClick={() => startEditComment(null)}>
                    Cancel
                  </button>
                  <button type="button" className="btn btn--fill btn--sm"
                    onClick={() => saveEditComment(c.comment_id)} disabled={!editBody.trim()}>
                    Save
                  </button>
                </div>
              </div>
            ) : (
              <p className="dr__cm-b">{renderMentions(c.body, mentionMembers)}</p>
            )}
          </div>
        </div>
      ))}

      <div className="dr__cm-new">
        <MentionTextarea
          value={comment}
          onChange={setComment}
          onSubmit={postComment}
          members={mentionMembers}
          placeholder="Add a comment… type @ to mention"
          rows={2}
        />
        <button type="button" className="btn btn--fill btn--sm" onClick={postComment} disabled={!comment.trim()}>
          Send
        </button>
      </div>
    </div>
  );
}
