/**
 * Module entitlement — a module the org has not subscribed to must not appear
 * in the nav, and must not resolve by URL.
 *
 * Two halves, and they are in very different states.
 *
 *   NAV     · implemented and correct, but DORMANT. `canSeeNavItem` reads
 *             `ctx.moduleGrants`, and `navContext` builds that from
 *             `user.module_grants`. `/auth/me` does not send the field
 *             (`auth_router.py:125 _safe_user` returns the user row plus
 *             `platform_roles` and `org_roles`, and nothing else), so
 *             `moduleGrants` is `null` and every module stays visible. That is
 *             deliberate: an absent signal must not read as an empty grant, or
 *             the entire modules group vanishes the day someone adds the field.
 *
 *   URL     · NOT IMPLEMENTED. `Protected` applies onboarding, client
 *             confinement and the platform-console check. There is no module
 *             check anywhere in the route tree, so typing `/vetana` resolves
 *             for a user with no Vetana grant even once the nav hides it.
 *
 * The nav half is tested for real. The URL half is pinned with `it.fails`, the
 * same device `separated-duty.test.jsx` uses: it passes only while the gap is
 * open and turns red the moment somebody closes it, at which point the
 * assertion inside is already written the right way round.
 */
import React from 'react';
import { Route } from 'react-router-dom';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import Protected from '../../components/layout/Protected';
import {
  NAV_FULL, navContext, canSeeNavItem, navGroupsFor,
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

/** Every nav entry that declares a `module`, derived rather than transcribed. */
const MODULE_ITEMS = NAV_FULL.flatMap(g => g.items).filter(i => i.module);
const ALL_MODULES = MODULE_ITEMS.map(i => i.module);

/**
 * Module entries whose visibility is decided by the grant ALONE.
 *
 * `canSeeNavItem` applies four independent predicates, and an entry may carry
 * more than one: `/hub` is `adminOnly: true, module: 'sahayak'`, so it is hidden
 * from a plain member whatever their grants say. Asserting "every module entry
 * is visible when grants are absent" over the unfiltered list therefore fails on
 * `/hub` for a reason that has nothing to do with entitlement — which is exactly
 * what happened when a sibling added `module: 'sahayak'` to those two rows.
 *
 * The permissive-default assertions below are about the MODULE predicate, so
 * they run over entries where no other predicate is in play.
 */
const GRANT_ONLY_ITEMS = MODULE_ITEMS.filter(
  i => !i.adminOnly && !i.orgAdminOnly && !i.ownerOnly,
);

/** Nav destinations a user can see, flattened. */
const destinationsFor = (user) =>
  navGroupsFor(user).flatMap(g => g.items.map(i => i.to.split('?')[0]));

/* ══════════════════════════════════════════════════════════════════════════
   1 · The nav predicate
   ══════════════════════════════════════════════════════════════════════════ */

describe('e2e · module entitlement · the nav', () => {
  it('the module inventory is derived and non-trivial', () => {
    expect(ALL_MODULES.length).toBeGreaterThan(8);
    expect(ALL_MODULES).toContain('vetana');
    expect(ALL_MODULES).toContain('ganit');
    // Pahchan was routed, rendered a finished page and appeared in NO nav list,
    // so the module was reachable exclusively by typing the URL.
    expect(ALL_MODULES).toContain('pahchan');
  });

  it('every module nav entry declares a `module` code the filter can read', () => {
    // The predicate existed in the data and never in the filter once: `module`
    // was declared on all ten entries and read by nothing.
    for (const item of MODULE_ITEMS) {
      expect(typeof item.module, `${item.to} has a non-string module code`).toBe('string');
      expect(item.module.length).toBeGreaterThan(0);
    }
  });

  it('a granted module is visible', () => {
    const user = users.staff({ module_grants: ['graha'] });
    expect(destinationsFor(user)).toContain('/graha');
  });

  it('an UNGRANTED module is hidden — one grant means one module', () => {
    const user = users.staff({ module_grants: ['graha'] });
    const seen = destinationsFor(user);

    for (const item of MODULE_ITEMS) {
      if (item.module === 'graha') continue;
      expect(seen, `${item.to} visible without a ${item.module} grant`).not.toContain(item.to);
    }
  });

  it('an empty grant array hides EVERY module', () => {
    const user = users.staff({ module_grants: [] });
    const seen = destinationsFor(user);
    for (const item of MODULE_ITEMS) {
      expect(seen, `${item.to} visible with no grants at all`).not.toContain(item.to);
    }
  });

  it('an empty grant array does not hide the non-module workspace', () => {
    // Over-correcting here empties the sidebar. Tasks, Boards and Approvals are
    // core, not modules, and carry no `module` key.
    const seen = destinationsFor(users.staff({ module_grants: [] }));
    expect(seen).toContain('/dashboard');
    expect(seen).toContain('/tasks');
    expect(seen).toContain('/approvals');
  });

  it('an ABSENT grant list is permissive, not empty', () => {
    // The load-bearing rule. `null` means "the server has no opinion", and a
    // missing signal must not read as an empty grant — that would vanish the
    // whole modules group the day the field is added.
    const user = users.staff(); // no module_grants key at all
    expect(navContext(user).moduleGrants).toBeNull();

    const seen = destinationsFor(user);
    expect(GRANT_ONLY_ITEMS.length).toBeGreaterThan(8);
    for (const item of GRANT_ONLY_ITEMS) {
      expect(seen, `${item.to} hidden when the server sent no grant list`).toContain(item.to);
    }
  });

  it('a malformed grant list is treated as absent rather than as empty', () => {
    // A server sending `null`, a string or an object must not blank the nav.
    for (const bad of [null, undefined, 'graha', { graha: true }, 42]) {
      const ctx = navContext(users.staff({ module_grants: bad }));
      expect(ctx.moduleGrants, `module_grants=${JSON.stringify(bad)}`).toBeNull();
    }
  });

  it('canSeeNavItem is the single predicate, and it is honoured for each flag', () => {
    const granted = navContext(users.staff({ module_grants: ['ganit'] }));
    expect(canSeeNavItem({ to: '/ganit', module: 'ganit' }, granted)).toBe(true);
    expect(canSeeNavItem({ to: '/vetana', module: 'vetana' }, granted)).toBe(false);
    // An item with no module code is never module-gated.
    expect(canSeeNavItem({ to: '/tasks' }, granted)).toBe(true);
  });

  it('an empty group is dropped rather than drawn as a heading with nothing under it', () => {
    const groups = navGroupsFor(users.staff({ module_grants: [] }));
    expect(groups.every(g => g.items.length > 0)).toBe(true);
    expect(groups.map(g => g.section)).not.toContain('modules');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   2 · Why the nav gate is dormant today
   ══════════════════════════════════════════════════════════════════════════ */

describe('e2e · module entitlement · the signal is not wired yet', () => {
  it('the frontend is ready for module_grants the moment the API sends it', () => {
    const nav = readSource('components/layout/navConfig.js');
    expect(nav).toMatch(/user\?\.module_grants/);
    expect(nav).toMatch(/item\.module\s*&&\s*ctx\.moduleGrants/);
  });

  it('/auth/me now returns module_grants, so the nav gate is LIVE', () => {
    // This test used to record the opposite. It went red when a sibling wired
    // the field, which is what it was for — the entitlement story is live and
    // the nav predicate above is now load-bearing rather than dormant.
    // eslint-disable-next-line global-require
    const { readFileSync, existsSync } = require('node:fs');
    const file = ['../backend/auth_router.py', 'backend/auth_router.py'].find(existsSync);
    expect(file, 'backend/auth_router.py not found from ' + process.cwd()).toBeTruthy();

    const src = readFileSync(file, 'utf8');
    const safeUser = src.slice(src.indexOf('def _safe_user'), src.indexOf('@router.post'));
    expect(safeUser).toContain('platform_roles');
    expect(safeUser).toContain('module_grants');
  });

  it('the API distinguishes "granted nothing" from "no opinion"', () => {
    // The trap the frontend comment warns about, on the server side. An EMPTY
    // list is a real answer — "this member has been granted nothing" — and it
    // is the answer the nav needs in order to hide the modules group. Serialised
    // on truthiness, `[]` would be dropped and read back as `null`, which is
    // permissive: the one case that matters would silently show every module.
    // eslint-disable-next-line global-require
    const { readFileSync, existsSync } = require('node:fs');
    const file = ['../backend/auth_router.py', 'backend/auth_router.py'].find(existsSync);
    const src = readFileSync(file, 'utf8');
    const safeUser = src.slice(src.indexOf('def _safe_user'), src.indexOf('@router.post'));

    expect(safeUser).toMatch(/module_grants\s+is\s+not\s+None/);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   3 · The URL half — pinned as a known-open gap
   ══════════════════════════════════════════════════════════════════════════ */

const MODULE_PAGE = <div data-landed="MODULE">Module page</div>;

async function visitModule(path, user) {
  signIn(user);
  installMockApi({ 'GET /auth/me': user });
  await host.mount(null, {
    path,
    routes: routesWith(<Route key="m" path={path} element={<Protected>{MODULE_PAGE}</Protected>} />),
  });
  return host.path();
}

describe('e2e · module entitlement · direct URL entry', () => {
  it('a granted module resolves for the user who holds it', async () => {
    // The control. Without it, the pins below could pass because nothing
    // resolves at all.
    const landed = await visitModule('/ganit', users.staff({ module_grants: ['ganit'] }));
    expect(landed).toBe('/ganit');
    expect(host.$('[data-landed="MODULE"]')).toBeTruthy();
  });

  /**
   * ── PINNED KNOWN-OPEN GAP ─────────────────────────────────────────────
   *
   * `Protected` has no module check. Hiding a nav link is presentation; it is
   * not entitlement. Anyone who bookmarks, guesses or is sent a link reaches
   * the page.
   *
   * The fix is small and belongs in `Protected.jsx` beside the other three
   * gates — resolve the path to a module code via `ROUTE_META`, then apply the
   * same `null`-is-permissive rule `canSeeNavItem` uses. It is not done here
   * because this branch owns tests, and because a route gate written against a
   * signal the API does not yet send cannot be verified end to end.
   *
   * When it lands, change `it.fails` to `it`.
   */
  it.fails('KNOWN-OPEN GAP: an ungranted module still resolves by URL', async () => {
    const oneGrant = users.staff({ module_grants: ['graha'] });
    const landed = await visitModule('/vetana', oneGrant);

    expect(landed, 'a user with no vetana grant reached /vetana by URL').not.toBe('/vetana');
  });

  it.fails('KNOWN-OPEN GAP: a user with NO grants still resolves every module by URL', async () => {
    const noGrants = users.staff({ module_grants: [] });
    const reached = [];
    for (const item of MODULE_ITEMS) {
      // eslint-disable-next-line no-await-in-loop
      const landed = await visitModule(item.to, noGrants);
      if (landed === item.to) reached.push(item.to);
      host.unmount();
      host = makeHost();
    }
    expect(reached, `reachable with an empty grant list: ${reached.join(', ')}`).toEqual([]);
  });

  it('RECORDED: Protected applies three gates and none of them is entitlement', () => {
    // The citation for the two pins above. If a module gate is added, this
    // test is the one that tells you to flip them.
    const src = readSource('components/layout/Protected.jsx');
    expect(src).toMatch(/onboardingIncomplete/);   // 1 · onboarding
    expect(src).toMatch(/ctx\.isClient/);          // 2 · client confinement
    expect(src).toMatch(/PLATFORM_PREFIX/);        // 3 · platform console
    expect(
      /moduleGrants|module_grants/.test(src),
      'Protected now reads module grants — flip the two it.fails pins above to it()',
    ).toBe(false);
  });
});
