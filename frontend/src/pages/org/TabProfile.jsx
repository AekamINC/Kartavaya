import React, { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { Button, ErrorState, SkeletonCard, useToast } from '../../components/ui';
import { validateGSTIN, validatePAN, validateIFSC, panFromGSTIN } from '../../lib/validators';
import LogoUpload from './LogoUpload';

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
  name: '', gstin: '', pan: '', logo_url: '', email: '', phone: '', website: '',
  billing_address: { line1: '', line2: '', city: '', state: '', pincode: '', country: 'India' },
  bank_details: { account_name: '', account_number: '', ifsc: '', bank_name: '', branch: '', upi_id: '' },
  invoice_note: '',
};

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
  const { pushToast } = useToast();
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
          billing_address: { ...EMPTY.billing_address, ...(r.data.billing_address || {}) },
          bank_details: { ...EMPTY.bank_details, ...(r.data.bank_details || {}) },
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
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const r = await api.post('/upload', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      set('logo_url', r.data.url);
      pushToast({ type: 'info', title: 'Logo attached — Save to apply it' });
    } catch {
      pushToast({ type: 'error', title: 'Logo upload failed' });
    } finally { setUploading(false); }
  };

  const save = async () => {
    const found = {
      gstin: validateGSTIN(profile.gstin),
      pan: validatePAN(profile.pan),
      ifsc: validateIFSC(profile.bank_details.ifsc),
    };
    if (Object.values(found).some(Boolean)) {
      setErrors(found);
      pushToast({ type: 'error', title: 'Fix the highlighted codes before saving' });
      return;
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
      await api.patch('/v1/org/profile', changed);
      setLoaded(profile);
      pushToast({ type: 'success', title: 'Company profile saved' });
    } catch (err) {
      pushToast({ type: 'error', title: err?.response?.data?.detail || 'Failed to save profile' });
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
          <F id="org-state" label="State" value={profile.billing_address.state}
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
