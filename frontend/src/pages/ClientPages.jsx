/**
 * ClientPages.jsx — the two route entries for the client portal.
 *
 * Implements `design-handover/19-client-portal.md`. The screens live in
 * `pages/client/`; this file is the composition root and nothing else.
 *
 * ── What 19 says about this file, and what is true on the branch
 *
 * 19 opens with a file list that no longer describes staging. Checked, one by
 * one:
 *
 *   · "`ClientPagesImpl.jsx` — the real implementation; restyle onto tokens"
 *     — **stale.** Deleted. It exported the same three names as this file and
 *     was imported by nothing; 36 KB that never reached a bundle.
 *   · "Retire `/client/legacy`" — **already done.** `App.jsx:213` is
 *     `<Route path="/client/legacy" element={<Navigate to="/client" replace />} />`,
 *     so an emailed link still lands somewhere. The dark portal is gone with
 *     the file that held it, and with it the fourth token vocabulary.
 *   · "Delete `ClientPortalPage.jsx` — `pages/README.md` marks it unused"
 *     — **stale.** No such file exists.
 *   · "`ClientPages.jsx` — a re-export barrel over `ClientPagesImpl.jsx`, keep
 *     only if the lazy split needs it" — **backwards.** This file is the
 *     implementation; `ClientProjectsPage.jsx` and `ClientBoardPage.jsx`
 *     re-export FROM it, which is what the lazy split needs.
 *   · "The two POSTs are new" — **stale.** `approvals_router.py` already has
 *     both, at `/tasks/{id}/client-approve` and `/tasks/{id}/client-reject`,
 *     with the required-note rule enforced server-side.
 *
 * ── How the three views are routed
 *
 * 19 asks for `/client/approvals` and `/client/files` under a `ClientShell`
 * route outside `AppShell`. Those two routes do not exist on this branch —
 * `App.jsx:188-190` declares `client`, `client/projects` and
 * `client/project/:projectId` and nothing else, all three INSIDE `AppShell`, so
 * two of the three built views were unreachable and a client saw the staff
 * sidebar around the third. `App.jsx` is owned elsewhere and the routes are
 * being added there; this file is built for that target.
 *
 * `viewFromLocation` resolves the view from the PATHNAME, and falls back to
 * `?view=` when the path carries none. Both forms work, which is what lets the
 * route move land in either order: before it, `/client?view=files` still
 * renders Files; after it, `/client/files` does, and every link already sent to
 * a client in an email keeps resolving.
 */
import React from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { ErrorState } from '../components/ui';
import ClientShell from './client/ClientShell';
import ClientHome from './client/ClientHome';
import ClientApprovals from './client/ClientApprovals';
import ClientFiles from './client/ClientFiles';
import ClientProject from './client/ClientProject';
import useClientPortal from './client/useClientPortal';

const VIEWS = ['overview', 'approvals', 'files'];

/**
 * Path first, query second, `overview` last.
 *
 * The trailing segment is read rather than the whole path so the resolution is
 * the same whether `App.jsx` mounts these absolutely (`/client/approvals`) or
 * as children of a `/client` parent (`approvals`).
 */
export function viewFromLocation(pathname = '', search = '') {
  const last = String(pathname).replace(/\/+$/, '').split('/').pop();
  if (VIEWS.includes(last)) return last;
  const q = new URLSearchParams(search).get('view');
  return VIEWS.includes(q) ? q : 'overview';
}

function Loading() {
  return <p className="cl-load">Loading…</p>;
}

export function ClientProjectsPage() {
  const { pathname, search } = useLocation();
  const view = viewFromLocation(pathname, search);

  const { me, firm, tasks, approvals, projects, loading, failure, reload } = useClientPortal();

  return (
    <ClientShell
      firm={firm}
      view={view}
      approvalCount={approvals.length}
      clientName={me?.full_name || me?.name || me?.email}
    >
      {loading && <Loading />}

      {!loading && failure && (
        <ErrorState kind={failure} onRetry={reload} />
      )}

      {!loading && !failure && view === 'overview' && (
        <ClientHome
          tasks={tasks}
          projects={projects}
          approvalCount={approvals.length}
          onChanged={reload}
        />
      )}

      {!loading && !failure && view === 'approvals' && (
        <ClientApprovals approvals={approvals} tasks={tasks} onDecided={reload} />
      )}

      {!loading && !failure && view === 'files' && (
        <ClientFiles tasks={tasks} />
      )}
    </ClientShell>
  );
}

export function ClientProjectBoardPage() {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const { me, firm, tasks, approvals, projects, loading, failure, reload } = useClientPortal();

  const project = projects.find(p => p.projectId === projectId);

  return (
    <ClientShell
      firm={firm}
      view="overview"
      approvalCount={approvals.length}
      projectName={project?.name}
      clientName={me?.full_name || me?.name || me?.email}
    >
      {loading && <Loading />}

      {!loading && failure && (
        <ErrorState kind={failure} onRetry={reload} />
      )}

      {/* A project the client is not on is `missing`, not `denied` — 02's error
          table, and the rule under it: a denial must name the missing grant and
          never confirm that a record exists to someone who should not know it.
          `backTo` is ErrorState's click handler, not a path. */}
      {!loading && !failure && !project && (
        <ErrorState
          kind="missing"
          backTo={() => navigate('/client')}
          backLabel="Back to your work"
        />
      )}

      {!loading && !failure && project && (
        <ClientProject
          projectId={projectId}
          projectName={project.name}
          tasks={tasks}
          projects={projects}
          onChanged={reload}
        />
      )}
    </ClientShell>
  );
}
