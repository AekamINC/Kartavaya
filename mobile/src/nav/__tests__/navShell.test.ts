/**
 * The rail and the drawer — the decisions in them that are invisible when wrong.
 *
 * Text assertions, because `.tsx` cannot be imported by `node --test` (type
 * stripping does not transform JSX). The arithmetic these two components rely on
 * is unit tested properly in `lib/__tests__/windowClass.test.ts`; what is left
 * here is the set of choices that live in a component body and would otherwise
 * be checkable only by holding a tablet.
 *
 * Each test below is a rule from 31-tablet.md that fails SILENTLY: a FAB on the
 * wrong platform, a More row in a drawer that already lists everything, a rail
 * hardcoded to six. None of them crash. None of them look obviously wrong in a
 * screenshot of the other platform.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { readCode, readRaw, srcPath } from '../../test/source.ts';
import fs from 'node:fs';
import path from 'node:path';

const rail   = () => readCode('nav/NavRail.tsx');
const drawer = () => readCode('nav/NavDrawer.tsx');

// ── §7 · What differs by platform ─────────────────────────────────────────────

test('the ＋ FAB is Android-only — iPadOS puts it in the pane toolbar', () => {
  // §7's table: Android gets "FAB at the head of the rail"; iPadOS gets
  // "Toolbar button in the pane's navigation bar". An ungated FAB is an Android
  // habit on iOS, and it looks entirely fine to anyone testing on Android.
  const code = rail();
  assert.match(
    code, /\{isAndroid && \(\s*<Pressable/,
    'the rail FAB is not gated on the platform',
  );
});

test('Android gets the Material pill, iPadOS tints the glyph instead', () => {
  // §7: Android has a "Material pill indicator behind the glyph"; iPadOS has
  // "tinted glyph + label, no indicator". Giving both the pill is the single
  // most common way an RN tablet build reads as an Android app on an iPad.
  const code = rail();
  assert.match(
    code, /isAndroid && focused && \{ backgroundColor: t\.secondaryContainer \}/,
    'the active-item pill is not gated on Android',
  );
});

test('the drawer sizes its rows per platform — 44 on iPadOS, 52 on Android', () => {
  // §7's table, and they are not interchangeable: 44pt is the iPadOS touch
  // floor and 52dp is the Material row.
  assert.match(drawer(), /rowHeight = isAndroid \? 52 : 44/);
});

// ── §2 · More is deleted at large, not widened ────────────────────────────────

test('the drawer has NO More row', () => {
  // "Shipping a *More* row inside a drawer that already lists everything is a
  // phone habit surviving into a place it makes no sense." The drawer renders
  // every group; a More row would be a door to a room you are standing in.
  const code = drawer();
  assert.doesNotMatch(code, /onMore/, 'the drawer takes an onMore handler');
  assert.doesNotMatch(code, /'More'|"More"/, 'the drawer renders a More label');
});

test('the drawer renders every group, not a hand-picked few', () => {
  // If this becomes a subset, destinations in the omitted groups are reachable
  // from nowhere at `large` — see destinations.test.ts for the other half.
  assert.match(drawer(), /GROUPS\.map\(/, 'the drawer does not iterate GROUPS');
  assert.match(drawer(), /inGroup\(g\.id\)/, 'the drawer does not read each group');
});

test('the rail fills to fit and is NOT hardcoded to six', () => {
  // §2's prose says six; `Tablet.jsx:25` fills to fit and overflows into More,
  // which is what ships. A fixed six wastes 600dp of rail on an iPad Pro held
  // upright, and the project's rule is that the prototype is the spec.
  const code = rail();
  assert.match(code, /railSlots\(/, 'the rail does not compute its slot count');
  assert.match(code, /railItems\(DESTINATIONS, slots\)/, 'the rail does not split by slots');
  assert.match(code, /\{overflow && \(/, 'the rail has no More affordance when it overflows');
});

// ── §3 · The footer is not decoration ─────────────────────────────────────────

test('the drawer footer carries the clock AND the queue depth', () => {
  // §3: the two things worth reaching from anywhere. "One line, stating the
  // queue depth rather than a cloud icon" — a cloud says somebody thought about
  // syncing; "3 changes queued · oldest 12 min" says what is at risk.
  const code = drawer();
  assert.match(code, /onClock/, 'no clock affordance in the footer');
  assert.match(code, /clockedFor/, 'the footer does not show whether you are on the clock');
  assert.match(code, /changes? queued|changes\$\{|queued > 0/, 'no queue state in the footer');
  assert.match(
    code, /\$\{queued\} change\$\{queued === 1 \? '' : 's'\} queued/,
    'the sync line no longer states the DEPTH — a count is the whole point',
  );
});

// ── §4 · Touch targets do not shrink because the screen grew ──────────────────

test('neither shell hardcodes a target below the platform floors', () => {
  // 44pt iPadOS, 48dp Android, "everywhere, including with a pointer attached —
  // the same hand uses both. There is no tablet density tier."
  //
  // Reads the row/slot heights that are declared as literals. The rail's item
  // height is a constant in lib/windowClass.ts and is checked there.
  assert.match(drawer(), /rowHeight = isAndroid \? 52 : 44/);
  assert.match(drawer(), /minHeight: 58/, 'the clock button lost its minimum height');
  assert.match(drawer(), /height: 48/, 'the New task button lost its minimum height');
});

// ── §6 / §10 acceptance 3 · The window is read live, everywhere ───────────────

test('ACCEPTANCE 3 — no file in mobile/src calls Dimensions.get(', () => {
  // §10, verbatim: "Search `Dimensions.get(` in `mobile/src`. Every hit outside
  // a one-shot measurement is a bug."
  //
  // It froze at launch, so an app that was 1376pt when it started still draws
  // that layout at 320pt in Slide Over. This is the single most common tablet
  // bug in the ecosystem and it was ALREADY zero here when the work started —
  // which is worth keeping rather than rediscovering.
  const root = srcPath('');
  const hits: string[] = [];

  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { walk(full); continue; }
      if (!/\.tsx?$/.test(e.name)) continue;
      if (full.includes('__tests__')) continue;
      const rel = path.relative(root, full).replace(/\\/g, '/');
      // COMMENT-STRIPPED, and the first run of this test is why: it flagged
      // `hooks/useWindowClass.ts`, whose header says "NEVER
      // `Dimensions.get('window')`". A guard that cannot tell a warning against
      // an API from a use of it punishes documenting the rule.
      if (/Dimensions\s*\.\s*get\s*\(/.test(readCode(rel))) hits.push(rel);
    }
  };
  walk(root);

  assert.deepEqual(
    hits, [],
    'Dimensions.get() freezes at launch and does not re-render on resize. Use '
    + 'useWindowDimensions() — see hooks/useWindowClass.ts. Files: ' + hits.join(', '),
  );
});

test('the shells read the window through the one hook, never a raw import', () => {
  // Both take `platform` as a prop rather than reading `Platform.OS`, because
  // §7's two rail widths are a DESIGN difference and have to be settable in a
  // test and in a preview of the other platform's shell.
  for (const [name, raw] of [['NavRail', readRaw('nav/NavRail.tsx')], ['NavDrawer', readRaw('nav/NavDrawer.tsx')]] as const) {
    assert.doesNotMatch(
      raw, /Platform\.OS/,
      `${name} reads Platform.OS directly — it must take the platform as a prop`,
    );
    assert.match(raw, /type Platform \} from '\.\.\/lib\/windowClass'/, `${name} does not use the shared Platform type`);
  }
});

test('both shells take their widths from navWidth, not from a literal', () => {
  // 72 / 80 / 280 appear in §7 and in `lib/windowClass.ts`. Written again here
  // they would drift from the arithmetic that decides how much content is left,
  // and the split rule is measured against exactly that number.
  assert.match(rail(), /width: navWidth\('medium', platform\)/);
  assert.match(drawer(), /width: navWidth\('large', platform\)/);
});

// ── The shell switch ──────────────────────────────────────────────────────────

test('THE 0e14f848 GUARD — no navigator registers one name twice', () => {
  // Two `<Stack.Screen>`s under one name makes React Navigation THROW, and it
  // takes the whole signed-in app down with it — which is exactly what the
  // Srijan→Sahayak rename did when `Sahayak` and `SahayakContent` were briefly
  // both `Sahayak`. It is a launch-time crash, so no amount of unit-testing a
  // screen catches it; only the registration does.
  //
  // Grouped by navigator, because `Clock` legitimately appears in both the stack
  // and the attendance-only tab shell. Same name, two navigators, is fine.
  const src = readRaw('nav/RootStack.tsx');
  const seen: Record<string, string[]> = {};
  for (const m of src.matchAll(/<(Stack|Tab|PahchanTab)\.Screen\s+name="([A-Za-z]+)"/g)) {
    (seen[m[1]] ??= []).push(m[2]);
  }
  assert.ok(Object.keys(seen).length >= 3, 'the registration scrape found nothing — regex rotted');

  for (const [nav, names] of Object.entries(seen)) {
    const dupes = names.filter((n, i) => names.indexOf(n) !== i);
    assert.deepEqual(
      dupes, [],
      `${nav} registers ${dupes.join(', ')} more than once — this THROWS at launch`,
    );
  }
});

test('the bottom bar is rendered only at compact', () => {
  // §2: above compact the rail or the drawer IS the navigation, and a bottom bar
  // as well would be two navigations competing for one thumb.
  assert.match(
    readCode('nav/RootStack.tsx'),
    /windowCls !== 'compact' \? null :/,
    'MainTabs still draws the bottom bar at every width',
  );
});

test('§6 — the shell wraps the navigator, it does not swap it', () => {
  // "It is a resize, not a remount. No refetch, no scroll reset, no keyboard
  // dismissal."
  //
  // The failure mode is a shell that renders one navigator at compact and a
  // different one above it: dragging an iPad app into Slide Over would then
  // remount every screen and lose all of it, silently, and only on a device.
  // So there is exactly ONE Stack.Navigator, and ShellFrame contains it.
  const code = readCode('nav/RootStack.tsx');
  const navigators = [...code.matchAll(/<Stack\.Navigator/g)].length;
  assert.equal(navigators, 1, 'more than one Stack.Navigator — a resize would remount');

  const shellAt = code.indexOf('<ShellFrame');
  const navAt   = code.indexOf('<Stack.Navigator');
  assert.ok(shellAt > 0 && shellAt < navAt, 'ShellFrame does not wrap the navigator');
});

test('the shell reads the route from onStateChange, not from a navigator hook', () => {
  // ShellFrame renders OUTSIDE every navigator — it has to, because the rail
  // addresses stack routes the tab navigator knows nothing about — so
  // `useNavigationState` is not available to it and would throw.
  const root = readCode('nav/RootStack.tsx');
  assert.match(root, /onStateChange=\{readFocus\}/, 'the focused route is not tracked');
  assert.match(root, /onReady=\{readFocus\}/, 'the first route is never read');
  assert.doesNotMatch(readCode('nav/ShellFrame.tsx'), /useNavigationState/);
});

test('§5 — Pahchan capture gets no rail and no drawer at any class', () => {
  // "No rail, no drawer, no panes, in any class, in either orientation."
  const code = readCode('nav/ShellFrame.tsx');
  assert.match(code, /IMMERSIVE_ROUTES\.has\(routeName\)/, 'nothing suppresses the chrome');
  assert.match(code, /const chrome = !immersive &&/, 'immersive does not gate the chrome');

  const dest = readCode('nav/destinations.ts');
  assert.match(dest, /IMMERSIVE_ROUTES = new Set\(\['Clock', 'Enroll'\]\)/,
    'the capture routes are no longer immersive');
});
