// Ganit · e-sign — send a contract for signature and follow what happened.
//
// ── The audit trail that was always empty ─────────────────────────────────
// This tab read the trail as `auditRes.data.data || auditRes.data.events || []`.
// `GET /contracts/{id}/audit-trail` returns neither key — it answers
// `{"audit_trail": [...]}` (routers/ganit.py:1391). Both fallbacks missed, the
// `|| []` caught it, and the panel rendered "no audit trail" for every contract
// that had one. That is signing EVIDENCE — who opened the document, from which
// IP, and when — and it was invisible for as long as the key was wrong.
import React, { useCallback, useEffect, useState } from 'react';
import { api, rows, body } from '../../lib/api';
import { EmptyState } from '../../components/ui/EmptyState';
import ErrorState, { errorKind } from '../../components/ui/ErrorState';
import { SkeletonList, SkeletonRegion } from '../../components/ui/Skeleton';
import { Badge, CONTRACT_COLORS } from './_shared';
import { inr } from '../../lib/inr';
import SignatureDetail from './SignatureDetail';

export default function ESignTab() {
  const [contracts, setContracts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [selected, setSelected] = useState(null);

  const load = useCallback(async () => {
    setErr(null);
    setLoading(true);
    try {
      const r = await api.get('/v1/ganit/contracts');
      setContracts(rows(r));
    } catch (e) {
      setErr(e);
      setContracts([]);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div>
      {loading ? (
        <SkeletonRegion label="Loading contracts"><SkeletonList rows={5} showAvatar={false} /></SkeletonRegion>
      ) : err ? (
        <ErrorState kind={errorKind(err)} onRetry={load} />
      ) : contracts.length === 0 ? (
        <EmptyState
          illustration="generic"
          title={{ en: 'No contracts to sign', hi: 'कोई अनुबंध नहीं' }}
          description="Create a contract first. Once it exists you can send it to one or more signers, and every view and signature is recorded against it."
        />
      ) : (
        <div className="gn-list">
          {contracts.map(c => (
            <button type="button" key={c.id} className="gn-row" onClick={() => setSelected(c)}>
              <span className="gn-row__head">
                <span className="gn-row__t">{c.title}</span>
                <span className="gn-row__r">
                  <span className="gn-row__v">{inr(Number(c.contract_value || 0))}</span>
                  <Badge text={c.status} color={CONTRACT_COLORS[c.status] || 'var(--on-surface-3)'} />
                </span>
              </span>
              <span className="gn-row__meta">
                <span>
                  {c.contact_name && `${c.contact_name} · `}
                  {c.start_date && `${c.start_date} → ${c.end_date || '…'}`}
                </span>
              </span>
            </button>
          ))}
        </div>
      )}

      {selected && (
        <SignatureDetail
          contract={selected}
          onClose={() => setSelected(null)}
          onChanged={load}
        />
      )}
    </div>
  );
}

/** Fetch the signature state and the audit trail for one contract. */
export async function loadSignatureState(contractId) {
  const [statusRes, auditRes] = await Promise.allSettled([
    api.get(`/v1/ganit/contracts/${contractId}/signature-status`),
    api.get(`/v1/ganit/contracts/${contractId}/audit-trail`),
  ]);
  return {
    status: statusRes.status === 'fulfilled' ? body(statusRes.value) : null,
    statusFailed: statusRes.status === 'rejected',
    // `audit_trail` is the key the endpoint actually returns.
    trail: auditRes.status === 'fulfilled' ? (body(auditRes.value).audit_trail || []) : [],
    trailFailed: auditRes.status === 'rejected',
  };
}
