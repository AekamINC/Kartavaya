/**
 * ClientProject — one project, from outside the firm.
 *
 * This replaces the kanban that used to render at `/client/project/:projectId`.
 * The old page fetched `GET /teams/{id}`, `GET /projects/{id}/columns` and
 * `GET /tasks?team_id={id}` and handed all three to `KanbanView`. Each of those
 * three calls crosses the boundary 19 draws:
 *
 *   · `GET /teams/{id}` returns `members` — the firm's staff list, which the
 *     old page passed straight into `KanbanView` as `teamMembers`.
 *   · `GET /tasks?team_id=` returns every task in the project, with
 *     `assignee_names` and `assignee_emails` on each (server.py:1699, 1713).
 *     A client saw the whole team's workload.
 *   · `KanbanView` draws the firm's own column names — the internal status
 *     vocabulary 19 maps away — and lets a row be dragged between them.
 *
 * None of it is fetched here. This view reads the same shaped list the rest of
 * the portal reads, filtered to one project.
 */
import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, EmptyState } from '../../components/ui';
import WorkList from './WorkList';
import RequestWork from './RequestWork';
import { DONE, WITH_US, WITH_YOU } from './clientShape';

export default function ClientProject({ projectId, projectName, tasks, projects, onChanged }) {
  const [asking, setAsking] = useState(false);

  const mine = tasks.filter(t => t.projectId === projectId);
  const open = mine.filter(t => t.state === WITH_US || t.state === WITH_YOU);
  const done = mine.filter(t => t.state === DONE);
  const here = projects.filter(p => p.projectId === projectId);

  return (
    <>
      <section className="cl-sec">
        <header className="cl-sec__h">
          <h2 className="cl-sec__t">{projectName || 'Project'}</h2>
          {open.length > 0 && <span className="cl-sec__n">{open.length} open</span>}
          <span className="cl-sec__act">
            <Button variant="out" size="sm" onClick={() => setAsking(true)}>Request work</Button>
            <Link className="cl-file__dl" to="/client">All work</Link>
          </span>
        </header>

        {open.length === 0 ? (
          <EmptyState
            illustration="tasks"
            title={{ en: 'Nothing open here', hi: 'यहाँ कुछ लंबित नहीं' }}
            description="Work on this project shows up here as your team moves it."
            action="Request work"
            onAction={() => setAsking(true)}
          />
        ) : (
          <WorkList tasks={open} label={`Work in ${projectName || 'this project'}`} />
        )}
      </section>

      {done.length > 0 && (
        <details className="cl-done">
          <summary>{done.length === 1 ? '1 finished item' : `${done.length} finished items`}</summary>
          <div className="cl-done__b">
            <WorkList tasks={done} label="Finished work" />
          </div>
        </details>
      )}

      <RequestWork
        open={asking}
        // Scoped to this project when the client is assigned to it, so the
        // picker cannot offer a project they arrived from somewhere else.
        projects={here.length ? here : projects}
        onClose={() => setAsking(false)}
        onCreated={() => { setAsking(false); onChanged?.(); }}
      />
    </>
  );
}
