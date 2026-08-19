/**
 * `.sh__side` — the records the answer was read out of.
 *
 * The prototype's panel is a PERMANENT column beside the thread, not something
 * behind a button: `.sh` is `minmax(0, 1fr) 320px` and only goes single-column
 * as `.sh--wide`, which is the answer-first layout. So there is no close control
 * here — the panel does not close, it is absent when there is nothing to put in
 * it. Clicking an inline `[1]` does not open it; it highlights the card it names.
 *
 * A web source is a link and a knowledge-base chunk is not. The KB card names a
 * document this org already owns and there is nowhere on the web to send anyone,
 * so the two render as different ELEMENTS rather than as one element with a
 * disabled state: `<a>` for the page, a plain block for the chunk. A control that
 * looks clickable and does nothing is the same defect as a dead link, one step
 * earlier.
 *
 * `rel="noopener noreferrer"` on every outbound link. These URLs come from a
 * grounding provider by way of the model; they are the least trusted strings on
 * this screen, and `window.opener` is not something to hand them.
 *
 * Nor is the SCHEME theirs to choose: `s.url` is whatever `sources.safeUrl`
 * accepted, which is an absolute http(s) URL or nothing at all. A web source
 * whose URL was refused therefore falls through to the plain block below — the
 * same shape a KB chunk gets, and for the same reason, because there is nowhere
 * this panel is willing to send anyone.
 */
import React from 'react';
import { sourceFoot } from './sources';

/** The file glyph from `.sh__side-hd`, drawn to the same 16-unit geometry as
 *  `layout/navIcons.jsx`. The prototype uses an icon here; an emoji would render
 *  as a different picture on every platform. */
const FILE_ICON = (
  <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor"
    strokeWidth="1.4" aria-hidden="true">
    <path d="M9 1.5H4a1 1 0 00-1 1v11a1 1 0 001 1h8a1 1 0 001-1V5.5L9 1.5z" />
    <path d="M9 1.5v4h4" />
  </svg>
);

/**
 * `.sh-ev` — the rows the answer was computed from, not a retelling of them.
 *
 * The prototype draws this as a SECOND `.sh__side` panel ("The rows behind it")
 * alternating with the sources panel. The build has one side column, so the two
 * share it: the table goes above the cards, under the same header. Splitting the
 * column would halve both.
 *
 * `POST /v1/hub/chat` returns `evidence` as `{cols, rows, src, source_key,
 * truncated, total}` with every cell already a string — `sahayak_answer.
 * evidence_for` stringifies, so nothing here formats a number and nothing can
 * print one the server did not send.
 *
 * `.num` is assigned from the VALUE rather than from the column index the
 * prototype hard-codes. The prototype's `i === 2 || i === 3` is right for its
 * one fixed table; the real one is built from whichever handler answered, and
 * `_generic_columns` puts the columns in the handler's own key order.
 */
function Evidence({ ev }) {
  const cols = Array.isArray(ev?.cols) ? ev.cols : null;
  const rows = Array.isArray(ev?.rows) ? ev.rows : null;
  if (!cols?.length || !rows?.length) return null;

  return (
    <>
      <table className="sh-ev">
        <thead>
          <tr>{cols.map((c, i) => <th key={i} scope="col">{String(c)}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r, ri) => (
            <tr key={ri}>
              {(Array.isArray(r) ? r : []).slice(0, cols.length).map((c, ci) => (
                <td key={ci} className={isNum(c) ? 'num' : undefined}>{String(c ?? '')}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="sh__side-note" style={{ margin: '4px 0 0' }}>
        {ev.truncated && Number(ev.total) > rows.length
          ? `The first ${rows.length} of ${Number(ev.total)} rows the query returned.`
          : 'This is the query result, not a copy of it.'}
        {ev.src ? ` Read from ${String(ev.src)}.` : ''}
      </p>
    </>
  );
}

/** A cell that is a bare number, so it can be right-aligned onto the tabular
 *  figures. Blank, a date and an id are not — `'' * 1` is 0, which is why the
 *  emptiness check comes first.
 *
 *  Exported because `AnswerBody` draws `.sh-ev` too, for the markdown tables in
 *  a reply. One table style, one rule for which cell is a figure. */
export function isNum(cell) {
  const s = String(cell ?? '').trim();
  return s !== '' && Number.isFinite(Number(s));
}

function Card({ s, hot, refEl }) {
  const inner = (
    <>
      <span className="sh-src__t">
        {s.title}
        {/* The number the prose cites this card by. A web page carries one now
            wherever the server numbered it, and the marker in the answer is
            worth nothing if the card it names is labelled something else. Only
            a source nothing numbered says `web`. */}
        <span className="sh-src__n">{s.ref != null ? `[${s.ref}]` : 'web'}</span>
      </span>
      <span className="sh-src__k">{sourceFoot(s)}</span>
    </>
  );
  const cls = `sh-src${hot ? ' on' : ''}`;

  if (s.kind === 'web' && s.url) {
    return (
      <a className={cls} href={s.url} target="_blank" rel="noopener noreferrer" ref={refEl}>
        {inner}
      </a>
    );
  }
  return <div className={cls} ref={refEl}>{inner}</div>;
}

/**
 * The panel, in its two lives.
 *
 * ── Above 768px it is a COLUMN and nothing here closes it ───────────────────
 * The prototype's `.sh` is `minmax(0, 1fr) 320px`; the panel is absent when the
 * answer cited nothing (`.sh--wide`) rather than closed. `onClose` still exists
 * because of the second life below, and `.sh__side-x` is display:none at that
 * width — a control that cannot do anything must not be reachable by tab.
 *
 * ── At 767px and below it is a BOTTOM SHEET ─────────────────────────────────
 * It used to be `display: none`. Not "collapsed", not "behind a button" —
 * REMOVED, so on a phone every source and every evidence row this product went
 * to the trouble of returning was unreachable, and the one rule this surface is
 * built on ("an answer that cannot point at where it came from is not shown")
 * held on desktop only. It is now the same panel translated off the bottom edge
 * of `.sh` and slid up by `.sh--sheet`, with the rail's own scrim behind it and
 * a close control and a grab handle that only paint at that width.
 *
 * `evidenceOpen` is the split-evidence switch. The switch itself lives beside
 * the ANSWER (`.sh__acts` in AnswerBody), because that is the answer the rows
 * belong to; this component only obeys it. Closed, the source cards get the
 * whole column back — which is the point on a short one.
 */
export default function SourcesPanel({ sources, hot, evidence, evidenceOpen = true, onClose }) {
  const list = Array.isArray(sources) ? sources : [];
  const hotRef = React.useRef(null);
  const showEv = !!evidence && evidenceOpen;

  /* A cite eight sources down opens nothing the reader can see unless the panel
     moves to it. `scrollIntoView` is safe here in a way it is not in the thread:
     this column is its own scroll container and nothing above it scrolls. */
  React.useEffect(() => {
    const el = hotRef.current;
    if (el && typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ block: 'nearest' });
    }
  }, [hot, sources]);

  return (
    <aside className="sh__side" aria-label="Sources for this answer">
      {/* The sheet's grab handle. Decorative — the close control below is the
          one a keyboard and a screen reader use. Paints only at sheet width. */}
      <span className="sh__side-grip" aria-hidden="true" />
      <div className="sh__side-hd">
        {FILE_ICON} {showEv ? 'The rows behind it' : 'Sources'}
        {onClose && (
          <button
            type="button"
            className="sh__side-x"
            onClick={onClose}
            aria-label="Close sources"
          >
            &times;
          </button>
        )}
      </div>
      <div className="sh__side-b">
        {showEv ? <Evidence ev={evidence} /> : null}
        {list.map(s => (
          <Card
            key={s.key}
            s={s}
            hot={hot != null && s.ref === hot}
            refEl={hot != null && s.ref === hot ? hotRef : undefined}
          />
        ))}
      </div>
      <p className="sh__side-note">
        Only records your own role can open. A question whose answer sits behind a
        permission you do not hold returns the refusal, not the answer — the
        assistant is not a way around access.
      </p>
    </aside>
  );
}
