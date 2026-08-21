// Vikray · new order — the create form.
//
// Extracted from the 400-line OrdersTab (27-vikray.md, "Files to create"). It
// owns nothing but the draft: the tab stays responsible for the list, and this
// reports a created order back up rather than reaching for `load()`.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api, rows } from '../../lib/api';
import { useToast } from '../../components/ui/toast';
import LineItemEditor from '../../components/LineItemEditor';
import { inr } from '../../lib/inr';
import { emptyLine, previewTotals, probeGanit } from './_shared';
import useModuleWrite from '../../hooks/useModuleWrite';
import { Secondary } from '../../components/Bilingual';
import DateInput from '../../components/ui/DateInput';
// The same wrapper Ganit's invoice form uses — server-side `?search=` into the
// shared `Picker`. See its own file for why the array cannot be handed over
// whole.
import ServerPicker from '../../components/ui/ServerPicker';

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
  // The two inline create panels. Null when closed; `{ name, gstin }` and
  // `{ name, email }` when open, seeded with whatever was typed into the
  // picker's search box — `Picker` hands `onCreate` that string precisely so
  // "type a company that isn't there" is one keystroke from making it.
  const [coDraft, setCoDraft] = useState(null);
  const [personDraft, setPersonDraft] = useState(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({
    contact_id: '', client_id: '', deal_id: '', order_date: '', expected_delivery: '', is_igst: false,
    discount: 0, shipping_address: {}, notes: '', line_items: [emptyLine()],
  });

  useEffect(() => {
    let dead = false;
    const missing = [];
    api.get('/v1/graha/clients')
      .then(r => { if (!dead) setClients(rows(r)); })
      .catch(() => { missing.push('the company list'); });
    api.get('/v1/graha/contacts')
      .then(r => { if (!dead) setContacts(rows(r)); })
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

  /**
   * Merge server rows into a local list, by id, keeping what is already there.
   *
   * The pickers ask the server for `?search=` results, so the array grows a
   * page at a time and the SELECTED row must survive every one of those
   * answers — otherwise the trigger label goes blank the moment a search
   * returns a page the current customer is not on. There is no react-query in
   * this frontend; local state is the cache, so merging is the invalidation.
   */
  const mergeById = useCallback((prev, next) => {
    const seen = new Map(prev.map(r => [String(r.id), r]));
    for (const r of next) seen.set(String(r.id), { ...seen.get(String(r.id)), ...r });
    return [...seen.values()];
  }, []);

  const searchClients = useCallback(async (q) => {
    try {
      const r = await api.get('/v1/graha/clients', { params: q ? { search: q } : {} });
      setClients(prev => mergeById(prev, rows(r)));
    } catch { /* the list simply does not grow; the picker keeps what it has */ }
  }, [mergeById]);

  const searchContacts = useCallback(async (q) => {
    try {
      const r = await api.get('/v1/graha/contacts', { params: q ? { search: q } : {} });
      setContacts(prev => mergeById(prev, rows(r)));
    } catch { /* as above */ }
  }, [mergeById]);

  const company = useMemo(
    () => clients.find(c => String(c.id) === String(form.client_id)) || null,
    [clients, form.client_id],
  );

  const clientItems = useMemo(
    () => clients.map(c => ({
      id: String(c.id),
      name: c.name,
      // NAMES, never ids. `ref_no` is the org's own reference for the company
      // and is the thing that tells two "Sharma Traders" apart.
      meta: c.ref_no || '',
    })),
    [clients],
  );

  /**
   * The people offered as the contact.
   *
   * Narrowed to the chosen company, as the old `<select>` did — with one
   * change: contacts with NO company are KEPT. They are exactly the people who
   * still need attaching to one, and hiding them is how a duplicate gets made.
   */
  const contactItems = useMemo(() => {
    const pool = form.client_id
      ? contacts.filter(c => !c.client_id || String(c.client_id) === String(form.client_id))
      : contacts;
    return pool.map(c => ({
      id: String(c.id),
      name: c.name,
      meta: c.client_name || c.company || c.designation || '',
    }));
  }, [contacts, form.client_id]);

  const preview = previewTotals(form.line_items, form.discount);
  const set = patch => setForm(f => ({ ...f, ...patch }));

  /**
   * Picking the person. A contact carries their employer, and adopting it is
   * what puts the order on the company's ledger — but it only FILLS a blank: a
   * company the user chose deliberately outranks an inference off the person.
   * The server resolves the same way (`resolve_order_company`,
   * backend/routers/vikray.py:229), so the form never disagrees with what is
   * stored.
   */
  function pickContact(id) {
    const c = contacts.find(x => String(x.id) === String(id));
    setForm(f => ({
      ...f,
      contact_id: id,
      client_id: f.client_id || (c?.client_id ? String(c.client_id) : ''),
    }));
  }

  /**
   * Picking the company. The chosen person is kept if they work there (or work
   * nowhere yet) and dropped if they belong to a different company — leaving
   * an order for "Acme Pvt Ltd" placed care of somebody at a competitor is the
   * one outcome nobody means.
   */
  function pickCompany(id) {
    setForm((f) => {
      const cur = contacts.find(x => String(x.id) === String(f.contact_id));
      const keep = !cur || !cur.client_id || String(cur.client_id) === String(id);
      return { ...f, client_id: id, contact_id: keep ? f.contact_id : '' };
    });
  }

  /**
   * Quick-create, straight into the CRM.
   *
   * The owner's ask: "ganit, sales BOTH need capacity to add clients, contacts
   * — same feature as CRM." The way to be in sync is to have ONE writer — so
   * these call the very endpoints Graha's own forms call, and Vikray inserts
   * nothing into `graha_clients` or `graha_contacts` itself. A second INSERT
   * here would be a second set of defaults, a second event emitter and a
   * second thing to keep identical forever; a background sync would be the
   * second source of truth migration 136 exists to prevent.
   *
   * Name only. GSTIN is offered and optional, and PAN, TAN and the rest are
   * not asked for at all: those block nothing anywhere in this product and a
   * create panel is not the place to start.
   */
  async function createCompany() {
    const name = (coDraft?.name || '').trim();
    if (!name || creating) return;
    setCreating(true);
    try {
      const r = await api.post('/v1/graha/clients', { name, gstin: (coDraft.gstin || '').trim() });
      const made = { id: String(r.data?.id), name: r.data?.name || name, ref_no: r.data?.ref_no || '' };
      setClients(prev => mergeById(prev, [made]));
      // The id lands in form state HERE, before anything else can fail. Two
      // writes now stand where one did: if the order POST is refused, the
      // retry must re-use this company rather than mint a second one under
      // the same name.
      set({ client_id: made.id });
      setCoDraft(null);
      pushToast({ title: 'Company added', message: `${made.name} is now in Graha and Ganit too.`, type: 'success' });
    } catch (err) {
      const detail = err.response?.data?.detail;
      pushToast({ title: (typeof detail === 'string' && detail) || 'Could not add the company', type: 'error' });
    } finally { setCreating(false); }
  }

  async function createPerson() {
    const name = (personDraft?.name || '').trim();
    if (!name || creating) return;
    setCreating(true);
    try {
      const r = await api.post('/v1/graha/contacts', {
        name,
        email: (personDraft.email || '').trim(),
        // Attached to the company on the form, so the person arrives in the
        // CRM already belonging somewhere rather than as another orphan.
        client_id: form.client_id || '',
        // EXPLICIT. `ContactCreate.contact_type` defaults to 'lead', and a
        // person you have just taken an order from is not a lead: filed as one
        // they pollute every lead list and feed lead scoring with somebody who
        // has already bought.
        contact_type: 'customer',
      });
      const made = {
        id: String(r.data?.id), name: r.data?.name || name,
        client_id: form.client_id || null,
        client_name: company?.name || '',
      };
      setContacts(prev => mergeById(prev, [made]));
      set({ contact_id: made.id });
      setPersonDraft(null);
      pushToast({ title: 'Contact added', message: `${made.name} is now in Graha.`, type: 'success' });
    } catch (err) {
      const detail = err.response?.data?.detail;
      pushToast({ title: (typeof detail === 'string' && detail) || 'Could not add the contact', type: 'error' });
    } finally { setCreating(false); }
  }

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
        {/* Two pickers where there were two bare `<select>`s over a page the
            server truncates at 200 rows. Both can now be created from here,
            into the CRM's own tables, so a company first met at order time
            shows up in Graha and Ganit without anyone re-typing it.
            A `<div>`, not a `<label>`: the picker's control is a real
            `<button>`, which is not a labelable element. `ariaLabel` names it
            instead. */}
        <div className="fld">
          <span className="fld__l">Customer<Secondary className="fld__hi" value="ग्राहक" /></span>
          <span className="fld__hint">The company buying.</span>
          <ServerPicker
            mode="option" field ariaLabel="Customer"
            search
            items={clientItems}
            value={form.client_id}
            placeholder="No company"
            onChange={pickCompany}
            onSearch={searchClients}
            onCreate={(q) => { setCoDraft({ name: q || '', gstin: '' }); setPersonDraft(null); }}
            createLabel="Create company"
          />
        </div>
        <div className="fld">
          <span className="fld__l">Contact</span>
          <span className="fld__hint">Who to speak to. Optional.</span>
          <ServerPicker
            mode="option" field ariaLabel="Contact"
            search
            items={contactItems}
            value={form.contact_id}
            placeholder="No contact"
            onChange={pickContact}
            onSearch={searchContacts}
            onCreate={(q) => { setPersonDraft({ name: q || '', email: '' }); setCoDraft(null); }}
            createLabel="Create contact"
          />
        </div>
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

      {/* The two quick-create panels. Name is the only thing either asks for.
          They post to the CRM's own endpoints — one writer per table — and the
          new row is put into form state the moment it exists, so a refused
          order does not turn into a second company on the retry. */}
      {coDraft && (
        <div className="note vk-form__grid" role="group" aria-label="New company">
          <label className="fld">
            <span className="fld__l">Company name</span>
            <input className="inp" autoFocus value={coDraft.name} placeholder="Acme Pvt Ltd"
              onChange={e => setCoDraft({ ...coDraft, name: e.target.value })} />
          </label>
          <label className="fld">
            {/* Optional, and it blocks nothing — GSTIN, PAN and TAN are
                non-mandatory everywhere in this product. It is offered because
                it is the number the firm will want on the invoice this order
                becomes. */}
            <span className="fld__l">GSTIN <span className="fld__hint">optional</span></span>
            <input className="inp k-mono" value={coDraft.gstin} placeholder="27AAAAA0000A1Z5"
              onChange={e => setCoDraft({ ...coDraft, gstin: e.target.value.toUpperCase() })} />
          </label>
          <div className="vk-form__acts">
            <button type="button" className="btn btn--fill btn--sm" disabled={creating || !coDraft.name.trim()}
              onClick={createCompany}>
              {creating ? 'Adding…' : 'Add company'}
            </button>
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => setCoDraft(null)}>Cancel</button>
          </div>
        </div>
      )}
      {personDraft && (
        <div className="note vk-form__grid" role="group" aria-label="New contact">
          <label className="fld">
            <span className="fld__l">Contact name</span>
            <input className="inp" autoFocus value={personDraft.name} placeholder="Priya Sharma"
              onChange={e => setPersonDraft({ ...personDraft, name: e.target.value })} />
          </label>
          <label className="fld">
            <span className="fld__l">Email <span className="fld__hint">optional</span></span>
            <input className="inp" type="email" value={personDraft.email} placeholder="priya@acme.in"
              onChange={e => setPersonDraft({ ...personDraft, email: e.target.value })} />
          </label>
          <div className="vk-form__acts">
            <button type="button" className="btn btn--fill btn--sm" disabled={creating || !personDraft.name.trim()}
              onClick={createPerson}>
              {creating ? 'Adding…' : 'Add contact'}
            </button>
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => setPersonDraft(null)}>Cancel</button>
          </div>
          {/* Stated, because it decides where the person lands in the CRM. */}
          <p className="fld__hint">
            {company
              ? `Filed under ${company.name} as a customer.`
              : 'Filed as a customer with no company — pick or create one above to attach them.'}
          </p>
        </div>
      )}

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
