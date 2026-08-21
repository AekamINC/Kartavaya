/**
 * The destination list, and the two ways it can silently lose a screen.
 *
 * This one CAN import the module it tests — `nav/destinations.ts` has no runtime
 * imports at all, only `import type`, which type-stripping erases. That is worth
 * preserving: it is the difference between checking the real array and grepping
 * the file that declares it.
 *
 * ── THE FAILURE THIS EXISTS FOR ─────────────────────────────────────────────
 *
 * `31-tablet.md` §2 deletes `More` at `large`. On a phone, More is the safety
 * net: a destination nobody put in a tab is still reachable from the grid. At
 * 1200 that net is gone, so a destination missing from the drawer is a screen
 * that has left the app — with no crash, no warning, and nothing on screen to
 * notice it by. The second half of §2 — "rail and drawer are the same
 * destination list" — is only true if there IS one list.
 *
 * The other half is `0e14f848`, which took the whole signed-in app down: a route
 * name that does not resolve. React Navigation does not throw on
 * `navigate('Typo')`; it does nothing. So every route named here is checked
 * against what `RootStack.tsx` actually registers.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { readRaw } from '../../test/source.ts';
import {
  DESTINATIONS, GROUPS, BAR_TABS, inGroup, inPhoneSection,
  type Destination,
} from '../destinations.ts';

/** Every `name="X"` a Screen is registered under in RootStack. */
function registeredRoutes(): Set<string> {
  const src = readRaw('nav/RootStack.tsx');
  const m = /<(?:Stack|Tab|PahchanTab)\.Screen\s+name="([A-Za-z]+)"/g;
  return new Set([...src.matchAll(m)].map(x => x[1]));
}

// ── Routes resolve ────────────────────────────────────────────────────────────

test('every destination names a route RootStack actually registers', () => {
  const routes = registeredRoutes();
  assert.ok(routes.size > 10, 'the route scrape found almost nothing — the regex has rotted');

  const dangling = DESTINATIONS
    .filter(d => !routes.has(d.route))
    .map(d => `${d.key} → ${d.route}`);
  assert.deepEqual(
    dangling, [],
    'these point at routes that do not exist. React Navigation does not throw on '
    + 'an unknown name — it does nothing, so the row is simply dead: ' + dangling.join(', '),
  );
});

test('every tab destination names a tab that exists', () => {
  const routes = registeredRoutes();
  for (const d of DESTINATIONS.filter(x => x.tab)) {
    assert.equal(d.route, 'Main', `${d.key} has a tab but does not route through Main`);
    assert.ok(routes.has(d.tab!), `${d.key} names tab "${d.tab}", which is not registered`);
  }
});

test('no two destinations share a key', () => {
  // Two rows under one key is a duplicate React key in every one of the three
  // renderings, and it is exactly the shape of the Srijan→Sahayak defect.
  const seen = new Map<string, number>();
  for (const d of DESTINATIONS) seen.set(d.key, (seen.get(d.key) ?? 0) + 1);
  const dupes = [...seen].filter(([, n]) => n > 1).map(([k]) => k);
  assert.deepEqual(dupes, []);
});

test('no two destinations share a Devanagari name', () => {
  // Three destinations that all involve somebody writing to you need three
  // words, or the drawer reads as one place listed three times. This is also
  // what caught सहायक being on both Sahayak and its Content hub.
  const seen = new Map<string, string[]>();
  for (const d of DESTINATIONS) seen.set(d.hi, [...(seen.get(d.hi) ?? []), d.key]);
  const shared = [...seen].filter(([, k]) => k.length > 1);
  assert.deepEqual(shared, [], 'one Devanagari word on two destinations: ' + JSON.stringify(shared));
});

// ── Nothing is lost when More is deleted ──────────────────────────────────────

test('everything the phone reaches through More is in a drawer group', () => {
  // THE §2 TRAP. At `large` More does not exist, so this is the only thing
  // standing between a shipped screen and its quiet disappearance.
  const groups = new Set(GROUPS.map(g => g.id as string));
  const orphaned = DESTINATIONS
    .filter(d => d.phoneSection && !groups.has(d.group))
    .map(d => d.key);
  assert.deepEqual(orphaned, []);

  // And the stronger form: every destination is in SOME group, whether or not
  // the phone shows it.
  const ungrouped = DESTINATIONS.filter(d => !groups.has(d.group)).map(d => d.key);
  assert.deepEqual(ungrouped, []);
});

test('the drawer covers every route the More grid can open', () => {
  const drawer = new Set(GROUPS.flatMap(g => inGroup(g.id).map(d => d.route)));
  const missing = DESTINATIONS
    .filter(d => d.phoneSection)
    .filter(d => !drawer.has(d.route))
    .map(d => `${d.key} (${d.route})`);
  assert.deepEqual(
    missing, [],
    'reachable from More on a phone and from nowhere at all on a large tablet: '
    + missing.join(', '),
  );
});

test('no group is empty and every group is used', () => {
  for (const g of GROUPS) {
    assert.ok(inGroup(g.id).length > 0, `group "${g.id}" has no destinations`);
  }
  assert.equal(
    GROUPS.reduce((n, g) => n + inGroup(g.id).length, 0),
    DESTINATIONS.length,
    'a destination is in a group that GROUPS does not declare',
  );
});

// ── The owner's two decisions, pinned ─────────────────────────────────────────

test('eSign is NOT a destination on this platform', () => {
  // Owner, 2026-08-07: eSign stays on the web page — "less chance for bug and
  // easy to fix bug no need of new app for bug fix". A web fix ships on merge;
  // an app fix waits on a store review.
  //
  // `Tablet.jsx:64` DOES list it, so porting that array wholesale is the obvious
  // way to reintroduce it. This fails if anyone does.
  const sign = DESTINATIONS.filter(d =>
    /sign|hastakshar/i.test(d.key) || /esign/i.test(d.en) || d.hi === 'हस्ताक्षर');
  assert.deepEqual(
    sign.map(d => d.key), [],
    'eSign is back in the destination list. It is deliberately web-only.',
  );
});

test('the five destinations the prototype omits are all present', () => {
  // The prototype was drawn against a smaller app. Boards, Mentions, Reminders,
  // Content and Marketing are real routed screens; dropping them to match a
  // drawing would delete five surfaces.
  for (const key of ['boards', 'mentions', 'reminders', 'sahayak-content', 'prachar']) {
    assert.ok(
      DESTINATIONS.some(d => d.key === key),
      `${key} is missing — it is reachable from More today and would be lost at large`,
    );
  }
});

test('the phone More grid keeps the exact order it shipped with', () => {
  // Declaration order drives all three renderings, so a change made for the
  // drawer's benefit silently reorders a screen that is already in users' hands.
  // §9: "No new screen components. Every screen ... is the phone screen from
  // 17-mobile-app.md, placed in a pane." Reordering one is not placing it.
  //
  // This is the row that made the point: `Tablet.jsx` has Sahayak sixth in the
  // module group; the shipped grid has it last. The phone wins.
  assert.deepEqual(
    inPhoneSection('work').map(d => d.key),
    ['boards', 'inbox', 'mentions', 'approvals', 'time', 'reminders'],
  );
  // `vikray` is APPENDED rather than slotted in beside graha and ganit where it
  // belongs by subject. That is the rule working, not being worked around: the
  // nine keys before it are in users' hands at those positions, and moving six
  // tiles to make Sales sit next to CRM is a redesign of a shipped grid. Adding
  // a module to the end costs nobody their muscle memory.
  assert.deepEqual(
    inPhoneSection('modules').map(d => d.key),
    ['pahchan', 'graha', 'ganit', 'manav', 'vetana', 'dristi',
     'sahayak-content', 'prachar', 'sahayak', 'vikray'],
  );
});

// ── Shape ─────────────────────────────────────────────────────────────────────

test('every destination carries both halves of its label and a glyph', () => {
  for (const d of DESTINATIONS) {
    assert.ok(d.en?.trim(), `${d.key} has no English label`);
    assert.match(d.hi, /[ऀ-ॿ]/, `${d.key}'s "hi" is not Devanagari`);
    assert.match(d.icon, /-outline$/, `${d.key}'s base glyph should be the outline form`);
    if (d.iconActive) {
      assert.doesNotMatch(d.iconActive, /-outline$/, `${d.key}'s active glyph is an outline`);
    }
  }
});

test('the bottom bar keeps its five slots, Create among them', () => {
  // `Create` is a slot with nothing behind it — BottomBar intercepts the press.
  // It is deliberately not a Destination, and More is deliberately not one
  // either: it exists only at compact.
  assert.equal(BAR_TABS.length, 5);
  assert.ok(BAR_TABS.includes('Create'));
  assert.ok(BAR_TABS.includes('More'));
  assert.equal(DESTINATIONS.filter((d: Destination) => d.key === 'more').length, 0);
});

test('the phone sections partition cleanly and the tabs stay out of them', () => {
  const withTab = DESTINATIONS.filter(d => d.tab);
  for (const d of withTab) {
    assert.equal(d.phoneSection, undefined, `${d.key} has a tab AND a More tile`);
  }
  const sectioned = ['work', 'modules', 'system'] as const;
  assert.equal(
    sectioned.reduce((n, s) => n + inPhoneSection(s).length, 0),
    DESTINATIONS.length - withTab.length,
  );
});
