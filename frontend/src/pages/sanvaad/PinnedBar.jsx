/**
 * PinnedBar.jsx — the strip above the log that says what this channel has
 * pinned.
 *
 * `samvada_messages` gained `pinned_at` / `pinned_by` in migration 093 and
 * `GET /v1/messaging/channels/:id/pins` is their only reader, so this component
 * is the whole surface of the feature. The other half — the `.msg__pin` chip on
 * the row itself — you can only see if you have already scrolled to it, and a
 * pin whose only home is the message it marks is not a pin, it is a decoration.
 *
 * Two states, and collapsed is the default on purpose. A channel is allowed
 * fifty pins (§1.9 caps it there so `GET /pins` can stay one unpaged query) and
 * fifty rows unrolled above the log would push the conversation off a laptop
 * screen. Expanding costs no request — `useChannelMessages` already holds the
 * list.
 *
 * ── The markup is dictated, not chosen ────────────────────────────────────
 * `sanvaad.css` is written by a different owner and this file may not open it,
 * so the structure below is the one its "MARKUP THIS EXPECTS" note names, to the
 * element:
 *
 *   .sv__pins[.is-open]     the strip; wraps, so the open list can take its own row
 *     .sv__pins-i           the pin glyph
 *     .sv__pins-t           the preview line — or, open, the list of pinned rows
 *     .sv__pins-x           unpin (a button, only when `onUnpin` is given)
 *     .sv__pins-nav         the "1 of 4" toggle (a button)
 *
 * Two consequences worth stating rather than discovering later:
 *
 *   · `.sv__pins-t` carries no button reset — it is `flex: 1` with an ellipsis,
 *     not a control — so the COLLAPSED preview is plain text and jumping to a
 *     pin is done from the open list. Making it a button would cost the
 *     ellipsis (`text-overflow` does nothing on a flex container), and a
 *     preview clipped mid-word with no `…` reads as a rendering bug.
 *   · The open list needs a row, and the stylesheet has no class for one.
 *     `.svd__row` is borrowed: it is `display:flex; align-items:center;
 *     gap: var(--sp-3)` and nothing about it is specific to the settings sheet.
 *     A dedicated rule would be better and is in the report.
 *
 * ── Who gets the ✕ ────────────────────────────────────────────────────────
 * `DELETE /messages/:id/pin` answers 403 to anyone who is neither `pinned_by`
 * nor a channel admin, so the control is asked PER PIN rather than once for the
 * whole bar. `canUnpin` is an addition to the §5.11 contract, which gives
 * `onUnpin` alone and hides the ✕ when it is undefined: with fifty pins from a
 * dozen people, one boolean for the whole list can only be wrong in one
 * direction or the other. It defaults to "yes", so a caller that has not heard
 * of it still gets exactly the documented behaviour.
 */
import React from 'react';
import { SvIcons } from './icons';

/** One line of strip. Long enough to recognise, short enough not to wrap. */
const PREVIEW = 80;

/**
 * Open, each row shares its line with an unpin button, so the preview is
 * shorter — `.sv__pins-nav` does not shrink and the list clips its overflow, so
 * a row that is too wide loses its tail with no ellipsis to explain it.
 */
const PREVIEW_OPEN = 56;

/**
 * The strip is one line, so a pinned code block or a three-paragraph notice has
 * to collapse to one. Newlines become spaces BEFORE the cut — otherwise the
 * ellipsis lands after the first line and the preview claims the message is
 * shorter than it is.
 */
function preview(text, max) {
  const flat = String(text || '').replace(/\s+/g, ' ').trim();
  if (!flat) return 'Message';
  return flat.length > max ? `${flat.slice(0, max).trimEnd()}…` : flat;
}

const senderOf = p => p.sender_name || 'Unknown';
const pinnedBy = p => (p.pinned_by_name ? ` · pinned by ${p.pinned_by_name}` : '');

export default function PinnedBar({
  pins = [],
  onJump,
  onUnpin,
  canUnpin = () => true,
  open = false,
  onToggle,
}) {
  // No empty strip. A channel with nothing pinned should look like a channel
  // with nothing pinned, not like a feature waiting to be used — the same
  // reading `.sv__banner` gets, which exists only while a channel is archived.
  if (!pins.length) return null;

  // `GET /pins` is `ORDER BY m.pinned_at DESC`, so the newest is first and the
  // collapsed strip is `pins[0]`. Do not re-sort: the server's order is the one
  // "1 of N" is counting against.
  const top = pins[0];

  return (
    <div className={`sv__pins${open ? ' is-open' : ''}`}>
      <span className="sv__pins-i" aria-hidden="true">{SvIcons.pin}</span>

      {open ? (
        <div className="sv__pins-t">
          {pins.map(p => (
            <div key={p.id} className="svd__row">
              {/* The pinner's name is in the accessible name and the tooltip
                  rather than in the visible text: the row is already spending
                  its width on who wrote it and what they said, and "pinned by"
                  is the thing you want when you are deciding whether to take it
                  down, which is exactly when you are on this row. */}
              <button
                type="button"
                className="sv__pins-nav"
                onClick={() => onJump?.(p)}
                title={`${senderOf(p)}${pinnedBy(p)}`}
                aria-label={`Go to the pinned message from ${senderOf(p)}${pinnedBy(p)}`}
              >
                {`${senderOf(p)}: ${preview(p.content, PREVIEW_OPEN)}`}
              </button>
              {onUnpin && canUnpin(p) && (
                <button
                  type="button"
                  className="sv__pins-x"
                  onClick={() => onUnpin(p)}
                  aria-label={`Unpin the message from ${senderOf(p)}`}
                >
                  {SvIcons.close}
                </button>
              )}
            </div>
          ))}
        </div>
      ) : (
        <span className="sv__pins-t" title={`${senderOf(top)}${pinnedBy(top)}`}>
          {`${senderOf(top)}: ${preview(top.content, PREVIEW)}`}
        </span>
      )}

      {!open && onUnpin && canUnpin(top) && (
        <button
          type="button"
          className="sv__pins-x"
          onClick={() => onUnpin(top)}
          aria-label={`Unpin the message from ${senderOf(top)}`}
        >
          {SvIcons.close}
        </button>
      )}

      {/* The count is the affordance when collapsed — "1 of 7" is what tells a
          reader there are six more. Numerals carry no language, so the visible
          label needs no Hindi partner; the sentence that would have needed one
          is the accessible name, and an aria-label is a string attribute that
          cannot carry `lang` or `--font-indic` — the same limit `MentionTextarea`
          records for placeholders. */}
      <button
        type="button"
        className="sv__pins-nav"
        onClick={onToggle}
        aria-expanded={open}
        aria-label={open
          ? 'Collapse the pinned messages'
          : `Show all ${pins.length} pinned ${pins.length === 1 ? 'message' : 'messages'}`}
      >
        {open ? 'Hide' : `1 of ${pins.length}`}
      </button>
    </div>
  );
}
