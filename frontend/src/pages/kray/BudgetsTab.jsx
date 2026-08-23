// Kray · budgets — department budgets against committed spend.
//
// Reads from /v1/procurement/reports/budget, which returns the budget state
// per department with limits from settings. Budget configuration itself lives
// in Settings (POSettingsPanel).
import React, { useCallback, useEffect, useState } from 'react';
import { api, body } from '../../lib/api';
import { DataTable, Td, StatTile } from '../../components/editorial';
import { EmptyState } from '../../components/ui/EmptyState';
import ErrorState, { errorKind } from '../../components/ui/ErrorState';
import { SkeletonList, SkeletonRegion } from '../../components/ui/Skeleton';
import { Secondary } from '../../components/Bilingual';
import { inr } from '../../lib/inr';

const COLUMNS = [
  'Department',
  { label: 'Budget', align: 'right' },
  { label: 'Committed', align: 'right' },
  { label: 'Remaining', align: 'right' },
  'Status',
];

function statusBadge(item) {
  if (!item.limit) return <span style={{ color: 'var(--on-surface-3)' }}>No limit</span>;
  const pct = item.limit > 0 ? (item.committed / item.limit) * 100 : 0;
  if (pct >= 100) return <span className="gn-tag" style={{ color: 'var(--danger)', borderColor: 'var(--danger)' }}>Over budget</span>;
  if (pct >= 80) return <span className="gn-tag" style={{ color: 'var(--warn)', borderColor: 'var(--warn)' }}>Near limit</span>;
  return <span className="gn-tag" style={{ color: 'var(--ok)', borderColor: 'var(--ok)' }}>On track</span>;
}

export default function BudgetsTab() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);

  const load = useCallback(async () => {
    setErr(null);
    setLoading(true);
    try {
      const r = await api.get('/v1/procurement/reports/budget');
      setData(body(r));
    } catch (e) { setErr(e); setData(null); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (err) return <ErrorState kind={errorKind(err)} retry={load} />;
  if (loading) return <SkeletonRegion><SkeletonList rows={4} /></SkeletonRegion>;

  const items = data?.data || [];
  const enabled = data?.enabled;

  if (!enabled) {
    return (
      <EmptyState
        icon="kray"
        heading="Budgets are off"
        body="Turn on department budgets in Settings to track spending against limits."
      />
    );
  }

  if (items.length === 0) {
    return (
      <EmptyState
        icon="kray"
        heading="No budget data"
        body="Set department budget limits in Settings, then raise purchase orders to see spend tracking."
      />
    );
  }

  const totalBudget = items.reduce((s, i) => s + (i.limit || 0), 0);
  const totalCommitted = items.reduce((s, i) => s + (i.committed || 0), 0);
  const overCount = items.filter(i => i.limit && i.committed > i.limit).length;

  return (
    <div>
      <div className="mk" style={{ marginBottom: '1rem' }}>
        <StatTile label="Total budget" hi="कुल बजट" value={inr(totalBudget)} />
        <StatTile label="Committed" hi="प्रतिबद्ध" value={inr(totalCommitted)} />
        <StatTile
          label="Over budget" hi="सीमा से अधिक"
          value={overCount}
          tone={overCount > 0 ? 'danger' : undefined}
        />
      </div>

      {data?.caveat && (
        <p className="gn-note" style={{ marginBottom: '1rem' }}>{data.caveat}</p>
      )}

      <DataTable columns={COLUMNS} label="Department budgets">
        {items.map(item => (
          <tr key={item.department}>
            <Td bold>{item.department}</Td>
            <Td align="right" mono>{item.limit ? inr(item.limit) : '—'}</Td>
            <Td align="right" mono>{inr(item.committed)}</Td>
            <Td align="right" mono>{item.limit ? inr(Math.max(0, item.limit - item.committed)) : '—'}</Td>
            <Td>{statusBadge(item)}</Td>
          </tr>
        ))}
      </DataTable>
    </div>
  );
}
