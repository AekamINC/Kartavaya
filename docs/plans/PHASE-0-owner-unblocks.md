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
