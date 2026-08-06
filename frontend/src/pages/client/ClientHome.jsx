/**
 * ClientHome — Overview.
 *
 * Three things, in this order (19-client-portal.md · Overview):
 *   1. what needs you   — a count, linking to Approvals
 *   2. what is in progress — title, status, expected date
 *   3. what is done     — collapsed by default
 *
 * No kanban, no assignees, no internal status vocabulary. The six statuses are
 * mapped to three in `clientShape.js`; nothing here re-derives them.
 *
 * The "Request work" action is new to this surface and deliberate: the `client`
 * project role is no longer read-only. It is a collaborator — clients
 * contribute, and there are flows where a client's sign-off is the approval
 * gate (`PROPOSED_066_tier3_tier4_roles.sql`, comment on
 * `public.team_members.role`). Two prohibitions survive that change and are
 * absolute: a client never logs time and never deletes. Neither appears
 * anywhere in this directory.
 */
import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, EmptyState } from '../../components/ui';
import WorkList from './WorkList';
import RequestWork from './RequestWork';
import { DONE, WITH_US, WITH_YOU } from './clientShape';
import { Secondary } from '../../components/Bilingual';

export default function ClientHome({ tasks, projects, approvalCount, onChanged }) {
  const [asking, setAsking] = useState(false);

  const open = tasks.filter(t => t.state === WITH_US || t.state === WITH_YOU);
  const done = tasks.filter(t => t.state === DONE);

  return (
    <>
      {approvalCount > 0 && (
        <Link className="cl-lead" to="/client/approvals">
          <span className="cl-lead__n">{approvalCount}</span>
          <span>
            <span className="cl-lead__t">
              {approvalCount === 1 ? 'One thing needs your approval' : `${approvalCount} things need your approval`}
            </span>
            <span className="cl-lead__d">Read it, then approve or ask for changes.</span>
          </span>
          <span className="cl-lead__go" aria-hidden="true">→</span>
        </Link>
      )}

      <section className="cl-sec">
        <header className="cl-sec__h">
          <h2 className="cl-sec__t">In progress</h2>
          <Secondary className="cl-sec__hi" value="प्रगति में" />
          {open.length > 0 && <span className="cl-sec__n">{open.length}</span>}
          <span className="cl-sec__act">
            <Button variant="out" size="sm" onClick={() => setAsking(true)}>Request work</Button>
          </span>
        </header>

        {open.length === 0 ? (
          <EmptyState
            illustration="tasks"
            title={{ en: 'Nothing in progress', hi: 'कुछ भी प्रगति में नहीं' }}
            description="Work your team is doing for you shows up here as it moves."
            action="Request work"
            onAction={() => setAsking(true)}
          />
        ) : (
          <WorkList tasks={open} label="Work in progress" />
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
        projects={projects}
        onClose={() => setAsking(false)}
        onCreated={() => { setAsking(false); onChanged?.(); }}
      />
    </>
  );
}
