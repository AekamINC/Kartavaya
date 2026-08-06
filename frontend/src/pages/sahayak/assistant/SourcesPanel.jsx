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
 *  emptiness check comes first. */
function isNum(cell) {
  const s = String(cell ?? '').trim();
  return s !== '' && Number.isFinite(Number(s));
}

function Card({ s, hot, refEl }) {
  const inner = (
    <>
      <span className="sh-src__t">
        {s.title}
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

export default function SourcesPanel({ sources, hot, evidence }) {
  const list = Array.isArray(sources) ? sources : [];
  const hotRef = React.useRef(null);

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
      <div className="sh__side-hd">{FILE_ICON} {evidence ? 'The rows behind it' : 'Sources'}</div>
      <div className="sh__side-b">
        <Evidence ev={evidence} />
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
