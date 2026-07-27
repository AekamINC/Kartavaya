# Reference-completeness audit — what the approved design has that the build does not

Branch: `audit/reference-completeness`, branched fresh from `origin/staging` @ `190fa73a`
(verified: `git log -1 --oneline origin/staging` → `190fa73a merge(vikray): restore the
pipeline and customers tabs the design specifies`).

Method: reference first. `MODULE_TABS` read in full and diffed against every module.
Every reference screen enumerated part-by-part from the JSX, then each part searched for
in the build. Claims below are marked **HELD** (verified on this branch) or **STALE**.

**Enumerated: 253 items** — 155 screen parts across 14 reference screens, 90 tabs across
12 modules, 8 approved print documents.
**Could not check: 12** — listed in §7. No database was queried (read-only constraint);
no browser harness was run (see §7 for why, and what that does and does not cover).

---

## THE ANSWER: what is in the approved design and NOT in the build

Ordered by size of gap.

| # | Missing from build | Reference source | Backend? |
|---|---|---|---|
| **1** | **Six of the eight approved print documents have no UI at all.** Quotation, Statement of Account, GSTR-3B Summary, TDS Challan, Service Agreement, Project Report. All six are fully built and mounted on the backend. Zero frontend callers. | `18-documents.md`, `docs/*.html` | ✅ built, unreachable |
| **2** | **Ganit `stats` tab is a different page from the reference.** Four GST panels — Pre-filing validation, GSTR-3B summary, File & share, Reconciliation — are absent. The build shows invoice counts + a cash chart instead. | `ScreensBiz.jsx:60–117` | partial |
| **3** | **`ganit/TimesheetTab` is a form with no list.** Known, still live. Confirmed below with the exact backend reason. | `MODULE_TABS.ganit` | ❌ needs GET |
| **4** | **"Share with CA"** — appears in two separate reference screens (Ganit File & share, Dristi Configure). Absent from the build entirely. | `ScreensBiz.jsx:97`, `ScreensMore.jsx:59` | ❌ |
| **5** | **"Scan bill" / bill OCR** — reference header action plus the expenses/payables empty state. No frontend or backend support anywhere. | `ScreensBiz.jsx:13, 119–124` | ❌ none |
| **6** | **Ganit "Shortcuts `?`" affordance** — the keyboard sheet exists in the reference as a discoverable button beside the tab bar. | `ScreensBiz.jsx:27` | n/a |

Items 1 and 2 are the same root cause: **the GST/statutory filing surface was never
given a screen.** That is the single largest hole between the approved design and the
build, and it lands on the exact deliverable two accounting firms take on 15 August.

---

## 1. Six approved documents are built and unreachable — HELD

This is the headline. It is also where a peer report is **wrong**, which is why it
survived: `agent-documents-print-output.md` §2.4 says *"Statement of Account — NOT
BUILT"* and §2.6 says *"TDS Challan — NOT BUILT"*, and §438 recommends Statement of
Account as *"the cheapest document left to build"*. **All three claims are STALE.**

`backend/routers/documents.py` — 953 lines, `APIRouter(prefix="/api/v1/documents")`,
mounted at `server.py:3084` with the comment *"quotation / statement / GSTR-3B / TDS /
agreement / project report"*:

| Endpoint | Line | Service | Lines | Frontend caller |
|---|---|---|---|---|
| `GET /quotations/{invoice_id}/pdf` | 158 | `quotation_pdf.py` | 278 | **none** |
| `GET /contacts/{contact_id}/statement/pdf` | 250 | `statement_pdf.py` | 291 | **none** |
| `POST /gst/gstr3b/{period}/pdf` | 435 | `gstr3b_pdf.py` | 578 | **none** |
| `POST /tds/challan/{period}/pdf` | 622 | `tds_challan_pdf.py` | 377 | **none** |
| `POST /contracts/{contract_id}/agreement/pdf` | 739 | `agreement_pdf.py` | 325 | **none** |
| `POST /projects/{board_id}/report/pdf` | 827 | `project_report_pdf.py` | 273 | **none** |

These are not stubs. `statement_pdf.py` implements `validate_statement` blocking on the
running balance tying and ageing buckets summing. `tds_challan_pdf.py` implements the
ITNS-281 counterfoil with `validate_tds_challan` blocking on the CIN triple. Both cite
their spec HTML in the module docstring. `backend/tests/test_document_routes.py` exercises
the GSTR-3B route including its hold-back behaviour.

**Reachability, proven by exhaustion.** Searching all non-test frontend source for
`v1/documents`, `/pdf`, `gstr`, `challan`, `quotation`, `statement`, `agreement/pdf`,
`report/pdf` returns exactly three PDF calls, none of them on this router:

- `ganit/InvoiceDetail.jsx:100` → `/v1/ganit/invoices/{id}/pdf` (Tax Invoice ✅)
- `vetana/PayslipsTab.jsx:156` → `/v1/vetana/payslips/{id}/pdf` (Payslip ✅)
- `org/TabBilling.jsx:138` → `/v1/subscription/cost-report/pdf` (not one of the eight)

So of the eight documents in `18-documents.md`, **two are reachable and six are not.**
`frontend/src/components/documents/` contains only e-sign attachment helpers
(`AuditTrail`, `EsignStatusPill`, `FileDropZone`, `FileTypeIcon`) — nothing that
generates or downloads a print document.

**What this needs:** a product decision on where each document is triggered from, then
wiring. Not a small fix — six trigger points across four modules. The natural homes,
from the reference: quotation on the Vikray order/quote row; statement on the Graha
contact; GSTR-3B and TDS challan on the Ganit `stats` tab (§2); agreement on the Ganit
contract; project report on the board. **No backend work required for any of them.**

---

## 2. Ganit `stats` — the reference's GST page is not the build's page — HELD

`ScreensBiz.jsx:60–117` defines the `stats` tab as a four-panel GST filing screen.
`frontend/src/pages/ganit/StatsTab.jsx` (126 lines) renders something else entirely.

| Reference part | Build | Note |
|---|---|---|
| Pre-filing validation card, "2 blockers" | **absent** | HSN missing, GSTIN checksum, PoS derived — each with a Fix action |
| GSTR-3B summary, 4 rows (3.1 / RCM / ITC / net payable) | **absent** | `gstr3b_pdf.py` computes exactly this |
| File & share → Share with CA | **absent** | |
| File & share → Export GSTR-1 JSON | **absent** | no backend either |
| File & share → Export GSTR-3B | **absent** | **endpoint exists** (§1) |
| File & share → Tally export (XML) | **absent** | no backend either |
| GSP / IRP sync note | **absent** | |
| Reconciliation card, GSTR-2B meter 42/47 | **absent** | |
| Reconciliation tags: 3 mismatched, 2 missing | **absent** | |
| — | 5 invoice stat tiles | present, not in reference's `stats` |
| — | Cash position chart | present; belongs to the **Dashboard** in the reference (`ScreensCore.jsx:50`) |

The build's `stats` is a competent panel — it is simply not the screen the design
approved for that tab. The GST compliance surface an accounting firm buys this product
for has no home in the UI.

**Split by what it needs:**
- *Wiring only* — Export GSTR-3B button (endpoint live), TDS challan alongside it.
- *Backend work* — pre-filing validation (needs an HSN/GSTIN validation query),
  GSTR-2B reconciliation (needs 2B import), GSTR-1 JSON and Tally XML exporters.
- *Product decision* — "Share with CA": recipient model, and whether it emails.
  I sent nothing.

---

## 3. `ganit/TimesheetTab` — form with no list — HELD, backend gap stated precisely

`TimesheetTab.jsx` is 107 lines: a date range, a customer select, an IGST checkbox, a
Generate button, and a success panel. It bills entries the user is never shown. Nothing
lists the unbilled entries, their hours, their employees, or the total about to be
invoiced — and the result panel reports `entries_billed` as a bare count *after* the
invoice is already written.

**Why it cannot be fixed on the frontend alone.** The unbilled-entries query is embedded
inside the POST handler, `backend/routers/ganit.py:2108–2133`:

```
SELECT te.entry_id, te.task_id, te.minutes, te.description, te.user_id,
       e.name AS employee_name, e.hourly_rate
FROM time_entries te
JOIN tasks tk ON tk.task_id = te.task_id
JOIN teams tm ON tm.team_id = tk.team_id
JOIN staging.manav_employees e
  ON e.user_id::text = te.user_id AND e.org_id = tm.org_id
WHERE tm.org_id=$1::uuid AND te.is_billed=FALSE
  AND te.minutes IS NOT NULL AND te.minutes > 0
```

There is no GET that returns this set, so the tab has nothing to render a list from.

**Precise ask:** extract lines 2108–2133 into a helper and expose it as
`GET /v1/ganit/time-entries/unbilled` taking the same `date_from` / `date_to` /
`employee_ids` filters, behind the same `_gate` and `get_org_id` dependencies. The dual
org-scoping (task→team→org **and** employee→org) must be preserved verbatim — the comment
above it records a real cross-org leak that shape fixed. The tab then previews rows and
a total before the irreversible POST. Backend change is small and additive; I did not
make it, as backend is another agent's surface this run.

---

## 4. Tab sets — all 12 modules match `MODULE_TABS` — HELD

`Data.jsx:119` reads in full: *"Real tab structures, lifted from staging pages — nothing
dropped"*. Diffed every module. **All 90 tabs present, no omissions, no extras.**

| Module | Ref | Build | Source |
|---|---|---|---|
| graha | 17 | 17 ✅ | `GrahaPage.jsx:43` |
| ganit | 10 | 10 ✅ | `GanitPage.jsx:33` |
| manav | 11 | 11 ✅ | `ManavPage.jsx:26` |
| vetana | 6 | 6 ✅ | `VetanaPage.jsx:42` |
| vikray | 6 | 6 ✅ | `VikrayPage.jsx:54` — the `190fa73a` fix held |
| prachar | 8 | 8 ✅ | `PracharPage.jsx:42` |
| dristi | 8 | 8 ✅ | `DristiPage.jsx:40` |
| sanvaad | 2 | 2 ✅ | `SanvaadPage.jsx:39` |
| esign | 2 | 2 ✅ | `EsignPage.jsx:38` |
| srijan | 6 | 6 ✅ | `OrgSrijanPage.jsx:36` |
| hub | 7 | 7 ✅ | `HubDashboardPage.jsx:28` |
| boards | 7 | 7 ✅ | `BoardsPage.jsx:365–431` (views, not tabs) |

`HubClientDetailPage.jsx:28` carries 9 (`overview` + the 7 + `skills`). That is a
superset for a client-scoped route, not a drift — see §5.

---

## 5. Duplicated / stale trees — the Hub merge held — HELD

The prior finding (≈700 of 1,342 lines a stale copy) is **resolved**.
`HubClientDetailPage.jsx` is now 159 lines and `HubDashboardPage.jsx` 147; both import
the same eight tab components from `./hub/`. Neither inlines a tab body, so there is no
tree that can drift independently. No other near-identical page pair found.

---

## 6. Reference elements with no backing data — report, do not fake

Confirmed the two named in the brief, and found a third.

1. **Graha "Filters" button** (`ScreensCore.jsx:120`) — no filter model. `GrahaPage.jsx`
   has no filter state; its only `filter(` calls compute the no-next-step count
   (`:111–113`). Reference shows the control; build correctly omits it. Leave omitted
   until a filter model is specified.
2. **Deal card owner avatar** (`ScreensCore.jsx:160`) — needs an org-admin-gated endpoint
   to resolve owner identity. Not populated. Correct.
3. **"Scan bill" / OCR** (`ScreensBiz.jsx:13`, and the expenses/payables empty state at
   `:119–124`) — **new**. Searched `frontend/src/pages/ganit` and `backend/routers/ganit.py`
   plus all of `backend/services/` for `ocr`, `scan`, bill extraction: **no matches
   anywhere.** The reference makes this the primary path into expenses and payables
   ("Scan a bill to start", with "Enter manually" as the fallback). The build offers only
   manual entry. This is a product decision — an OCR provider — not a wiring gap.

---

## 7. Per-screen part checklists

Legend: ✅ present · ❌ absent · ⚠️ differs · ？ not checkable

### ScreenDash — `ScreensCore.jsx:4` · 20 parts · 19 ✅ 1 ⚠️
Header kick/bilingual h1/lede ✅ · "This week" ✅ · New task ✅ · 5 stat tiles ✅ ·
week strip ✅ · "Needs you today" + View all ✅ · 4-col table ✅ · Cash position card ✅
(`today/CashPosition.jsx`) · 30d/Quarter toggle ✅ · bars ⚠️ (single series; reference
draws paired inflow/outflow stacks) · legend ✅ · Approvals + waiting tag ✅ · approve/
decline ✅ · Activity ✅ · Gītā verse ✅ (`DashboardPage.jsx:422`).

### ScreenGraha — `ScreensCore.jsx:109` · 19 parts · 18 ✅ 1 ❌
17 tabs ✅ · stale banner ✅ (`GrahaPage.jsx:155`, `graha/PipelineTab.jsx:133`) ·
4 stats ✅ · 6 stage columns w/ sum + probability ✅ · deal card company/value/next-step ✅ ·
"No next step" ✅ (`PipelineTab.jsx:173`) · stale tint ✅ · empty column ✅ · contacts table
+ GSTIN ✅ · activities timeline ✅ · **Filters button ❌** (§6.1, correctly omitted).

### ScreenGanit — `ScreensBiz.jsx:2` · 24 parts · 13 ✅ 11 ❌
5 stats ✅ · 10 tabs ✅ · invoices table + MSME + IGST/C+S ✅ · bank cards ✅ ·
**Scan bill ❌** · **Shortcuts `?` ❌** · **Pre-filing validation ❌** · **GSTR-3B summary ❌** ·
**Share with CA ❌** · **Export GSTR-1 JSON ❌** · **Export GSTR-3B ❌** · **Tally XML ❌** ·
**GSP note ❌** · **Reconciliation meter ❌** · **Reconciliation tags ❌** ·
**expenses/payables scan empty-state ❌**. Worst-scoring screen in the audit — see §2.

### ScreenVikray — `ScreensBiz.jsx:142` · 12 parts · 12 ✅
6 tabs ✅ · 4 stats ✅ · quote-to-cash table ✅ · flow progress ✅ · Send via ✅ ·
Stalled ✅ (`vikray/_shared.jsx:102`, `DashboardTab.jsx:8`) · Nudge ✅. Clean.

### ScreenBoards — `ScreensWork.jsx:2` · 7 parts · 7 ✅
7 views ✅ · project chips ✅ · 4 kanban columns ✅ · card anatomy ✅ · empty ✅.

### ScreenTasks — `ScreensWork.jsx:53` · 4 parts · 4 ✅
Seg with counts ✅ · 5-col table ✅ · priority grouping ✅.

### ScreenApprovals — `ScreensWork.jsx:93` · 3 parts · 3 ✅

### ScreenDristi — `ScreensMore.jsx:3` · 11 parts · 10 ✅ 1 ❌
8 tabs ✅ · Add chart ✅ (`DristiPage.jsx:130`) · chart grid ✅ · Configure source/
dimension/measure/type ✅ · Add to dashboard ✅ (`dristi/DashboardsTab.jsx:272`) ·
pivot ✅ · **Share with CA ❌**.

### ScreenManav — `ScreensMore.jsx:68` · 9 parts · 9 ✅
11 tabs ✅ · 4 stats ✅ · employees table ✅ · missed-punch Fix ✅ · leaves ✅.

### ScreenVetana — `ScreensMore.jsx:114` · 12 parts · 12 ✅
6 tabs ✅ · 4 stats ✅ · July run table ✅ · Source card ✅ — wired, and the build
documents it as such (`vetana/PayrollTab.jsx:14, 183, 198`) · attendance-source check ✅ ·
compliance rows ✅ · statutory ✅ (`StatutoryTab.jsx`, `statutoryCalendar.js`). Clean.

### ScreenPrachar — `ScreensMore.jsx:172` · 8 parts · 8 ✅
8 tabs ✅ · Month/Week + Schedule ✅ · channel chips ✅ · **calendar ✅** — the previously
missing calendar is present (`prachar/CampaignsTab.jsx`) · post pills ✅ · templates ✅.

### ScreenSrijan — `ScreensMore.jsx:218` · 8 parts · 8 ✅
### ScreenHub — `ScreensMore.jsx:256` · 11 parts · 11 ✅
### ScreenEsign — `ScreensMore.jsx:318` · 7 parts · 7 ✅
Audit trail ✅ (`esign/DetailTab.jsx:223`, ordered `<ol>`, newest first).

### Could not check — 12
- **Rendered-harness cross-check (8 documents).** I audited from source, not from the
  served harnesses. The §1 finding is a *reachability* fact — an endpoint with no caller —
  which source exhaustion proves and rendering cannot. But visual fidelity of the eight
  documents against `docs/*.html` is **unverified by me**; `agent-documents-print-output.md`
  §5 covers that harness and should be trusted there, *except* its §2.4 / §2.6 / §438
  build-status claims, which are stale (§1).
- **4 runtime-data behaviours** — stat tile figures, count badges, calendar post density,
  and pipeline sums depend on live org data. Read-only DB constraint; not queried.

### Superseded reference — not audited
`ScreensPahchan.jsx` per the standing note: it still shows 5-pose on-device face matching,
which `07-pahchan.md` replaced with human comparison, and `MODULE_TABS` has no `pahchan`
key. Build `PahchanPage.jsx:45` carries register / corrections / payroll / history /
enrollment / policy, which follows the v1 spec, not this file. Correct to diverge.

---

## Recommended order for 15 August

1. **Wire Export GSTR-3B and TDS challan** onto the Ganit `stats` tab. Endpoints are live
   and tested; this is frontend-only and it is the thing accounting firms will look for
   first. Highest value per hour in this report.
2. **Wire the statement of account** onto the Graha contact, and the quotation onto the
   Vikray quote row. Also endpoint-live, frontend-only.
3. **Add `GET /v1/ganit/time-entries/unbilled`** and give TimesheetTab its list (§3).
   Small additive backend change; removes an irreversible action taken blind.
4. Agreement and project report PDFs — same pattern, lower urgency.
5. Pre-filing validation, GSTR-2B reconciliation, GSTR-1/Tally exporters, "Share with CA",
   bill OCR — real backend or product scope. Decide explicitly; do not let them look done.

## Constraints observed
Branched fresh from `origin/staging` `190fa73a` and committed on
`audit/reference-completeness`. `main` untouched. No database queried. No email, WhatsApp
or push sent. No pricing figures anywhere. No lockfile or line-ending changes. Report-only
— no shared source file edited, six peers running in parallel.
