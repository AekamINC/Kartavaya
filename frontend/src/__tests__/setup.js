import '@testing-library/jest-dom';
import { beforeEach } from 'vitest';

/**
 * Every test starts in a FRESH TAB.
 *
 * jsdom gives a whole test file one `sessionStorage`, so without this a value
 * written by one `it` is still there for the next — and since `orgContext` pins
 * the active organisation per tab, that pin outlived the tests that seed an org
 * through `localStorage`. `sahayakStream` went red exactly there: it clears
 * `localStorage` in its own `beforeEach`, sets `Kartavaya_active_org` to
 * `org-9`, and got an earlier test's org on the request header instead.
 *
 * Clearing here rather than in that one file, because the invariant is general.
 * Twenty-four test files clear `localStorage` to get a clean slate; a per-tab
 * store makes that half a slate, and the next person to seed an org has no
 * reason to suspect the other half exists.
 *
 * File-level `beforeEach` hooks run after this one, so a test that deliberately
 * seeds `sessionStorage` — the support-session banner, the onboarding latch —
 * still sets it up unharmed.
 */
beforeEach(() => {
  try { sessionStorage.clear(); } catch { /* private mode; nothing to clear */ }
});
