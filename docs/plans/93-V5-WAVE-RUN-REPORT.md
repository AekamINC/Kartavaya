THE RUN WAS LARGELY RED: 116 of 280 executed tests failed (41%), and a further 51 tests never executed at all. But the redness is not evenly earned — roughly 17 failures are one Cloudflare CSP false red, ~41 are suites run out of dependency order, and ~20 are stale test code. Under that noise sit about two dozen genuine, customer-facing production defects, three of which are money or statute.

═══════════════════════════════════════════════════════════════
1. THE SCOREBOARD
═══════════════════════════════════════════════════════════════

PREFLIGHT — all three gates PASS. check-production-targets 12/12 ✓ (exit 0);
/api/health = production / public / outbound_mode=live / digest="0" / redis;
auth setup 3/3 passed (exit 0). Waves were correctly cleared to proceed.

Wave  Suite                       Pass  Fail  Skip  Never-ran  Exit
────  ──────────────────────────  ────  ────  ────  ─────────  ────
 1    00 coldstart-nav-audit         0     1     0      0        1
 1    01 auth                        4     0     0      0        0   ⚠ config
 1    02 org-settings               16     1     0      0        1   ⚠ config
 2    03 core-pm                    20     3     0      0        1   ⚠ config
 2    04 graha                       0     1     0     20       —    ⚠ HUNG
 3    05 ganit                      11    13     0      0        1
 3    06 kray                       10     2     0      0        1   ⚠ config
 4    07 manav                       7     1     0      8       —    ⚠ CAPPED
 4    08 vetana                      0    17     0      0        1   ⚠ config
 5    09 pahchan                     8*    8     0      0        1
 6    19 admin-modules               5     0     0      0        0
 6    17 client-billing             10     2     0      0        1
 6    14 sahayak                    12    12     0      0        1
 7    10 vikray                      8*    0     0     12       —    ⚠ CAPPED
 7    11 prachar                    12     1     0      0        1
 7    15 esign                       6     7     0      0        1
 7    16 niyam                       9    12     0      0        1
 8    18 portal                     11     3     0      0        1
 8    20 crosscutting                8     8     0      0        1
 8    22 dead-controls               2     0     0     11       —    ⚠ CAPPED
 9    12 dristi                      5     7     0      0        1
 9    13 sanvaad                     0    17     0      0        1
────  ──────────────────────────  ────  ────  ────  ─────────  ────
      TOTAL (22 suites)            164   116     0     51

  * S09 and S10 each include 3 auth-setup passes, not product tests.
    Product-test passes are therefore 158, not 164.
  "—" exit = no exit code was ever emitted: the suite was killed or hung
    before the reporter printed its summary. Never reported as 0.
  Zero tests were reported "skipped" by any reporter. The 51 in the
    never-ran column DID NOT RUN — see §4.

NOT RUN AT ALL (no dispatch, so no row above):
  Suite 19.3 support-session — admin.config.ts covers it; the briefed
    filename filter excluded it. Suite 19 coverage is PARTIAL.
  Suite 21 — no config exists (no suite21.config.ts); never dispatched.

═══════════════════════════════════════════════════════════════
2. EVERY FAILURE, BY VERDICT — PRODUCT BUGS FIRST
═══════════════════════════════════════════════════════════════

── PRODUCT BUGS (≈43 failing tests / ~24 distinct defects) ──

MONEY AND STATUTE — fix before customers transact
P1. GST IS CHARGED ON THE PRE-DISCOUNT VALUE. (S10, live query, not
    asserted by any test — it passed.) SO-2026-0007: subtotal 30000,
    discount 5000, tax 5400 = 18% of the GROSS. Correct is 4500.
    SO-2026-0014: tax 2175, correct 1925. s.15(3)(a) CGST Act excludes a
    discount recorded on the invoice from the transaction value. Excess
    output tax on two live rows: ₹900 and ₹250. Shape is the OPPOSITE of
    what the spec header predicted, so _compute_order_totals changed
    since it was written. No test covers this — add one.
P2. The receivables ageing report counts a DRAFT invoice (₹43,129) as a
    receivable. payment_ageing filters on payment_status only; dunning
    excludes drafts. One of the two is wrong. (S17 17.09, reported not
    failed.)
P3. POST /cron/billing (the auto_invoice sweep) passes no org_id and
    sweeps EVERY organisation at once. 0 invoices written so far, so it
    bites on the first tick that produces a row. (S17 17.11.)

TOTALLY BROKEN CUSTOMER PATHS
P4. "Download report" can never produce a file for any customer in any
    org. documents.py:828-834 looks the project up in public.boards;
    public.boards holds 0 rows across the ENTIRE database. A project in
    this product is public.teams. (S03 03.5 — verified independently of
    the spec's claim.)
P5. GET /v1/analytics/views answers 500 for EVERY module. analytics.py
    ::_presets_for (~567-584) subscripts w["metric"] unconditionally;
    three PRESETS widgets carry only "report" (founder[9], finance[8],
    sales_head[6]) → KeyError 'metric'. Replicated standalone against
    the real registry. Consequence chain: no views bar → no preset chip
    → the alert bell lives on a preset KPI widget → saved views and
    metric alerts are unreachable through the product. analytics_views
    and analytics_alerts each hold 0 ROWS ACROSS THE WHOLE DATABASE, for
    all time. Fails S12 12.01, 12.05, 12.07, 12.12 — four of seven.
P6. graha#analytics calls https://kartavaya-production.up.railway.app
    (the OLD hostname, missing the "a") from https://app.kartavaya.com
    and dies on CORS — no Access-Control-Allow-Origin — on every load of
    a customer-facing screen. Same class as commit 22b970c9; at least
    one call site was missed. (S20 20.02, S05 05.18.)
P7. TOAST DEADLOCK ON EVERY DRAWER ACTION. .k-toasts is correctly
    pointer-events:none but .tst is pointer-events:all
    (components.css:1257) with onMouseEnter→pause() (toast.jsx:314)
    clearing the 4s timer, at --z-toast 520, deliberately above the
    dialog at 420. The drawer's Restore/Archive/Delete/Approve/Reject
    icons sit in exactly that top-right corner. A user reaching for a
    second action pauses the toast under their own cursor and the
    control beneath is permanently unreachable. (S03 03.20.)
P8. Sanvaad's message composer is rate-limited: POST
    /messaging/channels/{id}/messages → 429 "Too many requests" while
    typing steadily. Root cause of 3 further S13 failures and of the
    126-vs-140 message shortfall. A chat composer that 429s a human
    needs an owner decision. (S13 13.03.)

CONTROLS THAT EXIST BUT CANNOT BE USED
P9.  An organisation can NEVER set its own brand profile. The only save
     control is BrandTab.jsx:41 → platform-role gated. The org-scoped
     PUT /v1/hub/org/brand works and has ZERO frontend callers. The KPI
     strip on the same page says "Not set — output will be generic until
     it is". (S14 14.17.)
P10. "Add credits" 403s for org users AND would top up the wrong pot if
     it worked: the form writes hub_credit_wallets (per-client) while
     every spend charges hub_org_credits (per-org). (S14 14.18.)
P11. "+ New client" draws a full seven-field form to a seat that always
     gets 403. (S14 14.12.) Same shape: the member spend ceiling can
     only be set from a row of "Who spent what", which is built from the
     credit ledger — a preventive control whose only door requires the
     thing it prevents to have already happened, so every new customer
     and every reseeded org can never set one. (S14 14.20.)
P12. Refusal toasts show customers the raw role list: "This action
     requires one of: platform_owner, platform_admin, platform_manager,
     account_manager, account_finance" — codes they cannot become and no
     action they can take. Three suites caught this.
P13. An expense attachment has no door: ExpensesTab.jsx renders no file
     input while ExpenseCreate.receipt_urls is API-writable. (S05 05.05.)
P14. The SLA-credit apply sheet is one free-text box wanting a vendor
     bill UUID, and no screen in the product ever shows one — the
     payables register shows the bill NUMBER. The route works; the door
     is missing. (S17 17.08.)
P15. NIYAM: the rule editor exposes less than the engine implements —
     five separate defects. 4 of 11 engine families have no filter chip
     (esign, marketing, payroll, whatsapp). 10 of 10 editor controls
     have no accessible name and 5 carry a dead label="" attribute that
     labels nothing. 3 action verbs are offered with no configuration
     fields at all. No channel control exists though send.py implements
     inapp/push/email — so NO customer rule can ever send email or push.
     @org_admins is in DB_TOKENS but not in the picker. Consequence
     (16.13): 5 rules fired, evaluated, reached their action and
     notified NOBODY. Separately and unasserted: the arming gate refuses
     a rule with no runs while only UNPROCESSED events fan out, so a
     rule on any event type the org does not currently emit can never be
     armed by a customer at all.
P16. Dristi's catalogue and /run disagree: the catalogue resolves
     entitlement by held_level and reports withheld_count 0, while /run
     also enforces module activation and 403s. The UI trusts the
     catalogue and AddWidget passes moduleFilter={null}, so 4 varta
     metrics are offered to a dashboard builder and can only ever error.
     (S12 12.03.)
P17. "Open pipeline" is not the open pipeline: dristi overview
     pipeline_value sums EVERY deal (27,410,000) against the funnel's
     22,210,000; and 12 deals on a Won/Lost stage still count as open
     because the write path never stamps lost_at. (S12 12.11.)

STANDING-RULE REGRESSIONS THE STATIC RATCHETS CANNOT SEE
P18. THREE UUIDs PAINTED ON SCREEN — graha#documents R2 folder labels
     "crm/19df5798-…/documents (1)" ×3. Violates names-not-IDs;
     check-rendered-ids.mjs is static and blind to it. (S20 20.03.)
P19. Five native <input type="month"> controls survive on ganit#stats,
     manav#performance, vetana#payroll, vetana#payslips,
     vetana#statutory. Field.jsx:61 forwards date/datetime-local/time to
     DateInput but NOT month. (S20 20.04.)
P20. Seven screens off the --row-h token (--row-h 50px at band V2):
     graha#documents 84px, manav#dsc 100px, manav#udin 114-138px,
     manav#notices 176-255px, vikray#products/#stock/#contacts ~56-60px.
     (S20 20.05.)
P21. Both shared drag handles are dead: .ktabs__grip (module tab order)
     and .kcols__grip (table column order) lift nothing by mouse OR by
     keyboard — a <button> is in @hello-pangea/dnd's interactiveTagNames,
     the same guard that killed every kanban card until 08-29 — and the
     grip's aria label promises "Space picks it up, arrows move it"
     which cannot happen. (S20 20.12b; marked FILED NOT FIXED.)
P22. Nine controls are covered by an overlay at their own centre point:
     button.k-dock__pill over graha>activities "Next page",
     graha>documents "Open", manav>logins "Columns"; th.tbl__th--rz over
     the column-resize handles on manav>dsc and manav>udin. Plus 11 DEAD
     control candidates (each confirmed by a second click) — three of
     which sit near the noise floor and want a look before filing.
     (S22 partial ledger; the census that publishes these never ran.)
P23. Three tabs (rate-cards, sla-credits, ageing) load SILENTLY — a bare
     <SkeletonList /> with no role="status"/aria-busy/aria-live, so a
     screen reader is told nothing and "loading" and "empty" are the same
     screen to anything automated. (S06 06.01 note.)
P24. Pahchan policy: "Overtime after" is the caption for BOTH the daily
     and the weekly threshold (PahchanPolicy.jsx:57,62), told apart only
     by the unit beside the box. Both land on a payslip. (S09 09.2.)

CROSS-TENANT SURFACE STILL LIVE (tolerated-and-pinned, not fixed)
P25. /api/client/projects' first leg carries no org predicate and ignores
     X-Org-Id. Only the absence of a row separates it from another
     tenant's project list — S18 18.05 proved one deliberate crossing
     (team_95beaa7529a9, Aekam Inc) and zero unexpected ids. Compared as
     ID SETS, correctly. Carry it forward; do not let the green read as
     closed.

THE ONE THAT IS PROBABLY NOT OURS (17 failing tests)
P26. Every production page load refuses an inline script. Three agents
     verified independently: the app's OWN bootstrap hash
     sha256-JtAu+6V2X/sONIJ0daMfltBe8H1N8hZ9kn7S9IFO4hk= MATCHES the
     pinned CSP and the app boots fine on all 31 routes. The refused
     script is Cloudflare's edge-injected challenge-platform loader,
     carrying per-request __CF$cv$params, so its sha256 changes on every
     load and no static hash can ever match it. Consequence: Cloudflare's
     JS bot-detection never runs, and a console error is logged on 100%
     of production page loads. NOT the documented CSP-hash-drift; a
     static hash is structurally incapable of fixing it. It fails
     S05 ×2, S06 ×1, S08 ×1, S13 ×11, S18 ×2 = 17 tests.

── TEST BUGS (≈20) ──
T1.  S18 18.01/18.03 and every CSP failure above: the repo ALREADY
     solved this — isForeignInlineScriptRefusal() at _helpers.ts:501,
     written 2026-08-30 because it was failing five suites as false
     reds. Six suites (03,04,05,06,07,08) were retrofitted. Suites 13
     and 18 were NOT and define their own unfiltered watchConsole().
T2.  S18 18.00 pins environment==='staging' AND schema==='staging' —
     both impossible since the 08-29 consolidation and the 08-30 move.
     Its lane/org/protected-set preflight therefore never ran.
T3.  S15 15.04/15.11 and S13 13.12/13.15 all die on the deployed
     OpenAPI: production serves 404 for /openapi.json and /docs by
     design (server.py:360-369, "None removes the route entirely").
     15.11's message "A control that calls one of these is a dead
     control" is FALSE and would badly mislead — the same run drove all
     14 of those routes to 200s and wrote the rows.
T4.  S06 06.07 asserts .toBe(1) while its own message says the revision
     "must not" spend an approval row. The product is right; four
     independent lines of evidence confirm 0 is correct. Fix is
     .toBe(0) at suite06-kray.spec.ts:2423.
T5.  S16 16.07 asserts a run on event types the org has NEVER emitted
     (invoice.created, payment.recorded, stock.adjusted = 0 rows ever),
     which cascades into 16.08's correct-by-design 422, then 16.09,
     16.10 and 16.14. 16.14 prints a quiet-hours accusation its own data
     does not support.
T6.  S16 16.11 posted a receipt against UNI-2026-0002 without checking
     doc_status; it is a draft and the backend correctly refused.
T7.  S12 12.10's 20-byte anti-vacuity floor is miscalibrated: the file
     is a valid single-scalar CSV ("value" / "1827.0", 15 bytes).
T8.  S05 05.14/05.15 crash with TypeError on contacts[(n-1)%0] instead
     of asserting cleanly.
T9.  S02 02.4's last line is an unscoped getByText matching all nine
     sender buckets → strict-mode violation. Its three substantive
     assertions had already passed and the write landed.
T10. S00's /hub/org failure is the THIRD recurrence of one class: .hb-err
     is also the correct skin for "Module 'sahayak' is not active" —
     the product telling the truth. Do NOT "fix" /hub/org.
T11. S00 anti-vacuity gap: 165 console errors were recorded and printed,
     and NEVER asserted. Had /hub/org been clean the suite would have
     reported GREEN over a CSP breach on 31/31 routes.
T12. S17 17.10 has an unstated precondition — 17.07 issues only the
     intra-state invoice, so one execution can never produce the 2
     pay-link candidates it demands.
T13. S09 09.10 dereferences mine.employee unguarded where 09.5 and 09.7
     guard the identical condition.
T14. S01 01.4 prints the hardcoded UNICODE_ORG_ID regardless of the
     resolved lane; the row went to E2E Test & Associates. A verifier
     following that log line looks in the wrong org.
T15. S01 01.3's in-file comment ("THIS FAILS ON STAGING TODAY AND IT IS
     A PRODUCT BUG, DO NOT LOOSEN IT") is stale — the split-bucket
     limiter did not reproduce; refusal came at exactly attempt 6.

── BLOCKED (≈49 failing + 51 never-run) ──
B1. ORDERING FAULT — Suite 08 was dispatched CONCURRENTLY with Suite 07,
    which creates the employees it reads. The readable employee count
    climbs 0→2→4→12 INSIDE the single run; all 28 manav_employees rows
    were written during it. 16 of 17 Vetana failures are that one fact.
    Payroll's entire known trap — leavers, PT by state and gender, "the
    re-run must MOVE the figure" — was NOT TESTED AT ALL.
B2. ORDERING FAULT — Suite 05 needs the 53 contacts Suite 04 leaves.
    Suite 04 hung at 04.02 and never reached contacts: graha_contacts =
    0 for the org, 4 in the whole database. 7 Ganit failures cascade,
    including all 45 invoices. Ganit's headline entity is 0 rows.
B3. ORDERING FAULT — Suite 14 requires Suite 19 to have topped up the
    wallet. It had not: hub_org_credits balance 0, transactions 0 rows.
    7 of 12 Sahayak failures are that single precondition.
B4. 0 OF 30 manav_employees CARRY A user_id (pahchan.py:491 resolves on
    user_id). 6 of 8 Pahchan failures. This is not only a lane problem:
    with real users at 09:00 IST, no employee in that org can clock in,
    record DPDP consent, or raise a correction.
B5. Suite 15's counterparty leg (5 tests) is doubly blocked: inbox()
    shells `railway run --service Kartavya` and the service is
    **Kartavaya**; and its embedded SQL reads staging.sign_signers /
    staging.sign_fields / staging.outbound_log — a schema dropped
    2026-08-29 (all three to_regclass NULL). One rename + three
    staging.→public. would unblock it.
B6. S20 20.06 (org-profile probe 502, transient — recovered by 20.07)
    and 20.11 (worker crash 0xC0000409, never executed). Loading states
    and the nine ?since= delta lists are UNTESTED, not passing.
B7. The 51 never-run tests — see §4.

── EXCLUDED BY DECISION ──
varta/WhatsApp absent from both orgs (93 §13) — asserted absent, do not
later misread as a provisioning defect. Prachar automations (501 stub)
and landing pages/forms/tracked links (not built). hub_publish_queue and
hub_social_accounts. org_owner and hr_admin seat tiers cannot be created
through ANY product control (update_member_role accepts only
org_admin/org_member), so 2 of 4 renderable tiers are unproven. Paid ads
not driven (owner's 08-27 decision).

── UNDETERMINED (9) ──
S05 05.17 TDS challan refused for a missing TAN — needs an OWNER RULING:
does "GSTIN/PAN/TAN block nothing" govern CAPTURE only, or also EMISSION
of a statutory counterfoil? s.203A says the PAN is no substitute on
ITNS-281. · S11 11.5 drag-to-reschedule issued NO PATCH at all; cannot
separate "synthetic drag never fired dragstart" from CampaignsTab.jsx:105's
same-day early return without opening the trace (path given in the report).
· S04 04.01 — failure block lost when the hung run was killed, and the
empty branch is no longer reproducible now the org has 25 clients. · S07
07.1 — capped before the reporter printed its block; a solo re-run with
--reporter=json settles it in ~45s. · S13 13.08 reaction re-add (fixed
2s settle, not a poll). · S19 19.2's console WRITE path passed vacuously
— all 12 modules were already active so zero POSTs fired and the
assertion loop ran zero times. · S20 20.10, S10 10.05, S06 06.05.

═══════════════════════════════════════════════════════════════
3. ROW EVIDENCE — ✅ vs 🟡
═══════════════════════════════════════════════════════════════

✅ ROWS APPEARED WHERE THERE WERE ZERO (baseline measured, not assumed):
  S04 graha        graha_clients 0 → 25   (04.01 asserted EMPTY minutes before)
  S06 kray         purchase_orders 12, po_lines 45, receipts 10,
                   revisions 4, approvals 6 — all five tables measured at
                   ZERO on 08-29. po_revisions holds its first rows ever.
  S07 manav        manav_employees 0 → 30. The table was GLOBALLY empty
                   across every org before this run. +6 depts, 24 leave
                   requests, 13 balances, 14 holidays, 150 schedules.
  S10 vikray       vikray_orders 0 → 35 (baseline measured 0), all marked.
  S11 prachar      campaigns 0→12, templates 0→12, send_evidence 0→144,
                   registrations 0→30, enrolments 0→24, unsubscribes 0→6.
  S12 dristi       dashboards 0→4 carrying 18 widgets, scheduled_reports
                   0→2, report_logs 0→2.
  S13 sanvaad      channels 0→10, messages 0→168, mentions 0→18, thread
                   replies 0→24, pins 0→1. FOUR of those tables had held
                   zero rows for the entire life of the product. Every one
                   of its 17 tests reported RED. Starkest split in the run.
  S15 esign        sign_documents 0→6, signers 0→10, audit_log 20,
                   11 outbound rows.
  S16 niyam        niyam_rules 0→15, niyam_runs 0→102.
  S17 billing      client_billing_profiles →6 (2 typed), +3 service lines,
                   +6 metered usage, +3 rate cards, +2 SLA credits.
  S14 sahayak      hub_chat_sessions 0→6 (only this; everything else 0).
  S09 pahchan      sites 0→4, policy 0→1, notice_ack 0→1.
  S01/S02          exactly 1 net-new invite row each; the rest are
                   ON CONFLICT DO UPDATE upserts verified in place.

🟡 GREEN (OR RUN) WITH NO NEW ROWS — do not score these as proof:
  S03 core-pm   20 PASSED and created ZERO rows. tasks 103 / 0 new,
                teams 9 / 0 new, comments 64 / 0 new; max(created_at) is
                2026-08-29. One time_entry is the only write it reached.
                An idempotent RE-VERIFICATION, not a first-rows pass.
  S19 admin     5/5 green, ZERO writes. The 24 module_subscriptions rows
                all carry activated_at 2026-08-28. ✅ as a capability,
                verification-only today. "Suite 19 green today" must NOT
                be recorded as "the console write path was proven today".
  S18 portal    Verify-only: 18.06 found its client row already present
                (written 2026-08-29) and typed nothing.
  S00, S20, S22 Read-only by design; nothing to count. (S00 note: merely
                loading a page fires POST /api/tasks/auto-archive, so the
                "safe to run" claim is true of the spec, not of the app.)

🔴 MAIN ENTITY AT ZERO — the suite's whole purpose unmet:
  S05 ganit     ganit_invoices 0 (baseline 0, target 45). Expenses 0,
                receipts 0, recurring 0, contracts 0.
  S08 vetana    vetana_salary_structures 0, payslips 0, loans 0.
  S09 pahchan   pahchan_punches 0 (target 240) — the code path never ran.
  S12 dristi    analytics_views 0, analytics_alerts 0 — and 0 in the
                WHOLE DATABASE, ever.
  S15 esign     sign_fields 0 while 24 fields were placed through the
                real stage and the test PASSED. The wave's trap is
                CONFIRMED by the live count, NOT by the test meant to
                confirm it (15.04 died on its first assertion).
  S13 sanvaad   attachments 0 (not built), read_receipts 0 (dead table).

⚠ TWO JUNK ROWS LEFT IN PRODUCTION THAT WILL CORRUPT THE RE-RUN:
  vetana_payroll_runs gained 2026-07 (emp=0, gross=0.00, 21:44:22) and
  2026-08 (emp=0, gross=0.00, 21:44:33) — the July run written NINE
  SECONDS before the org's first employee existed. Both months now read
  "already processed", which is exactly the precondition 08.5-08.7 and
  08.14 depend on. They need deleting BY NAME before Suite 08 re-runs.

⚠ 157 REAL EMAILS LEFT THE BUILDING (outbound live, suppression EMPTY):
  144 Prachar, 11 eSign, 2 Dristi. Every recipient fence held — 121 to
  simulator.amazonses.com, the rest to owner-controlled plus-tags, zero
  to @example.com and zero to the 53 seeded contacts. Expect ~34
  messages in the owner's own inbox.

═══════════════════════════════════════════════════════════════
4. WHAT DID NOT RUN, AND WHY
═══════════════════════════════════════════════════════════════

TIME-CAPPED / HUNG — 51 tests never executed:
  S04 graha    20 of 22. The worker went silent for 7m16s after 04.02
               (log mtime frozen, browser gone). Isolated re-runs of
               04.01 and 04.02 both passed in seconds, so this is the
               documented long-session Playwright hang. LOST: the
               lost_reason trap (04.11) was never exercised — the wave's
               named trap is UNVERIFIED in both directions.
  S07 manav     8 of 16. LOST: 07.8 (the leaver/custody register trap),
               07.10 (the 8 commission schemes Wave 4 declares as its
               precondition — still absent), 07.12 (employee↔login link,
               the exact gap that then blocked all of Suite 09), 07.14
               (the ratchet/contract test). Needs ~35-40 min.
  S10 vikray   12 of 20. LOST: 4 of the 6 failures the spec header
               predicts (10.08, 10.12, 10.16) live entirely in the
               un-run set. Needs 45-90 min of its own slot.
  S22 controls 11 of 13, and 6 of 7 shards. The census (22.90-22.94) —
               this suite's ENTIRE deliverable — never published, so
               there is NO published dead-control count for this run.
               comms alone took 9.8m for 153 clicks. Needs ~45 min.
  S13 (19m) and S20 (13.1m) ran over budget but COMPLETED.

THE BRIEFED COMMAND COLLECTED ZERO TESTS FOR SIX SUITES:
  S01, S02 → real.config.ts / wave1: no project's testMatch covers them
  S03      → wave2.config.ts declares only graha + manav
  S06      → wave3.config.ts declares only vetana/pahchan/ganit/corepm
  S07, S08 → wave4.config.ts declares only vikray + kray
  Each exited 1 with "Error: No tests found" before an agent re-ran it
  under the config that actually declares the spec. THE BRIEF'S FALLBACK
  CLAUSE IS A TAUTOLOGY ("if real.config.ts does not exist, use
  real.config.ts") and never fired. Every one of these six is a silent
  no-op for anyone who runs the runbook literally.

MISSING CONFIGS: no suite19.config.ts, no suite21.config.ts, no
  suite01-suite10 configs. Suite 21 was never dispatched.

BLOCKED, NOT COVERED — treat as UNTESTED, not passing:
  · Payroll's whole trap (leavers, PT by state+gender, re-run moves the
    figure) — 0 assertions reached.
  · Ganit's draft-invoice trap: 0 invoices → 0 drafts → the
    draft-cannot-be-paid guard never executed. Note the spec contains NO
    dunning assertion, NO draft-excluded-from-revenue assertion and the
    word "budget" appears zero times — that half is covered nowhere.
  · The geofence refusal case (09.8) aborted BEFORE setGeolocation
    (OUTSIDE) was ever called. Geofence flagging is unproven.
  · eSign's entire counterparty journey: signing link, OTP round trip,
    decline, signed-PDF bytes, audit certificate, volume sheet.
  · S20's loading-state and nine-delta-list checks (20.06, 20.11).
  · S12 12.12 never reached its protected-set re-verification.
  · "GSTIN blank must SAVE" is NOT covered by Suite 00 or Suite 01 (both
    contain zero GSTIN references); it was proved GREEN by S02 02.2/02.2b.
  · The Wave 8 cross-org trap has no counterpart in S20 or S22 (grepped:
    zero cross-org probes in either). Only S18 18.08/18.05 actually
    exercised it — and cleanly, by ID SETS.

MEASUREMENT CAVEATS worth carrying:
  · S12's download directory holds 36 files, exactly matching §4's "36
    exports" — but 11 are stale from 08-29 and only 25 came from this
    run. Counting that directory would have reported full coverage for a
    test that aborted at export #1.
  · S03's failure dump wrote a live Bearer JWT for the Unicode lane in
    plaintext into the log file and trace zip. Do not attach those logs
    to an issue.
  · _helpers.ts was edited at 23:10:51 while S14 was starting. Agents are
    editing shared helpers mid-wave.
  · S03's exit was nearly lost to the pipeline trap again (the shell
    returned 0 because echo ran last); only EXIT=$? caught the real 1.

═══════════════════════════════════════════════════════════════
5. THE THREE THINGS TO DO FIRST
═══════════════════════════════════════════════════════════════

1. Settle the GST discount treatment before anyone raises another
   invoice — two live sales orders already carry ₹1,150 of excess output
   tax because _compute_order_totals taxes the gross subtotal instead of
   the s.15(3)(a) net, and no test covers it.

2. Ship the three one-line production breakages on customer-facing
   screens: the w["metric"] KeyError that 500s GET /v1/analytics/views
   for every module, the analytics XHR still pointed at the dead
   kartavaya-production hostname, and the report route that reads
   public.boards when a project is public.teams.

3. Re-run Suites 04→05, 07→08→09 and 19→14 strictly in dependency order
   with the two zero-value payroll_runs deleted first, and retrofit
   isForeignInlineScriptRefusal() into Suites 13 and 18 — that removes
   ~58 of the 116 failures without touching a line of product code, and
   until it is done nobody can read this scoreboard.