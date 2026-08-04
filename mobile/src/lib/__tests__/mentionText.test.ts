/**
 * The caret arithmetic behind the `@` picker.
 *
 * The whole point of these is the agreement between the INSERTER and the
 * PARSER: `mentionTokenAt` must open a picker in exactly the places
 * `splitMentions` will later render a mention, and `insertMention` must write
 * the literal form three independent readers parse. A picker that opens on the
 * domain of `user@example.com`, or an insertion that writes a handle instead of
 * a display name, produces a message that looks like it mentions somebody and
 * notifies nobody.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { mentionTokenAt, insertMention } from '../mentionText.ts';
import { splitMentions } from '../richText.ts';

/** The caret sitting at the end of `value`. */
const atEnd = (value: string) => mentionTokenAt(value, value.length, value.length);

// ── Opening ───────────────────────────────────────────────────────────────────

test('an @ at the start of the message opens a token', () => {
  assert.deepEqual(atEnd('@ke'), { start: 0, end: 3, query: 'ke' });
});

test('@ alone opens a token with an empty query — it lists everybody', () => {
  assert.deepEqual(atEnd('@'), { start: 0, end: 1, query: '' });
});

test('an @ after a space opens where the space ends', () => {
  assert.deepEqual(atEnd('hi @ke'), { start: 3, end: 6, query: 'ke' });
});

test('an @ after a bracket opens too — the parser accepts one there', () => {
  // `splitMentions` opens at `(^|[^\w@])`, not at whitespace. An inserter that
  // offered fewer places than the parser renders is the same disagreement in
  // the other direction.
  assert.deepEqual(atEnd('(@ke'), { start: 1, end: 4, query: 'ke' });
  assert.ok(splitMentions('(@keval)').some(x => typeof x !== 'string'));
});

// ── Refusing ──────────────────────────────────────────────────────────────────

test('THE EMAIL CASE — user@example.com opens nothing', () => {
  assert.equal(mentionTokenAt('user@example', 12, 12), null);
  assert.equal(atEnd('mail user@example.com'), null);
  // And the parser agrees, which is the point.
  assert.deepEqual(splitMentions('mail user@example.com'), ['mail user@example.com']);
});

test('@@ opens nothing', () => {
  assert.equal(atEnd('@@x'), null);
});

test('a token closes at whitespace, so an inserted mention does not re-open one', () => {
  // The caret returning to the end of `@Keval Shah` must not put the picker
  // back up over a name that is already chosen.
  assert.equal(atEnd('@Keval Shah'), null);
  assert.equal(atEnd('hi @ke there'), null);
});

test('a range selection is not typing', () => {
  assert.equal(mentionTokenAt('@ke', 1, 3), null);
});

test('a paragraph beginning with @ is prose, not a name', () => {
  assert.equal(atEnd(`@${'x'.repeat(31)}`), null);
  assert.ok(atEnd(`@${'x'.repeat(30)}`), 'thirty characters is still a query');
});

test('no @ at all, and an empty value, are both null', () => {
  assert.equal(atEnd('just a message'), null);
  assert.equal(atEnd(''), null);
});

test('a caret past the end of the string is clamped, not trusted', () => {
  assert.deepEqual(mentionTokenAt('@ke', 99, 99), { start: 0, end: 3, query: 'ke' });
});

// ── Inserting ─────────────────────────────────────────────────────────────────

test('insertion writes @ + the FULL display name + one space', () => {
  const tok = atEnd('hi @ke')!;
  const out = insertMention('hi @ke', tok, 'Keval Shah');
  assert.equal(out.value, 'hi @Keval Shah ');
  assert.equal(out.caret, out.value.length);
});

test('what was inserted is what the parser reads back', () => {
  // The two halves of the same rule, asserted together so neither can move
  // without the other.
  const out = insertMention('hi @ke', atEnd('hi @ke')!, 'Keval Shah');
  const parts = splitMentions(out.value, ['Keval', 'Keval Shah']);
  const mention = parts.find(x => typeof x !== 'string') as { name: string } | undefined;
  assert.ok(mention, 'the inserted text must parse back as a mention');
  assert.equal(mention!.name, 'Keval Shah');
});

test('a mid-sentence insertion leaves the caret in the middle, not at the end', () => {
  const value = 'hi @ke, are you free?';
  const tok = mentionTokenAt(value, 6, 6)!;
  const out = insertMention(value, tok, 'Keval Shah');
  assert.equal(out.value, 'hi @Keval Shah , are you free?');
  assert.equal(out.caret, 'hi @Keval Shah '.length);
  assert.equal(out.value.slice(out.caret), ', are you free?');
});

test('a broadcast name goes in bare — @here, never @@here', () => {
  const out = insertMention('@h', atEnd('@h')!, 'here');
  assert.equal(out.value, '@here ');
});

test('a blank display name is refused rather than written as a bare @', () => {
  // `full_name` is nullable in `public.users`, so this is a real row shape.
  const value = 'hi @ke';
  const out = insertMention(value, atEnd(value)!, '   ');
  assert.equal(out.value, value);
  assert.equal(out.caret, value.length);
});
