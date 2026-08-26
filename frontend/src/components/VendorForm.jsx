import React, { useState } from 'react';
import { api, body } from '../lib/api';
import { useToast } from './ui/toast';

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

export const BLANK_VENDOR = {
  name: '', gstin: '', email: '', phone: '',
  is_msme: '', enterprise_class: '', vendor_kind: '',
  udyam_number: '', tds_section: '', payment_terms_days: '',
};

/** A live vendor row, hydrated into form state. `null` yields a blank form. */
export function vendorFormFrom(v) {
  if (!v) return { ...BLANK_VENDOR };
  return {
    name: v.name || '',
    gstin: v.gstin || '',
    email: v.email || '',
    phone: v.phone || '',
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
  return {
    name: f.name, gstin: f.gstin, email: f.email, phone: f.phone,
    is_msme: f.is_msme === '' ? null : f.is_msme === 'yes',
    enterprise_class: f.enterprise_class,
    vendor_kind: f.vendor_kind,
    udyam_number: f.udyam_number,
    tds_section: f.tds_section,
    payment_terms_days: f.payment_terms_days === '' ? null : Number(f.payment_terms_days),
  };
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
      pushToast({ title: err.response?.data?.detail || 'Could not save vendor', type: 'error' });
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
