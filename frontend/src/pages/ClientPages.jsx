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
 * ── Why the three views share one route
 *
 * 19 asks for `/client/approvals` and `/client/files` under a `ClientShell`
 * route outside `AppShell`. Adding routes means editing `App.jsx`, which is
 * outside this change's ownership, so the view is carried in the query string —
 * `/client?view=approvals` — which is bookmarkable, back-button-correct, and
 * needs no route table change. The proper route move is in the report.
 */
import React from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ErrorState } from '../components/ui';
import ClientShell from './client/ClientShell';
import ClientHome from './client/ClientHome';
import ClientApprovals from './client/ClientApprovals';
import ClientFiles from './client/ClientFiles';
import ClientProject from './client/ClientProject';
import useClientPortal from './client/useClientPortal';

const VIEWS = ['overview', 'approvals', 'files'];

function Loading() {
  return <p className="cl-load">Loading…</p>;
}

export function ClientProjectsPage() {
  const [params] = useSearchParams();
  const raw = params.get('view');
  const view = VIEWS.includes(raw) ? raw : 'overview';

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
          backTo={() => navigate('/client?view=overview')}
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
