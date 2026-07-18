/**
 * OrgSettingsPage.jsx — Org-level member management for org admins/owners.
 * Uses /api/v1/org/members (self-service, no platform admin needed).
 */
import React, { useState, useEffect, useCallback } from 'react';
import { currentUser } from '../lib/auth';
import { api } from '../lib/api';
import { useToast } from '../components/ui/toast';
import { PageHeader } from '../components/editorial';

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

export default function OrgSettingsPage() {
  const user = currentUser();
  const { pushToast } = useToast();
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);

  const [addEmail, setAddEmail] = useState('');
  const [addRole, setAddRole] = useState('org_member');
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

  const addMember = async () => {
    if (!addEmail.trim()) return;
    setAdding(true);
    try {
      const res = await api.post('/v1/org/members', { email: addEmail.trim(), role: addRole });
      pushToast({ type: 'success', title: `${addEmail} added as ${res.data.role.replace('_', ' ')}` });
      setAddEmail('');
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
        <PageHeader title="Organisation" subtitle="संगठन" />
        <p style={{ padding: 24, color: 'var(--ink-3)' }}>You do not have permission to manage this organisation.</p>
      </div>
    );
  }

  const labelSt = { fontSize: 10, fontWeight: 700, color: 'var(--ink-faint)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 3 };

  return (
    <div className="k-screen">
      <PageHeader title="Organisation" subtitle="संगठन" />

      <div style={{ padding: '0 24px', maxWidth: 720 }}>
        {orgRole.org_name && (
          <div style={{ marginBottom: 20, padding: '14px 18px', background: 'var(--bg-soft)', borderRadius: 'var(--r-md)', border: '1px solid var(--rule-soft)' }}>
            <div style={labelSt}>ORGANISATION</div>
            <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--ink)' }}>{orgRole.org_name}</div>
          </div>
        )}

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
                    {m.full_name && <div style={{ fontSize: 11, color: 'var(--ink-3)' }}>{m.email}</div>}
                  </div>

                  {isOwner ? (
                    <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em',
                      padding: '2px 8px', borderRadius: 99, background: 'rgba(0,130,198,.1)', color: 'var(--k-primary)' }}>
                      Owner
                    </span>
                  ) : !isSelf ? (
                    <select className="k-select" style={{ width: 120, fontSize: 11 }}
                      value={m.role_code} onChange={e => changeRole(m.user_id, e.target.value)}>
                      {ROLE_OPTIONS.map(r => <option key={r.code} value={r.code}>{r.label}</option>)}
                    </select>
                  ) : (
                    <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em',
                      padding: '2px 8px', borderRadius: 99, background: 'rgba(0,130,198,.1)', color: 'var(--k-primary)' }}>
                      {m.role_code.replace('_', ' ')}
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
                            border: `1px solid ${mod.sensitive ? (granted ? 'rgba(229,62,62,.3)' : 'var(--rule-soft)') : (granted ? 'rgba(5,183,170,.3)' : 'var(--rule-soft)')}`,
                            background: granted ? (mod.sensitive ? 'rgba(229,62,62,.06)' : 'rgba(5,183,170,.06)') : 'transparent' }}>
                            <input type="checkbox" checked={granted} disabled={savingModules}
                              onChange={() => {
                                const next = granted ? m.modules.filter(c => c !== mod.code) : [...(m.modules || []), mod.code];
                                saveModules(m.user_id, next);
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
        </div>

        {/* Add Member */}
        <div style={{ marginBottom: 24 }}>
          <div style={labelSt}>ADD MEMBER</div>
          <div style={{ fontSize: 11, color: 'var(--ink-3)', marginBottom: 8 }}>
            The user must have an existing Kartavya account. Enter their email to add them.
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'end' }}>
            <input className="k-input" type="email" placeholder="user@company.com" value={addEmail}
              onChange={e => setAddEmail(e.target.value)} onKeyDown={e => e.key === 'Enter' && addMember()}
              style={{ flex: 1 }} />
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
