/**
 * The idempotency key on the offline mutation queue.
 *
 * These are REAL tests: `offline/mutationQueue.ts` and `lib/storage.ts` execute
 * unmodified. Only the native bindings underneath them are replaced (MMKV,
 * crypto) plus `api/client`, which is stubbed so the suite has no transport at
 * all — see `src/test/register.mjs`.
 *
 * ── What is being protected ───────────────────────────────────────────────────
 *
 * A retried POST makes a second invoice, a second deal, a second task, and
 * nothing afterwards can tell the two apart. The key is the only thing standing
 * between "the response was lost" and "the customer was billed twice". Every
 * test below is a way the key could stop doing that job:
 *
 *   · it could be absent           (a create goes out unprotected)
 *   · it could change on retry     (attempt two is a stranger to the server)
 *   · it could not survive a restart
 *   · it could be shared by two different creates (a squash)
 *   · it could stop being sent     (the header quietly dropped)
 *   · the create could be sent after the server has forgotten it
 *
 * ── What these tests CANNOT show ──────────────────────────────────────────────
 *
 * That the header reaches the wire. The shared `api/client` stub records
 * method, url and body only — it does not capture the config argument, and that
 * stub is not this change's to edit. So the header is asserted through
 * `requestConfigFor`, the pure function `dispatch` builds it with. If somebody
 * changed `dispatch` to stop passing that config, these tests would still pass.
 * Closing that gap means teaching the stub to record its third argument.
 *
 * NOTHING ON THE SERVER HONOURS ANY OF THIS YET. `backend/migrations/
 * 186_idempotency.sql` is written and NOT applied, and no endpoint reads the
 * header. These tests pin the client half so that the server half has something
 * fixed to be built against.
 */

import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import {
  CREATE_MAX_AGE_MS,
  EXPIRED_MESSAGE,
  IDEMPOTENCY_HEADER,
  clearFailedMutations,
  clearQueue,
  discardFailedMutation,
  enqueueMutation,
  flushQueue,
  friendlyFlushError,
  getFailedCount,
  getFailedMutations,
  getQueueCount,
  getQueuedMutations,
  newIdempotencyKey,
  requestConfigFor,
} from '../../offline/mutationQueue.ts';
import type { MutationQueueItem } from '../types.ts';
import { storage } from '../../lib/storage.ts';
import { readCode, readRaw, srcPath } from '../../test/source.ts';
import { __resetStorage } from '../../test/stubs/react-native-mmkv.ts';
import { __resetCrypto } from '../../test/stubs/expo-crypto.ts';
import { __resetNet, __goOffline, __failWith, net } from '../../test/stubs/api-client.ts';

const QUEUE_KEY = 'mutation_queue';
const DAY = 24 * 60 * 60 * 1000;

beforeEach(() => {
  __resetStorage();
  __resetCrypto();
  __resetNet();
});

/** The one queued item, when a test has arranged for exactly one. */
function only() {
  const q = getQueuedMutations();
  assert.equal(q.length, 1, `expected exactly one queued item, found ${q.length}`);
  return q[0];
}

/** Rewrite the persisted `created_at` of every queued item, ageing the queue. */
function ageQueueBy(ms: number): void {
  const q = getQueuedMutations().map(i => ({
    ...i,
    created_at: new Date(new Date(i.created_at).getTime() - ms).toISOString(),
  }));
  storage.set(QUEUE_KEY, JSON.stringify(q));
}

// ── The key exists at all ─────────────────────────────────────────────────────

test('a queued create carries an idempotency key', () => {
  enqueueMutation({ method: 'POST', url: '/tasks', body: { title: 'File GSTR-3B' }, entity_type: 'task' });

  const key = only().idempotency_key;
  assert.ok(key, 'a create with no key is the whole defect: a retry makes a second task');
  assert.match(key as string, /^[0-9a-f-]{36}$/, 'a UUID, which is what the server CHECK expects the shape of');
});

test('every method gets a key, not only POST', () => {
  // A replayed DELETE that succeeded the first time 404s on the second, and the
  // queue reports "That item no longer exists" for something that in fact
  // worked. One rule for four methods is cheaper than a table of exceptions.
  enqueueMutation({ method: 'PATCH',  url: '/tasks/t_1', body: { status: 'done' } });
  enqueueMutation({ method: 'PUT',    url: '/tasks/t_2', body: { title: 'x' } });
  enqueueMutation({ method: 'DELETE', url: '/tasks/t_3' });

  for (const item of getQueuedMutations()) {
    assert.ok(item.idempotency_key, `${item.method} ${item.url} went out unkeyed`);
  }
});

test('two keys minted in a row are different', () => {
  assert.notEqual(newIdempotencyKey(), newIdempotencyKey());
});

// ── The key goes out on the wire ──────────────────────────────────────────────

test('the request config carries the key under Idempotency-Key', () => {
  enqueueMutation({ method: 'POST', url: '/tasks', body: { title: 'a' } });
  const item = only();

  const cfg = requestConfigFor(item);
  assert.equal(cfg.headers[IDEMPOTENCY_HEADER], item.idempotency_key);
  assert.equal(IDEMPOTENCY_HEADER, 'Idempotency-Key', 'the name in the IETF draft; migration 186 names the same one');
});

test('an item with no key sends no header rather than an empty one', () => {
  // Migration 186 refuses a key shorter than 16 characters, so an empty header
  // would be rejected by the server as malformed — which is a worse outcome
  // than the request simply not claiming to be idempotent.
  const legacy: MutationQueueItem = {
    id: 'i1', method: 'PATCH', url: '/tasks/t_1', created_at: new Date().toISOString(), retries: 0,
  };
  const cfg = requestConfigFor(legacy);
  assert.deepEqual(cfg.headers, {});
});

test('dispatch is the only caller of requestConfigFor, and it passes it to all four verbs', () => {
  // A source-contract assertion, and the reason is in this file's header: the
  // shared api-client stub does not record the config argument, so a `dispatch`
  // that quietly stopped passing it would break nothing else here.
  const code = readCode('offline/mutationQueue.ts');
  assert.match(code, /const config = requestConfigFor\(item\)/);
  for (const call of ['post(url, body, config)', 'put(url, body, config)',
                      'patch(url, body, config)', 'delete(url, config)']) {
    assert.ok(code.includes(call), `dispatch no longer passes the config to ${call}`);
  }
});

// ── The key is stable across retries and restarts ─────────────────────────────

test('the key does not change when a flush fails and the item is re-queued', async () => {
  enqueueMutation({ method: 'POST', url: '/tasks', body: { title: 'File GSTR-3B' } });
  const before = only().idempotency_key;

  __goOffline();
  await flushQueue();

  const after = only();
  assert.equal(after.retries, 1, 'the item was retried, so this test is exercising what it claims');
  assert.equal(after.idempotency_key, before,
    'regenerating on retry restores the exact bug the key exists to remove');
});

test('the key is the same on all four attempts', async () => {
  enqueueMutation({ method: 'POST', url: '/tasks', body: { title: 'a' } });
  const key = only().idempotency_key;

  __goOffline();
  await flushQueue();
  assert.equal(only().idempotency_key, key);
  await flushQueue();
  assert.equal(only().idempotency_key, key);
  await flushQueue();
  assert.equal(only().idempotency_key, key);

  // The fourth failure exhausts it; the key travels into the dead letter too.
  await flushQueue();
  assert.equal(getQueueCount(), 0);
  assert.equal(getFailedMutations()[0].item.idempotency_key, key);
});

test('the key survives an app restart', async () => {
  enqueueMutation({ method: 'POST', url: '/tasks', body: { title: 'a' } });
  const key = only().idempotency_key;

  __goOffline();
  await flushQueue();

  // A restart is exactly this: the module's in-memory state is gone and the
  // only thing left is MMKV. Read it raw rather than through the module, so the
  // assertion is about what was PERSISTED and not about a variable.
  const raw = JSON.parse(storage.getString(QUEUE_KEY) as string);
  assert.equal(raw.length, 1);
  assert.equal(raw[0].idempotency_key, key);
});

// ── Squashing: safe for PATCH, refused for POST ───────────────────────────────

test('two creates to the same URL are two entries with two different keys', () => {
  // The reason squashing must not reach a POST: these are two different tasks
  // that happen to share an endpoint. Collapsing them destroys one with no
  // trace — the user typed two things and one silently never existed.
  enqueueMutation({ method: 'POST', url: '/tasks', body: { title: 'File GSTR-3B' } });
  enqueueMutation({ method: 'POST', url: '/tasks', body: { title: 'Renew DSC' } });

  const q = getQueuedMutations();
  assert.equal(q.length, 2, 'a create was squashed away');
  assert.notEqual(q[0].idempotency_key, q[1].idempotency_key,
    'two creates sharing a key means the server executes only one of them');
  assert.deepEqual(q.map(i => (i.body as { title: string }).title), ['File GSTR-3B', 'Renew DSC']);
});

test('two deletes to the same URL are not squashed either', () => {
  enqueueMutation({ method: 'DELETE', url: '/tasks/t_1' });
  enqueueMutation({ method: 'DELETE', url: '/tasks/t_1' });
  assert.equal(getQueueCount(), 2);
});

test('two patches to the same URL still squash, and the merged entry is re-keyed', () => {
  // Safe precisely because PATCH is idempotent by URL: re-running the earlier
  // body and then the later one converges on the later one. The NEW key is the
  // point — the old key may already be bound server-side to the old bytes, and
  // sending changed bytes under it is a 422 that would throw the user's newer
  // edit away while the server kept the older value.
  enqueueMutation({ method: 'PATCH', url: '/tasks/t_1', body: { status: 'done' } });
  const first = only().idempotency_key;

  enqueueMutation({ method: 'PATCH', url: '/tasks/t_1', body: { priority: 'high' } });

  const merged = only();
  assert.deepEqual(merged.body, { status: 'done', priority: 'high' });
  assert.notEqual(merged.idempotency_key, first, 'the body changed, so the request did');
});

test('a squash that changes nothing keeps the key', () => {
  enqueueMutation({ method: 'PATCH', url: '/tasks/t_1', body: { status: 'done' } });
  const first = only().idempotency_key;

  enqueueMutation({ method: 'PATCH', url: '/tasks/t_1', body: { status: 'done' } });

  assert.equal(only().idempotency_key, first, 'identical bytes are the same request');
});

test('a patch does not squash into a create at the same URL', () => {
  enqueueMutation({ method: 'POST',  url: '/tasks', body: { title: 'a' } });
  enqueueMutation({ method: 'PATCH', url: '/tasks', body: { title: 'b' } });
  assert.equal(getQueueCount(), 2, 'the squash matches on method as well as URL');
});

// ── Dedup by optimistic_id: the caller's own collapse ─────────────────────────

test('revising a draft create in place keeps its key', () => {
  // The caller opted in by supplying a stable optimistic_id, whose documented
  // meaning is "this is the same logical write". Carrying the key over is what
  // stops the revision becoming a second create.
  enqueueMutation({ method: 'POST', url: '/tasks', body: { title: 'Draft' }, optimistic_id: 'draft_1' });
  const key = only().idempotency_key;

  enqueueMutation({ method: 'POST', url: '/tasks', body: { title: 'Draft, revised' }, optimistic_id: 'draft_1' });

  const after = only();
  assert.equal(after.idempotency_key, key, 'a create must never be re-keyed');
  assert.deepEqual(after.body, { title: 'Draft, revised' });
});

test('a revised PATCH under one optimistic_id is re-keyed', () => {
  enqueueMutation({ method: 'PATCH', url: '/tasks/t_1', body: { status: 'done' }, optimistic_id: 'o1' });
  const key = only().idempotency_key;

  enqueueMutation({ method: 'PATCH', url: '/tasks/t_1', body: { status: 'todo' }, optimistic_id: 'o1' });

  assert.notEqual(only().idempotency_key, key);
});

test('an optimistic_id reused across two different endpoints does not merge them', () => {
  // A caller bug either way, but merging a create into a delete turns the bug
  // into a wrong request. Queueing both is worse for nobody.
  enqueueMutation({ method: 'POST',   url: '/tasks',     body: { title: 'a' }, optimistic_id: 'shared' });
  enqueueMutation({ method: 'DELETE', url: '/tasks/t_1',                       optimistic_id: 'shared' });

  const q = getQueuedMutations();
  assert.equal(q.length, 2);
  assert.notEqual(q[0].idempotency_key, q[1].idempotency_key);
});

// ── Items written by an older build ───────────────────────────────────────────

test('an item persisted without a key is given one before its first dispatch', async () => {
  // Written straight into MMKV in the pre-idempotency shape. Minting lazily at
  // READ time would hand out a different key on every read, which is worse than
  // having none; it has to be minted once and persisted.
  storage.set(QUEUE_KEY, JSON.stringify([{
    id: 'legacy_1', method: 'PATCH', url: '/tasks/t_1', body: { status: 'done' },
    created_at: new Date().toISOString(), retries: 0,
  }]));

  __goOffline();
  await flushQueue();

  const after = only();
  assert.ok(after.idempotency_key, 'the legacy item was never backfilled');
  assert.equal(after.retries, 1);

  const key = after.idempotency_key;
  await flushQueue();
  assert.equal(only().idempotency_key, key, 'the backfilled key is itself stable');
});

// ── The six-day ceiling ───────────────────────────────────────────────────────

test('the client ceiling is inside the server TTL', () => {
  // Migration 186 sets expires_at to NOW() + 7 days. If these ever met, there
  // would be a window in which the client believes it is protected and the
  // server has already forgotten the key.
  assert.equal(CREATE_MAX_AGE_MS, 6 * DAY);
  assert.ok(CREATE_MAX_AGE_MS < 7 * DAY, 'the 24-hour margin is the point');
});

test('a create older than the ceiling is never sent', async () => {
  enqueueMutation({ method: 'POST', url: '/tasks', body: { title: 'File GSTR-3B' } });
  ageQueueBy(CREATE_MAX_AGE_MS + 1000);

  const result = await flushQueue();

  assert.equal(net.calls.length, 0,
    'it must not be DISPATCHED — sending and hoping is the unprotected replay this guards');
  assert.equal(result.failed.length, 1);
  assert.equal(result.failed[0].permanent, true);
  assert.equal(result.failed[0].reason, 'expired');
  assert.equal(result.failed[0].error, EXPIRED_MESSAGE);
  assert.equal(getQueueCount(), 0);
});

test('an expired create is kept, not dropped', async () => {
  enqueueMutation({ method: 'POST', url: '/tasks', body: { title: 'File GSTR-3B' } });
  ageQueueBy(CREATE_MAX_AGE_MS + 1000);
  await flushQueue();

  const dead = getFailedMutations();
  assert.equal(dead.length, 1);
  assert.equal(dead[0].reason, 'expired');
  assert.deepEqual(dead[0].item.body, { title: 'File GSTR-3B' },
    'the queue entry was the only copy of what the user typed');
});

test('the ceiling applies to creates only', async () => {
  // A six-day-old PATCH is stale, but re-sending it merely writes the field the
  // user asked for. Only a create can duplicate.
  enqueueMutation({ method: 'PATCH', url: '/tasks/t_1', body: { status: 'done' } });
  ageQueueBy(CREATE_MAX_AGE_MS + 1000);

  await flushQueue();

  assert.equal(net.calls.length, 1, 'the patch was withheld');
  assert.equal(getQueueCount(), 0, 'and it succeeded');
});

test('a create just inside the ceiling is still sent', async () => {
  enqueueMutation({ method: 'POST', url: '/tasks', body: { title: 'a' } });
  ageQueueBy(CREATE_MAX_AGE_MS - 60_000);

  await flushQueue();

  assert.equal(net.calls.length, 1);
  assert.equal(getFailedCount(), 0);
});

test('an unparseable created_at does not cost the user their work', async () => {
  // A bug in whatever wrote the timestamp must not be paid for by deleting a
  // create. Treated as fresh and sent.
  enqueueMutation({ method: 'POST', url: '/tasks', body: { title: 'a' } });
  const q = getQueuedMutations().map(i => ({ ...i, created_at: 'not a date' }));
  storage.set(QUEUE_KEY, JSON.stringify(q));

  await flushQueue();

  assert.equal(net.calls.length, 1);
  assert.equal(getFailedCount(), 0);
});

test('the message the user is shown survives friendlyFlushError intact', () => {
  // It contains the word "safely", and one careless future pattern would shred
  // a precise explanation into "Can't reach the server."
  assert.equal(friendlyFlushError(EXPIRED_MESSAGE), EXPIRED_MESSAGE);
  assert.match(EXPIRED_MESSAGE, /6 days/);
});

// ── Permanent failure: moved, never dropped ───────────────────────────────────

test('a create the server refuses is kept rather than discarded', async () => {
  enqueueMutation({ method: 'POST', url: '/tasks', body: { title: 'File GSTR-3B' } });
  __failWith(422);

  const result = await flushQueue();

  assert.equal(result.failed[0].permanent, true);
  assert.equal(result.failed[0].reason, 'rejected');
  assert.equal(getQueueCount(), 0, 'it left the live queue');
  assert.equal(getFailedCount(), 1, 'and landed in the dead letter, not on the floor');
  assert.deepEqual(getFailedMutations()[0].item.body, { title: 'File GSTR-3B' });
});

test('a rate-limited item is retried, not given up on', async () => {
  enqueueMutation({ method: 'POST', url: '/tasks', body: { title: 'a' } });
  __failWith(429);

  const result = await flushQueue();

  assert.equal(result.failed[0].permanent, false);
  assert.equal(getQueueCount(), 1);
  assert.equal(getFailedCount(), 0);
});

test('the dead letter records why and when', async () => {
  enqueueMutation({ method: 'POST', url: '/tasks', body: { title: 'a' } });
  __failWith(403);
  await flushQueue();

  const dead = getFailedMutations()[0];
  assert.equal(dead.reason, 'rejected');
  assert.ok(Number.isFinite(new Date(dead.failed_at).getTime()), 'failed_at must be readable');
  assert.equal(friendlyFlushError(dead.error), "You don't have permission to do that.");
});

test('the dead letter survives a restart', async () => {
  enqueueMutation({ method: 'POST', url: '/tasks', body: { title: 'a' } });
  __failWith(400);
  await flushQueue();

  const raw = storage.getString('mutation_queue_failed');
  assert.ok(raw, 'the dead letter is persisted, not in memory');
  assert.equal(JSON.parse(raw as string).length, 1);
});

test('clearing the live queue does not forget what failed', async () => {
  // Two different things a user might mean. Collapsing them loses the second
  // one silently — and the second one is the copy of work that was never saved.
  enqueueMutation({ method: 'POST', url: '/tasks', body: { title: 'a' } });
  __failWith(400);
  await flushQueue();

  enqueueMutation({ method: 'PATCH', url: '/tasks/t_1', body: { status: 'done' } });
  clearQueue();

  assert.equal(getQueueCount(), 0);
  assert.equal(getFailedCount(), 1);
});

test('a dead-letter entry can be dismissed one at a time', async () => {
  enqueueMutation({ method: 'POST', url: '/tasks', body: { title: 'a' } });
  enqueueMutation({ method: 'POST', url: '/tasks', body: { title: 'b' } });
  __failWith(400);
  await flushQueue();
  assert.equal(getFailedCount(), 2);

  discardFailedMutation(getFailedMutations()[0].item.id);
  assert.equal(getFailedCount(), 1);
  assert.deepEqual(getFailedMutations()[0].item.body, { title: 'b' });

  clearFailedMutations();
  assert.equal(getFailedCount(), 0);
});

test('a successful create leaves nothing behind', async () => {
  enqueueMutation({ method: 'POST', url: '/tasks', body: { title: 'a' } });

  const result = await flushQueue();

  assert.equal(result.succeeded, 1);
  assert.equal(getQueueCount(), 0);
  assert.equal(getFailedCount(), 0, 'a success must not be recorded as a failure');
});

// ── The hook ──────────────────────────────────────────────────────────────────

test('useOfflineMutation refuses fallbackToQueue on a POST without a key', () => {
  // Cannot be exercised by import — the hook pulls in react and TanStack Query,
  // neither of which this harness can load. Read instead, per `test/source.ts`.
  const code = readCode('hooks/useOfflineMutation.ts');
  assert.match(
    code,
    /opts\.fallbackToQueue && opts\.method === 'POST' && !opts\.idempotencyKey/,
    'the guard is what stops an unkeyed create being queued after an online attempt '
    + 'whose outcome is unknown',
  );
  assert.match(code, /idempotency_key: opts\.idempotencyKey\?\.\(vars\)/,
    'the caller-supplied key must reach the queue');
});

test('the online fallback only fires when the server never answered', () => {
  const code = readCode('hooks/useOfflineMutation.ts');
  assert.match(code, /if \(err\?\.response\) throw err/,
    'any HTTP status means the server had an opinion; replaying against it is not the queue\'s call');
});

// ── The two numbers that have to agree ────────────────────────────────────────

test('the migration and the client name each other', () => {
  // Five files have carried a constant that silently drifted from its pair. The
  // cheapest guard is that each side says the other one out loud, so a grep
  // finds the second place when the first one moves.
  // readRaw, not readCode: the pairing is documented in prose, which is where a
  // person changing the number will actually be reading.
  const prose = readRaw('offline/mutationQueue.ts');
  assert.match(prose, /186_idempotency\.sql/, 'the client must name the migration it depends on');

  const sqlPath = path.join(srcPath('..'), '..', 'backend', 'migrations', '186_idempotency.sql');
  assert.ok(existsSync(sqlPath), `the migration this file depends on is missing: ${sqlPath}`);

  const sql = readFileSync(sqlPath, 'utf8');
  assert.match(sql, /CREATE_MAX_AGE_MS/,
    'the migration must name the client constant back, so moving one finds the other');
  assert.match(sql, /interval '7 days'/,
    'the server TTL. If this becomes 6 days or less, CREATE_MAX_AGE_MS is no longer inside it '
    + 'and there is a window where the client thinks it is protected and the server has forgotten.');
});
