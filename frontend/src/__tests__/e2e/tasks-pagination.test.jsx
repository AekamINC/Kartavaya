/**
 * The Tasks list pager, mounted for real.
 *
 * Pagination is DOM structure, not geometry, so this suite can prove it where
 * the Playwright geometry spec cannot: jsdom computes no layout, but it renders
 * the same rows and the same controls.
 *
 * The three things worth proving are the three that are easy to get wrong:
 *
 *   1 · a page holds pageSize rows, and the pager reports how many pages that
 *       makes — 25 of 60, not 60 of 60.
 *   2 · the count beside the pager keeps the LIST's total. It answers "how many
 *       tasks are there", which does not change because you turned a page.
 *       (It used to be the group band's count; grouping was removed on
 *       2026-08-25 and the question moved to the pager.)
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

  it('counts the WHOLE list, not the page, and draws no group band', async () => {
    await host.mount(<TasksListPage />);
    await ready();

    /* This replaces a guard on `.k-group__count` — the grouped band was taken
       out of this list on 2026-08-25 (702d315b, "render flat table"), so the
       old assertion read `undefined` off an element that can no longer exist
       and the suite failed on a feature that was deliberately removed.

       What it was really protecting survives the removal: the count beside the
       pager answers "how many tasks are there", which does not change because
       you turned a page. 60, not 25. */
    const count = host.$('.k-pager__count');
    expect(count?.textContent.replace(/\s+/g, ' ').trim()).toBe('1–25 of 60');

    // And the band is gone for good, not hidden — a stray header would mean
    // the grouped code path came back with the CSS deleted from under it.
    expect(host.$$('.k-group__head').length).toBe(0);
    expect(host.$$('.k-group').length).toBe(0);
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
