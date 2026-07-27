// Ganit · the create-invoice form.
//
// Split out of `InvoicesTab` for the same reason Vikray split `OrderForm`: the
// tab was 542 lines carrying a list, a record view and a multi-line editor, and
// the styling diff was unreviewable while all three shared a file.
import React, { useEffect, useState } from 'react';
import { api, rows } from '../../lib/api';
import { useToast } from '../../components/ui/toast';
import { inr } from '../../lib/inr';
import { INV_TYPE_LABELS } from './_shared';

const EMPTY_LINE = { description: '', hsn_code: '', quantity: 1, unit: 'NOS', rate: 0, gst_rate: 18, discount_pct: 0 };
const BLANK = {
  contact_id: '', invoice_type: 'tax_invoice', invoice_date: '', due_date: '',
  place_of_supply: '', is_igst: false, is_export: false, currency: 'INR',
  notes: '', terms: 'Payment due within 30 days.', discount: 0,
  line_items: [{ ...EMPTY_LINE }],
};

/** One line's taxable value, after its own percentage discount. */
function lineTaxable(li) {
  const gross = (Number(li.quantity) || 0) * (Number(li.rate) || 0);
  return li.discount_pct > 0 ? gross * (1 - li.discount_pct / 100) : gross;
}

export default function InvoiceForm({ onCancel, onCreated }) {
  const { pushToast } = useToast();
  const [form, setForm] = useState({ ...BLANK });
  const [contacts, setContacts] = useState([]);
  const [products, setProducts] = useState([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    // Both are pickers, not the panel's own content. If either fails the form
    // is still usable — the customer select simply carries no options and the
    // user types the line items by hand — so this does NOT set the panel's
    // error state. It does say so, rather than presenting an empty dropdown as
    // though the org had no contacts.
    (async () => {
      const [c, p] = await Promise.allSettled([
        api.get('/v1/graha/contacts'),
        api.get('/v1/ganit/products'),
      ]);
      if (c.status === 'fulfilled') setContacts(rows(c.value));
      else pushToast({ title: 'Could not load customers', message: 'You can still create the invoice — pick the customer later.', type: 'error' });
      if (p.status === 'fulfilled') setProducts(rows(p.value));
    })();
  }, [pushToast]);

  function updateLine(idx, field, val) {
    setForm(f => {
      const items = [...f.line_items];
      items[idx] = { ...items[idx], [field]: val };
      return { ...f, line_items: items };
    });
  }

  function fillFromProduct(idx, productId) {
    const p = products.find(x => String(x.id) === String(productId));
    if (!p) return;
    setForm(f => {
      const items = [...f.line_items];
      items[idx] = {
        ...items[idx],
        description: p.name,
        hsn_code: p.hsn_code || p.sac_code || '',
        rate: Number(p.price),
        gst_rate: Number(p.gst_rate),
        unit: p.unit || 'NOS',
      };
      return { ...f, line_items: items };
    });
  }

  const subtotal = form.line_items.reduce((s, li) => s + lineTaxable(li), 0);
  const gst = form.line_items.reduce((s, li) => s + lineTaxable(li) * (Number(li.gst_rate) || 0) / 100, 0);
  const total = subtotal + gst - (Number(form.discount) || 0);

  async function save(e) {
    e.preventDefault();
    if (form.line_items.length === 0) {
      pushToast({ title: 'Add at least one line item', type: 'error' });
      return;
    }
    setSaving(true);
    try {
      const r = await api.post('/v1/ganit/invoices', form);
      pushToast({ title: 'Invoice created', type: 'success' });
      setForm({ ...BLANK });
      onCreated?.(r.data);
    } catch (err) {
      pushToast({ title: err.response?.data?.detail || 'Could not create the invoice', type: 'error' });
    } finally { setSaving(false); }
  }

  return (
    <form className="gn-form" onSubmit={save}>
      <h3 className="gn-form__t">Create invoice</h3>

      <div className="gn-form__grid">
        <label className="fld">
          <span className="fld__l">Type</span>
          <select className="inp" value={form.invoice_type} onChange={e => setForm({ ...form, invoice_type: e.target.value })}>
            {Object.entries(INV_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <label className="fld">
          <span className="fld__l">Customer</span>
          <select className="inp" value={form.contact_id} onChange={e => setForm({ ...form, contact_id: e.target.value })}>
            <option value="">Select…</option>
            {contacts.map(c => <option key={c.id} value={c.id}>{c.name}{c.company ? ` (${c.company})` : ''}</option>)}
          </select>
        </label>
        <label className="fld">
          <span className="fld__l">Place of supply</span>
          <input className="inp" placeholder="e.g. Maharashtra" value={form.place_of_supply}
            onChange={e => setForm({ ...form, place_of_supply: e.target.value })} />
        </label>
        <label className="fld">
          <span className="fld__l">Invoice date</span>
          <input className="inp" type="date" value={form.invoice_date}
            onChange={e => setForm({ ...form, invoice_date: e.target.value })} />
        </label>
        <label className="fld">
          <span className="fld__l">Due date</span>
          <input className="inp" type="date" value={form.due_date}
            onChange={e => setForm({ ...form, due_date: e.target.value })} />
        </label>
        <label className="gn-chk">
          <input type="checkbox" checked={form.is_igst} disabled={form.is_export}
            onChange={e => setForm({ ...form, is_igst: e.target.checked })} />
          <span>Inter-state (IGST)</span>
        </label>
        <label className="gn-chk">
          <input type="checkbox" checked={form.is_export}
            onChange={e => setForm({ ...form, is_export: e.target.checked, currency: e.target.checked ? form.currency : 'INR' })} />
          <span>Foreign / export invoice</span>
        </label>
        {form.is_export && (
          <label className="fld">
            <span className="fld__l">Currency</span>
            <select className="inp" value={form.currency} onChange={e => setForm({ ...form, currency: e.target.value })}>
              {['USD', 'EUR', 'GBP', 'AED', 'SGD', 'INR'].map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
        )}
      </div>

      <h4 className="gn-form__h">Line items</h4>
      {form.line_items.map((li, i) => (
        // The track list is the one thing allowed inline: it is per-instance
        // data feeding a rule in ganit.css, which is check-tokens deviation 2.
        <div key={i} className="gn-li" style={{ '--gn-li': '2fr 1fr 70px 90px 1fr 70px 30px' }}>
          <div>
            {i === 0 && <span className="gn-li__l">Description</span>}
            <input className="inp" placeholder="Item description" value={li.description}
              onChange={e => updateLine(i, 'description', e.target.value)} />
          </div>
          <div>
            {i === 0 && <span className="gn-li__l">HSN/SAC</span>}
            <input className="inp" value={li.hsn_code} onChange={e => updateLine(i, 'hsn_code', e.target.value)} />
          </div>
          <div>
            {i === 0 && <span className="gn-li__l">Qty</span>}
            <input className="inp" type="number" min="1" value={li.quantity}
              onChange={e => updateLine(i, 'quantity', parseFloat(e.target.value) || 1)} />
          </div>
          <div>
            {i === 0 && <span className="gn-li__l">Rate</span>}
            <input className="inp" type="number" value={li.rate}
              onChange={e => updateLine(i, 'rate', parseFloat(e.target.value) || 0)} />
          </div>
          <div>
            {i === 0 && <span className="gn-li__l">Product</span>}
            <select className="inp" value="" onChange={e => fillFromProduct(i, e.target.value)}>
              <option value="">Pick…</option>
              {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div>
            {i === 0 && <span className="gn-li__l">GST%</span>}
            <input className="inp" type="number" value={li.gst_rate}
              onChange={e => updateLine(i, 'gst_rate', parseFloat(e.target.value) || 0)} />
          </div>
          <button type="button" className="gn-li__x" aria-label={`Remove line ${i + 1}`}
            disabled={form.line_items.length === 1}
            onClick={() => setForm(f => ({ ...f, line_items: f.line_items.filter((_, j) => j !== i) }))}>
            ×
          </button>
        </div>
      ))}
      <button type="button" className="btn btn--ghost btn--sm"
        onClick={() => setForm(f => ({ ...f, line_items: [...f.line_items, { ...EMPTY_LINE }] }))}>
        + Add line
      </button>

      <div className="gn-form__foot">
        <label className="fld">
          <span className="fld__l">Flat discount (₹)</span>
          <input className="inp gn-payline__in" type="number" value={form.discount}
            onChange={e => setForm({ ...form, discount: parseFloat(e.target.value) || 0 })} />
        </label>
        <div className="gn-est">
          <div>Subtotal {inr(subtotal)}</div>
          <div className="gn-est__sub">GST {inr(gst)}</div>
          <div className="gn-est__tot">Total {inr(total)}</div>
          {/* Stated, not implied. The server recomputes and stores the figures
              that reach the document; rounding here is a preview only. */}
          <div className="gn-est__note">A preview — the server computes the figures it stores.</div>
        </div>
      </div>

      <div className="gn-form__acts">
        <button type="button" className="btn btn--ghost btn--sm" onClick={onCancel}>Cancel</button>
        <button type="submit" className="btn btn--fill btn--sm" disabled={saving}>
          {saving ? 'Creating…' : 'Create invoice'}
        </button>
      </div>
    </form>
  );
}
