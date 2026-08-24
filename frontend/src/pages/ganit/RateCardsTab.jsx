import React, { useCallback, useEffect, useState } from 'react';
import { api, rows as asRows } from '../../lib/api';
import { EmptyState, ErrorState, errorKind } from '../../components/ui';
import { SkeletonList } from '../../components/ui/Skeleton';
import { inr } from '../../lib/inr';
import useModuleWrite from '../../hooks/useModuleWrite';
import ConfirmDialog from '../../components/ui/ConfirmDialog';

const BLANK = {
  vendor_id: '', item_category: '', rate: '', unit: '',
  effective_from: '', effective_to: '', proration_clause: false, notes: '',
};

export default function RateCardsTab() {
  const { canWrite } = useModuleWrite({ label: 'manage vendor rate cards' });
  const [items, setItems] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [editing, setEditing] = useState(null);

  const load = useCallback(async () => {
    setErr(null);
    try {
      const [rc, v] = await Promise.all([
        api.get('/v1/ganit/billing/rate-cards'),
        api.get('/v1/ganit/vendors'),
      ]);
      setItems(asRows(rc));
      setVendors(asRows(v));
    } catch (e) { setErr(e); }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function save() {
    const form = editing;
    try {
      const payload = {
        item_category: form.item_category,
        rate: Number(form.rate),
        unit: form.unit,
        effective_from: form.effective_from || null,
        effective_to: form.effective_to || null,
        proration_clause: !!form.proration_clause,
        notes: form.notes || null,
      };
      if (form.id) {
        await api.patch(`/v1/ganit/billing/rate-cards/${form.id}`, payload);
      } else {
        await api.post('/v1/ganit/billing/rate-cards', { ...payload, vendor_id: form.vendor_id });
      }
      setEditing(null);
      load();
    } catch (e) {
      alert(e.response?.data?.detail || 'Failed to save');
    }
  }

  async function handleDelete(id) {
    if (!confirm('Delete this rate card?')) return;
    try {
      await api.delete(`/v1/ganit/billing/rate-cards/${id}`);
      load();
    } catch (e) {
      alert(e.response?.data?.detail || 'Failed to delete');
    }
  }

  if (loading) return <SkeletonList />;
  if (err) return <ErrorState kind={errorKind(err)} onRetry={load} />;

  return (
    <div className="k-tab-body">
      {canWrite && (
        <div className="k-toolbar">
          <button className="k-btn k-btn-primary" onClick={() => setEditing({ ...BLANK })}>
            + Rate Card
          </button>
        </div>
      )}

      {items.length === 0 && !editing && (
        <EmptyState
          title="No vendor rate cards"
          message="Add a rate card to lock in vendor pricing per item category, effective dates, and proration terms."
        />
      )}

      {items.length > 0 && (
        <table className="k-table">
          <thead>
            <tr>
              <th>Vendor</th>
              <th>Category</th>
              <th>Rate</th>
              <th>Unit</th>
              <th>Effective From</th>
              <th>Effective To</th>
              <th>Proration</th>
              {canWrite && <th></th>}
            </tr>
          </thead>
          <tbody>
            {items.map(r => (
              <tr key={r.id}>
                <td>{r.vendor_name}</td>
                <td>{r.item_category}</td>
                <td>{inr(r.rate)}</td>
                <td>{r.unit}</td>
                <td>{r.effective_from || '—'}</td>
                <td>{r.effective_to || '—'}</td>
                <td>{r.proration_clause ? 'Yes' : 'No'}</td>
                {canWrite && (
                  <td>
                    <button className="k-btn k-btn-ghost k-btn-sm"
                      onClick={() => setEditing({ ...r, rate: String(r.rate) })}>
                      Edit
                    </button>
                    <button className="k-btn k-btn-ghost k-btn-sm" onClick={() => handleDelete(r.id)}>
                      Delete
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {editing && (
        <ConfirmDialog
          title={editing.id ? 'Edit Rate Card' : 'New Rate Card'}
          onConfirm={save}
          onCancel={() => setEditing(null)}
          confirmLabel="Save"
        >
          <div className="k-form-grid">
            {!editing.id && (
              <label className="k-field">
                <span className="k-field-label">Vendor</span>
                <select className="k-input" value={editing.vendor_id}
                  onChange={e => setEditing({ ...editing, vendor_id: e.target.value })}>
                  <option value="">Select a vendor…</option>
                  {vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
                </select>
              </label>
            )}
            <label className="k-field">
              <span className="k-field-label">Item Category</span>
              <input className="k-input" value={editing.item_category}
                onChange={e => setEditing({ ...editing, item_category: e.target.value })} />
            </label>
            <label className="k-field">
              <span className="k-field-label">Rate</span>
              <input className="k-input" type="number" min={0} step="0.01"
                value={editing.rate}
                onChange={e => setEditing({ ...editing, rate: e.target.value })} />
            </label>
            <label className="k-field">
              <span className="k-field-label">Unit</span>
              <input className="k-input" value={editing.unit}
                placeholder="e.g. hours, units, kg"
                onChange={e => setEditing({ ...editing, unit: e.target.value })} />
            </label>
            <label className="k-field">
              <span className="k-field-label">Effective From</span>
              <input className="k-input" type="text" placeholder="YYYY-MM-DD"
                value={editing.effective_from}
                onChange={e => setEditing({ ...editing, effective_from: e.target.value })} />
            </label>
            <label className="k-field">
              <span className="k-field-label">Effective To</span>
              <input className="k-input" type="text" placeholder="YYYY-MM-DD (optional)"
                value={editing.effective_to}
                onChange={e => setEditing({ ...editing, effective_to: e.target.value })} />
            </label>
            <label className="k-field k-field-checkbox">
              <input type="checkbox" checked={!!editing.proration_clause}
                onChange={e => setEditing({ ...editing, proration_clause: e.target.checked })} />
              <span className="k-field-label">Proration Clause</span>
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
