/**
 * A tab a link can name.
 *
 * ── WHAT WAS ASKED FOR, AND WHAT WAS ACTUALLY BUILT ─────────────────────────
 *
 * The web app spent 2026-09-07 moving `?tab=`, `?open=` and `?view=` out of
 * component state and into the URL, so a screen could be opened in a second
 * browser tab, sent to a colleague, or survive a refresh. The owner then asked
 * for "the same for the mobile app tabs".
 *
 * ⚠ IT IS NOT THE SAME, and building it as though it were would have been the
 * wrong thing. React Native has no browser: no second tab, no href, no
 * ctrl-click. This app does not restore navigation state on a cold start
 * either, so "survives a refresh" buys nothing here. Exactly ONE of the web's
 * payoffs crosses over, and on a phone it is the important one:
 *
 *     A PUSH NOTIFICATION CAN LAND ON THE RIGHT TAB.
 *
 * "A leave request needs approving" should open Approvals on Pending rather
 * than dropping the reader on a default to go and find it. `Approvals` had no
 * deep link AT ALL before today — `group: 'work'` puts it outside the rule
 * `linking.test.ts` enforces, so nothing was looking.
 *
 * ── WHY THIS DRIVES THE REAL MATCHER ────────────────────────────────────────
 *
 * `linking.ts` fails by DOING NOTHING — its own header says so, and
 * `linking.test.ts` exists because two modules shipped with no path and nothing
 * noticed. An optional segment is a new way to fail that way: `:tab?` that did
 * not match would leave `approvals` resolving to nothing and the app opening on
 * Today, with no error anywhere.
 *
 * So these assertions call `getStateFromPath` — React Navigation's own
 * resolver — against the real config, rather than asserting on the shape of the
 * strings. A test that only checked the map contained `'approvals/:tab?'` would
 * pass over a syntax React Navigation does not accept.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { getStateFromPath } from '@react-navigation/native';

import { linking } from '../linking.ts';
import { resolveTab } from '../../hooks/useRouteTab.ts';
import { readRaw } from '../../test/source.ts';

type Leaf = { name: string; params?: Record<string, unknown> };

/** The screen a path lands on, and the params it arrives with. */
function resolve(path: string): Leaf | null {
  const state = getStateFromPath(path, linking.config as never);
  const dig = (route: unknown): Leaf | null => {
    const r = route as { name?: string; params?: Record<string, unknown>; state?: { routes: unknown[] } };
    if (!r?.name) return null;
    if (r.state?.routes?.length) return dig(r.state.routes[r.state.routes.length - 1]);
    return { name: r.name, params: r.params };
  };
  const routes = (state as { routes?: unknown[] } | undefined)?.routes;
  return routes?.length ? dig(routes[routes.length - 1]) : null;
}

/* ── The paths that gained a tab ─────────────────────────────────────────── */

const CASES: ReadonlyArray<{ path: string; screen: string; params: Record<string, unknown> }> = [
  // Approvals — new to the map entirely.
  { path: 'approvals',          screen: 'Approvals', params: {} },
  { path: 'approvals/pending',  screen: 'Approvals', params: { tab: 'pending' } },
  { path: 'approvals/history',  screen: 'Approvals', params: { tab: 'history' } },
  // Tasks — a bottom tab, so this resolves THROUGH `Main`.
  { path: 'tasks',              screen: 'Tasks',     params: {} },
  { path: 'tasks/today',        screen: 'Tasks',     params: { segment: 'today' } },
  // Sales — the three surfaces above the sheets.
  { path: 'sales',              screen: 'Vikray',    params: {} },
  { path: 'sales/stock',        screen: 'Vikray',    params: { tab: 'stock' } },
  // Board — the view rides BEHIND the project it belongs to.
  { path: 'board/p1',           screen: 'Board',     params: { projectId: 'p1' } },
  { path: 'board/p1/Tracker',   screen: 'Board',     params: { projectId: 'p1', view: 'Tracker' } },
];

for (const { path, screen, params } of CASES) {
  test(`${path} → ${screen} ${JSON.stringify(params)}`, () => {
    const leaf = resolve(path);
    assert.ok(leaf, `"${path}" matched no route at all — the link opens Today and looks ignored`);
    assert.equal(leaf.name, screen, `"${path}" opened ${leaf.name}`);
    assert.deepEqual(leaf.params ?? {}, params);
  });
}

test('the BARE path still works, so links already in circulation keep landing', () => {
  /* The whole point of `:tab?` being optional. A push sent last week says
     `kartavaya://sales`, and it must still open Sales rather than nothing — an
     optional segment that turned out to be required would break every link
     already delivered, silently. */
  for (const p of ['approvals', 'tasks', 'sales', 'board/p1']) {
    const leaf = resolve(p);
    assert.ok(leaf, `"${p}" stopped resolving — every link already sent is now dead`);
    assert.ok(!('tab' in (leaf.params ?? {})), `"${p}" invented a tab param`);
  }
});

test('the paths that did NOT change still resolve where they did', () => {
  // Adding optional segments to four routes must not reorder or shadow the rest.
  const unchanged: ReadonlyArray<[string, string]> = [
    ['crm', 'Graha'], ['invoices', 'Ganit'], ['hr', 'Manav'],
    ['inbox', 'Inbox'], ['settings', 'Settings'],
    ['sanvaad/mentions', 'Mentions'], ['sanvaad/search', 'Search'],
    ['sanvaad/c1', 'Chat'], ['task/t1', 'TaskDetail'],
  ];
  for (const [p, screen] of unchanged) {
    assert.equal(resolve(p)?.name, screen, `"${p}" no longer opens ${screen}`);
  }
});

/* ── The guard on the other side ─────────────────────────────────────────── */

test('a hostile tab reaches the screen, which is why the allow-list exists', () => {
  /* MEASURED, not assumed: React Navigation resolves `approvals/nonsense`
     perfectly happily and hands the screen `{ tab: 'nonsense' }`. Nothing in
     the linking layer rejects it — `linking.ts` is only loosely type-checked —
     so the screen's own allow-list is the only thing between that and a tab
     strip with nothing selected and no panel rendered. */
  const leaf = resolve('approvals/nonsense');
  assert.deepEqual(leaf?.params, { tab: 'nonsense' });

  assert.equal(resolveTab('nonsense', ['pending', 'history'] as const, 'pending'), 'pending');
  assert.equal(resolveTab(undefined, ['pending', 'history'] as const, 'pending'), 'pending');
  assert.equal(resolveTab('history', ['pending', 'history'] as const, 'pending'), 'history');
  // Not a string at all — a link can carry anything.
  assert.equal(resolveTab(7, ['pending', 'history'] as const, 'pending'), 'pending');
  assert.equal(resolveTab(null, ['pending', 'history'] as const, 'pending'), 'pending');
});

/* ── The source ratchet ──────────────────────────────────────────────────── */

const CONVERTED = [
  'screens/ApprovalsScreen.tsx',
  'screens/BoardScreen.tsx',
  'screens/TasksScreen.tsx',
  'screens/modules/VikrayScreen.tsx',
];

for (const rel of CONVERTED) {
  test(`${rel} takes its tab from the route, not from useState`, () => {
    const src = readRaw(rel);
    assert.match(src, /useRouteTab</, `${rel} does not use the hook`);
  });
}

test('the hook writes params rather than navigating', () => {
  /* `setParams` rewrites the CURRENT route in place. A `navigate` would push,
     and Android's hardware Back would then walk backwards through every tab the
     reader looked at instead of leaving the screen — the same conclusion the
     web reached for its view strips, where `useUrlView` replaces. */
  const src = readRaw('hooks/useRouteTab.ts');
  assert.match(src, /nav\.setParams\(/);
  assert.doesNotMatch(src, /nav\.navigate\(|nav\.push\(/);
});

/* ── The one deliberately left alone ─────────────────────────────────────── */

test('the Pahchan clock keeps its tab in state, on purpose', () => {
  /* `Clock` owns the whole window and runs a camera, and `linking.test.ts` says
     in as many words why it has no path: "a link into a capture screen from a
     push notification is a worse experience than landing on Today". With no
     deep link there is no payoff — no browser tab to open it in, no state to
     restore — so moving it into the route would be change for its own sake.
     Written down because the next person to grep for `useState<'` will find it
     and assume it was missed. */
  const src = readRaw('screens/pahchan/ClockScreen.tsx');
  assert.match(src, /useState<'clock' \| 'history'>/);
  assert.doesNotMatch(src, /useRouteTab/);

  const screens = linking.config?.screens as Record<string, unknown>;
  assert.ok(!('Clock' in screens), 'Clock gained a deep link — then it wants a route param too');
});

/* ── The floor ───────────────────────────────────────────────────────────── */

test('the matcher is actually matching, not returning undefined for everything', () => {
  // Every assertion above would pass over a resolver that had stopped working
  // if they only checked for absence. This one checks it says NO to a path
  // nothing claims.
  assert.equal(resolve('this/is/not/a/route'), null);
  assert.ok(CASES.length > 8);
});
