import React, { useState, useEffect } from 'react';
import { api } from '../../lib/api';
import { useToast } from '../../components/ui/toast';
import { Badge } from './_shared';
import { inr } from '../../lib/inr';

export default function RecurringTab() {
  const { pushToast } = useToast();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [contacts, setContacts] = useState([]);
  const [form, setForm] = useState({ contact_id: '', frequency: 'monthly', next_date: '', end_date: '', auto_send: false, notes: '',
    template_items: [{ description: '', quantity: 1, rate: 0, gst_rate: 18 }], subtotal: 0, gst_rate: 18, is_igst: false });
  const [saving, setSaving] = useState(false);

  useEffect(() => { load(); }, []);

  async function load() {
    try {
      const r = await api.get('/v1/ganit/recurring');
      setItems(r.data.data || []);
    } catch { pushToast({ title: 'Failed to load recurring', type: 'error' }); }
    finally { setLoading(false); }
  }

  async function loadContacts() {
    try {
      const r = await api.get('/v1/graha/contacts');
      setContacts(r.data.data || []);
    } catch {}
  }

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    const subtotal = form.template_items.reduce((s, li) => s + (li.quantity * li.rate), 0);
    try {
      await api.post('/v1/ganit/recurring', { ...form, subtotal });
      pushToast({ title: 'Recurring invoice created', type: 'success' });
      setShowForm(false);
      load();
    } catch (err) { pushToast({ title: err.response?.data?.detail || 'Failed', type: 'error' }); }
    finally { setSaving(false); }
  }

  async function deactivate(id) {
    try {
      await api.delete(`/v1/ganit/recurring/${id}`);
      pushToast({ title: 'Deactivated', type: 'success' });
      load();
    } catch { pushToast({ title: 'Could not deactivate schedule', type: 'error' }); }
  }

  async function generateNow(id) {
    try {
      const r = await api.post(`/v1/ganit/recurring/${id}/generate`);
      pushToast({ title: `Invoice ${r.data.invoice_number} generated`, type: 'success' });
      load();
    } catch (err) { pushToast({ title: err.response?.data?.detail || 'Generation failed', type: 'error' }); }
  }

  return (
    <div>
      <button className="k-btn k-btn--primary" style={{ fontSize: 13, marginBottom: 16 }} onClick={() => { setShowForm(true); loadContacts(); }}>
        + New Recurring Invoice
      </button>

      {showForm && (
        <form onSubmit={save} style={{ background: 'var(--surface-1)', border: '1px solid var(--rule-soft)', borderRadius: 'var(--r-md)', padding: 24, marginBottom: 16 }}>
          <h3 style={{ margin: '0 0 12px', fontSize: 15, fontWeight: 700 }}>Recurring Invoice</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 16 }}>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Contact</span>
              <select className="k-input" value={form.contact_id} onChange={e => setForm({ ...form, contact_id: e.target.value })}>
                <option value="">None</option>
                {contacts.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select></label>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Frequency *</span>
              <select className="k-input" value={form.frequency} onChange={e => setForm({ ...form, frequency: e.target.value })}>
                {['weekly', 'monthly', 'quarterly', 'yearly'].map(f => <option key={f} value={f}>{f}</option>)}
              </select></label>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Next Date *</span>
              <input className="k-input" type="date" required value={form.next_date} onChange={e => setForm({ ...form, next_date: e.target.value })} /></label>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>End Date</span>
              <input className="k-input" type="date" value={form.end_date} onChange={e => setForm({ ...form, end_date: e.target.value })} /></label>
            <label style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 8, paddingTop: 20 }}>
              <input type="checkbox" checked={form.auto_send} onChange={e => setForm({ ...form, auto_send: e.target.checked })} />
              <span style={{ fontWeight: 600 }}>Auto-send</span></label>
            <label style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 8, paddingTop: 20 }}>
              <input type="checkbox" checked={form.is_igst} onChange={e => setForm({ ...form, is_igst: e.target.checked })} />
              <span style={{ fontWeight: 600 }}>IGST</span></label>
          </div>
          <h4 style={{ margin: '0 0 8px', fontSize: 13, fontWeight: 700 }}>Template Items</h4>
          {form.template_items.map((li, i) => (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: '2fr 60px 80px 60px 30px', gap: 6, marginBottom: 6 }}>
              <input className="k-input" style={{ fontSize: 12 }} placeholder="Description" value={li.description}
                onChange={e => { const items = [...form.template_items]; items[i] = { ...items[i], description: e.target.value }; setForm({ ...form, template_items: items }); }} />
              <input className="k-input" style={{ fontSize: 12 }} type="number" min="1" placeholder="Qty" value={li.quantity}
                onChange={e => { const items = [...form.template_items]; items[i] = { ...items[i], quantity: parseFloat(e.target.value) || 1 }; setForm({ ...form, template_items: items }); }} />
              <input className="k-input" style={{ fontSize: 12 }} type="number" placeholder="Rate" value={li.rate}
                onChange={e => { const items = [...form.template_items]; items[i] = { ...items[i], rate: parseFloat(e.target.value) || 0 }; setForm({ ...form, template_items: items }); }} />
              <input className="k-input" style={{ fontSize: 12 }} type="number" placeholder="GST%" value={li.gst_rate}
                onChange={e => { const items = [...form.template_items]; items[i] = { ...items[i], gst_rate: parseFloat(e.target.value) || 18 }; setForm({ ...form, template_items: items }); }} />
              <button type="button" onClick={() => setForm({ ...form, template_items: form.template_items.filter((_, j) => j !== i) })}
                style={{ background: 'none', border: 'none', color: 'var(--danger)', cursor: 'pointer', fontSize: 16 }}>×</button>
            </div>
          ))}
          <button type="button" className="k-btn k-btn--ghost" style={{ fontSize: 12 }}
            onClick={() => setForm({ ...form, template_items: [...form.template_items, { description: '', quantity: 1, rate: 0, gst_rate: 18 }] })}>+ Add Item</button>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
            <button type="button" className="k-btn k-btn--ghost" onClick={() => setShowForm(false)}>Cancel</button>
            <button type="submit" className="k-btn k-btn--primary" disabled={saving}>{saving ? 'Creating…' : 'Create'}</button>
          </div>
        </form>
      )}

      {loading ? <p style={{ color: 'var(--ink-3)', fontSize: 13, textAlign: 'center', padding: 24 }}>Loading…</p> :
        items.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '48px 24px' }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>🔄</div>
            <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>No recurring invoices</div>
            <div style={{ fontSize: 13, color: 'var(--ink-3)', maxWidth: 300, margin: '0 auto' }}>Set up auto-generated invoices for retainers, subscriptions, or monthly services.</div>
          </div>
        ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {items.map(r => (
            <div key={r.id} style={{ background: 'var(--surface-1)', border: '1px solid var(--rule-soft)', borderRadius: 'var(--r-md)', padding: '12px 16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                <div>
                  <Badge text={r.frequency} color="var(--st-in-progress)" />
                  {r.contact_name && <span style={{ marginLeft: 8, fontSize: 13, fontWeight: 600 }}>{r.contact_name}</span>}
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <span style={{ fontWeight: 700, fontSize: 14 }}>{inr(Number(r.subtotal || 0))}</span>
                  <Badge text={r.is_active ? 'Active' : 'Inactive'} color={r.is_active ? 'var(--ok)' : 'var(--on-surface-3)'} />
                </div>
              </div>
              <div style={{ fontSize: 12, color: 'var(--ink-3)', display: 'flex', justifyContent: 'space-between' }}>
                <span>Next: {r.next_date} {r.end_date && `· Ends: ${r.end_date}`} {r.auto_send && '· Auto-send'}</span>
                {r.is_active && (
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button className="k-btn k-btn--primary" style={{ fontSize: 11, padding: '2px 10px' }} onClick={() => generateNow(r.id)}>Generate Now</button>
                    <button className="k-btn k-btn--ghost" style={{ fontSize: 11, color: 'var(--danger)', padding: '2px 8px' }} onClick={() => deactivate(r.id)}>Deactivate</button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
