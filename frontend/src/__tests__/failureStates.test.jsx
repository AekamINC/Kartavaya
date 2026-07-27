/**
 * A failed read is never an empty state — and a genuine empty is never an error.
 *
 * The highest-frequency defect in this codebase is `catch { /* … *\/ }` followed
 * by a `length === 0` branch: the request fails, the list stays at its initial
 * `[]`, and the screen prints a sentence about the customer's business that is
 * false. "No activity recorded yet" over a 500 says the team did nothing this
 * week. "Nothing is waiting" over a failed invite read tells an admin to stop
 * chasing invitations. "Nobody else is in your organisation yet" tells someone
 * their colleagues are not on the platform.
 *
 * Every case below is asserted TWICE, and the second half is the half that
 * keeps the first honest: turning every empty into an error is not a fix, it is
 * the same bug pointed the other way. `pahchan` already draws this line — a 404
 * on a reference photo is retention policy, not a failure — and it has to
 * survive.
 *
 * Rendered with react-dom directly rather than @testing-library/react: its
 * @testing-library/dom peer is not installed in this project, so importing it
 * throws. `grahaTabStates.test.jsx` and `kanbanTab.test.jsx` record the same
 * constraint and the same workaround.
 */
import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../lib/api', async (importOriginal) => ({
  ...(await importOriginal()),
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

import { api } from '../lib/api';
import { ToastProvider } from '../components/ui/toast';
import ActivityFeedPage from '../pages/ActivityFeedPage';
import TeamsPage from '../pages/TeamsPage';
import ChannelList from '../pages/sanvaad/ChannelList';
import AdminPage from '../pages/AdminPage';
import { ErrorState, errorKind } from '../components/ui/ErrorState';

/** A 500 with a real response — `errorKind` classifies this as `server`. */
const serverError = () => Object.assign(new Error('boom'), {
  isAxiosError: true,
  response: { status: 500, data: { detail: 'boom' } },
});

let container;
let root;

beforeEach(() => {
  vi.clearAllMocks();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  container = null;
});

const settle = async (rounds = 8) => {
  for (let i = 0; i < rounds; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => { await Promise.resolve(); });
  }
};

const mount = async (node) => {
  await act(async () => {
    root.render(<MemoryRouter><ToastProvider>{node}</ToastProvider></MemoryRouter>);
  });
};

/* ══════════════════════════════════════════════════════════════════════════
   errorKind — a 400 is the caller's request, not our fault
   ══════════════════════════════════════════════════════════════════════════ */

describe('ErrorState · a 400 does not blame the server', () => {
  it('never renders "broke on our side" above the server\'s own 400 sentence', async () => {
    // The exact shape reachable from approvals_router.py:562. ApprovePage puts
    // the server's `detail` under ErrorState's title, so while 400 mapped to
    // `server` the card contradicted itself in two adjacent lines.
    const dead = { response: { status: 400, data: { detail: 'This approval link is no longer active' } } };

    await mount(
      <ErrorState kind={errorKind(dead)} detail={dead.response.data.detail} />,
    );

    const text = container.textContent;
    expect(text).toContain('This approval link is no longer active');
    expect(text).not.toContain('broke on our side');
    expect(container.querySelector('[role="alert"]').dataset.kind).toBe('request');
  });

  it('offers no retry for a request the server already rejected', async () => {
    // Re-sending a spent link reproduces the same 400. A "Try again" button
    // there is an instruction to do something that cannot work.
    await mount(<ErrorState kind="request" onRetry={() => {}} />);
    expect(container.textContent).not.toContain('Try again');
  });

  it('still blames the server for a genuine 500', async () => {
    // The inverse guard: widening 4xx must not have swallowed 5xx.
    await mount(<ErrorState kind={errorKind({ response: { status: 500 } })} onRetry={() => {}} />);
    expect(container.textContent).toContain('broke on our side');
    expect(container.textContent).toContain('Try again');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   ActivityFeedPage
   ══════════════════════════════════════════════════════════════════════════ */

describe('ActivityFeedPage · "No activity recorded yet"', () => {
  it('does not claim an empty week when the feed request 500s', async () => {
    api.get.mockRejectedValue(serverError());

    await mount(<ActivityFeedPage teamId="t1" />);
    await settle();

    const text = container.textContent;
    expect(text).not.toContain('No activity recorded yet');
    expect(container.querySelector('[role="alert"]')).toBeTruthy();
    expect(text).toContain('Try again');
  });

  it('still says the week was quiet when the feed genuinely returns nothing', async () => {
    api.get.mockImplementation((url) => (
      url === '/activity/feed'
        ? Promise.resolve({ data: [] })
        : Promise.resolve({ data: { members: [] } })
    ));

    await mount(<ActivityFeedPage teamId="t1" />);
    await settle();

    expect(container.textContent).toContain('No activity recorded yet');
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   TeamsPage
   ══════════════════════════════════════════════════════════════════════════ */

describe('TeamsPage · "No teams created"', () => {
  it('does not send the user to create a project they already have', async () => {
    api.get.mockRejectedValue(serverError());

    await mount(<TeamsPage />);
    await settle();

    const text = container.textContent;
    expect(text).not.toContain('No teams created');
    // The empty state's CTA is the actively harmful part — it proposes work.
    expect(text).not.toContain('Create Project');
    expect(container.querySelector('[role="alert"]')).toBeTruthy();
  });

  it('still offers to create the first project when there genuinely are none', async () => {
    api.get.mockImplementation((url) => (
      url === '/teams' ? Promise.resolve({ data: [] }) : Promise.resolve({ data: [] })
    ));

    await mount(<TeamsPage />);
    await settle();

    expect(container.textContent).toContain('No teams created');
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   Sanvaad · the people directory
   ══════════════════════════════════════════════════════════════════════════ */

describe('Sanvaad DmPicker · "Nobody else is in your organisation yet"', () => {
  /**
   * Mount the list and open the picker behind "New direct message". The
   * directory read is debounced by 220ms, so the timers have to be advanced
   * before anything has been asked for at all.
   */
  const openPicker = async () => {
    await mount(
      <ChannelList
        channels={[]}
        archived={[]}
        showAll={false}
        onToggleAll={() => {}}
        loading={false}
        selectedId={null}
        onSelect={() => {}}
        onCreate={() => {}}
        onOpenDm={() => {}}
      />,
    );

    const trigger = container.querySelector('[aria-label="New direct message"]');
    expect(trigger).toBeTruthy();
    await act(async () => { trigger.click(); });

    // Past the 220ms debounce, then let the response settle.
    await act(async () => { vi.advanceTimersByTime(300); });
    await settle();
  };

  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('does not tell a user their colleagues are absent when the directory 500s', async () => {
    api.get.mockRejectedValue(serverError());

    await openPicker();

    const text = container.textContent;
    expect(text).not.toContain('Nobody else is in your organisation yet');
    // And it says what actually happened, so the blank list is explained.
    expect(text).toContain('did not load');
  });

  it('still says so when the directory genuinely comes back empty', async () => {
    api.get.mockResolvedValue({ data: [] });

    await openPicker();

    const text = container.textContent;
    expect(text).toContain('Nobody else is in your organisation yet');
    expect(text).not.toContain('did not load');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   AdminPage · invites and the R2 folder map
   ══════════════════════════════════════════════════════════════════════════ */

describe('AdminPage · "Nothing is waiting" over a failed invite read', () => {
  /**
   * `/admin/invites` and `/admin/teams` are deliberately swallowed relative to
   * `/admin/users` so that one failing does not blank the console. That is
   * correct; what was not is that each then left its own section at `[]`, and
   * the sections render "Nothing is waiting" and "No projects yet" off exactly
   * that value. A console that reports no pending invitations is a reason to
   * stop chasing them.
   */
  const ok = { data: [] };
  const users = [{ user_id: 'u1', full_name: 'A', email: 'a@b.c', role: 'member' }];

  beforeEach(() => {
    localStorage.setItem('Kartavaya_user', JSON.stringify({
      user_id: 'me', platform_roles: ['platform_manager'],
    }));
  });
  afterEach(() => localStorage.removeItem('Kartavaya_user'));

  const route = (overrides) => api.get.mockImplementation((url) => {
    if (url in overrides) return overrides[url];
    if (url === '/admin/users') return Promise.resolve({ data: users });
    return Promise.resolve(ok);
  });

  /**
   * Both sections live behind tabs, so the assertions below are worthless
   * until the right tab is actually selected — a `not.toContain` passes
   * trivially on a panel that was never rendered.
   */
  const openTab = async (label) => {
    const tab = [...container.querySelectorAll('[role="tab"]')]
      .find(t => t.textContent.includes(label));
    expect(tab).toBeTruthy();
    await act(async () => { tab.click(); });
    await settle(2);
  };

  it('does not report an empty invite queue when the read fails', async () => {
    route({ '/admin/invites': Promise.reject(serverError()) });

    await mount(<AdminPage />);
    await settle();
    await openTab('Invites');

    const text = container.textContent;
    expect(text).toContain('Pending invites');          // the panel really is up
    expect(text).not.toContain('Nothing is waiting');
    expect(text).not.toContain('Every invite sent has been accepted');
  });

  it('still reports an empty invite queue when there genuinely is one', async () => {
    route({ '/admin/invites': Promise.resolve({ data: [] }) });

    await mount(<AdminPage />);
    await settle();
    await openTab('Invites');

    expect(container.textContent).toContain('Nothing is waiting');
  });

  it('does not claim there are no projects when the folder map fails', async () => {
    route({ '/admin/teams': Promise.reject(serverError()) });

    await mount(<AdminPage />);
    await settle();

    const text = container.textContent;
    expect(text).toContain('Attachments live under');   // the panel really is up
    expect(text).not.toContain('No projects yet');
  });

  it('still claims there are no projects when there genuinely are none', async () => {
    route({ '/admin/teams': Promise.resolve({ data: [] }) });

    await mount(<AdminPage />);
    await settle();

    expect(container.textContent).toContain('No projects yet');
  });
});
