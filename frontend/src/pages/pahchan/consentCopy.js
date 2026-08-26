/**
 * consentCopy.js — the words the consent screen adds, and the ones it may never say.
 *
 * ── THIS IS NOT A SECOND NOTICE ─────────────────────────────────────────────
 *
 * `lib/pahchanNotice.js` is the single source of the DPDP disclosure copy and
 * its header forbids paraphrasing the six lines — they are versioned, the
 * acknowledgement row is keyed on that version, and an edit costs everybody a
 * re-read. `Consent.jsx` renders those six through `noticeLines()` and does not
 * restate one of them. `History.jsx` was already made to defer the same way,
 * and `__tests__/dpdpNotice.test.jsx` holds it there.
 *
 * What is here is the part the notice deliberately does not carry: the CHOICE.
 * The notice's own last line is "This is a notice, not a consent form", and
 * that is accurate about the notice. It is not the whole of what this product
 * does, because `migrations/209` and `routers/pahchan.py::enroll_photo` treat a
 * recorded decline as binding — an enrolment is refused for anyone who has
 * declined, from any source, HR upload included.
 *
 * So the product's actual position has two halves and the copy states both:
 *
 *   · ATTENDANCE IS NOT OPTIONAL. Keeping an attendance register is a legal
 *     obligation on the employer, so "I would rather not be marked present" is
 *     not on offer and pretending otherwise would be a kindness that misleads.
 *   · THE PHOTOGRAPH IS. Storing a picture of somebody's face to verify them is
 *     the part that has an alternative, and the alternative is real — a
 *     supervisor records the day instead.
 *
 * Muddling those two is how a consent screen ends up either coercive ("agree or
 * you are absent") or dishonest ("say no and nothing changes").
 *
 * ── WHAT WITHDRAWAL ACTUALLY DOES, WHICH IS LESS THAN IT SOUNDS ─────────────
 *
 * Measured against the shipped code rather than the intent:
 *
 *   · New photographs stop. `enroll_photo` refuses (409), and
 *     `upload_punch_photo` refuses for an employee who has declined, before
 *     anything reaches the object store.
 *   · Photographs ALREADY STORED are not deleted by the withdrawal.
 *     `services/pahchan_retention.py::purge_reference_photos` only ever deletes
 *     a reference pair for somebody whose employee record has status
 *     'terminated', 'resigned' or 'absconding' — a leaver, not a withdrawer.
 *     Punch selfies go on the org's ordinary photo window (90 days by default).
 *
 * `WITHDRAW_LINES` says exactly that and no more. A consent screen promising a
 * deletion the product does not perform is the single worst thing this file
 * could contain — it is the one sentence a customer would repeat to a
 * regulator.
 *
 * ── AND NO CERTIFICATION, EVER ──────────────────────────────────────────────
 *
 * Aekam holds none. `BANNED_CLAIMS` is the executable half of that rule:
 * `__tests__/pahchanConsent.test.jsx` renders the screen and fails on any of
 * those words appearing in it. A comment saying "do not claim compliance" is a
 * comment; this is a check.
 */

/** Section title, in the module's bilingual shape. */
export const CONSENT_TITLE = Object.freeze({
  en: 'Your choice about the photograph',
  hi: 'आपकी सहमति',
});

/**
 * The lede. Two sentences, and the split between them is the whole point —
 * see the header. The first is the obligation, the second is the choice.
 */
export const CONSENT_LEDE =
  'Your employer has to keep an attendance register, so being marked present is not optional. ' +
  'Having a photograph of your face taken and stored to prove it is you — that part is your choice.';

/** What agreeing means, in the order somebody would ask it. */
export const AGREE_LINES = Object.freeze([
  'Two reference photos are kept on file, and a selfie is stored with each clock-in.',
  'A person at your organisation compares them. No automatic face matching is used.',
]);

/**
 * What declining means. Every line is something the code actually does — the
 * refusal in `enroll_photo`, the refusal in `upload_punch_photo`, and
 * `POST /v1/pahchan/attendance/manual`.
 */
export const DECLINE_LINES = Object.freeze([
  'No new photograph of you is taken or stored, for enrolment or for a clock-in.',
  'Your supervisor records your hours instead, and those hours reach payroll the same way.',
  'You are not marked absent for declining, and your pay is worked out from the same register.',
]);

/**
 * What withdrawing does — and, in the last line, what it does not.
 *
 * DO NOT SOFTEN THE LAST LINE. See the header: nothing in the product deletes a
 * stored reference photo on withdrawal, and the retention sweep only reaches a
 * leaver's pair. Saying "and your photos are deleted" here would be a promise
 * no code keeps.
 */
export const WITHDRAW_LINES = Object.freeze([
  'You can change this answer whenever you like, from this screen, without asking anyone.',
  'From the moment you withdraw, no further photograph of you is taken or stored.',
  'Photographs already on file are not removed by this on their own — ask your HR admin to delete them.',
]);

/** How the answer was obtained. The vocabulary is migration 209's CHECK. */
export const METHOD_LABEL = Object.freeze({
  self_acknowledged: 'Answered themselves',
  paper: 'On paper',
  verbal_witnessed: 'Spoken, witnessed',
});

/** The two an admin may record on somebody's behalf — `EmployeeConsentBody`. */
export const ADMIN_METHODS = Object.freeze([
  ['paper', 'A signed paper form'],
  ['verbal_witnessed', 'Said out loud, with a witness'],
]);

/**
 * The reason an admin records at all, stated where they do it.
 *
 * Not a nicety. Measured read-only 2026-08-26: `manav_employees` holds 109 rows
 * and 2 carry a login. 107 people cannot answer for themselves through an
 * account they do not have, and inventing a tap they never made would be the
 * fabrication migration 209's own comment rules out — "Never fabricated — a row
 * with no plausible recorder is not written."
 */
export const ADMIN_LEDE =
  'Most employees have no login, so they cannot answer here themselves. ' +
  'Record what you actually obtained — a signed form, or a spoken answer you witnessed. ' +
  'Do not record an answer nobody gave.';

/** `manav_attendance_status_check`, in words. */
export const ATTENDANCE_STATUSES = Object.freeze([
  ['present', 'Present'],
  ['half_day', 'Half day'],
  ['late', 'Late'],
  ['absent', 'Absent'],
  ['on_leave', 'On leave'],
  ['holiday', 'Holiday'],
  ['weekend', 'Weekend'],
]);

/**
 * Words this screen must never contain.
 *
 * Aekam holds no certification of any kind — no DPDP registration, no ISO
 * 27001, no SOC 2 — and a consent screen is precisely where an unearned one
 * would do the most damage: the customer repeats it to their regulator as
 * something their software told them.
 *
 * The list is matched case-insensitively against the RENDERED TEXT of the
 * mounted screen, not against this file, so a claim smuggled in through a
 * variable, a server string or a future component fails exactly as a literal
 * would. `certified` and `certification` are both listed because neither is a
 * substring of the other.
 */
export const BANNED_CLAIMS = Object.freeze([
  'certified', 'certification', 'accredited', 'iso 27001', 'soc 2',
  'gdpr compliant', 'dpdp compliant', 'fully compliant', 'guarantee',
  'audited by', 'government approved',
]);
