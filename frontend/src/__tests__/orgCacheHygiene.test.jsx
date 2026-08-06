/**
 * What the previous organisation — or the previous PERSON — is allowed to leave
 * behind in localStorage.
 *
 * `orgSwitcher.test.jsx` already pins `kv_teams_cache`, and pinning ONE key by
 * name is how the other three were missed: a test that names a key can only
 * ever fail for that key, so the next cache somebody adds is invisible to it.
 * These tests are written the other way round. They seed a value that is
 * unmistakably the previous org's — a project name, an org name, an invited
 * colleague's address, an entitlement code — and then sweep EVERY key in the
 * store looking for it. A cache added next year is caught by the sweep without
 * anyone remembering to come back here.
 *
 * The three claims, in the order they matter:
 *
 *   1 · A switch must leave no key holding the previous org's ENTITLEMENTS.
 *       `Kartavaya_user` carries `module_grants`, `module_levels` and
 *       `org_roles`, and `Sidebar.jsx:62` reads it synchronously through
 *       `currentUser()` — so a stale copy is what the next org's first frame is
 *       drawn from. `OrgSwitcher.jsx` used to argue this was safe because
 *       `Protected` refetches `/auth/me`; the refetch is real, but it answered
 *       the same list for every org, so it replaced stale-wrong with fresh-wrong.
 *   2 · A switch must leave no key holding the previous org's NAMES.
 *       `Kartavaya_report_history` stores eight export rows whose `name` is
 *       `Kartavaya-{project-name}-{from}-{to}` (`ReportsPage.jsx:516`), and
 *       `kv_onboarding` stores the setup wizard's org name, invited email
 *       addresses and first project name.
 *   3 · A SIGN-OUT must leave none of it either. On a shared machine the next
 *       person to sign in is a different person, not a different org.
 *
 * Only `setActiveOrg` is stubbed, because the real one calls
 * `window.location.assign` and jsdom cannot navigate. Everything else — the
 * real `currentUser`, the real `getActiveOrg`, the real `clearActiveOrg`, the
 * real axios instance and its real interceptors — runs as it ships.
 */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { installNetworkKillSwitch, restoreNetwork } from './e2e/_harness';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const switched = [];

vi.mock('../lib/orgContext', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, setActiveOrg: vi.fn((id) => { switched.push(id); }) };
});

const { api, _resetSessionLatch } = await import('../lib/api');
const { apiLogout } = await import('../lib/auth');
const { default: OrgSwitcher } = await import('../components/layout/OrgSwitcher');

/* ── The previous org, written the way the product writes it ───────────────
 * Every string here is one a real cache really holds. If any of them survives
 * the boundary under test, the next org (or the next person) can read it.
 */
const PREV_ORG_NAME    = 'Mehta Associates';
const PREV_PROJECT     = 'gst-filing-q1';
const PREV_COLLEAGUE   = 'rohan@mehta-associates.in';
const PREV_GRANT       = 'ganit';

/** `/auth/me`'s payload, as `Protected.jsx:147` stores it. */
const PREV_USER = {
  user_id: 'u1',
  name: 'Aanya',
  org: { id: 'o1', name: PREV_ORG_NAME },
  org_roles: [{ org_id: 'o1', org_name: PREV_ORG_NAME, role_code: 'org_owner' }],
  module_grants: [PREV_GRANT, 'graha'],
  module_levels: { [PREV_GRANT]: 'approver' },
};

/** `ReportsPage.jsx:526` — the filename carries the project name in the clear. */
const PREV_REPORT_HISTORY = [{
  kind: 'time', fmt: 'XLSX', who: 'You', when: '3 Aug, 04:12 pm',
  name: `Kartavaya-${PREV_PROJECT}-2026-04-01-2026-06-30.xlsx`,
}];

/** `OnboardingPage.jsx:83` — the org's name, its invitees, its first project. */
const PREV_ONBOARDING = {
  name: 'Aanya', org: PREV_ORG_NAME, industry: 'CA / Legal practice',
  invites: [{ email: PREV_COLLEAGUE, role: 'org_admin' }],
  project: PREV_PROJECT, template: 'gst',
};

/** Everything the previous org left behind, all of it at once. */
function seedPreviousOrg() {
  localStorage.setItem('Kartavaya_user', JSON.stringify(PREV_USER));
  localStorage.setItem('Kartavaya_report_history', JSON.stringify(PREV_REPORT_HISTORY));
  localStorage.setItem('kv_onboarding', JSON.stringify(PREV_ONBOARDING));
  localStorage.setItem('kv_teams_cache', JSON.stringify([{ team_id: 't1', name: PREV_PROJECT }]));
  localStorage.setItem('Kartavaya_active_org', 'o1');
}

/**
 * Every key still in the store, and what is in it.
 *
 * The assertion below reports the KEY that held the leak, not just that a leak
 * exists — otherwise the failure says "something survived" and the next person
 * has to go looking.
 */
function survivingKeys() {
  const out = [];
  for (let i = 0; i < localStorage.length; i += 1) {
    const k = localStorage.key(i);
    out.push([k, localStorage.getItem(k) || '']);
  }
  return out;
}

function expectNothingHolds(needle, label) {
  const holders = survivingKeys()
    .filter(([, v]) => v.includes(needle))
    .map(([k]) => k);
  expect(holders, `${label} survived in: ${holders.join(', ')}`).toEqual([]);
}

/* ── Mounting the switcher ─────────────────────────────────────────────── */

let container;
let root;

const settle = async () => { await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };

const MEMBERSHIPS = {
  data: [
    { id: 'o1', name: PREV_ORG_NAME, role: 'org_owner', seats_used: null, seats_limit: null },
    { id: 'o2', name: 'Sundar Textiles', role: 'org_admin', seats_used: null, seats_limit: null },
  ],
  support: [],
  default_id: 'o1',
};

const mount = async () => {
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={['/today']}>
        <OrgSwitcher />
      </MemoryRouter>,
    );
  });
  await settle();
};

const click = async (el) => {
  await act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
};

/** Open the menu and pick the org that is NOT the active one. */
const switchToTheOtherOrg = async () => {
  await mount();
  await click(container.querySelector('.orgsw__t'));
  const rows = [...container.querySelectorAll('.orgsw__row')];
  const other = rows.find((r) => r.textContent.includes('Sundar Textiles'));
  expect(other, 'the second membership must be offered').toBeTruthy();
  await click(other);
  expect(switched, 'the switch must actually have been taken').toEqual(['o2']);
};

beforeEach(() => {
  installNetworkKillSwitch();
  localStorage.clear();
  switched.length = 0;
  _resetSessionLatch();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  vi.spyOn(api, 'get').mockResolvedValue({ data: MEMBERSHIPS });
  vi.spyOn(api, 'post').mockResolvedValue({ data: { ok: true } });
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
  restoreNetwork();
  vi.restoreAllMocks();
  localStorage.clear();
});

/* ══════════════════════════════════════════════════════════════════════════
   1 · Switching organisation
   ══════════════════════════════════════════════════════════════════════════ */

describe('switching organisation', () => {
  it('leaves no key holding the previous org\'s entitlements', async () => {
    seedPreviousOrg();
    await switchToTheOtherOrg();

    // The named key, because it is the one `Sidebar.jsx:62` reads synchronously
    // for the first frame after the reload.
    expect(localStorage.getItem('Kartavaya_user')).toBeNull();
    // And the sweep, because naming one key is how the other three were missed.
    expectNothingHolds('module_grants', "the previous org's grant list");
    expectNothingHolds(PREV_GRANT, `the module code "${PREV_GRANT}"`);
    expectNothingHolds('module_levels', "the previous org's write levels");
    expectNothingHolds('org_roles', "the previous org's role rows");
  });

  it('leaves no key holding the previous org\'s project names', async () => {
    seedPreviousOrg();
    await switchToTheOtherOrg();

    expect(localStorage.getItem('Kartavaya_report_history')).toBeNull();
    expectNothingHolds(PREV_PROJECT, `the project name "${PREV_PROJECT}"`);
  });

  it('leaves no key holding the previous org\'s name or its invitees', async () => {
    // `kv_onboarding` is not cosmetic: switching into an org whose
    // `onboarding_complete` is false reopens the wizard (`Protected.jsx:292`)
    // prefilled from the org it was abandoned in, and Continue then PATCHes
    // that name onto THIS org. A stale draft here is a wrong write, not a
    // stale render.
    seedPreviousOrg();
    await switchToTheOtherOrg();

    expect(localStorage.getItem('kv_onboarding')).toBeNull();
    expectNothingHolds(PREV_ORG_NAME, `the org name "${PREV_ORG_NAME}"`);
    expectNothingHolds(PREV_COLLEAGUE, 'an invited colleague\'s address');
  });

  it('still clears the cached teams — the key the first pass fixed', async () => {
    seedPreviousOrg();
    await switchToTheOtherOrg();
    expect(localStorage.getItem('kv_teams_cache')).toBeNull();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   2 · Signing out
   ══════════════════════════════════════════════════════════════════════════ */

describe('signing out', () => {
  it('leaves no key holding the previous org\'s project names', async () => {
    // A shared machine: the next person to sign in must not be able to read
    // which clients the last one exported reports for.
    seedPreviousOrg();
    await apiLogout();

    expect(localStorage.getItem('Kartavaya_report_history')).toBeNull();
    expectNothingHolds(PREV_PROJECT, `the project name "${PREV_PROJECT}"`);
  });

  it('forgets which organisation was active', async () => {
    // `clearActiveOrg` has existed since the switcher shipped, documented as
    // "on sign-out, so the next user does not inherit it", and nothing called
    // it. Left behind, the next person's very first request carries a stranger's
    // org id — the server refuses it, which is a broken first load rather than a
    // leak, but the id itself is still theirs and not this person's.
    seedPreviousOrg();
    await apiLogout();

    expect(localStorage.getItem('Kartavaya_active_org')).toBeNull();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   3 · A session that ended on its own
   ══════════════════════════════════════════════════════════════════════════ */

describe('a 401 from anywhere in the product', () => {
  /** The real response interceptor, invoked the way axios invokes it. */
  const reject401 = async () => {
    const handler = api.interceptors.response.handlers.find((h) => h && h.rejected);
    expect(handler, 'lib/api.js must register a rejection interceptor').toBeTruthy();
    // jsdom cannot navigate; the redirect is not what is under test here.
    const replace = vi.fn();
    const nav = vi.spyOn(window, 'location', 'get')
      .mockReturnValue({ pathname: '/reports', search: '', replace });
    try {
      await handler.rejected({
        config: { url: '/reports/download/t1' },
        response: { status: 401 },
      }).catch(() => {});
    } finally {
      nav.mockRestore();
    }
  };

  it('takes the export history down with the session', async () => {
    // Same shared machine, arrived at without anyone pressing sign out: the
    // token simply expired. `endSession` cleared three keys and left this one.
    seedPreviousOrg();
    await reject401();

    expect(localStorage.getItem('Kartavaya_report_history')).toBeNull();
    expectNothingHolds(PREV_PROJECT, `the project name "${PREV_PROJECT}"`);
  });

  it('and the setup wizard\'s draft, which only the sign-out path was clearing', async () => {
    // Found BY the sweep above rather than by reading `endSession`: the two
    // paths out of a session had different key lists, and nothing said why.
    // `apiLogout` cleared `kv_onboarding`; an expiry did not, so the org name,
    // the invitees' addresses and the first project's name survived on a
    // machine whose session had merely run out.
    seedPreviousOrg();
    await reject401();

    expect(localStorage.getItem('kv_onboarding')).toBeNull();
    expectNothingHolds(PREV_COLLEAGUE, 'an invited colleague\'s address');
    expectNothingHolds(PREV_ORG_NAME, `the org name "${PREV_ORG_NAME}"`);
  });
});
