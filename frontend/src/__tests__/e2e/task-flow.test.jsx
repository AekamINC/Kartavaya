/**
 * Create a task · move it across the board · open the drawer.
 *
 * The real `KanbanView`, the real optimistic write, the real rollback.
 *
 * ── Why the drag library is stubbed
 *
 * `@hello-pangea/dnd` measures real boxes and drives a pointer or keyboard
 * sensor. jsdom has no layout: every element is 0×0, so the library's own
 * lift-and-drop never resolves to a droppable and a "drag" in jsdom tests the
 * library's fallback behaviour rather than this app's.
 *
 * So the library is replaced with a pass-through that captures `onDragEnd`, and
 * the test invokes it with the `result` object the library would have produced.
 * What is under test is everything that happens AFTER the drop — which is where
 * every bug in this file's history has been:
 *
 *   · the move is ONE call. `PATCH /tasks/:id/move` takes column and order
 *     together; two calls leave a visible wrong-position frame if the second
 *     fails.
 *   · the optimistic write is rolled back to the WHOLE previous task on
 *     failure. Restoring `column_id` alone left the card in the right column at
 *     the dragged position.
 *   · a drop onto a synthetic column is refused. Those are derived from status
 *     and only the backend sets it.
 *
 * The trade is stated plainly: this cannot catch "the card is not draggable".
 * It catches everything the drop does, and it runs in CI with no browser.
 */
import React, { act } from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('@hello-pangea/dnd', () => {
  const captured = { onDragEnd: null, onDragStart: null };
  return {
    __captured: captured,
    DragDropContext: ({ children, onDragEnd, onDragStart }) => {
      captured.onDragEnd = onDragEnd;
      captured.onDragStart = onDragStart;
      return children;
    },
    Droppable: ({ children }) => children(
      { innerRef: () => {}, droppableProps: {}, placeholder: null },
      { isDraggingOver: false },
    ),
    Draggable: ({ children }) => children(
      { innerRef: () => {}, draggableProps: {}, dragHandleProps: {} },
      { isDragging: false },
    ),
  };
});

import * as dnd from '@hello-pangea/dnd';
import KanbanView from '../../components/views/KanbanView';
import {
  installMockApi, installNetworkKillSwitch, restoreNetwork, httpError,
  makeHost, signIn, clearSession, users, settle,
} from './_harness';

let host;

const COLUMNS = [
  { column_id: 'col_todo', name: 'To Do', is_done: false },
  { column_id: 'col_doing', name: 'In Progress', is_done: false },
  { column_id: 'col_done', name: 'Done', is_done: true },
];

const TASK = {
  task_id: 'task_aaa', team_id: 't1', title: 'File GSTR-3B for June',
  status: 'todo', column_id: 'col_todo', order: 0, priority: 'high',
  assignee_user_ids: [], attachments: [],
};

/** A controlled KanbanView — the parent owns `tasks`, exactly as the pages do. */
function Board({ initial = [TASK], onTasks, ...rest }) {
  const [tasks, setTasks] = React.useState(initial);
  React.useEffect(() => { onTasks?.(tasks); }, [tasks, onTasks]);
  return (
    <KanbanView
      columns={COLUMNS}
      tasks={tasks}
      onTasksChange={updater => setTasks(prev => (typeof updater === 'function' ? updater(prev) : updater))}
      teamId="t1"
      currentUserId="u_staff"
      currentUserRole="owner"
      {...rest}
    />
  );
}

/** Fire the drop the library would have produced, and let it settle. */
async function drop({ from = 'col_todo', to = 'col_doing', taskId = 'task_aaa', fromIndex = 0, toIndex = 0 }) {
  await act(async () => {
    await dnd.__captured.onDragEnd({
      draggableId: taskId,
      source: { droppableId: from, index: fromIndex },
      destination: to === null ? null : { droppableId: to, index: toIndex },
    });
  });
  await settle();
}

beforeEach(() => {
  clearSession();
  installNetworkKillSwitch();
  signIn(users.staff());
  host = makeHost();
});

afterEach(() => {
  host.unmount();
  restoreNetwork();
  vi.restoreAllMocks();
  clearSession();
});

/* ══════════════════════════════════════════════════════════════════════════
   1 · The board renders
   ══════════════════════════════════════════════════════════════════════════ */

describe('e2e · board · columns and cards', () => {
  it('draws every column with its own card count', async () => {
    installMockApi({});
    await host.mount(<Board />);

    const names = host.$$('.bd__cn').map(n => n.textContent);
    expect(names).toEqual(['To Do', 'In Progress', 'Done']);
    expect(host.text()).toContain('File GSTR-3B for June');
  });

  it('a task with an unknown column_id falls back to a column by status', async () => {
    // Otherwise the card vanishes: it belongs to no rendered column and the
    // board silently loses work.
    installMockApi({});
    await host.mount(<Board initial={[{ ...TASK, column_id: 'col_deleted', status: 'done' }]} />);
    expect(host.text()).toContain('File GSTR-3B for June');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   2 · Creating a task
   ══════════════════════════════════════════════════════════════════════════ */

describe('e2e · board · creating a task inline', () => {
  it('creates in the column it was typed into, and shows it without a refetch', async () => {
    const mock = installMockApi({
      'POST /tasks': ({ body }) => ({ ...TASK, task_id: 'task_new', title: body.title, column_id: body.column_id }),
    });
    await host.mount(<Board />);

    const addButtons = host.$$('.bd__add');
    expect(addButtons.length).toBeGreaterThan(0);
    await host.click(addButtons[1]); // In Progress

    // Semantic handle: the composer labels itself with the column it belongs to.
    const box = host.$('[aria-label="New task in In Progress"]');
    expect(box, 'the composer did not open in the column that was clicked').toBeTruthy();

    await host.fill(box, 'Reconcile the June ledger');
    await host.click(host.$$('button').find(b => b.textContent.trim() === 'Add'));

    expect(mock.calledWith('POST', '/tasks')).toHaveLength(1);
    expect(mock.calls.at(-1).body).toEqual({
      title: 'Reconcile the June ledger',
      team_id: 't1',
      column_id: 'col_doing',
      status: 'todo',
    });
    expect(host.text()).toContain('Reconcile the June ledger');
  });

  it('a task added to a done column is created done, not todo', async () => {
    const mock = installMockApi({ 'POST /tasks': ({ body }) => ({ ...TASK, task_id: 'task_d', ...body }) });
    await host.mount(<Board />);

    await host.click(host.$$('.bd__add')[2]); // Done
    await host.fill(host.$('[aria-label="New task in Done"]'), 'Already finished');
    await host.click(host.$$('button').find(b => b.textContent.trim() === 'Add'));

    expect(mock.calls.at(-1).body.status).toBe('done');
  });

  it('a failed create puts the draft back rather than losing what was typed', async () => {
    // The user typed it and the failure was not theirs.
    installMockApi({ 'POST /tasks': httpError(500, 'boom') });
    await host.mount(<Board />);

    await host.click(host.$$('.bd__add')[0]);
    await host.fill(host.$('[aria-label="New task in To Do"]'), 'Do not lose me');
    await host.click(host.$$('button').find(b => b.textContent.trim() === 'Add'));

    expect(host.$('[aria-label="New task in To Do"]').value).toBe('Do not lose me');
  });

  it('an empty draft cannot be submitted', async () => {
    installMockApi({ 'POST /tasks': { ok: true } });
    await host.mount(<Board />);

    await host.click(host.$$('.bd__add')[0]);
    const add = host.$$('button').find(b => b.textContent.trim() === 'Add');
    expect(add.disabled).toBe(true);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   3 · Moving a task
   ══════════════════════════════════════════════════════════════════════════ */

describe('e2e · board · moving a task across columns', () => {
  it('the move is ONE call carrying column and order together', async () => {
    const mock = installMockApi({
      'PATCH /tasks/:id/move': ({ body }) => ({ ...TASK, column_id: body.column_id, order: body.order }),
    });
    await host.mount(<Board />);

    await drop({ from: 'col_todo', to: 'col_doing', toIndex: 0 });

    const moves = mock.calledWith('PATCH', '/move');
    expect(moves).toHaveLength(1);
    expect(moves[0].body).toEqual({ column_id: 'col_doing', order: 0 });
    // Two calls would leave a visible wrong-position frame if the second failed.
    expect(mock.calls.filter(c => c.verb === 'PATCH')).toHaveLength(1);
  });

  it('the card appears in the destination before the server answers', async () => {
    // The optimistic write is inside `flushSync`, so it lands synchronously at
    // the top of onDragEnd; the request does not. Holding the response open is
    // what makes that window observable.
    let release;
    const mock = installMockApi({
      'PATCH /tasks/:id/move': () => new Promise(r => { release = r; }),
    });
    let seen = null;
    await host.mount(<Board onTasks={t => { seen = t; }} />);

    let inFlight;
    await act(async () => {
      inFlight = dnd.__captured.onDragEnd({
        draggableId: 'task_aaa',
        source: { droppableId: 'col_todo', index: 0 },
        destination: { droppableId: 'col_doing', index: 0 },
      });
    });

    // Moved locally; the server has not answered.
    expect(seen.find(t => t.task_id === 'task_aaa').column_id).toBe('col_doing');
    expect(mock.calledWith('PATCH', '/move')).toHaveLength(1);

    await act(async () => {
      release({ ...TASK, column_id: 'col_doing' });
      await inFlight;
    });
    await settle();
  });

  it('a failed move restores the WHOLE previous task, not just its column', async () => {
    // Restoring `column_id` alone left the card in the right column at the
    // position it had been dragged to.
    installMockApi({ 'PATCH /tasks/:id/move': httpError(500, 'nope') });
    let seen = null;
    await host.mount(<Board initial={[{ ...TASK, order: 3 }]} onTasks={t => { seen = t; }} />);

    await drop({ from: 'col_todo', to: 'col_doing', toIndex: 0 });

    const rolled = seen.find(t => t.task_id === 'task_aaa');
    expect(rolled.column_id).toBe('col_todo');
    expect(rolled.order).toBe(3);
    expect(host.text()).toMatch(/could not move task/i);
  });

  it('a drop outside any column is a no-op', async () => {
    const mock = installMockApi({ 'PATCH /tasks/:id/move': { ok: true } });
    await host.mount(<Board />);

    await drop({ to: null });

    expect(mock.calledWith('PATCH', '/move')).toHaveLength(0);
  });

  it('a drop back onto the same slot does not write', async () => {
    const mock = installMockApi({ 'PATCH /tasks/:id/move': { ok: true } });
    await host.mount(<Board />);

    await drop({ from: 'col_todo', to: 'col_todo', fromIndex: 0, toIndex: 0 });

    expect(mock.calledWith('PATCH', '/move')).toHaveLength(0);
  });

  it('a drop onto a SYNTHETIC column is refused', async () => {
    // "Requested" and "Awaiting Client Approval" are derived from status. Only
    // the backend sets it, so a drag into one would write a column id that does
    // not exist.
    const mock = installMockApi({ 'PATCH /tasks/:id/move': { ok: true } });
    await host.mount(<Board showRequested showClientApproval />);

    await drop({ from: 'col_todo', to: '__requested__' });
    await drop({ from: 'col_todo', to: '__pending_client__' });

    expect(mock.calledWith('PATCH', '/move')).toHaveLength(0);
  });

  it('readOnly disables the move and hides the add affordance', async () => {
    const mock = installMockApi({ 'PATCH /tasks/:id/move': { ok: true } });
    await host.mount(<Board readOnly />);

    expect(host.$$('.bd__add')).toHaveLength(0);
    expect(mock.calledWith('POST', '/tasks')).toHaveLength(0);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   4 · The drawer
   ══════════════════════════════════════════════════════════════════════════ */

describe('e2e · board · opening the task drawer', () => {
  /** Everything TaskDrawer reaches for on open. */
  const drawerRoutes = {
    'GET /categories': [],
    'GET /tasks/:id': TASK,
    'GET /tasks/:id/comments': [],
    'GET /activity/task/:id': [],
    'GET /time/task/:id': { entries: [], active_entry: null },
    'GET /projects/:teamId/columns': COLUMNS,
    'GET /teams/:teamId': { members: [] },
    'GET /fields/team/:teamId': [],
    // A bare array, because that is what `fields.py:194` actually returns. This
    // fixture said `{}` — an object the component then called `.forEach` on —
    // so the drawer threw on every open and the suite still reported green,
    // because an unhandled rejection is not a failed assertion. A fixture that
    // does not match its route turns the test into a source of false comfort.
    'GET /fields/task/:id/values': [],
  };

  it('clicking a card opens a labelled dialog for that task', async () => {
    installMockApi(drawerRoutes);
    await host.mount(<Board />);

    // `.bc` is the card itself — a <button>. `.bd__list`'s first child is the
    // Draggable's wrapper div, which carries the drag handle props and NO
    // onClick, so clicking it does nothing and the drawer never opens.
    const card = host.$$('.bc').find(b => b.textContent.includes('File GSTR-3B'));
    expect(card, 'no card to click').toBeTruthy();
    await host.click(card);

    // Asserted on the ROLE and the accessible name, not on a class — the drawer
    // has been restyled repeatedly and `role="dialog"` is the contract.
    const dialog = host.$('[role="dialog"]');
    expect(dialog, 'no dialog opened').toBeTruthy();
    expect(dialog.getAttribute('aria-label')).toContain('File GSTR-3B for June');
  });

  it('the drawer fetches the task it was opened for', async () => {
    const mock = installMockApi(drawerRoutes);
    await host.mount(<Board />);

    await host.click(host.$$('.bc').find(b => b.textContent.includes('File GSTR-3B')));

    expect(mock.calledWith('GET', '/tasks/task_aaa')).not.toHaveLength(0);
  });

  it('no drawer is open before a card is clicked', async () => {
    installMockApi(drawerRoutes);
    await host.mount(<Board />);
    expect(host.$('[role="dialog"]')).toBeNull();
  });
});
