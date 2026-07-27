# CRM · Sales · Finance — STRUCTURE

Branch `agent/biz-structure-a414c546`, cut fresh from `origin/staging` (the worktree
I was handed was 13 commits of `main`, 271 behind — see `_COORDINATION.md §1`. Those
commits are all on `origin/main`, nothing was lost).

**I rendered the reference before writing a line.** `frontend/public/__ref/` (gitignored),
`http://localhost:5173/__ref/Kartavaya%20Redesign.html`, viewport 1440. Screenshots of
CRM, Sales and Finance taken from the running harness, not read from prose.

## Where the CRM screen actually lives

The brief points at `ScreensBiz.jsx`. That file holds **only Ganit and Vikray** —
`ScreenGraha` is in **`ScreensCore.jsx:108`**, next to the dashboard, under the comment
`// ── Graha (CRM) — pipeline-first, per research`. Anyone auditing CRM from
`ScreensBiz.jsx` alone finds nothing and concludes CRM was never designed.

---

## 1. CRM — `ScreensCore.jsx:109` vs `frontend/src/pages/GrahaPage.jsx`

### Tabs

Both carry **17 tabs, identical ids, identical order**. This is the one thing that was
already right.

| # | Reference `MODULE_TABS.graha` | Build `GrahaPage.TABS` | |
|---|---|---|---|
| 1 | today आज | today | ✓ |
| 2 | clients ग्राहक | clients | ✓ |
| 3 | contacts संपर्क `6` | contacts | ✓ |
| 4 | deals सौदे | deals | ✓ |
| 5 | kanban फलक | kanban | ✓ |
| 6 | pipeline प्रवाह `9` | pipeline | ✓ |
| — | **More +11** ▾ | — | **✗** |
| 7–17 | follow-ups, labels, activities, reports, automations, territories, fields, web-forms, approvals, documents, dedupe | same 11, same order | ✓ ids |

### Everything else

| Aspect | Reference (rendered) | Build | |
|---|---|---|---|
| Kicker | `REVENUE · राजस्व` | absent | ✗ |
| Title | `ग्रह` **CRM** | `CRM` `ग्राहक` | ✗ wrong Devanagari |
| Lede | "Every deal carries its next step. Two have none — they surface first." | "Contacts, deals and pipeline" | ✗ |
| Header actions | `Filters` · `+ New deal` | none | ✗ |
| Tab overflow | 6 inline + `More +11` popover | all 17 in one scrolling strip | ✗ |
| Devanagari per tab | every tab | none | ✗ |
| Counts on tabs | contacts, pipeline | none passed | ✗ |
| Default tab | **pipeline** | today | ✗ |
| Page KPI strip | 4: Open pipeline · Weighted forecast · Won this quarter · Avg cycle | none | ✗ |
| Warn chip by tabs | `⏱ 2 deals have no next step` `Fix` | absent | ✗ |
| Page order | header → **tabs → stats** → content | header → tabs → content | — |
| Pipeline tab body | column board per stage; deal cards with value, next step + due, owner avatar; warn border when no next step | 2 StatTiles + a grid of per-stage **count** cards | ✗ |

**The owner's complaint decoded.** "crm they few tabs are added under a More section"
describes the **reference**, not a build bug. The design puts 6 tabs inline and the other
11 behind `More +11`; the build renders all 17 in one horizontally-scrolling strip with an
edge fade. The build's strip is deliberate and documented (`module.css:81-96`) — it is just
not what the design does.

**The biggest single gap is `pipeline`.** The reference's CRM is *pipeline-first*: it opens
on a stage-column board of deal cards. The build opens on `today`, and its `PipelineTab`
(`graha/PipelineTab.jsx`) is a grid of per-stage **count** tiles — a summary of the board,
not the board. The board the reference draws exists in the build as `KanbanTab`, on a
different tab, in a different shape.

---

## 2. Sales — `ScreensBiz.jsx:142` vs `frontend/src/pages/VikrayPage.jsx`

| # | Reference `MODULE_TABS.vikray` | Build | |
|---|---|---|---|
| 1 | dashboard मुख्य | dashboard | ✓ |
| 2 | orders आदेश `5` | orders | ✓ |
| 3 | stock भंडार | stock | ✓ |
| 4 | **pipeline प्रवाह** | — | removed |
| 5 | targets लक्ष्य | targets | ✓ |
| 6 | **customers ग्राहक** | — | removed |

**The two removals are correct and must not be reverted.** `cae0e0a` removed them with
evidence: neither had a Vikray endpoint. `pipeline` called `GET /v1/graha/pipeline-summary`
and `customers` called `GET /v1/graha/contacts?type=customer`, every row of which navigated
to `/graha` on click. They were Graha rendered twice.

The reference is not authority here: `Data.jsx:119` labels `MODULE_TABS` *"Real tab
structures, **lifted from staging pages** — nothing dropped"*. The designer copied the
build's old tab bar; he did not design a six-tab Sales module. Where the reference merely
mirrors an older build, the build's later reasoning wins. **Recorded as a deliberate
divergence, not a gap.**

Its consequence: the reference's default tab is `pipeline`, which no longer exists, so
`dashboard` is the correct default.

| Aspect | Reference | Build | |
|---|---|---|---|
| Kicker | `REVENUE · राजस्व` | absent | ✗ |
| Title | `विक्रय` **SALES** | `Sales` `विक्रय` | ~ hierarchy |
| Lede | "Quote, signature and invoice are one object — nothing is retyped between stages." | "Orders, stock and targets. Customers and pipeline live in Graha (CRM)." | divergent by decision |
| Header action | `+ New quote` | none | ✗ |
| Page KPI strip | 4: Quoted (open) · Signed this month · Win rate · Awaiting signature | none at page level; 8 tiles inside DashboardTab | ✗ |
| "Quote to cash" table | quote → sent → signed → invoiced → paid, 5-segment progress bar per row | absent | ✗ (no quote entity) |
| "Send via" card | WhatsApp · Email · SMS link · Copy link | absent | ✗ |
| "Stalled" card | per-quote nudge list | absent | ✗ |

The last four all depend on a **quote object the build does not have**. Vikray's entity is
an *order*, created already-agreed; there is no quote→sign→invoice lifecycle to render.
Building it is a backend feature, not a restyle — flagged, not attempted.

---

## 3. Finance — `ScreensBiz.jsx:2` vs `frontend/src/pages/GanitPage.jsx`

**Naming — the design intends `Finance`.** Three independent places in the reference agree:

- `Chrome.jsx` NAV renders the sidebar item **Finance**
- `ScreenGanit`'s page title is **`गणित` FINANCE & GST**
- `Landing2.jsx:265` lists the module as **"Ganit · Finance"**

The build says **Invoicing** in all three of its own places (`navConfig.js:59`,
`moduleColors.js:13`, `GanitPage.jsx:38`). Invoicing is a paraphrase and it is *narrower
than the module*: the tab bar already carries expenses, payables, bank, contracts and
timesheet, none of which is invoicing. **Changed to Finance.**

Same call for CRM's Devanagari: reference `ग्रह`, build `ग्राहक`. `ग्राहक` means *customer*
and is already in use as the Devanagari for the `clients` tab and for Vikray's `customers`
— using it for the module too makes one word mean two things. **Changed to `ग्रह`.**

### Tabs — 10, identical ids, identical order

| # | Reference `MODULE_TABS.ganit` | Build | |
|---|---|---|---|
| 1 | invoices बीजक `5` | invoices | ✓ |
| 2 | products वस्तु | products | ✓ |
| 3 | expenses व्यय | expenses | ✓ |
| 4 | payables देय `8` | payables | ✓ |
| 5 | contracts अनुबंध | contracts | ✓ |
| — | **More +4** ▾ | — | ✗ |
| 6–10 | e-sign, recurring, bank, timesheet, stats | same 5, same order | ✓ |

| Aspect | Reference | Build | |
|---|---|---|---|
| Kicker | `REVENUE · राजस्व` | absent | ✗ |
| Title | `गणित` **FINANCE & GST** | `Invoicing` `गणित` | ✗ |
| Lede | "GSTR-3B due 20 Aug. Two invoices are missing HSN codes…" | "Tax invoices, quotations and payments" | ~ |
| Header actions | `Scan bill` · `+ Invoice` `N` | none | ✗ |
| Default tab | invoices | invoices | ✓ |
| Page KPI strip | 5: Receivables · Overdue > 45d · GST payable · ITC available · Cash in bank | none | ✗ |
| `Shortcuts ?` button | right of tab bar | absent | ✗ |
| Page order | header → **stats → tabs** → content | header → tabs → content | — |

Note the **stats/tabs order differs between modules in the reference**: Graha puts tabs
before stats, Ganit and Vikray put stats before tabs. Not an accident of one file — it is
consistent within each screen. Graha's tab bar shares its row with the "no next step" chip,
which is why it sits first.

---

## Endpoints — every KPI the design asks for already exists

No mock data was needed and no stub was written.

| KPI | Endpoint | Field |
|---|---|---|
| CRM · Open pipeline | `GET /v1/graha/reports/forecast` | `total_pipeline`, `stages[].count` |
| CRM · Weighted forecast | same call | `weighted_forecast` |
| CRM · Won this quarter | `GET /v1/graha/reports/conversion?days=90` | `won_value` |
| CRM · Avg cycle | same call | `avg_cycle_days` |
| CRM · "no next step" count | `GET /v1/graha/deals` + `GET /v1/graha/follow-ups` | deals with no open follow-up |
| Finance · Receivables / Overdue | `GET /v1/ganit/stats` | `total_outstanding`, `overdue_count` |
| Finance · Payables | `GET /v1/ganit/payables-summary` | |
| Sales · all four | `GET /v1/vikray/dashboard` | already fetched, only hoisted |

The CRM "next step" is a **follow-up row** (`staging.graha_follow_ups`), not a column on
the deal — the reference's `d.next` has no direct build equivalent, so the count is derived
from deals carrying no open follow-up.

---

## Not mine, but found while looking

- **`.mt` is two different components.** `styles/module.css:97` (module tab strip) and
  `styles/boards.css:363` (MyTasks summary strip) both own `.mt`, `.mt__n` and six more
  `.mt__*`, and boards.css imports later. `module.css:110-131` documents this and works
  around it by scoping to `[role="tablist"]` / `.mt__b`. The workaround holds, but the
  next person to add a `.mt__*` rule to either file has a 50% chance of breaking the
  other. The fix is a rename; boards.css is the newer and more local.
- **Type hierarchy is inverted between the reference and the build's page header.** The
  reference's `PH` puts Devanagari first and larger inside the `<h1>`; the build's `.mh`
  puts English at 25px and Devanagari at 15px. The build follows `13-module-pages.md §1`
  prose, which contradicts the rendered reference. The *sidebar* does put English first in
  both — so these are two different rules, and the build applied the sidebar's to the page
  header. Pixels are a sibling's surface; recorded here because it is a spec conflict, not
  a slip.
