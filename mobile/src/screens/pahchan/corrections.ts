/**
 * Asking for a day to be corrected — the half of the feature that was missing.
 *
 * `POST /api/v1/pahchan/regularisations` has existed since the endpoints were
 * written, and until now NOTHING on any surface called it. The approve/decide
 * half works: HR has a Corrections queue with an Approve button and a decline
 * that demands a reason. The queue was permanently empty, and it read as "nobody
 * needs anything" rather than "nobody can ask".
 *
 * This module is the request, as arithmetic. Pure — no React, no react-native,
 * no network — for the same reason `register.ts` is: the numbers that decide
 * what somebody is paid for a day have to be readable and runnable without a
 * device. `CorrectionSheet.tsx` is the form; everything that can be got wrong is
 * here.
 *
 * ── Why `requested_at_time` is built rather than picked ───────────────────────
 *
 * The server takes `for_date` and `requested_at_time` as two independent
 * strings and checks NEITHER against the other. `services/attendance_bridge.py`
 * then uses them for two different things:
 *
 *   · `for_date` picks the day bucket — `reg_by_day[(employee_id, for_date)]`.
 *   · `at_time` is assigned VERBATIM to `check_in` / `check_out`, and
 *     `work_hours` is `(check_out - check_in)` in hours.
 *
 * So a timestamp that disagrees with `for_date` is not a display bug. Send
 * `for_date: '2026-07-06'` with `requested_at_time: '2026-07-06T18:30:00Z'` from
 * a phone in IST and the correction lands in the right bucket carrying a time
 * that is 00:00 on the 7th locally — five and a half hours of somebody's day,
 * every time, in the direction that pays them more or less depending on which
 * end was corrected. `new Date(...).toISOString()` produces exactly that string,
 * which is why the composition below is done by hand with the device's own
 * offset and then checked back against `localDayKey`.
 *
 * ── What is deliberately NOT here ─────────────────────────────────────────────
 *
 * No offline queue. `mutationQueue` discards after three failed retries and
 * `punchQueue` is 72-hour attendance storage that this is not; a correction that
 * was silently dropped after three backoff steps is an unpaid day nobody knows
 * about. So the send needs a connection, the sheet says so before you type, and
 * only a request the SERVER acknowledged is ever recorded as asked.
 */

import { storage } from '../../lib/storage';
import { localDayKey, hhmm } from './register';

/** `reason` on `RegularisationCreate`: `Field(..., min_length=3, max_length=500)`.
 *  Duplicated here so a too-short reason is a sentence rather than a 422 body,
 *  and pinned against the server's own literals by `__tests__/corrections.test.ts`. */
export const REASON_MIN = 3;
export const REASON_MAX = 500;

export type PunchDirection = 'in' | 'out';

/** What the employee filled in. Wall-clock, in their own head and their own zone. */
export interface CorrectionDraft {
  employeeId: string;
  /** Local calendar day, `YYYY-MM-DD` — the key `register.ts` builds. */
  forDate:    string;
  direction:  PunchDirection;
  /** The time on `forDate` they say it was, `HH:MM`. */
  time:       string;
  reason:     string;
  /** The punch being corrected, when there is one to point at. */
  punchId?:   string | null;
}

/** The body `RegularisationCreate` accepts. Field-for-field, nothing extra. */
export interface CorrectionBody {
  employee_id:         string;
  for_date:            string;
  requested_direction: PunchDirection;
  requested_at_time:   string;
  reason:              string;
  punch_id?:           string;
}

export type BuildResult =
  | { ok: true;  body: CorrectionBody }
  | { ok: false; problem: string };

const DAY_RE  = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

/**
 * An ISO instant carrying the device's OWN offset, not `Z`.
 *
 * `toISOString()` is the wrong tool twice over: it converts to UTC, so the
 * date and the clock in the string are both somebody else's, and the audit row
 * an HR admin later reads says a time the employee never claimed. Postgres
 * stores the same instant either way — the difference is entirely in what the
 * string means to the two humans who look at it.
 */
export function localIso(d: Date): string {
  const pad = (n: number) => `${Math.abs(Math.trunc(n))}`.padStart(2, '0');
  const offsetMinutes = -d.getTimezoneOffset();      // minutes EAST of UTC
  const sign = offsetMinutes < 0 ? '-' : '+';
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
    + `T${pad(d.getHours())}:${pad(d.getMinutes())}:00`
    + `${sign}${pad(offsetMinutes / 60)}:${pad(offsetMinutes % 60)}`;
}

/** `HH:MM` on `YYYY-MM-DD`, as a Date in the device's zone. Invalid input → null. */
export function localInstant(forDate: string, time: string): Date | null {
  if (!DAY_RE.test(forDate) || !TIME_RE.test(time)) return null;
  const [y, m, d] = forDate.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  const at = new Date(y, m - 1, d, hh, mm, 0, 0);
  if (Number.isNaN(at.getTime())) return null;
  // `new Date(2026, 1, 31)` is 3 March, silently. A day that rolled is a day
  // the employee did not choose, and it would file the correction against
  // somebody else's Tuesday.
  if (at.getFullYear() !== y || at.getMonth() !== m - 1 || at.getDate() !== d) return null;
  return at;
}

/**
 * Turn a filled-in form into the request body, or say why it cannot be one.
 *
 * Every refusal here is one the server would also make — as a 422 whose body is
 * a pydantic error list, or as a CHECK violation surfacing as a 500. Saying it
 * in a sentence on the phone is the only version the employee can act on.
 */
export function buildCorrection(draft: CorrectionDraft, now: Date = new Date()): BuildResult {
  if (!draft.employeeId) {
    return {
      ok: false,
      problem: 'This phone does not know which attendance record is yours yet. '
        + 'Open your register once while online, then try again.',
    };
  }

  const at = localInstant(draft.forDate, draft.time);
  if (!at) {
    return {
      ok: false,
      problem: `${draft.time || 'That time'} on ${draft.forDate || 'that day'} is not a `
        + 'time this can send. Use a 24-hour time like 18:30.',
    };
  }

  const reason = draft.reason.trim();
  if (reason.length < REASON_MIN) {
    return {
      ok: false,
      problem: 'Say what happened. Somebody at your organisation reads this and '
        + 'decides on it, and there is nothing else on the request for them to go on.',
    };
  }
  if (reason.length > REASON_MAX) {
    return {
      ok: false,
      problem: `That reason is ${reason.length} characters and the limit is ${REASON_MAX}. `
        + 'Trim it — the whole of it is stored and shown to the reviewer.',
    };
  }

  // A time that has not happened yet is not a correction, it is a claim. The
  // bridge would assign it to `check_out` and price the hours up to it.
  if (at.getTime() > now.getTime()) {
    return {
      ok: false,
      problem: `${draft.time} on ${draft.forDate} has not happened yet. A correction `
        + 'records a time that passed, so it cannot be in the future.',
    };
  }

  // The invariant the payroll bridge depends on, asserted rather than assumed.
  // `for_date` picks the day bucket and `requested_at_time` becomes the actual
  // clock value — if they disagree, the hours are wrong by the difference.
  const iso = localIso(at);
  if (localDayKey(iso) !== draft.forDate) {
    return {
      ok: false,
      problem: 'This phone built a timestamp on a different day from the one you '
        + 'picked, so nothing has been sent. Check the date and time on the device.',
    };
  }

  const body: CorrectionBody = {
    employee_id:         draft.employeeId,
    for_date:            draft.forDate,
    requested_direction: draft.direction,
    requested_at_time:   iso,
    reason,
  };
  // Omitted rather than sent as null: the INSERT reads `NULLIF($3,'')::uuid`, so
  // an absent punch is an absent key, and a `null` in the JSON is the same thing
  // said less clearly.
  if (draft.punchId) body.punch_id = draft.punchId;

  return { ok: true, body };
}

/**
 * What this correction would do to the day, said before it is sent.
 *
 * Advisory, never a refusal. `build_day_records` applies an approved correction
 * on top of the punches, so a clock-out earlier than the clock-in produces
 * `STATUS_INCOMPLETE` with `work_hours = None` — the day pays nothing and the
 * employee finds out weeks later on a payslip. Saying it here costs one line and
 * the employee can fix the number while they still remember the day.
 *
 * It does NOT block, for the same reason nothing blocks a punch: only the person
 * who was there knows what happened, and a night shift really can clock out
 * before it clocked in on the calendar day the app drew.
 */
export function pairingWarning(
  direction: PunchDirection,
  requestedIso: string,
  existing: { firstIn?: string; lastOut?: string },
): string | null {
  const at = new Date(requestedIso).getTime();
  if (Number.isNaN(at)) return null;

  if (direction === 'out' && existing.firstIn) {
    const inAt = new Date(existing.firstIn).getTime();
    if (!Number.isNaN(inAt) && at <= inAt) {
      return `You clocked in at ${hhmm(existing.firstIn)}. A clock-out at or before that `
        + 'cannot be paired with it, so payroll would read the day as incomplete and pay '
        + 'nothing for it. Send it anyway if that is really what happened.';
    }
  }

  if (direction === 'in' && existing.lastOut) {
    const outAt = new Date(existing.lastOut).getTime();
    if (!Number.isNaN(outAt) && at >= outAt) {
      return `Your clock-out that day was ${hhmm(existing.lastOut)}. A clock-in at or after `
        + 'that cannot be paired with it, so payroll would read the day as incomplete and pay '
        + 'nothing for it. Send it anyway if that is really what happened.';
    }
  }

  return null;
}

// ── What this phone has already asked for ────────────────────────────────────

/**
 * The corrections THIS DEVICE sent and the server acknowledged.
 *
 * Not a cache of the queue — there is no endpoint an employee may call to read
 * their own requests. `GET /regularisations` is gated on `org_owner`/`org_admin`,
 * so the only correction status an employee can be shown is the one their own
 * phone watched succeed.
 *
 * Which is exactly why nothing is written here until the POST returns 201 with
 * an id. Recording the attempt would produce a register that says "requested" for
 * a request nobody received, and that is a worse failure than the one this whole
 * feature exists to fix: the employee stops chasing it.
 *
 * The screen is careful to label these as what they are — asked, and awaiting a
 * decision this app cannot see. See `CorrectionSheet.tsx`.
 */
const ASKED_KEY = 'pahchan_corrections_asked';

/** How long an ask stays on the phone. Long enough to cover any payroll cycle
 *  it could still be argued over, short enough not to grow without limit. */
export const ASKED_RETENTION_MS = 180 * 24 * 60 * 60 * 1000;

export interface AskedCorrection {
  /** The row id the server returned. Its presence is the acknowledgement. */
  id:          string;
  /** Absent on a row that came back from `/regularisations/mine`: that endpoint
   *  selects by the caller's own employee record, so it has no reason to name
   *  one and the register has no use for it. */
  employee_id?: string;
  for_date:    string;
  direction:   PunchDirection;
  at_time:     string;
  asked_at:    string;
  /** The organisation's answer, once there is one. Absent on the locally-stored
   *  record, which only ever knows that the request was made — this device
   *  cannot learn the outcome on its own. */
  status?:        'pending' | 'approved' | 'rejected';
  decided_at?:    string | null;
  decision_note?: string | null;
}

function readAsked(): AskedCorrection[] {
  const raw = storage.getString(ASKED_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as AskedCorrection[]) : [];
  } catch {
    return [];
  }
}

function writeAsked(rows: AskedCorrection[]): void {
  storage.set(ASKED_KEY, JSON.stringify(rows));
}

/** Every ask still within retention, oldest first. */
export function getAsked(now: number = Date.now()): AskedCorrection[] {
  return readAsked().filter((a) => {
    const t = new Date(a.asked_at).getTime();
    // An unparseable stamp is kept rather than dropped: losing the record of an
    // ask is the failure this exists to prevent, and a bad date is not evidence
    // the ask did not happen.
    return Number.isNaN(t) || now - t < ASKED_RETENTION_MS;
  });
}

/** Record an acknowledged ask. Same day AND same direction replaces in place —
 *  a second ask for the same clock-out is the same question asked again. */
export function rememberAsked(ask: AskedCorrection, now: number = Date.now()): void {
  const kept = getAsked(now).filter(
    a => !(a.for_date === ask.for_date
        && a.direction === ask.direction
        && a.employee_id === ask.employee_id),
  );
  kept.push(ask);
  writeAsked(kept);
}

/** What this phone has asked for on one day. */
export function askedFor(forDate: string, now: number = Date.now()): AskedCorrection[] {
  return getAsked(now).filter(a => a.for_date === forDate);
}

/** Drop anything past retention. Called when the register mounts. */
export function pruneAsked(now: number = Date.now()): number {
  const before = readAsked();
  const after = getAsked(now);
  if (after.length !== before.length) writeAsked(after);
  return before.length - after.length;
}

/** Test seam. Nothing in the app calls this. */
export function __clearAsked(): void {
  storage.delete(ASKED_KEY);
}
