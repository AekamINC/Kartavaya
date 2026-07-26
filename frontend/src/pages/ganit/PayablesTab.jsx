import React, { useState, useEffect } from 'react';
import { api } from '../../lib/api';
import { useToast } from '../../components/ui/toast';
import { StatTile } from '../../components/editorial';
import { safeArray, Badge, BILL_STATUS_COLORS } from './_shared';
import { inr } from '../../lib/inr';

export default function PayablesTab() {
  const { pushToast } = useToast();
  const [bills, setBills] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [showVendorForm, setShowVendorForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [detail, setDetail] = useState(null);
  const [payAmount, setPayAmount] = useState('');
  const emptyLine = { description: '', hsn_code: '', quantity: 1, unit: 'NOS', rate: 0, gst_rate: 18, discount_pct: 0 };
  const [form, setForm] = useState({ vendor_id: '', bill_number: '', bill_date: '', due_date: '', is_igst: false, notes: '', line_items: [{ ...emptyLine }] });
  const [vendorForm, setVendorForm] = useState({ name: '', gstin: '', email: '', phone: '' });

  useEffect(() => { load(); loadVendors(); loadSummary(); }, [statusFilter]);

  async function load() {
    try {
      let url = '/v1/ganit/vendor-bills?';
      if (statusFilter) url += `status=${statusFilter}&`;
      const r = await api.get(url);
      setBills(r.data.data || []);
    } catch { pushToast({ title: 'Failed to load vendor bills', type: 'error' }); }
    finally { setLoading(false); }
  }

  async function loadVendors() {
    try { const r = await api.get('/v1/ganit/vendors'); setVendors(r.data.data || []); } catch {}
  }

  async function loadSummary() {
    try { const r = await api.get('/v1/ganit/payables-summary'); setSummary(r.data); } catch {}
  }

  async function saveVendor(e) {
    e.preventDefault();
    setSaving(true);
    try {
      const r = await api.post('/v1/ganit/vendors', vendorForm);
      pushToast({ title: 'Vendor added', type: 'success' });
      setShowVendorForm(false);
      setVendorForm({ name: '', gstin: '', email: '', phone: '' });
      await loadVendors();
      setForm(f => ({ ...f, vendor_id: r.data.id }));
    } catch (err) { pushToast({ title: err.response?.data?.detail || 'Failed', type: 'error' }); }
    finally { setSaving(false); }
  }

  function addLine() { setForm(f => ({ ...f, line_items: [...f.line_items, { ...emptyLine }] })); }
  function updateLine(idx, key, val) {
    setForm(f => {
      const items = [...f.line_items];
      items[idx] = { ...items[idx], [key]: val };
      return { ...f, line_items: items };
    });
  }
  function removeLine(idx) { setForm(f => ({ ...f, line_items: f.line_items.filter((_, i) => i !== idx) })); }

  async function saveBill(e) {
    e.preventDefault();
    if (!form.vendor_id) { pushToast({ title: 'Select a vendor', type: 'error' }); return; }
    setSaving(true);
    try {
      await api.post('/v1/ganit/vendor-bills', form);
      pushToast({ title: 'Vendor bill recorded', type: 'success' });
      setShowForm(false);
      setForm({ vendor_id: '', bill_number: '', bill_date: '', due_date: '', is_igst: false, notes: '', line_items: [{ ...emptyLine }] });
      load(); loadSummary();
    } catch (err) { pushToast({ title: err.response?.data?.detail || 'Failed', type: 'error' }); }
    finally { setSaving(false); }
  }

  async function loadDetail(id) {
    try { const r = await api.get(`/v1/ganit/vendor-bills/${id}`); setDetail(r.data); } catch { pushToast({ title: 'Failed to load', type: 'error' }); }
  }

  async function recordPayment() {
    const amt = parseFloat(payAmount);
    if (!amt || amt <= 0) { pushToast({ title: 'Enter a valid amount', type: 'error' }); return; }
    try {
      await api.post(`/v1/ganit/vendor-bills/${detail.id}/payments`, { amount: amt });
      pushToast({ title: 'Payment recorded', type: 'success' });
      setPayAmount('');
      loadDetail(detail.id); load(); loadSummary();
    } catch (err) { pushToast({ title: err.response?.data?.detail || 'Failed', type: 'error' }); }
  }

  const FMT = v => inr(Number(v || 0));

  if (detail) {
    return (
      <div>
        <button className="k-btn k-btn--ghost" style={{ fontSize: 12, marginBottom: 12 }} onClick={() => setDetail(null)}>← Back to list</button>
        <div style={{ background: 'var(--surface-1)', border: '1px solid var(--rule-soft)', borderRadius: 'var(--r-md)', padding: 24, marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <div>
              <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>{detail.internal_ref}</h3>
              <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--ink-2)' }}>{detail.vendor_name} · {detail.bill_date} {detail.due_date && `· Due ${detail.due_date}`}</p>
            </div>
            <Badge text={detail.status} color={BILL_STATUS_COLORS[detail.status]} />
          </div>
          <div style={{ display: 'flex', gap: 20, fontSize: 13, marginBottom: 12 }}>
            <span>Total: <strong style={{ fontFamily: 'var(--font-mono)' }}>{FMT(detail.total)}</strong></span>
            <span>Paid: <strong style={{ fontFamily: 'var(--font-mono)' }}>{FMT(detail.amount_paid)}</strong></span>
            <span>Balance: <strong style={{ fontFamily: 'var(--font-mono)' }}>{FMT(detail.total - detail.amount_paid)}</strong></span>
          </div>
          {detail.status !== 'paid' && detail.status !== 'cancelled' && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input className="k-input" type="number" placeholder="Amount" value={payAmount} onChange={e => setPayAmount(e.target.value)} style={{ width: 140 }} />
              <button className="k-btn k-btn--primary" style={{ fontSize: 12 }} onClick={recordPayment}>Record Payment</button>
            </div>
          )}
        </div>

        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead><tr style={{ borderBottom: '1px solid var(--rule-soft)', textAlign: 'left' }}>
            <th style={{ padding: 8 }}>Description</th><th style={{ padding: 8 }}>Qty</th><th style={{ padding: 8 }}>Rate</th><th style={{ padding: 8 }}>GST%</th><th style={{ padding: 8 }}>Line Total</th>
          </tr></thead>
          <tbody>
            {safeArray(detail.line_items).map((li, i) => (
              <tr key={i} style={{ borderBottom: '1px solid var(--rule-soft)' }}>
                <td style={{ padding: 8 }}>{li.description}</td>
                <td style={{ padding: 8 }}>{li.quantity} {li.unit}</td>
                <td style={{ padding: 8 }}>{FMT(li.rate)}</td>
                <td style={{ padding: 8 }}>{li.gst_rate}%</td>
                <td style={{ padding: 8 }}>{FMT(li.line_total)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {detail.payments.length > 0 && (
          <div style={{ marginTop: 20 }}>
            <h4 style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>Payment History</h4>
            {detail.payments.map(p => (
              <div key={p.id} style={{ fontSize: 12, color: 'var(--ink-2)', padding: '4px 0' }}>
                {p.payment_date} · {FMT(p.amount)} · {p.method}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div>
      {summary && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 16, marginBottom: 20 }}>
          <StatTile label="Outstanding" value={FMT(summary.outstanding)} />
          <StatTile label="Overdue" value={FMT(summary.overdue)} />
          <StatTile label="Open Bills" value={summary.open_bills} />
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center', flexWrap: 'wrap' }}>
        <select className="k-input" style={{ width: 150 }} value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
          <option value="">All Status</option>
          {['unpaid', 'partially_paid', 'paid', 'cancelled'].map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <div style={{ flex: 1 }} />
        <button className="k-btn k-btn--ghost" style={{ fontSize: 13 }} onClick={() => setShowVendorForm(true)}>+ Vendor</button>
        <button className="k-btn k-btn--primary" style={{ fontSize: 13 }} onClick={() => setShowForm(true)}>+ Vendor Bill</button>
      </div>

      {showVendorForm && (
        <form onSubmit={saveVendor} style={{ background: 'var(--surface-1)', border: '1px solid var(--rule-soft)', borderRadius: 'var(--r-md)', padding: 24, marginBottom: 16 }}>
          <h4 style={{ margin: '0 0 12px', fontSize: 14, fontWeight: 700 }}>New Vendor</h4>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Name *</span>
              <input className="k-input" required value={vendorForm.name} onChange={e => setVendorForm({ ...vendorForm, name: e.target.value })} /></label>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>GSTIN</span>
              <input className="k-input" value={vendorForm.gstin} onChange={e => setVendorForm({ ...vendorForm, gstin: e.target.value })} /></label>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Email</span>
              <input className="k-input" type="email" value={vendorForm.email} onChange={e => setVendorForm({ ...vendorForm, email: e.target.value })} /></label>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Phone</span>
              <input className="k-input" value={vendorForm.phone} onChange={e => setVendorForm({ ...vendorForm, phone: e.target.value })} /></label>
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
            <button type="button" className="k-btn k-btn--ghost" onClick={() => setShowVendorForm(false)}>Cancel</button>
            <button type="submit" className="k-btn k-btn--primary" disabled={saving}>{saving ? 'Saving…' : 'Save Vendor'}</button>
          </div>
        </form>
      )}

      {showForm && (
        <form onSubmit={saveBill} style={{ background: 'var(--surface-1)', border: '1px solid var(--rule-soft)', borderRadius: 'var(--r-md)', padding: 24, marginBottom: 16 }}>
          <h4 style={{ margin: '0 0 12px', fontSize: 14, fontWeight: 700 }}>New Vendor Bill</h4>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 12 }}>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Vendor *</span>
              <select className="k-input" required value={form.vendor_id} onChange={e => setForm({ ...form, vendor_id: e.target.value })}>
                <option value="">Select…</option>
                {vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
              </select></label>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Vendor's Bill No.</span>
              <input className="k-input" value={form.bill_number} onChange={e => setForm({ ...form, bill_number: e.target.value })} /></label>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Bill Date</span>
              <input className="k-input" type="date" value={form.bill_date} onChange={e => setForm({ ...form, bill_date: e.target.value })} /></label>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Due Date</span>
              <input className="k-input" type="date" value={form.due_date} onChange={e => setForm({ ...form, due_date: e.target.value })} /></label>
            <label style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 6, marginTop: 18 }}>
              <input type="checkbox" checked={form.is_igst} onChange={e => setForm({ ...form, is_igst: e.target.checked })} /> IGST (inter-state)</label>
          </div>

          {form.line_items.map((li, i) => (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr auto', gap: 8, marginBottom: 8, alignItems: 'center' }}>
              <input className="k-input" placeholder="Description" required value={li.description} onChange={e => updateLine(i, 'description', e.target.value)} />
              <input className="k-input" type="number" placeholder="Qty" value={li.quantity} onChange={e => updateLine(i, 'quantity', parseFloat(e.target.value) || 0)} />
              <input className="k-input" type="number" placeholder="Rate" value={li.rate} onChange={e => updateLine(i, 'rate', parseFloat(e.target.value) || 0)} />
              <input className="k-input" type="number" placeholder="GST%" value={li.gst_rate} onChange={e => updateLine(i, 'gst_rate', parseFloat(e.target.value) || 0)} />
              <input className="k-input" placeholder="HSN/SAC" value={li.hsn_code} onChange={e => updateLine(i, 'hsn_code', e.target.value)} />
              <button type="button" className="k-btn k-btn--ghost" style={{ fontSize: 11 }} onClick={() => removeLine(i)} disabled={form.line_items.length === 1}>✕</button>
            </div>
          ))}
          <button type="button" className="k-btn k-btn--ghost" style={{ fontSize: 12, marginBottom: 12 }} onClick={addLine}>+ Add Line</button>

          <label style={{ fontSize: 13, display: 'block', marginBottom: 12 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Notes</span>
            <textarea className="k-input" rows={2} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} style={{ resize: 'vertical', width: '100%' }} /></label>

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button type="button" className="k-btn k-btn--ghost" onClick={() => setShowForm(false)}>Cancel</button>
            <button type="submit" className="k-btn k-btn--primary" disabled={saving}>{saving ? 'Saving…' : 'Save Bill'}</button>
          </div>
        </form>
      )}

      {loading ? <p style={{ color: 'var(--ink-3)', fontSize: 13, textAlign: 'center', padding: 24 }}>Loading…</p> :
        bills.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '48px 24px' }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>📋</div>
            <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>No vendor bills yet</div>
            <div style={{ fontSize: 13, color: 'var(--ink-3)', maxWidth: 300, margin: '0 auto' }}>Record bills from your vendors and suppliers to track payables.</div>
          </div>
        ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {bills.map(b => (
            <div key={b.id} onClick={() => loadDetail(b.id)} style={{ cursor: 'pointer', background: 'var(--surface-1)', border: '1px solid var(--rule-soft)', borderRadius: 'var(--r-md)', padding: '12px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <span style={{ fontWeight: 700, fontSize: 14 }}>{b.vendor_name}</span>
                <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--ink-3)' }}>{b.internal_ref}</span>
                <p style={{ margin: '3px 0 0', fontSize: 12, color: 'var(--ink-3)' }}>{b.bill_date} {b.due_date && `· Due ${b.due_date}`}</p>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{FMT(b.total)}</span>
                <Badge text={b.status} color={BILL_STATUS_COLORS[b.status]} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
