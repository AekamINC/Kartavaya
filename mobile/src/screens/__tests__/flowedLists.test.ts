/**
 * The three `FlatList` screens flow, and the one thread does not.
 *
 * `lib/__tests__/cardRows.test.ts` proves the TRANSFORM. This proves it is
 * reached — the failure `CardList` already demonstrated once is a correct
 * component with no consumers, which passes every test it has and changes
 * nothing on screen.
 *
 * The negative assertions matter as much as the positive ones. Two lists on
 * these screens must stay one-per-line, and nothing about them looks different
 * from the ones that flow.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { readCode } from '../../test/source.ts';

const FLOWED = ['BoardsScreen', 'MentionsScreen', 'ClientPortalScreen'] as const;

for (const name of FLOWED) {
  test(`${name} flows its cards into rows`, () => {
    const code = readCode(`screens/${name}.tsx`);
    assert.match(code, /chunkRows\(/, `${name} still renders one card per row`);
    assert.match(code, /<CardRow/, `${name} chunks but does not lay the row out`);
  });

  test(`${name} keys rows by content, not by index`, () => {
    // An index key means inserting one item at the top re-keys every row
    // beneath it, so FlatList rebuilds the whole viewport. On Mentions, which
    // polls, that is every poll.
    const code = readCode(`screens/${name}.tsx`);
    assert.match(code, /keyExtractor=\{(?:\()?row/,
      `${name}'s keyExtractor no longer takes a row`);
    assert.match(code, /rowKey\(row/, `${name} is not using the stable row key`);
  });

  test(`${name} never touches numColumns`, () => {
    // The whole reason `chunkRows` exists. Changing `numColumns` on a mounted
    // list throws unless `key` changes too, which is the remount §6 forbids.
    assert.doesNotMatch(readCode(`screens/${name}.tsx`), /numColumns/,
      `${name} is back on numColumns and will remount on rotation`);
  });
}

test('the columns are measured against the CARDS, not the screen', () => {
  // Each of these lists has its own padding, so the content region is wider
  // than the room the cards actually get. Measuring the screen puts a list one
  // column too wide at every threshold.
  for (const name of FLOWED) {
    assert.match(readCode(`screens/${name}.tsx`), /gridColumns\(content - 32\)/,
      `${name} measures the screen rather than its content`);
  }
});

test('the client portal comment thread does NOT flow', () => {
  // A conversation read two abreast is not a conversation. The screen has two
  // FlatLists and only one of them is a card flow; a sweep that wrapped "the
  // FlatList" would have caught the wrong one.
  const code = readCode('screens/ClientPortalScreen.tsx');
  const thread = code.slice(code.indexOf('data={comments'), code.indexOf('data={taskRows'));
  assert.ok(thread.length > 0, 'the comment list has moved — this test is blind');
  assert.doesNotMatch(thread, /CardRow/, 'the comment thread was flowed into columns');
});

test('the client portal no longer draws the retired diamond', () => {
  // It rendered a literal ◆ glyph in a gradient box — and this screen is what an
  // EXTERNAL CLIENT sees, so it was the one surface showing a retired mark to
  // somebody outside the company.
  const code = readCode('screens/ClientPortalScreen.tsx');
  assert.doesNotMatch(code, /◆/, 'the old diamond is still on the client portal');
  assert.match(code, /<KLogo/, 'the client portal has no mark at all now');
});
