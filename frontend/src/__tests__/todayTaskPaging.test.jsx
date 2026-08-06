/**
 * The Today dashboard's numbers, against a task list the server truncates.
 *
 * `GET /api/tasks` (`server.py::list_tasks`) is `limit:Optional[int]=500` and
 * then `_lim = min(limit if limit is not None else 500, 500)`. There is no
 * "give me all of them" value: 500 is both the default AND the ceiling, and the
 * response is a bare JSON array with no total, no next cursor and no header
 * saying it was cut. A caller that asks once and counts what comes back CANNOT
 * TELL a 500-task org from a 5,000-task one.
 *
 * `DashboardPage.jsx` asked once. Every figure on the Today screen is derived
 * in the browser from that one array — OPEN TASKS, DUE TODAY, OVERDUE, DONE
 * THIS WEEK, "across N projects", the Project status bar's total, the week
 * strip's dots, and the hero lede's "you have N open tasks". So for any
 * organisation past 500 tasks the whole home screen understates, silently and
 * plausibly: no error, no spinner, no empty state — just smaller numbers than
 * the truth, on the first screen a buyer sees.
 *
 * Not hypothetical on this product. The cross-org access audit measured 555
 * tasks reachable from a single platform account, and the E2E organisation is
 * seeded with ~5,600 rows. The threshold is already crossed.
 *
 * WHY THE FIX IS PAGING AND NOT A BIGGER LIMIT. `limit` is clamped server-side,
 * so no value the client sends can raise the ceiling — `?limit=5000` returns
 * 500 rows and a 200. Raising the clamp is a `server.py` change and this page
 * does not own that file. Following `offset` is the contract the endpoint
 * already has.
 *
 * Rendered with react-dom directly. `@testing-library/react` is installed but
 * its `@testing-library/dom` peer is not, so importing it throws — the same
 * constraint `__tests__/skillRequest.test.jsx` records.
 */
import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../lib/api', () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

vi.mock('../lib/auth', () => ({
  currentUser: () => ({ user_id: 'user_me', full_name: 'Asha Rao' }),
}));

import { MemoryRouter } from 'react-router-dom';
import { api } from '../lib/api';
import { ToastProvider } from '../components/ui/toast';
import TodayPage from '../pages/DashboardPage';

/** The server's own ceiling, restated so the test fails loudly if it moves. */
const PAGE = 500;

/**
 * `n` open tasks, none of them the reader's, each in its own project so the
 * "across N projects" sub-line is derived from the same truncated set.
 */
const openTasks = (n, from = 0) => Array.from({ length: n }, (_, i) => ({
  task_id: `t${from + i}`,
  title: `Task ${from + i}`,
  status: 'todo',
  team_id: `team${from + i}`,
  assignee_user_ids: ['user_other'],
  created_by_user_id: 'user_other',
  user_id: 'user_other',
  due_at: null,
}));

/**
 * Serve `total` tasks through the real contract: a bare array, never longer
 * than `PAGE`, sliced by the `offset` the caller sent. Nothing in the response
 * says how many there are — that is the whole point.
 */
function serveTasks(total) {
  const all = openTasks(total);
  const calls = [];
  api.get.mockImplementation(async (path, config) => {
    if (path === '/tasks') {
      const offset = Number(config?.params?.offset || 0);
      const limit = Math.min(Number(config?.params?.limit || PAGE), PAGE);
      calls.push({ offset, limit });
      return { data: all.slice(offset, offset + limit) };
    }
    if (path === '/activity/feed') return { data: [] };
    if (path === '/verse-of-the-day') return { data: null };
    return { data: null };
  });
  return calls;
}

let container = null;
let root = null;

beforeEach(() => {
  vi.clearAllMocks();
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  container = null;
});

const settle = async (rounds = 12) => {
  for (let i = 0; i < rounds; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => { await Promise.resolve(); });
  }
  // `useSkeletonGate` holds a mounted skeleton for MIN_VISIBLE (220ms) on real
  // timers. Microtasks do not advance it, and `TodaySkeleton` renders its own
  // `.k-stats` — so without this wait every assertion below reads the
  // PLACEHOLDER strip and "no OPEN TASKS tile" would look like a paging bug.
  await act(async () => { await new Promise(r => { setTimeout(r, 320); }); });
};

async function mount() {
  await act(async () => {
    root.render(
      <ToastProvider>
        <MemoryRouter><TodayPage teams={[]} /></MemoryRouter>
      </ToastProvider>,
    );
  });
  await settle();
}

/** The value rendered in the tile whose label is `label`. */
function tile(label) {
  const el = [...container.querySelectorAll('.k-stats *')]
    .find(n => n.textContent.trim() === label);
  if (!el) return null;
  const card = el.closest('div');
  return card ? card.parentElement.textContent : null;
}

/** OPEN TASKS, read off the strip rather than off any internal state. */
function openTasksTile() {
  const strip = container.querySelector('.k-stats');
  if (!strip) return null;
  const card = [...strip.children]
    .find(c => c.textContent.includes('OPEN TASKS'));
  return card ? card.textContent : null;
}


describe('Today counts every task, not the first page of them', () => {
  it('follows offset until the server stops returning a full page', async () => {
    const calls = serveTasks(555);
    await mount();

    // Two requests: 0..500 came back full, so there may be more; 500..555 came
    // back short, so there is not. A third would be a wasted round trip.
    expect(calls).toEqual([
      { offset: 0, limit: PAGE },
      { offset: PAGE, limit: PAGE },
    ]);
  });

  it('shows 555 open tasks and not 500', async () => {
    serveTasks(555);
    await mount();

    const strip = openTasksTile();
    expect(strip).not.toBeNull();
    expect(strip).toContain('555');
    expect(strip).not.toContain('500');
  });

  it('derives "across N projects" from the whole set', async () => {
    serveTasks(555);
    await mount();

    expect(openTasksTile()).toContain('across 555 projects');
  });

  it('tells the reader the true org-wide total in the hero lede', async () => {
    // Nothing is assigned to the reader, so the lede quotes the org's open
    // count — the branch that reads `derived.openTotal`.
    serveTasks(555);
    await mount();

    const hero = container.querySelector('.k-hero') || container;
    expect(hero.textContent).toContain('555 open tasks');
  });

  it('asks once when the first page is already short', async () => {
    // The common case, and it must not cost a second request. A page shorter
    // than the ceiling is proof there is no more.
    const calls = serveTasks(12);
    await mount();

    expect(calls).toEqual([{ offset: 0, limit: PAGE }]);
    expect(openTasksTile()).toContain('12');
  });

  it('asks twice when the total lands exactly on the ceiling', async () => {
    // 500 back from a 500-row ask is indistinguishable from "there are more",
    // so the second ask is required and comes back empty. Stopping on a full
    // page because the arithmetic "looks round" is how an org with exactly one
    // page of tasks would get a phantom truncation warning.
    const calls = serveTasks(PAGE);
    await mount();

    expect(calls).toEqual([
      { offset: 0, limit: PAGE },
      { offset: PAGE, limit: PAGE },
    ]);
    expect(openTasksTile()).toContain('500');
  });

  it('does not silently drop the page that failed', async () => {
    // A second page rejecting is not "there were 500". The page already refuses
    // to render zero when `/tasks` fails outright; a partial load has to obey
    // the same rule rather than quietly presenting page one as the whole truth.
    api.get.mockImplementation(async (path, config) => {
      if (path === '/tasks') {
        const offset = Number(config?.params?.offset || 0);
        if (offset === 0) return { data: openTasks(PAGE) };
        throw Object.assign(new Error('boom'), { response: { status: 500 } });
      }
      if (path === '/activity/feed') return { data: [] };
      return { data: null };
    });
    await mount();

    expect(container.querySelector('.k-stats')).toBeNull();
    expect(container.textContent).toContain('could not load your tasks');
  });
});
