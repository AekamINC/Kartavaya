import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { PageHeader, PriorityDot } from '../components/editorial';
import { AVATAR_COLORS, userInitials } from '../lib/utils';
import ConfirmDialog from '../components/ui/ConfirmDialog';
import { EmptyState } from '../components/ui/EmptyState';

export default function TeamsPage() {
  const [projects,       setProjects]       = useState([]);
  const [selectedId,     setSelectedId]     = useState('');
  const [projectDetail,  setProjectDetail]  = useState(null);
  const [allUsers,       setAllUsers]       = useState([]);
  const [userSearch,     setUserSearch]     = useState('');
  const [selectedUser,   setSelectedUser]   = useState(null);
  const [inviteEmail,    setInviteEmail]    = useState('');
  const [inviteRole,     setInviteRole]     = useState('member');
  const [clientApproval, setClientApproval] = useState(true);
  const [clientCompany,  setClientCompany]  = useState('');
  const [confirmState,   setConfirmState]   = useState(null);
  const [adding,         setAdding]         = useState(false);

  const loadProjects = async () => {
    const res = await api.get('/teams');
    const list = Array.isArray(res.data) ? res.data : [];
    setProjects(list);
    if (!selectedId && list.length) setSelectedId(list[0].team_id);
  };

  const loadDetail = async (id) => {
    if (!id) return;
    const res = await api.get(`/teams/${id}`);
    setProjectDetail(res.data);
  };

  useEffect(() => {
    loadProjects().catch(() => {});
    api.get('/users').then(r => setAllUsers(Array.isArray(r.data) ? r.data : [])).catch(() => {});
  }, []); // eslint-disable-line

  useEffect(() => {
    if (!selectedId) { setProjectDetail(null); return; }
    loadDetail(selectedId).catch(() => {});
  }, [selectedId]); // eslint-disable-line

  const yourRole = projectDetail?.your_role || 'member';
  const isAdmin  = yourRole === 'owner' || yourRole === 'admin';
  const members  = useMemo(() => projectDetail?.members || [], [projectDetail]);

  const selectedProject = projects.find(p => p.team_id === selectedId);

  const filteredUsers = allUsers.filter(u => {
    const currentEmails = new Set(members.map(m => m.email));
    if (currentEmails.has(u.email)) return false;
    const q = userSearch.toLowerCase();
    return !q || u.display_name?.toLowerCase().includes(q) || u.email?.toLowerCase().includes(q);
  });

  const resetAddForm = () => {
    setSelectedUser(null); setUserSearch(''); setInviteEmail('');
    setInviteRole('member'); setClientApproval(true); setClientCompany('');
    setAdding(false);
  };

  const addMember = async () => {
    const email = selectedUser ? selectedUser.email : inviteEmail.trim().toLowerCase();
    if (!email || !selectedId) return;
    const res = await api.post(`/teams/${selectedId}/members`, {
      email,
      role: inviteRole,
      receives_approval_emails: inviteRole === 'client' ? clientApproval : undefined,
      company_name: inviteRole === 'client' ? (clientCompany.trim() || selectedUser?.company_name || '') : undefined,
    });
    setProjectDetail(prev => ({ ...prev, members: [res.data, ...(prev?.members || [])] }));
    resetAddForm();
  };

  const updateMemberRole = async (memberId, role) => {
    const res = await api.put(`/teams/${selectedId}/members/${memberId}`, { role });
    setProjectDetail(prev => ({ ...prev, members: (prev?.members || []).map(m => m.member_id === memberId ? res.data : m) }));
  };

  const removeMember = (memberId) => {
    setConfirmState({
      message: 'Remove this member from the project?',
      confirmLabel: 'Remove',
      onConfirm: async () => {
        await api.delete(`/teams/${selectedId}/members/${memberId}`);
        setProjectDetail(prev => ({ ...prev, members: (prev?.members || []).filter(m => m.member_id !== memberId) }));
      },
    });
  };

  const canAdd = !!(selectedUser || inviteEmail.trim());

  return (
    <div className="k-screen">
      <PageHeader
        kicker="PEOPLE"
        title="Team"
        sanskrit="दल"
        lede="Manage who has access to each project and their role."
      />

      {/* Project selector */}
      {projects.length > 0 ? (
        <section className="k-card" style={{ padding: '0' }}>
          <header className="k-card__head" style={{ paddingBottom: 0 }}>
            <div className="k-card__titles">
              <h3 className="k-card__title" style={{ fontSize: 13, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--ink-3)' }}>Project</h3>
            </div>
          </header>
          <div className="k-card__body" style={{ paddingTop: 8 }}>
            <select
              className="k-select"
              value={selectedId}
              onChange={e => { setSelectedId(e.target.value); resetAddForm(); }}
              style={{ width: '100%', fontSize: 15, fontWeight: 600 }}
            >
              {projects.map(p => (
                <option key={p.team_id} value={p.team_id}>{p.name}</option>
              ))}
            </select>
          </div>
        </section>
      ) : (
        <EmptyState
          illustration="teams"
          title={{ en: 'No teams created', hi: 'कोई टीम नहीं' }}
          description="Teams live on projects — create a project first, then add members here."
          action="Create Project"
          onAction={() => window.location.assign('/projects')}
        />
      )}

      {/* Member grid */}
      {members.length > 0 && (
        <div className="k-teamgrid">
          {members.map((m, idx) => {
            const color    = AVATAR_COLORS[idx % AVATAR_COLORS.length];
            const initials = userInitials(m.display_name || m.full_name || m.email);
            const name     = m.display_name || m.full_name || m.email || '?';
            const role     = m.role || 'member';
            return (
              <div key={m.member_id} className="k-mcard">
                <div className="k-mcard__head">
                  <span className="k-avatar" style={{ width: 44, height: 44, fontSize: 16, background: color, flexShrink: 0, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 600 }}>
                    {initials}
                  </span>
                  <div>
                    <div className="k-mcard__name">{name}</div>
                    <div className="k-mcard__role">
                      <span className={`k-rolebadge k-rolebadge--${role}`}>{role}</span>
                    </div>
                  </div>
                </div>

                <div className="k-mcard__stats">
                  <div><b>{m.open_task_count ?? 0}</b><span>open</span></div>
                  <div><b>{m.done_this_week ?? 0}</b><span>done</span></div>
                </div>

                {(m.open_tasks || []).slice(0, 3).map(t => (
                  <div key={t.task_id} className="k-mcard__row">
                    <PriorityDot priority={t.priority} size={6} />
                    <span className="k-mcard__tt">{t.title}</span>
                  </div>
                ))}
                {(m.open_tasks || []).length === 0 && (
                  <div className="k-mcard__empty">No open work · रिक्त</div>
                )}

                {isAdmin && (
                  <div style={{ marginTop: 12, display: 'flex', gap: 8, borderTop: '1px solid var(--rule-soft)', paddingTop: 12 }}>
                    <select
                      className="k-select"
                      value={role}
                      onChange={e => updateMemberRole(m.member_id, e.target.value)}
                      style={{ flex: 1, fontSize: 12 }}
                    >
                      {['admin', 'owner', 'member', 'client'].map(r => <option key={r} value={r}>{r}</option>)}
                    </select>
                    <button
                      className="k-btn k-btn--ghost k-btn--sm"
                      onClick={() => removeMember(m.member_id)}
                      style={{ color: 'var(--danger)', fontSize: 12 }}
                    >
                      Remove
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Add member panel */}
      {isAdmin && selectedId && (
        adding ? (
          <section className="k-card">
            <header className="k-card__head">
              <div className="k-card__titles">
                <h3 className="k-card__title">Add member to <em>{selectedProject?.name}</em></h3>
                <span className="k-card__sans">सदस्य जोड़ें</span>
              </div>
              <button className="k-btn k-btn--ghost k-btn--sm" onClick={resetAddForm} style={{ marginLeft: 'auto' }}>Cancel</button>
            </header>
            <div className="k-card__body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

              {/* Step 1: pick person */}
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.07em', color: 'var(--ink-3)', marginBottom: 6 }}>Person</div>
                {selectedUser ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 10, border: '1.5px solid var(--k-primary)', background: 'var(--side-active)' }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)' }}>{selectedUser.display_name}</div>
                      <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>{selectedUser.email}{selectedUser.company_name ? ` · ${selectedUser.company_name}` : ''}</div>
                    </div>
                    <button onClick={() => { setSelectedUser(null); setInviteEmail(''); }} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--ink-3)', fontSize: 18, lineHeight: 1 }}>×</button>
                  </div>
                ) : (
                  <div style={{ position: 'relative' }}>
                    <input
                      className="k-input"
                      placeholder="Search by name or email…"
                      value={userSearch}
                      onChange={e => { setUserSearch(e.target.value); setInviteEmail(''); }}
                      autoFocus
                    />
                    {userSearch && filteredUsers.length > 0 && (
                      <div style={{
                        position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 50,
                        background: 'var(--surface)', border: '1px solid var(--rule)',
                        borderRadius: 10, boxShadow: '0 8px 24px rgba(0,0,0,.12)',
                        marginTop: 4, maxHeight: 220, overflowY: 'auto',
                      }}>
                        {filteredUsers.map(u => (
                          <button key={u.user_id} onClick={() => { setSelectedUser(u); setUserSearch(''); setInviteEmail(''); }} style={{
                            display: 'block', width: '100%', textAlign: 'left',
                            padding: '10px 14px', border: 'none', background: 'transparent',
                            cursor: 'pointer', borderBottom: '1px solid var(--rule-soft)',
                          }}
                            onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-soft)'}
                            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                          >
                            <div style={{ fontSize: 14, color: 'var(--ink)', fontWeight: 500 }}>{u.display_name}</div>
                            <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 1 }}>
                              {u.role}{u.company_name ? ` · ${u.company_name}` : ''}
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                    {userSearch && filteredUsers.length === 0 && (
                      <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 50, marginTop: 4, padding: '10px 14px', background: 'var(--surface)', border: '1px solid var(--rule)', borderRadius: 10, fontSize: 13, color: 'var(--ink-3)' }}>
                        No existing user found.{' '}
                        <button onClick={() => { setInviteEmail(userSearch); setUserSearch(''); }} style={{ background: 'none', border: 'none', color: 'var(--k-primary)', cursor: 'pointer', fontSize: 13, padding: 0 }}>
                          Invite "{userSearch}" by email →
                        </button>
                      </div>
                    )}
                    {!userSearch && (
                      <input className="k-input" type="email" value={inviteEmail} onChange={e => setInviteEmail(e.target.value)}
                        placeholder="Or type email to invite someone new…" style={{ marginTop: 8 }} />
                    )}
                  </div>
                )}
              </div>

              {/* Step 2: pick role */}
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.07em', color: 'var(--ink-3)', marginBottom: 6 }}>Role</div>
                <select className="k-select" value={inviteRole} onChange={e => setInviteRole(e.target.value)} style={{ width: '100%' }}>
                  {['member', 'admin', 'owner', 'client'].map(r => (
                    <option key={r} value={r}>{r.charAt(0).toUpperCase() + r.slice(1)}</option>
                  ))}
                </select>
              </div>

              {/* Client-only options */}
              {inviteRole === 'client' && (
                <>
                  {!selectedUser?.company_name && (
                    <input className="k-input" value={clientCompany} onChange={e => setClientCompany(e.target.value)}
                      placeholder="Company name (for client)" />
                  )}
                  <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', fontSize: 13, color: 'var(--ink-2)' }}>
                    <div onClick={() => setClientApproval(v => !v)} style={{
                      width: 36, height: 20, borderRadius: 10, position: 'relative', cursor: 'pointer',
                      background: clientApproval ? 'var(--k-primary)' : 'var(--rule)', transition: 'background .15s', flexShrink: 0,
                    }}>
                      <div style={{
                        position: 'absolute', top: 3, left: clientApproval ? 18 : 3,
                        width: 14, height: 14, borderRadius: '50%', background: '#fff',
                        transition: 'left .15s', boxShadow: '0 1px 3px rgba(0,0,0,.2)',
                      }} />
                    </div>
                    <span>Requires approval for task completion</span>
                  </label>
                </>
              )}

              <button
                className="k-btn k-btn--primary"
                onClick={addMember}
                disabled={!canAdd}
                style={{ alignSelf: 'flex-start' }}
              >
                Add to {selectedProject?.name}
              </button>
            </div>
          </section>
        ) : (
          <button
            className="k-btn k-btn--ghost"
            onClick={() => setAdding(true)}
            style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--k-primary)', border: '1.5px dashed var(--k-primary)', borderRadius: 10, padding: '10px 18px', fontSize: 14, fontWeight: 600, width: '100%', justifyContent: 'center' }}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M8 3v10M3 8h10"/></svg>
            Add member to this project
          </button>
        )
      )}

      {projectDetail && members.length === 0 && !adding && (
        <div style={{ padding: '32px 0', textAlign: 'center', color: 'var(--ink-3)', fontStyle: 'italic', fontSize: 14 }}>
          No members yet — add someone above.
        </div>
      )}

      <ConfirmDialog state={confirmState} onClose={() => setConfirmState(null)} />
    </div>
  );
}
