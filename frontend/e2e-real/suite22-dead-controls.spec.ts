/**
 * Proposal 93 · Stage 3 · WAVE 8 · SUITE 22 — THE DEAD-CONTROL SWEEP, on
 * Unicode Group.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT THIS SUITE PRODUCES IS A CENSUS, NOT A PASS
 * ═══════════════════════════════════════════════════════════════════════════
 * §10 defines it: "On the fully seeded org: enumerate every visible enabled
 * button, link, tab, toggle and menu item; click each in isolation; record
 * request fired / DOM changed / console clean. Fires nothing and changes
 * nothing = dead. 4xx or 5xx = broken, reported separately. Destructive
 * controls are excluded by a reviewed allowlist and driven inside their own
 * suite instead."
 *
 * §7's gate on stage R7 is "the dead count is published even if not zero". So
 * `22.90 census` PASSES whatever it finds and prints the number with the list
 * behind it. The defect gates are separate tests — `22.91`, `22.92`, `22.93` —
 * so a red one can never suppress the census, and a green census can never be
 * mistaken for "nothing is dead".
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE LANE, AND THE GUARD THAT PROVES IT
 * ═══════════════════════════════════════════════════════════════════════════
 * `lane('unicode')` + `signInAs()` from `_lanes.ts`, which calls `assertOrg()`
 * itself. Read that file's header before changing a line here: on 2026-08-28 a
 * write suite renamed **Aekam Inc** — the one org proposal 93 guarantees is
 * untouched — because the credential held `platform_admin` and every request
 * resolved to Aekam via `platform_bypass`. The save succeeded and the suite
 * went GREEN.
 *
 * God mode belongs to Suite 19 alone, so `/admin/*` is NOT swept here and says
 * so in `NOT_SWEPT` below. This suite drives an ORG-SCOPED account only.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⚠ THE MISTAKE THIS FILE IS BUILT TO BE INCAPABLE OF MAKING
 * ═══════════════════════════════════════════════════════════════════════════
 * `getByRole(name)` matches the ACCESSIBLE NAME (`aria-label`), not the visible
 * text. That produced THREE false "missing control" findings in ONE DAY. A
 * fourth came from Playwright RE-ROOTING a `has:` locator at the outer element,
 * so an inner selector silently hunted for an ancestor.
 *
 * For a sweep whose entire output is "is this control dead", a control that
 * could not be LOCATED and a control that is DEAD are the same red mark unless
 * the method makes them different. So:
 *
 *   · NOTHING here is located by role-and-name. Not once. The enumerator walks
 *     the DOM inside a scope, stamps each candidate with `data-sw="<n>"`, and
 *     every click is `[data-sw="<n>"]` — an attribute this file wrote onto the
 *     element it had already measured.
 *   · There is no `has:` locator anywhere in this file.
 *   · Both names are recorded SEPARATELY on every row — `ariaLabel` and `text`
 *     — so the census can never conflate them, and so a reader can see which
 *     one a given control actually has.
 *   · A control that cannot be re-found for its confirming click is recorded
 *     `UNCLICKABLE` with the reason, never `DEAD`. **A control you could not
 *     locate is not a dead control.**
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE SEVEN VERDICTS, AND THE DISCIPLINE BEHIND EACH
 * ═══════════════════════════════════════════════════════════════════════════
 *  ALIVE        a request fired, or the DOM changed, or the URL changed, or a
 *               native dialog / popup / download appeared.
 *  DEAD         none of those — TWICE. Every candidate dead control is clicked
 *               a second time from a freshly navigated screen and must be dead
 *               on both. One-shot deadness is a flake and is recorded ALIVE
 *               with `flaky: true`.
 *  BROKEN       a 4xx or 5xx came back. Reported separately from DEAD because
 *               they need different fixes and different urgency.
 *               ⚠ A 500 escapes BEFORE the CORS headers are attached, so in the
 *               browser console it presents as a CORS error and is
 *               indistinguishable from a network fault. Only a request/response
 *               listener separates the two, so this file classifies from
 *               `page.on('response')` and NEVER from the console text.
 *  INTERCEPTED  something else is on top of it: `document.elementFromPoint` at
 *               the control's own centre returns an element that is neither the
 *               control nor inside it. This is `.m2jump` in Sanvaad — the
 *               keyboard path works and the mouse path does not — and the date
 *               picker whose Clear button lands on the modal scrim. A click
 *               sweep MIS-CLASSIFIES both unless it checks.
 *  EXCLUDED     on the REVIEWED allowlist below. Named, with a reason.
 *  HELD         matched the destructive SAFETY NET and is NOT on the reviewed
 *               allowlist. Not clicked, and reported BY NAME so the next pass
 *               can review it. A prefix is not a stack: nothing is excluded by
 *               pattern alone and then forgotten — the pattern only ever
 *               DEFERS, and the deferral is published.
 *  UNCLICKABLE  Playwright refused (detached, timeout, out of the layout), or
 *               the element could not be re-found by its own descriptor.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⚠⚠ SAFETY — THIS CLICKS ~2,250 THINGS ON A LIVE DATABASE
 * ═══════════════════════════════════════════════════════════════════════════
 * Staging and production share ONE Supabase database.
 *
 *  · `outbound_mode` on staging is `live` and `suppressed_orgs_digest` is `"0"`
 *    — NOTHING is shielded — and all of Unicode's pre-existing `graha_contacts`
 *    are `@example.com`, a null-MX domain. Mailing them is a hard bounce on the
 *    SES account that sends the owner's real invoices. **Every send control is
 *    on the reviewed allowlist.** A sweep that clicks "Send campaign" is not a
 *    sweep, it is an incident.
 *  · And the org fence would not save us anyway: `POST /tasks/{id}/comments`
 *    resolves no org, so those sends file `org_id = NULL` and
 *    `_org_suppressed(None)` returns False BY DESIGN.
 *  · **Arming anything is destructive.** A Niyam rule armed by a stray click
 *    acts on its own after the run stops. Every arm/disarm switch is excluded.
 *    `/cron/reports` and `/cron/esign` are 501 stubs and are never touched.
 *  · **Aekam Inc is NO-TOUCH.** Unicode contains a team literally named "Aekam
 *    Inc" (`team_ae1d58543b21`) holding the protected 20 tasks. `22.00` counts
 *    them before the sweep and `22.94` counts them after; both are hard gates.
 *  · Native `confirm()`/`alert()` dialogs are DISMISSED (i.e. Cancel), so a
 *    confirm-guarded action cannot complete even if one slipped the allowlist.
 *  · Popups (`target=_blank`, OAuth) are CLOSED the moment they open, so a
 *    connector consent screen is never reached.
 *  · **Every non-GET request this suite causes is written to the ledger**, with
 *    method, path and status. The report says exactly what was written; the
 *    census prints the list. That is §7's "say what this suite wrote".
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * HOW "CLICK EACH IN ISOLATION" IS ACTUALLY ACHIEVED
 * ═══════════════════════════════════════════════════════════════════════════
 * Reloading the whole screen between 2,250 clicks is hours of navigation for
 * no information. Instead each click is bracketed:
 *
 *   1. the screen is navigated and its tab selected;
 *   2. a NOISE FLOOR is measured — the page sits idle and whatever mutations
 *      and requests happen anyway (the notification poll) are recorded, so a
 *      polling GET can never be mistaken for a control doing something;
 *   3. the inventory is stamped and the descriptor of control `n` recorded;
 *   4. per click: re-stamp, verify the descriptor at `n` still matches, scroll
 *      it into view, settle, reset the counters, check interception, click;
 *   5. observe: first API request or 900 ms, then 350 ms for the DOM;
 *   6. RESTORE — Escape any overlay, return if the URL moved, and re-navigate
 *      whenever the inventory no longer matches the baseline.
 *
 * Restoration is cheap for exactly the class being hunted: a dead control by
 * definition changed nothing, so there is nothing to restore.
 *
 * ⚠ **THE LEDGER IS A FILE, and that is not optional here.** Playwright starts
 * a NEW WORKER after a failed test, and module-level state resets with it. This
 * suite's entire output IS a ledger, so it is appended to disk line by line as
 * it is produced; `census` reads it back off disk rather than out of memory.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT IS NOT SWEPT — read this before treating the census as complete
 * ═══════════════════════════════════════════════════════════════════════════
 * On a suite whose scope is "every control", a silent cap reads as full
 * coverage more easily than anywhere else in this programme. So `NOT_SWEPT`
 * below is a first-class constant, it is PRINTED by the census, and every entry
 * says why.
 *
 * Run:
 *   cd frontend
 *   npx playwright test --config e2e-real/suite22.config.ts
 */
import { test, expect, Page, BrowserContext, Locator } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { lane, signInAs as laneSignIn, assertOrg, ORG as ORG_IDS } from './_lanes';

const LANE = lane('unicode');
const API = process.env.E2E_API_URL || 'https://api.kartavaya.com';
const OUT = path.join(os.tmpdir(), 'kartavya-e2e-suite22');
const LEDGER_DIR = path.join(OUT, 'ledger');
fs.mkdirSync(LEDGER_DIR, { recursive: true });

/** Enumerate and record, click nothing. The pass the allowlist is reviewed from. */
const DRY = process.env.SWEEP_DRY === '1';

const BLOCKED =
  'BLOCKED — no Unicode Group credential. Set E2E_UNICODE_TOKEN (or ' +
  'E2E_UNICODE_EMAIL/_PASSWORD) in .env.e2e at the repo root. ⚠ It must be an ' +
  'ORG-SCOPED account: a platform_admin token resolves to Aekam Inc via ' +
  'platform_bypass and will write there. ENVIRONMENT blocker, not a product ' +
  'or test defect.';

// ════════════════════════════════════════════════════════════════════════════
// THE REVIEWED ALLOWLIST — §10's "destructive controls are excluded by a
// reviewed allowlist and driven inside their own suite instead".
// ════════════════════════════════════════════════════════════════════════════
//
// Every entry is a NAMED control with a REASON and the suite that drives it
// instead. Nothing is excluded because a word appears in it.
//
// ⚠ A PREFIX IS NOT A STACK. Where an entry has to be a pattern — because the
// product renders the record's own name into the button ("Delete INV-2026-0007"
// is thirty-one different accessible names for one control) — the pattern is
// ANCHORED and its reason names the shape it covers. A bare `*delete*` is not
// used anywhere in this file.
//
// The `where` field narrows an entry to the screens it was reviewed on. An
// entry with no `where` was reviewed as applying product-wide.
type Rule = { match: string | RegExp; why: string; where?: RegExp };

/**
 * ── THE ONE EXCLUSION THAT IS A CLASS OF CONTROL RATHER THAN A NAME ─────────
 *
 * §10 names "toggle" among the things to click. This suite does not click one,
 * and that is a decision with a reason rather than an omission.
 *
 * `components/ui/Toggle.jsx` is the product's switch, and its own docstring
 * draws the line this rule stands on: *"A real button that APPLIES IMMEDIATELY,
 * as distinct from a checkbox committed on submit."* So every `role="switch"`
 * in this product WRITES on click — a module on or off, a compliance answer, a
 * member's approval emails — on an organisation four other agents are driving
 * at the same time.
 *
 * And a name-based rule cannot separate the safe ones from the catastrophic
 * one, because **two of them have no accessible name at all**:
 * `NiyamPage.jsx:385` renders `<Toggle checked={r.enabled} …/>` and `:389`
 * renders `<Toggle checked={r.is_armed} …/>`, both with no `label` prop, so
 * `aria-label` is undefined and `getByRole('switch', {name})` matches nothing.
 * The second of those is the ARM switch — and §0 is explicit that arming is
 * destructive in a way nothing else here is: an armed rule keeps acting after
 * the run stops.
 *
 * A `<input type="checkbox">` is deliberately NOT on this list and IS clicked:
 * by the same docstring it is committed on submit, so clicking one changes a
 * form's state and writes nothing.
 *
 * The census prints how many switches went unclicked, so the gap is a published
 * number rather than a silent cap. Suites 02, 07 and 16 drive them.
 */
const SWITCHES_ARE_NOT_CLICKED =
  'role="switch" — every switch in this product is `components/ui/Toggle.jsx`, whose own ' +
  'docstring says it "applies immediately, as distinct from a checkbox committed on submit". ' +
  'Flipping one writes a setting on an org three other suites are driving concurrently, and ' +
  'NiyamPage.jsx:385/:389 render two of them with NO accessible name — one of which is is_armed, ' +
  'and an armed rule keeps acting after this run stops. Driven by Suites 02, 07 and 16.';

const EXCLUDED: Rule[] = [
  // ── SENDS. Nothing on this list may be clicked: staging is outbound_mode
  //    live with nothing shielded, and Unicode's contacts are @example.com,
  //    a null-MX domain. Every one of these is driven inside its own suite
  //    with the fence asserted first.
  { match: /^send\b/i, why: 'anchored on the word the send controls start with — "Send", "Send for signature", "Send reminder", "Send test". Outbound is LIVE and unshielded; Suites 05/11/15 drive these behind an asserted fence' },
  { match: /^resend\b/i, why: 'the retry half of the same control. Same fence, same suites' },
  { match: /^email\b/i, why: '"Email invoice", "Email payslip" — the send path with a different verb. Suites 05 and 08' },
  { match: 'Send campaign', why: 'mass send to a segment. Suite 11, which re-measures the fence before it sends' },
  { match: /^remind\b/i, why: '"Remind", "Remind signer" — dunning and eSign chasers. Suites 05 and 15' },
  { match: /^invite\b/i, why: '"Invite", "Invite by email", "Invite someone" — creates an invitation AND mails it. Suite 01' },
  { match: 'Enable notifications', why: 'asks the browser for push permission and registers a device token; a permission prompt cannot be dismissed from the page' },
  { match: /^dispatch\b/i, why: 'dispatch controls fan out to every recipient of a schedule. Suite 12' },
  { match: /^publish\b/i, why: '"Publish", "Publish now" — hands an item to an external network, and §13 excludes the social publish path from this programme entirely' },

  // ── DELETES AND OTHER IRREVERSIBLES. The suites that own each record own
  //    its delete; a sweep that deletes a seeded row destroys another suite's
  //    evidence, and §0 reserves irreversible acts to the lead.
  { match: 'Delete', why: 'the bare Delete button on every detail panel and row action. Driven by the suite that created the record (02.12 proves the whole bin round trip)' },
  { match: /^delete\b/i, why: 'anchored: every "Delete <record>" spelling the product renders, including the ones that carry the record name. Same owners' },
  { match: 'Remove', why: 'membership and line-item removal — "Remove" on a team member strips a seat another suite depends on' },
  { match: /^remove\b/i, why: 'anchored: "Remove member", "Remove line", "Remove attachment". Same reason' },
  { match: /^destroy\b/i, why: 'stage-2 permanent destruction of a binned file. 02.12 owns it and proves the object unreadable afterwards' },
  { match: /^void\b/i, why: 'voiding an eSign document or a payslip is irreversible. Suites 15 and 08' },
  { match: /^revoke\b/i, why: 'revoking a UDIN, a DSC custody line or a support grant. Suites 07 and 19' },
  { match: /^archive\b/i, why: 'archiving hides a record from every list, so it removes another suite\'s fixture without deleting it — the worst shape to hit mid-programme. Suite 03' },
  { match: /^unarchive\b/i, why: 'the inverse of an act this sweep must not perform; clicking it in isolation would restore something nobody archived' },
  { match: /^restore\b/i, why: 'restores a binned or archived record — a write that changes what every other suite sees. 02.12' },
  { match: 'Discard', why: 'discards an in-flight draft. On a shared org the draft may be another suite\'s' },
  { match: /^cancel order\b/i, why: 'order cancellation is a state transition Suite 10 asserts on; the bare "Cancel" that closes a dialog is NOT on this list and IS clicked' },
  { match: /^deactivate\b/i, why: 'deactivates a member, a rate card or a sender. Suites 02 and 17' },
  { match: /^leave\b/i, why: '"Leave organisation" removes this suite\'s own seat and would end the run' },
  { match: 'Sign out', why: 'ends the session mid-sweep; every screen after it would enumerate the login form and be reported dead' },
  { match: 'Sign out everywhere', why: 'same, for every device — and it is a mobile-only route per the orphaned-capability sweep' },

  // ── ARMING. §0: a rule armed by a stray click acts on its own after the run
  //    stops. This is the one exclusion class that is dangerous AFTER the
  //    suite has finished.
  { match: /^arm\b/i, why: 'arming an automation rule makes it fire on real events after this run ends. Suite 16 arms each rule and disarms it again' },
  { match: /^disarm\b/i, why: 'the inverse: disarming a rule Suite 16 armed removes its evidence' },
  { match: 'Run now', why: 'runs a schedule, a skill or a scraper immediately — a real job with real spend, and on a report schedule a real send. Suites 12 and 14' },
  { match: /^enable\b/i, why: '"Enable module", "Enable rule" — turning a module on or off changes what every concurrent suite can see. Suite 02', where: /settings|niyam|automations/i },
  { match: /^disable\b/i, why: 'same, in the direction that BREAKS four other agents mid-run', where: /settings|niyam|automations/i },
  { match: 'Grant', why: 'grants a role or platform support access. Suites 02b and 19' },
  { match: /^grant\b/i, why: 'anchored: "Grant access", "Grant a platform role". Same' },

  // ── MONEY AND DECISIONS. Each of these writes a row another suite asserts on.
  { match: 'Approve', why: 'an approval decision is a row Suites 03, 06 and 07 each assert a count on; deciding one here corrupts their arithmetic' },
  { match: 'Reject', why: 'the other half of the same decision' },
  { match: /^approve\b/i, why: 'anchored: "Approve claim", "Approve PO". Same owners' },
  { match: /^reject\b/i, why: 'anchored, same' },
  { match: /^finali[sz]e\b/i, why: 'finalising a draft invoice makes it immutable and dunnable — and dunning sends. Suite 05' },
  { match: /^process\b/i, why: '"Process payroll" generates payslips for 30 employees and mails them. Suite 08' },
  { match: /^reconcile\b/i, why: 'reconciliation is the ONLY path to "paid" in this product (there is no gateway), so a stray reconcile invents a payment. Suite 05' },
  { match: /^record payment\b/i, why: 'same: it invents money against an invoice another suite is asserting a balance on' },
  { match: /^top ?up\b/i, why: 'a credit top-up is billed. Suite 14' },
  { match: /^convert\b/i, why: '"Convert to Customer", "Convert to invoice" — creates a downstream record Suites 04 and 10 count' },
  { match: 'Transfer ownership', why: 'moves the org owner seat. Irreversible without the new owner acting' },

  // ── NAMED ON 2026-08-29 AFTER THIS SWEEP DAMAGED ANOTHER SUITE'S ROWS.
  //    The write fence above now makes all four impossible to execute; these
  //    entries stay so the sweep does not even ATTEMPT them, and so the record
  //    of what went wrong is in the file rather than only in a report.
  { match: 'Active', why: 'Dristi › Reports renders the schedule state as a CHIP, and clicking it sends PATCH /v1/dristi/scheduled-reports/{id} with is_active flipped. This sweep set BOTH of Suite 12 scheduled reports inactive on 2026-08-29; that CRUD writes no audit_log row, so the state was the only trace. Suite 12 owns it', where: /dristi/i },
  { match: 'Paused', why: 'the other face of the same chip, and the same PATCH', where: /dristi/i },
  { match: 'Preview', where: /pahchan/i, why: '⚠ A CONTROL LABELLED "Preview" THAT PUBLISHES. Pahchan > Payroll: clicking it sends POST /v1/pahchan/attendance/publish, which writes the attendance register through to payroll. This sweep fired it TWICE on 2026-08-29 believing it was reading. The mislabel is itself a finding and is in the report; the exclusion is scoped to Pahchan so that "Preview" elsewhere stays clickable. Suite 09 owns the control' },
  { match: 'Save policy', where: /pahchan/i, why: 'PATCH /v1/pahchan/policy rewrites the org attendance policy — geofence radius, grace, rounding. This sweep fired it twice on 2026-08-29. Suite 09' },
  { match: 'Duplicate', where: /prachar/i, why: 'Prachar > Templates: POST /v1/prachar/templates, which CREATES a marketing template row. This sweep created two on 2026-08-29 and they are Suite 11 counts' },
  { match: 'Cancel', where: /prachar/i, why: '⚠ THE ONE PLACE "Cancel" IS NOT "close this dialog". On Prachar > Events it sends PATCH /v1/prachar/events/{id} and cancels the EVENT; this sweep cancelled two on 2026-08-29. Scoped to Prachar precisely so the ordinary dialog-dismissing Cancel — which this sweep must keep clicking — is untouched. Suite 11' },
  { match: 'New chat', where: /hub/i, why: 'POST /v1/hub/clients/{id}/chat/sessions creates a Sahayak session row. This sweep created two on 2026-08-29. Suite 14' },

  // ── THE DANGER ZONE, BY NAME.
  { match: 'Danger zone', why: 'the TAB is swept (opening it is a read); its controls are not. The tab body is Suite 02c' },
  { match: /^delete organisation/i, why: 'deletes Unicode Group. Named here so the exclusion is explicit rather than assumed' },
  { match: /^reset\b/i, why: '"Reset to recommended" overwrites saved preferences for the account every other suite drives' },

  // ── OAUTH AND EXTERNAL. §13 excludes the social connectors by decision.
  { match: /^connect\b/i, why: '"Connect" opens a third-party OAuth consent screen. §13 excludes the social connectors from this programme by decision, not by blocker' },
  { match: /^disconnect\b/i, why: 'tears down a connection this programme did not make' },
  { match: /^authorize\b/i, why: 'same consent flow, US spelling' },
];

// ════════════════════════════════════════════════════════════════════════════
// THE SAFETY NET — NOT the allowlist, and deliberately a different mechanism.
// ════════════════════════════════════════════════════════════════════════════
//
// The allowlist above is a set of decisions. This is a brake for the case the
// decisions did not anticipate: a control whose name reads destructive and
// which nobody has reviewed. It does NOT exclude — it DEFERS, verdict `HELD`,
// and the census prints every held control by name so the next pass can rule
// on it. That is the difference between "a prefix is not a stack" and this:
// nothing is silently swallowed by a pattern; a pattern only ever postpones,
// visibly.
const SAFETY_NET =
  /\b(delete|remove|destroy|purge|erase|wipe|void|revoke|arm|disarm|send|resend|email|invite|remind|dispatch|publish|approve|reject|deactivate|archive|unarchive|restore|finali[sz]e|reconcile|payout|disburse|transfer|logout|sign out|unsubscribe|terminate|offboard|close account|cancel subscription)\b/i;

// ════════════════════════════════════════════════════════════════════════════
// WHAT IS NOT SWEPT — printed by the census, never left to be inferred.
// ════════════════════════════════════════════════════════════════════════════
const NOT_SWEPT: [string, string][] = [
  ['/admin/* — the platform console (12 screens)',
   'god mode is Suite 19 ONLY (§12, and the lane rule in _lanes.ts). An org-scoped account cannot reach it, and reaching it would put Aekam Inc in scope'],
  ['/client/* — the client portal (4 screens)',
   'needs an org-client login, which is a different lane. Suite 18 owns it'],
  ['Public pages — /login, /privacy, /security, /dpa, /subprocessors, /sign/:token, /i/:token, /approve',
   'logged-out surfaces. Suites 01, 15 and 17 reach them with the tokens that make them meaningful; a sweep signed in as an org admin sees a different page'],
  ['Controls INSIDE a modal, drawer, popover or expanded row',
   'the sweep enumerates each screen in its BASE state. §4 sizes this suite at ~2,250 clicks over ~150 screens — about fifteen per screen — which is the base state and not the recursive tree. Opening a modal is recorded as ALIVE; what is inside it is the owning suite\'s'],
  ['Text inputs, textareas, selects and date fields',
   '§10 names "button, link, tab, toggle and menu item". Typing and selecting are Suite 20\'s interaction vocabulary, and a select is not a dead control candidate — it either has options or it does not'],
  ['Rows beyond the per-group cap',
   'a table renders one control per row; clicking thirty identical Open buttons is thirty clicks and one fact. Controls are grouped by tag+role+class and the whole group is clicked when it has 8 or fewer members, otherwise 4 of it — first, second, middle and last. Every group\'s FULL size is in the ledger, so the multiplicity is never hidden'],
  ['Every `role="switch"` toggle',
   'the one CLASS exclusion rather than a named one, and the census prints the count and the screens. `components/ui/Toggle.jsx` applies immediately by design, two switches in Niyam carry no accessible name at all, and one of those is `is_armed` — an armed rule keeps acting after this run stops. Suites 02, 07 and 16'],
  ['The STATUS of any non-GET request — so BROKEN is measurable on GET only',
   'the write fence aborts every non-GET except two named read-shaped POSTs, so a control that would send DELETE or PATCH is recorded as ALIVE with the request it would have made, but never with a status. That is a real reduction and it is the deliberate price of the method change: on 2026-08-29 this sweep learned what a Dristi chip does by doing it, and set both of another suite scheduled reports inactive. A 405 found by performing a DELETE is not a finding'],
  ['Varta / WhatsApp',
   'excluded by decision, 93 §13 — recorded as a choice, not as a blocker'],
];

// ════════════════════════════════════════════════════════════════════════════
// THE SCREEN INVENTORY
// ════════════════════════════════════════════════════════════════════════════
//
// Tab ids and labels are taken from the page sources at HEAD, because the
// popover matches on the rendered LABEL and `ModuleTabs` derives it from
// `tabEn(id)` — `id.replace(/-/g, ' ')` — except where a page overrides it.
// Those overrides are spelled out rather than derived, so a page that renames
// a tab makes this list wrong loudly instead of silently missing a screen.
type Tab = { id: string; label: string };
const t = (id: string, label?: string): Tab => ({ id, label: label ?? id.replace(/-/g, ' ') });

type Screen = {
  key: string;
  path: string;
  /** Module pages: tabs reached through the real strip / More popover. */
  tabs?: Tab[];
  /** Settings pages: tabs reached through their own `?tab=` parameter. */
  urlTabs?: string[];
  /** Resolve a path that needs a real record id, by GET. Null = screen absent. */
  resolve?: (page: Page) => Promise<string | null>;
  /**
   * Put the screen into the state the sweep is supposed to measure, on EVERY
   * arrival. The sidebar needs one: seven of its eight sections are collapsed
   * for this account, and a collapsed section's items are clipped to nothing —
   * so without expanding them the nav sweep would cover four destinations out
   * of twenty-nine and report the other twenty-five as not present.
   */
  prepare?: (page: Page) => Promise<void>;
};

/** Open every collapsed sidebar section, so the whole nav is on screen. */
async function expandSidebar(page: Page) {
  for (let i = 0; i < 12; i++) {
    const shut = page.locator('.side__sec[aria-expanded="false"]');
    if (!(await shut.count())) break;
    await shut.first().click({ timeout: 5_000 }).catch(() => {});
    await page.waitForTimeout(320);   // --dur-base, the grid-rows transition
  }
  await page.waitForTimeout(400);
}

const GANIT: Tab[] = [
  t('invoices'), t('clients'), t('contacts'), t('products'), t('expenses'),
  t('payables'), t('contracts'), t('e-sign'), t('collections'),
  t('billing-profiles'), t('service-lines'), t('metered-usage'), t('rate-cards'),
  t('sla-credits'), t('ageing'), t('recurring'), t('bank'), t('timesheet'),
  t('stats', 'GST filing'), t('analytics'), t('settings'),
];
const GRAHA: Tab[] = [
  t('today'), t('clients'), t('contacts'), t('deals'), t('kanban'), t('pipeline'),
  t('follow-ups'), t('labels'), t('activities'), t('reports'), t('territories'),
  t('fields'), t('web-forms'), t('approvals'), t('documents'), t('dedupe'),
  t('analytics'), t('client-report'), t('billing'), t('metered-usage'),
];
const KRAY: Tab[] = [
  t('purchase orders'), t('vendors'), t('payables'), t('approvals'), t('budgets'),
  t('rate-cards'), t('sla-credits'), t('ageing'), t('reports'), t('settings'),
];
const MANAV: Tab[] = [
  'employees', 'attendance', 'shifts', 'leaves', 'expenses', 'commission', 'bonus',
  'recruitment', 'announcements', 'departments', 'holidays', 'performance',
  'assets', 'exits', 'custody', 'dsc', 'udin', 'notices', 'logins', 'analytics',
].map((x) => t(x));
const VETANA: Tab[] = ['dashboard', 'structures', 'payroll', 'payslips', 'loans', 'statutory', 'analytics'].map((x) => t(x));
const PAHCHAN: Tab[] = [
  t('clock', 'Clock in'), t('register', 'Register'), t('corrections', 'Corrections'),
  t('payroll', 'Payroll'), t('history', 'My attendance'), t('notice', 'What we record'),
  t('consent', 'Consent'), t('enrollment', 'Enrollment'), t('policy', 'Policy'),
  t('analytics', 'Analytics'),
];
const VIKRAY: Tab[] = [
  'dashboard', 'orders', 'products', 'stock', 'pipeline', 'targets', 'clients',
  'contacts', 'customers', 'billing', 'metered-usage', 'analytics',
].map((x) => t(x));
const PRACHAR: Tab[] = ['dashboard', 'campaigns', 'ads', 'sequences', 'templates', 'unsubscribes', 'events', 'analytics'].map((x) => t(x));
const DRISTI: Tab[] = [
  t('overview'), t('revenue'), t('pipeline'), t('hr', 'HR'), t('sales'),
  t('reports'), t('dashboards'), t('pivot'),
];
const ESIGN: Tab[] = [t('documents', 'Documents'), t('create', 'New document'), t('analytics', 'Analytics')];
const HUB_DASH: Tab[] = ['generate', 'content', 'chat', 'knowledge', 'publish', 'brand', 'credits'].map((x) => t(x));
const HUB_CLIENT: Tab[] = ['overview', 'generate', 'content', 'chat', 'knowledge', 'publish', 'brand', 'credits', 'skills'].map((x) => t(x));
const HUB_SKILLS: Tab[] = ['assigned', 'catalog', 'create', 'requests', 'guide'].map((x) => t(x));
const HUB_ORG: Tab[] = ['sahayak', 'skills', 'content', 'generate', 'data catalog', 'data runs', 'credits'].map((x) => t(x));

/** First team id in this org, read with a GET. Used for `/projects/:id`. */
async function firstProject(page: Page): Promise<string | null> {
  const rows = await getRows(page, '/api/teams?limit=5');
  const id = rows.find((r: any) => r?.team_id || r?.id);
  return id ? String(id.team_id ?? id.id) : null;
}
async function firstHubClient(page: Page): Promise<string | null> {
  const rows = await getRows(page, '/api/v1/hub/clients?limit=5');
  const id = rows.find((r: any) => r?.id);
  return id ? String(id.id) : null;
}

const SHARDS: Record<string, Screen[]> = {
  // The app shell itself — swept ONCE rather than 150 times, because the
  // sidebar and topbar are the same controls on every screen.
  chrome: [{ key: 'chrome', path: '/dashboard', prepare: expandSidebar }],

  core: [
    { key: 'dashboard', path: '/dashboard' },
    { key: 'boards', path: '/boards' },
    { key: 'projects', path: '/projects' },
    { key: 'project-detail', path: '/projects/:id', resolve: firstProject },
    { key: 'tasks', path: '/tasks' },
    { key: 'teams', path: '/teams' },
    { key: 'inbox', path: '/inbox' },
    { key: 'approvals', path: '/approvals' },
    { key: 'templates', path: '/templates' },
    { key: 'activity', path: '/activity' },
    { key: 'time', path: '/time' },
    { key: 'reports', path: '/reports' },
    { key: 'categories', path: '/settings/categories' },
  ],

  settings: [
    {
      key: 'org-settings', path: '/settings/organisation',
      urlTabs: ['profile', 'members', 'billing', 'modules', 'compliance', 'senders',
        'upi', 'security', 'storage', 'recycle', 'danger'],
    },
    {
      key: 'customize', path: '/settings/customize',
      urlTabs: ['appearance', 'typography', 'layout', 'language', 'notifications', 'security', 'data'],
    },
    { key: 'roles', path: '/settings/roles' },
    { key: 'connectors', path: '/settings/connectors' },
    { key: 'social-accounts', path: '/settings/social-accounts' },
    { key: 'automations', path: '/settings/automations' },
  ],

  money: [
    { key: 'ganit', path: '/ganit', tabs: GANIT },
    { key: 'kray', path: '/kray', tabs: KRAY },
    { key: 'vikray', path: '/vikray', tabs: VIKRAY },
  ],

  people: [
    { key: 'manav', path: '/manav', tabs: MANAV },
    { key: 'vetana', path: '/vetana', tabs: VETANA },
    { key: 'pahchan', path: '/pahchan', tabs: PAHCHAN },
  ],

  crm: [
    { key: 'graha', path: '/graha', tabs: GRAHA },
    { key: 'prachar', path: '/prachar', tabs: PRACHAR },
    { key: 'dristi', path: '/dristi', tabs: DRISTI },
  ],

  comms: [
    { key: 'esign', path: '/esign', tabs: ESIGN },
    { key: 'sanvaad', path: '/sanvaad' },
    { key: 'hub', path: '/hub', tabs: HUB_DASH },
    { key: 'hub-clients', path: '/hub/clients' },
    { key: 'hub-client', path: '/hub/clients/:id', tabs: HUB_CLIENT, resolve: firstHubClient },
    { key: 'hub-skills', path: '/hub/clients/:id/skills', tabs: HUB_SKILLS, resolve: firstHubClient },
    { key: 'hub-org', path: '/hub/org', tabs: HUB_ORG },
  ],
};

// ════════════════════════════════════════════════════════════════════════════
// LEDGER — on disk, line by line, because a new worker resets module state
// ════════════════════════════════════════════════════════════════════════════
type Row = {
  shard: string; screen: string; tab: string;
  idx: number; tag: string; role: string;
  ariaLabel: string; text: string; cls: string;
  group: string; groupSize: number;
  verdict: 'ALIVE' | 'DEAD' | 'NOOP' | 'BROKEN' | 'INTERCEPTED' | 'EXCLUDED' | 'HELD' | 'UNCLICKABLE' | 'SEEN';
  why?: string;
  reqs?: string[]; worst?: number; mut?: number; noiseMut?: number;
  navigated?: boolean; dialog?: string; popup?: string; download?: string;
  consoleErrors?: string[]; flaky?: boolean; blocker?: string;
  active?: boolean; submitsInvalidForm?: boolean; opensFilePicker?: boolean;
};

function ledgerFile(shard: string) { return path.join(LEDGER_DIR, `${shard}.jsonl`); }
function netFile(shard: string) { return path.join(LEDGER_DIR, `${shard}.writes.jsonl`); }

function append(file: string, obj: any) {
  fs.appendFileSync(file, JSON.stringify(obj) + '\n', 'utf8');
}

function readLedger(): Row[] {
  const out: Row[] = [];
  for (const f of fs.readdirSync(LEDGER_DIR)) {
    if (!f.endsWith('.jsonl') || f.endsWith('.writes.jsonl')) continue;
    for (const line of fs.readFileSync(path.join(LEDGER_DIR, f), 'utf8').split('\n')) {
      if (line.trim()) { try { out.push(JSON.parse(line)); } catch { /* partial last line */ } }
    }
  }
  return out;
}
function readWrites(): any[] {
  const out: any[] = [];
  for (const f of fs.readdirSync(LEDGER_DIR)) {
    if (!f.endsWith('.writes.jsonl')) continue;
    for (const line of fs.readFileSync(path.join(LEDGER_DIR, f), 'utf8').split('\n')) {
      if (line.trim()) { try { out.push(JSON.parse(line)); } catch { /* partial */ } }
    }
  }
  return out;
}

// ════════════════════════════════════════════════════════════════════════════
// SIGN IN — the lane, and the guard, exactly as every other 93 suite does it
// ════════════════════════════════════════════════════════════════════════════
async function signIn(page: Page) {
  await laneSignIn(page, LANE);
  await page.evaluate((id) => localStorage.setItem('Kartavaya_active_org', id), LANE.orgId);
  await assertOrg(page.request, page, LANE);
  expect(LANE.orgId, 'the lane must be Unicode Group and never Aekam Inc').toBe(ORG_IDS.UNICODE);
  expect(LANE.orgId, 'the lane must never be Aekam Inc').not.toBe(ORG_IDS.AEKAM);
}

/** GET only. The bypass ratchet's own carve-out: reading is evidence, not creation. */
async function getRows(page: Page, pathAndQuery: string): Promise<any[]> {
  const token = await page.evaluate(() => localStorage.getItem('auth_token'));
  const res = await page.request.get(`${API}${pathAndQuery}`, {
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'X-Org-Id': LANE.orgId },
  });
  if (!res.ok()) return [];
  const body = await res.json().catch(() => null);
  if (Array.isArray(body)) return body;
  if (Array.isArray(body?.data)) return body.data;
  if (Array.isArray(body?.items)) return body.items;
  if (Array.isArray(body?.results)) return body.results;
  return [];
}

// ════════════════════════════════════════════════════════════════════════════
// THE BROWSER-SIDE ENUMERATOR
// ════════════════════════════════════════════════════════════════════════════
//
// One `page.evaluate` that walks a scope, filters to visible+enabled controls,
// stamps each with `data-sw="<n>"` and hands back a descriptor per control.
// Everything after this point addresses controls by that stamp — never by role
// and name, which is the trap this whole file is written around.
function ENUMERATE(arg: { scopeSel: string; excludeSel: string; collapse: boolean }) {
  const SEL = [
    'button', 'a[href]', 'summary',
    '[role="button"]', '[role="tab"]', '[role="menuitem"]', '[role="menuitemcheckbox"]',
    '[role="switch"]', '[role="checkbox"]', '[role="option"]', '[role="link"]',
    'input[type="checkbox"]', 'input[type="radio"]',
  ].join(',');

  const scope: Element | null = arg.scopeSel === 'body'
    ? document.body : document.querySelector(arg.scopeSel);
  if (!scope) return null;

  // ⚠ A CONTROL CAN HAVE A PERFECTLY HEALTHY BOUNDING BOX AND STILL BE INVISIBLE.
  //
  // `Sidebar.jsx` collapses a nav section with `grid-template-rows: 0fr` and
  // `overflow: hidden` on the row wrapper. The wrapper's height goes to 0; the
  // BUTTONS INSIDE IT KEEP A 235x53 RECT. Measured live on 2026-08-29: with
  // OPERATIONS collapsed, `Approvals` still reports a 53px-high box at y=400,
  // overlapping the next section's header — which is why the first real run
  // reported twenty-four sidebar items "intercepted by button.side__sec". They
  // were not covered. They were CLIPPED, and the rect lied.
  //
  // So visibility walks the ancestors for a clipping box of its own.
  const clipped = (el: Element) => {
    let a = el.parentElement;
    while (a && a !== document.body) {
      const cs = getComputedStyle(a);
      if (cs.overflow !== 'visible' || cs.overflowX !== 'visible' || cs.overflowY !== 'visible') {
        const r = a.getBoundingClientRect();
        if (r.width < 2 || r.height < 2) return true;
      }
      a = a.parentElement;
    }
    return false;
  };
  const vis = (el: Element) => {
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none') return false;
    if (Number(cs.opacity) === 0) return false;
    if (el.closest('[aria-hidden="true"]')) return false;
    if (el.closest('.k-sr-only')) return false;
    if (clipped(el)) return false;
    return true;
  };
  const enabled = (el: any) => {
    if (el.disabled) return false;
    if (el.getAttribute('aria-disabled') === 'true') return false;
    if (el.closest('fieldset[disabled]')) return false;
    if (el.closest('[inert]')) return false;
    return true;
  };
  // The ACCESSIBLE name, kept strictly apart from the visible text. Conflating
  // the two is the mistake that produced three false "missing control"
  // findings in one day, so this returns '' rather than falling back to text.
  const nameOf = (el: Element) => {
    const al = (el.getAttribute('aria-label') || '').trim();
    if (al) return al;
    const lb = el.getAttribute('aria-labelledby');
    if (lb) {
      const s = lb.split(/\s+/)
        .map((i) => (document.getElementById(i) as HTMLElement | null)?.innerText || '')
        .join(' ').replace(/\s+/g, ' ').trim();
      if (s) return s;
    }
    return (el.getAttribute('title') || '').trim();
  };

  // Previous stamps go first: a re-render can move an element, and a stale
  // number would address the wrong one.
  document.querySelectorAll('[data-sw]').forEach((old) => old.removeAttribute('data-sw'));

  const out: any[] = [];
  let n = 0;
  scope.querySelectorAll(SEL).forEach((el) => {
    if (arg.excludeSel && el.closest(arg.excludeSel)) return;
    if (!vis(el) || !enabled(el)) return;
    el.setAttribute('data-sw', String(n));
    const cls = String(el.getAttribute('class') || '').split(/\s+/).filter(Boolean).sort().join('.');
    const role = el.getAttribute('role') || el.tagName.toLowerCase();
    const text = ((el as HTMLElement).innerText || '').replace(/\s+/g, ' ').trim().slice(0, 120);

    // Is this control ALREADY the chosen one? A filter chip reading "All" on a
    // list that is already unfiltered fires nothing and changes nothing — and
    // it is RIGHT not to. Without this the census cannot tell that apart from a
    // control with nothing behind it, and the first full run produced four such
    // rows (esign "All", esign "Default", hub "All 0", manav "Definitions").
    // ── TWO OUTCOMES NO REQUEST/DOM/NAV OBSERVER CAN EVER SEE ───────────────
    //
    // Both were measured on the first full run, and both would have been
    // published as dead controls:
    //
    //  · A `type="submit"` inside a form with an unfilled `required` field
    //    raises the BROWSER'S OWN validation bubble. That bubble is browser
    //    chrome, not DOM: no request, no mutation, no navigation. `Add credits`
    //    on `hub/CreditsTab.jsx` is exactly this — `<button type="submit">` over
    //    an `<input required>` — and it reported dead on three screens while
    //    being completely correct.
    //  · A control that opens the NATIVE FILE CHOOSER — the eSign dropzone —
    //    is the same shape: the picker is an OS window.
    //
    // So the enumerator records the shape, and `clickOne` refuses to call
    // either of them dead.
    const form = (el as HTMLInputElement).form
      || (el.getAttribute('type') === 'submit' ? el.closest('form') : null);
    const submitsInvalidForm = !!form
      && (el.getAttribute('type') === 'submit' || el.tagName === 'BUTTON')
      && typeof (form as HTMLFormElement).checkValidity === 'function'
      && !(form as HTMLFormElement).checkValidity();
    const opensFilePicker = !!(
      el.querySelector('input[type="file"]')
      || (el.closest('label') && el.closest('label')!.querySelector('input[type="file"]'))
      || (el.parentElement && el.parentElement.querySelector('input[type="file"]'))
    );

    const active = el.getAttribute('aria-selected') === 'true'
      || el.getAttribute('aria-current') != null && el.getAttribute('aria-current') !== 'false'
      || el.getAttribute('aria-pressed') === 'true'
      || /(^|[\s.])(on|active|is-active|selected|current)([\s.]|$)/.test(' ' + cls.replace(/\./g, ' ') + ' ');

    // ── HOW CONTROLS ARE GROUPED, and why the rule turns on ONE thing ────────
    //
    // A table renders the same control once per row. Clicking thirty Open
    // buttons is thirty clicks and one fact, so those are grouped and sampled.
    // But the sidebar also renders twenty-nine buttons that share a class —
    // and every one of them is a DIFFERENT destination, which is exactly where
    // a dead link would matter most. Grouping on the class alone would have
    // sampled four of the twenty-nine and called the nav swept.
    //
    // So the key carries the TEXT unless the control is inside a table BODY
    // row, where the text is the record's own name and is not a distinction
    // between controls. `thead` is deliberately outside this: sort headers are
    // separate controls per column and each is a real dead-control candidate.
    const inRow = !!el.closest('tbody tr, tbody [role="row"], [role="rowgroup"] [role="row"]');
    const group = el.tagName.toLowerCase() + '|' + role + '|' + cls + (inRow ? '|<row>' : '|' + text);

    out.push({
      idx: n,
      tag: el.tagName.toLowerCase(),
      role,
      ariaLabel: nameOf(el),
      text,
      cls: cls.slice(0, 160),
      active, submitsInvalidForm, opensFilePicker,
      href: el.tagName === 'A' ? String(el.getAttribute('href') || '').slice(0, 120) : '',
      group,
    });
    n++;
  });

  // ── SECOND PASS: collapse a bucket that is plainly DATA REPETITION ────────
  //
  // A table row is caught above by `inRow`. A KANBAN BOARD is not — Graha's
  // thirty deal cards are not in a `tbody`, so each carried its own record name
  // and each became its own group, and the first full run clicked thirty cards
  // to learn one fact. So a `tag|role|class` bucket of ten or more collapses
  // its text out of the key as well.
  //
  // TEN, not six: a filter-chip row is typically six or eight controls that
  // share a class and are genuinely DIFFERENT controls ("All", "Draft",
  // "Sent"), and collapsing those would sample four of eight on exactly the
  // kind of strip where a dead chip hides. Ten is above every chip row measured
  // on this product and below every data list.
  //
  // ⚠ AND IT IS OFF FOR THE APP SHELL. The sidebar renders twenty-nine
  // `button.side__item` — one bucket, and every one of them a DIFFERENT
  // destination. Collapsing there would sample four of twenty-nine and report
  // the navigation swept. The `chrome` screen passes `collapse: false`.
  if (arg.collapse) {
    const bucket = new Map<string, number>();
    for (const d of out) {
      const k = d.tag + '|' + d.role + '|' + d.cls;
      bucket.set(k, (bucket.get(k) || 0) + 1);
    }
    for (const d of out) {
      const k = d.tag + '|' + d.role + '|' + d.cls;
      if ((bucket.get(k) || 0) >= 10) d.group = k + '|<repeated>';
    }
  }
  return out;
}

type Desc = {
  idx: number; tag: string; role: string; ariaLabel: string; text: string;
  cls: string; active: boolean; submitsInvalidForm: boolean; opensFilePicker: boolean;
  href: string; group: string;
};

/** `scope` is where to look; `exclude` is what to leave for another pass. */
async function enumerate(page: Page, scope: string, exclude = '', collapse = true): Promise<Desc[] | null> {
  return (await page.evaluate(ENUMERATE, { scopeSel: scope, excludeSel: exclude, collapse })) as any;
}

/** Two descriptors are the same control when everything but the index matches. */
const sameControl = (a: Desc, b: Desc) =>
  a.tag === b.tag && a.role === b.role && a.ariaLabel === b.ariaLabel &&
  a.text === b.text && a.cls === b.cls;

/** The name a human would read. Both halves are kept; this is only for display. */
const shownName = (d: Desc) => d.ariaLabel || d.text || d.href || `<${d.tag} ${d.cls.slice(0, 40)}>`;

/**
 * The names a destructive rule may be matched against — and the two shapes it
 * must NOT be, both found by running the enumeration before finalising the
 * allowlist rather than by imagining it.
 *
 *  · **A column sort header carries the DATA's name, not a verb.** The contacts
 *    register has a column headed `EMAIL`, rendered as `button.tbl__sort`, and
 *    the send rule matched it — which would have excluded a plain sort control
 *    from a sweep whose entire subject is whether sort controls work. A sort
 *    header cannot send, delete or arm anything; it re-orders a list. Same for
 *    the module tab strip, whose labels are the tab ids.
 *  · **A 200-character `aria-label` is a description, not a label.** Ganit's
 *    analytics presets carry a full sentence — "…'paid' only ever comes from
 *    bank reconciliation" — and the safety net matched `reconcile` inside it.
 *    A control a person can read the label of is short; anything past 64
 *    characters is prose about the control, and matching a verb inside prose is
 *    how an allowlist starts excluding the product.
 */
function matchableNames(d: Desc, max: number): string[] {
  if (/\btbl__sort\b/.test(d.cls) || /\bmt__b\b/.test(d.cls) || /\btabs__b\b/.test(d.cls)) return [];
  if (d.role === 'tab') return [];
  return [d.ariaLabel, d.text]
    .filter(Boolean)
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter((s) => s.length <= max);
}

function ruleFor(d: Desc, screenKey: string): Rule | null {
  // 64 for the reviewed allowlist: its entries are exact strings or anchored
  // patterns, so a longer window costs nothing and covers "Delete invoice
  // INV-2026-0007 permanently".
  const names = matchableNames(d, 64);
  for (const r of EXCLUDED) {
    if (r.where && !r.where.test(screenKey)) continue;
    for (const nm of names) {
      if (typeof r.match === 'string') { if (nm.toLowerCase() === r.match.toLowerCase()) return r; }
      else if (r.match.test(nm)) return r;
    }
  }
  return null;
}

function heldBySafetyNet(d: Desc): string | null {
  // 40 for the net, and TIGHTER than the allowlist on purpose: the net matches
  // a verb ANYWHERE in the name, so it needs the name to be a label rather than
  // a sentence. Measured on the enumeration pass — at 64 it held a dedupe group
  // header reading "▸ email s04.contact01@example.com 2 contacts" and a Prachar
  // calendar chip reading "S11-C1 · Email · already sent, so its date is fixed".
  // Neither is a control that sends anything; both are DATA with a verb in it.
  for (const nm of matchableNames(d, 40)) {
    if (SAFETY_NET.test(nm)) return nm.slice(0, 80);
  }
  return null;
}

// ════════════════════════════════════════════════════════════════════════════
// THE PER-PAGE INSTRUMENTS
// ════════════════════════════════════════════════════════════════════════════
type Probe = {
  reqs: { method: string; url: string }[];
  resps: { method: string; url: string; status: number }[];
  /** Non-GET requests the write fence stopped. A fired request, never sent. */
  blocked: { method: string; url: string }[];
  cons: string[];
  dialogs: string[];
  popups: string[];
  downloads: string[];
  reset(): void;
};

function instrument(page: Page, context: BrowserContext, shard: string): Probe {
  const p: Probe = {
    reqs: [], resps: [], blocked: [], cons: [], dialogs: [], popups: [], downloads: [],
    reset() {
      p.reqs.length = 0; p.resps.length = 0; p.blocked.length = 0; p.cons.length = 0;
      p.dialogs.length = 0; p.popups.length = 0; p.downloads.length = 0;
    },
  };
  page.on('request', (r) => { if (r.url().startsWith(API)) p.reqs.push({ method: r.method(), url: r.url() }); });
  page.on('response', (r) => {
    if (!r.url().startsWith(API)) return;
    const m = r.request().method();
    p.resps.push({ method: m, url: r.url(), status: r.status() });
    // ⚠ EVERY non-GET that REACHES the server goes on the record at the moment
    // it happens — §7 asks the report to say exactly what was written, and a
    // list assembled from memory after a crash says nothing. With the write
    // fence installed the only entries here should be the named read-shaped
    // POSTs; anything else appearing is the fence having failed, and it is
    // recorded so that failure is visible rather than assumed away.
    if (m !== 'GET' && m !== 'OPTIONS' && m !== 'HEAD') {
      append(netFile(shard), { at: new Date().toISOString(), method: m, url: r.url().replace(API, ''), status: r.status(), reachedServer: true });
    }
  });
  page.on('console', (m) => { if (m.type() === 'error') p.cons.push(m.text().slice(0, 220)); });
  page.on('pageerror', (e) => p.cons.push('pageerror: ' + String(e).slice(0, 220)));
  // Cancel, always. A confirm-guarded destructive act cannot complete.
  page.on('dialog', async (d) => { p.dialogs.push(`${d.type()}: ${d.message().slice(0, 140)}`); await d.dismiss().catch(() => {}); });
  // Close, always. An OAuth consent screen is never reached.
  context.on('page', async (pg) => { p.popups.push(pg.url().slice(0, 140)); await pg.close().catch(() => {}); });
  page.on('download', async (d) => { p.downloads.push(d.suggestedFilename()); await d.cancel().catch(() => {}); });
  return p;
}

// ════════════════════════════════════════════════════════════════════════════
// ⚠⚠ THE WRITE FENCE — WHY "CLICK IT AND SEE" IS NOT THE METHOD ANY MORE
// ════════════════════════════════════════════════════════════════════════════
//
// ── The incident, recorded rather than summarised ───────────────────────────
// On 2026-08-29 this sweep clicked the Active/Paused chip on Dristi's Reports
// tab and sent `PATCH /api/v1/dristi/scheduled-reports/{id}` against BOTH of
// Suite 12's scheduled reports, setting `is_active=false` on rows that suite
// was concurrently asserting on. The scheduled-report CRUD writes no
// `audit_log` row, so the only trace was the state itself. It also created two
// `prachar_templates`, amended two `prachar_events`, and ran
// `POST /pahchan/attendance/publish` TWICE — publishing attendance to payroll.
//
// None of those controls was on the reviewed allowlist, and no allowlist would
// reliably have held them: "Active", "Paused", "Publish to payroll" and
// "Preview" are ordinary words, and the sweep's whole premise is that it does
// not know in advance what a control does.
//
// ── So the premise changed, not the allowlist ───────────────────────────────
// A sweep whose purpose is to find controls that do NOTHING must never be the
// thing that finds out by doing something irreversible.
//
// ⚠ AND THE ALLOWLIST COULD NOT HAVE BEEN MADE GOOD ENOUGH. That is the part
// worth writing down, because the obvious response to the incident is "add the
// missing names", and it is wrong. YOU CANNOT ENUMERATE WHAT A CONTROL DOES
// FROM ITS LABEL. The four that caused the damage were `Active`, `Paused`,
// `Duplicate` and `Cancel` — and `Cancel` is the word this sweep must keep
// clicking everywhere else, because everywhere else it closes a dialog. A fifth,
// `Preview` on Pahchan › Payroll, POSTs to `/attendance/publish`.
//
// The first shard run under the fence settled it as a measurement rather than
// an argument. In under ten minutes, on `crm` alone, it stopped FOURTEEN writes
// that the previous method executed:
//
//     2×  POST  /api/v1/vikray/orders/from-deal/{id}      would have raised two sales orders
//     1×  POST  /api/v1/ganit/invoices/from-deal/{id}     would have raised an invoice
//     4×  PATCH /api/v1/graha/deals/{id}                  would have moved four deals
//     3×  PATCH /api/v1/graha/follow-ups/{id}/complete    would have closed three follow-ups
//     1×  PATCH /api/v1/graha/activities/{id}/complete    would have closed an activity
//     3×  other
//
// Not one of those controls was on any allowlist, and no reading of their
// labels would have put them there. An allowlist is a guess about meaning; the
// fence is a fact about the wire.
//
// Every request this suite's clicks produce is now intercepted at the network
// layer:
//
//   GET · HEAD · OPTIONS          pass through — reading is not writing.
//   a NAMED read-shaped POST      passes through, and each one is named below
//                                 with the line of backend source that proves
//                                 it only reads.
//   EVERYTHING ELSE               is ABORTED before it leaves the browser, and
//                                 recorded as "would have fired".
//
// §10 asks the sweep to record "request fired". A request that was fired and
// blocked IS a request fired — the control is ALIVE and the ledger says exactly
// what it would have sent, which is MORE than the old method recorded, not less.
//
// ⚠ THE COST, AND A READER WHO DOES NOT KNOW IT WILL OVER-READ THE DEAD COUNT:
// the STATUS of a non-GET is gone, so **BROKEN IS MEASURABLE ON GET ONLY**
// (plus the two named read-POSTs). A rate-card DELETE that answers 405 now
// reads ALIVE-with-a-blocked-DELETE, not BROKEN. The census prints this in its
// own header so it cannot be missed. It is the right trade: a 405 found by
// performing a DELETE is not a finding, it is an incident with a note attached.
//
// The name allowlist and the switch exclusion BOTH STAY. They are defence in
// depth and they stop things this fence cannot: an OAuth popup, a `localStorage`
// change, a client-side navigation away from the run.

/**
 * Non-GET requests that only READ, each verified in the backend source.
 * A prefix is not a stack: these are whole paths, matched exactly.
 */
const READ_SHAPED_POSTS: { path: string; why: string }[] = [
  { path: '/api/v1/dristi/query',
    why: 'routers/dristi.py:1797 `run_pivot_query` — resolves `body.source` against ' +
         '`_ALLOWED_QUERY_TABLES`, checks module reachability, and builds an aggregate ' +
         'SELECT from a server-side column allowlist. It is a POST only because the ' +
         'pivot spec is a body. Blocking it would blank six Dristi tabs and under-count ' +
         'their controls' },
  { path: '/api/v1/prachar/audience/preview',
    why: 'routers/prachar.py:858 — its own docstring is "Count a segment that has not ' +
         'been saved onto a campaign yet". A count, and the reason the screen has a ' +
         'preview at all' },
];

/** Install the fence. Call AFTER sign-in, before the first sweep click. */
async function installWriteFence(page: Page, shard: string, blocked: { method: string; url: string }[]) {
  await page.route('**/*', async (route) => {
    const req = route.request();
    const m = req.method();
    const url = req.url();
    if (m === 'GET' || m === 'HEAD' || m === 'OPTIONS') return route.continue();
    if (!url.startsWith(API)) return route.continue();
    const p = url.replace(API, '').split('?')[0];
    if (m === 'POST' && READ_SHAPED_POSTS.some((r) => r.path === p)) return route.continue();
    blocked.push({ method: m, url: p });
    append(netFile(shard), { at: new Date().toISOString(), method: m, url: p, blocked: true });
    return route.abort('blockedbyclient');
  });
}

/** Mutation counter, installed before any document exists on this context. */
const OBSERVER = () => {
  (window as any).__sw = { mut: 0 };
  const start = () => {
    try {
      const obs = new MutationObserver((recs) => {
        for (const r of recs) {
          // The stamp this suite writes is itself an attribute mutation.
          // That is the ONLY thing filtered here, and the narrowness is a
          // correction rather than a preference: an earlier version also
          // ignored `.kv__side` and `.k-notif-anchor` as "poll noise", and on
          // the first real run that made the sidebar's six section headers and
          // the notification bell read DEAD — six false findings from one
          // convenience. Noise is handled by MEASURING an idle floor per
          // screen, never by declaring a region of the product uninteresting.
          if (r.type === 'attributes' && r.attributeName === 'data-sw') continue;
          (window as any).__sw.mut++;
        }
      });
      obs.observe(document.documentElement, {
        childList: true, subtree: true, attributes: true, characterData: true,
      });
    } catch { /* a page that has no documentElement yet cannot be observed */ }
  };
  if (document.documentElement) start();
  else document.addEventListener('DOMContentLoaded', start);
};

const mutCount = (page: Page) => page.evaluate(() => ((window as any).__sw?.mut ?? 0) as number);
const mutReset = (page: Page) => page.evaluate(() => { if ((window as any).__sw) (window as any).__sw.mut = 0; });

// ════════════════════════════════════════════════════════════════════════════
// NAVIGATION
// ════════════════════════════════════════════════════════════════════════════
async function settle(page: Page, ms = 700) {
  await page.waitForLoadState('domcontentloaded', { timeout: 30_000 }).catch(() => {});
  await page.waitForTimeout(ms);
}

/**
 * Select a module tab the way a person does.
 *
 * `#mt-tab-<id>` exists only for tabs currently INLINE, and which those are is
 * MEASURED by `ModuleTabs` from its own strip width at run time — so it is not
 * knowable from the source and must never be assumed. When the tab is in the
 * tail it is reached through the real "More" popover, matched on the label the
 * popover renders (`.mt__pop-en`), which is why every tab in the inventory
 * above carries its label explicitly.
 *
 * Returns false when the tab is not on the strip AND not in the menu — which is
 * itself a finding and is recorded as an ABSENT screen, never as a pass.
 */
type TabResult = { ok: boolean; why: string };

async function selectTab(page: Page, tab: Tab): Promise<TabResult> {
  const panel = () => page.locator(`[id="mt-panel-${tab.id}"]`);

  // The ATTRIBUTE form, not `#mt-tab-…`: three tab ids in this product contain
  // a space (`purchase orders`, `data catalog`, `data runs`), which an id
  // selector cannot express and which a naive `#` selector would silently turn
  // into a descendant combinator — reporting the whole screen missing.
  const direct = page.locator(`[id="mt-tab-${tab.id}"]`);
  if (await direct.count()) {
    await direct.first().click({ timeout: 10_000 }).catch(() => {});
    await settle(page);
    const seen = await panel().first().waitFor({ state: 'attached', timeout: 8_000 }).then(() => true).catch(() => false);
    return seen ? { ok: true, why: 'inline on the strip' }
      : { ok: false, why: `the tab button "${tab.label}" is on the strip and was clicked, but no [id="mt-panel-${tab.id}"] ever rendered` };
  }

  const more = page.locator('button.mt__more');
  if (!(await more.count())) {
    return { ok: false, why: `no strip button [id="mt-tab-${tab.id}"] and this module renders no More trigger at all` };
  }
  await more.first().click({ timeout: 10_000 }).catch(() => {});

  // ⚠ WAIT for the popover. `count()` does not auto-wait, and React needs a
  // tick to mount `.mt__pop` — reading it immediately reports an empty menu and
  // would file "this tab does not exist" against a tab that simply had not
  // painted yet. That is a manufactured finding, which is worse than a flake.
  const pop = page.locator('.mt__pop');
  const opened = await pop.first().waitFor({ state: 'visible', timeout: 8_000 }).then(() => true).catch(() => false);
  if (!opened) return { ok: false, why: 'the More trigger was clicked and no .mt__pop menu opened' };

  const rows = pop.locator('[role="menuitem"]');
  const n = await rows.count();
  const seenLabels: string[] = [];
  for (let i = 0; i < n; i++) {
    const label = (await rows.nth(i).locator('.mt__pop-en').textContent().catch(() => '') || '')
      .replace(/\s+/g, ' ').trim();
    if (label) seenLabels.push(label);
    if (label.toLowerCase() !== tab.label.toLowerCase()) continue;
    await rows.nth(i).click({ timeout: 10_000 }).catch(() => {});
    await settle(page);
    const seen = await panel().first().waitFor({ state: 'attached', timeout: 8_000 }).then(() => true).catch(() => false);
    return seen ? { ok: true, why: 'from the More menu' }
      : { ok: false, why: `the More menu row "${tab.label}" was clicked and no [id="mt-panel-${tab.id}"] rendered` };
  }
  // Nothing matched — close the menu so the next screen starts clean, and say
  // what the menu DID hold, because "not found" without the alternatives is the
  // shape of a false missing-control finding.
  await page.keyboard.press('Escape').catch(() => {});
  return { ok: false, why: `"${tab.label}" is not on the strip and not in the More menu, which held: ${seenLabels.join(' | ') || '(nothing)'}` };
}

/** Go to a screen and put it in the state the sweep measures. */
async function goScreen(page: Page, s: Screen, tab: Tab | null, resolved: string | null): Promise<TabResult> {
  const url = s.path.includes(':id') ? (resolved ? s.path.replace(':id', resolved) : '') : s.path;
  if (!url) return { ok: false, why: 'this screen needs a record id and none was resolved' };
  await page.goto(url, { waitUntil: 'domcontentloaded' }).catch(() => {});
  await settle(page, 1200);
  if (s.prepare) await s.prepare(page);
  if (!tab) return { ok: true, why: '' };

  // ⚠ WAIT FOR THE STRIP TO EXIST BEFORE ASKING WHAT IS ON IT.
  //
  // This cost forty-three false findings on the first full run. `settle()` is a
  // fixed 1.2 s, Graha needs longer, and `locator.count()` does NOT auto-wait —
  // so `[id="mt-tab-contacts"]` read 0, `button.mt__more` read 0, and the
  // ledger recorded "this module renders no More trigger at all" against a
  // module that renders twenty tabs. Every one of those would have been
  // published as a screen that does not exist.
  //
  // A control you could not locate is not a dead control, and a SCREEN you
  // asked about too early is not a missing screen.
  const strip = page.locator('.mt__wrap');
  const painted = await strip.first().waitFor({ state: 'attached', timeout: 20_000 })
    .then(() => true).catch(() => false);
  if (!painted) {
    return { ok: false, why: `no module tab strip (.mt__wrap) ever rendered on ${url} within 20s` };
  }
  return await selectTab(page, tab);
}

async function goUrlTab(page: Page, s: Screen, tabValue: string): Promise<boolean> {
  await page.goto(`${s.path}?tab=${tabValue}`, { waitUntil: 'domcontentloaded' }).catch(() => {});
  await settle(page, 1200);
  return (await page.locator('.tabs__panel').count()) > 0;
}

/** Escape whatever the last click opened, and say whether the screen survived. */
/**
 * Escape whatever the last click opened. Returns TRUE if something is still
 * open afterwards.
 *
 * ⚠ THIS IS NOT HYPOTHETICAL AND IT CORRUPTED A RUN. `sahayak/DataCatalogTab.jsx`
 * renders `<div class="sr-modal" role="dialog" aria-modal="true">` and has NO
 * Escape handler anywhere in the file — it closes only on a scrim click. On the
 * first full run Escape left it open and the next EIGHTEEN controls on that
 * screen were all reported "intercepted by div.sr-modal": one product defect
 * printed as eighteen findings.
 *
 * So the caller re-navigates when this returns true. The defect itself is a
 * finding in its own right (93 §1: "Escape closes every modal and drawer") and
 * is reported, not worked around silently.
 */
async function closeOverlays(page: Page): Promise<boolean> {
  const sel = '[role="dialog"], [aria-modal="true"], .mt__pop, [role="menu"], [role="listbox"]';
  for (let i = 0; i < 2; i++) {
    if (!(await page.locator(sel).count())) return false;
    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(300);
  }
  return (await page.locator(sel).count()) > 0;
}

// ════════════════════════════════════════════════════════════════════════════
// THE SWEEP OF ONE SCREEN
// ════════════════════════════════════════════════════════════════════════════
//
// `scope` narrows the enumeration so a module's tab strip is swept once rather
// than once per tab: the module root sweeps `#main` MINUS the open panel, and
// each tab sweeps only its own `#mt-panel-<id>`.
const MAX_SMALL_GROUP = 8;   // a group this size or smaller is clicked entirely
const BIG_GROUP_PICKS = 4;   // otherwise: first, second, middle, last

function pickIndices(members: number[]): number[] {
  if (members.length <= MAX_SMALL_GROUP) return members;
  const last = members.length - 1;
  const mid = Math.floor(members.length / 2);
  return [...new Set([members[0], members[1], members[mid], members[last]])].slice(0, BIG_GROUP_PICKS);
}

type Ctx = {
  shard: string; page: Page; probe: Probe;
  screen: Screen; tabId: string; tab: Tab | null;
  resolved: string | null; urlTab?: string;
  /** Where this pass looks, and what it leaves for another pass. */
  scope: string; exclude: string;
  /** The account's own sidebar arrangement, written back between clicks. */
  sidebar?: Record<string, string | null>;
  /** False only for the app shell — see the second pass in ENUMERATE. */
  collapse?: boolean;
};

async function sweepScope(c: Ctx): Promise<number> {
  const { page, probe, shard, scope, exclude } = c;
  const file = ledgerFile(shard);
  const screenKey = c.screen.key;

  // ── WAIT FOR THE SCREEN TO STOP ARRIVING, and do it by MEASURING rather
  //    than by sleeping a number somebody guessed.
  //
  // A fixed settle enumerated `Organisation › Modules` at ONE control while its
  // fourteen module cards were still in flight — i.e. it would have reported an
  // entire screen as having no controls, which on this suite reads as "swept
  // and clean". The inventory is re-counted until two consecutive readings
  // agree, so a screen is measured after it has finished painting.
  const COLLAPSE = c.collapse !== false;
  let base = await enumerate(page, scope, exclude, COLLAPSE);
  for (let i = 0; i < 5 && base != null; i++) {
    await page.waitForTimeout(700);
    const again = await enumerate(page, scope, exclude, COLLAPSE);
    if (again != null && again.length === base.length) { base = again; break; }
    base = again;
  }
  if (base == null) {
    append(file, { shard, screen: screenKey, tab: c.tabId, idx: -1, verdict: 'UNCLICKABLE',
      why: `scope ${scope} is not on the page`, tag: '', role: '', ariaLabel: '', text: '', cls: '', group: '', groupSize: 0 });
    return 0;
  }
  if (!base.length) {
    append(file, { shard, screen: screenKey, tab: c.tabId, idx: -1, verdict: 'SEEN',
      why: 'no visible enabled control in this scope', tag: '', role: '', ariaLabel: '', text: '', cls: '', group: '', groupSize: 0 });
    return 0;
  }

  // ── THE NOISE FLOOR. Sit idle and record what happens anyway: the shell
  //    polls notifications on a timer, so a polling GET must never be read as
  //    a control doing something. Both figures go in the ledger, so every
  //    classification below can be audited against the noise it was made over.
  probe.reset();
  await mutReset(page);
  await page.waitForTimeout(1200);
  const noiseMut = await mutCount(page);
  const noisePaths = new Set(probe.reqs.map((r) => r.url.split('?')[0]));

  // ── GROUPS. A table renders one control per row; the whole group's size is
  //    recorded so the multiplicity is never hidden by the cap.
  const groups = new Map<string, number[]>();
  base.forEach((d) => {
    const arr = groups.get(d.group) || [];
    arr.push(d.idx);
    groups.set(d.group, arr);
  });
  const chosen = new Set<number>();
  for (const [, members] of groups) for (const i of pickIndices(members)) chosen.add(i);

  let clicks = 0;
  for (const d of base) {
    const groupSize = (groups.get(d.group) || []).length;
    // ⚠ `ariaLabel` and `text` are recorded SEPARATELY and never merged. That is
    // the whole guard against this programme's most expensive mistake: three
    // false "missing control" findings in one day came from `getByRole(name)`
    // matching the ACCESSIBLE name while the reader was looking at the visible
    // text. A census that printed one of them would reproduce the confusion.
    const common = {
      shard, screen: screenKey, tab: c.tabId, idx: d.idx, tag: d.tag, role: d.role,
      ariaLabel: d.ariaLabel, text: d.text, cls: d.cls, group: d.group, groupSize,
      active: d.active, submitsInvalidForm: d.submitsInvalidForm, opensFilePicker: d.opensFilePicker,
    };

    if (!chosen.has(d.idx)) {
      append(file, { ...common, verdict: 'SEEN', why: `group of ${groupSize}; a representative sample of it was clicked` });
      continue;
    }

    if (d.role === 'switch') {
      append(file, { ...common, verdict: 'EXCLUDED', why: SWITCHES_ARE_NOT_CLICKED });
      continue;
    }

    const rule = ruleFor(d, screenKey);
    if (rule) { append(file, { ...common, verdict: 'EXCLUDED', why: rule.why }); continue; }

    const held = heldBySafetyNet(d);
    if (held) {
      append(file, { ...common, verdict: 'HELD',
        why: `the destructive safety net matched "${held}" and no reviewed allowlist entry covers it — NOT clicked, and published here by name so it can be ruled on` });
      continue;
    }

    if (DRY) { append(file, { ...common, verdict: 'SEEN', why: 'SWEEP_DRY=1 — enumerated, not clicked' }); continue; }

    const res = await clickOne(c, d, noiseMut, noisePaths, false);
    clicks++;

    // ── THE CONFIRMING SECOND CLICK. A control you could not locate is not a
    //    dead control, and a control that was merely slow is not one either.
    //    Every candidate dead control is re-clicked from a freshly navigated
    //    screen, and must be dead on both.
    if (res.verdict === 'DEAD') {
      const ok = await reNavigate(c);
      if (!ok) {
        append(file, { ...common, ...res, verdict: 'UNCLICKABLE',
          why: 'looked dead, but the screen could not be re-reached to confirm it — recorded as unclickable rather than as a finding' });
        continue;
      }
      const again = await clickOne(c, d, noiseMut, noisePaths, true);
      clicks++;
      if (again.verdict === 'DEAD') {
        // ⚠ `again.why` carries the MEASURED numbers — mutations against the
        // idle floor. An earlier version replaced it with a sentence, and the
        // one false DEAD in the first run (`hub` › Brand, 16 mutations against
        // a 27 idle floor) was only diagnosable because those numbers survived
        // in the row's own fields. Keep the reason the verdict was reached.
        append(file, { ...common, ...again,
          why: `${again.why} — and the same on a second click, from a separate arrival at this screen` });
      } else if (again.verdict === 'UNCLICKABLE') {
        append(file, { ...common, ...again, verdict: 'UNCLICKABLE',
          why: `first click looked dead; on the confirming pass the control could not be re-found by its own descriptor (${again.why}). Not reported as dead` });
      } else {
        append(file, { ...common, ...again, flaky: true,
          why: `first click observed nothing, second click did (${again.verdict}) — a timing artefact, not a dead control` });
      }
    } else {
      append(file, { ...common, ...res });
    }

    await restore(c, base.length);
  }
  return clicks;
}

/**
 * ── THE SIDEBAR REMEMBERS, AND THAT BREAKS ISOLATION ────────────────────────
 *
 * `Sidebar.jsx` persists which nav sections are open to `localStorage`
 * (`kartavya_sidebar_sections`, `kartavya_sidebar_collapsed`). So clicking the
 * "OPERATIONS" section header collapses it — correctly — and the collapse then
 * SURVIVES every subsequent navigation. On the first real run that turned one
 * legitimate click into twenty-three false findings: the items underneath sat
 * behind their own section header, and `elementFromPoint` reported each of them
 * intercepted by `button.side__sec`.
 *
 * So the sweep snapshots the account's own sidebar arrangement before it starts
 * and writes it back between clicks. It is a per-viewer display preference on
 * the test account, restored to exactly what it was — the capture-edit-revert
 * shape §12 already uses for the admin console's global rows.
 */
const SIDEBAR_KEYS = ['kartavya_sidebar_sections', 'kartavya_sidebar_collapsed'];

async function snapshotSidebar(page: Page): Promise<Record<string, string | null>> {
  return await page.evaluate((keys) => {
    const out: Record<string, string | null> = {};
    for (const k of keys) out[k] = localStorage.getItem(k);
    return out;
  }, SIDEBAR_KEYS);
}
async function restoreSidebar(page: Page, snap: Record<string, string | null>) {
  await page.evaluate((s) => {
    for (const k of Object.keys(s)) {
      if (s[k] == null) localStorage.removeItem(k); else localStorage.setItem(k, s[k] as string);
    }
  }, snap);
}

/** Re-arrive at this screen from scratch. Used before a confirming click. */
async function reNavigate(c: Ctx): Promise<boolean> {
  if (c.sidebar) await restoreSidebar(c.page, c.sidebar);
  if (c.urlTab) return await goUrlTab(c.page, c.screen, c.urlTab);
  return (await goScreen(c.page, c.screen, c.tab, c.resolved)).ok;
}

/**
 * Put the screen back into the state the next click is measured from.
 *
 * Cheap for exactly the class this suite hunts: a dead control changed nothing,
 * so there is nothing to undo. A full re-navigation happens only when the URL
 * moved or the inventory no longer matches — i.e. when the previous click DID
 * something, which is the case where it is warranted.
 */
async function restore(c: Ctx, baseCount: number) {
  const { page } = c;
  const stuck = await closeOverlays(page);
  // The sidebar screen is the one place a click's effect PERSISTS across
  // navigation, so it is put back before anything else is judged.
  if (c.sidebar) { await restoreSidebar(page, c.sidebar); await reNavigate(c); return; }
  // An overlay Escape could not dismiss would sit over every remaining control
  // on this screen and turn one defect into a column of false interceptions.
  if (stuck) { await reNavigate(c); return; }
  const here = new URL(page.url()).pathname;
  const want = c.screen.path.includes(':id')
    ? (c.resolved ? c.screen.path.replace(':id', c.resolved) : c.screen.path)
    : c.screen.path;
  if (here !== want) { await reNavigate(c); return; }
  const now = await enumerate(page, c.scope, c.exclude, c.collapse !== false);
  if (now == null || Math.abs(now.length - baseCount) > 2) await reNavigate(c);
}

type ClickResult = {
  verdict: Row['verdict']; why?: string; reqs?: string[]; worst?: number;
  mut?: number; noiseMut?: number; navigated?: boolean; dialog?: string;
  popup?: string; download?: string; consoleErrors?: string[]; blocker?: string;
};

async function clickOne(
  c: Ctx, want: Desc, noiseMut: number,
  noisePaths: Set<string>, confirming: boolean,
): Promise<ClickResult> {
  const { page, probe } = c;

  // Re-stamp and CHECK we are about to click the thing we mean to. A React
  // re-render can move an element, and clicking index 7 because index 7 was
  // right a minute ago is exactly how a false finding is manufactured.
  const now = await enumerate(page, c.scope, c.exclude, c.collapse !== false);
  if (!now) return { verdict: 'UNCLICKABLE', why: 'the scope vanished from the page' };
  let target = now.find((d) => d.idx === want.idx && sameControl(d, want));
  if (!target) target = now.find((d) => sameControl(d, want));
  if (!target) {
    return { verdict: 'UNCLICKABLE',
      why: `no element matching this descriptor is on the screen any more (aria-label="${want.ariaLabel}" text="${want.text.slice(0, 40)}")` };
  }

  const loc: Locator = page.locator(`[data-sw="${target.idx}"]`);
  await loc.scrollIntoViewIfNeeded({ timeout: 5_000 }).catch(() => {});
  await page.waitForTimeout(250);

  // ── INTERCEPTION. `.m2jump` in Sanvaad OVERLAYS the controls beneath it: the
  //    keyboard path works and the mouse path does not, and a click sweep
  //    mis-classifies that unless it asks who is actually on top. Same shape as
  //    the date picker whose Clear button lands on the modal scrim.
  const hit = await page.evaluate((i) => {
    const el = document.querySelector(`[data-sw="${i}"]`) as HTMLElement | null;
    if (!el) return { ok: true, blocker: '', gone: true };
    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    // Outside the viewport is not interception — it is a scroll problem, and
    // Playwright's own actionability check handles it better than this does.
    if (x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight) {
      return { ok: true, blocker: '', gone: false };
    }
    const top = document.elementFromPoint(x, y);
    // `null`, `<html>` and `<body>` all mean "nothing meaningful is at that
    // point", which is what an off-screen skip link looks like. Not a cover.
    if (!top || top === document.documentElement || top === document.body) {
      return { ok: true, blocker: '', gone: false };
    }
    if (el.contains(top) || top.contains(el)) return { ok: true, blocker: '', gone: false };
    const cls = String((top as HTMLElement).className || '').split(/\s+/).filter(Boolean).slice(0, 3).join('.');
    return { ok: false, blocker: top.tagName.toLowerCase() + (cls ? '.' + cls : ''), gone: false };
  }, target.idx);

  if (!hit.ok) {
    // ⚠ INTERCEPTED is only worth reporting when the control is reachable some
    // OTHER way — that is the whole `.m2jump` shape: the keyboard path works
    // and the mouse path does not. So the keyboard path is TRIED, and the
    // verdict says which one broke instead of leaving the reader to guess.
    const before = page.url();
    await mutReset(page);
    probe.reset();
    const kb = await loc.focus({ timeout: 3_000 }).then(() => true).catch(() => false);
    if (kb) { await page.keyboard.press('Enter').catch(() => {}); await page.waitForTimeout(700); }
    const kbMut = await mutCount(page).catch(() => 0);
    const kbWorked = kb && (probe.resps.length > 0 || page.url() !== before || kbMut > noiseMut);
    return { verdict: 'INTERCEPTED', blocker: hit.blocker,
      why: `${hit.blocker} covers this control at its own centre point, so the MOUSE path is blocked. ` +
        (kbWorked
          ? 'The KEYBOARD path still works (focus + Enter fired a request or changed the DOM) — a control reachable only by keyboard, which is the `.m2jump` shape.'
          : 'The keyboard path did not visibly work either, so this control may be genuinely unreachable rather than merely covered.') };
  }

  const urlBefore = page.url();
  probe.reset();
  await mutReset(page);

  let clickErr = '';
  try {
    await loc.click({ timeout: 5_000, noWaitAfter: true });
  } catch (e: any) {
    clickErr = String(e?.message || e).split('\n')[0].slice(0, 160);
  }

  if (clickErr) {
    return { verdict: 'UNCLICKABLE', why: `Playwright refused the click: ${clickErr}` };
  }

  // Observe: the first API request, or 900 ms; then let the DOM settle.
  await page.waitForRequest((r) => r.url().startsWith(API), { timeout: 900 }).catch(() => {});
  await page.waitForTimeout(350);

  const mut = await mutCount(page).catch(() => 0);
  const urlAfter = page.url();
  const navigated = urlAfter !== urlBefore;

  const caused = probe.resps.filter((r) => r.method !== 'GET' || !noisePaths.has(r.url.split('?')[0]));
  // A request the write fence stopped was still FIRED — §10's own criterion —
  // and it is the most informative row in this ledger: it names exactly what
  // the control would have sent, with nothing written to find that out.
  const stopped = probe.blocked.map((b) => `${b.method} ${b.url} ⟂ BLOCKED by the write fence`);
  const reqs = [...caused.map((r) => `${r.method} ${r.url.replace(API, '')} → ${r.status}`), ...stopped].slice(0, 8);
  const worst = caused.reduce((m, r) => Math.max(m, r.status), 0);

  const common: ClickResult = {
    verdict: 'ALIVE', reqs, worst, mut, noiseMut, navigated,
    dialog: probe.dialogs[0], popup: probe.popups[0], download: probe.downloads[0],
    consoleErrors: probe.cons.slice(0, 3),
  };

  // ⚠ BROKEN is decided from the RESPONSE STATUS, never from the console. A 500
  // escapes before the CORS headers are attached, so it reaches the console as
  // a CORS error and is indistinguishable there from a network fault.
  if (worst >= 400) {
    const bad = caused.filter((r) => r.status >= 400)[0];
    return { ...common, verdict: 'BROKEN',
      why: `${bad.method} ${bad.url.replace(API, '')} answered ${bad.status}` };
  }

  const didSomething =
    caused.length > 0 || probe.blocked.length > 0 || navigated ||
    probe.dialogs.length > 0 || probe.popups.length > 0 || probe.downloads.length > 0 ||
    mut > noiseMut;   // ANY movement above the measured idle floor

  if (didSomething) return common;

  // ── NOTHING HAPPENED. Now decide whether that is a FINDING or CORRECT. ────
  //
  // Three shapes fire nothing and change nothing and are not dead controls.
  // Each was measured on the first full run and each would otherwise have been
  // published as a defect. `NOOP` is a separate verdict so the dead COUNT — the
  // number this whole suite exists to publish — carries only the real ones,
  // while none of these is hidden: they are printed by the census too.
  const observed = `0 caused requests, ${mut} DOM mutations against a ${noiseMut} idle floor, ` +
    'no navigation, no dialog, no popup, no download';

  if (target.active) {
    return { ...common, verdict: 'NOOP',
      why: `${observed} — but this control was ALREADY the selected one ` +
        '(aria-selected / aria-current / an "on" class), so doing nothing is correct. ' +
        'A filter chip reading "All" on an unfiltered list is not a dead control.' };
  }
  if (target.submitsInvalidForm) {
    return { ...common, verdict: 'NOOP',
      why: `${observed} — but it is a submit button over a form that does not ` +
        'validate, so the browser raised its own "please fill out this field" bubble. ' +
        'That bubble is browser chrome, not DOM: it is INVISIBLE to request, mutation ' +
        'and navigation observation. Correct behaviour, unobservable by this method.' };
  }
  if (target.opensFilePicker) {
    return { ...common, verdict: 'NOOP',
      why: `${observed} — but it fronts an <input type="file">, so the click opens the ` +
        'native file chooser, which is an OS window and not a DOM event. ' +
        'Unobservable by this method; driven by the suite that uploads.' };
  }

  return { ...common, verdict: 'DEAD',
    why: (confirming ? `confirming click: ${observed}` : observed) };
}

// ════════════════════════════════════════════════════════════════════════════
// THE SHARD RUNNER
// ════════════════════════════════════════════════════════════════════════════
async function runShard(shard: string, page: Page, context: BrowserContext) {
  fs.writeFileSync(ledgerFile(shard), '', 'utf8');
  fs.writeFileSync(netFile(shard), '', 'utf8');

  const probe = instrument(page, context, shard);
  await signIn(page);
  // AFTER sign-in: the fence must not interfere with getting in, and the token
  // branch of `signInAs` performs no write anyway.
  await installWriteFence(page, shard, probe.blocked);

  let clicks = 0;
  for (const screen of SHARDS[shard]) {
    let resolved: string | null = null;
    if (screen.resolve) {
      resolved = await screen.resolve(page);
      if (!resolved) {
        append(ledgerFile(shard), { shard, screen: screen.key, tab: '', idx: -1, verdict: 'UNCLICKABLE',
          why: 'no record exists to open this screen against — reported rather than skipped',
          tag: '', role: '', ariaLabel: '', text: '', cls: '', group: '', groupSize: 0 });
        continue;
      }
    }

    // ── SETTINGS-STYLE pages: their own `?tab=` parameter, one panel each.
    if (screen.urlTabs) {
      for (const v of screen.urlTabs) {
        const ok = await goUrlTab(page, screen, v);
        const c: Ctx = { shard, page, probe, screen, tabId: v, tab: null, resolved, urlTab: v, scope: '.tabs__panel', exclude: '' };
        if (!ok) {
          append(ledgerFile(shard), { shard, screen: screen.key, tab: v, idx: -1, verdict: 'UNCLICKABLE',
            why: 'the tab panel did not render', tag: '', role: '', ariaLabel: '', text: '', cls: '', group: '', groupSize: 0 });
          continue;
        }
        clicks += await sweepScope(c);
      }
      // The settings page's own tab STRIP, swept once rather than once per
      // panel — it is eleven identical buttons on every one of them.
      await goUrlTab(page, screen, screen.urlTabs[0]);
      clicks += await sweepScope({ shard, page, probe, screen, tabId: '(tab strip)', tab: null, resolved, urlTab: screen.urlTabs[0], scope: '#main', exclude: '.tabs__panel' });
      continue;
    }

    // ── MODULE pages: the chrome once, then each tab panel.
    if (screen.tabs) {
      await goScreen(page, screen, null, resolved);
      // The module's own chrome — header actions, KPI strip, and the whole tab
      // strip including "More". Swept once, from `#main` MINUS whichever panel
      // happens to be open, so twenty tab buttons are not re-swept twenty times
      // and the open panel's controls are not counted here as well as there.
      clicks += await sweepScope({ shard, page, probe, screen, tabId: '(module chrome)', tab: null, resolved, scope: '#main', exclude: '[id^="mt-panel-"]' });

      for (const tab of screen.tabs) {
        const got = await goScreen(page, screen, tab, resolved);
        const c: Ctx = { shard, page, probe, screen, tabId: tab.id, tab, resolved, scope: `[id="mt-panel-${tab.id}"]`, exclude: '' };
        if (!got.ok) {
          // A SCREEN that could not be reached, said in full — what was looked
          // for and what was there instead. "This tab does not exist" without
          // the alternatives beside it is the exact shape of the three false
          // missing-control findings this file is written against.
          append(ledgerFile(shard), { shard, screen: screen.key, tab: tab.id, idx: -1, verdict: 'UNCLICKABLE',
            why: `SCREEN NOT REACHED — ${got.why}`,
            tag: '', role: '', ariaLabel: '', text: '', cls: '', group: '', groupSize: 0 });
          continue;
        }
        clicks += await sweepScope(c);
      }
      continue;
    }

    // ── PLAIN pages, and the app shell.
    await goScreen(page, screen, null, resolved);
    // `chrome` is the one screen swept OUTSIDE `#main`: the sidebar, the org
    // switcher, the topbar and the notification bell are the same controls on
    // every screen in the product, so they are swept once here and are excluded
    // from every other screen by the `#main` scope.
    const c: Ctx = screen.key === 'chrome'
      ? { shard, page, probe, screen, tabId: '', tab: null, resolved, scope: 'body', exclude: '#main',
          collapse: false, sidebar: await snapshotSidebar(page) }
      : { shard, page, probe, screen, tabId: '', tab: null, resolved, scope: '#main', exclude: '' };
    clicks += await sweepScope(c);
    if (c.sidebar) await restoreSidebar(page, c.sidebar);
  }

  console.log(`\n[suite22:${shard}] ${clicks} clicks recorded → ${ledgerFile(shard)}`);
}

// ════════════════════════════════════════════════════════════════════════════
// TESTS
// ════════════════════════════════════════════════════════════════════════════
test.use({ actionTimeout: 20_000 });

test.beforeEach(async ({ context }) => {
  expect(LANE.token || LANE.password, BLOCKED).toBeTruthy();
  await context.addInitScript(OBSERVER);
});

test('22.00 preflight the lane, the org and the protected set, before anything is clicked', async ({ page }) => {
  await signIn(page);

  // ⚠ WIPE THE LEDGER FIRST. `census` reads every `*.jsonl` in this directory,
  // so a shard file left behind by an earlier pass would be counted as part of
  // THIS run — a census assembled half from one run and half from another, with
  // nothing on its face to say so. Preflight is a dependency of all six shards,
  // so this is the one place it can be done safely.
  // ⚠ ARCHIVED, NEVER DELETED. An earlier version unlinked these, and when this
  // sweep was found to have damaged another suite's rows the write ledgers of
  // the two runs before it had already been destroyed by this very line — so
  // "what did you write" could only be answered for the most recent run. A
  // suite whose safety case rests on its own write log may not be the thing
  // that erases it.
  const keep = path.join(LEDGER_DIR, 'prev', String(Date.now()));
  const stale = fs.readdirSync(LEDGER_DIR).filter((f) => /\.(jsonl|json|txt)$/.test(f));
  if (stale.length) {
    fs.mkdirSync(keep, { recursive: true });
    for (const f of stale) fs.renameSync(path.join(LEDGER_DIR, f), path.join(keep, f));
    console.log(`[suite22] previous ledger archived to ${keep}`);
  }

  // The protected set, counted BEFORE. Unicode contains a team literally named
  // "Aekam Inc" (`team_ae1d58543b21`) holding the 20 tasks §12 guarantees are
  // untouched. 22.94 counts them again at the end.
  //
  // ⚠ BOTH HALVES, and that is not belt-and-braces — it is the difference
  // between a true gate and a false alarm. `list_tasks` defaults to
  // `archived=False` and appends `t.archived_at IS NULL` (`server.py`), so the
  // plain call answers NINETEEN. The twentieth is `task_effc0a245194` ("test"),
  // archived on 2026-07-29 — a month before this programme began, so it is a
  // fact about the fixture and not something any suite did. Asserting 20
  // against the default call would have failed this suite on the product being
  // correct, which is itself a defect in the test.
  const live = await getRows(page, '/api/tasks?team_id=team_ae1d58543b21&limit=200');
  const arch = await getRows(page, '/api/tasks?team_id=team_ae1d58543b21&archived=true&limit=200');
  const total = live.length + arch.length;
  fs.writeFileSync(path.join(LEDGER_DIR, 'protected-before.json'),
    JSON.stringify({ at: new Date().toISOString(), live: live.length, archived: arch.length, total }, null, 2), 'utf8');
  console.log(`[suite22] protected team_ae1d58543b21: ${live.length} live + ${arch.length} archived = ${total}`);
  expect(total, 'the protected Aekam Inc team must hold its 20 tasks before the sweep begins').toBe(20);
  expect(live.length, 'nineteen of the protected twenty are unarchived, and that is the number a board shows').toBe(19);

  // Outbound is MEASURED and reported, not used as a gate: nothing here sends,
  // because every send control is on the reviewed allowlist. Recording it makes
  // the reason those exclusions exist visible in the run itself.
  const health = await page.request.get(`${API}/api/health`);
  const meta = await health.json();
  console.log(`[suite22] outbound_mode=${meta.outbound_mode} suppressed_orgs_digest=${meta.suppressed_orgs_digest} ` +
    '— nothing is shielded, which is why every send control is excluded by name');
});

for (const shard of Object.keys(SHARDS)) {
  const n = 10 + Object.keys(SHARDS).indexOf(shard);
  test(`22.${n} ${shard} sweep every visible enabled control on this shard's screens`, async ({ page, context }) => {
    test.setTimeout(85 * 60_000);
    await runShard(shard, page, context);
  });
}

// ── THE CENSUS. Passes whatever it finds: §7's gate is that the number is
//    PUBLISHED, not that it is zero.
test('22.90 census publish the dead count, the allowlist and what was not swept', async () => {
  const rows = readLedger();
  const writes = readWrites();
  expect(rows.length, 'the shards wrote no ledger — nothing to publish').toBeGreaterThan(0);
  const shardsSeen = new Set(rows.map((r) => r.shard));
  expect([...shardsSeen].sort().join(','),
    'the census must cover every shard — a missing one is a silent cap, which on this ' +
    'suite reads as full coverage')
    .toBe(Object.keys(SHARDS).sort().join(','));

  const by = (v: string) => rows.filter((r) => r.verdict === v);
  const clicked = rows.filter((r) => ['ALIVE', 'DEAD', 'NOOP', 'BROKEN', 'INTERCEPTED', 'UNCLICKABLE'].includes(r.verdict));
  const screens = new Set(rows.map((r) => `${r.screen}${r.tab ? ' › ' + r.tab : ''}`));

  const L: string[] = [];
  L.push('');
  L.push('════════════════════════════════════════════════════════════════════');
  L.push(' SUITE 22 — DEAD-CONTROL CENSUS · Unicode Group');
  L.push('════════════════════════════════════════════════════════════════════');
  L.push(`  screens swept        ${screens.size}`);
  L.push(`  controls enumerated  ${rows.length}`);
  L.push(`  controls clicked     ${clicked.length}`);
  L.push('');
  L.push('  ⚠ HOW TO READ THIS: every non-GET request a click made was ABORTED at the');
  L.push('    network layer, so this suite wrote nothing — and therefore BROKEN IS');
  L.push('    MEASURABLE ON GET ONLY. A control that would send DELETE or PATCH is');
  L.push('    counted ALIVE, with the request it would have made printed below, and');
  L.push('    never with a status. Do not read a low BROKEN count as a healthy product.');
  L.push('');
  L.push(`  ALIVE                ${by('ALIVE').length}`);
  L.push(`  DEAD                 ${by('DEAD').length}   ← THE NUMBER THIS SUITE EXISTS TO PUBLISH`);
  L.push(`  NOOP  (correct)      ${by('NOOP').length}   already-selected · submit over an invalid form · native file chooser`);
  L.push(`  BROKEN (4xx/5xx)     ${by('BROKEN').length}`);
  L.push(`  INTERCEPTED          ${by('INTERCEPTED').length}`);
  L.push(`  UNCLICKABLE          ${by('UNCLICKABLE').length}`);
  L.push(`  EXCLUDED (reviewed)  ${by('EXCLUDED').length}`);
  L.push(`  HELD (safety net)    ${by('HELD').length}`);
  L.push(`  SEEN (group sample)  ${by('SEEN').length}`);
  L.push('');

  const line = (r: Row) =>
    `    ${r.screen}${r.tab ? ' › ' + r.tab : ''}  [${r.tag}${r.role !== r.tag ? '/' + r.role : ''}]  ` +
    `aria-label=${JSON.stringify(r.ariaLabel)} text=${JSON.stringify((r.text || '').slice(0, 48))}` +
    (r.why ? `\n        ${r.why}` : '');

  for (const [head, v] of [['DEAD — fires nothing, changes nothing, and nothing explains it', 'DEAD'],
    ['NOOP — fires nothing, and that is CORRECT (not counted as dead)', 'NOOP'],
    ['BROKEN — a 4xx or 5xx came back', 'BROKEN'],
    ['INTERCEPTED — something is on top of it', 'INTERCEPTED'],
    ['UNCLICKABLE — could not be clicked or re-found; NOT a dead control', 'UNCLICKABLE'],
    ['HELD — matched the safety net, no reviewed entry covers it', 'HELD']] as [string, string][]) {
    const list = by(v);
    L.push(`  ${head}  (${list.length})`);
    if (!list.length) L.push('    none');
    for (const r of list.slice(0, 120)) L.push(line(r));
    if (list.length > 120) L.push(`    … and ${list.length - 120} more in the ledger`);
    L.push('');
  }

  // ── WHAT THIS SUITE WROTE, and what it would have written ────────────────
  const reached = writes.filter((w) => w.reachedServer);
  const stopped = writes.filter((w) => w.blocked);
  const seen = new Map<string, number>();
  for (const w of reached) seen.set(`${w.method} ${String(w.url).split('?')[0]} → ${w.status}`,
    (seen.get(`${w.method} ${String(w.url).split('?')[0]} → ${w.status}`) || 0) + 1);

  L.push(`  WHAT THIS SUITE WROTE — non-GET requests that REACHED the server  (${reached.length})`);
  if (!reached.length) L.push('    nothing. Every one was stopped by the write fence.');
  for (const [k, n] of [...seen.entries()].sort()) L.push(`    ${n}×  ${k}`);
  L.push('');

  const wouldMap = new Map<string, number>();
  for (const w of stopped) {
    const k = `${w.method} ${String(w.url).split('?')[0]}`;
    wouldMap.set(k, (wouldMap.get(k) || 0) + 1);
  }
  L.push(`  WHAT IT WOULD HAVE WRITTEN — stopped at the network layer  (${stopped.length})`);
  L.push('    Each of these is a control proved ALIVE without anything being written.');
  for (const [k, n] of [...wouldMap.entries()].sort()) L.push(`    ${n}×  ${k}`);
  L.push('');
  L.push('  READ-SHAPED POSTS DELIBERATELY ALLOWED THROUGH THE FENCE');
  for (const r of READ_SHAPED_POSTS) { L.push(`    ${r.path}`); L.push(`        ${r.why}`); }
  L.push('');

  const switches = rows.filter((r) => r.role === 'switch');
  L.push(`  TOGGLES NOT CLICKED — the one CLASS exclusion  (${switches.length} switches)`);
  L.push(`    ${SWITCHES_ARE_NOT_CLICKED}`);
  const bySwitchScreen = new Map<string, number>();
  for (const s of switches) {
    const k = `${s.screen}${s.tab ? ' › ' + s.tab : ''}`;
    bySwitchScreen.set(k, (bySwitchScreen.get(k) || 0) + 1);
  }
  for (const [k, n] of [...bySwitchScreen.entries()].sort()) L.push(`    ${n}×  ${k}`);
  L.push('');

  L.push(`  THE REVIEWED ALLOWLIST, IN FULL  (${EXCLUDED.length} named entries, plus the class exclusion above)`);
  for (const r of EXCLUDED) {
    L.push(`    ${typeof r.match === 'string' ? JSON.stringify(r.match) : String(r.match)}` +
      (r.where ? `  [only where ${String(r.where)}]` : ''));
    L.push(`        ${r.why}`);
  }
  L.push('');
  L.push('  NOT SWEPT — stated, because a silent cap reads as full coverage');
  for (const [what, why] of NOT_SWEPT) { L.push(`    ${what}`); L.push(`        ${why}`); }
  L.push('════════════════════════════════════════════════════════════════════');
  L.push('');

  const text = L.join('\n');
  console.log(text);
  fs.writeFileSync(path.join(LEDGER_DIR, 'CENSUS.txt'), text, 'utf8');
  fs.writeFileSync(path.join(LEDGER_DIR, 'census.json'), JSON.stringify({
    screens: screens.size, enumerated: rows.length, clicked: clicked.length,
    dead: by('DEAD').length, broken: by('BROKEN').length, intercepted: by('INTERCEPTED').length,
    unclickable: by('UNCLICKABLE').length, excluded: by('EXCLUDED').length, held: by('HELD').length,
    writes: [...seen.entries()].map(([k, n]) => ({ what: k, n })),
    deadList: by('DEAD'), brokenList: by('BROKEN'), interceptedList: by('INTERCEPTED'),
    heldList: by('HELD').map((r) => ({ screen: r.screen, tab: r.tab, name: r.ariaLabel || r.text })),
  }, null, 2), 'utf8');
});

// ── THE DEFECT GATES. Separate tests so a red one can never suppress the
//    census above, and so a green census can never read as "nothing is wrong".
test('22.91 census no control answered a 5xx', async () => {
  const bad = readLedger().filter((r) => r.verdict === 'BROKEN' && (r.worst ?? 0) >= 500);
  expect(bad.map((r) => `${r.screen}›${r.tab} "${r.ariaLabel || r.text}" — ${r.why}`).join('\n'),
    'a control on a fully seeded org answered a server error').toBe('');
});

test('22.92 census no control answered a 4xx', async () => {
  const bad = readLedger().filter((r) => r.verdict === 'BROKEN' && (r.worst ?? 0) >= 400 && (r.worst ?? 0) < 500);
  expect(bad.map((r) => `${r.screen}›${r.tab} "${r.ariaLabel || r.text}" — ${r.why}`).join('\n'),
    'a control on a fully seeded org answered a client error — a 405 here is the rate-card shape, ' +
    'a 404 the Vikray proration shape').toBe('');
});

test('22.93 census no control is covered by something on top of it', async () => {
  const bad = readLedger().filter((r) => r.verdict === 'INTERCEPTED');
  expect(bad.map((r) => `${r.screen}›${r.tab} "${r.ariaLabel || r.text}" blocked by ${r.blocker}`).join('\n'),
    'the mouse path to a control is blocked by an overlay — the `.m2jump` shape').toBe('');
});

test('22.94 census the protected Aekam Inc team is untouched', async ({ page }) => {
  await signIn(page);
  const live = await getRows(page, '/api/tasks?team_id=team_ae1d58543b21&limit=200');
  const arch = await getRows(page, '/api/tasks?team_id=team_ae1d58543b21&archived=true&limit=200');
  const before = JSON.parse(fs.readFileSync(path.join(LEDGER_DIR, 'protected-before.json'), 'utf8'));
  console.log(`[suite22] protected team_ae1d58543b21: ${before.live}+${before.archived} before, ` +
    `${live.length}+${arch.length} after`);
  expect(live.length, 'the sweep changed how many protected tasks are live').toBe(before.live);
  expect(arch.length, 'the sweep archived or unarchived a protected task').toBe(before.archived);
  expect(live.length + arch.length, 'the protected set is 20 tasks and must still be').toBe(20);
});
