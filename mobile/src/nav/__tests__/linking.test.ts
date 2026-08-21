/**
 * The deep-link map, and the two ways a screen loses its link without anyone
 * noticing.
 *
 * ── THE FAILURE THIS EXISTS FOR ──────────────────────────────────────────────
 *
 * `linking.ts` is only loosely type-checked. `LinkingOptions<RootStackParamList>`
 * does not validate the nested `screens` map against the param list, so a route
 * that is missing from it, or one that is spelled wrong, compiles cleanly. It
 * then FAILS BY DOING NOTHING: React Navigation cannot match the path, the app
 * opens on Today, and the link looks like it was simply ignored. There is no
 * crash, no warning, and nothing on screen to notice it by — the same shape of
 * silence that `destinations.test.ts` was written for.
 *
 * Vikray proved it. Sales shipped with a route, a screen, a More tile and a
 * drawer row on 2026-08-20, and no line in this map. So did `SahayakContent`
 * before it. Neither was caught by anything, because nothing was looking.
 *
 * ── WHY THE RULE IS SCOPED TO `group: 'modules'` ─────────────────────────────
 *
 * Not every destination wants a URL. `Clock` and `Enroll` own the whole window
 * and run a camera; a link into a capture screen from a push notification is a
 * worse experience than landing on Today. The MODULES are different: every one
 * of them is a place a notification points at — an invoice fell overdue, a leave
 * request needs approving, an order shipped — so the module group is exactly the
 * set where a missing path is a defect rather than a decision.
 *
 * This file can import `linking.ts` directly for the same reason
 * `destinations.test.ts` can import `destinations.ts`: both have `import type`
 * and nothing else, and type-stripping erases those. It reads the real object,
 * not the text of the file that declares it.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { readRaw } from '../../test/source.ts';
import { linking } from '../linking.ts';
import { DESTINATIONS } from '../destinations.ts';

/** The top-level `screens` map, as `{ RouteName: path | nested }`. */
function topLevelScreens(): Record<string, unknown> {
  const screens = linking.config?.screens as Record<string, unknown> | undefined;
  assert.ok(screens, 'linking.config.screens is missing — the whole map is gone');
  return screens;
}

/** Every `name="X"` a Screen is registered under in RootStack. */
function registeredRoutes(): Set<string> {
  const src = readRaw('nav/RootStack.tsx');
  const m = /<(?:Stack|Tab|PahchanTab)\.Screen\s+name="([A-Za-z]+)"/g;
  return new Set([...src.matchAll(m)].map(x => x[1]));
}

/** Every string path in the map, including the ones nested under `Main`. */
function allPaths(): string[] {
  const out: string[] = [];
  const walk = (node: Record<string, unknown>) => {
    for (const value of Object.values(node)) {
      if (typeof value === 'string') out.push(value);
      else if (value && typeof value === 'object') {
        const nested = (value as { screens?: Record<string, unknown> }).screens;
        if (nested) walk(nested);
      }
    }
  };
  walk(topLevelScreens());
  return out;
}

// ── The rule that closes the gap ──────────────────────────────────────────────

test('every module destination has a deep link path', () => {
  // THE ONE THAT WOULD HAVE CAUGHT VIKRAY. Adding a module means adding a route,
  // a screen, a destination AND a path; three of the four are visible on screen
  // the moment they are wrong, and this is the fourth.
  const screens = topLevelScreens();
  const missing = DESTINATIONS
    .filter(d => d.group === 'modules')
    .filter(d => !(d.route in screens))
    .map(d => `${d.key} → ${d.route}`);

  assert.deepEqual(
    missing, [],
    'these modules have a route and a tile but no URL, so every deep link and '
    + 'every push that names them opens Today instead and looks ignored: '
    + missing.join(', '),
  );
});

test('a module path is a real string, not an empty one or a nested map', () => {
  // `Vikray: ''` matches the prefix itself and would hijack `kartavaya://`.
  const screens = topLevelScreens();
  for (const d of DESTINATIONS.filter(x => x.group === 'modules')) {
    const path = screens[d.route];
    assert.equal(typeof path, 'string', `${d.route}'s path is not a string`);
    assert.ok((path as string).trim().length > 0, `${d.route} has an empty path`);
  }
});

// ── The two ways an existing entry rots ───────────────────────────────────────

test('every route named in the linking map is registered in RootStack', () => {
  // React Navigation does not throw on a route name it does not know — the
  // entry is simply inert. `0e14f848` is the version of this that took the
  // signed-in app down; this is the quiet version.
  const routes = registeredRoutes();
  assert.ok(routes.size > 10, 'the route scrape found almost nothing — the regex has rotted');

  const screens = topLevelScreens();
  const dangling: string[] = [];
  for (const [name, value] of Object.entries(screens)) {
    if (!routes.has(name)) dangling.push(name);
    const nested = (value as { screens?: Record<string, unknown> })?.screens;
    if (nested) {
      for (const tab of Object.keys(nested)) if (!routes.has(tab)) dangling.push(`Main.${tab}`);
    }
  }
  assert.deepEqual(
    dangling, [],
    'linking points at names RootStack does not register. This is the failure '
    + 'the file header describes — the link resolves to nothing: ' + dangling.join(', '),
  );
});

test('no two destinations share a deep link path', () => {
  // First match wins, so a duplicate does not error — it silently sends one
  // route's links to the other route's screen.
  const seen = new Map<string, number>();
  for (const p of allPaths()) seen.set(p, (seen.get(p) ?? 0) + 1);
  const dupes = [...seen].filter(([, n]) => n > 1).map(([p]) => p);
  assert.deepEqual(dupes, [], 'one path on two routes: ' + dupes.join(', '));
});

test('the parameterised sanvaad path stays LAST among its siblings', () => {
  // ORDER IS LOAD-BEARING and `linking.ts` says so: `sanvaad/:channelId` listed
  // before `sanvaad/mentions` swallows it, and `/sanvaad/search` opens a channel
  // whose id is "search". Key order in an object literal is insertion order, so
  // this is checkable.
  const keys = Object.keys(topLevelScreens());
  const param = keys.indexOf('Chat');
  for (const literal of ['Mentions', 'Search']) {
    const i = keys.indexOf(literal);
    assert.ok(i !== -1, `${literal} has lost its path`);
    assert.ok(
      i < param,
      `${literal} is declared after the parameterised sanvaad path, which will `
      + 'swallow it and open a channel by that name',
    );
  }
});

test('the prefixes keep the retired .in host', () => {
  // Removing a prefix breaks every link ALREADY SENT to a user. The canonical
  // domain is kartavaya.com; the .in host predates it and is kept for that
  // reason alone.
  const prefixes = linking.prefixes ?? [];
  assert.ok(prefixes.includes('kartavaya://'), 'the RN scheme is gone');
  assert.ok(
    prefixes.some(p => /kartavaya\.in/i.test(p)),
    'the .in prefix was removed — links already in circulation now dead-end',
  );
  assert.ok(
    prefixes.some(p => /app\.kartavaya\.com/i.test(p)),
    'the canonical kartavaya.com prefix is missing',
  );
});
