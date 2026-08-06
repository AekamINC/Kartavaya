/**
 * The DPDP notice — the words, for React Native.
 *
 * ── THIS IS A MIRROR, AND THAT IS DELIBERATE ─────────────────────────────────
 *
 * `frontend/src/pages/pahchan/noticeCopy.js` holds the same six lines. This is a
 * copy rather than an import because `mobile/` has its own tsconfig and no path
 * into `frontend/src`; a cross-boundary import is how two copies silently
 * diverge on a build-config change instead of on an edit.
 *
 * The divergence is guarded rather than trusted. `screens/__tests__/dpdpNotice.test.ts`
 * reads the web module as TEXT and asserts every line and the version string
 * match, and a failed read fails the test rather than skipping it. If you change
 * a word here, change it there in the same commit or the suite goes red.
 *
 * ── DO NOT EDIT THE SIX LINES ────────────────────────────────────────────────
 *
 * Transcribed from `design-reference/Kartavaya Redesign/PahchanClock.jsx:174-206`.
 * They are a legal notice under the DPDP Act. Do not paraphrase, do not tighten,
 * and do not add a reassuring sentence — over-claiming in a notice is worse than
 * not having one.
 *
 * ── THE ONE DEVIATION FROM VERBATIM ──────────────────────────────────────────
 *
 * `How long` takes the org's own retention figures instead of the prototype's
 * hard-coded 90 and 45. `MyBiometrics.tsx:23-26` already makes the argument in
 * shipped code: "A retention promise displayed from a constant is a promise
 * about a different system." The final clause carries NO number on purpose —
 * `record_retention_years` is the org's configured window, which is not the same
 * claim as what the law requires, and a notice must not state the stronger one.
 */

/** Bumped only when the WORDS change. `YYYY-MM-DD.n`. */
export const PAHCHAN_NOTICE_VERSION = '2026-08-06.1';

export interface NoticeRetention {
  punch_photo_days: number;
  reference_photo_grace_days: number;
  record_retention_years: number;
}

/**
 * Used only until `/v1/pahchan/me` answers. `DEFAULT_POLICY`'s figures in
 * `backend/routers/pahchan.py`, so a notice rendered before the request lands
 * says what an org with no policy row would be told anyway.
 */
export const RETENTION_FALLBACK: NoticeRetention = {
  punch_photo_days: 90,
  reference_photo_grace_days: 45,
  record_retention_years: 3,
};

export const NOTICE_TITLE = {
  en: 'Attendance — what we record',
  hi: 'उपस्थिति — हम क्या दर्ज करते हैं',
} as const;

export const NOTICE_LEDE = 'Six lines. Tap any one to see the detail.';

export const NOTICE_ACK = 'I have read this';

export const NOTICE_LEGAL =
  'This is a notice, not a consent form. Attendance is processed as a legitimate use for employment.';

export interface NoticeLine {
  key: string;
  text: string;
}

/** The six disclosure lines, resolved against an org's retention figures. */
export function noticeLines(retention?: Partial<NoticeRetention> | null): NoticeLine[] {
  const r: NoticeRetention = { ...RETENTION_FALLBACK, ...(retention || {}) };
  return [
    {
      key: 'What is captured',
      text: 'A photo of your face each time you clock in or out, the time, and your location at that moment.',
    },
    {
      key: 'Why',
      text: 'To confirm that the person marking attendance is you. Your employer needs an accurate attendance register — it is a record they are required by law to keep.',
    },
    {
      key: 'Who sees it',
      text: 'Your HR admin and the owner of your organisation. Nobody else. Aekam, who runs Kartavaya, cannot see your photos, times or location — only how many people at your organisation use attendance.',
    },
    {
      key: 'How long',
      text: `Punch photos are deleted after ${r.punch_photo_days} days. Your two reference photos are deleted ${r.reference_photo_grace_days} days after you leave. The attendance record itself — dates and hours, no photo — is kept for as long as the law requires your employer to keep it.`,
    },
    {
      key: 'Face recognition',
      text: 'Not used. A person compares the photos. If your employer ever turns on automatic face matching, you will be asked separately and you can say no.',
    },
    {
      key: 'Your rights',
      text: 'You can ask to see everything held about you, ask for a correction, and complain to the Data Protection Board of India. Contact your HR admin first.',
    },
  ];
}
