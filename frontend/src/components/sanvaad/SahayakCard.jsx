/**
 * SahayakCard — an answer, in the conversation. `.sh-card` + `.sh-pts`.
 *
 * `28-messaging-v2.md` §7 gives Sahayak three entry points inside Messaging and
 * this is the block all three of them render: the catch-up card at the unread
 * divider (`.sh-card--inline`), and the answers inside the side panel. It is
 * transcribed from `Msg2Chat.jsx:166-193` (`M2Catchup`) and `Msg2Aside.jsx:48-72`
 * — one component, because in the prototype those two are the same markup with
 * one class of difference, and building them twice is how they drift.
 *
 * ── A CITE IS A CONTROL, AND THAT IS THE WHOLE POINT ────────────────────────
 *
 * `sahayak.css` opens with it: "an answer that cannot point at where it came
 * from is not shown. Every claim carries a <cite>, and the cite is a control —
 * it opens the record. That is what separates this from a chatbot."
 *
 * So every `<cite>` here is a `<button>` wearing the `cite` element, not a
 * decorated span: `.sh-pts__src cite` states `cursor: pointer` and a hover
 * repaint, and a thing that looks clickable and is not is the same defect as a
 * dead link one step earlier. It carries the cited message's id and the click
 * takes the reader to that message in the log — a decision quoted at them is
 * one press away from the sentence somebody actually typed.
 *
 * THIS COMPONENT FETCHES NOTHING AND VALIDATES NOTHING. The admission test — a
 * point whose citations do not resolve is deleted rather than displayed — runs
 * on the server, in `routers/sanvaad_sahayak._points_from_model`, because a
 * check the client performs is a check an answer can be rendered without. What
 * arrives here is already only what could be cited.
 *
 * ── WHY IT IS NOT `RecordCard`, `Card` OR ANY EXISTING BLOCK ────────────────
 *
 * Deliberately new. `.sh-card` is a bordered block with a TONAL HEADER
 * (`--primary-container`) and a numbered, counter-driven point list; the
 * product's `.card` is a flat panel and `.m2rec` is an object reference with a
 * status strip. Substituting either would lose the header tone that marks this
 * block as the assistant speaking rather than a colleague, which on a surface
 * where every other block is somebody's message is the only cue there is.
 */
import React from 'react';
import { SvIcons } from '../../pages/sanvaad/icons';

/**
 * One point and the records behind it.
 *
 * `.sh-pts` is an `<ol>` with `counter-reset: sh` and `li::before` drawing the
 * number, so the ORDER is carried by the list element and the marker is drawn
 * by CSS — a `<div>` here would take the number away from assistive technology
 * as well as from the counter.
 */
function Point({ point, onCite }) {
  const cites = Array.isArray(point.cites) ? point.cites : [];
  return (
    <li>
      <span className="sh-pts__t">{point.text}</span>
      {cites.length > 0 && (
        <span className="sh-pts__src">
          {cites.map((c, i) => (
            <cite
              key={c.message_id || i}
              /* `<cite>` is not focusable and takes no keyboard event of its
                 own, so the role and the handler are stated rather than
                 assumed. 23-accessibility.md: a control reachable only by
                 pointer is not a control. `onKeyDown` covers Enter and Space
                 because a `role="button"` on a non-button element gets neither
                 for free. */
              role={onCite ? 'button' : undefined}
              tabIndex={onCite ? 0 : undefined}
              title={c.at ? `${c.author || 'Someone'} · ${c.at}` : undefined}
              onClick={onCite ? () => onCite(c) : undefined}
              onKeyDown={onCite ? (e) => {
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onCite(c); }
              } : undefined}
            >
              {c.label || c.author || 'Source'}
            </cite>
          ))}
        </span>
      )}
    </li>
  );
}

export default function SahayakCard({
  title,
  /** `.sh-card--inline` — the log's own card, with the entrance animation and
   *  the log's margins. The panel's cards take neither. */
  inline = false,
  points = [],
  /** How many claims the server deleted because their citations resolved to
   *  nothing. Shown, not swallowed: a card that quietly renders two of the four
   *  things the model said lies by omission about how much it read. */
  dropped = 0,
  /** `.sh-card__foot` — what it read and what it cost. */
  foot,
  actions = [],
  onCite,
  onClose,
}) {
  const list = Array.isArray(points) ? points : [];
  return (
    <div className={`sh-card${inline ? ' sh-card--inline' : ''}`}>
      <div className="sh-card__hd">
        <span className="sh-card__ic" aria-hidden="true">{SvIcons.spark}</span>
        <b>{title}</b>
        {onClose && (
          <>
            {/* The prototype's own spacer (`Msg2Chat.jsx:173`). A flex child
                rather than `margin-left: auto` on the button, because `.svbtn`
                is shared and baking the margin into the class put the chat
                header's back arrow at the wrong end of the header once
                already — sanvaad.css says so at `.cmp__reply > .svbtn`. */}
            <span style={{ flex: 1 }} />
            <button
              type="button"
              className="svbtn"
              onClick={onClose}
              aria-label="Dismiss this summary"
            >
              {SvIcons.close}
            </button>
          </>
        )}
      </div>

      {list.length > 0 && (
        <ol className="sh-pts">
          {list.map((p, i) => <Point key={i} point={p} onCite={onCite} />)}
        </ol>
      )}

      {actions.length > 0 && (
        <div className="sh-card__act">
          {actions.map(a => (
            <button key={a.id} type="button" className="btn btn--out btn--sm" onClick={a.onSelect}>
              {a.label}
            </button>
          ))}
        </div>
      )}

      {(foot || dropped > 0) && (
        <div className="sh-card__foot">
          {foot && <span>{foot}</span>}
          {dropped > 0 && (
            <span>
              {dropped} {dropped === 1 ? 'point was' : 'points were'} dropped — nothing in
              this conversation backed {dropped === 1 ? 'it' : 'them'} up.
            </span>
          )}
        </div>
      )}
    </div>
  );
}
