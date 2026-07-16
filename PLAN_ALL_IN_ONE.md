# Kartavya · All-in-One Strategy — Competitive Research & Implementation Plan

**Session:** 2026-07-16
**Branch:** staging
**Author:** Research pass over 12 competitor products (folk, Close, Clay, Apollo, Ahrefs, Celayix, Lindo, iScanner, SignNow, LeadSquared, Coupler)
**Principle carried forward from PLAN_VIKRAY / PLAN_VETANA:** Zero code duplication. New capability is a thin layer over existing module endpoints, never a rewrite.

---

## 0. The Core Strategic Finding (read this first)

The 12 products are **not one market**. They split into three groups, and the correct response to each group is different. The single biggest risk in this plan is treating the list as a feature backlog and trying to clone all of it. That path loses.

| Group | Products | Their moat | Our verdict |
|---|---|---|---|
| **Data-moat businesses** | Clay, Apollo, Ahrefs, folk's enrichment | A licensed/crawled data corpus costing $10M+/yr to build and maintain | **SKIP the moat. Rent it via BYO-key.** |
| **Workflow businesses** | folk, Close, Celayix, LeadSquared, Coupler, SignNow | UX + workflow logic. Code, not data. | **BUILD.** This is where we win. |
| **Adjacent point tools** | Lindo, iScanner | Weakly defended, low strategic value | **1 BUILD (scan), 1 SKIP (website builder).** |

**Why this matters:** Ahrefs maintains a petabyte-scale web crawler. Apollo licenses and refreshes a 275M-contact database. Clay resells 150+ providers. We cannot fund any of that, and attempting it burns the runway that should go into the workflow layer. But — and this is the opportunity — **every one of those data vendors sells an API.** We can offer their data inside Kartavya without owning it, and let the customer pay the data vendor directly (BYO-key). We monetize the workflow, not the bytes.

**The actual wedge:** None of these 12 products is built for the Indian SMB. The all-in-one that wins India is not "folk + Apollo + Ahrefs in one login." It is:

> **WhatsApp-native CRM + Aadhaar eSign + GST invoicing + attendance/payroll, in one system, priced in rupees, with no per-credit meter.**

Kartavya already has 4 of those 5 pillars built (Graha, Ganit, Manav, Vetana). The gap is WhatsApp and eSign. That is a far shorter path to "all-in-one" than any feature-cloning exercise.

---

## 1. Research Findings Per Product

### 1.1 folk.app — relationship-first CRM
**What it does well:** Clean contact-centric UX, browser extension for LinkedIn capture, "1-click enrich," email sync, shared pipelines. Speed of data entry is its whole pitch.

**Documented weaknesses (G2/Capterra/Reddit):**
- **No mobile app at all** — the single most-repeated complaint. Web-on-phone only.
- No real workflow automation.
- Reporting is shallow: no cohort analysis, no win/loss, no forecast accuracy.
- Duplicate contacts when the same person imports via both LinkedIn and Gmail (no merge-on-import).
- Enrichment hard-capped at 1,000 contacts/month.
- Scales expensively: ~$5,760/yr for a 10-person team on Premium annual.
- 18–24h support response, no live chat even on Premium.

**Lesson for Kartavya:** Our mobile app (Expo, already in `mobile/`) is a genuine advantage over folk. Their duplicate-on-import bug is a warning: **we must build merge-on-import before we build any import.** Their pricing is the opening — a 10-person Indian SMB will not pay $5,760/yr.

### 1.2 Close.com — inside-sales CRM with native dialer
**What it does well:** Best-in-class native **Power Dialer** and Predictive Dialer — auto-skips busy/disconnected numbers and advances the rep. Auto call transcription + summarization. Built for high-volume SDR/BDR teams.

**Weaknesses:** Per-user cost compounds on Professional/Business. Weak on marketing automation, service, and multi-layer approvals — deliberately narrow.

**Lesson:** The dialer is the feature worth stealing conceptually, but **not via Twilio-style telephony in v1** — that is a licensing, DLT-registration, and cost rabbit hole in India. The cheap 80% is a **click-to-call + call-outcome-logging + next-lead-queue loop** driven from the phone's native dialer via the mobile app. Same rep-productivity win, ~2% of the build cost.

### 1.3 Clay.com — enrichment waterfall
**What it does well:** "Waterfall" enrichment across 150+ providers — try provider 1, if no hit try provider 2, and so on. **Only charges on successful lookup.** This is a genuinely good design.

**Weaknesses:** Credit burn is the #1 complaint. Costs unpredictable on large lists with many steps. Steep learning curve (near-universal in G2 reviews). Only pays off at serious outbound volume. Power users cut cost by **bringing their own GPT and data API keys** — a critical signal.

**Lesson:** **Do not become a data reseller.** Adopt the *waterfall pattern* (ordered provider chain, pay-on-hit, cache aggressively) but run it on **the customer's own API keys**. This flips Clay's main weakness — unpredictable credit burn — into our differentiator: the customer sees exactly what they spend, and we never mark up bytes.

### 1.4 Apollo.io — B2B database + sequencer
**What it does well:** Huge contact DB, strong native sequencer with A/B testing, conditional logic, and manual-task steps (LinkedIn, calls).

**Weaknesses — this is the important part:**
- Claims 91% accuracy; independent tests find **65–80%**, and **as low as ~60% outside the USA**.
- r/coldemail documents **15–38% bounce rates on "verified" exports** through Q1 2026.
- Data decay: contacts who changed jobs months ago still show current.
- Teams that trusted the "verified" label **damaged their sending domains.**
- Deliverability suite is thin: no mailbox warm-up, no ESP matching, no bounce shield.

**Lesson — decisive:** Apollo's data is **~60% accurate in our home market**. Any plan to clone or resell a contact database for India is dead on arrival. But the *sequencer* is pure workflow logic and very much worth building. And their deliverability failure is a gap we can occupy cheaply: **verify-before-send + bounce shield** is a small amount of code that protects the customer's domain — the exact thing Apollo burns.

### 1.5 Ahrefs — SEO
**What it does well:** The backlink index. That is the product.

**Weaknesses:** Credit system is the universal complaint — *every action* costs a credit (opening Site Explorer = 1, clicking a report = 1, applying a filter = 1). Up to 50% price rises in 2024; grandfathered pricing killed Oct 2024. Reddit consensus: prohibitively expensive for agencies, freelancers, small teams. No free trial.

**Lesson: SKIP entirely.** We cannot build a web crawler and there is no version of this we win. It is also **strategically unrelated** to a PM/CRM/HRMS suite — an Indian SMB using Kartavya for invoices and payroll is not switching SEO vendors because of it. The only defensible slice is *content* SEO (briefs, on-page suggestions), which belongs to **Srijan** where AI already lives — and even that is a P3 nice-to-have, not a pillar.

### 1.6 Celayix — workforce scheduling
**What it does well:** Shift **bidding** (staff express interest, scheduler assigns), availability capture, auto-assign by rules, labor-cost control, overtime avoidance. Strong for shift-based/field industries.

**Weaknesses:** **Three separate mobile apps** for different features — reviewers call it fatiguing. Payroll integration "isn't straightforward." Custom reporting limited. Unclear pricing.

**Lesson:** This is the **highest-fit item on the entire list.** Kartavya already has Manav (employees, attendance, leaves, holidays) and Vetana (payroll) and **one** mobile app. Celayix's two biggest complaints — app fragmentation and painful payroll integration — are things we get *for free* because scheduling would live in the same system as attendance and payroll. Shift scheduling is a genuine hole in Manav today and it is directly adjacent to the **Pahchan** biometric-attendance module already planned. Build it.

### 1.7 Lindo.ai — AI website builder
**Findings:** Modern UI but reviewers report **buggy, unstable, constant server disconnects**. After 8 months still missing basics: no font-size editing, no color-scheme editing, **no undo/redo**. Invited client-editors can create unlimited new sites (agencies hate this). Best only for brochure/portfolio sites. Early adopters felt misled on promised features.

**Lesson: SKIP.** A website builder is an enormous surface area (editor, hosting, CDN, DNS, templates) with no connection to Kartavya's core. Lindo is visibly struggling to build it *as their only product*. The one adjacent piece we already have is **web forms** (shipped in the CRM Phase 0+1+3 commit) — a public form that feeds Graha is 95% of the value an SMB actually needs from "a website" in a CRM context. Extend forms into hosted landing pages **only** if customers ask (P3).

### 1.8 iScanner — mobile document scanner
**What it does well:** Edge detection, image enhancement, OCR in 24 languages, e-signing/merge/split.

**Weaknesses:** Aggressive subscription (forces sub before use; 3-day trial auto-renews; users report surprise weekly charges). OCR ranked **7th of 10** on handwriting. Files reported "trapped in the app" — no clean export.

**Lesson:** Do not build a scanner *product*. But **scan-to-capture as a feature inside our existing mobile app is high value and cheap**: photograph a GST invoice or a receipt → OCR → prefill a Ganit expense. That kills manual data entry, which is the actual job. Their "files trapped in app" complaint is the anti-pattern — everything we scan must land in an existing Kartavya record, never a private silo. Use on-device/ML Kit OCR + a **cheap** model for field extraction (per AI budget: cheap models in production, never Claude at runtime).

### 1.9 SignNow — e-signature
**What it does well:** Templates, signing order/routing, audit trail, in-person signing, at a lower price point than DocuSign.

**The India finding (this is the big one):**
- Aadhaar eSign is **legally valid** under **Section 3A + Schedule 2 of the IT Act, 2000**, per the Gazette notification of **28 Jan 2015**.
- It is **legally binding for B2B contracts** when performed via a licensed **Certifying Authority**, with the same standing as a wet signature.
- CCA-licensed providers: **eMudhra, Protean (NSDL e-Gov), Capricorn, Digio, SignDesk, Leegality**.
- Pricing: **Leegality ~₹15/eSign, transparent usage-based**. Market range **₹3–₹25/signature**. **Digio is enterprise-contract only as of Apr 2026 — no self-serve, no pay-per-use.**
- Positioning: Digio/SignDesk skew fintech/lending; **Leegality is strong on contract-heavy and e-stamping flows** — which is exactly our shape.

**Lesson:** **Ganit already has a `contracts` table with zero signature capability** (verified: no sign-related fields in `ganit.py`). Wiring Aadhaar eSign into Ganit contracts + Vikray quotations is a **legally-differentiated, India-specific feature that no product on this list offers well.** DocuSign supports it only via local CA partnerships at enterprise pricing. **Start with Leegality** — transparent per-eSign pricing and self-serve, versus Digio's enterprise-only wall.

### 1.10 LeadSquared — the closest India competitor
**What it does well:** Fast to implement, easy to learn (sales managers picked it over Zoho for this), strong India distribution in education/BFSI/healthcare.

**Weaknesses:** "Customer service is abysmal." Users report **data auto-deleting** and lag. Some reviewers found it "incredibly frustrating with nothing to like."
**Zoho (the other India incumbent):** complex, needs heavy training, cluttered/dated UI, inconsistent integrations, aggressive billing behavior.

**Lesson:** This is our real competitive set, not folk or Close. The India CRM market's shared weakness is **support and reliability**, not features. Both incumbents are beatable on *trust*. Also note LeadSquared's wedge was **speed-to-value** — that should shape our onboarding.

### 1.11 Coupler.io — reporting automation / ETL
**What it does well:** Pulls from marketing/sales/ecommerce/accounting sources, blends them, schedules refresh, ships prebuilt Looker/PowerBI dashboards. Reviewers praise affordability and support.

**Weaknesses:** Connection-based pricing gets expensive across many accounts. Overwhelming with many imports. Limited export/source customization. Complex models need trial and error. Price rises and plan-limit changes noted.

**Lesson:** **We are the source of truth, so we skip the hardest part of their job.** Coupler exists because a business's data is scattered across 20 SaaS tools. In Kartavya, CRM + invoicing + HR + payroll + projects are **already in one Postgres**. Cross-module reporting is a `JOIN`, not an ETL pipeline. **Dristi already has `/overview`, `/revenue`, `/pipeline`, `/hr`, `/sales` + custom dashboards.** The gap is *outbound*: scheduled email delivery of reports, CSV/Sheets export, and a light external-source pull (Google Ads/Analytics) for marketing spend. That is a Dristi extension, not a new product.

---

## 2. Where Kartavya Actually Stands (verified against code, 2026-07-16)

| Capability | Module | Status |
|---|---|---|
| Contacts, deals, kanban, pipeline, labels, timeline | `graha.py` (2101 ln) | ✅ Solid |
| Lead scoring + rules + rescore | `graha.py` | ✅ Shipped |
| Automations + logs | `graha.py`, `automations.py`, `automation_engine.py` | ✅ Shipped |
| Inbound leads + inbound email + web forms | `graha.py`, `lead_parser.py` | ✅ Shipped |
| Invoices, products, payments, expenses, recurring, GST | `ganit.py` (1183 ln) | ✅ Solid |
| Contracts | `ganit.py` | ⚠️ **Exists, but no signature capability** |
| Employees, attendance, leaves, holidays, performance | `manav.py` (895 ln) | ✅ Solid |
| Payroll + statutory | `vetana.py` | ✅ Planned/built |
| Sales orders, targets, leaderboard | `vikray.py` | ✅ Planned/built |
| Analytics + custom dashboards | `dristi.py` (434 ln) | ✅ Core done |
| Email campaigns, templates, audience, unsubscribes | `prachar.py` (600 ln) | ✅ Email only |
| AI routing + grounding + RAG | `ai_router.py`, `rag.py` | ✅ Shipped |
| Social publishing + OAuth | `social_publisher.py`, `hub_publish.py` | ✅ Shipped |
| Mobile app | `mobile/` (Expo) | ✅ Exists — **beats folk outright** |
| **WhatsApp send/receive** | — | ❌ **MISSING — highest-value gap** |
| **Aadhaar eSign** | — | ❌ **MISSING — legally differentiated** |
| **Enrichment (any)** | — | ❌ Missing |
| **Sequencer (multi-step cadence)** | `prachar.py` has campaigns, not cadences | ❌ Missing |
| **Shift scheduling / bidding** | — | ❌ Missing (Celayix gap) |
| **Doc scan → OCR → record** | — | ❌ Missing |
| **Scheduled report delivery / export** | `report_generator.py` exists | ⚠️ Partial |
| **Merge-on-import / dedupe** | — | ❌ Missing (folk's documented bug) |

**Verified gaps by grep:** no `whatsapp`/`twilio`/`sms` in any router except passing refs in `hub.py`/`ai_router.py`; no sign/signature fields on contracts; no enrichment anywhere; `prachar` has a `channel` column defaulting to `"email"` but only email actually sends — **the channel abstraction already exists and is the natural seam for WhatsApp.**

---

## 3. The Verdict Table

| # | Product | Verdict | Where it lands | Priority |
|---|---|---|---|---|
| 1 | **WhatsApp** (not on the list — from India research) | **BUILD** | `prachar` channel + new `sanvaad` inbox | **P0** |
| 2 | SignNow → **in-house e-sign** | **BUILD** (no vendor, ₹0/sig — Aadhaar ditched 16 Jul) | `ganit` contracts + `vikray` quotes | **P0** |
| 3 | folk (dedupe/merge, capture speed) | **BUILD** | `graha` | **P0** |
| 4 | Celayix (shift scheduling + bidding) | **BUILD** | `manav` + `pahchan` + mobile | **P1** |
| 5 | Apollo (**sequencer only**, not data) | **BUILD** | `prachar` cadences | **P1** |
| 6 | Coupler (scheduled delivery + export) | **BUILD** | `dristi` | **P1** |
| 7 | Close (click-to-call loop, not telephony) | **BUILD** | `graha` + mobile | **P2** |
| 8 | iScanner (scan→OCR→prefill) | **BUILD** | mobile → `ganit` expenses | **P2** |
| 9 | Clay (waterfall **pattern**, BYO-key) | **INTEGRATE** | `graha` enrichment service | **P2** |
| 10 | Apollo/folk (contact **data**) | **INTEGRATE** (BYO-key only) | same service as #9 | **P2** |
| 11 | Ahrefs (SEO) | **SKIP** — content-SEO only, in `srijan` | P3 |
| 12 | Lindo (website builder) | **SKIP** — extend web forms → landing pages only if asked | P3 |

---

## 4. Implementation Plan

### P0 — The All-in-One Wedge (this is the release that matters)

#### 4.1 WhatsApp Channel — `sanvaad` + `prachar`

**Why P0:** India research is unambiguous. A team handling 25–100 leads/day converts at **1–2% without a WhatsApp CRM and 7–8% with** shared inbox + ownership + automated follow-up. That is a **4–7x conversion lift** — the single largest ROI number in this entire research pass. Meanwhile Graha already has inbound leads, scoring, and automations; they are just deaf to the channel Indian SMBs actually sell on.

**Economics (verified):** Meta charges Marketing **₹0.8631/msg**, Utility **~₹0.13**, Auth **~₹0.115**, +18% GST. **Service messages are free.** BSP platform fees run ₹999/mo (Picky Assist, BotSpace) to ₹16,999/mo (WATI). Typical SMB at 100 leads/day: **₹4,500–₹7,200/mo all-in.**

**Design decision — BSP vs direct Meta Cloud API: ✅ DECIDED 2026-07-16 — direct Meta, no WATI, no BSP.**
Verified there is **no WATI/AiSensy/Interakt/Gallabox code in the repo** — no migration debt, nothing to rip out. Sanvaad is a greenfield build straight onto Meta Cloud API.

Go **direct to Meta Cloud API**, not through a BSP. BSPs are a ₹999–₹16,999/mo tax for a shared inbox we are already building. The research says BSP "WABA plumbing is largely commoditised — they differ on shared inbox UX and automation depth." **Inbox UX and automation depth are precisely what Kartavya already is.** Paying a BSP means paying a competitor for the part we're best at. Direct Cloud API = customer pays Meta only, we charge zero markup, and that undercuts WATI/AiSensy/Interakt/Gallabox on day one.

**Build:**
```
backend/services/whatsapp_service.py   — Meta Cloud API client (send, template send, media)
backend/routers/sanvaad.py             — the shared inbox module
  GET    /v1/sanvaad/conversations              — list, filter by assignee/status/unread
  GET    /v1/sanvaad/conversations/{id}         — thread + linked graha contact
  POST   /v1/sanvaad/conversations/{id}/messages — send (respects 24h service window)
  PATCH  /v1/sanvaad/conversations/{id}/assign  — ownership (the thing that drives 1%→7%)
  PATCH  /v1/sanvaad/conversations/{id}/status  — open/pending/resolved
  POST   /v1/sanvaad/webhook                    — Meta inbound (signature-verified, public)
  GET    /v1/sanvaad/templates                  — WABA templates + approval status
  POST   /v1/sanvaad/templates                  — submit for Meta approval
```
- **Reuse:** `prachar.channel` already defaults to `"email"` — extend the enum to `whatsapp`, and campaign send dispatches on channel. No new campaign engine.
- **Reuse:** inbound WhatsApp from an unknown number → `POST /v1/graha/inbound-leads` (exists) → auto-scored by existing rules → routed by existing automations. **The whole lead machine already works; we are only adding a mouth and ears.**
- **Critical — 24-hour service window:** Meta only permits free-form replies within 24h of the customer's last message. Outside it, only approved templates (paid). The inbox **must** show a live countdown per conversation and hard-block free-form sends past it, or users will silently fail to reach customers. This is the #1 functional trap of the WhatsApp API.
- **Compliance:** TRAI rules apply to marketing sends; honor existing `prachar` unsubscribes across channels — an opt-out on email must suppress WhatsApp marketing too (single suppression list, not per-channel).
- **Cost display:** show per-conversation cost (category × rate + GST) in the UI. Clay/Ahrefs' universal complaint is *unpredictable metered spend*; we neutralize it by making it visible rather than hiding it behind our own credit currency.
- **Security:** verify `X-Hub-Signature-256` HMAC on the webhook; rate-limit it (`limiter.py`); it is a public unauthenticated endpoint — treat inbound payloads as untrusted (existing email-escaping convention applies to message bodies rendered in the inbox).

#### 4.2 In-House E-Signature — `ganit` contracts
**✅ DECIDED 2026-07-16 — Aadhaar eSign DITCHED. Build our own simple e-signature. No vendor, ₹0/signature.**

**Why this works legally (verified):**
- **IT Act §10A**: a contract formed electronically **is valid and enforceable** and cannot be held invalid *solely* because it was formed electronically. Parties are **free to adopt virtual signatures, clickwrap, or email exchange** — Aadhaar is not required.
- **Indian Contract Act, 1872** governs validity. Most commercial contracts require no prescribed signature form at all.
- **The trade-off, stated honestly:** a non-Schedule-2 signature has **no statutory presumption of validity**. Aadhaar eSign/DSC get that presumption; ours does not. If a signature is *disputed*, we must prove four things:
  1. the signature links **only** to the signatory and no other person;
  2. **only** the signatory had access/control of the document at signing;
  3. any **alteration after signing is detectable**;
  4. the Contract Act essentials are met.

**Those four points are not a warning — they are the build spec.** A well-designed audit trail proves all four. This is exactly what DocuSign/SignNow actually do for the overwhelming majority of their volume: simple electronic signature + audit trail, not certificates.

**⚠️ IT Act First Schedule — these CANNOT be e-signed by ANY method** (Aadhaar wouldn't have helped either). Hard-block in the UI with an explanation:
- Negotiable instruments **other than a cheque** (NI Act §13)
- **Power of attorney** (Powers-of-Attorney Act §1A)
- **Trusts** (Indian Trust Act §3)
- **Wills** / any testamentary disposition (Indian Succession Act §2(h))
- **Any contract for sale or transfer of immovable property** or any interest in it

Everything Kartavya's customers actually sign — quotations, SOWs, NDAs, engagement letters, service agreements, POs — is **outside** these exclusions and fine.

**Build:**
```
backend/services/esign_service.py      — in-house; keep a provider interface so Aadhaar
                                          eSign (Leegality ~₹15) can drop in later if a
                                          BFSI/lending customer ever demands presumption
# extend routers/ganit.py — do NOT create a new module
  POST   /v1/ganit/contracts/{id}/send-for-signature   — tokenized signer links, signing order
  GET    /v1/ganit/sign/{token}                        — PUBLIC signer view (no login)
  POST   /v1/ganit/sign/{token}/otp                    — issue email/SMS OTP
  POST   /v1/ganit/sign/{token}/verify                 — verify OTP  → unlocks signing
  POST   /v1/ganit/sign/{token}/submit                 — capture signature + consent
  GET    /v1/ganit/contracts/{id}/signature-status     — pending/viewed/signed/declined/expired
  POST   /v1/ganit/contracts/{id}/cancel-signature
  GET    /v1/ganit/contracts/{id}/audit-trail          — legal evidence pack (PDF)
```

**Evidence design — each element maps to a legal test above:**
| Capture | Proves |
|---|---|
| **Email/SMS OTP before signing** (mandatory) | (1) links to signatory — *the single most important element; do not make it optional* |
| Unique unguessable token per signer, single-use, expiring | (2) sole access/control |
| IP, user-agent, timestamp per event (sent/viewed/OTP/signed) | (1)(2) |
| **SHA-256 hash of the final PDF at signing**, stored immutably | (3) alteration detectable |
| Explicit consent checkbox ("I intend to sign and be bound") | (4) intent under Contract Act |
| **Certificate of Completion** appended to the signed PDF | all four, in one exportable artifact |

- Signature capture: draw / type / upload image. Store as PNG in R2.
- Schema: add `signature_status`, `signature_method`, `signed_pdf_url`, `signed_pdf_sha256`, `signed_at`, `signers` (jsonb: name/email/phone/order/status/ip/ua/otp_verified_at) to contracts.
- Store signed PDF + audit trail in existing R2 (`storage.py`). **The audit trail IS the legal evidence** — immutable, exportable, never hard-deleted (soft-delete only, even if the contract is deleted).
- **Security:** `/v1/ganit/sign/{token}` is **public and unauthenticated** — rate-limit it (`limiter.py`), constant-time token compare, throttle OTP attempts (lock after 5), expire tokens, and treat all signer input as hostile.
- **Extend to Vikray quotations** — signed quote → auto-create sales order (`POST /v1/vikray/orders`) → Ganit invoice. Closes quote→sign→order→invoice→payment fully inside Kartavya. **No competitor on this list closes that loop.**

**Why this beats the Leegality plan:** ₹0/signature vs ₹15 (a real COGS line at volume — 1,000 contracts/mo = ₹15,000/mo saved), no vendor dependency, no enterprise-contract wall, no per-signature metering to explain to customers (§5.2), and we own the UX. The only thing given up is the statutory presumption — which matters for lending/BFSI, not for SMB service contracts. **Keep the provider interface so that door stays open.**

#### 4.3 Merge-on-Import / Dedupe — `graha`

**Why P0 and why before any import feature:** folk's most-cited data bug is duplicate contacts when the same person arrives via two sources. We are about to add three new inbound sources (WhatsApp, enrichment, scan). **Building import before dedupe means shipping folk's bug at 3x the surface area.** This is cheap now and expensive later.

```
POST   /v1/graha/contacts/find-duplicates    — fuzzy: email exact, phone E.164-normalized, name+company trigram
POST   /v1/graha/contacts/{id}/merge         — merge into survivor; re-point deals/activities/timeline/labels
GET    /v1/graha/contacts/duplicates         — review queue
```
- Match keys in priority order: **email (exact, lowercased) > phone (E.164-normalized — critical for WhatsApp, where the number IS the identity) > name+company (trigram)**.
- Merge must re-point every FK (deals, activities, follow-ups, labels, timeline, conversations) and keep an undo window. Merging is destructive; treat it with the same care as delete.
- Enforce at write time on `inbound-leads` and the WhatsApp webhook, not just as a cleanup batch.

---

### P1 — Depth

#### 4.4 Shift Scheduling + Bidding — `manav`
**Highest structural fit on the list.** Celayix's two worst complaints are **3 fragmented mobile apps** and **payroll integration "isn't straightforward."** We have one Expo app and Vetana payroll in the same database — both complaints are architecturally impossible for us. Manav already has attendance/leaves/holidays; scheduling is the missing sibling, and it feeds Pahchan (biometric attendance) directly.

```
# extend routers/manav.py
  GET/POST   /v1/manav/shifts                  — shift definitions (name, start, end, break, role)
  GET/POST   /v1/manav/schedules               — assign shift → employee → date
  POST       /v1/manav/schedules/auto-assign   — rule-based fill (availability + skills + OT limits)
  GET/POST   /v1/manav/availability            — employee-declared availability
  GET/POST   /v1/manav/shift-bids              — open shifts → staff bid → manager assigns
  POST       /v1/manav/shifts/{id}/swap        — swap request → approval (reuse approvals_router.py)
  GET        /v1/manav/schedules/coverage      — gaps + labor cost + OT warnings
```
- **Reuse:** `approvals_router.py` for swaps, `manav/holidays` + `leaves` for conflict blocking (`/leaves/check-conflicts` already exists), `push_service.py`/`expo_push_service.py` for shift alerts, Vetana reads schedules for OT pay. **Zero new infrastructure.**
- Labor-cost guardrail: warn before publishing a schedule that breaches OT thresholds — Celayix's actual selling point.

#### 4.5 Sequencer / Cadences — `prachar`
Apollo's sequencer is its best part and is **pure workflow logic with no data dependency** — safe to build. Campaigns (one-to-many blast) ≠ cadences (per-contact multi-step timeline).

```
GET/POST   /v1/prachar/sequences                    — definition
GET/POST   /v1/prachar/sequences/{id}/steps         — ordered: wait N days → email | whatsapp | call task | manual
POST       /v1/prachar/sequences/{id}/enroll        — enroll contacts (from a graha filter)
POST       /v1/prachar/sequences/{id}/pause
GET        /v1/prachar/sequences/{id}/stats         — per-step funnel, reply rate, A/B split
```
- **Multi-channel from day one** (email + WhatsApp + call task) — Apollo is email-first and this is where WhatsApp compounds in India.
- **Auto-exit on reply** is mandatory — the classic sequencer failure is continuing to nag someone who already replied.
- **Reuse:** `automation_engine.py` for step scheduling — do not write a second scheduler.
- **Deliverability guard (occupying Apollo's failure):** verify-before-send (MX + syntax + disposable-domain check), suppress hard bounces org-wide, cap daily sends per mailbox, and **warn on bounce rate >5%**. Apollo's users damaged their sending domains trusting a "verified" label. Never show a "verified" badge we can't stand behind — display the **source and age** of an email instead. Data decay is what burned them; honesty about staleness is the fix.

#### 4.6 Scheduled Reports + Export — `dristi`
Coupler's whole business is unifying scattered data. **Ours is already unified — that's the moat.** We only need the delivery half.

```
GET/POST   /v1/dristi/scheduled-reports        — dashboard + cron + recipients + format
POST       /v1/dristi/reports/{id}/run-now
GET        /v1/dristi/exports/{id}             — CSV / XLSX / PDF
POST       /v1/dristi/connections              — external pull: Google Ads/Analytics (marketing spend only)
```
- **Reuse:** `report_generator.py` (exists), `email_service.py`, `task_reminders.py` cron pattern.
- Only pull **external marketing spend** (Ads/Analytics) — the one number genuinely not in our DB, needed for CAC/ROAS. Resist becoming an ETL company.
- **Pricing note:** Coupler's complaint is connection-based pricing scaling badly. Include scheduled reports in the base plan. It costs us a cron job.

---

### P2 — Productivity & Rented Data

#### 4.7 Click-to-Call Loop — `graha` + mobile
Close's dialer value **without** telephony. No Twilio, no DLT registration, no per-minute cost, no telecom licensing.
```
POST   /v1/graha/call-queue           — build queue from a contact filter
GET    /v1/graha/call-queue/next      — serve next lead
POST   /v1/graha/calls                — log outcome (connected/no-answer/busy/callback) + notes + next action
```
- Mobile taps `tel:` → native dialer → returns → **one-tap outcome → auto-advance to next lead.** That is ~90% of Close's rep-productivity gain for ~2% of the cost.
- Optional: attach a recording; transcribe with a **cheap** model (per AI budget — never Claude at runtime).

#### 4.8 Scan → OCR → Prefill — mobile + `ganit`
```
POST   /v1/ganit/expenses/from-scan    — image → OCR → extract vendor/date/amount/GSTIN/tax → prefilled draft
POST   /v1/uploads/scan                — reuse uploads.py + storage.py
```
- On-device edge detection + ML Kit OCR (free, offline — matches the Pahchan offline-first pattern), **cheap** model only for field extraction.
- **Always land in a real record** (draft expense), never a private file silo — iScanner's "files trapped in the app" is the anti-pattern.
- **Always show the draft for confirmation.** OCR on Indian GST invoices will not be reliable enough to auto-post; iScanner ranked 7/10 on handwriting. Extraction assists, the human confirms.

#### 4.9 Enrichment — BYO-Key Waterfall (`graha`)
**The strategic core of the "rent, don't own" decision.**
```
backend/services/enrichment_service.py
  GET/POST /v1/graha/enrichment/providers      — org's own API keys (encrypted at rest)
  POST     /v1/graha/contacts/{id}/enrich      — run waterfall
  POST     /v1/graha/enrichment/bulk           — batched, rate-limited
  GET      /v1/graha/enrichment/usage          — per-provider spend, transparent
```
- **Waterfall pattern from Clay:** ordered provider chain, stop on first hit, **only count a successful lookup**.
- **BYO-key:** customer brings Apollo/Hunter/Dropcontact/Clearbit keys. **We never resell data, never mark up, never hold a credit balance.** Research showed Clay's own power users do exactly this to cut cost — we make it the default instead of the workaround.
- **Cache aggressively** (org-scoped, TTL'd) — the cheapest lookup is the one not made.
- **Store `source` + `fetched_at` on every enriched field** and surface age in the UI. Apollo's core failure is data decay presented as truth. We show provenance instead of a false "verified" badge.
- Keys are secrets: encrypt at rest, never log, never return to client (write-only + masked display).

---

### P3 — Deferred (explicitly not now)
- **SEO (Ahrefs):** content-brief/on-page suggestions inside **Srijan** using existing Gemini grounding. **No crawler, no backlink index, ever.**
- **Landing pages (Lindo):** extend existing web forms → hosted landing page. Only on real customer demand. Lindo is failing at this as a full-time product.

---

## 5. Cross-Cutting Requirements

### 5.1 DPDP Act + Data Residency — and the Neon decision

**Verified facts (2026-07-16):**
- MeitY notified the **DPDP Rules 13–14 Nov 2025**. Penalties **up to ₹250 crore**.
- **Section 16 uses a "negative list"**: personal data may be transferred to **any** country *except* those the Central Government restricts by notification. **As of mid-2026 no restricted-country list has been published.**
- Section 16 + operational obligations activate **18 months after the Nov 2025 notification (~May 2027)**.
- **No blanket localization mandate** for general personal data. RBI's exclusive-India rule binds **payment system operators** (we record invoice payments; we are not a payment system operator — likely out of scope, but confirm before storing any card/PSP data).
- Government **may** mandate localization for **Significant Data Fiduciaries** — provision exists, not yet activated.

**Current state (verified via Supabase API):** project `kartavya-sg`, region **`ap-southeast-1` — Singapore.** All Indian customer payroll, PAN, Aadhaar, bank, and salary data physically sits in Singapore today.

**Is that illegal? No — not today, and not on any published timeline.** Singapore is not on a restricted list because no list exists.

**⚠️ CORRECTION to an earlier recommendation ("pick an India region on Neon") — that is not possible:**
- **Neon has no India region.** Verified against Neon docs: 8 AWS regions (N. Virginia, Ohio, Oregon, Frankfurt, London, **Singapore**, Sydney, São Paulo). Azure regions deprecated. Mumbai is a long-standing unfulfilled community request.
- **Neon cannot change a project's region after creation** — "You cannot change the region for an existing project." A move means a new project + full data migration.
- **Supabase *does* have Mumbai (`ap-south-1`).**

**So the Neon migration is not a cost decision — it is a fork:**

| Option | Data location | Cost | Consequence |
|---|---|---|---|
| **A. Migrate to Neon** | Singapore (best case) | Lower (scale-to-zero) | **Permanently forecloses India residency** — no region change, no India region |
| **B. Stay Supabase, move to Mumbai `ap-south-1`** | **India** | ~Supabase pricing | India residency; kills the "where does our payroll data live?" objection |
| **C. Stay Supabase Singapore** | Singapore | Status quo | Legal today; same migration cost deferred |

**Recommendation: Option B.** The Neon saving is small in absolute terms (Railway is already ~$1.70/mo). Foreclosing India data residency — *permanently and irreversibly* — while we build **Aadhaar eSign**, **biometric attendance (Pahchan)**, and **payroll** for **Indian SMBs** is a large strategic cost for a small monthly one. Three reasons residency matters even though Singapore is legal:
1. **The negative list can change by notification, with no grace period.** If Singapore is ever listed, we move the DB on the government's deadline, mid-business, under duress.
2. **Significant Data Fiduciary designation** becomes plausible as we grow, and we hold the most sensitive categories that exist: biometric + Aadhaar + payroll.
3. **Sales.** Indian buyers — especially BFSI, education, healthcare (LeadSquared's strongholds) — ask where the data lives. "Singapore" loses deals *regardless of legality*.

Moving regions costs roughly the same ~3 hours as the planned Neon swap, and **it is cheapest right now** — migration difficulty scales with data volume and customer count. Do it once, correctly. Revisit Neon only if they ship an India region.

**Mumbai migration runbook — verified feasible 2026-07-16, planned for tonight:**

Verified facts:
- Org `AekamINC` is on the **free plan**; a new project costs **$0/mo**. Only **1 project exists** (limit is 2 free) — room for `kartavya-in`.
- **The migration is unusually clean because we barely use Supabase.** Verified by grep:
  - **Auth is custom JWT** (`auth_router.py` uses `jwt.encode` with our own `JWT_SECRET`) — **not Supabase Auth**. No `auth.users` to migrate, no sessions invalidated, no user re-login.
  - **Storage is Cloudflare R2** (`services/storage.py`, per-org buckets) — **not Supabase Storage**. Nothing to move.
  - **DB access is plain asyncpg via `DATABASE_URL`** (`db.py`). Supabase is *only* hosted Postgres to us.
  - → **The migration is a `pg_dump` + restore + one env-var swap.** No application code changes.

Steps:
1. Create project `kartavya-in`, region **`ap-south-1` (Mumbai)**, **Postgres 17** (match current `17.6.1.127`).
2. `pg_dump` from `kartavya-sg` (schema + data, `--no-owner --no-privileges`).
3. Restore into `kartavya-in`; verify row counts per table against source.
4. Swap `DATABASE_URL` in **Railway** (and any Vercel server-side env). Redeploy.
5. Smoke test: login, one write per module, `/health`.
6. **Keep `kartavya-sg` running as rollback for ~1 week**, then delete. (Free-tier projects pause after 7 days idle — the old one pausing is fine and is itself a safety net.)

Caveats: free tier has no PITR, so take the dump **immediately before** cutover to minimise the write gap; announce a short maintenance window, or accept that writes during the dump window are lost. Confirm the DB password / pooler connection string from the dashboard before starting.

**Required build (P1, well before May 2027):**
- `backend/routers/privacy.py` — export-my-data, delete-my-data, consent log. Reuse `activity_logger.py` for the audit trail.
- 72-hour breach notification process, consent records, automated data-deletion workflows, data-subject access/erasure endpoints.
- **Pahchan biometric raises the stakes** — face templates are sensitive personal data. Re-review the 72hr-buffer design under DPDP **before Pahchan ships**.

### 5.2 Pricing Strategy — our sharpest weapon
Every single metered competitor is hated for the same reason:
- **Ahrefs:** a credit per click, per filter, per report.
- **Clay:** unpredictable credit burn, the #1 complaint.
- **folk:** ~$5,760/yr for 10 users; enrichment capped at 1,000/mo.
- **Coupler:** connection-based pricing punishes multi-account users.
- **iScanner:** surprise weekly charges.
- **Close:** per-user cost compounds.

**Kartavya's position: flat per-user INR pricing, no credits, no internal currency.** Where a true external cost exists (Meta ₹0.8631/marketing msg, Leegality ~₹15/eSign, enrichment API calls), **pass it through at cost, shown transparently, on the customer's own account.** We monetize workflow; we never mark up bytes.

This is not just nicer — it is **structurally cheaper for us**, because we carry no data-licensing COGS. It's a margin advantage disguised as a pricing philosophy.

### 5.3 Reliability & Support — the India CRM opening
LeadSquared: "customer service is abysmal," data auto-deleting, lag. Zoho: threatened suspension over its own billing bug. folk: 18–24h response, no live chat. Lindo: buggy, unstable, constant disconnects.

**The India CRM market's shared weakness is trust, not features.** Concretely: never silently delete data (soft-delete everywhere — already our convention), make merges/deletes undoable, keep the module-toggle work (`admin panel enable/disable`) so orgs adopt incrementally, and **support responsiveness is a product feature, not a cost center.**

### 5.4 Engineering Conventions (per existing code + memory)
- Follow `architecture_patterns.md`: page structure, API-call pattern, auth, `_bg()`, rate limiting, email escaping.
- **Column allowlists on every new filter/sort** — the SQL-injection convention from commit `2e77287` applies to all new endpoints, especially `sanvaad` and enrichment where inputs are external.
- All new modules must be **toggleable per-org** via the existing admin module enable/disable (`5f4eb0a`).
- **Fluid, left-aligned, no fixed-width centering** on every new page (per `feedback_ui_layout.md`), with `k-*` editorial.css tokens and the bilingual naming pattern (`feedback_design_system.md`).
- **Production AI = cheap models only.** Gemini direct for grounding. Claude is a development tool, not a runtime dependency (`feedback_ai_models.md`).
- Webhooks (`sanvaad`, `esign`) are **public unauthenticated endpoints** — HMAC-verify, rate-limit, and treat every payload as hostile.

---

## 6. Sequencing

| Phase | Scope | Unlocks |
|---|---|---|
| **P0.1** | Dedupe/merge (`graha`) | Prerequisite for every new inbound source |
| **P0.2** | WhatsApp inbox + channel (`sanvaad`/`prachar`) | 1–2% → 7–8% lead conversion; the India wedge |
| **P0.3** | In-house e-sign (`ganit`/`vikray`) | Closes quote→sign→order→invoice→payment |
| **P1.1** | Shift scheduling + bidding (`manav`) | Celayix replacement; feeds Pahchan |
| **P1.2** | Sequencer + deliverability guard (`prachar`) | Apollo's best feature, none of its liability |
| **P1.3** | Scheduled reports + export (`dristi`) | Coupler replacement, ~free for us |
| **P2** | Click-to-call, scan→OCR, BYO-key enrichment | Rep productivity + rented data |
| **Cross** | DPDP (India region on Neon migration), privacy endpoints | ₹250cr regulatory exposure; **decide region before migrating** |
| **P3** | Content SEO in Srijan, landing pages | Only on demand |

**Do P0.1 first.** It is the smallest item and the only one that gets *more expensive* the longer it waits — every day without it, WhatsApp/enrichment/scan pour more duplicate contacts into Graha.

---

## 7. What We Are Deliberately Not Building

Stated plainly so it doesn't get relitigated:

1. **A contact database.** Apollo is ~60% accurate outside the US. We would be worse and it would cost millions. BYO-key instead.
2. **A backlink index / SEO crawler.** Ahrefs' moat is a petabyte crawler, unrelated to a PM/CRM/HRMS suite.
3. **A website builder.** Lindo can't ship undo/redo after 8 months as their only product.
4. **A credit currency.** It is the most-complained-about mechanic across Ahrefs, Clay, folk, Coupler, and iScanner. Flat INR + at-cost pass-through.
5. **An ETL pipeline.** Coupler exists because data is scattered; ours is in one Postgres. A `JOIN` beats a pipeline.
6. **Telephony infrastructure.** DLT registration, licensing, per-minute costs — for ~10% more than a `tel:` link gives free.
7. **A BSP dependency for WhatsApp.** Their differentiator is inbox UX; that's our core competence. Direct Cloud API.

**The all-in-one claim is earned by owning one database across CRM + invoicing + HR + payroll + projects + WhatsApp + eSign — not by having the most features.** Every competitor on this list is a point solution defending one moat. Kartavya's moat is the join between them, and that is the one thing none of them can copy.

---

## Sources

**Products:** [folk pricing/reviews](https://prospeo.io/s/folk-pricing-reviews-pros-and-cons) · [folk CRM reviews](https://delveant.com/blog/folk-crm-reviews/) · [folk review (Dex)](https://getdex.com/blog/folk-crm-review/) · [Close CRM review](https://www.authencio.com/blog/close-crm-review-power-dialer-pricing-pros-cons-competitors) · [Close hands-on](https://www.breakcold.com/blog/close-crm-review) · [Clay pricing](https://www.saleshandy.com/blog/clay-pricing/) · [Apollo review](https://www.salesforge.ai/blog/apollo-io-review) · [Apollo data accuracy](https://tomba.io/blog/apolloio-reviews) · [Apollo brutal truth](https://autoposting.ai/blog/apollo-io-review) · [Ahrefs cons + Reddit](https://searchatlas.com/blog/ahrefs-cons/) · [Ahrefs alternatives](https://cybernaira.com/best-ahrefs-alternatives/) · [Celayix review](https://connecteam.com/reviews/celayix/) · [Celayix reviews (Capterra)](https://www.capterra.com/p/83589/Celayix/reviews/) · [Lindo reviews (AppSumo)](https://appsumo.com/products/lindo-ai/reviews/) · [Lindo (Trustpilot)](https://www.trustpilot.com/review/lindo.ai) · [iScanner reviews](https://www.capterra.com/p/10005668/iScanner/reviews/) · [iScanner review](https://www.mobileappdaily.com/product-review/iscanner) · [LeadSquared vs Zoho](https://www.trustradius.com/compare-products/leadsquared-vs-zoho-crm) · [LeadSquared vs Zoho (PeerSpot)](https://www.peerspot.com/products/comparisons/leadsquared_vs_zoho-crm) · [Coupler reviews](https://www.capterra.com/p/202311/Coupler-io/reviews/) · [Coupler pricing](https://coefficient.io/coupler-io-pricing)

**India / regulatory:** [Aadhaar eSign legality (IT Act)](https://www.leegality.com/blog/law-around-aadhaar-esign) · [eSign enforceability](https://www.leegality.com/blog/legal-enforceability-of-esign) · [Aadhaar eSign B2B binding](https://www.esignglobal.com/blog/is-aadhaar-esign-legally-binding-b2b-contracts-india) · [Leegality vs Digio](https://findthatsoftware.com/compare/leegality-vs-digio-india) · [Leegality pricing](https://www.leegality.com/pricing) · [eSign pricing comparison](https://signyu.com/compare/pricing) · [Digio Aadhaar eSign docs](https://documentation.digio.in/digisign/types_of_sign/aadhaar_based/) · [WhatsApp API pricing India](https://www.secuodsoft.com/blog/digital-marketing/whatsapp-business-api-pricing-implementation-cost-in-india.php) · [WhatsApp CRM India guide](https://blog.kraya-ai.com/whatsapp-crm) · [WhatsApp API + TRAI](https://ozonetel.com/whatsapp-business-api/) · [Best WhatsApp CRM India](https://www.itforsme.in/best/whatsapp-crm-india/) · [DPDP Phase 1 guide](https://secureprivacy.ai/blog/india-dpdp-act-phase-1) · [DPDP for SaaS](https://complydog.com/blog/india-dpdp-act-data-protection-privacy-compliance-saas) · [DPDP data residency](https://globaldatashield.com/blog/data-residency-india-dpdp-act) · [DPDP 2026 founders guide](https://vucense.com/privacy-sovereignty/surveillance-biometrics/india-dpdp-act-2026-saas-compliance-guide/)
