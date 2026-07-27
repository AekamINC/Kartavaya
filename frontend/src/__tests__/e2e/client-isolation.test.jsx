/**
 * A client must never reach the staff product.
 *
 * This is the highest-value file in the suite, because it is the one defect
 * that actually shipped. `Protected.jsx` records what it was: the client rule
 * used to be a DENY-LIST of seven paths, so `/dashboard`, `/boards`, `/inbox`,
 * `/approvals`, `/graha`, `/ganit` and every module screen added after the list
 * was written all resolved — for a client, inside the staff shell, wrapped in
 * the module sidebar that `19-client-portal.md`'s never-see list opens with.
 *
 * ── Why these tests are shaped the way they are
 *
 * A deny-list fails on the paths that did not exist when it was written, so a
 * test that hardcodes a list of staff paths has exactly the same defect as the
 * bug it is testing for. Every path here is therefore DERIVED at runtime from
 * `navConfig.ROUTE_META`, which is built from `NAV_FULL` plus `EXTRA_ROUTES` —
 * the app's own list of everywhere it can go. A module added to the sidebar
 * next month is covered by this file the day it lands, with no edit here.
 *
 * `pages/client/__tests__/smoke.test.jsx` already covers what the portal
 * RENDERS — no staff email, no assignee name, no internal approval row. That is
 * not repeated. This file is about the boundary: who is allowed to be where.
 */
import React from 'react';
import { Route } from 'react-router-dom';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import Protected from '../../components/layout/Protected';
import {
  ROUTE_META, NAV_FULL, NAV_CLIENT, navContext, navGroupsFor,
} from '../../components/layout/navConfig';
import {
  installMockApi, installNetworkKillSwitch, restoreNetwork,
  makeHost, routesWith, signIn, clearSession, users, readSource,
} from './_harness';

let host;

beforeEach(() => {
  clearSession();
  installNetworkKillSwitch();
  host = makeHost();
});

afterEach(() => {
  host.unmount();
  restoreNetwork();
  vi.restoreAllMocks();
  clearSession();
});

/* ── The path inventory, derived rather than transcribed ──────────────────── */

const allKnownPaths = Object.keys(ROUTE_META);
const CLIENT_HOME = '/client';
const underClient = (p) => p === CLIENT_HOME || p.startsWith(CLIENT_HOME + '/');

/** Everywhere the app says it can go that is NOT the portal. */
const STAFF_PATHS = allKnownPaths.filter(p => !underClient(p));
/** The portal's own paths. */
const PORTAL_PATHS = allKnownPaths.filter(underClient);

const STAFF_PAGE = <div data-landed="STAFF-PRODUCT">Staff product</div>;
const PORTAL_PAGE = <div data-landed="PORTAL">Client portal</div>;

/**
 * Mount `Protected` at `path`, with that path declared as a guarded staff route.
 *
 * The target is ALWAYS wrapped, including `/dashboard`. Leaving it as a plain
 * landing stub was the first version of this helper and it made the
 * `/dashboard` case pass for the wrong reason: the stub rendered, no gate ran,
 * and `host.path()` read `/dashboard` — which is exactly what an ungated staff
 * page looks like. `routesWith` drops its own stub for any path the caller
 * claims, so the wrapped route wins.
 */
async function visit(path, { guarded = STAFF_PAGE } = {}) {
  await host.mount(null, {
    path,
    routes: routesWith(<Route key="target" path={path} element={<Protected>{guarded}</Protected>} />),
  });
  return host.path();
}

/* ══════════════════════════════════════════════════════════════════════════
   1 · The boundary, walked over every route the app admits to having
   ══════════════════════════════════════════════════════════════════════════ */

describe('e2e · a client is confined to the portal', () => {
  it('the derived inventory is non-trivial — the sweep below is not vacuous', () => {
    // A sweep over an empty list passes and proves nothing. If ROUTE_META ever
    // stops being the app's route inventory, this is the assertion that says so
    // rather than the twenty silent successes underneath it.
    expect(STAFF_PATHS.length).toBeGreaterThan(20);
    expect(PORTAL_PATHS.length).toBeGreaterThan(0);
    expect(STAFF_PATHS).toContain('/dashboard');
    expect(STAFF_PATHS).toContain('/approvals'); // the firm's own queue
    expect(STAFF_PATHS).toContain('/inbox');     // the staff notification feed
    expect(STAFF_PATHS).toContain('/vetana');    // payroll
    expect(STAFF_PATHS).toContain('/admin');     // the platform console
  });

  for (const path of STAFF_PATHS) {
    it(`bounces a client off ${path}`, async () => {
      signIn(users.client());
      installMockApi({ 'GET /auth/me': users.client() });

      const landed = await visit(path);

      expect(landed).toBe(CLIENT_HOME);
      expect(host.$('[data-landed="STAFF-PRODUCT"]'), `${path} rendered the staff product`)
        .toBeNull();
    });
  }

  it('a path nobody has declared yet is refused too — the allow-list holds', async () => {
    // The whole point of the allow-list rewrite: a staff route added next month
    // is covered on the day it lands rather than the day someone remembers
    // Protected.jsx. This path exists in no nav list and in no route table.
    signIn(users.client());
    installMockApi({ 'GET /auth/me': users.client() });

    const landed = await visit('/some-module-invented-after-this-test-was-written');

    expect(landed).toBe(CLIENT_HOME);
  });

  it('lets a client into their own portal', async () => {
    signIn(users.client());
    installMockApi({ 'GET /auth/me': users.client() });

    await host.mount(null, {
      path: '/client',
      routes: routesWith(<Route key="c" path="/client" element={<Protected>{PORTAL_PAGE}</Protected>} />),
    });

    expect(host.path()).toBe('/client');
    expect(host.$('[data-landed="PORTAL"]')).toBeTruthy();
  });

  it('lets a client into a nested portal path', async () => {
    signIn(users.client());
    installMockApi({ 'GET /auth/me': users.client() });

    await host.mount(null, {
      path: '/client/project/t1',
      routes: routesWith(
        <Route key="p" path="/client/project/:id" element={<Protected>{PORTAL_PAGE}</Protected>} />,
      ),
    });

    expect(host.path()).toBe('/client/project/t1');
    expect(host.$('[data-landed="PORTAL"]')).toBeTruthy();
  });

  it('a prefix that merely STARTS with /client is not the portal', async () => {
    // `/clients` is a plausible future staff route (a firm's client list). A
    // `startsWith('/client')` test would hand it to a portal user.
    signIn(users.client());
    installMockApi({ 'GET /auth/me': users.client() });

    expect(await visit('/clients')).toBe(CLIENT_HOME);
    expect(await visit('/client-admin')).toBe(CLIENT_HOME);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   2 · Who counts as a client
   ══════════════════════════════════════════════════════════════════════════ */

describe('e2e · the definition of "client" has exactly one home', () => {
  it('role client AND no org membership — both halves are required', () => {
    expect(navContext(users.client()).isClient).toBe(true);
    expect(navContext(users.staff()).isClient).toBe(false);
    // Flagged client who also holds an org role is staff who happens to be
    // marked. Confining them would lock a colleague out of their own workspace.
    expect(navContext(users.clientWithOrgRole()).isClient).toBe(false);
  });

  it('a flagged client WITH an org role keeps the staff product', async () => {
    signIn(users.clientWithOrgRole());
    installMockApi({ 'GET /auth/me': users.clientWithOrgRole() });

    const landed = await visit('/tasks');

    expect(landed).toBe('/tasks');
    expect(host.$('[data-landed="STAFF-PRODUCT"]')).toBeTruthy();
  });

  it('`Protected` and the nav read the same predicate, not two copies of it', () => {
    // The failure this prevents: two definitions of "who is a client" that
    // disagree, so the gate confines someone the nav still offers staff links
    // to, or the reverse. Protected imports navContext from navConfig; assert
    // the import is still there rather than trusting the comment.
    const src = readSource('components/layout/Protected.jsx');
    expect(src).toMatch(/import\s*\{[^}]*navContext[^}]*\}\s*from\s*'\.\/navConfig'/);
    expect(src).toMatch(/ctx\.isClient/);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   3 · The reverse direction — staff must not sit inside the portal
   ══════════════════════════════════════════════════════════════════════════ */

describe('e2e · staff are kept OUT of the portal', () => {
  for (const path of PORTAL_PATHS) {
    it(`redirects staff away from ${path}`, async () => {
      signIn(users.staff());
      installMockApi({ 'GET /auth/me': users.staff() });

      await host.mount(null, {
        path,
        routes: routesWith(<Route key="p" path={path} element={<Protected>{PORTAL_PAGE}</Protected>} />),
      });

      expect(host.path()).toBe('/dashboard');
      expect(host.$('[data-landed="PORTAL"]')).toBeNull();
    });
  }
});

/* ══════════════════════════════════════════════════════════════════════════
   4 · The nav a client is handed
   ══════════════════════════════════════════════════════════════════════════ */

describe('e2e · the client nav offers nothing that leads out', () => {
  it('every destination in a client nav group is inside /client', () => {
    const groups = navGroupsFor(users.client());
    const destinations = groups.flatMap(g => g.items.map(i => i.to.split('?')[0]));

    expect(destinations.length).toBeGreaterThan(0);
    for (const to of destinations) {
      expect(to, `client nav offers ${to}`).toMatch(/^\/client(\/|$)/);
    }
  });

  it('the client nav is NAV_CLIENT, never NAV_FULL', () => {
    const clientSections = navGroupsFor(users.client()).map(g => g.section);
    const staffSections = NAV_FULL.map(g => g.section);
    for (const s of clientSections) expect(staffSections).not.toContain(s);
    expect(clientSections).toEqual(NAV_CLIENT.map(g => g.section));
  });

  it('staff get the full nav, so the switch is on the user and not on the build', () => {
    const sections = navGroupsFor(users.orgOwner()).map(g => g.section);
    expect(sections).toContain('workspace');
    // Was `'modules'`, the flat bucket every module row used to sit in. That
    // group is gone: the design splits those modules across Revenue, People,
    // Growth and Clients, which is why CRM no longer sits under a generic
    // heading. `revenue` is the better sentinel anyway — a client seeing the
    // firm's revenue nav is the exact leak this file exists to catch, whereas
    // `modules` only ever meant "some staff group exists".
    expect(sections).toContain('revenue');
    expect(sections).toContain('people');
  });

  it('no client nav entry points at the firm\'s own approval queue or inbox', () => {
    // Both were on the client nav once. `/approvals` is `ApprovalsPage` — the
    // firm's queue, with the requester's name and email on every row.
    const destinations = navGroupsFor(users.client())
      .flatMap(g => g.items.map(i => i.to.split('?')[0]));
    expect(destinations).not.toContain('/approvals');
    expect(destinations).not.toContain('/inbox');
    expect(destinations).not.toContain('/dashboard');
    expect(destinations).not.toContain('/settings/customize');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   5 · The route tree's own shape
   ══════════════════════════════════════════════════════════════════════════ */

describe('e2e · /client routes live outside the staff shell', () => {
  const app = readSource('App.jsx');

  /**
   * The body of `<Route path="/" element={<Protected><AppShell /></Protected>}>`.
   *
   * Every route inside it is self-closing, so the first `</Route>` after the
   * opening tag closes the block.
   *
   * An earlier version of this test asserted every `/client` route appeared
   * BEFORE the shell block by string offset. That is the wrong invariant and it
   * failed on `/client/legacy`, a retired redirect declared near the bottom of
   * the file and correctly outside the shell. Position is not the property that
   * matters; CONTAINMENT is.
   */
  const shellBody = (() => {
    const at = app.indexOf('<Protected><AppShell /></Protected>');
    expect(at).toBeGreaterThan(0);
    const end = app.indexOf('</Route>', at);
    expect(end).toBeGreaterThan(at);
    return app.slice(at, end);
  })();

  it('no /client route is nested inside the staff shell', () => {
    // A /client route inside AppShell paints the portal in the staff chrome:
    // module sidebar, staff topbar, notification bell, "New task" button. That
    // is the first entry on 19's never-see list, and it is a LAYOUT fact —
    // `Protected` runs and passes, so no guard test can catch it.
    expect(shellBody).not.toMatch(/path="\/?client/);
  });

  it('the portal has its own top-level routes rather than none', () => {
    const clientRoutes = [...app.matchAll(/<Route\s+path="(\/client[^"]*)"/g)].map(m => m[1]);
    expect(clientRoutes).toContain('/client');
    expect(clientRoutes.length).toBeGreaterThan(2);
  });

  it('the staff shell still has children — the slice above is not empty', () => {
    // Guards the parser, not the app: if the shell block ever stops matching,
    // `shellBody` becomes a fragment and the containment test above passes
    // vacuously.
    expect(shellBody).toMatch(/path="dashboard"/);
    expect(shellBody).toMatch(/path="tasks"/);
  });

  it('the catch-all still exists, so an unknown path cannot render undefined', () => {
    expect(app).toMatch(/<Route\s+path="\*"/);
  });
});
