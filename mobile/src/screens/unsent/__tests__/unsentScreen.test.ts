/**
 * The dead letter, rendered.
 * ─────────────────────────
 *
 * `offline/mutationQueue.ts` has kept permanently-failed writes in a persisted
 * store for a while. Nothing read it. The payload was safe and the user could
 * not see it, which for a CREATE means the invoice or the task they typed on a
 * site with no signal existed nowhere at all after the seven-second banner
 * cleared.
 *
 * Two halves are tested here, and only one of them can be tested for real:
 *
 *   · `describeFailure.ts` and the store additions are plain `.ts` and EXECUTE.
 *     Every naming decision, every redaction, and every retry refusal below is
 *     the real function being called, with `lib/storage.ts` and
 *     `offline/mutationQueue.ts` running unmodified over the MMKV stub.
 *
 *   · `UnsentScreen.tsx` cannot be imported at all — Node strips types but does
 *     not transform JSX (see `src/test/register.mjs`) — so the wiring at the
 *     bottom of this file is source-contract only. It pins the decisions that
 *     live in the component body: that no URL or method is rendered, that
 *     discard always confirms, and that the two entry points exist.
 *
 * ── The three rules these are protecting ─────────────────────────────────────
 *
 *   1. NOTHING IS DELETED except through a confirmed discard. `retryFailedMutation`
 *      writes the queue BEFORE it clears the dead letter, and refuses outright
 *      rather than dropping an entry it cannot requeue.
 *   2. NO ID IS EVER RENDERED. `decision_names_not_ids` is an owner ruling, and a
 *      recovery screen is the most tempting place to break it.
 *   3. THE SIX-DAY CEILING IS NOT NEGOTIABLE. A retry keeps `created_at` and the
 *      original `idempotency_key`; if either moved, a button on a screen would
 *      have quietly undone the mechanism that stops one create becoming two.
 */

import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  CREATE_MAX_AGE_MS,
  canRetryFailed,
  clearFailedMutations,
  clearQueue,
  discardFailedMutation,
  enqueueMutation,
  flushQueue,
  getFailedCount,
  getFailedMutations,
  getQueueCount,
  getQueuedMutations,
  retryFailedMutation,
} from '../../../offline/mutationQueue.ts';
import {
  describeFields, describeMutation, exportText, failureReason, fieldLabel,
  formatValue, formatWhen, clip,
} from '../describeFailure.ts';
import type { FailedMutation, MutationQueueItem } from '../../../api/types.ts';
import { storage } from '../../../lib/storage.ts';
import { readCode, readRaw } from '../../../test/source.ts';
import { __resetStorage } from '../../../test/stubs/react-native-mmkv.ts';
import { __resetCrypto } from '../../../test/stubs/expo-crypto.ts';
import { __resetNet, __goOffline, __failWith } from '../../../test/stubs/api-client.ts';

const FAILED_KEY = 'mutation_queue_failed';
const QUEUE_KEY  = 'mutation_queue';
const DAY = 24 * 60 * 60 * 1000;

beforeEach(() => {
  __resetStorage();
  __resetCrypto();
  __resetNet();
});

// ── Fixtures ──────────────────────────────────────────────────────────────────

/**
 * A queued item shaped exactly like the ones the app really enqueues.
 *
 * Every default here was read off a live call site rather than invented, so a
 * naming test that passes is a statement about this product and not about a
 * hypothetical payload. The sites are listed against each sample below.
 */
function item(over: Partial<MutationQueueItem> = {}): MutationQueueItem {
  return {
    id: 'i1',
    method: 'POST',
    url: '/tasks',
    body: { title: 'File GSTR-3B' },
    created_at: '2026-08-14T09:12:00',
    retries: 0,
    idempotency_key: '11111111-2222-4333-8444-555555555555',
    ...over,
  };
}

function failed(over: Partial<FailedMutation> = {}, itemOver: Partial<MutationQueueItem> = {}): FailedMutation {
  return {
    item: item(itemOver),
    error: 'Network Error',
    failed_at: '2026-08-20T11:40:00',
    reason: 'exhausted',
    ...over,
  };
}

/** Put entries straight into the dead letter, the way `recordFailure` does. */
function seedFailed(entries: FailedMutation[]): void {
  storage.set(FAILED_KEY, JSON.stringify(entries));
}

const UUID_ANYWHERE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

// ─────────────────────────────────────────────────────────────────────────────
// 1 · WHAT WAS IT — the name comes from the payload, never from the URL
// ─────────────────────────────────────────────────────────────────────────────

test('a queued task create is named by its title, not its endpoint', () => {
  // components/NewTaskSheet.tsx:222 — POST /tasks with the sheet's payload.
  const d = describeMutation(item({
    body: { title: 'File GSTR-3B', priority: 'high', description: null },
    entity_type: 'task',
  }));

  assert.equal(d.kind, 'Task');
  assert.ok(d.named, 'the payload carries a title, so this is a NAMED entry');
  assert.match(d.title, /File GSTR-3B/);
  assert.doesNotMatch(d.title, /\/tasks|POST/, 'the endpoint is the app talking to itself');
});

test('a swipe-to-complete has no name, and says what it was instead of guessing one', () => {
  // screens/TasksScreen.tsx:91 — PUT /tasks/{id} with { status: 'done' }. The
  // title of that task lives on a server this device cannot reach, so there is
  // nothing honest to put in quotes.
  const d = describeMutation(item({
    method: 'PUT', url: '/tasks/t_a91f', body: { status: 'done' },
    entity_type: 'task', entity_id: 't_a91f',
  }));

  assert.equal(d.named, false, 'nothing in the payload names the task');
  assert.equal(d.title, 'A task marked done');
  assert.equal(d.action, 'Changed');
  assert.doesNotMatch(d.title, /t_a91f/, 'an id is not a name');
});

test('a message quotes what the person typed', () => {
  // screens/ChatScreen.tsx:641 — the one write where the payload IS the words.
  const d = describeMutation(item({
    url: '/v1/messaging/channels/c_7/messages',
    body: { content: 'Please share the GSTR-3B workings', type: 'text', parent_message_id: null },
  }));

  assert.equal(d.kind, 'Message');
  assert.ok(d.named);
  assert.match(d.title, /Please share the GSTR-3B workings/);
});

test('a stage move names the stage, which is the whole of what changed', () => {
  // screens/graha/DealDetailSheet.tsx:142 — PATCH /v1/graha/deals/{id} { stage }
  const d = describeMutation(item({
    method: 'PATCH', url: '/v1/graha/deals/d_3', body: { stage: 'Won' },
    entity_type: 'graha_deal',
  }));

  assert.equal(d.kind, 'Deal');
  assert.equal(d.title, 'A deal moved to Won');
});

test('a contact edit is named when the patch happens to carry the name', () => {
  // screens/graha/ContactSheet.tsx:153 — PATCH with a sparse patch object.
  const named = describeMutation(item({
    method: 'PATCH', url: '/v1/graha/contacts/c_1',
    body: { name: 'Sharma & Co', phone: '+91 98200 11111' },
  }));
  assert.ok(named.named);
  assert.match(named.title, /Sharma & Co/);

  // …and honestly unnamed when it does not.
  const anon = describeMutation(item({
    method: 'PATCH', url: '/v1/graha/contacts/c_1', body: { phone: '+91 98200 11111' },
  }));
  assert.equal(anon.named, false);
  assert.equal(anon.title, 'Changes to a contact');
});

test('the writes that carry no body at all are still described as actions', () => {
  const cases: Array<[Partial<MutationQueueItem>, string]> = [
    // screens/graha/TodayPanel.tsx:81
    [{ method: 'PATCH', url: '/v1/graha/follow-ups/f_2/complete', body: {} }, 'A follow-up ticked off'],
    // screens/vikray/ConvertDealSheet.tsx:138
    [{ method: 'POST', url: '/v1/vikray/orders/from-deal/d_9', body: {} }, 'A sales order raised from a won deal'],
    // screens/ChatScreen.tsx:706 / :722
    [{ method: 'POST', url: '/v1/messaging/messages/m_4/pin', body: {} }, 'Pinning a message'],
    [{ method: 'DELETE', url: '/v1/messaging/messages/m_4/pin' }, 'Unpinning a message'],
  ];

  for (const [over, expected] of cases) {
    const d = describeMutation(item(over));
    assert.equal(d.title, expected);
    assert.equal(d.named, false, `${expected} does not name a record, and must not claim to`);
  }
});

test('a mute reads as what it does to the person, in both directions', () => {
  // screens/MessagesScreen.tsx:279 — PUT …/mute { muted }
  assert.match(
    describeMutation(item({ method: 'PUT', url: '/v1/messaging/channels/c_1/mute', body: { muted: true } })).title,
    /Muting notifications/,
  );
  assert.match(
    describeMutation(item({ method: 'PUT', url: '/v1/messaging/channels/c_1/mute', body: { muted: false } })).title,
    /notifications back on/,
  );
});

test('an endpoint nothing recognises still produces a sentence, never a path', () => {
  const d = describeMutation(item({
    method: 'POST', url: '/v1/ganit/some-future-thing', body: { note: 'hello' },
    entity_type: 'ganit_voucher',
  }));

  assert.equal(d.title, 'Something you created');
  assert.equal(d.kind, 'Ganit voucher', 'the entity_type is better than a path, and free');
  assert.doesNotMatch(d.title, /ganit|some-future-thing|POST/i);
  // The payload underneath the vague title is still complete.
  assert.deepEqual(d.fields, [{ label: 'Note', value: 'hello' }]);
});

test('NO description anywhere contains a URL, a method or a UUID', () => {
  // The sweep. Every shape this app can queue, plus two it cannot yet.
  const samples: MutationQueueItem[] = [
    item(),
    item({ method: 'PUT', url: '/tasks/t_1', body: { status: 'done' } }),
    item({ method: 'DELETE', url: '/tasks/t_1', body: undefined }),
    item({ url: '/client/tasks/request', body: { title: 'Please file my ITR' } }),
    item({ url: '/v1/messaging/channels/c_1/messages', body: { content: 'hi' } }),
    item({ method: 'PUT', url: '/v1/messaging/channels/c_1/mute', body: { muted: true } }),
    item({ method: 'PATCH', url: '/v1/graha/deals/d_1', body: { stage: 'Won' } }),
    item({ method: 'PATCH', url: '/v1/graha/contacts/c_1', body: { email: 'a@b.com' } }),
    item({ method: 'POST', url: '/v1/vikray/orders/from-deal/d_1', body: {} }),
    item({ method: 'POST', url: '/v1/unknown/thing', body: {} }),
    item({
      method: 'POST', url: '/tasks',
      body: { title: 'x', assignee_user_ids: ['3f2504e0-4f89-41d3-9a0c-0305e82c3301'] },
    }),
  ];

  for (const sample of samples) {
    const d = describeMutation(sample);
    const surface = [d.title, d.kind, ...d.fields.map(f => `${f.label} ${f.value}`)].join(' | ');

    assert.doesNotMatch(surface, /https?:\/\/|\/v1\/|\/tasks\b/,
      `a path reached the UI for ${sample.url}: ${surface}`);
    assert.doesNotMatch(surface, /\b(POST|PATCH|PUT|DELETE)\b/,
      `an HTTP method reached the UI for ${sample.url}: ${surface}`);
    assert.doesNotMatch(surface, UUID_ANYWHERE,
      `a UUID reached the UI for ${sample.url}: ${surface}`);
    assert.ok(d.title.length > 3, `${sample.url} produced no sentence`);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 2 · NAMES, NOT IDS — and nothing silently dropped
// ─────────────────────────────────────────────────────────────────────────────

test('a list of user ids becomes a count of people, and the ids are gone', () => {
  const fields = describeFields({
    title: 'File GSTR-3B',
    assignee_user_ids: [
      '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
      '9c858901-8a57-4791-81fe-4c455b099bc9',
    ],
  });

  const assignees = fields.find(f => f.label === 'Assigned to');
  assert.ok(assignees, 'the field must still be LISTED — the user needs to know it existed');
  assert.equal(assignees!.value, '2 people');
  assert.doesNotMatch(JSON.stringify(fields), UUID_ANYWHERE);
});

test('a lone id value is withheld rather than printed', () => {
  assert.equal(formatValue('client_id', '3f2504e0-4f89-41d3-9a0c-0305e82c3301'), '(id hidden)');
  // A non-UUID key of the app's own shape is not an owner-ruling id and is kept:
  // it is short, and it is occasionally the only handle a user recognises.
  assert.equal(formatValue('team_id', 'proj-audit-2026'), 'proj-audit-2026');
});

test('attachments give up their filenames, which is the part the user chose', () => {
  assert.equal(
    formatValue('attachments', [{ name: 'workings.xlsx', url: 'x', key: null },
                                { name: 'challan.pdf', url: 'y', key: null }]),
    '2 — workings.xlsx, challan.pdf',
  );
});

test('EVERY top-level key survives into the fields — nothing is silently dropped', () => {
  const body = {
    title: 'File GSTR-3B',
    priority: 'high',
    description: 'Pull the 2B first',
    due_at: '2026-09-05T16:00:00',
    team_id: 'proj-audit-2026',
    something_new_next_year: 'still here',
  };

  const fields = describeFields(body);
  assert.equal(fields.length, Object.keys(body).length,
    'a field dropped here is a field the user cannot get back — this is the last copy');
  assert.ok(fields.some(f => f.label === 'Something new next year' && f.value === 'still here'),
    'an unmapped key must be humanised, not omitted');
});

test('a cleared field says cleared, and an empty one says empty', () => {
  // Both are real: `NewTaskSheet` sends `description: null`, and a contact patch
  // can blank a phone number. "cleared" and "(nothing)" are different facts.
  assert.equal(formatValue('description', null), 'cleared');
  assert.equal(formatValue('description', ''), 'empty');
});

test('dates are rendered without Intl, so a phone shows what a test asserts', () => {
  // Hermes ships without full ICU unless the build opts in — `NewTaskSheet`
  // avoids Intl for the same reason when it computes an IST due date.
  assert.equal(formatWhen('2026-09-05T16:00:00'), '5 Sep 2026, 16:00');
  // A bare `YYYY-MM-DD` is read as LOCAL midnight, not UTC. `new Date('2026-09-05')`
  // is UTC midnight, which is 4 September to anyone west of Greenwich — so the
  // day itself would shift for a value that has no time of day to shift by.
  assert.equal(formatValue('close_date', '2026-09-05'), '5 Sep 2026');
  assert.equal(formatWhen('not a date'), 'not a date', 'an unparseable stamp is passed through, never blanked');
});

test('field labels are words even when the key is not', () => {
  assert.equal(fieldLabel('due_at'), 'Due');
  assert.equal(fieldLabel('assignee_user_ids'), 'Assigned to');
  assert.equal(fieldLabel('gstr_period'), 'Gstr period');
});

test('clip never cuts mid-word and always marks that it cut', () => {
  const long = 'File the GSTR-3B for Sharma and Company before the twentieth of September';
  const short = clip(long, 30);
  assert.ok(short.length <= 31, short);
  assert.match(short, /…$/);
  assert.equal(clip('short', 30), 'short', 'nothing is added when nothing is cut');
});

// ─────────────────────────────────────────────────────────────────────────────
// 3 · WHY IT FAILED — three reasons, three different things to do
// ─────────────────────────────────────────────────────────────────────────────

test('rejected says the server decided, and that repeating it changes nothing', () => {
  const entry = failed({ reason: 'rejected', error: 'You don\'t have permission to do that.' },
                       { method: 'PATCH', url: '/tasks/t_1', body: { status: 'done' } });
  const why = failureReason(entry, canRetryFailed(entry));

  assert.match(why.badge, /Refused/i);
  assert.match(why.meaning, /unchanged/i, 'the user must be told a plain retry is not the answer');
  assert.match(why.whatNow, /enter it again/i);
  assert.ok(why.retryCaveat, 'a retry is offered, so the caveat has to be offered with it');
});

test('exhausted says it never arrived, and offers the retry that could actually work', () => {
  const entry = failed({ reason: 'exhausted' }, { method: 'PATCH', url: '/tasks/t_1', body: { status: 'done' } });
  const why = failureReason(entry, canRetryFailed(entry));

  assert.equal(why.retryable, true);
  assert.match(why.meaning, /connection/i);
  assert.match(why.whatNow, /Try again/i);
  assert.equal(why.retryCaveat, undefined, 'there is nothing to warn about — this is the retryable case');
});

test('expired offers NO retry, and says exactly why sending it would be wrong', () => {
  const entry = failed({ reason: 'expired' }, {
    method: 'POST', url: '/tasks',
    created_at: new Date(Date.now() - 7 * DAY).toISOString(),
  });
  const why = failureReason(entry, canRetryFailed(entry));

  assert.equal(why.retryable, false, 'a retry here is either a no-op or an unprotected replay');
  assert.match(why.meaning, /six days|seven days/i);
  assert.match(why.whatNow, /enter it again/i);
  assert.match(why.whatNow, /two/i, 'the duplicate risk is the reason, so it has to be said out loud');
});

test('the reason copy never blames the user for a network failure', () => {
  const why = failureReason(failed({ reason: 'exhausted' }), true);
  assert.match(why.meaning, /not anything wrong with what you entered/i);
});

// ─────────────────────────────────────────────────────────────────────────────
// 4 · CAN IT BE RETRIED — the ceiling is a property of AGE, not of `reason`
// ─────────────────────────────────────────────────────────────────────────────

test('an expired create cannot be retried', () => {
  const entry = failed({ reason: 'expired' }, {
    method: 'POST', created_at: new Date(Date.now() - (6 * DAY + 60_000)).toISOString(),
  });
  assert.equal(canRetryFailed(entry), false);
});

test('AN EXHAUSTED CREATE THAT HAS SINCE AGED OUT IS ALSO UNRETRIABLE', () => {
  // The case `reason !== 'expired'` gets wrong. It failed on day two for a bad
  // connection, sat in the dead letter, and is being looked at on day seven. The
  // server has forgotten its key by now, so re-sending it is the unprotected
  // replay `CREATE_MAX_AGE_MS` exists to prevent — regardless of how it arrived.
  const entry = failed({ reason: 'exhausted' }, {
    method: 'POST', created_at: new Date(Date.now() - (CREATE_MAX_AGE_MS + 60_000)).toISOString(),
  });
  assert.equal(canRetryFailed(entry), false);
  assert.equal(failureReason(entry, canRetryFailed(entry)).retryable, false);
});

test('an old PATCH is always retryable — only creation duplicates', () => {
  const entry = failed({ reason: 'exhausted' }, {
    method: 'PATCH', url: '/tasks/t_1', body: { status: 'done' },
    created_at: new Date(Date.now() - 30 * DAY).toISOString(),
  });
  assert.equal(canRetryFailed(entry), true);
});

test('a create one minute inside the ceiling is still retryable', () => {
  const entry = failed({ reason: 'exhausted' }, {
    method: 'POST', created_at: new Date(Date.now() - (CREATE_MAX_AGE_MS - 60_000)).toISOString(),
  });
  assert.equal(canRetryFailed(entry), true);
});

// ─────────────────────────────────────────────────────────────────────────────
// 5 · RETRY — against the real store
// ─────────────────────────────────────────────────────────────────────────────

test('retry moves the entry back to the live queue and out of the dead letter', () => {
  seedFailed([failed({}, { id: 'x1', method: 'PATCH', url: '/tasks/t_1', body: { status: 'done' } })]);

  assert.equal(retryFailedMutation('x1'), 'queued');
  assert.equal(getQueueCount(), 1);
  assert.equal(getFailedCount(), 0);
  assert.equal(getQueuedMutations()[0].url, '/tasks/t_1');
});

test('retry keeps the idempotency key — re-keying is how one create becomes two', () => {
  const key = '11111111-2222-4333-8444-555555555555';
  // A CREATE, and one still inside the six-day window — the key matters most on
  // exactly the write that a second copy of would be a second invoice.
  seedFailed([failed({}, {
    id: 'x1', method: 'POST', url: '/tasks',
    created_at: new Date().toISOString(), idempotency_key: key,
  })]);

  assert.equal(retryFailedMutation('x1'), 'queued');
  assert.equal(getQueuedMutations()[0].idempotency_key, key,
    'the earlier attempt may have SUCCEEDED with only its response lost');
});

test('retry keeps created_at — resetting it would delete the six-day ceiling', () => {
  const born = '2026-08-14T09:12:00';
  seedFailed([failed({}, { id: 'x1', method: 'PATCH', url: '/tasks/t_1', created_at: born })]);

  retryFailedMutation('x1');
  assert.equal(getQueuedMutations()[0].created_at, born,
    'a button that resets the age is the ceiling removed, not the ceiling respected');
});

test('retry resets the attempt count, because the person asked for a fresh round', () => {
  seedFailed([failed({}, { id: 'x1', method: 'PATCH', url: '/tasks/t_1', retries: 3 })]);

  retryFailedMutation('x1');
  assert.equal(getQueuedMutations()[0].retries, 0);
});

test('retry REFUSES an expired create and leaves the payload exactly where it was', () => {
  seedFailed([failed({ reason: 'expired' }, {
    id: 'x1', method: 'POST', url: '/tasks',
    body: { title: 'File GSTR-3B' },
    created_at: new Date(Date.now() - 8 * DAY).toISOString(),
  })]);

  assert.equal(retryFailedMutation('x1'), 'expired-create');
  assert.equal(getQueueCount(), 0, 'nothing was queued');
  assert.equal(getFailedCount(), 1, 'AND NOTHING WAS LOST — a refusal must never be a deletion');
  assert.deepEqual(getFailedMutations()[0].item.body, { title: 'File GSTR-3B' });
});

test('retrying twice does not queue the write twice', () => {
  seedFailed([failed({}, { id: 'x1', method: 'PATCH', url: '/tasks/t_1' })]);

  assert.equal(retryFailedMutation('x1'), 'queued');
  assert.equal(retryFailedMutation('x1'), 'not-found');
  assert.equal(getQueueCount(), 1, 'two POSTs under one key is a 409 at best and a duplicate at worst');
});

test('an unknown id is reported, not thrown and not silently swallowed', () => {
  seedFailed([failed({}, { id: 'x1' })]);
  assert.equal(retryFailedMutation('nope'), 'not-found');
  assert.equal(getFailedCount(), 1);
});

test('discard removes one entry and touches no other', () => {
  seedFailed([
    failed({}, { id: 'x1', body: { title: 'One' } }),
    failed({}, { id: 'x2', body: { title: 'Two' } }),
  ]);

  discardFailedMutation('x1');
  const left = getFailedMutations();
  assert.equal(left.length, 1);
  assert.deepEqual(left[0].item.body, { title: 'Two' });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6 · THE WHOLE ROUND TRIP, through the real queue
// ─────────────────────────────────────────────────────────────────────────────

test('a create that exhausts its retries survives to the dead letter, is named, and can be sent later', async () => {
  __goOffline();
  enqueueMutation({
    method: 'POST', url: '/tasks',
    body: { title: 'File GSTR-3B', priority: 'high' },
    entity_type: 'task',
  });
  const key = getQueuedMutations()[0].idempotency_key;

  // The original attempt plus three retries.
  for (let i = 0; i < 4; i++) await flushQueue();

  assert.equal(getQueueCount(), 0);
  assert.equal(getFailedCount(), 1);

  const entry = getFailedMutations()[0];
  assert.equal(entry.reason, 'exhausted');
  assert.deepEqual(entry.item.body, { title: 'File GSTR-3B', priority: 'high' },
    'the payload is the point — this is the only copy of what the user typed');

  // And it renders as itself, not as an endpoint.
  assert.match(describeMutation(entry.item).title, /File GSTR-3B/);
  assert.equal(canRetryFailed(entry), true);

  // Retry, with the connection restored.
  __resetNet();
  assert.equal(retryFailedMutation(entry.item.id), 'queued');
  assert.equal(getQueuedMutations()[0].idempotency_key, key, 'same identity, so the server can recognise a replay');

  const result = await flushQueue();
  assert.equal(result.succeeded, 1);
  assert.equal(getQueueCount(), 0);
  assert.equal(getFailedCount(), 0, 'a write that finally landed does not stay on the failure screen');
});

test('a 4xx lands as rejected with the payload intact', async () => {
  __failWith(422);
  enqueueMutation({ method: 'POST', url: '/tasks', body: { title: 'File GSTR-3B' } });
  await flushQueue();

  const entry = getFailedMutations()[0];
  assert.equal(entry.reason, 'rejected');
  assert.deepEqual(entry.item.body, { title: 'File GSTR-3B' });
  assert.match(failureReason(entry, canRetryFailed(entry)).badge, /Refused/i);
});

test('clearQueue still does not touch the dead letter', () => {
  // Two different things a user might mean, and the screen relies on them being
  // separate: the banner's Discard clears PENDING edits, and must not erase the
  // record of what already failed.
  seedFailed([failed({}, { id: 'x1' })]);
  enqueueMutation({ method: 'PATCH', url: '/tasks/t_1', body: { status: 'done' } });

  clearQueue();
  assert.equal(getQueueCount(), 0);
  assert.equal(getFailedCount(), 1);
});

test('the dead letter survives a restart', () => {
  seedFailed([failed({}, { id: 'x1', body: { title: 'File GSTR-3B' } })]);
  // A restart is exactly this: the module re-reads MMKV and nothing else.
  const raw = storage.getString(FAILED_KEY);
  assert.ok(raw, 'nothing was persisted');
  assert.match(raw as string, /File GSTR-3B/);
  assert.equal(getFailedCount(), 1);
});

// ─────────────────────────────────────────────────────────────────────────────
// 7 · COPY IT OUT
// ─────────────────────────────────────────────────────────────────────────────

test('the export carries everything the user typed, as prose and not as JSON', () => {
  const entry = failed({ reason: 'rejected', error: 'You don\'t have permission to do that.' }, {
    body: {
      title: 'File GSTR-3B',
      priority: 'high',
      description: 'Pull the 2B first',
      due_at: '2026-09-05T16:00:00',
      assignee_user_ids: ['3f2504e0-4f89-41d3-9a0c-0305e82c3301'],
    },
  });

  const text = exportText(entry, canRetryFailed(entry));

  for (const expected of ['File GSTR-3B', 'high', 'Pull the 2B first', '5 Sep 2026', '1 person']) {
    assert.ok(text.includes(expected), `the export lost "${expected}":\n${text}`);
  }
  assert.ok(text.includes('14 Aug 2026'), 'when it was made is part of recognising it');
  assert.ok(text.includes('20 Aug 2026'), 'and when it was given up on');
  assert.ok(text.includes('You don\'t have permission to do that.'), 'the server\'s own words survive');

  assert.doesNotMatch(text, UUID_ANYWHERE, 'no id leaves the app either');
  assert.doesNotMatch(text, /[{}]|":\s/, 'JSON is the app failing to explain itself');
  assert.doesNotMatch(text, /\/tasks|\bPOST\b/, 'no endpoint, no method');
});

test('an export of a bodyless write says so rather than producing an empty block', () => {
  const text = exportText(
    failed({}, { method: 'PATCH', url: '/v1/graha/follow-ups/f_1/complete', body: {} }),
    true,
  );
  assert.match(text, /A follow-up ticked off/);
  assert.match(text, /no details of its own/i);
});

// ─────────────────────────────────────────────────────────────────────────────
// 8 · THE WIRING — source contract, because no .tsx can be imported here
// ─────────────────────────────────────────────────────────────────────────────

const SCREEN   = () => readCode('screens/unsent/UnsentScreen.tsx');
const SETTINGS = () => readCode('screens/SettingsScreen.tsx');
const APP      = () => readCode('App.tsx');
const ROOT     = () => readCode('nav/RootStack.tsx');

test('the screen is registered as a route, or nothing can reach it', () => {
  assert.match(ROOT(), /Unsent:\s*undefined/, 'the param list must declare it');
  assert.match(ROOT(), /<Stack\.Screen\s+name="Unsent"/, 'and the navigator must register it');
  assert.match(ROOT(), /screens\/unsent\/UnsentScreen/);
});

test('Settings carries a PERMANENT door to it', () => {
  // The banner lasts seven seconds. If this row is not here, a change that
  // failed while the phone was in a pocket is unreachable for ever.
  const code = SETTINGS();
  assert.match(code, /nav\.navigate\('Unsent'\)/);
  assert.match(code, /getFailedCount/, 'the row states the count, so zero is visible too');
});

test('the Settings row is rendered unconditionally — an empty dead letter is a fact worth showing', () => {
  const code = SETTINGS();
  // The guard that would break this is `{failedCount > 0 && <Row …>}`. The count
  // pill is allowed to be conditional; the row is not.
  assert.doesNotMatch(
    code, /failedCount\s*>\s*0\s*&&\s*\(?\s*<Row/,
    'hiding the row until something fails is how this store came to have no reader at all',
  );
  assert.match(code, /None — everything has reached the server/,
    'and the empty case has to READ as reassurance, not as an error');
});

test('the failure banner leads somewhere', () => {
  const code = APP();
  assert.match(code, /onView/, 'the permanent-failure banner needs an action');
  assert.match(code, /navigationRef\.navigate\('Unsent'\)/);
  assert.match(code, /canView:\s*true/, 'and only the permanent branch may set it');
  // It is a sibling of the navigator, so a hook is not available out there.
  assert.match(code, /navigationRef\.isReady\(\)/,
    'a flush can complete before the container has mounted');
});

test('the screen never renders a URL or a method', () => {
  const code = SCREEN();
  assert.doesNotMatch(code, /item\.url|\.item\.method|entry\.item\.url/,
    'the URL is the app talking to itself; describeMutation is the only thing allowed to read it');
});

test('discard always confirms, and the confirmation says it is the last copy', () => {
  const code = SCREEN();
  assert.match(code, /Alert\.alert\(/, 'discard without a confirmation is the defect, not the fix');
  assert.match(code, /last copy/i);
  assert.match(code, /style:\s*'destructive'/);
  // The order matters: `discardFailedMutation` may only be called from inside
  // the confirmation's onPress, never at the top of the handler.
  const alertAt   = code.indexOf('Alert.alert(');
  const discardAt = code.indexOf('discardFailedMutation(');
  assert.ok(alertAt !== -1 && discardAt > alertAt,
    'the discard call must sit INSIDE the confirmation, not before it');
});

test('the screen offers no sweep — there is no discard-all on a screen of last copies', () => {
  assert.doesNotMatch(SCREEN(), /clearFailedMutations/,
    'the store has one; a one-tap sweep here is one mis-tap from the bug this exists to fix');
});

test('the screen asks the store whether a retry is possible, rather than switching on reason', () => {
  const code = SCREEN();
  assert.match(code, /const retryable = canRetryFailed\(entry\)/,
    'the possibility of a retry is the store\'s decision, not the screen\'s');
  assert.match(code, /failureReason\(entry, retryable\)/,
    'and the copy has to be built from the same answer the button is');
  assert.match(code, /\{why\.retryable && \(/, 'the button itself is gated on it');

  // `entry.reason` is allowed elsewhere — it picks the icon and decides whether
  // the raw server message adds anything. It must not decide RETRY: reason is
  // how the item arrived, and the ceiling is about how old it is now. An
  // exhausted create that has since aged past six days is unretryable too.
  const offenders = code.split('\n').filter(
    line => /retry/i.test(line) && /reason\s*!==?\s*['"]expired['"]/.test(line),
  );
  assert.deepEqual(offenders, [],
    'a retry decision made from `reason` misses the exhausted-then-aged case:\n' + offenders.join('\n'));
});

test('copy is offered on every entry, not only the ones that cannot be retried', () => {
  const code = SCREEN();
  // A retry can fail too, and this is still the last copy either way.
  const copyBtn = /onPress=\{onCopy\}/.test(code);
  assert.ok(copyBtn, 'the copy action is missing');
  assert.doesNotMatch(code, /why\.retryable\s*\|\|[^\n]*onCopy|!why\.retryable\s*&&[\s\S]{0,80}onCopy/,
    'copy must not be conditional on the reason');
});

test('the Devanagari subtitle carries no synthetic weight and no tracking', () => {
  // Tiro ships one weight and RN tracks after shaping — theme/BiLabel.tsx has
  // the full argument. The app-wide sweep covers this too; it is restated here
  // so a failure names this screen.
  const raw = readRaw('screens/unsent/UnsentScreen.tsx');
  const m = /titleHi:\s*\{([^}]*)\}/.exec(raw);
  assert.ok(m, 'titleHi style not found — was it renamed?');
  assert.match(m![1], /hindi\(\)/, 'the Devanagari run must name the Tiro face');
  assert.doesNotMatch(m![1], /fontWeight/);
  assert.doesNotMatch(m![1], /letterSpacing/);
});
