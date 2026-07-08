/**
 * AdminOrgsPage.jsx — Platform admin: create orgs, manage members, R2 credentials.
 * k-* design system.
 */
import React, { useState, useEffect } from 'react';
import { api } from '../lib/api';
import { useToast } from '../components/ui/toast';
import { PageHeader } from '../components/editorial';

const PLAN_OPTIONS = [
  { code: 'free', label: 'Free — Core PM only' },
  { code: 'starter', label: 'Starter — ₹10k/mo' },
  { code: 'growth', label: 'Growth — ₹15k/mo' },
  { code: 'scale', label: 'Scale — ₹20k/mo' },
];

const ORG_ROLE_OPTIONS = [
  { code: 'org_admin', label: 'Org Admin' },
  { code: 'org_member', label: 'Org Member' },
  { code: 'srijan_admin', label: 'Srijan Admin' },
];

const PLATFORM_ROLE_OPTIONS = [
  { code: 'platform_admin', label: 'Platform Admin' },
  { code: 'account_manager', label: 'Account Manager' },
  { code: 'account_finance', label: 'Account / Finance' },
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
  const [form, setForm] = useState({ name: '', owner_email: '', plan_code: 'starter' });
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
      setForm({ name: '', owner_email: '', plan_code: 'starter' });
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

      <div style={{ display: 'grid', gap: 12, gridTemplateColumns: '1fr 1fr 1fr', marginBottom: 12 }}>
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
          <select className="k-select" style={{ width: '100%' }} value={form.plan_code} onChange={e => setForm(f => ({ ...f, plan_code: e.target.value }))}>
            {PLAN_OPTIONS.map(p => <option key={p.code} value={p.code}>{p.label}</option>)}
          </select>
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

function OrgDetail({ orgId, onClose, pushToast }) {
  const [data, setData] = useState(null);
  const [addEmail, setAddEmail] = useState('');
  const [addRoles, setAddRoles] = useState(['org_member']);
  const [adding, setAdding] = useState(false);

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
      await api.post(`/v1/admin/orgs/${orgId}/members`, { email: addEmail.trim(), roles: addRoles });
      pushToast({ type: 'success', title: `Added ${addEmail}` });
      setAddEmail('');
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

  if (!data) return null;
  const { org, members, modules } = data;

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

          {members.map(m => (
            <div key={`${m.user_id}-${m.role_code}`} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px dashed var(--rule-soft)' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>{m.full_name || m.email}</div>
                {m.full_name && <div style={{ fontSize: 11, color: 'var(--ink-3)' }}>{m.email}</div>}
              </div>
              <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em',
                padding: '2px 8px', borderRadius: 99, background: 'rgba(0,130,198,.1)', color: 'var(--k-primary)' }}>
                {m.role_code.replace('_', ' ')}
              </span>
              <button className="k-iconbtn" style={{ color: 'var(--danger)' }}
                onClick={() => removeMember(m.user_id, m.email)} title="Remove">
                <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M3 4h10M5 4V3h6v1M6 7v5M10 7v5M4 4l1 9h6l1-9"/></svg>
              </button>
            </div>
          ))}

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
        </div>

        {/* Active Modules */}
        {modules.length > 0 && (
          <div style={{ padding: '0 24px 20px' }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)', marginBottom: 8 }}>Active Modules</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {modules.filter(m => m.is_active).map(m => (
                <span key={m.module_code} style={{ fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 99,
                  background: 'rgba(5,183,170,.1)', color: '#05b7aa' }}>
                  {m.module_code}
                </span>
              ))}
            </div>
          </div>
        )}
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
              <div style={{ fontSize: 11, color: 'var(--ink-2)' }}>{formatBytes(org.storage_used_bytes)}</div>
              <div style={{ fontSize: 10, color: 'var(--ink-faint)' }}>
                {org.storage_limit_bytes > 0 ? `of ${formatBytes(org.storage_limit_bytes)}` : 'no limit'}
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
