/**
 * The CRM write paths.
 *
 * Two kinds of test, and the split is not cosmetic:
 *
 *  · **Real unit tests** for `api/graha.ts`. It imports only `./client`, which
 *    the harness stubs, so `node --test` can load and CALL it. `stagesOf`,
 *    `isOpenStage`, `writeErrorMessage` and `dueDateIn` are exercised for
 *    real — inputs in, assertions on the output.
 *
 *  · **Source-contract assertions** for the four `.tsx` files. Node's
 *    type-stripping does not transform JSX, so no screen or sheet in this
 *    repository can be imported here at all (`test/register.mjs` says so at
 *    length). Reading the source is the only instrument that reaches a decision
 *    made inside a component body, and it is a weak one: it pins the decision so
 *    that removing it turns the suite red. It proves nothing about what renders.
 *
 * Every source assertion below was checked by reverting the thing it guards and
 * watching it fail. The ones that matter most are the four about idempotence —
 * they are the difference between a duplicate row in a database production
 * shares with staging, and no duplicate row.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { readCode } from '../../../test/source.ts';
import {
  stagesOf, isOpenStage, writeErrorMessage, DEFAULT_STAGES, ACTIVITY_TYPES,
  type Pipeline,
} from '../../../api/graha.ts';
import { dueDateIn } from '../dueDate.ts';

// ── stagesOf ─────────────────────────────────────────────────────────────────

const pipeline = (over: Partial<Pipeline>): Pipeline => ({
  id: 'p', name: 'Sales', stages: null, is_default: false, ...over,
});

test('the stage list comes from the org’s DEFAULT pipeline, not the first row', () => {
  // `/pipelines` orders by `is_default DESC`, so the default is usually first —
  // but "usually" is how a rep in an org with two pipelines gets offered the
  // wrong board's stages, and the ordering is the server's to change.
  const stages = stagesOf([
    pipeline({ id: 'a', name: 'Partners', stages: ['Intro', 'Signed'] }),
    pipeline({ id: 'b', name: 'Direct', stages: ['New', 'Won'], is_default: true }),
  ]);
  assert.deepEqual(stages, ['New', 'Won']);
});

test('a pipeline with no stages falls back to the server’s own defaults', () => {
  // `graha_pipelines.stages` is jsonb and rows predate it having a value. An
  // empty stage picker is a sheet with no way to do the one thing it is for.
  assert.deepEqual(stagesOf([pipeline({ stages: null, is_default: true })]), DEFAULT_STAGES);
  assert.deepEqual(stagesOf([pipeline({ stages: [], is_default: true })]), DEFAULT_STAGES);
  assert.deepEqual(stagesOf([]), DEFAULT_STAGES);
  assert.deepEqual(stagesOf(undefined), DEFAULT_STAGES);
});

test('the fallback stages are the ones PipelineCreate would have written', () => {
  // Kept in step with `backend/routers/graha.py`'s `PipelineCreate.stages`. If
  // the server's default changes and this does not, a fresh org gets a picker
  // whose chips do not match its own board.
  assert.deepEqual(DEFAULT_STAGES, ['New', 'Qualified', 'Proposal', 'Negotiation', 'Won', 'Lost']);
});

test('non-string junk in the jsonb array is dropped, not rendered', () => {
  const stages = stagesOf([pipeline({ stages: ['New', null, 'Won', ''] as unknown as string[], is_default: true })]);
  assert.deepEqual(stages, ['New', 'Won']);
});

// ── isOpenStage ──────────────────────────────────────────────────────────────

test('Won and Lost are terminal, in any casing, and null is open', () => {
  for (const closed of ['Won', 'won', 'LOST', 'Closed Won', 'closed lost']) {
    assert.equal(isOpenStage(closed), false, `${closed} should be closed`);
  }
  for (const open of ['New', 'Negotiation', null, undefined, '']) {
    assert.equal(isOpenStage(open), true, `${open} should be open`);
  }
});

// ── writeErrorMessage ────────────────────────────────────────────────────────

test('a 403 on a WRITE does not reuse the read copy', () => {
  // Mobile had never produced a 403 on a write before this screen existed, and
  // both existing sentences are wrong here. `ScreenState`'s forbidden copy says
  // the org may not have the module — but the deal is on screen, so the same
  // gate already passed on the GET. `api/client.ts` says "You don't have
  // permission to do that" and never says whether anything was saved.
  const msg = writeErrorMessage({ response: { status: 403 }, friendlyMessage: "You don't have permission to do that." });
  assert.match(msg, /read-only/i, 'a refused write must name the actual condition');
  assert.match(msg, /[Nn]othing was saved/, 'a refused write must say nothing was saved');
  assert.match(msg, /admin/i, 'and where it gets changed');
});

test('a lost response on a CREATE never says "try again"', () => {
  // The dangerous case. With no idempotency key on POST /activities, a request
  // that reached Postgres and lost its reply is indistinguishable from one that
  // never landed — so "retry" is advice that produces a duplicate.
  const msg = writeErrorMessage({ message: 'timeout of 15000ms exceeded' }, { creating: true });
  assert.match(msg, /may or may not/i);
  assert.match(msg, /[Cc]heck/);
  assert.doesNotMatch(msg, /try again/i, 'retrying an unacknowledged create duplicates it');
});

test('a lost response on a PATCH is allowed to be blunt', () => {
  // Nothing was created, so there is nothing to double up.
  const msg = writeErrorMessage({ message: 'Network Error' });
  assert.match(msg, /[Nn]othing was saved/);
  assert.doesNotMatch(msg, /may or may not/i);
});

test('a 404 blames the deal, not the network', () => {
  const msg = writeErrorMessage({ response: { status: 404 } });
  assert.match(msg, /no longer exists/i);
});

test('anything unrecognised falls through to the interceptor’s own sentence', () => {
  // `api/client.ts` already writes the right words for most statuses; this
  // function exists to override the two it gets wrong, not to replace it.
  const msg = writeErrorMessage({ response: { status: 409 }, friendlyMessage: 'This already exists — try a different name or email.' });
  assert.equal(msg, 'This already exists — try a different name or email.');
});

// ── dueDateIn ────────────────────────────────────────────────────────────────

test('a follow-up is due at 10:00, not at whatever time it was set', () => {
  // Due "now + 3 days" makes every follow-up due mid-afternoon and pushes half
  // of them into `overdue_followups` a day before anyone would have called.
  const from = new Date(2026, 7, 20, 17, 42, 13, 500);
  const due = dueDateIn(3, from);
  assert.equal(due.getDate(), 23);
  assert.equal(due.getHours(), 10);
  assert.equal(due.getMinutes(), 0);
  assert.equal(due.getSeconds(), 0);
  assert.equal(due.getMilliseconds(), 0);
});

test('dueDateIn crosses a month boundary by date arithmetic, not by adding days of ms', () => {
  // `+ n * 86400000` is the version that silently drifts an hour across a DST
  // change. `setDate` is calendar arithmetic and does not.
  const due = dueDateIn(14, new Date(2026, 7, 25, 9, 0, 0));
  assert.equal(due.getMonth(), 8, 'should have rolled into September');
  assert.equal(due.getDate(), 8);
});

test('dueDateIn does not mutate the date it was given', () => {
  const from = new Date(2026, 7, 20, 17, 0, 0);
  dueDateIn(7, from);
  assert.equal(from.getDate(), 20);
  assert.equal(from.getHours(), 17);
});

// ── The idempotence split, pinned ────────────────────────────────────────────

const CREATE_SHEETS = ['screens/graha/LogActivitySheet.tsx', 'screens/graha/FollowUpSheet.tsx'];

test('neither CREATE sheet touches the offline queue', () => {
  // THE load-bearing test in this file. `mutationQueue` retries three times and
  // sends no idempotency key, so a queued POST whose response is lost is
  // replayed and creates a second row — in a database production shares with
  // staging, against an endpoint with no delete on mobile.
  for (const file of CREATE_SHEETS) {
    const code = readCode(file);
    assert.doesNotMatch(code, /useOfflineMutation|enqueueMutation/,
      `${file} queues a POST that carries no idempotency key — it will duplicate on replay`);
  }
});

test('each CREATE sheet refuses to submit while offline, and says why', () => {
  for (const file of CREATE_SHEETS) {
    const code = readCode(file);
    assert.match(code, /useOnline\(\)/, `${file} does not know whether it is online`);
    assert.match(code, /canSubmit=\{online/,
      `${file} lets the button fire with no connection — the request just fails`);
    // Silently disabling a button is the failure mode this replaces: a rep taps
    // it, nothing happens, and they conclude the app is broken.
    assert.match(code, /!online &&/, `${file} disables the button without explaining it`);
  }
});

test('the stage move and the follow-up tick DO go through the queue', () => {
  // The other half of the split. Both are PATCHes that mean the same thing
  // applied twice, and the rep clearing them is between meetings — which is
  // where the signal is worst.
  for (const file of ['screens/graha/DealDetailSheet.tsx', 'screens/graha/TodayPanel.tsx']) {
    const code = readCode(file);
    assert.match(code, /useOfflineMutation/, `${file} does not survive being offline`);
  }
});

test('every queued write names an entity so a row can show its own pending state', () => {
  // §7.1, never lie about state. Without `entity_type` + `entity_id`,
  // `queuedEntityIds` cannot answer "is this one still waiting?" and an
  // optimistic row is indistinguishable from an accepted one.
  for (const file of ['screens/graha/DealDetailSheet.tsx', 'screens/graha/TodayPanel.tsx']) {
    const code = readCode(file);
    assert.match(code, /entity_type:\s*'graha_/, `${file} enqueues without an entity_type`);
    assert.match(code, /entityId:/, `${file} enqueues without an entity id`);
    assert.match(code, /optimisticId:/,
      `${file} has no dedup key — two taps before the first lands enqueue two writes`);
    assert.match(code, /queuedEntityIds\(/,
      `${file} never reads the queue back, so nothing on screen says "not sent yet"`);
  }
});

// ── The stage PATCH is narrow ────────────────────────────────────────────────

test('moving a stage sends ONLY the stage', () => {
  // `update_deal` writes every key it receives. A phone that PUT the object it
  // fetched two minutes ago would revert a value or a close date being edited on
  // the desktop right now — and the queue's last-write-wins replay would do it
  // again minutes later.
  const api = readCode('api/graha.ts');
  assert.match(api, /moveStage:.*\n?.*patch\([^)]*\{ stage \}\)/,
    'moveStage no longer sends a single-key body');
  const sheet = readCode('screens/graha/DealDetailSheet.tsx');
  assert.match(sheet, /bodyBuilder:\s*v\s*=>\s*\(\{ stage: v\.stage \}\)/,
    'the QUEUED body is wider than the online one — the replay would clobber more');
});

test('the phone never sets won_at, lost_at or probability itself', () => {
  // The server sets all three when the stage becomes Won or Lost. A client
  // guess would be overwritten at best and wrong at worst.
  for (const file of ['api/graha.ts', 'screens/graha/DealDetailSheet.tsx']) {
    const code = readCode(file);
    for (const field of ['won_at', 'lost_at']) {
      assert.doesNotMatch(code, new RegExp(`${field}\\s*:`), `${file} sets ${field}`);
    }
  }
});

// ── House rules ──────────────────────────────────────────────────────────────

const CRM_VIEWS = [
  'screens/graha/DealDetailSheet.tsx',
  'screens/graha/LogActivitySheet.tsx',
  'screens/graha/FollowUpSheet.tsx',
  'screens/graha/TodayPanel.tsx',
  'screens/modules/GrahaScreen.tsx',
];

test('no CRM surface renders an id', () => {
  // The names-not-ids rule. `check-rendered-ids.mjs` is the web's ratchet and
  // has no mobile counterpart, so this is the only guard on this side.
  //
  // Ids reaching a <Text> is what is banned; ids as React keys, query keys and
  // request parameters are the whole mechanism and are fine.
  const banned = /<Text[^>]*>\s*\{[^}]*\b(?:deal|contact|client|user|org|follow_?up)_?[Ii]d\b/;
  for (const file of CRM_VIEWS) {
    assert.doesNotMatch(readCode(file), banned, `${file} renders an id`);
  }
});

test('no CRM sheet uses a date control other than the shared DateTimePicker', () => {
  for (const file of CREATE_SHEETS) {
    const code = readCode(file);
    assert.match(code, /from '@react-native-community\/datetimepicker'/,
      `${file} does not use the app's date picker`);
  }
});

test('the five activity types are exactly the five the server accepts', () => {
  // `create_activity` raises 400 on anything else. A sixth chip here is a
  // guaranteed refusal that the rep would read as the app being broken.
  assert.deepEqual([...ACTIVITY_TYPES].sort(), ['call', 'email', 'meeting', 'note', 'task']);
});

test('a contact id is sent as "" and never as null', () => {
  // The INSERT casts it through `NULLIF($3,'')::uuid`. `null` fails that cast
  // with a 500 rather than storing a null.
  const code = readCode('screens/graha/LogActivitySheet.tsx');
  assert.match(code, /contact_id:\s*contactId \?\? ''/,
    'a deal with no contact would 500 the activity endpoint');
});

// ── The boundary note ────────────────────────────────────────────────────────

test('GrahaScreen no longer claims the CRM is read-only', () => {
  // `ModuleShell` requires `boundary` so that seven screens each state what they
  // cannot do. A sentence that has gone stale is worse than a missing one: it
  // sends a rep to a laptop for something the phone now does.
  const code = readCode('screens/modules/GrahaScreen.tsx');
  const boundary = /boundary="([^"]*)"/.exec(code);
  assert.ok(boundary, 'GrahaScreen has no boundary note');
  const text = boundary[1];
  assert.doesNotMatch(text, /Logging a call, moving a stage and editing a contact are desktop/,
    'the boundary still describes the read-only build');
  assert.match(text, /move a stage/i, 'the boundary does not mention what the phone can now do');
  // Updated when creates landed: "Creating a deal" moved from the desktop side
  // of this sentence to the phone side, and the pipeline board took its place.
  // The rule the assertion encodes is unchanged — the note must still name
  // something the phone cannot do, or it is a boundary note that draws no
  // boundary.
  assert.match(text, /desktop/i, 'the boundary no longer says what is still desktop');
  assert.match(text, /pipeline board/i, 'the boundary does not name what is still desktop');
});

test('a deal row is openable and carries a name, not a position', () => {
  const code = readCode('screens/modules/GrahaScreen.tsx');
  assert.match(code, /onOpen\(deal\.id, deal\.title\)/, 'deal rows are not tappable');
  assert.match(code, /a11yButton\(who \?/,
    'the row’s accessible name does not disambiguate two deals with the same title');
});

test('the detail sheet resolves its own state through the shared primitive', () => {
  // A sheet that fetches and does not resolve is the false-empty defect in a new
  // place: a 403 or a dropped connection would render as a deal with no
  // activities rather than as the answer it is.
  const code = readCode('screens/graha/DealDetailSheet.tsx');
  assert.match(code, /resolveScreenState\(/);
  assert.match(code, /isError:\s*detail\.isError/);
});

test('the contact timeline is fetched only when the rep asks for it', () => {
  // A fourth request on a sheet opened between meetings. Four of the five rows
  // it returns are already above it; the one that is not — an unpaid invoice at
  // this customer — is the reason it exists, and it is worth a tap rather than a
  // request per deal opened.
  const code = readCode('screens/graha/DealDetailSheet.tsx');
  assert.match(code, /contactTimeline\(/, 'the deal sheet never reaches the timeline');
  assert.match(code, /enabled:\s*visible && showHistory/,
    'the timeline fetches on open rather than on request');
});

test('a failed timeline cannot blank a deal that loaded', () => {
  // The false-empty defect in a new place: a fourth query erroring must not take
  // the sheet with it, and must not read as "no history" either.
  const code = readCode('screens/graha/DealDetailSheet.tsx');
  assert.match(code, /timeline\.isError/, 'the timeline error is never checked');
  assert.match(code, /The history did not load/,
    'a failed timeline renders as an empty one');
});
