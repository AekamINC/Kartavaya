/**
 * Composer.jsx — the message box, its reply bar and its emoji row.
 *
 * `06-sanvaad-varta.md` §8: "The composer is an `<input>`, and `onKeyDown`
 * checks `!e.shiftKey` before sending. An `<input>` cannot hold a newline, so
 * Shift+Enter does nothing at all — it neither sends nor breaks the line. Use a
 * `<textarea>` that grows to a max height."
 *
 * The channels composer had already been converted to a `<textarea>` on the
 * branch, so half of this claim is stale; the growth was not implemented, and
 * the WhatsApp composer was still an `<input>` with the same dead guard.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { SvIcons } from './icons';
import { QUICK } from './Message';

/** `.cmp__ta` caps at 180px; keep the two numbers in one place. */
const MAX_H = 180;

export default function Composer({
  onSend, disabled, placeholder, replyTo, onCancelReply, emoji = false, label = 'Message',
}) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const ta = useRef(null);

  // Grow to content, then scroll. Reset to `auto` first or the box only ever
  // gets taller — `scrollHeight` never shrinks below the current height.
  const autoGrow = useCallback(() => {
    const el = ta.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, MAX_H)}px`;
  }, []);

  useEffect(autoGrow, [text, autoGrow]);

  // Opening a reply should put the cursor where the reply gets typed.
  useEffect(() => { if (replyTo) ta.current?.focus(); }, [replyTo]);

  const submit = async () => {
    const body = text.trim();
    if (!body || busy || disabled) return;
    setBusy(true);
    try {
      await onSend(body);
      setText('');
    } finally {
      setBusy(false);
    }
  };

  const onKeyDown = (e) => {
    // Now that this is a textarea the guard means what it says: Enter sends,
    // Shift+Enter breaks the line.
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
    if (e.key === 'Escape' && replyTo) { e.preventDefault(); onCancelReply?.(); }
  };

  return (
    <>
      {replyTo && (
        <div className="cmp__reply">
          <span className="ch__ic" aria-hidden="true">{SvIcons.reply}</span>
          <span className="cmp__reply-t">
            Replying to <strong>{replyTo.sender_name || 'Unknown'}</strong>
            {replyTo.content ? ` — ${replyTo.content.slice(0, 70)}` : ''}
          </span>
          <button type="button" className="svbtn" onClick={onCancelReply} aria-label="Cancel reply">
            {SvIcons.close}
          </button>
        </div>
      )}

      {pickerOpen && (
        <div className="cmp__reply">
          <div className="emo" role="group" aria-label="Insert emoji">
            {QUICK.map(e => (
              <button
                key={e}
                type="button"
                className="emo__b"
                onClick={() => { setText(t => t + e); setPickerOpen(false); ta.current?.focus(); }}
                aria-label={`Insert ${e}`}
              >
                <span aria-hidden="true">{e}</span>
              </button>
            ))}
          </div>
          <button type="button" className="svbtn" onClick={() => setPickerOpen(false)} aria-label="Close emoji picker">
            {SvIcons.close}
          </button>
        </div>
      )}

      <div className="cmp">
        {emoji && (
          <button
            type="button"
            className="svbtn"
            onClick={() => setPickerOpen(o => !o)}
            aria-label="Insert emoji"
            aria-expanded={pickerOpen}
          >
            {SvIcons.smile}
          </button>
        )}
        <textarea
          ref={ta}
          className="cmp__ta"
          rows={1}
          aria-label={label}
          placeholder={placeholder || 'Write a message…  संदेश लिखें'}
          value={text}
          disabled={disabled}
          onChange={e => setText(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <button
          type="button"
          className="cmp__send"
          onClick={submit}
          disabled={busy || disabled || !text.trim()}
          aria-label="Send"
        >
          {SvIcons.send}
        </button>
      </div>
    </>
  );
}
