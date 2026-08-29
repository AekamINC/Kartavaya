import React, { useEffect, useRef, useState } from 'react';
import { api } from '../../lib/api';
import { Button, ErrorState, SkeletonCard, useToast } from '../../components/ui';
import {
  validateGSTIN, validatePAN, validateTAN, validateIFSC, panFromGSTIN,
  GST_STATES, stateFromGSTIN,
} from '../../lib/validators';
import { oversizeMessage } from '../../lib/uploadLimits';
import LogoUpload from './LogoUpload';
import { apiErrorText } from '../../lib/apiError';

/**
 * TabProfile — the company identity that every printed document is built from.
 *
 * ── The defect that had to be verified before touching anything ──────────────
 * `10-org-settings.md` does not list it, but the ledger claim that a swallowed
 * load error let Save overwrite a real company profile with blank strings was
 * REAL, and it is already fixed on staging (OrgSettingsPage.jsx lines 78–96 in
 * the version this file replaces). Both halves of that fix are carried across
 * verbatim, because losing either one restores the bug:
 *
 *   1. A failed GET sets `profileError` and the form is NOT rendered. A blank
 *      form is indistinguishable from an org that has filled nothing in.
 *   2. PATCH sends only the keys that actually changed. GET returns a freshly
 *      SIGNED `logo_url` derived from `logo_key`, so echoing the whole object
 *      back writes an expiring URL into the stored column.
 *
 * ── Four fields from the design that are deliberately absent ────────────────
 * `description`, `industry`, `team_size` and `founded_year`. `ProfileUpdate` in
 * `backend/routers/org_profile.py` does not carry them and pydantic drops
 * unknown keys without complaining, so a field for any of them would accept
 * what the user typed, report "saved", and lose it on reload. An absent field
 * is better than one that silently discards work. They need four columns on
 * `staging.organisations` and four names on `ProfileUpdate` first.
 */

const EMPTY = {
  // `logo_key` sits beside `logo_url` because the KEY is the asset and the url
  // is a nine-hour signature over it. Upload stored only the url, so the column
  // held a string that stopped resolving the same day, and nothing was left to
  // re-sign it from — `LogoUpload.jsx` already says the url is a stale mirror
  // and every consumer signs `logo_key` at read time. GET returns both; the
  // diff below sends whichever actually changed.
  name: '', gstin: '', pan: '', tan: '', state_code: '', logo_url: '', logo_key: '', email: '', phone: '', website: '',
  billing_address: { line1: '', line2: '', city: '', state: '', pincode: '', country: 'India' },
  bank_details: { account_name: '', account_number: '', ifsc: '', bank_name: '', branch: '', upi_id: '' },
  invoice_note: '',
};

/**
 * A jsonb field as an OBJECT, whatever the server actually sent.
 *
 * `{...someString}` is legal JavaScript and silently yields `{0:'{', 1:'"', …}`
 * — one key per character. That is not hypothetical: `GET /v1/org/profile`
 * returned `billing_address` as a JSON *string*, this component spread it, and
 * the org's address was saved back with 122 character-indexed keys while every
 * address input rendered blank. The server side is fixed, but the guard stays:
 * the failure is silent, produces no error anywhere, and corrupts the stored
 * row rather than merely displaying it wrong.
 *
 * Numeric keys are dropped so a row already corrupted by the old build renders
 * its real fields.
 */
function asObject(v) {
  if (!v) return {};
  let o = v;
  // Twice: a doubly-encoded row parses to a string on the first pass.
  for (let i = 0; i < 2 && typeof o === 'string'; i++) {
    try { o = JSON.parse(o); } catch { return {}; }
  }
  if (!o || typeof o !== 'object' || Array.isArray(o)) return {};
  return Object.fromEntries(Object.entries(o).filter(([k]) => !/^\d+$/.test(k)));
}

/**
 * The GST state codes, by NAME, sorted by name.
 *
 * ⚠ REUSED, NOT RESTATED. `GST_STATES` is the one code→name table on this side
 * and `AddressBlock`, `EmployeesTab`, `HolidaysTab`, `PtLadderSection` and
 * `InvoiceForm` all read it. A second copy here is how the invoice form and the
 * profile end up disagreeing about which code is Ladakh.
 *
 * The VALUE is the numeric code — that is what `organisations.state_code`
 * holds and what `client_billing._supplier_state` reads. The visible text is
 * the NAME and only the name: "Ahmedabad, 24" reads as a house number, which is
 * the convention `AddressBlock.stateOf` was written to enforce.
 */
const STATE_OPTIONS = Object.entries(GST_STATES)
  .sort((a, b) => a[1].localeCompare(b[1]));

/** label + select + persistent hint + stacked error — `F`'s shape, one tag over.
 *
 * A SELECT and never a text box. This value decides CGST/SGST versus IGST on
 * every invoice the firm raises, and a free-text box would let "Maharastra",
 * "MH " and "27" all be stored as different states — the exact reason
 * `InvoiceForm` made place-of-supply a select. It also means the 400 the server
 * raises for an unrecognised code is unreachable from this screen. */
function S({ id, label, hint, error, value, onChange, children }) {
  return (
    <div className="of__f">
      <label className="of__l" htmlFor={id}>{label}</label>
      <select
        id={id}
        className="of__i"
        value={value ?? ''}
        onChange={onChange}
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={[hint && `${id}-h`, error && `${id}-e`].filter(Boolean).join(' ') || undefined}
      >
        {children}
      </select>
      {hint && <span className="of__h" id={`${id}-h`}>{hint}</span>}
      {error && <span className="of__e" id={`${id}-e`} role="alert">{error}</span>}
    </div>
  );
}

/** label + input + persistent hint + stacked error (26 §3). */
function F({ id, label, hint, error, mono, wide, value, onChange, onBlur, ...rest }) {
  return (
    <div className={`of__f${wide ? ' of__f--wide' : ''}`}>
      <label className="of__l" htmlFor={id}>{label}</label>
      <input
        id={id}
        className={`of__i${mono ? ' of__i--mono' : ''}`}
        value={value ?? ''}
        onChange={onChange}
        onBlur={onBlur}
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={[hint && `${id}-h`, error && `${id}-e`].filter(Boolean).join(' ') || undefined}
        {...rest}
      />
      {/* The hint stays when the error appears. Swapping them deletes the format
          instruction at the exact moment the user has proven they need it. */}
      {hint && <span className="of__h" id={`${id}-h`}>{hint}</span>}
      {error && <span className="of__e" id={`${id}-e`} role="alert">{error}</span>}
    </div>
  );
}

export default function TabProfile() {
  const { pushToast, dismiss } = useToast();
  // The id of the validation toast currently on screen, so a later SUCCESS
  // can take it down. F37: correcting a bad GSTIN and saving again showed
  // “✓ Company profile saved” beside a still-live “✕ Fix the highlighted
  // codes before saving” — the screen said the save both worked and did not.
  const validationToast = useRef(null);
  const [profile, setProfile] = useState(EMPTY);
  const [loaded, setLoaded] = useState(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [errors, setErrors] = useState({});

  useEffect(() => {
    let alive = true;
    api.get('/v1/org/profile')
      .then(r => {
        if (!alive) return;
        const merged = {
          ...EMPTY, ...r.data,
          // `state_code` is deliberately NOT coalesced here, and the first
          // draft of this fix did coalesce it with a comment claiming it kept
          // the save diff honest. The mutation proof showed that claim was
          // false — `null` compares equal to `null` and the diff was correct
          // either way — so it was dead code with a reason attached, which is
          // worse than no code. `S` handles the null, once, the way `F` does.
          billing_address: { ...EMPTY.billing_address, ...asObject(r.data.billing_address) },
          bank_details: { ...EMPTY.bank_details, ...asObject(r.data.bank_details) },
        };
        setProfile(merged);
        setLoaded(merged);
      })
      .catch(() => { if (alive) setFailed(true); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  const set = (k, v) => setProfile(p => ({ ...p, [k]: v }));
  const setAddr = (k, v) => setProfile(p => ({ ...p, billing_address: { ...p.billing_address, [k]: v } }));
  const setBank = (k, v) => setProfile(p => ({ ...p, bank_details: { ...p.bank_details, [k]: v } }));

  const check = (field, validate) => e =>
    setErrors(prev => ({ ...prev, [field]: validate(e.target.value) }));

  const uploadLogo = async (file) => {
    // The server counts the bytes too, but only after they have all arrived —
    // and a logo is picked from a phone photo library as often as from a design
    // folder, so a 12 MB PNG is an ordinary mistake rather than an odd one.
    const tooBig = oversizeMessage([file]);
    if (tooBig) {
      pushToast({ type: 'error', title: 'That logo is too large', message: tooBig });
      return;
    }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const r = await api.post('/upload', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      // ONE update, both fields. Two calls to `set` would leave a render in
      // which the profile carries the new url and the old key — and that is the
      // exact pair the save diffs, so a Save landing between them would store a
      // url signed from an object the key no longer names.
      setProfile(p => ({ ...p, logo_url: r.data.url, logo_key: r.data.key || '' }));
      pushToast({ type: 'info', title: 'Logo attached — Save to apply it' });
    } catch (err) {
      // The reason, not just the fact. When object storage is unconfigured the
      // server now REFUSES rather than inlining the file as a data URI, and its
      // 503 names the variables that are missing — which is the one message an
      // administrator can act on. "Logo upload failed" sent them nowhere.
      pushToast({
        type: 'error',
        title: 'Logo upload failed',
        message: apiErrorText(err, '') || undefined,
      });
    } finally { setUploading(false); }
  };

  const save = async () => {
    // ── GSTIN, PAN AND TAN DO NOT GATE THIS SAVE ───────────────────────────
    //
    // Owner's ruling 2026-08-08: "all gst, pan, tan needs to be non mandatory
    // so no check on org page", after "not all indian company needs GST".
    // That is the law and not a preference — GST registration begins at the
    // turnover threshold, and TAN exists only for a firm deducting tax at
    // source.
    //
    // What this used to do was refuse the WHOLE form — name, address, bank
    // details, everything — because one statutory code did not match a pattern
    // WE wrote. If our check digit or our regex is wrong about some legitimate
    // number, that firm cannot save its own details and has nothing to argue
    // with. The complaint still shows under the field, and the server echoes
    // its own in `code_warnings`; neither stops the save.
    //
    // IFSC still gates, and is a different kind of thing: it is not a
    // statutory registration, it is where money is sent. A wrong one is a
    // failed transfer, and it is checkable against a fixed format that banks
    // actually issue.
    const ifsc = validateIFSC(profile.bank_details.ifsc);
    setErrors(e => ({
      ...e,
      gstin: validateGSTIN(profile.gstin),
      pan: validatePAN(profile.pan),
      tan: validateTAN(profile.tan),
      ifsc,
    }));
    if (ifsc) {
      if (validationToast.current) dismiss(validationToast.current);
      validationToast.current = pushToast({
        type: 'error', title: 'Check the IFSC before saving — payments go to it',
      });
      return;
    }

    // Validation passed, so any complaint still on screen is about a value
    // the user has since corrected. Clear it BEFORE the request, not after:
    // if the save then fails for another reason, its own toast should be the
    // only one showing.
    if (validationToast.current) {
      dismiss(validationToast.current);
      validationToast.current = null;
    }
    const changed = {};
    for (const [k, v] of Object.entries(profile)) {
      if (JSON.stringify(v) !== JSON.stringify(loaded?.[k])) changed[k] = v;
    }
    if (!Object.keys(changed).length) {
      pushToast({ type: 'info', title: 'No changes to save' });
      return;
    }

    setSaving(true);
    try {
      const r = await api.patch('/v1/org/profile', changed);
      setLoaded(profile);
      // The SERVER's own reading of the statutory codes, so the field messages
      // cannot drift from what was actually stored. An empty object clears
      // them, which is how a corrected typo stops being complained about.
      const warn = r.data?.code_warnings || {};
      setErrors(e => ({
        ...e,
        gstin: warn.gstin || null,
        pan: warn.pan || null,
        tan: warn.tan || null,
        // A retired code — 25 or 28 — saves and then says so. It resolves to a
        // real state name so an old GSTIN is still readable, but nothing is
        // issued on either today, so a fresh one is almost certainly a typo.
        state_code: warn.state_code || null,
      }));
      pushToast({
        type: 'success',
        title: 'Company profile saved',
        // Saved, and still worth knowing: GSTR-1 emits the GSTIN and the TDS
        // challan emits the TAN, so a typo here surfaces months later when a
        // portal rejects a return.
        message: Object.keys(warn).length
          ? 'Saved. One or more codes do not look right — check the highlighted fields.'
          : undefined,
      });
    } catch (err) {
      pushToast({ type: 'error', title: apiErrorText(err, 'Failed to save profile') });
    } finally { setSaving(false); }
  };

  if (loading) return <SkeletonCard lines={6} />;

  // Not an ErrorState with a retry: a retry that re-renders the same failed
  // fetch is a button that lies. The form stays hidden because saving a blank
  // one overwrites what is stored.
  if (failed) {
    return (
      <ErrorState
        kind="server"
        detail="Couldn’t load the company profile. The form stays hidden rather than showing blank — saving a blank form would overwrite what’s stored. Reload to try again."
        onRetry={() => window.location.reload()}
      />
    );
  }

  // A GSTIN carries the holder's PAN at characters 3–12. When both are filled
  // and they disagree, one of the two is a typo — and neither field is wrong on
  // its own, so neither validator can catch it.
  const embedded = panFromGSTIN(profile.gstin);
  const panMismatch = embedded && profile.pan && embedded !== profile.pan.trim().toUpperCase()
    ? `This PAN does not match the one inside the GSTIN (${embedded}).`
    : null;

  // The GSTIN's first two characters ARE the state of registration, so when
  // both are filled and they disagree one of them is wrong — and, exactly as
  // with the PAN above, neither field is invalid on its own so neither
  // validator can see it. Said as a NAME, never as the digits.
  //
  // It reports and does not correct. Which of the two is the typo is not
  // knowable from here, and a control that silently rewrote the field deciding
  // CGST/SGST versus IGST would be worse than the disagreement it fixed.
  const fromGstin = stateFromGSTIN(profile.gstin);
  const stateMismatch = fromGstin && profile.state_code && fromGstin.code !== profile.state_code
    ? `This GSTIN was issued in ${fromGstin.name}. Check which of the two is right — this field decides whether an invoice is taxed CGST/SGST or IGST.`
    : null;

  // A code the list does not carry — '28', pre-bifurcation Andhra Pradesh, is
  // the real case: the server resolves it, this table deliberately does not.
  // Without an option for it the select renders BLANK over a populated column,
  // which is a control lying about what is stored.
  const unlisted = profile.state_code && !GST_STATES[profile.state_code]
    ? profile.state_code
    : null;

  return (
    <div>
      <section className="st__group">
        <h2 className="st__gt">Logo</h2>
        <LogoUpload url={profile.logo_url} busy={uploading} onFile={uploadLogo} />
      </section>

      <section className="st__group">
        <h2 className="st__gt">Company</h2>
        <div className="of">
          <F id="org-name" label="Legal name" value={profile.name}
            hint="As registered — this is what prints on the invoice."
            onChange={e => set('name', e.target.value)} />
          <F id="org-email" label="Email" type="email" value={profile.email}
            onChange={e => set('email', e.target.value)} />
          <F id="org-phone" label="Phone" type="tel" value={profile.phone}
            onChange={e => set('phone', e.target.value)} />
          <F id="org-web" label="Website" value={profile.website}
            onChange={e => set('website', e.target.value)} />
        </div>
      </section>

      <section className="st__group">
        <h2 className="st__gt">Tax</h2>
        <div className="of">
          <F id="org-gstin" label="GSTIN" mono value={profile.gstin}
            hint="15 characters. Checked on blur, including the check digit."
            error={errors.gstin}
            onBlur={check('gstin', validateGSTIN)}
            onChange={e => set('gstin', e.target.value)} />
          <F id="org-pan" label="PAN" mono value={profile.pan}
            hint="10 characters: five letters, four digits, a letter."
            error={errors.pan || panMismatch}
            onBlur={check('pan', validatePAN)}
            onChange={e => set('pan', e.target.value)} />
          {/* TAN. Absent until now, and the omission was load-bearing: the TDS
              challan (ITNS-281) refuses without one and told the user to "Set
              it in Settings → Organisation → Company Profile", which is this
              screen, which had no TAN field. The challan form is otherwise
              complete, so it could be filled in full and then never issued. */}
          <F id="org-tan" label="TAN" mono value={profile.tan}
            hint="10 characters: four letters, five digits, a letter. Needed for the TDS challan."
            error={errors.tan}
            onBlur={check('tan', validateTAN)}
            onChange={e => set('tan', e.target.value)} />
          {/* GST state. Absent until now, and the omission was load-bearing in
              exactly the way the TAN's was: `client_billing` refuses to raise
              an invoice without it — "Set the organisation's state in Settings
              -> Profile" — which is THIS screen, which had no such field. Two
              of five live organisations sat at NULL and could not raise a GST
              invoice by any route.

              ⚠ "Not set" is a real, permitted answer and stays first in the
              list. Blocking a blank would lock those two orgs out of saving
              their name, address and bank details over a field they have never
              been able to fill in — the same rule that keeps GSTIN, PAN and
              TAN from blocking anything. */}
          <S id="org-state-code" label="GST state"
            hint="The state you supply from. Decides whether an invoice is taxed CGST/SGST or IGST."
            error={errors.state_code || stateMismatch}
            value={profile.state_code}
            onChange={e => set('state_code', e.target.value)}>
            <option value="">Not set</option>
            {unlisted && <option value={unlisted}>{`Code ${unlisted} — no longer issued`}</option>}
            {STATE_OPTIONS.map(([code, name]) => (
              <option key={code} value={code}>{name}</option>
            ))}
          </S>
        </div>
      </section>

      <section className="st__group">
        <h2 className="st__gt">Registered address</h2>
        <div className="of">
          <F id="org-l1" label="Address line 1" value={profile.billing_address.line1}
            onChange={e => setAddr('line1', e.target.value)} />
          <F id="org-l2" label="Address line 2" value={profile.billing_address.line2}
            onChange={e => setAddr('line2', e.target.value)} />
        </div>
        <div className="of of--3 of--stacked">
          <F id="org-city" label="City" value={profile.billing_address.city}
            onChange={e => setAddr('city', e.target.value)} />
          {/* This is the state as it PRINTS on the letterhead, and it is not
              the field that taxes an invoice — that is "GST state" under Tax.
              The two were indistinguishable while only this one existed, so a
              firm could type "Gujarat" here, see a state on the form, and still
              be refused an invoice for having no state_code. */}
          <F id="org-state" label="State" value={profile.billing_address.state}
            hint="Printed on the letterhead. The tax state is under Tax."
            onChange={e => setAddr('state', e.target.value)} />
          <F id="org-pin" label="Pincode" inputMode="numeric" value={profile.billing_address.pincode}
            onChange={e => setAddr('pincode', e.target.value)} />
          <F id="org-country" label="Country" value={profile.billing_address.country}
            onChange={e => setAddr('country', e.target.value)} />
        </div>
      </section>

      <section className="st__group">
        <h2 className="st__gt">Bank details</h2>
        <p className="of__h of__h--lede">
          Printed on every invoice so a client can pay without asking for them.
        </p>
        <div className="of">
          <F id="org-acn" label="Account name" value={profile.bank_details.account_name}
            onChange={e => setBank('account_name', e.target.value)} />
          <F id="org-acno" label="Account number" value={profile.bank_details.account_number}
            onChange={e => setBank('account_number', e.target.value)} />
          <F id="org-ifsc" label="IFSC" mono value={profile.bank_details.ifsc}
            hint="11 characters: four letters, a zero, six more."
            error={errors.ifsc}
            onBlur={check('ifsc', validateIFSC)}
            onChange={e => setBank('ifsc', e.target.value)} />
          <F id="org-bank" label="Bank name" value={profile.bank_details.bank_name}
            onChange={e => setBank('bank_name', e.target.value)} />
          <F id="org-branch" label="Branch" value={profile.bank_details.branch}
            onChange={e => setBank('branch', e.target.value)} />
          <F id="org-upi" label="UPI ID" value={profile.bank_details.upi_id}
            onChange={e => setBank('upi_id', e.target.value)} />
        </div>
      </section>

      <section className="st__group">
        <h2 className="st__gt">Invoice footer</h2>
        <div className="of">
          <F id="org-note" label="Footer note" wide value={profile.invoice_note}
            hint="Prints under the totals on every invoice."
            placeholder="e.g. Thank you for your business."
            onChange={e => set('invoice_note', e.target.value)} />
        </div>
      </section>

      <Button variant="fill" onClick={save} disabled={saving}>
        {saving ? 'Saving…' : 'Save company profile'}
      </Button>
    </div>
  );
}
