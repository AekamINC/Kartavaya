// Ganit · the create-invoice form.
//
// Split out of `InvoicesTab` for the same reason Vikray split `OrderForm`: the
// tab was 542 lines carrying a list, a record view and a multi-line editor, and
// the styling diff was unreviewable while all three shared a file.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, rows } from '../../lib/api';
import { useToast } from '../../components/ui/toast';
import { inr } from '../../lib/inr';
import { stateFromGSTIN, GST_STATES } from '../../lib/validators';
import { INV_TYPE_LABELS } from './_shared';
import useModuleWrite from '../../hooks/useModuleWrite';
import { Secondary } from '../../components/Bilingual';
import DateInput from '../../components/ui/DateInput';
import Picker from '../../components/ui/Picker';

const EMPTY_LINE = { description: '', hsn_code: '', quantity: 1, unit: 'NOS', rate: 0, gst_rate: 18, discount_pct: 0 };

/**
 * A `Picker` whose options are fetched from the server for whatever is typed
 * into its search box.
 *
 * ── Why the array cannot just be handed over whole ──────────────────────────
 * `GET /v1/graha/contacts` and `GET /v1/graha/clients` are both `LIMIT 200`,
 * and this product already has orgs past that: 292 live contacts against a
 * 200-row window. `Picker` filters the array it is given, so filtering a
 * truncated array hides the other 92 people SILENTLY — and a user who cannot
 * find a customer creates a second copy of them, which is the exact duplicate
 * this whole change exists to prevent. Both endpoints take `?search=`; the
 * server has to be the one doing the narrowing.
 *
 * ── The seam ────────────────────────────────────────────────────────────────
 * `Picker` draws and owns its own search box and publishes what is typed there
 * only to `onCreate`. It is a shared component used by four other surfaces and
 * is not this file's to change. But a DOM `input` event BUBBLES, and this
 * wrapper contains the picker and nothing else — so the single `<input>` under
 * it is that search box, and listening here reads the query without a second
 * search field competing with the one the picker already draws.
 *
 * `onSearch` is debounced, and asked only when the text actually changed: React
 * re-renders replay no input events, but a stray focus/blur must not spend a
 * request.
 */
function ServerPicker({ onSearch, ...pickerProps }) {
  const timer = useRef(null);
  const last = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <div
      style={{ minWidth: 0 }}
      onInput={(e) => {
        if (e.target.tagName !== 'INPUT') return;
        const q = e.target.value || '';
        if (q === last.current) return;
        last.current = q;
        clearTimeout(timer.current);
        // 250ms: long enough that typing a company name is one request, short
        // enough that the list has moved before the user reaches for the
        // "create" row underneath it.
        timer.current = setTimeout(() => onSearch(q), 250);
      }}
    >
      <Picker {...pickerProps} />
    </div>
  );
}

// Mirrors `doc_validation.TAX_DOCUMENT_TYPES` — the variants that carry the
// full Rule 46 particulars. A quotation or proforma is an offer, not a tax
// document, and stays out of the gate.
const TAX_DOC_TYPES = ['tax_invoice', 'credit_note', 'debit_note'];
const BLANK = {
  // `client_id` is the CRM COMPANY — `graha_clients.id` — and `contact_id` is a
  // person at it. A CRM client is the customer; contacts come and go. Until
  // 2026-08-20 this form carried only the person, and `client_id` was never
  // written by any invoice path in the product.
  client_id: '',
  contact_id: '', invoice_type: 'tax_invoice', invoice_date: '', due_date: '',
  place_of_supply: '', is_igst: false, is_export: false, currency: 'INR',
  notes: '', terms: 'Payment due within 30 days.', discount: 0,
  line_items: [{ ...EMPTY_LINE }],
};

/**
 * The line editor's track list.
 *
 * `ScreensWork.jsx:203` (`InvoiceSheet`) sets `minmax(0,1fr) 90px 80px 100px`
 * over a single `tbl__head`; this adds the two columns that sheet's mock data
 * did not need — quantity and GST rate — and keeps the shape: one flexible
 * description, fixed numeric tracks, the amount last and right-aligned.
 */
/* The owner's ask, 2026-08-08: "increase invoice column width so it doesn't get
   truncated". Every track is wider, and the description now has a FLOOR of
   11rem rather than `minmax(0, …)`.
   The zero was the actual defect: a `minmax(0, 1.6fr)` track is allowed to
   vanish entirely, and in the drawer it did — "Item" printed on top of
   "HSN/SAC". A floor plus the container query in ganit.css means the row either
   fits, scrolls, or stacks; it never overlaps. */
const LINE_COLS =
  'minmax(11rem,1.9fr) 104px 72px 104px 74px minmax(104px,1fr) 30px';

/**
 * An existing invoice mapped onto the form's shape.
 *
 * `line_items` is defensive about arriving as a STRING: jsonb columns were
 * double-encoded across this codebase, and while the encoder is fixed and rows
 * repaired, an unrepaired row must open the editor rather than throw on
 * `.map`. That is the whole point of being able to edit it.
 */
function fromInvoice(inv) {
  let items = inv.line_items;
  if (typeof items === 'string') {
    try { items = JSON.parse(items); } catch { items = []; }
  }
  if (!Array.isArray(items)) items = [];
  return {
    ...BLANK,
    client_id: inv.client_id || '',
    contact_id: inv.contact_id || '',
    invoice_type: inv.invoice_type || 'tax_invoice',
    invoice_date: (inv.invoice_date || '').slice(0, 10),
    due_date: (inv.due_date || '').slice(0, 10),
    place_of_supply: inv.place_of_supply || '',
    is_igst: !!inv.is_igst,
    is_export: !!inv.is_export,
    currency: inv.currency || 'INR',
    discount: Number(inv.discount) || 0,
    notes: inv.notes || '',
    terms: inv.terms || '',
    line_items: items.length ? items.map(li => ({
      product_id: li.product_id || '',
      description: li.description || '',
      hsn_code: li.hsn_code || li.sac_code || '',
      quantity: Number(li.quantity) || 1,
      unit: li.unit || 'NOS',
      rate: Number(li.rate) || 0,
      gst_rate: Number(li.gst_rate) ?? 18,
      discount_pct: Number(li.discount_pct) || 0,
    })) : BLANK.line_items,
  };
}

/** One line's taxable value, after its own percentage discount. */
function lineTaxable(li) {
  const gross = (Number(li.quantity) || 0) * (Number(li.rate) || 0);
  return li.discount_pct > 0 ? gross * (1 - li.discount_pct / 100) : gross;
}

/**
 * `editing` — an existing invoice to correct, or null to create a new one.
 *
 * The same form serves both because the fields are identical and a second copy
 * would drift. Only a DRAFT is ever passed here; `InvoiceDetail` offers the
 * control on nothing else, and the server refuses an issued or part-paid
 * invoice regardless.
 *
 * This existed as nothing at all until 2026-07-29: an invoice could be created
 * and never corrected, so a draft whose line had no HSN could never be issued
 * as a PDF (Rule 46(g)) and stayed permanently out of the Tally and GSTR-1
 * exports — while the PDF's own error told the user to fix it "in Ganit → the
 * invoice → Edit".
 */
export default function InvoiceForm({ onCancel, onCreated, editing = null }) {
  // F32 — the module is read from the route, never named here.
  const { canWrite, reason: denial } = useModuleWrite({ label: 'create invoices' });
  const { pushToast } = useToast();
  const [form, setForm] = useState(() => (editing ? fromInvoice(editing) : { ...BLANK }));
  const [contacts, setContacts] = useState([]);
  const [clients, setClients] = useState([]);
  const [products, setProducts] = useState([]);
  const [orgGstin, setOrgGstin] = useState(null);
  const [saving, setSaving] = useState(false);
  // The two inline create panels. Null when closed; `{ name, gstin }` and
  // `{ name, email }` when open, seeded with whatever was typed into the
  // picker's search box — `Picker` hands `onCreate` that string precisely so
  // "type a company that isn't there" is one keystroke from making it.
  const [coDraft, setCoDraft] = useState(null);
  const [personDraft, setPersonDraft] = useState(null);
  const [creating, setCreating] = useState(false);
  // The design keeps place of supply and the tax treatment DERIVED and out of
  // sight, behind a "Change" (`ScreensWork.jsx:193`). They are revealed when
  // there is nothing to derive from, or when the reader asks.
  const [showSupply, setShowSupply] = useState(false);
  const [showOpt, setShowOpt] = useState(false);
  // Blocking gaps shown in the banner: set by the local Rule 46 check on
  // submit, or by the server's own `document_incomplete` 422 (same shape).
  // Null means no banner. Field-level marks derive LIVE from the form state,
  // so fixing a field clears its red edge before the banner is dismissed.
  const [gaps, setGaps] = useState(null);

  useEffect(() => {
    // Contacts and products are pickers, not the panel's own content. If either
    // fails the form is still usable — the customer select simply carries no
    // options and the user types the line items by hand — so this does NOT set
    // the panel's error state. It does say so, rather than presenting an empty
    // dropdown as though the org had no contacts.
    //
    // The org profile is read for ONE field: our own GSTIN, whose state code
    // decides inter-state versus intra-state. A failure there costs the derived
    // note and nothing else, so it stays silent.
    (async () => {
      const [c, p, o, cl] = await Promise.allSettled([
        api.get('/v1/graha/contacts'),
        api.get('/v1/ganit/products'),
        api.get('/v1/org/profile'),
        // The CRM's companies. A company is what `ganit_invoices.client_id`
        // points at, and it is the record receivables ageing, Client 360 and
        // every Niyam rule keyed on the customer actually read.
        api.get('/v1/graha/clients'),
      ]);
      if (c.status === 'fulfilled') setContacts(rows(c.value));
      else pushToast({ title: 'Could not load customers', message: 'You can still create the invoice — pick the customer later.', type: 'error' });
      if (p.status === 'fulfilled') setProducts(rows(p.value));
      if (o.status === 'fulfilled') setOrgGstin(o.value?.data?.gstin || null);
      if (cl.status === 'fulfilled') setClients(rows(cl.value));
    })();
  }, [pushToast]);

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

  const customer = useMemo(
    () => contacts.find(c => String(c.id) === String(form.contact_id)) || null,
    [contacts, form.contact_id],
  );

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
   * The people offered as the named recipient.
   *
   * Narrowed to the chosen company, because a company with forty staff should
   * not have to be scrolled past on an invoice to a different one. Contacts
   * with NO company are kept in the list: they are exactly the people who
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

  /**
   * Place of supply and the CGST/SGST-versus-IGST split, read off the two
   * GSTINs — ours and the customer's.
   *
   * Section 12(2)(a) of the IGST Act puts the place of supply at the recipient's
   * registered address, which is exactly what their GSTIN prefix encodes. Until
   * now this form asked the user to type the state by hand and tick "Inter-state
   * (IGST)" themselves, so the tax treatment on every invoice rested on a free
   * text field and an unchecked checkbox — and getting it wrong misfiles the
   * supply in GSTR-1 and hands the customer an unclaimable credit.
   */
  const derived = useMemo(() => {
    // The named person's own registration first, then the company's. A contact
    // GSTIN is the more specific fact where both exist; a company invoiced
    // without a named contact still carries a state code, and before the
    // company was on this form that case derived nothing at all.
    const them = stateFromGSTIN(customer?.gstin || company?.gstin);
    const us = stateFromGSTIN(orgGstin);
    if (!them) return null;
    return { ...them, igst: us ? us.code !== them.code : null, homeCode: us?.code || null };
  }, [customer, company, orgGstin]);

  // Export overrides the domestic split entirely, so the note has nothing to
  // say about a foreign invoice.
  const agrees = derived
    && form.place_of_supply === derived.name
    && (derived.igst === null || form.is_igst === derived.igst);
  const noteVisible = !!derived && !form.is_export;

  function applyDerived() {
    if (!derived) return;
    setForm(f => ({
      ...f,
      place_of_supply: derived.name,
      is_igst: derived.igst === null ? f.is_igst : derived.igst,
    }));
    setShowSupply(false);
  }

  /**
   * The place-of-supply and CGST/SGST-versus-IGST fields that follow from one
   * counterparty GSTIN, as a patch to fold into the form.
   *
   * Returns `{}` — not a cleared state — when there is nothing to read. A
   * customer with no GSTIN must LEAVE the fields alone; wiping a place of
   * supply the user typed because the next pick had no registration would be
   * a silent tax change.
   */
  function supplyFrom(gstin, f) {
    const s = stateFromGSTIN(gstin);
    if (!s || f.is_export) return {};
    const us = stateFromGSTIN(orgGstin);
    return { place_of_supply: s.name, ...(us ? { is_igst: us.code !== s.code } : {}) };
  }

  /**
   * Picking the customer applies the derivation immediately, because that is
   * the moment the two facts become known. It does NOT run on mount: an invoice
   * opened for correction keeps the state and treatment it was issued under
   * until someone asks for the change in as many words.
   */
  function pickCustomer(id) {
    const c = contacts.find(x => String(x.id) === String(id));
    setForm(f => ({
      ...f,
      contact_id: id,
      // A contact carries their employer, and adopting it is what puts this
      // invoice on the company's ledger. It only FILLS a blank: a company the
      // user chose deliberately outranks an inference off the person, because
      // billing one subsidiary through a contact whose record still names the
      // parent is a real thing firms do. The server resolves the same way
      // (`resolve_order_company`), so the form never disagrees with what is
      // stored.
      client_id: f.client_id || (c?.client_id ? String(c.client_id) : ''),
      ...supplyFrom(c?.gstin, f),
    }));
  }

  /**
   * Picking the company. The chosen person is kept if they work there (or work
   * nowhere yet) and dropped if they belong to a different company — leaving
   * "Acme Pvt Ltd" billed care of somebody at a competitor is the one outcome
   * nobody means.
   */
  function pickCompany(id) {
    const cl = clients.find(x => String(x.id) === String(id));
    setForm((f) => {
      const cur = contacts.find(x => String(x.id) === String(f.contact_id));
      const keep = !cur || !cur.client_id || String(cur.client_id) === String(id);
      return {
        ...f,
        client_id: id,
        contact_id: keep ? f.contact_id : '',
        // Only when the person cannot answer it — see `derived`.
        ...((keep && cur?.gstin) ? {} : supplyFrom(cl?.gstin, f)),
      };
    });
  }

  /**
   * Quick-create, straight into the CRM.
   *
   * The owner's ask: "ganit should be able to add client, contact same as crm
   * and in sync, so if client added via invoice it auto gets seen in crm or
   * sales." The way to be in sync is to have ONE writer — so these call the
   * very endpoints Graha's own forms call and Ganit inserts nothing into
   * `graha_clients` or `graha_contacts` itself. A second INSERT here would be
   * a second set of defaults, a second event emitter and a second thing to
   * keep identical forever.
   *
   * Name only. GSTIN is offered and optional — it is what derives the place of
   * supply — and PAN, TAN and the rest are not asked for at all: those block
   * nothing anywhere in this product and a create panel is not the place to
   * start.
   */
  async function createCompany() {
    const name = (coDraft?.name || '').trim();
    if (!name || creating) return;
    setCreating(true);
    try {
      const r = await api.post('/v1/graha/clients', { name, gstin: (coDraft.gstin || '').trim() });
      const made = { id: String(r.data?.id), name: r.data?.name || name, gstin: (coDraft.gstin || '').trim() };
      setClients(prev => mergeById(prev, [made]));
      // The id lands in form state HERE, before anything else can fail. Two
      // writes now stand where one did: if the invoice POST is refused, the
      // retry must re-use this company rather than mint a second one under
      // the same name.
      setForm(f => ({ ...f, client_id: made.id, ...supplyFrom(made.gstin, f) }));
      setCoDraft(null);
      pushToast({ title: 'Company added', message: `${made.name} is now in Graha and Vikray too.`, type: 'success' });
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
        // person you have just raised an invoice against is not a lead: filed
        // as one they pollute every lead list and feed lead scoring with
        // somebody who has already bought.
        contact_type: 'customer',
      });
      const made = {
        id: String(r.data?.id), name: r.data?.name || name,
        client_id: form.client_id || null,
        client_name: company?.name || '',
      };
      setContacts(prev => mergeById(prev, [made]));
      setForm(f => ({ ...f, contact_id: made.id }));
      setPersonDraft(null);
      pushToast({ title: 'Contact added', message: `${made.name} is now in Graha.`, type: 'success' });
    } catch (err) {
      const detail = err.response?.data?.detail;
      pushToast({ title: (typeof detail === 'string' && detail) || 'Could not add the contact', type: 'error' });
    } finally { setCreating(false); }
  }

  function updateLine(idx, field, val) {
    setForm(f => {
      const items = [...f.line_items];
      items[idx] = { ...items[idx], [field]: val };
      return { ...f, line_items: items };
    });
  }

  /**
   * A product appends a PREFILLED line rather than overwriting one.
   *
   * It used to be a seventh column inside every row — a "Product" select
   * wedged between Rate and GST% that carried no value of its own and reset to
   * "Pick…" the moment it was used. It made the row's columns disagree with any
   * reading of the design's line table, and it is not a property of the line: it
   * is how the line got filled in.
   */
  function addFromProduct(productId) {
    const p = products.find(x => String(x.id) === String(productId));
    if (!p) return;
    const line = {
      ...EMPTY_LINE,
      description: p.name,
      hsn_code: p.hsn_code || p.sac_code || '',
      rate: Number(p.price) || 0,
      gst_rate: Number(p.gst_rate) || 0,
      unit: p.unit || 'NOS',
    };
    setForm(f => {
      // A single untouched blank line is filled rather than left above the new
      // one — otherwise the first thing a product does is leave an empty row
      // the user has to delete.
      const only = f.line_items.length === 1 && !f.line_items[0].description && !Number(f.line_items[0].rate);
      return { ...f, line_items: only ? [line] : [...f.line_items, line] };
    });
  }

  const subtotal = form.line_items.reduce((s, li) => s + lineTaxable(li), 0);
  const gst = form.line_items.reduce((s, li) => s + lineTaxable(li) * (Number(li.gst_rate) || 0) / 100, 0);
  const total = subtotal + gst - (Number(form.discount) || 0);

  // The rate is named only when every line carries the same one. "CGST 9%" over
  // a mix of 5% and 18% lines would be a figure the reader could not reproduce.
  const rates = [...new Set(form.line_items.map(li => Number(li.gst_rate) || 0))];
  const oneRate = rates.length === 1 ? rates[0] : null;
  const half = n => (n == null ? '' : ` ${n / 2}%`);

  const isTaxDoc = TAX_DOC_TYPES.includes(form.invoice_type);
  // Live per-field truth for the red edges: recomputed every render so a fixed
  // field sheds its mark immediately, independent of the banner's lifecycle.
  const customerMissing = isTaxDoc && !form.contact_id;
  const hsnMissing = i => isTaxDoc && !String(form.line_items[i]?.hsn_code || '').trim();

  /**
   * The form's share of `doc_validation.validate_tax_invoice` — only the gaps
   * this form can actually fix (recipient, per-line HSN/SAC, place of supply
   * on an inter-State supply). Org-side rules (supplier GSTIN etc.) stay on
   * the server; its 422 arrives in the same shape and feeds the same banner.
   */
  function localGaps() {
    if (!isTaxDoc) return [];
    const out = [];
    if (customerMissing) {
      out.push({
        field: 'contact.name', label: 'Customer',
        reason: 'Rule 46(e) — the document must name the recipient.',
      });
    }
    // HSN/SAC is deliberately NOT in this list. Owner's ruling 2026-08-20:
    // a missing particular must not stop a firm from invoicing, exactly as
    // GSTIN does not. Refusing the save does not produce the code, it produces
    // an unbilled supply. The server agrees — `doc_validation` carries it as
    // advisory — and the gap is chased on the filing screen instead, where
    // `check_gstr1_readiness` lists every invoice still missing one.
    // The per-line red edge (`hsnMissing`) stays: visible, never blocking.
    if (form.is_igst && !form.is_export && !String(form.place_of_supply || '').trim()) {
      out.push({
        field: 'invoice.place_of_supply', label: 'Place of supply',
        reason: 'Rule 46(n) — mandatory on an inter-State supply.',
      });
    }
    return out;
  }

  async function save(e, asDraft = false) {
    e?.preventDefault();
    if (form.line_items.length === 0) {
      pushToast({ title: 'Add at least one line item', type: 'error' });
      return;
    }
    // A new tax invoice is created FINAL, so the Rule 46 gate runs here — the
    // same list the PDF would refuse it with, shown before a number is spent.
    // Editing stays permissive: a draft is edited precisely to close its gaps,
    // and `Mark final` is the server-side gate a draft must pass to leave.
    if (!editing && !asDraft) {
      const found = localGaps();
      if (found.length) { setGaps(found); return; }
    }
    setSaving(true);
    try {
      const payload = asDraft ? { ...form, doc_status: 'draft' } : form;
      const r = editing
        ? await api.patch(`/v1/ganit/invoices/${editing.id}`, payload)
        : await api.post('/v1/ganit/invoices', payload);
      setGaps(null);
      pushToast({
        title: editing ? 'Invoice updated' : (asDraft ? 'Saved as draft' : 'Invoice created'),
        ...(asDraft ? { message: 'Finish the missing fields, then Mark final to issue it.' } : {}),
        type: 'success',
      });
      // Only reset on create. Clearing an edit would discard what the user is
      // still looking at if the parent keeps the panel open.
      if (!editing) setForm({ ...BLANK });
      onCreated?.(r.data);
    } catch (err) {
      const detail = err.response?.data?.detail;
      if (detail?.error === 'document_incomplete') {
        // The server refused a FINAL document — render its gap list in the
        // banner rather than flattening a structured refusal into a toast.
        setGaps(detail.blocking || []);
      } else {
        pushToast({
          title: (typeof detail === 'string' && detail)
            || (editing ? 'Could not update the invoice' : 'Could not create the invoice'),
          type: 'error',
        });
      }
    } finally { setSaving(false); }
  }

  return (
    <form className="gn-form" onSubmit={save}>
      {/* The sheet header of `ScreensWork.jsx:181` — title, its Devanagari, and
          the document's own number held out to the trailing edge in mono. A new
          invoice has no number to show yet and says so, rather than borrowing
          the mock's INV-2608. */}
      <div className="gn-form__hd">
        <h3 className="gn-form__t">
          {editing ? `Edit ${editing.invoice_number || 'invoice'}` : 'Create invoice'}
        </h3>
        <Secondary className="gn-form__hi" value="बीजक" />
        <span className="gn-form__no">
          {editing ? (editing.invoice_number || '') : 'Number assigned on save'}
        </span>
      </div>

      <div className="gn-form__grid">
        <label className="fld">
          <span className="fld__l">Type</span>
          <select className="inp" value={form.invoice_type} onChange={e => setForm({ ...form, invoice_type: e.target.value })}>
            {Object.entries(INV_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        {/* TWO controls where there was one bare `<select>` of contacts.
            The company is the customer — it is what `client_id` stores, what
            receivables ageing groups by and what Client 360 reports on — and
            the contact is the person named on the document under Rule 46(e).
            Both can be created from here, into the CRM's own tables, so a
            company first met at invoicing time shows up in Graha and Vikray
            without anyone re-typing it.
            A `<div>`, not a `<label>`: the picker's control is a real
            `<button>`, which is not a labelable element. `ariaLabel` names it
            instead. */}
        <div className="fld">
          <span className="fld__l">Company</span>
          <ServerPicker
            mode="option" field ariaLabel="Company"
            search
            items={clientItems}
            value={form.client_id}
            placeholder="Select company…"
            onChange={pickCompany}
            onSearch={searchClients}
            onCreate={(q) => { setCoDraft({ name: q || '', gstin: '' }); setPersonDraft(null); }}
            createLabel="Create company"
          />
        </div>
        <div className="fld">
          <span className="fld__l">Customer</span>
          <ServerPicker
            mode="option" field ariaLabel="Customer"
            search
            items={contactItems}
            value={form.contact_id}
            placeholder="Select customer…"
            onChange={pickCustomer}
            onSearch={searchContacts}
            onCreate={(q) => { setPersonDraft({ name: q || '', email: '' }); setCoDraft(null); }}
            createLabel="Create contact"
          />
          {/* The red edge the `<select>` carried, said out loud. A picker's
              trigger is a button and `aria-invalid` on it announces nothing
              useful, so the gap is named where the reader is looking. */}
          {gaps && customerMissing && (
            <span className="fld__err">Rule 46(e) — the document must name the recipient.</span>
          )}
        </div>
        <label className="fld">
          <span className="fld__l">Invoice date</span>
          <DateInput className="inp" type="date" value={form.invoice_date}
            onChange={e => setForm({ ...form, invoice_date: e.target.value })} />
        </label>
        <label className="fld">
          <span className="fld__l">Due date</span>
          <DateInput className="inp" type="date" value={form.due_date}
            onChange={e => setForm({ ...form, due_date: e.target.value })} />
        </label>
      </div>

      {/* The two quick-create panels. Name is the only thing either asks for.
          They post to the CRM's own endpoints — one writer per table — and the
          new row is put into form state the moment it exists, so a refused
          invoice does not turn into a second company on the retry. */}
      {coDraft && (
        <div className="note gn-form__grid gn-form__grid--2" role="group" aria-label="New company">
          <label className="fld">
            <span className="fld__l">Company name</span>
            <input className="inp" autoFocus value={coDraft.name} placeholder="Acme Pvt Ltd"
              onChange={e => setCoDraft({ ...coDraft, name: e.target.value })} />
          </label>
          <label className="fld">
            {/* Optional, and it blocks nothing. It earns its place because the
                state code in its prefix is what derives place of supply and
                the CGST/SGST-versus-IGST split. */}
            <span className="fld__l">GSTIN <span className="fld__hint">optional</span></span>
            <input className="inp gn-mono" value={coDraft.gstin} placeholder="27AAAAA0000A1Z5"
              onChange={e => setCoDraft({ ...coDraft, gstin: e.target.value.toUpperCase() })} />
          </label>
          <div className="gn-form__wide gn-lines__acts">
            <button type="button" className="btn btn--fill btn--sm" disabled={creating || !coDraft.name.trim()}
              onClick={createCompany}>
              {creating ? 'Adding…' : 'Add company'}
            </button>
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => setCoDraft(null)}>Cancel</button>
          </div>
        </div>
      )}
      {personDraft && (
        <div className="note gn-form__grid gn-form__grid--2" role="group" aria-label="New contact">
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
          <div className="gn-form__wide gn-lines__acts">
            <button type="button" className="btn btn--fill btn--sm" disabled={creating || !personDraft.name.trim()}
              onClick={createPerson}>
              {creating ? 'Adding…' : 'Add contact'}
            </button>
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => setPersonDraft(null)}>Cancel</button>
          </div>
          {/* Stated, because it decides where the person lands in the CRM. */}
          <p className="fld__hint gn-form__wide">
            {company
              ? `Filed under ${company.name} as a customer.`
              : 'Filed as a customer with no company — pick or create one above to attach them.'}
          </p>
        </div>
      )}

      {/* Derived, and stated in full — the prefix it read, the state it means and
          the tax that follows. A reader who disagrees can see exactly which of
          the three to argue with. */}
      {noteVisible && (
        <p className={`note ${agrees ? 'note--ok' : 'note--warn'} gn-supply`}>
          <span className="gn-supply__t">
            {agrees ? 'Derived from GSTIN prefix ' : 'GSTIN prefix '}
            <b className="gn-supply__code">{derived.code}</b>
            {' — place of supply '}<b>{derived.name}</b>
            {derived.igst === null
              ? '. Your own GSTIN is not set, so the CGST/SGST split cannot be worked out here.'
              : <>, tax as <b>{derived.igst ? 'IGST' : 'CGST + SGST'}</b>.</>}
            {!agrees && (
              <> This invoice is set to <b>{form.place_of_supply || 'no state'}</b>
                {derived.igst !== null && <>, <b>{form.is_igst ? 'IGST' : 'CGST + SGST'}</b></>}.
              </>
            )}
          </span>
          {!agrees && (
            <button type="button" className="btn btn--out btn--sm gn-supply__b" onClick={applyDerived}>
              Use derived
            </button>
          )}
          <button type="button" className="btn btn--out btn--sm gn-supply__b"
            onClick={() => setShowSupply(v => !v)} aria-expanded={showSupply}>
            {showSupply ? 'Done' : 'Change'}
          </button>
        </p>
      )}

      {(showSupply || !noteVisible) && (
        <div className="gn-form__grid gn-form__grid--2">
          {/* A SELECT, not a text field.
              Place of supply decides IGST versus CGST+SGST, and it was a free
              text box: "Maharastra", "MH" or a trailing space all read as a
              different state from "Maharashtra", and nothing downstream could
              tell a typo from a state. The statutory GST state codes are a
              fixed list (01–38 plus 97/99) already carried in `GST_STATES` and
              already used to DERIVE this field from the customer's GSTIN, so
              the options and the derivation now come from one source and the
              value cannot be spelled wrong. */}
          <label className="fld">
            <span className="fld__l">Place of supply</span>
            <select className="inp" value={form.place_of_supply}
              onChange={e => setForm({ ...form, place_of_supply: e.target.value })}>
              <option value="">Select…</option>
              {Object.entries(GST_STATES)
                .sort((a, b) => a[1].localeCompare(b[1]))
                .map(([code, name]) => (
                  <option key={code} value={name}>{name} ({code})</option>
                ))}
            </select>
          </label>
          <label className="gn-chk">
            <input type="checkbox" checked={form.is_igst} disabled={form.is_export}
              onChange={e => setForm({ ...form, is_igst: e.target.checked })} />
            <span>Inter-state (IGST)</span>
          </label>
        </div>
      )}

      <div className="gn-form__grid gn-form__grid--2">
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
      {/* One bordered table with ONE head row, per `ScreensWork.jsx:203`.
          It was seven bare inputs floating on the panel background with the
          column names printed above the first row only, so from the second line
          down nothing said which box was the rate and which the quantity, and
          the block had no edge to read as a table at all. */}
      <div className="gn-lines" style={{ '--gn-li': LINE_COLS }}>
        <div className="gn-lines__head" aria-hidden="true">
          <span>Item</span>
          <span>HSN/SAC</span>
          <span className="gn-num">Qty</span>
          <span className="gn-num">Rate</span>
          <span className="gn-num">GST%</span>
          <span className="gn-num">Amount</span>
          <span />
        </div>
        {form.line_items.map((li, i) => (
          <div key={i} className="gn-li">
            <div>
              {/* Repeated on every row and hidden above 640px, where the head
                  row carries them. Below it the grid stacks to one column, and
                  a stack of unlabelled inputs is not a table. */}
              <span className="gn-li__l">Description</span>
              <input className="inp" placeholder="Item description" value={li.description}
                aria-label={`Line ${i + 1} description`}
                onChange={e => updateLine(i, 'description', e.target.value)} />
            </div>
            <div>
              <span className="gn-li__l">HSN/SAC</span>
              <input className="inp gn-mono" value={li.hsn_code} aria-label={`Line ${i + 1} HSN or SAC code`}
                aria-invalid={gaps && hsnMissing(i) ? 'true' : undefined}
                onChange={e => updateLine(i, 'hsn_code', e.target.value)} />
            </div>
            <div>
              <span className="gn-li__l">Qty</span>
              <input className="inp gn-num" type="number" min="1" value={li.quantity}
                aria-label={`Line ${i + 1} quantity`}
                onChange={e => updateLine(i, 'quantity', parseFloat(e.target.value) || 1)} />
            </div>
            <div>
              <span className="gn-li__l">Rate</span>
              <input className="inp gn-num" type="number" value={li.rate}
                aria-label={`Line ${i + 1} rate`}
                onChange={e => updateLine(i, 'rate', parseFloat(e.target.value) || 0)} />
            </div>
            <div>
              <span className="gn-li__l">GST%</span>
              <input className="inp gn-num" type="number" value={li.gst_rate}
                aria-label={`Line ${i + 1} GST percentage`}
                onChange={e => updateLine(i, 'gst_rate', parseFloat(e.target.value) || 0)} />
            </div>
            {/* The design's fourth column, and the one this editor never had:
                quantity times rate, per line. Without it a six-line invoice
                could only be checked by re-doing the arithmetic by hand. */}
            <div className="gn-li__amtc">
              <span className="gn-li__l">Amount</span>
              <span className="gn-li__amt">{inr(lineTaxable(li))}</span>
            </div>
            <button type="button" className="gn-li__x" aria-label={`Remove line ${i + 1}`}
              disabled={form.line_items.length === 1}
              onClick={() => setForm(f => ({ ...f, line_items: f.line_items.filter((_, j) => j !== i) }))}>
              ×
            </button>
          </div>
        ))}
      </div>

      <div className="gn-lines__acts">
        <button type="button" className="btn btn--ghost btn--sm"
          onClick={() => setForm(f => ({ ...f, line_items: [...f.line_items, { ...EMPTY_LINE }] }))}>
          + Add line
        </button>
        {products.length > 0 && (
          <label className="gn-lines__pick">
            <span className="gn-lines__pickl">From product</span>
            <select className="inp gn-lines__picks" value=""
              onChange={e => { addFromProduct(e.target.value); e.target.value = ''; }}>
              <option value="">Pick…</option>
              {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
        )}
      </div>

      {/* `ScreensWork.jsx:226` — the optional block folded away. Notes and terms
          are on the document and were on the payload, but this form had no field
          for either: `terms` went out as the hard-coded "Payment due within 30
          days." on every invoice the UI has ever created. */}
      <button type="button" className="gn-more" onClick={() => setShowOpt(v => !v)} aria-expanded={showOpt}>
        <span className="gn-more__l">Optional — notes, terms, flat discount</span>
        <span className="gn-more__c" aria-hidden="true">›</span>
      </button>
      {showOpt && (
        <div className="gn-form__grid gn-form__grid--2">
          <label className="fld gn-form__wide">
            <span className="fld__l">Notes</span>
            <textarea className="inp gn-ta" value={form.notes} placeholder="Shown on the invoice"
              onChange={e => setForm({ ...form, notes: e.target.value })} />
          </label>
          <label className="fld gn-form__wide">
            <span className="fld__l">Terms</span>
            <textarea className="inp gn-ta" value={form.terms} placeholder="Payment terms"
              onChange={e => setForm({ ...form, terms: e.target.value })} />
          </label>
          <label className="fld">
            <span className="fld__l">Flat discount (₹)</span>
            <input className="inp gn-num" type="number" value={form.discount}
              onChange={e => setForm({ ...form, discount: parseFloat(e.target.value) || 0 })} />
          </label>
        </div>
      )}

      {/* Taxable value, then the tax NAMED as it will appear on the document —
          CGST and SGST as two lines when the supply is intra-state, because that
          is how they are charged, filed and claimed. A single "GST" row matched
          nothing the customer will see. */}
      <div className="gn-tot">
        <div className="gn-tot__r">
          <span className="gn-tot__l">Taxable value</span>
          <span className="gn-tot__v">{inr(subtotal)}</span>
        </div>
        {form.is_igst ? (
          <div className="gn-tot__r">
            <span className="gn-tot__l">IGST{oneRate != null ? ` ${oneRate}%` : ''}</span>
            <span className="gn-tot__v">{inr(gst)}</span>
          </div>
        ) : (
          <>
            <div className="gn-tot__r">
              <span className="gn-tot__l">CGST{half(oneRate)}</span>
              <span className="gn-tot__v">{inr(gst / 2)}</span>
            </div>
            <div className="gn-tot__r">
              <span className="gn-tot__l">SGST{half(oneRate)}</span>
              <span className="gn-tot__v">{inr(gst / 2)}</span>
            </div>
          </>
        )}
        {Number(form.discount) > 0 && (
          <div className="gn-tot__r">
            <span className="gn-tot__l">Flat discount</span>
            <span className="gn-tot__v">−{inr(Number(form.discount))}</span>
          </div>
        )}
        <div className="gn-tot__r gn-tot__r--sum">
          <span className="gn-tot__l">Total</span>
          <span className="gn-tot__v">{inr(total)}</span>
        </div>
        {/* Stated, not implied. The server recomputes and stores the figures
            that reach the document; rounding here is a preview only. */}
        <p className="gn-tot__note">A preview — the server computes the figures it stores.</p>
      </div>

      {/* The Rule 46 gate, in the banner form the design asks for — visible,
          dismissible, never a toast. Each gap names its rule so the reader can
          check the claim; the escape hatch keeps the incomplete-draft workflow
          the product deliberately supports. */}
      {gaps && gaps.length > 0 && (
        <div className="note note--danger gn-gaps" role="alert">
          <p className="gn-gaps__t">
            This {INV_TYPE_LABELS[form.invoice_type]?.toLowerCase() || 'invoice'} can’t be
            issued yet — {gaps.length} required field{gaps.length > 1 ? 's are' : ' is'} missing.
          </p>
          <ul className="gn-gaps__ls">
            {gaps.map(g => (
              <li key={g.field} className="gn-gaps__r">
                <b>{g.label}</b> — {g.reason}{g.fix && !g.field.startsWith('invoice.') && !g.field.startsWith('contact.') ? ` Set it in ${g.fix}.` : ''}
              </li>
            ))}
          </ul>
          <div className="gn-gaps__acts">
            <button type="button" className="btn btn--out btn--sm" disabled={saving}
              onClick={e => save(e, true)}>
              Save as draft instead
            </button>
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => setGaps(null)}>
              Keep editing
            </button>
          </div>
        </div>
      )}

      <div className="gn-form__acts">
        <button type="button" className="btn btn--ghost btn--sm" onClick={onCancel}>Cancel</button>
        <button type="submit" className="btn btn--fill btn--sm" disabled={saving || !canWrite} title={denial || undefined}>
          {saving ? (editing ? 'Saving…' : 'Creating…') : (editing ? 'Save changes' : 'Create invoice')}
        </button>
      </div>
    </form>
  );
}
