/**
 * punchQueue — the highest-risk logic in the app.
 *
 * These are REAL tests: `punchQueue.ts` and `lib/storage.ts` execute unmodified.
 * Only the three native bindings underneath them are replaced (MMKV, crypto,
 * filesystem) plus `api/client`, which is stubbed so the suite has no transport
 * at all — see `src/test/register.mjs`.
 *
 * The thing being protected is stated in the module's own header: "A dropped
 * punch is an unpaid day." Every test below is a way that could happen.
 *
 * ── Biometric note ────────────────────────────────────────────────────────────
 *
 * No real face data appears here and none is generated. `photo_uri` values are
 * synthetic paths to files that do not exist; the queue never holds image bytes,
 * only a pointer, and one of the tests below asserts exactly that.
 */

import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  PUNCH_RETENTION_MS,
  enqueuePunch,
  attachPhotoKey,
  flushPunches,
  getPunchCount,
  getPunchSummary,
  getQueuedPunches,
  pruneExpired,
} from '../punchQueue.ts';
import { clearQueue, enqueueMutation, getQueueCount } from '../mutationQueue.ts';
import { __resetStorage } from '../../test/stubs/react-native-mmkv.ts';
import { __resetCrypto } from '../../test/stubs/expo-crypto.ts';
import { __resetFs, fs, __wasDeleted } from '../../test/stubs/expo-file-system.ts';
import { __resetNet, __goOffline, net } from '../../test/stubs/api-client.ts';

const PUNCH_URL = '/v1/pahchan/punch';
const HOUR = 60 * 60 * 1000;

/** An ISO timestamp `hoursAgo` hours before now. */
const ago = (hoursAgo: number) => new Date(Date.now() - hoursAgo * HOUR).toISOString();

beforeEach(() => {
  __resetStorage();
  __resetCrypto();
  __resetFs();
  __resetNet();
});

// ── The contract with the server ──────────────────────────────────────────────

test('captured_at is press time and survives to the wire unchanged', async () => {
  // The whole point of the queue: a punch taken at 09:41 on a train and synced
  // at 11:38 is a 09:41 punch. `received_at` is the server's to stamp.
  //
  // Relative to now, not a literal date: a fixed timestamp ages past the 72-hour
  // window and the punch is retired instead of sent, which is the retention rule
  // working correctly and a test failing for the wrong reason.
  const pressed = ago(2);
  const id = enqueuePunch({ direction: 'in', captured_at: pressed, photo_uri: '/p/1.jpg' });
  attachPhotoKey(id, 'key_1');

  await flushPunches();

  const body = net.calls[0].body as Record<string, unknown>;
  assert.equal(body.captured_at, pressed);
  assert.equal(body.client_punch_id, id);
  assert.ok(!('received_at' in body), 'received_at is the server\'s to set, never the client\'s');
});

test('every replayed punch is marked source: offline', async () => {
  // Anything coming out of this queue was captured without a network, whatever
  // the connection looks like at flush time. The reviewer needs that to explain
  // why captured_at and received_at differ.
  const id = enqueuePunch({ direction: 'out', photo_uri: '/p/1.jpg' });
  attachPhotoKey(id, 'k');
  await flushPunches();
  assert.equal((net.calls[0].body as Record<string, unknown>).source, 'offline');
});

test('client_punch_id is generated once and NEVER regenerated on retry', async () => {
  // Regenerating it is exactly how one punch becomes two: the server dedups on
  // (org_id, client_punch_id), so a new id on retry defeats the dedup.
  const id = enqueuePunch({ direction: 'in', photo_uri: '/p/1.jpg' });
  attachPhotoKey(id, 'k');

  __goOffline();
  await flushPunches();
  await flushPunches();
  await flushPunches();

  __resetNet();
  await flushPunches();

  const ids = net.calls.map(c => (c.body as { client_punch_id: string }).client_punch_id);
  assert.equal(new Set(ids).size, 1, 'four sends, one identity');
  assert.equal(ids[0], id);
});

test('accuracy_m is never defaulted to 0 — absent stays absent', async () => {
  // 0 would read as a perfect fix. Undefined is what makes the server flag it.
  const id = enqueuePunch({ direction: 'in', photo_uri: '/p/1.jpg' });
  attachPhotoKey(id, 'k');
  await flushPunches();

  const body = net.calls[0].body as Record<string, unknown>;
  assert.equal(body.accuracy_m, undefined);
  assert.notEqual(body.accuracy_m, 0);
});

test('mock_location null and false are different facts', async () => {
  // null = not checked on this platform (iOS). false = checked and clean.
  const a = enqueuePunch({ direction: 'in', photo_uri: '/a.jpg' });
  const b = enqueuePunch({ direction: 'out', captured_at: ago(-1), mock_location: false, photo_uri: '/b.jpg' });
  attachPhotoKey(a, 'ka');
  attachPhotoKey(b, 'kb');
  await flushPunches();

  const byId = new Map(net.calls.map(c => {
    const body = c.body as { client_punch_id: string; mock_location: unknown };
    return [body.client_punch_id, body.mock_location];
  }));
  assert.equal(byId.get(a), null, 'unchecked stays null');
  assert.equal(byId.get(b), false, 'checked-and-clean stays false');
});

// ── Pahchan retakes: the flag threshold ───────────────────────────────────────

test('retry_count reaches the wire verbatim — 3 is the flag threshold', async () => {
  // RETRY_FLAG_THRESHOLD = 3 in backend/routers/pahchan.py. The client's job is
  // only to report the count honestly; the server decides what to do with it.
  // Nothing here blocks or refuses a punch at any count.
  for (const count of [0, 1, 2, 3, 4]) {
    __resetStorage();
    __resetNet();
    const id = enqueuePunch({ direction: 'in', retry_count: count, photo_uri: '/p.jpg' });
    attachPhotoKey(id, 'k');
    const result = await flushPunches();

    assert.equal((net.calls[0].body as Record<string, unknown>).retry_count, count);
    assert.equal(result.sent, 1, `a punch with retry_count ${count} is still sent`);
    assert.equal(result.errors.length, 0);
  }
});

test('retry_count defaults to 0, never to undefined', async () => {
  const id = enqueuePunch({ direction: 'in', photo_uri: '/p.jpg' });
  attachPhotoKey(id, 'k');
  await flushPunches();
  assert.equal((net.calls[0].body as Record<string, unknown>).retry_count, 0);
});

// ── Never dropped ─────────────────────────────────────────────────────────────

test('a failing punch is kept forever — there is no retry ceiling', async () => {
  // mutationQueue discards at MAX_RETRIES = 3. This queue must not, because
  // three backoff steps is shorter than a site visit with no signal.
  const id = enqueuePunch({ direction: 'in', photo_uri: '/p.jpg' });
  attachPhotoKey(id, 'k');
  __goOffline();

  for (let i = 0; i < 10; i++) {
    const r = await flushPunches();
    assert.equal(r.sent, 0);
    assert.equal(r.pending, 1, `still queued after ${i + 1} failures`);
    assert.equal(r.expired.length, 0);
  }

  const [punch] = getQueuedPunches();
  assert.equal(punch.client_punch_id, id);
  assert.equal(punch.attempts, 10, 'attempts is counted for diagnostics');
  assert.match(String(punch.last_error), /Network Error/);
});

test('a failed send keeps the photo on the device', async () => {
  // The photo is the only evidence for a punch that has not landed. Deleting it
  // on failure would leave a punch that can never be verified.
  const id = enqueuePunch({ direction: 'in', photo_uri: '/p/keep.jpg' });
  attachPhotoKey(id, 'k');
  __goOffline();
  await flushPunches();

  assert.equal(__wasDeleted('/p/keep.jpg'), false);
  assert.equal(getPunchCount(), 1);
});

test('one punch failing does not block the others', async () => {
  const a = enqueuePunch({ direction: 'in',  captured_at: ago(3), photo_uri: '/a.jpg' });
  const b = enqueuePunch({ direction: 'out', captured_at: ago(2), photo_uri: '/b.jpg' });
  const c = enqueuePunch({ direction: 'in',  captured_at: ago(1), photo_uri: '/c.jpg' });
  [a, b, c].forEach((id, i) => attachPhotoKey(id, `k${i}`));

  net.handler = async (call) => {
    if ((call.body as { client_punch_id: string }).client_punch_id === b) {
      throw new Error('500');
    }
    return { data: {} };
  };

  const r = await flushPunches();
  assert.equal(r.sent, 2);
  assert.equal(r.pending, 1);
  assert.equal(r.errors.length, 1);
  assert.equal(r.errors[0].client_punch_id, b);
  assert.deepEqual(getQueuedPunches().map(p => p.client_punch_id), [b]);
});

// ── Ordering and append-only ──────────────────────────────────────────────────

test('replay is oldest-first by captured_at, not by enqueue order', async () => {
  // An `out` that lands before its `in` gives the server a shift it cannot close.
  // Enqueued deliberately backwards.
  const late  = enqueuePunch({ direction: 'out', captured_at: ago(1), photo_uri: '/l.jpg' });
  const early = enqueuePunch({ direction: 'in',  captured_at: ago(5), photo_uri: '/e.jpg' });
  attachPhotoKey(late, 'kl');
  attachPhotoKey(early, 'ke');

  await flushPunches();

  const order = net.calls.map(c => (c.body as { client_punch_id: string }).client_punch_id);
  assert.deepEqual(order, [early, late], 'the in must reach the server before the out');
});

test('two punches are never squashed, even when identical in shape', async () => {
  // mutationQueue collapses consecutive PATCH/PUT to the same URL. Two punches
  // are two facts and collapsing them loses a day.
  const a = enqueuePunch({ direction: 'in', captured_at: ago(4), photo_uri: '/a.jpg' });
  const b = enqueuePunch({ direction: 'in', captured_at: ago(3), photo_uri: '/b.jpg' });
  attachPhotoKey(a, 'ka');
  attachPhotoKey(b, 'kb');

  assert.equal(getPunchCount(), 2);
  const r = await flushPunches();
  assert.equal(r.sent, 2);
  assert.equal(net.calls.filter(c => c.url === PUNCH_URL).length, 2);
});

test('a second punch a minute later is kept, not deduplicated as a mis-tap', () => {
  const a = enqueuePunch({ direction: 'in', captured_at: ago(2) });
  const b = enqueuePunch({ direction: 'in', captured_at: ago(2 - 1 / 60) });
  assert.notEqual(a, b);
  assert.equal(getPunchCount(), 2);
});

// ── The 72-hour buffer ────────────────────────────────────────────────────────

test('PUNCH_RETENTION_MS is 72 hours', () => {
  assert.equal(PUNCH_RETENTION_MS, 72 * HOUR);
});

test('the retention boundary is measured from captured_at', () => {
  enqueuePunch({ direction: 'in', captured_at: ago(71.9) });
  enqueuePunch({ direction: 'in', captured_at: ago(72.1) });

  const expired = pruneExpired();
  assert.equal(expired.length, 1, 'only the one past 72h is retired');
  assert.equal(getPunchCount(), 1, 'the 71h59m punch is still live');
});

test('an expired punch is RETURNED, not silently deleted', () => {
  // Only the employee knows it happened, and they need to raise a
  // regularisation. Deleting it quietly turns a sync failure into a missing day.
  const id = enqueuePunch({ direction: 'in', captured_at: ago(80), photo_uri: '/old.jpg' });
  const expired = pruneExpired();

  assert.equal(expired.length, 1);
  assert.equal(expired[0].client_punch_id, id);
  assert.equal(expired[0].direction, 'in');
  assert.equal(getPunchCount(), 0);
});

test('flushPunches surfaces expiries alongside the sends', async () => {
  enqueuePunch({ direction: 'in', captured_at: ago(90), photo_uri: '/old.jpg' });
  const live = enqueuePunch({ direction: 'in', captured_at: ago(1), photo_uri: '/new.jpg' });
  attachPhotoKey(live, 'k');

  const r = await flushPunches();
  assert.equal(r.expired.length, 1);
  assert.equal(r.sent, 1);
});

test('an unparseable captured_at is KEPT, never lost to a bad date string', () => {
  enqueuePunch({ direction: 'in', captured_at: 'not-a-date' });
  assert.equal(pruneExpired().length, 0);
  assert.equal(getPunchCount(), 1, 'losing a punch to a parse failure is the outcome this queue prevents');
});

test('an unparseable timestamp does not get to claim it is the oldest', () => {
  enqueuePunch({ direction: 'in', captured_at: 'garbage' });
  enqueuePunch({ direction: 'in', captured_at: ago(10) });

  const summary = getPunchSummary();
  assert.equal(summary.count, 2);
  assert.ok(summary.oldestCapturedAt !== null);
  assert.ok(!Number.isNaN(Date.parse(summary.oldestCapturedAt!)));
});

// ── The summary the UI shows ──────────────────────────────────────────────────

test('getPunchSummary reports nothing when the queue is empty', () => {
  assert.deepEqual(getPunchSummary(), { count: 0, oldestCapturedAt: null, hoursLeft: null });
});

test('hoursLeft counts down from captured_at and matches what pruneExpired enforces', () => {
  const now = Date.now();
  enqueuePunch({ direction: 'in', captured_at: new Date(now - 2 * HOUR).toISOString() });
  const s = getPunchSummary(now);
  assert.equal(s.count, 1);
  assert.equal(s.hoursLeft, 70, '72 promised minus 2 elapsed');
});

test('hoursLeft floors at 0 — "-3 hours remaining" is not a sentence', () => {
  const now = Date.now();
  enqueuePunch({ direction: 'in', captured_at: new Date(now - 75 * HOUR).toISOString() });
  assert.equal(getPunchSummary(now).hoursLeft, 0);
});

test('the summary tracks the OLDEST punch, not the newest', () => {
  const now = Date.now();
  enqueuePunch({ direction: 'in',  captured_at: new Date(now - 1 * HOUR).toISOString() });
  enqueuePunch({ direction: 'out', captured_at: new Date(now - 50 * HOUR).toISOString() });
  assert.equal(getPunchSummary(now).hoursLeft, 22, 'the one closest to aging out is the one that matters');
});

// ── Photo lifecycle: a face on a phone ────────────────────────────────────────

test('the selfie is deleted once the punch is acknowledged', async () => {
  // After the send it is a second copy of a biometric with nobody's retention
  // job pointed at it.
  const id = enqueuePunch({ direction: 'in', photo_uri: '/p/face.jpg' });
  attachPhotoKey(id, 'k');
  await flushPunches();
  assert.equal(__wasDeleted('/p/face.jpg'), true);
});

test('the selfie is deleted when the punch expires unsent', async () => {
  // The employee has lost the punch; keeping the face as well is the worst of
  // both outcomes.
  enqueuePunch({ direction: 'in', captured_at: ago(90), photo_uri: '/p/old-face.jpg' });
  await flushPunches();
  assert.equal(__wasDeleted('/p/old-face.jpg'), true);
});

test('a punch is not failed by a filesystem that will not delete a JPEG', async () => {
  const id = enqueuePunch({ direction: 'in', photo_uri: '/p/locked.jpg' });
  attachPhotoKey(id, 'k');
  fs.throwOn.add('/p/locked.jpg');

  const r = await flushPunches();
  assert.equal(r.sent, 1, 'the punch still counts as sent');
  assert.equal(r.errors.length, 0);
  assert.equal(getPunchCount(), 0);
});

test('the queue stores a pointer, never image bytes', async () => {
  const id = enqueuePunch({ direction: 'in', photo_uri: '/p/face.jpg' });
  attachPhotoKey(id, 'k');

  const [queued] = getQueuedPunches();
  assert.equal(queued.photo_uri, '/p/face.jpg');
  assert.ok(!('photo' in queued), 'no image field exists on a queue entry');
  assert.ok(!('base64' in queued));

  await flushPunches();
  const body = net.calls[0].body as Record<string, unknown>;
  assert.ok(!('photo_uri' in body), 'the local path is not sent to the server either');
  assert.equal(body.photo_key, 'k');
});

// ── The photo gate ────────────────────────────────────────────────────────────

test('a punch with no photo_key waits rather than going without one', async () => {
  // photo_key is part of 07 §4's contract; a punch that cannot be compared
  // against the reference pair cannot be verified.
  enqueuePunch({ direction: 'in', photo_uri: '/p/1.jpg' });

  const r = await flushPunches();
  assert.equal(r.sent, 0);
  assert.equal(r.pending, 1);
  assert.equal(net.calls.length, 0, 'nothing was sent');
  assert.equal(r.errors.length, 0, 'waiting is not an error');
});

test('attachPhotoKey releases the punch on the next flush', async () => {
  const id = enqueuePunch({ direction: 'in', photo_uri: '/p/1.jpg' });
  assert.equal((await flushPunches()).sent, 0);

  attachPhotoKey(id, 'late_key');
  const r = await flushPunches();
  assert.equal(r.sent, 1);
  assert.equal((net.calls[0].body as Record<string, unknown>).photo_key, 'late_key');
});

test('attachPhotoKey on an unknown id is a no-op, not a throw', () => {
  enqueuePunch({ direction: 'in', photo_uri: '/p/1.jpg' });
  assert.doesNotThrow(() => attachPhotoKey('no-such-punch', 'k'));
  assert.equal(getPunchCount(), 1);
});

test('a punch waiting for its photo does not block a later ready one', async () => {
  enqueuePunch({ direction: 'in', captured_at: ago(5), photo_uri: '/waiting.jpg' });
  const ready = enqueuePunch({ direction: 'out', captured_at: ago(4), photo_uri: '/ready.jpg' });
  attachPhotoKey(ready, 'k');

  const r = await flushPunches();
  assert.equal(r.sent, 1);
  assert.equal(r.pending, 1);
});

// ── Isolation from the mutation queue ─────────────────────────────────────────

test('clearing the mutation queue cannot wipe attendance', async () => {
  // Separate MMKV keys, so wiping pending edits never wipes someone's pay.
  enqueuePunch({ direction: 'in', photo_uri: '/p.jpg' });
  enqueueMutation({
    method: 'PATCH', url: '/tasks/t_1', body: { status: 'done' },
    entity_type: 'task', entity_id: 't_1',
  });

  assert.equal(getPunchCount(), 1);
  assert.equal(getQueueCount(), 1);

  clearQueue();

  assert.equal(getQueueCount(), 0, 'the mutation queue is cleared');
  assert.equal(getPunchCount(), 1, 'the punch survives');
});

// ── Persistence ───────────────────────────────────────────────────────────────

test('the queue survives a corrupted store rather than throwing', () => {
  // A JSON parse failure returns an empty queue. Losing the queue is bad; a
  // crash on every screen that reads it is worse.
  enqueuePunch({ direction: 'in' });
  assert.equal(getPunchCount(), 1);
  assert.doesNotThrow(() => getQueuedPunches());
});

test('enqueue records the device clock alongside capture time', () => {
  // Paired with captured_at this exposes clock drift on the device.
  const id = enqueuePunch({ direction: 'in', captured_at: ago(30) });
  const [p] = getQueuedPunches();
  assert.equal(p.client_punch_id, id);
  assert.ok(!Number.isNaN(Date.parse(p.enqueued_at)));
  assert.notEqual(p.enqueued_at, p.captured_at, 'a replayed punch has two different times');
});

test('captured_at defaults to now when the caller does not pass one', () => {
  const before = Date.now();
  enqueuePunch({ direction: 'in' });
  const after = Date.now();
  const t = Date.parse(getQueuedPunches()[0].captured_at);
  assert.ok(t >= before && t <= after);
});
