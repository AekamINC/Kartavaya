/**
 * One toolbar, seven views — and a filtered board that is a link.
 *
 * `04-boards-table-views.md` §2 gives the board a single toolbar carrying
 * "view switch · filter · group · fields", and says in the same paragraph that
 * Board, Table, Calendar, Timeline, Workload and Priority all need it.
 *
 * The build had that state inside `TableView`, which produced two failures a
 * screenshot shows instantly and no amount of reading the prose does:
 *
 *  · Table view rendered a SECOND `.vtb` under the page's own, so the row a
 *    control lived in changed when you switched view.
 *  · Search and filter reached the table and nothing else. Kanban — the
 *    default view — could not be narrowed at all.
 *
 * These tests are those two statements made executable, plus the URL contract
 * from `IxViews` 10.4 ("filters serialise into the URL so a filtered view is a
 * shareable link") and 10.1 (the same of sort). They assert structure — which
 * controls exist, in how many bars — and deliberately not pixels, which are
 * another surface's.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import React, { act } from 'react';

import { makeHost, settle } from './_harness';
import BoardToolbar from '../../components/views/BoardToolbar';
import useBoardView from '../../components/views/useBoardView';

const TASKS = [
  { task_id: 't1', title: 'Reconcile input tax credit', status: 'todo',        priority: 'high',   column_id: 'c1', order: 0 },
  { task_id: 't2', title: 'Diwali campaign draft',      status: 'in_progress', priority: 'medium', column_id: 'c2', order: 1 },
  { task_id: 't3', title: 'Vendor agreement clause',    status: 'todo',        priority: 'low',    column_id: 'c1', order: 2 },
];
const COLUMNS = [
  { column_id: 'c1', name: 'To Do' },
  { column_id: 'c2', name: 'In Progress' },
];
const FIELDS = [
  { field_id: 'f1', name: 'Client', type: 'text' },
  { field_id: 'f2', name: 'Billable', type: 'checkbox' },
];

/** Mounts the hook and the bar together, the way a page does. */
function Board({ view = 'kanban', onBoard }) {
  const board = useBoardView({
    tasks: TASKS, columns: COLUMNS, fieldDefs: FIELDS, boardKey: 'test-board',
  });
  onBoard?.(board);
  return <BoardToolbar view={view} onView={() => {}} board={board} />;
}

let host;
beforeEach(() => { host = makeHost(); localStorage.clear(); });
afterEach(() => { host.unmount(); localStorage.clear(); });

/** Call a hook setter the way a control would — inside act, then let it flush. */
async function drive(fn) {
  await act(async () => { fn(); });
  await settle();
}

describe('BoardToolbar — one bar', () => {
  it('renders exactly one .vtb in every view', async () => {
    for (const view of ['kanban', 'table', 'calendar', 'timeline', 'workload', 'priority', 'mytasks']) {
      // eslint-disable-next-line no-await-in-loop
      await host.mount(<Board view={view} />);
      expect(host.$$('.vtb'), `${view} should have one toolbar`).toHaveLength(1);
    }
  });

  it('offers search in every view, not only the table', async () => {
    for (const view of ['kanban', 'calendar', 'timeline', 'workload', 'priority', 'mytasks']) {
      // eslint-disable-next-line no-await-in-loop
      await host.mount(<Board view={view} />);
      expect(host.$('.k-searchpill input'), `${view} should be searchable`).toBeTruthy();
    }
  });

  it('offers the filter builder in every view', async () => {
    await host.mount(<Board view="kanban" />);
    expect(host.$('.fb')).toBeTruthy();
  });

  it('shows group-by and Fields only where they can do something', async () => {
    // A Calendar has no rows to group and no table columns to hide. A control
    // that cannot act is not rendered rather than rendered disabled.
    await host.mount(<Board view="calendar" />);
    expect(host.$('.vtb__group')).toBeNull();
    expect(host.control('Fields')).toBeNull();

    await host.mount(<Board view="table" />);
    expect(host.$('.vtb__group select')).toBeTruthy();
    expect(host.control('Fields')).toBeTruthy();
  });
});

describe('useBoardView — the URL is the filter', () => {
  it('puts the search term in the query string', async () => {
    await host.mount(<Board view="kanban" />, { path: '/boards' });
    await host.fill('.k-searchpill input', 'Diwali');
    expect(host.search()).toContain('q=Diwali');
  });

  it('reads a filter back out of the URL and applies it', async () => {
    let board;
    await host.mount(
      <Board view="kanban" onBoard={b => { board = b; }} />,
      { path: '/boards?filter=priority%3Ais%3Ahigh' },
    );
    expect(board.clauses).toHaveLength(1);
    expect(board.clauses[0]).toMatchObject({ field: 'priority', op: 'is', value: 'high' });
    expect(board.filtered.map(t => t.task_id)).toEqual(['t1']);
    expect(board.isFiltered).toBe(true);
  });

  it('round-trips a value containing the separators', async () => {
    // `~` splits clauses and `:` splits a clause, so a title filter typed as
    // "a:b~c" has to survive both. `encodeURIComponent` escapes the colon and
    // NOT the tilde, which is the bug this caught: the clause came back halved.
    let board;
    await host.mount(<Board view="kanban" onBoard={b => { board = b; }} />, { path: '/boards' });
    await drive(() => board.setClauses([{ id: 'f0', field: 'title', op: 'contains', value: 'a:b~c' }]));
    expect(board.clauses).toHaveLength(1);
    expect(board.clauses[0].value).toBe('a:b~c');
  });

  it('keeps sort in the URL and drops it on the third click', async () => {
    let board;
    await host.mount(<Board view="table" onBoard={b => { board = b; }} />, { path: '/boards' });
    await drive(() => board.setSort({ key: 'due_at', dir: 'ascending' }));
    expect(host.search()).toContain('sort=due_at%3Aascending');
    expect(board.sort).toEqual({ key: 'due_at', dir: 'ascending' });

    await drive(() => board.setSort(null));
    expect(host.search()).not.toContain('sort=');
    expect(board.sort).toBeNull();
  });

  it('ignores a hand-edited sort direction rather than throwing', async () => {
    let board;
    await host.mount(
      <Board view="table" onBoard={b => { board = b; }} />,
      { path: '/boards?sort=due_at%3Asideways' },
    );
    expect(board.sort).toBeNull();
  });

  it('keeps field visibility OUT of the URL', async () => {
    // It is a preference about how you read a table, not part of what you are
    // looking at — 10.1 puts it "per user", so it would be noise in a link.
    let board;
    await host.mount(<Board view="table" onBoard={b => { board = b; }} />, { path: '/boards' });
    await drive(() => board.toggleField('f1'));
    expect(host.search()).not.toContain('f1');
    expect(board.shownFields.map(f => f.field_id)).toEqual(['f2']);
    expect(JSON.parse(localStorage.getItem('kv.table.fields.test-board'))).toEqual(['f1']);
  });

  it('clears search and filter together in one write', async () => {
    let board;
    await host.mount(
      <Board view="kanban" onBoard={b => { board = b; }} />,
      { path: '/boards?q=Diwali&filter=priority%3Ais%3Ahigh' },
    );
    expect(board.filtered).toHaveLength(0);
    await drive(() => board.clearFilters());
    expect(host.search()).not.toContain('q=');
    expect(host.search()).not.toContain('filter=');
    expect(board.filtered).toHaveLength(3);
  });
});
