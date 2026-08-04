/**
 * The parts of `api/messages.ts` that decide something before a request exists.
 *
 * ── WHY THIS FILE DOES NOT ASSERT A SINGLE URL, PARAM OR RESPONSE ENVELOPE
 *
 * `src/test/register.mjs` swaps `api/client` for a transport-free stub, and its
 * header states that "there is no code path from this suite to a socket". That
 * is true of `src/offline/*`, which imports the client as `'../api/client'`. It
 * is NOT true here. The resolve hook matches `'../api/client'` or a specifier
 * ending in `/api/client`, and every module in `src/api/` imports its sibling as
 * `'./client'` — which matches neither, falls through to Metro-style extension
 * resolution, and loads the REAL axios instance. That instance points at the
 * staging deployment, and staging shares a Supabase database with production.
 *
 * So: importing `../messages.ts` is safe (constructing an axios instance opens
 * no socket), but CALLING anything that reaches `apiClient` from this suite
 * would issue a real request against a real database. Every assertion below is
 * therefore on code that returns or throws before the request is built:
 * `isUuid`, `cleanMessage`, and the two refusals inside `markMentionsRead`.
 *
 * What that leaves uncovered, so it is not mistaken for covered: the `/search`
 * `{results, more}` envelope, the `before`/`limit` clamps on `list`, and the
 * three accepted body shapes of `markMentionsRead`. All three are observable the
 * moment the hook in `register.mjs` also matches `'./client'` — one line, in a
 * file this agent does not own. Until then they are asserted by nothing.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { isUuid, messagesApi, __cleanMessage, type Message } from '../messages.ts';

const UUID = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';

/* ── isUuid ─────────────────────────────────────────────────────────────── */

test('isUuid accepts a canonical uuid in either case', () => {
  assert.equal(isUuid(UUID), true);
  assert.equal(isUuid(UUID.toUpperCase()), true);
});

test('isUuid rejects everything a route param or a push payload can actually be', () => {
  // Each of these has a real source: an empty route param, a truncated id, a
  // uuid with the whitespace a copy-paste leaves on it, a numeric id from a
  // different table, and an absent key on `data.url`.
  for (const bad of ['', 'oops', UUID.slice(0, 35), ` ${UUID}`, `${UUID} `, 42, null, undefined, {}, [UUID]]) {
    assert.equal(isUuid(bad), false, `expected ${JSON.stringify(bad)} to be rejected`);
  }
});

/* ── cleanMessage ───────────────────────────────────────────────────────── */

/** A wire row with only the keys the scrubber cares about. */
const wire = (extra: Record<string, unknown>) =>
  ({
    id: UUID,
    channel_id: UUID,
    sender_id: 'u-1',
    content: 'hello',
    type: 'text',
    is_deleted: false,
    created_at: '2026-08-02T10:00:00Z',
    ...extra,
  }) as unknown as Message & { search_tsv?: unknown };

test('cleanMessage drops search_tsv so it is never persisted to MMKV', () => {
  const out = __cleanMessage(wire({ search_tsv: "'hello':1 'world':2" }));
  assert.equal('search_tsv' in out, false);
  // The scrub must not take anything else with it.
  assert.equal(out.content, 'hello');
  assert.equal(out.id, UUID);
});

test('cleanMessage parses reactions that arrive as a JSON string', () => {
  const out = __cleanMessage(wire({ reactions: '[{"emoji":"👍","user_id":"u-2"}]' }));
  assert.deepEqual(out.reactions, [{ emoji: '👍', user_id: 'u-2' }]);
});

test('cleanMessage yields [] rather than throwing on a malformed reactions string', () => {
  // A renderer that maps over reactions must not be handed a crash by a codec
  // that failed to register — `tallyReactions` returning nothing is recoverable,
  // an exception inside a FlatList row is not.
  const out = __cleanMessage(wire({ reactions: '[{"emoji":' }));
  assert.deepEqual(out.reactions, []);
});

test('cleanMessage yields [] when the endpoint does not aggregate reactions at all', () => {
  // `/thread`, send and edit return a bare row with no reactions sub-select.
  assert.deepEqual(__cleanMessage(wire({})).reactions, []);
  assert.deepEqual(__cleanMessage(wire({ reactions: null })).reactions, []);
});

test('cleanMessage passes an already-decoded reactions array through unchanged', () => {
  const reactions = [{ emoji: '🎉', user_id: 'u-3' }];
  assert.deepEqual(__cleanMessage(wire({ reactions })).reactions, reactions);
});

/* ── markMentionsRead ───────────────────────────────────────────────────── */

test('markMentionsRead refuses mention_ids and mark_all together', () => {
  // The server answers 400 for this, but the throw is what stops the ambiguous
  // call being written in the first place.
  assert.throws(
    () => messagesApi.markMentionsRead({ mention_ids: [UUID], mark_all: true }),
    /never both/,
  );
});

test('markMentionsRead refuses a non-uuid channel_id instead of sending it', () => {
  // THE WHOLE POINT. The server drops an invalid `channel_id` silently and the
  // UPDATE then runs unscoped — this exact call would mark the caller's entire
  // org read. It must never leave the device.
  assert.throws(
    () => messagesApi.markMentionsRead({ mark_all: true, channel_id: 'not-a-uuid' }),
    /must be a uuid/,
  );
  assert.throws(
    () => messagesApi.markMentionsRead({ mark_all: true, channel_id: '' }),
    /must be a uuid/,
  );
});
