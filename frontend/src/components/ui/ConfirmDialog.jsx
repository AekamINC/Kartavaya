import React, { useEffect, useId, useRef, useState } from "react";
import FocusTrap from "./FocusTrap";

/**
 * Accessible confirm dialog — replaces window.confirm throughout the app.
 *
 * Usage (unchanged — nine call sites depend on it):
 *   const [confirm, setConfirm] = useState(null);
 *   // trigger:  setConfirm({ message: "...", onConfirm: () => doThing() })
 *   // render:   <ConfirmDialog state={confirm} onClose={() => setConfirm(null)} />
 *
 * Three things changed here, per 02-common-components.md §5.
 *
 * 1 · **Off inline styles and onto tokens.** It painted `var(--k-danger,
 *     #dc2626)`, `var(--surface, #fff)`, `var(--rule, #e2e8f0)` and a literal
 *     `rgba(0,0,0,0.25)` shadow. Two of those fallbacks are the bug 00 §7 warns
 *     about — a `var(--x, fallback)` hides a missing token indefinitely, and
 *     `--k-danger` is one of the two competing reds that made some "red" buttons
 *     not red. It now uses `.modal__*` and `.btn--*`, which is the same chrome
 *     as Modal rather than a second dialog that merely resembles it.
 *
 * 2 · **`intent`** — `danger` | `warn` | `neutral`. The confirm button was
 *     always a filled red or a filled primary, so "Archive this project" and
 *     "Delete permanently" looked identical.
 *
 * 3 · **A typed confirmation for irreversible actions.** Pass `confirmText:
 *     "DELETE"` (or the record's own name) and the confirm button stays disabled
 *     until it is typed. This is the ONE place a filled danger button is correct
 *     — 02 §1 says danger is an outline variant precisely because a filled red
 *     button reads as the primary action on the screen, and the exception is a
 *     confirmed delete inside a dialog the user opened deliberately.
 *
 * Escape only; Tab-trapping and focus restore belong to <FocusTrap>, which
 * captures the trigger before moving focus inward.
 */
export default function ConfirmDialog({ state, onClose }) {
  const cancelRef = useRef(null);
  const [typed, setTyped] = useState('');

  // useId, not a literal. Two dialogs mounted at once — a delete confirm opened
  // from inside a slide-over — produced duplicate "cd-title" ids, and
  // aria-labelledby resolved to whichever the browser found first.
  const uid       = useId();
  const titleId   = `cd-title-${uid}`;
  const messageId = `cd-msg-${uid}`;
  const inputId   = `cd-type-${uid}`;

  useEffect(() => {
    if (!state) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [state, onClose]);

  // Reset between openings, or the second dialog opens pre-confirmed with the
  // first one's text still in the box.
  useEffect(() => { setTyped(''); }, [state]);

  if (!state) return null;

  const {
    title = 'Are you sure?',
    message,
    onConfirm,
    confirmLabel = 'Delete',
    // `confirmStyle` is the legacy name and still honoured; `intent` is the one
    // 02 asks for. Neither call site has to change on the same commit as this.
    intent = state.confirmStyle === 'primary' ? 'neutral' : (state.confirmStyle || 'danger'),
    confirmText,
  } = state;

  const needsTyping = Boolean(confirmText);
  const ready = !needsTyping || typed.trim() === confirmText;
  const confirmVariant = intent === 'danger' ? 'fill' : intent === 'warn' ? 'out' : 'fill';

  return (
    <div
      role="presentation"
      className="modal__scrim"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <FocusTrap active initialFocus={cancelRef}>
        <div
          role="alertdialog"
          aria-modal="true"
          aria-labelledby={titleId}
          aria-describedby={messageId}
          className="modal__panel modal__panel--sm"
          data-intent={intent}
        >
          <div className="modal__body">
            <p id={titleId} className="cd__t">{title}</p>
            <p id={messageId} className="cd__m">{message}</p>

            {needsTyping && (
              <div className="fldx cd__type">
                <label className="fldx__lbl" htmlFor={inputId}>
                  <span>Type <code>{confirmText}</code> to confirm</span>
                </label>
                <input
                  id={inputId}
                  className="fldx__in"
                  value={typed}
                  autoComplete="off"
                  spellCheck="false"
                  onChange={(e) => setTyped(e.target.value)}
                />
              </div>
            )}
          </div>

          <div className="modal__foot">
            <button ref={cancelRef} type="button" className="btn btn--ghost" onClick={onClose}>Cancel</button>
            <button
              type="button"
              className={`btn ${intent === 'danger' ? 'btn--dangerfill' : `btn--${confirmVariant}`}`}
              disabled={!ready}
              onClick={async () => { await onConfirm(); onClose(); }}
            >
              {confirmLabel}
            </button>
          </div>
        </div>
      </FocusTrap>
    </div>
  );
}
