// Kray · reports — the four procurement exception reports.
//
// Each report is a collapsible section. The data comes from endpoints that
// already exist in procurement.py: committed-spend, received-not-invoiced,
// late-suppliers, tds-194q.
import React, { useCallback, useEffect, useState } from 'react';
import { api, body } from '../../lib/api';
import { DataTable, Td, StatTile } from '../../components/editorial';
import ErrorState, { errorKind } from '../../components/ui/ErrorState';
import { SkeletonList, SkeletonRegion } from '../../components/ui/Skeleton';
import { Secondary } from '../../components/Bilingual';
import { inr } from '../../lib/inr';

function Section({ title, hi, children, loading, err, retry }) {
  const [open, setOpen] = useState(true);
  return (
    <details open={open} onToggle={e => setOpen(e.currentTarget.open)} style={{ marginBottom: '1.5rem' }}>
      <summary className="gn-section-head" style={{ cursor: 'pointer', userSelect: 'none' }}>
        <Secondary en={title} hi={hi} />
      </summary>
      <div style={{ paddingTop: '.75rem' }}>
        {err ? <ErrorState kind={errorKind(err)} onRetry={retry} /> :
         loading ? <SkeletonList rows={3} /> : children}
      </div>
    </details>
  );
}

export default function KrayReportsTab() {
  const [spend, setSpend] = useState(null);
  const [grni, setGrni] = useState(null);
  const [late, setLate] = useState(null);
  const [tds, setTds] = useState(null);
  const [errs, setErrs] = useState({});
  const [loading, setLoading] = useState({
    spend: true, grni: true, late: true, tds: true,
  });

  const load = useCallback(async () => {
    setErrs({});
    setLoading({ spend: true, grni: true, late: true, tds: true });

    const jobs = [
      ['spend', '/v1/procurement/reports/committed-spend', setSpend],
      ['grni', '/v1/procurement/reports/received-not-invoiced', setGrni],
      ['late', '/v1/procurement/reports/late-suppliers', setLate],
      ['tds', '/v1/procurement/reports/tds-194q', setTds],
    ];

    await Promise.allSettled(jobs.map(async ([key, url, setter]) => {
      try {
        const r = await api.get(url);
        setter(body(r));
      } catch (e) {
        setErrs(prev => ({ ...prev, [key]: e }));
        setter(null);
      } finally {
        setLoading(prev => ({ ...prev, [key]: false }));
      }
    }));
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div>
      {/* ── Committed spend ─────────────────────────────────────────── */}
      <Section title="Committed spend" hi="प्रतिबद्ध व्यय" loading={loading.spend} err={errs.spend} retry={load}>
        {spend && (
          <>
            <div className="mk" style={{ marginBottom: '.75rem' }}>
              <StatTile label="Total committed" hi="कुल प्रतिबद्ध" value={inr(spend.total || 0)} />
              <StatTile label="Open orders" hi="खुले आदेश" value={spend.orders || 0} />
            </div>
            {spend.note && <p className="gn-note">{spend.note}</p>}
            {(spend.data || []).length > 0 && (
              <DataTable columns={['Department', { label: 'Orders', align: 'right' }, { label: 'Committed', align: 'right' }]} label="Committed by department">
                {spend.data.map(r => (
                  <tr key={r.department}>
                    <Td bold>{r.department}</Td>
                    <Td align="right" mono>{r.orders}</Td>
                    <Td align="right" mono>{inr(r.committed)}</Td>
                  </tr>
                ))}
              </DataTable>
            )}
          </>
        )}
      </Section>

      {/* ── Received not invoiced (GRNI) ────────────────────────────── */}
      <Section title="Received, not invoiced" hi="प्राप्त, बिल नहीं" loading={loading.grni} err={errs.grni} retry={load}>
        {grni && (
          <>
            <div className="mk" style={{ marginBottom: '.75rem' }}>
              <StatTile label="Accrual total" hi="उपार्जन" value={inr(grni.total || 0)} tone="warn" />
            </div>
            {grni.basis && <p className="gn-note">{grni.basis}</p>}
            {(grni.data || []).length > 0 ? (
              <DataTable columns={['Order', 'Supplier', 'Ordered on', { label: 'Accrual', align: 'right' }]} label="GRNI">
                {grni.data.map(r => (
                  <tr key={r.po_number}>
                    <Td mono>{r.po_number}</Td>
                    <Td>{r.vendor_name}</Td>
                    <Td>{r.po_date}</Td>
                    <Td align="right" mono>{inr(r.accrual)}</Td>
                  </tr>
                ))}
              </DataTable>
            ) : <p className="gn-note">No goods received without a matching bill.</p>}
          </>
        )}
      </Section>

      {/* ── Late suppliers ──────────────────────────────────────────── */}
      <Section title="Late suppliers" hi="विलंबित आपूर्तिकर्ता" loading={loading.late} err={errs.late} retry={load}>
        {late && (
          <>
            {(late.data || []).length > 0 ? (
              <DataTable columns={['Order', 'Supplier', 'Expected', { label: 'Days late', align: 'right' }, 'Contact']} label="Late suppliers">
                {late.data.map(r => (
                  <tr key={r.po_number}>
                    <Td mono>{r.po_number}</Td>
                    <Td bold>{r.vendor_name}</Td>
                    <Td>{r.expected_date}</Td>
                    <Td align="right" mono style={{ color: 'var(--danger)' }}>{r.days_late}</Td>
                    <Td>{r.vendor_phone || r.vendor_email || '—'}</Td>
                  </tr>
                ))}
              </DataTable>
            ) : <p className="gn-note">No suppliers are late on open orders.</p>}
          </>
        )}
      </Section>

      {/* ── TDS 194Q early warning ──────────────────────────────────── */}
      <Section title="TDS 194Q warning" hi="टीडीएस 194Q चेतावनी" loading={loading.tds} err={errs.tds} retry={load}>
        {tds && (
          <>
            {tds.note && <p className="gn-note" style={{ marginBottom: '.75rem' }}>{tds.note}</p>}
            {(tds.data || []).length > 0 ? (
              <DataTable columns={['Vendor', { label: 'Purchased YTD', align: 'right' }, { label: 'On order', align: 'right' }, { label: 'Projected', align: 'right' }, 'Status']} label="TDS 194Q">
                {tds.data.map(r => (
                  <tr key={r.vendor}>
                    <Td bold>{r.vendor}</Td>
                    <Td align="right" mono>{inr(r.purchased_ytd)}</Td>
                    <Td align="right" mono>{inr(r.on_order)}</Td>
                    <Td align="right" mono>{inr(r.projected)}</Td>
                    <Td>
                      <span className="gn-tag" style={{
                        color: r.breached ? 'var(--danger)' : 'var(--warn)',
                        borderColor: r.breached ? 'var(--danger)' : 'var(--warn)',
                      }}>
                        {r.breached ? 'Threshold crossed' : 'Approaching'}
                      </span>
                    </Td>
                  </tr>
                ))}
              </DataTable>
            ) : <p className="gn-note">No vendors near the ₹50L threshold this financial year.</p>}
          </>
        )}
      </Section>
    </div>
  );
}
