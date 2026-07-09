import React, { useState, useEffect } from 'react';
import { api } from '../lib/api';
import { useToast } from '../components/ui/toast';
import { PageHeader, StatTile } from '../components/editorial';

const INV_TYPE_LABELS = { tax_invoice: 'Tax Invoice', proforma: 'Proforma', credit_note: 'Credit Note', debit_note: 'Debit Note', quotation: 'Quotation' };
const STATUS_COLORS = { unpaid: '#f59e0b', partial: '#6366f1', paid: '#10b981', overdue: '#ef4444', cancelled: '#9ca3af' };
const PAY_METHODS = ['cash', 'bank_transfer', 'upi', 'cheque', 'card', 'other'];

function Badge({ text, color }) {
  return (
    <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.08em',
      padding: '2px 10px', borderRadius: 99, background: `${color}18`, color }}>{text}</span>
  );
}

const TABS = ['invoices', 'products', 'stats'];

export default function GanitPage() {
  const [tab, setTab] = useState('invoices');

  return (
    <div style={{ maxWidth: 1000, margin: '0 auto', padding: '0 24px 48px' }}>
      <PageHeader title="Ganit · गणित" subtitle="GST Invoicing — Tax Invoices, Quotations & Payments" />

      <div style={{ display: 'flex', gap: 4, marginBottom: 24, borderBottom: '1px solid var(--rule-soft)' }}>
        {TABS.map(t => (
          <button key={t} onClick={() => setTab(t)}
            style={{ padding: '8px 16px', fontSize: 13, fontWeight: tab === t ? 700 : 400,
              color: tab === t ? 'var(--k-primary)' : 'var(--ink-3)',
              borderBottom: tab === t ? '2px solid var(--k-primary)' : '2px solid transparent',
              background: 'none', border: 'none', cursor: 'pointer', textTransform: 'capitalize' }}>
            {t}
          </button>
        ))}
      </div>

      {tab === 'invoices' && <InvoicesTab />}
      {tab === 'products' && <ProductsTab />}
      {tab === 'stats' && <StatsTab />}
    </div>
  );
}


function InvoicesTab() {
  const { pushToast } = useToast();
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [typeFilter, setTypeFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [contacts, setContacts] = useState([]);
  const [products, setProducts] = useState([]);
  const [saving, setSaving] = useState(false);
  const [detail, setDetail] = useState(null);
  const [payForm, setPayForm] = useState({ amount: '', payment_method: 'bank_transfer', reference: '', notes: '' });
  const [showPay, setShowPay] = useState(false);

  const [form, setForm] = useState({
    contact_id: '', invoice_type: 'tax_invoice', invoice_date: '', due_date: '',
    place_of_supply: '', is_igst: false, notes: '', terms: 'Payment due within 30 days.', discount: 0,
    line_items: [{ description: '', hsn_code: '', quantity: 1, unit: 'NOS', rate: 0, gst_rate: 18, discount_pct: 0 }],
  });

  useEffect(() => { load(); }, []);

  async function load() {
    try {
      let url = '/v1/ganit/invoices?';
      if (typeFilter) url += `invoice_type=${typeFilter}&`;
      if (statusFilter) url += `payment_status=${statusFilter}&`;
      const r = await api.get(url);
      setInvoices(r.data.data || []);
    } catch { pushToast({ title: 'Failed to load invoices', type: 'error' }); }
    finally { setLoading(false); }
  }

  async function loadOptions() {
    try {
      const [c, p] = await Promise.all([
        api.get('/v1/graha/contacts'), api.get('/v1/ganit/products'),
      ]);
      setContacts(c.data.data || []);
      setProducts(p.data.data || []);
    } catch {}
  }

  function addLine() {
    setForm(f => ({ ...f, line_items: [...f.line_items, { description: '', hsn_code: '', quantity: 1, unit: 'NOS', rate: 0, gst_rate: 18, discount_pct: 0 }] }));
  }

  function updateLine(idx, field, val) {
    setForm(f => {
      const items = [...f.line_items];
      items[idx] = { ...items[idx], [field]: val };
      return { ...f, line_items: items };
    });
  }

  function removeLine(idx) {
    setForm(f => ({ ...f, line_items: f.line_items.filter((_, i) => i !== idx) }));
  }

  function fillFromProduct(idx, productId) {
    const p = products.find(x => x.id === productId);
    if (!p) return;
    updateLine(idx, 'description', p.name);
    updateLine(idx, 'hsn_code', p.hsn_code || p.sac_code || '');
    updateLine(idx, 'rate', Number(p.price));
    updateLine(idx, 'gst_rate', Number(p.gst_rate));
    updateLine(idx, 'unit', p.unit || 'NOS');
  }

  const computedSubtotal = form.line_items.reduce((s, li) => {
    let lt = li.quantity * li.rate;
    if (li.discount_pct > 0) lt *= (1 - li.discount_pct / 100);
    return s + lt;
  }, 0);
  const computedGst = form.line_items.reduce((s, li) => {
    let lt = li.quantity * li.rate;
    if (li.discount_pct > 0) lt *= (1 - li.discount_pct / 100);
    return s + lt * li.gst_rate / 100;
  }, 0);
  const computedTotal = computedSubtotal + computedGst - (form.discount || 0);

  async function save(e) {
    e.preventDefault();
    if (form.line_items.length === 0) { pushToast({ title: 'Add at least one line item', type: 'error' }); return; }
    setSaving(true);
    try {
      await api.post('/v1/ganit/invoices', form);
      pushToast({ title: 'Invoice created', type: 'success' });
      setShowForm(false);
      setForm({
        contact_id: '', invoice_type: 'tax_invoice', invoice_date: '', due_date: '',
        place_of_supply: '', is_igst: false, notes: '', terms: 'Payment due within 30 days.', discount: 0,
        line_items: [{ description: '', hsn_code: '', quantity: 1, unit: 'NOS', rate: 0, gst_rate: 18, discount_pct: 0 }],
      });
      load();
    } catch (err) { pushToast({ title: err.response?.data?.detail || 'Failed', type: 'error' }); }
    finally { setSaving(false); }
  }

  async function loadDetail(id) {
    try {
      const r = await api.get(`/v1/ganit/invoices/${id}`);
      setDetail(r.data);
    } catch { pushToast({ title: 'Failed to load invoice', type: 'error' }); }
  }

  async function recordPayment(e) {
    e.preventDefault();
    if (!detail) return;
    try {
      await api.post(`/v1/ganit/invoices/${detail.invoice.id}/payments`, {
        ...payForm, amount: parseFloat(payForm.amount) || 0,
      });
      pushToast({ title: 'Payment recorded', type: 'success' });
      setShowPay(false);
      setPayForm({ amount: '', payment_method: 'bank_transfer', reference: '', notes: '' });
      loadDetail(detail.invoice.id);
      load();
    } catch (err) { pushToast({ title: err.response?.data?.detail || 'Failed', type: 'error' }); }
  }

  if (detail) {
    const inv = detail.invoice;
    return (
      <div>
        <button className="k-btn k-btn--ghost" style={{ fontSize: 12, marginBottom: 12 }} onClick={() => setDetail(null)}>← Back to list</button>
        <div style={{ background: 'var(--surface-1)', border: '1px solid var(--rule-soft)', borderRadius: 12, padding: 24, marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
            <div>
              <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>{inv.invoice_number}</h3>
              <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--ink-2)' }}>
                {INV_TYPE_LABELS[inv.invoice_type] || inv.invoice_type} · {inv.invoice_date}
              </p>
            </div>
            <Badge text={inv.payment_status} color={STATUS_COLORS[inv.payment_status] || '#6E7B91'} />
          </div>

          {inv.contact_name && (
            <div style={{ fontSize: 13, color: 'var(--ink-2)', marginBottom: 16 }}>
              <strong>Bill To:</strong> {inv.contact_name} {inv.contact_company && `(${inv.contact_company})`}
              {inv.contact_gstin && <span> · GSTIN: {inv.contact_gstin}</span>}
            </div>
          )}

          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, marginBottom: 16 }}>
            <thead>
              <tr style={{ borderBottom: '2px solid var(--rule-soft)' }}>
                {['Description', 'HSN/SAC', 'Qty', 'Rate', 'GST%', 'Amount'].map(h => (
                  <th key={h} style={{ textAlign: h === 'Description' ? 'left' : 'right', padding: '8px 10px', fontWeight: 600, color: 'var(--ink-3)', fontSize: 11, textTransform: 'uppercase' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(inv.line_items || []).map((li, i) => (
                <tr key={i} style={{ borderBottom: '1px solid var(--rule-soft)' }}>
                  <td style={{ padding: '8px 10px' }}>{li.description}</td>
                  <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 12 }}>{li.hsn_code || li.sac_code || '—'}</td>
                  <td style={{ padding: '8px 10px', textAlign: 'right' }}>{li.quantity} {li.unit}</td>
                  <td style={{ padding: '8px 10px', textAlign: 'right' }}>₹{Number(li.rate).toLocaleString('en-IN')}</td>
                  <td style={{ padding: '8px 10px', textAlign: 'right' }}>{li.gst_rate}%</td>
                  <td style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 600 }}>₹{Number(li.line_total).toLocaleString('en-IN')}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <div style={{ width: 280, fontSize: 13 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}><span>Subtotal</span><span>₹{Number(inv.subtotal).toLocaleString('en-IN')}</span></div>
              {!inv.is_igst ? (
                <>
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', color: 'var(--ink-3)' }}><span>CGST</span><span>₹{Number(inv.cgst).toLocaleString('en-IN')}</span></div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', color: 'var(--ink-3)' }}><span>SGST</span><span>₹{Number(inv.sgst).toLocaleString('en-IN')}</span></div>
                </>
              ) : (
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', color: 'var(--ink-3)' }}><span>IGST</span><span>₹{Number(inv.igst).toLocaleString('en-IN')}</span></div>
              )}
              {Number(inv.discount) > 0 && <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', color: '#ef4444' }}><span>Discount</span><span>-₹{Number(inv.discount).toLocaleString('en-IN')}</span></div>}
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', fontWeight: 700, borderTop: '2px solid var(--rule-soft)', marginTop: 4 }}><span>Total</span><span>₹{Number(inv.total).toLocaleString('en-IN')}</span></div>
              {Number(inv.amount_paid) > 0 && <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', color: '#10b981' }}><span>Paid</span><span>₹{Number(inv.amount_paid).toLocaleString('en-IN')}</span></div>}
              {Number(inv.balance_due) > 0 && <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontWeight: 600, color: '#ef4444' }}><span>Balance Due</span><span>₹{Number(inv.balance_due).toLocaleString('en-IN')}</span></div>}
            </div>
          </div>

          {inv.payment_status !== 'paid' && inv.payment_status !== 'cancelled' && (
            <div style={{ marginTop: 16 }}>
              <button className="k-btn k-btn--primary" style={{ fontSize: 13 }} onClick={() => setShowPay(true)}>Record Payment</button>
            </div>
          )}
        </div>

        {showPay && (
          <form onSubmit={recordPayment} style={{ background: 'var(--surface-1)', border: '1px solid var(--k-primary)', borderRadius: 12, padding: 24, marginBottom: 16 }}>
            <h4 style={{ margin: '0 0 12px', fontSize: 14, fontWeight: 700 }}>Record Payment</h4>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Amount (₹) *</span>
                <input className="k-input" type="number" step="0.01" required value={payForm.amount} onChange={e => setPayForm({ ...payForm, amount: e.target.value })} /></label>
              <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Method</span>
                <select className="k-input" value={payForm.payment_method} onChange={e => setPayForm({ ...payForm, payment_method: e.target.value })}>
                  {PAY_METHODS.map(m => <option key={m} value={m}>{m.replace('_', ' ')}</option>)}
                </select></label>
              <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Reference</span>
                <input className="k-input" placeholder="e.g. UTR, cheque no" value={payForm.reference} onChange={e => setPayForm({ ...payForm, reference: e.target.value })} /></label>
              <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Notes</span>
                <input className="k-input" value={payForm.notes} onChange={e => setPayForm({ ...payForm, notes: e.target.value })} /></label>
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
              <button type="button" className="k-btn k-btn--ghost" onClick={() => setShowPay(false)}>Cancel</button>
              <button type="submit" className="k-btn k-btn--primary">Record</button>
            </div>
          </form>
        )}

        {detail.payments?.length > 0 && (
          <div style={{ background: 'var(--surface-1)', border: '1px solid var(--rule-soft)', borderRadius: 12, padding: 24 }}>
            <h4 style={{ margin: '0 0 12px', fontSize: 14, fontWeight: 700 }}>Payment History</h4>
            {detail.payments.map(p => (
              <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--rule-soft)', fontSize: 13 }}>
                <div>
                  <span style={{ fontWeight: 600 }}>₹{Number(p.amount).toLocaleString('en-IN')}</span>
                  <span style={{ marginLeft: 12, color: 'var(--ink-3)' }}>{p.payment_method?.replace('_', ' ')}</span>
                  {p.reference && <span style={{ marginLeft: 8, color: 'var(--ink-3)', fontFamily: 'var(--font-mono)', fontSize: 11 }}>{p.reference}</span>}
                </div>
                <span style={{ color: 'var(--ink-3)', fontSize: 12 }}>{p.payment_date}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center' }}>
        <select className="k-input" style={{ width: 140 }} value={typeFilter} onChange={e => setTypeFilter(e.target.value)}>
          <option value="">All Types</option>
          {Object.entries(INV_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select className="k-input" style={{ width: 130 }} value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
          <option value="">All Status</option>
          {Object.keys(STATUS_COLORS).map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <button className="k-btn k-btn--ghost" style={{ fontSize: 12 }} onClick={load}>Filter</button>
        <div style={{ flex: 1 }} />
        <button className="k-btn k-btn--primary" style={{ fontSize: 13 }} onClick={() => { setShowForm(true); loadOptions(); }}>+ New Invoice</button>
      </div>

      {showForm && (
        <form onSubmit={save} style={{ background: 'var(--surface-1)', border: '1px solid var(--rule-soft)', borderRadius: 12, padding: 24, marginBottom: 16 }}>
          <h3 style={{ margin: '0 0 12px', fontSize: 15, fontWeight: 700 }}>Create Invoice</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 16 }}>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Type</span>
              <select className="k-input" value={form.invoice_type} onChange={e => setForm({ ...form, invoice_type: e.target.value })}>
                {Object.entries(INV_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select></label>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Customer</span>
              <select className="k-input" value={form.contact_id} onChange={e => setForm({ ...form, contact_id: e.target.value })}>
                <option value="">Select…</option>
                {contacts.map(c => <option key={c.id} value={c.id}>{c.name} {c.company && `(${c.company})`}</option>)}
              </select></label>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Place of Supply</span>
              <input className="k-input" placeholder="e.g. Maharashtra" value={form.place_of_supply} onChange={e => setForm({ ...form, place_of_supply: e.target.value })} /></label>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Invoice Date</span>
              <input className="k-input" type="date" value={form.invoice_date} onChange={e => setForm({ ...form, invoice_date: e.target.value })} /></label>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Due Date</span>
              <input className="k-input" type="date" value={form.due_date} onChange={e => setForm({ ...form, due_date: e.target.value })} /></label>
            <label style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 8, paddingTop: 20 }}>
              <input type="checkbox" checked={form.is_igst} onChange={e => setForm({ ...form, is_igst: e.target.checked })} />
              <span style={{ fontWeight: 600 }}>Inter-state (IGST)</span></label>
          </div>

          <h4 style={{ margin: '0 0 8px', fontSize: 13, fontWeight: 700 }}>Line Items</h4>
          {form.line_items.map((li, i) => (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 60px 60px 1fr 60px 30px', gap: 6, marginBottom: 6, alignItems: 'end' }}>
              <div>
                {i === 0 && <span style={{ fontSize: 11, color: 'var(--ink-3)', display: 'block', marginBottom: 2 }}>Description</span>}
                <input className="k-input" style={{ fontSize: 12 }} placeholder="Item description" value={li.description} onChange={e => updateLine(i, 'description', e.target.value)} />
              </div>
              <div>
                {i === 0 && <span style={{ fontSize: 11, color: 'var(--ink-3)', display: 'block', marginBottom: 2 }}>HSN/SAC</span>}
                <input className="k-input" style={{ fontSize: 12 }} value={li.hsn_code} onChange={e => updateLine(i, 'hsn_code', e.target.value)} />
              </div>
              <div>
                {i === 0 && <span style={{ fontSize: 11, color: 'var(--ink-3)', display: 'block', marginBottom: 2 }}>Qty</span>}
                <input className="k-input" style={{ fontSize: 12 }} type="number" min="1" value={li.quantity} onChange={e => updateLine(i, 'quantity', parseFloat(e.target.value) || 1)} />
              </div>
              <div>
                {i === 0 && <span style={{ fontSize: 11, color: 'var(--ink-3)', display: 'block', marginBottom: 2 }}>Rate</span>}
                <input className="k-input" style={{ fontSize: 12 }} type="number" value={li.rate} onChange={e => updateLine(i, 'rate', parseFloat(e.target.value) || 0)} />
              </div>
              <div>
                {i === 0 && <span style={{ fontSize: 11, color: 'var(--ink-3)', display: 'block', marginBottom: 2 }}>Product</span>}
                <select className="k-input" style={{ fontSize: 12 }} onChange={e => fillFromProduct(i, e.target.value)}>
                  <option value="">Pick…</option>
                  {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
              <div>
                {i === 0 && <span style={{ fontSize: 11, color: 'var(--ink-3)', display: 'block', marginBottom: 2 }}>GST%</span>}
                <input className="k-input" style={{ fontSize: 12 }} type="number" value={li.gst_rate} onChange={e => updateLine(i, 'gst_rate', parseFloat(e.target.value) || 0)} />
              </div>
              <button type="button" onClick={() => removeLine(i)} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: 16, paddingBottom: 6 }}>×</button>
            </div>
          ))}
          <button type="button" className="k-btn k-btn--ghost" style={{ fontSize: 12, marginTop: 4 }} onClick={addLine}>+ Add Line</button>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'end', marginTop: 16 }}>
            <div style={{ fontSize: 13 }}>
              <label><span style={{ fontWeight: 600 }}>Flat Discount (₹): </span>
                <input className="k-input" type="number" style={{ width: 100 }} value={form.discount} onChange={e => setForm({ ...form, discount: parseFloat(e.target.value) || 0 })} /></label>
            </div>
            <div style={{ textAlign: 'right', fontSize: 13 }}>
              <div>Subtotal: ₹{computedSubtotal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</div>
              <div style={{ color: 'var(--ink-3)' }}>GST: ₹{computedGst.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</div>
              <div style={{ fontWeight: 700, fontSize: 15, marginTop: 4 }}>Total: ₹{computedTotal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
            <button type="button" className="k-btn k-btn--ghost" onClick={() => setShowForm(false)}>Cancel</button>
            <button type="submit" className="k-btn k-btn--primary" disabled={saving}>{saving ? 'Creating…' : 'Create Invoice'}</button>
          </div>
        </form>
      )}

      {loading ? <p style={{ color: 'var(--ink-3)', fontSize: 13, textAlign: 'center', padding: 24 }}>Loading…</p> :
        invoices.length === 0 ? <p style={{ color: 'var(--ink-3)', fontSize: 13, textAlign: 'center', padding: 24 }}>No invoices yet.</p> : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--rule-soft)' }}>
              {['Invoice #', 'Customer', 'Type', 'Date', 'Total', 'Paid', 'Due', 'Status'].map(h => (
                <th key={h} style={{ textAlign: h === 'Invoice #' || h === 'Customer' || h === 'Type' ? 'left' : 'right', padding: '8px 10px', fontWeight: 600, color: 'var(--ink-3)', fontSize: 11, textTransform: 'uppercase' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {invoices.map(inv => (
              <tr key={inv.id} style={{ borderBottom: '1px solid var(--rule-soft)', cursor: 'pointer' }} onClick={() => loadDetail(inv.id)}>
                <td style={{ padding: '10px', fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 600 }}>{inv.invoice_number}</td>
                <td style={{ padding: '10px' }}>{inv.contact_name || '—'}</td>
                <td style={{ padding: '10px' }}><Badge text={INV_TYPE_LABELS[inv.invoice_type] || inv.invoice_type} color="#0082c6" /></td>
                <td style={{ padding: '10px', textAlign: 'right', fontSize: 12 }}>{inv.invoice_date}</td>
                <td style={{ padding: '10px', textAlign: 'right', fontWeight: 600 }}>₹{Number(inv.total).toLocaleString('en-IN')}</td>
                <td style={{ padding: '10px', textAlign: 'right', color: '#10b981' }}>₹{Number(inv.amount_paid).toLocaleString('en-IN')}</td>
                <td style={{ padding: '10px', textAlign: 'right', color: Number(inv.balance_due) > 0 ? '#ef4444' : 'var(--ink-3)' }}>₹{Number(inv.balance_due).toLocaleString('en-IN')}</td>
                <td style={{ padding: '10px', textAlign: 'right' }}><Badge text={inv.payment_status} color={STATUS_COLORS[inv.payment_status] || '#6E7B91'} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}


function ProductsTab() {
  const { pushToast } = useToast();
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: '', hsn_code: '', sac_code: '', unit: 'NOS', price: '', gst_rate: 18, description: '', is_service: false });
  const [saving, setSaving] = useState(false);

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

  async function deleteProduct(id) {
    try {
      await api.delete(`/v1/ganit/products/${id}`);
      setProducts(prev => prev.filter(p => p.id !== id));
      pushToast({ title: 'Product deleted', type: 'success' });
    } catch { pushToast({ title: 'Delete failed', type: 'error' }); }
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
        products.length === 0 ? <p style={{ color: 'var(--ink-3)', fontSize: 13, textAlign: 'center', padding: 24 }}>No products yet.</p> : (
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
              <tr key={p.id} style={{ borderBottom: '1px solid var(--rule-soft)' }}>
                <td style={{ padding: '10px', fontWeight: 600 }}>{p.name}</td>
                <td style={{ padding: '10px', fontFamily: 'var(--font-mono)', fontSize: 12 }}>{p.hsn_code || p.sac_code || '—'}</td>
                <td style={{ padding: '10px' }}>{p.unit}</td>
                <td style={{ padding: '10px' }}>₹{Number(p.price).toLocaleString('en-IN')}</td>
                <td style={{ padding: '10px' }}>{Number(p.gst_rate)}%</td>
                <td style={{ padding: '10px' }}><Badge text={p.is_service ? 'Service' : 'Goods'} color={p.is_service ? '#6366f1' : '#0082c6'} /></td>
                <td style={{ padding: '10px' }}>
                  <button onClick={() => deleteProduct(p.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ef4444', fontSize: 11 }}>Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}


function StatsTab() {
  const { pushToast } = useToast();
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => { load(); }, []);

  async function load() {
    try {
      const r = await api.get('/v1/ganit/stats');
      setStats(r.data);
    } catch { pushToast({ title: 'Failed to load stats', type: 'error' }); }
    finally { setLoading(false); }
  }

  if (loading) return <p style={{ color: 'var(--ink-3)', fontSize: 13, textAlign: 'center', padding: 24 }}>Loading…</p>;
  if (!stats) return null;

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 }}>
      <StatTile label="Total Invoices" value={stats.total_invoices} />
      <StatTile label="Outstanding" value={`₹${Number(stats.total_outstanding).toLocaleString('en-IN')}`} />
      <StatTile label="Collected" value={`₹${Number(stats.total_collected).toLocaleString('en-IN')}`} />
      <StatTile label="Unpaid" value={stats.unpaid_count} />
      <StatTile label="Overdue" value={stats.overdue_count} />
    </div>
  );
}
