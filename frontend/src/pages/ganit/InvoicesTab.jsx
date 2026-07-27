import React, { useState, useEffect } from 'react';
import { api } from '../../lib/api';
import { useToast } from '../../components/ui/toast';
import { EmptyState } from '../../components/ui/EmptyState';
import { ErrorState, errorKind } from '../../components/ui/ErrorState';
import { SkeletonTable, SkeletonRegion } from '../../components/ui/Skeleton';
import { safeArray, Badge, UpiPayBlock, INV_TYPE_LABELS, STATUS_COLORS, DOC_STATUS_COLORS, PAY_METHODS } from './_shared';
import { inr } from '../../lib/inr';
import { describeDocumentError } from '../../lib/docErrors';

/**
 * `newNonce` lets the page header's "+ Invoice" button open this tab's create
 * form. A counter, not a boolean, so pressing it again re-opens the form after
 * the first attempt was cancelled — a boolean would already be `true` and the
 * effect would not re-run.
 */
export default function InvoicesTab({ newNonce = 0 }) {
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
  // A failed load left `invoices` at [] and painted "No invoices yet — create
  // your first invoice". On a finance ledger that is the worst version of this
  // bug: an empty receivables list is a number the user may act on.
  const [err, setErr] = useState(null);

  useEffect(() => { load(); }, []);
  useEffect(() => {
    if (!newNonce) return;
    setShowForm(true);
    loadOptions();
  }, [newNonce]);

  async function load() {
    setErr(null);
    try {
      let url = '/v1/ganit/invoices?';
      if (typeFilter) url += `invoice_type=${typeFilter}&`;
      if (statusFilter) url += `payment_status=${statusFilter}&`;
      const r = await api.get(url);
      setInvoices(r.data.data || []);
    } catch (e) {
      setErr(e);
      pushToast({ title: 'Failed to load invoices', type: 'error' });
    }
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
    } catch (err) {
      // A 422 here is a refusal, not a failure: the invoice is missing a
      // mandatory GST particular and the backend declines to emit a document
      // that would look complete. Surface which field, not just "failed".
      const { title, message } = await describeDocumentError(err, 'Failed to generate PDF');
      pushToast({ title, message, type: 'error' });
    }
    finally { setDownloading(false); }
  }

  if (detail) {
    const inv = detail.invoice;
    const nextDocStatus = { draft: 'final', final: 'sent', sent: 'viewed' };
    const nextLabel = { draft: 'Mark Final', final: 'Mark Sent', sent: 'Mark Viewed' };
    return (
      <div>
        <button className="k-btn k-btn--ghost" style={{ fontSize: 12, marginBottom: 12 }} onClick={() => setDetail(null)}>← Back to list</button>
        <div style={{ background: 'var(--surface-1)', border: '1px solid var(--rule-soft)', borderRadius: 'var(--r-md)', padding: 24, marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
            <div>
              <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>{inv.invoice_number}</h3>
              <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--ink-2)' }}>
                {INV_TYPE_LABELS[inv.invoice_type] || inv.invoice_type} · {inv.invoice_date}
              </p>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              {inv.doc_status && <Badge text={inv.doc_status} color={DOC_STATUS_COLORS[inv.doc_status] || 'var(--on-surface-3)'} />}
              <Badge text={inv.payment_status} color={STATUS_COLORS[inv.payment_status] || 'var(--on-surface-3)'} />
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
              <button className="k-btn k-btn--primary" style={{ fontSize: 12, background: 'var(--ok)' }} onClick={convertToInvoice}>Convert to Invoice</button>
            )}
            {inv.estimate_status && <Badge text={`Estimate: ${inv.estimate_status}`} color={inv.estimate_status === 'accepted' ? 'var(--ok)' : inv.estimate_status === 'rejected' ? 'var(--danger)' : 'var(--on-surface-3)'} />}
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
                  <td className="mtbl__num" style={{ padding: '8px 10px' }}>{li.quantity} {li.unit}</td>
                  <td className="mtbl__num" style={{ padding: '8px 10px' }}>{inr(Number(li.rate))}</td>
                  <td style={{ padding: '8px 10px', textAlign: 'right' }}>{li.gst_rate}%</td>
                  <td className="mtbl__num" style={{ padding: '8px 10px', fontWeight: 600 }}>{inr(Number(li.line_total))}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <div style={{ width: 280, fontSize: 13 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}><span>Subtotal</span><span>{inr(Number(inv.subtotal))}</span></div>
              {!inv.is_igst ? (
                <>
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', color: 'var(--ink-3)' }}><span>CGST</span><span>{inr(Number(inv.cgst))}</span></div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', color: 'var(--ink-3)' }}><span>SGST</span><span>{inr(Number(inv.sgst))}</span></div>
                </>
              ) : (
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', color: 'var(--ink-3)' }}><span>IGST</span><span>{inr(Number(inv.igst))}</span></div>
              )}
              {Number(inv.discount) > 0 && <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', color: 'var(--danger)' }}><span>Discount</span><span>-{inr(Number(inv.discount))}</span></div>}
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', fontWeight: 700, borderTop: '2px solid var(--rule-soft)', marginTop: 4 }}><span>Total</span><span>{inr(Number(inv.total))}</span></div>
              {Number(inv.amount_paid) > 0 && <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', color: 'var(--ok)' }}><span>Paid</span><span>{inr(Number(inv.amount_paid))}</span></div>}
              {Number(inv.balance_due) > 0 && <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontWeight: 600, color: 'var(--danger)' }}><span>Balance Due</span><span>{inr(Number(inv.balance_due))}</span></div>}
            </div>
          </div>

          <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 12, display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            {inv.sent_at && <span>Sent: {new Date(inv.sent_at).toLocaleString('en-IN')}</span>}
            {inv.viewed_at && <span>Viewed: {new Date(inv.viewed_at).toLocaleString('en-IN')}</span>}
            {inv.recurring_id && <span>Recurring: <Badge text="Auto-generated" color="var(--st-in-progress)" /></span>}
          </div>

          {inv.payment_status !== 'paid' && inv.payment_status !== 'cancelled' && (
            <div style={{ marginTop: 16 }}>
              <button className="k-btn k-btn--primary" style={{ fontSize: 13 }} onClick={() => setShowPay(true)}>Record Payment</button>
            </div>
          )}

          <UpiPayBlock invoice={inv} />
        </div>

        {showPay && (
          <form onSubmit={recordPayment} style={{ background: 'var(--surface-1)', border: '1px solid var(--k-primary)', borderRadius: 'var(--r-md)', padding: 24, marginBottom: 16 }}>
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
          <div style={{ background: 'var(--surface-1)', border: '1px solid var(--rule-soft)', borderRadius: 'var(--r-md)', padding: 24 }}>
            <h4 style={{ margin: '0 0 12px', fontSize: 14, fontWeight: 700 }}>Payment History</h4>
            {detail.payments.map(p => (
              <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--rule-soft)', fontSize: 13 }}>
                <div>
                  <span style={{ fontWeight: 600 }}>{inr(Number(p.amount))}</span>
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
        <form onSubmit={save} style={{ background: 'var(--surface-1)', border: '1px solid var(--rule-soft)', borderRadius: 'var(--r-md)', padding: 24, marginBottom: 16 }}>
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
              <button type="button" onClick={() => removeLine(i)} style={{ background: 'none', border: 'none', color: 'var(--danger)', cursor: 'pointer', fontSize: 16, paddingBottom: 6 }}>×</button>
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

      {loading ? (
        <SkeletonRegion label="Loading invoices"><SkeletonTable rows={8} columns={5} /></SkeletonRegion>
      ) : err ? (
        <ErrorState kind={errorKind(err)} onRetry={load} />
      ) :
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
                <td style={{ padding: '10px' }}><Badge text={INV_TYPE_LABELS[inv.invoice_type] || inv.invoice_type} color="var(--st-in-progress)" /></td>
                <td style={{ padding: '10px', textAlign: 'right', fontSize: 12 }}>{inv.invoice_date}</td>
                <td className="mtbl__num" style={{ padding: '10px', fontWeight: 600 }}>{inr(Number(inv.total))}</td>
                <td className="mtbl__num" style={{ padding: '10px', color: 'var(--ok)' }}>{inr(Number(inv.amount_paid))}</td>
                <td className="mtbl__num" style={{ padding: '10px', color: Number(inv.balance_due) > 0 ? 'var(--danger)' : 'var(--ink-3)' }}>{inr(Number(inv.balance_due))}</td>
                <td style={{ padding: '10px', textAlign: 'right' }}><Badge text={inv.payment_status} color={STATUS_COLORS[inv.payment_status] || 'var(--on-surface-3)'} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
