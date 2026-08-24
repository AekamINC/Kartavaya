import React, { useCallback, useEffect, useState } from 'react';
import { api, rows as asRows } from '../../lib/api';
import { EmptyState, ErrorState, errorKind } from '../../components/ui';
import { SkeletonList } from '../../components/ui/Skeleton';
import { inr } from '../../lib/inr';
import useModuleWrite from '../../hooks/useModuleWrite';
import ConfirmDialog from '../../components/ui/ConfirmDialog';
import DateInput from '../../components/ui/DateInput';

const BLANK = {
  profile_id: '', metric: '', quantity: '', unit: '', rate: '',
  recorded_date: '', source_ref: '',
};

export default function MeteredUsageTab() {
  const { canWrite } = useModuleWrite({ label: 'manage metered usage' });
  const [items, setItems] = useState([]);
  const [profiles, setProfiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [editing, setEditing] = useState(null);
  const [filter, setFilter] = useState('unbilled');
  const [generating, setGenerating] = useState(null);

  const load = useCallback(async () => {
    setErr(null);
    try {
      const invoicedParam = filter === 'all' ? '' : filter === 'unbilled' ? 'false' : 'true';
      const [u, pr] = await Promise.all([
        api.get(`/v1/ganit/billing/metered-usage${invoicedParam ? `?invoiced=${invoicedParam}` : ''}`),
        api.get('/v1/ganit/billing/profiles'),
      ]);
      setItems(asRows(u));
      setProfiles(asRows(pr));
    } catch (e) { setErr(e); }
    setLoading(false);
  }, [filter]);

  useEffect(() => { load(); }, [load]);

  async function save() {
    const form = editing;
    try {
      if (form.id) {
        await api.patch(`/v1/ganit/billing/metered-usage/${form.id}`, {
          metric: form.metric,
          quantity: Number(form.quantity),
          unit: form.unit,
          rate: Number(form.rate),
          recorded_date: form.recorded_date || null,
          source_ref: form.source_ref || null,
        });
      } else {
        await api.post('/v1/ganit/billing/metered-usage', {
          ...form,
          quantity: Number(form.quantity),
          rate: Number(form.rate),
          recorded_date: form.recorded_date || null,
          source_ref: form.source_ref || null,
        });
      }
      setEditing(null);
      load();
    } catch (e) {
      alert(e.response?.data?.detail || 'Failed to save');
    }
  }

  async function handleDelete(id) {
    if (!confirm('Delete this usage entry?')) return;
    try {
      await api.delete(`/v1/ganit/billing/metered-usage/${id}`);
      load();
    } catch (e) {
      alert(e.response?.data?.detail || 'Failed to delete');
    }
  }

  async function generateInvoice(profileId) {
    setGenerating(profileId);
    try {
      const res = await api.post('/v1/ganit/billing/metered-usage/generate-invoice', {
        profile_id: profileId,
      });
      alert(`Invoice created: ${res.entries} entries, ${inr(res.total)}`);
      load();
    } catch (e) {
      alert(e.response?.data?.detail || 'Failed to generate invoice');
    }
    setGenerating(null);
  }

  if (loading) return <SkeletonList />;
  if (err) return <ErrorState kind={errorKind(err)} onRetry={load} />;

  const byProfile = {};
  for (const u of items) {
    const key = u.profile_id;
    if (!byProfile[key]) byProfile[key] = { client_name: u.client_name, profile_id: key, rows: [] };
    byProfile[key].rows.push(u);
  }
  const groups = Object.values(byProfile);

  return (
    <div className="k-tab-body">
      <div className="k-toolbar">
        {canWrite && (
          <button className="k-btn k-btn-primary" onClick={() => setEditing({ ...BLANK })}>
            + Usage Entry
          </button>
        )}
        <div className="k-toolbar-spacer" />
        <select
          className="k-input"
          style={{ width: 'auto', minWidth: 120 }}
          value={filter}
          onChange={e => { setFilter(e.target.value); setLoading(true); }}
        >
          <option value="unbilled">Unbilled</option>
          <option value="invoiced">Invoiced</option>
          <option value="all">All</option>
        </select>
      </div>

      {items.length === 0 && !editing && (
        <EmptyState
          illustration="invoice"
          title="No usage entries"
          description="Record billable hours, units, or transactions for your clients. Generate invoices from unbilled usage."
          action={canWrite ? '+ Usage Entry' : undefined}
          onAction={canWrite ? () => setEditing({ ...BLANK }) : undefined}
        />
      )}

      {groups.map(g => (
        <div key={g.profile_id} style={{ marginBottom: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
            <h3 className="k-section-label" style={{ margin: 0 }}>{g.client_name}</h3>
            {canWrite && filter !== 'invoiced' && g.rows.some(r => !r.invoiced) && (
              <button
                className="k-btn k-btn-sm"
                disabled={generating === g.profile_id}
                onClick={() => generateInvoice(g.profile_id)}
              >
                {generating === g.profile_id ? 'Generating…' : 'Generate Invoice'}
              </button>
            )}
          </div>
          <table className="k-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Metric</th>
                <th>Qty</th>
                <th>Unit</th>
                <th>Rate</th>
                <th>Amount</th>
                <th>Source</th>
                <th>Status</th>
                {canWrite && <th></th>}
              </tr>
            </thead>
            <tbody>
              {g.rows.map(u => (
                <tr key={u.id} style={u.invoiced ? { opacity: 0.6 } : undefined}>
                  <td>{u.recorded_date}</td>
                  <td>{u.metric}</td>
                  <td>{u.quantity}</td>
                  <td>{u.unit}</td>
                  <td>{inr(u.rate)}</td>
                  <td>{inr(Number(u.quantity) * Number(u.rate))}</td>
                  <td>{u.source_ref || '—'}</td>
                  <td>{u.invoiced ? 'Invoiced' : 'Unbilled'}</td>
                  {canWrite && (
                    <td>
                      {!u.invoiced && (
                        <>
                          <button className="k-btn k-btn-ghost k-btn-sm"
                            onClick={() => setEditing({
                              ...u,
                              quantity: String(u.quantity),
                              rate: String(u.rate),
                            })}>
                            Edit
                          </button>
                          <button className="k-btn k-btn-ghost k-btn-sm"
                            onClick={() => handleDelete(u.id)}>
                            Delete
                          </button>
                        </>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          {!g.rows.some(r => r.invoiced) && (
            <div style={{ textAlign: 'right', fontSize: '0.85rem', color: 'var(--text-2)', marginTop: 4 }}>
              Total: {inr(g.rows.reduce((s, r) => s + Number(r.quantity) * Number(r.rate), 0))}
            </div>
          )}
        </div>
      ))}

      {editing && (
        <ConfirmDialog
          title={editing.id ? 'Edit Usage Entry' : 'New Usage Entry'}
          onConfirm={save}
          onCancel={() => setEditing(null)}
          confirmLabel="Save"
        >
          <div className="k-form-grid">
            {!editing.id && (
              <label className="k-field">
                <span className="k-field-label">Billing Profile</span>
                <select className="k-input" value={editing.profile_id}
                  onChange={e => setEditing({ ...editing, profile_id: e.target.value })}>
                  <option value="">Select…</option>
                  {profiles.map(p => (
                    <option key={p.id} value={p.id}>{p.client_name} ({p.billing_cycle})</option>
                  ))}
                </select>
              </label>
            )}
            <label className="k-field">
              <span className="k-field-label">Metric</span>
              <input className="k-input" value={editing.metric}
                placeholder="e.g. Consulting Hours, Units Processed"
                onChange={e => setEditing({ ...editing, metric: e.target.value })} />
            </label>
            <label className="k-field">
              <span className="k-field-label">Quantity</span>
              <input className="k-input" type="number" min={0} step="0.01"
                value={editing.quantity}
                onChange={e => setEditing({ ...editing, quantity: e.target.value })} />
            </label>
            <label className="k-field">
              <span className="k-field-label">Unit</span>
              <input className="k-input" value={editing.unit}
                placeholder="e.g. hours, units, transactions"
                onChange={e => setEditing({ ...editing, unit: e.target.value })} />
            </label>
            <label className="k-field">
              <span className="k-field-label">Rate</span>
              <input className="k-input" type="number" min={0} step="0.01"
                value={editing.rate}
                onChange={e => setEditing({ ...editing, rate: e.target.value })} />
            </label>
            <label className="k-field">
              <span className="k-field-label">Date</span>
              <DateInput value={editing.recorded_date}
                onChange={v => setEditing({ ...editing, recorded_date: v })} />
            </label>
            <label className="k-field">
              <span className="k-field-label">Source Reference (optional)</span>
              <input className="k-input" value={editing.source_ref || ''}
                placeholder="e.g. task:uuid, timesheet:uuid"
                onChange={e => setEditing({ ...editing, source_ref: e.target.value })} />
            </label>
          </div>
        </ConfirmDialog>
      )}
    </div>
  );
}
