# Kartavya Proposals 00–90 — The Final Verdict

*Written 2026-08-25. This is the map across all 90+ design/status proposals. The step-by-step execution plan lives in `docs/plans/PHASE-0..6`; proposal 90 holds the deep 50–88 claim audit. This document does not re-litigate that detail.*

---

## 1. THE ARC

Across ninety-odd proposals the product moved through three distinct eras. **The repair era (00–29, 5–6 Aug 2026)** was not about building — it was about discovering that things sold as working did not: a cross-org task leak that let 7 of 10 platform accounts read every org's data (06/20), a Ganit "Overdue: 0" tile counting a status nothing writes while 199 invoices sat past due (21), Prachar marketing mail with no unsubscribe link (23), 32MB of base64 video stuffed into Postgres (22), and eighteen orphan teams from an un-guarded double-submit (13). This era also settled the surface language: the Srijan→Sahayak rename, the Sanvaad message-shape system (09), and the palette fight that ran from indigo mockups (11/14) to the final cream + liquid glass decision (15, later 88). **The module era (50–83)** built outward — Niyam automation, the analytics suite through S6, the Pulse board, the reports catalogue, commission, procurement, compliance and legal docs — most of it landing as real routers and tables. **The "built but no data" era (84–90, current)** is the reckoning: the machinery exists but 48 tables hold zero rows, 16 feature columns have no write path, four models were built twice, and live blockers (payroll pays leavers, two billing endpoints 500, drafts counted as revenue, a cross-tenant billing leak) mean the product is wired far ahead of where it is actually load-bearing.

---

## 2. THE 00–49 LEDGER

| # | Title | Status | Still relevant? |
|---|-------|--------|-----------------|
| 00 | Where we are | RESEARCH | Dated snapshot only; superseded by 07 then session_state memory |
| 01 | Org lifecycle, four screens | SHIPPED | Nothing material; `admin_orgs.py`, `org_billing_lines`, top-up live |
| 02 | Org control & AI marketplace | SHIPPED | Only cosmetic: demo-screenshot/setup-fee prefill (`org_modules.py`, `hub_skill_requests`) |
| 03 | Billing lines | SHIPPED | Core live (migration 097); extended by 86/87 |
| 04 | Email, simply | **PARTIAL** | **Shared-inbox "replies inside Kartavaya" (`graha_inbound_emails`: matching/unread/assignment) never built** |
| 05 | Two kinds of user | **PARTIAL** | **Employee↔account link (0 of 98 linked) + distinct Pahchan seat counter — gates email-optional payslips** |
| 06 | What god mode can see | SHIPPED | Leak closed (`org_resolver.py`, commit 489a415a); tenancy backfill of ~48 child tables is the residual |
| 07 | Two days, what is left | RESEARCH | Historical; housekeeping tail (orphan memberships, `.easignore`) minor |
| 08 | Where the AI money goes | RESEARCH | **RAG index still empty on 2026-08-25 — KB never worked, grounded on nothing** |
| 09 | Sanvaad messaging design | SHIPPED | Live (`Message.jsx`, `sanvaad.css`); note Sanvaad→Samvada rename |
| 10 | Srijan chat, why it reads cheap | SHIPPED | Streaming (SSE, item 6) still open — nothing streams |
| 11 | Kartavaya exact replica (indigo) | SUPERSEDED | Palette rejected for cream+glass; bubbles it mocked did ship |
| 12 | The full plan (5 Aug) | PARTIAL | Chat memory/distillation (19), full audit_log across 9 modules (17), streaming least-closed |
| 13 | The team sweep | SHIPPED | 18 rows in `team_members_removed_backup`, verified; create-team idempotency guard still absent |
| 14 | Whole product, indigo (b) | **ABANDONED** (correctly) | Marketplace richness shipped; indigo re-skin dropped for cream |
| 15 | Light palette, six grounds | RESEARCH | Settled on cream (#F3EFE6); nothing open |
| 16 | Sahayak welcome options | SUPERSEDED | Folded into 19; scoped-RBAC line (E) dropped by design |
| 17 | Sahayak four chat layouts | SUPERSEDED | Folded into 19; verify Verdict.jsx gets real structured sections |
| 18 | Sahayak bilingual welcome | SUPERSEDED | **3-line `hub_chat.py` fix (lang hardcoded 'en') — verify or Hindi/Gujarati still reply in English** |
| 19 | Sahayak, the layout | SHIPPED | Live (`assistant/` dir); inline-[1] citations + streaming worth verifying (memory: citations render dead) |
| 20 | Cross-org leak map | RESEARCH | Six privilege bugs → Package A (29); verify each closed |
| 21 | What does not work | RESEARCH | Eight sold-broken; overdue tile fixed (`ganit.py`); spot-check the tail |
| 22 | What Kartavaya costs | RESEARCH | **Six oversized file rows still in Postgres (not migrated); staging-sleep to confirm** |
| 23 | What does not work, the rest | RESEARCH | Prachar unsubscribe fixed (`prachar_unsubscribe.py`); verify other 3 criticals |
| 24 | Unicode demo guide | RESEARCH | Point-in-time demo script; low relevance |
| 25 | The tail, re-checked | RESEARCH | **`recurring_invoice_generator` (foreign serial, allocator poisons filed GST serial) — file absent, verify rewrite** |
| 26 | The new design bundle | RESEARCH | Org switcher shipped (`OrgSwitcher.jsx`); nothing outstanding |
| 27 | The parity ledger | RESEARCH | DPDP attendance notice, Indian-finance table columns, Graha `.gr_` third table system |
| 28 | Unicode as full product | RESEARCH | **Likely ABANDONED — QA evicted from live orgs (opposite direction); "measure in elements, 50/module floor" principle stands** |
| 29 | How bundles resolve | RESEARCH | **Package A privilege bugs = highest-value open; table-system unification (gn-coll third system)** |

*Terse grouping:* **11/14** (indigo palette) — dead, resolved to cream. **15/16/17/18** — palette/Sahayak iterations, all folded into shipped 09/19. **00/07/24** — dated snapshots, historical only. **01/02/03/06/09/13/19/26** — SHIPPED, nothing material.

---

## 3. WHAT FROM 00–49 IS STILL GENUINELY OPEN

Strictly: only items not already captured in the 50–88 phased plan. Most old gaps are closed.

1. **The RAG / KB index is empty and always has been (08).** Zero KB citations ever; `hub_kb_documents`/`hub_kb_chunks` schema exists, no content, and the 0.3 similarity threshold discards any hit. Sahayak answers "grounded" on nothing. Not in the 50–88 scope — this is the single largest silent lie in the AI surface.

2. **Employee↔login link + separate Pahchan seat counter (05).** 0 of 98 employees linked to accounts; `manav_employees.user_id` is the missing join. This is the direct gate on email-optional payslips and on a correct Pahchan-vs-org seat count. (Note: it also underlies the live "payroll pays 10 leavers" blocker.)

3. **Shared-inbox "replies appear inside Kartavaya" (04).** `graha_inbound_emails` table exists but the matching / unread / assignment build — the CRM-first reply loop — was the explicit "later, a real build" and remains unbuilt.

4. **Sahayak streaming + the bilingual backend fix (10/18/19).** Nothing streams (SSE never wired); `hub_chat.py` passes literal `language='en'`, so Hindi/Gujarati questions risk English answers despite the router's Indic branch. Three-line fix, still worth verifying.

5. **Package A privilege bugs (20/29).** Six RBAC holes found by a *design* audit, not a security one: sensitive-module grants accepted, tier-3 client can edit tasks, `is_project_member` trusting `users.role`, forward-target any account. Same class as the closed cross-org header leak — verify each independently.

6. **Six oversized file rows still inside Postgres (22).** The R2-only decision closed the write paths but the six historical `tasks.attachments` rows (32MB) were never migrated out.

7. **`recurring_invoice_generator` correctness (25).** Foreign serial-number format and two allocators that can poison a GSTR-1-filed GST serial. The file is not in `backend/services/` now — verify it was rewritten before any cron points at it.

Everything else from 00–49 is SHIPPED, correctly ABANDONED (indigo palette 11/14; hand-fill-the-org 28), or a dated RESEARCH snapshot with no residual.

---

## 4. THE 00–90 FINAL VERDICT

**The honest single number: the machinery is roughly 90% built and roughly 55% load-bearing.** Almost every proposal produced real routers, tables and screens — but 48 tables hold zero rows, 16 feature columns have no write path, four models were built twice, and no router test executes its own SQL. The product demos far better than it runs. The repair era's structural lessons (measure in elements not modules; a mock pool hides bad SQL; built ≠ wired ≠ has-data) are exactly the diagnosis of the current state.

**Top 5 across all 90, ranked by what matters most:**

1. **Live money/data-integrity blockers (86/87 + 21/25).** Payroll pays 10 leavers; two billing endpoints 500 on a missing `gst_rate` column; draft invoices are dunned *and* counted as revenue; a cross-tenant leak in client_billing. These are shipping-wrong-numbers, not gaps. Fix first.

2. **The empty-data reckoning (08/28/80/83 + 90's structural findings).** RAG index empty, 48 zero-row tables, 16 NULL feature columns with no write path, `statute_calendar` read by skills but not by payroll. The product cannot tell the truth until data flows.

3. **The employee↔login join (05).** One missing foreign key gates payslips, Pahchan seats, and correct payroll. Small change, large blast radius.

4. **RBAC Package A privilege bugs (20/29).** The cross-org *header* leak is closed; the six privilege-logic holes were never security-verified. Same data-exposure class.

5. **Sahayak honesty (08/10/18/19).** Streaming, real bilingual language passing, and structured answer sections — so the assistant stops rendering dead citations and answering from an empty index.

---

## 5. POINTER

This document is the **map**. The **steps** are already written: `docs/plans/PHASE-0` through `PHASE-6`. Proposal 90 holds the verified 50–88 claim-by-claim audit; the 00–49 detail is the ledger in §2 above. Start with §4 item 1 (live money blockers) — those are in PHASE-0.
## 5. Note on proposals 30–49 (not deep-scanned this pass)

The classifier hit a session limit before the 30–39 and 40–49 groups ran, so
these are summarized from project memory and the commit record rather than a
fresh live scan. Treat as PROVISIONAL and re-scan before acting on any of them.

**30–39 — the mark, payments, WhatsApp send.**
- `30/31` The brand mark (full lotus with क, half-lotus K) — **SHIPPED** in code;
  the PNG assets were still the old mark last checked (`decision_brand_mark`).
- `32–37` Invoice payment QR · pay page · Ganit collections · WhatsApp send ·
  shared invoice page · final flow — the **payments programme P1–P8, COMPLETE**
  (`payments_link_programme`). No gateway ever; "paid" = bank reconciliation.
- `38/39` WhatsApp automation + plan — the webhook is the value; **Meta bills the
  org** (`whatsapp_cloud_api_p7`). `varta_business_accounts` = 0 rows, so the
  channel is untested pending owner credentials (Phase 0.26).

**40–49 — Vercel/infra, automation, glass, AI cost.**
- `40` Vercel Hobby licence — **SHIPPED/decided**; Cloudflare Pages cutover is
  code-done and inert, waiting on owner dashboard actions.
- `41–44` Automation architecture / review / catalogue / audit — **SUPERSEDED**
  by Niyam (proposals 55–59), which replaced the entire estate.
- `45/46` Sidebar glass · glass animations — **SHIPPED**, and the subject of
  proposals 88 (record) and 89 (rescope) plus this session's enrichment.
- `47` Reports download — **SHIPPED** (CSV/XLSX/PDF on org letterhead).
- `48/49` AI model costs · near-zero-cost assistant — **RESEARCH/decided**;
  production uses cheap pinned models, Claude is a dev tool not a runtime
  (`feedback_ai_models`, `gemini_models_pinned`).

Net: 30–49 is mostly SHIPPED or correctly SUPERSEDED. The one genuinely open
thread is the WhatsApp channel (owner credentials, Phase 0.26); the brand PNGs
are a cosmetic follow-up.

---

*Provenance: 00–29 classified live by the scan workflow; 50–88 from proposal 90's
802-claim audit (verified against Supabase 2026-08-25); 30–49 from memory pending
re-scan. Living status: `docs/STATUS.md`. Execution: `docs/plans/`.*
