/**
 * The picker's rules, which are the ones that fail in silence.
 *
 * Every assertion here stands for a defect that LOOKS like a working picker:
 *
 *   · a source that filters a capped list locally, and so can never offer the
 *     92 contacts past `LIMIT 200`;
 *   · a row that renders a uuid where a name should be;
 *   · a truncated page that says nothing, so the reader believes the record
 *     does not exist and creates a second one;
 *   · an offline fallback that presents a partial answer as a complete one.
 *
 * None of these throws, none appears in a log, and none is reachable by
 * rendering — `src/test/register.mjs` cannot load a `.tsx` file. That is why the
 * rules live in `entitySource.ts` with no imports and no JSX, exactly as
 * `offline/deltaCursor.ts` does for the sync cursor.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  assigneeSource, clientSource, contactSource, productSource,
  listMeta, localFilter, localMatch, looksLikeId, paramSignature, requestParams,
  shouldAskServer, toOptions, truncationNotice, unwrapRows,
  type EntitySource,
} from '../entitySource.ts';

const UUID = '0f9c1a3e-2b4d-4f6a-8c1e-5d7b9a2c4e60';

/* ── The safety property ───────────────────────────────────────────────────── */

test('every capped list is server-searched', () => {
  // THE rule. `GET /v1/graha/contacts` ends `LIMIT 200` and staging holds 292
  // contacts, so a source that filters locally silently withholds 92 people
  // while looking like a working search. Flipping either of these to false is
  // the defect, and it is invisible until somebody cannot find a colleague.
  assert.equal(contactSource().serverSearch, true);
  assert.equal(clientSource().serverSearch, true);
});

test('a locally-filtered source is only ever one the server sends whole', () => {
  // `/v1/ganit/products` (routers/ganit.py:360) and `GET /teams/{id}` have no
  // LIMIT clause at all, so one fetch is the complete set and filtering it here
  // hides nothing. If a LIMIT is ever added to either, these two become the bug
  // above — which is what this test is here to make somebody notice.
  assert.equal(productSource().serverSearch, false);
  assert.equal(assigneeSource(UUID).serverSearch, false);
});

test('a non-searchable source never asks the server for a search', () => {
  assert.equal(shouldAskServer(productSource(), 'widget'), false);
  assert.equal(requestParams(productSource(), 'widget').search, undefined);
});

test('an empty query is never sent as search=""', () => {
  // Identical behaviour server-side, but two spellings of the same request mint
  // two cache entries and read as two different calls in a log.
  assert.equal(requestParams(contactSource(), '   ').search, undefined);
  assert.equal(requestParams(contactSource(), 'ka').search, 'ka');
});

test('static filters survive the search params, and are not searchable text', () => {
  const src = contactSource({ contactType: 'customer' });
  const p = requestParams(src, 'ka');
  assert.equal(p.contact_type, 'customer');
  assert.equal(p.search, 'ka');
});

test('minChars holds a request back but never a local filter', () => {
  const src: EntitySource = { ...contactSource(), minChars: 3 };
  assert.equal(shouldAskServer(src, 'ka'), false);
  assert.equal(shouldAskServer(src, 'kar'), true);
});

/* ── No uuid reaches the screen ────────────────────────────────────────────── */

test('a row whose name is a uuid is dropped, and COUNTED', () => {
  // Dropping in silence is the same failure as the LIMIT reached from the other
  // side: the record is unreachable and nothing says so, so it gets created a
  // second time. The count is what lets the picker write a sentence about it.
  const rows = [
    { id: 'a', name: 'Acme Traders' },
    { id: 'b', name: UUID },
    { id: 'c', name: '   ' },
  ];
  const out = toOptions(rows, clientSource());
  assert.deepEqual(out.options.map(o => o.label), ['Acme Traders']);
  assert.equal(out.unnamed, 2);
});

test('a uuid SUBLABEL loses the line, not the row', () => {
  // The second line is decoration. Losing the whole contact because a join
  // returned a raw id would be the worse trade.
  const out = toOptions(
    [{ id: 'a', name: 'Priya Nair', client_name: UUID }],
    contactSource(),
  );
  assert.equal(out.options.length, 1);
  assert.equal(out.options[0].sublabel, undefined);
  assert.equal(out.unnamed, 0);
});

test('a row with no value is dropped without being called unnamed', () => {
  // There is nothing to hand back to the form. It is not a naming failure and
  // must not inflate the "have no name" sentence.
  const out = toOptions([{ name: 'Nameless Co' }], clientSource());
  assert.equal(out.options.length, 0);
  assert.equal(out.unnamed, 0);
});

test('looksLikeId is case- and whitespace-tolerant', () => {
  assert.equal(looksLikeId(UUID.toUpperCase()), true);
  assert.equal(looksLikeId(` ${UUID} `), true);
  assert.equal(looksLikeId('Acme Traders'), false);
  assert.equal(looksLikeId(12345), false);
});

test('the assignee label falls through to an email before it gives up', () => {
  // An email is a worse name than a name and an infinitely better one than a
  // uuid. `TeamMember` populates four different columns across real rows.
  const src = assigneeSource(UUID);
  const out = toOptions(
    [{ user_id: 'u1', email: 'rekha@example.com' }],
    src,
  );
  assert.equal(out.options[0].label, 'rekha@example.com');
  // …and it is not ALSO the second line.
  assert.equal(out.options[0].sublabel, undefined);
});

test('the assignee value prefers user_id and falls back to member_id', () => {
  const src = assigneeSource(UUID);
  assert.equal(toOptions([{ user_id: 'u1', member_id: 'm1', name: 'A' }], src).options[0].id, 'u1');
  assert.equal(toOptions([{ member_id: 'm1', name: 'A' }], src).options[0].id, 'm1');
});

/* ── Envelopes ─────────────────────────────────────────────────────────────── */

test('all four live response shapes unwrap', () => {
  // `_listed`, a bare `{data}`, `GET /teams/{id}`'s `{members}`, and a raw array.
  assert.equal(unwrapRows({ data: [{ id: 1 }], total: 1, limit: 200, truncated: false }).length, 1);
  assert.equal(unwrapRows({ data: [{ id: 1 }, { id: 2 }] }).length, 2);
  assert.equal(unwrapRows({ members: [{ id: 1 }] }).length, 1);
  assert.equal(unwrapRows([{ id: 1 }]).length, 1);
});

test('an unrecognised body is an empty list, never a throw', () => {
  // A picker that renders nothing is recoverable. A picker that crashes the form
  // it is inside is not.
  assert.deepEqual(unwrapRows(null), []);
  assert.deepEqual(unwrapRows('nope'), []);
  assert.deepEqual(unwrapRows({ detail: 'Forbidden' }), []);
});

test('non-object entries are dropped from a list', () => {
  assert.deepEqual(unwrapRows({ data: [null, 'x', { id: 1 }] }), [{ id: 1 }]);
});

test('truncated is READ from the server, never inferred from the page size', () => {
  // 200 rows out of exactly 200 is complete. Inferring truncation from
  // `rows.length === limit` would put a permanent "there are more" note on it.
  assert.equal(listMeta({ data: [], total: 200, limit: 200, truncated: false }).truncated, false);
  assert.equal(listMeta({ data: [], total: 292, limit: 200, truncated: true }).truncated, true);
  assert.deepEqual(listMeta({ data: [] }), { total: null, limit: null, truncated: false });
});

/* ── Local matching ────────────────────────────────────────────────────────── */

test('every typed token must appear — not just the whole string', () => {
  // "acme mum" finds "Acme Traders / Mumbai", which a single-substring match
  // cannot. That is most of what a two-line row is FOR.
  const hay = ['Acme Traders', 'Mumbai'];
  assert.equal(localMatch(hay, 'acme mum'), true);
  assert.equal(localMatch(hay, 'acme delhi'), false);
  assert.equal(localMatch(hay, ''), true);
});

test('the local filter matches only the declared haystack, never an id', () => {
  // Matching every string field on a row would let somebody find a person by
  // pasting their uuid — and would then show a picker whose only row looks
  // unrelated to what was typed.
  const rows = [{ id: UUID, name: 'Priya Nair', company: 'Acme' }];
  assert.equal(localFilter(rows, contactSource(), 'priya').length, 1);
  assert.equal(localFilter(rows, contactSource(), UUID).length, 0);
});

test('the local filter is case-folded', () => {
  const rows = [{ id: 'a', name: 'ACME Traders' }];
  assert.equal(localFilter(rows, clientSource(), 'acme').length, 1);
});

/* ── The sentences ─────────────────────────────────────────────────────────── */

const NOUN = { one: 'contact', many: 'contacts' };

test('a complete list says nothing at all', () => {
  const n = truncationNotice({
    meta: { total: 12, limit: 200, truncated: false },
    shown: 12, query: '', offline: false, noun: NOUN,
  });
  assert.equal(n.text, null);
});

test('a truncated list with nothing typed says how many, and what to do', () => {
  const n = truncationNotice({
    meta: { total: 292, limit: 200, truncated: true },
    shown: 50, query: '', offline: false, noun: NOUN,
  });
  assert.match(n.text ?? '', /292/);
  assert.match(n.text ?? '', /type to search/i);
  assert.equal(n.tone, 'info');
});

test('a truncated list WITH a query is a warning, not a note', () => {
  // The answer on screen is not the whole answer to the question that was
  // asked. That is a different thing from a long list not being fully shown.
  const n = truncationNotice({
    meta: { total: 400, limit: 200, truncated: true },
    shown: 50, query: 'sharma', offline: false, noun: NOUN,
  });
  assert.equal(n.tone, 'warn');
});

test('offline outranks everything the cached page claimed about itself', () => {
  // The cached page's own `truncated: false` was true of the page, not of the
  // search: it was fetched unsearched and capped at 200 by the same LIMIT. The
  // honest sentence is that the SEARCH is partial.
  const n = truncationNotice({
    meta: { total: 200, limit: 200, truncated: false },
    shown: 3, query: 'sharma', offline: true, noun: NOUN,
  });
  assert.equal(n.tone, 'warn');
  assert.match(n.text ?? '', /offline/i);
  assert.match(n.text ?? '', /may be missing/i);
});

test('the offline sentence counts in the source’s own noun, singular and plural', () => {
  const one = truncationNotice({
    meta: { total: null, limit: null, truncated: false },
    shown: 1, query: 'x', offline: true, noun: NOUN,
  });
  assert.match(one.text ?? '', /1 saved contact\b/);
});

/* ── Cache keys ────────────────────────────────────────────────────────────── */

test('the param signature is order-independent', () => {
  // `{a,b}` and `{b,a}` are the same request. `JSON.stringify` preserves
  // insertion order and would mint two cache entries for one list.
  const a: EntitySource = { ...contactSource(), staticParams: { z: 1, a: 2 } };
  const b: EntitySource = { ...contactSource(), staticParams: { a: 2, z: 1 } };
  assert.equal(paramSignature(a), paramSignature(b));
  assert.equal(paramSignature(contactSource()), '');
});

test('each source keys on the prefix the screens already invalidate', () => {
  // A delta sync invalidates `['graha','contacts']`; react-query matches by
  // prefix, so the picker's cache is reached without `sessionSync` knowing
  // pickers exist. A key that does not match is a picker that silently serves
  // a stale list for two hours.
  assert.deepEqual(contactSource().queryKey, ['graha', 'contacts']);
  assert.deepEqual(clientSource().queryKey, ['graha', 'clients']);
  assert.deepEqual(productSource().queryKey, ['ganit', 'products']);
  assert.deepEqual(assigneeSource('team-1').queryKey, ['members', 'team-1']);
});

test('the assignee source is scoped to ONE project', () => {
  // An org-wide list would let a form assign a task to somebody who cannot open
  // the board it is on. `NewTaskSheet` reads the same endpoint for the same
  // reason.
  assert.equal(assigneeSource('team-1').url, '/teams/team-1');
});
