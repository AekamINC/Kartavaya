// Procurement · the approval queue — everything waiting on YOU.
//
// Deliberately not "everything awaiting approval". A queue that shows orders
// somebody else has to decide is a queue people stop opening, and the server
// already answers the narrower question: it evaluates each order's snapshotted
// rule against the caller, the self-approval setting, whether they have already
// decided, and whose turn it is on a sequential rule.
//
// Beside the queue sit the three exception reports, because they are what a
// finance lead comes to this screen for on the days there is nothing to
// approve: who is late, what has arrived unbilled, and which supplier is about
// to cross the 194Q line.
import React, { useCallback, useEffect, useState } from 'react';
import { api, body, rows } from '../../lib/api';
import { useToast } from '../../components/ui/toast';
import { DataTable, Td, StatTile } from '../../components/editorial';
import { EmptyState } from '../../components/ui/EmptyState';
import ErrorState, { errorKind } from '../../components/ui/ErrorState';
import { SkeletonList, SkeletonRegion } from '../../components/ui/Skeleton';
import useModuleWrite from '../../hooks/useModuleWrite';
import { Secondary } from '../../components/Bilingual';
import { inr } from '../../lib/inr';
import PurchaseOrderDetail from './PurchaseOrderDetail';
import { apiErrorText } from '../../lib/apiError';

const QUEUE_COLUMNS = [
  'Order', 'Supplier', 'Rule',
  { label: 'Value', align: 'right' },
  { label: 'Approvals', align: 'right' },
  '',
];

const LATE_COLUMNS = [
  'Order', 'Supplier', 'Reach them', 'Expected',
  { label: 'Days late', align: 'right' },
  { label: 'Outstanding', align: 'right' },
];

const GRNI_COLUMNS = [
  'Order', 'Supplier', 'Ordered on',
  { label: 'Received, not billed', align: 'right' },
];

const TDS_COLUMNS = [
  'Supplier',
  { label: 'Billed this year', align: 'right' },
  { label: 'On order', align: 'right' },
  { label: 'Projected', align: 'right' },
  { label: 'Of ₹50 lakh', align: 'right' },
];

export default function POApprovalsTab() {
  const { canWrite, reason: denial } = useModuleWrite({ label: 'approve purchase orders' });
  const { pushToast } = useToast();
  const [queue, setQueue] = useState([]);
  const [late, setLate] = useState(null);
  const [grni, setGrni] = useState(null);
  const [tds, setTds] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [openId, setOpenId] = useState(null);

  const load = useCallback(async () => {
    setErr(null);
    setLoading(true);
    try {
      const r = await api.get('/v1/procurement/approvals');
      setQueue(rows(r));
    } catch (e) { setErr(e); setQueue([]); } finally { setLoading(false); }
  }, []);

  const loadReports = useCallback(async () => {
    // Settled, not all: a firm whose 194Q report fails must still see who is
    // late, and Promise.all would throw all three away.
    const [l, g, t] = await Promise.allSettled([
      api.get('/v1/procurement/reports/late-suppliers'),
      api.get('/v1/procurement/reports/received-not-invoiced'),
      api.get('/v1/procurement/reports/tds-194q'),
    ]);
    setLate(l.status === 'fulfilled' ? body(l.value) : null);
    setGrni(g.status === 'fulfilled' ? body(g.value) : null);
    setTds(t.status === 'fulfilled' ? body(t.value) : null);
  }, []);

  useEffect(() => { load(); loadReports(); }, [load, loadReports]);

  async function decide(id, verb) {
    setBusyId(id);
    try {
      const r = await api.post(`/v1/procurement/purchase-orders/${id}/${verb}`, {});
      pushToast({
        title: verb === 'approve' ? 'Approved' : 'Rejected',
        message: body(r).note || undefined,
        type: 'success',
      });
      await load();
      await loadReports();
    } catch (e) {
      pushToast({
        title: apiErrorText(e, 'That decision could not be recorded'),
        type: 'error',
      });
    } finally { setBusyId(null); }
  }

  return (
    <div>
      <div className="gn-stats" style={{ '--gn-min': '160px' }}>
        <StatTile label="Waiting on you" sanskrit="प्रतीक्षा" value={queue.length} />
        {late && (
          <StatTile
            label="Late suppliers" value={late.total ?? 0}
            variant={(late.total ?? 0) > 0 ? 'warn' : 'neutral'}
          />
        )}
        {grni && (
          <StatTile label="Received, not billed" value={inr(Number(grni.total || 0))} />
        )}
        {tds && (
          <StatTile
            label="Nearing 194Q" value={tds.total ?? 0}
            variant={(tds.total ?? 0) > 0 ? 'warn' : 'neutral'}
          />
        )}
      </div>

      <h3 className="gn-panel__h">
        Waiting on you<Secondary className="dr__lbl-hi" value="अनुमोदन" />
      </h3>
      {loading ? (
        <SkeletonRegion label="Loading the approval queue">
          <SkeletonList rows={4} showAvatar={false} />
        </SkeletonRegion>
      ) : err ? (
        <ErrorState kind={errorKind(err)} onRetry={load} />
      ) : queue.length === 0 ? (
        <EmptyState
          illustration="generic"
          title={{ en: 'Nothing is waiting on you', hi: 'कुछ लंबित नहीं' }}
          description="This queue shows only the purchase orders your organisation's own rules put in front of you. Orders below every threshold are issued without asking anyone."
        />
      ) : (
        <DataTable arrange="procurement.po_approvals_queue" columns={QUEUE_COLUMNS}>
          {queue.map(q => (
            <tr className="gn-tbl__row" key={q.id}>
              <Td bold>
                <button type="button" className="gn-link" onClick={() => setOpenId(q.id)}>
                  {q.po_number || 'Draft'}
                </button>
              </Td>
              <Td>{q.vendor_name}</Td>
              <Td>{q.rule || '—'}</Td>
              <Td align="right">{inr(Number(q.total || 0))}</Td>
              <Td align="right">{q.approvals_recorded} of {q.approvers_required}</Td>
              <Td>
                <span className="gn-row__acts">
                  <button
                    type="button" className="btn btn--fill btn--sm"
                    disabled={!canWrite || busyId === q.id} title={denial || undefined}
                    onClick={() => decide(q.id, 'approve')}
                  >
                    Approve
                  </button>
                  <button
                    type="button" className="btn btn--ghost btn--sm"
                    disabled={!canWrite || busyId === q.id}
                    onClick={() => decide(q.id, 'reject')}
                  >
                    Reject
                  </button>
                </span>
              </Td>
            </tr>
          ))}
        </DataTable>
      )}

      {/* ── Late suppliers ────────────────────────────────────── */}
      {late && (late.data || []).length > 0 && (
        <div className="gn-panel gn-panel--warn">
          <h3 className="gn-panel__h">
            Late suppliers<Secondary className="dr__lbl-hi" value="विलंबित" />
          </h3>
          <DataTable arrange="procurement.po_approvals_late" columns={LATE_COLUMNS}>
            {late.data.map(l => (
              <tr className="gn-tbl__row" key={l.po_number}>
                <Td bold>{l.po_number}</Td>
                <Td>{l.vendor_name}</Td>
                <Td>{l.vendor_phone || l.vendor_email || '—'}</Td>
                <Td>{l.expected_date}</Td>
                <Td align="right">{l.days_late}</Td>
                <Td align="right">{l.qty_outstanding}</Td>
              </tr>
            ))}
          </DataTable>
          <p className="gn-tot__note">
            An order with no expected date is not late — it is undated, which is
            a different thing.
          </p>
        </div>
      )}

      {/* ── Goods received, not invoiced ──────────────────────── */}
      {grni && (grni.data || []).length > 0 && (
        <div className="gn-panel">
          <h3 className="gn-panel__h">
            Received, not invoiced<Secondary className="dr__lbl-hi" value="प्रोद्भवन" />
          </h3>
          <DataTable arrange="procurement.po_approvals_grni" columns={GRNI_COLUMNS}>
            {grni.data.map(g => (
              <tr className="gn-tbl__row" key={g.po_number}>
                <Td bold>{g.po_number}</Td>
                <Td>{g.vendor_name}</Td>
                <Td>{g.po_date}</Td>
                <Td align="right">{inr(Number(g.accrual), { decimals: 2 })}</Td>
              </tr>
            ))}
          </DataTable>
          <p className="gn-tot__note">{grni.basis}</p>
        </div>
      )}

      {/* ── 194Q ──────────────────────────────────────────────── */}
      {tds && (tds.data || []).length > 0 && (
        <div className="gn-panel gn-panel--warn">
          <h3 className="gn-panel__h">
            Approaching Section 194Q<Secondary className="dr__lbl-hi" value="टीडीएस" />
          </h3>
          <DataTable arrange="procurement.po_approvals_tds" columns={TDS_COLUMNS}>
            {tds.data.map(t => (
              <tr className="gn-tbl__row" key={t.vendor}>
                <Td bold>{t.vendor}</Td>
                <Td align="right">{inr(t.purchased_ytd)}</Td>
                <Td align="right">{inr(t.on_order)}</Td>
                <Td align="right">{inr(t.projected)}</Td>
                <Td align="right">{t.pct_of_threshold}%</Td>
              </tr>
            ))}
          </DataTable>
          <p className="gn-tot__note">{tds.note}</p>
        </div>
      )}

      {openId && (
        <PurchaseOrderDetail
          poId={openId}
          onClose={() => setOpenId(null)}
          onChanged={() => { load(); loadReports(); }}
        />
      )}
    </div>
  );
}
