import React, { useCallback, useEffect, useState } from 'react';
import { api, rows as asRows } from '../../lib/api';
import { EmptyState, ErrorState, errorKind } from '../../components/ui';
import { SkeletonList } from '../../components/ui/Skeleton';
import { inr } from '../../lib/inr';
import useModuleWrite from '../../hooks/useModuleWrite';
import ConfirmDialog from '../../components/ui/ConfirmDialog';

const BLANK = {
  client_id: '', billing_cycle: 'monthly', anchor_day: 1,
  payment_terms_days: 30, currency: 'INR', gst_treatment: 'registered',
  credit_limit: '', notes: '',
};

const CYCLES = ['monthly', 'quarterly', 'annual'];
const GST = ['registered', 'unregistered', 'composition', 'overseas', 'sez'];

export default function BillingProfilesTab() {
  const { canWrite } = useModuleWrite({ label: 'manage billing profiles' });
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [editing, setEditing] = useState(null);
  const [clients, setClients] = useState([]);

  const load = useCallback(async () => {
    setErr(null);
    try {
      const [p, c] = await Promise.allSettled([
        api.get('/v1/ganit/billing/profiles'),
        api.get('/v1/graha/clients'),
      ]);
      if (p.status === 'rejected') throw p.reason;
      setItems(asRows(p.value));
      setClients(c.status === 'fulfilled' ? asRows(c.value) : []);
    } catch (e) { setErr(e); }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function save() {
    const form = editing;
    try {
      if (form.id) {
        await api.patch(`/v1/ganit/billing/profiles/${form.id}`, {
          billing_cycle: form.billing_cycle,
          anchor_day: Number(form.anchor_day),
          payment_terms_days: Number(form.payment_terms_days),
          currency: form.currency,
          gst_treatment: form.gst_treatment,
          credit_limit: form.credit_limit ? Number(form.credit_limit) : null,
          notes: form.notes,
        });
      } else {
        await api.post('/v1/ganit/billing/profiles', {
          ...form,
          anchor_day: Number(form.anchor_day),
          payment_terms_days: Number(form.payment_terms_days),
          credit_limit: form.credit_limit ? Number(form.credit_limit) : null,
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

  const usedClients = new Set(items.map(i => i.client_id));
  const available = clients.filter(c => !usedClients.has(c.id));

  return (
    <div className="k-tab-body">
      {canWrite && (
        <div className="k-toolbar">
          <button className="k-btn k-btn-primary" onClick={() => setEditing({ ...BLANK })}>
            + Billing Profile
          </button>
        </div>
      )}

      {items.length > 0 ? (
        <table className="k-table">
          <thead>
            <tr>
              <th>Client</th>
              <th>Cycle</th>
              <th>Anchor Day</th>
              <th>Terms</th>
              <th>GST</th>
              <th>Credit Limit</th>
              {canWrite && <th></th>}
            </tr>
          </thead>
          <tbody>
            {items.map(p => (
              <tr key={p.id}>
                <td>{p.client_name}</td>
                <td>{p.billing_cycle}</td>
                <td>{p.anchor_day}</td>
                <td>{p.payment_terms_days}d</td>
                <td>{p.gst_treatment}</td>
                <td>{p.credit_limit ? inr(p.credit_limit) : '—'}</td>
                {canWrite && (
                  <td>
                    <button className="k-btn k-btn-ghost k-btn-sm" onClick={() => setEditing({ ...p })}>
                      Edit
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <EmptyState
          illustration="invoice"
          title="No billing profiles"
          description="Create a billing profile for a client to set up their billing cycle, terms, and GST treatment."
          action={canWrite ? '+ Billing Profile' : undefined}
          onAction={canWrite ? () => setEditing({ ...BLANK }) : undefined}
        />
      )}

      {editing && (
        <ConfirmDialog
          title={editing.id ? 'Edit Billing Profile' : 'New Billing Profile'}
          onConfirm={save}
          onCancel={() => setEditing(null)}
          confirmLabel="Save"
        >
          <div className="k-form-grid">
            {!editing.id && (
              <label className="k-field">
                <span className="k-field-label">Client</span>
                <select
                  className="k-input"
                  value={editing.client_id}
                  onChange={e => setEditing({ ...editing, client_id: e.target.value })}
                >
                  <option value="">Select a client…</option>
                  {available.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </label>
            )}
            <label className="k-field">
              <span className="k-field-label">Billing Cycle</span>
              <select className="k-input" value={editing.billing_cycle}
                onChange={e => setEditing({ ...editing, billing_cycle: e.target.value })}>
                {CYCLES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
            <label className="k-field">
              <span className="k-field-label">Anchor Day (1–28)</span>
              <input className="k-input" type="number" min={1} max={28}
                value={editing.anchor_day}
                onChange={e => setEditing({ ...editing, anchor_day: e.target.value })} />
            </label>
            <label className="k-field">
              <span className="k-field-label">Payment Terms (days)</span>
              <input className="k-input" type="number" min={0}
                value={editing.payment_terms_days}
                onChange={e => setEditing({ ...editing, payment_terms_days: e.target.value })} />
            </label>
            <label className="k-field">
              <span className="k-field-label">GST Treatment</span>
              <select className="k-input" value={editing.gst_treatment}
                onChange={e => setEditing({ ...editing, gst_treatment: e.target.value })}>
                {GST.map(g => <option key={g} value={g}>{g}</option>)}
              </select>
            </label>
            <label className="k-field">
              <span className="k-field-label">Credit Limit</span>
              <input className="k-input" type="number" min={0}
                value={editing.credit_limit}
                onChange={e => setEditing({ ...editing, credit_limit: e.target.value })} />
            </label>
            <label className="k-field">
              <span className="k-field-label">Notes</span>
              <textarea className="k-input" rows={2} value={editing.notes}
                onChange={e => setEditing({ ...editing, notes: e.target.value })} />
            </label>
          </div>
        </ConfirmDialog>
      )}
    </div>
  );
}
