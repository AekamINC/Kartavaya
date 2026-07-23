/**
 * AdminOrgsPage.jsx — Platform admin: create orgs, manage members, R2 credentials.
 * k-* design system.
 */
import React, { useState, useEffect } from 'react';
import { api } from '../lib/api';
import { useToast } from '../components/ui/toast';
import { PageHeader } from '../components/editorial';

const PLAN_OPTIONS = [
  { code: 'free', label: 'Free', credits: 200 },
  { code: 'starter', label: 'Starter', credits: 500 },
  { code: 'growth', label: 'Growth', credits: 1000 },
  { code: 'scale', label: 'Scale', credits: 2000 },
];

const ORG_ROLE_OPTIONS = [
  { code: 'org_admin', label: 'Org Admin' },
  { code: 'org_member', label: 'Org Member' },
];

const PLATFORM_ROLE_OPTIONS = [
  { code: 'platform_admin', label: 'Platform Admin' },
  { code: 'account_manager', label: 'Account Manager' },
  { code: 'account_finance', label: 'Account / Finance' },
  { code: 'developer', label: 'Developer' },
  { code: 'srijan_admin', label: 'Srijan Admin' },
];

function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const gb = bytes / (1024 ** 3);
  if (gb >= 1) return `${gb.toFixed(2)} GB`;
  const mb = bytes / (1024 ** 2);
  if (mb >= 1) return `${mb.toFixed(1)} MB`;
  return `${(bytes / 1024).toFixed(0)} KB`;
}

// ── Create Org Form ─────────────────────────────────────────

function CreateOrgForm({ onCreated, pushToast }) {
  const [form, setForm] = useState({ name: '', owner_email: '', plan_code: 'starter', markup_pct: 0.30, monthly_credits: 500, monthly_price: 10000 });
  const [r2, setR2] = useState({ account_id: '', access_key_id: '', secret_access_key: '', bucket_name: 'kartavya-storage' });
  const [showR2, setShowR2] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [r2Valid, setR2Valid] = useState(null);
  const [creating, setCreating] = useState(false);

  const verifyR2 = async () => {
    if (!r2.account_id || !r2.access_key_id || !r2.secret_access_key) {
      pushToast({ type: 'error', title: 'Fill all R2 fields first' });
      return;
    }
    setVerifying(true);
    try {
      const res = await api.post('/v1/admin/orgs/r2/verify', r2);
      setR2Valid(res.data.valid);
      if (res.data.valid) {
        pushToast({ type: 'success', title: 'R2 credentials verified', message: `${res.data.buckets.length} bucket(s) found` });
      } else {
        pushToast({ type: 'error', title: 'R2 credentials invalid', message: res.data.error });
      }
    } catch (err) {
      pushToast({ type: 'error', title: err?.response?.data?.detail || 'Verification failed' });
      setR2Valid(false);
    } finally { setVerifying(false); }
  };

  const submit = async () => {
    if (!form.name.trim() || !form.owner_email.trim()) {
      pushToast({ type: 'error', title: 'Name and owner email required' });
      return;
    }
    setCreating(true);
    try {
      const payload = { ...form };
      if (showR2 && r2.account_id) payload.r2 = r2;
      const res = await api.post('/v1/admin/orgs', payload);
      pushToast({ type: 'success', title: `Org "${res.data.name}" created`, message: `Plan: ${res.data.plan}` });
      setForm({ name: '', owner_email: '', plan_code: 'starter', markup_pct: 0.30, monthly_credits: 500, monthly_price: 10000 });
      setR2({ account_id: '', access_key_id: '', secret_access_key: '', bucket_name: 'kartavya-storage' });
      setShowR2(false);
      setR2Valid(null);
      onCreated();
    } catch (err) {
      pushToast({ type: 'error', title: err?.response?.data?.detail || 'Could not create org' });
    } finally { setCreating(false); }
  };

  const labelSt = { fontSize: 11, fontWeight: 700, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 5, display: 'block' };

  return (
    <div className="k-card" style={{ marginBottom: 'var(--sp-5)' }}>
      <div className="k-card__head">
        <span className="k-card__title">Create Organisation</span>
        <span className="k-card__sans">संगठन बनाएं</span>
      </div>

      <div style={{ display: 'grid', gap: 12, gridTemplateColumns: '1fr 1fr 1fr auto', marginBottom: 12 }}>
        <div>
          <label style={labelSt}>Organisation Name</label>
          <input className="k-input" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Acme Corp" />
        </div>
        <div>
          <label style={labelSt}>Owner Email</label>
          <input className="k-input" type="email" value={form.owner_email} onChange={e => setForm(f => ({ ...f, owner_email: e.target.value }))} placeholder="ceo@acme.com" />
        </div>
        <div>
          <label style={labelSt}>Plan</label>
          <select className="k-select" style={{ width: '100%' }} value={form.plan_code} onChange={e => {
            const plan = PLAN_OPTIONS.find(p => p.code === e.target.value);
            setForm(f => ({ ...f, plan_code: e.target.value, monthly_credits: plan?.credits || f.monthly_credits }));
          }}>
            {PLAN_OPTIONS.map(p => <option key={p.code} value={p.code}>{p.label} ({p.credits} credits)</option>)}
          </select>
        </div>
        <div style={{ minWidth: 90 }}>
          <label style={labelSt}>Markup %</label>
          <input className="k-input" type="number" min="0" max="100" step="1"
            value={Math.round(form.markup_pct * 100)}
            onChange={e => setForm(f => ({ ...f, markup_pct: Number(e.target.value) / 100 }))}
            style={{ width: '100%' }} />
        </div>
      </div>
      <div style={{ display: 'grid', gap: 12, gridTemplateColumns: '1fr 1fr', marginBottom: 12 }}>
        <div>
          <label style={labelSt}>Monthly Credits</label>
          <input className="k-input" type="number" min="0" step="50"
            value={form.monthly_credits}
            onChange={e => setForm(f => ({ ...f, monthly_credits: Number(e.target.value) }))}
            style={{ width: '100%' }} />
        </div>
        <div>
          <label style={labelSt}>Monthly Price (₹)</label>
          <input className="k-input" type="number" min="0" step="500"
            value={form.monthly_price}
            onChange={e => setForm(f => ({ ...f, monthly_price: Number(e.target.value) }))}
            style={{ width: '100%' }} />
        </div>
      </div>

      {/* R2 toggle */}
      <div style={{ marginBottom: 12 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', userSelect: 'none' }}>
          <input type="checkbox" checked={showR2} onChange={e => setShowR2(e.target.checked)} />
          <span style={{ fontSize: 13, color: 'var(--ink-2)' }}>Configure Cloudflare R2 storage (per-org account)</span>
        </label>
      </div>

      {showR2 && (
        <div style={{ padding: 16, background: 'var(--bg-soft)', borderRadius: 'var(--r-md)', border: '1px solid var(--rule-soft)', marginBottom: 12 }}>
          <div style={{ display: 'grid', gap: 10, gridTemplateColumns: '1fr 1fr', marginBottom: 10 }}>
            <div>
              <label style={labelSt}>Cloudflare Account ID</label>
              <input className="k-input" value={r2.account_id} onChange={e => setR2(f => ({ ...f, account_id: e.target.value }))} placeholder="abc123def456" />
            </div>
            <div>
              <label style={labelSt}>Bucket Name</label>
              <input className="k-input" value={r2.bucket_name} onChange={e => setR2(f => ({ ...f, bucket_name: e.target.value }))} />
            </div>
          </div>
          <div style={{ display: 'grid', gap: 10, gridTemplateColumns: '1fr 1fr', marginBottom: 10 }}>
            <div>
              <label style={labelSt}>R2 Access Key ID</label>
              <input className="k-input" value={r2.access_key_id} onChange={e => setR2(f => ({ ...f, access_key_id: e.target.value }))} placeholder="Access key" />
            </div>
            <div>
              <label style={labelSt}>R2 Secret Access Key</label>
              <input className="k-input" type="password" value={r2.secret_access_key} onChange={e => setR2(f => ({ ...f, secret_access_key: e.target.value }))} placeholder="Secret key" />
            </div>
          </div>
          <button className="k-btn k-btn--ghost k-btn--sm" onClick={verifyR2} disabled={verifying}>
            {verifying ? 'Verifying…' : r2Valid === true ? '✓ Verified' : 'Verify Credentials'}
          </button>
          {r2Valid === false && <span style={{ fontSize: 12, color: 'var(--danger)', marginLeft: 10 }}>Invalid credentials</span>}
        </div>
      )}

      <button className="k-btn k-btn--primary" onClick={submit} disabled={creating}>
        {creating ? 'Creating…' : 'Create Organisation'}
      </button>
    </div>
  );
}

// ── Org Detail Slide-Over ───────────────────────────────────

const ALL_MODULES = [
  { code: 'graha', label: 'Graha · CRM', sensitive: false },
  { code: 'ganit', label: 'Ganit · Invoicing', sensitive: true },
  { code: 'manav', label: 'Manav · HRMS', sensitive: true },
  { code: 'vikray', label: 'Vikray · Sales', sensitive: false },
  { code: 'vetana', label: 'Vetana · Payroll', sensitive: true },
  { code: 'dristi', label: 'Dristi · Analytics', sensitive: false },
  { code: 'prachar', label: 'Prachar · Marketing', sensitive: false },
  { code: 'srijan', label: 'Srijan · AI Hub', sensitive: false },
];

function OrgBillingSettings({ org, orgId, pushToast, onSaved }) {
  const [markup, setMarkup] = useState(Math.round((org.markup_pct || 0.3) * 100));
  const [credits, setCredits] = useState(org.monthly_credits || 0);
  const [price, setPrice] = useState(org.monthly_price || 0);
  const [saving, setSaving] = useState(false);

  const changed = markup !== Math.round((org.markup_pct || 0.3) * 100)
    || credits !== (org.monthly_credits || 0)
    || price !== (org.monthly_price || 0);

  const save = async () => {
    setSaving(true);
    try {
      await api.patch(`/v1/admin/orgs/${orgId}/settings`, {
        markup_pct: markup / 100,
        monthly_credits: credits,
        monthly_price: price,
      });
      pushToast({ type: 'success', title: 'Billing settings saved' });
      onSaved();
    } catch (err) {
      pushToast({ type: 'error', title: err?.response?.data?.detail || 'Save failed' });
    } finally { setSaving(false); }
  };

  const labelSt = { fontSize: 10, fontWeight: 700, color: 'var(--ink-faint)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 3 };

  return (
    <div style={{ padding: '0 24px 16px' }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-2)', marginBottom: 8 }}>Billing & Credits</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
        <div>
          <div style={labelSt}>MARKUP %</div>
          <input className="k-input" type="number" min="0" max="100" step="1" value={markup}
            onChange={e => setMarkup(Number(e.target.value))} style={{ width: '100%' }} />
        </div>
        <div>
          <div style={labelSt}>MONTHLY CREDITS</div>
          <input className="k-input" type="number" min="0" step="50" value={credits}
            onChange={e => setCredits(Number(e.target.value))} style={{ width: '100%' }} />
        </div>
        <div>
          <div style={labelSt}>MONTHLY PRICE ₹</div>
          <input className="k-input" type="number" min="0" step="500" value={price}
            onChange={e => setPrice(Number(e.target.value))} style={{ width: '100%' }} />
        </div>
      </div>
      {changed && (
        <button className="k-btn k-btn--sm k-btn--primary" style={{ marginTop: 8 }} disabled={saving} onClick={save}>
          {saving ? 'Saving…' : 'Save Billing Settings'}
        </button>
      )}
    </div>
  );
}

function OrgDetail({ orgId, onClose, pushToast }) {
  const [data, setData] = useState(null);
  const [addEmail, setAddEmail] = useState('');
  const [addRoles, setAddRoles] = useState(['org_member']);
  const [addModules, setAddModules] = useState([]);
  const [adding, setAdding] = useState(false);
  const [togglingModule, setTogglingModule] = useState(null);
  const [editingMemberModules, setEditingMemberModules] = useState(null); // user_id
  const [savingMemberModules, setSavingMemberModules] = useState(false);

  // R2 config
  const [r2Form, setR2Form] = useState({ account_id: '', access_key_id: '', secret_access_key: '', bucket_name: 'kartavya-storage' });
  const [showR2, setShowR2] = useState(false);
  const [savingR2, setSavingR2] = useState(false);

  const load = () => api.get(`/v1/admin/orgs/${orgId}`).then(r => setData(r.data)).catch(() => {});
  useEffect(() => { load(); }, [orgId]);

  const addMember = async () => {
    if (!addEmail.trim()) return;
    setAdding(true);
    try {
      await api.post(`/v1/admin/orgs/${orgId}/members`, { email: addEmail.trim(), roles: addRoles, module_grants: addModules });
      pushToast({ type: 'success', title: `Added ${addEmail}` });
      setAddEmail('');
      setAddModules([]);
      load();
    } catch (err) {
      pushToast({ type: 'error', title: err?.response?.data?.detail || 'Could not add member' });
    } finally { setAdding(false); }
  };

  const removeMember = async (userId, email) => {
    try {
      await api.delete(`/v1/admin/orgs/${orgId}/members/${userId}`);
      pushToast({ type: 'success', title: `Removed ${email}` });
      load();
    } catch (err) {
      pushToast({ type: 'error', title: err?.response?.data?.detail || 'Could not remove' });
    }
  };

  const toggleModule = async (code, currentlyActive) => {
    setTogglingModule(code);
    try {
      if (currentlyActive) {
        await api.delete(`/v1/admin/orgs/${orgId}/modules/${code}`);
        pushToast({ type: 'success', title: `${code} disabled` });
      } else {
        await api.post(`/v1/admin/orgs/${orgId}/modules/${code}`);
        pushToast({ type: 'success', title: `${code} enabled` });
      }
      load();
    } catch (err) {
      pushToast({ type: 'error', title: err?.response?.data?.detail || 'Module toggle failed' });
    } finally { setTogglingModule(null); }
  };

  const saveR2 = async () => {
    setSavingR2(true);
    try {
      const res = await api.put(`/v1/admin/orgs/${orgId}/r2`, r2Form);
      pushToast({ type: 'success', title: 'R2 configured', message: `Bucket: ${res.data.bucket}` });
      setShowR2(false);
      load();
    } catch (err) {
      pushToast({ type: 'error', title: err?.response?.data?.detail || 'R2 configuration failed' });
    } finally { setSavingR2(false); }
  };

  const saveMemberModules = async (targetUserId, moduleCodes) => {
    setSavingMemberModules(true);
    try {
      await api.put(`/v1/admin/orgs/${orgId}/members/${targetUserId}/modules`, { user_id: targetUserId, modules: moduleCodes });
      pushToast({ type: 'success', title: 'Module access updated' });
      load();
    } catch (err) {
      pushToast({ type: 'error', title: err?.response?.data?.detail || 'Could not update modules' });
    } finally { setSavingMemberModules(false); }
  };

  if (!data) return null;
  const { org, members, modules, member_modules = [] } = data;

  const getMemberModules = (userId) => member_modules.filter(mm => mm.user_id === userId).map(mm => mm.module_code);
  const isAdminRole = (userId) => members.some(m => m.user_id === userId && (m.role_code === 'org_admin' || m.role_code === 'org_owner'));
  const enabledModuleCodes = modules.filter(m => m.is_active).map(m => m.module_code);

  const labelSt = { fontSize: 10, fontWeight: 700, color: 'var(--ink-faint)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 3 };

  return (
    <div onClick={e => e.target === e.currentTarget && onClose()}
      style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(5,14,26,.45)', display: 'flex', justifyContent: 'flex-end' }}>
      <div style={{ width: 520, maxWidth: '95vw', height: '100%', background: 'var(--surface)', display: 'flex', flexDirection: 'column', boxShadow: '-8px 0 40px rgba(0,0,0,.18)', overflowY: 'auto' }}>

        {/* Header */}
        <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--rule-soft)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 600, color: 'var(--ink)' }}>{org.name}</div>
            <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>
              {org.plan_name || 'No plan'} · {org.owner_email || 'No owner'}
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-3)', fontSize: 20, padding: 4 }}>✕</button>
        </div>

        {/* Org Info */}
        <div style={{ padding: '16px 24px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div>
            <div style={labelSt}>ORG ID</div>
            <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--ink-2)', wordBreak: 'break-all' }}>{org.id}</div>
          </div>
          <div>
            <div style={labelSt}>TEAM ID</div>
            <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--ink-2)' }}>{org.team_id}</div>
          </div>
          <div>
            <div style={labelSt}>STORAGE</div>
            <div style={{ fontSize: 12, color: 'var(--ink-2)' }}>
              {formatBytes(org.storage_used_bytes)} / {org.storage_limit_bytes > 0 ? formatBytes(org.storage_limit_bytes) : '∞'}
            </div>
          </div>
          <div>
            <div style={labelSt}>R2 BUCKET</div>
            <div style={{ fontSize: 12, color: org.r2_account_id ? 'var(--k-primary)' : 'var(--ink-faint)' }}>
              {org.r2_bucket_name || (org.r2_account_id ? 'Configured' : 'Not configured')}
            </div>
          </div>
        </div>

        {/* Billing Settings */}
        <OrgBillingSettings org={org} orgId={orgId} pushToast={pushToast} onSaved={load} />

        {/* R2 Config */}
        {!org.r2_account_id && (
          <div style={{ padding: '0 24px 16px' }}>
            {!showR2 ? (
              <button className="k-btn k-btn--ghost k-btn--sm" onClick={() => setShowR2(true)}>
                Configure R2 Storage
              </button>
            ) : (
              <div style={{ padding: 14, background: 'var(--bg-soft)', borderRadius: 'var(--r-md)', border: '1px solid var(--rule-soft)' }}>
                <div style={{ display: 'grid', gap: 8, gridTemplateColumns: '1fr 1fr', marginBottom: 8 }}>
                  <input className="k-input" placeholder="Account ID" value={r2Form.account_id} onChange={e => setR2Form(f => ({ ...f, account_id: e.target.value }))} />
                  <input className="k-input" placeholder="Bucket name" value={r2Form.bucket_name} onChange={e => setR2Form(f => ({ ...f, bucket_name: e.target.value }))} />
                </div>
                <div style={{ display: 'grid', gap: 8, gridTemplateColumns: '1fr 1fr', marginBottom: 10 }}>
                  <input className="k-input" placeholder="Access Key ID" value={r2Form.access_key_id} onChange={e => setR2Form(f => ({ ...f, access_key_id: e.target.value }))} />
                  <input className="k-input" type="password" placeholder="Secret Key" value={r2Form.secret_access_key} onChange={e => setR2Form(f => ({ ...f, secret_access_key: e.target.value }))} />
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="k-btn k-btn--primary k-btn--sm" onClick={saveR2} disabled={savingR2}>
                    {savingR2 ? 'Saving…' : 'Verify & Save'}
                  </button>
                  <button className="k-btn k-btn--ghost k-btn--sm" onClick={() => setShowR2(false)}>Cancel</button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Members */}
        <div style={{ padding: '0 24px 16px' }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)', marginBottom: 10 }}>Members ({members.length})</div>

          {/* Dedupe members by user_id, show all roles */}
          {Object.values(members.reduce((acc, m) => {
            if (!acc[m.user_id]) acc[m.user_id] = { ...m, roles: [] };
            acc[m.user_id].roles.push(m.role_code);
            return acc;
          }, {})).map(m => {
            const isAdmin = m.roles.some(r => r === 'org_admin' || r === 'org_owner');
            const userModules = getMemberModules(m.user_id);
            const isEditing = editingMemberModules === m.user_id;
            return (
              <div key={m.user_id} style={{ padding: '10px 0', borderBottom: '1px dashed var(--rule-soft)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>{m.full_name || m.email}</div>
                    {m.full_name && <div style={{ fontSize: 11, color: 'var(--ink-3)' }}>{m.email}</div>}
                  </div>
                  {m.roles.map(r => (
                    <span key={r} style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em',
                      padding: '2px 8px', borderRadius: 99, background: 'rgba(0,130,198,.1)', color: 'var(--k-primary)' }}>
                      {r.replace('_', ' ')}
                    </span>
                  ))}
                  {!isAdmin && (
                    <button className="k-btn k-btn--ghost k-btn--sm" style={{ fontSize: 10, padding: '2px 8px' }}
                      onClick={() => setEditingMemberModules(isEditing ? null : m.user_id)}>
                      {isEditing ? 'Close' : 'Modules'}
                    </button>
                  )}
                  <button className="k-iconbtn" style={{ color: 'var(--danger)' }}
                    onClick={() => removeMember(m.user_id, m.email)} title="Remove">
                    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M3 4h10M5 4V3h6v1M6 7v5M10 7v5M4 4l1 9h6l1-9"/></svg>
                  </button>
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
                      {ALL_MODULES.filter(mod => enabledModuleCodes.includes(mod.code)).map(mod => {
                        const granted = userModules.includes(mod.code);
                        return (
                          <label key={mod.code} style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: savingMemberModules ? 'wait' : 'pointer',
                            padding: '4px 8px', borderRadius: 6, fontSize: 11, userSelect: 'none',
                            border: `1px solid ${mod.sensitive ? (granted ? 'rgba(229,62,62,.3)' : 'var(--rule-soft)') : (granted ? 'rgba(5,183,170,.3)' : 'var(--rule-soft)')}`,
                            background: granted ? (mod.sensitive ? 'rgba(229,62,62,.06)' : 'rgba(5,183,170,.06)') : 'transparent' }}>
                            <input type="checkbox" checked={granted} disabled={savingMemberModules}
                              onChange={() => {
                                const next = granted ? userModules.filter(c => c !== mod.code) : [...userModules, mod.code];
                                saveMemberModules(m.user_id, next);
                              }}
                              style={{ accentColor: mod.sensitive ? '#E53E3E' : '#05b7aa' }} />
                            <span style={{ fontWeight: 600, color: granted ? 'var(--ink)' : 'var(--ink-3)' }}>{mod.label}</span>
                            {mod.sensitive && <span style={{ fontSize: 9, color: '#E53E3E', fontWeight: 700 }}>SENSITIVE</span>}
                          </label>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            );
          })}

          {/* Add member */}
          <div style={{ display: 'flex', gap: 8, marginTop: 12, alignItems: 'end' }}>
            <div style={{ flex: 1 }}>
              <label style={labelSt}>ADD MEMBER</label>
              <input className="k-input" type="email" placeholder="user@company.com" value={addEmail}
                onChange={e => setAddEmail(e.target.value)} onKeyDown={e => e.key === 'Enter' && addMember()} />
            </div>
            <select className="k-select" style={{ width: 140 }} value={addRoles[0]}
              onChange={e => setAddRoles([e.target.value])}>
              {ORG_ROLE_OPTIONS.map(r => <option key={r.code} value={r.code}>{r.label}</option>)}
            </select>
            <button className="k-btn k-btn--primary k-btn--sm" onClick={addMember} disabled={adding}
              style={{ height: 36, whiteSpace: 'nowrap' }}>
              {adding ? '…' : 'Add'}
            </button>
          </div>

          {/* Module access checkboxes for new member */}
          {addRoles[0] === 'org_member' && enabledModuleCodes.length > 0 && (
            <div style={{ marginTop: 10, padding: 10, background: 'var(--bg-soft)', borderRadius: 'var(--r-md)', border: '1px solid var(--rule-soft)' }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--ink-faint)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>
                Module Access (non-sensitive auto-granted)
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
                {ALL_MODULES.filter(mod => enabledModuleCodes.includes(mod.code)).map(mod => {
                  const checked = addModules.includes(mod.code) || (!mod.sensitive && addModules.length === 0);
                  return (
                    <label key={mod.code} style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer',
                      padding: '4px 8px', borderRadius: 6, fontSize: 11, userSelect: 'none',
                      border: `1px solid ${mod.sensitive ? (checked ? 'rgba(229,62,62,.3)' : 'var(--rule-soft)') : 'rgba(5,183,170,.3)'}`,
                      background: checked ? (mod.sensitive ? 'rgba(229,62,62,.06)' : 'rgba(5,183,170,.06)') : 'transparent' }}>
                      <input type="checkbox" checked={checked}
                        onChange={() => {
                          if (addModules.length === 0) {
                            // Initialize from defaults (non-sensitive = on)
                            const defaults = ALL_MODULES.filter(m => enabledModuleCodes.includes(m.code) && !m.sensitive).map(m => m.code);
                            if (mod.sensitive) setAddModules([...defaults, mod.code]);
                            else setAddModules(defaults.filter(c => c !== mod.code));
                          } else {
                            setAddModules(prev => prev.includes(mod.code) ? prev.filter(c => c !== mod.code) : [...prev, mod.code]);
                          }
                        }}
                        style={{ accentColor: mod.sensitive ? '#E53E3E' : '#05b7aa' }} />
                      <span style={{ fontWeight: 600, color: checked ? 'var(--ink)' : 'var(--ink-3)' }}>{mod.label}</span>
                      {mod.sensitive && <span style={{ fontSize: 9, color: '#E53E3E', fontWeight: 700 }}>SENSITIVE</span>}
                    </label>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Modules */}
        <div style={{ padding: '0 24px 20px' }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)', marginBottom: 10 }}>Modules</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
            {ALL_MODULES.map(m => {
              const active = modules.some(mod => mod.module_code === m.code && mod.is_active);
              const toggling = togglingModule === m.code;
              return (
                <div key={m.code} onClick={() => !toggling && toggleModule(m.code, active)}
                  style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 12px', borderRadius: 'var(--r-md)',
                    border: `1px solid ${active ? 'rgba(5,183,170,.3)' : 'var(--rule-soft)'}`,
                    background: active ? 'rgba(5,183,170,.06)' : 'transparent',
                    cursor: toggling ? 'wait' : 'pointer', opacity: toggling ? 0.5 : 1, transition: 'all .15s',
                    userSelect: 'none' }}>
                  <div style={{ width: 18, height: 18, borderRadius: 4,
                    border: `2px solid ${active ? '#05b7aa' : 'var(--ink-faint)'}`,
                    background: active ? '#05b7aa' : 'transparent',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    {active && <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="#fff" strokeWidth="2"><path d="M2 6l3 3 5-5"/></svg>}
                  </div>
                  <span style={{ fontSize: 12, fontWeight: 600, color: active ? 'var(--ink)' : 'var(--ink-3)' }}>{m.label}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Platform Roles ─────────────────────────────────────────

function PlatformRoles({ pushToast }) {
  const [roles, setRoles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState('');
  const [roleCode, setRoleCode] = useState('developer');
  const [assigning, setAssigning] = useState(false);

  const load = () => {
    setLoading(true);
    api.get('/v1/admin/orgs/roles/platform')
      .then(r => setRoles(r.data))
      .catch(() => pushToast({ type: 'error', title: 'Could not load platform roles' }))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const assign = async () => {
    if (!email.trim()) return;
    setAssigning(true);
    try {
      const userRes = await api.get(`/v1/admin/orgs/users/search?email=${encodeURIComponent(email.trim())}`);
      const userId = userRes.data?.user_id;
      if (!userId) { pushToast({ type: 'error', title: 'User not found' }); return; }
      await api.post('/v1/admin/orgs/roles/assign', { user_id: userId, role_code: roleCode });
      pushToast({ type: 'success', title: `${roleCode} assigned to ${email}` });
      setEmail('');
      load();
    } catch (err) {
      pushToast({ type: 'error', title: err?.response?.data?.detail || 'Could not assign role' });
    } finally { setAssigning(false); }
  };

  const revoke = async (roleId, email, code) => {
    try {
      await api.delete(`/v1/admin/orgs/roles/${roleId}`);
      pushToast({ type: 'success', title: `Revoked ${code} from ${email}` });
      load();
    } catch (err) {
      pushToast({ type: 'error', title: err?.response?.data?.detail || 'Could not revoke role' });
    }
  };

  const roleColor = (code) => {
    if (code === 'platform_admin') return '#E53E3E';
    if (code === 'account_finance') return '#D69E2E';
    if (code === 'srijan_admin') return '#805AD5';
    return 'var(--k-primary)';
  };

  const labelSt = { fontSize: 10, fontWeight: 700, color: 'var(--ink-faint)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 3 };

  return (
    <div className="k-card" style={{ marginBottom: 'var(--sp-5)' }}>
      <div className="k-card__head">
        <span className="k-card__title">Platform Roles</span>
        <span className="k-card__sans">प्लेटफ़ॉर्म भूमिकाएँ</span>
      </div>

      {loading ? (
        <div style={{ padding: 16, color: 'var(--ink-faint)', fontSize: 13 }}>Loading…</div>
      ) : (
        <>
          {/* Group by user */}
          {Object.values(roles.reduce((acc, r) => {
            if (!acc[r.user_id]) acc[r.user_id] = { ...r, codes: [] };
            acc[r.user_id].codes.push({ id: r.id, code: r.role_code });
            return acc;
          }, {})).map(u => (
            <div key={u.user_id} style={{ padding: '10px 0', borderBottom: '1px dashed var(--rule-soft)', display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>{u.full_name || u.email}</div>
                {u.full_name && <div style={{ fontSize: 11, color: 'var(--ink-3)' }}>{u.email}</div>}
              </div>
              {u.codes.map(c => (
                <span key={c.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
                  letterSpacing: '0.1em', padding: '2px 8px', borderRadius: 99,
                  background: `${roleColor(c.code)}14`, color: roleColor(c.code) }}>
                  {c.code.replace(/_/g, ' ')}
                  <button onClick={() => revoke(c.id, u.email, c.code)}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', fontSize: 12, padding: 0, lineHeight: 1 }}
                    title="Revoke">×</button>
                </span>
              ))}
            </div>
          ))}

          {roles.length === 0 && (
            <div style={{ padding: 16, color: 'var(--ink-faint)', fontSize: 13, fontStyle: 'italic' }}>No platform roles assigned yet.</div>
          )}
        </>
      )}

      {/* Assign form */}
      <div style={{ display: 'flex', gap: 8, marginTop: 12, alignItems: 'end' }}>
        <div style={{ flex: 1 }}>
          <label style={labelSt}>ASSIGN PLATFORM ROLE</label>
          <input className="k-input" type="email" placeholder="user@aekam.com" value={email}
            onChange={e => setEmail(e.target.value)} onKeyDown={e => e.key === 'Enter' && assign()} />
        </div>
        <select className="k-select" style={{ width: 160 }} value={roleCode}
          onChange={e => setRoleCode(e.target.value)}>
          {PLATFORM_ROLE_OPTIONS.map(r => <option key={r.code} value={r.code}>{r.label}</option>)}
        </select>
        <button className="k-btn k-btn--primary k-btn--sm" onClick={assign} disabled={assigning}
          style={{ height: 36, whiteSpace: 'nowrap' }}>
          {assigning ? '…' : 'Assign'}
        </button>
      </div>
    </div>
  );
}

// ── Main Page ───────────────────────────────────────────────

export default function AdminOrgsPage() {
  const { pushToast } = useToast();
  const [orgs, setOrgs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedOrg, setSelectedOrg] = useState(null);

  const loadOrgs = () => {
    setLoading(true);
    api.get('/v1/admin/orgs')
      .then(r => setOrgs(r.data.data || []))
      .catch(() => pushToast({ type: 'error', title: 'Could not load organisations' }))
      .finally(() => setLoading(false));
  };

  useEffect(() => { loadOrgs(); }, []);

  return (
    <div className="k-screen">
      <PageHeader kicker="ADMIN · ORGANISATIONS" title="Organisations" sanskrit="संगठन" lede="Create and manage client organisations, members, roles, and storage." />

      <CreateOrgForm onCreated={loadOrgs} pushToast={pushToast} />

      <PlatformRoles pushToast={pushToast} />

      {/* Org List */}
      <div className="k-card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '12px 20px', borderBottom: '1px solid var(--rule-soft)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontFamily: 'var(--font-display)', fontSize: 15, fontWeight: 600, color: 'var(--ink)' }}>All Organisations</span>
          <span style={{ fontSize: 11, color: 'var(--ink-3)', background: 'var(--bg-soft)', borderRadius: 99, padding: '2px 8px' }}>
            {orgs.length} total
          </span>
        </div>

        {loading && (
          <div style={{ padding: 20, textAlign: 'center', color: 'var(--ink-faint)', fontSize: 13 }}>Loading…</div>
        )}

        {!loading && orgs.length === 0 && (
          <div style={{ padding: 30, textAlign: 'center', color: 'var(--ink-faint)', fontSize: 13, fontStyle: 'italic' }}>
            No organisations yet. Create one above.
          </div>
        )}

        {orgs.map(org => (
          <div key={org.id} onClick={() => setSelectedOrg(org.id)}
            style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 20px', borderBottom: '1px dashed var(--rule-soft)', cursor: 'pointer', transition: 'background .15s' }}
            onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-soft)'}
            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>

            <div style={{ width: 40, height: 40, borderRadius: 8, background: org.is_active ? 'rgba(0,130,198,.1)' : 'var(--bg-soft)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-display)', fontSize: 16, fontWeight: 700,
              color: org.is_active ? 'var(--k-primary)' : 'var(--ink-faint)', flexShrink: 0 }}>
              {(org.name || '?')[0].toUpperCase()}
            </div>

            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)', display: 'flex', alignItems: 'center', gap: 8 }}>
                {org.name}
                {!org.is_active && <span style={{ fontSize: 10, color: 'var(--danger)', fontWeight: 700 }}>INACTIVE</span>}
              </div>
              <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>
                {org.owner_email || 'No owner'} · {org.plan_name || 'No plan'}
              </div>
            </div>

            <div style={{ textAlign: 'right', flexShrink: 0 }}>
              <div style={{ fontSize: 11, color: 'var(--ink-2)' }}>{org.monthly_credits || 0} credits · ₹{(org.monthly_price || 0).toLocaleString('en-IN')}/mo</div>
              <div style={{ fontSize: 10, color: 'var(--ink-faint)' }}>
                {formatBytes(org.storage_used_bytes)} {org.storage_limit_bytes > 0 ? `of ${formatBytes(org.storage_limit_bytes)}` : ''}
              </div>
            </div>

            <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em',
              padding: '3px 10px', borderRadius: 99,
              background: org.plan_code === 'free' ? 'var(--bg-soft)' : 'rgba(5,183,170,.1)',
              color: org.plan_code === 'free' ? 'var(--ink-faint)' : '#05b7aa' }}>
              {org.plan_code || 'none'}
            </span>
          </div>
        ))}
      </div>

      {/* Slide-over */}
      {selectedOrg && (
        <OrgDetail orgId={selectedOrg} onClose={() => { setSelectedOrg(null); loadOrgs(); }} pushToast={pushToast} />
      )}
    </div>
  );
}
