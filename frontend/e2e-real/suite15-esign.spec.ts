/**
 * Proposal 93 · Stage 3 · WAVE 5 · SUITE 15 — eSign, on Unicode Group, at §4
 * volumes.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THIS MODULE IS WHY SUITE RULE 1 EXISTS
 * ═══════════════════════════════════════════════════════════════════════════
 * "A missing control is a FAILURE, never `test.skip`. `test.skip(!opened)` is
 * how **the e-sign journey** reported green for weeks while the module 403'd."
 *
 * There is no `test.skip` in this file, for any reason, and no `if (await
 * x.count())` that shrugs. Every control §10 names is asserted to exist before
 * it is used, and an absent one fails naming what was looked for and what the
 * wire said instead.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE LANE, AND THE GUARD THAT PROVES IT
 * ═══════════════════════════════════════════════════════════════════════════
 * `lane('unicode')` + `signInAs()` from `_lanes.ts`. Read that file's header
 * before changing a line here: on 2026-08-28 a write suite renamed **Aekam
 * Inc** — the one org proposal 93 guarantees is untouched — because the
 * credential held `platform_admin` and every request resolved to Aekam via
 * `platform_bypass`. The save genuinely succeeded and the suite went GREEN.
 * `signInAs()` calls `assertOrg()` itself; `signIn()` below re-asserts AFTER
 * pinning the active-org key, because that key is written after the door opens
 * and it is the key that decides which org `X-Org-Id` names.
 *
 * ⚠ Unicode Group contains a TEAM literally named "Aekam Inc"
 * (`team_ae1d58543b21`) holding the protected 20 tasks. Nothing in this suite
 * touches a team, a task or a project — eSign has no link to any of them — so
 * the protected set is untouched by construction rather than by care.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * RULE 1 — EVERY ROW HERE IS TYPED BY A USER
 * ═══════════════════════════════════════════════════════════════════════════
 * Every document, every placed field, every signer, every send, every reminder
 * and every void is made by opening the screen, filling the real inputs,
 * attaching the real multi-page PDF and pressing the real button. No SQL
 * INSERT. No `page.request.post/put/patch/delete`.
 *
 * `page.request.get` IS used — `apiRows()` / `apiOne()` — and that is the
 * ratchet's own carve-out: asserting the row appeared IS the required
 * evidence. Both send `X-Org-Id` (`frontend/src/lib/api.js`), because a read
 * helper that omits it makes the server fall back to the caller's OLDEST
 * membership and answer for a different organisation than the screen beside it.
 *
 * ⚠ ONE READ-ONLY DATABASE QUERY, AND IT STANDS IN FOR A MAILBOX ────────────
 *
 * §10 requires the counterparty to sign in a second browser context. To do
 * that this suite needs two values, and THE PRODUCT DELIBERATELY REFUSES TO
 * GIVE EITHER OF THEM TO ANYONE BUT THE RECIPIENT'S INBOX:
 *
 *   · the signing TOKEN. `services/esign_service.py:299-303` says it outright —
 *     "the token must never enter `created`… that is the whole authority to
 *     sign, in a response body". `GET /v1/esign/documents/{id}` selects
 *     `id, name, email, phone, sign_order, status, signed_at, signature_type`
 *     and no token; the audit trail carries `actor_email` and no token; and
 *     `staging.outbound_log` is forbidden by `outbound_log_no_body_ck` from
 *     storing the message body the link is in. Measured, not assumed.
 *   · the OTP. `send_otp` mints it, writes it to `sign_signers.otp_code`,
 *     emails it, and returns `{"sent": true, "email": <masked>}`.
 *
 * Both of those are CORRECT security properties and this suite does not want
 * them changed. But they mean the counterparty leg cannot be driven from the
 * browser alone: the only in-product channel is a mailbox, and the mailboxes
 * §3 assigns are two real Gmail accounts and the AWS simulator, none of which
 * Playwright can read.
 *
 * So `inbox()` below is the signer's mailbox, and it is a **read-only SELECT**
 * over `staging.sign_signers`, run through `railway run` so no credential is
 * ever written to a file in this repository. It reads. It never writes, and it
 * never creates a row this suite then claims a user typed. If it cannot run,
 * the tests that need it FAIL with the exact command to make it work — they do
 * not skip, and they do not soften into "the signing link could not be tested".
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * RULE 2 — STOP AND REPORT. NO VERDICT.
 * ═══════════════════════════════════════════════════════════════════════════
 * 93 §14 reserves the product-bug-versus-test-bug judgement to the owner. What
 * this suite found on 2026-08-29 is reported at the head of each test and in
 * the run report; nothing is skipped and no assertion is softened.
 *
 *   15.04  **FIELD PLACEMENT IS TYPED AND THROWN AWAY.** `staging.sign_fields`
 *          EXISTS — migration 114 is applied, measured live — and NOTHING in
 *          the backend references it: `grep -rn sign_fields backend/ --include
 *          *.py` returns zero hits outside the migration itself. The deployed
 *          OpenAPI's `routers__esign__DocumentCreate` carries `title`,
 *          `description`, `signers`, `expires_days`, `message` and no `fields`
 *          member, and Pydantic v2 ignores unknown members by default, so the
 *          24 fields §4 asks for are POSTed, accepted, and silently discarded.
 *          `CreateTab` knows this and says so in a warning toast rather than
 *          lying, which is the right behaviour for a screen that cannot fix it
 *          — so this suite asserts the honest warning appears AND that the
 *          canonical record carries no placement. **§4's "fields placed 24" is
 *          therefore 24 PLACED and 0 STORED, and 15.12 reports it that way.**
 *          The shape is the sweep's dominant defect class inverted: not a route
 *          with no screen, but a TABLE with no route.
 *
 *   15.05  **SIGNING ORDER IS DECORATIVE.** `POST /documents/{id}/send` loops
 *          every signer and mails all of them at once (`esign.py:582-601`);
 *          `submit_signature` has no predecessor check. So a document with two
 *          "ordered" signers issues both links immediately and either party can
 *          sign first, while `CreateTab` renders a numbered rail, renumbers on
 *          removal to keep `sign_order` dense, and explains that "a sequential
 *          flow with a gap at position 2 is a document the server will wait on
 *          forever". This suite proves it read-only, from the outbound log, and
 *          does not sign out of order to demonstrate it.
 *
 *   15.06  **A DECLINE DOES NOT MOVE THE DOCUMENT.** `decline_signing` writes
 *          `sign_signers.status='declined'` and leaves `sign_documents.status`
 *          alone, so a document every signer has refused sits at "Sent" for
 *          ever, can never reach `completed` (the counter never catches
 *          `signers_total`), and the sender's list gives no hint. The signer
 *          pill is the only surface that says it.
 *
 *   15.11  **THE REGISTER IS CAPPED AT 50 AND HAS NO PAGINATION.**
 *          `list_documents` ends `ORDER BY created_at DESC LIMIT 50` with no
 *          offset, cursor or total, and `DocumentsTab` renders exactly what it
 *          gets. §10's rule 4 warns lists cap at 200; this one caps at 50 and
 *          the screen cannot reach row 51.
 *
 *   15.11  `GET /v1/esign/documents/{id}/audit` is ORPHANED — no caller, per
 *          `docs/plans/93-E-ORPHANED-CAPABILITY-SWEEP.md` §3.8, because
 *          `DetailTab` takes `audit_trail` off `GET /documents/{id}`. It is
 *          live and correct, and this suite calls it to prove that rather than
 *          leaving a superseded route unmeasured.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE SEND FENCE — WHY IT IS AN ALLOWLIST AND NOT `assertOutboundFenceFor`
 * ═══════════════════════════════════════════════════════════════════════════
 * `GET /api/health` reports `outbound_mode=live` and `suppressed_orgs_digest`
 * `"0"`: NOTHING is shielded, and eSign genuinely mails every signer an
 * invitation, a reminder and a one-time code. `_helpers.assertOutboundFenceFor`
 * asserts the opposite state — that the org IS suppressed — and would fail this
 * suite for a condition that is deliberate.
 *
 * The protection here is therefore the ADDRESSES, and it is enumerated rather
 * than sampled. Every signer on this suite's documents is typed by this suite,
 * so `ALLOWED` is a closed set; before any send, `gateRecipients()` reads the
 * canonical signer list off the server — the server's own answer to "who will
 * be mailed" — and refuses to continue if a single address falls outside it.
 * ⚠ All 53 pre-existing Unicode `graha_contacts` are `@example.com`, which
 * publishes a null MX; `ALLOWED` does not admit that domain and never will.
 * A gate may be tightened without asking; it may never be loosened.
 *
 * ⚠ `send_email` RETURNS TRUE WHEN THE GATE SUPPRESSES. The row is the
 * evidence, so every send and every reminder is proved by a DELTA in
 * `GET /api/v1/billing/me/outbound/messages?recipient=…` — the org's own admin
 * asking "did this person get it", which is the only in-product surface that
 * answers per address. The vocabulary is `queued · sent · suppressed · failed`;
 * there is **no `bounced` status and no bounce webhook**, so nothing here
 * asserts bounce handling and 15.12 reports it as not-built.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * §6 — RE-RUNNABLE, AND PROVED BY RUNNING IT TWICE
 * ═══════════════════════════════════════════════════════════════════════════
 * Every document carries a DETERMINISTIC title mark (`S15-DOC-01 …`), so a
 * second execution recognises its own output and verifies instead of
 * duplicating: `ensureDocs()` reads the live register first and types only what
 * is missing. Every state transition is likewise conditional — a document
 * already `sent` is not sent again (the endpoint answers 400 "Document already
 * sent"), a signer already `signed` is verified rather than re-signed, and a
 * document already `cancelled` is read rather than re-cancelled. 15.12 prints
 * "N typed, M already present" for every §4 line.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE FIXTURES — §5's SIX MULTI-PAGE PDFs, AND WHY THEY ARE UNCOMPRESSED
 * ═══════════════════════════════════════════════════════════════════════════
 * `fixtures/generated/esign/*.pdf`, built by `fixtures/make-fixtures.mjs` and
 * pinned byte-for-byte in `generated/MANIFEST.txt`. 2, 2, 3, 3, 4 and 6 pages —
 * §5's "multi-page, so field placement on page 2+ is exercised". They are
 * PDF 1.4 with a classic xref and NO object streams on purpose, because the
 * product's own page counter (`pages/esign/fieldPlacement.js countPdfPages`)
 * reads `/Type /Page` and `/Count` out of the raw bytes and returns 0 — "one
 * page, and say so" — for the compressed page tree most modern writers emit.
 * A compressed fixture would have collapsed the placer to a single page and
 * page 2+ would never have been reached.
 *
 * Run the generator before the first run:
 *     node frontend/e2e-real/fixtures/make-fixtures.mjs
 * A missing fixture is a FAILURE here, with that command in the message.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE TRAPS THIS FILE IS WRITTEN AROUND
 * ═══════════════════════════════════════════════════════════════════════════
 * · **ONE BUTTON, TWO REQUESTS** (§10 rule 7). "Create document" POSTs
 *   `/documents` and then POSTs `/documents/{id}/upload`, and the second can
 *   fail on its own leaving a draft at `file_url === 'pending'`. Both are
 *   awaited, both are asserted, and the upload's path id is compared to the
 *   create's response id — so a suite cannot pass by watching one of them.
 * · **READ THE WRITE RESPONSE, NOT THE LIST**, then fetch the CANONICAL row.
 *   `POST /documents` answers `{id, status}` and nothing else; every other
 *   field would be `undefined` if asserted off it.
 * · `getByRole(name)` matches the ACCESSIBLE NAME. The signer inputs are
 *   `aria-label="Signer 1 email"` with no visible label, and the placed fields
 *   are `role="button"` named "Signature for Meera Joshi, page 2" by
 *   `describeField`. A locator written against visible text fails here as a
 *   MISSING CONTROL, which is the wrong diagnosis entirely.
 * · **Scope to the tabpanel.** `EsignPage` renders the detail view into
 *   `#mt-panel-documents` — the SAME panel id as the list, because a detail is
 *   not a third tab — and the module header duplicates nothing but the sidebar
 *   is full of module names. Every locator below is scoped.
 * · `fill('')` does not register with a controlled React input; clearing is
 *   select-all-then-type (`typeInto`).
 * · A vacuous assertion passes for ever. EVERY loop below asserts its count
 *   BEFORE it iterates.
 * · **The stage is not a PDF render.** `FieldPlacer` says so on the surface:
 *   there is no PDF viewer in this build, so the sheet is a page-shaped guide.
 *   Coordinates are percentages and survive the day one is added — which is
 *   the only reason placing on "page 6" means anything at all today.
 * · No user, member or org UUID is rendered or asserted. 15.01 and 15.03 scan
 *   the PAINTED TEXT of every eSign screen for one, because
 *   `check-rendered-ids.mjs` is static and positional and cannot see an id the
 *   server pre-formatted into a string.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WEB ONLY — §10's last four words
 * ═══════════════════════════════════════════════════════════════════════════
 * "Web only — never a mobile destination." The live mobile proof is Suite 21's
 * ("eSign absence · 2 checks"). 15.11 does the cheap half here at HEAD: the
 * mobile app must declare no eSign destination. It is a source assertion and
 * says so; it does not stand in for driving the AVD.
 *
 * Run:
 *   cd frontend
 *   npx playwright test --config e2e-real/suite15.config.ts
 */
import { test, expect, Page, Locator, Browser } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { lane, signInAs as laneSignIn, assertOrg, ORG as ORG_IDS } from './_lanes';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const FIX = path.join(HERE, 'fixtures', 'generated', 'esign');
const OUT = path.join(os.tmpdir(), 'kartavya-e2e-suite15', 'downloads');
fs.mkdirSync(OUT, { recursive: true });

const LANE = lane('unicode');
const API = process.env.E2E_API_URL || 'https://kartavya-staging.up.railway.app';
const BASE = process.env.E2E_BASE_URL || 'https://staging.kartavaya.com';

const BLOCKED =
  'BLOCKED — no Unicode Group credential. Set E2E_UNICODE_TOKEN (or ' +
  'E2E_UNICODE_EMAIL/_PASSWORD) in .env.e2e at the repo root. ⚠ It must be an ' +
  'ORG-SCOPED account: a platform_admin token resolves to Aekam Inc via ' +
  'platform_bypass and will write there. ENVIRONMENT blocker, not a product ' +
  'or test defect.';

/** The suite's own mark. Deterministic — §6 idempotence hangs off it. */
const TAG = 'S15';

// ── §4 VOLUMES, stated once ─────────────────────────────────────────────────
const N_DOCUMENTS = 6;
const N_FIELDS = 24;
const N_SIGNERS = 10;
const N_SIGNED = 4;
const N_VOIDED = 1;

/**
 * THE ALLOWED RECIPIENT SET, and it is narrower than the brief's on purpose.
 *
 * Admits the AWS mailbox simulator (any behaviour label), the two Gmail tags
 * §3 names, and `@unicodegroup.com`. It does NOT admit `@example.com`: all 53
 * pre-existing Unicode contacts carry that domain, it is RFC 2606 reserved and
 * publishes a null MX, and mailing one is a hard bounce on the SES account that
 * sends the owner's real invoices. A gate may be tightened without asking; it
 * may never be loosened.
 */
const ALLOWED =
  /^(?:[^@\s]+@simulator\.amazonses\.com|kevalvshah03\+[^@\s]*@gmail\.com|kelisweet\+[^@\s]*@gmail\.com|[^@\s]+@unicodegroup\.com)$/i;

type Kind = 'signature' | 'initials' | 'date' | 'text' | 'checkbox';

type PlannedField = { kind: Kind; signer: number; page: number };
type PlannedSigner = { name: string; email: string; phone: string };

type PlannedDoc = {
  no: string;
  fixture: string;
  pages: number;
  title: string;
  description: string;
  expiresDays: number;
  signers: PlannedSigner[];
  fields: PlannedField[];
  /** What this document is for, at the end of the run. */
  end: 'draft' | 'sent' | 'completed' | 'cancelled' | 'declined-signer';
};

/**
 * THE SIX DOCUMENTS — §4's `6 · 24 · 10 · 4 · 1`, allocated once, here.
 *
 *   documents 6   · one per §5 fixture, 2/2/3/3/4/6 pages
 *   fields   24   · four per document, EVERY ONE OF THEM PLACING ON PAGE 2+,
 *                   and the five kinds the palette offers all exercised
 *   signers  10   · 2+2+2+2+1+1
 *   signed    4   · D1 and D2 complete, both signatures each
 *   voided    1   · D4 cancelled from the detail screen's confirm dialog
 *
 * The address mix follows §3's shape at this scale: one `kevalvshah03+`, one
 * `kelisweet+`, one `test+…@unicodegroup.com` and seven simulator addresses, so
 * half the evidence lands in an inbox a human can actually open and the rest
 * runs the full send path at zero reputational cost.
 */
const DOCS: PlannedDoc[] = [
  {
    no: '01',
    fixture: 'esign-01-engagement-letter-2p.pdf',
    pages: 2,
    title: `${TAG}-DOC-01 Engagement letter FY 2026-27`,
    description: 'Annual engagement letter. Signed by the engagement partner and the client.',
    expiresDays: 30,
    signers: [
      { name: 'Meera Joshi', email: 'kevalvshah03+s15d1s1@gmail.com', phone: '+91 98250 10001' },
      { name: 'Rohit Ambekar', email: 'success+s15d1s2@simulator.amazonses.com', phone: '' },
    ],
    fields: [
      { kind: 'initials', signer: 1, page: 1 },
      { kind: 'signature', signer: 1, page: 2 },
      { kind: 'date', signer: 1, page: 2 },
      { kind: 'signature', signer: 2, page: 2 },
    ],
    end: 'completed',
  },
  {
    no: '02',
    fixture: 'esign-02-nda-mutual-2p.pdf',
    pages: 2,
    title: `${TAG}-DOC-02 Mutual non-disclosure agreement`,
    description: 'Mutual NDA ahead of the GST advisory scope discussion.',
    expiresDays: 21,
    signers: [
      { name: 'Anjali Deshpande', email: 'kelisweet+s15d2s1@gmail.com', phone: '' },
      { name: 'Vikram Rao', email: 'success+s15d2s2@simulator.amazonses.com', phone: '+91 98250 10002' },
    ],
    fields: [
      { kind: 'initials', signer: 1, page: 1 },
      { kind: 'signature', signer: 1, page: 2 },
      { kind: 'signature', signer: 2, page: 2 },
      { kind: 'date', signer: 2, page: 2 },
    ],
    end: 'completed',
  },
  {
    no: '03',
    fixture: 'esign-03-sow-gst-advisory-3p.pdf',
    pages: 3,
    title: `${TAG}-DOC-03 Statement of work — GST advisory`,
    description: 'Scope, fees and timeline for the GST advisory engagement.',
    expiresDays: 45,
    signers: [
      { name: 'Priya Nair', email: 'success+s15d3s1@simulator.amazonses.com', phone: '' },
      { name: 'Sanjay Mehta', email: 'test+s15d3s2@unicodegroup.com', phone: '' },
    ],
    fields: [
      { kind: 'initials', signer: 1, page: 1 },
      { kind: 'initials', signer: 2, page: 2 },
      { kind: 'signature', signer: 1, page: 3 },
      { kind: 'signature', signer: 2, page: 3 },
    ],
    end: 'sent',
  },
  {
    no: '04',
    fixture: 'esign-04-office-lease-3p.pdf',
    pages: 3,
    title: `${TAG}-DOC-04 Leave and licence — Ahmedabad office`,
    description: 'Eleven-month leave and licence agreement for the Bopal premises.',
    expiresDays: 14,
    signers: [
      { name: 'Nikhil Shah', email: 'success+s15d4s1@simulator.amazonses.com', phone: '' },
      { name: 'Kavita Iyer', email: 'success+s15d4s2@simulator.amazonses.com', phone: '' },
    ],
    fields: [
      { kind: 'text', signer: 1, page: 1 },
      { kind: 'checkbox', signer: 2, page: 2 },
      { kind: 'signature', signer: 1, page: 3 },
      { kind: 'signature', signer: 2, page: 3 },
    ],
    end: 'cancelled',
  },
  {
    no: '05',
    fixture: 'esign-05-board-resolution-4p.pdf',
    pages: 4,
    title: `${TAG}-DOC-05 Board resolution — banking authority`,
    description: 'Resolution authorising the operation of the current account.',
    expiresDays: 30,
    signers: [
      { name: 'Devika Menon', email: 'success+s15d5s1@simulator.amazonses.com', phone: '' },
    ],
    fields: [
      { kind: 'initials', signer: 1, page: 1 },
      { kind: 'initials', signer: 1, page: 2 },
      { kind: 'date', signer: 1, page: 3 },
      { kind: 'signature', signer: 1, page: 4 },
    ],
    end: 'declined-signer',
  },
  {
    no: '06',
    fixture: 'esign-06-audit-representation-6p.pdf',
    pages: 6,
    title: `${TAG}-DOC-06 Management representation letter`,
    description: 'Representation letter for the year ended 31 March 2026. Kept as a draft.',
    expiresDays: 60,
    signers: [
      { name: 'Harsh Trivedi', email: 'success+s15d6s1@simulator.amazonses.com', phone: '' },
    ],
    fields: [
      { kind: 'initials', signer: 1, page: 1 },
      { kind: 'text', signer: 1, page: 3 },
      { kind: 'checkbox', signer: 1, page: 5 },
      { kind: 'signature', signer: 1, page: 6 },
    ],
    end: 'draft',
  },
];

/** The palette's label for each kind — `FIELD_KINDS` in `fieldPlacement.js`. */
const KIND_LABEL: Record<Kind, string> = {
  signature: 'Signature',
  initials: 'Initials',
  date: 'Date',
  text: 'Text',
  checkbox: 'Checkbox',
};

/**
 * ⚠ EVERY CROSS-TEST NUMBER LIVES IN A FILE, AND THAT IS NOT FUSSINESS.
 *
 * These counters were module-level constants, and on the run that first went
 * end to end they came out as `documents: 0 typed, 0 already present` — after
 * 15.02 had printed `0 typed, 6 already present` four tests earlier.
 *
 * **Playwright starts a NEW WORKER PROCESS after a failed test.** 15.08 failed,
 * the worker was replaced, the module was imported again, and every counter
 * went back to zero. The §6 idempotence report was therefore a report about
 * nothing — and worse, `OTP_LOG_GAPS` came back EMPTY, so 15.08b, whose whole
 * job is to fail on a defect it had just measured, PASSED. A false green in the
 * one test written to be red.
 *
 * So the shared state is on disk, under this suite's own output directory,
 * reset by 15.01 (which always runs first and cannot be reached by a restart).
 * Read-modify-write on every mutation: `workers: 1` means there is never a
 * second writer.
 */
const STATE_FILE = path.join(os.tmpdir(), 'kartavya-e2e-suite15', 'shared-state.json');

type Shared = {
  typed: {
    documents: number; documentsFound: number;
    fieldsPlaced: number; fieldsFound: number;
    signers: number; signersFound: number;
    sent: number; sentFound: number;
    reminders: number;
    signatures: number; signaturesFound: number;
    voided: number; voidedFound: number;
    declines: number; declinesFound: number;
  };
  findings: string[];
  otpGaps: { email: string; visible: number; before: number }[];
};

const freshState = (): Shared => ({
  typed: {
    documents: 0, documentsFound: 0,
    fieldsPlaced: 0, fieldsFound: 0,
    signers: 0, signersFound: 0,
    sent: 0, sentFound: 0,
    reminders: 0,
    signatures: 0, signaturesFound: 0,
    voided: 0, voidedFound: 0,
    declines: 0, declinesFound: 0,
  },
  findings: [],
  otpGaps: [],
});

function readShared(): Shared {
  try {
    const raw = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    return { ...freshState(), ...raw, typed: { ...freshState().typed, ...(raw.typed || {}) } };
  } catch {
    return freshState();
  }
}

function writeShared(s: Shared) {
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 1), 'utf8');
}

/** Read-modify-write one change. Survives the worker restart a failure causes. */
function bump(fn: (s: Shared) => void) {
  const s = readShared();
  fn(s);
  writeShared(s);
}

const note = (s: string) => {
  bump((st) => { if (!st.findings.includes(s)) st.findings.push(s); });
  console.log(`  ▸ ${s}`);
};

// ════════════════════════════════════════════════════════════════════════════
// THE SIGNER'S MAILBOX — read-only, and never a write
// ════════════════════════════════════════════════════════════════════════════

/**
 * The SELECT this suite runs in place of opening the signer's inbox.
 *
 * Two statements, both read-only, both scoped to this suite's own documents by
 * the caller. Written to a temp file at run time rather than committed, so this
 * suite adds no third file to a tree several agents are editing at once.
 */
const INBOX_PY = `
import asyncio, json, os, sys
import asyncpg

async def main():
    mode, arg = sys.argv[1], sys.argv[2]
    url = os.environ.get("DATABASE_URL")
    if not url:
        print(json.dumps({"error": "DATABASE_URL is not in the environment"}))
        return
    conn = await asyncpg.connect(url, statement_cache_size=0)
    try:
        if mode == "signers":
            rows = await conn.fetch(
                "SELECT s.id::text AS signer_id, s.email, s.sign_order, s.token, s.status "
                "FROM staging.sign_signers s WHERE s.document_id = $1::uuid "
                "ORDER BY s.sign_order", arg)
        elif mode == "otp":
            rows = await conn.fetch(
                "SELECT otp_code, otp_expires_at::text AS otp_expires_at "
                "FROM staging.sign_signers WHERE id = $1::uuid", arg)
        elif mode == "fields":
            rows = await conn.fetch(
                "SELECT count(*) AS n FROM staging.sign_fields WHERE document_id = $1::uuid", arg)
        elif mode == "otplog":
            rows = await conn.fetch(
                "SELECT purpose, status, org_id::text AS org_id, user_id, ts::text AS ts "
                "FROM staging.outbound_log WHERE purpose = 'signing_otp' "
                "AND lower(recipient) = lower($1::text) ORDER BY ts DESC LIMIT 5", arg)
        else:
            rows = []
        print(json.dumps([dict(r) for r in rows], default=str))
    finally:
        await conn.close()

asyncio.run(main())
`;

let INBOX_SCRIPT = '';
function inboxScript(): string {
  if (!INBOX_SCRIPT) {
    INBOX_SCRIPT = path.join(os.tmpdir(), 'kartavya-e2e-suite15', 'inbox.py');
    fs.mkdirSync(path.dirname(INBOX_SCRIPT), { recursive: true });
    fs.writeFileSync(INBOX_SCRIPT, INBOX_PY, 'utf8');
  }
  return INBOX_SCRIPT;
}

/** The interpreter that has `asyncpg`: the backend's own venv, or an override. */
function python(): string {
  if (process.env.E2E_ESIGN_PYTHON) return process.env.E2E_ESIGN_PYTHON;
  const venv = path.join(REPO, 'backend', '.venv', 'Scripts', 'python.exe');
  if (fs.existsSync(venv)) return venv;
  const posix = path.join(REPO, 'backend', '.venv', 'bin', 'python');
  if (fs.existsSync(posix)) return posix;
  return 'python';
}

const INBOX_HELP =
  '\n     THE SIGNER MAILBOX IS UNREACHABLE, so the counterparty leg cannot run.\n' +
  '     This is an ENVIRONMENT blocker, not a product or test defect — and NOT a\n' +
  '     reason to skip: §10 rule 1 says a missing control is a failure.\n' +
  '     The product deliberately never returns a signing token or an OTP to\n' +
  '     anyone but the recipient (esign_service.py:299-303), so the second\n' +
  '     browser context needs the mailbox, and this suite stands in for it with\n' +
  '     one read-only SELECT. Make ONE of these true and re-run:\n' +
  '       · `railway link` this repo to Kartavya Production / staging, and leave\n' +
  '         `backend/.venv` in place  (the default path — no secret is stored)\n' +
  '       · export E2E_ESIGN_PG_URL=<read-only Postgres URL for the staging DB>\n' +
  '       · export E2E_ESIGN_PYTHON=<an interpreter that has asyncpg>\n';

/**
 * Run one read-only statement as the signer's mailbox.
 *
 * `railway run` injects the service's own `DATABASE_URL` into a LOCAL process
 * and prints nothing sensitive, so the credential never lands in `.env.e2e`,
 * in this file, or in the report. `E2E_ESIGN_PG_URL` is the escape hatch for a
 * machine with no Railway CLI.
 */
function inbox(mode: 'signers' | 'otp' | 'fields', arg: string): any[] {
  const script = inboxScript();
  const py = python();
  const direct = process.env.E2E_ESIGN_PG_URL;
  const service = process.env.E2E_ESIGN_RAILWAY_SERVICE || 'Kartavya';
  const cmd = direct
    ? `"${py}" "${script}" ${mode} "${arg}"`
    : `railway run --service ${service} -- "${py}" "${script}" ${mode} "${arg}"`;

  let out = '';
  try {
    out = execSync(cmd, {
      cwd: REPO,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 120_000,
      env: direct ? { ...process.env, DATABASE_URL: direct } : process.env,
    });
  } catch (e: any) {
    const detail = `${e?.stderr || ''}${e?.stdout || ''}`.slice(0, 400);
    throw new Error(`the signer mailbox read failed (${mode} ${arg}): ${detail}${INBOX_HELP}`);
  }
  // `railway run` prints its own banner lines; the payload is the last JSON line.
  const line = out.trim().split(/\r?\n/).reverse().find((l) => l.trim().startsWith('['));
  if (!line) throw new Error(`the signer mailbox returned no JSON: ${out.slice(0, 300)}${INBOX_HELP}`);
  const parsed = JSON.parse(line);
  if (!Array.isArray(parsed)) throw new Error(`the signer mailbox returned ${line.slice(0, 200)}`);
  return parsed;
}

type MailSigner = { signer_id: string; email: string; sign_order: number; token: string; status: string };

/** The signing links a document's signers were mailed, in signing order. */
function signingLinks(docId: string): MailSigner[] {
  const rows = inbox('signers', docId) as MailSigner[];
  expect(rows.length, `the mailbox found no signers for document ${docId.slice(0, 8)}…`)
    .toBeGreaterThan(0);
  for (const r of rows) {
    expect(r.token, `signer ${r.sign_order} of ${docId.slice(0, 8)}… has no signing token`)
      .toBeTruthy();
  }
  return rows;
}

/** The one-time code that was just emailed to a signer. */
function latestOtp(signerId: string): string {
  const rows = inbox('otp', signerId);
  const code = String(rows[0]?.otp_code || '');
  expect(code, `no OTP is on record for signer ${signerId.slice(0, 8)}… — ` +
    '`POST /verify/{token}/otp/send` answered but wrote no `otp_code`, which ' +
    'means the code the signer was emailed cannot be the one the server checks')
    .toMatch(/^\d{6}$/);
  return code;
}

// ════════════════════════════════════════════════════════════════════════════
// SIGN-IN, AND THE ORG GUARD
// ════════════════════════════════════════════════════════════════════════════

async function signIn(page: Page) {
  await laneSignIn(page, LANE);
  await page.evaluate((id) => localStorage.setItem('Kartavaya_active_org', id), LANE.orgId);
  await assertOrg(page.request, page, LANE);
  expect(LANE.orgId, 'the lane must be Unicode Group and never Aekam Inc').toBe(ORG_IDS.UNICODE);
  expect(LANE.orgId, 'the lane must never be Aekam Inc').not.toBe(ORG_IDS.AEKAM);
}

// ════════════════════════════════════════════════════════════════════════════
// READ-BACK — GET only, and always with X-Org-Id
// ════════════════════════════════════════════════════════════════════════════

async function apiGet(page: Page, pathAndQuery: string) {
  const token = await page.evaluate(() => localStorage.getItem('auth_token'));
  return page.request.get(`${API}${pathAndQuery}`, {
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      'X-Org-Id': LANE.orgId,
    },
  });
}

async function apiRows(page: Page, pathAndQuery: string): Promise<any[]> {
  const res = await apiGet(page, pathAndQuery);
  expect(res.status(), `GET ${pathAndQuery} → ${res.status()}: ${(await res.text()).slice(0, 300)}`)
    .toBeLessThan(400);
  const body = await res.json();
  if (Array.isArray(body)) return body;
  if (Array.isArray(body?.data)) return body.data;
  return [];
}

async function apiOne(page: Page, pathAndQuery: string): Promise<any> {
  const res = await apiGet(page, pathAndQuery);
  expect(res.status(), `GET ${pathAndQuery} → ${res.status()}: ${(await res.text()).slice(0, 300)}`)
    .toBeLessThan(400);
  return await res.json();
}

/** The register, narrowed to this suite's own marks. Keyed by the plan's `no`. */
async function myDocs(page: Page): Promise<Map<string, any>> {
  const rows = await apiRows(page, '/api/v1/esign/documents');
  const out = new Map<string, any>();
  for (const r of rows) {
    const m = String(r?.title || '').match(new RegExp(`^${TAG}-DOC-(\\d{2})\\b`));
    if (m) out.set(m[1], r);
  }
  return out;
}

/** `{document, signers, audit_trail}` — the canonical record, never the list. */
async function record(page: Page, id: string) {
  const body = await apiOne(page, `/api/v1/esign/documents/${id}`);
  expect(body?.document?.id, `GET /documents/${id} returned no document object`).toBeTruthy();
  return body as { document: any; signers: any[]; audit_trail: any[] };
}

/** Sends recorded against one address, newest first. The row is the evidence. */
async function outboundFor(page: Page, email: string): Promise<any[]> {
  const body = await apiOne(page,
    `/api/v1/billing/me/outbound/messages?recipient=${encodeURIComponent(email)}`);
  expect(body?.truncated,
    `the outbound log for ${email} came back TRUNCATED, so a delta over it is a ` +
    'sample and not a count').toBeFalsy();
  return Array.isArray(body?.data) ? body.data : [];
}

const countPurpose = (rows: any[], purpose: string) =>
  rows.filter((r) => String(r?.purpose || '') === purpose).length;

// ════════════════════════════════════════════════════════════════════════════
// THE WIRE, THE CONSOLE, AND THE FAILURES
// ════════════════════════════════════════════════════════════════════════════

type Wire = string[];

function watchWire(page: Page): Wire {
  const wire: Wire = [];
  page.on('response', async (r) => {
    const req = r.request();
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method())) return;
    if (!/\/api\//.test(r.url())) return;
    let body = '';
    try { body = (await r.text()).slice(0, 180); } catch { /* consumed */ }
    wire.push(`${req.method()} ${r.status()} ${new URL(r.url()).pathname}  ${body}`);
  });
  return wire;
}

const dumpWire = (w: Wire) =>
  w.length ? w.slice(-25).map((l) => '\n     ' + l).join('') : '\n     (no write request was made at all)';

type Watcher = { errors: { where: string; text: string }[]; at: (where: string) => void };

function watchConsole(page: Page): Watcher {
  const errors: { where: string; text: string }[] = [];
  let where = 'boot';
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    errors.push({ where, text: m.text().slice(0, 240) });
  });
  page.on('pageerror', (e) => {
    errors.push({ where, text: `UNCAUGHT ${String(e?.message ?? e).slice(0, 240)}` });
  });
  return { errors, at: (w: string) => { where = w; } };
}

const dumpConsole = (c: Watcher) =>
  c.errors.map((e) => `\n     [${e.where}] ${e.text}`).join('') || '\n     (none)';

function assertNoUncaught(c: Watcher) {
  const uncaught = c.errors.filter((e) => e.text.startsWith('UNCAUGHT'));
  expect(uncaught, `uncaught exception(s) on screen:${dumpConsole(c)}`).toHaveLength(0);
}

type Failures = string[];
function watchFailures(page: Page): Failures {
  const out: Failures = [];
  page.on('response', async (r) => {
    if (r.status() < 400) return;
    if (!/\/api\//.test(r.url())) return;
    let body = '';
    try { body = (await r.text()).slice(0, 300); } catch { /* consumed */ }
    const u = new URL(r.url());
    out.push(`${r.request().method()} ${r.status()} ${u.pathname}${u.search}  ${body}`);
  });
  return out;
}

const dumpFailures = (f: Failures) =>
  f.length ? f.map((l) => '\n     ' + l).join('') : '\n     (none)';

// ════════════════════════════════════════════════════════════════════════════
// SCREEN MACHINERY
// ════════════════════════════════════════════════════════════════════════════

async function settle(page: Page) {
  await page.waitForLoadState('networkidle', { timeout: 12_000 }).catch(() => {});
}

/**
 * The panel the module renders into.
 *
 * ⚠ `EsignPage` renders the DETAIL view into `#mt-panel-documents` as well —
 * `panelFor = openId ? 'documents' : tab` — because a detail view is not a
 * third tab and marking "Documents" selected while its list has been replaced
 * would be a lie about where you are. So this id covers list AND detail.
 */
const panel = (page: Page, tab: 'documents' | 'create' | 'analytics') =>
  page.locator(`#mt-panel-${tab}`);

async function gotoEsign(page: Page) {
  await page.goto('/esign');
  await expect(page.locator('.docpane').first(),
    'the eSign module did not render its page shell at all — if the module is ' +
    'not subscribed for this org the router answers 403 and the screen is blank')
    .toBeVisible({ timeout: 60_000 });
  await settle(page);
}

/**
 * Open one eSign tab by CLICKING it, inline or out of the More popover.
 *
 * ⚠ NOT by URL. `EsignPage` reads its tab from local state only — "no URL
 * param, no route state" in its own header — so `/esign?tab=create` lands on
 * whatever the starred default is and every assertion afterwards is about the
 * wrong screen. And the strip is HIDDEN while a document is open, so this
 * asserts it is present rather than assuming.
 *
 * ⚠ AND NOT `{ exact: true }`, which is how this failed on its first run.
 * `getByRole(name)` matches the ACCESSIBLE NAME, and `ModuleTabs` builds that
 * one from FOUR nodes: the English label, a Devanagari `Secondary` when
 * `TAB_HI` has one, an optional count, and — on the STARRED tab only — a
 * `k-sr-only` "Opens here". So the accessible name of the default tab is
 * "Documents Opens here", an exact match finds nothing, and the failure reads
 * "the tab is not in the More menu either": a MISSING CONTROL, which is the
 * wrong diagnosis entirely. Substring, like `_helpers.openTab` already does.
 */
async function openTab(page: Page, label: 'Documents' | 'New document' | 'Analytics') {
  const inline = page.getByRole('tab', { name: label });
  if (await inline.count()) {
    await inline.first().click();
    // ⚠ AND THE TAB MUST ACTUALLY BECOME THE SELECTED ONE. A click that lands
    // and does not switch is a different fault from a tab that is not there,
    // and reporting the first as the second sends the reader looking for a
    // missing control. It happened here on the first full run: `CreateTab`'s
    // `onDone()` fires after an ASYNC read-back, so a create that had not
    // finished settling reset the tab to Documents a moment after this click —
    // and the failure read "the create screen did not render".
    await expect(inline.first(),
      `the "${label}" tab was clicked and did not become selected. Either the ` +
      'click was swallowed by something on top of it, or a pending state update ' +
      'from the previous screen reset the tab underneath this one.')
      .toHaveAttribute('aria-selected', 'true', { timeout: 20_000 });
    await settle(page);
    return;
  }
  const more = page.getByRole('button', { name: /^More/ });
  await expect(more,
    `the "${label}" tab is neither inline nor behind a More menu. The strip is ` +
    'hidden while a document is open — go back to the list first.').toBeVisible();
  await more.click();
  const item = page.getByRole('menuitem', { name: label });
  await expect(item, `the "${label}" tab is not in the More menu either`).toBeVisible();
  await item.click();
  await settle(page);
}

/** Type into a controlled React input the way a person does. */
async function typeInto(input: Locator, value: string) {
  await input.click();
  await input.press('ControlOrMeta+a');
  if (value === '') { await input.press('Backspace'); return; }
  await input.fill(value);
}

/** Open a document from the register by its title, and return the detail scope. */
async function openDoc(page: Page, title: string): Promise<Locator> {
  await gotoEsign(page);
  await openTab(page, 'Documents');
  const p = panel(page, 'documents');
  const row = p.locator('.docrow', { hasText: title });
  await expect(row,
    `"${title}" is not on the register. ⚠ GET /v1/esign/documents ends ` +
    '`LIMIT 50` with no pagination, so a register past fifty rows cannot show ' +
    'it at all — see 15.11.').toHaveCount(1, { timeout: 30_000 });
  await row.click();
  const detail = panel(page, 'documents');
  await expect(detail.getByRole('button', { name: 'All documents' }),
    'the detail view did not open — the list is still on screen').toBeVisible({ timeout: 20_000 });
  await expect(detail.getByText(title, { exact: false }).first()).toBeVisible();
  return detail;
}

/** Press a control that writes, and WAIT FOR THE SERVER before going on. */
async function saveAndWait(
  page: Page,
  act: () => Promise<void>,
  urlRe: RegExp,
  what: string,
  methods: string[] = ['POST', 'PUT', 'PATCH'],
) {
  const [res] = await Promise.all([
    page.waitForResponse((r) => urlRe.test(r.url()) && methods.includes(r.request().method()),
      { timeout: 90_000 }),
    act(),
  ]);
  const body = await res.text().catch(() => '');
  expect(res.status(),
    `${what}: ${res.request().method()} ${new URL(res.url()).pathname} → ${res.status()}\n     ${body.slice(0, 400)}`)
    .toBeLessThan(400);
  try { return JSON.parse(body); } catch { return {}; }
}

/** A PDF is a PDF, checked at the magic number rather than at the extension. */
function assertPdf(buf: Buffer, what: string) {
  expect(buf.subarray(0, 5).toString('latin1'),
    `${what} is not a PDF — it begins ${JSON.stringify(buf.subarray(0, 16).toString('latin1'))}`)
    .toBe('%PDF-');
  expect(buf.subarray(-2048).toString('latin1'), `${what} has no EOF marker — it is truncated`)
    .toContain('%%EOF');
}

/**
 * Pages in a PDF, LENIENTLY — `/Count` if the page tree is readable, else the
 * `/Type /Page` objects, else 0.
 *
 * `_helpers.pdfPageCount` cross-checks the two and asserts they agree, which is
 * right for the fixtures this suite uploads (PDF 1.4, classic xref, no object
 * streams — see the header) and WRONG for the executed copy, which pypdf
 * rewrites and may compress. A test that demanded agreement there would fail on
 * a correct signed PDF, which is a defect in the test.
 */
function pdfPages(buf: Buffer): number {
  const text = buf.toString('latin1');
  const counts = [...text.matchAll(/\/Count\s+(\d+)/g)].map((m) => Number(m[1]));
  const objs = (text.match(/\/Type\s*\/Page(?![s\w])/g) || []).length;
  return Math.max(counts.length ? Math.max(...counts) : 0, objs);
}

/** Fetch a stored artefact, whichever way storage handed it back. */
async function artefact(page: Page, url: string, what: string): Promise<Buffer> {
  expect(url, `${what}: there is no URL to fetch`).toBeTruthy();
  if (url.startsWith('data:')) {
    const comma = url.indexOf(',');
    expect(comma, `${what}: malformed data URI ${url.slice(0, 40)}`).toBeGreaterThan(0);
    return Buffer.from(url.slice(comma + 1), 'base64');
  }
  const res = await page.request.get(url);
  expect(res.status(), `${what}: fetching ${url.slice(0, 90)}… → ${res.status()}`).toBe(200);
  const buf = await res.body();
  expect(buf.length,
    `${what} came back as a 200 WITH AN EMPTY BODY — the exact failure §1 names. ` +
    'The row points at storage and storage returned nothing.').toBeGreaterThan(400);
  return buf;
}

/** A UUID painted on a screen. `check-rendered-ids.mjs` cannot see these. */
const UUID_RE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i;

async function assertNoRenderedId(scope: Locator, where: string) {
  const text = (await scope.innerText()).replace(/\s+/g, ' ');
  const hit = text.match(UUID_RE);
  expect(hit,
    `${where} renders a UUID on screen: "${hit?.[0]}". Never render a user, ` +
    'member or org id in any UI — and the static ratchet is positional, so it ' +
    'cannot see an id the server pre-formatted into a string.').toBeNull();
}

/** The fixture bytes, with the command to build them if they are absent. */
function fixture(name: string): string {
  const p = path.join(FIX, name);
  expect(fs.existsSync(p),
    `the §5 fixture ${name} is missing. Build it first:\n` +
    '       node frontend/e2e-real/fixtures/make-fixtures.mjs\n' +
    '     It is git-ignored on purpose (fixtures/.gitignore) — the generator is ' +
    'deterministic and MANIFEST.txt pins every byte.').toBeTruthy();
  return p;
}

// ════════════════════════════════════════════════════════════════════════════
// THE CREATE FORM
// ════════════════════════════════════════════════════════════════════════════

/**
 * Type one whole document on the "New document" screen and press Create.
 *
 * The order matters and is the order a person uses: title, description, the
 * PDF, then the signers, then the fields. The field palette is DISABLED until
 * a file is attached and until there is at least one signer (`FieldPlacer`
 * disables on `!hasFile || signerCount === 0`), and the "Place fields for"
 * select lists the signers by the names typed above it — so placing before
 * either exists would be placing for nobody.
 */
async function typeDocument(page: Page, doc: PlannedDoc) {
  await openTab(page, 'New document');
  const p = panel(page, 'create');

  await expect(p.getByText('New document').first(),
    'the create screen did not render').toBeVisible({ timeout: 30_000 });

  // ── Title, description ───────────────────────────────────────────────────
  const title = p.getByLabel('Title', { exact: false }).first();
  await expect(title, 'the create form has no Title field').toBeVisible();
  await typeInto(title, doc.title);

  const desc = p.getByLabel('Description', { exact: false }).first();
  await expect(desc, 'the create form has no Description field').toBeVisible();
  await typeInto(desc, doc.description);

  // ── Expiry. NOT a date input — a number of days. ─────────────────────────
  // Worth stating because the standing rule is "no native <input type=date>
  // anywhere": this screen has no date control at all, so the rule is
  // satisfied vacuously here rather than by using `DateInput`.
  const expires = p.getByLabel('Expires in', { exact: false }).first();
  await expect(expires, 'the Send card has no "Expires in" control').toBeVisible();
  await typeInto(expires, String(doc.expiresDays));

  // ── The PDF, through the real drop zone ──────────────────────────────────
  const drop = p.locator('input[type="file"]').first();
  await expect(drop, 'the create form has no file input — `FileDropZone` did not render')
    .toHaveCount(1);
  await drop.setInputFiles(fixture(doc.fixture));
  await expect(p.locator('.docdz__nm'),
    `the drop zone did not accept ${doc.fixture} — it renders the rejection in place`)
    .toBeVisible({ timeout: 20_000 });

  // ── Signers ──────────────────────────────────────────────────────────────
  for (let i = 0; i < doc.signers.length; i++) {
    if (i > 0) {
      const add = p.getByRole('button', { name: 'Add signer' });
      await expect(add, 'there is no "Add signer" control on the signing-order card')
        .toBeVisible();
      await add.click();
    }
    const s = doc.signers[i];
    const n = i + 1;
    // ⚠ aria-label, not a visible label. `getByRole(name)` matches the
    // ACCESSIBLE name and these inputs have no <label> at all.
    const name = p.locator(`input[aria-label="Signer ${n} name"]`);
    const mail = p.locator(`input[aria-label="Signer ${n} email"]`);
    const phone = p.locator(`input[aria-label="Signer ${n} phone"]`);
    await expect(name, `signer ${n}'s name box is not on the form`).toBeVisible();
    await expect(mail, `signer ${n}'s email box is not on the form`).toBeVisible();
    await typeInto(name, s.name);
    await typeInto(mail, s.email);
    if (s.phone) {
      await expect(phone, `signer ${n}'s phone box is not on the form`).toBeVisible();
      await typeInto(phone, s.phone);
    }
    // The order number is rendered on the rail. It was absent once, so a
    // three-signer document gave no clue who receives it first.
    await expect(p.locator('.docfp-ord__n').nth(i),
      `signer ${n}'s order number is not shown on the rail`).toHaveText(String(n));
  }

  // ── The page stage: does the placer know how many pages this PDF has? ────
  // This is the assertion that proves `countPdfPages` read the fixture. A
  // compressed page tree returns 0 and the stage silently collapses to one
  // page — which would make every "page 2+" placement below meaningless.
  const pageBtns = p.locator('.docfp-pg');
  await expect(pageBtns,
    `the placer does not offer ${doc.pages} pages for ${doc.fixture}. ` +
    '`countPdfPages` reads /Type /Page and /Count out of the raw bytes and ' +
    'returns 0 for a compressed page tree, in which case the stage shows ONE ' +
    'page and nothing can be placed past it — so this counts the page strip ' +
    'rather than trusting the fixture.')
    .toHaveCount(doc.pages, { timeout: 20_000 });

  // `.docfp-hint` is used TWICE — the drag/arrow-key instructions and the
  // honesty note about what the sheet is. `.first()` reads the wrong one, which
  // is how this failed on its first run. Filtered, not indexed.
  await expect(p.locator('.docfp-hint').filter({ hasText: /page-shaped guide/i }),
    'the placement stage does not say on the surface that it is a guide rather ' +
    'than a render of the PDF. A person placing a signature over a paragraph ' +
    'they cannot see is entitled to know that is what they are doing.')
    .toHaveCount(1);

  // ── The 24 fields, across the pages ──────────────────────────────────────
  const who = p.locator('#docfp-who-sel');
  await expect(who, 'the "Place fields for" select is not on the stage').toBeVisible();

  for (const f of doc.fields) {
    await who.selectOption(String(f.signer));
    await pageBtns.nth(f.page - 1).click();
    await expect(pageBtns.nth(f.page - 1),
      `page ${f.page} did not become the current page`).toHaveAttribute('aria-current', 'true');

    const chip = p.locator('.docfp-kinds button', { hasText: KIND_LABEL[f.kind] }).first();
    await expect(chip,
      `the palette has no "${KIND_LABEL[f.kind]}" chip, or it is disabled — it ` +
      'stays disabled until a PDF is attached AND a signer exists').toBeEnabled();
    await chip.click();

    // The box must exist ON THIS PAGE, named for the signer it belongs to.
    const named = `${KIND_LABEL[f.kind]} for ${doc.signers[f.signer - 1].name}, page ${f.page}`;
    await expect(p.getByRole('button', { name: named, exact: true }),
      `no field named "${named}" appeared on the stage. describeField() builds ` +
      'that accessible name, so its absence means the box was not placed for ' +
      'the signer or the page the palette was set to.').toHaveCount(1);
  }

  // `.docfp-pgn` is used twice — the header's "N fields placed" and the page
  // strip's "page X of N" — so this is filtered rather than taken `.first()`,
  // which would silently read the wrong one on a document with no fields.
  await expect(p.locator('.docfp-pgn').filter({ hasText: /field/ }),
    `the header does not report ${doc.fields.length} placed fields`)
    .toContainText(`${doc.fields.length} field`);

  // ── Create. ONE BUTTON, TWO REQUESTS — §10 rule 7. ───────────────────────
  const create = p.getByRole('button', { name: /^Create/ });
  await expect(create, 'there is no "Create document" button').toBeEnabled();

  // ⚠ WAIT FOR THE PREVIOUS DOCUMENT'S TOAST TO GO FIRST, or the assertion
  // below matches it and this test walks on before the create has settled.
  // That is exactly what happened on the first full run: a warning toast lives
  // 7,000 ms (`toast.jsx` DURATION), document 03's form took less than that to
  // fill, so document 02's toast satisfied the check, the loop clicked "New
  // document" for document 04, and document 03's own `onDone()` — which runs
  // after an async read-back — then reset the tab to Documents underneath it.
  // A stale toast is not evidence about this document.
  await expect(page.locator('.k-toasts .tst'),
    'a toast from the previous document is still on screen after 15s, so any ' +
    'toast assertion below would be about the wrong document')
    .toHaveCount(0, { timeout: 15_000 });

  const [createRes, uploadRes] = await Promise.all([
    page.waitForResponse((r) => /\/api\/v1\/esign\/documents$/.test(r.url())
      && r.request().method() === 'POST', { timeout: 90_000 }),
    page.waitForResponse((r) => /\/api\/v1\/esign\/documents\/[^/]+\/upload$/.test(r.url())
      && r.request().method() === 'POST', { timeout: 90_000 }),
    create.click(),
  ]);

  const createBody = await createRes.text();
  expect(createRes.status(),
    `POST /v1/esign/documents → ${createRes.status()}: ${createBody.slice(0, 400)}`).toBe(200);
  const created = JSON.parse(createBody);
  expect(created?.id, 'the create response carried no document id').toBeTruthy();
  expect(created?.status, 'a new document must be a draft').toBe('draft');

  const uploadBody = await uploadRes.text();
  expect(uploadRes.status(),
    `the SECOND request — POST /documents/{id}/upload — answered ` +
    `${uploadRes.status()}: ${uploadBody.slice(0, 400)}. The document row is ` +
    'written FIRST, so a refused upload leaves a draft at file_url="pending" ' +
    'that the user has to find and finish.').toBe(200);

  // The upload must have targeted the row the create just made. Watching one
  // request and assuming the other is how a two-request button passes a test
  // it should fail.
  const uploadedTo = new URL(uploadRes.url()).pathname.split('/').slice(-2, -1)[0];
  expect(uploadedTo,
    'the upload went to a different document than the create returned').toBe(String(created.id));

  // ⚠ AND THE SCREEN MUST TELL THE TRUTH ABOUT THE PLACEMENT. `CreateTab` reads
  // the document back after the create and counts what came home; when the
  // server kept nothing it says so, in those words, rather than reporting
  // success over a silent discard. That warning is the product being honest
  // about the gap 15.04 measures, and it is asserted here so that a future
  // change which starts STORING the fields turns this red on purpose.
  await expect(page.locator('.k-toasts'),
    'the create screen reported plain success after posting ' +
    `${doc.fields.length} placed fields the server does not store. Pydantic v2 ` +
    'drops unknown members silently, so a screen that does not read the document ' +
    'back cannot tell — and telling the user their placement was saved when it ' +
    'was discarded is the worst outcome this surface has.')
    .toContainText(new RegExp(`does not store field placement yet.*${doc.fields.length} field`, 's'),
      { timeout: 45_000 });

  const uploaded = JSON.parse(uploadBody);
  expect(uploaded?.file_url, 'the upload response carried no file_url').toBeTruthy();
  expect(String(uploaded?.file_hash || ''),
    'the upload response carried no SHA-256 — the hash is the "alterations are ' +
    'detectable" limb of the IT Act §10A claim').toMatch(/^[0-9a-f]{64}$/);

  return { id: String(created.id), fileHash: String(uploaded.file_hash) };
}

// ════════════════════════════════════════════════════════════════════════════
// THE TESTS
// ════════════════════════════════════════════════════════════════════════════

/**
 * ⚠ ORDER, BUT NOT FAIL-FAST — and the difference cost a whole run.
 *
 * These tests depend on each other in sequence and `workers: 1` with no
 * `fullyParallel` already guarantees declaration order in one worker. What
 * `describe.configure({ mode: 'serial' })` ADDS is that the first failure SKIPS
 * everything after it — so 15.08b's known, deliberate red (a telemetry defect
 * that changes nothing about the journey) took 15.09, 15.10, 15.11 and the §4
 * volume sheet down with it and reported them as "did not run".
 *
 * That is the silent cap §10 warns about wearing a different hat: four tests
 * reported as unrun because an unrelated one was red. Suite 05 records the same
 * lesson — "a test that aborts hides everything after it". So: no serial mode.
 * A test that genuinely cannot proceed says so in its own failure message.
 */

test.beforeAll(() => {
  expect(LANE.token || LANE.password, BLOCKED).toBeTruthy();
});

test('15.01 the module opens, all three tabs render, and the s.10A notice is ON the screen', async ({ page }) => {
  // The run starts here, and so does the shared ledger. 15.01 is the only test
  // that resets it: it always runs first, and a worker restarted by a later
  // failure never re-enters it — which is exactly the property the ledger needs.
  writeShared(freshState());

  const con = watchConsole(page);
  const fail = watchFailures(page);
  await signIn(page);

  con.at('esign');
  await gotoEsign(page);

  // The module header. A 403 from `require_module("esign")` renders an empty
  // shell, so this asserts the module is actually subscribed for this org.
  await expect(page.getByRole('heading', { name: /E-Sign/i }).first(),
    'the eSign module header is not on the page — check the module subscription')
    .toBeVisible({ timeout: 30_000 });

  // ⚠ 13 §2 requires this stated ON the surface, not in help. A user who
  // believes they hold a Digital Signature Certificate has been misled by
  // omission, and this is the one screen that can correct it.
  await expect(page.locator('.note').first(),
    'the IT Act s.10A notice is not on the eSign page. It is a statutory ' +
    'disclosure, not decoration: OTP signing is NOT a Digital Signature ' +
    'Certificate and the surface has to say so.')
    .toContainText(/Information\s+Technology\s+Act, 2000/);
  await expect(page.locator('.note').first())
    .toContainText(/not a Digital Signature Certificate/i);

  // Three tabs, all three opened, none skipped.
  for (const t of ['Documents', 'New document', 'Analytics'] as const) {
    con.at(`tab:${t}`);
    await openTab(page, t);
    const id = t === 'Documents' ? 'documents' : t === 'Analytics' ? 'analytics' : 'create';
    await expect(panel(page, id),
      `the "${t}" tab did not render its panel (#mt-panel-${id})`).toBeVisible({ timeout: 30_000 });
    // Every screen must SAY something. A blank panel is indistinguishable from
    // a broken one, which is Suite 00's whole complaint.
    const text = (await panel(page, id).innerText()).trim();
    expect(text.length, `the "${t}" panel painted nothing at all`).toBeGreaterThan(0);
    await assertNoRenderedId(panel(page, id), `the eSign "${t}" tab`);
  }

  // The register's filter chips — six states, and each one is a real button
  // with aria-pressed, not a colour.
  await openTab(page, 'Documents');
  const chips = panel(page, 'documents').locator('.docfilt .chip');
  await expect(chips,
    'the register has no status filter row').toHaveCount(6);
  for (const label of ['All', 'draft', 'sent', 'partially signed', 'completed', 'cancelled']) {
    await expect(chips.filter({ hasText: new RegExp(`^${label}$`, 'i') }),
      `the "${label}" filter chip is missing from the register`).toHaveCount(1);
  }
  // A filter that filters. Click `draft`, and the request must carry it.
  const [filtered] = await Promise.all([
    page.waitForResponse((r) => /\/v1\/esign\/documents\?status=draft/.test(r.url()), { timeout: 30_000 }),
    chips.filter({ hasText: /^draft$/i }).click(),
  ]);
  expect(filtered.status(), 'filtering the register by draft failed').toBe(200);
  await chips.filter({ hasText: /^All$/i }).click();
  await settle(page);

  assertNoUncaught(con);
  console.log(`  15.01 console:${dumpConsole(con)}`);
  console.log(`  15.01 non-2xx:${dumpFailures(fail)}`);
});

test('15.02 six documents typed by hand — a real multi-page PDF, 24 placed fields, 10 signers', async ({ page }) => {
  test.setTimeout(30 * 60_000);
  const con = watchConsole(page);
  const wire = watchWire(page);
  await signIn(page);
  await gotoEsign(page);

  const before = await myDocs(page);

  for (const doc of DOCS) {
    con.at(`create:${doc.no}`);
    if (before.has(doc.no)) {
      // §6 — recognise this run's own output and verify rather than duplicate.
      bump((st) => {
        st.typed.documentsFound++;
        st.typed.signersFound += doc.signers.length;
        st.typed.fieldsFound += doc.fields.length;
      });
      console.log(`  15.02 ${doc.no} already present — verified, not typed`);
      continue;
    }
    const made = await typeDocument(page, doc);
    bump((st) => {
      st.typed.documents++;
      st.typed.signers += doc.signers.length;
      st.typed.fieldsPlaced += doc.fields.length;
    });

    // The canonical row, never the create response and never the list.
    const rec = await record(page, made.id);
    expect(rec.document.title, `document ${doc.no} came back with the wrong title`)
      .toBe(doc.title);
    expect(rec.document.status, `document ${doc.no} is not a draft after create`).toBe('draft');
    expect(Number(rec.document.signers_total),
      `document ${doc.no} recorded the wrong signer count`).toBe(doc.signers.length);
    expect(rec.signers.length,
      `document ${doc.no} stored ${rec.signers.length} signer rows for ${doc.signers.length} typed`)
      .toBe(doc.signers.length);
    expect(rec.signers.map((s: any) => Number(s.sign_order)),
      `document ${doc.no}'s signing order is not dense 1..n — a gap at position 2 ` +
      'is a document the server waits on for ever')
      .toEqual(doc.signers.map((_, i) => i + 1));
    expect(rec.signers.map((s: any) => String(s.email).toLowerCase()),
      `document ${doc.no}'s signer addresses did not round-trip`)
      .toEqual(doc.signers.map((s) => s.email.toLowerCase()));
    expect(String(rec.document.file_url || ''),
      `document ${doc.no} is still at file_url="pending" — the second request ` +
      'left an orphan draft').not.toBe('pending');
    expect(String(rec.document.file_hash || ''),
      `document ${doc.no} stored no file hash`).toBe(made.fileHash);

    // The audit trail starts here. `document_created` and `file_uploaded` are
    // the two rows the two requests each owe.
    const actions = rec.audit_trail.map((a: any) => String(a.action));
    expect(actions, `document ${doc.no}: the create wrote no document_created audit row`)
      .toContain('document_created');
    expect(actions, `document ${doc.no}: the upload wrote no file_uploaded audit row`)
      .toContain('file_uploaded');
  }

  assertNoUncaught(con);
  console.log(`  15.02 wire:${dumpWire(wire)}`);

  const after = await myDocs(page);
  expect(after.size,
    `${after.size} of ${N_DOCUMENTS} §4 documents are on the register. Missing: ` +
    DOCS.filter((d) => !after.has(d.no)).map((d) => d.no).join(', '))
    .toBe(N_DOCUMENTS);
  const T = readShared().typed;
  console.log(`  15.02 §6 idempotence — documents: ${T.documents} typed, ${T.documentsFound} already present`);
});

test('15.03 the canonical record, and the multi-page PDF that came back out of R2', async ({ page }) => {
  test.setTimeout(15 * 60_000);
  const con = watchConsole(page);
  await signIn(page);

  const docs = await myDocs(page);
  expect(docs.size, 'the register does not hold this suite\'s six documents').toBe(N_DOCUMENTS);

  for (const doc of DOCS) {
    con.at(`record:${doc.no}`);
    const row = docs.get(doc.no)!;
    const rec = await record(page, row.id);

    // ⚠ THE ASSERTION THAT PROVES §5. The fixture is multi-page, it was
    // uploaded, it went to R2, and the bytes that come BACK are the same
    // document with the same number of pages. A single-page fixture proves
    // nothing, and neither does a fixture that never survived the round trip.
    const buf = await artefact(page, String(rec.document.file_url),
      `document ${doc.no}'s stored PDF`);
    assertPdf(buf, `document ${doc.no}'s stored PDF`);
    expect(pdfPages(buf),
      `document ${doc.no} was uploaded as a ${doc.pages}-page PDF and storage ` +
      `returned ${pdfPages(buf)} pages`).toBe(doc.pages);
    fs.writeFileSync(path.join(OUT, `original-${doc.no}.pdf`), buf);

    // The detail SCREEN, not just the row.
    const detail = await openDoc(page, doc.title);
    await expect(detail.locator('.k-statuschip').first(),
      `document ${doc.no}'s status pill is missing from the detail screen`).toBeVisible();
    await expect(detail.getByText('Signed', { exact: false }).first()).toBeVisible();
    // Expiry is an ABSOLUTE date plus a signed relative — it was rendered with
    // `relTime`, which appends "ago" unconditionally, so a document expiring in
    // twelve days read "Expires 12d ago" and looked long dead.
    await expect(detail.getByText(/Expires/).first(),
      `document ${doc.no}'s detail screen does not show an expiry`).toBeVisible();
    await expect(detail.locator('.docdet__v').filter({ hasText: /\bin\s+\d+/ }).first(),
      `document ${doc.no}'s expiry reads as a past date — a future expiry must ` +
      'not be rendered with an "ago" suffix').toBeVisible();

    // Every signer is on the screen, by NAME, with their state.
    const rows = detail.locator('.docsg__r');
    await expect(rows, `document ${doc.no} does not show one row per signer ` +
      `(${doc.signers.length} were typed)`).toHaveCount(doc.signers.length);
    for (let i = 0; i < doc.signers.length; i++) {
      await expect(rows.nth(i).locator('.docsg__nm'),
        `signer ${i + 1} of document ${doc.no} is not named on the detail screen`)
        .toHaveText(doc.signers[i].name);
      await expect(rows.nth(i).locator('.docsg__n'),
        `signer ${i + 1} of document ${doc.no} shows no order number`).toHaveText(String(i + 1));
    }

    await assertNoRenderedId(detail, `the eSign detail screen for document ${doc.no}`);
  }

  assertNoUncaught(con);
});

test('15.04 field placement is TYPED AND THROWN AWAY — the honest finding, asserted three ways', async ({ page }) => {
  await signIn(page);

  // ── 1. THE DEPLOYED CONTRACT. Not the source tree — the running service. ──
  // `⚠ "the code already does X" must be checked against what is DEPLOYED`, and
  // the OpenAPI the staging process publishes is that check.
  const spec = await (await page.request.get(`${API}/openapi.json`)).json();
  const create = spec?.components?.schemas?.routers__esign__DocumentCreate;
  expect(create, 'the deployed OpenAPI has no routers__esign__DocumentCreate schema').toBeTruthy();
  const members = Object.keys(create.properties || {});
  expect(members.sort(),
    'the deployed create contract has changed. If `fields` has been ADDED, this ' +
    'test is now the thing standing in the way of the fix — rewrite it to assert ' +
    'the placement is STORED, and re-point 15.12\'s volume line at sign_fields.')
    .toEqual(['description', 'expires_days', 'message', 'signers', 'title'].sort());
  expect(members,
    'the deployed create contract now accepts `fields` — see the message above')
    .not.toContain('fields');

  // ── 2. THE CANONICAL RECORD carries no placement, per document ────────────
  const docs = await myDocs(page);
  expect(docs.size, 'the six documents are not on the register').toBe(N_DOCUMENTS);
  for (const doc of DOCS) {
    const rec: any = await record(page, docs.get(doc.no)!.id);
    expect(rec.fields ?? rec.document?.fields,
      `document ${doc.no} unexpectedly carries stored field placement. If the ` +
      'router now writes `staging.sign_fields`, this assertion is what has to ' +
      'change — not the router.').toBeUndefined();
  }

  // ── 3. THE TABLE EXISTS AND IS EMPTY ─────────────────────────────────────
  // `staging.sign_fields` was created by migration 114 and is applied — checked
  // live, not read off the migration file. Nothing in `backend/` references it.
  // This is the sweep's dominant defect class INVERTED: not a route with no
  // screen, but a TABLE with no route, behind a screen that produces exactly
  // the rows it would hold.
  const first = docs.get('01')!;
  const rows = inbox('fields', String(first.id));
  expect(Number(rows[0]?.n),
    'staging.sign_fields now holds rows for a document this suite created — ' +
    'the placement is being stored, so 15.12\'s volume line must change')
    .toBe(0);

  note(
    `FIELD PLACEMENT — ${N_FIELDS} placed, 0 stored. staging.sign_fields EXISTS ` +
    '(migration 114 applied, verified live) and NOTHING reads or writes it; the ' +
    'deployed DocumentCreate has no `fields` member and Pydantic v2 drops unknown ' +
    'members silently. CreateTab detects this and warns the user rather than ' +
    'lying, which is correct — but §4\'s "fields placed 24" is 24 PLACED and 0 ' +
    'STORED. PRODUCT GAP · LATENT (nobody has relied on a placed field yet, ' +
    'because the signing page never renders one).');
});

test('15.05 the recipient gate, and then the send — with the outbound row as the evidence', async ({ page }) => {
  test.setTimeout(25 * 60_000);
  const con = watchConsole(page);
  const wire = watchWire(page);
  await signIn(page);

  // ── THE GATE. Enumerated from the SERVER's own signer list, never sampled. ─
  const docs = await myDocs(page);
  expect(docs.size, 'the six documents are not on the register').toBe(N_DOCUMENTS);

  const everyone: { doc: string; email: string }[] = [];
  for (const doc of DOCS) {
    const rec = await record(page, docs.get(doc.no)!.id);
    expect(rec.signers.length,
      `document ${doc.no} lists ${rec.signers.length} signers, so the enumeration ` +
      'is incomplete and no send may happen').toBe(doc.signers.length);
    for (const s of rec.signers) everyone.push({ doc: doc.no, email: String(s.email) });
  }
  expect(everyone.length,
    `the enumeration found ${everyone.length} addresses for ${N_SIGNERS} §4 signers`)
    .toBe(N_SIGNERS);

  const bad = everyone.filter((e) => !ALLOWED.test(e.email));
  expect(bad,
    '\n  ⚠⚠ STOP — this send would mail address(es) outside the allowed set.\n' +
    bad.map((b) => `     ${b.doc}: ${b.email}`).join('\n') + '\n' +
    '     GET /api/health reports outbound_mode=live and suppressed_orgs_digest="0",\n' +
    '     so NOTHING is shielded and this WOULD be delivered. Allowed:\n' +
    '     @simulator.amazonses.com, kevalvshah03+…@gmail.com, kelisweet+…@gmail.com,\n' +
    '     …@unicodegroup.com. @example.com is refused — it is RFC 2606 reserved,\n' +
    '     publishes a null MX, and a bounce lands on the SES account that sends the\n' +
    '     owner\'s real invoices. Reported, not worked around.\n')
    .toEqual([]);
  console.log(`  15.05 recipient gate: ${everyone.length} addresses, all inside the allowed set`);

  // The health line is printed either way, so the run report says what the
  // deployed process actually reported rather than what a comment claims.
  const health = await (await page.request.get(`${API}/api/health`)).json();
  console.log(`  15.05 outbound_mode=${health.outbound_mode} suppressed_orgs_digest=${health.suppressed_orgs_digest}`);

  // ── THE SEND. Five documents; D6 stays a draft on purpose. ───────────────
  const toSend = DOCS.filter((d) => d.end !== 'draft');
  expect(toSend.length, 'the plan sends five of the six documents').toBe(5);

  for (const doc of toSend) {
    con.at(`send:${doc.no}`);
    const before = await record(page, docs.get(doc.no)!.id);
    if (before.document.status !== 'draft') {
      bump((st) => { st.typed.sentFound++; });
      console.log(`  15.05 ${doc.no} already ${before.document.status} — verified, not re-sent`);
      continue;
    }

    // Outbound BEFORE, per address. A delta, never a total — §10 rule 4.
    const priors = new Map<string, number>();
    for (const s of doc.signers) {
      priors.set(s.email, countPurpose(await outboundFor(page, s.email), 'signature_request'));
    }

    const detail = await openDoc(page, doc.title);
    const send = detail.getByRole('button', { name: /Send for signing/ });
    await expect(send,
      `document ${doc.no} is a draft with a PDF attached and offers no "Send for ` +
      'signing" button').toBeVisible();

    const body = await saveAndWait(page, () => send.click(),
      /\/v1\/esign\/documents\/[^/]+\/send$/, `sending document ${doc.no}`);
    expect(body?.status, `sending document ${doc.no} did not answer "sent"`).toBe('sent');
    expect(Number(body?.signers_notified),
      `document ${doc.no} notified ${body?.signers_notified} of ${doc.signers.length} signers`)
      .toBe(doc.signers.length);
    bump((st) => { st.typed.sent++; });

    // The row is the evidence — `send_email` returns True when the gate
    // suppresses, so a 200 proves nothing about a message.
    for (const s of doc.signers) {
      const rows = await outboundFor(page, s.email);
      const now = countPurpose(rows, 'signature_request');
      expect(now,
        `no signature_request row was written for ${s.email} on document ` +
        `${doc.no}. The endpoint answered 200 and send_email() returns True when ` +
        'the gate suppresses, so the log row is the only evidence a message ' +
        'existed at all.').toBe(priors.get(s.email)! + 1);
      const latest = rows.find((r) => String(r.purpose) === 'signature_request');
      expect(['queued', 'sent', 'suppressed', 'failed'],
        `the outbound row for ${s.email} carries status "${latest?.status}", which ` +
        'is not in services/outbound_log.py\'s vocabulary')
        .toContain(String(latest?.status));
      console.log(`  15.05 ${doc.no} → ${s.email}: ${latest?.status}`);
    }

    // The screen must catch up: the document and every signer move together.
    const after = await record(page, docs.get(doc.no)!.id);
    expect(after.document.status, `document ${doc.no} is not "sent" after sending`).toBe('sent');
    expect(after.signers.map((s: any) => s.status),
      `document ${doc.no}'s signers were not all moved to "sent"`)
      .toEqual(doc.signers.map(() => 'sent'));
    await expect(panel(page, 'documents').locator('.k-statuschip').first())
      .toContainText('Sent', { timeout: 20_000 });
    // Send is a one-way door, and the button must go.
    await expect(panel(page, 'documents').getByRole('button', { name: /Send for signing/ }),
      `document ${doc.no} still offers "Send for signing" after being sent — the ` +
      'endpoint answers 400 "Document already sent"').toHaveCount(0);
  }

  // ── SIGNING ORDER IS DECORATIVE, proved read-only ────────────────────────
  // D1 has two ordered signers. Both were invited by the same click, before
  // signer 1 had done anything — so the numbered rail on the create screen
  // describes a sequence the server does not run.
  const d1 = DOCS[0];
  const invited = [] as string[];
  for (const s of d1.signers) {
    const rows = await outboundFor(page, s.email);
    if (countPurpose(rows, 'signature_request') > 0) invited.push(s.email);
  }
  expect(invited.length,
    'expected both of document 01\'s signers to have been invited').toBe(2);
  note(
    'SIGNING ORDER IS DECORATIVE. `POST /documents/{id}/send` loops every signer ' +
    'and mails all of them at once, and `submit_signature` has no predecessor ' +
    'check — measured here: both of document 01\'s ordered signers hold a live ' +
    'signature_request before signer 1 has signed. CreateTab renders a numbered ' +
    'rail, renumbers on removal to keep sign_order dense, and warns that "a gap ' +
    'at position 2 is a document the server will wait on for ever". PRODUCT GAP · ' +
    'ACTIVE — the sequence the UI promises is not the sequence the server runs.');

  assertNoUncaught(con);
  console.log(`  15.05 wire:${dumpWire(wire)}`);
  const T = readShared().typed;
  console.log(`  15.05 §6 idempotence — sends: ${T.sent} typed, ${T.sentFound} already present`);
});

test('15.06 remind — per signer, and only where a reminder means anything', async ({ page }) => {
  test.setTimeout(15 * 60_000);
  const con = watchConsole(page);
  await signIn(page);

  const doc = DOCS.find((d) => d.no === '03')!;
  const docs = await myDocs(page);
  const id = String(docs.get('03')!.id);

  const before = await record(page, id);
  expect(before.document.status,
    'document 03 must be "sent" before a reminder means anything').toBe('sent');

  const priorAudit = before.audit_trail.filter((a: any) => a.action === 'reminder_sent').length;

  const detail = await openDoc(page, doc.title);
  const rows = detail.locator('.docsg__r');
  await expect(rows).toHaveCount(doc.signers.length);

  for (let i = 0; i < doc.signers.length; i++) {
    con.at(`remind:${i + 1}`);
    const s = doc.signers[i];
    const priorMail = countPurpose(await outboundFor(page, s.email), 'signature_reminder');

    const remind = rows.nth(i).getByRole('button', { name: 'Remind' });
    await expect(remind,
      `signer ${i + 1} of document 03 is awaiting signature and offers no ` +
      '"Remind" button. DetailTab renders it for status sent|opened on a ' +
      'document that is not cancelled — anything else and the control is gone.')
      .toBeVisible();

    const body = await saveAndWait(page, () => remind.click(),
      /\/v1\/esign\/documents\/[^/]+\/resend\/[^/]+$/, `reminding signer ${i + 1}`);
    expect(body?.resent, `the reminder for ${s.name} did not answer resent:true`).toBe(true);
    bump((st) => { st.typed.reminders++; });

    const now = countPurpose(await outboundFor(page, s.email), 'signature_reminder');
    expect(now,
      `no signature_reminder row was written for ${s.email}. The button answered ` +
      '200; the row is the evidence.').toBe(priorMail + 1);
    await expect(page.locator('.k-toasts'),
      'the reminder produced no confirmation on screen')
      .toContainText(new RegExp(`Reminder sent to ${s.name}`), { timeout: 20_000 });
  }

  const after = await record(page, id);
  const nowAudit = after.audit_trail.filter((a: any) => a.action === 'reminder_sent').length;
  expect(nowAudit,
    'the reminders wrote no reminder_sent rows into the audit trail — the trail ' +
    'IS the product here, so a reminder nobody can evidence did not happen')
    .toBe(priorAudit + doc.signers.length);

  // The audit trail is on the SCREEN, ordered, and names the person.
  await expect(detail.getByText('Audit trail').first(),
    'the detail screen has no audit trail card').toBeVisible();
  await expect(detail.locator('.docaud__none'),
    'the audit trail card says "No activity recorded yet" for a document that has ' +
    'been created, uploaded, sent and reminded').toHaveCount(0);

  // ── The control must be ABSENT where a reminder is meaningless ───────────
  // Document 06 is a draft: nobody has been invited, so there is nobody to
  // remind. A "Remind" button there would send a reminder for an invitation
  // that was never issued.
  const draft = await openDoc(page, DOCS.find((d) => d.no === '06')!.title);
  await expect(draft.getByRole('button', { name: 'Remind' }),
    'a DRAFT document offers a "Remind" button. Nobody has been invited, so a ' +
    'reminder would be a reminder about nothing.').toHaveCount(0);

  assertNoUncaught(con);
  const T = readShared().typed;
  console.log(`  15.06 reminders sent this run: ${T.reminders}`);
});

test('15.07 void — confirmed, irreversible, and it takes the controls with it', async ({ page }) => {
  test.setTimeout(10 * 60_000);
  const con = watchConsole(page);
  await signIn(page);

  const doc = DOCS.find((d) => d.no === '04')!;
  const docs = await myDocs(page);
  const id = String(docs.get('04')!.id);
  const before = await record(page, id);

  if (before.document.status === 'cancelled') {
    bump((st) => { st.typed.voidedFound++; });
    console.log('  15.07 document 04 is already cancelled — verified, not re-voided');
  } else {
    expect(before.document.status,
      'document 04 must be sent before it can be voided').toBe('sent');

    const detail = await openDoc(page, doc.title);
    const cancel = detail.getByRole('button', { name: 'Cancel document' });
    await expect(cancel,
      'document 04 is live and offers no "Cancel document" control. Void is one ' +
      'of the four actions §10 names for this suite, and it is exactly the shape ' +
      'that hides an orphaned route.').toBeVisible();
    await cancel.click();

    // ⚠ CONFIRMED, because it invalidates every outstanding signing link. It
    // was a one-click irreversible action once.
    const dialog = page.locator('[role="alertdialog"]');
    await expect(dialog,
      'voiding a document is not confirmed. It kills every outstanding signing ' +
      'link, including for signers who have already opened it, and cannot be undone.')
      .toBeVisible({ timeout: 15_000 });
    await expect(dialog).toContainText(/cannot be undone/i);

    const body = await saveAndWait(page,
      () => dialog.getByRole('button', { name: /^Cancel document$/ }).click(),
      /\/v1\/esign\/documents\/[^/]+\/cancel$/, 'voiding document 04');
    expect(body?.status, 'the void did not answer "cancelled"').toBe('cancelled');
    bump((st) => { st.typed.voided++; });
  }

  const after = await record(page, id);
  expect(after.document.status, 'document 04 is not cancelled').toBe('cancelled');
  expect(after.audit_trail.map((a: any) => a.action),
    'the void wrote no document_cancelled audit row').toContain('document_cancelled');

  // The screen, and the controls that must have gone with it.
  const detail = await openDoc(page, doc.title);
  await expect(detail.locator('.k-statuschip').first()).toContainText('Cancelled');
  await expect(detail.getByRole('button', { name: 'Cancel document' }),
    'a cancelled document still offers "Cancel document" — the endpoint answers ' +
    '400 "Cannot cancel a cancelled document"').toHaveCount(0);
  await expect(detail.getByRole('button', { name: /Send for signing/ }),
    'a cancelled document still offers "Send for signing"').toHaveCount(0);
  await expect(detail.getByRole('button', { name: 'Remind' }),
    'a cancelled document still offers "Remind" — DetailTab gates that on ' +
    'doc.status !== "cancelled" precisely so a dead link is not re-sent')
    .toHaveCount(0);

  // The register agrees, through its own filter.
  //
  // ⚠ Back to the LIST first, with the screen's own control. `EsignPage` hides
  // the tab strip while a document is open — "a detail view is not a third tab
  // and marking Documents selected while its list has been replaced is a lie
  // about where you are" — so calling `openTab` from inside a detail view finds
  // no tablist and reports a missing tab. That is this suite's own bug, caught
  // on its first full run, and the fix is to leave the way a person does.
  await detail.getByRole('button', { name: 'All documents' }).click();
  const chips = panel(page, 'documents').locator('.docfilt .chip');
  await expect(chips, 'going back from the detail view did not restore the register')
    .toHaveCount(6, { timeout: 20_000 });
  const [res] = await Promise.all([
    page.waitForResponse((r) => /\/v1\/esign\/documents\?status=cancelled/.test(r.url())),
    chips.filter({ hasText: /^cancelled$/i }).click(),
  ]);
  expect(res.status()).toBe(200);
  await expect(panel(page, 'documents').locator('.docrow', { hasText: doc.title }),
    'the cancelled filter does not show the document that was just cancelled')
    .toHaveCount(1, { timeout: 20_000 });

  assertNoUncaught(con);
});

test('15.08 the counterparty signs — in a second browser context, with no session at all', async ({ page, browser }) => {
  test.setTimeout(40 * 60_000);
  await signIn(page);
  const docs = await myDocs(page);

  /** One complete counterparty journey, start to finish, as a stranger. */
  async function signAs(browser: Browser, docNo: string, order: number) {
    const doc = DOCS.find((d) => d.no === docNo)!;
    const id = String(docs.get(docNo)!.id);
    const planned = doc.signers[order - 1];

    const links = signingLinks(id);
    const mine = links.find((l) => Number(l.sign_order) === order)!;
    expect(mine, `document ${docNo} has no signer at order ${order}`).toBeTruthy();
    expect(String(mine.email).toLowerCase(),
      `the mailbox and the plan disagree about who signer ${order} is`)
      .toBe(planned.email.toLowerCase());

    if (mine.status === 'signed') {
      bump((st) => { st.typed.signaturesFound++; });
      console.log(`  15.08 ${docNo} signer ${order} has already signed — verified, not re-signed`);
      // §6 — and the product must SAY so rather than offering the form again.
      const ctx0 = await browser.newContext();
      const p0 = await ctx0.newPage();
      await p0.goto(`${BASE}/sign/${mine.token}`);
      // The HEADING, not the text. `getByText('Already signed')` matches the
      // card title AND the sentence under it ("You have already signed this
      // document on 29 Aug 2026") and dies of strict mode — a test bug that
      // reads exactly like the product failing to show the state.
      await expect(p0.getByRole('heading', { name: 'Already signed' }),
        'a signed link does not report "Already signed" — it must never offer the ' +
        'signature form a second time').toBeVisible({ timeout: 45_000 });
      await expect(p0.getByRole('button', { name: 'Sign document' }),
        'a signed link still offers the signature form').toHaveCount(0);
      await ctx0.close();
      return;
    }

    // ── A FRESH CONTEXT. No storage state, no cookie, no token. ────────────
    // This is the only thing that proves the signing link works for a stranger
    // rather than for whoever happened to be logged in.
    const ctx = await browser.newContext();
    const sp = await ctx.newPage();
    const con = watchConsole(sp);
    const fail = watchFailures(sp);
    try {
      expect(await ctx.cookies(),
        'the counterparty context is not clean — it carries cookies').toEqual([]);

      await sp.goto(`${BASE}/sign/${mine.token}`);
      await expect(sp.getByText(`Sign: ${doc.title}`).first(),
        `the signing link for document ${docNo} signer ${order} did not open the ` +
        'signing page. A link that only works while the sender is logged in is a defect.')
        .toBeVisible({ timeout: 60_000 });

      await expect(sp.getByText(planned.name).first(),
        'the signing page does not greet the signer by name').toBeVisible();

      // ⚠ THE DOCUMENT IS NOT HANDED OVER BEFORE VERIFICATION. `get_signing_page`
      // returns `file_url: null` until the signer is OTP-verified, because a
      // signing token travels through mail relays, forwarded threads and
      // corporate archives — the token alone used to be enough to read the
      // contract while the OTP gated only the signature.
      await expect(sp.getByRole('link', { name: /View document \(PDF\)/ }),
        'the unverified signing page hands over a link to the contract. The token ' +
        'alone must not be enough to READ the document — that is what the OTP is for.')
        .toHaveCount(0);

      // The signer must not see their own address in full, and must never see a
      // UUID.
      await assertNoRenderedId(sp.locator('.pub'), `the public signing page for ${docNo}/${order}`);

      // ── OTP: request it, and prove it left ─────────────────────────────
      con.at('otp-send');
      const priorOtpMail = countPurpose(await outboundFor(page, planned.email), 'signing_otp');
      const sent = await saveAndWait(sp,
        () => sp.getByRole('button', { name: 'Send verification code' }).click(),
        /\/v1\/esign\/verify\/[^/]+\/otp\/send$/, `requesting the OTP for ${docNo}/${order}`);
      expect(sent?.sent, 'the OTP request did not answer sent:true').toBe(true);
      expect(String(sent?.email || ''),
        'the OTP response returned the signer\'s FULL address. Both public ' +
        'endpoints mask it, and one masking and one not is decoration.')
        .toMatch(/\*/);

      // ⚠ RECORDED, NOT ASSERTED HERE — and 15.08b is where it fails.
      //
      // Measured on the first full run: the code IS emailed and `outbound_log`
      // DOES get a row, but that row carries `org_id = NULL`, so the firm's own
      // "did this person get their code?" lookup can never see it. Asserting it
      // inside this journey aborted the journey and took the four signatures,
      // the completion and the executed PDF with it — which is the exact reason
      // Suite 05 splits its known failures into tests of their own. The finding
      // gets its own red test; the journey carries on.
      const nowOtpMail = countPurpose(await outboundFor(page, planned.email), 'signing_otp');
      if (nowOtpMail !== priorOtpMail + 1) {
        bump((st) => st.otpGaps.push(
          { email: planned.email, visible: nowOtpMail, before: priorOtpMail }));
      }

      // The OPEN is recorded here, on the POST, and not on the GET — corporate
      // mail scanners follow every link in every message before a human does,
      // and an audit row saying a signer opened a contract at a scanner's IP is
      // evidence that is wrong.
      const opened = await record(page, id);
      const meNow = opened.signers.find((s: any) => Number(s.sign_order) === order);
      expect(String(meNow?.status),
        'requesting the code did not move the signer to "opened"').toBe('opened');
      expect(opened.audit_trail.map((a: any) => a.action),
        'requesting the code wrote no link_opened audit row').toContain('link_opened');
      expect(opened.audit_trail.map((a: any) => a.action),
        'requesting the code wrote no otp_sent audit row').toContain('otp_sent');

      // ── Verify ────────────────────────────────────────────────────────
      con.at('otp-verify');
      const code = latestOtp(mine.signer_id);
      const otpBox = sp.locator('#sgn-otp');
      await expect(otpBox, 'the verification step has no code field').toBeVisible();
      await otpBox.fill(code);
      await saveAndWait(sp,
        () => sp.getByRole('button', { name: 'Verify' }).click(),
        /\/v1\/esign\/verify\/[^/]+\/otp\/verify$/, `verifying the OTP for ${docNo}/${order}`);

      // AND NOW the document is handed over — the page re-fetches on purpose.
      await expect(sp.getByRole('link', { name: /View document \(PDF\)/ }).first(),
        'after verifying, the signer still has no way to open the document they ' +
        'are about to sign')
        .toBeVisible({ timeout: 45_000 });

      // ── Sign ──────────────────────────────────────────────────────────
      con.at('sign');
      const mode = sp.getByRole('group', { name: 'Signature method' });
      await expect(mode, 'the signing step offers no choice of signature method').toBeVisible();
      await expect(mode.getByRole('button', { name: 'Type signature' })).toBeVisible();
      await expect(mode.getByRole('button', { name: 'Draw signature' })).toBeVisible();
      await mode.getByRole('button', { name: 'Type signature' }).click();

      const nameBox = sp.locator('#sgn-name');
      await expect(nameBox, 'the typed-signature step has no name field').toBeVisible();
      await nameBox.fill(planned.name);
      await expect(sp.locator('.sg__preview-ink'),
        'the typed signature is not previewed as ink').toHaveText(planned.name);

      await expect(sp.getByText(/IT Act, 2000/),
        'the signing button carries no statement of what signing means').toBeVisible();

      const signed = await saveAndWait(sp,
        () => sp.getByRole('button', { name: 'Sign document' }).click(),
        /\/v1\/esign\/verify\/[^/]+\/sign$/, `signing ${docNo} as signer ${order}`);
      expect(signed?.signed, 'the signature was not accepted').toBe(true);
      bump((st) => { st.typed.signatures++; });

      await expect(sp.getByText('Document signed'),
        'the signer was given no confirmation that the signature landed. It is a ' +
        'legally binding act and the only confirmation they ever receive.')
        .toBeVisible({ timeout: 30_000 });
      await expect(sp.locator('.sg__done'))
        .toContainText(`${signed.signers_completed}/${signed.signers_total}`);

      assertNoUncaught(con);
      console.log(`  15.08 ${docNo}/${order} signed — ${signed.signers_completed}/${signed.signers_total}` +
        `, document is now ${signed.document_status}`);
      console.log(`  15.08 ${docNo}/${order} non-2xx:${dumpFailures(fail)}`);
    } finally {
      await ctx.close();
    }
  }

  // §4 — four signatures, completing two documents.
  await signAs(browser, '01', 1);
  await signAs(browser, '01', 2);
  await signAs(browser, '02', 1);
  await signAs(browser, '02', 2);

  for (const no of ['01', '02']) {
    const rec = await record(page, String(docs.get(no)!.id));
    expect(rec.document.status,
      `document ${no} has every signature and is still "${rec.document.status}"`)
      .toBe('completed');
    expect(Number(rec.document.signers_completed),
      `document ${no}'s completed counter did not reach its total`)
      .toBe(Number(rec.document.signers_total));
    expect(rec.audit_trail.map((a: any) => a.action),
      `document ${no} completed without a document_completed audit row`)
      .toContain('document_completed');
    expect(rec.signers.every((s: any) => s.status === 'signed'),
      `document ${no} is complete but not every signer row says signed`).toBe(true);
  }

  const T = readShared().typed;
  console.log(`  15.08 §6 idempotence — signatures: ${T.signatures} typed, ${T.signaturesFound} already present`);
});

test('15.08b the signing OTP leaves the building with NO ORGANISATION on it', async ({ page }) => {
  test.setTimeout(15 * 60_000);
  await signIn(page);

  // ⚠ THE FINDING, and it is a live one rather than a reading of the source.
  //
  // `POST /verify/{token}/otp/send` is a PUBLIC endpoint — no auth, no
  // `get_org_id` dependency — so the ContextVar `outbound.begin()` reads the
  // org from is unset when it calls `send_email(purpose="signing_otp")`. The
  // message is genuinely sent. The `outbound_log` row is genuinely written. It
  // carries `org_id = NULL`, and `email_service` names that outcome by hand:
  // "a send from this function with neither is an outbound row no org can ever
  // see". Every org-scoped read of that table is `WHERE org_id = $1::uuid`
  // (`routers/billing.py`), and `/me/outbound/messages` reports
  // `excludes_orgless: true` in its own body.
  //
  // So the customer-visible consequence is precise: a firm whose client says
  // "I never got a code" opens the one screen that answers that question per
  // address and is told nothing was ever sent. The identity-verification
  // message — the limb of the IT Act §10A claim that ties the signature to the
  // signatory — is the ONE eSign message with no tenant on it.
  // `signature_request` and `signature_reminder` both carry the org, because
  // both are sent from authenticated routes.
  //
  // ⚠ AND THIS TEST WAS VACUOUS ON A RE-RUN, AND PASSED WHILE BEING SO.
  //
  // Its first version asserted over gaps 15.08 collected WHILE SIGNING. On the
  // second execution every signer is already signed, 15.08 requests no code,
  // the gap list is legitimately empty — and this reported GREEN having
  // measured nothing at all, on a defect that had not moved. Caught by running
  // the suite a third time. A test that cannot fail is decoration.
  //
  // So it measures the LEDGER rather than this run's activity: every
  // `signing_otp` row `staging.outbound_log` holds for one of this suite's ten
  // signer addresses, against what the org's own screen can see of them.
  const dbRows: { email: string; org_id: string | null; status: string; ts: string }[] = [];
  const invisible: string[] = [];
  const seen: string[] = [];

  for (const doc of DOCS) {
    for (const s of doc.signers) {
      const rows = inbox('otplog', s.email) as any[];
      for (const r of rows) {
        dbRows.push({ email: s.email, org_id: r.org_id, status: r.status, ts: r.ts });
      }
      if (!rows.length) continue;
      const visible = countPurpose(await outboundFor(page, s.email), 'signing_otp');
      const nulls = rows.filter((r) => r.org_id === null).length;
      seen.push(`${s.email}: ${rows.length} signing_otp row(s) in outbound_log, `
        + `${nulls} with org_id=NULL; the org's own screen shows ${visible}`);
      if (visible < rows.length) {
        invisible.push(`${s.email} (${rows.length} logged, ${visible} visible)`);
      }
    }
  }

  // NON-VACUOUS BY CONSTRUCTION. 15.08 collects four signatures and every one
  // of them needed a code, so by the time this runs there MUST be OTP rows on
  // record. If there are none, the ledger is not saying "all is well" — it is
  // saying this check has nothing to stand on, and that is a failure too.
  expect(dbRows.length,
    'staging.outbound_log holds no signing_otp row for ANY of the ten signers, '
    + 'yet 15.08 collected four signatures and each one required a code. Either '
    + 'the codes are not being logged at all, or this check is measuring the '
    + 'wrong thing — it must never pass by having nothing to look at.')
    .toBeGreaterThan(0);

  const orgless = dbRows.filter((r) => r.org_id === null);

  expect(orgless.length,
    '\n  ⚠ THE ONE-TIME CODE LEAVES THE BUILDING WITH NO ORGANISATION ON IT.\n'
    + `     ${orgless.length} of ${dbRows.length} signing_otp rows carry org_id = NULL.\n`
    + (invisible.length
      ? `     Invisible to the firm's own screen: ${invisible.join(', ')}\n`
      : '')
    + '     Measured directly against staging.outbound_log:\n'
    + seen.map((x) => '       ' + x).join('\n')
    + '\n     The mail IS sent and the row IS written; it carries no tenant, so\n'
    + '     every org-scoped read (`WHERE org_id = $1::uuid`) misses it, and\n'
    + '     /api/v1/billing/me/outbound/messages — which reports\n'
    + '     excludes_orgless=true — answers "nothing was sent" to a firm whose\n'
    + '     client is asking where their code is. `signature_request` and\n'
    + '     `signature_reminder` carry the org correctly; both are sent from\n'
    + '     authenticated routes and this one is public.\n'
    + '     FIXED IN THE WORKING TREE, NOT DEPLOYED: `backend/routers/esign.py`\n'
    + '     `send_otp` now wraps the send in `outbound.org_scope(d.org_id)`,\n'
    + '     proved by `backend/tests/test_esign_otp_outbound_org.py`, which goes\n'
    + '     red when the scope is removed. An agent cannot deploy, so this stays\n'
    + '     RED against staging until the lead ships it — and the rows above are\n'
    + '     historical, so it stays red for those even after the deploy.\n'
    + '     PRODUCT DEFECT · ACTIVE · telemetry only — no message was lost.\n')
    .toBe(0);
});

test('15.09 a signer declines, and the document does not move', async ({ page, browser }) => {
  test.setTimeout(15 * 60_000);
  await signIn(page);
  const docs = await myDocs(page);
  const doc = DOCS.find((d) => d.no === '05')!;
  const id = String(docs.get('05')!.id);

  const links = signingLinks(id);
  const mine = links[0];

  if (mine.status === 'declined') {
    bump((st) => { st.typed.declinesFound++; });
    console.log('  15.09 document 05\'s signer has already declined — verified, not re-declined');
  } else {
    const ctx = await browser.newContext();
    const sp = await ctx.newPage();
    try {
      await sp.goto(`${BASE}/sign/${mine.token}`);
      const decline = sp.getByRole('button', { name: 'Decline' });
      await expect(decline,
        'the signing page offers no way to refuse. A signature surface that can ' +
        'only say yes is not a signature surface.').toBeVisible({ timeout: 60_000 });
      await decline.click();

      const dialog = sp.locator('[role="alertdialog"]');
      await expect(dialog, 'declining is not confirmed').toBeVisible({ timeout: 15_000 });
      const confirm = dialog.getByRole('button', { name: /Decline/ });
      await saveAndWait(sp, () => confirm.click(),
        /\/v1\/esign\/verify\/[^/]+\/decline$/, 'declining document 05');
      bump((st) => { st.typed.declines++; });

      await expect(sp.getByText('Signing declined'),
        'the signer got no confirmation that the refusal was recorded')
        .toBeVisible({ timeout: 30_000 });
    } finally {
      await ctx.close();
    }
  }

  const rec = await record(page, id);
  const signer = rec.signers[0];
  expect(String(signer.status), 'the decline did not move the signer row').toBe('declined');
  expect(rec.audit_trail.map((a: any) => a.action),
    'the decline wrote no signature_declined audit row').toContain('signature_declined');

  // The sender's screen must at least SHOW it, even though the document has
  // not moved.
  const detail = await openDoc(page, doc.title);
  await expect(detail.locator('.docsg__r').first().locator('.k-statuschip'),
    'the sender\'s screen does not show that this signer declined').toContainText('Declined');
  await expect(detail.locator('.docsg__r').first().getByRole('button', { name: 'Remind' }),
    'a declined signer is still offered a reminder').toHaveCount(0);

  // ⚠ THE FINDING. `decline_signing` touches the signer row only.
  expect(String(rec.document.status),
    'the document status changed on a decline — if this is now a real transition, ' +
    'this assertion is the thing standing in the way and must be rewritten')
    .toBe('sent');
  note(
    'A DECLINE DOES NOT MOVE THE DOCUMENT. `decline_signing` writes ' +
    '`sign_signers.status=\'declined\'` and leaves `sign_documents.status` alone, ' +
    'so document 05 — whose ONLY signer has refused — still reads "Sent" on the ' +
    'register, can never reach `completed` (signers_completed never catches ' +
    'signers_total), and offers no control that acknowledges the refusal. The ' +
    'signer pill on the detail screen is the only surface that says it. PRODUCT ' +
    'GAP · ACTIVE — a firm reading its own register cannot tell a dead document ' +
    'from a live one.');
});

test('15.10 the signed PDF actually downloads — bytes, not a 200 with an empty body', async ({ page }) => {
  test.setTimeout(20 * 60_000);
  const con = watchConsole(page);
  await signIn(page);
  const docs = await myDocs(page);

  for (const no of ['01', '02']) {
    con.at(`signed:${no}`);
    const doc = DOCS.find((d) => d.no === no)!;
    const id = String(docs.get(no)!.id);
    let rec = await record(page, id);
    expect(rec.document.status, `document ${no} is not completed`).toBe('completed');

    const detail = await openDoc(page, doc.title);

    // Completion generates the artefacts best-effort — `_generate_completion_
    // artefacts` swallows and logs so a WeasyPrint outage cannot turn a valid
    // signature into a 500. When it did not run, the screen offers the recovery
    // path by name, and this drives it rather than reporting a dead end.
    if (!rec.document.signed_file_url) {
      const assemble = detail.getByRole('button', { name: /Assemble signed document/ });
      await expect(assemble,
        `document ${no} is completed, has no executed copy, and offers no way to ` +
        'assemble one. Everything needed is on record, so a dead end here is the ' +
        'one thing a signing product must not do.').toBeVisible();
      await saveAndWait(page, () => assemble.click(),
        /\/v1\/esign\/documents\/[^/]+\/rebuild$/, `assembling the signed copy of ${no}`);
      await settle(page);
      rec = await record(page, id);
      note(`document ${no}'s executed copy was NOT produced at completion and had to ` +
        'be assembled from the detail screen. `_generate_completion_artefacts` ' +
        'swallows its own failure by design, so the Railway log is the only place ' +
        'the reason exists.');
    }

    expect(String(rec.document.signed_file_url || ''),
      `document ${no} is completed and carries no signed_file_url`).toBeTruthy();
    expect(String(rec.document.signed_file_hash || ''),
      `document ${no}'s executed copy has no SHA-256`).toMatch(/^[0-9a-f]{64}$/);

    // ── THE BYTES. §1's named failure is "a 200 with an empty body". ────────
    const link = detail.getByRole('link', { name: /Signed document \(PDF\)/ });
    await expect(link,
      `document ${no} is completed with an executed copy and the screen offers no ` +
      'way to download it').toBeVisible();
    const href = await link.getAttribute('href');
    const buf = await artefact(page, String(href), `document ${no}'s executed PDF`);
    assertPdf(buf, `document ${no}'s executed PDF`);
    fs.writeFileSync(path.join(OUT, `signed-${no}.pdf`), buf);

    // ⚠ AND IT MUST BE THE DOCUMENT, not just a signature page. `build_signed_
    // pdf` appends the original; `rebuild` reports `appended_original` for
    // exactly this reason. Original pages + at least one signature page.
    expect(pdfPages(buf),
      `document ${no}'s executed copy reads as ${pdfPages(buf)} pages. The ` +
      `original was ${doc.pages}, so the executed copy must carry those plus a ` +
      'signature page — anything fewer means the original was NOT bound in and ' +
      'the download is the signature record alone, which is a different artefact ' +
      'wearing the same button. (A 0 here would instead mean the writer emitted a ' +
      'compressed page tree and the count is unreadable from the bytes — a ' +
      'different failure, and it is named so the two are not confused.)')
      .toBeGreaterThan(doc.pages);

    // ⚠ The TEXT of the executed copy is deliberately NOT asserted. WeasyPrint
    // subsets its fonts and may write the signatory names through a custom
    // encoding, so `buf.includes('Joshi')` is a coin toss that would go red on
    // a perfectly correct PDF — a defect in the test, not in the product. Who
    // signed is asserted against the audit certificate below, which is JSON.

    // The audit certificate is the OTHER artefact and must not be confused with
    // the document — it is evidence ABOUT it.
    const cert = detail.getByRole('link', { name: /Audit certificate \(JSON\)/ });
    await expect(cert,
      `document ${no} is completed and offers no audit certificate`).toBeVisible();
    const certBuf = await artefact(page, String(await cert.getAttribute('href')),
      `document ${no}'s audit certificate`);
    const parsed = JSON.parse(certBuf.toString('utf8'));
    expect(parsed.signers?.length,
      `document ${no}'s certificate lists ${parsed.signers?.length} signatories`)
      .toBe(doc.signers.length);
    expect(parsed.signers.every((s: any) => s.otp_verified === true),
      `document ${no}'s certificate shows a signatory who was never OTP-verified — ` +
      'that is the limb of the IT Act §10A claim that links the signature to the ' +
      'signatory').toBe(true);
    expect(String(parsed.original_file_hash || ''),
      `document ${no}'s certificate carries no hash of the document that was signed`)
      .toMatch(/^[0-9a-f]{64}$/);
    expect(Array.isArray(parsed.audit_trail) && parsed.audit_trail.length,
      `document ${no}'s certificate carries an empty audit trail`).toBeTruthy();
  }

  assertNoUncaught(con);
});

test('15.11 every eSign route has a control, and every control a route', async ({ page }) => {
  await signIn(page);

  // ── The DEPLOYED surface, not the source tree ────────────────────────────
  const spec = await (await page.request.get(`${API}/openapi.json`)).json();
  const routes = Object.keys(spec.paths || {})
    .filter((p) => p.startsWith('/api/v1/esign/'))
    .flatMap((p) => Object.keys(spec.paths[p])
      .filter((m) => ['get', 'post', 'put', 'patch', 'delete'].includes(m))
      .map((m) => `${m.toUpperCase()} ${p}`))
    .sort();

  /**
   * Every deployed eSign operation, and the control that reaches it.
   *
   * ⚠ THE DOMINANT DEFECT CLASS: a route exists, is deployed, works — and no
   * screen calls it. 67 of the deployed 958 operations are genuinely orphaned
   * (`docs/plans/93-E-ORPHANED-CAPABILITY-SWEEP.md`). Void and Remind are
   * exactly the shape that hides it, so both are named here and both are driven
   * by 15.06 and 15.07.
   */
  const MATRIX: Record<string, string> = {
    'GET /api/v1/esign/documents': 'DocumentsTab — the register, and its six filter chips (15.01)',
    'POST /api/v1/esign/documents': 'CreateTab — "Create document", request 1 of 2 (15.02)',
    'POST /api/v1/esign/documents/{doc_id}/upload': 'CreateTab — "Create document", request 2 of 2 (15.02)',
    'GET /api/v1/esign/documents/{doc_id}': 'DetailTab — opening a row (15.03)',
    'POST /api/v1/esign/documents/{doc_id}/send': 'DetailTab — "Send for signing" (15.05)',
    'POST /api/v1/esign/documents/{doc_id}/resend/{signer_id}': 'DetailTab — per-signer "Remind" (15.06)',
    'POST /api/v1/esign/documents/{doc_id}/cancel': 'DetailTab — "Cancel document" + confirm (15.07)',
    'POST /api/v1/esign/documents/{doc_id}/rebuild': 'DetailTab — "Assemble signed document" (15.10)',
    'GET /api/v1/esign/verify/{token}': 'SigningPage — loading /sign/:token (15.08)',
    'POST /api/v1/esign/verify/{token}/otp/send': 'SigningPage — "Send verification code" (15.08)',
    'POST /api/v1/esign/verify/{token}/otp/verify': 'SigningPage — "Verify" (15.08)',
    'POST /api/v1/esign/verify/{token}/sign': 'SigningPage — "Sign document" (15.08)',
    'POST /api/v1/esign/verify/{token}/decline': 'SigningPage — "Decline" + confirm (15.09)',
    'GET /api/v1/esign/documents/{doc_id}/audit': 'ORPHANED · SUPERSEDED — no caller. DetailTab takes audit_trail off GET /documents/{id}',
  };

  const unmapped = routes.filter((r) => !(r in MATRIX));
  expect(unmapped,
    'the deployed service carries eSign route(s) this matrix does not account ' +
    'for. Every one is either reached by a control or is an ORPHAN, and an ' +
    'unlisted route is an unmeasured one:\n     ' + unmapped.join('\n     '))
    .toEqual([]);

  const missing = Object.keys(MATRIX).filter((r) => !routes.includes(r));
  expect(missing,
    'this matrix names route(s) the deployed service does not have. A control ' +
    'that calls one of these is a dead control:\n     ' + missing.join('\n     '))
    .toEqual([]);

  console.log(`  15.11 ${routes.length} deployed eSign operations, all accounted for:`);
  for (const r of routes) console.log(`         ${r}  →  ${MATRIX[r]}`);

  // ── The one orphan, exercised so it is measured rather than assumed ──────
  const docs = await myDocs(page);
  const id = String(docs.get('01')!.id);
  const orphan = await apiOne(page, `/api/v1/esign/documents/${id}/audit`);
  expect(Array.isArray(orphan?.audit_trail) && orphan.audit_trail.length,
    'GET /documents/{id}/audit is deployed and answers an empty trail for a ' +
    'document that has been created, uploaded, sent and signed').toBeTruthy();
  note(
    `GET /v1/esign/documents/{id}/audit is ORPHANED and LIVE — it answered with ` +
    `${orphan.audit_trail.length} audit rows and has no caller anywhere in the ` +
    'product (DetailTab takes `audit_trail` off GET /documents/{id}). Recorded, ' +
    'not fixed: it is superseded rather than missing, and the sweep already ' +
    'classes it that way.');

  // ── The register's own ceiling ───────────────────────────────────────────
  // `list_documents` ends `ORDER BY created_at DESC LIMIT 50` with no offset,
  // no cursor and no total, and `DocumentsTab` renders exactly what it is
  // given. §10 rule 4 warns lists cap at 200; this one caps at 50.
  const all = await apiRows(page, '/api/v1/esign/documents');
  expect(all.length,
    'the register returned more than 50 rows, so the LIMIT has changed and this ' +
    'finding needs re-measuring').toBeLessThanOrEqual(50);
  note(
    `THE REGISTER IS CAPPED AT 50 WITH NO PAGINATION. GET /v1/esign/documents ` +
    `ends "ORDER BY created_at DESC LIMIT 50" — no offset, no cursor, no total — ` +
    `and DocumentsTab renders exactly that (${all.length} rows today). A firm ` +
    'past fifty documents cannot reach the fifty-first from any screen, and the ' +
    'status filters narrow the same capped window rather than paging it. ' +
    'PRODUCT GAP · LATENT until this org holds 51 documents.');

  // ── Cross-tenant: a document id this org does not own must be 404 ────────
  const foreign = await apiGet(page, '/api/v1/esign/documents/00000000-0000-4000-8000-000000000000');
  expect([404, 422]).toContain(foreign.status());

  // ── WEB ONLY — §10's last four words, at HEAD ────────────────────────────
  //
  // The live proof is Suite 21's ("eSign absence · 2 checks") and this does NOT
  // stand in for driving the AVD. It is the cheap source half, and it is
  // written against the API SURFACE rather than against the word: `mobile/src`
  // mentions eSign in four comments and in its own guard test
  // (`nav/__tests__/destinations.test.ts:126`, "eSign is NOT a destination on
  // this platform"), so a grep for the word would go red on the very file that
  // enforces the rule. What must be zero is a CALL.
  const mobileSrc = path.join(REPO, 'mobile', 'src');
  expect(fs.existsSync(mobileSrc), 'mobile/src is not where this expects it').toBeTruthy();
  const callers: string[] = [];
  const destinations: string[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { walk(full); continue; }
      if (!/\.(ts|tsx|js|jsx)$/.test(e.name)) continue;
      if (/__tests__/.test(full)) continue;
      const body = fs.readFileSync(full, 'utf8');
      if (/\/v1\/esign|esign\/documents/.test(body)) callers.push(path.relative(REPO, full));
      // A destination is a `{ key, en, hi }` row in the nav registry. `sign`
      // or `हस्ताक्षर` appearing there is the thing the owner ruled out.
      if (/nav[\\/]destinations\.ts$/.test(full)
        && /key:\s*['"]e?sign['"]|hi:\s*['"]हस्ताक्षर['"]/.test(body)) {
        destinations.push(path.relative(REPO, full));
      }
    }
  };
  walk(mobileSrc);
  expect(callers,
    'the mobile app CALLS an eSign endpoint. §10: "Web only — never a mobile ' +
    'destination", and mobile invoices are read-only for the same reason:\n     ' +
    callers.join('\n     ')).toEqual([]);
  expect(destinations,
    'eSign is back in the mobile destination registry. Owner, 2026-08-07: it ' +
    'stays on the web page:\n     ' + destinations.join('\n     ')).toEqual([]);
  console.log('  15.11 mobile/src calls no eSign endpoint and declares no eSign destination ' +
    '(source assertion at HEAD; the live AVD check is Suite 21)');
});

test('15.12 the §4 volume sheet, as live counts', async ({ page }) => {
  await signIn(page);
  const docs = await myDocs(page);

  let signers = 0;
  let signed = 0;
  let voided = 0;
  let completed = 0;
  let declined = 0;
  let storedFields = 0;
  for (const doc of DOCS) {
    const row = docs.get(doc.no);
    if (!row) continue;
    const rec = await record(page, String(row.id));
    signers += rec.signers.length;
    signed += rec.signers.filter((s: any) => s.status === 'signed').length;
    declined += rec.signers.filter((s: any) => s.status === 'declined').length;
    if (rec.document.status === 'cancelled') voided++;
    if (rec.document.status === 'completed') completed++;
    storedFields += Number((inbox('fields', String(row.id))[0] || {}).n || 0);
  }

  const placed = DOCS.reduce((n, d) => n + d.fields.length, 0);

  const sheet: [string, number, number, string][] = [
    ['eSign documents', docs.size, N_DOCUMENTS, ''],
    ['fields PLACED through the UI', placed, N_FIELDS, ''],
    ['fields STORED by the server', storedFields, N_FIELDS,
      '⚠ 0 — the deployed DocumentCreate has no `fields` member and staging.sign_fields has no writer. See 15.04.'],
    ['signers', signers, N_SIGNERS, ''],
    ['signed', signed, N_SIGNED, ''],
    ['voided', voided, N_VOIDED, ''],
  ];

  console.log('\n  ═══ SUITE 15 · §4 VOLUMES, LIVE ═══');
  for (const [what, got, want, why] of sheet) {
    console.log(`   ${got === want ? '✓' : '✗'} ${what.padEnd(30)} ${String(got).padStart(3)} / ${want}${why ? '   ' + why : ''}`);
  }
  const shared = readShared();
  const T = shared.typed;
  console.log(`     documents completed: ${completed} · signers declined: ${declined}`);
  console.log('\n  ═══ §6 IDEMPOTENCE — this run ═══');
  console.log(`     documents  : ${T.documents} typed, ${T.documentsFound} already present`);
  console.log(`     signers    : ${T.signers} typed, ${T.signersFound} already present`);
  console.log(`     fields     : ${T.fieldsPlaced} placed, ${T.fieldsFound} already present`);
  console.log(`     sends      : ${T.sent} typed, ${T.sentFound} already present`);
  console.log(`     signatures : ${T.signatures} typed, ${T.signaturesFound} already present`);
  console.log(`     voids      : ${T.voided} typed, ${T.voidedFound} already present`);
  console.log(`     declines   : ${T.declines} typed, ${T.declinesFound} already present`);
  console.log(`     reminders  : ${T.reminders} sent this run (a reminder is not idempotent by nature)`);
  console.log('\n  ═══ FINDINGS ═══');
  for (const f of shared.findings) console.log(`     · ${f}`);
  console.log(
    '\n  ═══ NOT BUILT, so nothing here asserts it ═══\n' +
    '     · No bounce webhook and no `bounced` status. services/outbound_log.py\'s\n' +
    '       vocabulary is queued · sent · suppressed · failed, and nothing in this\n' +
    '       product ever hears back from a mailbox. Delivery is NOT proved by any\n' +
    '       assertion in this suite — only that a message left.\n' +
    '     · No WhatsApp delivery. The Send card states "Deliver by: Email" as a\n' +
    '       fact rather than offering a toggle that would do nothing.\n' +
    '     · No scheduled reminders. Reminders are manual, per signer, and the card\n' +
    '       says so. /cron/esign is a 501 stub and is NEVER armed.\n' +
    '     · No PDF renderer. The placement stage is a page-shaped guide, so a\n' +
    '       field is placed against a percentage of a page nobody can see.\n');

  // The sheet is the deliverable, and a line it cannot meet is not quietly
  // dropped — that is the silent cap §10 warns about.
  expect(docs.size, `§4 asks for ${N_DOCUMENTS} documents; the register holds ${docs.size}`)
    .toBe(N_DOCUMENTS);
  expect(placed, `§4 asks for ${N_FIELDS} placed fields; this suite places ${placed}`).toBe(N_FIELDS);
  expect(signers, `§4 asks for ${N_SIGNERS} signers; the documents carry ${signers}`).toBe(N_SIGNERS);
  expect(signed, `§4 asks for ${N_SIGNED} signatures; ${signed} have been collected`).toBe(N_SIGNED);
  expect(voided, `§4 asks for ${N_VOIDED} voided document; ${voided} are cancelled`).toBe(N_VOIDED);
  expect(completed, 'the four signatures must complete exactly two documents').toBe(2);

  // ⚠ AND THE LINE §4 CANNOT MEET, stated as a failure rather than omitted.
  expect(storedFields,
    `§4 asks for ${N_FIELDS} FIELDS PLACED. ${placed} were placed through the real ` +
    `stage, for the real signers, on pages 1 to 6 — and ${storedFields} were stored. ` +
    'staging.sign_fields exists (migration 114, applied — verified live) and has no ' +
    'writer: the deployed `routers__esign__DocumentCreate` carries no `fields` member, ' +
    'and Pydantic v2 drops unknown members without complaint. CreateTab already ' +
    'detects this and warns the person, so the screen is honest; the gap is the ' +
    'router. This assertion is RED on purpose — a volume sheet that quietly drops ' +
    'the line it cannot meet is the silent cap §10 warns about.').toBe(N_FIELDS);
});
