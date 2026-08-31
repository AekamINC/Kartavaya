/**
 * A late roster for the PREVIOUS project must never be aimed at the current one.
 *
 * ── The defect ──────────────────────────────────────────────────────────────
 *
 * `TeamsPage` fetched a project's detail with no cancellation:
 *
 *     useEffect(() => { setProjectDetail(null); loadDetail(selectedId); },
 *              [selectedId]);
 *
 * Pick project A, pick project B, and if A's response lands AFTER B's, the
 * `setProjectDetail` from A wins. The screen then draws A's roster under B's
 * name, and the role select posts to
 *
 *     PUT /teams/${selectedId}/members/${m.member_id}
 *
 * — B's team id with A's member id.
 *
 * Measured on production 2026-08-31, from a Suite 03.9 failure:
 *
 *     PUT /api/teams/team_9a89314a6658/members/mem_77b44eec56dc  ->  404
 *     mem_77b44eec56dc   belongs to team_8b7c75da6a1e
 *     the same person on team_9a89314a6658 is mem_9348c91e211f
 *
 * ⚠ THE 404 WAS THE LUCKY OUTCOME. The two projects shared a person, which is
 * what made the id plausible; had it happened to name a row that DID exist on
 * the target team, the write would have changed the wrong person's role and
 * answered 200. Nothing on screen would have said so.
 *
 * The effect already cleared the roster when the second fetch FAILED — "a
 * roster attributed to the wrong project is worse than no roster", says its
 * comment. This is the same rule for two fetches that both succeed and finish
 * out of order.
 *
 * ── What is asserted ────────────────────────────────────────────────────────
 *
 * Both halves, because either alone leaves the hole open:
 *
 *   1. the late response is DISCARDED, so A's people never appear under B;
 *   2. and the write is addressed from the id the roster was loaded for, so a
 *      stale member id can never be sent to a different project.
 *
 * Rendered with react-dom directly: `@testing-library/react` is installed but
 * its `@testing-library/dom` peer is not — the constraint the sibling tests in
 * this repo record and follow.
 */
import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../lib/api', async (importOriginal) => ({
  ...(await importOriginal()),
  api: {
    get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn(), delete: vi.fn(),
    interceptors: { response: { use: vi.fn(() => 1), eject: vi.fn() } },
  },
}));

import { api } from '../../lib/api';
import TeamsPage from '../TeamsPage';

const A = 'team_8b7c75da6a1e';
const B = 'team_9a89314a6658';

const PROJECTS = [
  { team_id: A, name: 'Project A' },
  { team_id: B, name: 'Project B' },
];

/** The same person on both projects, under a DIFFERENT member id — the live
 *  shape, and the reason a stale id looks valid. */
const DETAIL = {
  [A]: {
    team_id: A, name: 'Project A', your_role: 'owner',
    members: [
      { member_id: 'mem_77b44eec56dc', user_id: 'user_fae870000001',
        display_name: 'Anita Rao', role: 'member' },
      // ⚠ ON PROJECT A ONLY, so the first test can tell the two rosters
      // apart. Without somebody unique to A, both rosters render the same one
      // name and the assertion below cannot fail whatever the page does.
      { member_id: 'mem_only_on_a', user_id: 'user_a0000000only',
        display_name: 'Devendra Joshi', role: 'member' },
    ],
  },
  [B]: {
    team_id: B, name: 'Project B', your_role: 'owner',
    members: [{ member_id: 'mem_9348c91e211f', user_id: 'user_fae870000001',
                display_name: 'Anita Rao', role: 'member' }],
  },
};

// React's own flag for "this is a test". Without it every `act()` warns
// "not configured to support act", which is noise that trains a reader to
// ignore the one line that might matter.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let host;
let root;

/** Resolvers for the two detail fetches, so their order is ours to choose. */
let pending;

beforeEach(() => {
  pending = new Map();
  api.get.mockReset();
  api.put.mockReset();
  api.get.mockImplementation((url) => {
    if (url === '/teams') return Promise.resolve({ data: PROJECTS });
    if (url === '/users') return Promise.resolve({ data: [] });
    const m = /^\/teams\/(.+)$/.exec(url);
    if (m) {
      return new Promise((resolve) => { pending.set(m[1], resolve); });
    }
    return Promise.resolve({ data: {} });
  });
  api.put.mockResolvedValue({ data: { member_id: 'x', role: 'admin' } });
  host = document.createElement('div');
  document.body.appendChild(host);
});

afterEach(() => {
  act(() => root?.unmount());
  host.remove();
});

/** Finish the fetch for one project, whenever we choose to. */
async function land(teamId) {
  const resolve = pending.get(teamId);
  expect(resolve, `no detail fetch was in flight for ${teamId}`).toBeTruthy();
  await act(async () => { resolve({ data: DETAIL[teamId] }); });
}

async function mount() {
  await act(async () => {
    root = createRoot(host);
    root.render(<TeamsPage />);
  });
}

/** Change the project the page is showing, via its own <select>. */
async function pick(teamId) {
  const sel = [...host.querySelectorAll('select')]
    .find((s) => [...s.options].some((o) => o.value === teamId));
  expect(sel, 'the project picker is not on screen').toBeTruthy();
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLSelectElement.prototype, 'value').set;
    setter.call(sel, teamId);
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

describe('the roster on screen belongs to the project named above it', () => {
  it('discards a detail response for a project that is no longer selected', async () => {
    await mount();
    // `loadProjects` selects the first project, so A's fetch is already in
    // flight. Switch to B before letting A land.
    await pick(B);
    await land(B);
    await land(A);                       // the LATE one — this is the defect

    const shown = host.textContent || '';
    expect(shown, 'the roster vanished — discarding the late response must not '
      + 'discard the response that is actually current').toContain('Anita Rao');
    expect(shown,
      'Devendra Joshi is on Project A and not on Project B, and he is on screen '
      + 'under Project B. A late response for the project the user has already '
      + 'left has overwritten the one they are looking at.')
      .not.toContain('Devendra Joshi');
    expect(host.querySelectorAll('.k-mcard').length,
      'Project B has one member and the screen is drawing a different number of '
      + 'cards, so this roster belongs to some other project').toBe(1);
  });

  it('never sends a member id from one project to another', async () => {
    await mount();
    await pick(B);
    await land(B);
    await land(A);                       // A arrives late, under B's name

    const roleSel = [...host.querySelectorAll('select')]
      .find((s) => (s.getAttribute('aria-label') || '').startsWith('Role for'));
    expect(roleSel, 'no role control rendered for the roster').toBeTruthy();

    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLSelectElement.prototype, 'value').set;
      setter.call(roleSel, 'admin');
      roleSel.dispatchEvent(new Event('change', { bubbles: true }));
    });

    // ⚠ THE ASSERTION THE DEFECT FAILED. Before the fix this called
    // `PUT /teams/team_9a89314a6658/members/mem_77b44eec56dc` — B's team, A's
    // member. Either the write goes to B with B's member, or it does not go.
    for (const [url] of api.put.mock.calls) {
      expect(url, `a role change was addressed to ${url}, which pairs a team id `
        + 'with a member id from a different project').not.toContain('mem_77b44eec56dc');
    }
    if (api.put.mock.calls.length) {
      expect(api.put.mock.calls[0][0]).toBe(`/teams/${B}/members/mem_9348c91e211f`);
    }
  });
});
