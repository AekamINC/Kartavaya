# Phase 0 — Owner unblocks

**Runs alongside everything. None of it is engineering — it is facts, decisions
and credentials only the owner can supply, and several downstream phases are
throttled until pieces of it land.**

Start today. Counsel (item 0.10) has the longest lead time and gates the first CA
sale. Items 0.07 and 0.08 are ten-minute dashboard reads.

This mirrors and extends `docs/OWNER-ACTIONS.md` — that file stays the live
blocked list; this one groups the same asks by the phase they unblock.

## Legal — the nine facts that lift the draft banner (proposal 81)

The four legal pages ship behind a computed draft banner. These lift it:

- **0.01** CIN, exactly as on the MCA record
- **0.02** Registered office address
- **0.03** Jurisdiction city for DPA clause 12
- **0.04** Grievance Officer's name (DPDP s.13 requires a real person)
- **0.05** A monitored grievance mailbox
- **0.06** A monitored security mailbox (the page promises a 72-hour ack)
- **0.07** Railway deployment region — one dashboard read
- **0.08** Cloudflare R2 bucket location — one dashboard read
- **0.09** AWS SES sending region

## Legal — decisions (proposal 81)

- **0.10** Engage an Indian data-protection lawyer to review the DPA and privacy
  policy before the banner comes down. **Longest lead time — start now.**
- **0.11** Certificate order and spend: ISO 27001 (₹4–10 L yr 1) → SOC 2
  ($15–40 K/yr) → 27701 (+₹2–3 L). No cert exists today; the pages must not
  *claim* one.
- **0.12** Deploy the legal pages to production — `main` is ~1,652 commits behind
  staging, so today a prospect's counsel at kartavaya.com/privacy gets a 404.

## Product & commercial decisions

- **0.13** Billing anchor: 1st-of-month vs per-org anniversary (86). Code shipped
  the flexible option and defaults everyone to day 1.
- **0.14** Dunning severity at +14 days overdue: lockout / read-only / banner (86).
- **0.15** Module-settings scope: org-wide or per-user (86). **Blocks P4 and P5
  of billing.**
- **0.16** True-up frequency: monthly / quarterly / annual (86).
- **0.17** **Proration day-count: calendar / working-days / calendar-minus-Sundays.**
  All three ship today in three files. **Blocks Phase 3.** Decide before a fourth
  convention is written.
- **0.18** Prachar pricing: `add_on_modules` still carries prachar at ₹39/user/mo
  against proposal 74's "bundle at ₹0".
- **0.19** Kray budget strictness: Warn / Stop / Ignore (85). Gates Phase-1
  procurement budget work.
- **0.20** Vendor CRUD ownership: Ganit or Kray (85).
- **0.21** Dock telemetry: per-module counters vs the "stored nowhere" invariant
  (71) — they cannot both hold.
- **0.22** `tasks.client_id` — the one column that buys real client
  profitability; it is a behaviour change, price it as one (73).

## Data & credentials only the owner can supply

- **0.23** Employee↔login scope: 96 of 98 unlinked, most impossible (71 employees
  vs 7 logins in the largest org). Decide who actually needs a login.
- **0.24** Professional-tax slabs: 9 rows for ~20 PT states — a data-entry job.
  **Feeds Phase 2.2.**
- **0.25** State codes on 38 `manav_holidays` rows. **Feeds Phase 1.6.**
- **0.26** A Meta WhatsApp Business Account — `varta_business_accounts` = 0 rows,
  so the whole WhatsApp channel and the free-entry-point strategy are untested (74).
- **0.27** Meta's INR rate card, pulled from Business Manager, before any price
  reaches a customer (74).
- **0.28** A written ICAI ESB answer on the client/prospect line — two of six
  compliance rules are `basis=inferred` (74).
- **0.29** Cold-restart verification of APK 2.0.4 on a device (82 workstream M —
  code-complete, verification only).
- **0.30** Permission to drop three restore schemas: `qa_cleanup_20260822`,
  `owner_actions_20260823`, `punch_cleanup_20260823`.
- **0.31** Scraper repricing decision (proposals 51/52/53) — every actor is sold
  below cost; and whether to move the six free-source scrapers off Apify and
  stand up an India runner. All open owner decisions, none actioned.

## Immediate, before any production deploy (engineering will do these; owner
just needs to approve the wording)

- Correct the MFA paragraph on `SecurityPage.jsx:161-168` — TOTP shipped 23 Aug.
- Add the three undisclosed AI sub-processors (OpenRouter, HuggingFace, Groq) to
  `frontend/src/pages/legal/legalFacts.js` — DPDP s.8(2) exposure on the page
  written to unblock the sale.

---

## 0.01–0.12 — PARKED by the owner, 2026-08-26

The nine legal facts and the three legal decisions are **deliberately deferred**
and are not blocking anything. The consequence, stated so nobody treats it as a
defect: the four legal pages keep their computed draft banner, and **no amount
of engineering lifts it** — the banner is driven by the facts being absent, which
is the honest behaviour. They are not in production, so nothing is misrepresented
to anyone today.

Do not chase these. Do not "fill in" a plausible CIN, address or officer name to
make the banner go away; a fabricated fact on a legal page is worse than a
visible draft notice.

## DECISIONS — owner, 2026-08-26. These are settled; do not re-open them.

| # | Decision |
|---|---|
| **0.13** | **Flexible anchor, default 1.** Already how the code behaves; 4 live profiles use anchors 1 and 15. No change. |
| **0.14** | **Banner at +14 days, read-only at +30, never lockout.** Locking a firm out of its own accounting during a payment dispute loses the customer and the invoice; read-only still lets them file a return. |
| **0.15** | **Org-wide.** Compliance settings are organisational facts, not preferences — per-user would let two people in one firm hold contradictory positions. **Unblocks billing P4/P5.** |
| **0.16** | **Per-org, not one global cadence.** "It depends what service the org provides its client — it can be quarterly, yearly or monthly." So true-up frequency is a per-org setting with the same three options as `billing_cycle`, NOT a platform constant. |
| **0.17** | **Calendar-minus-Sundays, everywhere.** Payroll already computes it (`vetana.py:1588`; Aug 2026 = 26 days). Billing's `weekday() < 5` (`client_billing.py:1281`) says 21 for the same month and is the one to change — payroll has money flowing through it. **Unblocks Phase 3.** |
| **0.18** | **Prachar ₹0; delete the ₹39 row.** Pricing is BY MODULE. Any third-party connection cost — Meta, SES, a scraper — is borne by the organisation itself, not resold. |
| **0.19** | **Warn, configurable to Stop.** Same rule as GSTIN/PAN/TAN and professional tax: it must not block. A hard stop at month-end moves procurement outside the system. |
| **0.20** | **VENDORS LIVE IN GANIT *AND* KRAY.** ⚠ This overrides the "Kray owns it" recommendation. Not every org buys Kray, and vendors must still be reachable — so Ganit keeps a full vendor surface. **The real defect is that `ganit/PayablesTab.jsx` has a stripped 4-field form** that creates vendors carrying none of the six MSME/TDS columns. Point it at the same component Kray uses; do not fork the fields. |
| **0.21** | **Keep the "stored nowhere" invariant.** Counters are not worth quietly breaking a privacy promise. |
| **0.22** | **Add `tasks.client_id`.** `public.tasks` has no such column, which is exactly why client profitability reads 0%. It is a behaviour change — every task then wants a client — so ship it as a feature, not a silent migration. |
| **0.23** | **Create dummy logins and link 10–15 employees**, so the Playwright suites can exercise DIFFERENT ROLES end to end. Live today: 110 employees, 19 seats, **2 linked**. Most links are arithmetically impossible and that is fine — a login is a tool, not a record. |
| **0.24** | **Mechanism DONE, data NOT.** Migration 221 applied, the settings screen shipped (Vetana → Statutory → Professional tax), resolution falls back and never blocks. But the ladder still holds **3 states of ~20**. Add states as customers need them; the ₹0 fallback means an unseeded state blocks nothing. |
| **0.25** | **Standard holidays stay national.** A NULL `state_code` means everywhere, which is right for Republic Day and Diwali. Owner is open to importing per-state holidays from a government source if one can be found. |
| **0.26** | Owner will connect a Meta WhatsApp Business Account on Aekam Inc later. `varta_business_accounts` = 0 until then, so the whole free-entry-point strategy stays untested. |
| **0.27** | Owner asked whether we can obtain Meta's INR rate card. **We cannot** — it is behind their Business Manager login, and entering credentials is not something this seat does. Published India pricing can be researched as an estimate; the account card must come from the owner. |
| **0.28** | **CLOSED — out of scope.** "Kartavaya is just a platform; we do not manage how an org does its marketing." The ICAI client/prospect line is the ORGANISATION's professional-conduct risk, not the platform's. The two `basis=inferred` rules stay as guidance, and no written ESB answer is owed. |
| **0.29** | **A fresh APK is owed after ALL phases complete** — the owner has lost every previous build. `bash mobile/scripts/build-apk.sh release`; a debug APK carries no JS bundle and is useless off the build machine. |
| **0.30** | **DROP the three restore schemas.** `qa_cleanup_20260822` (11 tables, 1112 kB), `punch_cleanup_20260823` (2, 328 kB), `owner_actions_20260823` (6, 96 kB). **Unblocks Phase 6.** |
| **0.31** | **Reprice every scraper to cost + margin now; defer the India runner.** Selling below cost scales the loss with usage; the runner only pays off at volume that does not exist yet. |

## Progress

_Update as items land — tick here, flip the row in `docs/STATUS.md`, and append to `PROGRESS.md` with evidence. Nothing in this phase has landed yet._
