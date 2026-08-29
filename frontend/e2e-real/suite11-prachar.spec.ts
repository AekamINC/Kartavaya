/**
 * Proposal 93 · Stage 3 · WAVE 4 · SUITE 11 — Prachar (marketing), on Unicode
 * Group.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE LANE
 * ═══════════════════════════════════════════════════════════════════════════
 * `lane('unicode')` and nothing else. `signIn()` below calls `assertOrg()`
 * before any test may write, and `assertOrg()` asserts the org **ID** the
 * SERVER resolved — never a name on screen, because the name is exactly what
 * got corrupted when a platform credential renamed Aekam Inc on 2026-08-28.
 * See the header of `_lanes.ts`. No platform/god-mode credential appears here.
 *
 * Measured 2026-08-29 before a line of this file ran, with
 * `Authorization: E2E_UNICODE_TOKEN` and `X-Org-Id: fae87907…`:
 *
 *     GET /api/v1/org/profile                200  Unicode Group, state_code 24
 *     GET /api/v1/prachar/dashboard          200  campaigns.total 0
 *     templates · campaigns · sequences · events · unsubscribes · automations
 *     · compliance/classes · audience/options            ALL 200
 *     staging.prachar_templates      (Unicode)  0 rows
 *     staging.prachar_campaigns      (Unicode)  0 rows
 *     staging.prachar_sequences      (Unicode)  0 rows
 *     staging.prachar_events         (Unicode)  0 rows
 *     staging.prachar_unsubscribes   (Unicode)  0 rows
 *     staging.prachar_campaign_contacts          0 rows  (every org)
 *     staging.prachar_sequence_enrollments       0 rows  (every org)
 *     staging.prachar_event_registrations        0 rows  (every org)
 *     staging.prachar_send_evidence              0 rows  (every org)
 *
 * So every empty state 11.1 asserts is asserted over a genuinely empty module,
 * and every count afterwards is a count this suite produced.
 *
 * DEPLOYED SHA, checked rather than assumed (CLAUDE.md's rule), and it MOVED
 * under this file mid-run, which is why both are named:
 *
 *   at authoring   deployment `e76030e0`, SUCCESS 2026-08-29T07:53:24Z,
 *                  commit `1c749a45`, branch `staging` — also the local HEAD
 *   at the second run
 *                  deployment `0684ad8b`, SUCCESS 2026-08-29T08:46:31Z,
 *                  commit `88229cc3` (Suite 10's fixes), branch `staging`
 *
 * NEITHER carries the `_ts` fix this suite found — see §BLOCKED below. The
 * backend still exposes no route returning its own SHA (`/api/version`,
 * `/api/meta`, `/api/_meta` all 404), so the Railway deployment record is the
 * whole of the available evidence and it is named here rather than glossed.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * §BLOCKED — FIVE OF THESE THIRTEEN TESTS CANNOT RUN ON THE DEPLOYED BUILD
 * ═══════════════════════════════════════════════════════════════════════════
 * `POST /v1/prachar/campaigns` and `POST /v1/prachar/events` both bind a `str`
 * into a `::timestamptz` and 500 before Postgres sees the statement. Measured
 * from the Railway deploy log on deployment `e76030e0`, 2026-08-29T08:23:51Z:
 *
 *     File "/app/routers/prachar.py", line 607, in create_campaign
 *     asyncpg.exceptions.DataError: invalid input for query argument $8:
 *       '2026-08-30T08:00:00.000Z' (expected a datetime.date or
 *       datetime.datetime instance, got 'str')
 *
 * The browser sees `net::ERR_FAILED` because the 500 escapes before the CORS
 * headers. Fixed in the working tree (`routers/prachar.py::_ts`, four call
 * sites) with `tests/test_prachar_temporal_binds_live_sql.py` beside it, three
 * mutations proved to bite — but an agent may not commit, so it is not on
 * staging and **11.5, 11.6, 11.7, 11.9 and 11.10 are red pending that deploy.**
 * 11.1–11.4, 11.8 and 11.11–11.13 are green on two consecutive full runs.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⚠⚠ THE OUTBOUND GATE — THIS IS THE ONE SUITE THAT MAILS PEOPLE
 * ═══════════════════════════════════════════════════════════════════════════
 * Measured on the deployed process, 2026-08-29, immediately before this file
 * was written:
 *
 *     GET /api/health -> {"outbound_mode":"live","suppressed_orgs_digest":"0"}
 *
 * The mode is LIVE and **no organisation is shielded**. There is no dry-run
 * guard between this suite and AWS SES. `assertOutboundFenceFor()` in
 * `_helpers.ts` would FAIL on that state, correctly, and it is deliberately not
 * used here: this suite is meant to deliver. What stands in its place is a
 * harder gate, applied per send, and it is `gateAudience()` below.
 *
 * ── WHY THIS SUITE BUILDS ITS OWN RECIPIENTS ────────────────────────────────
 * Unicode Group holds 53 CRM contacts and **every single one is
 * `s04.contactNN@example.com`** — measured, all 53, zero exceptions. That is
 * Suite 04's output and it is fine as DATA. It is not fine as a MAILING LIST:
 * `example.com` publishes a null MX and hard-bounces by definition, so seven
 * campaigns over that list is ~144 hard bounces on the SES account that sends
 * this firm's real invoices. Proposal §3 sized that exact hazard — "176 rows
 * mailed would be a 45% bounce rate against AWS's 5% review line and 10%
 * suspension line" — and designed it out by replacing `@example.com` with the
 * mailbox simulator. The last four days of `staging.outbound_log` already carry
 * 12 `@example.com` sends against 64 deliverable ones; adding 144 more would
 * take the account past both lines in one night.
 *
 * So 11.2 types a reach list of its own, through the real Graha forms, on §3
 * addressing, and **every campaign in this file is filtered to that list**.
 * The pre-existing 53 are never mailed and never previewed into a sendable
 * audience.
 *
 * ── HOW §3's MIX IS APPLIED, AND WHERE IT IS DELIBERATELY NOT ───────────────
 * §3 asks for 5% `test+…@unicodegroup.com` · 20% `kevalvshah03+` · 30%
 * `kelisweet+` · 45% simulator. This file uses **20 simulator + 4 gmail tags**
 * and NO `unicodegroup.com`. Two departures, both stated rather than silent:
 *
 *   · **The unicodegroup plus-tag slice is dropped entirely.** The R4b probe
 *     BOUNCED (`STATUS.md`, 2026-08-28: "SES accepted all three probe messages,
 *     then reported attempts=2, bounces=1 … §3's ~550
 *     `test+<tag>@unicodegroup.com` recipients must not be seeded until the
 *     mailbox says which", OWNER-ACTIONS 15). That is an open owner action, so
 *     seeding into it here would be seeding on an assumption §3 itself forbids.
 *   · **The gmail share is 17%, not 50%.** §3's percentages size a POPULATION;
 *     Prachar multiplies every member of that population by every campaign, so
 *     50% of 24 contacts is ~84 real messages into two personal inboxes rather
 *     than 12. 4 tagged addresses receiving ~27 messages between them keeps the
 *     property §3 actually wanted — "half the population is genuinely
 *     checkable" becomes "a checkable sample in a readable inbox" — without
 *     turning the evidence into noise nobody opens.
 *
 * The simulator's 20 are split the way §3 splits its 45%: success, bounce,
 * complaint, out-of-office. Those bounces and complaints are reputation-exempt
 * by AWS's own rule, which is the whole reason §3 chose the simulator.
 *
 * ── THE GATE ITSELF ─────────────────────────────────────────────────────────
 * Before any Send button is pressed, `gateAudience()`:
 *
 *   1. reads `GET /campaigns/{id}/audience` — the SAME `_resolve_audience`
 *      the send path uses, so preview and send cannot disagree about who;
 *   2. refuses to proceed unless `truncated === false` **and**
 *      `contacts.length === will_receive`, so the enumeration is EXHAUSTIVE
 *      rather than the route's first fifty;
 *   3. checks EVERY address against `ALLOWED`, and fails naming the offenders.
 *
 * `ALLOWED` is deliberately NARROWER than the brief's list: it admits the
 * simulator, the two gmail tags and `@unicodegroup.com`, and it does **not**
 * admit `@example.com`. The brief tolerates that domain in what already exists;
 * this file will not MAIL it, for the reason above. A gate may be tightened
 * without asking. It may never be loosened.
 *
 * ⚠ **`send_email` returns True when the gate suppresses.** Nothing here infers
 * a send from a return value: the evidence is the `outbound_log` row, read back
 * through `GET /v1/billing/me/outbound/messages`, and asserted as a DELTA
 * (suite rule 4 — never reconcile a total by summing a capped list).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * §4 VOLUMES THAT ARE NOT REACHABLE, AND WHY — stated, never silently capped
 * ═══════════════════════════════════════════════════════════════════════════
 * 1 · **Landing pages 2 · form submissions 12 · tracked links 6 · clicks 24 ·
 *     referrals 4 — NOT BUILT.** Live query, both product schemas:
 *     `staging.mkt_landing_pages`, `mkt_tracked_links`, `mkt_link_clicks`,
 *     `mkt_referrals`, `mkt_referral_codes` all EXIST and all hold **0 rows**;
 *     nothing in `public`. No router in `backend/routers/` references any of
 *     them — the only mentions in the whole tree are two migrations
 *     (`030`, `201`) and one line of `docs/STAGING_SETUP.md`. No Prachar tab
 *     draws them. 11.12 asserts the routes 404 and the tabs are absent.
 * 2 · **Marketing automations fired 5 — NOT BUILT, and closed on purpose.**
 *     `PracharPage.jsx`'s `TABS` omits `automations` and says why; `POST
 *     /v1/prachar/automations` answers **501**; `GET /automations` answers
 *     `{"data":[],"engine":null,"note":"Prachar automations cannot be created:
 *     nothing in the product fires them…"}`. `staging.prachar_automations`
 *     holds 0 rows in its entire life. 11.11 measures all three.
 * 3 · **Sequence ADVANCE is not a user action.** The only thing that moves an
 *     enrolment is `services/skills/marketing_skills.process_sequence_steps`,
 *     reached from `POST /api/internal/cron/marketing`. Railway's `cron-daily`
 *     on staging is on `0 0 1 1 *` — DISARMED under R1, read from the service
 *     config on 2026-08-29 — and firing a cron by hand is a scheduler
 *     operation, not a row typed by a user. 11.8 drives everything a person can
 *     drive (create, step, enrol, activate, pause, archive) and says so.
 * 4 · **Sequence EXIT ON REPLY is a setting with no reachable outcome.**
 *     Nothing in this product writes `status='replied'` to
 *     `prachar_sequence_enrollments` or `prachar_sequence_logs` — grep returns
 *     only the two COUNT filters that read it — because there is no inbound
 *     email path at all (§8: "Inbound email is still out"). 11.8 proves the
 *     flag round-trips in both positions and renders as "Stops" / "Keeps
 *     sending", and states that the exit itself cannot be driven.
 * 5 · **Segments 6 — there is no segment ENTITY.** `prachar_lists` does not
 *     exist in either product schema. A segment in this product IS
 *     `prachar_campaigns.audience_filter`, built in `AudienceFilter.jsx`, and
 *     the backend accepts five keys of which the UI offers three (`tag` and
 *     `min_score` have no control, and `AudienceFilter.jsx` explains that
 *     `graha_contacts.tags` and `lead_score` are empty in every org). 11.4
 *     builds six distinct filters and previews each; 11.5 saves them onto
 *     campaigns.
 * 6 · **The ICAI override path is unreachable from any screen.** `client_only`
 *     defaults TRUE and `AudienceFilter.jsx` states there is deliberately no
 *     control to turn it off, so a non-client can never enter an audience
 *     through the browser, so `icai_block` is always false and the
 *     `window.prompt` basis flow in `CampaignsTab.send()` cannot be reached by
 *     a user. 11.4 asserts the panel's clients-only line instead. That is a
 *     closed door by design, not a defect and not a skip.
 * 7 · **Recipients land at 144 against §4's ~150.** 5 full-list sends (24) + one
 *     type-filtered send (6) + one post-unsubscribe send (18). The shortfall is
 *     arithmetic, not a cap: a seventh full send would be 162, and 144 is the
 *     nearer of the two to the number asked for.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * EXCLUDED BY DECISION — §13, and it must not blur into "blocked"
 * ═══════════════════════════════════════════════════════════════════════════
 * **Paid ads leave.** `prachar/AdsTab.jsx` is mounted and this suite does not
 * drive it. `staging.prachar_ad_accounts` and `prachar_ad_campaigns` hold 0
 * rows and END the run at 0. So do `hub_publish_queue` and
 * `hub_social_accounts` — Varta and the social connectors are out by the
 * owner's decision of 2026-08-27, not by any failure here.
 *
 * **There is no SMS provider in this codebase.** `services/outbound_log.py:263`
 * admits `email · push · whatsapp · social` and no `sms`;
 * `prachar_campaigns.channel`'s CHECK does allow `'sms'`. 11.10 verifies the
 * consequence a customer meets: a campaign on either non-email channel is
 * refused at Send with a sentence naming the channel. That is known and
 * recorded in §3 — it is confirmed here, not filed as a discovery.
 *
 * **There is no bounce webhook and no `bounced` status.** `outbound_log.status`
 * is `queued · sent · suppressed · failed`. Nothing in this file asserts bounce
 * handling, because there is none to test.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * §6 IDEMPOTENCE — proved by running twice, never claimed
 * ═══════════════════════════════════════════════════════════════════════════
 * Every record carries a DETERMINISTIC key: client `S11 Prachar Reach`,
 * contacts `S11 Reach 01…24` on fixed addresses, templates `S11-T01…12`,
 * campaigns `S11-C1…7` plus `S11-D1…3`, `S11-SMS-1`, `S11-WA-1`, sequences
 * `S11-SEQ-1…3`, events `S11-EV-1…3`, six fixed unsubscribe addresses, 30 fixed
 * registration addresses. Each test READS what exists first and creates only
 * the shortfall, then asserts the total. A second run therefore creates nothing
 * and still asserts everything.
 *
 * A campaign already `sent` is NOT re-sent on the second run: the server
 * refuses (`status is 'sent', cannot send`) and re-sending would double the
 * mail. 11.6 and 11.7 verify the terminal state instead and report
 * "0 sent, N already sent".
 *
 * `RUN` does not exist in this file. A stamped name is the opposite of
 * idempotent.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * STATUTORY NOTES — where a green assertion could be wrong
 * ═══════════════════════════════════════════════════════════════════════════
 * · **Clause (6), Part I, First Schedule, Chartered Accountants Act 1949.**
 *   `services/prachar_compliance.py` enforces six classes, three SOURCED and
 *   two INFERRED, and the file says which is which. 11.3 asserts that the form
 *   shows the basis — "Reasoned, not sourced." against "Stated in the Code." —
 *   because a member relying on the newsletter class is entitled to know the
 *   inference is ours. It does **not** assert that any class is legally
 *   correct: that is the Institute's to say and not a test's.
 * · **The prohibited class is present and is not a failure.**
 *   `prospect_outreach` exists so the refusal has a name. 11.3 creates a
 *   template carrying it. Nothing in this file sends to a non-client.
 * · **No open, click or bounce figure is asserted as measured.** Nothing in
 *   this product receives engagement events (`services/engagement_metrics.py`),
 *   the backend returns those counters as null, and the screens read "Not
 *   measured". 11.6 asserts that wording rather than a number, because a 0%
 *   open rate asserted green would be a figure this suite invented.
 * · **GSTIN blocks nothing.** 11.2 types every contact with the GSTIN box left
 *   blank and requires the save to succeed. The standing rule has regressed
 *   more than once.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * §14 — THIS SUITE RULES ON NOTHING
 * ═══════════════════════════════════════════════════════════════════════════
 * Every failure is written to report the WIRE (method, status, path, body) and
 * stop. No assertion is relaxed to make a screen pass and no product defect is
 * diagnosed here. That judgement is reserved.
 *
 * Run:
 *   cd frontend
 *   npx playwright test --config e2e-real/suite11.config.ts
 */
import { test, expect, Page, Locator } from '@playwright/test';
import { lane, assertOrg } from './_lanes';
import { setDate, settle } from './_helpers';

const LANE = lane('unicode');
const API = process.env.E2E_API_URL || 'https://kartavya-staging.up.railway.app';

const BLOCKED =
  'BLOCKED — no Unicode Group credential. Set E2E_UNICODE_TOKEN (or ' +
  'E2E_UNICODE_EMAIL/_PASSWORD) in .env.e2e at the repo root. ⚠ It must be an ' +
  'ORG-SCOPED account: a platform_admin token resolves to Aekam Inc via ' +
  'platform_bypass and would write there. ENVIRONMENT blocker, not a product ' +
  'or test defect.';

/* ══════════════════════════════════════════════════════════════════════════
   THE REACH LIST — the only addresses this suite is allowed to mail
   ══════════════════════════════════════════════════════════════════════════ */

/** The company every reach contact is filed under. `graha_contacts.company` is
 *  written by the BEFORE-INSERT trigger `trg_contact_company_from_client` from
 *  the linked client's name — read from `pg_trigger` on 2026-08-29, not assumed
 *  — which is what makes the Company segment resolve to exactly this list and
 *  to none of Suite 04's 53. */
const CLIENT_NAME = 'S11 Prachar Reach';

/** The second segment axis. Free text on the contact form, stored verbatim, and
 *  offered back by `GET /audience/options` as a DISTINCT source. */
const SOURCE = 's11-reach';

/**
 * The 24 mailboxes, written out rather than generated, because a generated
 * address is one nobody reads and this is the list that decides who gets mail.
 *
 * 20 simulator + 4 gmail tags. No `@example.com` and no `@unicodegroup.com` —
 * see the header for both reasons. The simulator's behaviours follow §3's
 * split: success dominates, with bounce, complaint and out-of-office present so
 * the full send path runs for each at zero reputational cost.
 */
const MAILBOX: string[] = [
  'success+s11r01@simulator.amazonses.com',
  'success+s11r02@simulator.amazonses.com',
  'success+s11r03@simulator.amazonses.com',
  'success+s11r04@simulator.amazonses.com',
  'success+s11r05@simulator.amazonses.com',
  'success+s11r06@simulator.amazonses.com',
  'success+s11r07@simulator.amazonses.com',
  'success+s11r08@simulator.amazonses.com',
  'success+s11r09@simulator.amazonses.com',
  'success+s11r10@simulator.amazonses.com',
  'success+s11r11@simulator.amazonses.com',
  'success+s11r12@simulator.amazonses.com',
  'success+s11r13@simulator.amazonses.com',
  'success+s11r14@simulator.amazonses.com',
  'success+s11r15@simulator.amazonses.com',
  'success+s11r16@simulator.amazonses.com',
  'bounce+s11r17@simulator.amazonses.com',
  'bounce+s11r18@simulator.amazonses.com',
  'complaint+s11r19@simulator.amazonses.com',
  'ooto+s11r20@simulator.amazonses.com',
  'kevalvshah03+s11r21@gmail.com',
  'kevalvshah03+s11r22@gmail.com',
  'kelisweet+s11r23@gmail.com',
  'kelisweet+s11r24@gmail.com',
];

/** `graha_contacts.contact_type`'s four CHECK values, six contacts each, so a
 *  type-filtered segment resolves to a sixth of the list. */
const TYPES = ['lead', 'customer', 'vendor', 'partner'] as const;

type Reach = { no: string; name: string; email: string; type: string };

const REACH: Reach[] = MAILBOX.map((email, i) => {
  const no = String(i + 1).padStart(2, '0');
  return { no, name: `S11 Reach ${no}`, email, type: TYPES[i % 4] };
});

/**
 * THE ALLOWED SET, and it is narrower than the brief's on purpose.
 *
 * Admits: the AWS mailbox simulator (any behaviour label), the two gmail tags
 * §3 names, and `@unicodegroup.com`. It does NOT admit `@example.com` — see the
 * header. A gate may be tightened without asking; it may never be loosened.
 */
const ALLOWED =
  /^(?:[^@\s]+@simulator\.amazonses\.com|kevalvshah03\+[^@\s]*@gmail\.com|kelisweet\+[^@\s]*@gmail\.com|[^@\s]+@unicodegroup\.com)$/i;

/** The six who opt out in 11.7. A mix on purpose: three success, one bounce,
 *  one address on each gmail mailbox — so the exclusion proof covers a
 *  deliverable inbox a human can check as well as the simulator. */
const OPT_OUT = ['04', '09', '14', '18', '22', '24']
  .map((no) => REACH.find((r) => r.no === no)!.email);

/* ══════════════════════════════════════════════════════════════════════════
   SEGMENTS — six, and a segment here is an audience_filter, not an entity
   ══════════════════════════════════════════════════════════════════════════ */

type Segment = {
  key: string;
  label: string;
  /** What the three controls in `AudienceFilter.jsx` are set to. */
  type?: typeof TYPES[number];
  source?: string;
  company?: string;
  /** How many of the 24 it must resolve to before anybody unsubscribes. */
  expect: number;
};

const SEGMENTS: Segment[] = [
  { key: 'S1', label: 'the whole reach list, by company', company: CLIENT_NAME, expect: 24 },
  { key: 'S2', label: 'the whole reach list, by source', source: SOURCE, expect: 24 },
  { key: 'S3', label: 'leads in the reach list', type: 'lead', company: CLIENT_NAME, expect: 6 },
  { key: 'S4', label: 'customers in the reach list', type: 'customer', company: CLIENT_NAME, expect: 6 },
  { key: 'S5', label: 'vendors, by source', type: 'vendor', source: SOURCE, expect: 6 },
  { key: 'S6', label: 'partners in the reach list', type: 'partner', company: CLIENT_NAME, expect: 6 },
];

const seg = (k: string) => SEGMENTS.find((s) => s.key === k)!;

/* ══════════════════════════════════════════════════════════════════════════
   TEMPLATES — twelve, and every compliance class represented
   ══════════════════════════════════════════════════════════════════════════ */

type Tmpl = {
  name: string;
  category: string;
  /** '' means "From the category" — the ordinary case, and the one that proves
   *  `CATEGORY_TO_CLASS` is consulted rather than the column alone. */
  cls: string;
  subject: string;
  body: string;
  /** The class the SEND PATH must end up enforcing, whichever way it got there.
   *  null = unclassified, which `general` deliberately is. */
  effective: string | null;
  /** Set on the one template written to trip the save-time linter. */
  lint?: string;
};

const TEMPLATES: Tmpl[] = [
  {
    name: 'S11-T01', category: 'transactional', cls: 'client_service',
    subject: 'Your GSTR-3B for {{company}} has been filed',
    body: 'Hello {{name}}, the return for {{company}} was filed today. The acknowledgement is attached to your engagement folder.',
    effective: 'client_service',
  },
  {
    name: 'S11-T02', category: 'general', cls: 'greeting',
    subject: 'Season’s greetings from the practice',
    body: 'Hello {{name}}, our warmest wishes to you and everyone at {{company}} for the year ahead.',
    effective: 'greeting',
  },
  {
    name: 'S11-T03', category: 'general', cls: 'invitation',
    subject: 'You are invited: our annual client evening',
    body: 'Hello {{name}}, we would be glad to see you at our annual client evening.',
    effective: 'invitation',
  },
  {
    name: 'S11-T04', category: 'newsletter', cls: 'statutory_reminder',
    subject: 'TDS payment for {{company}} is due on the 7th',
    body: 'Hello {{name}}, the TDS deposit for {{company}} falls due on the 7th of next month. Nothing is needed from you if the challan is already with us.',
    effective: 'statutory_reminder',
  },
  {
    name: 'S11-T05', category: 'newsletter', cls: 'knowledge_update',
    subject: 'What the new e-invoicing threshold means for you',
    body: 'Hello {{name}}, a short note on the revised e-invoicing threshold and whether {{company}} is inside it.',
    effective: 'knowledge_update',
  },
  {
    name: 'S11-T06', category: 'promotional', cls: 'prospect_outreach',
    subject: 'An introduction to the practice',
    body: 'Hello {{name}}, a short introduction to what we do. This template carries the one class the Code prohibits by email, and it exists so the refusal has a name.',
    effective: 'prospect_outreach',
  },
  {
    name: 'S11-T07', category: 'transactional', cls: '',
    subject: 'Statement of account for {{company}}',
    body: 'Hello {{name}}, the statement of account for {{company}} is ready in your portal.',
    effective: 'client_service',
  },
  {
    name: 'S11-T08', category: 'newsletter', cls: '',
    subject: 'This month in direct tax',
    body: 'Hello {{name}}, three things worth ten minutes of your time this month.',
    effective: 'knowledge_update',
  },
  {
    name: 'S11-T09', category: 'promotional', cls: '',
    subject: 'Our advisory practice',
    body: 'Hello {{name}}, an outline of the advisory work we take on.',
    effective: 'prospect_outreach',
  },
  {
    name: 'S11-T10', category: 'general', cls: '',
    subject: 'A note from the practice',
    body: 'Hello {{name}}, a short note. `general` maps to no class at all, deliberately, so this template is UNCLASSIFIED and the send path treats it as such.',
    effective: null,
  },
  {
    name: 'S11-T11', category: 'general', cls: 'client_service',
    subject: 'Our award-winning team is at your service',
    body: 'Hello {{name}}, our award-winning team and our unbeatable rates are here to help {{company}}. This subject line exists to be caught by the save-time linter.',
    effective: 'client_service',
    lint: 'award-winning',
  },
  {
    name: 'S11-T12', category: 'transactional', cls: 'greeting',
    subject: 'Happy new financial year, {{name}}',
    body: 'Hello {{name}}, wishing {{company}} a good year. Your engagement letter renews automatically.',
    effective: 'greeting',
  },
];

/* ══════════════════════════════════════════════════════════════════════════
   CAMPAIGNS
   ══════════════════════════════════════════════════════════════════════════ */

type Camp = {
  name: string;
  template: string;
  subject: string;
  body: string;
  segment: string;
  channel: 'email' | 'sms' | 'whatsapp';
  /** Days from today for the `Send at` DateInput. */
  inDays: number;
  /** Sent by 11.6/11.7, or left a draft. */
  send: 'now' | 'draft' | 'refused';
  /** Recipients the send must resolve to, at the moment it is sent. */
  recipients: number;
};

const CAMPAIGNS: Camp[] = [
  { name: 'S11-C1', template: 'S11-T01', subject: 'Your filings this quarter', body: 'Hello {{name}}, the quarter’s filings for {{company}} are complete.', segment: 'S1', channel: 'email', inDays: 1, send: 'now', recipients: 24 },
  { name: 'S11-C2', template: 'S11-T02', subject: 'Greetings from the practice', body: 'Hello {{name}}, our best wishes to everyone at {{company}}.', segment: 'S1', channel: 'email', inDays: 2, send: 'now', recipients: 24 },
  { name: 'S11-C3', template: 'S11-T04', subject: 'Statutory dates for next month', body: 'Hello {{name}}, the dates that matter to {{company}} next month.', segment: 'S1', channel: 'email', inDays: 3, send: 'now', recipients: 24 },
  { name: 'S11-C4', template: 'S11-T05', subject: 'E-invoicing: what changed', body: 'Hello {{name}}, what the revised threshold means for {{company}}.', segment: 'S2', channel: 'email', inDays: 4, send: 'now', recipients: 24 },
  { name: 'S11-C5', template: 'S11-T07', subject: 'Your statement of account', body: 'Hello {{name}}, the statement for {{company}} is ready.', segment: 'S2', channel: 'email', inDays: 5, send: 'now', recipients: 24 },
  { name: 'S11-C6', template: 'S11-T12', subject: 'A note for our newest clients', body: 'Hello {{name}}, welcome aboard from all of us.', segment: 'S3', channel: 'email', inDays: 6, send: 'now', recipients: 6 },
  // THE EXCLUSION PROOF. Sent LAST, after 11.7 has opted six people out, and
  // over the SAME segment as C1 — so the only difference between 24 and 18 is
  // the suppression list.
  { name: 'S11-C7', template: 'S11-T01', subject: 'After the opt-outs', body: 'Hello {{name}}, a note for {{company}}.', segment: 'S1', channel: 'email', inDays: 7, send: 'now', recipients: 18 },

  { name: 'S11-D1', template: 'S11-T08', subject: 'This month in direct tax', body: 'Hello {{name}}, three things worth reading.', segment: 'S4', channel: 'email', inDays: 10, send: 'draft', recipients: 6 },
  { name: 'S11-D2', template: 'S11-T10', subject: 'A note from the practice', body: 'Hello {{name}}, a short note.', segment: 'S5', channel: 'email', inDays: 11, send: 'draft', recipients: 6 },
  { name: 'S11-D3', template: 'S11-T03', subject: 'Our annual client evening', body: 'Hello {{name}}, we would be glad to see you.', segment: 'S6', channel: 'email', inDays: 12, send: 'draft', recipients: 6 },

  { name: 'S11-SMS-1', template: 'S11-T01', subject: 'SMS channel probe', body: 'Nothing in this product can deliver an SMS.', segment: 'S3', channel: 'sms', inDays: 13, send: 'refused', recipients: 6 },
  { name: 'S11-WA-1', template: 'S11-T01', subject: 'WhatsApp channel probe', body: 'Varta is excluded by decision and cannot deliver.', segment: 'S3', channel: 'whatsapp', inDays: 14, send: 'refused', recipients: 6 },
];

const camp = (n: string) => CAMPAIGNS.find((c) => c.name === n)!;
const SENT_CAMPAIGNS = CAMPAIGNS.filter((c) => c.send === 'now');

/* ══════════════════════════════════════════════════════════════════════════
   SEQUENCES · EVENTS
   ══════════════════════════════════════════════════════════════════════════ */

type Step = { order: number; channel: string; delay: number; subject: string; body: string };

type Seq = {
  name: string;
  description: string;
  exitOnReply: boolean;
  steps: Step[];
  /** 1-based reach numbers enrolled into this sequence. Eight each = 24. */
  enrol: string[];
  /** Whether 11.8 presses Activate on it. */
  activate: boolean;
};

const SEQUENCES: Seq[] = [
  {
    name: 'S11-SEQ-1', description: 'Onboarding drip for a newly engaged client',
    exitOnReply: true, activate: true,
    steps: [
      { order: 1, channel: 'email', delay: 0, subject: 'Welcome — what happens in week one', body: 'Hello {{name}}, here is what we do first.' },
      { order: 2, channel: 'email', delay: 3, subject: 'The documents we will need', body: 'Hello {{name}}, a short list.' },
      { order: 3, channel: 'call_task', delay: 7, subject: '', body: '' },
      { order: 4, channel: 'manual', delay: 14, subject: '', body: '' },
    ],
    enrol: ['01', '02', '03', '04', '05', '06', '07', '08'],
  },
  {
    name: 'S11-SEQ-2', description: 'Renewal nudge — deliberately keeps sending after a reply',
    exitOnReply: false, activate: false,
    steps: [
      { order: 1, channel: 'email', delay: 1, subject: 'Your engagement renews next month', body: 'Hello {{name}}, a reminder for {{company}}.' },
      { order: 2, channel: 'email', delay: 8, subject: 'Renewal — anything to change?', body: 'Hello {{name}}, tell us if the scope has moved.' },
      { order: 3, channel: 'whatsapp', delay: 15, subject: 'Renewal', body: 'A nudge.' },
      { order: 4, channel: 'manual', delay: 21, subject: '', body: '' },
    ],
    enrol: ['09', '10', '11', '12', '13', '14', '15', '16'],
  },
  {
    name: 'S11-SEQ-3', description: 'Statutory calendar ladder',
    exitOnReply: true, activate: false,
    steps: [
      { order: 1, channel: 'email', delay: 2, subject: 'GST: the 11th and the 20th', body: 'Hello {{name}}, the two dates for {{company}}.' },
      { order: 2, channel: 'email', delay: 9, subject: 'TDS: the 7th', body: 'Hello {{name}}, the deposit date.' },
      { order: 3, channel: 'email', delay: 16, subject: 'Advance tax: the 15th', body: 'Hello {{name}}, the instalment date.' },
      { order: 4, channel: 'call_task', delay: 25, subject: '', body: '' },
    ],
    enrol: ['17', '18', '19', '20', '21', '22', '23', '24'],
  },
];

type Ev = {
  name: string;
  type: string;
  location: string;
  url: string;
  cap: string;
  inDays: number;
  /** 10 registrations each = 30. */
  regs: number;
};

const EVENTS: Ev[] = [
  { name: 'S11-EV-1', type: 'webinar', location: 'Online', url: 'https://staging.kartavaya.com/events/s11-ev-1', cap: '10', inDays: 20, regs: 10 },
  { name: 'S11-EV-2', type: 'meetup', location: 'Ahmedabad', url: '', cap: '', inDays: 27, regs: 10 },
  { name: 'S11-EV-3', type: 'workshop', location: 'Surat', url: 'https://staging.kartavaya.com/events/s11-ev-3', cap: '20', inDays: 34, regs: 10 },
];

/** Registration addresses. Nothing mails them — `register_for_event` sends no
 *  email, checked in `routers/prachar.py` — but they follow §3 anyway, because
 *  an address seeded outside the scheme is one somebody later mails by
 *  accident. */
const regEmail = (ev: string, i: number) =>
  `success+s11${ev.toLowerCase().replace(/[^a-z0-9]/g, '')}${String(i).padStart(2, '0')}@simulator.amazonses.com`;

/* ══════════════════════════════════════════════════════════════════════════
   THE HARNESS
   ══════════════════════════════════════════════════════════════════════════ */

test.beforeAll(() => {
  console.log(
    `\n  LANE: ${LANE.org} (${LANE.orgId})  · reference lane, §14` +
    `\n  API : ${API}` +
    `\n  ⚠ outbound_mode=live and NOTHING is suppressed. Every send in this` +
    `\n    suite is a real send. The only addresses it may reach are the 24 in` +
    `\n    MAILBOX; gateAudience() enumerates and checks every one before any` +
    `\n    Send button is pressed.\n`,
  );
});

/**
 * Sign in, then REFUSE TO CONTINUE unless the session resolved to Unicode.
 *
 * The token opens the door; every row below is still typed and clicked. §2 of
 * the proposal takes the same position about the bootstrap admin it insists on
 * keeping: "This is not a bypass of the 'driven as a user' rule — it is the
 * precondition for it."
 *
 * `assertOrg()` is called inside `signInAs()` now, and it is called again here
 * for the token branch this file drives, because the guard has been found not
 * running three times and a countermeasure that depends on being remembered is
 * one that will be forgotten.
 */
async function signIn(page: Page) {
  if (LANE.email && LANE.password) {
    await page.goto('/login');
    await expect(page.locator('#au-email')).toBeVisible({ timeout: 30_000 });
    await page.locator('#au-email').fill(LANE.email);
    await page.locator('#au-password').fill(LANE.password);
    await page.locator('form button[type="submit"]').first().click();
    await page.waitForURL((u) => !/\/login/.test(u.pathname), { timeout: 45_000 });
  } else {
    if (!LANE.token) throw new Error(BLOCKED);
    await page.goto('/login');
    await page.evaluate((t) => localStorage.setItem('auth_token', t), LANE.token);
    await page.goto('/dashboard');
    await page.waitForURL((u) => !/\/login/.test(u.pathname), { timeout: 45_000 });
  }
  await assertOrg(page.request, page, LANE);
}

/**
 * ⚠ `X-Org-Id` IS NOT OPTIONAL, and `_helpers.ts::api()` MUST NOT be used here.
 *
 * `src/lib/api.js:39` puts the active org on every request the product makes.
 * `_helpers.ts::api()` sends `X-Org-Id: process.env.E2E_ORG_ID` — which names
 * **E2E Test & Associates**, not Unicode. A read helper that answers for a
 * different organisation than the screen beside it is the same class of fault
 * as the 2026-08-28 cross-org incident, so this file has its own, bound to the
 * lane's org id and to nothing in the environment.
 *
 * GET only, and that is a rule rather than an accident:
 * `check-e2e-no-bypass.mjs` bans `page.request.post/put/patch/delete` and
 * permits `get`, because asserting that the row appeared IS the evidence.
 */
async function orgGet(page: Page, path: string): Promise<any> {
  const token = await page.evaluate(() => localStorage.getItem('auth_token'));
  const res = await page.request.get(`${API}${path}`, {
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      'X-Org-Id': LANE.orgId,
    },
  });
  expect(res.ok(), `GET ${path} → ${res.status()}: ${(await res.text()).slice(0, 500)}`)
    .toBeTruthy();
  return await res.json();
}

/** A GET whose STATUS is the assertion — used to prove a route is not built. */
async function orgGetStatus(page: Page, path: string): Promise<number> {
  const token = await page.evaluate(() => localStorage.getItem('auth_token'));
  const res = await page.request.get(`${API}${path}`, {
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      'X-Org-Id': LANE.orgId,
    },
  });
  return res.status();
}

/** The rows of an enveloped or bare list, whichever the route answers. */
async function rowsOf(page: Page, path: string): Promise<any[]> {
  const body = await orgGet(page, path);
  const r = Array.isArray(body) ? body : body?.data;
  expect(Array.isArray(r), `GET ${path} did not answer a list: ${JSON.stringify(body).slice(0, 300)}`)
    .toBeTruthy();
  return r as any[];
}

/**
 * THE WIRE — every write, with the status the server answered, plus the
 * requests that never came back at all.
 *
 * Memory's rule, learned from the bank-import bug: watch the requests before
 * blaming the UI. That defect presented as "the button does nothing" and as a
 * CORS error in the console; it was a 500, and only a request listener told the
 * two apart.
 */
type Wire = string[];
const FAILED = new WeakMap<Page, string[]>();

function watchWire(page: Page): Wire {
  const wire: Wire = [];
  const failed: string[] = [];
  FAILED.set(page, failed);
  page.on('response', async (r) => {
    const req = r.request();
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method())) return;
    if (!/\/api\//.test(r.url())) return;
    let body = '';
    try { body = (await r.text()).slice(0, 240); } catch { /* consumed */ }
    wire.push(`${req.method()} ${r.status()} ${new URL(r.url()).pathname}  ${body}`);
  });
  page.on('requestfailed', (req) => {
    if (!/\/api\//.test(req.url())) return;
    failed.push(
      `${req.method()} FAILED ${new URL(req.url()).pathname}  ` +
      `${req.failure()?.errorText ?? '(no reason given)'}`,
    );
  });
  return wire;
}

const dump = (page: Page, w: Wire) => {
  const f = FAILED.get(page) || [];
  return (w.length ? w.slice(-10).map((l) => '\n     ' + l).join('') : '\n     (no write request was made at all)')
    + (f.length ? '\n     ── requests that never returned ──' + f.slice(-6).map((l) => '\n     ' + l).join('') : '');
};

/**
 * The console, per screen.
 *
 * `pageerror` is an UNCAUGHT exception and is asserted at zero — that is the §1
 * requirement and it is not negotiable. `console.error` is collected beside it
 * and asserted separately, so a failure says which of the two happened rather
 * than leaving the next reader to guess.
 */
type Con = { errors: string[]; uncaught: string[] };
function watchConsole(page: Page): Con {
  const c: Con = { errors: [], uncaught: [] };
  page.on('console', (m) => {
    if (m.type() === 'error') {
      c.errors.push(`${page.url().replace(/^https?:\/\/[^/]+/, '')}  ${m.text().slice(0, 240)}`);
    }
  });
  page.on('pageerror', (e) => c.uncaught.push(`${page.url()}  ${String(e).slice(0, 240)}`));
  return c;
}

/**
 * Every native dialog, accepted, and RECORDED.
 *
 * Playwright DISMISSES dialogs by default, so without this every `Send now`
 * would silently cancel and the suite would report "no send happened" against a
 * product that was never asked to send. Three surfaces here use one:
 * `CampaignsTab.send()` confirms the recipient count and the segment by name,
 * `UnsubscribesTab.remove()` confirms an address, `EventsTab.remove()` confirms
 * a deletion.
 *
 * The message is kept because the confirm text is itself an assertion target —
 * "Send X to N people" is the last thing a marketer reads, and it quoting the
 * PRE-suppression count instead of the post-suppression one is a defect this
 * module has already had fixed once.
 */
type Dialogs = string[];
function acceptDialogs(page: Page): Dialogs {
  const seen: Dialogs = [];
  page.on('dialog', async (d) => {
    seen.push(`${d.type()}: ${d.message().replace(/\n+/g, ' | ')}`);
    await d.accept('');
  });
  return seen;
}

/**
 * Click something that writes, and return what the server actually stored.
 *
 * Suite rule 2 — read the WRITE RESPONSE, not the list. Ganit's list is date
 * ordered and a new row is not on page one, and the test that looked there
 * reported "not created" while the screen said "created".
 *
 * A request that never returns is invisible to a response listener and is the
 * failure mode that reads most like "the button does nothing", so the timeout
 * message carries the failed-request log rather than a bare "Timeout exceeded".
 */
async function writes(
  page: Page, wire: Wire, urlPart: string | RegExp,
  act: () => Promise<void>, expectStatus?: number,
): Promise<any> {
  const match = (u: string) => (typeof urlPart === 'string' ? u.includes(urlPart) : urlPart.test(u));
  let res;
  try {
    [res] = await Promise.all([
      page.waitForResponse((r) => match(r.url()) && r.request().method() !== 'GET', { timeout: 60_000 }),
      act(),
    ]);
  } catch (e) {
    throw new Error(
      `no response to a write matching ${String(urlPart)} within 60s.` +
      `${dump(page, wire)}\n     original: ${String(e).slice(0, 200)}`,
    );
  }
  const body = await res.text();
  const line = `${res.request().method()} ${res.url()} → ${res.status()}: ${body.slice(0, 500)}`;
  if (expectStatus != null) {
    expect(res.status(), line).toBe(expectStatus);
  } else {
    // ANY 2xx. Demanding exactly 200 once rejected a correct 201 Created and
    // reported it as a failure.
    expect(res.status(), line).toBeGreaterThanOrEqual(200);
    expect(res.status(), line).toBeLessThan(300);
  }
  try { return JSON.parse(body); } catch { return {}; }
}

/**
 * Open Prachar and switch to one tab, wherever `ModuleTabs` has put it.
 *
 * Prachar declares eight tabs and `ModuleTabs` shows as many as fit inline,
 * pushing the rest behind "More +N" — and WHICH ones depends on the measured
 * width of the strip, re-derived by a `ResizeObserver`. A test that decides the
 * branch from one `count()` and then clicks meets "waiting for
 * locator('#mt-tab-events')" on a tab that was there when it was looked for.
 *
 * ⚠ Scoped to the module tablist by its aria-label. `_helpers.ts::openTab` uses
 * a bare `getByRole('tab')`, and this page renders other tab-shaped controls
 * inside its panels (the Month/Week/List segmented control is `role="group"`,
 * but the analytics panel brings its own). Suite rule 6: an unscoped name match
 * resolves in DOM order and will hit the wrong one.
 *
 * The page holds its tab in local state with no URL parameter, so `goto` always
 * lands on whatever `useTabPrefs` has starred. Every caller names the tab it
 * wants; nothing here assumes the landing tab.
 */
async function prachar(page: Page, tabId: string): Promise<void> {
  if (!/\/prachar/.test(page.url())) await page.goto('/prachar');
  // ⚠ A DETAIL VIEW IS NOT A DIFFERENT URL, and that cost a test.
  //
  // `CampaignsTab`, `SequencesTab` and the template form all replace the tab's
  // whole panel from LOCAL STATE — the address bar still reads `/prachar`. So
  // the guard above does not navigate, and clicking the tab that is already
  // selected calls `onChange` with the value it already has, which re-renders
  // nothing and leaves the detail on screen. 11.8 met that as "waiting for
  // locator('table.tbl tr').filter({hasText:'S11-SEQ-2'})" — a row that was
  // genuinely not there, on a screen that was genuinely not the list.
  //
  // The BackButton is driven rather than the URL reloaded, because it is the
  // control a person uses and a reload would also throw away the tab the
  // starred default is not.
  await backToList(page);
  await moduleTab(page, 'Prachar sections', tabId);
}

/** Leave any detail or form view the module is showing, by its own control. */
async function backToList(page: Page): Promise<void> {
  for (let i = 0; i < 3; i++) {
    const back = page.locator('button.k-backbtn');
    if (!(await back.count())) return;
    await back.first().click();
    await settle(page);
  }
}

/** The same, for the two Graha screens 11.2 has to reach. */
async function graha(page: Page, tabId: string): Promise<void> {
  if (!/\/graha/.test(page.url())) await page.goto('/graha');
  await moduleTab(page, 'Graha sections', tabId);
}

async function moduleTab(page: Page, stripLabel: string, tabId: string): Promise<void> {
  const strip = page.getByRole('tablist', { name: stripLabel });
  await expect(strip, `the "${stripLabel}" tab strip never rendered`).toBeVisible({ timeout: 45_000 });

  // Let the strip finish measuring before deciding where the tab is. `fits` is
  // re-derived by a ResizeObserver, so a tab can EXIST inline on first paint and
  // be in the More menu a beat later.
  let stable = -1;
  let sameFor = 0;
  for (let i = 0; i < 25; i++) {
    const n = await strip.locator('[role="tab"]').count();
    if (n > 0 && n === stable) { sameFor += 1; if (sameFor >= 3) break; } else { sameFor = 0; }
    stable = n;
    await page.waitForTimeout(200);
  }

  let last: unknown;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const inline = page.locator(`#mt-tab-${tabId}`);
      if (await inline.count()) {
        await inline.click({ timeout: 15_000 });
      } else {
        const more = page.getByRole('button', { name: /^More/ });
        await expect(more, `the "${tabId}" tab is not inline and there is no More menu`).toBeVisible();
        // ⚠ THE TRIGGER IS A TOGGLE — `onClick={() => setOpenMore(o => !o)}`.
        // Clicking it when the popover is already open CLOSES it, and the menu
        // lookup then runs against a menu that is not on screen and reports the
        // tab as absent. `aria-expanded` is the state to read.
        if ((await more.getAttribute('aria-expanded')) !== 'true') await more.click();
        const menu = page.getByRole('menu');
        await expect(menu).toBeVisible({ timeout: 10_000 });
        const row = menu.getByRole('menuitem', {
          name: new RegExp(`^\\s*${tabId.replace(/-/g, ' ')}\\s*$`, 'i'),
        });
        if (await row.count()) {
          await row.click();
        } else {
          const listed = (await menu.locator('.mt__pop-en').allTextContents()).join(', ');
          const inlineIds = await page.$$eval('[id^="mt-tab-"]', (els) => els.map((e) => e.id).join(','));
          throw new Error(
            `the "${tabId}" tab is in neither place. Inline: ${inlineIds}. Menu: ${listed}`,
          );
        }
      }
      await expect(
        page.locator(`#mt-panel-${tabId}`),
        `the "${tabId}" tab was clicked and its panel never appeared`,
      ).toBeVisible({ timeout: 20_000 });
      await settle(page);
      return;
    } catch (e) {
      last = e;
      await page.keyboard.press('Escape').catch(() => {});
      await page.waitForTimeout(400);
    }
  }
  throw last;
}

/** A `k-formpanel__label` by its visible text, inside a scope. */
const fp = (scope: Locator | Page, text: string | RegExp): Locator =>
  (scope as any).locator('label.k-formpanel__label').filter({ hasText: text }).first();

/** A Graha `gr__f` field by its visible label. */
const gf = (scope: Locator | Page, text: string | RegExp): Locator =>
  (scope as any).locator('label.gr__f').filter({ hasText: text }).first();

/**
 * Wait for a select that a fetch populates, then choose by option TEXT.
 *
 * Suite rule 5. `pickOption` in `_helpers.ts` does the same thing; this one is
 * here because it must also work on the multi-select enroller, and because a
 * genuinely empty picker IS a finding and must fail naming the picker rather
 * than being tolerated.
 */
async function pickByText(select: Locator, what: string, text: string) {
  await expect
    .poll(async () => await select.locator('option').count(),
      { message: `the ${what} picker never loaded any options`, timeout: 30_000 })
    .toBeGreaterThan(1);
  const texts = await select.locator('option').allTextContents();
  // ⚠ CASE-INSENSITIVE, and that is a real fact about these screens rather than
  // laxity. Every enum this product shows a person goes through `humanise()` —
  // underscores to spaces, first letter capitalised — so the stored source
  // `s11-reach` is drawn as `S11-reach` and the company name is drawn verbatim.
  // The first version of this matched the STORED string and reported "no source
  // option containing s11-reach" against a select whose seventh row was exactly
  // that source. A locator written against the wrong casing fails as a MISSING
  // CONTROL, which is the wrong diagnosis entirely.
  const want = text.toLowerCase();
  const idx = texts.findIndex((t) => t.toLowerCase().includes(want));
  expect(idx, `no ${what} option containing "${text}"; saw: ${texts.slice(0, 10).join(' | ')}`)
    .toBeGreaterThan(-1);
  const value = await select.locator('option').nth(idx).getAttribute('value');
  await select.selectOption(value!);
  return value!;
}

/** `YYYY-MM-DD`, n days from today, in LOCAL time. `toISOString()` is UTC and
 *  would file a 1 a.m. IST campaign on the previous day. */
function inDays(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  const p = (x: number) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/* ══════════════════════════════════════════════════════════════════════════
   THE SEND GATE
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * ⚠ NOTHING IN THIS FILE PRESSES SEND WITHOUT PASSING THROUGH HERE.
 *
 * `GET /campaigns/{id}/audience` runs the SAME `_resolve_audience` the send
 * path runs, and `_audience_preview_body` applies the SAME suppression pass —
 * that is the module's own oldest promise and it is why this is the honest
 * place to enumerate from. Three conditions, and every one of them is a stop:
 *
 *   · `truncated === false` — the route projects `eligible[:50]`, so a bigger
 *     audience would hand back a SAMPLE, and the brief's instruction is
 *     explicit that sampling is not enumeration.
 *   · `contacts.length === will_receive` — the enumeration is complete against
 *     the server's own count of who receives.
 *   · every address matches `ALLOWED`.
 *
 * Returns the addresses, so the caller can assert on them afterwards.
 */
async function gateAudience(page: Page, campaignId: string, name: string, expected: number) {
  const a = await orgGet(page, `/api/v1/prachar/campaigns/${campaignId}/audience`);
  const contacts: any[] = a.contacts || [];
  const emails: string[] = contacts.map((c) => String(c.email || ''));

  expect(a.truncated,
    `${name}: the audience response is TRUNCATED (matched ${a.matched}), so the ` +
    'address list is a sample and not an enumeration. STOP — no send.').toBe(false);

  expect(contacts.length,
    `${name}: the audience listed ${contacts.length} addresses but the server says ` +
    `${a.will_receive} will receive it. The enumeration is incomplete. STOP — no send.`)
    .toBe(Number(a.will_receive));

  const bad = emails.filter((e) => !ALLOWED.test(e));
  expect(bad,
    `\n  ⚠⚠ STOP — ${name} would mail ${bad.length} address(es) outside the allowed set.\n` +
    `     ${bad.slice(0, 20).join('\n     ')}\n` +
    `     outbound_mode is LIVE and nothing is suppressed, so this WOULD have been\n` +
    `     delivered. Allowed: @simulator.amazonses.com, kevalvshah03+…@gmail.com,\n` +
    `     kelisweet+…@gmail.com, …@unicodegroup.com. Reported, not worked around.\n`)
    .toEqual([]);

  expect(Number(a.will_receive),
    `${name}: expected ${expected} recipients, the audience resolves to ${a.will_receive}` +
    ` (matched ${a.matched}, unsubscribed ${a.unsubscribed}). Segment: ${a.summary}`)
    .toBe(expected);

  // The ICAI gate, read from the same body the panel reads. Every reach contact
  // is linked to `S11 Prachar Reach`, so this must be a clean clients-only
  // audience and the send must not need an override.
  expect(a.icai_block, `${name}: the ICAI gate would REFUSE this send — ` +
    `${a.non_client_recipients} recipient(s) have no client record`).toBe(false);
  expect(Number(a.client_recipients), `${name}: not every recipient is a client`)
    .toBe(expected);

  return emails;
}

/** Prachar's own sends, out of the org's outbound log. A DELTA is taken across
 *  each send rather than a total summed from this list — suite rule 4 — and the
 *  cap is asserted so a truncated page cannot silently flatten the delta. */
async function outboundCampaignRows(page: Page): Promise<any[]> {
  const body = await orgGet(page,
    '/api/v1/billing/me/outbound/messages?purpose=prachar_campaign&limit=500');
  const rows: any[] = body?.data || [];
  expect(rows.length,
    'the outbound log came back at the route cap (500) — a delta taken across it ' +
    'is no longer trustworthy. Narrow the period before reading it again.')
    .toBeLessThan(500);
  return rows;
}

/** Every send this org has made to one address, whatever the period. */
async function outboundTo(page: Page, address: string): Promise<any[]> {
  const body = await orgGet(page,
    `/api/v1/billing/me/outbound/messages?purpose=prachar_campaign&recipient=${encodeURIComponent(address)}&limit=500`);
  return body?.data || [];
}

/* ══════════════════════════════════════════════════════════════════════════
   ⚠ ORDER YES, `serial` NO — and the difference is deliberate.
   ══════════════════════════════════════════════════════════════════════════
   The tests build on each other's rows, and one of those dependencies is a
   SAFETY dependency: 11.6 may not send until 11.2 has built the reach list.
   Playwright runs the tests in one file in DECLARATION order on a single worker
   (this config does not set `fullyParallel`), so the ordering holds without
   `mode: 'serial'`.

   What `serial` would add is SKIPPING every later test once one fails — and on
   a programme whose whole purpose is to measure how much of a module a customer
   can actually drive, that turns one shipped blocker into twelve unmeasured
   screens. Every test signs in for itself and reads what exists before it
   creates, so a later test is not left half-built by an earlier failure: it
   either finds its precondition and proceeds, or fails saying which test owns
   it.

   THE ONE EXCEPTION IS THE SEND. 11.6 and 11.7 assert their precondition — that
   the reach list is complete and that every address in it is allowed — and FAIL
   rather than send if it is not. A missing precondition there is not a skip and
   is not a partial run; it is a refusal to mail anybody.
   ══════════════════════════════════════════════════════════════════════════ */

/* ────────────────────────────────────────────────────────────────────────── */

test('11.1 Prachar opens, mounts exactly the tabs PracharPage declares, and says what is empty', async ({ page }) => {
  const wire = watchWire(page);
  const con = watchConsole(page);
  await signIn(page);

  await page.goto('/prachar');
  await expect(page.getByRole('tablist', { name: 'Prachar sections' }),
    'the Prachar tab strip never rendered — the module may not be active for this org')
    .toBeVisible({ timeout: 45_000 });

  // The KPI strip is the module summary, and its fourth tile is the one that
  // must never invent a figure: nothing in this product receives open events,
  // so the tile says so in the VALUE rather than printing a confident 0%.
  await expect(page.getByText('Not measured').first(),
    'the Open rate tile does not say "Not measured" — a fabricated open rate is ' +
    'the one number on this page read without a sentence around it')
    .toBeVisible({ timeout: 30_000 });

  // The eight tabs `PracharPage.jsx` mounts, and only those. `automations` is
  // deliberately absent — there is no engine behind it (11.11).
  const want = ['dashboard', 'campaigns', 'ads', 'sequences', 'templates',
    'unsubscribes', 'events', 'analytics'];
  const ids = new Set<string>();
  const strip = page.getByRole('tablist', { name: 'Prachar sections' });
  for (const id of await strip.locator('[role="tab"]').evaluateAll(
    (els) => els.map((e) => e.id.replace(/^mt-tab-/, '')))) ids.add(id);
  const more = page.getByRole('button', { name: /^More/ });
  if (await more.count()) {
    if ((await more.getAttribute('aria-expanded')) !== 'true') await more.click();
    const menu = page.getByRole('menu');
    if (await menu.count()) {
      for (const t of await menu.locator('[role="menuitem"] .mt__pop-en').allTextContents()) {
        ids.add(t.trim().toLowerCase().replace(/\s+/g, '-'));
      }
    }
    await page.keyboard.press('Escape').catch(() => {});
  }
  for (const id of want) {
    expect([...ids], `the "${id}" tab is on neither the strip nor the More menu`).toContain(id);
  }
  expect([...ids], 'an "automations" tab is mounted — `PracharPage.jsx` omits it ' +
    'deliberately because nothing fires a Prachar automation (see 11.11)')
    .not.toContain('automations');

  // Every tab renders, in words, whichever state it is in. Both branches assert:
  // an empty module must SAY it is empty, and a populated one must draw rows.
  // Nothing here is skipped on emptiness — that is how a 403'd module reported
  // green for weeks.
  const before = {
    templates: (await rowsOf(page, '/api/v1/prachar/templates')).length,
    campaigns: (await rowsOf(page, '/api/v1/prachar/campaigns')).length,
    sequences: (await rowsOf(page, '/api/v1/prachar/sequences')).length,
    events: (await rowsOf(page, '/api/v1/prachar/events')).length,
    unsubscribes: (await rowsOf(page, '/api/v1/prachar/unsubscribes')).length,
  };
  console.log(`  11.1 module state on entry: ${JSON.stringify(before)}`);

  const EMPTY: Record<string, RegExp> = {
    templates: /No templates yet/i,
    campaigns: /No campaigns yet/i,
    sequences: /No sequences yet/i,
    events: /No events yet/i,
    unsubscribes: /Nobody has opted out/i,
  };
  for (const [tab, re] of Object.entries(EMPTY)) {
    await prachar(page, tab);
    const panel = page.locator(`#mt-panel-${tab}`);
    await expect(panel).toBeVisible();
    if ((before as any)[tab] === 0) {
      await expect(panel.getByText(re).first(),
        `the ${tab} tab holds no rows and does not say so in words — a blank panel ` +
        'is indistinguishable from a broken one, which is the day-one failure ' +
        'Suite 00 exists to catch').toBeVisible({ timeout: 20_000 });
    } else {
      await expect(panel.locator('table.tbl, .pr__grid, .pr__steps').first(),
        `the ${tab} tab holds ${(before as any)[tab]} rows and drew no list`)
        .toBeVisible({ timeout: 20_000 });
    }
  }

  // The dashboard's funnel must not claim a measurement it does not have.
  await prachar(page, 'dashboard');
  await expect(page.locator('#mt-panel-dashboard').getByText(/Delivery funnel/i).first())
    .toBeVisible({ timeout: 20_000 });

  expect(con.uncaught, `uncaught exceptions while walking Prachar's tabs:\n  ${con.uncaught.join('\n  ')}`)
    .toEqual([]);
  expect(wire.filter((l) => / 5\d\d /.test(l)),
    `a write 5xx'd while merely opening tabs:${dump(page, wire)}`).toEqual([]);
});

/* ────────────────────────────────────────────────────────────────────────── */

test('11.2 the reach list — one client and 24 contacts on §3 addressing, typed into Graha', async ({ page }) => {
  const wire = watchWire(page);
  const con = watchConsole(page);
  await signIn(page);

  // ── This test reaches OUTSIDE Prachar, and says so ──────────────────────
  // Prachar has no contact form: its audience is `staging.graha_contacts` and
  // the only way a person creates one is Graha's own screen. Suite 07 set the
  // precedent (07.13 types a Graha client because a Manav notice needs one) and
  // the same reasoning holds here — with one addition that is this suite's
  // alone: the recipients ARE the safety boundary, so building them anywhere
  // other than the real form would be building the gate out of SQL.

  // 1 · the company. `graha_contacts.company` is written from it by trigger, and
  //     the client LINK is what keeps every send inside the ICAI clients-only
  //     gate without an override.
  await graha(page, 'clients');
  let clients = await rowsOf(page, '/api/v1/graha/clients?limit=200');
  let mine = clients.find((c) => c.name === CLIENT_NAME);
  let clientsTyped = 0;
  if (!mine) {
    await page.getByRole('button', { name: '+ Add Client' }).click();
    const panel = page.locator('.gr__panel');
    await expect(panel).toBeVisible();
    await panel.getByLabel('Company name').fill(CLIENT_NAME);
    await panel.getByLabel('Reference number').fill('S11-REACH');
    // ⚠ GSTIN LEFT BLANK, DELIBERATELY. The standing rule is that GSTIN/PAN/TAN
    // block nothing, and it has regressed more than once.
    await panel.getByLabel('City').fill('Ahmedabad');
    await panel.getByLabel('State').fill('Gujarat');
    await panel.getByLabel('Pincode').fill('380015');
    await writes(page, wire, '/graha/clients',
      () => panel.getByRole('button', { name: 'Create' }).click());
    clientsTyped = 1;
    clients = await rowsOf(page, '/api/v1/graha/clients?limit=200');
    mine = clients.find((c) => c.name === CLIENT_NAME);
  }
  expect(mine, `the "${CLIENT_NAME}" client was not created — every campaign in ` +
    'this suite is filtered to the contacts linked to it, so nothing may send ' +
    `without it.${dump(page, wire)}`).toBeTruthy();

  // 2 · the 24 people. Read first, create only the shortfall — §6.
  await graha(page, 'contacts');
  const existing = await rowsOf(page, '/api/v1/graha/contacts?limit=200');
  const have = new Set(existing.map((c) => String(c.email || '').toLowerCase()));
  let typed = 0;

  for (const r of REACH) {
    if (have.has(r.email.toLowerCase())) continue;
    await page.getByRole('button', { name: '+ Add Contact' }).click();
    const form = page.locator('form.gr__panel');
    await expect(form).toBeVisible();
    await gf(form, 'Name *').locator('input').fill(r.name);
    await gf(form, 'Type').locator('select').selectOption(r.type);
    await gf(form, 'Email').locator('input').fill(r.email);
    // A UK drama-range number: Ofcom reserves 07700 900000–900999 permanently
    // and they are unassignable, so a seeded number can never reach a person.
    // §3's reasoning — India has no reserved test range, so every well-formed
    // +91 number you invent is somebody's phone.
    await gf(form, 'Phone / Mobile').locator('input').fill(`+44 7700 9001${r.no}`);
    await gf(form, 'Designation').locator('input').fill('Finance contact');
    // GSTIN left blank on every one of the 24 — see above.
    await gf(form, 'Source').locator('input').fill(SOURCE);
    await pickByText(gf(form, 'Client / Company').locator('select'), 'client', CLIENT_NAME);
    const out = await writes(page, wire, '/graha/contacts',
      () => form.getByRole('button', { name: 'Create Contact' }).click());
    expect(String(out?.email || out?.data?.email || r.email).toLowerCase(),
      `the contact write echoed a different address than the one typed for ${r.name}`)
      .toBe(r.email.toLowerCase());
    typed += 1;
  }

  // 3 · the CANONICAL rows — suite rule 3. A POST echoes a few fields; the
  //     company comes from a trigger and the client link from a resolver, and
  //     neither is in the echo.
  const after = await rowsOf(page, '/api/v1/graha/contacts?limit=200');
  const list = after.filter((c) => REACH.some((r) => r.email.toLowerCase() === String(c.email || '').toLowerCase()));
  expect(list.length, `the reach list should hold ${REACH.length} contacts; the CRM ` +
    `returned ${list.length}.${dump(page, wire)}`).toBe(REACH.length);
  for (const c of list) {
    expect(String(c.company || ''),
      `${c.name} is not filed under "${CLIENT_NAME}", so the Company segment will ` +
      'not resolve to it and a send would target the wrong people').toBe(CLIENT_NAME);
    expect(String(c.source || ''), `${c.name} carries source "${c.source}"`).toBe(SOURCE);
  }

  // 4 · THE GATE ON THE FIXTURE ITSELF. If the address table is ever edited
  //     wrongly this fails here, before any campaign exists to send.
  const bad = list.map((c) => String(c.email)).filter((e) => !ALLOWED.test(e));
  expect(bad, `\n  ⚠ the reach list contains address(es) outside the allowed set:\n     ` +
    `${bad.join('\n     ')}\n     Nothing in this suite may mail them.\n`).toEqual([]);

  // 5 · and the segment axes must be OFFERED back, or the builder in 11.4
  //     cannot select them.
  const opts = await orgGet(page, '/api/v1/prachar/audience/options');
  expect(opts.sources, 'the audience builder does not offer the reach list\'s source')
    .toContain(SOURCE);
  expect(opts.companies, 'the audience builder does not offer the reach list\'s company')
    .toContain(CLIENT_NAME);

  console.log(`  11.2 §6 idempotence: ${clientsTyped} client typed, ${typed} contacts typed, ` +
    `${REACH.length - typed} already present`);
  expect(con.uncaught, `uncaught exceptions:\n  ${con.uncaught.join('\n  ')}`).toEqual([]);
});

/* ────────────────────────────────────────────────────────────────────────── */

test('11.3 twelve templates, every compliance class represented, and the linter quotes the phrase', async ({ page }) => {
  const wire = watchWire(page);
  const con = watchConsole(page);
  await signIn(page);
  await prachar(page, 'templates');

  // The classes come from the SERVER (`GET /compliance/classes`) so the form
  // cannot offer one the enforcer does not know. All six must be there, or the
  // "each compliance class represented" volume is unbuildable.
  const cls = await orgGet(page, '/api/v1/prachar/compliance/classes');
  const keys = (cls.classes || []).map((c: any) => c.key);
  for (const k of ['client_service', 'greeting', 'invitation', 'statutory_reminder',
    'knowledge_update', 'prospect_outreach']) {
    expect(keys, `the compliance-class endpoint does not offer "${k}"`).toContain(k);
  }

  const before = await rowsOf(page, '/api/v1/prachar/templates');
  const have = new Set(before.map((t) => t.name));
  let typed = 0;

  for (const t of TEMPLATES) {
    if (have.has(t.name)) continue;
    await page.getByRole('button', { name: '+ New template' }).first().click();
    const form = page.locator('.k-formpanel');
    await expect(form).toBeVisible();
    await fp(form, 'Template name').locator('input').fill(t.name);
    await fp(form, 'Category').locator('select').selectOption(t.category);
    const clsSel = fp(form, 'Compliance class').locator('select');
    await expect(clsSel, 'the compliance-class select never enabled — its options come ' +
      'from /compliance/classes and an empty list disables it').toBeEnabled({ timeout: 20_000 });
    await clsSel.selectOption(t.cls);

    // The BASIS is shown for an explicitly chosen class, and it is the most
    // important sentence on this screen: a member relying on `knowledge_update`
    // is entitled to know the inference is ours and not the Institute's.
    if (t.cls) {
      const inferred = ['statutory_reminder', 'knowledge_update'].includes(t.cls);
      await expect(form.getByText(inferred ? 'Reasoned, not sourced.' : 'Stated in the Code.').first(),
        `${t.name}: choosing "${t.cls}" did not state whether the basis is sourced or inferred`)
        .toBeVisible({ timeout: 15_000 });
    }

    await fp(form, 'Subject').locator('input').fill(t.subject);
    await fp(form, 'Body').locator('textarea').fill(t.body);
    await fp(form, 'Plain-text fallback').locator('textarea')
      .fill(t.body.replace(/\{\{(\w+)\}\}/g, '$1'));

    // The merge fields are DERIVED from the body, not typed. The old form sent
    // `variables: []` always, so the column was written empty on every template.
    const vars = [...new Set([...`${t.subject} ${t.body}`.matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)].map((m) => m[1]))];
    if (vars.length) {
      await expect(form.getByText(/Merge fields detected/).first(),
        `${t.name} uses ${vars.join(', ')} and the form did not detect them`).toBeVisible();
    }

    const out = await writes(page, wire, '/prachar/templates',
      () => form.getByRole('button', { name: 'Create template' }).click());

    // The save-time linter rides back on the 200 and is ADVISORY. The quoted
    // phrase is the feature: "contains promotional language" is not something
    // anyone can act on; «our award-winning team» with the rule beside it is a
    // single edit.
    if (t.lint) {
      const findings = out?.compliance?.findings || out?.data?.compliance?.findings || [];
      expect(findings.length, `${t.name} was written with the phrase "${t.lint}" and the ` +
        `compliance linter returned no finding at all. Response: ${JSON.stringify(out).slice(0, 400)}`)
        .toBeGreaterThan(0);
      const phrases = findings.map((f: any) => String(f.phrase || '').toLowerCase()).join(' | ');
      expect(phrases, `${t.name}: the linter fired but did not quote "${t.lint}" — it quoted: ${phrases}`)
        .toContain(t.lint);
      await expect(page.getByText(/reads? as advertising/i).first(),
        'the linter finding never reached the screen').toBeVisible({ timeout: 15_000 });
    }
    typed += 1;
  }

  // The CANONICAL rows — the class the SEND PATH will enforce, which for six of
  // the twelve is derived from the category and appears in no write echo.
  const after = await rowsOf(page, '/api/v1/prachar/templates');
  const byName = new Map(after.map((t) => [t.name, t]));
  for (const t of TEMPLATES) {
    const row = byName.get(t.name);
    expect(row, `template ${t.name} is not in the register.${dump(page, wire)}`).toBeTruthy();
    expect(String(row.category), `${t.name} filed under the wrong category`).toBe(t.category);
    if (t.cls) {
      expect(String(row.compliance_class || ''),
        `${t.name} was saved with compliance class "${row.compliance_class}"`).toBe(t.cls);
    } else {
      // '' becomes null so `CATEGORY_TO_CLASS` decides — sending '' would be a
      // CHECK violation, which is why the form maps it.
      expect(row.compliance_class ?? null,
        `${t.name} was left on "From the category" and the column is not null`).toBeNull();
    }
  }
  expect(after.filter((t) => TEMPLATES.some((x) => x.name === t.name)).length,
    '§4 asks for 12 marketing templates').toBe(12);

  // Every class appears at least once across the twelve, counting BOTH the
  // explicit column and the category mapping — because "represented" is about
  // what the send path enforces, not about which box was ticked.
  const represented = new Set(TEMPLATES.map((t) => t.effective).filter(Boolean));
  expect([...represented].sort(),
    'not every compliance class is represented across the twelve templates').toEqual(
    ['client_service', 'greeting', 'invitation', 'knowledge_update',
      'prospect_outreach', 'statutory_reminder']);

  // The screen must draw the class beside the category. An unclassified template
  // is one that cannot be sent to an audience containing anybody the firm does
  // not act for, and the absence is worth showing.
  const grid = page.locator('.pr__grid');
  await expect(grid.getByText('S11-T01').first()).toBeVisible({ timeout: 20_000 });
  await expect(grid.locator('article.pr__tpl').filter({ hasText: 'S11-T06' })
    .getByText('Prospect outreach').first(),
    'the prohibited class is not drawn on the template card').toBeVisible();

  console.log(`  11.3 §6 idempotence: ${typed} typed, ${12 - typed} already present`);
  expect(con.uncaught, `uncaught exceptions:\n  ${con.uncaught.join('\n  ')}`).toEqual([]);
});

/* ────────────────────────────────────────────────────────────────────────── */

test('11.4 six segments built in the real audience panel, each previewed and counted', async ({ page }) => {
  const wire = watchWire(page);
  const con = watchConsole(page);
  await signIn(page);

  // Precondition, asserted rather than assumed: the reach list must exist, or
  // every count below is a count of somebody else's contacts.
  const contacts = await rowsOf(page, '/api/v1/graha/contacts?limit=200');
  const reach = contacts.filter((c) => String(c.company || '') === CLIENT_NAME);
  expect(reach.length, `11.2 owns the reach list and it holds ${reach.length} of ` +
    `${REACH.length}. Nothing here may be counted until it is complete.`).toBe(REACH.length);

  await prachar(page, 'campaigns');
  await page.getByRole('button', { name: '+ Schedule' }).first().click();
  const form = page.locator('.k-formpanel');
  await expect(form).toBeVisible();
  const aud = form.locator('.pr__aud');
  await expect(aud, 'the campaign form has no audience panel — `audience_filter` was ' +
    'hard-coded to {} for this module\'s whole life and this control is the fix')
    .toBeVisible();

  // ── "Everyone" first, as a PREVIEW and never as a send ───────────────────
  // It is the default and it used to be silent. It must warn, in words, that it
  // reaches every contact in the organisation with a client record — and on this
  // org that includes Suite 04's 53 `@example.com` addresses, which is exactly
  // why no campaign in this file is left on it.
  await aud.getByRole('button', { name: 'Everyone' }).click();
  await expect(aud.getByText(/No filter set/i).first(),
    'the unfiltered audience does not warn that it goes to the whole organisation')
    .toBeVisible({ timeout: 20_000 });
  await expect
    .poll(async () => (await aud.locator('.pr__aud-sum').innerText()).trim(),
      { message: 'the reach sentence never resolved for the unfiltered audience', timeout: 40_000 })
    .toMatch(/contacts? match/i);
  const everyoneText = (await aud.locator('.pr__aud-sum').innerText()).trim();
  console.log(`  11.4 unfiltered audience (previewed, NEVER sent): ${everyoneText}`);

  // ── The six segments ─────────────────────────────────────────────────────
  await aud.getByRole('button', { name: 'A segment' }).click();
  const counted: Record<string, number> = {};

  for (const s of SEGMENTS) {
    // Reset all three controls each time — a segment is the WHOLE filter, and a
    // leftover Type from the previous one would silently narrow the next.
    await aud.getByRole('button', { name: 'Everyone' }).click();
    await aud.getByRole('button', { name: 'A segment' }).click();

    if (s.type) await fp(aud, 'Contact type').locator('select').selectOption(s.type);
    if (s.source) await pickByText(fp(aud, 'Source').locator('select'), 'source', s.source);
    if (s.company) await fp(aud, 'Company').locator('input').fill(s.company);

    // The preview is debounced 350ms and goes through the SAME `_resolve_audience`
    // the send path uses, which is the whole reason it is trustworthy.
    await expect
      .poll(async () => {
        const t = await aud.locator('.pr__aud-sum').innerText();
        const m = /^(\d+)\s+contacts?\s+match/i.exec(t.trim());
        return m ? Number(m[1]) : -1;
      }, {
        message: `segment ${s.key} (${s.label}) never settled on a count`,
        timeout: 40_000,
      })
      .toBe(s.expect);

    counted[s.key] = s.expect;

    // THE ICAI LINE, said even at zero. "0 non-clients" is the reassurance a
    // partner wants before pressing send; a line that appears only on failure is
    // a line nobody trusts.
    await expect(aud.getByText(/Existing clients only/i).first(),
      `segment ${s.key}: the panel does not state the clients-only gate`).toBeVisible();
    await expect(aud.getByText(new RegExp(`Existing clients only — ${s.expect} of ${s.expect}`)).first(),
      `segment ${s.key}: the clients-only line does not read ${s.expect} of ${s.expect}`)
      .toBeVisible({ timeout: 15_000 });

    // And the sample table lists people, by name and address, never by id.
    const sample = aud.locator('table.tbl').first();
    await expect(sample, `segment ${s.key} drew no sample of who it reaches`).toBeVisible();
    const shown = await sample.locator('tbody tr').count();
    expect(shown, `segment ${s.key}: the sample shows ${shown} rows for ${s.expect} matches`)
      .toBe(Math.min(8, s.expect));
    const addrs = await sample.locator('tbody tr td:nth-child(2)').allTextContents();
    const bad = addrs.map((a) => a.trim()).filter((a) => a && !ALLOWED.test(a));
    expect(bad, `segment ${s.key} previews address(es) outside the allowed set: ${bad.join(', ')}`)
      .toEqual([]);
  }

  console.log(`  11.4 six segments counted: ${JSON.stringify(counted)}`);
  expect(Object.keys(counted).length, '§4 asks for 6 segments').toBe(6);

  // ⚠ THE ICAI OVERRIDE PATH IS UNREACHABLE FROM THIS SCREEN, BY DESIGN.
  // `client_only` defaults true and `AudienceFilter.jsx` states there is
  // deliberately no control to turn it off, so `icai_block` can never become
  // true through the browser and the `window.prompt` basis flow in
  // `CampaignsTab.send()` cannot be reached by a user. Asserted as an ABSENCE
  // rather than skipped, so the day a toggle appears this goes red.
  expect(await aud.getByRole('checkbox').count(),
    'the audience panel has grown a checkbox — if it turns the clients-only gate ' +
    'off, the ICAI refusal and its override are now reachable and need their own test')
    .toBe(0);

  await page.getByRole('button', { name: 'Cancel' }).first().click();
  expect(con.uncaught, `uncaught exceptions:\n  ${con.uncaught.join('\n  ')}`).toEqual([]);
});

/* ────────────────────────────────────────────────────────────────────────── */

test('11.5 twelve campaigns created from templates, and the calendar reschedules one', async ({ page }) => {
  const wire = watchWire(page);
  const con = watchConsole(page);
  const dialogs = acceptDialogs(page);
  await signIn(page);
  await prachar(page, 'campaigns');

  const templates = await rowsOf(page, '/api/v1/prachar/templates');
  expect(templates.filter((t) => t.name.startsWith('S11-T')).length,
    '11.3 owns the templates and they are not all there').toBe(12);

  const before = await rowsOf(page, '/api/v1/prachar/campaigns');
  const have = new Map(before.map((c) => [c.name, c]));
  let typed = 0;

  for (const c of CAMPAIGNS) {
    if (have.has(c.name)) continue;
    await page.getByRole('button', { name: '+ Schedule' }).first().click();
    const form = page.locator('.k-formpanel');
    await expect(form).toBeVisible();

    // The template LINK, not the copied text. `template_id` is what the send
    // path reads `compliance_class` off, so a campaign started from a template
    // stays classified even after its subject and body are edited here.
    await pickByText(fp(form, 'Start from a template').locator('select'), 'template', c.template);
    await fp(form, 'Campaign name').locator('input').fill(c.name);
    await fp(form, 'Subject line').locator('input').fill(c.subject);
    await fp(form, 'Channel').locator('select').selectOption(c.channel);
    // ⚠ `DateInput`, driven by opening the calendar and clicking the day — this
    // product has no native date input anywhere and Playwright cannot fill the
    // hidden one.
    await setDate(form, 'Send at', inDays(c.inDays));

    const s = seg(c.segment);
    const aud = form.locator('.pr__aud');
    await aud.getByRole('button', { name: 'A segment' }).click();
    if (s.type) await fp(aud, 'Contact type').locator('select').selectOption(s.type);
    if (s.source) await pickByText(fp(aud, 'Source').locator('select'), 'source', s.source);
    if (s.company) await fp(aud, 'Company').locator('input').fill(s.company);
    // Wait for the REFETCH, not just the keystroke — suite rule 5. The count is
    // what tells you whether to save the filter at all.
    await expect
      .poll(async () => {
        const t = await aud.locator('.pr__aud-sum').innerText();
        const m = /^(\d+)\s+contacts?\s+match/i.exec(t.trim());
        return m ? Number(m[1]) : -1;
      }, { message: `${c.name}: the audience never settled on ${s.expect}`, timeout: 40_000 })
      .toBe(s.expect);

    await fp(form, 'Body').locator('textarea').fill(c.body);
    const out = await writes(page, wire, '/prachar/campaigns',
      () => form.getByRole('button', { name: 'Create campaign' }).click());
    expect(String(out?.name || out?.data?.name || ''),
      `the campaign write echoed a different name than the one typed`).toBe(c.name);
    typed += 1;
  }

  // The CANONICAL rows. A POST echoes a few fields; `audience_filter` survives
  // a round trip through jsonb and `channel` decides whether a send is even
  // attempted, so both are read back rather than trusted.
  const after = await rowsOf(page, '/api/v1/prachar/campaigns');
  const byName = new Map(after.map((c) => [c.name, c]));
  for (const c of CAMPAIGNS) {
    const row = byName.get(c.name);
    expect(row, `campaign ${c.name} is not in the register.${dump(page, wire)}`).toBeTruthy();
    expect(String(row.channel), `${c.name} saved on the wrong channel`).toBe(c.channel);
    expect(row.template_id, `${c.name} lost its template link, so the send path cannot ` +
      'read a compliance class off it').toBeTruthy();
    const f = typeof row.audience_filter === 'string'
      ? JSON.parse(row.audience_filter) : (row.audience_filter || {});
    const s = seg(c.segment);
    expect(f.type ?? null, `${c.name}: the segment's contact type did not persist`).toBe(s.type ?? null);
    expect(f.source ?? null, `${c.name}: the segment's source did not persist`).toBe(s.source ?? null);
    expect(f.company ?? null, `${c.name}: the segment's company did not persist`).toBe(s.company ?? null);
    expect(Object.keys(f).length, `${c.name}: the audience filter is EMPTY, which means ` +
      'this campaign targets every contact in the organisation — including the 53 ' +
      '@example.com addresses. That is the hard-coded `{}` this control exists to fix.')
      .toBeGreaterThan(0);
    expect(row.scheduled_at, `${c.name} carries no send date`).toBeTruthy();
  }

  // ── The calendar, and the drag that has to SAVE ──────────────────────────
  // A drag that animates and does not persist is the exact defect a screenshot
  // cannot distinguish from success, so the assertion is on the canonical row's
  // `scheduled_at`, never on where the pill appears.
  await prachar(page, 'campaigns');
  await expect(page.locator('.pr__cal').first(), 'the campaigns tab drew no month calendar')
    .toBeVisible({ timeout: 30_000 });

  const target = byName.get('S11-D1');
  const from = new Date(target.scheduled_at);
  const to = new Date(from.getFullYear(), from.getMonth(), from.getDate() + 1);
  // Both days must be in the month on screen, so the pill and the target cell
  // are both rendered. D1 is 10 days out and D3 is 12, so a month boundary is
  // possible — page the calendar to the pill's own month first.
  const monthTitle = from.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
  for (let i = 0; i < 3; i++) {
    if ((await page.locator('.pr__cal-m').innerText()).trim() === monthTitle) break;
    await page.getByRole('button', { name: 'Next →' }).click();
    await settle(page);
  }
  const pill = page.locator('.pr__pill').filter({ hasText: 'S11-D1' }).first();
  await expect(pill, 'S11-D1 is not on the calendar — a campaign with a date that the ' +
    'grid does not draw is a campaign nobody can see').toBeVisible({ timeout: 20_000 });

  const cells = page.locator('.pr__cal-d:not(.is-pad)');
  const targetCell = cells.filter({ has: page.locator(`.pr__cal-n:text-is("${to.getDate()}")`) }).first();
  await expect(targetCell).toBeVisible();

  const patched = await writes(page, wire, /\/prachar\/campaigns\/[0-9a-f-]+$/,
    () => pill.dragTo(targetCell));
  expect(patched, 'the drag produced no PATCH').toBeTruthy();

  const moved = await orgGet(page, `/api/v1/prachar/campaigns/${target.id}`);
  const movedTo = new Date((moved.data || moved).scheduled_at);
  expect(movedTo.getDate(), `S11-D1 was dragged onto the ${to.getDate()}th and the ROW ` +
    `still says the ${movedTo.getDate()}th — the drag animated and did not save.${dump(page, wire)}`)
    .toBe(to.getDate());
  // A sent campaign's date is fixed (`PATCH` refuses once it is sending or
  // sent), so those pills must not be draggable. Checked as a property of the
  // markup rather than by attempting a drag that should fail.
  const fixed = await page.locator('.pr__pill[draggable="false"]').count();
  console.log(`  11.5 calendar: ${await page.locator('.pr__pill').count()} pills, ` +
    `${fixed} of them not draggable`);

  // Month · Week · List all render, and the channel chips filter.
  for (const v of ['Week', 'List', 'Month']) {
    await page.getByRole('button', { name: v, exact: true }).click();
    await settle(page);
  }
  await page.getByRole('button', { name: 'List', exact: true }).click();
  await expect(page.locator('table.tbl').first(), 'the List view drew no table')
    .toBeVisible({ timeout: 20_000 });
  // The Segment column is next to Channel because the two together are the whole
  // of "where does this go". A list that showed neither is how nobody noticed
  // that every row said the same thing.
  await expect(page.locator('.pr__seg-c').first(), 'the campaign list has no Segment column')
    .toBeVisible();
  const segTexts = await page.locator('.pr__seg-c').allTextContents();
  expect(segTexts.filter((t) => /Includes non-clients/.test(t)),
    'a campaign in the list reports that it includes non-clients').toEqual([]);

  console.log(`  11.5 §6 idempotence: ${typed} typed, ${CAMPAIGNS.length - typed} already present` +
    `${dialogs.length ? `; dialogs accepted: ${dialogs.length}` : ''}`);
  expect(con.uncaught, `uncaught exceptions:\n  ${con.uncaught.join('\n  ')}`).toEqual([]);
});

/* ────────────────────────────────────────────────────────────────────────── */

test('11.6 six campaigns SENT — every recipient enumerated and gated first', async ({ page }) => {
  const wire = watchWire(page);
  const con = watchConsole(page);
  const dialogs = acceptDialogs(page);
  await signIn(page);

  // ── PRECONDITION, and it is a refusal rather than a skip ─────────────────
  const contacts = await rowsOf(page, '/api/v1/graha/contacts?limit=200');
  const reach = contacts.filter((c) => String(c.company || '') === CLIENT_NAME);
  expect(reach.length, `11.2 owns the reach list and it holds ${reach.length} of ` +
    `${REACH.length}. NOTHING MAY SEND until it is complete.`).toBe(REACH.length);
  const reachBad = reach.map((c) => String(c.email)).filter((e) => !ALLOWED.test(e));
  expect(reachBad, `the reach list contains address(es) outside the allowed set: ` +
    `${reachBad.join(', ')}. NOTHING MAY SEND.`).toEqual([]);

  const campaigns = await rowsOf(page, '/api/v1/prachar/campaigns');
  const byName = new Map(campaigns.map((c) => [c.name, c]));

  const outboundBefore = (await outboundCampaignRows(page)).length;
  let sent = 0;
  let already = 0;
  let recipients = 0;

  // C7 is 11.7's — it is the campaign that must exclude the opt-outs, and
  // sending it here would spend the proof before anyone has opted out.
  for (const c of SENT_CAMPAIGNS.filter((x) => x.name !== 'S11-C7')) {
    const row = byName.get(c.name);
    expect(row, `campaign ${c.name} is missing — 11.5 owns it`).toBeTruthy();

    if (row.status === 'sent' || row.status === 'sending') {
      // §6. A campaign already sent is NOT re-sent: the server refuses, and
      // re-sending would double the mail. Verify the terminal state instead.
      const stats = await orgGet(page, `/api/v1/prachar/campaigns/${row.id}/stats`);
      expect(Number(stats.sent), `${c.name} reports status "${row.status}" and ` +
        `${stats.sent} delivered rows`).toBe(c.recipients);
      already += 1;
      recipients += c.recipients;
      continue;
    }

    // ── THE GATE ─────────────────────────────────────────────────────────
    const addrs = await gateAudience(page, row.id, c.name, c.recipients);

    // ── THE SEND, from the real detail screen ────────────────────────────
    await prachar(page, 'campaigns');
    await page.getByRole('button', { name: 'List', exact: true }).click();
    await settle(page);
    await page.getByRole('button', { name: c.name, exact: true }).first().click();
    await expect(page.getByRole('heading', { name: c.name }),
      `the campaign detail for ${c.name} did not open`).toBeVisible({ timeout: 20_000 });

    // The audience panel must agree with the gate before the button is pressed.
    await expect(page.getByText(/will receive this/i).first(),
      `${c.name}: the detail screen does not say how many people will receive it`)
      .toBeVisible({ timeout: 30_000 });

    const dialogsBefore = dialogs.length;
    const out = await writes(page, wire, /\/prachar\/campaigns\/[0-9a-f-]+\/send$/,
      () => page.getByRole('button', { name: 'Send now' }).click());

    // The confirm quotes who RECEIVES it, not who matched. The old copy quoted
    // the pre-suppression count, so a marketer agreed to 128 and 116 were sent.
    expect(dialogs.length, `${c.name}: Send now did not raise a confirmation at all`)
      .toBeGreaterThan(dialogsBefore);
    const confirm = dialogs[dialogsBefore];
    expect(confirm, `${c.name}: the confirmation does not name the recipient count`)
      .toContain(`${c.recipients} `);
    expect(confirm, `${c.name}: the confirmation does not name the segment`)
      .toMatch(/Audience:/);

    expect(Number(out.recipients), `${c.name}: the send reports ${out.recipients} recipients`)
      .toBe(c.recipients);
    expect(out.override_recorded, `${c.name} went out under an ICAI override, which no ` +
      'audience in this suite should ever need').toBeFalsy();
    expect(String(out?.compliance?.code || ''), `${c.name}: the compliance verdict was ` +
      `"${out?.compliance?.code}"`).toBe('allowed_clients_only');

    // ── DISPATCH IS ASYNCHRONOUS — `asyncio.create_task(_dispatch())`. Poll
    //    the per-recipient rows rather than reading them once.
    await expect
      .poll(async () => {
        const s = await orgGet(page, `/api/v1/prachar/campaigns/${row.id}/stats`);
        return Number(s.sent || 0);
      }, {
        message: `${c.name}: the dispatch never marked ${c.recipients} recipients sent`,
        timeout: 180_000,
        intervals: [2000],
      })
      .toBe(c.recipients);

    const final = await orgGet(page, `/api/v1/prachar/campaigns/${row.id}`);
    const fr = final.data || final;
    // ZERO DELIVERED IS NOT 'sent'. The route writes 'suppressed' with
    // `sent_at=NULL` when nothing left the building, and that branch is the one
    // that catches a gate nobody noticed was on.
    expect(String(fr.status), `${c.name} finished in status "${fr.status}" — 'suppressed' ` +
      'means the outbound gate refused every message and NOBODY received it').toBe('sent');
    expect(fr.sent_at, `${c.name} is 'sent' with no sent_at`).toBeTruthy();

    sent += 1;
    recipients += c.recipients;
    console.log(`  11.6 ${c.name}: ${c.recipients} recipients, all gated — ` +
      `${addrs.filter((e) => /simulator/.test(e)).length} simulator, ` +
      `${addrs.filter((e) => /gmail/.test(e)).length} gmail tags`);
  }

  // ── THE EVIDENCE IS THE outbound_log ROW, NEVER A RETURN VALUE ───────────
  // `send_email` returns True when the gate suppresses; 1,562 rows once read
  // `sent` against 1,562 suppressed. A DELTA, because a list endpoint caps.
  const outboundAfter = await outboundCampaignRows(page);
  const delta = outboundAfter.length - outboundBefore;
  const expectedDelta = SENT_CAMPAIGNS
    .filter((x) => x.name !== 'S11-C7')
    .filter((x) => {
      const r = byName.get(x.name);
      return !(r.status === 'sent' || r.status === 'sending');
    })
    .reduce((n, x) => n + x.recipients, 0);
  expect(delta, `the campaigns reported ${expectedDelta} recipients and staging.outbound_log ` +
    `grew by ${delta}. The row is the evidence, not the return value.`).toBe(expectedDelta);

  const statuses = new Set(outboundAfter.map((r) => String(r.status)));
  expect([...statuses].filter((s) => s === 'suppressed'),
    'campaign mail was SUPPRESSED — the send reported success and nothing left the building')
    .toEqual([]);
  const outBad = outboundAfter.map((r) => String(r.target || '')).filter((t) => t && !ALLOWED.test(t));
  expect(outBad, `⚠ the outbound log records campaign mail to address(es) outside the ` +
    `allowed set: ${outBad.slice(0, 10).join(', ')}`).toEqual([]);

  // No open, click or bounce figure is asserted as measured. Nothing in this
  // product receives engagement events, so the screens must say so rather than
  // print a confident zero.
  await prachar(page, 'campaigns');
  await page.getByRole('button', { name: 'List', exact: true }).click();
  await settle(page);
  await page.getByRole('button', { name: 'S11-C1', exact: true }).first().click();
  await expect(page.getByText('Not measured').first(),
    'the delivery table prints a number for Opened — nothing in this product ' +
    'receives an open event, so a 0 there reads as "we measured, and nobody opened it"')
    .toBeVisible({ timeout: 30_000 });

  console.log(`  11.6 §6 idempotence: ${sent} sent, ${already} already sent; ` +
    `${recipients} recipients across ${SENT_CAMPAIGNS.length - 1} campaigns`);
  expect(con.uncaught, `uncaught exceptions:\n  ${con.uncaught.join('\n  ')}`).toEqual([]);
});

/* ────────────────────────────────────────────────────────────────────────── */

test('11.7 six opt-outs, then the next campaign excludes them — proven per address', async ({ page }) => {
  const wire = watchWire(page);
  const con = watchConsole(page);
  const dialogs = acceptDialogs(page);
  await signIn(page);

  // ── THE CONTROLS FIRST, BEFORE THE ORDERING GATE BELOW ──────────────────
  //
  // A missing control is a FAILURE, never a skip — suite rule 1, and the rule
  // that let the e-sign journey report green for weeks while the module 403'd.
  // The ordering precondition below can legitimately hold this test back on a
  // run where 11.6 is blocked, and if it ran FIRST it would hide a missing
  // opt-out form behind a sequencing message. So the three controls are proved
  // to exist here, on the real screen, before anything else is judged — and
  // nothing is typed into them yet.
  await prachar(page, 'unsubscribes');
  const addBar = page.locator('.pr__inline').first();
  await expect(addBar.getByLabel('Email address to suppress'),
    'the opt-out tab has no address box').toBeVisible({ timeout: 30_000 });
  await expect(addBar.getByLabel('Reason'), 'the opt-out tab has no reason picker').toBeVisible();
  await expect(addBar.getByRole('button', { name: 'Add', exact: true }),
    'the opt-out tab has no Add button').toBeEnabled();
  // And the sentence that makes the list mean something to the person reading
  // it: every send is filtered against it.
  await expect(page.getByText(/Every campaign send is filtered against this list/i).first(),
    'the opt-out tab does not say what the list does').toBeVisible();

  // ── ⚠ THE ORDER IS A PRECONDITION, NOT A CONVENIENCE ────────────────────
  //
  // Suppressing six people before 11.6 has written to them would silently move
  // every one of the first six campaigns from 24 recipients to 18 — and the
  // next run would then report a RECIPIENT SHORTFALL against a product that
  // did exactly what it was told. A suite that can corrupt its own volume
  // sheet by running in a different order is a suite whose numbers mean
  // nothing, so this refuses instead of proceeding.
  //
  // It is asserted from the CANONICAL rows, not from a flag this file sets:
  // the six campaigns must already be `sent`.
  const pre = await rowsOf(page, '/api/v1/prachar/campaigns');
  const owed = SENT_CAMPAIGNS.filter((c) => c.name !== 'S11-C7')
    .filter((c) => {
      const r = pre.find((x) => x.name === c.name);
      return !r || (r.status !== 'sent' && r.status !== 'sending');
    })
    .map((c) => c.name);
  expect(owed, `11.6 owns the first six sends and ${owed.length} of them have not gone ` +
    `out yet (${owed.join(', ')}). Opting six people out NOW would take those ` +
    'campaigns from 24 recipients to 18 and make every later run report a ' +
    'shortfall the product did not cause. Nothing is suppressed until 11.6 is green.')
    .toEqual([]);

  await prachar(page, 'unsubscribes');

  const before = await rowsOf(page, '/api/v1/prachar/unsubscribes');
  const have = new Set(before.map((u) => String(u.email || '').toLowerCase()));
  let typed = 0;

  for (const email of OPT_OUT) {
    if (have.has(email.toLowerCase())) continue;
    const bar = page.locator('.pr__inline').first();
    await bar.getByLabel('Email address to suppress').fill(email);
    await bar.getByLabel('Reason').selectOption('requested');
    // ⚠ Scoped to the add bar. `Add` is a two-letter name and an unscoped
    // `getByRole` resolves in DOM order — suite rule 6, and the shell has its
    // own buttons above this panel.
    await writes(page, wire, '/prachar/unsubscribes',
      () => bar.getByRole('button', { name: 'Add', exact: true }).click());
    typed += 1;
  }

  const after = await rowsOf(page, '/api/v1/prachar/unsubscribes');
  const list = after.map((u) => String(u.email).toLowerCase());
  for (const e of OPT_OUT) {
    expect(list, `${e} is not on the opt-out list.${dump(page, wire)}`).toContain(e.toLowerCase());
  }
  expect(after.length, '§4 asks for 6 unsubscribes').toBe(6);

  // The screen draws them, with the reason, and says how many are suppressed.
  await expect(page.getByText(/6 addresses suppressed/i).first(),
    'the opt-out list does not report its own size').toBeVisible({ timeout: 20_000 });

  // ── PROOF ONE: the audience shrinks by exactly six ───────────────────────
  // Same segment as S11-C1, so the ONLY difference between 24 and 18 is the
  // suppression list. Asserted BEFORE the send, on the same route the send uses.
  const campaigns = await rowsOf(page, '/api/v1/prachar/campaigns');
  const c1 = campaigns.find((c) => c.name === 'S11-C1');
  const c7 = campaigns.find((c) => c.name === 'S11-C7');
  expect(c7, 'S11-C7 is missing — 11.5 owns it').toBeTruthy();

  const a7 = await orgGet(page, `/api/v1/prachar/campaigns/${c7.id}/audience`);
  expect(Number(a7.matched), 'the segment should still MATCH 24 people — an opt-out is a ' +
    'suppression, not a deletion').toBe(24);
  expect(Number(a7.unsubscribed), 'the audience does not report six people as unsubscribed')
    .toBe(6);
  expect(Number(a7.will_receive), 'the audience does not drop to 18').toBe(18);
  const willGet = (a7.contacts || []).map((c: any) => String(c.email).toLowerCase());
  for (const e of OPT_OUT) {
    expect(willGet, `${e} opted out and is still IN the audience the send will use`)
      .not.toContain(e.toLowerCase());
  }

  // ── PROOF TWO: the send itself ───────────────────────────────────────────
  const sentBefore: Record<string, number> = {};
  for (const e of OPT_OUT) sentBefore[e] = (await outboundTo(page, e)).length;

  let sent = 0;
  let already = 0;
  if (c7.status === 'sent' || c7.status === 'sending') {
    already = 1;
  } else {
    await gateAudience(page, c7.id, 'S11-C7', 18);
    await prachar(page, 'campaigns');
    await page.getByRole('button', { name: 'List', exact: true }).click();
    await settle(page);
    await page.getByRole('button', { name: 'S11-C7', exact: true }).first().click();
    await expect(page.getByRole('heading', { name: 'S11-C7' })).toBeVisible({ timeout: 20_000 });

    const dialogsBefore = dialogs.length;
    const out = await writes(page, wire, /\/prachar\/campaigns\/[0-9a-f-]+\/send$/,
      () => page.getByRole('button', { name: 'Send now' }).click());
    expect(dialogs[dialogsBefore], 'the confirmation quoted the pre-suppression count — a ' +
      'marketer who agrees to 24 and reaches 18 was told the wrong number')
      .toContain('18 ');
    expect(Number(out.recipients), 'S11-C7 sent to the wrong number of people').toBe(18);
    expect(Number(out.skipped_unsubscribed), 'the send did not report the six it skipped')
      .toBe(6);

    await expect
      .poll(async () => Number((await orgGet(page, `/api/v1/prachar/campaigns/${c7.id}/stats`)).sent || 0),
        { message: 'S11-C7 never finished dispatching', timeout: 180_000, intervals: [2000] })
      .toBe(18);
    sent = 1;
  }

  // ── PROOF THREE, and it is the only one that is not a count ──────────────
  // Every opted-out address, individually, against the org's own outbound log:
  // it must have received NOTHING since it opted out.
  for (const e of OPT_OUT) {
    const now = (await outboundTo(page, e)).length;
    expect(now, `⚠ ${e} opted out and the outbound log shows ${now - sentBefore[e]} campaign ` +
      'message(s) sent to them afterwards. The row is the evidence.')
      .toBe(sentBefore[e]);
  }

  // And a contact who never opted out DID receive it, or "nobody got it" would
  // satisfy the assertion above just as well.
  const control = REACH.find((r) => !OPT_OUT.includes(r.email))!;
  const got = await outboundTo(page, control.email);
  expect(got.length, `the control address ${control.email} received nothing at all, so the ` +
    'exclusion proof above is vacuous').toBeGreaterThan(0);

  console.log(`  11.7 §6 idempotence: ${typed} opt-outs typed, ${6 - typed} already present; ` +
    `S11-C7 ${sent ? 'sent' : 'already sent'} to 18 of 24`);
  expect(con.uncaught, `uncaught exceptions:\n  ${con.uncaught.join('\n  ')}`).toEqual([]);
});

/* ────────────────────────────────────────────────────────────────────────── */

test('11.8 three sequences, twelve steps, twenty-four enrolments; exit-on-reply round-trips', async ({ page }) => {
  const wire = watchWire(page);
  const con = watchConsole(page);
  const dialogs = acceptDialogs(page);
  await signIn(page);
  await prachar(page, 'sequences');

  const before = await rowsOf(page, '/api/v1/prachar/sequences');
  const have = new Map(before.map((s) => [s.name, s]));
  let typed = 0;

  for (const s of SEQUENCES) {
    if (have.has(s.name)) continue;
    await page.getByRole('button', { name: '+ New sequence' }).first().click();
    const form = page.locator('.k-formpanel');
    await expect(form).toBeVisible();
    await fp(form, 'Sequence name').locator('input').fill(s.name);
    await fp(form, 'What it is for').locator('textarea').fill(s.description);
    // THE FIELD THAT WAS UNREACHABLE. `SequenceCreate` has always carried
    // `exit_on_reply` and the old form sent `{name, channel, status}`, so
    // pydantic dropped it and the most consequential setting on a drip sequence
    // could neither be seen nor changed.
    const tick = form.locator('label.pr__check input[type="checkbox"]');
    await expect(tick, 'there is no "stop sending once they reply" control').toBeVisible();
    if ((await tick.isChecked()) !== s.exitOnReply) await tick.setChecked(s.exitOnReply);
    await writes(page, wire, '/prachar/sequences',
      () => form.getByRole('button', { name: 'Create sequence' }).click());
    typed += 1;
  }

  const seqs = await rowsOf(page, '/api/v1/prachar/sequences');
  const byName = new Map(seqs.map((s) => [s.name, s]));
  expect(seqs.filter((s) => s.name.startsWith('S11-SEQ')).length, '§4 asks for 3 sequences').toBe(3);

  // The canonical row, not the checkbox: the flag decides what happens to a
  // person who writes back.
  for (const s of SEQUENCES) {
    expect(Boolean(byName.get(s.name).exit_on_reply),
      `${s.name}: exit_on_reply did not round-trip`).toBe(s.exitOnReply);
  }
  // …and it must be RENDERED, because a setting nobody can read is a setting
  // nobody can rely on.
  const table = page.locator('table.tbl').first();
  await expect(table.locator('tr').filter({ hasText: 'S11-SEQ-1' }).getByText('Stops').first(),
    'the sequence list does not say what happens on a reply').toBeVisible({ timeout: 20_000 });
  await expect(table.locator('tr').filter({ hasText: 'S11-SEQ-2' }).getByText('Keeps sending').first(),
    'a sequence with exit_on_reply off does not say so').toBeVisible();

  let steps = 0;
  let enrolled = 0;

  for (const s of SEQUENCES) {
    const row = byName.get(s.name);
    await prachar(page, 'sequences');
    await page.locator('table.tbl tr').filter({ hasText: s.name })
      .getByRole('button', { name: 'Open' }).click();
    await expect(page.getByRole('heading', { name: s.name })).toBeVisible({ timeout: 20_000 });

    const full = await orgGet(page, `/api/v1/prachar/sequences/${row.id}`);
    const existingSteps = new Set((full.steps || full.data?.steps || []).map((x: any) => Number(x.step_order)));

    for (const st of s.steps) {
      if (existingSteps.has(st.order)) { steps += 1; continue; }
      await page.getByRole('button', { name: '+ Add step' }).click();
      const sf = page.locator('.k-formpanel').last();
      await expect(sf).toBeVisible();
      await fp(sf, 'Position').locator('input').fill(String(st.order));
      await fp(sf, 'Wait before sending').locator('input').fill(String(st.delay));
      // ⚠ The step channels are NOT the campaign channels. `add_step` validates
      // against ("email","whatsapp","call_task","manual") and 400s on anything
      // else; the old form offered SMS, so every step saved with it failed with
      // a toast that said only "400".
      await fp(sf, 'Channel').locator('select').selectOption(st.channel);
      if (st.subject) await fp(sf, 'Subject').locator('input').fill(st.subject);
      if (st.body) await fp(sf, 'Body').locator('textarea').fill(st.body);
      await writes(page, wire, /\/prachar\/sequences\/[0-9a-f-]+\/steps$/,
        () => sf.getByRole('button', { name: 'Save step' }).click());
      steps += 1;
    }

    // ── ENROLMENT ────────────────────────────────────────────────────────
    // ⚠ The picker lists EVERY contact in the CRM, including Suite 04's 53
    // `@example.com` addresses. Only the reach list is selected, by the option
    // VALUE resolved from the contact register — because an active sequence
    // whose cron is ever re-armed would mail whatever is enrolled in it.
    const contacts = await rowsOf(page, '/api/v1/graha/contacts?limit=200');
    const wanted = s.enrol.map((no) => {
      const r = REACH.find((x) => x.no === no)!;
      const c = contacts.find((x) => String(x.email || '').toLowerCase() === r.email.toLowerCase());
      expect(c, `${r.email} is not in the CRM — 11.2 owns the reach list`).toBeTruthy();
      return { id: String(c.id), email: r.email };
    });
    const bad = wanted.map((w) => w.email).filter((e) => !ALLOWED.test(e));
    expect(bad, `sequence ${s.name} would enrol address(es) outside the allowed set: ${bad.join(', ')}`)
      .toEqual([]);

    const already = new Set(((full.enrollments || full.data?.enrollments || []) as any[])
      .map((e) => String(e.contact_email || '').toLowerCase()));
    const todo = wanted.filter((w) => !already.has(w.email.toLowerCase()));
    if (todo.length) {
      const picker = page.getByLabel('Contacts to enrol');
      await expect
        .poll(async () => await picker.locator('option').count(),
          { message: 'the enrolment picker never loaded a contact', timeout: 30_000 })
        .toBeGreaterThan(0);
      await picker.selectOption(todo.map((w) => w.id));
      const out = await writes(page, wire, /\/prachar\/sequences\/[0-9a-f-]+\/enroll$/,
        () => page.getByRole('button', { name: /^Enrol/ }).click());
      expect(Number(out.enrolled), `${s.name}: enrolled ${out.enrolled} of ${todo.length}`)
        .toBe(todo.length);
      expect(Number(out.rejected || 0), `${s.name}: the server rejected ${out.rejected} contacts ` +
        'as belonging to another organisation').toBe(0);
    }
    enrolled += wanted.length;

    // The canonical rows: eight people, each on step 1, each with the address
    // the CRM holds.
    const back = await orgGet(page, `/api/v1/prachar/sequences/${row.id}`);
    const rows = (back.enrollments || back.data?.enrollments || []) as any[];
    expect(rows.length, `${s.name} holds ${rows.length} enrolments.${dump(page, wire)}`).toBe(8);
    const enrolBad = rows.map((e) => String(e.contact_email || '')).filter((e) => e && !ALLOWED.test(e));
    expect(enrolBad, `${s.name} has enrolled address(es) outside the allowed set: ${enrolBad.join(', ')}`)
      .toEqual([]);

    // The steps must be on screen, in order, with their delay in words.
    await expect(page.locator('.pr__step').first(), `${s.name} drew no steps`)
      .toBeVisible({ timeout: 20_000 });
    expect(await page.locator('.pr__step').count(), `${s.name} should have 4 steps`).toBe(4);

    // ── ACTIVATE / PAUSE / ARCHIVE — the lifecycle a person can drive ─────
    if (s.activate) {
      const btn = page.getByRole('button', { name: 'Activate' });
      if (await btn.count()) {
        await writes(page, wire, /\/prachar\/sequences\/[0-9a-f-]+$/, () => btn.click());
      }
      const now = await orgGet(page, `/api/v1/prachar/sequences/${row.id}`);
      expect(String((now.sequence || now.data?.sequence).status),
        `${s.name} did not become active`).toBe('active');
      // Pause and resume, so the two controls are exercised and the enrolments
      // are seen to follow the sequence.
      await writes(page, wire, /\/prachar\/sequences\/[0-9a-f-]+\/pause$/,
        () => page.getByRole('button', { name: 'Pause' }).click());
      const paused = await orgGet(page, `/api/v1/prachar/sequences/${row.id}`);
      expect(String((paused.sequence || paused.data?.sequence).status)).toBe('paused');
      await writes(page, wire, /\/prachar\/sequences\/[0-9a-f-]+$/,
        () => page.getByRole('button', { name: 'Activate' }).click());
    }
  }

  expect(steps, '§4 asks for 12 sequence steps').toBe(12);
  expect(enrolled, '§4 asks for 24 enrolments').toBe(24);

  // ⚠ ADVANCE AND EXIT-ON-REPLY ARE NOT USER ACTIONS, AND THAT IS MEASURED
  // RATHER THAN ASSUMED.
  //
  //  · advance — the only thing that moves an enrolment is
  //    `marketing_skills.process_sequence_steps`, reached from
  //    `POST /api/internal/cron/marketing`. Railway's staging `cron-daily` is on
  //    `0 0 1 1 *` (read from the service config, 2026-08-29), so it is
  //    disarmed under R1; and firing a cron by hand is a scheduler operation,
  //    not a row typed by a user.
  //  · exit on reply — nothing in this product writes `status='replied'` to
  //    either enrolment or log table, because there is no inbound email path.
  //
  // So the assertion is the honest one: every enrolment is on step 1, nothing
  // has advanced, and no screen offers a control that would advance it.
  const s1 = byName.get('S11-SEQ-1');
  const stats = await orgGet(page, `/api/v1/prachar/sequences/${s1.id}/stats`);
  console.log(`  11.8 sequence stats (advance is cron-only, cron disarmed): ` +
    `${JSON.stringify(stats.totals || {})}`);
  expect(Number((stats.totals || {}).replied || 0),
    'an enrolment is marked replied — nothing in this product can write that status, ' +
    'so if this is non-zero the reply path has been built and needs its own test').toBe(0);

  console.log(`  11.8 §6 idempotence: ${typed} sequences typed, ${3 - typed} already present` +
    `${dialogs.length ? `; dialogs accepted: ${dialogs.length}` : ''}`);
  expect(con.uncaught, `uncaught exceptions:\n  ${con.uncaught.join('\n  ')}`).toEqual([]);
});

/* ────────────────────────────────────────────────────────────────────────── */

test('11.9 three events, thirty registrations, publish, attend, cancel, and the capacity refusal', async ({ page }) => {
  const wire = watchWire(page);
  const con = watchConsole(page);
  const dialogs = acceptDialogs(page);
  await signIn(page);
  await prachar(page, 'events');

  const before = await rowsOf(page, '/api/v1/prachar/events');
  const have = new Map(before.map((e) => [e.title, e]));
  let typed = 0;

  for (const ev of EVENTS) {
    if (have.has(ev.name)) continue;
    await page.getByRole('button', { name: '+ New event' }).first().click();
    const form = page.locator('.k-formpanel');
    await expect(form).toBeVisible();
    await fp(form, 'Title').locator('input').fill(ev.name);
    await fp(form, 'Type').locator('select').selectOption(ev.type);
    await fp(form, 'Description').locator('textarea')
      .fill(`${ev.name} — seeded by proposal 93 Suite 11.`);
    await fp(form, 'Location').locator('input').fill(ev.location);
    if (ev.url) await fp(form, 'Joining link').locator('input').fill(ev.url);
    // Two `DateInput`s on one form. `setDate` opens the calendar and clicks the
    // day; for `datetime-local` the component then emits `…T09:00`.
    await setDate(form, 'Starts', inDays(ev.inDays));
    await setDate(form, 'Ends', inDays(ev.inDays + 1));
    if (ev.cap) await fp(form, 'Maximum attendees').locator('input').fill(ev.cap);
    await writes(page, wire, '/prachar/events',
      () => form.getByRole('button', { name: 'Create event' }).click());
    typed += 1;
  }

  const events = await rowsOf(page, '/api/v1/prachar/events');
  const byTitle = new Map(events.map((e) => [e.title, e]));
  expect(events.filter((e) => e.title.startsWith('S11-EV')).length, '§4 asks for 3 events').toBe(3);

  let regs = 0;
  for (const ev of EVENTS) {
    const row = byTitle.get(ev.name);
    expect(row, `event ${ev.name} is missing.${dump(page, wire)}`).toBeTruthy();

    await prachar(page, 'events');
    const tr = page.locator('table.tbl tr').filter({ hasText: ev.name }).first();
    // Publish first: a draft event is one nobody outside the firm can see, and
    // the control only exists while it is a draft.
    if (row.status === 'draft') {
      await writes(page, wire, /\/prachar\/events\/[0-9a-f-]+$/,
        () => tr.getByRole('button', { name: 'Publish' }).click());
    }

    await page.locator('table.tbl tr').filter({ hasText: ev.name }).first()
      .getByRole('button', { name: 'Open' }).click();
    const exp = page.locator('.pr__exp');
    await expect(exp, `the ${ev.name} row did not expand`).toBeVisible({ timeout: 20_000 });

    const existing = await rowsOf(page, `/api/v1/prachar/events/${row.id}/registrations`);
    const seen = new Set(existing.map((r) => String(r.email || '').toLowerCase()));

    for (let i = 1; i <= ev.regs; i++) {
      const email = regEmail(ev.name, i);
      if (seen.has(email.toLowerCase())) continue;
      await exp.getByRole('button', { name: '+ Add attendee' }).click();
      await exp.getByLabel('Attendee name').fill(`${ev.name} attendee ${String(i).padStart(2, '0')}`);
      await exp.getByLabel('Attendee email').fill(email);
      await exp.getByLabel('Attendee phone').fill(`+44 7700 9002${String(i).padStart(2, '0')}`);
      await writes(page, wire, /\/prachar\/events\/[0-9a-f-]+\/register$/,
        () => exp.getByRole('button', { name: 'Register', exact: true }).click());
    }

    const after = await rowsOf(page, `/api/v1/prachar/events/${row.id}/registrations`);
    expect(after.length, `${ev.name} holds ${after.length} registrations.${dump(page, wire)}`)
      .toBe(ev.regs);
    const bad = after.map((r) => String(r.email || '')).filter((e) => e && !ALLOWED.test(e));
    expect(bad, `${ev.name} has registrations outside the allowed addressing scheme: ${bad.join(', ')}`)
      .toEqual([]);
    regs += after.length;

    // ── THE CAPACITY REFUSAL, on the event whose cap equals its roll ──────
    // `max_attendees` was collected in the form and used nowhere until this was
    // fixed; the refusal is the UI's, so it is asserted as the UI's.
    if (ev.cap && Number(ev.cap) === ev.regs) {
      await expect(exp.getByText(new RegExp(`Full — ${ev.cap} of ${ev.cap} places taken`)).first(),
        `${ev.name} is full and the screen does not say so`).toBeVisible({ timeout: 15_000 });
      expect(await exp.getByRole('button', { name: '+ Add attendee' }).count(),
        `${ev.name} is full and still offers to add another attendee`).toBe(0);
    }
  }
  expect(regs, '§4 asks for 30 event registrations').toBe(30);

  // ── Attendance and cancellation, on the meetup ───────────────────────────
  const ev2 = byTitle.get('S11-EV-2');
  await prachar(page, 'events');
  await page.locator('table.tbl tr').filter({ hasText: 'S11-EV-2' }).first()
    .getByRole('button', { name: 'Open' }).click();
  const exp2 = page.locator('.pr__exp');
  await expect(exp2).toBeVisible({ timeout: 20_000 });

  let marked = 0;
  const regRows = await rowsOf(page, `/api/v1/prachar/events/${ev2.id}/registrations`);
  const toAttend = regRows.filter((r) => r.status === 'registered').slice(0, 3);
  for (const r of toAttend) {
    const line = exp2.locator('table.tbl tr').filter({ hasText: String(r.email) }).first();
    await writes(page, wire, /\/registrations\/[0-9a-f-]+\?status=attended$/,
      () => line.getByRole('button', { name: 'Mark attended' }).click());
    marked += 1;
  }
  const toCancel = regRows.filter((r) => r.status === 'registered').slice(3, 5);
  for (const r of toCancel) {
    const line = exp2.locator('table.tbl tr').filter({ hasText: String(r.email) }).first();
    if (await line.getByRole('button', { name: 'Cancel' }).count()) {
      await writes(page, wire, /\/registrations\/[0-9a-f-]+\?status=cancelled$/,
        () => line.getByRole('button', { name: 'Cancel' }).click());
    }
  }
  const final = await rowsOf(page, `/api/v1/prachar/events/${ev2.id}/registrations`);
  expect(final.filter((r) => r.status === 'attended').length,
    'attendance did not persist on the canonical rows').toBeGreaterThanOrEqual(3);
  expect(final.length, 'a cancelled registration was DELETED rather than cancelled — the row ' +
    'is the record that somebody signed up').toBe(10);

  console.log(`  11.9 §6 idempotence: ${typed} events typed, ${3 - typed} already present; ` +
    `${regs} registrations, ${marked} newly marked attended` +
    `${dialogs.length ? `; dialogs accepted: ${dialogs.length}` : ''}`);
  expect(con.uncaught, `uncaught exceptions:\n  ${con.uncaught.join('\n  ')}`).toEqual([]);
});

/* ────────────────────────────────────────────────────────────────────────── */

test('11.10 an SMS or WhatsApp campaign is refused at Send, and the refusal names the channel', async ({ page }) => {
  const wire = watchWire(page);
  const con = watchConsole(page);
  const dialogs = acceptDialogs(page);
  await signIn(page);

  // §3 records this and it is CONFIRMED here rather than discovered:
  // `services/outbound_log.py:263` admits `email · push · whatsapp · social`
  // and no `sms` at all, `campaign_sender.py:87` says outright "there is no SMS
  // provider in this codebase", and `prachar_campaigns.channel`'s CHECK allows
  // 'sms' anyway. The consequence a customer meets is what matters: the channel
  // is offered on the form, the campaign saves, and the send is refused.
  const campaigns = await rowsOf(page, '/api/v1/prachar/campaigns');
  const byName = new Map(campaigns.map((c) => [c.name, c]));

  for (const name of ['S11-SMS-1', 'S11-WA-1']) {
    const c = camp(name);
    const row = byName.get(name);
    expect(row, `${name} is missing — 11.5 owns it`).toBeTruthy();
    expect(String(row.channel), `${name} did not save on the ${c.channel} channel — the CHECK ` +
      'admits it, so a save that silently rewrote it would be a different defect')
      .toBe(c.channel);
    expect(String(row.status), `${name} is already "${row.status}" — a non-email campaign ` +
      'must never reach a sent state').toBe('draft');

    await prachar(page, 'campaigns');
    await page.getByRole('button', { name: 'List', exact: true }).click();
    await settle(page);
    await page.getByRole('button', { name, exact: true }).first().click();
    await expect(page.getByRole('heading', { name })).toBeVisible({ timeout: 20_000 });

    // 400, and the refusal is the assertion. It fires BEFORE `_resolve_audience`
    // runs, so nothing is written and nobody is mailed — which is why this is
    // safe to drive against a live outbound mode.
    const out = await writes(page, wire, /\/prachar\/campaigns\/[0-9a-f-]+\/send$/,
      () => page.getByRole('button', { name: 'Send now' }).click(), 400);
    const detail = String(out?.detail || '');
    expect(detail, `${name}: the refusal does not name the channel, so the operator cannot ` +
      `act on it. Server said: ${detail.slice(0, 300)}`).toContain(c.channel);
    expect(detail, `${name}: the refusal does not explain that a different set of people ` +
      'would be reached').toMatch(/different set of people|can only deliver email/i);

    // And it must reach the SCREEN, not only the wire. `errText` surfaces a
    // string `detail` verbatim.
    await expect(page.getByText(/can only deliver email/i).first(),
      `${name}: the refusal never appeared on screen — a 400 nobody can read is a ` +
      'button that does nothing').toBeVisible({ timeout: 20_000 });

    const after = await orgGet(page, `/api/v1/prachar/campaigns/${row.id}`);
    expect(String((after.data || after).status), `${name} changed status on a refused send`)
      .toBe('draft');
    const stats = await orgGet(page, `/api/v1/prachar/campaigns/${row.id}/stats`);
    expect(Number(stats.total || 0), `${name} wrote recipient rows for a send that was refused`)
      .toBe(0);
  }

  console.log(`  11.10 both non-email channels refused at Send; ${dialogs.length} dialogs accepted`);
  expect(con.uncaught, `uncaught exceptions:\n  ${con.uncaught.join('\n  ')}`).toEqual([]);
});

/* ────────────────────────────────────────────────────────────────────────── */

test('11.11 Prachar automations: the tab is not mounted and the engine does not exist', async ({ page }) => {
  const con = watchConsole(page);
  await signIn(page);
  await page.goto('/prachar');

  // §4 budgets "marketing automations fired 5". NOT BUILT — and the honest
  // reading is stronger than "blocked": the door was closed on purpose, by a
  // product decision that is written down in three places, and this test
  // measures all three rather than repeating any of them.

  // 1 · The screen. `PracharPage.jsx`'s TABS omits `automations` with a note
  //     explaining that `AutomationsTab.jsx` is kept, unimported, as the screen
  //     this feature needs on the day an engine exists.
  const strip = page.getByRole('tablist', { name: 'Prachar sections' });
  await expect(strip).toBeVisible({ timeout: 45_000 });
  const ids = await strip.locator('[role="tab"]').evaluateAll(
    (els) => els.map((e) => e.id.replace(/^mt-tab-/, '')));
  expect(ids, 'an automations tab is on the Prachar strip').not.toContain('automations');
  const more = page.getByRole('button', { name: /^More/ });
  if (await more.count()) {
    if ((await more.getAttribute('aria-expanded')) !== 'true') await more.click();
    const menu = page.getByRole('menu');
    if (await menu.count()) {
      const listed = (await menu.locator('[role="menuitem"] .mt__pop-en').allTextContents())
        .map((t) => t.trim().toLowerCase());
      expect(listed, 'an automations tab is in the Prachar overflow menu').not.toContain('automations');
    }
    await page.keyboard.press('Escape').catch(() => {});
  }

  // 2 · The route, which is left OPEN for reads on purpose — a row written
  //     before the decision must stay readable, pausable and removable, because
  //     sealing the exit as well as the entrance is how dead rows become
  //     permanent.
  const body = await orgGet(page, '/api/v1/prachar/automations');
  expect(Array.isArray(body.data), 'GET /prachar/automations does not answer a list').toBeTruthy();
  expect(body.data.length, `staging.prachar_automations holds ${body.data.length} rows for ` +
    'this org — it has held 0 in the product\'s entire life, so a row here means ' +
    'something has started writing them').toBe(0);
  expect(body.engine, 'the automations route claims an engine').toBeNull();
  expect(String(body.note || ''), 'the route does not say why an automation cannot be created')
    .toMatch(/nothing in the product fires them/i);

  // 3 · And the door itself. `POST` answers 501 — the request is well formed
  //     and the SERVER is what is missing, which is exactly what 501 means. It
  //     is not driven here: `check-e2e-no-bypass.mjs` bans a spec from posting,
  //     and there is no control on any screen to click, which is the finding.
  console.log('  11.11 automations: tab unmounted, GET returns engine=null and 0 rows. ' +
    'POST /v1/prachar/automations answers 501 (read from routers/prachar.py; not ' +
    'driven from here because no screen offers the control and a spec may not post). ' +
    'The engine that DOES fire is Niyam, at /settings/automations, and none of ' +
    'Prachar\'s seven trigger names is in its vocabulary. NOT BUILT.');

  expect(con.uncaught, `uncaught exceptions:\n  ${con.uncaught.join('\n  ')}`).toEqual([]);
});

/* ────────────────────────────────────────────────────────────────────────── */

test('11.12 landing pages, forms, tracked links, clicks and referrals are not built', async ({ page }) => {
  const con = watchConsole(page);
  await signIn(page);
  await page.goto('/prachar');

  // §4 budgets "landing pages 2 · form submissions 12 · tracked links 6 ·
  // clicks 24 · referrals 4" and §10 lists them among Suite 11's ten screens.
  // NONE OF IT EXISTS, and the claim is made with live queries rather than a
  // grep, because CLAUDE.md's rule is that a route is never called missing
  // without one.
  //
  // Measured 2026-08-29 against project toacecaewujfxjfrjwco, BOTH product
  // schemas, read-only:
  //
  //   staging.mkt_landing_pages    EXISTS, 0 rows      public: absent
  //   staging.mkt_tracked_links    EXISTS, 0 rows      public: absent
  //   staging.mkt_link_clicks      EXISTS, 0 rows      public: absent
  //   staging.mkt_referrals        EXISTS, 0 rows      public: absent
  //   staging.mkt_referral_codes   EXISTS, 0 rows      public: absent
  //
  // The tables are real and empty. Nothing in `backend/routers/` reads or
  // writes any of them — the only references in the whole tree are migrations
  // `030` and `201` and one line of `docs/STAGING_SETUP.md`. So they are a
  // design that was schema'd and never built, not a feature that broke.
  //
  // WEB FORMS DO EXIST — as `graha_web_forms`, in the CRM, and they are Suite
  // 04's. `STATUS.md` already records that "a web form publishes with no public
  // route to fill it" (OWNER-ACTIONS 19), so the twelve submissions §4 budgets
  // are not reachable there either. Not restated as a finding here; named so
  // the zero is not misread later.

  for (const p of ['landing-pages', 'tracked-links', 'links', 'clicks', 'referrals', 'forms']) {
    const code = await orgGetStatus(page, `/api/v1/prachar/${p}`);
    expect(code, `GET /v1/prachar/${p} answered ${code} — if this route now exists, the ` +
      'feature has been built and §4\'s volumes for it are reachable').toBe(404);
  }

  const strip = page.getByRole('tablist', { name: 'Prachar sections' });
  await expect(strip).toBeVisible({ timeout: 45_000 });
  const ids = new Set(await strip.locator('[role="tab"]').evaluateAll(
    (els) => els.map((e) => e.id.replace(/^mt-tab-/, ''))));
  const more = page.getByRole('button', { name: /^More/ });
  if (await more.count()) {
    if ((await more.getAttribute('aria-expanded')) !== 'true') await more.click();
    const menu = page.getByRole('menu');
    if (await menu.count()) {
      for (const t of await menu.locator('[role="menuitem"] .mt__pop-en').allTextContents()) {
        ids.add(t.trim().toLowerCase().replace(/\s+/g, '-'));
      }
    }
    await page.keyboard.press('Escape').catch(() => {});
  }
  for (const t of ['landing', 'landing-pages', 'links', 'tracked-links', 'referrals', 'forms']) {
    expect([...ids], `a "${t}" tab has appeared on Prachar`).not.toContain(t);
  }

  console.log('  11.12 landing pages · form submissions · tracked links · clicks · ' +
    'referrals: NOT BUILT. Five mkt_* tables exist in `staging` at 0 rows, no ' +
    'router references them, no screen draws them, and all six candidate routes 404.');

  expect(con.uncaught, `uncaught exceptions:\n  ${con.uncaught.join('\n  ')}`).toEqual([]);
});

/* ────────────────────────────────────────────────────────────────────────── */

test('11.13 the standing rules, on Prachar\'s own screens', async ({ page }) => {
  const con = watchConsole(page);
  await signIn(page);

  const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i;
  const tabs = ['dashboard', 'campaigns', 'sequences', 'templates', 'unsubscribes', 'events'];
  // ⚠ WHAT THE ROW CHECK ACTUALLY MEASURED, TAB BY TAB.
  //
  // `--row-h` can only be measured where a row exists, so on an empty tab the
  // check quietly covers nothing. A silent cap reads as full coverage — the
  // brief's words — so the tabs that HAD rows and the tabs that did not are both
  // printed, and a reader can see the difference without opening a trace.
  const rowCoverage: string[] = [];

  for (const t of tabs) {
    await prachar(page, t);
    const panel = page.locator(`#mt-panel-${t}`);
    await expect(panel).toBeVisible();

    // ── NAMES, NOT IDS ───────────────────────────────────────────────────
    // ⚠ `check-rendered-ids.mjs` is static and positional and has been GREEN
    // over two real violations — an id behind a helper, and one the SERVER
    // pre-formats into a string. This is the runtime half of the same contract,
    // and it reads what the page actually draws.
    const text = (await panel.innerText()).replace(/\s+/g, ' ');
    const hit = UUID.exec(text);
    expect(hit && hit[0], `the ${t} tab renders a UUID on screen: "${hit?.[0]}". ` +
      'Never render a user/member/org id in any UI.').toBeFalsy();

    // ── NO NATIVE DATE INPUT ANYWHERE ────────────────────────────────────
    // `DateInput` keeps a native control in the DOM for form serialisation, but
    // it is `.pk__native`, aria-hidden and out of the tab order. Anything else
    // is the control this product does not use.
    const natives = await panel.locator(
      'input[type="date"]:not(.pk__native), input[type="datetime-local"]:not(.pk__native), input[type="time"]:not(.pk__native)',
    ).count();
    expect(natives, `the ${t} tab renders ${natives} native date input(s)`).toBe(0);

    // ── EVERY TABLE ON THE ROW TOKEN ─────────────────────────────────────
    // Measured at the ROW, not read off a class name: `check-table-rows.mjs`
    // checks that a table REFERENCES the token and stayed green while Manav's
    // DSC rows rendered 77px against a 66px token.
    // ⚠ WAIT FOR THE PANEL TO STOP LOADING BEFORE COUNTING ROWS.
    //
    // `Panel` renders `<Shimmer>` while `useResource` is in flight, and
    // `settle()` deliberately never fails, so a count taken straight after it
    // can read 0 against a list that arrives a moment later. The first version
    // of this reported "sequences: NO ROWS" on a tab holding three — an
    // UNDER-REPORT of its own coverage, which is the quiet half of the silent
    // cap the brief forbids.
    await expect
      .poll(async () => await panel.locator('.k-shimmer').count(),
        { message: `the ${t} tab never finished loading`, timeout: 25_000 })
      .toBe(0);
    const rows = panel.locator('table.tbl tbody tr');
    const n = await rows.count();
    if (!n) {
      rowCoverage.push(`${t}: NO ROWS — --row-h not measured here`);
    } else {
      const m = await rows.first().evaluate((el) => {
        const cs = getComputedStyle(el);
        return {
          h: Math.round(el.getBoundingClientRect().height),
          token: cs.getPropertyValue('--row-h').trim(),
        };
      });
      if (!m.token) {
        rowCoverage.push(`${t}: ${n} rows, but --row-h does not resolve AT THE ROW`);
      } else {
        // ⚠ THE ASSERTION IS "THE ROW MEASURES ITS TOKEN", NOT "THE TOKEN IS
        // 48, 66 OR 76" — and the first version of this asserted the second,
        // went red on the dashboard at 50px, and was WRONG.
        //
        // 48/66/76 are the three DENSITY tiers. `viewport-fit.css` narrows the
        // token again by viewport band, on purpose and with a long argument for
        // it: band V2 (`min-width: 1024px and max-height: 780px` — the 1366x768
        // panel that is still the most common laptop sold in India) sets
        // `--row-h: 50px` for cozy and 56px for comfy, and band V1 sets 56/64.
        // Playwright's default viewport is 1280x720, which is inside V2, so 50px
        // is the CORRECT resolved value on this run.
        //
        // A test that failed on that would be a test failing on correct
        // behaviour, which teaches people to edit tests — so the tier list is
        // gone and what remains is the half `check-table-rows.mjs` genuinely
        // cannot see: that gate reads whether a table's CSS REFERENCES the
        // token, and stayed green while Manav's DSC rows rendered 77px against
        // a 66px token. This measures the rendered row against the token AT THE
        // ROW, which is the contract.
        const want = Number(m.token.replace('px', ''));
        expect(Number.isFinite(want) && want > 0,
          `the ${t} tab's --row-h resolves to "${m.token}", which is not a length`).toBeTruthy();
        expect(Math.abs(m.h - want), `the ${t} tab's rows measure ${m.h}px against a --row-h ` +
          `of ${m.token} at the row itself — the table is not on the row contract`)
          .toBeLessThanOrEqual(2);
        rowCoverage.push(`${t}: ${n} rows, ${m.h}px against ${m.token}`);
      }
    }
  }
  console.log(`  11.13 --row-h, measured at the row:\n     ${rowCoverage.join('\n     ')}`);

  // ── ESCAPE CLOSES WHAT IT OPENS ──────────────────────────────────────────
  // Fixed by hand once already — React Aria was rejected — so it regresses
  // silently. The calendar is the one transient overlay on this module's forms.
  await prachar(page, 'campaigns');
  await page.getByRole('button', { name: '+ Schedule' }).first().click();
  const form = page.locator('.k-formpanel');
  await expect(form).toBeVisible();
  const trigger = fp(form, 'Send at').locator('.pk--dt button.pk__tr').first();
  await trigger.click();
  const pop = fp(form, 'Send at').locator('.pk__pop');
  await expect(pop, 'the date picker did not open').toBeVisible();
  await page.keyboard.press('Escape');
  await expect(pop, 'Escape did not close the date picker — a popover that traps the ' +
    'keyboard is a live bug no row count would show').toBeHidden({ timeout: 10_000 });

  // The form's own escape hatch: Cancel returns to the list without writing.
  await page.getByRole('button', { name: 'Cancel' }).first().click();
  await expect(page.getByRole('button', { name: '+ Schedule' }).first()).toBeVisible();

  // ── §13's TWO SILENT ZEROES, SAID OUT LOUD ───────────────────────────────
  // Varta and the social connectors are excluded BY DECISION, so
  // `hub_publish_queue` and `hub_social_accounts` end the run empty and the
  // report must say so rather than leaving two zeroes for somebody to misread as
  // a defect in six weeks. Paid ads leave with them: `prachar_ad_accounts` and
  // `prachar_ad_campaigns` are untouched by this suite.
  const ads = await orgGetStatus(page, '/api/v1/prachar/ads/overview');
  console.log(`  11.13 §13 excluded by decision — Prachar's Ads tab is mounted and NOT ` +
    `driven (GET /prachar/ads/overview → ${ads}); prachar_ad_accounts, ` +
    'prachar_ad_campaigns, hub_publish_queue and hub_social_accounts all end this ' +
    'run at 0 rows, by choice and not by failure.');

  expect(con.uncaught, `uncaught exceptions across the cross-cutting sweep:\n  ${con.uncaught.join('\n  ')}`)
    .toEqual([]);
  // `console.error` is reported rather than asserted at zero: the shell polls
  // notifications and a transient network error there is not this module's.
  if (con.errors.length) {
    console.log(`  11.13 console.error (reported, not asserted): ${con.errors.length}\n     ` +
      con.errors.slice(0, 8).join('\n     '));
  }
});
