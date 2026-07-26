/**
 * OrgSettingsPage.jsx — Org-level member management for org admins/owners.
 * Uses /api/v1/org/members (self-service, no platform admin needed).
 */
import React, { useState, useEffect, useCallback } from 'react';
import { currentUser } from '../lib/auth';
import { api } from '../lib/api';
import { useToast } from '../components/ui/toast';
import { PageHeader } from '../components/editorial';
import { validateGSTIN, validatePAN, validateIFSC } from '../lib/validators';

const ALL_MODULES = [
  { code: 'graha',   label: 'Graha · CRM' },
  { code: 'ganit',   label: 'Ganit · Invoicing',  sensitive: true },
  { code: 'manav',   label: 'Manav · HRMS',       sensitive: true },
  { code: 'vikray',  label: 'Vikray · Sales' },
  { code: 'vetana',  label: 'Vetana · Payroll',    sensitive: true },
  { code: 'dristi',  label: 'Dristi · Analytics' },
  { code: 'prachar', label: 'Prachar · Marketing' },
  { code: 'srijan',  label: 'Srijan · AI Hub' },
];

const ROLE_OPTIONS = [
  { code: 'org_admin',  label: 'Org Admin' },
  { code: 'org_member', label: 'Org Member' },
];

const ROLE_LABELS = { org_owner: 'Owner', org_admin: 'Org Admin', org_member: 'Org Member' };
/** `org_member`.replace('_',' ') rendered "org member" — lowercase, to the user. */
const roleLabel = code =>
  ROLE_LABELS[code] || String(code || '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

/** Sensitive modules read as danger; the rest take the accent. */
const modTone = mod => (mod.sensitive ? 'var(--danger)' : 'var(--primary)');

const EMPTY_PROFILE = {
  name: '', gstin: '', pan: '', logo_url: '', email: '', phone: '', website: '',
  billing_address: { line1: '', line2: '', city: '', state: '', pincode: '', country: 'India' },
  bank_details: { account_name: '', account_number: '', ifsc: '', bank_name: '', branch: '', upi_id: '' },
  invoice_note: '',
};

export default function OrgSettingsPage() {
  const user = currentUser();
  const { pushToast } = useToast();
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);

  const [profile, setProfile] = useState(EMPTY_PROFILE);
  // The value the server gave us, so a save can send only what actually
  // changed. See saveProfile for why sending the whole object was destructive.
  const [loadedProfile, setLoadedProfile] = useState(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const [profileError, setProfileError] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [codeErrors, setCodeErrors] = useState({});

  const [addEmail, setAddEmail] = useState('');
  const [addRole, setAddRole] = useState('org_member');
  const [addMobile, setAddMobile] = useState('');
  const [adding, setAdding] = useState(false);

  const [editingModules, setEditingModules] = useState(null);
  const [savingModules, setSavingModules] = useState(false);

  const orgRole = user?.org_roles?.find(r => r.role_code === 'org_admin' || r.role_code === 'org_owner');

  const load = useCallback(() => {
    api.get('/v1/org/members')
      .then(r => setMembers(Array.isArray(r.data) ? r.data : []))
      .catch(() => pushToast({ type: 'error', title: 'Failed to load members' }))
      .finally(() => setLoading(false));
  }, [pushToast]);

  useEffect(() => { load(); }, [load]);

  // A failed load used to be swallowed with `.catch(() => {})`, leaving the form
  // showing EMPTY_PROFILE — indistinguishable from an org that has filled in
  // nothing. Since saveProfile PATCHed the whole object, the next click of Save
  // overwrote a real company profile with blank strings. A display bug that
  // destroys data, so the form is not rendered at all unless the load succeeded.
  useEffect(() => {
    api.get('/v1/org/profile')
      .then(r => {
        const merged = {
          ...EMPTY_PROFILE, ...r.data,
          billing_address: { ...EMPTY_PROFILE.billing_address, ...(r.data.billing_address || {}) },
          bank_details: { ...EMPTY_PROFILE.bank_details, ...(r.data.bank_details || {}) },
        };
        setProfile(merged);
        setLoadedProfile(merged);
      })
      .catch(() => setProfileError(true))
      .finally(() => setProfileLoading(false));
  }, []);

  const saveProfile = async () => {
    const errors = {
      gstin: validateGSTIN(profile.gstin),
      pan: validatePAN(profile.pan),
      ifsc: validateIFSC(profile.bank_details.ifsc),
    };
    if (Object.values(errors).some(Boolean)) {
      setCodeErrors(errors);
      pushToast({ type: 'error', title: 'Fix the highlighted codes before saving' });
      return;
    }

    // Send only what changed. Two reasons beyond bandwidth: GET returns a
    // freshly SIGNED logo_url derived from logo_key, so echoing the whole object
    // back writes an expiring URL into the stored column; and a PATCH that
    // always carries every field turns any stale local state into a silent
    // overwrite of someone else's concurrent edit.
    const changed = {};
    for (const [k, v] of Object.entries(profile)) {
      if (JSON.stringify(v) !== JSON.stringify(loadedProfile?.[k])) changed[k] = v;
    }
    if (!Object.keys(changed).length) {
      pushToast({ type: 'info', title: 'No changes to save' });
      return;
    }

    setSavingProfile(true);
    try {
      await api.patch('/v1/org/profile', changed);
      setLoadedProfile(profile);
      pushToast({ type: 'success', title: 'Company profile saved' });
    } catch (err) {
      pushToast({ type: 'error', title: err?.response?.data?.detail || 'Failed to save profile' });
    } finally { setSavingProfile(false); }
  };

  const checkCode = (field, validate) => (e) =>
    setCodeErrors(prev => ({ ...prev, [field]: validate(e.target.value) }));

  const uploadLogo = async (file) => {
    if (!file) return;
    setUploadingLogo(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const r = await api.post('/upload', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      setProfile(p => ({ ...p, logo_url: r.data.url }));
      pushToast({ type: 'success', title: 'Logo uploaded — click Save to apply' });
    } catch (err) {
      pushToast({ type: 'error', title: 'Logo upload failed' });
    } finally { setUploadingLogo(false); }
  };

  const addMember = async () => {
    if (!addEmail.trim()) return;
    setAdding(true);
    try {
      const res = await api.post('/v1/org/members', { email: addEmail.trim(), role: addRole, mobile_number: addMobile.trim() });
      pushToast({ type: 'success', title: `${addEmail} added as ${res.data.role.replace('_', ' ')}` });
      setAddEmail(''); setAddMobile('');
      load();
    } catch (err) {
      pushToast({ type: 'error', title: err?.response?.data?.detail || 'Failed to add member' });
    } finally { setAdding(false); }
  };

  const removeMember = async (userId, email) => {
    if (!confirm(`Remove ${email} from this organisation?`)) return;
    try {
      await api.delete(`/v1/org/members/${userId}`);
      pushToast({ type: 'success', title: `${email} removed` });
      load();
    } catch (err) {
      pushToast({ type: 'error', title: err?.response?.data?.detail || 'Failed to remove member' });
    }
  };

  const changeRole = async (userId, newRole) => {
    try {
      await api.put(`/v1/org/members/${userId}/role?role=${newRole}`);
      pushToast({ type: 'success', title: 'Role updated' });
      load();
    } catch (err) {
      pushToast({ type: 'error', title: err?.response?.data?.detail || 'Failed to update role' });
    }
  };

  const saveModules = async (userId, modules) => {
    setSavingModules(true);
    try {
      await api.put(`/v1/org/members/${userId}/modules`, { modules });
      pushToast({ type: 'success', title: 'Module access updated' });
      load();
    } catch (err) {
      pushToast({ type: 'error', title: err?.response?.data?.detail || 'Failed to update modules' });
    } finally { setSavingModules(false); }
  };

  if (!orgRole) {
    return (
      <div className="k-screen">
        <PageHeader title="Organisation" sanskrit="संगठन" />
        <p style={{ padding: 24, color: 'var(--ink-3)' }}>You do not have permission to manage this organisation.</p>
      </div>
    );
  }

  const labelSt = { fontSize: 10, fontWeight: 700, color: 'var(--ink-faint)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 3 };
  // GSTIN, PAN and IFSC are fixed-format codes. Uppercase monospace signals
  // that and makes a mistyped character findable by eye.
  const codeSt = { fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '.02em' };
  const errSt = { display: 'block', fontSize: 11, color: 'var(--danger)', marginTop: 3, textTransform: 'none', letterSpacing: 0, fontWeight: 400 };

  return (
    <div className="k-screen">
      <PageHeader title="Organisation" sanskrit="संगठन" />

      <div style={{ padding: '0 24px', maxWidth: 720 }}>
        {orgRole.org_name && (
          <div style={{ marginBottom: 20, padding: '14px 18px', background: 'var(--bg-soft)', borderRadius: 'var(--r-md)', border: '1px solid var(--rule-soft)' }}>
            <div style={labelSt}>ORGANISATION</div>
            <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--ink)' }}>{orgRole.org_name}</div>
          </div>
        )}

        {/* Company Profile — powers the invoice PDF letterhead */}
        <div style={{ marginBottom: 24, padding: 18, background: 'var(--bg-soft)', borderRadius: 'var(--r-md)', border: '1px solid var(--rule-soft)' }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)', marginBottom: 4 }}>Company Profile</div>
          <div style={{ fontSize: 11, color: 'var(--ink-3)', marginBottom: 14 }}>
            Shown on the letterhead of every invoice PDF (Ganit).
          </div>

          {profileLoading ? <div style={{ color: 'var(--ink-3)', fontSize: 12 }}>Loading…</div> : profileError ? (
            <div style={{ fontSize: 12, color: 'var(--danger)' }}>
              Couldn’t load the company profile. The form is hidden rather than shown
              blank, because saving a blank form would overwrite what’s stored. Reload
              to try again.
            </div>
          ) : (
            <>
              <div style={{ display: 'flex', gap: 14, alignItems: 'center', marginBottom: 14 }}>
                {profile.logo_url
                  ? <img src={profile.logo_url} alt="Logo" style={{ width: 56, height: 56, objectFit: 'contain', borderRadius: 8, border: '1px solid var(--rule-soft)', background: '#fff' }} />
                  : <div style={{ width: 56, height: 56, borderRadius: 8, border: '1px dashed var(--rule-soft)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: 'var(--ink-3)' }}>No logo</div>}
                <label className="k-btn k-btn--ghost k-btn--sm" style={{ fontSize: 11, cursor: 'pointer' }}>
                  {uploadingLogo ? 'Uploading…' : 'Upload logo'}
                  <input type="file" accept="image/*" style={{ display: 'none' }}
                    onChange={e => uploadLogo(e.target.files?.[0])} disabled={uploadingLogo} />
                </label>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 10 }}>
                <label style={{ fontSize: 12 }}><span style={labelSt}>Legal Name</span>
                  <input className="k-input" value={profile.name} onChange={e => setProfile({ ...profile, name: e.target.value })} /></label>
                {/* Validated on BLUR, not per keystroke — a GSTIN is invalid for
                    the first 14 characters you type, and flagging it the whole
                    way trains people to ignore the warning. */}
                <label style={{ fontSize: 12 }}><span style={labelSt}>GSTIN</span>
                  <input className="k-input" style={codeSt} value={profile.gstin || ''}
                    aria-invalid={!!codeErrors.gstin}
                    aria-describedby={codeErrors.gstin ? 'err-gstin' : undefined}
                    onBlur={checkCode('gstin', validateGSTIN)}
                    onChange={e => setProfile({ ...profile, gstin: e.target.value })} />
                  {codeErrors.gstin && <span id="err-gstin" style={errSt}>{codeErrors.gstin}</span>}</label>
                <label style={{ fontSize: 12 }}><span style={labelSt}>PAN</span>
                  <input className="k-input" style={codeSt} value={profile.pan || ''}
                    aria-invalid={!!codeErrors.pan}
                    aria-describedby={codeErrors.pan ? 'err-pan' : undefined}
                    onBlur={checkCode('pan', validatePAN)}
                    onChange={e => setProfile({ ...profile, pan: e.target.value })} />
                  {codeErrors.pan && <span id="err-pan" style={errSt}>{codeErrors.pan}</span>}</label>
                <label style={{ fontSize: 12 }}><span style={labelSt}>Email</span>
                  <input className="k-input" value={profile.email} onChange={e => setProfile({ ...profile, email: e.target.value })} /></label>
                <label style={{ fontSize: 12 }}><span style={labelSt}>Phone</span>
                  <input className="k-input" value={profile.phone} onChange={e => setProfile({ ...profile, phone: e.target.value })} /></label>
                <label style={{ fontSize: 12 }}><span style={labelSt}>Website</span>
                  <input className="k-input" value={profile.website} onChange={e => setProfile({ ...profile, website: e.target.value })} /></label>
              </div>

              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-2)', margin: '10px 0 6px' }}>Address</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
                <input className="k-input" placeholder="Address line 1" value={profile.billing_address.line1}
                  onChange={e => setProfile({ ...profile, billing_address: { ...profile.billing_address, line1: e.target.value } })} />
                <input className="k-input" placeholder="Address line 2" value={profile.billing_address.line2}
                  onChange={e => setProfile({ ...profile, billing_address: { ...profile.billing_address, line2: e.target.value } })} />
                <input className="k-input" placeholder="City" value={profile.billing_address.city}
                  onChange={e => setProfile({ ...profile, billing_address: { ...profile.billing_address, city: e.target.value } })} />
                <input className="k-input" placeholder="State" value={profile.billing_address.state}
                  onChange={e => setProfile({ ...profile, billing_address: { ...profile.billing_address, state: e.target.value } })} />
                <input className="k-input" placeholder="Pincode" value={profile.billing_address.pincode}
                  onChange={e => setProfile({ ...profile, billing_address: { ...profile.billing_address, pincode: e.target.value } })} />
                <input className="k-input" placeholder="Country" value={profile.billing_address.country}
                  onChange={e => setProfile({ ...profile, billing_address: { ...profile.billing_address, country: e.target.value } })} />
              </div>

              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-2)', margin: '10px 0 6px' }}>Bank Details (shown on invoice for payment)</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
                <input className="k-input" placeholder="Account name" value={profile.bank_details.account_name}
                  onChange={e => setProfile({ ...profile, bank_details: { ...profile.bank_details, account_name: e.target.value } })} />
                <input className="k-input" placeholder="Account number" value={profile.bank_details.account_number}
                  onChange={e => setProfile({ ...profile, bank_details: { ...profile.bank_details, account_number: e.target.value } })} />
                <div>
                  <input className="k-input" style={{ ...codeSt, width: '100%' }} placeholder="IFSC"
                    value={profile.bank_details.ifsc}
                    aria-invalid={!!codeErrors.ifsc}
                    aria-describedby={codeErrors.ifsc ? 'err-ifsc' : undefined}
                    aria-label="IFSC"
                    onBlur={checkCode('ifsc', validateIFSC)}
                    onChange={e => setProfile({ ...profile, bank_details: { ...profile.bank_details, ifsc: e.target.value } })} />
                  {codeErrors.ifsc && <span id="err-ifsc" style={errSt}>{codeErrors.ifsc}</span>}
                </div>
                <input className="k-input" placeholder="Bank name" value={profile.bank_details.bank_name}
                  onChange={e => setProfile({ ...profile, bank_details: { ...profile.bank_details, bank_name: e.target.value } })} />
                <input className="k-input" placeholder="Branch" value={profile.bank_details.branch}
                  onChange={e => setProfile({ ...profile, bank_details: { ...profile.bank_details, branch: e.target.value } })} />
                <input className="k-input" placeholder="UPI ID" value={profile.bank_details.upi_id}
                  onChange={e => setProfile({ ...profile, bank_details: { ...profile.bank_details, upi_id: e.target.value } })} />
              </div>

              <label style={{ fontSize: 12, display: 'block', marginBottom: 12 }}><span style={labelSt}>Invoice footer note</span>
                <input className="k-input" placeholder="e.g. Thank you for your business."
                  value={profile.invoice_note} onChange={e => setProfile({ ...profile, invoice_note: e.target.value })} /></label>

              <button className="k-btn k-btn--primary k-btn--sm" onClick={saveProfile} disabled={savingProfile}>
                {savingProfile ? 'Saving…' : 'Save Company Profile'}
              </button>
            </>
          )}
        </div>

        {/* Members */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)', marginBottom: 12 }}>
            Members ({members.length})
          </div>

          {loading && <div style={{ color: 'var(--ink-3)', fontSize: 12 }}>Loading…</div>}

          {members.map(m => {
            const isOwner = m.role_code === 'org_owner';
            const isAdmin = m.role_code === 'org_admin' || isOwner;
            const isSelf = m.user_id === user?.user_id;
            const isEditing = editingModules === m.user_id;

            return (
              <div key={m.user_id} style={{ padding: '10px 0', borderBottom: '1px dashed var(--rule-soft)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  {m.avatar_url
                    ? <img src={m.avatar_url} alt="" style={{ width: 28, height: 28, borderRadius: '50%', objectFit: 'cover' }} />
                    : <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'var(--bg-raised)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: 'var(--ink-3)' }}>
                        {(m.full_name || m.email || '?')[0].toUpperCase()}
                      </div>
                  }
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>{m.full_name || m.email}</div>
                    {m.full_name && <div style={{ fontSize: 11, color: 'var(--ink-3)' }}>{m.email}{m.mobile_number ? ` · ${m.mobile_number}` : ''}</div>}
                  </div>

                  {isOwner ? (
                    <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em',
                      padding: '2px 8px', borderRadius: 99, background: 'color-mix(in srgb, var(--primary) 12%, transparent)', color: 'var(--primary)' }}>
                      Owner
                    </span>
                  ) : !isSelf ? (
                    <select className="k-select" style={{ width: 120, fontSize: 11 }}
                      value={m.role_code} onChange={e => changeRole(m.user_id, e.target.value)}>
                      {ROLE_OPTIONS.map(r => <option key={r.code} value={r.code}>{r.label}</option>)}
                    </select>
                  ) : (
                    <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em',
                      padding: '2px 8px', borderRadius: 99, background: 'color-mix(in srgb, var(--primary) 12%, transparent)', color: 'var(--primary)' }}>
                      {roleLabel(m.role_code)}
                    </span>
                  )}

                  {!isAdmin && !isSelf && (
                    <button className="k-btn k-btn--ghost k-btn--sm" style={{ fontSize: 10, padding: '2px 8px' }}
                      onClick={() => setEditingModules(isEditing ? null : m.user_id)}>
                      {isEditing ? 'Close' : 'Modules'}
                    </button>
                  )}

                  {!isOwner && !isSelf && (
                    <button className="k-iconbtn" style={{ color: 'var(--danger)' }}
                      onClick={() => removeMember(m.user_id, m.email)} title="Remove">
                      <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
                        <path d="M3 4h10M5 4V3h6v1M6 7v5M10 7v5M4 4l1 9h6l1-9"/>
                      </svg>
                    </button>
                  )}
                </div>

                {isAdmin && (
                  <div style={{ fontSize: 10, color: 'var(--ink-faint)', marginTop: 4, fontStyle: 'italic' }}>
                    Admin/Owner — access to all enabled modules
                  </div>
                )}

                {isEditing && !isAdmin && (
                  <div style={{ marginTop: 8, padding: 10, background: 'var(--bg-soft)', borderRadius: 'var(--r-md)', border: '1px solid var(--rule-soft)' }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-2)', marginBottom: 6 }}>MODULE ACCESS</div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
                      {ALL_MODULES.map(mod => {
                        const granted = m.modules?.includes(mod.code);
                        return (
                          <label key={mod.code} style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: savingModules ? 'wait' : 'pointer',
                            padding: '4px 8px', borderRadius: 6, fontSize: 11, userSelect: 'none',
                            border: `1px solid ${granted ? `color-mix(in srgb, ${modTone(mod)} 40%, transparent)` : 'var(--rule-soft)'}`,
                            background: granted ? `color-mix(in srgb, ${modTone(mod)} 8%, transparent)` : 'transparent' }}>
                            <input type="checkbox" checked={granted} disabled={savingModules}
                              onChange={() => {
                                const next = granted ? m.modules.filter(c => c !== mod.code) : [...(m.modules || []), mod.code];
                                saveModules(m.user_id, next);
                              }}
                              style={{ accentColor: modTone(mod) }} />
                            <span style={{ fontWeight: 600, color: granted ? 'var(--ink)' : 'var(--ink-3)' }}>{mod.label}</span>
                            {mod.sensitive && <span style={{ fontSize: 9, color: 'var(--danger)', fontWeight: 700 }}>SENSITIVE</span>}
                          </label>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Add Member */}
        <div style={{ marginBottom: 24 }}>
          <div style={labelSt}>ADD MEMBER</div>
          <div style={{ fontSize: 11, color: 'var(--ink-3)', marginBottom: 8 }}>
            The user must have an existing Kartavya account. Enter their email to add them.
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'end', flexWrap: 'wrap' }}>
            <input className="k-input" type="email" placeholder="user@company.com" value={addEmail}
              onChange={e => setAddEmail(e.target.value)} onKeyDown={e => e.key === 'Enter' && addMember()}
              style={{ flex: 2, minWidth: 180 }} />
            <input className="k-input" type="tel" placeholder="Mobile (optional)" value={addMobile}
              onChange={e => setAddMobile(e.target.value)}
              style={{ flex: 1, minWidth: 130 }} />
            <select className="k-select" style={{ width: 140 }} value={addRole}
              onChange={e => setAddRole(e.target.value)}>
              {ROLE_OPTIONS.map(r => <option key={r.code} value={r.code}>{r.label}</option>)}
            </select>
            <button className="k-btn k-btn--primary k-btn--sm" onClick={addMember} disabled={adding}
              style={{ height: 36, whiteSpace: 'nowrap' }}>
              {adding ? 'Adding…' : 'Add'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
