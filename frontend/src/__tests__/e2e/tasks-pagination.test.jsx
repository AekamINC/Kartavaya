/**
 * The Tasks list pager, mounted for real.
 *
 * Pagination is DOM structure, not geometry, so this suite can prove it where
 * the Playwright geometry spec cannot: jsdom computes no layout, but it renders
 * the same rows, the same group headers and the same controls.
 *
 * The three things worth proving are the three that are easy to get wrong:
 *
 *   1 · a page holds pageSize rows, not pageSize rows PER GROUP. Slicing each
 *       group independently is the obvious implementation and it repeats every
 *       group header on every page.
 *   2 · the group header keeps the group's TOTAL. It answers "how many are
 *       medium priority", which does not change because you turned a page.
 *   3 · changing a filter returns to page 1. Sitting on page 2 of a list that
 *       just shrank to one page renders an empty table under a live pager —
 *       reads as "my search found nothing" and is really "you are on page 2
 *       of 1".
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import TasksListPage from '../../pages/TasksListPage';
import {
  installNetworkKillSwitch, restoreNetwork, installMockApi,
  makeHost, settle, signIn, clearSession,
} from './_harness';

/** 60 tasks, all one priority, so every row lands in a single group. */
const TASKS = Array.from({ length: 60 }, (_, i) => ({
  task_id: `task_${String(i).padStart(3, '0')}`,
  title: `Fixture task ${i}`,
  status: 'todo',
  priority: 'medium',
  team_id: 'team_1',
  assignee_names: [],
  assignee_user_ids: [],
  user_id: 'user_1',
  due_at: null,
  updated_at: '2026-08-01T00:00:00Z',
}));

const TEAMS = [{ team_id: 'team_1', name: 'Fixture Project' }];

let host;

beforeEach(() => {
  installNetworkKillSwitch();
  installMockApi({
    'GET /tasks': TASKS,
    'GET /teams': TEAMS,
    'GET /categories': [],
    'GET /users': [{ user_id: 'user_1', name: 'E2E User' }],
    'POST /tasks/auto-archive': {},
  });
  signIn({ user_id: 'user_1', name: 'E2E User', email: 'e2e@example.com', role: 'org_admin' });
  host = makeHost();
});

afterEach(() => {
  host?.unmount();
  clearSession();
  restoreNetwork();
});

/* `useSkeletonGate` holds the table behind a skeleton for DELAY(120) +
   MIN_VISIBLE(220). `settle()` only flushes microtasks, so without waiting past
   that window every assertion here reads zero rows off a "Loading tasks…"
   screen — which is a green-looking failure, not a red one. */
async function ready() {
  await new Promise(r => setTimeout(r, 420));
  await settle();
}

const rows = () => host.$$('.k-trow');
const pager = () => host.$('.k-pager');
const pos = () => host.$('.k-pager__pos')?.textContent.replace(/\s+/g, ' ').trim();

describe('Tasks list pagination', () => {
  it('shows one page of rows, not the whole list', async () => {
    await host.mount(<TasksListPage />);
    await ready();

    expect(rows().length, '60 tasks should not all render at once').toBe(25);
    expect(pager(), 'pager should be present for 60 rows').not.toBeNull();
    expect(pos()).toBe('1 / 3');
  });

  it('keeps the group header showing the GROUP total, not the page count', async () => {
    await host.mount(<TasksListPage />);
    await ready();

    const count = host.$('.k-group__count');
    // 60, not 25. The header answers a question about the group.
    expect(count?.textContent.trim()).toBe('60');
    // And exactly ONE header — a group is not repeated per page.
    expect(host.$$('.k-group__head').length).toBe(1);
  });

  it('advances to the next page and shows different rows', async () => {
    await host.mount(<TasksListPage />);
    await ready();

    const first = rows().map(r => r.textContent);
    const next = host.control('Next page');

    await host.click(next);
    await settle();

    expect(pos()).toBe('2 / 3');
    const second = rows().map(r => r.textContent);
    expect(second.length).toBe(25);
    expect(second[0], 'page 2 must not repeat page 1').not.toBe(first[0]);
  });

  it('hides the pager when everything fits on one page', async () => {
    installMockApi({
      'GET /tasks': TASKS.slice(0, 5),
      'GET /teams': TEAMS,
      'GET /categories': [],
      'GET /users': [],
      'POST /tasks/auto-archive': {},
    });
    await host.mount(<TasksListPage />);
    await ready();

    expect(rows().length).toBe(5);
    expect(pager(), 'a control that can do nothing should not render').toBeNull();
  });

  it('returns to page 1 when the filter changes', async () => {
    await host.mount(<TasksListPage />);
    await ready();

    await host.click(host.control('Next page'));
    await settle();
    expect(pos()).toBe('2 / 3');

    // Any control that narrows the list. Typing in search is the one a user
    // reaches for while deep in a long list, which is when this bug bites.
    const search = host.$('input[type="search"], input[placeholder*="Search" i]');
    expect(search, 'search input not found — update this selector').not.toBeNull();
    await host.fill(search, 'task 1');
    await settle();

    const p = pos();
    // Either the pager is gone (one page of matches) or we are back at page 1.
    expect(p === undefined || p.startsWith('1 /'), `expected page 1, got ${p}`).toBe(true);
  });
});
