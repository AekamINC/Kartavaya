/**
 * Refresher must forward what ScrollView injects — or every list it touches
 * renders NOTHING.
 *
 * ── THE BUG THIS WAS WRITTEN FOR ────────────────────────────────────────────
 *
 * Owner, 2026-08-07: "each screen are empty and nothing inside just number."
 * Every list with a `refreshControl` rendered blank — not even its
 * ListHeaderComponent — and the strip commits (4336de93, 5c3f4ee0) removed
 * the gesture from fifteen call sites to get a product that renders at all,
 * recording the cause as "any RefreshControl blanks every list on RN 0.81".
 *
 * That sentence was wrong, and the misattribution is why the gesture stayed
 * gone for eleven days. On Android, `ScrollView.js` (RN 0.81.5, ~line 1838)
 * renders
 *
 *     cloneElement(refreshControl, { style }, <NativeScrollView>{content}</>)
 *
 * — the ENTIRE list subtree is injected as the refreshControl element's
 * CHILDREN, because `AndroidSwipeRefreshLayout` natively wraps what it
 * refreshes. A direct RefreshControl works (its Android branch spreads
 * `...props`, children included); `Refresher` destructured exactly
 * `{refreshing, onRefresh, offset}` and rendered a RefreshControl with no
 * children — silently discarding every screen it was mounted on. iOS never
 * injects, which is why the contract is easy to not know. Upstream closed
 * the identical report (facebook/react-native#49878) as not-planned: the
 * contract is permanent, and every wrapper must honour it.
 *
 * ── WHY THESE ASSERTIONS AND NOT A RENDER TEST ──────────────────────────────
 *
 * Node's type-stripping does not transform JSX, so no `.tsx` in this repo can
 * be imported by `node --test` — the constraint `test/source.ts` documents.
 * The defect is a props contract in a component body, so reading is the
 * instrument. Comments are stripped first: this file's own prose names the
 * exact tokens it asserts on.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readRaw, stripComments } from '../../test/source';

const refresher = stripComments(readRaw('components/Refresher.tsx'));

test('Refresher accepts the Android-injected children in its props type', () => {
  assert.match(refresher, /children\?:\s*React\.ReactNode/,
    'RefresherProps has no children — the injected list subtree is untyped ' +
    'and the next cleanup deletes the forward as unused');
});

test('Refresher forwards everything it does not name onto RefreshControl', () => {
  assert.match(refresher, /\{\s*refreshing,\s*onRefresh,\s*offset,\s*\.\.\.rest\s*\}/,
    'the destructuring no longer collects ...rest — children and the ' +
    'injected style are dropped and every list blanks again');
  const render = refresher.slice(refresher.indexOf('<RefreshControl'));
  assert.match(render, /\{\s*\.\.\.\(?rest/,
    'RefreshControl no longer receives the forwarded rest');
});

test('the forward is spread before the explicit props, so ours win', () => {
  const render = refresher.slice(refresher.indexOf('<RefreshControl'));
  const spread = render.search(/\{\s*\.\.\.\(?rest/);
  const explicit = render.indexOf('refreshing={refreshing}');
  assert.ok(spread !== -1 && explicit !== -1 && spread < explicit,
    'the rest spread must come FIRST — after the explicit props it could ' +
    'silently override refreshing/onRefresh with injected values');
});

test('every screen that lost the gesture has it back, through Refresher', () => {
  // The fifteen call sites the strip commits removed, by file. The gesture
  // returning through THIS component (never a bare RefreshControl) is what
  // keeps one fix point for the Android contract, the colour tokens, and
  // pull-to-apply for OTA updates.
  const expected: Record<string, number> = {
    'screens/TodayScreen.tsx': 1,
    'screens/TasksScreen.tsx': 1,
    'screens/ApprovalsScreen.tsx': 2,
    'screens/BoardScreen.tsx': 3,
    'screens/ChatScreen.tsx': 1,
    'screens/InboxScreen.tsx': 1,
    'screens/MentionsScreen.tsx': 1,
    'screens/MessagesScreen.tsx': 1,
    'screens/RemindersScreen.tsx': 1,
    'screens/SahayakScreen.tsx': 1,
    'screens/TimeScreen.tsx': 1,
    'screens/modules/ModuleShell.tsx': 1,
  };
  for (const [rel, count] of Object.entries(expected)) {
    const src = stripComments(readRaw(rel));
    const sites = src.match(/refreshControl=\{/g)?.length ?? 0;
    assert.equal(sites, count,
      `${rel}: expected ${count} refreshControl site(s), found ${sites}`);
    assert.equal(src.match(/<Refresher[\s>]/g)?.length ?? 0, count,
      `${rel}: a refreshControl site is not using the Refresher wrapper`);
  }
});
