# Design proposals

Self-contained HTML. Open any file directly in a browser — no build, no assets, no CDN.
Each supports light and dark.

**Status:** `proposed` = a decision to make · `approved` = build from this · `built` = shipped ·
`superseded` = kept for the record only.

| # | File | What it settles | Status |
|---|------|-----------------|--------|
| 00 | `00-where-we-are.html` | State of play, 5 Aug | superseded by 07 |
| 01 | `01-org-lifecycle-four-screens.html` | Creating an org, end to end | proposed |
| 02 | `02-org-control-and-marketplace.html` | Org control page + AI marketplace | proposed |
| 03 | `03-billing-lines.html` | An invoice as a query over what is due | built |
| 04 | `04-email-plan.html` | Providers, per-client sending, ten addresses | partly built |
| 05 | `05-two-kinds-of-user.html` | Org seats vs Pahchan seats | approved |
| 06 | `06-cross-org-visibility.html` | What god mode can actually see | approved |
| 07 | `07-two-days-and-what-is-left.html` | Two days of work, and what remained | superseded by 12 |
| 08 | `08-where-the-ai-money-goes.html` | 80% of the AI bill is images, not tokens | approved |
| 09 | `09-sanvaad-design-system.html` | Bubbles, channel tones, emoji picker | approved |
| 10 | `10-srijan-chat-research.html` | The eight omissions behind "looks cheap" | approved |
| 11 | `11-replica.html` | The replica both surfaces were approved from | approved |
| 12 | `12-the-plan.html` | **27 open items and the dependency chains** | approved |
| 13 | `13-team-sweep.html` | Every platform team membership, with evidence | built |
| 14 | `14-whole-product.html` | Whole-product palette + App Store marketplace | palette superseded by 15; marketplace approved |
| 15 | `15-light-palettes.html` | Six light grounds — **Slate chosen** | approved |
| 16 | `16-sahayak-welcome.html` | Five welcome voices | superseded by 18 |
| 17 | `17-sahayak-layouts.html` | Four chat layouts | superseded by 19 |
| 18 | `18-welcome-bilingual.html` | Six bilingual variants — **C1 chosen** | approved |
| 19 | `19-sahayak-final.html` | **The approved Sahayak layout — build from this** | approved |
| 32 | `32-invoice-payment-qr.html` | The A4 invoice with the payment block | built |
| 33 | `33-pay-page.html` | Per-platform pay behaviour: Android, iOS, desktop | built |
| 34 | `34-ganit-collections.html` | Collections — which service paid, split payments | built |
| 35 | `35-whatsapp-send.html` | Send on WhatsApp, and the chat preview card | built |
| 36 | `36-shared-invoice-page.html` | The shared invoice page in full, laptop and phone | built |
| 37 | `37-final-flow.html` | **The approved payment flow**, end to end | built |
| 38 | `38-whatsapp-automation.html` | Cloud API, rules, delivery ladder | partly built — the send shipped, the rules are A4 |
| 39 | `39-automation-plan.html` | First automation plan | **rejected** — audited triggers, never checked whether the actions could run |
| 40 | `40-vercel-hobby-licence.html` | The Vercel Hobby licence problem and the plan off it | approved — see `docs/CLOUDFLARE-MIGRATION.md` |
| 41 | `41-automation-architecture.html` | **The automation design** — event spine, trigger/condition/action model, per-module catalogue | proposed |
| 42 | `42-automation-architecture-review.html` | **Architecture review of 41** — what it got wrong, plus four platform faults underneath it | proposed |
| 43 | `43-automation-catalogue.html` | **All 60 automations in plain words. Read this one first.** | proposed |
| 44 | `44-automation-audit-superseded.html` | Second automation audit | **rejected** — audited the two screens, not the product. Renumbered from 40, which collided |
| 45 | `45-sidebar-glass.html` | Sidebar glass treatments | superseded by the 2026-08-09 ruling: glass everywhere, gated on capability not OS |
| 46 | `46-glass-animations.html` | Glass animations; §2 is the rail waking on approach | approved except §2 — the rail-wake awaits a yes |
| 47 | `47-reports-download.html` | CRM reports download (CSV/Excel/PDF) + which modules get reports next | built — CRM shipped `1f9bec4c`; Ganit ageing next |
| 48 | `48-ai-model-costs.html` | Every model and its measured cost | approved |
| 49 | `49-near-zero-cost-assistant.html` | The near-zero-cost chat strategy: streaming, markdown, "be short" | approved — the three mechanics are plan step 8 |
| 50 | `50-selling-sahayak-per-org.html` | Selling Sahayak per org | approved — wallet split confirmed, plan step 7 |
| 51 | `51-sahayak-whole-module-economics.html` | Whole-module economics — the scrapers sold below cost | built — repriced and live 2026-08-10 |
| 52 | `52-getting-off-apify.html` | Getting off Apify: provider column + drivers | approved — plan steps 1-6, nothing started |
| 53 | `53-open-source-scrapers-and-an-india-runner.html` | Open-source scrapers and an India egress runner | approved — plan step 6, buy only when blocked |
| 54 | `54-the-plan-2026-08-16.html` | **The plan of record — every open track in execution order** | approved-in-use — supersedes 12's open-item list |
| 55 | `55-niyam-automation.html` | **Niyam — the fresh zero-AI automation system.** Rips out all five surfaces and 20 dispatchers; app-emitted outbox, typed conditions, one gated send, one sweep | **awaiting approval** — supersedes 41/42/43 as plans |
| 56 | `56-niyam-demo.html` | **Working demo:** drive the engine — fire events, run the sweep, watch rules claim, run and record | demo for 55 |
| 57 | `57-niyam-templates.html` | **Working demo:** the 15 starter rules, ordered by blast radius; the two modules deliberately left out | demo for 55 §7 |
| 58 | `58-niyam-old-vs-new.html` | **Working demo:** four everyday moments, today's automation vs Niyam side by side | demo for 55 §1 |
| 59 | `59-niyam-builder.html` | **Working demo:** author a rule; the form refuses to let you build a broken one | demo for 55 §7 |
| 60 | `60-analytics-spine.html` | An analytics spine, not a connector zoo — accounts, daily grain, adapters | approved — spine shipped unarmed; Meta adapter open |
| 61 | `61-analytics-demo.html` | **Working demo** for 60/62 | demo |
| 62 | `62-analytics-everywhere.html` | **Analytics in every module** — one registry, three surfaces, exports as the org's paper | built — D1–D7 + per-module tabs shipped 2026-08-17/18 |
| 63 | `63-analytics-builder-demo.html` | **Working demo:** the widget builder | demo for 62 |
| 64 | `64-react-aria.html` | React Aria adoption for the overlay primitives | **rejected** — fixed by hand instead, `5cb76413` |
| 65 | `65-analytics-standalone.html` | **Analytics without Dristi** — every module carries files, schedules and alerts on its own page | proposed |
| 66 | `66-niyam-catalogue.html` | **The Niyam catalogue** — 13 templates today → ~37; every module's events, two broken contracts to repair first | proposed |
| 67 | `67-widget-freedom-and-tab-choice.html` | **Widget freedom and tab choice** — drag anywhere, resize from the corner, density measured from real pixels so no widget carries dead space | built |
| 68 | `68-kartavaya-usage-analytics.html` | **The Pulse** — Aekam's own view of Kartavaya: active users, surfaces and OS, app versions; only the UA and app-version collectors were approved | built |
| 69 | `69-an-assistant-that-compounds.html` | **An assistant that compounds** — Sahayak is slow, not expensive ($2.19 lifetime, 7.3s average); the seven cheap assets that improve it over time, and the one migration that waits | proposed |
| 92 | `92-map-integration-market-research.html` | **What the market actually asks maps for** — the demand ranking, what every competitor ships, Indian addressing reality, Mappls’ licence conditions, and the three Phase 7 questions answered | research — input to `docs/plans/PHASE-7-territory-and-address.md` |

Numbering note: 20–31 were never used, and 91 is deliberately skipped — CLAUDE.md reserves against a
proposal 91 to stop the status audit being written a seventh time. 39 and 44 are kept because the owner rejected both and the
reason each was rejected is the useful part.

## The settled palette

Scoped to **Sanvaad and Sahayak only**. The rest of Kartavaya stays warm cream.

| | Light — "Slate" | Dark — indigo |
|---|---|---|
| bg | `#EDEFF3` | `#0B0E16` |
| surface | `#FFFFFF` | `#141827` |
| lowest | `#F7F8FA` | `#0F1320` |
| container | `#E1E4EA` | `#1C2135` |
| rule | `#C8CCD6` | `#2A3048` |
| ink | `#0D1117` | `#E9E7E1` |
| ink-2 | `#3A4049` | `#BFBDB6` |
| ink-3 | `#565D68` | `#8E8D87` |
| primary | `#0B6E67` | `#4ADECD` |
| primary-container | `#BCEEE7` | `#0A4F49` |
| on-primary | `#FFFFFF` | `#06231F` |
| on-primary-container | `#032A26` | `#A8F0E6` |

The dark text ramp is Kartavaya's own, verbatim from `kartavaya-design.css` L408-410. There is no
second foreground ramp — only ground, surfaces and primary move.

## Two rules these pages exist to enforce

1. **Render with the real token values.** Building 11 against the actual palette caught three
   contrast failures a spec sheet would have shipped: when a row goes `--primary-container`, every
   line in it must be recoloured, not only the title.
2. **Say what is not cheap.** Where a design needs a backend change — the answer cards need the
   model to return structured sections — the page says so rather than letting it look like CSS.
