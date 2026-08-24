import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { EmptyState, ErrorState, errorKind } from '../../components/ui';
import { SkeletonList } from '../../components/ui/Skeleton';
import { inr } from '../../lib/inr';

// Bucket keys match `/v1/ganit/billing/ageing`'s response exactly
// (`{buckets, totals, by_client}`, keys "current"/"30"/"60"/"90"/"120"/"120+").
const BUCKETS = [
  { key: 'current', label: 'Current' },
  { key: '30', label: '1-30' },
  { key: '60', label: '31-60' },
  { key: '90', label: '61-90' },
  { key: '120', label: '91-120' },
  { key: '120+', label: '120+' },
];

function Section({ title, partyLabel, data }) {
  if (!data) return null;
  const { by_client: parties, totals } = data;
  const grandTotal = BUCKETS.reduce((s, b) => s + Number(totals[b.key] || 0), 0);

  return (
    <div style={{ marginBottom: 32 }}>
      <h3 className="k-section-label">{title}</h3>

      <table className="k-table" style={{ marginBottom: 16 }}>
        <thead>
          <tr>
            {BUCKETS.map(b => <th key={b.key}>{b.label}</th>)}
            <th>Total</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            {BUCKETS.map(b => <td key={b.key}>{inr(totals[b.key] || 0)}</td>)}
            <td><strong>{inr(grandTotal)}</strong></td>
          </tr>
        </tbody>
      </table>

      {parties.length === 0 ? (
        <div className="k-text-muted" style={{ padding: '8px 0' }}>No open balances.</div>
      ) : (
        <table className="k-table">
          <thead>
            <tr>
              <th>{partyLabel}</th>
              {BUCKETS.map(b => <th key={b.key}>{b.label}</th>)}
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            {parties
              .slice()
              .sort((a, b) => b.total_outstanding - a.total_outstanding)
              .map(p => (
                <tr key={p.party_id}>
                  <td>{p.party_name}</td>
                  {BUCKETS.map(b => <td key={b.key}>{inr(p[b.key] || 0)}</td>)}
                  <td>{inr(p.total_outstanding)}</td>
                </tr>
              ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export default function AgeingTab() {
  const [receivable, setReceivable] = useState(null);
  const [payable, setPayable] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);

  const load = useCallback(async () => {
    setErr(null);
    try {
      const [r, p] = await Promise.allSettled([
        api.get('/v1/ganit/billing/ageing?direction=receivable'),
        api.get('/v1/ganit/billing/ageing?direction=payable'),
      ]);
      if (r.status === 'rejected' && p.status === 'rejected') throw r.reason;
      setReceivable(r.status === 'fulfilled' ? r.value.data : null);
      setPayable(p.status === 'fulfilled' ? p.value.data : null);
    } catch (e) { setErr(e); }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) return <SkeletonList />;
  if (err) return <ErrorState kind={errorKind(err)} onRetry={load} />;

  const hasData = receivable || payable;

  return (
    <div className="k-tab-body">
      {hasData ? (
        <>
          <Section title="Receivables" partyLabel="Client" data={receivable} />
          <Section title="Payables" partyLabel="Vendor" data={payable} />
        </>
      ) : (
        <EmptyState
          illustration="invoice"
          title="No ageing data"
          description="Ageing reports appear once invoices or vendor bills are raised."
        />
      )}
    </div>
  );
}
