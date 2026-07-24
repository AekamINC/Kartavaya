import React, { useState, useEffect } from 'react';
import { api } from '../lib/api';
import { useToast } from '../components/ui/toast';
import { PageHeader, StatTile } from '../components/editorial';
import { EmptyState } from '../components/ui/EmptyState';

const INV_TYPE_LABELS = { tax_invoice: 'Tax Invoice', proforma: 'Proforma', credit_note: 'Credit Note', debit_note: 'Debit Note', quotation: 'Quotation' };
const STATUS_COLORS = { unpaid: '#f59e0b', partial: '#6366f1', paid: '#10b981', overdue: '#ef4444', cancelled: '#9ca3af' };
const DOC_STATUS_COLORS = { draft: '#6E7B91', final: '#0082c6', sent: '#8b5cf6', viewed: '#10b981' };
const CONTRACT_COLORS = { draft: '#6E7B91', active: '#10b981', expired: '#f59e0b', cancelled: '#ef4444', renewed: '#0082c6' };
const PAY_METHODS = ['cash', 'bank_transfer', 'upi', 'cheque', 'card', 'other'];

function safeArray(v) {
  if (Array.isArray(v)) return v;
  if (typeof v === 'string') try { const p = JSON.parse(v); if (Array.isArray(p)) return p; } catch {}
  return [];
}

function UpiPayBlock({ invoice }) {
  const [upiId, setUpiId] = useState(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    api.get('/v1/org/profile').then(r => {
      const id = r.data?.bank_details?.upi_id;
      if (id) setUpiId(id);
    }).catch(() => {});
  }, []);
  if (!upiId || invoice.payment_status === 'paid' || invoice.payment_status === 'cancelled') return null;
  const amount = Number(invoice.balance_due || invoice.total || 0);
  if (amount <= 0) return null;
  const orgName = invoice.org_name || 'Merchant';
  const upiLink = `upi://pay?pa=${encodeURIComponent(upiId)}&pn=${encodeURIComponent(orgName)}&am=${amount.toFixed(2)}&cu=INR&tn=${encodeURIComponent(`Payment for ${invoice.invoice_number}`)}`;
  return (
    <div style={{ marginTop: 16, background: 'color-mix(in srgb, var(--surface) 82%, transparent)', backdropFilter: 'blur(12px)', border: '1px solid var(--rule-soft)', borderRadius: 12, padding: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <span style={{ fontSize: 20 }}>💳</span>
        <h4 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>UPI Payment Link</h4>
        <span style={{ fontFamily: 'var(--font-hindi)', fontSize: 12, color: 'var(--ink-3)' }}>यूपीआई भुगतान</span>
      </div>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ fontSize: 12, color: 'var(--ink-3)', marginBottom: 4 }}>Pay ₹{amount.toLocaleString('en-IN')} to</div>
          <div style={{ fontSize: 14, fontWeight: 600, fontFamily: 'var(--font-mono)' }}>{upiId}</div>
          <div style={{ fontSize: 11, color: 'var(--ink-faint)', marginTop: 4 }}>Ref: {invoice.invoice_number}</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <a href={upiLink} className="k-btn k-btn--primary" style={{ fontSize: 12, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            Open in UPI App
          </a>
          <button className="k-btn k-btn--ghost" style={{ fontSize: 12 }}
            onClick={() => { navigator.clipboard.writeText(upiLink).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); }); }}>
            {copied ? '✓ Copied' : 'Copy Link'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Badge({ text, color }) {
  return (
    <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.08em',
      padding: '2px 10px', borderRadius: 99, background: `${color}18`, color }}>{text}</span>
  );
}

const TABS = ['invoices', 'products', 'expenses', 'payables', 'contracts', 'e-sign', 'recurring', 'bank', 'timesheet', 'stats'];
const BILL_STATUS_COLORS = { unpaid: '#f59e0b', partially_paid: '#6366f1', paid: '#10b981', cancelled: '#9ca3af' };
const SIGN_STATUS_COLORS = { pending: '#f59e0b', otp_sent: '#6366f1', signed: '#10b981', expired: '#9ca3af', cancelled: '#ef4444' };

export default function GanitPage() {
  const [tab, setTab] = useState('invoices');

  return (
    <div style={{ padding: '0 0 48px' }}>
      <PageHeader title="Ganit · गणित" subtitle="GST Invoicing — Tax Invoices, Quotations & Payments" />

      <div style={{ display: 'flex', gap: 4, marginBottom: 24, borderBottom: '1px solid var(--rule-soft)', overflowX: 'auto' }}>
        {TABS.map(t => (
          <button key={t} onClick={() => setTab(t)}
            style={{ padding: '8px 16px', fontSize: 13, fontWeight: tab === t ? 700 : 400,
              color: tab === t ? 'var(--k-primary)' : 'var(--ink-3)',
              borderBottom: tab === t ? '2px solid var(--k-primary)' : '2px solid transparent',
              background: 'none', border: 'none', cursor: 'pointer', textTransform: 'capitalize', whiteSpace: 'nowrap' }}>
            {t}
          </button>
        ))}
      </div>

      {tab === 'invoices' && <InvoicesTab />}
      {tab === 'products' && <ProductsTab />}
      {tab === 'expenses' && <ExpensesTab />}
      {tab === 'payables' && <PayablesTab />}
      {tab === 'contracts' && <ContractsTab />}
      {tab === 'e-sign' && <ESignTab />}
      {tab === 'recurring' && <RecurringTab />}
      {tab === 'bank' && <BankTab />}
      {tab === 'timesheet' && <TimesheetTab />}
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
    place_of_supply: '', is_igst: false, is_export: false, currency: 'INR',
    notes: '', terms: 'Payment due within 30 days.', discount: 0,
    line_items: [{ description: '', hsn_code: '', quantity: 1, unit: 'NOS', rate: 0, gst_rate: 18, discount_pct: 0 }],
  });
  const [downloading, setDownloading] = useState(false);

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
        place_of_supply: '', is_igst: false, is_export: false, currency: 'INR',
        notes: '', terms: 'Payment due within 30 days.', discount: 0,
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

  async function updateDocStatus(newStatus) {
    if (!detail) return;
    try {
      await api.patch(`/v1/ganit/invoices/${detail.invoice.id}/status`, { doc_status: newStatus });
      pushToast({ title: `Status → ${newStatus}`, type: 'success' });
      loadDetail(detail.invoice.id);
    } catch (err) { pushToast({ title: err.response?.data?.detail || 'Failed', type: 'error' }); }
  }

  async function acceptEstimate() {
    if (!detail) return;
    try {
      await api.post(`/v1/ganit/invoices/${detail.invoice.id}/accept-estimate`);
      pushToast({ title: 'Estimate accepted', type: 'success' });
      loadDetail(detail.invoice.id);
    } catch (err) { pushToast({ title: err.response?.data?.detail || 'Failed', type: 'error' }); }
  }

  async function convertToInvoice() {
    if (!detail) return;
    try {
      const r = await api.post(`/v1/ganit/invoices/${detail.invoice.id}/convert-to-invoice`);
      pushToast({ title: `Converted → ${r.data.invoice_number}`, type: 'success' });
      setDetail(null);
      load();
    } catch (err) { pushToast({ title: err.response?.data?.detail || 'Failed', type: 'error' }); }
  }

  async function downloadPdf() {
    if (!detail) return;
    setDownloading(true);
    try {
      const res = await api.get(`/v1/ganit/invoices/${detail.invoice.id}/pdf`, { responseType: 'blob' });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url; a.download = `${detail.invoice.invoice_number}.pdf`; a.click();
      URL.revokeObjectURL(url);
    } catch (err) { pushToast({ title: 'Failed to generate PDF', type: 'error' }); }
    finally { setDownloading(false); }
  }

  if (detail) {
    const inv = detail.invoice;
    const nextDocStatus = { draft: 'final', final: 'sent', sent: 'viewed' };
    const nextLabel = { draft: 'Mark Final', final: 'Mark Sent', sent: 'Mark Viewed' };
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
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              {inv.doc_status && <Badge text={inv.doc_status} color={DOC_STATUS_COLORS[inv.doc_status] || '#6E7B91'} />}
              <Badge text={inv.payment_status} color={STATUS_COLORS[inv.payment_status] || '#6E7B91'} />
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
            <button className="k-btn k-btn--primary" style={{ fontSize: 12 }} onClick={downloadPdf} disabled={downloading}>
              {downloading ? 'Generating…' : '⬇ Download PDF'}
            </button>
            {nextDocStatus[inv.doc_status] && (
              <button className="k-btn k-btn--primary" style={{ fontSize: 12 }}
                onClick={() => updateDocStatus(nextDocStatus[inv.doc_status])}>
                {nextLabel[inv.doc_status]}
              </button>
            )}
            {inv.invoice_type === 'quotation' && inv.estimate_status !== 'accepted' && inv.estimate_status !== 'converted' && (
              <button className="k-btn k-btn--primary" style={{ fontSize: 12 }} onClick={acceptEstimate}>Accept Estimate</button>
            )}
            {inv.invoice_type === 'quotation' && inv.estimate_status === 'accepted' && (
              <button className="k-btn k-btn--primary" style={{ fontSize: 12, background: '#10b981' }} onClick={convertToInvoice}>Convert to Invoice</button>
            )}
            {inv.estimate_status && <Badge text={`Estimate: ${inv.estimate_status}`} color={inv.estimate_status === 'accepted' ? '#10b981' : inv.estimate_status === 'rejected' ? '#ef4444' : '#6E7B91'} />}
            {inv.converted_invoice_id && (
              <button className="k-btn k-btn--ghost" style={{ fontSize: 12 }}
                onClick={() => { setDetail(null); setTimeout(() => loadDetail(inv.converted_invoice_id), 100); }}>
                View Converted Invoice →
              </button>
            )}
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
              {safeArray(inv.line_items).map((li, i) => (
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

          <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 12, display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            {inv.sent_at && <span>Sent: {new Date(inv.sent_at).toLocaleString('en-IN')}</span>}
            {inv.viewed_at && <span>Viewed: {new Date(inv.viewed_at).toLocaleString('en-IN')}</span>}
            {inv.recurring_id && <span>Recurring: <Badge text="Auto-generated" color="#0082c6" /></span>}
          </div>

          {inv.payment_status !== 'paid' && inv.payment_status !== 'cancelled' && (
            <div style={{ marginTop: 16 }}>
              <button className="k-btn k-btn--primary" style={{ fontSize: 13 }} onClick={() => setShowPay(true)}>Record Payment</button>
            </div>
          )}

          <UpiPayBlock invoice={inv} />
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
              <input type="checkbox" checked={form.is_igst} onChange={e => setForm({ ...form, is_igst: e.target.checked })}
                disabled={form.is_export} />
              <span style={{ fontWeight: 600 }}>Inter-state (IGST)</span></label>
            <label style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 8, paddingTop: 20 }}>
              <input type="checkbox" checked={form.is_export}
                onChange={e => setForm({ ...form, is_export: e.target.checked, currency: e.target.checked ? form.currency : 'INR' })} />
              <span style={{ fontWeight: 600 }}>Foreign / Export Invoice</span></label>
            {form.is_export && (
              <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Currency</span>
                <select className="k-input" value={form.currency} onChange={e => setForm({ ...form, currency: e.target.value })}>
                  {['USD', 'EUR', 'GBP', 'AED', 'SGD', 'INR'].map(c => <option key={c} value={c}>{c}</option>)}
                </select></label>
            )}
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
        invoices.length === 0 ? (
          <EmptyState
            illustration="invoice"
            title={{ en: 'No invoices yet', hi: 'कोई बीजक नहीं' }}
            description="Create your first invoice to start tracking payments. Add products first if you haven't already."
            action="Create Invoice"
            onAction={() => { setShowForm(true); loadOptions(); }}
          />
        ) : (
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


function ExpensesTab() {
  const { pushToast } = useToast();
  const [expenses, setExpenses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [categories, setCategories] = useState([]);
  const [catFilter, setCatFilter] = useState('');
  const [expStats, setExpStats] = useState(null);
  const [form, setForm] = useState({ title: '', category: 'general', amount: '', tax_amount: 0, expense_date: '', vendor: '', reference: '', notes: '', is_billable: false });
  const [saving, setSaving] = useState(false);
  const [showCatForm, setShowCatForm] = useState(false);
  const [catForm, setCatForm] = useState({ name: '', icon: '📁' });
  const [editExpense, setEditExpense] = useState(null);
  const [editForm, setEditForm] = useState({});
  const [editSaving, setEditSaving] = useState(false);

  useEffect(() => { load(); loadCategories(); loadStats(); }, []);

  async function load() {
    try {
      let url = '/v1/ganit/expenses?';
      if (catFilter) url += `category=${encodeURIComponent(catFilter)}&`;
      const r = await api.get(url);
      setExpenses(r.data.data || []);
    } catch { pushToast({ title: 'Failed to load expenses', type: 'error' }); }
    finally { setLoading(false); }
  }

  async function loadCategories() {
    try {
      const r = await api.get('/v1/ganit/expense-categories');
      setCategories(r.data.data || []);
    } catch {}
  }

  async function loadStats() {
    try {
      const r = await api.get('/v1/ganit/expense-stats');
      setExpStats(r.data);
    } catch {}
  }

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    const amt = parseFloat(form.amount) || 0;
    const tax = parseFloat(form.tax_amount) || 0;
    try {
      await api.post('/v1/ganit/expenses', { ...form, amount: amt, tax_amount: tax, total: amt + tax });
      pushToast({ title: 'Expense recorded', type: 'success' });
      setShowForm(false);
      setForm({ title: '', category: 'general', amount: '', tax_amount: 0, expense_date: '', vendor: '', reference: '', notes: '', is_billable: false });
      load();
      loadStats();
    } catch (err) { pushToast({ title: err.response?.data?.detail || 'Failed', type: 'error' }); }
    finally { setSaving(false); }
  }

  async function deleteExpense(id) {
    try {
      await api.delete(`/v1/ganit/expenses/${id}`);
      setExpenses(prev => prev.filter(x => x.id !== id));
      pushToast({ title: 'Expense deleted', type: 'success' });
      loadStats();
    } catch { pushToast({ title: 'Could not delete expense', type: 'error' }); }
  }

  function startEditExpense(ex) {
    setEditExpense(ex.id);
    setEditForm({ title: ex.title || '', category: ex.category || 'general', amount: ex.amount ?? '', tax_amount: ex.tax_amount ?? 0, expense_date: ex.expense_date || '', vendor: ex.vendor || '', reference: ex.reference || '', notes: ex.notes || '', is_billable: !!ex.is_billable });
  }

  async function saveEditExpense(e) {
    e.preventDefault();
    setEditSaving(true);
    try {
      const amt = parseFloat(editForm.amount) || 0;
      const tax = parseFloat(editForm.tax_amount) || 0;
      await api.patch(`/v1/ganit/expenses/${editExpense}`, { ...editForm, amount: amt, tax_amount: tax, total: amt + tax });
      pushToast({ title: 'Expense updated', type: 'success' });
      setEditExpense(null);
      load(); loadStats();
    } catch (err) { pushToast({ title: err.response?.data?.detail || 'Could not update expense', type: 'error' }); }
    finally { setEditSaving(false); }
  }

  async function saveCat(e) {
    e.preventDefault();
    try {
      await api.post('/v1/ganit/expense-categories', catForm);
      pushToast({ title: 'Category created', type: 'success' });
      setShowCatForm(false);
      setCatForm({ name: '', icon: '📁' });
      loadCategories();
    } catch (err) { pushToast({ title: err.response?.data?.detail || 'Failed', type: 'error' }); }
  }

  return (
    <div>
      {expStats && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16, marginBottom: 20 }}>
          <StatTile label="Total Expenses" value={`₹${Number(expStats.total_amount || 0).toLocaleString('en-IN')}`} />
          <StatTile label="This Month" value={`₹${Number(expStats.this_month || 0).toLocaleString('en-IN')}`} />
          <StatTile label="Billable" value={`₹${Number(expStats.billable_amount || 0).toLocaleString('en-IN')}`} />
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center' }}>
        <select className="k-input" style={{ width: 150 }} value={catFilter} onChange={e => setCatFilter(e.target.value)}>
          <option value="">All Categories</option>
          {categories.map(c => <option key={c.id} value={c.name}>{c.icon} {c.name}</option>)}
        </select>
        <button className="k-btn k-btn--ghost" style={{ fontSize: 12 }} onClick={load}>Filter</button>
        <div style={{ flex: 1 }} />
        <button className="k-btn k-btn--ghost" style={{ fontSize: 13 }} onClick={() => setShowCatForm(true)}>+ Category</button>
        <button className="k-btn k-btn--primary" style={{ fontSize: 13 }} onClick={() => setShowForm(true)}>+ Add Expense</button>
      </div>

      {showCatForm && (
        <form onSubmit={saveCat} style={{ background: 'var(--surface-1)', border: '1px solid var(--rule-soft)', borderRadius: 12, padding: 24, marginBottom: 16 }}>
          <h4 style={{ margin: '0 0 12px', fontSize: 14, fontWeight: 700 }}>New Category</h4>
          <div style={{ display: 'flex', gap: 12 }}>
            <label style={{ fontSize: 13, flex: 1 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Name *</span>
              <input className="k-input" required value={catForm.name} onChange={e => setCatForm({ ...catForm, name: e.target.value })} /></label>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Icon</span>
              <input className="k-input" style={{ width: 60 }} value={catForm.icon} onChange={e => setCatForm({ ...catForm, icon: e.target.value })} /></label>
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
            <button type="button" className="k-btn k-btn--ghost" onClick={() => setShowCatForm(false)}>Cancel</button>
            <button type="submit" className="k-btn k-btn--primary">Create</button>
          </div>
        </form>
      )}

      {showForm && (
        <form onSubmit={save} style={{ background: 'var(--surface-1)', border: '1px solid var(--rule-soft)', borderRadius: 12, padding: 24, marginBottom: 16 }}>
          <h3 style={{ margin: '0 0 12px', fontSize: 15, fontWeight: 700 }}>Record Expense</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Title *</span>
              <input className="k-input" required value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} /></label>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Category</span>
              <select className="k-input" value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}>
                <option value="general">General</option>
                {categories.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
              </select></label>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Date *</span>
              <input className="k-input" type="date" required value={form.expense_date} onChange={e => setForm({ ...form, expense_date: e.target.value })} /></label>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Amount (₹) *</span>
              <input className="k-input" type="number" step="0.01" required value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} /></label>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Tax (₹)</span>
              <input className="k-input" type="number" step="0.01" value={form.tax_amount} onChange={e => setForm({ ...form, tax_amount: e.target.value })} /></label>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Vendor</span>
              <input className="k-input" value={form.vendor} onChange={e => setForm({ ...form, vendor: e.target.value })} /></label>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Reference</span>
              <input className="k-input" value={form.reference} onChange={e => setForm({ ...form, reference: e.target.value })} /></label>
            <label style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 8, paddingTop: 20 }}>
              <input type="checkbox" checked={form.is_billable} onChange={e => setForm({ ...form, is_billable: e.target.checked })} />
              <span style={{ fontWeight: 600 }}>Billable</span></label>
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
            <button type="button" className="k-btn k-btn--ghost" onClick={() => setShowForm(false)}>Cancel</button>
            <button type="submit" className="k-btn k-btn--primary" disabled={saving}>{saving ? 'Saving…' : 'Record'}</button>
          </div>
        </form>
      )}

      {loading ? <p style={{ color: 'var(--ink-3)', fontSize: 13, textAlign: 'center', padding: 24 }}>Loading…</p> :
        expenses.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '48px 24px' }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>💸</div>
            <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>No expenses recorded</div>
            <div style={{ fontSize: 13, color: 'var(--ink-3)', maxWidth: 300, margin: '0 auto' }}>Log business expenses here to track spending and generate reports.</div>
          </div>
        ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--rule-soft)' }}>
              {['Date', 'Title', 'Category', 'Vendor', 'Amount', 'Tax', 'Total', 'Billable', ''].map(h => (
                <th key={h} style={{ textAlign: ['Amount', 'Tax', 'Total'].includes(h) ? 'right' : 'left', padding: '8px 10px', fontWeight: 600, color: 'var(--ink-3)', fontSize: 11, textTransform: 'uppercase' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {expenses.map(ex => (
              <React.Fragment key={ex.id}>
              <tr style={{ borderBottom: '1px solid var(--rule-soft)' }}>
                <td style={{ padding: '10px', fontSize: 12 }}>{ex.expense_date}</td>
                <td style={{ padding: '10px', fontWeight: 600 }}>
                  <span style={{ cursor: 'pointer', color: 'var(--k-primary)', textDecoration: 'underline', textDecorationStyle: 'dotted' }} onClick={() => startEditExpense(ex)}>{ex.title}</span>
                </td>
                <td style={{ padding: '10px' }}><Badge text={ex.category} color="#6366f1" /></td>
                <td style={{ padding: '10px', color: 'var(--ink-2)' }}>{ex.vendor || '—'}</td>
                <td style={{ padding: '10px', textAlign: 'right' }}>₹{Number(ex.amount).toLocaleString('en-IN')}</td>
                <td style={{ padding: '10px', textAlign: 'right', color: 'var(--ink-3)' }}>₹{Number(ex.tax_amount || 0).toLocaleString('en-IN')}</td>
                <td style={{ padding: '10px', textAlign: 'right', fontWeight: 600 }}>₹{Number(ex.total).toLocaleString('en-IN')}</td>
                <td style={{ padding: '10px' }}>{ex.is_billable ? <Badge text="Yes" color="#10b981" /> : '—'}</td>
                <td style={{ padding: '10px', display: 'flex', gap: 8 }}>
                  <button onClick={() => startEditExpense(ex)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--k-primary)', fontSize: 11 }}>Edit</button>
                  <button onClick={() => deleteExpense(ex.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ef4444', fontSize: 11 }}>Delete</button>
                </td>
              </tr>
              {editExpense === ex.id && (
                <tr><td colSpan={9} style={{ padding: 0 }}>
                  <form onSubmit={saveEditExpense} style={{ background: 'var(--surface-1)', border: '1px solid var(--rule-soft)', borderRadius: 8, padding: 16, margin: '4px 0 8px' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
                      <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Title *</span>
                        <input className="k-input" required value={editForm.title} onChange={e => setEditForm({ ...editForm, title: e.target.value })} /></label>
                      <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Category</span>
                        <select className="k-input" value={editForm.category} onChange={e => setEditForm({ ...editForm, category: e.target.value })}>
                          <option value="general">General</option>
                          {categories.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
                        </select></label>
                      <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Date *</span>
                        <input className="k-input" type="date" required value={editForm.expense_date} onChange={e => setEditForm({ ...editForm, expense_date: e.target.value })} /></label>
                      <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Amount</span>
                        <input className="k-input" type="number" step="0.01" required value={editForm.amount} onChange={e => setEditForm({ ...editForm, amount: e.target.value })} /></label>
                      <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Tax</span>
                        <input className="k-input" type="number" step="0.01" value={editForm.tax_amount} onChange={e => setEditForm({ ...editForm, tax_amount: e.target.value })} /></label>
                      <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Vendor</span>
                        <input className="k-input" value={editForm.vendor} onChange={e => setEditForm({ ...editForm, vendor: e.target.value })} /></label>
                      <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Reference</span>
                        <input className="k-input" value={editForm.reference} onChange={e => setEditForm({ ...editForm, reference: e.target.value })} /></label>
                      <label style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 8, paddingTop: 20 }}>
                        <input type="checkbox" checked={editForm.is_billable} onChange={e => setEditForm({ ...editForm, is_billable: e.target.checked })} />
                        <span style={{ fontWeight: 600 }}>Billable</span></label>
                    </div>
                    <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
                      <button type="button" className="k-btn k-btn--ghost" onClick={() => setEditExpense(null)}>Cancel</button>
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


function PayablesTab() {
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

  const FMT = v => `₹${Number(v || 0).toLocaleString('en-IN')}`;

  if (detail) {
    return (
      <div>
        <button className="k-btn k-btn--ghost" style={{ fontSize: 12, marginBottom: 12 }} onClick={() => setDetail(null)}>← Back to list</button>
        <div style={{ background: 'var(--surface-1)', border: '1px solid var(--rule-soft)', borderRadius: 12, padding: 24, marginBottom: 16 }}>
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
        <form onSubmit={saveVendor} style={{ background: 'var(--surface-1)', border: '1px solid var(--rule-soft)', borderRadius: 12, padding: 24, marginBottom: 16 }}>
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
        <form onSubmit={saveBill} style={{ background: 'var(--surface-1)', border: '1px solid var(--rule-soft)', borderRadius: 12, padding: 24, marginBottom: 16 }}>
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
            <div key={b.id} onClick={() => loadDetail(b.id)} style={{ cursor: 'pointer', background: 'var(--surface-1)', border: '1px solid var(--rule-soft)', borderRadius: 10, padding: '12px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
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


function ContractsTab() {
  const { pushToast } = useToast();
  const [contracts, setContracts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [statusFilter, setStatusFilter] = useState('');
  const [contacts, setContacts] = useState([]);
  const [detail, setDetail] = useState(null);
  const [form, setForm] = useState({ title: '', contact_id: '', description: '', contract_value: '', start_date: '', end_date: '', renewal_reminder_days: 30, notes: '' });
  const [saving, setSaving] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [editForm, setEditForm] = useState({});
  const [editSaving, setEditSaving] = useState(false);

  useEffect(() => { load(); }, []);

  async function load() {
    try {
      let url = '/v1/ganit/contracts?';
      if (statusFilter) url += `status=${statusFilter}&`;
      const r = await api.get(url);
      setContracts(r.data.data || []);
    } catch { pushToast({ title: 'Failed to load contracts', type: 'error' }); }
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
    try {
      await api.post('/v1/ganit/contracts', { ...form, contract_value: parseFloat(form.contract_value) || 0 });
      pushToast({ title: 'Contract created', type: 'success' });
      setShowForm(false);
      setForm({ title: '', contact_id: '', description: '', contract_value: '', start_date: '', end_date: '', renewal_reminder_days: 30, notes: '' });
      load();
    } catch (err) { pushToast({ title: err.response?.data?.detail || 'Failed', type: 'error' }); }
    finally { setSaving(false); }
  }

  async function updateStatus(id, status) {
    try {
      await api.patch(`/v1/ganit/contracts/${id}`, { status });
      pushToast({ title: `Contract → ${status}`, type: 'success' });
      load();
      if (detail) loadDetail(id);
    } catch (err) { pushToast({ title: err.response?.data?.detail || 'Failed', type: 'error' }); }
  }

  async function loadDetail(id) {
    try {
      const r = await api.get(`/v1/ganit/contracts/${id}`);
      setDetail(r.data);
      setEditMode(false);
    } catch { pushToast({ title: 'Failed to load contract', type: 'error' }); }
  }

  function startEditContract(c) {
    setEditForm({ title: c.title || '', contact_id: c.contact_id || '', description: c.description || '', contract_value: c.contract_value ?? '', start_date: c.start_date || '', end_date: c.end_date || '', renewal_reminder_days: c.renewal_reminder_days ?? 30, notes: c.notes || '' });
    setEditMode(true);
    loadContacts();
  }

  async function saveEditContract(e) {
    e.preventDefault();
    setEditSaving(true);
    try {
      await api.patch(`/v1/ganit/contracts/${detail.contract.id}`, { ...editForm, contract_value: parseFloat(editForm.contract_value) || 0 });
      pushToast({ title: 'Contract updated', type: 'success' });
      setEditMode(false);
      loadDetail(detail.contract.id);
      load();
    } catch (err) { pushToast({ title: err.response?.data?.detail || 'Could not update contract', type: 'error' }); }
    finally { setEditSaving(false); }
  }

  if (detail) {
    const c = detail.contract;
    return (
      <div>
        <button className="k-btn k-btn--ghost" style={{ fontSize: 12, marginBottom: 12 }} onClick={() => setDetail(null)}>← Back to list</button>
        <div style={{ background: 'var(--surface-1)', border: '1px solid var(--rule-soft)', borderRadius: 12, padding: 24, marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <div>
              <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>{c.title}</h3>
              {c.contact_name && <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--ink-2)' }}>{c.contact_name}</p>}
            </div>
            <Badge text={c.status} color={CONTRACT_COLORS[c.status] || '#6E7B91'} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, fontSize: 13 }}>
            <div><strong>Value:</strong> ₹{Number(c.contract_value || 0).toLocaleString('en-IN')}</div>
            <div><strong>Start:</strong> {c.start_date || '—'}</div>
            <div><strong>End:</strong> {c.end_date || '—'}</div>
            <div><strong>Reminder:</strong> {c.renewal_reminder_days} days before</div>
          </div>
          {c.description && <p style={{ fontSize: 13, color: 'var(--ink-2)', marginTop: 12 }}>{c.description}</p>}
          <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
            <button className="k-btn k-btn--primary" style={{ fontSize: 12 }} onClick={() => startEditContract(c)}>Edit</button>
            {['draft', 'active', 'expired', 'cancelled', 'renewed'].filter(s => s !== c.status).map(s => (
              <button key={s} className="k-btn k-btn--ghost" style={{ fontSize: 12 }} onClick={() => updateStatus(c.id, s)}>{s}</button>
            ))}
          </div>
        </div>

        {editMode && (
          <form onSubmit={saveEditContract} style={{ background: 'var(--surface-1)', border: '1px solid var(--rule-soft)', borderRadius: 12, padding: 24, marginBottom: 16 }}>
            <h4 style={{ margin: '0 0 12px', fontSize: 14, fontWeight: 700 }}>Edit Contract</h4>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Title *</span>
                <input className="k-input" required value={editForm.title} onChange={e => setEditForm({ ...editForm, title: e.target.value })} /></label>
              <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Contact</span>
                <select className="k-input" value={editForm.contact_id} onChange={e => setEditForm({ ...editForm, contact_id: e.target.value })}>
                  <option value="">None</option>
                  {contacts.map(ct => <option key={ct.id} value={ct.id}>{ct.name}</option>)}
                </select></label>
              <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Value</span>
                <input className="k-input" type="number" step="0.01" value={editForm.contract_value} onChange={e => setEditForm({ ...editForm, contract_value: e.target.value })} /></label>
              <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Reminder (days)</span>
                <input className="k-input" type="number" value={editForm.renewal_reminder_days} onChange={e => setEditForm({ ...editForm, renewal_reminder_days: parseInt(e.target.value) || 30 })} /></label>
              <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Start Date</span>
                <input className="k-input" type="date" value={editForm.start_date} onChange={e => setEditForm({ ...editForm, start_date: e.target.value })} /></label>
              <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>End Date</span>
                <input className="k-input" type="date" value={editForm.end_date} onChange={e => setEditForm({ ...editForm, end_date: e.target.value })} /></label>
              <label style={{ fontSize: 13, gridColumn: '1 / -1' }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Description</span>
                <textarea className="k-input" rows={2} value={editForm.description} onChange={e => setEditForm({ ...editForm, description: e.target.value })} style={{ resize: 'vertical' }} /></label>
              <label style={{ fontSize: 13, gridColumn: '1 / -1' }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Notes</span>
                <textarea className="k-input" rows={2} value={editForm.notes} onChange={e => setEditForm({ ...editForm, notes: e.target.value })} style={{ resize: 'vertical' }} /></label>
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
              <button type="button" className="k-btn k-btn--ghost" onClick={() => setEditMode(false)}>Cancel</button>
              <button type="submit" className="k-btn k-btn--primary" disabled={editSaving}>{editSaving ? 'Saving…' : 'Save'}</button>
            </div>
          </form>
        )}

        {detail.invoices?.length > 0 && (
          <div style={{ background: 'var(--surface-1)', border: '1px solid var(--rule-soft)', borderRadius: 12, padding: 24 }}>
            <h4 style={{ margin: '0 0 12px', fontSize: 14, fontWeight: 700 }}>Related Invoices ({detail.invoices.length})</h4>
            {detail.invoices.map(inv => (
              <div key={inv.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--rule-soft)', fontSize: 13 }}>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>{inv.invoice_number}</span>
                <span style={{ fontWeight: 600 }}>₹{Number(inv.total).toLocaleString('en-IN')}</span>
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
        <select className="k-input" style={{ width: 130 }} value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
          <option value="">All Status</option>
          {['draft', 'active', 'expired', 'cancelled', 'renewed'].map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <button className="k-btn k-btn--ghost" style={{ fontSize: 12 }} onClick={load}>Filter</button>
        <div style={{ flex: 1 }} />
        <button className="k-btn k-btn--primary" style={{ fontSize: 13 }} onClick={() => { setShowForm(true); loadContacts(); }}>+ New Contract</button>
      </div>

      {showForm && (
        <form onSubmit={save} style={{ background: 'var(--surface-1)', border: '1px solid var(--rule-soft)', borderRadius: 12, padding: 24, marginBottom: 16 }}>
          <h3 style={{ margin: '0 0 12px', fontSize: 15, fontWeight: 700 }}>New Contract</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Title *</span>
              <input className="k-input" required value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} /></label>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Contact</span>
              <select className="k-input" value={form.contact_id} onChange={e => setForm({ ...form, contact_id: e.target.value })}>
                <option value="">None</option>
                {contacts.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select></label>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Value (₹)</span>
              <input className="k-input" type="number" step="0.01" value={form.contract_value} onChange={e => setForm({ ...form, contract_value: e.target.value })} /></label>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Reminder (days before end)</span>
              <input className="k-input" type="number" value={form.renewal_reminder_days} onChange={e => setForm({ ...form, renewal_reminder_days: parseInt(e.target.value) || 30 })} /></label>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Start Date</span>
              <input className="k-input" type="date" value={form.start_date} onChange={e => setForm({ ...form, start_date: e.target.value })} /></label>
            <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>End Date</span>
              <input className="k-input" type="date" value={form.end_date} onChange={e => setForm({ ...form, end_date: e.target.value })} /></label>
            <label style={{ fontSize: 13, gridColumn: '1 / -1' }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Description</span>
              <textarea className="k-input" rows={2} value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} style={{ resize: 'vertical' }} /></label>
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
            <button type="button" className="k-btn k-btn--ghost" onClick={() => setShowForm(false)}>Cancel</button>
            <button type="submit" className="k-btn k-btn--primary" disabled={saving}>{saving ? 'Creating…' : 'Create'}</button>
          </div>
        </form>
      )}

      {loading ? <p style={{ color: 'var(--ink-3)', fontSize: 13, textAlign: 'center', padding: 24 }}>Loading…</p> :
        contracts.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '48px 24px' }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>📄</div>
            <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>No contracts yet</div>
            <div style={{ fontSize: 13, color: 'var(--ink-3)', maxWidth: 300, margin: '0 auto' }}>Create contracts for recurring services or long-term agreements with clients.</div>
          </div>
        ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {contracts.map(c => (
            <div key={c.id} style={{ background: 'var(--surface-1)', border: '1px solid var(--rule-soft)', borderRadius: 10, padding: '12px 16px', cursor: 'pointer' }}
              onClick={() => loadDetail(c.id)}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                <span style={{ fontWeight: 700, fontSize: 14 }}>{c.title}</span>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <span style={{ fontWeight: 700 }}>₹{Number(c.contract_value || 0).toLocaleString('en-IN')}</span>
                  <Badge text={c.status} color={CONTRACT_COLORS[c.status] || '#6E7B91'} />
                </div>
              </div>
              <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>
                {c.contact_name && <span>{c.contact_name} · </span>}
                {c.start_date && <span>{c.start_date} → {c.end_date || '…'}</span>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}


function ESignTab() {
  const { pushToast } = useToast();
  const [contracts, setContracts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [sigStatus, setSigStatus] = useState(null);
  const [auditTrail, setAuditTrail] = useState([]);
  const [signers, setSigners] = useState([{ name: '', email: '', role: 'signer' }]);
  const [sending, setSending] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  useEffect(() => { load(); }, []);

  async function load() {
    try {
      const r = await api.get('/v1/ganit/contracts');
      setContracts(r.data.data || []);
    } catch { pushToast({ title: 'Failed to load contracts', type: 'error' }); }
    finally { setLoading(false); }
  }

  async function selectContract(c) {
    setSelected(c);
    setSigStatus(null);
    setAuditTrail([]);
    setSigners([{ name: '', email: '', role: 'signer' }]);
    try {
      const [statusRes, auditRes] = await Promise.all([
        api.get(`/v1/ganit/contracts/${c.id}/signature-status`).catch(() => null),
        api.get(`/v1/ganit/contracts/${c.id}/audit-trail`).catch(() => null),
      ]);
      if (statusRes) setSigStatus(statusRes.data);
      if (auditRes) setAuditTrail(auditRes.data.data || auditRes.data.events || []);
    } catch {}
  }

  async function sendForSignature(e) {
    e.preventDefault();
    const valid = signers.every(s => s.name.trim() && s.email.trim());
    if (!valid) { pushToast({ title: 'Fill all signer names and emails', type: 'error' }); return; }
    setSending(true);
    try {
      await api.post(`/v1/ganit/contracts/${selected.id}/send-for-signature`, { signers });
      pushToast({ title: 'Sent for signature', type: 'success' });
      selectContract(selected);
    } catch (err) { pushToast({ title: err.response?.data?.detail || 'Failed to send', type: 'error' }); }
    finally { setSending(false); }
  }

  async function cancelSignature() {
    setCancelling(true);
    try {
      await api.post(`/v1/ganit/contracts/${selected.id}/cancel-signature`);
      pushToast({ title: 'Signature cancelled', type: 'success' });
      selectContract(selected);
    } catch (err) { pushToast({ title: err.response?.data?.detail || 'Cancel failed', type: 'error' }); }
    finally { setCancelling(false); }
  }

  function addSigner() {
    setSigners(s => [...s, { name: '', email: '', role: 'signer' }]);
  }

  function updateSigner(idx, field, val) {
    setSigners(s => { const n = [...s]; n[idx] = { ...n[idx], [field]: val }; return n; });
  }

  function removeSigner(idx) {
    setSigners(s => s.filter((_, i) => i !== idx));
  }

  if (selected) {
    const hasSent = sigStatus && sigStatus.signers && sigStatus.signers.length > 0;
    const canCancel = hasSent && sigStatus.signers.some(s => s.status === 'pending' || s.status === 'otp_sent');
    return (
      <div>
        <button className="k-btn k-btn--ghost" style={{ fontSize: 12, marginBottom: 12 }} onClick={() => setSelected(null)}>← Back to list</button>

        <div style={{ background: 'var(--surface-1)', border: '1px solid var(--rule-soft)', borderRadius: 12, padding: 24, marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <div>
              <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>{selected.title}</h3>
              {selected.contact_name && <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--ink-2)' }}>{selected.contact_name}</p>}
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <span style={{ fontWeight: 700 }}>₹{Number(selected.contract_value || 0).toLocaleString('en-IN')}</span>
              <Badge text={selected.status} color={CONTRACT_COLORS[selected.status] || '#6E7B91'} />
            </div>
          </div>
        </div>

        {hasSent && (
          <div style={{ background: 'var(--surface-1)', border: '1px solid var(--rule-soft)', borderRadius: 12, padding: 24, marginBottom: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <h4 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>Signature Status</h4>
              {canCancel && (
                <button className="k-btn k-btn--ghost" style={{ fontSize: 12, color: '#ef4444' }} disabled={cancelling} onClick={cancelSignature}>
                  {cancelling ? 'Cancelling…' : 'Cancel Signature'}
                </button>
              )}
            </div>
            {sigStatus.signers.map((s, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid var(--rule-soft)', fontSize: 13 }}>
                <div>
                  <span style={{ fontWeight: 600 }}>{s.name}</span>
                  <span style={{ marginLeft: 8, color: 'var(--ink-3)' }}>{s.email}</span>
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  {s.signed_at && <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>{new Date(s.signed_at).toLocaleString('en-IN')}</span>}
                  <Badge text={s.status} color={SIGN_STATUS_COLORS[s.status] || '#6E7B91'} />
                </div>
              </div>
            ))}
          </div>
        )}

        {!hasSent && (
          <form onSubmit={sendForSignature} style={{ background: 'var(--surface-1)', border: '1px solid var(--rule-soft)', borderRadius: 12, padding: 24, marginBottom: 16 }}>
            <h4 style={{ margin: '0 0 12px', fontSize: 14, fontWeight: 700 }}>Send for Signature</h4>
            {signers.map((s, i) => (
              <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 30px', gap: 8, marginBottom: 8 }}>
                <input className="k-input" placeholder="Signer name" value={s.name} onChange={e => updateSigner(i, 'name', e.target.value)} />
                <input className="k-input" type="email" placeholder="Signer email" value={s.email} onChange={e => updateSigner(i, 'email', e.target.value)} />
                {signers.length > 1 && (
                  <button type="button" onClick={() => removeSigner(i)} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: 16 }}>×</button>
                )}
              </div>
            ))}
            <button type="button" className="k-btn k-btn--ghost" style={{ fontSize: 12, marginBottom: 12 }} onClick={addSigner}>+ Add Signer</button>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button type="submit" className="k-btn k-btn--primary" disabled={sending}>{sending ? 'Sending…' : 'Send for Signature'}</button>
            </div>
          </form>
        )}

        {auditTrail.length > 0 && (
          <div style={{ background: 'var(--surface-1)', border: '1px solid var(--rule-soft)', borderRadius: 12, padding: 24 }}>
            <h4 style={{ margin: '0 0 12px', fontSize: 14, fontWeight: 700 }}>Audit Trail</h4>
            {auditTrail.map((ev, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--rule-soft)', fontSize: 13 }}>
                <div>
                  <span style={{ fontWeight: 600 }}>{ev.event}</span>
                  {ev.actor_email && <span style={{ marginLeft: 8, color: 'var(--ink-3)' }}>{ev.actor_email}</span>}
                  {ev.ip_address && <span style={{ marginLeft: 8, fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink-3)' }}>{ev.ip_address}</span>}
                </div>
                <span style={{ color: 'var(--ink-3)', fontSize: 12 }}>{new Date(ev.timestamp).toLocaleString('en-IN')}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div>
      {loading ? <p style={{ color: 'var(--ink-3)', fontSize: 13, textAlign: 'center', padding: 24 }}>Loading…</p> :
        contracts.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '48px 24px' }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>📄</div>
            <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>No contracts yet</div>
            <div style={{ fontSize: 13, color: 'var(--ink-3)', maxWidth: 300, margin: '0 auto' }}>Create contracts for recurring services or long-term agreements with clients.</div>
          </div>
        ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {contracts.map(c => (
            <div key={c.id} style={{ background: 'var(--surface-1)', border: '1px solid var(--rule-soft)', borderRadius: 10, padding: '12px 16px', cursor: 'pointer' }}
              onClick={() => selectContract(c)}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                <span style={{ fontWeight: 700, fontSize: 14 }}>{c.title}</span>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <span style={{ fontWeight: 700 }}>₹{Number(c.contract_value || 0).toLocaleString('en-IN')}</span>
                  <Badge text={c.status} color={CONTRACT_COLORS[c.status] || '#6E7B91'} />
                </div>
              </div>
              <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>
                {c.contact_name && <span>{c.contact_name} · </span>}
                {c.start_date && <span>{c.start_date} → {c.end_date || '…'}</span>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}


function RecurringTab() {
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
        <form onSubmit={save} style={{ background: 'var(--surface-1)', border: '1px solid var(--rule-soft)', borderRadius: 12, padding: 24, marginBottom: 16 }}>
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
                style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: 16 }}>×</button>
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
            <div key={r.id} style={{ background: 'var(--surface-1)', border: '1px solid var(--rule-soft)', borderRadius: 10, padding: '12px 16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                <div>
                  <Badge text={r.frequency} color="#0082c6" />
                  {r.contact_name && <span style={{ marginLeft: 8, fontSize: 13, fontWeight: 600 }}>{r.contact_name}</span>}
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <span style={{ fontWeight: 700, fontSize: 14 }}>₹{Number(r.subtotal || 0).toLocaleString('en-IN')}</span>
                  <Badge text={r.is_active ? 'Active' : 'Inactive'} color={r.is_active ? '#10b981' : '#9ca3af'} />
                </div>
              </div>
              <div style={{ fontSize: 12, color: 'var(--ink-3)', display: 'flex', justifyContent: 'space-between' }}>
                <span>Next: {r.next_date} {r.end_date && `· Ends: ${r.end_date}`} {r.auto_send && '· Auto-send'}</span>
                {r.is_active && (
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button className="k-btn k-btn--primary" style={{ fontSize: 11, padding: '2px 10px' }} onClick={() => generateNow(r.id)}>Generate Now</button>
                    <button className="k-btn k-btn--ghost" style={{ fontSize: 11, color: '#ef4444', padding: '2px 8px' }} onClick={() => deactivate(r.id)}>Deactivate</button>
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


function BankTab() {
  const { pushToast } = useToast();
  const [statements, setStatements] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');
  const [csvText, setCsvText] = useState('');
  const [batchLabel, setBatchLabel] = useState('');
  const [importing, setImporting] = useState(false);
  const [showImport, setShowImport] = useState(false);

  const FMT = v => `₹${Number(v || 0).toLocaleString('en-IN')}`;

  useEffect(() => { load(); loadStats(); }, []);

  async function load() {
    try {
      let url = '/v1/ganit/bank-statements?';
      if (filter === 'matched') url += 'reconciled=true&';
      if (filter === 'unmatched') url += 'reconciled=false&';
      const r = await api.get(url);
      setStatements(r.data.data || []);
    } catch { pushToast({ title: 'Failed to load bank statements', type: 'error' }); }
    finally { setLoading(false); }
  }

  async function loadStats() {
    try {
      const r = await api.get('/v1/ganit/bank-statements/stats');
      setStats(r.data);
    } catch {}
  }

  async function handleImport(e) {
    e.preventDefault();
    if (!csvText.trim()) { pushToast({ title: 'Paste CSV data first', type: 'error' }); return; }
    const lines = csvText.trim().split('\n').map(line => {
      const parts = line.split(',').map(s => s.trim());
      return { statement_date: parts[0] || '', description: parts[1] || '', reference: parts[2] || '', amount: parseFloat(parts[3]) || 0, running_balance: parseFloat(parts[4]) || 0 };
    });
    if (lines.length === 0) { pushToast({ title: 'No valid lines found', type: 'error' }); return; }
    setImporting(true);
    try {
      const r = await api.post('/v1/ganit/bank-statements/import', { lines, batch_label: batchLabel || undefined });
      pushToast({ title: `Imported ${r.data.imported} lines, ${r.data.auto_matched} auto-matched`, type: 'success' });
      setCsvText('');
      setBatchLabel('');
      setShowImport(false);
      load();
      loadStats();
    } catch (err) { pushToast({ title: err.response?.data?.detail || 'Import failed', type: 'error' }); }
    finally { setImporting(false); }
  }

  async function unmatch(id) {
    try {
      await api.post(`/v1/ganit/bank-statements/${id}/unmatch`);
      pushToast({ title: 'Unmatched', type: 'success' });
      load();
      loadStats();
    } catch (err) { pushToast({ title: err.response?.data?.detail || 'Unmatch failed', type: 'error' }); }
  }

  return (
    <div>
      {stats && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 16, marginBottom: 20 }}>
          <StatTile label="Total Lines" value={stats.total_lines} />
          <StatTile label="Matched" value={stats.matched} />
          <StatTile label="Unmatched" value={stats.unmatched} />
          <StatTile label="Matched Amount" value={FMT(stats.matched_amount)} />
          <StatTile label="Unmatched Amount" value={FMT(stats.unmatched_amount)} />
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center' }}>
        <select className="k-input" style={{ width: 150 }} value={filter} onChange={e => setFilter(e.target.value)}>
          <option value="">All</option>
          <option value="matched">Matched</option>
          <option value="unmatched">Unmatched</option>
        </select>
        <button className="k-btn k-btn--ghost" style={{ fontSize: 12 }} onClick={load}>Filter</button>
        <div style={{ flex: 1 }} />
        <button className="k-btn k-btn--primary" style={{ fontSize: 13 }} onClick={() => setShowImport(true)}>Import CSV</button>
      </div>

      {showImport && (
        <form onSubmit={handleImport} style={{ background: 'var(--surface-1)', border: '1px solid var(--rule-soft)', borderRadius: 12, padding: 24, marginBottom: 16 }}>
          <h4 style={{ margin: '0 0 12px', fontSize: 14, fontWeight: 700 }}>Import Bank Statement</h4>
          <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Batch Label</span>
            <input className="k-input" placeholder="e.g. HDFC Jul-2026" value={batchLabel} onChange={e => setBatchLabel(e.target.value)} style={{ marginBottom: 12 }} /></label>
          <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>CSV Data (date, description, reference, amount, balance — one per line)</span>
            <textarea className="k-input" rows={6} value={csvText} onChange={e => setCsvText(e.target.value)}
              placeholder="2026-07-01,Office rent,REF001,25000,475000&#10;2026-07-02,Client payment,UTR123,150000,625000"
              style={{ resize: 'vertical', width: '100%', fontFamily: 'var(--font-mono)', fontSize: 12 }} /></label>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
            <button type="button" className="k-btn k-btn--ghost" onClick={() => setShowImport(false)}>Cancel</button>
            <button type="submit" className="k-btn k-btn--primary" disabled={importing}>{importing ? 'Importing…' : 'Import'}</button>
          </div>
        </form>
      )}

      {loading ? <p style={{ color: 'var(--ink-3)', fontSize: 13, textAlign: 'center', padding: 24 }}>Loading…</p> :
        statements.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '48px 24px' }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>🏦</div>
            <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>No bank statements imported</div>
            <div style={{ fontSize: 13, color: 'var(--ink-3)', maxWidth: 300, margin: '0 auto' }}>Import CSV statements from your bank to reconcile payments automatically.</div>
          </div>
        ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--rule-soft)' }}>
              {['Date', 'Description', 'Reference', 'Amount', 'Status', ''].map(h => (
                <th key={h} style={{ textAlign: h === 'Amount' ? 'right' : 'left', padding: '8px 10px', fontWeight: 600, color: 'var(--ink-3)', fontSize: 11, textTransform: 'uppercase' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {statements.map(s => (
              <tr key={s.id} style={{ borderBottom: '1px solid var(--rule-soft)' }}>
                <td style={{ padding: '10px', fontSize: 12 }}>{s.statement_date}</td>
                <td style={{ padding: '10px' }}>{s.description}</td>
                <td style={{ padding: '10px', fontFamily: 'var(--font-mono)', fontSize: 12 }}>{s.reference || '—'}</td>
                <td style={{ padding: '10px', textAlign: 'right', fontWeight: 600 }}>{FMT(s.amount)}</td>
                <td style={{ padding: '10px' }}>
                  {s.is_reconciled ? <Badge text="Matched" color="#10b981" /> : <Badge text="Unmatched" color="#f59e0b" />}
                </td>
                <td style={{ padding: '10px' }}>
                  {s.is_reconciled && (
                    <button onClick={() => unmatch(s.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ef4444', fontSize: 11 }}>Unmatch</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}


function TimesheetTab() {
  const { pushToast } = useToast();
  const [form, setForm] = useState({ date_from: '', date_to: '', contact_id: '', is_igst: false });
  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState(null);

  const FMT = v => `₹${Number(v || 0).toLocaleString('en-IN')}`;

  async function generate(e) {
    e.preventDefault();
    if (!form.date_from || !form.date_to) { pushToast({ title: 'Select date range', type: 'error' }); return; }
    setGenerating(true);
    setResult(null);
    try {
      const body = {
        employee_ids: [],
        date_from: form.date_from,
        date_to: form.date_to,
        is_igst: form.is_igst,
      };
      if (form.contact_id) body.contact_id = form.contact_id;
      const r = await api.post('/v1/ganit/invoices/from-time-entries', body);
      setResult(r.data);
      pushToast({ title: `Invoice ${r.data.invoice_number} created`, type: 'success' });
    } catch (err) { pushToast({ title: err.response?.data?.detail || 'Generation failed', type: 'error' }); }
    finally { setGenerating(false); }
  }

  return (
    <div>
      <form onSubmit={generate} style={{ background: 'var(--surface-1)', border: '1px solid var(--rule-soft)', borderRadius: 12, padding: 24, marginBottom: 16 }}>
        <h3 style={{ margin: '0 0 12px', fontSize: 15, fontWeight: 700 }}>Generate Invoice from Timesheets</h3>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
          <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>From Date *</span>
            <input className="k-input" type="date" required value={form.date_from} onChange={e => setForm({ ...form, date_from: e.target.value })} /></label>
          <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>To Date *</span>
            <input className="k-input" type="date" required value={form.date_to} onChange={e => setForm({ ...form, date_to: e.target.value })} /></label>
          <label style={{ fontSize: 13 }}><span style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Contact ID</span>
            <input className="k-input" placeholder="Optional" value={form.contact_id} onChange={e => setForm({ ...form, contact_id: e.target.value })} /></label>
        </div>
        <label style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 8, marginTop: 12 }}>
          <input type="checkbox" checked={form.is_igst} onChange={e => setForm({ ...form, is_igst: e.target.checked })} />
          <span style={{ fontWeight: 600 }}>Inter-state (IGST)</span></label>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
          <button type="submit" className="k-btn k-btn--primary" disabled={generating}>{generating ? 'Generating…' : 'Generate Invoice'}</button>
        </div>
      </form>

      {result && (
        <div style={{ background: 'var(--surface-1)', border: '1px solid #10b981', borderRadius: 12, padding: 24 }}>
          <h4 style={{ margin: '0 0 12px', fontSize: 14, fontWeight: 700, color: '#10b981' }}>Invoice Created</h4>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, fontSize: 13 }}>
            <div><strong>Invoice #:</strong> <span style={{ fontFamily: 'var(--font-mono)' }}>{result.invoice_number}</span></div>
            <div><strong>Total:</strong> <span style={{ fontWeight: 700 }}>{FMT(result.total)}</span></div>
            <div><strong>Entries Billed:</strong> {result.entries_billed}</div>
          </div>
        </div>
      )}
    </div>
  );
}
