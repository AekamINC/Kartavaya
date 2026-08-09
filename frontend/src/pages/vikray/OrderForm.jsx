// Vikray · new order — the create form.
//
// Extracted from the 400-line OrdersTab (27-vikray.md, "Files to create"). It
// owns nothing but the draft: the tab stays responsible for the list, and this
// reports a created order back up rather than reaching for `load()`.
import React, { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { useToast } from '../../components/ui/toast';
import LineItemEditor from '../../components/LineItemEditor';
import { inr } from '../../lib/inr';
import { emptyLine, previewTotals, probeGanit } from './_shared';
import useModuleWrite from '../../hooks/useModuleWrite';
import { Secondary } from '../../components/Bilingual';
import DateInput from '../../components/ui/DateInput';

export default function OrderForm({ onCreated, onCancel }) {
  // F32 — the module is read from the route, never named here.
  const { canWrite, reason: denial } = useModuleWrite({ label: 'create orders' });
  const { pushToast } = useToast();
  const [contacts, setContacts] = useState([]);
  /* The COMPANY, which is who a customer actually is — a contact is who you
     speak to, and contacts leave. One shared record (migration 136): the same
     row the CRM calls a client, so a company entered here IS the CRM client if
     the org ever buys CRM. No sync, because there is nothing to sync. */
  const [clients, setClients] = useState([]);
  const [products, setProducts] = useState([]);
  // Neither list is fatal. A missing catalogue means typing the line by hand;
  // a missing contact list means an order with no customer attached, which the
  // API allows. Silently rendering two empty dropdowns does not — hence the note.
  const [optsErr, setOptsErr] = useState('');
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    contact_id: '', client_id: '', deal_id: '', order_date: '', expected_delivery: '', is_igst: false,
    discount: 0, shipping_address: {}, notes: '', line_items: [emptyLine()],
  });

  useEffect(() => {
    let dead = false;
    const missing = [];
    api.get('/v1/graha/clients')
      .then(r => { if (!dead) setClients(r.data?.data || []); })
      .catch(() => { missing.push('the company list'); });
    api.get('/v1/graha/contacts')
      .then(r => { if (!dead) setContacts(r.data?.data || []); })
      .catch(() => { missing.push('the contact list (CRM)'); })
      .then(() => probeGanit())
      .then(r => {
        if (dead) return;
        setProducts(r.products);
        if (!r.ok) missing.push('the product catalogue (Finance)');
        if (missing.length) setOptsErr(missing.join(' and '));
      });
    return () => { dead = true; };
  }, []);

  const preview = previewTotals(form.line_items, form.discount);
  const set = patch => setForm(f => ({ ...f, ...patch }));

  async function submit(e) {
    e.preventDefault();
    const usable = form.line_items.filter(li => (li.description || '').trim() || Number(li.rate) > 0);
    if (usable.length === 0) {
      pushToast({ title: 'Add at least one line item', type: 'error' });
      return;
    }
    setSaving(true);
    try {
      const r = await api.post('/v1/vikray/orders', { ...form, line_items: usable });
      pushToast({ title: `Order ${r.data.order_number} created`, type: 'success' });
      onCreated?.(r.data);
    } catch (err) {
      pushToast({ title: err.response?.data?.detail || 'Could not create the order', type: 'error' });
    } finally { setSaving(false); }
  }

  return (
    <form className="vk-form" onSubmit={submit}>
      <div className="vk-form__head">
        <h3 className="vk-form__t">New order<Secondary className="vk-form__hi" value="नया आदेश" /></h3>
      </div>

      {optsErr && (
        <p className="note note--warn" role="status">
          Could not load {optsErr}. You can still create the order — type the lines by hand.
        </p>
      )}

      <div className="vk-form__grid">
        <label className="fld">
          <span className="fld__l">Customer<Secondary className="fld__hi" value="ग्राहक" /></span>
          <span className="fld__hint">The company buying.</span>
          <select className="inp" value={form.client_id} onChange={e => set({ client_id: e.target.value })}>
            <option value="">No company</option>
            {clients.map(c => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </label>
        <label className="fld">
          <span className="fld__l">Contact</span>
          <span className="fld__hint">Who to speak to. Optional.</span>
          <select className="inp" value={form.contact_id} onChange={e => set({ contact_id: e.target.value })}>
            <option value="">No contact</option>
            {contacts
              .filter(c => !form.client_id || String(c.client_id) === String(form.client_id))
              .map(c => (
                <option key={c.id} value={c.id}>{c.name}{c.company ? ` · ${c.company}` : ''}</option>
              ))}
          </select>
        </label>
        <label className="fld">
          <span className="fld__l">Order date</span>
          <DateInput type="date" className="inp" value={form.order_date} onChange={e => set({ order_date: e.target.value })} />
        </label>
        <label className="fld">
          <span className="fld__l">Expected delivery</span>
          <DateInput type="date" className="inp" value={form.expected_delivery}
            onChange={e => set({ expected_delivery: e.target.value })} />
        </label>
      </div>

      {/* is_igst is the one piece of GST logic that must not be got wrong: it
          decides CGST+SGST against IGST, and the server splits on it. The hint
          says what it means rather than assuming the abbreviation carries. */}
      <label className="vk-form__chk">
        <input type="checkbox" checked={form.is_igst} onChange={e => set({ is_igst: e.target.checked })} />
        <span>
          Inter-state supply (IGST)
          <span className="vk-form__chkhint">Tax is charged as one IGST line instead of CGST + SGST.</span>
        </span>
      </label>

      <LineItemEditor
        value={form.line_items}
        products={products}
        disabled={saving}
        onChange={line_items => set({ line_items })}
      />

      <div className="vk-form__foot">
        <label className="fld vk-form__disc">
          <span className="fld__l">Order discount (₹)</span>
          <input type="number" min="0" className="inp" value={form.discount}
            onChange={e => set({ discount: Number(e.target.value) })} />
        </label>

        {/* 27 §5 — labelled a preview, because it is one. The server recomputes
            these on save and its answer is the one that reaches the ledger. */}
        <dl className="vk-form__est">
          <div className="vk-form__estrow"><dt>Subtotal</dt><dd>{inr(preview.subtotal)}</dd></div>
          <div className="vk-form__estrow"><dt>GST</dt><dd>{inr(preview.gst)}</dd></div>
          <div className="vk-form__estrow vk-form__estrow--tot"><dt>Estimated total</dt><dd>{inr(preview.total)}</dd></div>
          <p className="vk-form__estnote">A preview. The stored figures are computed by the server on save.</p>
        </dl>
      </div>

      <label className="fld">
        <span className="fld__l">Notes</span>
        <textarea className="inp vk-form__ta" value={form.notes} onChange={e => set({ notes: e.target.value })} />
      </label>

      <div className="vk-form__acts">
        <button type="submit" className="btn btn--fill btn--sm" disabled={saving || !canWrite} title={denial || undefined}>
          {saving ? 'Creating…' : 'Create order'}
        </button>
        <button type="button" className="btn btn--ghost btn--sm" onClick={onCancel} disabled={saving}>
          Cancel
        </button>
      </div>
    </form>
  );
}
