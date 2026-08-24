// Kray · vendors — the master list of suppliers this org buys from.
//
// Vendor records live in ganit_vendors (the table name is not a module code)
// and are shared between Ganit and Kray via the payables gate.
import React, { useCallback, useEffect, useState } from 'react';
import { api, rows, body } from '../../lib/api';
import { useToast } from '../../components/ui/toast';
import { DataTable, Td } from '../../components/editorial';
import { EmptyState } from '../../components/ui/EmptyState';
import ErrorState, { errorKind } from '../../components/ui/ErrorState';
import { SkeletonList } from '../../components/ui/Skeleton';
import useModuleWrite from '../../hooks/useModuleWrite';
import { Secondary } from '../../components/Bilingual';

const COLUMNS = ['Name', 'GSTIN', 'Email', 'Phone', ''];

export default function VendorsTab() {
  const { canWrite, reason: denial } = useModuleWrite({ label: 'manage vendors' });
  const { pushToast } = useToast();
  const [vendors, setVendors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editId, setEditId] = useState(null);
  const [form, setForm] = useState({ name: '', gstin: '', email: '', phone: '' });

  const load = useCallback(async () => {
    setErr(null);
    setLoading(true);
    try {
      const params = search ? { search } : undefined;
      const r = await api.get('/v1/ganit/vendors', { params });
      setVendors(rows(r));
    } catch (e) { setErr(e); setVendors([]); }
    finally { setLoading(false); }
  }, [search]);

  useEffect(() => { load(); }, [load]);

  function startEdit(v) {
    setEditId(v.id);
    setForm({ name: v.name, gstin: v.gstin || '', email: v.email || '', phone: v.phone || '' });
    setShowForm(true);
  }

  function startNew() {
    setEditId(null);
    setForm({ name: '', gstin: '', email: '', phone: '' });
    setShowForm(true);
  }

  async function save(e) {
    e.preventDefault();
    if (!form.name.trim()) { pushToast({ title: 'Name is required', type: 'error' }); return; }
    setSaving(true);
    try {
      if (editId) {
        await api.patch(`/v1/ganit/vendors/${editId}`, form);
        pushToast({ title: 'Vendor updated', type: 'success' });
      } else {
        await api.post('/v1/ganit/vendors', form);
        pushToast({ title: 'Vendor added', type: 'success' });
      }
      setShowForm(false);
      setForm({ name: '', gstin: '', email: '', phone: '' });
      setEditId(null);
      load();
    } catch (err2) {
      pushToast({ title: err2.response?.data?.detail || 'Could not save vendor', type: 'error' });
    } finally { setSaving(false); }
  }

  if (err) return <ErrorState kind={errorKind(err)} retry={load} />;

  return (
    <div>
      <div className="gn-bar" style={{ marginBottom: '1rem' }}>
        <input
          className="gn-search"
          type="text"
          placeholder="Search vendors…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        {canWrite && (
          <button type="button" className="btn btn--fill btn--sm" onClick={startNew}>
            + Vendor
          </button>
        )}
        {!canWrite && denial && (
          <span className="gn-denial">{denial}</span>
        )}
      </div>

      {showForm && (
        <form className="gn-form gn-form--inline" onSubmit={save} style={{ marginBottom: '1.5rem' }}>
          <div className="gn-form__row">
            <label className="gn-form__field">
              <Secondary en="Name" hi="नाम" />
              <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required />
            </label>
            <label className="gn-form__field">
              <Secondary en="GSTIN" hi="जीएसटीआईएन" />
              <input value={form.gstin} onChange={e => setForm(f => ({ ...f, gstin: e.target.value }))} placeholder="Optional" />
            </label>
          </div>
          <div className="gn-form__row">
            <label className="gn-form__field">
              <Secondary en="Email" hi="ईमेल" />
              <input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
            </label>
            <label className="gn-form__field">
              <Secondary en="Phone" hi="फ़ोन" />
              <input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} />
            </label>
          </div>
          <div className="gn-form__actions">
            <button type="submit" className="btn btn--fill btn--sm" disabled={saving}>
              {saving ? 'Saving…' : editId ? 'Update' : 'Add vendor'}
            </button>
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => setShowForm(false)}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {loading ? <SkeletonList rows={6} /> : vendors.length === 0 ? (
        <EmptyState
          icon="kray"
          title="No vendors yet"
          description="Add your first supplier to start raising purchase orders."
          action={canWrite ? '+ Vendor' : undefined}
          onAction={canWrite ? startNew : undefined}
        />
      ) : (
        <DataTable columns={COLUMNS} label="Vendors">
          {vendors.map(v => (
            <tr key={v.id}>
              <Td bold>{v.name}</Td>
              <Td mono>{v.gstin || '—'}</Td>
              <Td>{v.email || '—'}</Td>
              <Td>{v.phone || '—'}</Td>
              <Td>
                {canWrite && (
                  <button type="button" className="btn btn--ghost btn--xs" onClick={() => startEdit(v)}>
                    Edit
                  </button>
                )}
              </Td>
            </tr>
          ))}
        </DataTable>
      )}
    </div>
  );
}
