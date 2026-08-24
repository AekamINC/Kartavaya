import React, { useCallback, useEffect, useState } from 'react';
import { api, rows as asRows } from '../../lib/api';
import { EmptyState, ErrorState, errorKind } from '../../components/ui';
import { SkeletonList } from '../../components/ui/Skeleton';
import { inr } from '../../lib/inr';
import useModuleWrite from '../../hooks/useModuleWrite';
import ConfirmDialog from '../../components/ui/ConfirmDialog';
import DateInput from '../../components/ui/DateInput';

const KINDS = ['retainer', 'subscription', 'one_off'];
const CADENCES = ['monthly', 'quarterly', 'annual', 'one_off'];

const BLANK = {
  profile_id: '', kind: 'retainer', description: '', amount: '',
  cadence: 'monthly', period_start: '', period_end: '',
  billing_direction: 'advance', auto_invoice: false,
};

export default function ServiceLinesTab() {
  const { canWrite } = useModuleWrite({ label: 'manage service lines' });
  const [items, setItems] = useState([]);
  const [profiles, setProfiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [editing, setEditing] = useState(null);

  const load = useCallback(async () => {
    setErr(null);
    try {
      const [sl, pr] = await Promise.all([
        api.get('/v1/ganit/billing/service-lines'),
        api.get('/v1/ganit/billing/profiles'),
      ]);
      setItems(asRows(sl));
      setProfiles(asRows(pr));
    } catch (e) { setErr(e); }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function save() {
    const form = editing;
    try {
      if (form.id) {
        await api.patch(`/v1/ganit/billing/service-lines/${form.id}`, {
          description: form.description,
          amount: Number(form.amount),
          period_end: form.period_end || null,
          auto_invoice: form.auto_invoice,
        });
      } else {
        await api.post('/v1/ganit/billing/service-lines', {
          ...form,
          amount: Number(form.amount),
          period_end: form.period_end || null,
        });
      }
      setEditing(null);
      load();
    } catch (e) {
      alert(e.response?.data?.detail || 'Failed to save');
    }
  }

  if (loading) return <SkeletonList />;
  if (err) return <ErrorState kind={errorKind(err)} onRetry={load} />;

  const active = items.filter(i => !i.period_end || new Date(i.period_end) > new Date());
  const ended = items.filter(i => i.period_end && new Date(i.period_end) <= new Date());

  return (
    <div className="k-tab-body">
      {canWrite && (
        <div className="k-toolbar">
          <button className="k-btn k-btn-primary" onClick={() => setEditing({ ...BLANK })}>
            + Service Line
          </button>
        </div>
      )}

      {items.length === 0 && !editing && (
        <EmptyState
          title="No service lines"
          message="Add recurring retainers, subscriptions, or one-off charges for your clients."
        />
      )}

      {active.length > 0 && (
        <>
          <h3 className="k-section-label">Active</h3>
          <table className="k-table">
            <thead>
              <tr>
                <th>Client</th>
                <th>Kind</th>
                <th>Description</th>
                <th>Amount</th>
                <th>Cadence</th>
                <th>Start</th>
                <th>Auto</th>
                {canWrite && <th></th>}
              </tr>
            </thead>
            <tbody>
              {active.map(sl => (
                <tr key={sl.id}>
                  <td>{sl.client_name}</td>
                  <td>{sl.kind}</td>
                  <td>{sl.description}</td>
                  <td>{inr(sl.amount)}</td>
                  <td>{sl.cadence}</td>
                  <td>{sl.period_start}</td>
                  <td>{sl.auto_invoice ? 'Yes' : '—'}</td>
                  {canWrite && (
                    <td>
                      <button className="k-btn k-btn-ghost k-btn-sm" onClick={() => setEditing({ ...sl, amount: String(sl.amount) })}>
                        Edit
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {ended.length > 0 && (
        <>
          <h3 className="k-section-label" style={{ marginTop: 24 }}>Ended</h3>
          <table className="k-table">
            <thead>
              <tr>
                <th>Client</th>
                <th>Description</th>
                <th>Amount</th>
                <th>Period</th>
              </tr>
            </thead>
            <tbody>
              {ended.map(sl => (
                <tr key={sl.id} style={{ opacity: 0.6 }}>
                  <td>{sl.client_name}</td>
                  <td>{sl.description}</td>
                  <td>{inr(sl.amount)}</td>
                  <td>{sl.period_start} – {sl.period_end}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {editing && (
        <ConfirmDialog
          title={editing.id ? 'Edit Service Line' : 'New Service Line'}
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
            {!editing.id && (
              <label className="k-field">
                <span className="k-field-label">Kind</span>
                <select className="k-input" value={editing.kind}
                  onChange={e => setEditing({ ...editing, kind: e.target.value })}>
                  {KINDS.map(k => <option key={k} value={k}>{k.replace('_', ' ')}</option>)}
                </select>
              </label>
            )}
            <label className="k-field">
              <span className="k-field-label">Description</span>
              <input className="k-input" value={editing.description}
                onChange={e => setEditing({ ...editing, description: e.target.value })} />
            </label>
            <label className="k-field">
              <span className="k-field-label">Amount</span>
              <input className="k-input" type="number" min={0} step="0.01"
                value={editing.amount}
                onChange={e => setEditing({ ...editing, amount: e.target.value })} />
            </label>
            {!editing.id && (
              <label className="k-field">
                <span className="k-field-label">Cadence</span>
                <select className="k-input" value={editing.cadence}
                  onChange={e => setEditing({ ...editing, cadence: e.target.value })}>
                  {CADENCES.map(c => <option key={c} value={c}>{c.replace('_', ' ')}</option>)}
                </select>
              </label>
            )}
            {!editing.id && (
              <label className="k-field">
                <span className="k-field-label">Period Start</span>
                <DateInput value={editing.period_start}
                  onChange={v => setEditing({ ...editing, period_start: v })} />
              </label>
            )}
            <label className="k-field">
              <span className="k-field-label">Period End (optional)</span>
              <DateInput value={editing.period_end}
                onChange={v => setEditing({ ...editing, period_end: v })} />
            </label>
            <label className="k-field k-field-row">
              <input type="checkbox" checked={editing.auto_invoice}
                onChange={e => setEditing({ ...editing, auto_invoice: e.target.checked })} />
              <span>Auto-generate invoices</span>
            </label>
          </div>
        </ConfirmDialog>
      )}
    </div>
  );
}
