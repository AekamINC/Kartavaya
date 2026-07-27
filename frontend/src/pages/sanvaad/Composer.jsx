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

/**
 * English only, deliberately. `24-bilingual-devanagari.md` closes with an
 * explicit "No" list — "validation messages, error text, empty-state
 * explanations, tooltips, form field labels, table column headers" — and a
 * placeholder is the label of the field it sits in. The rule there is that
 * Devanagari is "a recognition cue on things the user already knows the meaning
 * of"; "Write a message…" is an instruction, not a name the reader already
 * recognises, so the second script buys nothing.
 *
 * The structural half matters more than the editorial half. A placeholder is a
 * plain string attribute, so the Devanagari inside one can never carry `lang`
 * or `--font-indic` — the two things `24` requires of every Indic run. Without
 * `lang` a screen reader speaks Devanagari with the English voice; without
 * `--font-indic` an EN+GU user gets Devanagari where Gujarati was chosen. Every
 * other Indic string in this module (`.sv__hi`, `EmptyState`'s `{en, hi}`
 * title) is a nested element for exactly that reason. A placeholder cannot be,
 * so it does not get one.
 */
const DEFAULT_PLACEHOLDER = 'Write a message…';

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

  /**
   * The box clears BEFORE the request, not after it.
   *
   * `MOTION-SPEC.md` §7.1 pairs the optimistic row in the log with an immediately
   * empty composer — that is one gesture, and splitting it across a round trip is
   * what made a slow send look like a dropped one: the text was still sitting in
   * the box, the send button was disabled, and nothing had appeared in the log.
   *
   * The draft is restored on failure, which is the other half of the same rule
   * ("a failed write restores the old value"). `onSend` rethrows after `ChatPane`
   * has raised the server's own reason, so the reader gets the sentence and their
   * words back together.
   */
  const submit = async () => {
    const body = text.trim();
    if (!body || busy || disabled) return;
    setBusy(true);
    setText('');
    try {
      await onSend(body);
    } catch {
      setText(body);
      ta.current?.focus();
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
          placeholder={placeholder || DEFAULT_PLACEHOLDER}
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
