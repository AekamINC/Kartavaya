/**
 * The Organisation hub's tab bar: Devanagari, counts, and the loop that the
 * counts could so easily have been.
 *
 * Counts have two writers into one guarded setter: the shell fetches them so
 * they are on screen while Profile is still open (only one panel is mounted at
 * a time, so a panel-only count is a count nobody sees), and the panels report
 * again as their lists change so the chip does not go stale after an add.
 *
 * Two writers into shared state has one failure mode and it is severe: panel
 * reports → shell re-renders → panel re-renders → panel reports. The request
 * counter in the last test is the real assertion in this file. Everything else
 * here would survive a loop; that would not.
 *
 * `createRoot` + `act` rather than @testing-library/react, which is the house
 * pattern (see pageHeader.test.jsx) and is not installed.
 */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { ToastProvider } from '../components/ui/toast';

// Without this React logs "not configured to support act(...)" on every
// awaited update, which buries anything the test is actually trying to say.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const calls = [];

vi.mock('../lib/api', () => ({
  api: {
    get: vi.fn(url => {
      calls.push(url);
      if (url === '/v1/org/members') {
        return Promise.resolve({ data: [
          { user_id: 'u1', email: 'a@x.co', full_name: 'A', role_code: 'org_member', module_grants: [] },
          { user_id: 'u2', email: 'b@x.co', full_name: 'B', role_code: 'org_admin', module_grants: [] },
          { user_id: 'u3', email: 'c@x.co', full_name: 'C', role_code: 'org_member', module_grants: [] },
        ] });
      }
      if (url === '/v1/org/invites') return Promise.resolve({ data: [] });
      if (url === '/v1/subscription/current') {
        return Promise.resolve({ data: { active_modules: ['graha', 'ganit', 'manav', 'vetana'] } });
      }
      return Promise.resolve({ data: {} });
    }),
    put: vi.fn(() => Promise.resolve({ data: {} })),
    post: vi.fn(() => Promise.resolve({ data: {} })),
    delete: vi.fn(() => Promise.resolve({ data: {} })),
  },
}));

vi.mock('../lib/auth', () => ({
  currentUser: () => ({ user_id: 'u1', org_roles: [{ role_code: 'org_owner', org_name: 'Aekam Inc' }] }),
}));

const { default: OrgSettingsPage } = await import('../pages/OrgSettingsPage');

let container;
let root;

const settle = async (ms = 0) => {
  await act(async () => { await new Promise(r => setTimeout(r, ms)); });
};

/**
 * Poll until `check()` stops throwing, rather than sleeping a fixed span.
 *
 * These run alongside a dozen other agents' suites on one machine — one earlier
 * full run recorded 912s of environment setup — and a fixed `settle(60)` that
 * passes on an idle box is a test that fails on a loaded one for no reason
 * anybody can act on.
 */
const until = async (check, timeout = 3000) => {
  const deadline = Date.now() + timeout;
  for (;;) {
    try { check(); return; } catch (err) {
      if (Date.now() > deadline) throw err;
      await settle(15);
    }
  }
};

const draw = async () => {
  await act(async () => {
    root.render(<ToastProvider><MemoryRouter><OrgSettingsPage /></MemoryRouter></ToastProvider>);
  });
  await settle();
};

const tabs = () => [...container.querySelectorAll('[role="tab"]')];

beforeEach(() => {
  calls.length = 0;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
});

describe('Organisation hub tab bar', () => {
  // TEN, and each addition is a decision rather than a drift. The design had
  // six; `Senders` came next (per-purpose From addresses are a deliverability
  // setting, not a company detail); `UPI IDs` after it (one id PER PLATFORM,
  // not one VPA field); and Phase 4 added two on 2026-08-27 — `Compliance`
  // (4.1) and `Storage` (4.4), both endpoints that had existed with no caller.
  //
  // The list is asserted in FULL and in order, because a count alone would let
  // a tab be renamed or reordered without anybody noticing. This file pinned
  // seven for long enough that it was two behind before Phase 4 touched it:
  // when a tab lands, this is the test that has to move with it.
  it('renders the tabs in the design\'s order, plus the four added since', async () => {
    await draw();
    expect(tabs().map(t => t.textContent.replace(/[^A-Za-z ]/g, '').trim())).toEqual([
      'Profile', 'Members', 'Billing', 'Modules', 'Compliance', 'Senders',
      'UPI IDs', 'Security', 'Storage', 'Danger zone',
    ]);
  });

  it('carries each tab\'s Devanagari from the designer\'s TAB_HI map', async () => {
    await draw();
    expect(tabs().map(t => t.querySelector('.tabs__hi')?.textContent))
      .toEqual(['रूपरेखा', 'सदस्य', 'बीजक', 'खंड', 'अनुपालन', 'प्रेषक',
                'यूपीआई', 'सुरक्षा', 'भंडार', 'संकट']);
  });

  it('marks the Devanagari lang="hi" so it is not read as English', async () => {
    await draw();
    const marks = [...container.querySelectorAll('.tabs__hi')];
    expect(marks.length).toBe(10);
    for (const el of marks) expect(el.getAttribute('lang')).toBe('hi');
  });

  // The point of the shell fetching them: Profile is the open tab, so neither
  // Members nor Modules has mounted, and a count that only arrives when you
  // open the tab is a count you never see.
  it('shows both counts while Profile is still the open tab', async () => {
    await draw();
    await until(() => {
      expect(tabs()[1].querySelector('.tabs__n')?.textContent).toBe('3');
      expect(tabs()[3].querySelector('.tabs__n')?.textContent).toBe('4');
    });
  });

  it('renders no chip on the tabs the design gives no count', async () => {
    await draw();
    await until(() => expect(tabs()[1].querySelector('.tabs__n')).not.toBeNull());
    for (const i of [0, 2, 4, 5]) expect(tabs()[i].querySelector('.tabs__n')).toBeNull();
  });

  it('does not loop: reporting a count settles instead of re-requesting', async () => {
    await draw();
    // Wait for the counts to LAND, then give a loop plenty of further frames to
    // run away with itself. Asserting on a fixed sleep alone would pass simply
    // by measuring before the first response arrived.
    await until(() => expect(tabs()[1].querySelector('.tabs__n')).not.toBeNull());
    await settle(200);
    expect(calls.filter(u => u === '/v1/org/members').length).toBe(1);
    expect(calls.filter(u => u === '/v1/subscription/current').length).toBe(1);
  });
});
