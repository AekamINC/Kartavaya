/**
 * The light modules flow their cards — 31-tablet.md §3.
 *
 * ── WHY THIS FILE EXISTS ─────────────────────────────────────────────────────
 *
 * `CardList` was built, unit tested and then wired to NOTHING for a whole
 * session. A component with no consumers passes every test it has and changes
 * nothing on screen, which is the quiet way a tablet build stays a phone build:
 *
 *   "A single column of cards across 700dp is a phone layout that happens to be
 *   wide — the most common way a tablet build looks unfinished."
 *
 * So these tests are about REACH, not arithmetic. The column thresholds are
 * unit tested for real in `lib/__tests__/windowClass.test.ts`; what is unproven
 * without this file is that any screen asks for them.
 *
 * ── WHY THE MODULES AND NOT THE FLATLIST SCREENS ─────────────────────────────
 *
 * The six light-module surfaces are the ones that can take it today: their rows
 * are already `rows.map(...)` inside `ModuleShell`'s ScrollView, so flowing them
 * costs nothing and loses nothing. Boards, Mentions and the client portal are
 * `FlatList`s, and `CardList.tsx`'s own header sets out why `numColumns` is the
 * wrong answer there — that conversion trades virtualisation and is a separate
 * decision, not a wiring pass. It is recorded as NOT DONE, deliberately.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { readCode } from '../../../test/source.ts';

/** Every module surface whose body is a flow of cards. */
const CARD_MODULES = [
  'GanitScreen',
  'GrahaScreen',
  'ManavScreen',
  'PracharScreen',
  'SahayakContentScreen',
  'VetanaScreen',
] as const;

// ── §3 · The cards actually flow ─────────────────────────────────────────────

for (const name of CARD_MODULES) {
  test(`${name} flows its cards instead of stacking one per row`, () => {
    const code = readCode(`screens/modules/${name}.tsx`);
    assert.match(code, /<ModuleCards>/,
      `${name} still renders its rows as a single column at every width`);
    assert.match(code, /ModuleCards/,
      `${name} does not import the module card flow`);
  });
}

test('Dristi is NOT in the list, and that is deliberate', () => {
  // Its only `.map` draws the bars of a trend chart. Flowing those two abreast
  // would cut the chart in half — §3 is about cards, not about every repeated
  // element on a screen.
  const code = readCode('screens/modules/DristiScreen.tsx');
  assert.doesNotMatch(code, /ModuleCards/,
    'the trend chart has been wrapped in a card flow');
});

// ── The frame owns its own padding ───────────────────────────────────────────

test('ModuleCards subtracts the body padding from ONE definition of it', () => {
  // `CardList` measures the window's content region, but a module row sits
  // inside `ModuleShell`'s padded body and is narrower than that. Hard-coding
  // 32 at six call sites means the day the padding changes, five of them are
  // wrong and nothing says so.
  const code = readCode('screens/modules/ModuleShell.tsx');
  assert.match(code, /const BODY_PAD =/,
    'the body padding is not a named constant');
  assert.match(code, /inset=\{BODY_PAD \* 2\}/,
    'ModuleCards does not derive its inset from the body padding');
  assert.match(code, /paddingHorizontal: BODY_PAD/,
    'the stylesheet does not use the same constant it exports the inset from');
});

test('CardList can be told what to subtract', () => {
  const code = readCode('components/CardList.tsx');
  assert.match(code, /inset\?: number/, 'CardList takes no inset');
  assert.match(code, /content - inset/,
    'the inset is accepted and then ignored');
});

test('the inset applies only to the MEASURED width', () => {
  // A caller that passes an explicit `width` has already measured its own pane
  // and subtracting again would double-count. The guard is that `inset` lives
  // on the `width === undefined` branch.
  const code = readCode('components/CardList.tsx');
  assert.doesNotMatch(code, /width - inset/,
    'an explicitly passed width is being inset a second time');
});
