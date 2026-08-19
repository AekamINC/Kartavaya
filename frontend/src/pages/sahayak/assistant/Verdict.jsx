/**
 * The verdict on one answer, and the one question a thumbs-down asks.
 *
 * ── What was here before, and what it collected ─────────────────────────────
 *
 * Two thumbs that posted `accepted: true|false` and nothing else. On
 * 2026-08-19, `SELECT COUNT(*) FROM staging.hub_skill_feedback` was 0 and
 * `staging.ai_feedback` was 0 — every feedback table in this product is empty,
 * so nothing downstream has ever had anything to read. Proposal 69 §3E is about
 * that emptiness: the complaint is what becomes a test case, and a verdict with
 * no reason attached cannot become one. Somebody reading a row that says only
 * "wrong" a month from now cannot reproduce anything.
 *
 * These thumbs fill `hub_skill_feedback` and only that one. `ai_feedback` is
 * the other table — the accept/edit/reject ledger for generated content, with
 * no `message_id` to hang a chat answer on — and it stays at zero no matter
 * what happens on this control; `SahayakTab`'s header carries the whole
 * distinction, because §3E names the table this does not write to.
 *
 * So a thumbs-down asks ONE question, once, and every part of it is optional.
 * Five concrete reasons (`feedback.REASONS`) and a box for words. Choosing
 * nothing is a valid answer and leaves the verdict exactly as it was recorded.
 *
 * ── The three lies this control refuses to tell ─────────────────────────────
 *
 *   1. IT NEVER FILLS A THUMB THE SERVER DID NOT ACCEPT. `verdict` is the SENT
 *      state, written by `SahayakTab` only after the 201. The endpoint has four
 *      ways to refuse — 400 with no id, 404 on another tenant's message, 403
 *      from the module gate, 500 — and an optimistic fill would be wrong often
 *      enough to matter. A refusal paints no thumb and says so IN THE ROW, not
 *      only in a toast: a toast is gone in four seconds and the reader is left
 *      looking at an unpressed button with no idea why.
 *   2. IT SAYS WHAT IT STORED. After a reason is accepted the row echoes the
 *      note back, in the words that went into the column. "Thanks for your
 *      feedback" is not evidence that anything was written; the sentence that
 *      was written is.
 *   3. IT NEVER TAKES THE ANSWER AWAY, AND NEVER BLOCKS THE CHAT. The question
 *      is a block under the reply, not a dialog: the composer stays live, the
 *      thread keeps scrolling, and dismissing it costs nothing because the
 *      verdict is already on the server by then. A failed reason keeps the
 *      typed words exactly where they were — this panel owns that text, and
 *      nothing above it can unmount the panel out from under a failure.
 *
 * ── Keyboard ────────────────────────────────────────────────────────────────
 *
 * Everything here is a real `<button>` or a real `<textarea>` with a real
 * `<label>`; nothing is a div with a click handler and nothing steals focus.
 * The panel is drawn immediately after the thumb that opened it, so the next
 * Tab from that thumb lands on the first reason — the tab order is the reading
 * order without a `tabindex` anywhere. The status line is a `role="status"`, so
 * a reader who cannot see the fill is told what was recorded rather than left
 * to infer it from a button's colour. This project fixed its keyboard access by
 * hand (5cb76413) and regressions are not welcome.
 *
 * No id of any kind is rendered. The message id is an argument, never text.
 */
import React, { useId, useState } from 'react';
import { NOTE_MAX, REASONS, noteFrom } from './feedback';

/**
 * The two thumbs, drawn to the same 16-unit geometry as `layout/navIcons.jsx`.
 *
 * One path, mirrored, rather than two hand-drawn glyphs — a down thumb that is
 * not the exact reflection of the up thumb reads as two different controls.
 * `scale(1,-1)` about the centre is the mirror; the transform is on the <g> so
 * the stroke geometry is identical in both.
 */
function Thumb({ down }) {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor"
      strokeWidth="1.4" strokeLinejoin="round" aria-hidden="true">
      <g transform={down ? 'translate(0,16) scale(1,-1)' : undefined}>
        <path d="M4.5 14V7h1.9l2.2-4.6A1.4 1.4 0 0 1 11.2 3l-.5 3.1h2.6a1.2 1.2 0 0 1 1.2 1.4l-.8 4.6A1.9 1.9 0 0 1 11.8 14H4.5z" />
        <path d="M4.5 7H1.8v7h2.7" />
      </g>
    </svg>
  );
}

/**
 * The thumbs and the line that says what the ledger holds — both inline, both
 * inside `.sh__acts`.
 *
 * The reopen control exists because skipping the question is not meant to be a
 * one-way door: a reader who pressed the thumb, read the reply again and then
 * worked out what was wrong with it has nowhere else to put that.
 */
export default function Verdict({
  verdict = null, note = '', error = '', busy = false, asking = false,
  onFeedback, onAsk,
}) {
  // While the panel is open it carries the error and the question, so the row
  // does not say the same thing twice a line apart.
  const said = asking ? '' : (error
    ? `Not recorded — ${error} Press the thumb again to try.`
    : verdict === 'up' ? 'Recorded — thank you.'
      : verdict === 'down' ? (note ? `Recorded as wrong — ${note}` : 'Recorded as wrong.')
        : '');

  return (
    <>
      <span className="sh__fb" aria-busy={busy || undefined}>
        <button
          type="button"
          className={verdict === 'up' ? 'on' : undefined}
          aria-pressed={verdict === 'up'}
          aria-label="This answer was right"
          title="This answer was right"
          onClick={() => onFeedback('up')}
        >
          <Thumb />
        </button>
        <button
          type="button"
          className={verdict === 'down' ? 'on' : undefined}
          aria-pressed={verdict === 'down'}
          aria-label="This answer was wrong"
          title="This answer was wrong"
          onClick={() => onFeedback('down')}
        >
          <Thumb down />
        </button>
      </span>
      {said ? (
        <span
          className={error ? 'sh__note sh__note--bad' : 'sh__note'}
          role="status"
        >
          {said}
        </span>
      ) : null}
      {verdict === 'down' && !note && !asking && !error ? (
        <button type="button" className="sh__act" onClick={() => onAsk(true)}>
          Say what was wrong
        </button>
      ) : null}
    </>
  );
}

/**
 * The question itself — a block under the row, never a dialog.
 *
 * The chosen reasons and the typed words live HERE rather than in `SahayakTab`,
 * for one reason that is not tidiness: when the endpoint refuses the note, the
 * panel stays mounted and the words stay in it. State lifted to the page would
 * have to be cleaned up on every session switch, and the cleanup is what would
 * eventually eat somebody's sentence.
 *
 * Send is disabled while there is nothing to send. An empty note would be a
 * second row in an append-only table carrying no more signal than the first —
 * a write that costs a row and says nothing.
 */
export function ReasonPanel({ note = '', error = '', busy = false, onExplain, onCancel }) {
  const boxId = useId();
  const [picked, setPicked] = useState([]);
  const [text, setText] = useState('');
  const composed = noteFrom(picked, text);

  const toggle = (id) => setPicked(p => (
    p.includes(id) ? p.filter(x => x !== id) : [...p, id]
  ));

  return (
    <div className="sh__why" role="group" aria-label="What was wrong with this answer">
      <b>What was wrong with it?</b>
      <span>
        Optional, and the verdict is already recorded either way. A reason is
        what turns this into something somebody can reproduce and fix.
      </span>
      <div className="sh__acts">
        {REASONS.map(r => (
          <button
            key={r.id}
            type="button"
            className={picked.includes(r.id) ? 'sh__act on' : 'sh__act'}
            aria-pressed={picked.includes(r.id)}
            onClick={() => toggle(r.id)}
          >
            {r.label}
          </button>
        ))}
      </div>
      <label htmlFor={boxId}>In your own words, if you like</label>
      <textarea
        id={boxId}
        rows={2}
        maxLength={NOTE_MAX}
        value={text}
        onChange={e => setText(e.target.value)}
        placeholder="What did you expect it to say?"
      />
      {error ? (
        <span className="sh__note sh__note--bad" role="status">
          Not recorded — {error} Nothing you typed was lost; send it again.
        </span>
      ) : null}
      <div className="sh__confirm-act">
        <button
          type="button"
          className="sh__act"
          disabled={busy || !composed || composed === note}
          onClick={() => onExplain(composed)}
        >
          {busy ? 'Sending…' : 'Send this'}
        </button>
        <button type="button" className="sh__act" onClick={() => onCancel()}>
          Skip
        </button>
      </div>
    </div>
  );
}
