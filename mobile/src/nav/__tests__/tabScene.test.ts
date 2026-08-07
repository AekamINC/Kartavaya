/**
 * A scene's visibility is never gated on an animation completing.
 *
 * ── THE BUG THIS WAS WRITTEN FOR ────────────────────────────────────────────
 *
 * Owner, 2026-08-07, on an 800dp tablet: the navigation rail rendered in full —
 * sixteen destinations, badges, the FAB — beside a completely empty pane.
 *
 * `TabScene` opened every scene at `opacity: 0` and animated up to 1. On this
 * build (Expo 54 / RN 0.81 / Fabric, `newArchEnabled=true`) that native-driver
 * animation does not complete, so the scene stayed at zero: mounted, laid out
 * at the full `[120,0][1200,1920]`, and invisible. `uiautomator dump` showed
 * the content region present with no children, which is what an alpha-zero
 * subtree looks like from the outside.
 *
 * Verified on the device, each after a COLD RESTART — Fast Refresh returns
 * stale frames on this build and cannot be trusted for this
 * (`components/Refresher.tsx` records the same trap):
 *
 *     opacity bound to the animation  → pane empty
 *     opacity binding removed         → Today renders in full, both columns
 *     opacity binding restored        → pane empty again
 *
 * ── WHY THESE ASSERTIONS AND NOT A RENDER TEST ──────────────────────────────
 *
 * Node's type-stripping does not transform JSX, so no `.tsx` in this repo can
 * be imported by `node --test` — see `test/source.ts`. The defect lives in a
 * component body, so reading is the only instrument that reaches it at all.
 *
 * These fail against the code as it was: the first two on the `opacity: anim`
 * binding, the third on the unconditional `anim.setValue(0)` at first focus.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { readCode } from '../../test/source.ts';

const code = () => readCode('nav/TabScene.tsx');

test('opacity is not driven by the animation', () => {
  // The whole of the fix. A stuck translate leaves a pane 10px off; a stuck
  // opacity hides the product.
  assert.doesNotMatch(code(), /opacity:\s*anim/,
    'a scene that starts transparent is invisible whenever the animation does not run');
});

test('opacity is not animated at all', () => {
  // Not merely "not `anim`" — `interpolate` onto opacity would be the same
  // defect spelled differently.
  const style = code();
  assert.doesNotMatch(style, /opacity:[^,\n]*interpolate/,
    'opacity is being interpolated, which is the same gate in another form');
});

test('the first focus does not animate', () => {
  // Mount is not a tab CHANGE. Animating it is what made the bug reachable
  // without ever touching the bar — the app was blank on launch.
  const src = code();
  assert.match(src, /if\s*\(\s*from\s*===\s*index\s*\)/,
    'first focus is not distinguished from a tab change');
  assert.match(src, /from\s*===\s*index\s*\)\s*\{\s*anim\.setValue\(1\)/,
    'first focus must rest at 1, not at 0');
});

test('an interrupted animation still comes to rest', () => {
  // `.start()` with no callback leaves a torn-down scene at whatever offset it
  // had reached, and that offset persists into its next focus.
  assert.match(code(), /start\(\s*\(\{\s*finished\s*\}\)/,
    'the animation does not handle being interrupted');
});

test('the translate cue is kept', () => {
  // The fix is not "delete the animation". §motion's direction cue — enter from
  // the right when you went right — survives, because a translate cannot hide
  // anything.
  assert.match(code(), /translateX/,
    'the direction cue was dropped along with the fade');
});
