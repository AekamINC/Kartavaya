/**
 * The sources panel — collapsed behind one button, opened as a split column.
 *
 * `19-sahayak-final.html`: "Sources stay collapsed behind one button and open
 * the split panel; clicking an inline [1] opens it with that card highlighted."
 * Both entry points land here, and `hot` is which of them was used.
 *
 * A web source is a link and a knowledge-base chunk is not — the KB card names
 * a document this org already owns and there is nowhere on the web to send
 * anyone. So the two render as different elements rather than as one element
 * with a disabled state: `<a>` for the page, a plain block for the chunk. A
 * button that looks clickable and does nothing is the same defect as a dead
 * link, one step earlier.
 *
 * `rel="noopener noreferrer"` on every outbound link. These URLs come from a
 * grounding provider by way of the model; they are the least trusted strings on
 * this screen, and `window.opener` is not something to hand them.
 */
import React from 'react';
import { sourceFoot } from './sources';

function Card({ s, hot }) {
  const inner = (
    <>
      <span className="sh-sc__n">
        <span className={`sh-sc__i${s.kind === 'web' ? ' sh-sc__i--web' : ''}`} aria-hidden="true">
          {s.kind === 'web' ? '↗' : s.ref}
        </span>
        <span className="sh-sc__t" title={s.title}>{s.title}</span>
      </span>
      <span className="sh-sc__f">{sourceFoot(s)}</span>
    </>
  );

  const cls = `sh-sc${hot ? ' on' : ''}`;

  if (s.kind === 'web' && s.url) {
    return (
      <a className={`${cls} sh-sc--link`} href={s.url} target="_blank" rel="noopener noreferrer">
        {inner}
      </a>
    );
  }
  return <div className={cls}>{inner}</div>;
}

export default function SourcesPanel({ sources, hot, onClose }) {
  const list = Array.isArray(sources) ? sources : [];

  return (
    <aside className="sh__src" aria-label="Sources for this answer">
      <div className="sh__src-h">
        <span className="sh__src-t">Sources · {list.length}</span>
        <button type="button" className="sh__src-x" onClick={onClose} aria-label="Close sources">
          &times;
        </button>
      </div>

      {list.length === 0 ? (
        /* Reached by opening the panel on an answer that carried nothing —
           every message this product sent before grounding was threaded
           through. It says which of the two it is rather than showing an empty
           column, because "no sources" and "sources did not load" look
           identical from here otherwise. */
        <p className="sh__src-note">
          This answer did not cite anything. Older conversations were answered
          before Sahayak began recording where its facts came from.
        </p>
      ) : (
        list.map(s => <Card key={s.key} s={s} hot={hot != null && s.ref === hot} />)
      )}

      {list.some(s => s.ref != null) && (
        <p className="sh__src-note">
          Clicking a number in the answer highlights the source it came from.
        </p>
      )}
    </aside>
  );
}
