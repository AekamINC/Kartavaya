/**
 * ProjectsPage.jsx — editorial Projects grid with soft-delete bin.
 */
import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import { currentUser } from '../lib/auth';
import { useToast } from '../components/ui/toast';
import { PageHeader, DueChip } from '../components/editorial';
import ConfirmDialog from '../components/ui/ConfirmDialog';
import { EmptyState } from '../components/ui/EmptyState';
import BrandKit from '../components/BrandKit';
import { AVATAR_COLORS } from '../lib/utils';

// ── Delete confirmation modal ─────────────────────────────────────────────────
function DeleteProjectModal({ project, onConfirm, onCancel }) {
  const [typed, setTyped] = useState('');
  const inputRef = useRef(null);
  const match = typed.trim() === project?.name?.trim();

  useEffect(() => {
    setTyped('');
    setTimeout(() => inputRef.current?.focus(), 60);
  }, [project]);

  if (!project) return null;

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 600, background: 'rgba(10,10,16,0.72)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
      onClick={e => e.target === e.currentTarget && onCancel()}
    >
      <div style={{ background: 'var(--surface)', border: '1.5px solid #e53e3e55', borderRadius: 18, width: '100%', maxWidth: 440, boxShadow: '0 32px 80px rgba(229,62,62,0.18), 0 8px 32px rgba(0,0,0,0.3)', overflow: 'hidden' }}>

        {/* Red header band */}
        <div style={{ background: 'linear-gradient(135deg, #e53e3e 0%, #c53030 100%)', padding: '20px 24px 16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
            <span style={{ width: 32, height: 32, borderRadius: '50%', background: 'rgba(255,255,255,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="#fff" strokeWidth="2"><path d="M8 1v6M8 11v2"/><circle cx="8" cy="8" r="7"/></svg>
            </span>
            <div>
              <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.7)', marginBottom: 2 }}>
                DELETE PROJECT · परियोजना हटाएँ
              </div>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 20, fontWeight: 400, color: '#fff', lineHeight: 1.2 }}>
                Move to Bin
              </div>
            </div>
          </div>
        </div>

        {/* Body */}
        <div style={{ padding: '20px 24px 24px' }}>
          <p style={{ fontSize: 14, color: 'var(--ink-3)', lineHeight: 1.6, margin: '0 0 16px' }}>
            <strong style={{ color: 'var(--ink)' }}>{project.name}</strong> and all its tasks, columns, and settings will be moved to the bin. You can restore it within <strong style={{ color: 'var(--ink)' }}>30 days</strong>.
          </p>

          <div style={{ background: '#e53e3e0d', border: '1px solid #e53e3e33', borderRadius: 10, padding: '12px 14px', marginBottom: 20 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#e53e3e', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8 }}>
              Type the project name to confirm
            </div>
            <input
              ref={inputRef}
              value={typed}
              onChange={e => setTyped(e.target.value)}
              placeholder={project.name}
              onKeyDown={e => { if (e.key === 'Enter' && match) onConfirm(); if (e.key === 'Escape') onCancel(); }}
              style={{ width: '100%', background: 'var(--bg)', border: `1.5px solid ${match ? '#e53e3e' : 'var(--rule)'}`, borderRadius: 8, padding: '8px 12px', fontSize: 14, color: 'var(--ink)', fontFamily: 'var(--font-ui)', outline: 'none', transition: 'border .15s', boxSizing: 'border-box' }}
            />
            {typed.length > 0 && !match && (
              <div style={{ fontSize: 11, color: '#e53e3e', marginTop: 5 }}>
                Name doesn't match — type <em>{project.name}</em> exactly.
              </div>
            )}
          </div>

          <div style={{ display: 'flex', gap: 10 }}>
            <button
              onClick={onConfirm}
              disabled={!match}
              style={{ flex: 1, padding: '10px 0', borderRadius: 10, border: 'none', cursor: match ? 'pointer' : 'not-allowed', fontSize: 14, fontWeight: 700, fontFamily: 'var(--font-ui)', background: match ? 'linear-gradient(135deg,#e53e3e,#c53030)' : 'var(--rule)', color: match ? '#fff' : 'var(--ink-faint)', transition: 'all .15s', boxShadow: match ? '0 4px 16px rgba(229,62,62,0.3)' : 'none' }}
            >
              Move to Bin
            </button>
            <button
              onClick={onCancel}
              style={{ padding: '10px 20px', borderRadius: 10, border: '1.5px solid var(--rule)', background: 'transparent', cursor: 'pointer', fontSize: 14, fontWeight: 500, fontFamily: 'var(--font-ui)', color: 'var(--ink-3)' }}
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function ProjectsPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { pushToast } = useToast();
  const me = currentUser();
  const isMainAdmin = me?.role === 'admin';

  const [projects,    setProjects]    = useState([]);
  const [binProjects, setBinProjects] = useState([]);
  const [name,           setName]           = useState('');
  const [creating,       setCreating]       = useState(false);
  const [showNew,        setShowNew]        = useState(false);
  const [showBrandKit,   setShowBrandKit]   = useState(false);
  const [brandKit,       setBrandKit]       = useState({ colors: [], fonts: [] });
  const [showBin,     setShowBin]     = useState(false);
  const [deleteModal, setDeleteModal] = useState(null); // project object
  const [confirmState, setConfirmState] = useState(null);

  const load = () => api.get('/teams').then(r => setProjects(Array.isArray(r.data) ? r.data : [])).catch(() => {});
  const loadBin = () => api.get('/teams/bin').then(r => setBinProjects(Array.isArray(r.data) ? r.data : [])).catch(() => {});

  useEffect(() => { load(); }, []); // eslint-disable-line
  useEffect(() => { if (showBin) loadBin(); }, [showBin]);

  // Deep-link from the onboarding checklist: /projects?new=1 opens the New Project prompt.
  useEffect(() => {
    if (searchParams.get('new') === '1') {
      setShowNew(true);
      const next = new URLSearchParams(searchParams);
      next.delete('new');
      setSearchParams(next, { replace: true });
    }
  }, [searchParams]); // eslint-disable-line

  const create = async () => {
    if (!name.trim()) return;
    setCreating(true);
    try {
      await api.post('/teams', {
        name: name.trim(),
        brand_settings: (brandKit.colors.length || brandKit.fonts.length) ? brandKit : undefined,
      });
      setName(''); setShowNew(false); setShowBrandKit(false); setBrandKit({ colors: [], fonts: [] });
      pushToast({ type: 'success', title: 'Project created' }); load();
    } catch (_) { pushToast({ type: 'error', title: 'Could not create project' }); }
    finally { setCreating(false); }
  };

  const confirmDelete = async () => {
    if (!deleteModal) return;
    try {
      await api.delete(`/teams/${deleteModal.team_id}`);
      pushToast({ type: 'success', title: `"${deleteModal.name}" moved to bin` });
      setDeleteModal(null);
      load();
    } catch (_) { pushToast({ type: 'error', title: 'Could not delete project' }); }
  };

  const restore = async (p) => {
    try {
      await api.post(`/teams/${p.team_id}/restore`);
      pushToast({ type: 'success', title: `"${p.name}" restored` });
      loadBin(); load();
    } catch (_) { pushToast({ type: 'error', title: 'Could not restore' }); }
  };

  const purge = (p) => {
    setConfirmState({
      message: `Permanently delete "${p.name}"? This cannot be undone.`,
      confirmLabel: 'Delete permanently',
      onConfirm: async () => {
        try {
          await api.delete(`/teams/${p.team_id}/purge`);
          pushToast({ type: 'success', title: 'Permanently deleted' });
          loadBin();
        } catch (_) { pushToast({ type: 'error', title: 'Could not purge' }); }
      },
    });
  };

  return (
    <div className="k-screen">
      <PageHeader
        kicker="WORKSPACE"
        title="Projects"
        sanskrit="परियोजनाएँ"
        lede="Every active engagement — internal and client."
        right={
          <div style={{ display: 'flex', gap: 8 }}>
            {isMainAdmin && (
              <button
                className={'k-btn k-btn--ghost k-btn--sm' + (showBin ? ' is-active' : '')}
                onClick={() => setShowBin(v => !v)}
                style={{ display: 'flex', alignItems: 'center', gap: 6 }}
              >
                <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M3 4h10M5 4V2.5h6V4M6 7v5M10 7v5M4 4l.8 10h6.4L12 4"/></svg>
                Bin {binProjects.length > 0 && showBin && <span style={{ background: '#e53e3e', color: '#fff', borderRadius: 99, padding: '0 5px', fontSize: 10, fontWeight: 700 }}>{binProjects.length}</span>}
              </button>
            )}
            <button className="k-btn k-btn--primary k-btn--sm" onClick={() => setShowNew(v => !v)}>
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2"><path d="M8 3v10M3 8h10"/></svg>
              New project
            </button>
          </div>
        }
      />

      {/* New project form */}
      {showNew && (
        <section className="k-card">
          <header className="k-card__head">
            <div className="k-card__titles">
              <h3 className="k-card__title">New project</h3>
              <span className="k-card__sans">नई परियोजना</span>
            </div>
          </header>
          <div className="k-card__body" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* Name row */}
            <div style={{ display: 'flex', gap: 10 }}>
              <input className="k-input" value={name} onChange={e => setName(e.target.value)}
                placeholder="Project name…" onKeyDown={e => e.key === 'Enter' && !showBrandKit && create()}
                autoFocus style={{ flex: 1 }} />
            </div>

            {/* Brand kit toggle */}
            <button
              type="button"
              onClick={() => setShowBrandKit(v => !v)}
              style={{ display: 'flex', alignItems: 'center', gap: 8, width: 'fit-content',
                background: 'none', border: 'none', cursor: 'pointer', padding: 0,
                fontSize: 12, fontWeight: 600, color: 'var(--k-primary)', fontFamily: 'var(--font-ui)' }}
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8">
                <path d={showBrandKit ? 'M2 4l4 4 4-4' : 'M4 2l4 4-4 4'} />
              </svg>
              {showBrandKit ? 'Hide' : 'Add'} brand kit — colors & fonts (optional)
            </button>

            {showBrandKit && (
              <div style={{ borderTop: '1px solid var(--rule-soft)', paddingTop: 16 }}>
                <div style={{ fontSize: 12, color: 'var(--ink-3)', marginBottom: 14 }}>
                  Define this project's brand colors and typefaces. Team members will see these as a reference in tasks.
                </div>
                <BrandKit mode="edit" value={brandKit} onChange={setBrandKit} />
              </div>
            )}

            {/* Actions */}
            <div style={{ display: 'flex', gap: 10, paddingTop: 4 }}>
              <button className="k-btn k-btn--primary" onClick={create} disabled={creating || !name.trim()}>
                {creating ? 'Creating…' : 'Create project'}
              </button>
              <button className="k-btn k-btn--ghost" onClick={() => { setShowNew(false); setShowBrandKit(false); setBrandKit({ colors: [], fonts: [] }); }}>
                Cancel
              </button>
            </div>
          </div>
        </section>
      )}

      {/* ── Bin ──────────────────────────────────────────────────────────────── */}
      {showBin && isMainAdmin && (
        <section className="k-card" style={{ borderColor: '#e53e3e33', marginBottom: 'var(--sp-5)' }}>
          <header className="k-card__head">
            <div className="k-card__titles">
              <h3 className="k-card__title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="#e53e3e" strokeWidth="1.5"><path d="M3 4h10M5 4V2.5h6V4M6 7v5M10 7v5M4 4l.8 10h6.4L12 4"/></svg>
                Project Bin
              </h3>
              <span className="k-card__sans">रद्दी</span>
            </div>
            <span style={{ fontSize: 12, color: 'var(--ink-3)', marginLeft: 'auto' }}>
              Projects restore within 30 days · auto-purged after
            </span>
          </header>
          <div className="k-card__body" style={{ padding: 0 }}>
            {binProjects.length === 0 ? (
              <div style={{ padding: '24px', textAlign: 'center', color: 'var(--ink-3)', fontSize: 13, fontStyle: 'italic' }}>Bin is empty</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                {binProjects.map((p, i) => {
                  const days = Math.round(p.days_deleted || 0);
                  const remaining = 30 - days;
                  return (
                    <div key={p.team_id} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '12px 20px', borderBottom: i < binProjects.length - 1 ? '1px solid var(--rule-soft)' : 'none' }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)' }}>{p.name}</div>
                        <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 2 }}>
                          Deleted {days === 0 ? 'today' : `${days}d ago`} by {p.deleted_by_name || 'Admin'}
                          {' · '}
                          <span style={{ color: remaining <= 5 ? '#e53e3e' : 'var(--ink-3)', fontWeight: remaining <= 5 ? 700 : 400 }}>
                            {remaining}d left to restore
                          </span>
                        </div>
                      </div>
                      {/* Countdown bar */}
                      <div style={{ width: 80, height: 4, background: 'var(--rule)', borderRadius: 4, overflow: 'hidden', flexShrink: 0 }}>
                        <div style={{ height: '100%', width: `${(remaining / 30) * 100}%`, background: remaining <= 5 ? '#e53e3e' : remaining <= 10 ? '#f59e0b' : '#05b7aa', borderRadius: 4, transition: 'width .3s' }} />
                      </div>
                      <button className="k-btn k-btn--ghost k-btn--sm" onClick={() => restore(p)} style={{ color: '#05b7aa', borderColor: '#05b7aa44' }}>
                        Restore
                      </button>
                      <button className="k-btn k-btn--ghost k-btn--sm" onClick={() => purge(p)} style={{ color: '#e53e3e', borderColor: '#e53e3e44' }}>
                        Delete forever
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </section>
      )}

      {/* Project grid */}
      <div className="k-pgrid">
        {projects.length === 0 && (
          <EmptyState
            illustration="projects"
            title={{ en: 'No projects yet', hi: 'अभी कोई योजना नहीं' }}
            description="Every engagement — internal or client-facing — starts here. Create one to get going."
            action="Create Project"
            onAction={() => setShowNew(true)}
          />
        )}
        {projects.map((p, idx) => {
          const color     = AVATAR_COLORS[idx % AVATAR_COLORS.length];
          const taskCount = p.task_count || 0;
          const doneCount = p.done_count || 0;
          const openCount = taskCount - doneCount;
          const progress  = taskCount > 0 ? doneCount / taskCount : 0;
          const kicker    = p.category || p.name.split(' ').pop().toUpperCase().slice(0, 10);

          return (
            <button key={p.team_id} className="k-pcard" onClick={() => navigate(`/projects/${p.team_id}`)}>
              <div className="k-pcard__head">
                <span className="k-pcard__bar" style={{ background: color }} />
                <div className="k-pcard__titles">
                  <div className="k-pcard__sans" style={{ color }}>{kicker}</div>
                  <div className="k-pcard__name">{p.name}</div>
                  <div className="k-pcard__client">{p.workspace_name || 'Internal'}</div>
                </div>
                {isMainAdmin && (
                  <button
                    className="k-iconbtn"
                    style={{ marginLeft: 'auto', opacity: 0.45, fontSize: 12 }}
                    onClick={e => { e.stopPropagation(); setDeleteModal(p); }}
                    title="Move to bin"
                    aria-label="Move project to bin"
                  >
                    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M3 4h10M5 4V2.5h6V4M6 7v5M10 7v5M4 4l.8 10h6.4L12 4"/></svg>
                  </button>
                )}
              </div>
              <div className="k-pcard__body">
                <div className="k-pcard__stat"><b>{taskCount}</b><span>tasks</span></div>
                <div className="k-pcard__stat"><b>{doneCount}</b><span>done</span></div>
                <div className="k-pcard__stat"><b>{openCount}</b><span>open</span></div>
              </div>
              <div className="k-pcard__meter">
                <div className="k-pcard__bar2">
                  <i style={{ width: Math.round(progress * 100) + '%', background: color }} />
                </div>
                <div className="k-pcard__meter-row">
                  <span>{Math.round(progress * 100)}% complete</span>
                  {p.due_at && <DueChip date={p.due_at} />}
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {/* Delete confirmation modal */}
      <DeleteProjectModal
        project={deleteModal}
        onConfirm={confirmDelete}
        onCancel={() => setDeleteModal(null)}
      />
      <ConfirmDialog state={confirmState} onClose={() => setConfirmState(null)} />
    </div>
  );
}
