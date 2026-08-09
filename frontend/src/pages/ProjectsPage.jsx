/**
 * ProjectsPage.jsx — the projects grid with its soft-delete bin (`/projects`).
 *
 * WHAT CHANGED:
 *
 *  · `DeleteProjectModal` — 80 lines and ~20 inline styles hand-rolling a
 *    dialog — is DELETED, not restyled. `ConfirmDialog` already does everything
 *    it did and three things it did not: a FocusTrap, a real
 *    role="alertdialog"/aria-labelledby pair, and a scroll lock. It has
 *    supported typed confirmation via `confirmText` all along (02 §3), which is
 *    exactly the "type the project name" affordance this file reimplemented. A
 *    keyboard user could previously Tab straight out of the delete dialog into
 *    the project grid behind it and press Enter on the wrong card.
 *
 *  · A private red palette — `#e53e3e`, `#c53030`, `#e53e3e55`, `#e53e3e0d`,
 *    `rgba(229,62,62,0.18)` plus `#f59e0b` and `#05b7aa` in the bin countdown —
 *    none of it theme-aware, all of it disagreeing with `--danger` / `--warn` /
 *    `--ok`. In dark mode the delete band stayed a light-mode red on a dark
 *    surface. Gone; the semantic tokens carry it.
 *
 *  · 47 inline styles total. The survivors are `--c` and `--w` custom
 *    properties carrying per-project accent and progress width, which is
 *    genuinely per-instance data.
 *
 *  · `/teams` and `/teams/bin` were both `.catch(() => {})` — a swallowed
 *    rejection with no state written — so a failed load rendered the "No
 *    projects yet" empty state and its "Create Project" button to a user whose
 *    projects had simply failed to arrive. Both are three-state now.
 *
 * `/teams` (server.py:1904) is `List[TeamOut]`, a bare array; `rows()` covers
 * that and the envelope both.
 */
import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api, rows as asRows } from '../lib/api';
import { useToast } from '../components/ui/toast';
import { PageHeader, DueChip } from '../components/editorial';
import { Card, CardHead, CardBody } from '../components/ui/Card';
import { Input } from '../components/ui/Field';
import Button from '../components/ui/Button';
import ConfirmDialog from '../components/ui/ConfirmDialog';
import { EmptyState } from '../components/ui/EmptyState';
import { ErrorState, errorKind } from '../components/ui/ErrorState';
import { SkeletonCardGrid } from '../components/ui/Skeleton';
import BrandKit from '../components/BrandKit';
import { avatarBg } from '../components/ui/Avatar';
import { Secondary } from '../components/Bilingual';

// Seven, not thirty — owner's decision 2026-08-09. Must stay equal to
// `PROJECT_BIN_DAYS` in `backend/server.py`, which is what actually enforces
// the window; this constant only draws the countdown.
const BIN_DAYS = 7;
const TRASH = <path d="M3 4h10M5 4V2.5h6V4M6 7v5M10 7v5M4 4l.8 10h6.4L12 4" />;
const BOX = <path d="M2 3.5h12v3H2zM3 6.5v6h10v-6M6.5 9h3" />;

export default function ProjectsPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { pushToast } = useToast();
  /* WHO MAY ARCHIVE OR DELETE is now the server's answer, per project, on
     `can_admin`. It used to be `currentUser().role === 'admin'` — the global
     `users.role` claim baked into the JWT, which is a PER-ORG fact stored in one
     global column and is held by six vendor accounts and nobody else. So the
     customer who owns the project never saw the delete control at all, which is
     half of why the owner reported archive/delete as broken. `showBin` follows
     the same answer: you get a bin if you administer at least one project. */
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState(null);
  const canAdminAny = projects.some(p => p.can_admin);
  /* `/teams` returns archived projects too — deliberately, because reports must
     keep counting a finished engagement. The grid is the one place they should
     not sit alongside live work, so they are split out here rather than
     filtered out of the request. */
  const liveProjects = projects.filter(p => !p.archived_at);
  const archivedProjects = projects.filter(p => p.archived_at);

  const [binProjects, setBinProjects] = useState([]);
  const [binLoading, setBinLoading] = useState(false);
  const [binErr, setBinErr] = useState(null);

  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showBrandKit, setShowBrandKit] = useState(false);
  const [brandKit, setBrandKit] = useState({ colors: [], fonts: [] });
  const [showBin, setShowBin] = useState(false);
  const [confirmState, setConfirmState] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadErr(null);
    try {
      const r = await api.get('/teams');
      setProjects(asRows(r));
    } catch (e) {
      setLoadErr(errorKind(e));
    } finally {
      setLoading(false);
    }
  }, []);

  const loadBin = useCallback(async () => {
    setBinLoading(true);
    setBinErr(null);
    try {
      const r = await api.get('/teams/bin');
      setBinProjects(asRows(r));
    } catch (e) {
      setBinErr(errorKind(e));
    } finally {
      setBinLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (showBin) loadBin(); }, [showBin, loadBin]);

  // Deep-link from the onboarding checklist: /projects?new=1 opens the form.
  useEffect(() => {
    if (searchParams.get('new') === '1') {
      setShowNew(true);
      const next = new URLSearchParams(searchParams);
      next.delete('new');
      setSearchParams(next, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  const create = async () => {
    if (!name.trim()) return;
    setCreating(true);
    try {
      await api.post('/teams', {
        name: name.trim(),
        brand_settings: (brandKit.colors.length || brandKit.fonts.length) ? brandKit : undefined,
      });
      setName(''); setShowNew(false); setShowBrandKit(false);
      setBrandKit({ colors: [], fonts: [] });
      pushToast({ type: 'success', title: 'Project created' });
      load();
    } catch {
      pushToast({ type: 'error', title: 'Could not create project' });
    } finally {
      setCreating(false);
    }
  };

  /* Typed confirmation, from the system dialog rather than a private one.
     `confirmText` keeps the confirm button inert until the project's name is
     typed exactly — the same guard the hand-rolled modal implemented, now with
     a focus trap and an Escape handler behind it. */
  const askDelete = (p) => setConfirmState({
    title: 'Move project to bin?',
    message: `"${p.name}" and all its tasks, columns and settings move to the bin. You can restore it within ${BIN_DAYS} days.`,
    confirmText: p.name,
    confirmLabel: 'Move to bin',
    intent: 'danger',
    onConfirm: async () => {
      try {
        await api.delete(`/teams/${p.team_id}`);
        pushToast({ type: 'success', title: `"${p.name}" moved to bin` });
        load();
      } catch {
        pushToast({ type: 'error', title: 'Could not delete project' });
      }
    },
  });

  /* ARCHIVE — a third state, and NOT a soft delete. `POST /teams/:id/archive`
     has existed since migration 104 and had no button anywhere in the app, so
     the only way to retire a finished engagement was to delete it. No typed
     confirmation: nothing is erased and one click undoes it. */
  const archive = async (p) => {
    try {
      await api.post(`/teams/${p.team_id}/archive`);
      pushToast({ type: 'success', title: `"${p.name}" archived` });
      load();
    } catch (e) {
      pushToast({
        type: 'error',
        title: 'Could not archive project',
        // 503 here means migration 104 has not been applied to this database.
        // Saying so beats a generic failure the reader cannot act on.
        message: e?.response?.data?.detail || undefined,
      });
    }
  };

  const unarchive = async (p) => {
    try {
      await api.post(`/teams/${p.team_id}/unarchive`);
      pushToast({ type: 'success', title: `"${p.name}" is active again` });
      load();
    } catch {
      pushToast({ type: 'error', title: 'Could not unarchive project' });
    }
  };

  const restore = async (p) => {
    try {
      await api.post(`/teams/${p.team_id}/restore`);
      pushToast({ type: 'success', title: `"${p.name}" restored` });
      loadBin(); load();
    } catch {
      pushToast({ type: 'error', title: 'Could not restore project' });
    }
  };

  const purge = (p) => setConfirmState({
    title: 'Delete permanently?',
    message: `"${p.name}" will be erased. This cannot be undone.`,
    confirmText: p.name,
    confirmLabel: 'Delete permanently',
    intent: 'danger',
    onConfirm: async () => {
      try {
        await api.delete(`/teams/${p.team_id}/purge`);
        pushToast({ type: 'success', title: 'Permanently deleted' });
        loadBin();
      } catch {
        pushToast({ type: 'error', title: 'Could not delete project' });
      }
    },
  });

  return (
    <div className="k-screen">
      <PageHeader
        kicker="WORKSPACE"
        title="Projects"
        sanskrit="परियोजनाएँ"
        lede="Every active engagement — internal and client."
        right={
          <div className="wf-acts">
            {canAdminAny && (
              <Button
                variant="ghost"
                size="sm"
                className={showBin ? 'is-active' : ''}
                onClick={() => setShowBin(v => !v)}
              >
                <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                  {TRASH}
                </svg>
                Bin
                {showBin && binProjects.length > 0 && (
                  <span className="prj-bin__n">{binProjects.length}</span>
                )}
              </Button>
            )}
            <Button variant="fill" size="sm" onClick={() => setShowNew(v => !v)}>
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M8 3v10M3 8h10" />
              </svg>
              New project
            </Button>
          </div>
        }
      />

      {showNew && (
        <Card>
          <CardHead title="New project" sanskrit="नई परियोजना" />
          <CardBody>
            <div className="prj-form">
              <Input
                value={name}
                autoFocus
                aria-label="Project name"
                placeholder="Project name…"
                onChange={e => setName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && !showBrandKit && create()}
              />

              <button type="button" className="prj-bk" onClick={() => setShowBrandKit(v => !v)}>
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <path d={showBrandKit ? 'M2 4l4 4 4-4' : 'M4 2l4 4-4 4'} />
                </svg>
                {showBrandKit ? 'Hide' : 'Add'} brand kit — colours &amp; fonts (optional)
              </button>

              {showBrandKit && (
                <div className="prj-bk__panel">
                  <p className="prj-bk__hint">
                    Define this project&rsquo;s brand colours and typefaces. Team members see these
                    as a reference in tasks.
                  </p>
                  <BrandKit mode="edit" value={brandKit} onChange={setBrandKit} />
                </div>
              )}

              <div className="wf-acts">
                <Button variant="fill" loading={creating} disabled={!name.trim()} onClick={create}>
                  Create project
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => {
                    setShowNew(false); setShowBrandKit(false);
                    setBrandKit({ colors: [], fonts: [] });
                  }}
                >
                  Cancel
                </Button>
              </div>
            </div>
          </CardBody>
        </Card>
      )}

      {showBin && canAdminAny && (
        <Card className="prj-bin">
          <CardHead title="Project bin" sanskrit="रद्दी">
            <span className="prj-bin__note">Restorable for {BIN_DAYS} days · auto-purged after</span>
          </CardHead>
          <CardBody flush>
            {binLoading && (
              <div className="prj-bin__row" aria-busy="true" aria-label="Loading bin">
                <div className="prj-bin__main"><span className="prj-bin__name">Loading…</span></div>
              </div>
            )}

            {!binLoading && binErr && <ErrorState kind={binErr} onRetry={loadBin} />}

            {!binLoading && !binErr && binProjects.length === 0 && (
              <div className="prj-bin__row">
                <span className="prj-bin__meta">Bin is empty.</span>
              </div>
            )}

            {!binLoading && !binErr && binProjects.map((p) => {
              const days = Math.round(p.days_deleted || 0);
              const remaining = Math.max(0, BIN_DAYS - days);
              const soon = remaining <= 5;
              // --w and --c are per-row data: how much time is left, and the
              // urgency tone that goes with it.
              const tone = soon ? 'var(--danger)' : remaining <= 10 ? 'var(--warn)' : 'var(--ok)';
              return (
                <div key={p.team_id} className="prj-bin__row">
                  <div className="prj-bin__main">
                    <div className="prj-bin__name">{p.name}</div>
                    <div className="prj-bin__meta">
                      Deleted {days === 0 ? 'today' : `${days}d ago`} by {p.deleted_by_name || 'an admin'}
                      {' · '}
                      <span className={`prj-bin__left${soon ? ' prj-bin__left--soon' : ''}`}>
                        {remaining}d left to restore
                      </span>
                    </div>
                  </div>
                  <div className="prj-bin__meter" aria-hidden="true">
                    <div
                      className="prj-bin__fill"
                      style={{ '--w': `${(remaining / BIN_DAYS) * 100}%`, '--c': tone }}
                    />
                  </div>
                  <Button variant="out" size="sm" onClick={() => restore(p)}>Restore</Button>
                  <Button variant="danger" size="sm" onClick={() => purge(p)}>Delete forever</Button>
                </div>
              );
            })}
          </CardBody>
        </Card>
      )}

      {/* Three states for the grid itself. */}
      {loading && <SkeletonCardGrid count={6} columns={3} lines={3} />}

      {!loading && loadErr && <ErrorState kind={loadErr} onRetry={load} />}

      {!loading && !loadErr && projects.length === 0 && (
        <EmptyState
          illustration="projects"
          title={{ en: 'No projects yet', hi: 'अभी कोई योजना नहीं' }}
          description="Every engagement — internal or client-facing — starts here. Create one to get going."
          action="Create project"
          onAction={() => setShowNew(true)}
        />
      )}

      {!loading && !loadErr && liveProjects.length > 0 && (
        <div className="k-pgrid">
          {liveProjects.map((p, idx) => {
            // Keyed on the project, not its position: index-keyed colour reshuffles
            // every card the moment one project is added or filtered out.
            const color = avatarBg(p.name || p.team_id || String(idx));
            const taskCount = p.task_count || 0;
            const doneCount = p.done_count || 0;
            const openCount = taskCount - doneCount;
            const pct = taskCount > 0 ? Math.round((doneCount / taskCount) * 100) : 0;
            const kicker = p.category || p.name.split(' ').pop().toUpperCase().slice(0, 10);

            return (
              <button
                key={p.team_id}
                className="k-pcard"
                onClick={() => navigate(`/projects/${p.team_id}`)}
              >
                <div className="k-pcard__head">
                  <span className="k-pcard__bar prj-card__bar" style={{ '--c': color }} />
                  <div className="k-pcard__titles">
                    <Secondary className="k-pcard__sans prj-card__kick" style={{ '--c': color }} as="div" value={kicker} />
                    <div className="k-pcard__name">{p.name}</div>
                    <div className="k-pcard__client">{p.workspace_name || 'Internal'}</div>
                  </div>
                  {/* Per PROJECT, not per user: an org admin gets these on every
                      card, a project owner/admin only on their own. */}
                  {p.can_admin && (
                    <>
                      <button
                        type="button"
                        className="k-iconbtn prj-card__del"
                        onClick={e => { e.stopPropagation(); archive(p); }}
                        title={`Archive ${p.name}`}
                        aria-label={`Archive ${p.name}`}
                      >
                        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                          {BOX}
                        </svg>
                      </button>
                      <button
                        type="button"
                        className="k-iconbtn prj-card__del"
                        onClick={e => { e.stopPropagation(); askDelete(p); }}
                        title={`Move ${p.name} to bin`}
                        aria-label={`Move ${p.name} to bin`}
                      >
                        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                          {TRASH}
                        </svg>
                      </button>
                    </>
                  )}
                </div>
                <div className="k-pcard__body">
                  <div className="k-pcard__stat"><b>{taskCount}</b><span>tasks</span></div>
                  <div className="k-pcard__stat"><b>{doneCount}</b><span>done</span></div>
                  <div className="k-pcard__stat"><b>{openCount}</b><span>open</span></div>
                </div>
                <div className="k-pcard__meter">
                  <div className="k-pcard__bar2">
                    <i className="prj-card__fill" style={{ '--w': `${pct}%`, '--c': color }} />
                  </div>
                  <div className="k-pcard__meter-row">
                    <span>{pct}% complete</span>
                    {p.due_at && <DueChip date={p.due_at} />}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* Archived projects. A list, not cards: they are the firm's record
          rather than today's work, and they reuse the bin's row classes so this
          adds no CSS. */}
      {!loading && !loadErr && archivedProjects.length > 0 && (
        <Card className="prj-bin">
          <CardHead title="Archived" sanskrit="संग्रहीत">
            <span className="prj-bin__note">
              Finished engagements · still counted in reports
            </span>
          </CardHead>
          <CardBody>
            {archivedProjects.map(p => (
              <div key={p.team_id} className="prj-bin__row">
                <div className="prj-bin__main">
                  <div className="prj-bin__name">{p.name}</div>
                  <div className="prj-bin__meta">
                    {p.task_count || 0} tasks · {p.done_count || 0} done
                  </div>
                </div>
                <div className="wf-acts">
                  <Button variant="ghost" size="sm"
                          onClick={() => navigate(`/projects/${p.team_id}`)}>
                    Open
                  </Button>
                  {p.can_admin && (
                    <Button variant="out" size="sm" onClick={() => unarchive(p)}>
                      Unarchive
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </CardBody>
        </Card>
      )}

      <ConfirmDialog state={confirmState} onClose={() => setConfirmState(null)} />
    </div>
  );
}
