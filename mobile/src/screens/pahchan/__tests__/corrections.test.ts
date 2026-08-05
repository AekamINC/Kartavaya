/**
 * Asking for a day to be corrected.
 *
 * `POST /api/v1/pahchan/regularisations` had no caller on any surface. The
 * approve half — the HR queue, the decline-needs-a-reason gate, the audit row —
 * was built and worked; the queue was permanently empty because nobody could put
 * anything in it, and an empty queue rendered as a green tick.
 *
 * ── What is actually proven here, and what is not ─────────────────────────────
 *
 * The first three sections run the REAL `corrections.ts` — no source reading, no
 * mocks beyond the in-memory MMKV the harness swaps in for the JSI binding. The
 * arithmetic that decides which day a correction lands on and what clock value
 * payroll reads off it is exercised directly.
 *
 * The fourth reads `backend/routers/pahchan_attendance.py` and compares the body
 * this client actually builds against the pydantic model that has to accept it.
 * Same instrument as `api/__tests__/serverContract.test.ts` and for the same
 * reason: the server is Python, so every field name is a string on one side and
 * a string on the other and `tsc` cannot see the gap.
 *
 * The fifth is a SOURCE-CONTRACT read of two `.tsx` files. Node's type-stripping
 * does not transform JSX, so a screen cannot be rendered here at all. Those
 * checks prove the entry point is wired and that nothing is recorded before the
 * server answers; they do not prove a finger on the button does anything.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

import { srcPath, readCode } from '../../../test/source.ts';
import { localDayKey } from '../register.ts';
import {
  REASON_MIN, REASON_MAX, ASKED_RETENTION_MS,
  buildCorrection, localInstant, localIso, pairingWarning,
  getAsked, rememberAsked, askedFor, pruneAsked, __clearAsked,
  type AskedCorrection, type CorrectionDraft,
} from '../corrections.ts';

const DRAFT: CorrectionDraft = {
  employeeId: 'e-1',
  forDate:    '2026-07-06',
  direction:  'out',
  time:       '18:30',
  reason:     'Phone battery died before I could clock out.',
};

/** A time far enough in the past that "not in the future" cannot flap. */
const NOW = new Date('2026-08-01T12:00:00+05:30');

function ok(over: Partial<CorrectionDraft> = {}) {
  const r = buildCorrection({ ...DRAFT, ...over }, NOW);
  assert.ok(r.ok, `expected a body, got: ${r.ok ? '' : r.problem}`);
  return r.body;
}

function refused(over: Partial<CorrectionDraft>) {
  const r = buildCorrection({ ...DRAFT, ...over }, NOW);
  assert.ok(!r.ok, 'expected a refusal, got a body');
  return r.problem;
}

// ── 1 · The timestamp, which is the whole payroll risk ───────────────────────

test('THE UTC DEFECT — requested_at_time carries the device offset, never Z', () => {
  // `services/attendance_bridge.py` assigns `at_time` VERBATIM to check_in /
  // check_out and prices `(check_out - check_in)` in hours. `for_date` picks the
  // bucket and is checked against nothing. So a body built with
  // `new Date(...).toISOString()` files in the right bucket carrying a clock
  // value shifted by the device's whole offset — five and a half hours of
  // somebody's day, in the direction that pays them more or less depending on
  // which end was corrected.
  //
  // Asserted as a property of the string rather than against a fixed literal, so
  // it holds on a runner in any zone: toISOString ALWAYS ends in Z, and the
  // offset this must carry is the machine's own.
  const at = ok().requested_at_time;
  assert.ok(!at.endsWith('Z'), `requested_at_time is a UTC instant: ${at}`);

  const m = /([+-])(\d{2}):(\d{2})$/.exec(at);
  assert.ok(m, `requested_at_time carries no offset at all: ${at}`);
  const signed = (m![1] === '-' ? -1 : 1) * (Number(m![2]) * 60 + Number(m![3]));
  assert.equal(
    signed, -new Date('2026-07-06T12:00:00Z').getTimezoneOffset(),
    'the offset in the string is not this device\'s offset on that day',
  );
});

test('the clock value the employee typed is the clock value that is sent', () => {
  // The reader on the other end is a person deciding whether 18:30 is when this
  // employee left. A string that says a different hour than they picked is the
  // defect, whatever instant it denotes.
  const at = ok({ time: '18:30' }).requested_at_time;
  assert.match(at, /T18:30:00/);
  const parsed = new Date(at);
  assert.equal(parsed.getHours(), 18, 'the instant does not land on 18:00 local');
  assert.equal(parsed.getMinutes(), 30);
});

test('for_date and requested_at_time can never disagree about the day', () => {
  // The invariant `build_day_records` depends on: the bucket key and the clock
  // value must be the same calendar day, or the hours are wrong by the gap.
  // Both ends of the day, because that is where a UTC shift crosses midnight.
  for (const time of ['00:05', '05:15', '09:02', '18:30', '23:55']) {
    const body = ok({ time });
    assert.equal(
      localDayKey(body.requested_at_time), body.for_date,
      `${time} produced ${body.requested_at_time}, which is not on ${body.for_date}`,
    );
  }
});

test('a date that does not exist is refused rather than rolled', () => {
  // `new Date(2026, 1, 31)` is 3 March, silently — which would file the
  // correction against a Tuesday the employee never looked at.
  assert.equal(localInstant('2026-02-31', '09:00'), null);
  assert.equal(localInstant('2026-13-01', '09:00'), null);
  assert.equal(localInstant('not-a-day', '09:00'), null);
  assert.equal(localInstant('2026-07-06', '25:00'), null);
  assert.equal(localInstant('2026-07-06', '9:00'), null);
  assert.equal(localInstant('2026-07-06', '18:60'), null);
  assert.ok(localInstant('2026-02-28', '09:00'), 'a real February day still works');
});

test('localIso zero-pads a single-digit offset hour', () => {
  // A '+5:30' or a '+530' is not an offset any parser accepts, and the failure
  // would be a 422 on a payroll request the employee has already typed out.
  const at = localIso(new Date(2026, 6, 6, 9, 2));
  assert.match(at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00[+-]\d{2}:\d{2}$/, at);
});

// ── 2 · What it refuses, and what it only warns about ────────────────────────

test('a time that has not happened yet is refused', () => {
  // The bridge would assign it to check_out and price the hours up to it.
  const problem = buildCorrection(
    { ...DRAFT, forDate: '2026-08-01', time: '23:00' },
    NOW,
  );
  assert.ok(!problem.ok);
  assert.match(problem.problem, /has not happened yet/);

  // And the same clock time on the same day, once it HAS passed, is fine.
  const later = buildCorrection(
    { ...DRAFT, forDate: '2026-08-01', time: '23:00' },
    new Date('2026-08-02T09:00:00+05:30'),
  );
  assert.ok(later.ok);
});

test('a reason shorter than the server accepts is refused here, in a sentence', () => {
  // The server's own gate is `Field(..., min_length=3)`, whose refusal is a
  // pydantic error list. This one is readable.
  assert.match(refused({ reason: '' }), /Say what happened/);
  assert.match(refused({ reason: '  ' }), /Say what happened/);
  assert.match(refused({ reason: 'ok' }), /Say what happened/);
  assert.ok(buildCorrection({ ...DRAFT, reason: 'car' }, NOW).ok, `${REASON_MIN} is the floor`);
});

test('an over-long reason is refused, and the whole limit is named', () => {
  const problem = refused({ reason: 'x'.repeat(REASON_MAX + 1) });
  assert.match(problem, new RegExp(`${REASON_MAX}`));
  assert.ok(buildCorrection({ ...DRAFT, reason: 'x'.repeat(REASON_MAX) }, NOW).ok);
});

test('the reason is trimmed before it is measured and before it is sent', () => {
  const body = ok({ reason: '   Gate log shows 10:20.   ' });
  assert.equal(body.reason, 'Gate log shows 10:20.');
});

test('punch_id is omitted when there is no punch to point at, not sent as null', () => {
  // The INSERT reads `NULLIF($3,'')::uuid`. A JSON null is the same thing said
  // less clearly, and an empty string would be a cast error.
  assert.ok(!('punch_id' in ok()), 'punch_id is present on a request with no punch');
  assert.ok(!('punch_id' in ok({ punchId: null })));
  assert.equal(ok({ punchId: 'p-9' }).punch_id, 'p-9');
});

test('a pairing that payroll cannot read WARNS and is still sendable', () => {
  // `build_day_records`: `if rec.check_out <= rec.check_in` → STATUS_INCOMPLETE
  // and `work_hours = None`. The day pays nothing and the employee finds out on
  // a payslip weeks later.
  const morning = new Date(2026, 6, 6, 9, 2).toISOString();
  const at = localIso(new Date(2026, 6, 6, 8, 30));

  const warn = pairingWarning('out', at, { firstIn: morning });
  assert.ok(warn, 'a clock-out before the clock-in raised no warning');
  assert.match(warn!, /incomplete/);
  assert.match(warn!, /pay\s*\n?\s*nothing|pays? nothing|pay nothing/);

  // Equal counts too — the server's comparison is `<=`.
  assert.ok(pairingWarning('out', morning, { firstIn: morning }));

  // And it does NOT block: only the person who was there knows whether a night
  // shift really did end before it started on the calendar day this app drew.
  assert.ok(buildCorrection({ ...DRAFT, time: '08:30' }, NOW).ok);
});

test('a clock-in at or after the recorded clock-out warns the same way', () => {
  const evening = new Date(2026, 6, 6, 17, 30).toISOString();
  assert.ok(pairingWarning('in', localIso(new Date(2026, 6, 6, 18, 0)), { lastOut: evening }));
  assert.ok(pairingWarning('in', evening, { lastOut: evening }));
  assert.equal(pairingWarning('in', localIso(new Date(2026, 6, 6, 9, 0)), { lastOut: evening }), null);
});

test('an ordinary correction raises no warning', () => {
  const morning = new Date(2026, 6, 6, 9, 2).toISOString();
  assert.equal(pairingWarning('out', localIso(new Date(2026, 6, 6, 17, 30)), { firstIn: morning }), null);
  assert.equal(pairingWarning('out', localIso(new Date(2026, 6, 6, 17, 30)), {}), null);
  assert.equal(pairingWarning('out', 'not-a-time', { firstIn: morning }), null);
  assert.equal(pairingWarning('out', localIso(new Date()), { firstIn: 'rubbish' }), null);
});

// ── 3 · What this phone has already asked for ────────────────────────────────

const ASK = (over: Partial<AskedCorrection> = {}): AskedCorrection => ({
  id:          'r-1',
  employee_id: 'e-1',
  for_date:    '2026-07-06',
  direction:   'out',
  at_time:     '2026-07-06T18:30:00+05:30',
  asked_at:    '2026-07-07T09:00:00+05:30',
  ...over,
});

test('an ask is remembered per day and per direction', () => {
  __clearAsked();
  rememberAsked(ASK());
  rememberAsked(ASK({ id: 'r-2', direction: 'in', at_time: '2026-07-06T09:00:00+05:30' }));

  const day = askedFor('2026-07-06');
  assert.equal(day.length, 2, 'both ends of one day must be recordable');
  assert.deepEqual(day.map(a => a.direction).sort(), ['in', 'out']);
  assert.equal(askedFor('2026-07-07').length, 0);
});

test('asking again for the same end of the same day REPLACES rather than stacks', () => {
  // Otherwise the register grows a second "you asked for this" line every time
  // somebody retries, and the day reads as though it is in dispute twice.
  __clearAsked();
  rememberAsked(ASK());
  rememberAsked(ASK({ id: 'r-9', at_time: '2026-07-06T19:15:00+05:30' }));

  const day = askedFor('2026-07-06');
  assert.equal(day.length, 1);
  assert.equal(day[0].id, 'r-9');
  assert.equal(day[0].at_time, '2026-07-06T19:15:00+05:30');
});

test('two employees on one device do not overwrite each other', () => {
  __clearAsked();
  rememberAsked(ASK());
  rememberAsked(ASK({ id: 'r-3', employee_id: 'e-2' }));
  assert.equal(askedFor('2026-07-06').length, 2);
});

test('asks older than the retention window are dropped', () => {
  // Written while they were fresh and read back after the window has passed,
  // which is the only sequence a real device produces. `rememberAsked` prunes as
  // it writes, so seeding an already-expired row through it would prove nothing.
  __clearAsked();
  const then = Date.parse('2026-01-01T00:00:00Z');
  rememberAsked(ASK({ id: 'old', asked_at: new Date(then).toISOString() }), then);
  rememberAsked(ASK({ id: 'older', direction: 'in', asked_at: new Date(then + 1000).toISOString() }), then);
  assert.equal(getAsked(then).length, 2, 'both were recorded');

  const later = then + ASKED_RETENTION_MS + 5000;
  assert.deepEqual(getAsked(later), [], 'an expired ask is still being read back');
  assert.equal(pruneAsked(later), 2, 'prune reported the wrong number of drops');
  assert.equal(pruneAsked(later), 0, 'a second prune drops nothing');

  rememberAsked(ASK({ id: 'fresh', asked_at: new Date(later).toISOString() }), later);
  assert.deepEqual(getAsked(later).map(a => a.id), ['fresh']);
});

test('an ask with an unreadable timestamp is KEPT, not silently discarded', () => {
  // Losing the record of an ask is the failure this exists to prevent, and a bad
  // date is not evidence the ask did not happen.
  __clearAsked();
  rememberAsked(ASK({ asked_at: 'nonsense' }));
  assert.equal(getAsked().length, 1);
});

test('a corrupted store reads as empty rather than throwing on the register', () => {
  __clearAsked();
  rememberAsked(ASK());
  assert.equal(getAsked().length, 1);
  __clearAsked();
  assert.deepEqual(getAsked(), []);
});

// ── 4 · The server contract ──────────────────────────────────────────────────

function backendDir(): string {
  let dir = srcPath('..');
  for (let i = 0; i < 5; i++) {
    const candidate = path.join(dir, 'backend');
    if (existsSync(path.join(candidate, 'server.py'))) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(
    'Could not locate backend/ from mobile/src. This is a client↔server contract '
    + 'test; without the server there is nothing to compare against and passing '
    + 'would mean nothing.',
  );
}

const ROUTER = readFileSync(
  path.join(backendDir(), 'routers', 'pahchan_attendance.py'), 'utf8',
);

/**
 * Python with `#` comments and triple-quoted docstrings removed, ordinary string
 * literals kept.
 *
 * The literals are load-bearing here — `pattern="^(in|out)$"` IS the contract —
 * so this cannot use the blunt instrument. The comments have to go for the usual
 * reason: `pahchan_attendance.py` documents its own defects in prose, including
 * the paragraph explaining that `rejected` is not a value this table can hold,
 * and a grep over the file matches its own explanation.
 */
function stripPy(src: string): string {
  let out = '';
  let i = 0;
  while (i < src.length) {
    const three = src.slice(i, i + 3);
    if (three === '"""' || three === "'''") {
      const end = src.indexOf(three, i + 3);
      i = end === -1 ? src.length : end + 3;
      out += ' ';
      continue;
    }
    const c = src[i];
    if (c === '#') {
      while (i < src.length && src[i] !== '\n') i++;
      continue;
    }
    if (c === '"' || c === "'") {
      out += c;
      i++;
      while (i < src.length) {
        if (src[i] === '\\') { out += src[i] + (src[i + 1] ?? ''); i += 2; continue; }
        out += src[i];
        if (src[i] === c) { i++; break; }
        i++;
      }
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

const ROUTER_CODE = stripPy(ROUTER);

/** The body of `class RegularisationCreate(BaseModel):`, comments removed. */
function modelBody(): string {
  const at = ROUTER_CODE.indexOf('class RegularisationCreate(BaseModel):');
  assert.notEqual(at, -1, 'pahchan_attendance.py no longer declares RegularisationCreate');
  const rest = ROUTER_CODE.slice(at);
  const next = rest.slice(1).search(/\n(?:class |@router|async def |def )/);
  return next === -1 ? rest : rest.slice(0, next + 1);
}

/** `{ field: { required } }` for the pydantic model. */
function modelFields(): Record<string, { required: boolean }> {
  const out: Record<string, { required: boolean }> = {};
  for (const line of modelBody().split('\n').slice(1)) {
    const m = /^\s{4}(\w+)\s*:\s*(.+?)\s*$/.exec(line);
    if (!m) continue;
    // A default of any kind makes it optional; `Field(...)` is the required form
    // and its ellipsis is inside the call, not an assignment default.
    const rhs = m[2];
    const assigned = /=\s*(.+)$/.exec(rhs);
    const required = !assigned || /^Field\(\s*\.\.\./.test(assigned[1]);
    out[m[1]] = { required };
  }
  return out;
}

test('the parse of RegularisationCreate found a real model', () => {
  // A contract test that quietly stops comparing is indistinguishable from one
  // that passes, so the parse is checked before anything is concluded from it.
  const fields = modelFields();
  assert.ok(
    Object.keys(fields).length >= 5,
    `read ${Object.keys(fields).length} fields off RegularisationCreate: ${Object.keys(fields)}`,
  );
  assert.ok(fields.employee_id?.required, 'employee_id parsed as optional');
  assert.equal(fields.punch_id?.required, false, 'punch_id parsed as required');
});

test('every field this client sends is one RegularisationCreate accepts', () => {
  // Taken off a real build rather than off the TypeScript interface, because the
  // interface is what we intended and the object is what goes on the wire.
  const sent = new Set([...Object.keys(ok()), ...Object.keys(ok({ punchId: 'p-1' }))]);
  const accepted = modelFields();
  for (const name of sent) {
    assert.ok(
      accepted[name],
      `the client sends "${name}" and RegularisationCreate accepts `
      + `[${Object.keys(accepted).join(', ')}]. Pydantic ignores an unknown field by `
      + `default, so this does not 4xx — the value is simply dropped, and for `
      + `requested_at_time that means a correction with no time on it.`,
    );
  }
});

test('every REQUIRED field of RegularisationCreate is sent', () => {
  const sent = new Set(Object.keys(ok()));
  for (const [name, spec] of Object.entries(modelFields())) {
    if (!spec.required) continue;
    assert.ok(
      sent.has(name),
      `RegularisationCreate requires "${name}" and the client never sends it — `
      + 'every correction request would 422.',
    );
  }
});

test('the direction values the client can send are the ones the pattern admits', () => {
  const m = /requested_direction[^\n]*pattern="([^"]+)"/.exec(modelBody());
  assert.ok(m, 'requested_direction no longer carries a pattern');
  const re = new RegExp(m![1]);
  for (const direction of ['in', 'out'] as const) {
    assert.ok(
      re.test(ok({ direction }).requested_direction),
      `the server's pattern ${m![1]} refuses "${direction}"`,
    );
  }
  // And the pattern is still narrow enough to be worth agreeing with.
  assert.ok(!re.test('IN'));
  assert.ok(!re.test('inout'));
});

test('the reason bounds are the server\'s own, not a second opinion', () => {
  const line = /reason\s*:\s*str\s*=\s*Field\(([^)]*)\)/.exec(modelBody());
  assert.ok(line, 'reason no longer declares a Field with bounds');
  const min = /min_length\s*=\s*(\d+)/.exec(line![1]);
  const max = /max_length\s*=\s*(\d+)/.exec(line![1]);
  assert.ok(min && max, `could not read the bounds off: ${line![1]}`);
  assert.equal(REASON_MIN, Number(min![1]), 'the client and the server disagree on the minimum');
  assert.equal(REASON_MAX, Number(max![1]), 'the client and the server disagree on the maximum');
});

test('the client posts to the path the router actually mounts', () => {
  const prefix = /APIRouter\(prefix="([^"]+)"/.exec(ROUTER_CODE);
  assert.ok(prefix, 'the router no longer declares a prefix');
  const route = /@router\.post\("(\/regularisations)"/.exec(ROUTER_CODE);
  assert.ok(route, 'the router no longer declares POST /regularisations');

  const client = readCode('api/pahchan.ts');
  const m = /post<CorrectionCreated>\('([^']+)'/.exec(client);
  assert.ok(m, 'api/pahchan.ts no longer posts a correction');
  // `apiClient` is created with `baseURL: `${BASE_URL}/api``, so the client path
  // is the mounted path with that prefix removed.
  assert.equal(
    `/api${m![1]}`, `${prefix![1]}${route![1]}`,
    `the client posts to /api${m![1]} and the route is ${prefix![1]}${route![1]}`,
  );
});

test('the client does NOT try to list corrections — that route is reviewer-only', () => {
  // `GET /regularisations` carries `_r=Depends(_review_gate)` with
  // `require_org_role('org_owner','org_admin')`. An employee calling it gets a
  // 403, and a screen that treats a 403 as "no corrections" is the same
  // false-empty defect this product has already shipped once.
  const gate = /@router\.get\("\/regularisations"\)[\s\S]{0,400}?_review_gate/.test(ROUTER_CODE);
  assert.ok(gate, 'GET /regularisations is no longer reviewer-gated — the client may now read it');

  const client = readCode('api/pahchan.ts');
  assert.ok(
    !/get<[^>]*>\('\/v1\/pahchan\/regularisations'/.test(client),
    'the mobile client now reads the reviewer-gated correction queue; an '
    + 'employee gets a 403 from it',
  );
});

// ── 5 · The entry point, on the register ─────────────────────────────────────

const HISTORY = readCode('screens/pahchan/AttendanceHistory.tsx');
const SHEET = readCode('screens/pahchan/CorrectionSheet.tsx');

test('the register can open the correction sheet', () => {
  assert.match(HISTORY, /import CorrectionSheet from '\.\/CorrectionSheet'/);
  assert.match(HISTORY, /<CorrectionSheet/, 'the sheet is imported but never rendered');
  assert.match(HISTORY, /Ask for a correction/, 'the register offers no way in');
});

test('THE DEAD CELL — a past day with no record is selectable', () => {
  // It was `disabled={!rec}`, which made the single most correctable day on the
  // calendar — the one where no punch reached us at all — the only cell that did
  // nothing when tapped. The screen said "No record" and offered nothing.
  assert.ok(
    !/disabled=\{!rec\}/.test(HISTORY),
    'the calendar cell is disabled again whenever the day has no record, so the '
    + 'day most in need of a correction cannot be opened',
  );
  assert.match(HISTORY, /disabled=\{future\}/, 'only a future day should be inert');
});

test('nothing is recorded as asked until the SERVER has answered', () => {
  // Writing the ask on the attempt puts "you asked for this" on a register for a
  // request nobody received, and the employee stops chasing it — worse than the
  // gap this feature closes.
  const request = SHEET.indexOf('await correctionsApi.request(');
  const remember = SHEET.indexOf('rememberAsked(');
  assert.ok(request !== -1, 'the sheet no longer calls the endpoint');
  assert.ok(remember !== -1, 'the sheet no longer records the ask');
  assert.ok(
    request < remember,
    'rememberAsked runs before the POST resolves, so a failed request would be '
    + 'shown to the employee as a correction their organisation has',
  );
  // And it is inside the try, before any catch can swallow it.
  const catchAt = SHEET.indexOf('} catch');
  assert.ok(remember < catchAt, 'the ask is recorded on the failure path');
});

test('the sheet builds its body through buildCorrection, not by hand', () => {
  // Everything proven in sections 1 and 2 is proven about `buildCorrection`. A
  // sheet that assembles its own object literal is covered by none of it.
  assert.match(SHEET, /buildCorrection\(/);
  assert.match(SHEET, /correctionsApi\.request\(built\.body\)/,
    'the sheet sends something other than the built body');
  assert.ok(
    !/requested_at_time:\s*(?!built)/.test(SHEET),
    'the sheet composes a timestamp itself',
  );
  assert.ok(!/toISOString\(\)\s*,?\s*\n?\s*for_date/.test(SHEET));
});

test('the sheet refuses to queue a correction offline, and says why', () => {
  // `mutationQueue` discards after three failed retries. For a correction that
  // is an unpaid day disposed of silently.
  assert.ok(
    !/enqueueMutation\(/.test(SHEET),
    'the correction now goes through the mutation queue, which drops an item '
    + 'after three failed retries',
  );
  assert.match(SHEET, /!online/, 'the sheet does not check whether it can send');
  assert.match(SHEET, /You are offline/, 'the offline state is not explained');
});

test('the sheet promises nothing about a decision it cannot see', () => {
  // There is no endpoint an employee may call to read their own requests, so the
  // app must not imply it will show them the outcome.
  assert.match(SHEET, /cannot show you their decision/);
  assert.ok(
    !/we['’]ll let you know|you will be notified|notify you when/i.test(SHEET),
    'the sheet promises a notification the product cannot send',
  );
});
