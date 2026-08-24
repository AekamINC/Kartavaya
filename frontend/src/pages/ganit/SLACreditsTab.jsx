import React, { useCallback, useEffect, useState } from 'react';
import { api, rows as asRows } from '../../lib/api';
import { EmptyState, ErrorState, errorKind } from '../../components/ui';
import { SkeletonList } from '../../components/ui/Skeleton';
import { inr } from '../../lib/inr';
import useModuleWrite from '../../hooks/useModuleWrite';
import ConfirmDialog from '../../components/ui/ConfirmDialog';
import DateInput from '../../components/ui/DateInput';

const BLANK = {
  vendor_id: '', sla_metric: '', threshold: '', actual: '',
  credit_amount: '', period: '', rate_card_id: '',
};

const STATUS_CLASS = { pending: 'k-badge', applied: 'k-badge k-badge-green', waived: 'k-badge k-badge-muted' };

export default function SLACreditsTab() {
  const { canWrite } = useModuleWrite({ label: 'manage SLA credits' });
  const [items, setItems] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [rateCards, setRateCards] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState(null);

  const load = useCallback(async () => {
    setErr(null);
    try {
      const [sc, v, rc] = await Promise.allSettled([
        api.get('/v1/ganit/billing/sla-credits'),
        api.get('/v1/ganit/vendors'),
        api.get('/v1/ganit/billing/rate-cards'),
      ]);
      if (sc.status === 'rejected') throw sc.reason;
      setItems(asRows(sc.value));
      setVendors(v.status === 'fulfilled' ? asRows(v.value) : []);
      setRateCards(rc.status === 'fulfilled' ? asRows(rc.value) : []);
    } catch (e) { setErr(e); }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function save() {
    const form = editing;
    try {
      await api.post('/v1/ganit/billing/sla-credits', {
        vendor_id: form.vendor_id,
        sla_metric: form.sla_metric,
        threshold: Number(form.threshold),
        actual: Number(form.actual),
        credit_amount: Number(form.credit_amount),
        period: form.period || null,
        rate_card_id: form.rate_card_id || null,
      });
      setEditing(null);
      load();
    } catch (e) {
      alert(e.response?.data?.detail || 'Failed to save');
    }
  }

  async function applyToBill(id) {
    const billId = prompt('Bill ID to apply this credit to:');
    if (!billId) return;
    setBusy(id);
    try {
      await api.post(`/v1/ganit/billing/sla-credits/${id}/apply`, { bill_id: billId });
      load();
    } catch (e) {
      alert(e.response?.data?.detail || 'Failed to apply credit');
    }
    setBusy(null);
  }

  async function waive(id) {
    if (!confirm('Waive this SLA credit?')) return;
    setBusy(id);
    try {
      await api.patch(`/v1/ganit/billing/sla-credits/${id}/waive`);
      load();
    } catch (e) {
      alert(e.response?.data?.detail || 'Failed to waive credit');
    }
    setBusy(null);
  }

  if (loading) return <SkeletonList />;
  if (err) return <ErrorState kind={errorKind(err)} onRetry={load} />;

  return (
    <div className="k-tab-body">
      {canWrite && (
        <div className="k-toolbar">
          <button className="k-btn k-btn-primary" onClick={() => setEditing({ ...BLANK })}>
            + SLA Credit
          </button>
        </div>
      )}

      {items.length > 0 ? (
        <table className="k-table">
          <thead>
            <tr>
              <th>Vendor</th>
              <th>SLA Metric</th>
              <th>Threshold</th>
              <th>Actual</th>
              <th>Credit Amount</th>
              <th>Period</th>
              <th>Status</th>
              {canWrite && <th></th>}
            </tr>
          </thead>
          <tbody>
            {items.map(s => (
              <tr key={s.id}>
                <td>{s.vendor_name}</td>
                <td>{s.sla_metric}</td>
                <td>{s.threshold}</td>
                <td>{s.actual}</td>
                <td>{inr(s.credit_amount)}</td>
                <td>{s.period}</td>
                <td><span className={STATUS_CLASS[s.status] || 'k-badge'}>{s.status}</span></td>
                {canWrite && (
                  <td>
                    {s.status === 'pending' && (
                      <>
                        <button className="k-btn k-btn-ghost k-btn-sm" disabled={busy === s.id}
                          onClick={() => applyToBill(s.id)}>
                          Apply to Bill
                        </button>
                        <button className="k-btn k-btn-ghost k-btn-sm" disabled={busy === s.id}
                          onClick={() => waive(s.id)}>
                          Waive
                        </button>
                      </>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <EmptyState
          illustration="invoice"
          title="No SLA credits"
          description="Record a service-level breach against a vendor to track the credit owed, then apply it to a bill or waive it."
          action={canWrite ? '+ SLA Credit' : undefined}
          onAction={canWrite ? () => setEditing({ ...BLANK }) : undefined}
        />
      )}

      {editing && (
        <ConfirmDialog
          title="New SLA Credit"
          onConfirm={save}
          onCancel={() => setEditing(null)}
          confirmLabel="Save"
        >
          <div className="k-form-grid">
            <label className="k-field">
              <span className="k-field-label">Vendor</span>
              <select className="k-input" value={editing.vendor_id}
                onChange={e => setEditing({ ...editing, vendor_id: e.target.value })}>
                <option value="">Select a vendor…</option>
                {vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
              </select>
            </label>
            <label className="k-field">
              <span className="k-field-label">SLA Metric</span>
              <input className="k-input" value={editing.sla_metric}
                placeholder="e.g. Uptime %, Response Time (hrs)"
                onChange={e => setEditing({ ...editing, sla_metric: e.target.value })} />
            </label>
            <label className="k-field">
              <span className="k-field-label">Threshold</span>
              <input className="k-input" type="number" step="0.0001"
                value={editing.threshold}
                onChange={e => setEditing({ ...editing, threshold: e.target.value })} />
            </label>
            <label className="k-field">
              <span className="k-field-label">Actual</span>
              <input className="k-input" type="number" step="0.0001"
                value={editing.actual}
                onChange={e => setEditing({ ...editing, actual: e.target.value })} />
            </label>
            <label className="k-field">
              <span className="k-field-label">Credit Amount</span>
              <input className="k-input" type="number" min={0} step="0.01"
                value={editing.credit_amount}
                onChange={e => setEditing({ ...editing, credit_amount: e.target.value })} />
            </label>
            <label className="k-field">
              <span className="k-field-label">Period</span>
              <DateInput value={editing.period}
                onChange={v => setEditing({ ...editing, period: v })} />
            </label>
            <label className="k-field">
              <span className="k-field-label">Rate Card (optional)</span>
              <select className="k-input" value={editing.rate_card_id}
                onChange={e => setEditing({ ...editing, rate_card_id: e.target.value })}>
                <option value="">None</option>
                {rateCards.map(rc => (
                  <option key={rc.id} value={rc.id}>
                    {rc.vendor_name} — {rc.item_category} ({inr(rc.rate)}/{rc.unit})
                  </option>
                ))}
              </select>
            </label>
          </div>
        </ConfirmDialog>
      )}
    </div>
  );
}
