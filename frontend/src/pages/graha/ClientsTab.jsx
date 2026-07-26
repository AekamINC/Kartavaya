import React, { useState, useEffect, useCallback } from 'react';
import { api } from '../../lib/api';
import { useToast } from '../../components/ui/toast';
import { Card } from '../../components/editorial';
import { mixAlpha } from '../../lib/statusColors';
import { inr } from '../../lib/inr';

export default function ClientsTab() {
  const { pushToast } = useToast();
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState(null);
  const [form, setForm] = useState({ name: '', ref_no: '', gstin: '', website: '', notes: '', address: {} });
  const [search, setSearch] = useState('');
  const [detail, setDetail] = useState(null);

  const load = useCallback(() => {
    const params = search ? `?search=${encodeURIComponent(search)}` : '';
    api.get(`/v1/graha/clients${params}`)
      .then(r => setClients(r.data.data || []))
      .catch(() => pushToast({ title: 'Failed to load clients', type: 'error' }))
      .finally(() => setLoading(false));
  }, [search]);

  useEffect(() => { load(); }, [load]);

  async function save() {
    if (!form.name.trim()) return pushToast({ title: 'Company name is required', type: 'error' });
    try {
      if (editId) {
        await api.patch(`/v1/graha/clients/${editId}`, form);
        pushToast({ title: 'Client updated', type: 'success' });
      } else {
        await api.post('/v1/graha/clients', form);
        pushToast({ title: 'Client created', type: 'success' });
      }
      setShowForm(false); setEditId(null);
      setForm({ name: '', ref_no: '', gstin: '', website: '', notes: '', address: {} });
      load();
    } catch { pushToast({ title: 'Could not save client', type: 'error' }); }
  }

  function openEdit(c) {
    setEditId(c.id);
    setForm({ name: c.name, ref_no: c.ref_no || '', gstin: c.gstin || '', website: c.website || '', notes: c.notes || '', address: c.address || {} });
    setDetail(null);
    setShowForm(true);
  }

  async function openDetail(id) {
    try {
      const r = await api.get(`/v1/graha/clients/${id}`);
      setDetail(r.data);
    } catch { pushToast({ title: 'Failed to load client', type: 'error' }); }
  }

  async function remove(id) {
    if (!window.confirm('Delete this client? This cannot be undone.')) return;
    try {
      await api.delete(`/v1/graha/clients/${id}`);
      pushToast({ title: 'Client deleted', type: 'success' });
      setDetail(null);
      load();
    } catch { pushToast({ title: 'Could not delete client', type: 'error' }); }
  }

  if (loading) return <p style={{ color: 'var(--ink-3)', fontSize: 13, padding: 16 }}>Loading...</p>;

  if (detail) {
    return (
      <div>
        <button onClick={() => setDetail(null)} style={{ fontSize: 12, color: 'var(--k-primary)', background: 'none', border: 'none', cursor: 'pointer', marginBottom: 12 }}>← Back to clients</button>
        <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 340px', border: '1px solid var(--rule-soft)', borderRadius: 'var(--r-md)', padding: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>{detail.name}</h3>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => openEdit(detail)} style={{ fontSize: 12, padding: '4px 12px', borderRadius: 'var(--r-sm)', background: 'var(--surface-1)', border: '1px solid var(--rule-soft)', cursor: 'pointer' }}>Edit</button>
                <button onClick={() => remove(detail.id)} style={{ fontSize: 12, padding: '4px 12px', borderRadius: 'var(--r-sm)', background: mixAlpha('var(--danger)', 9), color: 'var(--danger)', border: 'none', cursor: 'pointer' }}>Delete</button>
              </div>
            </div>
            {detail.ref_no && <div style={{ fontSize: 12, color: 'var(--ink-3)', marginBottom: 4 }}>Ref: {detail.ref_no}</div>}
            {detail.gstin && <div style={{ fontSize: 12, color: 'var(--ink-3)', marginBottom: 4 }}>GSTIN: {detail.gstin}</div>}
            {detail.website && <div style={{ fontSize: 12, color: 'var(--ink-3)', marginBottom: 4 }}>Web: {detail.website}</div>}
            {detail.address?.line1 && <div style={{ fontSize: 12, color: 'var(--ink-3)', marginBottom: 4 }}>Address: {[detail.address.line1, detail.address.line2, detail.address.city, detail.address.state, detail.address.pincode].filter(Boolean).join(', ')}</div>}
            {detail.notes && <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 8 }}>{detail.notes}</div>}
          </div>
          <div style={{ flex: '1 1 300px' }}>
            <h4 style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>Contacts ({detail.contacts?.length || 0})</h4>
            {(detail.contacts || []).map(c => (
              <div key={c.id} style={{ padding: '6px 0', borderBottom: '1px solid var(--rule-soft)', fontSize: 13 }}>
                <span style={{ fontWeight: 600 }}>{c.name}</span>
                {c.designation && <span style={{ color: 'var(--ink-3)', fontSize: 11 }}> · {c.designation}</span>}
                {c.email && <div style={{ fontSize: 11, color: 'var(--ink-3)' }}>{c.email}</div>}
              </div>
            ))}
            {(!detail.contacts || detail.contacts.length === 0) && <p style={{ fontSize: 12, color: 'var(--ink-3)' }}>No contacts linked</p>}

            <h4 style={{ fontSize: 13, fontWeight: 700, marginTop: 16, marginBottom: 8 }}>Deals ({detail.deals?.length || 0})</h4>
            {(detail.deals || []).map(d => (
              <div key={d.id} style={{ padding: '6px 0', borderBottom: '1px solid var(--rule-soft)', fontSize: 13, display: 'flex', justifyContent: 'space-between' }}>
                <span>{d.title}</span>
                <span style={{ fontWeight: 600 }}>{inr(Number(d.value || 0))}</span>
              </div>
            ))}
            {(!detail.deals || detail.deals.length === 0) && <p style={{ fontSize: 12, color: 'var(--ink-3)' }}>No deals linked</p>}
          </div>
        </div>
      </div>
    );
  }

  const inputStyle = { width: '100%', padding: '6px 10px', fontSize: 13, border: '1px solid var(--rule-soft)', borderRadius: 'var(--r-sm)', background: 'var(--bg)', color: 'var(--ink-1)' };

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center' }}>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search clients..."
          style={{ ...inputStyle, maxWidth: 260 }} />
        <button onClick={() => { setShowForm(true); setEditId(null); setForm({ name: '', ref_no: '', gstin: '', website: '', notes: '', address: {} }); }}
          className="k-btn k-btn--primary" style={{ whiteSpace: 'nowrap' }}>
          + Add Client
        </button>
      </div>

      {showForm && (
        <Card style={{ marginBottom: 16, padding: 16 }}>
          <h4 style={{ margin: '0 0 12px', fontSize: 14, fontWeight: 700 }}>{editId ? 'Edit' : 'New'} Client</h4>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 10 }}>
            <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Company Name *" style={inputStyle} />
            <input value={form.ref_no} onChange={e => setForm(f => ({ ...f, ref_no: e.target.value }))} placeholder="Ref No" style={inputStyle} />
            <input value={form.gstin} onChange={e => setForm(f => ({ ...f, gstin: e.target.value }))} placeholder="GST No" style={inputStyle} />
            <input value={form.website} onChange={e => setForm(f => ({ ...f, website: e.target.value }))} placeholder="Website" style={inputStyle} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 10, marginTop: 10 }}>
            <input value={form.address?.line1 || ''} onChange={e => setForm(f => ({ ...f, address: { ...f.address, line1: e.target.value } }))} placeholder="Address Line 1" style={inputStyle} />
            <input value={form.address?.line2 || ''} onChange={e => setForm(f => ({ ...f, address: { ...f.address, line2: e.target.value } }))} placeholder="Address Line 2" style={inputStyle} />
            <input value={form.address?.city || ''} onChange={e => setForm(f => ({ ...f, address: { ...f.address, city: e.target.value } }))} placeholder="City" style={inputStyle} />
            <input value={form.address?.state || ''} onChange={e => setForm(f => ({ ...f, address: { ...f.address, state: e.target.value } }))} placeholder="State" style={inputStyle} />
            <input value={form.address?.pincode || ''} onChange={e => setForm(f => ({ ...f, address: { ...f.address, pincode: e.target.value } }))} placeholder="Pincode" style={inputStyle} />
          </div>
          <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Notes" rows={2}
            style={{ ...inputStyle, marginTop: 10, resize: 'vertical' }} />
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button onClick={save} className="k-btn k-btn--primary">
              {editId ? 'Update' : 'Create'}
            </button>
            <button onClick={() => { setShowForm(false); setEditId(null); }} style={{ padding: '6px 16px', fontSize: 13, borderRadius: 'var(--r-sm)', background: 'var(--surface-1)', border: '1px solid var(--rule-soft)', cursor: 'pointer' }}>Cancel</button>
          </div>
        </Card>
      )}

      <div style={{ border: '1px solid var(--rule-soft)', borderRadius: 'var(--r-sm)', overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: 'var(--bg-raised)', textAlign: 'left' }}>
              <th style={{ padding: '8px 12px', fontWeight: 600 }}>Company</th>
              <th style={{ padding: '8px 12px', fontWeight: 600 }}>Ref No</th>
              <th style={{ padding: '8px 12px', fontWeight: 600 }}>GSTIN</th>
              <th style={{ padding: '8px 12px', fontWeight: 600 }}>Website</th>
              <th style={{ padding: '8px 12px', fontWeight: 600, textAlign: 'center' }}>Contacts</th>
              <th style={{ padding: '8px 12px', fontWeight: 600, textAlign: 'center' }}>Deals</th>
            </tr>
          </thead>
          <tbody>
            {clients.map(c => (
              <tr key={c.id} onClick={() => openDetail(c.id)} style={{ cursor: 'pointer', borderTop: '1px solid var(--rule-soft)' }}>
                <td style={{ padding: '8px 12px', fontWeight: 600 }}>{c.name}</td>
                <td style={{ padding: '8px 12px', color: 'var(--ink-3)' }}>{c.ref_no || '—'}</td>
                <td style={{ padding: '8px 12px', color: 'var(--ink-3)' }}>{c.gstin || '—'}</td>
                <td style={{ padding: '8px 12px', color: 'var(--ink-3)' }}>{c.website || '—'}</td>
                <td style={{ padding: '8px 12px', textAlign: 'center' }}>{c.contact_count}</td>
                <td style={{ padding: '8px 12px', textAlign: 'center' }}>{c.deal_count}</td>
              </tr>
            ))}
            {clients.length === 0 && (
              <tr><td colSpan={6} style={{ padding: 24, textAlign: 'center', color: 'var(--ink-3)', fontSize: 13 }}>No clients yet. Add your first company.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
