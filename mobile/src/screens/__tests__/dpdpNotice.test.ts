/**
 * The DPDP notice on the phone — the words, the gate, and the offline latch.
 *
 * ── THREE INSTRUMENTS, AND THEIR HONEST LIMITS ────────────────────────────────
 *
 * 1 · REAL. `noticeCopy.ts` and `noticeAck.ts` are plain TypeScript with no JSX,
 *     so they are IMPORTED and executed. `noticeAck` runs against the in-memory
 *     MMKV stub, which means the actual JSON round-trip and the actual key
 *     shape are exercised — not a description of them.
 *
 * 2 · AGAINST THE SPEC. The six lines are compared to
 *     `design-reference/Kartavaya Redesign/PahchanClock.jsx`, the prototype's
 *     `PhNotice`, parsed as text. This is a legal notice; the failure mode is a
 *     word, not a crash, so the assertion is against the specification itself.
 *
 * 3 · SOURCE-CONTRACT. `ClockScreen.tsx` and `AttendanceNotice.tsx` are `.tsx`
 *     and cannot be loaded by `node --test` at all — Node strips types but does
 *     not transform JSX. So the two decisions that matter about the gate — WHERE
 *     it sits in the early-return chain, and that the local latch is written
 *     BEFORE the network call — are asserted by reading the file. That proves
 *     the code says so. It does not prove the screen renders, that the button is
 *     44pt, or that the camera stayed shut; those need a device.
 *
 * A FAILED FILE READ FAILS THESE TESTS. It does not skip. "The file moved" and
 * "the file agrees" must not look the same from here.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { readCode, readRaw, srcPath } from '../../test/source.ts';
import {
  PAHCHAN_NOTICE_VERSION, NOTICE_TITLE, NOTICE_LEDE, NOTICE_ACK, NOTICE_LEGAL,
  RETENTION_FALLBACK, noticeLines,
} from '../pahchan/noticeCopy.ts';
import { localAck, setLocalAck, needsNotice } from '../pahchan/noticeAck.ts';

// ── The specification, and the web mirror ─────────────────────────────────────

/** Read, or throw with the path. Never returns a sentinel. */
function readOrFail(abs: string): string {
  try {
    return readFileSync(abs, 'utf8');
  } catch (err) {
    throw new Error(
      `Could not read ${abs}. This suite compares shipped copy against it, so a missing `
      + `file is a failure and not a skip. Original: ${(err as Error).message}`,
    );
  }
}

const PROTOTYPE = srcPath('../../design-reference/Kartavaya Redesign/PahchanClock.jsx');
const WEB_COPY = srcPath('../../frontend/src/lib/pahchanNotice.js');

/**
 * The prototype's six `['key', 'text']` pairs. Every string there is
 * single-quoted with no escaped quote, so `[^']+` is exact; the count assertion
 * below is what catches it if that ever stops being true.
 */
function prototypeLines(): Array<{ key: string; text: string }> {
  const src = readOrFail(PROTOTYPE);
  const out: Array<{ key: string; text: string }> = [];
  const re = /\[\s*'([^']+)',\s*'([^']+)'\s*\],/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) out.push({ key: m[1], text: m[2] });
  return out;
}

test('the prototype still holds exactly six disclosure lines', () => {
  assert.equal(prototypeLines().length, 6);
});

test('the keys are the prototype’s keys, in the prototype’s order', () => {
  assert.deepEqual(
    noticeLines().map(l => l.key),
    prototypeLines().map(l => l.key),
  );
});

test('five of the six lines are byte-for-byte the prototype’s', () => {
  const proto = prototypeLines();
  const ours = noticeLines();
  for (let i = 0; i < proto.length; i++) {
    if (proto[i].key === 'How long') continue;
    assert.equal(
      ours[i].text, proto[i].text,
      `line "${proto[i].key}" has been reworded. This is a legal notice — revert it, or `
      + 'change the prototype and have counsel confirm (07 §8).',
    );
  }
});

test('"How long" differs ONLY by substituting the org’s two figures', () => {
  // The fallbacks ARE the prototype's hardcoded 90 and 45, so rendered against
  // them the sentence must come out identical. That is what proves the deviation
  // is a substitution rather than a rewrite.
  const ours = noticeLines(RETENTION_FALLBACK).find(l => l.key === 'How long')!.text;
  const theirs = prototypeLines().find(l => l.key === 'How long')!.text;
  assert.equal(ours, theirs);
});

test('"How long" renders the org’s figures, never the constants', () => {
  const line = noticeLines({ punch_photo_days: 30, reference_photo_grace_days: 7 })
    .find(l => l.key === 'How long')!.text;
  assert.match(line, /deleted after 30 days/);
  assert.match(line, /deleted 7 days after you leave/);
  assert.doesNotMatch(line, /90/);
  assert.doesNotMatch(line, /45/);
});

test('"How long" states no number for the record itself', () => {
  // `record_retention_years` is the org's CONFIGURED window, which is not the
  // same claim as "as long as the law requires". A notice must not state the
  // stronger one.
  const line = noticeLines({ record_retention_years: 7 }).find(l => l.key === 'How long')!.text;
  assert.match(line, /as long as the law requires your employer to keep it/);
  assert.doesNotMatch(line, /7/);
});

// ── THE JOIN: the keys this phone reads are the keys the server sends ────────
//
// Both halves of this were tested and the join was not, which is where it broke.
// The tests above feed `noticeLines` a hand-written CLIENT-shaped dict; the
// backend had its own tests. Nothing fed this function the dict the endpoint
// actually sends — and until 6 August 2026 `GET /v1/pahchan/me` answered in two
// shapes. The employee branch used the names below; the no-employee branch
// returned the raw `pahchan_policy` row, whose column is
// `punch_photo_retention_days`.
//
// That is the branch EVERY caller takes (0 of 81 employee rows carry a
// `user_id`). `noticeLines` merges per key, so the unknown name was silently
// the fallback and the notice said 90 days whatever the org had configured.
// `MyBiometrics.tsx` has no fallback at all and rendered `undefined days`.

const BACKEND_ROUTER = srcPath('../../backend/routers/pahchan.py');

/** The keys `_retention()` builds, read out of the router itself. */
function serverKeys(): string[] {
  const src = readOrFail(BACKEND_ROUTER);
  const at = src.indexOf('def _retention(');
  assert.ok(at > -1, 'backend/routers/pahchan.py has no _retention() helper');
  const body = src.slice(at, src.indexOf('async def _employee_for', at));
  const keys = [...body.matchAll(/"([a-z_]+)":\s*policy\[/g)].map(m => m[1]);
  assert.equal(keys.length, 3, `_retention() returned no parseable keys:\n${body}`);
  return keys;
}

test('every key the endpoint emits is one this module reads', () => {
  assert.deepEqual(new Set(serverKeys()), new Set(Object.keys(RETENTION_FALLBACK)));
});

test('"How long" renders the org’s numbers from the REAL payload shape', () => {
  // Built from the server's own key names, not from ours. A rename on the
  // server carries into this dict, the merge falls back, and the 90 fails.
  const payload = Object.fromEntries(
    serverKeys().map((k, i) => [k, [30, 7, 8][i]]),
  );
  const line = noticeLines(payload as never).find(l => l.key === 'How long')!.text;
  assert.match(line, /deleted after 30 days/);
  assert.match(line, /deleted 7 days after you leave/);
  assert.doesNotMatch(line, /90/);
  assert.doesNotMatch(line, /45/);
});

test('both branches of GET /me go through the one retention helper', () => {
  // The defect was two dict literals, one per branch. The definition plus one
  // call site per branch is three.
  const src = readOrFail(BACKEND_ROUTER);
  assert.ok((src.match(/_retention\(/g) ?? []).length >= 3);
  assert.doesNotMatch(src, /"retention":\s*await\s+_policy\(/);
});

test('RetentionPromise declares exactly the fields the server sends', () => {
  // `MyBiometrics.tsx:155` interpolates `r.punch_photo_days` with NO fallback,
  // so a key the server does not send renders the string "undefined days,
  // then deleted" on a screen headed "How long these are kept".
  const api = readOrFail(srcPath('api/pahchan.ts'));
  const body = api.slice(api.indexOf('interface RetentionPromise'));
  const declared = new Set(
    [...body.slice(0, body.indexOf('}')).matchAll(/([a-z_]+)\s*:/g)].map(m => m[1]),
  );
  assert.deepEqual(declared, new Set(serverKeys()));
});

test('the title, lede, button and legal footer are the prototype’s', () => {
  const src = readOrFail(PROTOTYPE);
  for (const s of [NOTICE_TITLE.en, NOTICE_TITLE.hi, NOTICE_LEDE, NOTICE_ACK, NOTICE_LEGAL]) {
    assert.ok(src.includes(s), `the prototype does not contain: ${s}`);
  }
});

test('the notice classifies itself as a notice and not as consent', () => {
  assert.match(NOTICE_LEGAL, /not a consent form/);
  assert.match(NOTICE_LEGAL, /legitimate use for employment/);
});

test('the complaint route exists — "Data Protection Board of India"', () => {
  // Absent from frontend/src, mobile/src and backend/ entirely before this
  // feature. It is the only route an employee has, and a notice without it is
  // not a DPDP notice.
  assert.match(noticeLines().find(l => l.key === 'Your rights')!.text, /Data Protection Board of India/);
});

test('the bilingual shape is {en, hi} — there is no gu arm', () => {
  assert.deepEqual(Object.keys(NOTICE_TITLE).sort(), ['en', 'hi']);
});

// ── The web mirror ────────────────────────────────────────────────────────────

test('the web copy module declares the same version string', () => {
  const web = readOrFail(WEB_COPY);
  const m = /PAHCHAN_NOTICE_VERSION\s*=\s*'([^']+)'/.exec(web);
  assert.ok(m, 'no PAHCHAN_NOTICE_VERSION found in frontend/src/lib/pahchanNotice.js');
  assert.equal(m![1], PAHCHAN_NOTICE_VERSION);
});

test('the web copy module carries the same words', () => {
  const web = readOrFail(WEB_COPY);
  for (const s of [NOTICE_TITLE.en, NOTICE_TITLE.hi, NOTICE_LEDE, NOTICE_ACK, NOTICE_LEGAL]) {
    assert.ok(web.includes(s), `the web mirror is missing: ${s}`);
  }
  for (const l of noticeLines()) {
    if (l.key === 'How long') continue;
    assert.ok(web.includes(l.text), `the web mirror is missing the "${l.key}" line`);
  }
});

test('the web copy module interpolates the same two figures into "How long"', () => {
  const web = readOrFail(WEB_COPY);
  assert.ok(web.includes('Punch photos are deleted after ${r.punch_photo_days} days.'));
  assert.ok(web.includes('reference photos are deleted ${r.reference_photo_grace_days} days after you leave.'));
  assert.ok(web.includes('as long as the law requires your employer to keep it.'));
});

// ── The offline latch ─────────────────────────────────────────────────────────
//
// These run for real against the in-memory MMKV stub.

test('a fresh account needs the notice', () => {
  assert.equal(needsNotice({ userId: 'user_fresh', serverAcknowledgedAt: null }), true);
});

test('nobody signed in is never shown it', () => {
  // Nothing to key an acknowledgement on, and nobody to show it to.
  assert.equal(needsNotice({ userId: undefined, serverAcknowledgedAt: null }), false);
  assert.equal(needsNotice({ userId: null, serverAcknowledgedAt: null }), false);
});

test('the gate is keyed on the ACCOUNT, not the employee record', () => {
  // Migration 113's measurement: 81 employee rows, 0 carrying a user_id, so
  // `_employee_for` resolves nobody and `/me` answers `{"employee": null}` to
  // everybody. Keyed on the employee id, this gate would never fire for anyone —
  // which is the notice not existing, with extra steps.
  const code = readCode('screens/pahchan/noticeAck.ts');
  assert.match(code, /userId/);
  assert.doesNotMatch(code, /employeeId/);
});

test('the server’s acknowledgement wins with no local latch at all', () => {
  // The row is keyed on the account, not the handset — so acknowledging on the
  // web means this never fires, and a new phone does not ask again.
  assert.equal(
    needsNotice({ userId: 'user_web_acked', serverAcknowledgedAt: '2026-08-06T09:41:00Z' }),
    false,
  );
  assert.equal(localAck('user_web_acked'), null);
});

test('the local latch clears the gate with NO server answer — the offline case', () => {
  assert.equal(needsNotice({ userId: 'user_offline', serverAcknowledgedAt: null }), true);
  setLocalAck('user_offline');
  assert.equal(needsNotice({ userId: 'user_offline', serverAcknowledgedAt: null }), false);
});

test('the local latch keeps the FIRST instant, not the most recent', () => {
  // The first time somebody was told is the fact, and it is the one that
  // actually preceded the photograph. Same rule as 113's unique index.
  const first = setLocalAck('user_twice', PAHCHAN_NOTICE_VERSION, '2026-08-06T09:41:00Z');
  const second = setLocalAck('user_twice', PAHCHAN_NOTICE_VERSION, '2026-08-07T18:12:00Z');
  assert.equal(first, '2026-08-06T09:41:00Z');
  assert.equal(second, '2026-08-06T09:41:00Z');
  assert.equal(localAck('user_twice'), '2026-08-06T09:41:00Z');
});

test('the latch is per account — a shared handset asks the second person', () => {
  setLocalAck('user_one');
  assert.equal(needsNotice({ userId: 'user_one', serverAcknowledgedAt: null }), false);
  assert.equal(needsNotice({ userId: 'user_two', serverAcknowledgedAt: null }), true);
});

test('the latch is per version — a reworded notice asks again', () => {
  setLocalAck('user_version', '2026-08-06.1');
  assert.equal(
    needsNotice({ userId: 'user_version', serverAcknowledgedAt: null, version: '2026-08-06.1' }),
    false,
  );
  assert.equal(
    needsNotice({ userId: 'user_version', serverAcknowledgedAt: null, version: '2027-01-01.1' }),
    true,
  );
});

// ── The gate, by source contract ──────────────────────────────────────────────

test('ClockScreen renders the notice BELOW the register and ABOVE the camera permission', () => {
  const code = readCode('screens/pahchan/ClockScreen.tsx');

  const history = code.indexOf("if (tab === 'history')");
  const gate = code.indexOf('mode="gate"');
  const permission = code.indexOf('if (!permission)');

  assert.ok(history > 0, "the tab === 'history' branch was not found");
  assert.ok(gate > 0, 'the notice gate was not found on ClockScreen');
  assert.ok(permission > 0, 'the camera-permission branch was not found');

  assert.ok(
    history < gate,
    'The notice must sit BELOW the register branch. Reading your own attendance record '
    + 'is not new processing, and someone looking at last month on a train must still '
    + 'be able to see it.',
  );
  assert.ok(
    gate < permission,
    'The notice must sit ABOVE the camera-permission branch. You tell somebody why you '
    + 'want their camera before you ask for it, and nothing has been asked at that point.',
  );
});

test('the gate writes the local latch BEFORE it touches the network', () => {
  // This ordering is the whole reason the gate is safe to put in front of a
  // punch. Reverse it and a person with no signal is trapped on a notice screen
  // with a camera behind it — 07 §2, nothing blocks a punch.
  const code = readCode('screens/pahchan/ClockScreen.tsx');
  const latch = code.indexOf('setLocalAck(');
  const post = code.indexOf('acknowledgeNotice(');
  assert.ok(latch > 0, 'setLocalAck is not called on ClockScreen');
  assert.ok(post > 0, 'acknowledgeNotice is not called on ClockScreen');
  assert.ok(latch < post, 'the local latch must be written before the POST is fired');
});

test('the gate offers no way out but the acknowledgement', () => {
  // "One tap and it is gone forever." A dismiss, a back arrow or an X would make
  // the notice skippable, which is the same as not serving it.
  const code = readCode('screens/pahchan/AttendanceNotice.tsx');
  const gateBlock = code.slice(code.indexOf("mode === 'reference'"));
  assert.doesNotMatch(gateBlock, /onDismiss|accessibilityLabel="Close"|name="close/);
});

test('the notice component takes retention as a prop and holds no figures of its own', () => {
  // A retention promise displayed from a constant is a promise about a different
  // system. The only numbers in this file are typography.
  const code = readCode('screens/pahchan/AttendanceNotice.tsx');
  assert.doesNotMatch(code, /punch_photo_days\s*[:=]\s*\d/);
  assert.doesNotMatch(code, /reference_photo_grace_days\s*[:=]\s*\d/);
  assert.ok(code.includes('noticeLines('), 'the component must render noticeLines(), not its own strings');
});

test('the notice is reachable from the Me tab after the gate has cleared', () => {
  // 07 §9, and `PahchanClock.jsx:151`'s "What we store" row. A notice you can
  // only ever see once is a notice somebody can honestly say they do not
  // remember being shown.
  const code = readCode('screens/pahchan/MyBiometrics.tsx');
  assert.match(code, /<AttendanceNotice[\s\S]*mode="reference"/);
});

test('the Me tab copy of the notice carries no acknowledge button', () => {
  const code = readCode('screens/pahchan/MyBiometrics.tsx');
  const el = /<AttendanceNotice[\s\S]*?\/>/.exec(code);
  assert.ok(el, 'AttendanceNotice is not rendered on the Me tab');
  assert.doesNotMatch(el![0], /onAck/);
});

test('the ack version sent to the server is the one this build renders', () => {
  // Not the server's own constant. A client on an older build must file the
  // wording IT showed — the row is the answer to "what were they shown".
  const code = readCode('screens/pahchan/ClockScreen.tsx');
  assert.match(code, /acknowledgeNotice\(PAHCHAN_NOTICE_VERSION/);
  assert.match(code, /pahchanApi\.me\(7,\s*PAHCHAN_NOTICE_VERSION\)/);
});

test('the LATCHED instant is sent, never a fresh one at sync time', () => {
  // 113's two clocks. `acknowledged_at` is when the person tapped and is what
  // must precede the first photograph; re-stamping it when the phone finds
  // signal destroys the only fact the row exists to hold.
  const code = readCode('screens/pahchan/ClockScreen.tsx');
  assert.doesNotMatch(
    code, /acknowledgeNotice\([^)]*new Date\(\)/,
    'the retry must send the latched instant, not the moment it happened to sync',
  );
  assert.match(code, /acknowledgeNotice\(PAHCHAN_NOTICE_VERSION,\s*at,/);
});

test('the sync retry declares itself offline and the live tap does not', () => {
  // `was_offline` is stated by the client rather than inferred from the two
  // timestamps — a phone with a wrong clock would make that inference lie in
  // both directions (113).
  const code = readCode('screens/pahchan/ClockScreen.tsx');
  assert.match(code, /acknowledgeNotice\(PAHCHAN_NOTICE_VERSION,\s*at,\s*false\)/);
  assert.match(code, /acknowledgeNotice\(PAHCHAN_NOTICE_VERSION,\s*at,\s*true\)/);
});

test('the notice copy module is not imported across the platform boundary', () => {
  // The two copies are guarded by these tests, not by an import that would
  // silently break on a build-config change. `mobile/` has no path into
  // `frontend/src` and must not grow one.
  const raw = readRaw('screens/pahchan/noticeCopy.ts');
  assert.doesNotMatch(raw, /from\s+['"][^'"]*frontend\//);
});
