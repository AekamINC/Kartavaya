/**
 * Source contracts — for the two decisions that cannot be reached any other way.
 *
 * `EntityPicker.tsx` is JSX, and `src/test/register.mjs` cannot load it: Node
 * strips types but does not transform JSX. `offline/sessionSync.ts` is plain
 * `.ts` but pulls in the network client, MMKV and the react-query client, so it
 * cannot be imported here either — which is precisely why the cursor arithmetic
 * was split into `offline/deltaCursor.ts` in the first place.
 *
 * So these read the files as TEXT. That is the weaker instrument described at
 * the top of `src/test/source.ts`, and it is used the way that file prescribes:
 * to pin specific line-level decisions so that deleting one turns the suite red.
 * It proves nothing about what renders.
 *
 * ── A NOTE ON WHERE THIS FILE LIVES ──────────────────────────────────────────
 *
 * The `DELTA_SOURCES` assertions belong in `offline/__tests__/`, next to
 * `deltaCursor.test.ts`. They are here because this directory was the one this
 * change owned while two other agents were working inside `mobile/` at the same
 * time. Move them when the tree is quiet.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { readCode } from '../../../test/source.ts';

const PICKER = readCode('components/pickers/EntityPicker.tsx');
const SYNC   = readCode('offline/sessionSync.ts');

/* ── The picker ────────────────────────────────────────────────────────────── */

test('the search query is never persisted to MMKV', () => {
  // The key carries the debounced string, and `offline/queryClient`'s EPHEMERAL
  // exclusion only covers keys beginning `['messaging', …]`. Without `gcTime: 0`
  // every query anybody ever typed is serialised into the single `rq_cache` MMKV
  // string and held for the full two-hour maxAge — one disk entry per keystroke,
  // written on a 1-second throttle on the JS thread. At zero the entry dies with
  // its observer, so at most ONE search result is ever on disk.
  assert.match(PICKER, /gcTime:\s*0/);
});

test('both queries forward the abort signal to axios', () => {
  // Two `signal` forwards: the base page and the search. A superseded query is
  // then genuinely aborted rather than merely ignored — which matters on the
  // connection where the debounce did not save us.
  const forwards = PICKER.match(/signal\s*[,}]/g) ?? [];
  assert.ok(forwards.length >= 2, `expected both queries to pass signal, saw ${forwards.length}`);
});

test('offline is decided on isError, never on missing data', () => {
  // A query in flight has no data either. Calling that "offline" flashes the
  // warning on every keystroke, ahead of the rows it stands in for — the same
  // distinction `MentionInput` draws with `isSuccess`.
  assert.match(PICKER, /const offline\s*=\s*askServer\s*&&\s*search\.isError/);
});

test('the picker draws a label and never an id', () => {
  // The rows render `item.label` and `item.sublabel`; `item.id` appears only as
  // a key, in the row lookup, and in the selected comparison. `toOptions` has
  // already refused to put a uuid in either field — this guards the renderer
  // from growing a third one.
  const drawn = PICKER.match(/\{\s*(item|opt)\.[a-z]+\s*\}/g) ?? [];
  for (const d of drawn) {
    assert.ok(!/\.id\s*\}/.test(d), `an id reaches the screen: ${d}`);
  }
});

test('the create affordance is a prop, not a built-in', () => {
  // The picker offers the button and hands back what was typed; what a new
  // record COSTS — a company, a rate, a GST class — belongs to the form that
  // owns the entity. A picker that posted its own would be writing rows nobody
  // reviewed.
  assert.match(PICKER, /onCreate\?:\s*\(typed: string\) => void/);
  assert.ok(!/apiClient\.post/.test(PICKER), 'the picker must not write');
});

/* ── The delta sources ─────────────────────────────────────────────────────── */

test('all nine `?since=` lists are consumed', () => {
  // Five of these were unconsumed: the backend answered a delta and the app
  // never asked, so every screen reading them did a FULL refetch on every open.
  for (const url of [
    '/tasks',
    '/teams',
    '/v1/graha/deals',
    '/v1/ganit/invoices',
    '/v1/graha/clients',
    '/v1/graha/contacts',
    '/v1/graha/activities',
    '/v1/graha/follow-ups',
    '/v1/vikray/orders',
  ]) {
    assert.ok(SYNC.includes(`'${url}'`), `DELTA_SOURCES is missing ${url}`);
  }
});

test('the shared cursor is still the FLOOR of what each source covered', () => {
  // Adding five sources slows the cursor to the laggiest list, and that is the
  // design: a source left mid-window holds the others back so that nothing is
  // declared covered which nobody fetched. `Math.max`, or a cursor per source,
  // moves past rows that are then invisible for ever with no error anywhere.
  assert.match(SYNC, /rememberSyncedAt\(coveredFloor\(covered\)\)/);
  assert.ok(!/Math\.max/.test(SYNC), 'the cursor must never take the largest covered point');
});

test('the page budget per source is still bounded', () => {
  // Driven by a server response. `while (truncated)` would let a bug at either
  // end spin forever on a user’s data connection — now across nine sources
  // rather than four.
  assert.match(SYNC, /const MAX_PAGES = 10/);
  assert.match(SYNC, /page < MAX_PAGES/);
});

test('the push still happens before the pull', () => {
  // Pull first and the server's version of a row overwrites the local edit that
  // has not reached it yet. Nine sources make the pull longer, not later.
  const push = SYNC.indexOf('flushQueue()');
  const pull = SYNC.indexOf('for (const src of DELTA_SOURCES)');
  assert.ok(push > 0 && pull > push, 'flushQueue must run before the delta loop');
});
