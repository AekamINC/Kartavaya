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

Numbering note: 20–31 were never used. 39 and 44 are kept because the owner rejected both and the
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
