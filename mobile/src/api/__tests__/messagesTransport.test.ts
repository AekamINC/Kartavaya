/**
 * What `api/messages.ts` actually puts on the wire, and the proof that "on the
 * wire" here means a stub and not a socket.
 *
 * ── WHY THIS IS A SECOND FILE
 *
 * `__tests__/messages.test.ts` covers what `messages.ts` decides BEFORE a
 * request exists, and its header explains why it stopped there: the resolve hook
 * in `src/test/register.mjs` matched `'../api/client'` or a specifier ending in
 * `/api/client`, and every module in `src/api/` imports its sibling as
 * `'./client'`. That matched neither, so this directory loaded the real axios
 * instance — base URL falling back to the staging deployment, which shares a
 * Supabase database with production. Calling anything from a test would have
 * written a real row.
 *
 * The hook now decides on the RESOLVED PATH, so `'./client'` is stubbed like
 * everything else. The three things that file listed as "asserted by nothing"
 * are asserted here. It is a new file rather than an addition to that one
 * because that one belongs to another agent.
 *
 * ── WHY THERE IS A LOCAL SPY
 *
 * `stubs/api-client.ts` records method, url and body; `record()` drops axios's
 * third argument entirely. Every clamp below lives in `params`, so `sent()`
 * wraps the two verbs for the duration of one call and hands back what was
 * going to leave. It is the same double the rest of the suite uses, recording
 * one more field — the module under test runs unmodified either way.
 */

import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  messagesApi,
  type MentionsReadIn,
  type SearchHit,
  type SearchPage,
} from '../messages.ts';
// The specifier the app itself writes. Routed by the hook, and the whole point
// of the first test below.
import { apiClient as appClient } from '../client.ts';
import { apiClient as stubClient, net, __resetNet } from '../../test/stubs/api-client.ts';

const CHANNEL = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';
const MENTION = '9c858901-8a57-4791-81fe-4c455b099bc9';
const OTHER   = '0e1b8a52-2b6f-4a1c-9c4f-2f3d5e6a7b8c';

beforeEach(() => { __resetNet(); });

/* ── The harness itself ─────────────────────────────────────────────────────
 *
 * Everything below is only meaningful if these two pass. They are the
 * regression test for the resolve hook: revert it and this file starts issuing
 * real requests against a real database, silently, while still reporting green.
 */

test('src/api/ resolves `./client` to the transport-free stub, not to axios', () => {
  assert.equal(appClient, stubClient, '`./client` did not reach src/test/stubs/api-client.ts');
  // The cheap tell, if the identity check above is ever made to pass by
  // something other than the hook.
  //
  // CHANGED 2026-08-19. It used to be `'defaults' in appClient === false`, and
  // that stopped distinguishing anything: `api/sahayak.ts` derives the streaming
  // URL from the axios instance rather than keeping a second copy of the base
  // URL, so the stub had to grow a `defaults.baseURL` — a string at a hostname
  // reserved never to resolve. An axios instance is a CALLABLE: `axios.create()`
  // returns a function with the verbs hung off it. The stub is a plain object
  // and cannot be one, which is a property no amount of shape-copying changes.
  assert.notEqual(typeof appClient, 'function', 'this is a live axios instance');
});

test('a messagesApi call lands in the stub ledger rather than on a network', async () => {
  net.handler = async () => ({ data: [] });
  await messagesApi.list(CHANNEL);
  assert.equal(net.calls.length, 1);
  assert.equal(net.calls[0].method, 'GET');
  assert.equal(net.calls[0].url, `/v1/messaging/channels/${CHANNEL}/messages`);
});

/* ── The spy ────────────────────────────────────────────────────────────────*/

/** The stub's verbs, plus the axios config argument the stub discards. */
type Verb = (url: string, ...rest: unknown[]) => Promise<{ data: unknown }>;

interface Sent {
  url:     string;
  params:  Record<string, unknown>;
  body?:   unknown;
}

/**
 * Runs `call` with `get` and `post` replaced by recorders that answer `reply`,
 * and returns both what was going to be sent and what the caller received.
 * Restored in a `finally` so a test that throws does not leave the stub
 * rewritten for the rest of the file.
 */
async function sent<T>(reply: unknown, call: () => Promise<T>): Promise<{ req: Sent; out: T }> {
  const spied = stubClient as { get: Verb; post: Verb };
  const { get, post } = spied;
  let req: Sent | undefined;

  const paramsOf = (config: unknown) =>
    (config as { params?: Record<string, unknown> } | undefined)?.params ?? {};

  spied.get  = async (url, config)       => { req = { url, params: paramsOf(config) };       return { data: reply }; };
  spied.post = async (url, body, config) => { req = { url, params: paramsOf(config), body }; return { data: reply }; };

  try {
    const out = await call();
    if (!req) throw new Error('the call under test never reached apiClient');
    return { req, out };
  } finally {
    spied.get  = get;
    spied.post = post;
  }
}

/* ── /search: the {results, more} envelope ──────────────────────────────────*/

const hit = (id: string): SearchHit => ({
  id,
  channel_id:        CHANNEL,
  content:           'the invoice went out on Tuesday',
  sender_id:         'u-1',
  created_at:        '2026-08-02T10:00:00Z',
  parent_message_id: null,
  pinned_at:         null,
  channel_name:      'accounts',
  channel_type:      'public',
  sender_name:       'Asha',
  sender_avatar:     null,
});

test('search resolves to the envelope itself — there is no `.data` inside it', async () => {
  const page: SearchPage = { results: [hit(MENTION)], more: true };
  const { out } = await sent(page, () => messagesApi.search({ q: 'invoice' }));

  // THE TRAP THIS EXISTS FOR. `search` already unwraps the axios response, so a
  // caller reaching for `.data` a second time gets `undefined`, `?? []` turns
  // that into a zero-result screen, and nothing anywhere reports an error. It
  // has already fooled one test into accusing the product of losing a message.
  assert.equal((out as unknown as { data?: unknown }).data, undefined);
  assert.equal(Array.isArray(out), false, 'not a bare array either');

  assert.deepEqual(out, page);
  assert.equal(out.results.length, 1);
  assert.equal(out.more, true);
});

test('search reports exhaustion through `more`, and carries no total to render', async () => {
  const { out } = await sent({ results: [], more: false }, () => messagesApi.search({ q: 'zz' }));
  assert.deepEqual(out.results, []);
  assert.equal(out.more, false);
  // `more` comes from a LIMIT n+1 look-ahead, not a COUNT. A "showing 10 of 84"
  // header cannot be built from this response.
  assert.equal('total' in out, false);
});

test('search clamps limit and offset, and drops a channel filter that is not a uuid', async () => {
  const q = async (p: Parameters<typeof messagesApi.search>[0]) =>
    (await sent({ results: [], more: false }, () => messagesApi.search(p))).req;

  const dflt = await q({ q: 'invoice' });
  assert.equal(dflt.url, '/v1/messaging/search');
  assert.equal(dflt.params.limit, 25);
  assert.equal(dflt.params.offset, 0);

  assert.equal((await q({ q: 'x', limit: 0 })).params.limit, 1);
  assert.equal((await q({ q: 'x', limit: 900 })).params.limit, 50);
  // The server hard-caps offset at 500; sending more is a 422 the friendly-error
  // path in client.ts cannot phrase, because FastAPI sends `detail` as an array.
  assert.equal((await q({ q: 'x', offset: -5 })).params.offset, 0);
  assert.equal((await q({ q: 'x', offset: 9999 })).params.offset, 500);

  // A bad channel_id is DROPPED by the server rather than refused, so a search
  // that was meant to be scoped would quietly run across every channel the
  // caller can read. It is dropped here instead, where the caller can see it.
  assert.equal((await q({ q: 'x', channelId: 'not-a-uuid' })).params.channel_id, undefined);
  assert.equal((await q({ q: 'x', channelId: CHANNEL })).params.channel_id, CHANNEL);
});

/* ── list: the before / limit clamps ────────────────────────────────────────*/

const listParams = async (params?: { before?: string; limit?: number }) =>
  (await sent([], () => messagesApi.list(CHANNEL, params))).req.params;

test('list drops a `before` cursor that is not a uuid instead of 500ing on it', async () => {
  // Unguarded on the server: a malformed value reaches `$3::uuid`, asyncpg
  // raises DataError, and the user gets "Something went wrong on our end" for
  // what is really a stale cursor. These are the values a real cursor goes bad
  // as — an optimistic id, a cleared state, a paste with whitespace.
  for (const bad of ['', 'optimistic-1', `${CHANNEL} `, CHANNEL.slice(0, 30)]) {
    assert.equal((await listParams({ before: bad })).before, undefined, `sent ${JSON.stringify(bad)}`);
  }
});

test('list passes a valid `before` through untouched — it is a message id, not a time', async () => {
  const p = await listParams({ before: MENTION });
  assert.equal(p.before, MENTION);
});

test('list defaults to 50 and clamps limit into 1..100', async () => {
  // A negative or zero limit is a 500, not an empty page, and anything above
  // 100 is silently truncated server-side — so the clamp is what makes the
  // "end of feed is a short page" rule mean anything to the caller.
  assert.equal((await listParams()).limit, 50);
  assert.equal((await listParams({ limit: 0 })).limit, 1);
  assert.equal((await listParams({ limit: -20 })).limit, 1);
  assert.equal((await listParams({ limit: 101 })).limit, 100);
  assert.equal((await listParams({ limit: 5000 })).limit, 100);
  assert.equal((await listParams({ limit: 20 })).limit, 20, 'a value in range must survive');
});

test('list omits `before` entirely on the first page rather than sending null', async () => {
  // axios drops an undefined param; a null would be serialised as the string
  // "null" and reach `$3::uuid` as a DataError.
  const p = await listParams();
  assert.equal('before' in p, true);
  assert.equal(p.before, undefined);
});

/* ── markMentionsRead: the three body shapes ────────────────────────────────*/

const readBody = async (body: MentionsReadIn) =>
  (await sent({ ok: true, updated: 0 }, () => messagesApi.markMentionsRead(body))).req;

test('markMentionsRead shape 1 — an explicit list of mention ids', async () => {
  const req = await readBody({ mention_ids: [MENTION, OTHER] });
  assert.equal(req.url, '/v1/messaging/mentions/read');
  assert.deepEqual(req.body, { mention_ids: [MENTION, OTHER] });
});

test('markMentionsRead shape 2 — mark_all, unscoped', async () => {
  assert.deepEqual((await readBody({ mark_all: true })).body, { mark_all: true });
});

test('markMentionsRead shape 3 — mark_all scoped to one channel', async () => {
  assert.deepEqual(
    (await readBody({ mark_all: true, channel_id: CHANNEL })).body,
    { mark_all: true, channel_id: CHANNEL },
  );
});

test('markMentionsRead builds the body itself and carries nothing else across', async () => {
  // `channel_id` is only ever a modifier on `mark_all`. Passed beside
  // `mention_ids` it is dropped, because the ids are already the scope — and a
  // caller who believed it narrowed them would have been marking by id anyway.
  assert.deepEqual((await readBody({ mention_ids: [MENTION], channel_id: OTHER })).body,
    { mention_ids: [MENTION] });
  // `mark_all: false` is not `mark_all`. Neither it nor its channel is sent.
  assert.deepEqual((await readBody({ mark_all: false, channel_id: CHANNEL })).body, {});
});

test('markMentionsRead strips a mention id that is not a uuid before sending', async () => {
  // The request still goes, and updates nothing — but the malformed id never
  // leaves the device, which is the half that matters: the server drops what it
  // cannot parse and runs the UPDATE on what is left.
  assert.deepEqual((await readBody({ mention_ids: [MENTION, 'oops', ''] })).body,
    { mention_ids: [MENTION] });
});
