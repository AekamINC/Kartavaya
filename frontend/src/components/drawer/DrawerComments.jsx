import React from 'react';
import { Pencil, Trash2 } from 'lucide-react';
import MentionTextarea from '../MentionTextarea';
import { lbl } from './constants';

/**
 * DrawerComments — threaded comment list with inline edit/delete, plus add-comment input.
 */
/**
 * Highlight mentions, matching how the backend resolves them.
 *
 * The old renderer was `body.split(/(@[\w.-]+)/g)`, which disagreed with the
 * picker at both ends. MentionTextarea inserts the member's full display name,
 * so "@Keval Shah" was bolded as "@Keval" with " Shah" left as plain text —
 * the visible tell that the inserter and the parsers disagree. The same regex
 * also bolded the domain of any pasted email address: "contact user@example.com"
 * rendered "@example.com" as a mention of nobody.
 *
 * Member display names are matched first, longest first, so a member called
 * "Keval" cannot shadow "Keval Shah". Bare handles still highlight, but only
 * when not preceded by a word character — which is what excludes email domains.
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
    out.push(<strong key={start} style={{ color: 'var(--k-primary)' }}>{m[2]}</strong>);
    last = start + m[2].length;
  }
  if (last < body.length) out.push(body.slice(last));
  return out;
}

export default function DrawerComments({
  comments, comment, setComment, postComment,
  deleteComment, editingComment, editBody, setEditBody,
  startEditComment, saveEditComment,
  me, isSystemAdmin, mentionMembers,
}) {
  return (
    <div>
      <span style={{ ...lbl, marginBottom: 10 }}>
        Comments{' '}
        <span style={{ fontFamily: 'var(--font-hindi)', fontSize: 12, textTransform: 'none', letterSpacing: 0, color: 'var(--ink-faint)', fontWeight: 400 }}>
          &#x091F;&#x093F;&#x092A;&#x094D;&#x092A;&#x0923;&#x093F;&#x092F;&#x093E;&#x0901;
        </span>
      </span>

      {comments.length === 0 && (
        <p style={{ color: 'var(--ink-3)', fontSize: 13, marginBottom: 12 }}>No comments yet.</p>
      )}

      {comments.map(c => (
        <div key={c.comment_id} style={{ display: 'flex', gap: 10, marginBottom: 14 }}>
          <div style={{
            width: 28, height: 28, borderRadius: '50%',
            background: 'color-mix(in srgb, var(--k-primary) 15%, var(--surface))',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 11, fontWeight: 700, color: 'var(--k-primary)', flexShrink: 0,
          }}>
            {c.user_name?.[0]?.toUpperCase() || '?'}
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontWeight: 600, fontSize: 13 }}>{c.user_name}</span>{' '}
              <span style={{ color: 'var(--ink-3)', fontSize: 11 }}>
                {new Date(c.created_at).toLocaleString()}
              </span>
              {(c.user_id === me?.user_id || isSystemAdmin) && editingComment !== c.comment_id && (
                <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
                  <button
                    onClick={() => startEditComment(c)}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-3)', padding: 2, display: 'flex' }}
                    title="Edit"
                  >
                    <Pencil size={11} />
                  </button>
                  <button
                    onClick={() => deleteComment(c.comment_id)}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-3)', padding: 2, display: 'flex' }}
                    title="Delete"
                    aria-label="Delete comment"
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
              )}
            </div>

            {editingComment === c.comment_id ? (
              <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <textarea
                  value={editBody}
                  onChange={e => setEditBody(e.target.value)}
                  rows={3}
                  className="k-input"
                  style={{ width: '100%', resize: 'vertical', fontSize: 13 }}
                />
                <div style={{ display: 'flex', gap: 6 }}>
                  <button onClick={() => startEditComment(null)} className="k-btn k-btn--ghost k-btn--sm">
                    Cancel
                  </button>
                  <button
                    onClick={() => saveEditComment(c.comment_id)}
                    className="k-btn k-btn--primary k-btn--sm"
                    disabled={!editBody.trim()}
                  >
                    Save
                  </button>
                </div>
              </div>
            ) : (
              <p style={{ margin: '4px 0 0', fontSize: 13, lineHeight: 1.55, whiteSpace: 'pre-wrap' }}>
                {renderMentions(c.body, mentionMembers)}
              </p>
            )}
          </div>
        </div>
      ))}

      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <MentionTextarea
          value={comment}
          onChange={setComment}
          onSubmit={postComment}
          members={mentionMembers}
          placeholder="Add a comment&hellip; type @ to mention"
          rows={2}
        />
        <button onClick={postComment} className="k-btn k-btn--primary k-btn--sm">Send</button>
      </div>
    </div>
  );
}
