import React, { useState, useEffect, useCallback } from 'react';
import { ChevronRight } from 'lucide-react';
import { api } from '../../lib/api';
import { Chip, ChipRow, EmptyState, ErrorState, errorKind, SkeletonList } from '../../components/ui';
import { EsignStatusPill, formatDate, relSigned } from '../../components/documents';
import useModuleWrite from '../../hooks/useModuleWrite';

/**
 * The document list.
 *
 * Rows, not Cards. A `Card` with an `onClick` is a div that looks pressable and
 * is invisible to the keyboard — this was the previous implementation, so the
 * only way to open a document was with a mouse. `.docrow` is a real `<button>`.
 *
 * Two things the list has to say honestly:
 *  · **Expiry is a future date.** It was rendered with `relTime`, which appends
 *    "ago" unconditionally, so a document expiring in twelve days read
 *    "Expires 12d ago" — it looked long dead while it was still live. Absolute
 *    date plus a signed relative.
 *  · **A failed load is not an empty list.** The catch used to toast and leave
 *    `docs` at `[]`, so a 500 rendered "No documents yet" and invited the user
 *    to create a duplicate of something they already had.
 */
const FILTERS = ['', 'draft', 'sent', 'partially_signed', 'completed', 'cancelled'];

const label = s => (s ? String(s).replace(/_/g, ' ') : '—');

export default function DocumentsTab({ onOpen, onCreate }) {
  // F32 — the module is read from the route, never named here.
  const { canWrite, reason: denial } = useModuleWrite({ label: 'create documents' });
  const [docs, setDocs] = useState([]);
  const [filter, setFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const url = filter ? `/v1/esign/documents?status=${encodeURIComponent(filter)}` : '/v1/esign/documents';
      const r = await api.get(url);
      setDocs(r.data.data || []);
    } catch (e) {
      setErr(e);
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => { load(); }, [load]);

  return (
    <div>
      <div className="docfilt">
        <ChipRow>
          {FILTERS.map(f => (
            <Chip key={f || 'all'} on={filter === f} onClick={() => setFilter(f)}>
              {f ? label(f) : 'All'}
            </Chip>
          ))}
        </ChipRow>
      </div>

      {loading && <SkeletonList rows={4} showAvatar={false} />}

      {!loading && err && (
        <ErrorState kind={errorKind(err)} onRetry={load} />
      )}

      {!loading && !err && docs.length === 0 && (
        <EmptyState
          illustration="invoice"
          title={filter ? `No ${label(filter)} documents` : 'No documents yet'}
          /* The CTA is two different actions behind one prop. `Clear filter`
             is a READ and stays available to everyone — only the create
             branch is a write, so only that branch is gated. */
          description={filter
            ? 'Nothing in this state right now. Clear the filter to see everything.'
            : canWrite
              ? 'Create a document, add signers, and send it for signature.'
              : `A document is prepared here, signed by the people you name, and kept with its audit trail. ${denial}`}
          action={filter ? 'Clear filter' : (canWrite ? 'New document' : undefined)}
          onAction={filter ? () => setFilter('') : (canWrite ? onCreate : undefined)}
        />
      )}

      {!loading && !err && docs.length > 0 && (
        <div className="doclist">
          {docs.map(d => {
            const total = Number(d.signers_total) || 0;
            const done = Number(d.signers_completed) || 0;
            const pct = total ? Math.round((done / total) * 100) : 0;
            return (
              <button type="button" className="docrow" key={d.id} onClick={() => onOpen(d.id)}>
                <span className="docrow__main">
                  <span className="docrow__top">
                    <span className="docrow__t">{d.title}</span>
                    <EsignStatusPill status={d.status} />
                  </span>
                  {d.description && <span className="docrow__d">{d.description}</span>}
                  <span className="docrow__meta">
                    <span>Signed <b>{done}/{total}</b></span>
                    <span>Created {formatDate(d.created_at)}</span>
                    {d.expires_at && (
                      <span>
                        Expires {formatDate(d.expires_at)} <b>({relSigned(d.expires_at)})</b>
                      </span>
                    )}
                  </span>
                </span>

                {total > 0 && (
                  <span className="docrow__prg">
                    <span
                      className="prg"
                      role="progressbar"
                      aria-label={`${done} of ${total} signed`}
                      aria-valuenow={done}
                      aria-valuemin={0}
                      aria-valuemax={total}
                    >
                      <span className="prg__f" style={{ width: `${pct}%` }} />
                    </span>
                  </span>
                )}

                <ChevronRight size={16} className="docrow__ch" aria-hidden="true" />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
