/**
 * WorkList — how work reads in the portal.
 *
 * Not a board. 19: "No kanban, no assignees, no internal status vocabulary."
 * The kanban that used to render here came from `KanbanView`, which draws an
 * assignee stack on every card and drags between the firm's own columns — two
 * of the things on the never-see list, on the one screen a stranger uses.
 *
 * `StatusChip` is not used either, for the same reason: it renders the six
 * internal states by name ("In Review", "Awaiting Approval"). The three-state
 * mapping lives in `clientShape.js`, next to the field filter, so the two
 * cannot drift apart.
 */
import React from 'react';
import { relTime } from '../../lib/utils';
import { expectedLabel, STATE_CLASS, STATE_LABEL } from './clientShape';

export function StateChip({ state }) {
  return (
    <span className={STATE_CLASS[state] || 'cl-state'}>
      <span className="cl-state__dot" />
      {STATE_LABEL[state] || state}
    </span>
  );
}

export function WorkItem({ task }) {
  const expected = expectedLabel(task.expectedAt);
  return (
    <li className="cl-item">
      <div className="cl-item__b">
        <div className="cl-item__t">{task.title}</div>
        <div className="cl-item__m">
          <span className="cl-item__id">{task.ref}</span>
          {expected && <><span className="cl-item__sep">·</span><span>Expected {expected}</span></>}
          {task.updatedAt && <><span className="cl-item__sep">·</span><span>Updated {relTime(task.updatedAt)}</span></>}
        </div>
      </div>
      <StateChip state={task.state} />
    </li>
  );
}

export default function WorkList({ tasks, label }) {
  if (!tasks.length) return null;
  return (
    <ul className="cl-list" aria-label={label}>
      {tasks.map(t => <WorkItem key={t.taskId} task={t} />)}
    </ul>
  );
}
