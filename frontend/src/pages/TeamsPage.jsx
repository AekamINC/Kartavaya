import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { PageHeader, PriorityDot } from '../components/editorial';
import { AVATAR_COLORS, userInitials } from '../lib/utils';
import ConfirmDialog from '../components/ui/ConfirmDialog';
import { EmptyState } from '../components/ui/EmptyState';
import { ErrorState, errorKind } from '../components/ui/ErrorState';

/**
 * TeamsPage — the reference migration onto the design system.
 *
 * Before: 33 inline style objects, 10 `k-btn`, 3 `k-input`, a hand-rolled
 * toggle, a hand-rolled typeahead dropdown with its hover state written in JS
 * (onMouseEnter assigning style.background — a repaint per row, and invisible
 * to the theme), and an avatar re-specified inline despite .k-avatar existing.
 *
 * After: 0 inline style objects. Everything resolves to a component class in
 * components.css. Five of those classes are new (.sw, .menu, .picked, .addbtn,
 * .k-avatar--lg) and were added rather than written here, because a person
 * picker and a toggle appear on most of the remaining 41 pages — the point of
 * doing one page first is to find out what the component layer is missing.
 *
 * Nothing about the behaviour changed. Same endpoints, same state, same flow.
 */
export default function TeamsPage() {
  // `null` until the list actually arrives. "No teams created" sends the user
  // off to build a project they already have; over a 500 it is both wrong and
  // actively misleading.
  const [projects,       setProjects]       = useState(null);
  const [projectsErr,    setProjectsErr]    = useState(null);
  const [selectedId,     setSelectedId]     = useState('');
  const [projectDetail,  setProjectDetail]  = useState(null);
  const [detailErr,      setDetailErr]      = useState(null);
  const [allUsers,       setAllUsers]       = useState(null);
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
    loadProjects().then(() => setProjectsErr(null)).catch(e => { setProjects(null); setProjectsErr(e); });
    api.get('/users')
      .then(r => setAllUsers(Array.isArray(r.data) ? r.data : []))
      .catch(() => setAllUsers(null));
  }, []); // eslint-disable-line

  useEffect(() => {
    if (!selectedId) { setProjectDetail(null); setDetailErr(null); return; }
    // Clearing first matters as much as recording the error. This kept the
    // PREVIOUS project's members on screen under the newly selected project's
    // name when the second fetch failed — a roster attributed to the wrong
    // project is worse than no roster.
    setProjectDetail(null);
    setDetailErr(null);
    loadDetail(selectedId).catch(e => { setProjectDetail(null); setDetailErr(e); });
  }, [selectedId]); // eslint-disable-line

  const yourRole = projectDetail?.your_role || 'member';
  const isAdmin  = yourRole === 'owner' || yourRole === 'admin';
  const members  = useMemo(() => projectDetail?.members || [], [projectDetail]);

  const selectedProject = (projects || []).find(p => p.team_id === selectedId);

  // Null when the directory never loaded, so the picker below can say it does
  // not know rather than "No existing user found" — which offers to send an
  // invitation to somebody who already has an account.
  const filteredUsers = allUsers === null ? null : allUsers.filter(u => {
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

      {/* Loading, then failure, then empty. */}
      {projectsErr ? (
        <ErrorState
          kind={errorKind(projectsErr)}
          grant="access to these projects"
          onRetry={() => loadProjects().then(() => setProjectsErr(null)).catch(e => setProjectsErr(e))}
        />
      ) : projects === null ? (
        <p className="k-note">Loading projects…</p>
      ) : projects.length > 0 ? (
        <section className="card">
          <div className="card__body">
            <label className="fld">
              <span className="fld__l">Project<span className="fld__hi" lang="hi">योजना</span></span>
              <select
                className="inp"
                value={selectedId}
                onChange={e => { setSelectedId(e.target.value); resetAddForm(); }}
              >
                {projects.map(p => (
                  <option key={p.team_id} value={p.team_id}>{p.name}</option>
                ))}
              </select>
            </label>
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
                  {/* --av-c is set per element by design — a deterministic
                      colour hashed from the person, not a theme decision. */}
                  <span className="k-avatar k-avatar--lg" style={{ '--av-c': color, background: 'var(--av-c)' }}>
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
                  <div className="k-mcard__empty">No open work <span lang="hi">रिक्त</span></div>
                )}

                {isAdmin && (
                  <div className="k-mcard__admin">
                    <select
                      className="inp"
                      aria-label={`Role for ${name}`}
                      value={role}
                      onChange={e => updateMemberRole(m.member_id, e.target.value)}
                    >
                      {['admin', 'owner', 'member', 'client'].map(r => <option key={r} value={r}>{r}</option>)}
                    </select>
                    <button className="btn btn--danger btn--sm" onClick={() => removeMember(m.member_id)}>
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
          <section className="card">
            <div className="card__head">
              <div className="card__titles">
                <h3 className="card__title">Add member to {selectedProject?.name}</h3>
                <span className="card__hi" lang="hi">सदस्य जोड़ें</span>
              </div>
              <button className="btn btn--ghost btn--sm" onClick={resetAddForm}>Cancel</button>
            </div>

            <div className="card__body stack">
              {/* Step 1: pick person */}
              <div className="fld">
                <span className="fld__l">Person<span className="fld__hi" lang="hi">व्यक्ति</span></span>
                {selectedUser ? (
                  <div className="picked">
                    <div className="picked__body">
                      <div className="picked__t">{selectedUser.display_name}</div>
                      <div className="picked__d">
                        {selectedUser.email}{selectedUser.company_name ? ` · ${selectedUser.company_name}` : ''}
                      </div>
                    </div>
                    <button
                      className="picked__x"
                      aria-label={`Clear ${selectedUser.display_name}`}
                      onClick={() => { setSelectedUser(null); setInviteEmail(''); }}
                    >
                      ×
                    </button>
                  </div>
                ) : (
                  <div className="anchor">
                    <input
                      className="inp"
                      placeholder="Search by name or email…"
                      value={userSearch}
                      onChange={e => { setUserSearch(e.target.value); setInviteEmail(''); }}
                      autoFocus
                    />
                    {/* Hover was an onMouseEnter handler assigning
                        style.background — a JS repaint per row, and one that
                        could not follow the theme. It is a :hover rule now. */}
                    {userSearch && filteredUsers === null && (
                      <div className="menu menu__empty">
                        The user directory did not load, so we cannot tell whether
                        “{userSearch}” already has an account.
                      </div>
                    )}
                    {userSearch && filteredUsers?.length > 0 && (
                      <div className="menu">
                        {filteredUsers.map(u => (
                          <button
                            key={u.user_id}
                            className="menu__item"
                            onClick={() => { setSelectedUser(u); setUserSearch(''); setInviteEmail(''); }}
                          >
                            <div className="menu__t">{u.display_name}</div>
                            <div className="menu__d">
                              {u.role}{u.company_name ? ` · ${u.company_name}` : ''}
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                    {userSearch && filteredUsers?.length === 0 && (
                      <div className="menu menu__empty">
                        No existing user found.{' '}
                        <button className="btn btn--text btn--sm" onClick={() => { setInviteEmail(userSearch); setUserSearch(''); }}>
                          Invite “{userSearch}” by email →
                        </button>
                      </div>
                    )}
                    {!userSearch && (
                      <input
                        className="inp"
                        type="email"
                        value={inviteEmail}
                        onChange={e => setInviteEmail(e.target.value)}
                        aria-label="Invite by email"
                        placeholder="Or type email to invite someone new…"
                      />
                    )}
                  </div>
                )}
              </div>

              {/* Step 2: pick role */}
              <label className="fld">
                <span className="fld__l">Role<span className="fld__hi" lang="hi">भूमिका</span></span>
                <select className="inp" value={inviteRole} onChange={e => setInviteRole(e.target.value)}>
                  {['member', 'admin', 'owner', 'client'].map(r => (
                    <option key={r} value={r}>{r.charAt(0).toUpperCase() + r.slice(1)}</option>
                  ))}
                </select>
              </label>

              {/* Client-only options */}
              {inviteRole === 'client' && (
                <>
                  {!selectedUser?.company_name && (
                    <label className="fld">
                      <span className="fld__l">Company</span>
                      <input className="inp" value={clientCompany} onChange={e => setClientCompany(e.target.value)}
                        placeholder="Company name (for client)" />
                    </label>
                  )}
                  {/* A real button with aria-checked, not a div with an onClick.
                      The old one was unreachable by keyboard entirely. */}
                  <label className="sw__row">
                    <button
                      type="button"
                      role="switch"
                      aria-checked={clientApproval}
                      className="sw"
                      onClick={() => setClientApproval(v => !v)}
                    />
                    <span>Requires approval for task completion</span>
                  </label>
                </>
              )}

              <div>
                <button className="btn btn--fill" onClick={addMember} disabled={!canAdd}>
                  Add to {selectedProject?.name}
                </button>
              </div>
            </div>
          </section>
        ) : (
          <button className="addbtn" onClick={() => setAdding(true)}>
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
              <path d="M8 3v10M3 8h10" />
            </svg>
            Add member to this project
          </button>
        )
      )}

      {detailErr && (
        <ErrorState
          kind={errorKind(detailErr)}
          grant="access to this project’s members"
          onRetry={() => { setDetailErr(null); loadDetail(selectedId).catch(e => setDetailErr(e)); }}
        />
      )}
      {!detailErr && projectDetail && members.length === 0 && !adding && (
        <p className="k-note">No members yet — add someone above.</p>
      )}

      <ConfirmDialog state={confirmState} onClose={() => setConfirmState(null)} />
    </div>
  );
}
