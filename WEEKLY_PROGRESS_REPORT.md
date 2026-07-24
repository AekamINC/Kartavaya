# Kartavaya — Weekly Progress Report

## Week of July 17–24, 2026

---

## Summary

116 commits landed on `staging` this week, all authored by Keval Shah, all AI-paired (107 commits credit Claude Opus 4.6, 9 credit Claude Sonnet 5 as co-author). The week had two halves: the first three days fixed a string of data-type and connection-pool bugs left over from the prior week's Odoo-feature push, and the last four days shipped a full per-org credit billing system, an in-house e-signature module, and a rebuilt 13-platform social publishing hub. Production (`main`) is still 13 commits behind — none of this has shipped to customers yet. Code review this week turned up two real bugs worth fixing before the credit system and Srijan publishing go live: a billing mismatch between what users are shown and what they're actually charged, and a WhatsApp publishing path that can't work as written.

---

## This Week at a Glance

![Commits per contributor](chart_contributors.png)

![Changes per module](chart_modules.png)

![Bug fixes vs features](chart_bugs_vs_features.png)

---

## Features & UI Changes

**Srijan (content & social publishing hub)** — Keval Shah
- Built the org-level Srijan page from scratch: skill browser, AI content generation, content grid, credit balance display
- Added quick-generate flows for Social Post, Email, Ad, Blog, WhatsApp, Proposal, and Festival Campaign content
- Rebuilt the publish tab end-to-end: 13 platforms, per-client enablement toggles
- Added platform-specific publish forms — character limits per platform, Twitter thread count, Email subject line, Google Ads type/URL, LinkedIn post type
- Merged the standalone Data Tools (scraper) page into Srijan as tabs and removed the old route
- Switched the AI image pipeline through four providers in one week (Flux Dev → Flux Pro → Ideogram → Gemini) before landing on Seedream for reliability
- Added reminder cron jobs: overdue invoices, CRM follow-ups, stale approvals, upcoming tasks — delivered by email and push

**Graha (CRM)** — Keval Shah
- Added a Client/Company entity (GSTIN, address, website) linked to contacts, deals, and invoices, with a Clients tab and detail page
- Built a lead-gen bridge from the scraper marketplace into CRM: a 15-source catalog (LinkedIn, Google/Meta ad libraries, SEO/SERP, Instagram/X, Amazon/Flipkart, MCA/GST, WhatsApp, email enrichment) imports and dedupes straight into leads
- Added delete for deals and a confirmation dialog before delete on all 11 CRM entity types
- Added full edit forms for Contacts and Deals

**Manav (HRMS)** — Keval Shah
- Added department edit/delete with a guard blocking deletion of departments that still have active employees
- Added employee dropdowns to Leave Request and Expense Claim so admins can file on an employee's behalf
- Added edit forms for Employees, Shifts, Job Openings, Assets (asset edit now includes purchase cost/date)
- Shipped a recruitment pipeline: Job Openings → Candidates → Screening → Interview → Offer → Hire

**Vetana (Payroll)** — Keval Shah
- Added payslip PDF generation, attached directly to the employee notification email
- Re-enabled "Revert to Draft" on approved payroll runs
- Added employee loan/salary-advance tracking: EMI auto-deducted from payroll, auto-closes at zero balance, write-off supported

**Ganit (Invoicing)** — Keval Shah
- Added invoice PDF generation via WeasyPrint: GST tax invoice and export/foreign-currency variants, Indian lakh/crore amount-in-words, company profile (logo/GSTIN/PAN/bank) pulled from Org Settings
- Added UPI payment deep-links on invoice detail with a copy button
- Shipped a Vendor Bills / Accounts Payable module: vendor CRUD, GST-inclusive line items, partial payments, overdue detection
- Added edit forms for Products, Expenses, Contracts

**Vikray (Sales)** — Keval Shah
- Added a product stock ledger: low-stock threshold, manual +1/-1 adjustment, automatic stock movement on order confirm/cancel
- Added edit forms for Orders and Sales Targets
- Linked Vikray customers through to their Graha CRM record

**Scrapers marketplace** — Keval Shah
- Launched the Apify-proxy scraper marketplace with 75% margin billing
- Moved scraper results out of Supabase JSONB into R2 storage to cut egress cost
- Added dynamic credit true-up: minimum credits held upfront, real cost reconciled after Apify returns actual spend, 45% margin applied

**E-signature** — Keval Shah
- Shipped an in-house e-signature system end to end: OTP-verified signing, 13 backend endpoints, document management and public signing pages on the frontend

**Admin / Billing / Credits** — Keval Shah
- Built a full credit system: per-plan default credits (free 200, pro 500, biz 1000, enterprise 2000), monthly reset, scraper-run enforcement, admin top-up controls
- Built the Admin Cost Dashboard from scratch: platform KPIs, cost by provider, top spenders, per-org drill-down, live reconciliation against OpenRouter/Apify/HuggingFace usage
- Added per-org monthly credits, monthly pricing, and configurable markup % to billing settings
- Changed client-facing billing to show credits only — dollar/rupee figures are now hidden from clients
- Redefined revenue as margin from usage markup instead of invoice payments received

**Org settings** — Keval Shah
- Org admins can now manage their own members without platform-admin involvement
- Added a company profile section (logo, GSTIN, PAN, bank details) to Org Settings
- Added a mobile number field to users/contacts

**Platform-wide** — Keval Shah
- Added a Cmd+K command palette with fuzzy search across 26 pages plus 4 quick actions, and a keyboard-shortcuts overlay
- Added a dashboard hero KPI section (receivables, collected, overdue) and a 5-step onboarding checklist for new orgs
- Added an app-wide error boundary with bilingual error UI
- Rewrote 30+ empty-state and error messages across every module
- Removed POS quick-sale and Helpdesk ticketing entirely — routers, tables, and frontend tabs dropped after the team decided not to carry them forward

---

## Bug Fixes

**Data type mismatches (Manav, Graha, Ganit, Vikray, Dristi)** — Keval Shah, ~10 commits, July 17–23
`asyncpg` requires native Python `date`/`time`/`datetime` objects; the code had been passing raw strings, which threw 500s on shift, leave, invoice, and report-scheduling endpoints. Same root cause hit `tags` (a `TEXT[]` column being `json.dumps()`-ed, which corrupted the array) and `user_id`/`created_by` (migrated from UUID to TEXT, but code still cast them `::uuid`, breaking leave requests and contact/deal creation). All fixed incrementally across the week.

**Payroll**
- Payroll was showing ₹0 gross for any employee with no attendance records — present-days calc now defaults to full working days when attendance is empty
- Late/half-day attendance was being excluded from the present-days calculation, undercounting pay
- "Revert to Draft" was blocked on approved runs by an overly strict status check

**CRM** — from the July 22–23 E2E bug sweep
- LinkedIn scraper imports produced blank contact names — the scraper returns `firstName`/`lastName` separately, not combined; now composed
- Deal edit was rejected whenever `expected_close_date` or `notes` were empty — now stripped before sending
- Kanban board was empty because the frontend read `r.data.stages` instead of the actual `r.data.columns` shape
- Client Edit form never rendered — the detail view returned early before reaching the form, and stale form state leaked into Delete

**Invoicing**
- Create Invoice button 500'd on every attempt — the code was inserting into a `gst_rate` column that didn't exist
- Invoice detail crashed because `line_items` arrived as a JSON string, not pre-parsed

**Security sweep (single commit, `31a6e96`)**
- 7 UPDATE/DELETE statements and 1 analytics query were missing `org_id` in the WHERE clause — one org could modify or read another org's rows. All patched.
- R2 storage secret keys were being returned in the admin org-detail API response — removed
- OTP generation used `random.randint` instead of a cryptographic source — switched to `secrets`, added a 5-attempt/15-minute rate limit, removed the OTP from email subject lines
- The Srijan AI chatbot rendered markdown without escaping HTML first — an XSS hole, fixed with `escapeHtml()`
- Concurrent invoice/order/payslip creation could produce duplicate document numbers — added an advisory lock (see Code Review below — this fix doesn't fully work as written)

**Infrastructure fragility (July 18, DB connectivity)**
- PgBouncer's transaction-mode pooler was killing connections under load; switched to session-mode pooler with a direct-connection fallback and retry logic, across four iterative fixes in one day
- `/api/teams` was 500ing because `brand_settings` (a JSON string) wasn't being parsed
- CORS origin matching was case-sensitive and rejected legitimate preview-deploy origins over a spelling mismatch ("kartavaya" vs "Kartavaya")

**UI components**
- `@mention` dropdown in task comments only matched exact prefixes and had no fallback when members weren't already loaded — fixed
- `Card` didn't forward `onClick`/`style`/rest props to the DOM, silently breaking click handlers everywhere it was reused
- `useToast` was missing `error`/`success`/`warning`/`info` methods, breaking call sites that used them
- `DataTable` and `TabBar` prop APIs didn't match how `AdminCostDashboardPage` was calling them
- Service-worker auto-reload on deploy was wiping open forms and active tabs mid-workflow — replaced with a non-disruptive "app updated" toast

---

## Testing

No automated tests were touched this week — the existing pytest/vitest suites (`test_auth.py`, `test_ganit.py`, `test_manav.py`, `test_graha.py`, `auth.test.jsx`, `utils.test.js`) were not extended. All testing was manual and E2E, done by Keval Shah:

- Three dedicated E2E bug-fix commits: employee dropdowns/pipeline data/report access (July 21), HRMS/Payroll — CORS, payroll ₹0, employee selectors, department CRUD, asset edit (July 22), CRM — tab reset, delete confirmations, deal CRUD, LinkedIn import, border contrast (July 23)
- A tester-facing testing guide was written for the 5 new Tier-1 features (Loans, Expense Claims, Vendor Bills, Stock Ledger, Recruitment) — both a markdown version and a matching `.docx`, scoped to a manual QA session dated July 22
- A doc-only commit corrected the feature-plan status doc: all 15 planned Odoo-parity features shipped, 2 (POS, Helpdesk) were subsequently pulled back out

**Gap:** the week's biggest feature set (credit billing, Srijan publishing) has zero automated test coverage, and the manual QA pass was focused on the earlier Odoo-feature batch, not billing or publishing. See Code Review below for two bugs that manual testing didn't catch.

---

## Infrastructure & Optimization

- **Supabase egress cut** — scraper results moved from Supabase JSONB to R2 storage; the admin "all teams" query is now scoped by org instead of returning every team on every request (was 1.5M rows/day); notification polling throttled to 5 minutes when the tab is hidden; startup no longer re-runs 47 DDL statements once tables already exist
- **Attachments excluded from the task-list query** — task lists were pulling in up to 48MB of attachment data per response; now returns an empty array there instead
- **Legacy `team_members` tenant fallback removed**, replaced by the `user_roles` table; a retention cron added to prune stale data
- **DB pool tuning** — min/max connection sizes adjusted three times this week chasing pooler stability, settling on session-mode pooling with a direct-connection fallback
- **Forex source migrated** off broken Google Finance scraping to `open.er-api.com` primary with a CDN fallback; hardcoded fallback rate updated from ₹85 to ₹96.50; all cost/billing endpoints now return USD, INR, and client-charged INR with configurable per-org markup
- **New credit/billing tables** — `hub_org_credits`, `hub_user_credits`, `hub_org_credit_transactions`, and `org_id` added to `hub_ai_logs` after discovering the app referenced tables that had never been created; credit balance computation was wrong twice in a row before landing on `plan_credits - used`, computed from monthly debits
- **13 migrations shipped this week** (029–056): single-org consolidation, UUID→TEXT conversion for user-ID columns, multi-currency/bank-reconciliation/approval-chains/timesheet-billing/assets/events/documents, loans/expense-claims/vendor-bills/stock/recruitment, scraper marketplace, e-sign, CRM clients, invoice PDF, scraper-results-to-R2, plan credits, org credit tables, publish-platform expansion

---

## Code Simplification

**Already done this week:**
- Removed ~570 lines of unused/half-built POS and Helpdesk code (routers, frontend tabs, and their tables) once the team decided not to ship them
- Fixed a `NameError` in `ai_router.generate()` (undefined `org_id`), removed a hardcoded ₹85 forex fallback from the frontend, removed a redundant import
- Removed debug-only endpoints and debug try/except scaffolding from `hub.py`, `ganit.py`, `graha.py` once image generation and deal/invoice creation were confirmed working
- Consolidated the standalone Data Tools page into Srijan tabs, removing a duplicate route and nav entry
- Removed a query referencing a column that was never created (`total_topup`)

**Not yet done — worth doing before the credit system goes further:**
- Two separate credit-cost tables exist (one in `hub.py` for what the UI shows, one in `ai_router.py` for what actually gets charged) and they've already drifted — see Code Review, finding #1. They need to be one source of truth.
- `get_usd_inr()` is called twice in the same `admin_orgs.py` handler where one shared value would do
- `forex.py` exports `get_usd_inr_sync()`, which is imported but never called anywhere
- Cost-report building is duplicated nearly verbatim across `admin_orgs.py` and `subscription.py` (~150 lines of near-identical aggregation logic) — worth a shared helper
- The 11 platform-publisher functions in `social_publisher.py` follow the same request/response pattern and could share one helper as more platforms get added

---

## Code Review — Findings From This Week's Diff

Read-only review of the staging diff, no code was changed. Two are worth fixing before the credit system and Srijan publishing get more traffic:

1. **Billing mismatch (high).** The credit cost shown to users when they generate content doesn't match what actually gets deducted from their wallet. `social_post` shows 3 credits but debits 2; `email_campaign` shows 3, debits 2; `proposal` shows 5, debits 8; `festival_campaign` shows 5, debits 10 — because `hub.py`'s display table and `ai_router.py`'s actual deduction table were built separately and have already drifted. This is a real billing-accuracy problem on a brand-new monetization feature and should be fixed before this goes to more orgs.

2. **WhatsApp publishing is non-functional as written (high).** The publish query aliases the social account's metadata column as `acct_meta`, but the WhatsApp send function reads `metadata` — so it always gets an empty broadcast list and every WhatsApp post will fail against the Meta API. There's also no field on the account model to hold a broadcast list yet.

3. **The duplicate-document-number fix doesn't fully work (medium).** This week's security commit added an advisory lock to stop concurrent invoice/order/payslip creation from generating the same number, but the lock isn't wrapped in an explicit transaction, so under asyncpg it releases almost immediately — and the lock key is derived from Python's `hash()`, which is randomized per process, so two backend workers won't even contend on the same lock. The race condition is likely still there.

4. **Plan pricing can still leak to clients (medium).** This week's stated goal was to hide plan pricing from clients, but the pricing endpoint gates on the legacy `role` field (an old admin/member/client flag), not the new RBAC roles introduced this week. Any client user whose legacy role happens to be "admin" still gets raw pricing back from the API, even though the current frontend doesn't render it.

5. **Social OAuth tokens stored in plaintext (medium).** Access/refresh tokens for connected client social accounts (Facebook, Instagram, LinkedIn, etc.) are stored unencrypted. A DB backup leak would expose live tokens for every client's connected accounts.

6. **Minor:** `markup_pct` isn't range-validated on org creation (only on update), and `credit_balance` in one cost-breakdown endpoint reports the largest single client wallet instead of the org-wide total — unused by the frontend today, but a landmine if wired up later.

---

## Competitive Landscape

**What Kartavaya already has this week that Zoho, Freshsales, LeadSquared, Kylas, SalezShark, HubSpot, Pipedrive, and Salesforce charge extra for, or don't offer at all:**

- **CRM + HRMS + Payroll + Invoicing + Sales + Analytics + Marketing + Social Publishing + E-signature + lead-gen scraping, one login, one database.** Every one of the eight sells CRM (at most CRM + marketing). None ship payroll, HRMS, or GST invoicing — Zoho gets closest but as separate paid products (Zoho Books, Zoho Payroll) with separate logins and no shared schema, so cross-module reporting like Dristi's overview page (one SQL join across CRM, HR, and payroll) isn't something their architecture can do without an ETL layer in between.
- **In-house e-signature with a full audit trail (OTP verification, PDF hash, IP/timestamp per event) shipped this week at no marginal cost per signature.** HubSpot's is a paid add-on, Zoho requires a separate Zoho Sign subscription, Pipedrive has no native e-sign at all, and Salesforce's is enterprise-tier only.
- **13-platform social publishing with AI content generation, built into the CRM itself.** None of the eight touch this — it's Hootsuite/Buffer/Sprout Social territory, each its own $50–500/month subscription.
- **Transparent, credit-based billing in rupees** — this week's dashboard shows exactly what a client is charged for AI/scraper usage, in dual currency, with live forex. Salesforce and HubSpot obscure real cost behind seat tiers and add-on pricing; Kylas and SalezShark are flat-fee but have no AI/data usage to meter in the first place.
- **A GST-native invoicing engine plus a full accounts-payable side**, in the same product as the sales pipeline. Zoho and Freshsales need a separate SKU for this; LeadSquared and Kylas have no invoicing at all.
- **A genuinely trilingual UI (English/Hindi/Gujarati)**, not just translated marketing pages. Neither of the two India-focused competitors on this list, LeadSquared or Kylas, do this at the app level.

**Concrete gaps:**
- No telephony/click-to-call. Pipedrive, Zoho, Freshsales, HubSpot, Salesforce, Kylas, and LeadSquared all have it.
- No working marketing automation — Prachar can define a campaign sequence but the send step is still a stub. HubSpot, Zoho, Freshsales, and LeadSquared all have automation that actually fires.
- No app ecosystem or public API/webhooks — Salesforce and HubSpot's real moat.
- No lead-enrichment product of our own; the plan is to integrate a third party later, and that hasn't happened yet.
- Still effectively single-tenant in practice — 31 orgs exist on paper, but there's one real paying customer (Aekam Inc itself). A prospect's security team would flag this immediately against Salesforce/HubSpot/Zoho's proven multi-tenant track record.
- No WhatsApp integration live yet — the highest-ROI unbuilt item on our own roadmap, and both India-market competitors (Kylas, LeadSquared) already have it.

**The wedge:** *the only business system where a CRM pipeline, a payroll run, a GST invoice, a signed contract, and a social post live in the same database — priced in rupees, with every AI credit spent shown to the rupee, not hidden behind a seat tier.* That claim closes once WhatsApp ships and we've onboarded a second real paying org — both are the right next priorities, ahead of more feature breadth.

---

## UI Modernization Ideas

The design system ("editorial": warm paper background, dark navy sidebar, teal accent `#1AB8B0` with an existing but under-used three-stop gradient) already got its first glass treatment this week — `.k-glass` blur/saturate effects shipped on the Dashboard, Ganit, Graha, and Manav pages. The generic `.k-card` used almost everywhere else (Vetana, Dristi, Srijan, Admin) is still flat: no shadow, no blur. That's the concrete gap, not a hypothetical one.

- **Graha (CRM):** extend glass styling to kanban deal cards; add a gradient border on hover using the existing `--k-grad` teal gradient; turn the "rotting deal" indicator into a slow pulsing amber glow instead of a static badge — this is the screen a stakeholder demo lingers on longest.
- **Manav (HRMS):** the new shift-scheduling grid is still default table styling — color-code shift types (morning/evening/night) with three gradients derived from the brand teal so the schedule reads at a glance.
- **Vetana (Payroll):** status chips (draft/processed/approved/disbursed) are flat single-hex tints — convert to soft gradient pills, and add a one-time checkmark-draw animation when a run moves to "disbursed." This is a money-moving module; it should look like one.
- **Dristi (Analytics):** apply `.k-glass` to the KPI panel wrapper so it visually floats, and add small inline sparklines next to each stat tile's headline number — right now the numbers have no trend indicator, which undersells the module's whole point.
- **Srijan (content hub):** the new publish tab is the highest-leverage spot for a platform-icon rail with each platform's own brand color as a card accent, so the 13-platform grid reads instantly instead of requiring label-reading. Add a shimmer/gradient-sweep loading state on the generate button while AI content streams in.
- **Admin/Billing dashboard:** this is the densest, most numbers-heavy page in the product and currently plain `DataTable` rows. Give it a glass-panel margin/revenue hero (reusing the `.k-hero-kpi` class already built for the main Dashboard this week) with the margin percentage as a large gradient-filled number, plus a green-to-red heat tint on provider-cost rows scaled to margin — so a margin problem is visible at a glance.
- **Everywhere:** promote `.k-glass` from a one-off class to the default `.k-card` look — it already exists and is proven on 4 pages, so this is low-risk. Apply the existing `--k-grad` gradient to primary buttons instead of flat teal. Swap toast/modal fade-in for a cheap spring-easing slide/scale — small, app-wide, near-zero engineering cost.

---

## Costs & Budget

| Tool | Purpose | Spend to date |
|---|---|---|
| HuggingFace | Model testing | $10 |
| OpenRouter | API testing | $10 |
| Apify | Scraping / data tools | Free plan |

**Total external tool spend to date: $20 + free-tier services.**

---

## Contributors

- **Keval Shah** — 116 of 116 commits on staging this week (100%). Shipped the entire feature slate: credit/billing system, e-signature module, scraper marketplace, Srijan publishing rebuild, plus the multi-day asyncpg/UUID bug-fix sweep and the July 22–23 E2E testing pass across CRM/HRMS/Payroll. All commits carry an AI co-author trailer — 107 with Claude Opus 4.6, 9 with Claude Sonnet 5.
- **"Claude" (separate git identity)** — 5 commits on `claude/odoo-ui-ux-forms-770p2h` (last commit July 17), not merged into staging. None of that work has shipped.

---

## Next Steps

1. **Fix the two high-severity bugs from this week's code review before pushing the credit system and Srijan publishing further** — the credit display/deduction mismatch and the broken WhatsApp publish path.
2. **Ship WhatsApp integration.** It's the highest-ROI item on our own roadmap and the sharpest gap against Kylas and LeadSquared, our actual India-market competitors — still untouched this week despite everything else that shipped.
3. **Promote `staging` to `main`** once the two review findings are fixed — production is 13 commits behind and none of this week's work (credit system, e-sign, Srijan rebuild) has reached real users yet.
4. **Wire up Prachar's send step** — sequences can be built but nothing executes them yet.
5. **Add automated test coverage for the credit/billing system** — it shipped this week with zero tests and is now handling real money calculations.
6. **Resolve the Supabase egress question properly.** This week's fixes were stopgaps; the underlying decision (stay on Supabase vs. migrate) is still open.
7. **Onboard a second real paying org.** Multi-tenancy is unproven in practice — 31 orgs exist, one is real. This is a credibility gap against every competitor on the list.
