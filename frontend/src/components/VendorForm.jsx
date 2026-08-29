import React, { useState } from 'react';
import { api, body } from '../lib/api';
import AddressSuggest from './ui/AddressSuggest';
import PincodeAutofill from './ui/PincodeAutofill';
import { useToast } from './ui/toast';
import { apiErrorText } from '../lib/apiError';

/**
 * VendorForm — the ONE form that creates or edits a supplier.
 *
 * ── The defect this closes (owner decision 0.20, 2026-08-26) ────────────────
 *
 * Vendors are reachable from two places, and both are correct: Kray owns the
 * master list, and Ganit · Payables lets a firm record a supplier without
 * abandoning the bill it is halfway through typing. Not every org buys Kray,
 * so Ganit keeps a full vendor surface — that is the decision, and it is not
 * "Kray owns it".
 *
 * What was wrong is that the two surfaces had FORKED. Kray's form carried ten
 * fields including all six MSME/TDS columns; `ganit/PayablesTab.jsx` carried
 * four — name, GSTIN, email, phone — so every vendor created from the payables
 * screen was born with `is_msme`, `enterprise_class`, `vendor_kind`,
 * `udyam_number`, `tds_section` and `payment_terms_days` all NULL, and the
 * 43B(h) skill that reads them reported "nobody has said" for a supplier the
 * user had just finished describing. Measured 2026-08-26: of 84 active vendors
 * across the two in-scope orgs, 12 carry the six columns and all 12 sit in
 * E2E Test & Associates; Unicode Group's 9 real suppliers carry none.
 *
 * So the fields live here, once, and both tabs render this. A field added to
 * the compliance set appears on both surfaces or on neither — which is the
 * only arrangement in which the two can never disagree again.
 *
 * ── What the caller keeps ───────────────────────────────────────────────────
 *
 * The POST/PATCH, the validation and the toast are HERE, because a second copy
 * of `payload()` is how the six columns went missing in the first place. What
 * happens AFTER a successful save is the caller's — Kray reloads its list,
 * Ganit reloads the picker and selects the new vendor into the bill it is
 * building. That is the only thing the two surfaces legitimately disagree on.
 */

/* The second-script run on a field label. Deliberately NOT `<Secondary>` from
   components/Bilingual: that one returns null under EN — the node is absent,
   by design — whereas this form has always shown both scripts unconditionally.
   Carried over from `kray/VendorsTab.jsx` unchanged; changing when Devanagari
   renders is a separate decision from de-duplicating the fields. */
const HI = { fontFamily: 'var(--font-indic)', fontWeight: 400, letterSpacing: 0, textTransform: 'none' };
const Hi = ({ t }) => <span aria-hidden="true" lang="hi" style={HI}>{' · '}{t}</span>;

/* Mirrors the LIVE CHECK constraints ganit_vendors_enterprise_class_ck and
   ganit_vendors_kind_ck (read from pg_constraint 2026-08-25, not from the
   migration). '' is the unrecorded state and is always offered: NULL means
   "nobody has said", which the 43B(h) skill counts apart from a real answer. */
const CLASSES = [['', 'Not recorded'], ['micro', 'Micro'], ['small', 'Small'], ['medium', 'Medium']];
const KINDS = [['', 'Not recorded'], ['manufacturer', 'Manufacturer'], ['service', 'Service'], ['trader', 'Trader']];
const MSME = [['', 'Not recorded'], ['yes', 'Yes'], ['no', 'No']];

/* ── ADDRESS ────────────────────────────────────────────────────────────────
 *
 * The defect (open finding 4): `staging.ganit_vendors.address` is `jsonb NOT
 * NULL DEFAULT '{}'`, `POST /v1/ganit/vendors` has always bound `body.address`
 * into the INSERT and `PATCH` has always bound it into the SET — and this form
 * had no `address` key at all. So the column was API-writable, already
 * populated, and unenterable by a human. Measured live 2026-08-27 against the
 * staging schema: of 9 active Unicode Group vendors **6** carry a non-empty
 * address object, and of 75 in E2E Test & Associates **40** do. A supplier
 * address that a person can neither type nor correct is the same failure shape
 * as `graha_contacts.territory_id` before Phase 7.0.
 *
 * The keys are NOT a new spelling. They are the seven `AddressBlock` reads and
 * `services/invoice_pdf.py:_fmt_addr` prints, in that order — a vendor written
 * with any other spelling would be invisible to the bill raised against it.
 * Confirmed against what is actually stored: the only keys present on any
 * `ganit_vendors.address` row are `city` (46), `line1` (46), `country`,
 * `pincode`, `state` and `state_code` (6 each). `line2` is unused today and is
 * still offered, because it is in the vocabulary the renderers read.
 *
 * `state_code` is the seventh and it is deliberately NOT a box. It is the
 * numeric GST code ('24' Gujarat, '27' Maharashtra) — reference data resolved
 * to a NAME for display and never printed raw, which is the standing rule in
 * `AddressBlock.stateOf` and `EmployeesTab`. It survives an edit through the
 * carry-through below, alongside every other key we do not render.
 */
const ADDRESS_BOXES = [
  ['line1', 'Address line 1', 'पता पंक्ति 1', {}],
  ['line2', 'Address line 2', 'पता पंक्ति 2', {}],
  ['city', 'City', 'शहर', {}],
  ['state', 'State', 'राज्य', {}],
  /* Six digits, and NOT enforced — the same call `graha/ContactsTab` documents.
     GSTIN/PAN/TAN are non-mandatory by owner rule and a pincode is the same
     kind of fact: a half-typed one must not stop somebody recording a supplier.
     `maxLength` and `inputMode` are help, not validation; `Unicode Group`'s
     `INC UK` already stores 'NW1 245' in a pincode and it must stay editable. */
  ['pincode', 'Pincode', 'पिन कोड', { inputMode: 'numeric', maxLength: 6, placeholder: '395002' }],
  /* Rendered because `_fmt_addr` PRINTS it and 6 live vendor rows carry it.
     Leaving it out would reproduce, one field smaller, the exact defect this
     block closes: written by the API, present on rows, unenterable. */
  ['country', 'Country', 'देश', { placeholder: 'Optional · for an overseas supplier' }],
];

const ADDRESS_BOX_KEYS = ADDRESS_BOXES.map(([k]) => k);

export const BLANK_ADDRESS = Object.freeze(
  Object.fromEntries(ADDRESS_BOX_KEYS.map(k => [k, ''])),
);

export const BLANK_VENDOR = {
  name: '', gstin: '', email: '', phone: '',
  address: { ...BLANK_ADDRESS },
  /* Every key of the stored object that is NOT one of the six boxes, carried
     verbatim from load to save. This is the whole of the non-destruction
     guarantee — see `vendorAddress` below. */
  address_extra: {},
  /* Whether a person touched an address box in THIS editing session. See
     `vendorPayload`: the `address` key is omitted entirely when false. */
  address_dirty: false,
  is_msme: '', enterprise_class: '', vendor_kind: '',
  udyam_number: '', tds_section: '', payment_terms_days: '',
};

/** A stored value is part of an address only if it is text with something in
 *  it. Mirrors `AddressBlock.text`, including the number leg — a pincode that
 *  was stored as `395002` rather than `'395002'` is still a pincode. */
function text(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '';
  if (typeof v !== 'string') return '';
  return v.trim();
}

/**
 * Whatever the column handed back → a plain object, or null.
 *
 * Deliberately NARROWER than `AddressBlock.asFields`, and the difference is the
 * point. That one is a display path and may fall back to `{ line1: <the whole
 * string> }` for a column holding loose text; doing that HERE would put a guess
 * into a payload and save it. So: a serialised object is decoded (one level —
 * `backend/db.py:_json_encoder` documents the double-encode that produced those
 * rows, and a bound depth means a hypothetical triple-encode cannot loop), and
 * anything else — loose text, an array, a number — yields null, which leaves
 * the boxes blank AND, because nothing then marks the form dirty, leaves the
 * column untouched on save.
 *
 * No live vendor row needs the decode today: `jsonb_typeof(address)='string'`
 * is 0 across all three orgs (measured 2026-08-27). It is here because the
 * fossil is documented on 38 jsonb columns across 26 tables and this form is
 * the one thing that would overwrite it.
 */
function asAddressObject(raw, depth = 0) {
  if (raw == null) return null;
  if (typeof raw === 'string') {
    const t = raw.trim();
    if (!t || depth > 0) return null;
    if (t[0] !== '{') return null;
    let parsed;
    try { parsed = JSON.parse(t); } catch { return null; }
    return asAddressObject(parsed, depth + 1);
  }
  if (typeof raw !== 'object' || Array.isArray(raw)) return null;
  return raw;
}

/**
 * The address to SAVE: every unrecognised key exactly as it was found, with the
 * six boxes written over the top.
 *
 * THE ROW THIS EXISTS FOR. Unicode Group's `Navrang Polymers` stores its
 * address as 43 keys: "0".."41" spelling `{"city": "Mumbai", "state":
 * "Maharashtra"}` one character per key, plus a genuine `city` reading "Navi
 * Mumbai" that contradicts the exploded copy. (It is a `graha_clients` row
 * today, not a vendor — but the fossil that produced it is column-agnostic and
 * `ganit_vendors.address` is one of the swept columns, so it is the shape this
 * form must survive, not a shape it may assume away.)
 *
 * Read the six names, ignore everything else, and NEVER reassemble anything.
 * Rebuilding a string from character-indexed keys is a guess, and it would lose
 * to the real `city` sitting beside it anyway. So an edit of Navrang's phone
 * number leaves all 43 keys where they are; an edit of its City replaces one of
 * them and leaves 42.
 *
 * The six are always written, including as `''`. A blank is NOT a deletion and
 * is not treated as one: `''` and an absent key read identically in every
 * consumer (`AddressBlock.text` trims and drops it, `_fmt_addr` filters falsy),
 * so writing the blank is how a value entered by mistake gets taken back —
 * exactly the tri-state argument the compliance columns above are built on.
 * A `delete` would be indistinguishable in effect and one branch harder to
 * reason about.
 */
export function vendorAddress(f) {
  const out = { ...(f.address_extra || {}) };
  for (const k of ADDRESS_BOX_KEYS) out[k] = text(f.address?.[k]);
  return out;
}

/** A live vendor row, hydrated into form state. `null` yields a blank form. */
export function vendorFormFrom(v) {
  if (!v) return { ...BLANK_VENDOR, address: { ...BLANK_ADDRESS }, address_extra: {} };
  const stored = asAddressObject(v.address);
  const address = { ...BLANK_ADDRESS };
  const address_extra = {};
  for (const [k, val] of Object.entries(stored || {})) {
    if (ADDRESS_BOX_KEYS.includes(k)) address[k] = text(val);
    else address_extra[k] = val;
  }
  return {
    name: v.name || '',
    gstin: v.gstin || '',
    email: v.email || '',
    phone: v.phone || '',
    address,
    address_extra,
    address_dirty: false,
    /* Tri-state on the way in as well: `is_msme` is boolean-or-NULL, so a
       null must hydrate as '' (not recorded) and false as 'no'. `?? ''`
       rather than `|| ''` for the same reason on the number — 0 days is a
       real answer (paid on delivery), not an empty box. */
    is_msme: v.is_msme === null || v.is_msme === undefined ? '' : v.is_msme ? 'yes' : 'no',
    enterprise_class: v.enterprise_class || '',
    vendor_kind: v.vendor_kind || '',
    udyam_number: v.udyam_number || '',
    tds_section: v.tds_section || '',
    payment_terms_days: v.payment_terms_days ?? '',
  };
}

/* Every compliance key is sent on every save, including blank ones — the
   backend reads `model_fields_set`, so a key that is present-and-blank clears
   the column to NULL and a key that is absent leaves it alone. Sending them
   all is what makes a value removable after it was entered by mistake. */
export function vendorPayload(f) {
  const p = {
    name: f.name, gstin: f.gstin, email: f.email, phone: f.phone,
    is_msme: f.is_msme === '' ? null : f.is_msme === 'yes',
    enterprise_class: f.enterprise_class,
    vendor_kind: f.vendor_kind,
    udyam_number: f.udyam_number,
    tds_section: f.tds_section,
    payment_terms_days: f.payment_terms_days === '' ? null : Number(f.payment_terms_days),
  };
  /* `address` is the ONE key that breaks the send-everything rule above, and
     for the opposite reason. The compliance columns are tri-states a person
     answers; an address is a whole object we did not necessarily author. On
     `VendorUpdate` the field is `dict | None = None` and the router only adds
     `address=$n::jsonb` to the SET when it is not None — so omitting the key is
     the router's own "leave this column exactly as it is".

     Somebody who opens a vendor to fix its TDS section must not rewrite the
     address as a side effect. That matters most for a row this form cannot
     fully represent: an address stored as a JSON string, or one carrying keys
     no box maps to. Untouched means unsent means unchanged — a guarantee no
     amount of careful merging can match, because merging still writes.

     On create there is nothing to protect, and nothing to send either: the
     column's DEFAULT is `'{}'::jsonb` and `VendorCreate.address` defaults to
     `{}`, so an untouched blank address arrives at the same value by both
     routes. */
  if (f.address_dirty) p.address = vendorAddress(f);
  return p;
}

/**
 * @param {object}   props
 * @param {object?}  props.vendor   the row being edited; absent/null creates.
 * @param {function} props.onSaved  called with the saved row.
 * @param {function} props.onCancel called when the user backs out.
 */
export default function VendorForm({ vendor = null, onSaved, onCancel }) {
  const { pushToast } = useToast();
  const vendorId = vendor?.id ?? null;
  const [seed, setSeed] = useState(vendorId);
  const [form, setForm] = useState(() => vendorFormFrom(vendor));
  const [saving, setSaving] = useState(false);

  /* Adjusting state during render, not in an effect — React's own pattern for
     "a prop changed and derived state must follow it". Kray keeps this form
     mounted while the user clicks Edit on a second vendor, and an effect would
     paint the previous supplier's details for one frame before correcting
     them. */
  if (vendorId !== seed) {
    setSeed(vendorId);
    setForm(vendorFormFrom(vendor));
  }

  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }));

  /* Typing in ANY address box marks the whole address dirty. Per-key dirtiness
     would be wrong: the six travel to the column as one jsonb value, so once a
     save has to write the object it writes all of it. `address_dirty` is
     one-way within an editing session — a person who types a city and deletes
     it again has still asked for the address to be saved as they left it. It
     resets when the form re-seeds onto a different vendor, above. */
  const setAddr = (k) => (e) => setForm(f => ({
    ...f, address_dirty: true, address: { ...f.address, [k]: e.target.value },
  }));

  async function submit(e) {
    e.preventDefault();
    /* The ONLY field that blocks a save. GSTIN, PAN and TAN are non-mandatory
       by product rule and so is every compliance column here — an unrecordable
       supplier is a worse outcome than an incompletely described one. */
    if (!form.name.trim()) { pushToast({ title: 'Name is required', type: 'error' }); return; }
    setSaving(true);
    let saved = null;
    try {
      const r = vendorId
        ? await api.patch(`/v1/ganit/vendors/${vendorId}`, vendorPayload(form))
        : await api.post('/v1/ganit/vendors', vendorPayload(form));
      saved = body(r);
    } catch (err) {
      pushToast({ title: apiErrorText(err, 'Could not save vendor'), type: 'error' });
    }
    /* Settled BEFORE `onSaved`, which is what closes this form on both call
       sites — a `finally` after it would be setting state on a component the
       caller has already unmounted. */
    setSaving(false);
    if (!saved) return;
    pushToast({ title: vendorId ? 'Vendor updated' : 'Vendor added', type: 'success' });
    onSaved?.(saved);
  }

  return (
    <form className="gn-form" onSubmit={submit}>
      <h4 className="gn-form__h">{vendorId ? 'Edit vendor' : 'New vendor'}</h4>
      <div className="gn-form__row">
        <label className="gn-form__field">
          Name <Hi t="नाम" />
          <input className="inp" required value={form.name} onChange={set('name')} />
        </label>
        <label className="gn-form__field">
          GSTIN <Hi t="जीएसटीआईएन" />
          <input className="inp" value={form.gstin} onChange={set('gstin')} placeholder="Optional" />
        </label>
      </div>
      <div className="gn-form__row">
        <label className="gn-form__field">
          Email <Hi t="ईमेल" />
          <input className="inp" type="email" value={form.email} onChange={set('email')} />
        </label>
        <label className="gn-form__field">
          Phone <Hi t="फ़ोन" />
          <input className="inp" value={form.phone} onChange={set('phone')} />
        </label>
      </div>
      {/* Reuses `.gn-form__h`, the sub-heading already on this form, so the
          group needs no new rule in `ganit.css`. `.gn-form__row` is an auto-fit
          grid, so a row holding one field spans the panel and a row holding two
          splits it — the layout stays fluid and left-aligned at every width
          without a fixed column count. */}
      <div className="gn-form__h">Address <Hi t="पता" /></div>
      {/* 7.6 — look it up, then correct it by hand. The six boxes below stay
          the record: autosuggest FILLS them and never replaces them, because a
          supplier's premises is exactly the field a vendor's database is most
          likely to be wrong about, and the person entering it is the one who
          knows. Choosing a suggestion marks the address dirty for the same
          reason typing does — `vendorPayload` omits the whole `address` key
          otherwise and the fill would be silently discarded on save.

          ⚠ Content submitted to Mappls carries a perpetual, sub-licensable
          licence back to them. Only the FRAGMENT being typed goes; the stored
          record never does, and `AddressSuggest` has no `useEffect` on its
          value precisely so that opening an existing vendor submits nothing. */}
      <AddressSuggest
        label="Find an address"
        value={form.address_query || ''}
        onChange={q => setForm(f => ({ ...f, address_query: q }))}
        onSelect={(s) => setForm(f => ({
          ...f,
          address_dirty: true,
          address_query: s.label || '',
          address: {
            ...f.address,
            // Only keys the suggestion actually carried. A blank from the
            // vendor must not erase something a person already typed.
            ...(s.line1 ? { line1: s.line1 } : {}),
            ...(s.city ? { city: s.city } : {}),
            ...(s.state ? { state: s.state } : {}),
            ...(s.pincode ? { pincode: s.pincode } : {}),
          },
        }))}
      />
      {/* 7.6's other half, and the half that needs nobody's permission: our
          OWN pincode directory (20,144 government rows, already in the
          database) names the district and offers the state. No key, no quota,
          no vendor call and no licence — nothing is submitted, so nothing is
          licensed. It fills STATE only: a district is not a city, and 400706
          is THANE district with Navi Mumbai as its city. */}
      <PincodeAutofill
        pincode={form.address.pincode}
        state={form.address.state}
        onFill={patch => setForm(f => ({
          ...f, address_dirty: true, address: { ...f.address, ...patch },
        }))}
      />
      {[['line1'], ['line2'], ['city', 'state'], ['pincode', 'country']].map(keys => (
        <div className="gn-form__row" key={keys.join('-')}>
          {keys.map((key) => {
            const [, label, hi, attrs] = ADDRESS_BOXES.find(([k]) => k === key);
            return (
              <label className="gn-form__field" key={key}>
                {label} <Hi t={hi} />
                <input
                  className="inp"
                  {...attrs}
                  value={form.address[key] || ''}
                  onChange={setAddr(key)}
                />
              </label>
            );
          })}
        </div>
      ))}
      <div className="gn-form__row">
        <label className="gn-form__field">
          MSME registered <Hi t="एमएसएमई" />
          <select className="inp" value={form.is_msme} onChange={set('is_msme')}>
            {MSME.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
        <label className="gn-form__field">
          Enterprise class <Hi t="श्रेणी" />
          <select className="inp" value={form.enterprise_class} onChange={set('enterprise_class')}>
            {CLASSES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <small className="fld__hint">
            Micro and small suppliers are covered by the 45-day payment rule. Medium is not.
          </small>
        </label>
      </div>
      <div className="gn-form__row">
        <label className="gn-form__field">
          Vendor kind <Hi t="प्रकार" />
          <select className="inp" value={form.vendor_kind} onChange={set('vendor_kind')}>
            {KINDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <small className="fld__hint">Traders are outside the rule.</small>
        </label>
        <label className="gn-form__field">
          Udyam number <Hi t="उद्यम संख्या" />
          <input
            className="inp"
            value={form.udyam_number}
            onChange={set('udyam_number')}
            placeholder="Optional · UDYAM-XX-00-0000000"
          />
        </label>
      </div>
      <div className="gn-form__row">
        <label className="gn-form__field">
          TDS section <Hi t="टीडीएस धारा" />
          <input
            className="inp"
            value={form.tds_section}
            onChange={set('tds_section')}
            placeholder="Optional · e.g. 194C"
          />
        </label>
        <label className="gn-form__field">
          Payment terms <Hi t="भुगतान अवधि" />
          <input
            className="inp"
            type="number"
            min="0"
            max="365"
            value={form.payment_terms_days}
            onChange={set('payment_terms_days')}
            placeholder="Days · blank means no written agreement"
          />
        </label>
      </div>
      <div className="gn-form__acts">
        <button type="button" className="btn btn--ghost btn--sm" onClick={onCancel}>Cancel</button>
        <button type="submit" className="btn btn--fill btn--sm" disabled={saving}>
          {saving ? 'Saving…' : vendorId ? 'Update vendor' : 'Save vendor'}
        </button>
      </div>
    </form>
  );
}
