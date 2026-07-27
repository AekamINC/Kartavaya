/**
 * The false-empty guard, swept across every screen.
 *
 * The defect: `TodayScreen`, `InboxScreen` and `BoardsScreen` never read
 * `isError`. A 500 therefore rendered "All clear! No tasks for this filter." on
 * the first screen a user opens each morning — the app told someone with an
 * overdue task that they had nothing to do, and gave them no reason to doubt it.
 *
 * The shape of the fix is the same on all three, and it is two decisions that
 * have to travel together:
 *
 *   1. `query.data ?? []` rather than a destructuring default. `const { data =
 *      [] }` erases the difference between "the server answered with nothing"
 *      and "the request failed" before any state logic can see it — `data` is
 *      `[]` either way, and `hasData` computed from it is a lie.
 *   2. `isError` and `error` passed into `resolveScreenState`, so a failure
 *      resolves to `error`/`request`/`forbidden` instead of falling through to
 *      the empty branch.
 *
 * ── What this test is and is not ──────────────────────────────────────────────
 *
 * This is a SOURCE-CONTRACT test. It reads the screen files as text. It cannot
 * be a render test: Node's type-stripping does not transform JSX, so no `.tsx`
 * file can be imported by `node --test`. What it does prove is that the wiring
 * that carries a failure into the state machine is present on every screen, and
 * it goes red if any of it is deleted — verified by reverting each fix in turn.
 *
 * The decision the wiring feeds is separately covered, for real, by
 * `components/__tests__/screenStatus.test.ts`, which exercises
 * `resolveScreenState` itself with no source reading involved. The two halves
 * together are: the logic is right, and every screen is plugged into it.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { readCode, screenFiles, callObjects, propValue } from '../../test/source.ts';
import { resolveScreenState } from '../../components/screenStatus.ts';

/** The three screens that shipped the defect. Named so a regression is obvious. */
const REGRESSION_SCREENS = [
  'screens/TodayScreen.tsx',
  'screens/InboxScreen.tsx',
  'screens/BoardsScreen.tsx',
];

/** Screens that resolve their state through the shared primitive. */
function screensUsingResolver(): string[] {
  return screenFiles().filter(f => readCode(f).includes('resolveScreenState('));
}

test('the three screens that shipped the false-empty defect all resolve state', () => {
  for (const f of REGRESSION_SCREENS) {
    assert.ok(
      readCode(f).includes('resolveScreenState('),
      `${f} must route its empty/error decision through resolveScreenState`,
    );
  }
});

test('EVERY resolveScreenState call passes isError — a failure can never read as empty', () => {
  const screens = screensUsingResolver();
  // 13 today: 6 core screens, 7 module/attendance surfaces. The floor is a
  // tripwire for the sweep silently finding nothing, not a target.
  assert.ok(screens.length >= 13, `expected the sweep to find the module screens, found ${screens.length}`);

  for (const file of screens) {
    const code = readCode(file);
    const calls = callObjects(code, 'resolveScreenState');
    assert.ok(calls.length > 0, `${file} calls resolveScreenState but no argument object was parsed`);

    calls.forEach((arg, i) => {
      for (const prop of ['isError', 'error', 'hasData'] as const) {
        assert.ok(
          propValue(arg, prop, code) !== undefined,
          `${file} call #${i + 1} does not pass ${prop} — a failure would render as "nothing here"`,
        );
      }
    });
  }
});

test('isError is wired to a real query flag, not hardcoded false', () => {
  for (const file of screensUsingResolver()) {
    const code = readCode(file);
    for (const arg of callObjects(code, 'resolveScreenState')) {
      const value = propValue(arg, 'isError', code);
      assert.ok(value, `${file}: isError has no value`);
      assert.ok(
        /\.isError\b/.test(value!),
        `${file}: isError is "${value}" — it must come from a query's isError flag`,
      );
      assert.ok(
        value !== 'false' && value !== 'true',
        `${file}: isError is hardcoded to ${value}`,
      );
    }
  }
});

test('a screen with several queries reports failure if ANY of them failed', () => {
  // BoardScreen, GanitScreen, GrahaScreen and ManavScreen each drive two
  // queries. Anding them would let a half-loaded screen claim success.
  const multi = ['screens/BoardScreen.tsx', 'screens/modules/GanitScreen.tsx',
                 'screens/modules/GrahaScreen.tsx', 'screens/modules/ManavScreen.tsx'];
  for (const file of multi) {
    const code = readCode(file);
    for (const arg of callObjects(code, 'resolveScreenState')) {
      const value = propValue(arg, 'isError', code)!;
      if (value.includes('.isError') && value.split('.isError').length > 2) {
        assert.ok(
          value.includes('||'),
          `${file}: combined isError uses "${value.trim()}" — must be || so one failure is reported`,
        );
        assert.ok(!value.includes('&&'), `${file}: && would hide a single query's failure`);
      }
    }
  }
});

test('the regression screens do not default data to an empty array', () => {
  // `const { data = [] }` is the exact shape that erased the failure. `?? []`
  // applied to `query.data` keeps `query.data === undefined` observable, which
  // is what `hasData` is computed from.
  //
  // Both spellings are caught. The renamed form `{ data: tasks = [] }` is the
  // one that actually appears in this codebase's style and the first version of
  // this guard missed it — the A/B run reverted the fix in exactly that shape
  // and the suite stayed green.
  const destructuredDefault = /\{[^{}]*\bdata\s*(?::\s*[A-Za-z_$][\w$]*)?\s*=\s*\[\s*\]/;
  for (const file of REGRESSION_SCREENS) {
    const code = readCode(file);
    assert.doesNotMatch(
      code, destructuredDefault,
      `${file} destructures data with an [] default, which hides a failed fetch`,
    );
  }
});

test('hasData is derived from data being defined, not from its length', () => {
  // `hasData: tasks.length > 0` would send a successful empty response down the
  // same path as a failure — the inverse of the original bug, same root cause.
  for (const file of screensUsingResolver()) {
    const code = readCode(file);
    for (const arg of callObjects(code, 'resolveScreenState')) {
      const value = propValue(arg, 'hasData', code)!;
      assert.ok(
        /!==\s*undefined|!=\s*null|Boolean\(|!!/.test(value),
        `${file}: hasData is "${value}" — it must test for the data being DEFINED`,
      );
      assert.doesNotMatch(
        value, /\.length\s*[><]/,
        `${file}: hasData is computed from length, so an empty success looks like a failure`,
      );
    }
  }
});

/**
 * The behavioural half, with no source reading.
 *
 * This is what the wiring above feeds. If a screen passes `isError: true` with a
 * 500, it CANNOT reach the empty branch — proven against the real function.
 */
test('with isError wired, a server failure can never resolve to empty', () => {
  const serverError = { response: { status: 500 } };

  // The exact arguments TodayScreen builds on a failed fetch: no data, so
  // isEmpty is false and the empty branch is unreachable.
  assert.equal(
    resolveScreenState({
      isLoading: false, isError: true, error: serverError,
      online: true, hasData: false, isEmpty: false,
    }),
    'error',
  );

  // And the defect's own shape: had `data` defaulted to `[]`, the screen would
  // have computed hasData:true + isEmpty:true and rendered "All clear!".
  assert.equal(
    resolveScreenState({
      isLoading: false, isError: true, error: serverError,
      online: true, hasData: true, isEmpty: true,
    }),
    'empty',
    'this is what the defect looked like — hasData must not be true on a failure',
  );
});

test('every non-ready status has copy to render, so no screen falls through blank', () => {
  const code = readCode('components/ScreenState.tsx');
  for (const status of ['offline', 'forbidden', 'error', 'request', 'empty']) {
    assert.match(code, new RegExp(`\\b${status}\\s*:\\s*\\{`), `ScreenState has no copy for "${status}"`);
  }
  // `loading` is handled by an early return with a spinner rather than copy.
  assert.match(code, /status === 'loading'/);
});
