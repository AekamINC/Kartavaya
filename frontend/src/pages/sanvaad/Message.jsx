/**
 * Message.jsx — one message row, its reaction chips, its hover tray and its
 * thread link.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Avatar, ConfirmDialog, Menu } from '../../components/ui';
import { formatTime } from '../../lib/timeFormat';
import { moduleMeta } from '../../lib/moduleColors';
import { relTime } from '../../lib/utils';
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

/**
 * The tombstone. `MESSAGING-ATTENDANCE-SPEC.md:24` — "`is_edited` / `is_deleted`
 * → need an 'edited' marker and a tombstone state" — and `ScreensSanvaad.jsx:118`
 * is the shape: a single full-width row, italic, naming who deleted it and when.
 * The build rendered a bare "Message deleted" inside the normal body, so a
 * deleted message still cost an avatar, a name and a timestamp column.
 *
 * Who sees it, precisely — this is not what it first looks like. `delete_message`
 * is a soft delete (`is_deleted=TRUE`) and `list_messages` filters
 * `is_deleted = FALSE`, so the row never comes back from the server again. The
 * poll cannot therefore remove it either: `mergeById` is a UNION, so a local
 * row the incoming page omits is kept, not dropped. The tombstone is
 * consequently visible to the deleter for the rest of the session and to nobody
 * else, and it disappears on the next channel switch.
 *
 * `ScreensSanvaad.jsx` places a deleted row among ordinary messages, so the
 * design intends a tombstone EVERY member sees. Reaching that needs
 * `list_messages` to return deleted rows with the content stripped instead of
 * filtering them out — a change to what every existing client receives, which
 * is recorded in the report rather than made here.
 */
function Tomb({ msg, who }) {
  return (
    <article className="msg msg--gone">
      <span className="msg__tomb">
        {SvIcons.trash}
        Message deleted by {who} · <time dateTime={msg.created_at}>{formatTime(msg.created_at)}</time>
      </span>
    </article>
  );
}

/**
 * A module event. `MESSAGING-ATTENDANCE-SPEC.md:20` is unusually direct about
 * this one: "`type='system'` already exists — module bot messages (task updates
 * from Kartavya, deals from Graha, invoices from Ganit) are a **message type**,
 * not a new mechanism. Render them with no avatar, a module glyph, and a muted
 * tonal background."
 *
 * `samvada_messages.type` has had `'system'` in its CHECK constraint since 058
 * and `list_messages` selects `m.*`, so the value has always arrived at the
 * client — which rendered it as an ordinary message with the sender's face and
 * name on it. A task update from Kartavya therefore looked like a human being
 * had typed it.
 *
 * The module id and the optional deep link come from `metadata`, the JSONB
 * column 058 provides and nothing writes yet:
 *
 *   { "module": "ganit", "action_label": "Open in Ganit", "action_href": "/ganit/…" }
 *
 * Everything is optional and the row degrades to a plain system note without it,
 * because the first producer of these rows does not exist yet and this must not
 * be the thing that breaks when it appears.
 */
function SystemMsg({ msg }) {
  const meta = (msg.metadata && typeof msg.metadata === 'object') ? msg.metadata : {};
  const mod = moduleMeta(meta.module);
  const when = formatTime(msg.created_at);

  return (
    <article className="msg msg--sys">
      <span
        className="msg__glyph"
        aria-hidden="true"
        style={mod ? { '--glyph': mod.color } : undefined}
      >
        {SvIcons.bolt}
      </span>
      <div className="msg__c">
        <div className="msg__hd">
          <span className="msg__who">
            {mod ? <>{mod.en} <span className="sv__hi" lang="hi">{mod.hi}</span></> : 'System'}
          </span>
          <span className="msg__systag">system</span>
          <time className="msg__when" dateTime={msg.created_at}>{when}</time>
        </div>
        <div className="msg__sysb">
          {msg.content}
          {meta.action_label && meta.action_href && (
            <Link className="msg__sysa" to={meta.action_href}>{meta.action_label} →</Link>
          )}
        </div>
      </div>
    </article>
  );
}

/**
 * "Seen by Aanya, Rohan +1" — `ScreensSanvaad.jsx:150`, on your own messages
 * only. `seen_by` is the first four readers by `last_read_at` and `seen_count`
 * is the uncapped total, both new on `list_messages`; see the note there for
 * why the receipt is derived from `samvada_channel_members.last_read_at` rather
 * than from `samvada_read_receipts`, which the schema declares and no endpoint
 * has ever written a row to.
 *
 * First names only, because the design shows first names and because a receipt
 * is glanced at, not read.
 */
function Seen({ names: seen, total }) {
  const shown = seen.slice(0, 2).map(n => String(n).split(' ')[0]);
  const extra = Math.max(0, (Number(total) || seen.length) - shown.length);
  return (
    <div className="seen">
      <span className="ch__ic" aria-hidden="true">{SvIcons.eye}</span>
      Seen by {shown.join(', ')}{extra > 0 ? ` +${extra}` : ''}
    </div>
  );
}

export default function Message({
  msg, continuation = false, meId, meName, names, onReact, onOpenThread, onReply,
  onEdit, onDelete,
}) {
  const cont = continuation;
  const rx = groupReactions(msg.reactions, meId);
  const who = msg.sender_name || 'Unknown';
  const threads = Number(msg.thread_count) || 0;
  const when = formatTime(msg.created_at);
  const mine = meId != null && String(msg.sender_id) === String(meId);

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(msg.content || '');
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const ta = useRef(null);

  // Opening the editor puts the caret at the END of the existing text, not at
  // the start — an edit is almost always an addition or a correction near the
  // end, and `autoFocus` alone selects nothing and lands at 0.
  useEffect(() => {
    if (!editing) return;
    const el = ta.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, [editing]);

  const openEditor = () => { setDraft(msg.content || ''); setEditing(true); };

  const commit = async () => {
    const next = draft.trim();
    if (!next || busy) return;
    if (next === (msg.content || '').trim()) { setEditing(false); return; }
    setBusy(true);
    try {
      await onEdit(msg, next);
      setEditing(false);
    } catch {
      // Same reasoning as `remove`: this runs straight off an onClick/onKeyDown,
      // so a rejection escapes as an unhandled promise. The toast is raised
      // upstream and the editor deliberately stays open with the draft intact —
      // losing what someone just typed because the save failed is the worse of
      // the two outcomes.
    } finally {
      setBusy(false);
    }
  };

  // Swallowed, not rethrown. `ConfirmDialog` runs `await onConfirm(); onClose()`
  // in its own click handler, so a rejection here would both leave an unhandled
  // promise in the console and skip `onClose`. `ChatPane` has already shown the
  // server's reason in a toast; keeping the dialog open is the retry.
  const remove = async () => {
    setBusy(true);
    try {
      await onDelete(msg);
      setConfirming(false);
    } catch {
      /* toast raised upstream */
    } finally {
      setBusy(false);
    }
  };

  const menu = mine && !msg.is_deleted && (onEdit || onDelete) ? [
    onEdit && { id: 'edit', label: 'Edit message', icon: SvIcons.pencil, onSelect: openEditor },
    onDelete && { id: 'del', label: 'Delete message', icon: SvIcons.trash, danger: true, onSelect: () => setConfirming(true) },
  ].filter(Boolean) : [];

  if (msg.is_deleted) return <Tomb msg={msg} who={who} />;
  // Before the tray, the reactions and the avatar are read: none of them apply
  // to a module event, and a system row has no author to act on.
  if (msg.type === 'system') return <SystemMsg msg={msg} />;

  // `__pending` is the optimistic row, `__fresh` a message that arrived while
  // the reader was watching. Both are motion-only flags set in `messageUtils`;
  // neither is ever sent to or read from the server.
  const cls = `msg${cont ? ' msg--cont' : ''}`
    + (msg.__pending ? ' msg--sending' : '')
    + (msg.__fresh ? ' msg--new' : '');

  return (
    <article className={cls}>
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
          </div>
        )}

        {editing ? (
          <div className="msg__edit">
            <textarea
              ref={ta}
              className="cmp__ta msg__edit-ta"
              rows={2}
              aria-label="Edit message"
              value={draft}
              disabled={busy}
              onChange={e => setDraft(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commit(); }
                if (e.key === 'Escape') { e.preventDefault(); setEditing(false); }
              }}
            />
            <div className="msg__edit-row">
              <button type="button" className="btn btn--fill btn--sm" onClick={commit} disabled={busy || !draft.trim()}>
                Save
              </button>
              <button type="button" className="btn btn--out btn--sm" onClick={() => setEditing(false)} disabled={busy}>
                Cancel
              </button>
              <span className="msg__edit-hint">Enter to save · Escape to cancel</span>
            </div>
          </div>
        ) : (
          <div className="msg__b">
            <Body text={msg.content} names={names} meName={meName} />
            {/* `.msg__ed`, appended to the BODY — `ScreensSanvaad.jsx:134` and
                `app.css:432`. It sat in the header beside the timestamp, where a
                continuation row (which has no header) could never show it, so an
                edited follow-up message was silently indistinguishable from an
                unedited one. */}
            {msg.is_edited && <span className="msg__ed">(edited)</span>}
          </div>
        )}

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
            {/* `.thrl__t` in `app.css:457` — "Last reply 20m ago". `last_reply_at`
                is new on `list_messages`; without it the link said how many
                replies exist but never whether the thread was alive. */}
            {msg.last_reply_at && (
              <span className="msg__thr-t">Last reply {relTime(msg.last_reply_at)}</span>
            )}
          </button>
        )}

        {mine && Array.isArray(msg.seen_by) && msg.seen_by.length > 0 && (
          <Seen names={msg.seen_by} total={msg.seen_count} />
        )}

        {/* `IxChat.jsx:138` — the caption under an unacknowledged row. The
            `opacity: .6` on `.msg--sending` is the state; this is the word for
            it, because opacity alone is not a signal a screen reader can read
            and `--motion-scale: 0` must not be able to remove it. */}
        {msg.__pending && <div className="msg__sending" role="status">Sending…</div>}
      </div>

      {/* No tray on a row the server has not acknowledged: its id is a local
          `tmp:` string, so a reaction, a thread reply, an edit or a delete would
          all address a message that does not exist yet. */}
      {!editing && !msg.__pending && (onReact || menu.length > 0) && (
        <div className="msg__act">
          {onReact && QUICK.map(e => (
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
          {/* `ScreensSanvaad.jsx:157` ends the tray with a "More" button. It was
              the only one of the three not built, which is why edit and delete —
              both of which have had a live endpoint since migration 058 — had no
              way in at all. */}
          {menu.length > 0 && (
            <Menu
              align="right"
              label="Message actions"
              items={menu}
              trigger={<span className="msg__actb">{SvIcons.dots}</span>}
            />
          )}
        </div>
      )}

      {/* `ConfirmDialog` takes a `state` object and renders nothing when it is
          null — it is not an `open` boolean. */}
      <ConfirmDialog
        state={confirming ? {
          title: 'Delete this message?',
          message: 'It disappears for everyone in the channel. This cannot be undone.',
          confirmLabel: 'Delete',
          intent: 'danger',
          onConfirm: remove,
        } : null}
        onClose={() => setConfirming(false)}
      />
    </article>
  );
}
