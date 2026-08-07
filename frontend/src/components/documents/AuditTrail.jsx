import React from 'react';
import { formatDate } from './fileMeta';

/**
 * AuditTrail — an ordered, timestamped record of what happened to a document.
 *
 * Rendered as a real `<ol>`. The previous version was a stack of divs, which
 * announces as unrelated text: an audit trail whose ORDER is not conveyed is
 * missing the one property that makes it an audit trail. Newest first, because
 * the question a person opens this list to answer is almost always "what
 * happened last".
 *
 * The actor line shows a NAME. It used to show `actor_email`, so the trail read
 * `priya@vendor.co.in` directly beneath a signer panel printing "Priya Nair"
 * for the same person — the owner's rule is that a person is identified by
 * their name, and an address is neither a name nor something to put on screen
 * by default. `GET …/documents/{id}` now resolves `actor_name` from the
 * document's own signer list (routers/esign.py).
 *
 * Where no name is on record the row says "system" rather than inventing one or
 * falling back to the address — an audit record that attributes an action to
 * the wrong party is worse than one that admits it does not know.
 */
export default function AuditTrail({ entries = [] }) {
  if (!entries.length) {
    return <p className="docaud__none">No activity recorded yet.</p>;
  }

  const ordered = [...entries].sort(
    (a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0),
  );

  return (
    <ol className="docaud">
      {ordered.map((a, i) => (
        <li className="docaud__r" key={a.id || `${a.created_at}-${a.action}-${i}`}>
          <span className="docaud__dot" aria-hidden="true" />
          <div className="docaud__body">
            <span className="docaud__act">
              {String(a.action || 'event').replace(/_/g, ' ')}
            </span>
            <span className="docaud__who">{a.actor_name || 'system'}</span>
          </div>
          <time className="docaud__at" dateTime={a.created_at || undefined}>
            {formatDate(a.created_at, { time: true })}
          </time>
        </li>
      ))}
    </ol>
  );
}
