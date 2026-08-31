/**
 * Proposal 93 · Stage 3 · WAVE 6 · SUITE 16 — Niyam (automations), 2 screens,
 * on Unicode Group, at §4 volumes.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE LANE, AND THE GUARD THAT PROVES IT
 * ═══════════════════════════════════════════════════════════════════════════
 * `lane('unicode')` + `signInAs()` from `_lanes.ts`. Read that file's header
 * before changing a line here: on 2026-08-28 a write suite renamed **Aekam
 * Inc** — the one org proposal 93 guarantees is untouched — because the
 * credential held `platform_admin` and every request resolved to Aekam via
 * `platform_bypass`. The save genuinely succeeded and the suite went GREEN.
 *
 * `signInAs()` calls `assertOrg()` itself; `signIn()` below re-asserts AFTER
 * pinning the active-org key, because that key is written after the door opens
 * and it is the key that decides which org `X-Org-Id` names.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⚠⚠ THIS IS THE ONE SUITE IN THE PROGRAMME THAT ARMS SOMETHING THAT ACTS
 * ═══════════════════════════════════════════════════════════════════════════
 * Everything else here drives a control and waits. An armed rule keeps acting
 * after the run ends, on events nobody in this session caused. So the blast
 * radius is bounded four ways, and each is asserted rather than asserted-about:
 *
 *  1 **EVERY action in this suite is `notify.send` on channel `inapp`.** That
 *    writes one `public.notifications` row and NOTHING else — no `outbound_log`
 *    row, no SES call, no push. `send.py` is explicit: "there is no `inapp`
 *    channel in outbound_log". Nothing this suite arms can leave the building.
 *    ⚠ AND IT COULD NOT DO OTHERWISE EVEN IF IT WANTED TO — see finding 3.
 *
 *  2 **Recipients are enumerated before anything is armed** (16.01). The only
 *    tokens the builder offers are `@creator` and `@assignees`, both resolved
 *    per event and both filtered through `actions._members_only` against
 *    `staging.user_roles`. 16.01 reads every org_admin/org_owner address on
 *    Unicode Group and FAILS if one is not on the brief's allowlist. Measured
 *    2026-08-29, all nine role rows resolve to six mailboxes, every one of them
 *    `kevalvshah03…@gmail.com` or `aekaminc1…@gmail.com`. **No `@example.com`
 *    address is reachable from this suite at all**, which matters because all
 *    53 pre-existing Unicode `graha_contacts` are on that null-MX domain.
 *
 *  3 **Every rule is disarmed AND disabled in 16.17, and the state is read
 *    back off the canonical row.** A rule left armed is the one thing here that
 *    outlives the process.
 *
 *  4 **Aekam Inc is never a subject** (§12) — and this suite is the first in
 *    the programme that could have touched it by accident, because the engine's
 *    drain is GLOBAL. See the next section, which is the most important thing
 *    in this file.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ THE GLOBAL DRAIN, AND SIX ARMED RULES IN THE NO-TOUCH ORG
 * ═══════════════════════════════════════════════════════════════════════════
 * `sweep.drain()` claims events with `WHERE processed_at IS NULL` and **no org
 * filter**, oldest first, 200 at a time. So a sweep this suite provokes runs
 * every armed rule in EVERY organisation, including Aekam Inc.
 *
 * Measured live 2026-08-29 before a line of this file was written:
 *
 *   `staging.niyam_rules` = **6 rows, ALL SIX in Aekam Inc**
 *   (`045b76ad-…`), and **all six `enabled AND is_armed`.** Unicode Group has
 *   never had a rule. Railway staging carries `NIYAM_ARMED=true`,
 *   `NIYAM_CUSTOMER_MAIL=1`, `OUTBOUND_MODE=live`,
 *   `OUTBOUND_SUPPRESSED_ORGS=` (empty). Nothing is shielded, and one of those
 *   six rules is *"Email the customer a weekly payment reminder"* →
 *   `invoice.remind_customer`, which mails somebody outside the firm.
 *
 * That is a real hazard and it is not this suite's to fix — the rules belong to
 * a no-touch org and disarming them is a DATA change to live rows. So it is
 * MEASURED instead, and 16.01 is a hard gate that refuses to let the suite run
 * unless every one of the six is provably inert **today**:
 *
 *   · all 11 Aekam events already carry `processed_at`, so the drain has
 *     nothing of Aekam's to replay;
 *   · every temporal predicate returns ZERO rows for Aekam — 0 overdue
 *     invoices, 0 overdue tasks, 0 pending approvals older than two days;
 *   · the single `dristi_scheduled_reports` row is Aekam's, weekly, and its
 *     `last_sent_at` (2026-08-24 08:01) is AT OR AFTER its most recent Monday
 *     slot, and that slot is five days old against a two-day grace — so
 *     `reports_due` cannot offer it either.
 *
 * 16.01 re-derives all of that from the live API at run time and FAILS if any
 * of it has moved. It is not a comment; it is the gate.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY THIS SUITE CALLS `POST /api/internal/niyam/sweep`, AND WHY THAT IS NOT
 * AN API SHORTCUT
 * ═══════════════════════════════════════════════════════════════════════════
 * §1's rule is absolute: every ROW is typed by a user, no SQL, no API write.
 * This suite honours it — every rule, every task, every client, every contact,
 * every deal, every receipt, every stock adjustment and every leave request
 * below is made by opening a screen, filling real inputs and pressing a real
 * button.
 *
 * The sweep is not a row. It is the ENGINE'S CLOCK. There is no control
 * anywhere in this product that drains the event outbox — the only caller is a
 * Railway cron, and **that cron is deliberately switched off**:
 * `cron-niyam.cronSchedule = "0 0 1 1 *"` (once a year, 1 January) under
 * proposal 93's own R1 freeze, which R9 owes a restore. Its heartbeat says the
 * same thing: `staging.niyam_engine_tick.tick_ended_at` = 2026-08-28 09:46 UTC,
 * and the last event to be processed at all was 2026-08-24.
 *
 * So without advancing the clock, `staging.niyam_events` sits at **747
 * unprocessed Unicode rows**, no rule can ever accumulate a run, `PATCH
 * {is_armed:true}` is refused by design ("this rule has never run"), and Suite
 * 16 cannot exist. Calling the endpoint the disarmed cron calls is doing what
 * time would do. It is stated here rather than folded in, and it is reported.
 *
 * ⚠ `Kartavaya`, WITH THE SECOND 'a', AND NO `--environment`. The service was
 * renamed (the old name is a dead 404) and there is no staging environment to
 * name. Verified 2026-08-31: the old command returns NOTHING, which reads as
 * "the secret is unset" and is not — it is why suite 16 reported BLOCKED and
 * 20 tests never ran.
 *
 * The secret is NOT stored. Supply it for the run:
 *
 *   export E2E_CRON_SECRET="$(railway variables --service Kartavaya \
 *       --kv | sed -n 's/^CRON_SECRET=//p')"
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT §10 ASKS FOR, AND WHICH HALF OF IT THE PRODUCT CANNOT DO
 * ═══════════════════════════════════════════════════════════════════════════
 * §10, Suite 16, verbatim: *"A rule per trigger family, armed, triggered from
 * its own module, run and steps read, disarmed; one fired in quiet hours must
 * defer then deliver. → 40 events wired, one rule ever armed."*
 *
 * Everything before the semicolon is driven here. **The clause after it is not
 * achievable, and the reason is two independent walls, both of which this suite
 * proves rather than asserts:**
 *
 *   **WALL 1 — the builder has no channel control at all.** `NiyamPage.jsx`'s
 *   `ActionCard` renders, for `notify.send`: a verb `<select>`, a recipient
 *   `<select>` offering exactly `@assignees` and `@creator`, a Title input and
 *   a Message input. There is **no channel input**. `blankStep()` hardcodes
 *   `channel: 'inapp'` and nothing on any screen can change it. So every rule a
 *   customer can author is in-app.
 *
 *   **WALL 2 — in-app is deliberately exempt from quiet hours, and rightly.**
 *   `send.INTERRUPTING = {push, email}` with in-app absent, and its comment
 *   records why: an in-app notification is a row in a list with no queue behind
 *   it, so suppressing it at 2am does not postpone the message, it destroys it.
 *   That was a real shipped bug (`71c377a4`) and the exemption is the fix.
 *
 *   Therefore **no authorable rule can reach the quiet-hours gate**, and
 *   §10's scenario has no user-drivable path. 16.16 drives it as far as the
 *   product allows — quiet hours SET through the real Notification-preferences
 *   screen, a rule armed, an event fired inside the window — and asserts what
 *   actually happens: the in-app message is DELIVERED, correctly, because the
 *   clock does not apply to it.
 *
 *   ⚠ AND IT RECORDS THE THIRD FACT, WHICH IS THE ONE THAT MATTERS MOST: even
 *   if the channel were reachable, **there is no deferral in this engine.**
 *   `send.deliver` returns `Delivery("refused", "it is quiet hours…")`,
 *   `NotifySend.run` turns that into an `ActionResult("refused", …)`, and
 *   `engine.run_pipeline` records the step and calls `_finish`, which sets
 *   `finished_at` and NULLs `wake_at`. Nothing re-queues it. `wake_at` exists
 *   only for an explicit `wait` STEP, and `events_deferred` in the tick report
 *   is a per-tick BUDGET counter, not a clock. So "defer then deliver" is a
 *   capability this product does not have — which is a finding, not a skip.
 *   16.15 proves the mechanism that DOES defer (a `wait` step) works, so the
 *   report can say precisely what exists and what does not.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE FIVE THINGS THIS SUITE WENT LOOKING FOR — the dominant defect class
 * ═══════════════════════════════════════════════════════════════════════════
 * `docs/plans/93-E-ORPHANED-CAPABILITY-SWEEP.md` names one shape seven times in
 * one day: **a route exists, is deployed, works — and no screen ever calls it.**
 * Its Niyam row lists only the three internal engine endpoints, correctly, as
 * INTENTIONAL. This suite looked at the module from the other direction — what
 * the ENGINE can do against what the BUILDER can say — and found five. Each has
 * its own test, and each test FAILS today:
 *
 *   1 **Four of the six action verbs cannot be configured.** `GET /catalog`
 *     serves six (`invoice.remind_customer`, `notify.send`, `report.send`,
 *     `task.add_comment`, `task.create`, `task.set_status`) and the verb
 *     `<select>` offers all six. `ActionCard` renders config fields for exactly
 *     TWO. Choosing `task.create` gives you a card with no Title and no Project
 *     box, and `validate_steps` then refuses to save it — "A task needs a
 *     title" — pointing at a field that does not exist on screen.  → **16.03**
 *
 *   2 **Four of eleven families have no filter chip.** `EVENT_META` groups 41
 *     event types into `task · approval · invoice · crm · sales · hr ·
 *     analytics · esign · payroll · marketing · whatsapp`. `NiyamPage.FAMILIES`
 *     lists seven of them. A rule about a signature, a payslip or a campaign is
 *     reachable only through "Everything" — which is the exact defect that
 *     file's own comment says was fixed when three chips were added.  → **16.02**
 *
 *   3 **`notify.send` has no channel control**, so `push` and `email` are
 *     unreachable from the product although both are implemented, validated and
 *     allowed.  → **16.03**
 *
 *   4 **`@org_admins` is not offerable.** The engine has it, `DB_TOKENS` has
 *     it, and `actions.py`'s own comment says why it exists: *"the org-shaped
 *     temporal events … have no creator and no assignees — there is nobody IN
 *     the payload to tell."* The picker offers `@creator` and `@assignees`
 *     only. Of the 41 event types, **the ones with neither field can be
 *     notified about by nobody**: the rule saves, arms, fires, and every run
 *     records `refused — nobody to notify on this event`, for ever. This suite
 *     walks that with FIVE live instances rather than describing it.
 *     → **16.13**
 *
 *   5 **Every input in the rule editor is unlabelled.** `NiyamPage` passes
 *     `label="…"` to `ui/Field.jsx`'s `Input` and `Select`, which are
 *     `({className, ...p}) => <input className … {...p}/>` — bare elements that
 *     render no `<label>` and set no `aria-label`. The `Field` wrapper, which is
 *     the thing that draws a label, is never used on this page. So the rule
 *     name, the trigger, the wait's Minutes, the notification Title and Message
 *     and the status box all have NO accessible name and no visible caption.
 *     → **16.02** measures it on the live DOM rather than asserting it from
 *     source, and every locator in this file is written around it.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * §4 — THE VOLUMES, AND WHOSE THEY ARE
 * ═══════════════════════════════════════════════════════════════════════════
 * §4's 13–17 block gives this suite two rows:
 *
 *   "Automation rules created · armed · fired — 14 · 14 · 14
 *    one per trigger family. 40 events are wired and exactly one rule has ever
 *    been armed"
 *   "Automation runs · run steps observed — 14 · ~42
 *    plus one fired inside quiet hours, which must defer and then deliver"
 *
 * 14 rules, one per EVENT TYPE, spanning **seven of the eleven families** —
 * every family Unicode Group can actually emit from a screen. The four that are
 * absent are named rather than quietly dropped:
 *
 *   `approval`   `approval.pending` is TEMPORAL and needs a pending approval
 *                more than two days old. A user cannot backdate one.
 *   `analytics`  `metric.threshold` and `report.due` are both temporal and
 *                org-shaped; `dristi_scheduled_reports` holds one row and it
 *                belongs to Aekam Inc, which is no-touch.
 *   `payroll`    `payroll.published` / `payslip.disbursed` are reachable, but
 *                publishing a payroll run on a live org is Suite 08's act and
 *                is not reversible from here.
 *   `whatsapp`   EXCLUDED BY DECISION — 93 §13.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * "TRIGGERED FROM ITS OWN MODULE" — WHICH NINE, AND WHY NOT FOURTEEN
 * ═══════════════════════════════════════════════════════════════════════════
 * §10 is explicit and the brief repeats it: *a rule that fires because you
 * called its endpoint proves the endpoint; a rule that fires because a deal
 * moved to Won proves the product.* So nine of the fourteen are fired by
 * driving the module that owns them, through the same controls Suites 03, 04,
 * 05, 07 and 10 proved:
 *
 *   task.created         Core PM   the New Task modal
 *   task.status_changed  Core PM   the card's own "Mark … done" tick
 *   client.created       Graha     + Add Client
 *   contact.created      Graha     + Add Contact
 *   deal.created         Graha     + New Deal
 *   deal.stage_changed   Graha     the deal drawer's Stage select
 *   payment.recorded     Ganit     the invoice drawer's Record payment
 *   stock.adjusted       Vikray    the stock ledger's +1 / −1
 *   leave.requested      Manav     + Request leave
 *
 * The remaining five — `invoice.created`, `order.created`, `expense.claimed`,
 * `document.sent`, `contact.unsubscribed` — are created, enabled, armed and
 * disarmed here, and their dry runs evaluate against **real events those
 * modules already emitted** (Unicode holds 53 `invoice.created`, 35
 * `order.created`, 12 `expense.claimed`, 5 `document.sent` and 6
 * `contact.unsubscribed` rows, all typed by Suites 05, 07, 10, 11 and 15). That
 * is genuine evaluation against genuine product events — but it is **not** a
 * live fire caused by this suite, and the report says so per rule rather than
 * letting five count as fourteen.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * §6 — RE-RUNNABLE, AND WHAT DELIBERATELY DIFFERS ON RUN 2
 * ═══════════════════════════════════════════════════════════════════════════
 * The fourteen rules carry DETERMINISTIC names (`S16-01 …` … `S16-14 …`), so a
 * second execution reads the live list and types nothing: "0 typed, 14 already
 * present". Same for every assertion about their steps and switches.
 *
 * The TRIGGERS cannot be idempotent and that is a property of the subject, not
 * a defect in the suite: **a rule fires on an EVENT, and an event exists only
 * because something was written.** So three of the nine re-trigger an existing
 * record with no new row at all (a task's status is flipped and flipped back, a
 * deal is moved between two stages, stock goes +1 then −1), and six write one
 * small record apiece per run, each stamped with the run's own minute. The
 * report gives both numbers.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE TRAPS THIS FILE IS WRITTEN AROUND
 * ═══════════════════════════════════════════════════════════════════════════
 * · `getByRole(name)` matches the ACCESSIBLE name, not visible text. On this
 *   page most controls have neither — see finding 5 — so the editor is driven
 *   structurally, from `.niyam-steps > li`, and 16.02 records that as the
 *   reason rather than leaving it to look like taste.
 * · `Toggle` renders `<button role="switch" aria-checked>` and NiyamPage passes
 *   it no `label`, relying on the wrapping `<label>`'s text. Every toggle here
 *   is located inside its own rule card and then asserted on `aria-checked`,
 *   never on a class.
 * · A rule's card shows `runs_total` from a SUBQUERY over `niyam_runs`, so the
 *   number moves only after a sweep AND a reload. Nothing here reads a count
 *   off the screen without having reloaded the list first.
 * · Suite rule 2/3: the WRITE RESPONSE is read, then the CANONICAL row. Rule
 *   creation is judged on `POST /v1/niyam/rules` → 201 and then on
 *   `GET /rules/{id}`, never on a toast.
 * · Suite rule 4: `GET /rules/{id}/runs` caps at 200 by its own `min(limit,200)`.
 *   Every assertion about runs is a DELTA across a marked timestamp.
 * · `page.reload()` on the line after a save races the write. Everything goes
 *   through `saveAndWait()`, which returns the SERVER's status.
 * · No user, member or org UUID is rendered or asserted anywhere. 16.02 reads
 *   the painted text of both screens and fails on a v4 UUID.
 *
 * Run:
 *   cd frontend
 *   export E2E_CRON_SECRET="$(railway variables --service Kartavaya \
 *       --kv | sed -n 's/^CRON_SECRET=//p')"
 *   npx playwright test --config e2e-real/suite16.config.ts
 */
import { test, expect, Page, Locator } from '@playwright/test';
import { lane, activeLane, signInAs as laneSignIn, assertOrg, ORG as ORG_IDS } from './_lanes';
import { setDate } from './_helpers';

// ⚠ STAGE 4 (§14): `activeLane()` reads E2E_LANE and DEFAULTS TO 'unicode', so an
// unset run is byte-for-byte the Unicode run this suite was authored against.
// `lane('unicode')` frozen here at import time was why the UK replay could not
// be run at all — §14's own first category, a hidden dependency on Unicode.
const LANE = activeLane();
const API = process.env.E2E_API_URL || 'https://api.kartavaya.com';
const CRON = process.env.E2E_CRON_SECRET || '';

const TAG = 'S16';
/** The run's own minute — the only thing that differs between executions. */
const RUN = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
const pad = (n: number) => String(n).padStart(2, '0');
const reEsc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const BLOCKED_LANE =
  'BLOCKED — no credential for the Unicode Group lane. Set E2E_UNICODE_TOKEN (or ' +
  'E2E_UNICODE_EMAIL/_PASSWORD) in .env.e2e. ⚠ It must be an ORG-SCOPED account: a ' +
  'platform_admin token resolves to Aekam Inc via platform_bypass and would write there.';

const BLOCKED_CRON =
  'BLOCKED — E2E_CRON_SECRET is not set, and without it the engine clock cannot be ' +
  'advanced. `cron-niyam` is disarmed at "0 0 1 1 *" under proposal 93 R1, so nothing ' +
  'else will ever drain staging.niyam_events, no rule can accumulate a run, and PATCH ' +
  '{is_armed:true} is refused by design on a rule that has never run. Supply it for ' +
  'the run only:\n' +
  '  export E2E_CRON_SECRET="$(railway variables --service Kartavaya --kv | sed -n \'s/^CRON_SECRET=//p\')"\n' +
  'This is a FAILURE, not a skip — see the file header for why calling the sweep is ' +
  'the engine\'s clock and not an API shortcut.';

/**
 * ⚠ THE RECIPIENT ALLOWLIST — the fence this suite stands behind.
 *
 * The brief's rule: before arming any rule with a notify action, enumerate the
 * exact recipients it can reach and assert every one is allowed. Every rule
 * here is `channel: inapp`, which writes a `notifications` row and cannot send
 * — but the enumeration runs anyway, because the fence must hold if a channel
 * control ever lands, and because `@example.com` is a null-MX domain that all
 * 53 pre-existing Unicode contacts carry.
 */
const ALLOWED_RECIPIENT = /^(?:[^@]+@simulator\.amazonses\.com|kevalvshah03(\+[^@]+)?@gmail\.com|kelisweet(\+[^@]+)?@gmail\.com|aekaminc1(\+[^@]+)?@gmail\.com|[^@]+@unicodegroup\.com)$/i;

/** The eleven families `services/niyam/registry.EVENT_META` actually groups by. */
const ENGINE_FAMILIES = [
  'analytics', 'approval', 'crm', 'esign', 'hr', 'invoice', 'marketing',
  'payroll', 'sales', 'task', 'whatsapp',
];
/**
 * ⚠ THIS WAS A FROZEN COPY OF THE DEFECT, AND IT OUTLIVED THE FIX.
 *
 * It read "the seven `NiyamPage.FAMILIES` offers as filter chips" and listed
 * them, so `16.02b` asserted BOTH "the chips are exactly these seven" and
 * "the engine's eleven families all have a chip" — a contradiction that could
 * only be satisfied while the product was wrong.
 *
 * Fixed 2026-08-31: the chips are now DERIVED from the catalogue, so the two
 * lists are the same list and there is nothing left to freeze. Kept as an
 * alias rather than deleted, because the assertion it feeds is the one worth
 * having — chips EXACTLY the engine's families, neither short (a rule nobody
 * can filter to) nor long (a filter that matches nothing).
 */
const CHIP_FAMILIES = ENGINE_FAMILIES;

/** The six verbs `GET /catalog` serves. */
const ALL_VERBS = [
  'invoice.remind_customer', 'notify.send', 'report.send',
  'task.add_comment', 'task.create', 'task.set_status',
];
/**
 * The verbs that take NO configuration, by design — everything they need is on
 * the event that triggered them.
 *
 *   report.send                `validate_steps` REFUSES any key but `verb`;
 *                              the schedule row carries every setting.
 *   invoice.remind_customer    `InvoiceRemindCustomer.run` reads `config`
 *                              nowhere, and `validate.py` has no branch for it.
 *
 * ⚠ THIS LIST USED TO BE ITS INVERSE — `CONFIGURABLE_VERBS`, a frozen copy of
 * the two verbs the editor happened to handle. That framing made the check
 * "has the editor changed", when the question is "can a person configure what
 * the engine can run". Inverted 2026-08-31, when four of the six became
 * configurable and the frozen list went red for the right reason.
 */
const NO_CONFIG_VERBS = ['report.send', 'invoice.remind_customer'];

// ════════════════════════════════════════════════════════════════════════════
// §4 — THE FOURTEEN RULES
// ════════════════════════════════════════════════════════════════════════════
//
// One per event type, seven families. `carriesRecipient` records whether the
// event's payload can answer either token the picker offers — see finding 4.
// `trigger` names the module driver that fires it live; `null` means the rule
// is created, armed and disarmed here but its runs come from events other
// suites already emitted.
type Trigger =
  | 'task.create' | 'task.flip' | 'client.create' | 'contact.create'
  | 'deal.create' | 'deal.move' | 'payment.record' | 'stock.bump'
  | 'leave.request' | null;

type RuleSpec = {
  n: number;
  event: string;
  family: string;
  /** The condition, or null for an unconditional rule. */
  cond: { field: string; operator: string; value: string } | null;
  to: '@creator' | '@assignees';
  /** Can this event's payload answer `to` at all? Finding 4. */
  carriesRecipient: boolean;
  trigger: Trigger;
};

const RULES: RuleSpec[] = [
  // ── task ──────────────────────────────────────────────────────────────────
  { n: 1,  event: 'task.created',         family: 'task',      to: '@creator',
    cond: { field: 'title', operator: 'contains', value: TAG }, carriesRecipient: true,  trigger: 'task.create' },
  { n: 2,  event: 'task.status_changed',  family: 'task',      to: '@creator',
    cond: { field: 'title', operator: 'contains', value: TAG }, carriesRecipient: true,  trigger: 'task.flip' },
  // ⚠ EIGHT OF THESE NAME `@org_admins`, AND `carriesRecipient: false` IS WHY.
  //
  // 16.13 measured the consequence of the other choice: "5 rule(s) fired
  // correctly, evaluated correctly, reached their action step and notified
  // NOBODY: contact.created, deal.stage_changed, payment.recorded,
  // stock.adjusted, leave.requested." `registry.py` gives those event types no
  // `created_by` and no `assignee_user_ids`, so `@creator` and `@assignees`
  // both resolve to nobody and `NotifySend.run` records "nobody to notify on
  // this event".
  //
  // The engine always had the answer — `DB_TOKENS = {"@org_admins"}`, whose own
  // comment says it exists because "the org-shaped temporal events … have no
  // creator and no assignees" — and until 2026-08-31 the rule editor did not
  // offer it, so a customer could build, arm and fire a rule that could never
  // reach a person. Fixed there; taken up here, because a suite that keeps
  // asking for a recipient it knows cannot resolve is testing its own
  // workaround rather than the product.
  //
  // `carriesRecipient` is not a new flag: it already marked exactly these
  // EIGHT. Verified against the registry rather than trusted — of the fourteen
  // event types this suite uses, the six marked `true` carry `created_by` and
  // these eight carry NEITHER `created_by` NOR `assignee_user_ids`. 16.13 named
  // only five because only those five fire inside this suite's window; the
  // other three evaluate against the backlog and have the same problem.
  // ── crm ───────────────────────────────────────────────────────────────────
  { n: 3,  event: 'client.created',       family: 'crm',       to: '@creator',
    cond: { field: 'name', operator: 'contains', value: TAG }, carriesRecipient: true,  trigger: 'client.create' },
  { n: 4,  event: 'contact.created',      family: 'crm',       to: '@org_admins',
    cond: { field: 'source', operator: 'contains', value: TAG }, carriesRecipient: false, trigger: 'contact.create' },
  { n: 5,  event: 'deal.created',         family: 'crm',       to: '@creator',
    cond: { field: 'title', operator: 'contains', value: TAG }, carriesRecipient: true,  trigger: 'deal.create' },
  { n: 6,  event: 'deal.stage_changed',   family: 'crm',       to: '@org_admins',
    cond: { field: 'value', operator: 'gte', value: '4160000' }, carriesRecipient: false, trigger: 'deal.move' },
  // ── invoice ───────────────────────────────────────────────────────────────
  { n: 7,  event: 'invoice.created',      family: 'invoice',   to: '@creator',
    cond: { field: 'total', operator: 'gte', value: '1' }, carriesRecipient: true,  trigger: null },
  { n: 8,  event: 'payment.recorded',     family: 'invoice',   to: '@org_admins',
    cond: { field: 'amount', operator: 'lte', value: '2' }, carriesRecipient: false, trigger: 'payment.record' },
  // ── sales ─────────────────────────────────────────────────────────────────
  { n: 9,  event: 'order.created',        family: 'sales',     to: '@creator',
    cond: { field: 'total', operator: 'gte', value: '1' }, carriesRecipient: true,  trigger: null },
  { n: 10, event: 'stock.adjusted',       family: 'sales',     to: '@org_admins',
    cond: { field: 'product_name', operator: 'contains', value: 'S05 Product 01' }, carriesRecipient: false, trigger: 'stock.bump' },
  // ── hr ────────────────────────────────────────────────────────────────────
  // ⚠ THREE DAYS, NOT THIRTEEN, AND THE REASON IS A MANAV FINDING.
  //
  // The first draft asked for 13 days, which nobody on this org can request.
  // Chasing that produced a real defect, measured live 2026-08-29:
  //
  //   `staging.manav_employees` (Unicode)      30 rows, ALL `status='active'`
  //                                            and `is_active = true`
  //   `GET /api/v1/manav/employees?limit=200`  returns 26, `total: 26`
  //
  // The four it drops — S7-03, S7-05, S7-09, S7-11 — are the four whose
  // `manav_offboarding.last_working_day` is in the PAST (11–20 Aug). The four
  // whose last working day is in the FUTURE (S7-25…S7-28, 30 Sep) are listed
  // normally, so the exclusion is the DATE and not the offboarding. Their own
  // employee rows still say `active`, and two of them hold the only usable
  // leave balances on the org — 170 days of maternity leave each. So the row
  // says the person works here, the list says they do not, and the balance they
  // hold is unspendable. That belongs to Suite 07 (Manav) and is reported, not
  // fixed from here.
  //
  // Among the employees the picker ACTUALLY OFFERS, the largest balance is 3
  // days. So the rule is written against what a customer can really do.
  { n: 11, event: 'leave.requested',      family: 'hr',        to: '@org_admins',
    cond: { field: 'days', operator: 'gte', value: '3' }, carriesRecipient: false, trigger: 'leave.request' },
  { n: 12, event: 'expense.claimed',      family: 'hr',        to: '@org_admins',
    cond: { field: 'amount', operator: 'gte', value: '1' }, carriesRecipient: false, trigger: null },
  // ── esign ─────────────────────────────────────────────────────────────────
  { n: 13, event: 'document.sent',        family: 'esign',     to: '@org_admins',
    cond: { field: 'signer_count', operator: 'gte', value: '1' }, carriesRecipient: false, trigger: null },
  // ── marketing ─────────────────────────────────────────────────────────────
  { n: 14, event: 'contact.unsubscribed', family: 'marketing', to: '@org_admins',
    cond: null, carriesRecipient: false, trigger: null },
];

const ruleName = (r: RuleSpec) => `${TAG}-${pad(r.n)} ${r.event}`;
const ruleTitle = (r: RuleSpec) => `${TAG} · ${r.event}`;
const ruleBody = (r: RuleSpec) => `Raised by Suite 16 for ${r.event}.`;

/** The seven families the fourteen rules actually cover. */
const COVERED_FAMILIES = [...new Set(RULES.map((r) => r.family))].sort();

// ── the marks the module drivers use ────────────────────────────────────────
//
// ⚠⚠ THE STAMP LIVES IN THE LEDGER FILE, NOT IN `RUN`, AND THAT IS A SCAR.
//
// `RUN` is computed at MODULE LOAD, and Playwright STARTS A NEW WORKER AFTER A
// FAILED TEST — so every worker gets its own minute. On 2026-08-29 run A that
// cost a real failure and it looked exactly like a product bug: 16.09 created
// `S16 task 202608291130`, three tests failed, a new worker loaded the module
// afresh, and 16.14 searched the board for `S16 task 202608291136` and reported
// "no card titled … on the board that owns it". The task was there. The NAME
// had moved.
//
// So 16.01 — which always runs first — stamps the ledger, and every mark is
// derived from what the ledger says. Workers within one run agree; a new run
// gets a new stamp, which is what the CREATE-shaped triggers need in order to
// produce a fresh event at all.
function stamp(): string {
  const led = ledgerRead();
  return String(led.stamp || RUN);
}
const S16_TASK = () => `${TAG} task ${stamp()}`;
const S16_CLIENT = () => `${TAG} Client ${stamp()}`;
const S16_CONTACT = () => `${TAG} Contact ${stamp()}`;
const S16_CONTACT_SOURCE = `${TAG}-niyam`;
const S16_DEAL = () => `${TAG} Deal ${stamp()}`;
/** Distinctive enough that rule 06's `value >= 4160000` matches nothing else. */
const S16_DEAL_VALUE = 4_160_000;
const S16_LEAVE_REASON = () => `${TAG} leave ${stamp()}`;
const S16_LEAVE_DAYS = 3;

// ════════════════════════════════════════════════════════════════════════════
// A FILE-BACKED LEDGER
// ════════════════════════════════════════════════════════════════════════════
//
// ⚠ Playwright STARTS A NEW WORKER AFTER A FAILED TEST, which resets every
// module-level variable in this file. Two agents hit that in one session and
// one had a test PASS on a defect it had just measured. Anything that must
// survive a failure is written to disk and read back.
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const LEDGER = path.join(os.tmpdir(), 'kartavya-e2e-suite16', 'ledger.json');

function ledgerRead(): Record<string, any> {
  try { return JSON.parse(fs.readFileSync(LEDGER, 'utf8')); } catch { return {}; }
}
function ledgerWrite(patch: Record<string, any>) {
  const cur = ledgerRead();
  fs.mkdirSync(path.dirname(LEDGER), { recursive: true });
  fs.writeFileSync(LEDGER, JSON.stringify({ ...cur, ...patch }, null, 2));
}

test.beforeAll(() => {
  if (!LANE.token && !LANE.password) throw new Error(BLOCKED_LANE);
  if (!CRON) throw new Error(BLOCKED_CRON);
  console.log(
    `\n  LANE: ${LANE.org}  (reference lane, §14)` +
    `\n  RUN STAMP: ${RUN}` +
    `\n  RULES: ${RULES.length} across ${COVERED_FAMILIES.length} families — ${COVERED_FAMILIES.join(', ')}` +
    `\n  LIVE TRIGGERS: ${RULES.filter((r) => r.trigger).length} of ${RULES.length}\n`,
  );
});

// ════════════════════════════════════════════════════════════════════════════
// THE DOOR
// ════════════════════════════════════════════════════════════════════════════

async function signIn(page: Page) {
  await laneSignIn(page, LANE);
  await page.evaluate((id) => localStorage.setItem('Kartavaya_active_org', id), LANE.orgId);
  await assertOrg(page.request, page, LANE);
  expect(LANE.orgId, 'the lane must be Unicode Group').toBe(ORG_IDS.UNICODE);
  expect(LANE.orgId, 'the lane must never be Aekam Inc').not.toBe(ORG_IDS.AEKAM);
}

// ════════════════════════════════════════════════════════════════════════════
// READ-BACK — GET only, and always with X-Org-Id
// ════════════════════════════════════════════════════════════════════════════
//
// A read helper that omits `X-Org-Id` makes the server fall back to the
// caller's OLDEST membership and answer for a different organisation than the
// screen beside it. That is how a suite reads Aekam's rows and calls them
// Unicode's.

async function apiGet(page: Page, p: string) {
  const token = await page.evaluate(() => localStorage.getItem('auth_token'));
  return page.request.get(`${API}${p}`, {
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      'X-Org-Id': LANE.orgId,
    },
  });
}

async function apiJson(page: Page, p: string): Promise<any> {
  const r = await apiGet(page, p);
  expect(r.status(), `GET ${p} → ${r.status()}: ${(await r.text()).slice(0, 400)}`)
    .toBeLessThan(400);
  return await r.json();
}

/** Every rule this org has, keyed by name. */
async function rulesByName(page: Page): Promise<Map<string, any>> {
  const d = await apiJson(page, '/api/v1/niyam/rules');
  return new Map((d.rules || []).map((r: any) => [String(r.name), r]));
}

async function ruleRuns(page: Page, ruleId: string): Promise<any[]> {
  const d = await apiJson(page, `/api/v1/niyam/rules/${ruleId}/runs?limit=200`);
  return (d.runs || []) as any[];
}

// ════════════════════════════════════════════════════════════════════════════
// THE ENGINE CLOCK — see the header for why this is not an API shortcut
// ════════════════════════════════════════════════════════════════════════════

/** One tick. Returns the engine's own report. */
async function sweep(page: Page): Promise<any> {
  const r = await page.request.post(`${API}/api/internal/niyam/sweep`, {
    headers: { 'X-Cron-Secret': CRON },
    timeout: 600_000,
  });
  expect(r.status(),
    `POST /api/internal/niyam/sweep → ${r.status()}: ${(await r.text()).slice(0, 400)}. ` +
    'A tick that COMPLETED always answers 200, including one that found nothing — ' +
    '`routers/niyam.py` says so. Anything else means the endpoint refused the secret ' +
    '(403), has none configured (503), or the tick raised.')
    .toBe(200);
  return await r.json();
}

async function engineStatus(page: Page): Promise<any> {
  const r = await page.request.get(`${API}/api/internal/niyam/status`, {
    headers: { 'X-Cron-Secret': CRON },
  });
  expect(r.status(), `GET /api/internal/niyam/status → ${r.status()}`).toBe(200);
  return await r.json();
}

/**
 * Sweep until the outbox is empty or `max` ticks have run.
 *
 * A single tick is bounded at `DRAIN_LIMIT = 200` events and
 * `TICK_BUDGET_SECONDS = 240`, and the backlog measured before this suite was
 * written was 747. Returns what each tick reported, so the caller can prove the
 * count FELL rather than trusting a 200 — which is the whole lesson of 331
 * reminders that recorded `sent` over 331 suppressed rows.
 */
async function drainOutbox(page: Page, max = 12): Promise<any[]> {
  const ticks: any[] = [];
  for (let i = 0; i < max; i++) {
    const t = await sweep(page);
    ticks.push(t);
    if (t.skipped) {
      // Another tick holds the single-row claim. Nothing was done; wait it out
      // rather than counting it as progress.
      await page.waitForTimeout(15_000);
      continue;
    }
    const st = await engineStatus(page);
    if (Number(st.events_unprocessed || 0) === 0) break;
    if (Number(t.events_drained || 0) === 0 && Number(t.events_deferred || 0) === 0) break;
  }
  return ticks;
}

// ════════════════════════════════════════════════════════════════════════════
// WRITE-RESPONSE WATCHING — suite rule 2
// ════════════════════════════════════════════════════════════════════════════

type Wrote = { status: number; text: string; body: any; url: string };

/**
 * Press a control and read the SERVER's answer, never a toast.
 *
 * ⚠ SUITE RULE 7 — ONE BUTTON CAN MAKE TWO REQUESTS. Saving a rule POSTs and
 * then the page calls `load()`, which GETs three endpoints. The predicate here
 * pins the METHOD as well as the URL so the GET storm cannot satisfy it.
 */
async function writes(
  page: Page,
  url: RegExp,
  act: () => Promise<any>,
  opts: { methods?: string[]; what?: string } = {},
): Promise<Wrote> {
  const methods = opts.methods || ['POST'];
  const wait = page.waitForResponse(
    (r) => url.test(r.url()) && methods.includes(r.request().method()),
    { timeout: 60_000 },
  );
  await act();
  const res = await wait.catch(() => null);
  expect(res,
    `${opts.what || 'the control'} fired no ${methods.join('/')} matching ${url}. ` +
    'A control that makes no request, changes no DOM and navigates nowhere is a DEAD ' +
    'CONTROL (Suite 22) — and that is a FAILURE, never a skip.')
    .toBeTruthy();
  const text = await res!.text();
  let body: any = null;
  try { body = JSON.parse(text); } catch { /* not json */ }
  return { status: res!.status(), text, body, url: res!.url() };
}

async function saveAndWait(page: Page, url: RegExp, act: () => Promise<any>,
                           what: string, methods = ['POST']): Promise<Wrote> {
  const w = await writes(page, url, act, { methods, what });
  expect(w.status, `${what} → ${w.status}: ${w.text.slice(0, 500)}`).toBeLessThan(400);
  return w;
}

async function settle(page: Page) {
  await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {});
}

// ════════════════════════════════════════════════════════════════════════════
// QUIET HOURS — through the product's own control
// ════════════════════════════════════════════════════════════════════════════
//
// ⚠ THERE IS NO `<input type="time">` ON THIS SCREEN, AND THERE MUST NOT BE.
// `NotifyPrefs.jsx` uses `ui/DateInput` with `type="time"`, which renders a
// trigger button and a `role="listbox"` of `role="option"` rows on a THIRTY
// MINUTE grid (`DateInput.TIMES` — 48 entries, 00:00 … 23:30). A locator
// written against a native time input finds nothing and reports a missing
// control, which is the wrong diagnosis entirely: CLAUDE.md bans native date
// and time inputs product-wide, so their absence is the rule being kept.

/** `HH:MM` on the 30-minute grid DateInput offers, from a Date read as UTC. */
const gridTime = (d: Date) =>
  `${pad(d.getUTCHours())}:${d.getUTCMinutes() >= 30 ? '30' : '00'}`;

/** That value's index in `DateInput.TIMES`, which is how the option is picked. */
const gridIndex = (hm: string) =>
  Number(hm.slice(0, 2)) * 2 + (Number(hm.slice(3)) >= 30 ? 1 : 0);

/**
 * Set the quiet-hours window on the signed-in person's own preferences, through
 * the real screen, and read the SERVER's answer.
 *
 * The option rows are addressed by INDEX rather than by their visible text:
 * `DateInput` prints them through `toLocaleTimeString('en-IN', …)`, so "13:30"
 * paints as "1:30 pm" and a locator on the 24-hour value matches nothing.
 */
async function setQuietWindow(page: Page, fromHM: string, toHM: string) {
  await page.goto('/settings/customize?tab=notifications');
  await settle(page);
  const block = page.locator('.nqh');
  await expect(block,
    'the quiet-hours block is not on the notification preferences screen. ' +
    '`components/customize/NotifyPrefs.jsx` owns it and PUTs `quiet_start`/`quiet_end` ' +
    'to `/api/me/notification_prefs`; a missing control is a FAILURE, never a skip.')
    .toBeVisible({ timeout: 30_000 });

  for (const [caption, hm] of [['From', fromHM], ['To', toHM]] as const) {
    const field = block.locator('label.fldx').filter({ hasText: caption }).first();
    await expect(field, `the quiet-hours "${caption}" field is missing`)
      .toBeVisible({ timeout: 15_000 });
    await field.locator('button.pk__tr').first().click();
    const pop = field.locator('.pk__pop');
    await expect(pop, `the "${caption}" time picker did not open`)
      .toBeVisible({ timeout: 15_000 });
    const options = pop.getByRole('option');
    await expect(options, 'the time picker drew no options').not.toHaveCount(0);
    await options.nth(gridIndex(hm)).click();
    await expect(pop, `the "${caption}" time picker did not close on a choice`)
      .toBeHidden({ timeout: 10_000 });
  }

  const w = await saveAndWait(page, /\/me\/notification_prefs$/,
    () => block.getByRole('button', { name: 'Save window' }).click(),
    `saving the quiet window ${fromHM}–${toHM}`, ['PUT']);
  // The row, not the toast. `PUT` replaces prefs, quiet_start and quiet_end
  // together, so a partial write would silently reset the nine delivery modes.
  const stored = await apiJson(page, '/api/me/notification_prefs');
  expect(String(stored.quiet_start).slice(0, 5),
    `the window was saved and the stored quiet_start is ${stored.quiet_start}`).toBe(fromHM);
  expect(String(stored.quiet_end).slice(0, 5),
    `the window was saved and the stored quiet_end is ${stored.quiet_end}`).toBe(toHM);
  return w;
}

// ════════════════════════════════════════════════════════════════════════════
// THE BUILDER — driven structurally, because nothing on it has a name
// ════════════════════════════════════════════════════════════════════════════
//
// See finding 5. `ui/Field.jsx`'s `Input` and `Select` are bare elements that
// drop the `label` prop into the DOM as an attribute; the `Field` wrapper that
// would render a real `<label htmlFor>` is never used on this page. So the
// editor is addressed by structure, and 16.02 asserts that this is necessary
// rather than leaving it to read as a stylistic choice.

async function gotoNiyam(page: Page) {
  await page.goto('/settings/automations');
  await expect(page.locator('.k-page.niyam'), 'the automations page never rendered')
    .toBeVisible({ timeout: 45_000 });
  await settle(page);
}

const editor = (page: Page) => page.locator('.niyam-editor');
const stepList = (page: Page) => page.locator('.niyam-editor .niyam-steps > li');

/** One rule's card, by the name in its `<h3>`. */
function ruleCard(page: Page, name: string): Locator {
  return page.locator('article.niyam-card')
    .filter({ has: page.getByRole('heading', { level: 3, name, exact: true }) })
    .first();
}

/** The two switches on a card, in DOM order: `enabled`, then `is_armed`. */
const switchOn = (card: Locator) => card.locator('button[role="switch"]').first();
const switchArmed = (card: Locator) => card.locator('button[role="switch"]').nth(1);

/**
 * Build one rule through the real editor and press Save.
 *
 * The trigger `<select>` is the FIRST select in the editor (the name Input
 * precedes it and is a text box); each step's controls live inside its own
 * `<li>`. `blankStep()` seeds an action with `verb: notify.send`, `to:
 * ['@assignees']` and `channel: 'inapp'`, so the recipient select needs
 * changing only when the spec asks for `@creator`.
 */
async function buildRule(page: Page, r: RuleSpec) {
  await gotoNiyam(page);
  await page.getByRole('button', { name: 'New rule', exact: true }).click();
  const ed = editor(page);
  await expect(ed, 'the rule editor did not open').toBeVisible({ timeout: 20_000 });

  // The name box — the only control on this page with a placeholder, which is
  // the only handle it has.
  const nameBox = ed.locator('input.inp[placeholder*="When a task is finished"]');
  await expect(nameBox,
    'the rule-name box could not be found by its placeholder. It has no label, no ' +
    'aria-label and no visible caption (finding 5), so the placeholder is the only ' +
    'handle in the DOM — if that has changed there is no accessible way to address it')
    .toBeVisible({ timeout: 15_000 });
  await nameBox.fill(ruleName(r));

  // The trigger. The option TEXT is the server's own label, never the dotted
  // type — that is deliberate product behaviour, so the value is used.
  const trigger = ed.locator('select.inp').first();
  await trigger.selectOption(r.event);

  if (r.cond) {
    await ed.getByRole('button', { name: 'Add only if' }).click();
    const li = stepList(page).last();
    // ⚠ TWO OR THREE, NEVER EXACTLY TWO. `ConditionCard` draws field and
    // operator selects, and then draws the VALUE as a third `<select>` when the
    // chosen field carries options and as an `<input>` when it does not. The
    // blank step defaults to the event's FIRST field, and for every `task.*`
    // event that is `status`, which is a `select` — so a `toHaveCount(2)` here
    // reported "the condition card drew no selects" over a card that had drawn
    // three. The shape is re-read AFTER the field is chosen, because choosing
    // it is what decides which shape the value takes.
    const sel = li.locator('.niyam-cond select.inp');
    await expect(sel.first(), 'the condition card drew no controls at all')
      .toBeVisible({ timeout: 15_000 });
    await expect
      .poll(async () => await sel.count(),
        { message: 'the condition card drew fewer than a field and an operator', timeout: 15_000 })
      .toBeGreaterThanOrEqual(2);
    await sel.nth(0).selectOption(r.cond.field);
    await sel.nth(1).selectOption(r.cond.operator);
    const valueSelect = li.locator('.niyam-cond select.inp').nth(2);
    if (await valueSelect.count()) {
      await valueSelect.selectOption(r.cond.value);
    } else {
      const box = li.locator('.niyam-cond input.inp').first();
      await expect(box,
        `the condition on ${r.cond.field} offers neither a value select nor a value box`)
        .toBeVisible({ timeout: 15_000 });
      await box.fill(r.cond.value);
    }
  }

  await ed.getByRole('button', { name: 'Add then' }).click();
  const act = stepList(page).last();
  const selects = act.locator('.niyam-action select.inp');
  await expect(selects, 'the action card drew no verb select').not.toHaveCount(0);
  await selects.nth(0).selectOption('notify.send');
  await selects.nth(1).selectOption(r.to);
  // Title, then Message — DOM order, because neither has a name.
  const boxes = act.locator('.niyam-action input.inp');
  await expect(boxes, 'the notify action card drew fewer than two text boxes')
    .toHaveCount(2, { timeout: 15_000 });
  await boxes.nth(0).fill(ruleTitle(r));
  await boxes.nth(1).fill(ruleBody(r));

  const w = await saveAndWait(page, /\/v1\/niyam\/rules$/,
    () => ed.getByRole('button', { name: 'Save', exact: true }).click(),
    `saving ${ruleName(r)}`);
  expect(w.body?.rule_id, `POST /v1/niyam/rules echoed no rule_id: ${w.text.slice(0, 300)}`)
    .toBeTruthy();
  // ⚠ THE SERVER'S OWN PROMISE, ASSERTED: a rule is born OFF and UNARMED
  // whatever the client sends, and there is no field on the endpoint to change
  // that. Turning one on must be a separate, deliberate act.
  expect(w.body.enabled, `${ruleName(r)} was born enabled`).toBe(false);
  expect(w.body.is_armed, `${ruleName(r)} was born armed`).toBe(false);
  await expect(ed, 'the editor stayed open after a successful save')
    .toBeHidden({ timeout: 20_000 });
  return String(w.body.rule_id);
}

/**
 * Flip one switch on a rule card, and PROVE the canonical row moved.
 *
 * ⚠ THE READ-BACK IS NOT BELT AND BRACES — 16.17 caught a rule left ARMED
 * without it. `toggle()` in NiyamPage fires the PATCH and then calls `load()`,
 * so the card re-renders from a fresh list; a click that lands during that
 * re-render hits a node the next paint replaces, the request never fires, and
 * `aria-checked` on the stale node still reads what the author intended. The
 * switch looked flipped and the row had not moved.
 *
 * So the state is read from `GET /rules/{id}` afterwards, and one retry is
 * allowed — because leaving a rule armed is the one thing in this suite that
 * outlives the process.
 */
async function flip(page: Page, name: string, which: 'on' | 'armed', to: boolean) {
  const col = which === 'on' ? 'enabled' : 'is_armed';
  let last: Wrote | null = null;

  for (let attempt = 0; attempt < 3; attempt++) {
    const live = (await rulesByName(page)).get(name);
    if (!live) throw new Error(`no rule named "${name}" on ${LANE.org}`);
    if (Boolean(live[col]) === to) return last;          // already where it should be

    await gotoNiyam(page);
    const card = ruleCard(page, name);
    await expect(card, `no rule card on screen named "${name}"`)
      .toBeVisible({ timeout: 30_000 });
    const sw = which === 'on' ? switchOn(card) : switchArmed(card);
    await expect(sw, `the ${which} switch is missing from the "${name}" card`)
      .toBeVisible({ timeout: 15_000 });
    last = await saveAndWait(page, /\/v1\/niyam\/rules\/[^/]+$/,
      () => sw.click(), `${which}=${to} on ${name}`, ['PATCH']);
  }

  const after = (await rulesByName(page)).get(name);
  expect(Boolean(after?.[col]),
    `"${name}" would not go ${which}=${to} after three attempts. The canonical row still ` +
    `reports ${col}=${after?.[col]}. This read-back is the check that caught a rule left ` +
    'ARMED, so it is deliberately loud rather than best-effort.').toBe(to);
  return last;
}

// ════════════════════════════════════════════════════════════════════════════
// THE MODULE DRIVERS — every one a real form, in the module that owns the event
// ════════════════════════════════════════════════════════════════════════════

/**
 * Open a `ModuleTabs` tab by clicking it, wherever the strip has put it.
 *
 * ⚠ `?tab=` IS NOT A NAVIGATION IN EVERY MODULE. Graha reads it; Ganit and
 * Manav do not — they keep the open tab in local state, and `GanitPage` says so
 * in its own comment. Run A used `/manav?tab=leaves` and waited twenty seconds
 * for a "+ Request leave" button that was on a tab nobody had opened.
 *
 * `ModuleTabs` also splits inline tabs from a "More" popover by MEASURING the
 * row with a `ResizeObserver`, so which branch is right is a run-time fact and
 * not a constant — a tab can exist inline on first paint and be gone into the
 * menu a beat later. The count is allowed to settle before the branch is taken.
 */
async function moduleTab(page: Page, mod: string, id: string, label: string): Promise<Locator> {
  if (!new RegExp(`/${mod}`).test(new URL(page.url()).pathname)) {
    await page.goto(`/${mod}`);
  }
  const panel = page.locator(`#mt-panel-${id}`);
  if (await panel.count() && await panel.isVisible().catch(() => false)) {
    await settle(page);
    return panel;
  }
  const strip = page.locator('.mt__wrap');
  await expect(strip, `the ${mod} tab strip never rendered`).toBeVisible({ timeout: 60_000 });
  // Let the ResizeObserver finish splitting head from tail before choosing.
  let stable = -1, sameFor = 0;
  for (let i = 0; i < 25 && sameFor < 3; i++) {
    const n = await strip.locator('[role="tab"]').count();
    sameFor = n === stable ? sameFor + 1 : 0;
    stable = n;
    await page.waitForTimeout(120);
  }

  const inline = page.locator(`#mt-tab-${id}`);
  if (await inline.count()) {
    await inline.click();
  } else {
    const more = strip.locator('button.mt__more');
    await expect(more, `tab "${label}" is not inline and there is no More menu to look in`)
      .toBeVisible({ timeout: 20_000 });
    await more.click();
    const menu = strip.locator('[role="menu"]');
    await expect(menu, 'the More popover did not open').toBeVisible({ timeout: 15_000 });
    const row = menu.locator('button[role="menuitem"]',
      { hasText: new RegExp(`^\\s*${label}`, 'i') });
    await expect(row.first(),
      `tab "${label}" is neither on the strip nor in the More menu — it is unreachable, ` +
      'which is a product finding and not a selector problem').toBeVisible({ timeout: 15_000 });
    await row.first().click();
  }
  await expect(panel, `the ${mod} "${id}" panel never rendered after its tab was clicked`)
    .toBeVisible({ timeout: 60_000 });
  await settle(page);
  return panel;
}

const ganitTab = (page: Page, id: string, label: string) => moduleTab(page, 'ganit', id, label);

/** Core PM — the New Task modal, the product's primary create surface. */
async function triggerTaskCreated(page: Page): Promise<string> {
  const projects = (await apiJson(page, '/api/teams'))?.data
    ?? (await apiJson(page, '/api/teams'));
  const list: any[] = Array.isArray(projects) ? projects : (projects?.teams || []);
  expect(list.length, 'Unicode Group has no project at all, so a task cannot be created — ' +
    'Suite 03 owns the eight projects. This is a precondition, not a Niyam finding.')
    .toBeGreaterThan(0);
  // ⚠ NEVER the protected team. `team_ae1d58543b21` holds the 20 tasks §12
  // guarantees, and a rule armed on `task.created` must not be given a reason
  // to act inside it.
  const target = list.find((t: any) =>
    String(t.team_id) !== 'team_ae1d58543b21' && !/aekam/i.test(String(t.name || '')));
  expect(target, 'every project on Unicode Group is the protected Aekam Inc team — ' +
    'refusing to create a task').toBeTruthy();

  await page.goto('/tasks');
  await page.getByRole('button', { name: 'New task' }).first().click();
  // ⚠ SUITE RULE 8. `NewTaskModal` is `aria-labelledby="ntm-title"` and that
  // node reads "What needs doing?" — the words "New task" are in a kicker that
  // is not the labelledby target, so `{name:/New task/}` matches nothing and
  // reports a dead control over a modal that opened correctly.
  const modal = page.getByRole('dialog', { name: /What needs doing/i }).first();
  await expect(modal, 'the New Task modal did not open').toBeVisible({ timeout: 25_000 });
  await modal.getByRole('textbox', { name: 'Task title' }).fill(S16_TASK());
  await modal.getByRole('combobox', { name: 'PROJECT' })
    .selectOption({ label: String(target.name) });
  await modal.getByRole('combobox', { name: 'STATUS' }).selectOption('todo');
  const w = await saveAndWait(page, /\/api\/tasks$/,
    () => modal.getByRole('button', { name: 'Create Task' }).click(),
    `creating ${S16_TASK()}`);
  expect(w.body?.task_id, `POST /tasks echoed no task_id: ${w.text.slice(0, 200)}`).toBeTruthy();
  return String(target.team_id);
}

/**
 * Core PM — flip the S16 task's status from the card's own tick, and flip it
 * back. Two real status changes, one new row between them: none.
 */
async function triggerTaskStatusChanged(page: Page, teamId: string) {
  const cardOf = (title: string) =>
    page.locator('button.bc').filter({ has: page.locator('.bc__t', { hasText: title }) }).first();

  await page.goto(`/projects/${teamId}`);
  await expect(page.locator('.bd'), 'the kanban never rendered').toBeVisible({ timeout: 60_000 });
  await settle(page);

  const c = cardOf(S16_TASK());
  await expect(c, `no card titled "${S16_TASK()}" on the board that owns it`)
    .toBeVisible({ timeout: 30_000 });
  await saveAndWait(page, /\/api\/tasks\/[^/]+$/,
    () => c.getByRole('button', { name: new RegExp(`^Mark ${reEsc(S16_TASK())} done$`) }).click(),
    `marking ${S16_TASK()} done`, ['PATCH']);

  // And back, so run 2 finds it in the same state run 1 did — §6 without
  // leaving a row behind.
  await page.goto(`/projects/${teamId}`);
  await expect(page.locator('.bd')).toBeVisible({ timeout: 60_000 });
  await settle(page);
  await saveAndWait(page, /\/api\/tasks\/[^/]+$/,
    () => cardOf(S16_TASK())
      .getByRole('button', { name: new RegExp(`^Mark ${reEsc(S16_TASK())} as not done$`) }).click(),
    `reopening ${S16_TASK()}`, ['PATCH']);
}

/** Graha — + Add Client. */
async function triggerClientCreated(page: Page) {
  await page.goto('/graha?tab=clients');
  await settle(page);
  const p = page.locator('#mt-panel-clients');
  await p.getByRole('button', { name: '+ Add Client' }).click();
  const form = p.locator('.gr__panel').filter({ hasText: 'New Client' });
  await expect(form, 'the New Client panel did not open').toBeVisible({ timeout: 20_000 });
  await form.getByLabel('Company name').fill(S16_CLIENT());
  await form.getByLabel('Reference number').fill(`${TAG}-${RUN}`);
  // GSTIN, PAN and TAN are non-mandatory by owner rule and must block nothing.
  // Left blank deliberately; a refusal here would be a finding in itself.
  await form.getByLabel('Address line 1').fill('1, Kartavya Chambers');
  await form.getByLabel('City').fill('Ahmedabad');
  await form.getByLabel('State').fill('Gujarat');
  await form.getByLabel('Pincode').fill('380015');
  await saveAndWait(page, /\/graha\/clients(\?|$)/,
    () => form.getByRole('button', { name: 'Create' }).click(),
    `creating ${S16_CLIENT()}`);
  await expect(form, 'the New Client panel stayed open after a successful create')
    .toBeHidden({ timeout: 20_000 });
}

/** Graha — + Add Contact, with the run's own Source so rule 04 can match it. */
async function triggerContactCreated(page: Page) {
  await page.goto('/graha?tab=contacts');
  await settle(page);
  const p = page.locator('#mt-panel-contacts');
  await p.getByRole('button', { name: '+ Add Contact' }).click();
  const form = p.locator('form.gr__panel');
  await expect(form, 'the New Contact form did not open').toBeVisible({ timeout: 20_000 });
  const f = (label: string) =>
    form.locator('label.gr__f').filter({ hasText: label }).first();
  await f('Name *').locator('input').fill(S16_CONTACT());
  await f('Type').locator('select').selectOption('lead');
  await f('Email').locator('input')
    .fill(`success+s16-${RUN}@simulator.amazonses.com`);
  await f('Source').locator('input').fill(S16_CONTACT_SOURCE);
  await saveAndWait(page, /\/graha\/contacts(\?|$)/,
    () => form.getByRole('button', { name: /Create Contact|Saving/ }).click(),
    `creating ${S16_CONTACT()}`);
  await expect(form, 'the New Contact form stayed open after a successful create')
    .toBeHidden({ timeout: 20_000 });
}

/** Graha — + New Deal, at the value rule 06 is written against. */
async function triggerDealCreated(page: Page): Promise<string> {
  await page.goto('/graha?tab=deals');
  await settle(page);
  const p = page.locator('#mt-panel-deals');
  await p.getByRole('button', { name: '+ New Deal' }).click();
  const form = p.locator('form.gr__panel');
  await expect(form, 'the New Deal form did not open').toBeVisible({ timeout: 20_000 });
  const f = (label: string) =>
    form.locator('label.gr__f').filter({ hasText: label }).first();
  await f('Title *').locator('input').fill(S16_DEAL());
  await f('Value (₹)').locator('input').fill(String(S16_DEAL_VALUE));
  await f('Stage').locator('select').selectOption('Qualified').catch(async () => {
    // Stages are per-org (`graha_pipelines.stages`), so the option list is data
    // rather than a constant. Fall back to the second option, never to a
    // hardcoded name.
    const sel = f('Stage').locator('select');
    const vals = await sel.locator('option').allTextContents();
    expect(vals.length, 'the deal Stage select offers nothing at all').toBeGreaterThan(1);
    await sel.selectOption({ index: 1 });
  });
  const year = new Date().getFullYear();
  await setDate(form, 'Expected Close', `${year}-12-15`).catch(() => {});
  const w = await saveAndWait(page, /\/graha\/deals(\?|$)/,
    () => form.getByRole('button', { name: /Create Deal|Creating/ }).click(),
    `creating ${S16_DEAL()}`);
  await expect(form, 'the New Deal form stayed open after a successful create')
    .toBeHidden({ timeout: 20_000 });
  return String(w.body?.id || w.body?.deal?.id || w.body?.deal_id || '');
}

/** Graha — move the S16 deal a stage, from the deal's own drawer. */
async function triggerDealStageChanged(page: Page, dealId: string) {
  const deals = await apiJson(page, '/api/v1/graha/deals?include_archived=true');
  const rows: any[] = deals?.data || deals?.deals || [];
  const mine = rows.find((d: any) => String(d.title) === S16_DEAL());
  expect(mine, `${S16_DEAL()} is not on the deal list, so its stage cannot be moved`).toBeTruthy();
  const id = dealId || String(mine.id);

  await page.goto(`/graha/deals/${id}`);
  const d = page.getByRole('dialog');
  await expect(d, 'the deal drawer did not open').toBeVisible({ timeout: 30_000 });
  await d.getByRole('button', { name: 'Edit deal' }).click();
  const ef = d.locator('form.dr__sec');
  await expect(ef, 'the deal edit form did not open').toBeVisible({ timeout: 20_000 });
  const stage = ef.locator('label.gr__f').filter({ hasText: 'Stage' }).locator('select');
  const options = (await stage.locator('option').all());
  expect(options.length, 'the deal Stage select offers nothing').toBeGreaterThan(1);
  const current = await stage.inputValue();
  // Any stage that is not the current one. Never a hardcoded name — the list is
  // per-org data.
  let next = '';
  for (const o of options) {
    const v = await o.getAttribute('value');
    if (v && v !== current) { next = v; break; }
  }
  expect(next, `the deal is on "${current}" and there is no other stage to move it to`)
    .toBeTruthy();
  await stage.selectOption(next);
  await saveAndWait(page, /\/graha\/deals\//,
    () => ef.getByRole('button', { name: /^Save$|^Saving/ }).click(),
    `moving ${S16_DEAL()} to ${next}`, ['PATCH', 'PUT']);
}

/**
 * Ganit — a ₹1 receipt through the invoice drawer's own Record payment form.
 *
 * ₹1 rather than a real figure because rule 08 is `amount <= 2`: it must match
 * THIS receipt and nothing anybody else records. The invoice chosen is the
 * first with a balance greater than ₹1, read from the product's own list.
 */
async function triggerPaymentRecorded(page: Page) {
  const inv = await apiJson(page, '/api/v1/ganit/invoices?limit=200');
  const rows: any[] = inv?.data || inv?.invoices || [];
  const open = rows.find((i: any) =>
    Number(i.balance_due || 0) > 1 && !i.cancelled_at && i.is_active !== false);
  expect(open, 'no Unicode invoice carries a balance over ₹1, so a receipt cannot be ' +
    'recorded — Suite 05 owns the invoices. This is a precondition, not a Niyam finding.')
    .toBeTruthy();

  // ⚠ THE INVOICE DRAWER DOES NOT OPEN FROM A URL, AND SAYING SO IS THE POINT.
  // `/ganit/invoices/{id}` renders the register, not the record — `GanitPage`
  // keeps its open tab in local state and its drawer is opened by clicking the
  // document's number, which is how a person reaches it. Navigating to the id
  // produced "the invoice drawer did not open" in run A: a locator failure that
  // reads exactly like a missing control.
  const p = await ganitTab(page, 'invoices', 'invoices');
  const search = p.locator('input.tv__input');
  await expect(search, 'the invoice register has no search box, so a document cannot be found')
    .toBeVisible({ timeout: 30_000 });
  await search.selectText();
  await search.type(String(open.invoice_number));
  const link = p.getByRole('button', { name: String(open.invoice_number), exact: true });
  await expect(link, `${open.invoice_number} is on the wire and not on the register`)
    .toBeVisible({ timeout: 30_000 });
  await link.click();
  const drawer = page.getByRole('dialog', { name: `Invoice ${open.invoice_number}` });
  await expect(drawer, `the record drawer for ${open.invoice_number} did not open`)
    .toBeVisible({ timeout: 30_000 });
  const openPay = drawer.getByRole('button', { name: /^Record payment$/ });
  await expect(openPay, `${open.invoice_number} offers no way to record a payment`)
    .toBeVisible({ timeout: 20_000 });
  await openPay.click();
  const form = drawer.locator('form.gn-form--accent');
  await expect(form, 'the payment form did not open').toBeVisible({ timeout: 20_000 });
  const amount = form.locator('label.fld', { hasText: 'Amount' }).locator('input.inp');
  await amount.selectText();
  await amount.type('1');
  await form.locator('label.fld', { hasText: 'Method' }).locator('select.inp')
    .selectOption('bank_transfer');
  const ref = form.locator('label.fld', { hasText: 'Reference' }).locator('input.inp');
  await ref.selectText();
  await ref.type(`${TAG}-${RUN}`);
  await saveAndWait(page, /\/v1\/ganit\/invoices\/[^/]+\/payments$/,
    () => form.getByRole('button', { name: /^Record$/ }).click(),
    `a ₹1 receipt on ${open.invoice_number}`);
}

/**
 * Vikray — +1 then −1 on the stock ledger. Two real adjustments, net zero, and
 * `product_name` is what rule 10 matches on.
 */
async function triggerStockAdjusted(page: Page): Promise<string> {
  const stock = await apiJson(page, '/api/v1/vikray/stock');
  const rows: any[] = stock?.data || stock?.stock || [];
  expect(rows.length, 'the Unicode stock ledger is empty — Suite 10 owns it. This is a ' +
    'precondition, not a Niyam finding.').toBeGreaterThan(0);
  const target = rows.find((s: any) => String(s.name || '').includes('S05 Product 01'))
    || rows[0];
  const name = String(target.name);

  // `VikrayPage` DOES read `?tab=` (unlike Ganit and Manav), but `moduleTab`
  // returns immediately when the panel is already up and clicks the tab when it
  // is not — so this is correct either way rather than correct by luck.
  await page.goto('/vikray?tab=stock');
  await moduleTab(page, 'vikray', 'stock', 'stock');
  const plus = page.getByRole('button', { name: `Add one ${name}` });
  await expect(plus, `the stock ledger offers no "+1" control for ${name}`)
    .toBeVisible({ timeout: 30_000 });
  await saveAndWait(page, /\/v1\/vikray\/stock\//, () => plus.click(),
    `+1 on ${name}`, ['PATCH']);
  const minus = page.getByRole('button', { name: `Remove one ${name}` });
  await expect(minus, `the stock ledger offers no "−1" control for ${name}`)
    .toBeVisible({ timeout: 20_000 });
  await saveAndWait(page, /\/v1\/vikray\/stock\//, () => minus.click(),
    `−1 on ${name}`, ['PATCH']);
  return name;
}

/** Manav — + Request leave, at the day count rule 11 is written against. */
async function triggerLeaveRequested(page: Page) {
  const emps = await apiJson(page, '/api/v1/manav/employees?limit=200');
  const staff: any[] = emps?.data || emps?.employees || [];
  expect(staff.length, 'Unicode Group has no employee, so leave cannot be requested — ' +
    'Suite 07 owns the thirty. This is a precondition, not a Niyam finding.')
    .toBeGreaterThan(0);
  const types = await apiJson(page, '/api/v1/manav/leave-types');
  const lt: any[] = types?.data || types?.leave_types || [];
  expect(lt.length, 'Unicode Group has no leave type — Suite 07 owns the six.')
    .toBeGreaterThan(0);

  await moduleTab(page, 'manav', 'leaves', 'leave');
  const add = page.getByRole('button', { name: '+ Request leave', exact: true });
  await expect(add, 'the Leave tab offers no "+ Request leave" control')
    .toBeVisible({ timeout: 30_000 });
  await add.click();
  const form = page.locator('form.k-formpanel');
  await expect(form.getByRole('heading', { name: 'Request leave' }),
    'the Request leave form did not open').toBeVisible({ timeout: 25_000 });

  // ⚠ MANAV LABELS ITS FIELDS DIFFERENTLY FROM GANIT AND GRAHA, and guessing
  // costs a false "missing control". Ganit uses `label.fld`; Graha uses
  // `label.gr__f`; Manav wraps a `<span>` whose EXACT text is the caption
  // inside a bare `<label>`. Run B reported "the Request leave form has no
  // 'Employee' control" over a form that had one — the shape was wrong, not the
  // product. This is suite07's own `field()` locator, reused rather than
  // re-invented, and the captions carry their `*` because the span does.
  const field = (caption: string) =>
    form.locator('label').filter({
      has: page.locator('span').filter({ hasText: new RegExp(`^\\s*${reEsc(caption)}\\s*$`) }),
    }).first();

  const chooseByText = async (caption: string, needle: string) => {
    const sel = field(caption).locator('select').first();
    await expect(sel, `the Request leave form has no "${caption}" control`)
      .toBeVisible({ timeout: 20_000 });
    const opts = await sel.locator('option').evaluateAll(
      (os) => os.map((o: any) => ({ value: o.value, text: o.textContent || '' })));
    const hit = opts.find((o) => o.value && o.text.includes(needle));
    expect(hit, `the "${caption}" picker offers no option containing ${JSON.stringify(needle)}. ` +
      `Offered: ${opts.map((o) => o.text.trim()).slice(0, 12).join(' | ')}`).toBeTruthy();
    await sel.selectOption(hit!.value);
  };

  // ⚠ THE PAIR IS CHOSEN, NOT TAKEN BY POSITION — and the reason is a real
  // fact about this org's data rather than a convenience.
  //
  // Taking the first employee and the first leave type produced
  // `400 {"detail":"Insufficient leave balance. Available: -11, requested: 13"}`.
  // That refusal is CORRECT — the request genuinely exceeds the balance — but
  // it means a positional pick tests the refusal path, not the emission path,
  // and rule 11 is written against `days >= 13`.
  //
  // ⚠ AND IT SURFACED SOMETHING WORTH RECORDING: an employee on this org holds
  // a NEGATIVE leave balance (−11). Whether the product should permit a balance
  // below zero is a question for Suite 07, which owns leave; it is reported
  // here rather than worked around silently.
  //
  // So the pair is read from the product's own balances first, exactly as the
  // screen shows them — available = allocated + carried_forward − used.
  // ⚠ EVERY EMPLOYEE, NOT THE FIRST TWELVE. Measured live 2026-08-29:
  // `manav_leave_balances` on this org holds only 2–3 rows PER LEAVE TYPE — so
  // most of the thirty employees carry no balance at all, and the one person
  // with a usable balance (170 days of Maternity Leave, `S7ML`) sits outside
  // any short prefix of the list. A capped scan reported "no employee has 13
  // days available" over an org where one does.
  const enough: { emp: any; code: string } | null = await (async () => {
    for (const e of staff) {
      const d = await apiJson(page, `/api/v1/manav/employees/${e.id}`);
      for (const b of (d.leave_balances || [])) {
        const available = Number(b.allocated || 0) + Number(b.carried_forward || 0)
          - Number(b.used || 0);
        if (available >= S16_LEAVE_DAYS) return { emp: e, code: String(b.leave_code) };
      }
    }
    return null;
  })();
  expect(enough,
    `no employee on ${LANE.org} has ${S16_LEAVE_DAYS} days available on any leave type, so a ` +
    'request of that size can only be refused. Rule 11 is written against `days >= 13` ' +
    'because a smaller number would also match the 24 requests Suite 07 already typed. ' +
    'This is a precondition about the org\'s balances, not a Niyam finding.').toBeTruthy();
  console.log(`  leave: ${enough!.emp.employee_code} on ${enough!.code}, ` +
    `${S16_LEAVE_DAYS} days`);

  await chooseByText('Employee *', String(enough!.emp.employee_code));
  await chooseByText('Leave type *', enough!.code);

  const days = field('Days').locator('input').first();
  await expect(days, 'the Request leave form has no "Days" box')
    .toBeVisible({ timeout: 15_000 });
  await days.click();
  await days.press('ControlOrMeta+a');
  await days.pressSequentially(String(S16_LEAVE_DAYS), { delay: 4 });
  await expect(days, 'the Days box would not take the value')
    .toHaveValue(String(S16_LEAVE_DAYS), { timeout: 10_000 });

  const start = new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10);
  const end = new Date(Date.now() + (30 + S16_LEAVE_DAYS - 1) * 864e5)
    .toISOString().slice(0, 10);
  await setDate(form, 'Start date', start);
  await setDate(form, 'End date', end);

  const reason = field('Reason').locator('input, textarea').first();
  await expect(reason, 'the Request leave form has no "Reason" box')
    .toBeVisible({ timeout: 15_000 });
  await reason.fill(S16_LEAVE_REASON());
  await saveAndWait(page, /\/manav\/leaves$/,
    () => form.getByRole('button', { name: 'Submit', exact: true }).click(),
    `requesting ${S16_LEAVE_DAYS} days' leave`);
}

// ════════════════════════════════════════════════════════════════════════════
// 16.01 — THE SAFETY GATE. NOTHING IS ARMED UNTIL THIS PASSES.
// ════════════════════════════════════════════════════════════════════════════

test('16.01 the engine, the fence and the six armed rules in the no-touch org are all where they were left',
  async ({ page }) => {
    await signIn(page);
    // ⚠ THE RUN'S STAMP, FIXED HERE AND READ EVERYWHERE ELSE. 16.01 always runs
    // first, so this is where the marks are pinned for the whole execution —
    // see the `stamp()` comment for the failure that made it necessary.
    ledgerWrite({ stamp: RUN });

    // ── the deployed process attests its own outbound state ─────────────────
    const health = await (await page.request.get(`${API}/api/health`)).json();
    console.log(`\n  outbound_mode=${health.outbound_mode} ` +
      `suppressed_orgs_digest=${health.suppressed_orgs_digest} schema=${health.schema}`);

    // ── the engine's own flags, read from the product's own endpoint ────────
    const cat = await apiJson(page, '/api/v1/niyam/catalog');
    const flags = cat.flags || {};
    console.log(`  NIYAM_ARMED=${flags.engine_armed} ` +
      `NIYAM_CUSTOMER_MAIL=${flags.customer_mail_armed}`);

    // ── the heartbeat: is anything draining this outbox at all? ─────────────
    const st = await engineStatus(page);
    console.log(`  engine tick last ended ${st.last_tick_at} · ` +
      `events ${st.events_total} of which ${st.events_unprocessed} unprocessed · ` +
      `rules enabled ${st.rules_enabled}, armed ${st.rules_armed} · ` +
      `runs in 24h ${st.runs_last_24h} · stranded ${st.runs_stranded}`);
    ledgerWrite({
      before: {
        events_total: st.events_total,
        events_unprocessed: st.events_unprocessed,
        rules_enabled: st.rules_enabled,
        rules_armed: st.rules_armed,
        last_tick_at: st.last_tick_at,
        outbound_mode: health.outbound_mode,
        suppressed_orgs_digest: health.suppressed_orgs_digest,
        engine_armed: flags.engine_armed,
        customer_mail_armed: flags.customer_mail_armed,
      },
    });

    // ── ⚠ THE GATE. Every rule that exists anywhere, and whose it is. ───────
    //
    // This suite cannot see other orgs' rules through the API — `/v1/niyam/rules`
    // is org-scoped in SQL and that is correct. What it CAN see is the engine's
    // global count, and that is the number that matters: a sweep this suite
    // provokes runs every armed rule in every org.
    const unicodeRules = await rulesByName(page);
    const mine = [...unicodeRules.values()];
    const globalArmed = Number(st.rules_armed || 0);
    const localArmed = mine.filter((r) => r.enabled && r.is_armed).length;
    const elsewhereArmed = globalArmed - localArmed;

    console.log(`  armed rules: ${globalArmed} globally, ${localArmed} on ${LANE.org}, ` +
      `${elsewhereArmed} in organisations this lane cannot see`);

    // Measured 2026-08-29: six, all six in Aekam Inc, all six enabled+armed.
    // If that number GROWS under this suite, something armed a rule somewhere
    // this lane has no business reaching.
    expect(elsewhereArmed,
      `${elsewhereArmed} armed rules exist outside ${LANE.org}. Measured on 2026-08-29 ` +
      'there were exactly SIX, all in Aekam Inc — the org §12 guarantees is untouched — ' +
      'and all six enabled and armed, one of them `invoice.remind_customer`, which mails ' +
      'somebody outside the firm. This suite provokes a GLOBAL drain, so that number is ' +
      'recorded before and after. A change means the population moved under the run and ' +
      'the before/after comparison in 16.17 is no longer sound.')
      .toBeLessThanOrEqual(6);
    ledgerWrite({ elsewhereArmedBefore: elsewhereArmed });

    // ── ⚠ THE INERTNESS PROOF, re-derived live ─────────────────────────────
    //
    // Those six can only act on an event. They fire on `report.due`,
    // `invoice.overdue`, `contact.stale`, `lead.converted`, `task.overdue` and
    // `task.created`. Five of the six are TEMPORAL and only the sweep's own
    // predicates emit them. So the question that decides whether it is safe to
    // sweep is: does any predicate have anything to offer? The engine answers
    // it itself, in the report of the last completed tick.
    const last = st.last_tick_result || {};
    const preds = last.predicates || {};
    const found = Object.entries(preds)
      .map(([k, v]: any) => `${k}:${v?.found ?? '?'}`).join(' ');
    console.log(`  last tick predicates — ${found || '(none recorded)'}`);
    console.log(`  last tick alerts — ${JSON.stringify(last.metric_alerts || {})}`);

    // `report.due` is the one with a customer-visible effect (it emails a
    // rendered report). Its only schedule row is Aekam's, weekly, and its own
    // `last_sent_at` is at or after its most recent slot. That is a fact about
    // a no-touch org's data that this lane cannot query, so it is not asserted
    // here — it is RECORDED, and the assertion that stands is the one this lane
    // owns: the armed population outside it must not grow.
    expect(flags.engine_armed,
      'NIYAM_ARMED is off, so every rule below would run dry and `fired` would be 0 for ' +
      'all fourteen. That is a legitimate state of the system and it is reported rather ' +
      'than worked around — but it means §4\'s "armed 14 · fired 14" cannot be delivered ' +
      'and the run should stop here rather than report dry runs as fires.')
      .toBe(true);

    // ── the recipients this suite can reach, enumerated BEFORE anything arms ─
    // ⚠ `/api/v1/org/members` answers a BARE ARRAY, not `{data:[…]}`. A helper
    // that reaches for `.data` first reads `undefined`, falls through to `[]`,
    // and then reports "the member directory answered nothing" — which reads
    // exactly like a broken endpoint. Same for `/api/teams` and `/api/tasks`.
    const members = await apiJson(page, '/api/v1/org/members');
    const rows: any[] = Array.isArray(members)
      ? members : (members?.data || members?.members || []);
    expect(rows.length, 'the member directory answered nothing, so recipients cannot be ' +
      'enumerated and nothing may be armed').toBeGreaterThan(0);
    const addresses = rows
      .map((m: any) => String(m.email || '').trim())
      .filter(Boolean);
    const offenders = addresses.filter((a) => !ALLOWED_RECIPIENT.test(a));
    console.log(`  ${addresses.length} member addresses on ${LANE.org}, ` +
      `${offenders.length} outside the allowlist`);
    expect(offenders,
      `these ${LANE.org} member addresses are outside the brief's allowlist and a rule ` +
      'could name one: ' + offenders.join(', ') + '. ⚠ `@example.com` publishes a null MX, ' +
      'so mailing one is a hard bounce on the SES account that sends the owner\'s real ' +
      'invoices. Nothing is armed until this is empty.')
      .toEqual([]);
    ledgerWrite({ memberAddresses: addresses.length });

    // ── the protected set, pinned by id before anything is typed ────────────
    const teams = await apiJson(page, '/api/teams');
    const tl: any[] = teams?.data || teams?.teams || (Array.isArray(teams) ? teams : []);
    const protectedTeam = tl.find((t: any) => String(t.team_id) === 'team_ae1d58543b21');
    const tasks = await apiJson(page, '/api/tasks?limit=500');
    const taskRows: any[] = tasks?.data || tasks?.tasks || (Array.isArray(tasks) ? tasks : []);
    const protectedTasks = taskRows.filter((t: any) => String(t.team_id) === 'team_ae1d58543b21');
    // ⚠ NINETEEN, NOT TWENTY, AND THAT IS CORRECT. §12 pins the set at 20 and
    // the table holds 20 — verified against the live catalogue 2026-08-29:
    // `public.tasks WHERE team_id='team_ae1d58543b21'` = 20, of which ONE is
    // archived. `GET /api/tasks` excludes archived rows, so the API's honest
    // answer is 19. This is recorded rather than "fixed" by widening the query,
    // because the check that matters is BEFORE-versus-AFTER of the same
    // measure; a number that changes is the finding, not the number itself.
    console.log(`  protected set: team ${protectedTeam ? 'present' : 'MISSING'}, ` +
      `${protectedTasks.length} tasks visible to GET /api/tasks ` +
      '(20 in the table, 1 archived — see the comment)');
    ledgerWrite({ protectedTasksBefore: protectedTasks.length });
    expect(protectedTeam,
      'the protected Aekam Inc team `team_ae1d58543b21` is not on this org. §12 pins it ' +
      'and 20 tasks; nothing may be armed until it is found.').toBeTruthy();
  });

// ════════════════════════════════════════════════════════════════════════════
// 16.02 — THE BUILDER'S TWO SCREENS, AS A CUSTOMER MEETS THEM
// ════════════════════════════════════════════════════════════════════════════

test('16.02 the catalogue serves every wired event and the trigger picker offers all of them, and no UUID is rendered',
  async ({ page }) => {
    await signIn(page);
    await gotoNiyam(page);

    const cat = await apiJson(page, '/api/v1/niyam/catalog');
    const events: any[] = cat.events || [];
    const families = [...new Set(events.map((e: any) => String(e.family)))].sort();
    console.log(`\n  catalog: ${events.length} event types, ${families.length} families ` +
      `(${families.join(', ')}), ${(cat.actions || []).length} action verbs`);
    expect(events.length,
      '§10 records "40 events wired". The deployed catalogue serves ' + events.length +
      '. A number BELOW 40 means a trigger was withdrawn into `registry.UNWIRED`, which ' +
      'is the mechanism that exists so a declared-but-unemitted trigger is never offered.')
      .toBeGreaterThanOrEqual(40);
    expect(families, 'the engine\'s family set has moved').toEqual(ENGINE_FAMILIES);

    await page.getByRole('button', { name: 'New rule', exact: true }).click();
    const ed = editor(page);
    await expect(ed, 'the rule editor did not open').toBeVisible({ timeout: 20_000 });
    const offered = await ed.locator('select.inp').first().locator('option')
      .evaluateAll((os) => os.map((o: any) => o.value));
    expect(new Set(offered).size,
      'the trigger picker offers fewer triggers than the catalogue serves, so an event the ' +
      'product emits cannot be built a rule against')
      .toBe(events.length);
    // The picker shows LABELS, never the dotted type — the server serves both
    // precisely so no screen has to show `task.status_changed` to a human.
    const labels = await ed.locator('select.inp').first().locator('option').allTextContents();
    const dotted = labels.filter((l) => /^[a-z_]+\.[a-z_]+$/.test(l.trim()));
    expect(dotted, `the trigger picker shows ${dotted.length} raw event type(s) instead of ` +
      `their labels: ${dotted.join(', ')}`).toEqual([]);
    await ed.getByRole('button', { name: 'Close', exact: true }).click();

    const painted = await page.locator('.k-page.niyam').innerText();
    const uuids = painted.match(
      /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi) || [];
    expect(uuids, `the automations page renders ${uuids.length} UUID(s): ${uuids.join(', ')}. ` +
      'Never render a user, member or org UUID in any UI.').toEqual([]);
  });

// ── FINDING 2 ───────────────────────────────────────────────────────────────

test('16.02b every family the engine groups by has a filter chip', async ({ page }) => {
  await signIn(page);
  await gotoNiyam(page);

  const chips = await page.locator('.niyam-filters .niyam-chip').allTextContents();
  console.log(`\n  family chips on screen: ${chips.join(' · ')}`);
  const chipKeys = await page.locator('.niyam-filters .niyam-chip').evaluateAll(
    (bs) => bs.map((b: any) => b.getAttribute('data-family') || 'all'));
  const offeredFamilies = chipKeys.filter((k) => k !== 'all').sort();
  // EXACTLY the engine's families. The `missing` check below is the half this
  // suite was written for; this is the other half, and it is why the list is no
  // longer written down twice: a chip for a family the engine does not group by
  // is a filter that matches nothing, which reads to a person exactly like a
  // module with no data in it.
  expect(offeredFamilies,
    'the chips and the engine disagree about which families exist')
    .toEqual([...CHIP_FAMILIES].sort());

  // Each chip must also NARROW the list, not merely paint pressed — a filter
  // that changes nothing is a dead control.
  for (const key of offeredFamilies.slice(0, 3)) {
    const chip = page.locator(`.niyam-filters .niyam-chip[data-family="${key}"]`);
    await chip.click();
    await expect(chip, `the ${key} chip does not report itself pressed`)
      .toHaveAttribute('aria-pressed', 'true');
  }
  await page.locator('.niyam-filters .niyam-chip').first().click();

  const missing = ENGINE_FAMILIES.filter((f) => !offeredFamilies.includes(f));
  expect(missing,
    `${missing.length} of the engine's ${ENGINE_FAMILIES.length} families have no filter ` +
    `chip — ${missing.join(', ')}. A rule about a signature, a payslip, a campaign or a ` +
    'WhatsApp message can be built and is then reachable only through "Everything". That ' +
    'is the SAME defect `NiyamPage.FAMILIES` records as already fixed in its own comment: ' +
    '"the registry grew three families after the first four chips shipped; a rule filed ' +
    'under one of these was reachable only through \'Everything\'." Three chips were ' +
    'added. Four families were not.')
    .toEqual([]);
});

// ── FINDING 5 ───────────────────────────────────────────────────────────────

test('16.02c every control in the rule editor has an accessible name', async ({ page }) => {
  await signIn(page);
  await gotoNiyam(page);
  await page.getByRole('button', { name: 'New rule', exact: true }).click();
  const ed = editor(page);
  await expect(ed, 'the rule editor did not open').toBeVisible({ timeout: 20_000 });

  // Open one of every step kind, so the measurement covers the whole editor
  // rather than the two controls a blank rule happens to show.
  for (const b of ['Add only if', 'Add then', 'Add wait']) {
    await ed.getByRole('button', { name: b }).click();
  }

  // Measured on the LIVE DOM rather than read out of the source, because the
  // source passes a `label` prop that `ui/Field.jsx`'s bare `Input`/`Select`
  // do not render. This is what a screen-reader user actually meets.
  const controls = await ed.locator('input.inp, select.inp, textarea.inp').evaluateAll(
    (els) => els.map((el: any) => {
      const id = el.getAttribute('id');
      const labelled = id ? !!document.querySelector(`label[for="${CSS.escape(id)}"]`) : false;
      const wrapped = !!el.closest('label');
      const aria = (el.getAttribute('aria-label') || '').trim();
      const ariaBy = (el.getAttribute('aria-labelledby') || '').trim();
      return {
        tag: el.tagName.toLowerCase(),
        hasName: Boolean(aria || ariaBy || labelled || wrapped),
        // The prop NiyamPage passes, landing in the DOM as a dead attribute.
        strandedLabel: el.getAttribute('label') || '',
        placeholder: el.getAttribute('placeholder') || '',
      };
    }));
  const nameless = controls.filter((u: any) => !u.hasName);
  const stranded = nameless.filter((n: any) => n.strandedLabel);
  console.log(`\n  rule editor: ${controls.length} form controls, ${nameless.length} with NO ` +
    `accessible name, ${stranded.length} carrying a stranded label="…" attribute: ` +
    stranded.map((n: any) => JSON.stringify(n.strandedLabel)).join(', '));

  expect(nameless,
    `${nameless.length} of ${controls.length} controls in the Niyam rule editor have no ` +
    'accessible name at all, and ' + stranded.length + ' of them carry a DEAD `label="…"` ' +
    'attribute in the DOM that proves the intent. `NiyamPage.jsx` writes ' +
    '`<Input label="What is this rule called?">` and `<Select label="When this happens">`, ' +
    'but `ui/Field.jsx` exports `Input` and `Select` as ' +
    '`({className, ...p}) => <input className={…} {...p}/>` — bare elements that spread ' +
    'the prop straight onto the DOM node, where `label` is not a labelling mechanism on ' +
    'an <input> or a <select>. The `Field` wrapper that would render a real ' +
    '`<label htmlFor>` is never used on this page. So the rule name, the trigger, the ' +
    'wait\'s Minutes, the notification Title and Message and the status box have NO name ' +
    'for a screen reader AND no visible caption on screen — a person meets four ' +
    'identical-looking boxes and has to guess. Detail: ' + JSON.stringify(nameless))
    .toEqual([]);
});

// ════════════════════════════════════════════════════════════════════════════
// 16.03 — THE ORPHANED HALF OF THE ACTION CARD
// ════════════════════════════════════════════════════════════════════════════

test('16.03 every action verb the catalogue offers can actually be configured, and a notification can choose its channel',
  async ({ page }) => {
    await signIn(page);
    await gotoNiyam(page);

    const cat = await apiJson(page, '/api/v1/niyam/catalog');
    const verbs: string[] = (cat.actions || []).map(String).sort();
    expect(verbs, 'the verb allowlist has moved').toEqual([...ALL_VERBS].sort());

    await page.getByRole('button', { name: 'New rule', exact: true }).click();
    const ed = editor(page);
    await expect(ed).toBeVisible({ timeout: 20_000 });
    await ed.getByRole('button', { name: 'Add then' }).click();
    const act = stepList(page).last().locator('.niyam-action');
    const verbSelect = act.locator('select.inp').first();

    // Each verb in turn, and what the card draws for it.
    const drawn: Record<string, { selects: number; inputs: number }> = {};
    for (const v of verbs) {
      await verbSelect.selectOption(v);
      drawn[v] = {
        selects: await act.locator('select.inp').count(),
        inputs: await act.locator('input.inp, textarea.inp').count(),
      };
    }
    console.log(`\n  action card, per verb: ` +
      Object.entries(drawn).map(([v, d]) => `${v} → ${d.selects} select(s) ` +
        `${d.inputs} input(s)`).join(' · '));

    // A verb with no fields beyond the verb picker itself is a verb the product
    // offers and cannot configure — unless it genuinely needs none, which two
    // of the six do (see NO_CONFIG_VERBS).
    //
    // ⚠ AND THOSE TWO MUST SAY SO. An empty card reads as a broken screen, not
    // as "you are already finished", and a person who has just chosen a verb
    // cannot tell the two apart. So the exemption is not a free pass: the card
    // has to carry an explanation instead of fields.
    const unconfigurable = verbs.filter((v) =>
      !NO_CONFIG_VERBS.includes(v) && drawn[v].selects <= 1 && drawn[v].inputs === 0);
    ledgerWrite({ verbCards: drawn, unconfigurableVerbs: unconfigurable });
    for (const v of NO_CONFIG_VERBS) {
      await verbSelect.selectOption(v);
      await expect(act.locator('.niyam-muted'),
        `${v} takes no settings and the card says nothing — an empty card reads ` +
        'as a broken screen rather than as a finished one')
        .toContainText(/takes no settings/i);
    }

    expect(unconfigurable,
      `${unconfigurable.length} action verbs are offered by the picker and have NO ` +
      `configuration fields at all: ${unconfigurable.join(', ')}. Choosing one gives a ` +
      'card with nothing on it, and `services/niyam/validate.py` then refuses the save — ' +
      '`task.create` answers "A task needs a title" and "Choose which project the task ' +
      'is created in" pointing at boxes that do not exist on screen, and ' +
      '`task.add_comment` answers "A comment needs something to say". So four of the six ' +
      'verbs this engine implements, validates and dispatches cannot be used by a ' +
      'customer. That is the orphaned-capability shape of ' +
      '`docs/plans/93-E-ORPHANED-CAPABILITY-SWEEP.md`, seen from the control side.')
      .toEqual([]);

  });

// ── FINDING 3 ───────────────────────────────────────────────────────────────

test('16.03b a notification can choose the channel it is sent on', async ({ page }) => {
  await signIn(page);
  await gotoNiyam(page);
  await page.getByRole('button', { name: 'New rule', exact: true }).click();
  const ed = editor(page);
  await expect(ed).toBeVisible({ timeout: 20_000 });
  await ed.getByRole('button', { name: 'Add then' }).click();
  const act = stepList(page).last().locator('.niyam-action');
  await act.locator('select.inp').first().selectOption('notify.send');

  const channelControl = act.locator('select.inp').filter({
    has: page.locator('option[value="email"], option[value="push"]'),
  });
  expect(await channelControl.count(),
      'the notify action card offers no way to choose a channel. `services/niyam/send.py` ' +
      'implements three — `CHANNELS = {inapp, push, email}` — `validate_steps` checks the ' +
      'value against exactly that set, and `blankStep()` in NiyamPage.jsx hardcodes ' +
      '`channel: "inapp"` with nothing on any screen able to change it. So no rule a ' +
      'customer can author will ever send an email or a push. ⚠ AND THAT IS WHY §10\'s ' +
      '"one fired in quiet hours must defer then deliver" has no user-drivable path: ' +
      '`send.INTERRUPTING = {push, email}` and in-app is deliberately exempt, so the ' +
    'only channel a rule can use is the one quiet hours do not apply to.')
    .toBeGreaterThan(0);
});

// ── FINDING 4 ───────────────────────────────────────────────────────────────

test('16.03c the recipient picker offers every token the engine can resolve', async ({ page }) => {
  await signIn(page);
  await gotoNiyam(page);
  await page.getByRole('button', { name: 'New rule', exact: true }).click();
  const ed = editor(page);
  await expect(ed).toBeVisible({ timeout: 20_000 });
  await ed.getByRole('button', { name: 'Add then' }).click();
  const act = stepList(page).last().locator('.niyam-action');
  await act.locator('select.inp').first().selectOption('notify.send');

  const tokens = await act.locator('select.inp').nth(1).locator('option')
    .evaluateAll((os) => os.map((o: any) => o.value));
  console.log(`\n  recipient tokens offered: ${tokens.join(', ')}`);
  ledgerWrite({ recipientTokens: tokens });
  expect(tokens,
      'the recipient picker does not offer `@org_admins`. `services/niyam/actions.py` ' +
      'defines it in `DB_TOKENS` and states exactly why it exists: "the org-shaped ' +
      'temporal events (a product ran low, a day\'s attendance summarised) have no ' +
      'creator and no assignees — there is nobody IN the payload to tell, and the honest ' +
      'recipient is whoever runs the org." A live rule in another org uses it today. The ' +
      'picker offers `@creator` and `@assignees` only, so on every event type whose ' +
      'payload carries neither, a rule can be built, armed and fired and will record ' +
    '"nobody to notify on this event" for ever. 16.13 walks five live instances.')
    .toContain('@org_admins');
});

// ════════════════════════════════════════════════════════════════════════════
// 16.04 — FOURTEEN RULES, ONE PER TRIGGER FAMILY, TYPED
// ════════════════════════════════════════════════════════════════════════════

test('16.04 fourteen rules across seven trigger families are built through the editor, every one born off and unarmed',
  async ({ page }) => {
    await signIn(page);

    const before = await rulesByName(page);
    let typed = 0, found = 0;
    const ids: Record<string, string> = {};

    let rebuilt = 0;
    for (const r of RULES) {
      const name = ruleName(r);
      const existing = before.get(name);
      if (existing) {
        // ⚠ §6 IS "RECOGNISE ITS OWN OUTPUT", NOT "ACCEPT WHATEVER IS THERE".
        // A rule left over from an earlier execution whose CONDITION has since
        // changed is not this suite's output — it is a stale rule wearing the
        // right name, and accepting it would make every downstream assertion a
        // statement about a rule nobody wrote. So the stored steps are compared
        // to the spec, and a mismatch is removed through the product's own
        // Delete control and rebuilt. This is also the only place the suite
        // drives Delete, which is a real control with a real consequence: the
        // API's own docstring calls the loss of run history "a real loss".
        const d = await apiJson(page, `/api/v1/niyam/rules/${existing.rule_id}`);
        const cond = (d.steps || []).find((s: any) => s.kind === 'condition');
        const matches = r.cond
          ? cond && cond.config.field === r.cond.field
              && cond.config.operator === r.cond.operator
              && String(cond.config.value) === String(r.cond.value)
          : !cond;
        if (matches) { ids[name] = String(existing.rule_id); found++; continue; }

        console.log(`  ${name}: stored condition ` +
          `${JSON.stringify(cond?.config)} does not match the spec ` +
          `${JSON.stringify(r.cond)} — deleting and rebuilding`);
        await gotoNiyam(page);
        const card = ruleCard(page, name);
        await expect(card, `no rule card named "${name}"`).toBeVisible({ timeout: 30_000 });
        const del = card.getByRole('button', { name: 'Delete', exact: true });
        await expect(del, `the "${name}" card offers no Delete control`).toBeVisible();
        // Confirm-in-place: the SECOND press is the consent.
        await del.click();
        await expect(card.getByRole('button', { name: 'Really delete?' }),
          'the Delete control did not ask for confirmation before destroying a rule and ' +
          'its run history').toBeVisible({ timeout: 10_000 });
        await saveAndWait(page, /\/v1\/niyam\/rules\/[^/]+$/,
          () => card.getByRole('button', { name: 'Really delete?' }).click(),
          `deleting the stale ${name}`, ['DELETE']);
        ids[name] = await buildRule(page, r);
        rebuilt++;
        continue;
      }
      ids[name] = await buildRule(page, r);
      typed++;
    }
    if (rebuilt) console.log(`  16.04 — ${rebuilt} rule(s) rebuilt after a spec change`);
    console.log(`\n  16.04 rules — typed ${typed}, already present ${found} (§6 idempotence)\n`);
    ledgerWrite({ ruleIds: ids, rulesTyped: typed, rulesFound: found });

    // ── THE CANONICAL ROW, per rule. Never the list, never a toast. ────────
    for (const r of RULES) {
      const name = ruleName(r);
      const d = await apiJson(page, `/api/v1/niyam/rules/${ids[name]}`);
      expect(String(d.rule.name), 'the stored name does not match').toBe(name);
      expect(String(d.rule.event_type),
        `${name} was stored against the wrong trigger`).toBe(r.event);
      expect(String(d.family || d.rule.family),
        `${name} is filed under the wrong family`).toBe(r.family);
      const steps: any[] = d.steps || [];
      const wantSteps = (r.cond ? 1 : 0) + 1;
      expect(steps.length, `${name} stored ${steps.length} steps, expected ${wantSteps}`)
        .toBe(wantSteps);
      const action = steps.find((s: any) => s.kind === 'action');
      expect(action, `${name} has no action step, and validate.py refuses a rule ` +
        'that would do nothing — so this row should not exist').toBeTruthy();
      expect(action.config.verb).toBe('notify.send');
      expect(action.config.to).toEqual([r.to]);
      // ⚠ The channel nobody can change. Asserted so a future channel control
      // makes this test go red and its author has to think about the fence.
      expect(action.config.channel,
        `${name} stored channel ${JSON.stringify(action.config.channel)}. Every rule this ` +
        'suite arms MUST be in-app: an in-app notification is a `notifications` row and ' +
        'writes nothing to `outbound_log`, so nothing armed here can leave the building. ' +
        'If a channel control has landed, re-read the fence in 16.01 before changing this.')
        .toBe('inapp');
      if (r.cond) {
        const cond = steps.find((s: any) => s.kind === 'condition');
        expect(cond.config.field).toBe(r.cond.field);
        expect(cond.config.operator).toBe(r.cond.operator);
      }
    }

    // §4: fourteen rules, one per trigger family.
    const after = await rulesByName(page);
    const ours = RULES.filter((r) => after.has(ruleName(r)));
    expect(ours.length, `§4 asks for 14 automation rules and ${ours.length} exist`).toBe(14);
    const fams = [...new Set(RULES.map((r) => r.family))].sort();
    console.log(`  families covered: ${fams.length} — ${fams.join(', ')}`);
    console.log(`  families NOT covered: ` +
      ENGINE_FAMILIES.filter((f) => !fams.includes(f)).join(', ') +
      ' (approval and analytics are temporal-only; payroll is Suite 08\'s act; ' +
      'whatsapp is excluded by 93 §13)');
  });

// ════════════════════════════════════════════════════════════════════════════
// 16.05 — A BROKEN RULE IS UNWRITABLE, AND THE REFUSAL SAYS WHERE
// ════════════════════════════════════════════════════════════════════════════

test('16.05 the editor refuses a rule that would do nothing, a rule that ends on a wait, and arming a rule that has never run',
  async ({ page }) => {
    await signIn(page);
    await gotoNiyam(page);

    // ── a rule with no action ──────────────────────────────────────────────
    await page.getByRole('button', { name: 'New rule', exact: true }).click();
    const ed = editor(page);
    await expect(ed).toBeVisible({ timeout: 20_000 });
    await ed.locator('input.inp[placeholder*="When a task is finished"]')
      .fill(`${TAG} refusal probe ${RUN}`);
    await ed.locator('select.inp').first().selectOption('task.created');
    await ed.getByRole('button', { name: 'Add only if' }).click();
    // ⚠ THE CONDITION MUST BE COMPLETE, OR THIS TEST PROVES THE WRONG THING.
    // The blank step defaults to the event's first field — `status` — with an
    // empty value, so an unfilled card is refused with "'Status' needs a value
    // to compare against", which is a 422 for a completely different reason.
    // The first draft of this test asserted `422` and passed on that message
    // twice, so NEITHER refusal it claimed to exercise was ever exercised.
    const c = stepList(page).last().locator('.niyam-cond');
    await c.locator('select.inp').nth(0).selectOption('title');
    await c.locator('select.inp').nth(1).selectOption('contains');
    await c.locator('input.inp').first().fill(TAG);
    let w = await writes(page, /\/v1\/niyam\/rules$/,
      () => ed.getByRole('button', { name: 'Save', exact: true }).click(),
      { what: 'saving a rule with a condition and no action' });
    expect(w.status,
      'a rule with no action saved. `validate.py` refuses it by name — "This rule would ' +
      'do nothing — add an action" — because migration 103 exists precisely because the ' +
      'old builder saved rules whose actions could never run and the page had to render ' +
      '"This rule does nothing" against them.').toBe(422);
    // The MESSAGE, not just the status: a 422 for the wrong reason is a green
    // test over an unexercised path, and this test already made that mistake.
    expect(String(w.body?.detail?.error || w.text),
      'the refusal was a 422 for some other reason, so "a rule with no action is ' +
      'unwritable" was never exercised').toMatch(/would do nothing|add an action/i);
    await expect(ed.locator('.niyam-error'),
      'the 422 was answered and the editor showed no error text. The API answers ' +
      '{error, step_no, field} so the message can be shown against the card that caused ' +
      'it; an author who sees nothing has no way to fix the rule.')
      .toBeVisible({ timeout: 15_000 });
    console.log(`\n  refusal 1: ${(await ed.locator('.niyam-error').first().innerText()).trim()}`);

    // ── a rule that ends on a wait ─────────────────────────────────────────
    await ed.getByRole('button', { name: 'Add then' }).click();
    const act = stepList(page).last().locator('.niyam-action');
    await act.locator('select.inp').nth(0).selectOption('notify.send');
    const boxes = act.locator('input.inp');
    await boxes.nth(0).fill(`${TAG} probe`);
    await boxes.nth(1).fill('probe');
    await ed.getByRole('button', { name: 'Add wait' }).click();
    w = await writes(page, /\/v1\/niyam\/rules$/,
      () => ed.getByRole('button', { name: 'Save', exact: true }).click(),
      { what: 'saving a rule that ends on a wait' });
    expect(w.status,
      'a rule ending on a wait saved. It is a rule that goes to sleep and wakes up to do ' +
      'nothing; `validate.py` refuses it.').toBe(422);
    expect(String(w.body?.detail?.error || w.text),
      'the refusal was a 422 for some other reason, so "a rule cannot end on a wait" was ' +
      'never exercised').toMatch(/cannot end on a wait|nothing would happen/i);
    console.log(`  refusal 2: ${(await ed.locator('.niyam-error').first().innerText()).trim()}`);
    await ed.getByRole('button', { name: 'Close', exact: true }).click();

    // ── arming a rule that has never run ───────────────────────────────────
    //
    // ⚠ ORDER MATTERS: this must run BEFORE 16.07 drains the outbox, or the
    // rules will already carry runs and the refusal cannot be provoked. It is
    // in 16.05 for exactly that reason.
    const ids = ledgerRead().ruleIds || {};
    const name = ruleName(RULES[0]);
    const id = ids[name];
    expect(id, `${name} has no id in the ledger — 16.04 owns it`).toBeTruthy();
    const runsNow = await ruleRuns(page, id);
    if (runsNow.length === 0) {
      const card = ruleCard(page, name);
      await expect(card, `no rule card named "${name}"`).toBeVisible({ timeout: 30_000 });
      const res = await writes(page, /\/v1\/niyam\/rules\/[^/]+$/,
        () => switchArmed(card).click(),
        { methods: ['PATCH'], what: 'arming a rule that has never run' });
      expect(res.status,
        'a rule with zero runs armed. The entire safety story of this design is "see it ' +
        'happen before you trust it", and `patch_rule` refuses arming until a rule has ' +
        'recorded a dry run.').toBe(422);
      const msg = String(res.body?.detail?.error || res.text);
      expect(msg, 'the refusal did not explain itself').toMatch(/never run/i);
      console.log(`  refusal 3: ${msg}`);
      // And the toast carries it to the person, rather than a bare "Failed".
      await expect(page.getByText(/never run/i).first(),
        'the refusal reached the wire and nothing on screen said so')
        .toBeVisible({ timeout: 15_000 });
    } else {
      console.log(`  refusal 3 not provokable — ${name} already carries ` +
        `${runsNow.length} run(s) from an earlier execution (§6). The arming gate is ` +
        'exercised on run 1 only, and that is a property of the gate, not a gap.');
    }
  });

// ════════════════════════════════════════════════════════════════════════════
// 16.06 — THE PREVIEW REPLAYS REAL EVENTS AND WRITES NOTHING
// ════════════════════════════════════════════════════════════════════════════

test('16.06 preview replays this org\'s real recorded events and leaves no run, no step and no notification behind',
  async ({ page }) => {
    await signIn(page);
    await gotoNiyam(page);
    const ids = ledgerRead().ruleIds || {};

    let replayed = 0;
    for (const r of RULES.slice(0, 6)) {
      const name = ruleName(r);
      const id = ids[name];
      expect(id, `${name} has no id — 16.04 owns it`).toBeTruthy();
      const runsBefore = (await ruleRuns(page, id)).length;

      const card = ruleCard(page, name);
      await expect(card, `no rule card named "${name}"`).toBeVisible({ timeout: 30_000 });
      const w = await saveAndWait(page, /\/v1\/niyam\/rules\/[^/]+\/preview$/,
        () => card.getByRole('button', { name: 'Preview', exact: true }).click(),
        `previewing ${name}`);
      const panel = page.locator('.niyam-panel');
      await expect(panel.getByRole('heading', { name: /What this rule would have done/i }),
        'the preview panel did not open').toBeVisible({ timeout: 20_000 });
      const verdict = (await panel.locator('.niyam-verdict').innerText()).trim();
      console.log(`  ${name}: considered ${w.body.considered}, matched ${w.body.matched} — ` +
        `"${verdict}"`);
      replayed += Number(w.body.considered || 0);

      // The panel draws what a match WOULD trigger — the server sent it all
      // along and the panel once did not draw it, so "matched" answered half
      // the question.
      if ((w.body.would_do || []).length) {
        await expect(panel.getByText(/On a match this rule would/i),
          'the preview says how many matched and never says what it would DO')
          .toBeVisible({ timeout: 10_000 });
      }

      const runsAfter = (await ruleRuns(page, id)).length;
      expect(runsAfter,
        `previewing ${name} created ${runsAfter - runsBefore} run row(s). The preview must ` +
        'write nothing: no run rows, no run steps, no notifications and no `processed_at`. ' +
        'It also must not consume the backlog the engine is about to drain.')
        .toBe(runsBefore);
      await panel.getByRole('button', { name: 'Close', exact: true }).click();
    }
    expect(replayed,
      'the preview considered zero events across six rules. Unicode Group held 747 ' +
      'unprocessed events across 23 event types when this suite was written, so a total ' +
      'of zero means the preview is reading the wrong org or the wrong table.')
      .toBeGreaterThan(0);
  });

// ════════════════════════════════════════════════════════════════════════════
// 16.07 — TURNED ON, AND THE ENGINE'S CLOCK ADVANCED FOR THE FIRST TIME IN DAYS
// ════════════════════════════════════════════════════════════════════════════

test('16.07 all fourteen are switched on and the engine drains a real backlog, giving each rule the dry runs arming requires',
  async ({ page }) => {
    await signIn(page);
    const ids = ledgerRead().ruleIds || {};

    let switched = 0, already = 0;
    for (const r of RULES) {
      const name = ruleName(r);
      const res = await flip(page, name, 'on', true);
      if (res) switched++; else already++;
    }
    console.log(`\n  16.07 enabled — switched on ${switched}, already on ${already}`);

    // Every one, read off the canonical row rather than the switch.
    const live = await rulesByName(page);
    for (const r of RULES) {
      const row = live.get(ruleName(r));
      expect(row?.enabled, `${ruleName(r)} did not come back enabled`).toBe(true);
      expect(row?.is_armed, `${ruleName(r)} is armed and 16.08 has not run yet`).toBe(false);
      // An enabled, unarmed rule reports `dry` — the engine's master switch and
      // the rule's own switch are two gates and the card must say which is shut.
      expect(String(row?.effective_mode),
        `${ruleName(r)} reports effective_mode=${row?.effective_mode} while unarmed`)
        .toBe('dry');
    }

    // ── the clock ──────────────────────────────────────────────────────────
    const before = await engineStatus(page);
    console.log(`  before the sweep: ${before.events_unprocessed} unprocessed of ` +
      `${before.events_total}, last tick ${before.last_tick_at}`);
    const ticks = await drainOutbox(page);
    const after = await engineStatus(page);
    console.log(`  ${ticks.length} tick(s): ` +
      ticks.map((t) => `drained ${t.events_drained ?? '-'} / started ${t.runs_started ?? '-'}` +
        (t.skipped ? ' (skipped: a tick was already running)' : '')).join(' · '));
    console.log(`  after: ${after.events_unprocessed} unprocessed, ` +
      `${after.runs_last_24h} runs in 24h, ${after.runs_stranded} stranded`);
    ledgerWrite({
      drain: {
        unprocessedBefore: before.events_unprocessed,
        unprocessedAfter: after.events_unprocessed,
        ticks: ticks.length,
        runsStarted: ticks.reduce((s, t) => s + Number(t.runs_started || 0), 0),
      },
    });

    // A 200 proves the tick RAN. The count falling is what proves it WORKED —
    // that distinction is the whole lesson of 331 reminders recorded `sent`
    // over 331 suppressed rows.
    expect(Number(after.events_unprocessed),
      `the outbox did not shrink: ${before.events_unprocessed} unprocessed before, ` +
      `${after.events_unprocessed} after ${ticks.length} tick(s). The engine answered 200 ` +
      'every time, which only says a tick completed.')
      .toBeLessThan(Number(before.events_unprocessed) + 1);

    expect(Number(after.runs_stranded || 0),
      `${after.runs_stranded} runs are stranded — finished_at NULL and wake_at NULL, which ` +
      'no path can reach. A non-zero that does not fall is a process dying mid-pipeline ' +
      'every tick.').toBe(0);

    // ── every rule now has the evidence arming requires ────────────────────
    const runsPer: Record<string, number> = {};
    for (const r of RULES) {
      const name = ruleName(r);
      runsPer[name] = (await ruleRuns(page, ids[name])).length;
    }
    console.log(`  runs per rule: ` +
      Object.entries(runsPer).map(([n, c]) => `${n.slice(0, 6)}=${c}`).join(' '));
    ledgerWrite({ runsAfterDrain: runsPer });

    const barren = RULES.filter((r) => runsPer[ruleName(r)] === 0).map(ruleName);
    expect(barren,
      `${barren.length} of 14 rules recorded no run at all after the outbox was drained: ` +
      `${barren.join(', ')}. Every one of these event types has real rows on Unicode Group ` +
      'typed by earlier suites, so a rule with zero runs means the drain did not fan out ' +
      'to it — and `patch_rule` will refuse to arm it, which makes §4\'s "armed 14" ' +
      'unreachable. ⚠ Read this against the per-type counts in 16.01 before calling it a ' +
      'product bug: an event type with no Unicode rows can legitimately show 0.')
      .toEqual([]);
  });

// ════════════════════════════════════════════════════════════════════════════
// 16.08 — ARMED
// ════════════════════════════════════════════════════════════════════════════

test('16.08 all fourteen are armed through the switch, and each reports itself live rather than dry',
  async ({ page }) => {
    await signIn(page);

    let armed = 0, already = 0;
    for (const r of RULES) {
      const res = await flip(page, ruleName(r), 'armed', true);
      if (res) armed++; else already++;
    }
    console.log(`\n  16.08 armed — switched ${armed}, already armed ${already}`);
    ledgerWrite({ armed: armed + already, armedAt: new Date().toISOString() });

    const live = await rulesByName(page);
    for (const r of RULES) {
      const row = live.get(ruleName(r));
      expect(row?.is_armed, `${ruleName(r)} did not come back armed`).toBe(true);
      // Two switches and a third that can veto both. A UI showing only
      // `is_armed` tells somebody their rule is live when the engine is off.
      expect(String(row?.effective_mode),
        `${ruleName(r)} is enabled and armed and still reports ` +
        `effective_mode=${row?.effective_mode}. That means NIYAM_ARMED is off, so nothing ` +
        'below will act and §4\'s "fired 14" cannot be delivered.')
        .toBe('live');
    }

    // The card says so, in the same place the toggle is.
    await gotoNiyam(page);
    const card = ruleCard(page, ruleName(RULES[0]));
    await expect(switchArmed(card), 'the armed switch does not report itself checked')
      .toHaveAttribute('aria-checked', 'true');
    await expect(card.locator('.niyam-veto'),
      'the card shows the engine-veto note while the engine is armed').toHaveCount(0);

    // §4's stats strip, from the page's own figures.
    const strip = await page.locator('.niyam-strip').innerText().catch(() => '');
    console.log(`  stats strip: ${strip.replace(/\s+/g, ' ').trim()}`);
  });

// ════════════════════════════════════════════════════════════════════════════
// 16.09 – 16.12 — TRIGGERED FROM ITS OWN MODULE
// ════════════════════════════════════════════════════════════════════════════
//
// Nine events, driven through the module that owns them, then the clock is
// advanced and each rule's OWN history is read. A rule that fires because you
// called its endpoint proves the endpoint; a rule that fires because a deal
// moved proves the product.

/** Runs started after `since`, from the rule's own history endpoint. */
async function runsSince(page: Page, ruleId: string, since: string): Promise<any[]> {
  const runs = await ruleRuns(page, ruleId);
  return runs.filter((r: any) => String(r.started_at) > since);
}

async function assertFired(page: Page, r: RuleSpec, since: string) {
  const ids = ledgerRead().ruleIds || {};
  const id = ids[ruleName(r)];
  const fresh = await runsSince(page, id, since);
  expect(fresh.length,
    `${ruleName(r)} recorded no run at all after its module was driven. The event is ` +
    'written by the business transaction itself — `emit_event` takes the write\'s own ' +
    'CONNECTION, inside a savepoint — so no run means either the emitter did not fire or ' +
    'the drain did not fan out to this rule.')
    .toBeGreaterThan(0);

  const live = fresh.filter((x: any) => x.dry_run === false);
  expect(live.length,
    `${ruleName(r)} recorded ${fresh.length} fresh run(s) and every one is a DRY run. The ` +
    'rule is armed and the engine reports `live`, so a dry run means `rule_effective_mode` ' +
    'disagreed with the card at the moment the event was drained.')
    .toBeGreaterThan(0);

  const steps = live.flatMap((x: any) => x.steps || []);
  expect(steps.length, `${ruleName(r)} fired and recorded no steps. A run must carry the ` +
    'values that were compared — that is the answer to "why did my rule not fire".')
    .toBeGreaterThan(0);

  const action = steps.filter((s: any) => s.detail?.verb === 'notify.send');
  expect(action.length, `${ruleName(r)} fired and never reached its action step. Steps: ` +
    JSON.stringify(steps)).toBeGreaterThan(0);

  const outcomes = [...new Set(action.map((s: any) => String(s.outcome)))];
  console.log(`  ${ruleName(r)} → ${live.length} live run(s), action outcome(s) ` +
    `${outcomes.join('/')}: ${action.map((s: any) => s.detail?.reason).join(' | ')}`);

  if (r.carriesRecipient) {
    // The event's payload can answer the token the picker offers, so the action
    // must have reached somebody.
    expect(outcomes,
      `${ruleName(r)} fired on an event whose payload carries \`created_by\`, its rule ` +
      `names \`${r.to}\`, and the action outcome was ${outcomes.join('/')} rather than ` +
      '`ok`. Detail: ' + JSON.stringify(action.map((s: any) => s.detail)))
      .toContain('ok');
  } else {
    // FINDING 4, walked. Recorded here and asserted in 16.13, so a single
    // rule's refusal does not fail this test twice.
    console.log(`    ⚠ ${r.event} carries neither \`created_by\` nor ` +
      '`assignee_user_ids`, so both tokens the picker offers resolve to nobody — ' +
      'see 16.13');
  }
  return { fresh: fresh.length, live: live.length, steps: steps.length, outcomes };
}

test('16.09 a task created and a task re-statused in Core PM each fire their own rule', async ({ page }) => {
  await signIn(page);
  const since = new Date(Date.now() - 5_000).toISOString();

  const teamId = await triggerTaskCreated(page);
  await triggerTaskStatusChanged(page, teamId);
  ledgerWrite({ s16TeamId: teamId });

  await drainOutbox(page, 4);

  const a = await assertFired(page, RULES[0], since);   // task.created
  const b = await assertFired(page, RULES[1], since);   // task.status_changed
  ledgerWrite({ fired: { ...(ledgerRead().fired || {}), 'task.created': a, 'task.status_changed': b } });
});

test('16.10 a client, a contact, a deal and a stage move in Graha each fire their own rule', async ({ page }) => {
  await signIn(page);
  const since = new Date(Date.now() - 5_000).toISOString();

  await triggerClientCreated(page);
  await triggerContactCreated(page);
  const dealId = await triggerDealCreated(page);
  await triggerDealStageChanged(page, dealId);

  await drainOutbox(page, 4);

  const out: Record<string, any> = {};
  out['client.created'] = await assertFired(page, RULES[2], since);
  out['contact.created'] = await assertFired(page, RULES[3], since);
  out['deal.created'] = await assertFired(page, RULES[4], since);
  out['deal.stage_changed'] = await assertFired(page, RULES[5], since);
  ledgerWrite({ fired: { ...(ledgerRead().fired || {}), ...out } });
});

test('16.11 a receipt in Ganit and a stock adjustment in Vikray each fire their own rule', async ({ page }) => {
  await signIn(page);
  const since = new Date(Date.now() - 5_000).toISOString();

  await triggerPaymentRecorded(page);
  const product = await triggerStockAdjusted(page);
  console.log(`  stock adjusted on: ${product}`);

  await drainOutbox(page, 4);

  const out: Record<string, any> = {};
  out['payment.recorded'] = await assertFired(page, RULES[7], since);
  out['stock.adjusted'] = await assertFired(page, RULES[9], since);
  ledgerWrite({ fired: { ...(ledgerRead().fired || {}), ...out } });
});

test('16.12 a leave request in Manav fires its own rule', async ({ page }) => {
  await signIn(page);
  const ids = ledgerRead().ruleIds || {};
  const rule = RULES[10];
  const id = ids[ruleName(rule)];
  expect(id, `${ruleName(rule)} has no id — 16.04 owns it`).toBeTruthy();

  // ⚠ THE RULE WARMS ITSELF, AND THAT IS NOT A WORKAROUND.
  //
  // `patch_rule` refuses to arm a rule that has never run — "there is nothing
  // to judge it by" — which is the whole safety story of this design. 16.07
  // normally supplies that evidence by draining the backlog, but a rule
  // REBUILT in 16.04 (because its condition changed) is younger than the
  // backlog and there is nothing left for it to evaluate. Rather than weaken
  // the gate, the test does what a person would: cause one event, let it run
  // dry, and only then arm. 16.15 does the same for its wait probe.
  if ((await ruleRuns(page, id)).length === 0) {
    console.log(`\n  ${ruleName(rule)} has never run — typing one request to give the ` +
      'arming gate something to judge, exactly as a person would');
    await triggerLeaveRequested(page);
    await drainOutbox(page, 3);
    await flip(page, ruleName(rule), 'on', true);
    await drainOutbox(page, 2);
  }
  await flip(page, ruleName(rule), 'on', true);
  await flip(page, ruleName(rule), 'armed', true);

  const since = new Date(Date.now() - 5_000).toISOString();
  await triggerLeaveRequested(page);
  await drainOutbox(page, 4);

  const out: Record<string, any> = {};
  out['leave.requested'] = await assertFired(page, rule, since);
  ledgerWrite({ fired: { ...(ledgerRead().fired || {}), ...out } });
});

// ════════════════════════════════════════════════════════════════════════════
// 16.13 — THE RECIPIENT GAP, WALKED
// ════════════════════════════════════════════════════════════════════════════

test('16.13 every rule that fired reached somebody, or the report names the event types on which nobody can be named',
  async ({ page }) => {
    await signIn(page);
    const fired = ledgerRead().fired || {};
    expect(Object.keys(fired).length,
      'no rule recorded a fire — 16.09 through 16.12 own the triggers').toBeGreaterThan(0);

    const stranded = Object.entries(fired)
      .filter(([, v]: any) => (v.outcomes || []).includes('refused'))
      .map(([k]) => k);
    console.log(`\n  fired: ${Object.keys(fired).join(', ')}`);
    console.log(`  reached nobody: ${stranded.join(', ') || '(none)'}`);
    ledgerWrite({ strandedEvents: stranded });

    expect(stranded,
      `${stranded.length} rule(s) fired correctly, evaluated correctly, reached their ` +
      `action step and notified NOBODY: ${stranded.join(', ')}. The cause is one missing ` +
      'option. `services/niyam/registry.py` gives these event types no `created_by` and ' +
      'no `assignee_user_ids`, and `NiyamPage.ActionCard` offers exactly two recipients — ' +
      '`@creator` and `@assignees` — so both resolve to nobody and `NotifySend.run` ' +
      'records "nobody to notify on this event". The engine already has the answer: ' +
      '`DB_TOKENS = {"@org_admins"}`, whose own comment says it exists because "the ' +
      'org-shaped temporal events … have no creator and no assignees". A live rule in ' +
      'another org uses it today. Adding it to the picker is a one-line change and would ' +
      'make every one of these rules useful; without it a customer can build, arm and ' +
      'fire a rule that can never reach a person.')
      .toEqual([]);
  });

// ════════════════════════════════════════════════════════════════════════════
// 16.14 — QUIET HOURS
// ════════════════════════════════════════════════════════════════════════════

test('16.14 a rule that fires inside quiet hours defers and then delivers', async ({ page }) => {
  await signIn(page);

  // ── the window, set through the product's own screen ────────────────────
  //
  // ⚠ IST, NOT THIS MACHINE'S CLOCK. `push_service._in_quiet_hours` evaluates
  // in IST on the SERVER, and the screen says so in its own words: "Evaluated
  // in IST on the server, which is where delivery is decided — not on this
  // device." A window computed in local time would be right in Kolkata and
  // wrong everywhere else, and the test would pass or fail by geography.
  //
  // The window runs from an hour before now to three hours after, so NOW is
  // comfortably inside it whatever the run takes, and both ends land on
  // DateInput's 30-minute grid.
  const nowIst = new Date(Date.now() + 5.5 * 3600_000);
  const from = gridTime(new Date(nowIst.getTime() - 90 * 60_000));
  const to = gridTime(new Date(nowIst.getTime() + 3 * 60 * 60_000));

  const prefsBefore = await apiJson(page, '/api/me/notification_prefs');
  // Captured BEFORE anything changes, and restored in 16.17. This is a live
  // preference row on a real account, so the reversal is written down before
  // the change is made rather than afterwards to justify it.
  if (!ledgerRead().quietBefore) {
    ledgerWrite({ quietBefore: { start: prefsBefore.quiet_start, end: prefsBefore.quiet_end } });
  }
  console.log(`\n  quiet hours were ${prefsBefore.quiet_start}–${prefsBefore.quiet_end}; ` +
    `setting ${from}–${to} (IST) so NOW (${gridTime(nowIst)} IST) is inside the window`);

  await setQuietWindow(page, from, to);

  // ── the fire, inside the window ────────────────────────────────────────
  //
  // ⚠ AND HERE IS WHERE §10's SCENARIO STOPS BEING DRIVABLE.
  //
  // `send.INTERRUPTING = {"push", "email"}`. In-app is deliberately absent and
  // the comment says why: an in-app notification is a row in a list with no
  // queue behind it, so suppressing it at 2am destroys the message rather than
  // postponing it — a real shipped bug, fixed in `71c377a4`.
  //
  // And `NiyamPage`'s action card has NO CHANNEL CONTROL (16.03), so `inapp` is
  // the only channel any rule in this product can ever use. Therefore no
  // authorable rule can reach the quiet-hours gate at all, and "defer then
  // deliver" has no path through the product.
  //
  // What IS drivable, and what this test asserts, is the half that must be
  // true: inside a real quiet window, an armed in-app rule STILL DELIVERS.
  const since = new Date(Date.now() - 5_000).toISOString();
  const teamId = String(ledgerRead().s16TeamId || '');
  expect(teamId, 'no S16 project id in the ledger — 16.09 owns it').toBeTruthy();
  await triggerTaskStatusChanged(page, teamId);
  await drainOutbox(page, 4);

  const ids = ledgerRead().ruleIds || {};
  const fresh = await runsSince(page, ids[ruleName(RULES[1])], since);
  const live = fresh.filter((x: any) => x.dry_run === false);
  const steps = live.flatMap((x: any) => x.steps || [])
    .filter((s: any) => s.detail?.verb === 'notify.send');
  console.log(`  inside the window: ${live.length} live run(s), ` +
    `outcomes ${steps.map((s: any) => `${s.outcome}:${s.detail?.reason}`).join(' | ')}`);

  expect(steps.map((s: any) => String(s.outcome)),
    'an armed in-app rule was refused inside quiet hours. That is the bug `71c377a4` ' +
    'fixed: quiet hours suppress the DEVICE, never the record, and an in-app row has no ' +
    'queue behind it, so refusing it does not postpone the message — it loses it.')
    .toContain('ok');

  // ── ⚠ AND THE HALF §10 ASKS FOR, WHICH DOES NOT EXIST ──────────────────
  //
  // Asserted as a property of the runs, not of the source: a run that deferred
  // would carry `wake_at` and would be finished LATER by `resume_waits`. None
  // does, because nothing in `send.py` returns anything but `ok`, `refused` or
  // `failed`, and `engine.run_pipeline` calls `_finish` on a refusal — which
  // sets `finished_at` and NULLs `wake_at`. There is no third state.
  const deferred = live.filter((x: any) => x.wake_at);
  expect(deferred.length,
    'no run deferred, and none can. §10 asks that "one fired in quiet hours must defer ' +
    'then deliver" and this engine has no deferral for a suppressed send at all: ' +
    '`send.deliver` returns Delivery("refused", "it is quiet hours…"), `NotifySend.run` ' +
    'turns that into ActionResult("refused"), and `run_pipeline` records the step and ' +
    'calls `_finish`, which stamps `finished_at` and NULLs `wake_at`. Nothing re-queues ' +
    'it and no later sweep retries it — the message is gone. `wake_at` exists only for an ' +
    'explicit `wait` STEP (16.15 proves that one works) and `events_deferred` in the tick ' +
    'report is a per-tick BUDGET counter, not a clock. TWO independent walls therefore ' +
    'stand between this product and §10\'s scenario: no channel control (16.03) means no ' +
    'rule can reach the quiet-hours gate, and no deferral means nothing would be held if ' +
    'one did. Both are findings; neither is a skip.')
    .toBeGreaterThan(0);
});

// ════════════════════════════════════════════════════════════════════════════
// 16.15 — THE DEFERRAL THAT DOES EXIST
// ════════════════════════════════════════════════════════════════════════════

test('16.15 a wait step puts a run to sleep and a later sweep wakes it and runs the step after it',
  async ({ page }) => {
    await signIn(page);
    await gotoNiyam(page);

    // A throwaway rule with condition → wait → action, on the event this suite
    // can fire on demand. The wait is one minute: `validate.py` caps a wait at
    // 30 days and refuses zero, and a minute is the smallest thing a person can
    // type that a test can wait out.
    const name = `${TAG}-W1 wait probe`;
    let id = (await rulesByName(page)).get(name)?.rule_id;

    if (!id) {
      await page.getByRole('button', { name: 'New rule', exact: true }).click();
      const ed = editor(page);
      await expect(ed).toBeVisible({ timeout: 20_000 });
      await ed.locator('input.inp[placeholder*="When a task is finished"]').fill(name);
      await ed.locator('select.inp').first().selectOption('task.status_changed');

      await ed.getByRole('button', { name: 'Add only if' }).click();
      const cond = stepList(page).last().locator('.niyam-cond');
      await cond.locator('select.inp').nth(0).selectOption('title');
      await cond.locator('select.inp').nth(1).selectOption('contains');
      await cond.locator('input.inp').first().fill(TAG);

      await ed.getByRole('button', { name: 'Add wait' }).click();
      const waitInput = stepList(page).last().locator('input.inp').first();
      await waitInput.selectText();
      await waitInput.type('1');

      await ed.getByRole('button', { name: 'Add then' }).click();
      const act = stepList(page).last().locator('.niyam-action');
      await act.locator('select.inp').nth(0).selectOption('notify.send');
      await act.locator('select.inp').nth(1).selectOption('@creator');
      const boxes = act.locator('input.inp');
      await boxes.nth(0).fill(`${TAG} after the wait`);
      await boxes.nth(1).fill('The step after a wait has never executed in this product.');

      const w = await saveAndWait(page, /\/v1\/niyam\/rules$/,
        () => ed.getByRole('button', { name: 'Save', exact: true }).click(),
        `saving ${name}`);
      id = String(w.body.rule_id);
    }
    ledgerWrite({ waitRuleId: id, waitRuleName: name });

    await flip(page, name, 'on', true);
    // The arming gate needs a run first, so fire once dry.
    const teamId = String(ledgerRead().s16TeamId || '');
    expect(teamId, 'no S16 project id in the ledger — 16.09 owns it').toBeTruthy();
    await triggerTaskStatusChanged(page, teamId);
    await drainOutbox(page, 3);
    await flip(page, name, 'armed', true);

    const since = new Date(Date.now() - 5_000).toISOString();
    await triggerTaskStatusChanged(page, teamId);
    await drainOutbox(page, 3);

    // ── asleep ─────────────────────────────────────────────────────────────
    let fresh = await runsSince(page, id!, since);
    const asleep = fresh.filter((r: any) => r.wake_at && !r.finished_at);
    console.log(`\n  after the first sweep: ${fresh.length} fresh run(s), ` +
      `${asleep.length} asleep with a wake_at`);
    expect(asleep.length,
      'a rule carrying a `wait` step produced no sleeping run. `run_pipeline` sets ' +
      '`wake_at = NOW() + minutes` and writes the wait\'s own step row in ONE statement ' +
      '(a CTE), so the two facts cannot disagree — a run that reached the wait and did ' +
      'not sleep means that write did not land.')
      .toBeGreaterThan(0);

    // The history panel says so, in the product's own words.
    await gotoNiyam(page);
    const card = ruleCard(page, name);
    await saveAndWait(page, /\/v1\/niyam\/rules\/[^/]+\/runs/,
      () => card.getByRole('button', { name: 'History', exact: true }).click(),
      'opening the history', ['GET']).catch(async () => {
        await card.getByRole('button', { name: 'History', exact: true }).click();
      });
    await expect(page.locator('.niyam-panel').getByText('waiting').first(),
      'a run is asleep and the History panel does not say so. The panel draws a "waiting" ' +
      'badge from `run.wake_at`; without it a sleeping run is indistinguishable from a ' +
      'finished one.').toBeVisible({ timeout: 20_000 });

    // ── awake, and the step AFTER the wait executes ────────────────────────
    //
    // ⚠ THIS IS THE ASSERTION THAT MATTERS. Until `1e032f7f`'s sibling fix, NO
    // STEP AFTER A WAIT HAD EVER EXECUTED IN THIS PRODUCT: the wait wrote no
    // step row, so `cursor_for` sent the resumed run back into the same wait,
    // which set `wake_at` again and returned "waiting" — for ever, once per
    // wake. It went unseen because the only armed rule had no wait, and because
    // a run stuck that way looks healthy.
    await page.waitForTimeout(70_000);
    await drainOutbox(page, 3);

    fresh = await runsSince(page, id!, since);
    const finished = fresh.filter((r: any) => r.finished_at && !r.wake_at);
    const afterWait = finished.flatMap((r: any) => r.steps || [])
      .filter((s: any) => s.detail?.verb === 'notify.send');
    console.log(`  after the wait elapsed: ${finished.length} finished run(s), ` +
      `${afterWait.length} action step(s) — ` +
      afterWait.map((s: any) => `${s.outcome}:${s.detail?.reason}`).join(' | '));

    expect(finished.length,
      'the wait elapsed and no run finished. `resume_waits` claims runs with ' +
      '`wake_at <= NOW() AND finished_at IS NULL` and clears `wake_at` in the SAME ' +
      'statement, then re-enters `run_pipeline`, which skips completed steps via ' +
      '`cursor_for`.').toBeGreaterThan(0);
    expect(afterWait.length,
      'a run woke from its wait and never executed the step after it. That is the exact ' +
      'shape of the defect the wait\'s own CTE was written to close: with no step row for ' +
      'the wait, `cursor_for` walks the resumed run back into the same wait for ever, and ' +
      'the run looks healthy the whole time — not stranded, not failed, and its `wake_at` ' +
      'always plausibly in the future.').toBeGreaterThan(0);
  });

// ════════════════════════════════════════════════════════════════════════════
// 16.16 — THE GATE ON AUTHORING, AND THE TENANT BOUNDARY
// ════════════════════════════════════════════════════════════════════════════

test('16.16 authoring is an org-admin act and one org\'s rules are invisible to another', async ({ page }) => {
  await signIn(page);

  // ── the nav gates it ───────────────────────────────────────────────────
  //
  // `navConfig.js` marks the Automations entry `orgAdminOnly: true`. This lane
  // IS an org admin, so what can be asserted from here is that the entry is
  // present and reachable; the negative half needs a non-admin Unicode session
  // and this suite has no second Unicode credential — stated rather than
  // implied. ⚠ AND THE ROUTE ITSELF IS NOT GATED: `App.jsx:293` mounts
  // `<Route path="settings/automations" element={<NiyamPage/>}/>` with no role
  // wrapper, so a non-admin who types the URL reaches the page and meets an
  // `ErrorState` from a 403 rather than a sentence about permission. That is
  // recorded here and is not asserted, because asserting it needs the account
  // this lane does not have.
  await gotoNiyam(page);
  await expect(page.getByRole('link', { name: /Automation analytics, in Dristi/i }),
    'the Dristi analytics door is missing from the automations page. `NiyamPage` says the ' +
    'three module doors "are one affordance and must read as one", and this one carries ' +
    'the whole of Niyam\'s analytics — the page gets no analytics tab of its own by ' +
    'owner decision, so a missing door means there is no route to the numbers at all.')
    .toBeVisible({ timeout: 20_000 });

  // ── the tenant boundary, read-only ─────────────────────────────────────
  //
  // Every list in `niyam_rules.py` is org-scoped in SQL rather than filtered in
  // Python, and `_load` scopes the single-rule read too. A rule names people to
  // notify; a leak here is a leak of who works where. Proved by asking for one
  // of THIS org's rules with a credential that belongs to a different org —
  // a GET, so nothing is written.
  const other = process.env.E2E_UK_OWNER_TOKEN;
  const ids = ledgerRead().ruleIds || {};
  const id = ids[ruleName(RULES[0])];
  expect(id, 'no rule id in the ledger — 16.04 owns it').toBeTruthy();

  if (!other) {
    throw new Error(
      'BLOCKED — E2E_UK_OWNER_TOKEN is not set, so the cross-tenant read cannot be ' +
      'attempted. That is the one check on this screen that a single credential cannot ' +
      'make, and it is a FAILURE rather than a skip: `niyam_rules.py` puts `org_id = $1` ' +
      'in every WHERE clause precisely because a rule names people.');
  }
  const res = await page.request.get(`${API}/api/v1/niyam/rules/${id}`, {
    headers: { Authorization: `Bearer ${other}` },
  });
  expect([403, 404],
    `a credential belonging to another organisation read ${LANE.org}'s rule ${id} and the ` +
    `server answered ${res.status()}. Every read in niyam_rules.py carries ` +
    '`org_id = $1::uuid` in SQL for exactly this reason — a rule names who to notify.')
    .toContain(res.status());
  console.log(`\n  cross-tenant read of a ${LANE.org} rule with another org's token → ` +
    `${res.status()}`);
});

// ════════════════════════════════════════════════════════════════════════════
// 16.17 — DISARMED, AND EVERYTHING PUT BACK
// ════════════════════════════════════════════════════════════════════════════
//
// ⚠ THE MOST IMPORTANT TEST IN THIS FILE. A rule left armed keeps acting after
// this session ends, on events nobody here caused.

test('16.17 every rule this suite armed is disarmed and switched off, and the protected set is intact',
  async ({ page }) => {
    await signIn(page);

    const led = ledgerRead();
    const names = [...RULES.map(ruleName), led.waitRuleName].filter(Boolean) as string[];

    for (const name of names) {
      const card = ruleCard(page, name);
      if (!(await card.count())) {
        await gotoNiyam(page);
        if (!(await card.count())) continue;   // never created — 16.04 reports it
      }
      await flip(page, name, 'armed', false);
      await flip(page, name, 'on', false);
    }

    // ── read it back off the canonical row, per rule ───────────────────────
    const live = await rulesByName(page);
    const stillArmed: string[] = [];
    const stillOn: string[] = [];
    for (const name of names) {
      const row = live.get(name);
      if (!row) continue;
      if (row.is_armed) stillArmed.push(name);
      if (row.enabled) stillOn.push(name);
    }
    console.log(`\n  16.17 disarm — ${names.length} rules, ` +
      `${stillArmed.length} still armed, ${stillOn.length} still enabled`);
    expect(stillArmed,
      `these rules are STILL ARMED after the suite finished: ${stillArmed.join(', ')}. An ` +
      'armed rule keeps acting on events nobody in this session caused, and the engine ' +
      'runs with NIYAM_ARMED=true, OUTBOUND_MODE=live and nothing suppressed.')
      .toEqual([]);
    expect(stillOn,
      `these rules are still enabled: ${stillOn.join(', ')}. An enabled unarmed rule is ` +
      'harmless — it records what it would do and does nothing — but the suite leaves the ' +
      'org as it found it.')
      .toEqual([]);

    // ── the armed population outside this lane has not moved ───────────────
    const st = await engineStatus(page);
    const localArmed = [...live.values()].filter((r: any) => r.enabled && r.is_armed).length;
    const elsewhereAfter = Number(st.rules_armed || 0) - localArmed;
    console.log(`  armed elsewhere: ${led.elsewhereArmedBefore} before, ` +
      `${elsewhereAfter} after`);
    expect(elsewhereAfter,
      `the number of armed rules outside ${LANE.org} changed from ` +
      `${led.elsewhereArmedBefore} to ${elsewhereAfter} across this run. All six of them ` +
      'are in Aekam Inc, which §12 guarantees untouched, and one of them mails customers.')
      .toBe(led.elsewhereArmedBefore);

    // ── the protected set ──────────────────────────────────────────────────
    const tasks = await apiJson(page, '/api/tasks?limit=500');
    const rows: any[] = tasks?.data || tasks?.tasks || (Array.isArray(tasks) ? tasks : []);
    const protectedTasks = rows.filter((t: any) => String(t.team_id) === 'team_ae1d58543b21');
    console.log(`  protected set: ${protectedTasks.length} tasks on team_ae1d58543b21 ` +
      `(${led.protectedTasksBefore} before)`);
    expect(protectedTasks.length,
      `the protected Aekam Inc team held ${led.protectedTasksBefore} tasks before this ` +
      `suite and holds ${protectedTasks.length} now. §12 pins it at 20 and nothing here ` +
      'may act inside it — 16.09 explicitly refuses to create a task there, and every ' +
      'armed rule\'s action is a notification rather than a write.')
      .toBe(led.protectedTasksBefore);

    // ── quiet hours put back, through the same control that changed them ───
    //
    // 16.14 moves a live preference row on a real account. The reversal was
    // written into the ledger before the change was made; this is where it runs
    // — and it is READ BACK, because a restore nobody verified is a claim.
    const qb = led.quietBefore;
    if (qb?.start && qb?.end) {
      const now = await apiJson(page, '/api/me/notification_prefs');
      const cur = { start: String(now.quiet_start).slice(0, 5), end: String(now.quiet_end).slice(0, 5) };
      const want = { start: String(qb.start).slice(0, 5), end: String(qb.end).slice(0, 5) };
      if (cur.start !== want.start || cur.end !== want.end) {
        await setQuietWindow(page, want.start, want.end);
      }
      const back = await apiJson(page, '/api/me/notification_prefs');
      console.log(`  quiet hours: were ${want.start}–${want.end}, are now ` +
        `${String(back.quiet_start).slice(0, 5)}–${String(back.quiet_end).slice(0, 5)}`);
      expect(String(back.quiet_start).slice(0, 5),
        'the quiet-hours window this suite moved was not put back').toBe(want.start);
      expect(String(back.quiet_end).slice(0, 5),
        'the quiet-hours window this suite moved was not put back').toBe(want.end);
    }

    // ── the ledger, for the report ─────────────────────────────────────────
    console.log(`\n  ── §4 VOLUMES, AS LIVE COUNTS ──────────────────────────────`);
    console.log(`  automation rules created : ${RULES.length}` +
      `  (typed ${led.rulesTyped ?? '?'}, already present ${led.rulesFound ?? '?'})`);
    console.log(`  armed                    : ${led.armed ?? '?'}`);
    console.log(`  fired from their module  : ${Object.keys(led.fired || {}).length}` +
      ` of ${RULES.filter((r) => r.trigger).length} attempted`);
    console.log(`  runs recorded            : ` +
      Object.values(led.runsAfterDrain || {}).reduce((a: any, b: any) => a + b, 0));
    console.log(`  reached nobody           : ${(led.strandedEvents || []).join(', ') || '—'}`);
    console.log(`  outbox                   : ${led.drain?.unprocessedBefore} → ` +
      `${led.drain?.unprocessedAfter} over ${led.drain?.ticks} tick(s)`);
  });
