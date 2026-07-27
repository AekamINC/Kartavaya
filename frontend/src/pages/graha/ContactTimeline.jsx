// Graha · contact timeline — activities, follow-ups, invoices and deals, merged.
//
// 13 inline styles are now `gr__tl*` classes. The vertical rail was an
// absolutely-positioned empty `<div>`; it is a `::before` on the list now, so
// the decoration is not in the accessibility tree.
//
// The load was `.catch(() => {})` and the empty branch says "No activity yet."
// — a false statement about a customer relationship when the request actually
// failed. It has an error state with a retry now, and paging failures no longer
// silently stop the "Load more" button from doing anything.
import React, { useState, useEffect, useCallback } from 'react';
import { api, body } from '../../lib/api';
import { ErrorState, errorKind } from '../../components/ui/ErrorState';
import { Badge, stageColor, TL_ICONS, TL_SUB_ICONS, TL_COLORS } from './_shared';
import { inr } from '../../lib/inr';

export default function ContactTimeline({ contactId }) {
  const [items, setItems] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const [err, setErr] = useState(null);
  const [moreErr, setMoreErr] = useState(false);

  const load = useCallback((cur) => {
    const params = cur ? `?cursor=${encodeURIComponent(cur)}&limit=30` : '?limit=30';
    if (!cur) setErr(null);
    setMoreErr(false);
    api.get(`/v1/graha/contacts/${contactId}/timeline${params}`)
      .then(r => {
        const b = body(r);
        const page = Array.isArray(b.data) ? b.data : [];
        setItems(prev => (cur ? [...prev, ...page] : page));
        setCursor(b.next_cursor);
        setHasMore(!!b.next_cursor);
      })
      .catch(e => {
        // A first-page failure is the whole panel; a later page is not, so it
        // keeps what it has and offers the button again.
        if (cur) setMoreErr(true); else setErr(e);
      })
      .finally(() => setLoading(false));
  }, [contactId]);

  useEffect(() => { load(null); }, [load]);

  return (
    <div className="gr__stack">
      <h4 className="gr__eyebrow">Timeline</h4>

      {loading && items.length === 0 ? (
        <p className="gr__mute">Loading timeline…</p>
      ) : err ? (
        <ErrorState kind={errorKind(err)} onRetry={() => load(null)} />
      ) : items.length === 0 ? (
        <p className="gr__mute">No activity yet.</p>
      ) : (
        <div className="gr__tl">
          {items.map((it, i) => {
            const icon = (it.type === 'activity' && it.subtype)
              ? (TL_SUB_ICONS[it.subtype] || TL_ICONS.activity)
              : TL_ICONS[it.type];
            const color = TL_COLORS[it.type] || TL_COLORS._default;
            return (
              <div key={`${it.type}-${it.id}-${i}`} className="gr__tlrow">
                <span className="gr__tldot" style={{ '--c': color }} aria-hidden="true">{icon}</span>
                <div className="gr__tlt">
                  <span>{it.title}</span>
                  {it.amount != null && <span className="gr__tlamt">{inr(Number(it.amount))}</span>}
                  {it.stage && <Badge text={it.stage} color={stageColor(it.stage)} />}
                </div>
                <div className="gr__tlmeta">
                  <span className="gr__tlkind" style={{ '--c': color }}>{it.subtype || it.type}</span>
                  {' · '}
                  {it.ts ? new Date(it.ts).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''}
                </div>
              </div>
            );
          })}

          {moreErr && <p className="gr__mute">Could not load more. Try again.</p>}
          {hasMore && (
            <button type="button" className="gr__more" onClick={() => load(cursor)}>Load more…</button>
          )}
        </div>
      )}
    </div>
  );
}
