import React, { useState, useEffect } from 'react';
import { api } from '../../lib/api';
import { useToast } from '../../components/ui/toast';
import { Badge } from './_shared';

export default function ProductsTab() {
  const { pushToast } = useToast();
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: '', hsn_code: '', sac_code: '', unit: 'NOS', price: '', gst_rate: 18, description: '', is_service: false });
  const [saving, setSaving] = useState(false);
  const [editProduct, setEditProduct] = useState(null);
  const [editForm, setEditForm] = useState({});
  const [editSaving, setEditSaving] = useState(false);

  useEffect(() => { load(); }, []);

  async function load() {
    try {
      const r = await api.get('/v1/ganit/products');
      setProducts(r.data.data || []);
    } catch { pushToast({ title: 'Failed to load products', type: 'error' }); }
    finally { setLoading(false); }
  }

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post('/v1/ganit/products', { ...form, price: parseFloat(form.price) || 0 });
      pushToast({ title: 'Product created', type: 'success' });
      setShowForm(false);
      setForm({ name: '', hsn_code: '', sac_code: '', unit: 'NOS', price: '', gst_rate: 18, description: '', is_service: false });
      load();
    } catch (err) { pushToast({ title: err.response?.data?.detail || 'Failed', type: 'error' }); }
    finally { setSaving(false); }
  }

  function startEdit(p) {
    setEditProduct(p.id);
    setEditForm({ name: p.name || '', hsn_code: p.hsn_code || '', sac_code: p.sac_code || '', unit: p.unit || 'NOS', price: p.price ?? '', gst_rate: p.gst_rate ?? 18, description: p.description || '', is_service: !!p.is_service });
  }

  async function saveEdit(e) {
    e.preventDefault();
    setEditSaving(true);
    try {
      await api.patch(`/v1/ganit/products/${editProduct}`, { ...editForm, price: parseFloat(editForm.price) || 0 });
      pushToast({ title: 'Product updated', type: 'success' });
      setEditProduct(null);
      load();
    } catch (err) { pushToast({ title: err.response?.data?.detail || 'Could not update product', type: 'error' }); }
    finally { setEditSaving(false); }
  }

  async function deleteProduct(id) {
    try {
      await api.delete(`/v1/ganit/products/${id}`);
      setProducts(prev => prev.filter(p => p.id !== id));
      pushToast({ title: 'Product deleted', type: 'success' });
    } catch { pushToast({ title: 'Could not delete product', type: 'error' }); }
  }

  return (
    <div>
      <button className="k-btn k-btn--primary" style={{ fontSize: 13, marginBottom: 16 }} onClick={() => setShowForm(true)}>+ Add Product / Service</button>

      {showForm && (
        <form onSubmit={save} style={{ background: 'var(--surface-1)', border: '1px solid var(--rule-soft)', borderRadius: 12, padding: 24, marginBottom: 16 }}>
          <h3 style={{ margin: '0 0 12px', fontSize: 15, fontWeight: 700 }}>New Product / Service</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Name *</span>
              <input className="k-input" required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></label>
            <label style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 8, paddingTop: 20 }}>
              <input type="checkbox" checked={form.is_service} onChange={e => setForm({ ...form, is_service: e.target.checked })} />
              <span style={{ fontWeight: 600 }}>This is a Service</span></label>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>HSN Code</span>
              <input className="k-input" placeholder="For goods" value={form.hsn_code} onChange={e => setForm({ ...form, hsn_code: e.target.value })} /></label>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>SAC Code</span>
              <input className="k-input" placeholder="For services" value={form.sac_code} onChange={e => setForm({ ...form, sac_code: e.target.value })} /></label>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Unit</span>
              <input className="k-input" value={form.unit} onChange={e => setForm({ ...form, unit: e.target.value })} /></label>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Price (₹)</span>
              <input className="k-input" type="number" step="0.01" value={form.price} onChange={e => setForm({ ...form, price: e.target.value })} /></label>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>GST Rate (%)</span>
              <select className="k-input" value={form.gst_rate} onChange={e => setForm({ ...form, gst_rate: parseFloat(e.target.value) })}>
                {[0, 5, 12, 18, 28].map(r => <option key={r} value={r}>{r}%</option>)}
              </select></label>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Description</span>
              <input className="k-input" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} /></label>
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
            <button type="button" className="k-btn k-btn--ghost" onClick={() => setShowForm(false)}>Cancel</button>
            <button type="submit" className="k-btn k-btn--primary" disabled={saving}>{saving ? 'Saving…' : 'Create'}</button>
          </div>
        </form>
      )}

      {loading ? <p style={{ color: 'var(--ink-3)', fontSize: 13, textAlign: 'center', padding: 24 }}>Loading…</p> :
        products.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '48px 24px' }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>📦</div>
            <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>No products yet</div>
            <div style={{ fontSize: 13, color: 'var(--ink-3)', maxWidth: 300, margin: '0 auto' }}>Add your products and services with HSN codes and GST rates to speed up invoicing.</div>
          </div>
        ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--rule-soft)' }}>
              {['Name', 'HSN/SAC', 'Unit', 'Price', 'GST', 'Type', ''].map(h => (
                <th key={h} style={{ textAlign: 'left', padding: '8px 10px', fontWeight: 600, color: 'var(--ink-3)', fontSize: 11, textTransform: 'uppercase' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {products.map(p => (
              <React.Fragment key={p.id}>
              <tr style={{ borderBottom: '1px solid var(--rule-soft)' }}>
                <td style={{ padding: '10px', fontWeight: 600 }}>
                  <span style={{ cursor: 'pointer', color: 'var(--k-primary)', textDecoration: 'underline', textDecorationStyle: 'dotted' }} onClick={() => startEdit(p)}>{p.name}</span>
                </td>
                <td style={{ padding: '10px', fontFamily: 'var(--font-mono)', fontSize: 12 }}>{p.hsn_code || p.sac_code || '—'}</td>
                <td style={{ padding: '10px' }}>{p.unit}</td>
                <td style={{ padding: '10px' }}>₹{Number(p.price).toLocaleString('en-IN')}</td>
                <td style={{ padding: '10px' }}>{Number(p.gst_rate)}%</td>
                <td style={{ padding: '10px' }}><Badge text={p.is_service ? 'Service' : 'Goods'} color={p.is_service ? '#6366f1' : '#0082c6'} /></td>
                <td style={{ padding: '10px', display: 'flex', gap: 8 }}>
                  <button onClick={() => startEdit(p)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--k-primary)', fontSize: 11 }}>Edit</button>
                  <button onClick={() => deleteProduct(p.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ef4444', fontSize: 11 }}>Delete</button>
                </td>
              </tr>
              {editProduct === p.id && (
                <tr><td colSpan={7} style={{ padding: 0 }}>
                  <form onSubmit={saveEdit} style={{ background: 'var(--surface-1)', border: '1px solid var(--rule-soft)', borderRadius: 8, padding: 16, margin: '4px 0 8px' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                      <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Name *</span>
                        <input className="k-input" required value={editForm.name} onChange={e => setEditForm({ ...editForm, name: e.target.value })} /></label>
                      <label style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 8, paddingTop: 20 }}>
                        <input type="checkbox" checked={editForm.is_service} onChange={e => setEditForm({ ...editForm, is_service: e.target.checked })} />
                        <span style={{ fontWeight: 600 }}>This is a Service</span></label>
                      <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>HSN Code</span>
                        <input className="k-input" value={editForm.hsn_code} onChange={e => setEditForm({ ...editForm, hsn_code: e.target.value })} /></label>
                      <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>SAC Code</span>
                        <input className="k-input" value={editForm.sac_code} onChange={e => setEditForm({ ...editForm, sac_code: e.target.value })} /></label>
                      <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Unit</span>
                        <input className="k-input" value={editForm.unit} onChange={e => setEditForm({ ...editForm, unit: e.target.value })} /></label>
                      <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Price</span>
                        <input className="k-input" type="number" step="0.01" value={editForm.price} onChange={e => setEditForm({ ...editForm, price: e.target.value })} /></label>
                      <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>GST Rate (%)</span>
                        <select className="k-input" value={editForm.gst_rate} onChange={e => setEditForm({ ...editForm, gst_rate: parseFloat(e.target.value) })}>
                          {[0, 5, 12, 18, 28].map(r => <option key={r} value={r}>{r}%</option>)}
                        </select></label>
                      <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Description</span>
                        <input className="k-input" value={editForm.description} onChange={e => setEditForm({ ...editForm, description: e.target.value })} /></label>
                    </div>
                    <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
                      <button type="button" className="k-btn k-btn--ghost" onClick={() => setEditProduct(null)}>Cancel</button>
                      <button type="submit" className="k-btn k-btn--primary" disabled={editSaving}>{editSaving ? 'Saving…' : 'Save'}</button>
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
