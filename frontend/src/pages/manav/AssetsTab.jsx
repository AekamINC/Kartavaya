import React, { useState, useEffect } from 'react';
import { api } from '../../lib/api';
import { useToast } from '../../components/ui/toast';
import { Badge, ASSET_CATEGORIES, ASSET_CONDITIONS, CATEGORY_COLORS, CONDITION_COLORS } from './_shared';

export default function AssetsTab() {
  const { pushToast } = useToast();
  const [assets, setAssets] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [catFilter, setCatFilter] = useState('');
  const [assigningId, setAssigningId] = useState(null);
  const [assignEmployee, setAssignEmployee] = useState('');
  const [editingAsset, setEditingAsset] = useState(null);
  const [editAssetForm, setEditAssetForm] = useState({});
  const [editAssetSaving, setEditAssetSaving] = useState(false);
  const [form, setForm] = useState({
    asset_tag: '', name: '', category: 'laptop', serial_number: '',
    purchase_date: '', purchase_cost: '', condition: 'new', notes: '',
  });

  useEffect(() => { load(); loadEmployees(); }, []);

  async function load() {
    try {
      const r = await api.get('/v1/manav/assets');
      setAssets(r.data.data || []);
    } catch { pushToast({ title: 'Failed to load assets', type: 'error' }); }
    finally { setLoading(false); }
  }

  async function loadEmployees() {
    try {
      const r = await api.get('/v1/manav/employees');
      setEmployees(r.data.data || r.data || []);
    } catch {}
  }

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post('/v1/manav/assets', { ...form, purchase_cost: parseFloat(form.purchase_cost) || 0 });
      pushToast({ title: 'Asset created', type: 'success' });
      setShowForm(false);
      setForm({ asset_tag: '', name: '', category: 'laptop', serial_number: '', purchase_date: '', purchase_cost: '', condition: 'new', notes: '' });
      load();
    } catch (err) { pushToast({ title: err.response?.data?.detail || 'Failed', type: 'error' }); }
    finally { setSaving(false); }
  }

  async function remove(id) {
    try {
      await api.delete(`/v1/manav/assets/${id}`);
      pushToast({ title: 'Asset removed', type: 'success' });
      setAssets(prev => prev.filter(a => a.id !== id));
    } catch { pushToast({ title: 'Could not remove asset', type: 'error' }); }
  }

  async function assign(id) {
    if (!assignEmployee) return;
    try {
      await api.post(`/v1/manav/assets/${id}/assign`, { employee_id: assignEmployee });
      pushToast({ title: 'Asset assigned', type: 'success' });
      setAssigningId(null);
      setAssignEmployee('');
      load();
    } catch (err) { pushToast({ title: err.response?.data?.detail || 'Assign failed', type: 'error' }); }
  }

  async function returnAsset(id) {
    try {
      await api.post(`/v1/manav/assets/${id}/return`);
      pushToast({ title: 'Asset returned', type: 'success' });
      load();
    } catch (err) { pushToast({ title: err.response?.data?.detail || 'Return failed', type: 'error' }); }
  }

  function startEditAsset(a) {
    setEditingAsset(a.id);
    setEditAssetForm({
      name: a.name || '', category: a.category || 'laptop', serial_number: a.serial_number || '',
      condition: a.condition || 'new', notes: a.notes || '',
      purchase_cost: a.purchase_cost || '', purchase_date: a.purchase_date || '',
    });
  }

  async function saveEditAsset(e) {
    e.preventDefault();
    setEditAssetSaving(true);
    try {
      await api.patch(`/v1/manav/assets/${editingAsset}`, editAssetForm);
      pushToast({ title: 'Asset updated', type: 'success' });
      setEditingAsset(null);
      load();
    } catch (err) { pushToast({ title: err.response?.data?.detail || 'Could not update asset', type: 'error' }); }
    finally { setEditAssetSaving(false); }
  }

  const filtered = catFilter ? assets.filter(a => a.category === catFilter) : assets;

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center', flexWrap: 'wrap' }}>
        <select className="k-input" style={{ width: 140 }} value={catFilter} onChange={e => setCatFilter(e.target.value)}>
          <option value="">All Categories</option>
          {ASSET_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <div style={{ flex: 1 }} />
        <button className="k-btn k-btn--primary" style={{ fontSize: 13 }} onClick={() => setShowForm(true)}>+ New Asset</button>
      </div>

      {showForm && (
        <form onSubmit={save} style={{ background: 'var(--surface-1)', border: '1px solid var(--rule-soft)', borderRadius: 12, padding: 24, marginBottom: 16 }}>
          <h3 style={{ margin: '0 0 12px', fontSize: 15, fontWeight: 700 }}>New Asset</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Asset Tag *</span>
              <input className="k-input" required placeholder="e.g. AST-001" value={form.asset_tag} onChange={e => setForm({ ...form, asset_tag: e.target.value })} /></label>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Name *</span>
              <input className="k-input" required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></label>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Category</span>
              <select className="k-input" value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}>
                {ASSET_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select></label>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Serial Number</span>
              <input className="k-input" value={form.serial_number} onChange={e => setForm({ ...form, serial_number: e.target.value })} /></label>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Purchase Date</span>
              <input className="k-input" type="date" value={form.purchase_date} onChange={e => setForm({ ...form, purchase_date: e.target.value })} /></label>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Purchase Cost</span>
              <input className="k-input" type="number" placeholder="0" value={form.purchase_cost} onChange={e => setForm({ ...form, purchase_cost: e.target.value })} /></label>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Condition</span>
              <select className="k-input" value={form.condition} onChange={e => setForm({ ...form, condition: e.target.value })}>
                {ASSET_CONDITIONS.map(c => <option key={c} value={c}>{c}</option>)}
              </select></label>
            <label style={{ fontSize: 13, gridColumn: '2 / -1' }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Notes</span>
              <input className="k-input" value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} /></label>
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
            <button type="button" className="k-btn k-btn--ghost" onClick={() => setShowForm(false)}>Cancel</button>
            <button type="submit" className="k-btn k-btn--primary" disabled={saving}>{saving ? 'Creating…' : 'Create Asset'}</button>
          </div>
        </form>
      )}

      {loading ? <p style={{ color: 'var(--ink-3)', fontSize: 13, textAlign: 'center', padding: 24 }}>Loading…</p> :
        filtered.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '48px 24px' }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>💻</div>
            <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>No assets found</div>
            <div style={{ fontSize: 13, color: 'var(--ink-3)', maxWidth: 300, margin: '0 auto' }}>Track company assets like laptops, phones, and equipment assigned to employees.</div>
          </div>
        ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--rule-soft)' }}>
              {['Tag', 'Name', 'Category', 'Condition', 'Assigned To', 'Actions'].map(h => (
                <th key={h} style={{ textAlign: 'left', padding: '8px 10px', fontWeight: 600, color: 'var(--ink-3)', fontSize: 11, textTransform: 'uppercase' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map(a => (
              <React.Fragment key={a.id}>
                <tr style={{ borderBottom: '1px solid var(--rule-soft)' }}>
                  <td style={{ padding: '10px', fontFamily: 'var(--font-mono)', fontSize: 12 }}>{a.asset_tag || '—'}</td>
                  <td style={{ padding: '10px', fontWeight: 600 }}>{a.name}</td>
                  <td style={{ padding: '10px' }}><Badge text={a.category} color={CATEGORY_COLORS[a.category] || '#6b7280'} /></td>
                  <td style={{ padding: '10px' }}><Badge text={a.condition} color={CONDITION_COLORS[a.condition] || '#6b7280'} /></td>
                  <td style={{ padding: '10px', color: a.employee_name ? 'var(--ink-1)' : 'var(--ink-3)' }}>{a.employee_name || '—'}</td>
                  <td style={{ padding: '10px' }}>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                      <button className="k-btn k-btn--ghost" style={{ fontSize: 11, padding: '2px 8px' }} onClick={() => startEditAsset(a)}>Edit</button>
                      {a.assigned_to ? (
                        <button className="k-btn k-btn--ghost" style={{ fontSize: 11, padding: '2px 8px' }} onClick={() => returnAsset(a.id)}>Return</button>
                      ) : (
                        assigningId === a.id ? (
                          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                            <select className="k-input" style={{ fontSize: 11, padding: '2px 6px', width: 140 }} value={assignEmployee}
                              onChange={e => setAssignEmployee(e.target.value)}>
                              <option value="">Select…</option>
                              {employees.map(emp => <option key={emp.id} value={emp.id}>{emp.name}</option>)}
                            </select>
                            <button className="k-btn k-btn--primary" style={{ fontSize: 11, padding: '2px 8px' }} onClick={() => assign(a.id)}>OK</button>
                            <button className="k-btn k-btn--ghost" style={{ fontSize: 11, padding: '2px 8px' }} onClick={() => { setAssigningId(null); setAssignEmployee(''); }}>X</button>
                          </div>
                        ) : (
                          <button className="k-btn k-btn--ghost" style={{ fontSize: 11, padding: '2px 8px' }} onClick={() => setAssigningId(a.id)}>Assign</button>
                        )
                      )}
                      <button className="k-btn k-btn--ghost" style={{ fontSize: 11, padding: '2px 8px', color: '#ef4444' }} onClick={() => remove(a.id)}>Delete</button>
                    </div>
                  </td>
                </tr>
                {editingAsset === a.id && (
                  <tr><td colSpan={6} style={{ padding: '0 10px 10px' }}>
                    <form onSubmit={saveEditAsset} style={{ background: 'var(--surface-0)', border: '1px solid var(--rule-soft)', borderRadius: 8, padding: 16 }}>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
                        <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Name</span>
                          <input className="k-input" value={editAssetForm.name} onChange={e => setEditAssetForm({ ...editAssetForm, name: e.target.value })} /></label>
                        <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Category</span>
                          <select className="k-input" value={editAssetForm.category} onChange={e => setEditAssetForm({ ...editAssetForm, category: e.target.value })}>
                            {ASSET_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                          </select></label>
                        <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Serial Number</span>
                          <input className="k-input" value={editAssetForm.serial_number} onChange={e => setEditAssetForm({ ...editAssetForm, serial_number: e.target.value })} /></label>
                        <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Condition</span>
                          <select className="k-input" value={editAssetForm.condition} onChange={e => setEditAssetForm({ ...editAssetForm, condition: e.target.value })}>
                            {ASSET_CONDITIONS.map(c => <option key={c} value={c}>{c}</option>)}
                          </select></label>
                        <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Purchase Date</span>
                          <input className="k-input" type="date" value={editAssetForm.purchase_date} onChange={e => setEditAssetForm({ ...editAssetForm, purchase_date: e.target.value })} /></label>
                        <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Purchase Cost</span>
                          <input className="k-input" type="number" placeholder="0" value={editAssetForm.purchase_cost} onChange={e => setEditAssetForm({ ...editAssetForm, purchase_cost: e.target.value })} /></label>
                        <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Notes</span>
                          <input className="k-input" value={editAssetForm.notes} onChange={e => setEditAssetForm({ ...editAssetForm, notes: e.target.value })} /></label>
                      </div>
                      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
                        <button type="button" className="k-btn k-btn--ghost" onClick={() => setEditingAsset(null)}>Cancel</button>
                        <button type="submit" className="k-btn k-btn--primary" disabled={editAssetSaving}>{editAssetSaving ? 'Saving…' : 'Save'}</button>
                      </div>
                    </form>
                  </td></tr>
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
