import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { DataTable, Td } from '../../components/editorial';
import { EmptyState } from '../../components/ui/EmptyState';
import ErrorState, { errorKind } from '../../components/ui/ErrorState';
import { SkeletonList } from '../../components/ui/Skeleton';
import { Secondary } from '../../components/Bilingual';
import { inr } from '../../lib/inr';

const BUCKETS = [
  { key: 'current', label: 'Current' },
  { key: '30', label: '1-30' },
  { key: '60', label: '31-60' },
  { key: '90', label: '61-90' },
  { key: '120', label: '91-120' },
  { key: '120+', label: '120+' },
];

const TOTAL_COLUMNS = [
  ...BUCKETS.map(b => ({ label: b.label, align: 'right' })),
  { label: 'Total', align: 'right' },
];

function Section({ title, hi, partyLabel, data }) {
  if (!data) return null;
  const { by_client: parties, totals } = data;
  const grandTotal = BUCKETS.reduce((s, b) => s + Number(totals[b.key] || 0), 0);

  const partyColumns = [
    partyLabel,
    ...BUCKETS.map(b => ({ label: b.label, align: 'right' })),
    { label: 'Total', align: 'right' },
  ];

  return (
    <div style={{ marginBottom: 'var(--sp-7)' }}>
      <h3 className="gn-section-head">{title} <span aria-hidden="true" lang="hi" style={{ fontFamily: 'var(--font-indic)', fontWeight: 400, letterSpacing: 0, textTransform: 'none' }}>{' · '}{hi}</span></h3>

      <DataTable columns={TOTAL_COLUMNS} label={`${title} totals`}>
        <tr>
          {BUCKETS.map(b => <Td key={b.key} align="right" mono>{inr(totals[b.key] || 0)}</Td>)}
          <Td align="right" mono bold>{inr(grandTotal)}</Td>
        </tr>
      </DataTable>

      {parties.length === 0 ? (
        <p className="gn-note" style={{ marginTop: 'var(--sp-2)' }}>No open balances.</p>
      ) : (
        <DataTable columns={partyColumns} label={`${title} by party`}>
          {parties
            .slice()
            .sort((a, b) => b.total_outstanding - a.total_outstanding)
            .map(p => (
              <tr key={p.party_id}>
                <Td bold>{p.party_name}</Td>
                {BUCKETS.map(b => <Td key={b.key} align="right" mono>{inr(p[b.key] || 0)}</Td>)}
                <Td align="right" mono>{inr(p.total_outstanding)}</Td>
              </tr>
            ))}
        </DataTable>
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
    <div>
      {hasData ? (
        <>
          <Section title="Receivables" hi="प्राप्य" partyLabel="Client" data={receivable} />
          <Section title="Payables" hi="देय" partyLabel="Vendor" data={payable} />
        </>
      ) : (
        <EmptyState
          icon="ganit"
          title="No ageing data"
          description="Ageing reports appear once invoices or vendor bills are raised."
        />
      )}
    </div>
  );
}
