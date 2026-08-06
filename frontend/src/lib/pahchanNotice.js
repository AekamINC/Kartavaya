/**
 * The DPDP notice — the words, and nothing else.
 *
 * This is the SINGLE SOURCE OF THE COPY on the web side. Transcribed from the
 * prototype at `design-reference/Kartavaya Redesign/PahchanClock.jsx:174-206`
 * (`PhNotice`), which is the specification. It is rendered once there, inside
 * §05 of `Pahchan v1.html`, and existed in no form in `frontend/src`,
 * `mobile/src` or `backend/` before this file.
 *
 * ── DO NOT EDIT THE SIX LINES ─────────────────────────────────────────────────
 *
 * They are a legal notice under the DPDP Act, not product copy. Do not
 * paraphrase them, do not "tighten" them, and above all do not add a reassuring
 * sentence: over-claiming in a notice is worse than not having one. Every clause
 * here describes something v1 actually does. If a future version stops doing one
 * of them, the line changes AND `PAHCHAN_NOTICE_VERSION` changes, and
 * `07-pahchan.md §8` says what that costs — "Not a legal opinion — have counsel
 * confirm before launch".
 *
 * ── THE ONE DEVIATION FROM VERBATIM, AND WHY IT IS MANDATORY ──────────────────
 *
 * `How long` in the prototype hard-codes 90 days and 45 days. Here it is a
 * function of the org's own policy. `MyBiometrics.tsx:23-26` already makes the
 * argument in the shipped product: "A retention promise displayed from a
 * constant is a promise about a different system." An org that shortened its
 * punch-photo window to 30 days must not have its notice say 90.
 *
 * The last clause of that line deliberately carries NO number. The prototype's
 * wording is "kept for as long as the law requires your employer to keep it",
 * and `record_retention_years` is NOT substituted into it — that figure is the
 * org's configured window, which is not the same claim as what the law requires,
 * and a notice must not state the stronger one.
 *
 * ── WHAT THE VERSION STRING COVERS ────────────────────────────────────────────
 *
 * The WORDING. Not the numbers. A policy change from 90 days to 30 does not mint
 * a new version: the sentence is the same sentence and the figure is rendered
 * live from `/v1/pahchan/me`. Only an edit to the six lines, the title, the lede
 * or the legal footer does.
 *
 * ── THE MIRROR ────────────────────────────────────────────────────────────────
 *
 * `mobile/src/screens/pahchan/noticeCopy.ts` holds the same words for React
 * Native. It is a copy and not an import on purpose — `mobile/` has its own
 * tsconfig and no path into `frontend/src`, and a cross-boundary import is how
 * the two silently diverge on a build-config change rather than on an edit. The
 * divergence is guarded by a test on each side that reads the OTHER file as text
 * (`frontend/src/__tests__/dpdpNotice.test.jsx`,
 * `mobile/src/screens/__tests__/dpdpNotice.test.ts`). A failed read fails those
 * tests rather than skipping them.
 */

/**
 * Bumped only when the WORDS change. `YYYY-MM-DD.n`.
 *
 * The acknowledgement row is keyed on (employee, version), so a bump asks
 * everybody again — which is the point, and the reason a retention-days change
 * must not bump it.
 */
export const PAHCHAN_NOTICE_VERSION = '2026-08-06.1';

/**
 * Only used when `/v1/pahchan/me` has not answered yet. These are
 * `DEFAULT_POLICY`'s figures in `backend/routers/pahchan.py:204-206`, so a
 * notice rendered before the request lands says what an org with no policy row
 * would be told anyway — and the moment the real figures arrive it re-renders.
 */
export const RETENTION_FALLBACK = Object.freeze({
  punch_photo_days: 90,
  reference_photo_grace_days: 45,
  record_retention_years: 3,
});

export const NOTICE_TITLE = Object.freeze({
  en: 'Attendance — what we record',
  hi: 'उपस्थिति — हम क्या दर्ज करते हैं',
});

export const NOTICE_LEDE = 'Six lines. Tap any one to see the detail.';

export const NOTICE_ACK = 'I have read this';

export const NOTICE_LEGAL =
  'This is a notice, not a consent form. Attendance is processed as a legitimate use for employment.';

/**
 * The six disclosure lines, in the prototype's order.
 *
 * `text` takes the retention object so that exactly one of the six can vary. The
 * other five ignore it, and are byte-for-byte the prototype's strings.
 */
export const NOTICE_LINES = Object.freeze([
  Object.freeze({
    key: 'What is captured',
    text: () =>
      'A photo of your face each time you clock in or out, the time, and your location at that moment.',
  }),
  Object.freeze({
    key: 'Why',
    text: () =>
      'To confirm that the person marking attendance is you. Your employer needs an accurate attendance register — it is a record they are required by law to keep.',
  }),
  Object.freeze({
    key: 'Who sees it',
    text: () =>
      'Your HR admin and the owner of your organisation. Nobody else. Aekam, who runs Kartavaya, cannot see your photos, times or location — only how many people at your organisation use attendance.',
  }),
  Object.freeze({
    key: 'How long',
    text: (r) =>
      `Punch photos are deleted after ${r.punch_photo_days} days. Your two reference photos are deleted ${r.reference_photo_grace_days} days after you leave. The attendance record itself — dates and hours, no photo — is kept for as long as the law requires your employer to keep it.`,
  }),
  Object.freeze({
    key: 'Face recognition',
    text: () =>
      'Not used. A person compares the photos. If your employer ever turns on automatic face matching, you will be asked separately and you can say no.',
  }),
  Object.freeze({
    key: 'Your rights',
    text: () =>
      'You can ask to see everything held about you, ask for a correction, and complain to the Data Protection Board of India. Contact your HR admin first.',
  }),
]);

/**
 * The six lines resolved against an org's retention figures.
 *
 * A partial or absent `retention` falls back per key rather than wholesale, so
 * a server that gains a fourth figure and drops none cannot blank a sentence.
 */
export function noticeLines(retention) {
  const r = { ...RETENTION_FALLBACK, ...(retention || {}) };
  return NOTICE_LINES.map(({ key, text }) => ({ key, text: text(r) }));
}
