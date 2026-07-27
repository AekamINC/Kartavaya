# Verification pass — Vetana · Vikray · Dristi · Prachar

**Branch** `verify/vetana-vikray-dristi-prachar`, cut fresh from `origin/staging` @ `0a69bef1`
(`git rev-list --count HEAD..origin/staging` = 0).
**Date** 2026-07-27. **Scope** 38 files. **Verdicts below cover all 38 — none skipped.**

This is the first pass in which these four pages were **actually rendered and measured**. Every
previous agent reported "visual fidelity unverified". The headline result: the four conversions
are substantially real. The specific features they claimed to have built are present and behave
as the reference specifies. No file is a stub.

---

## How this was verified (and what that does and does not prove)

| Method | Detail |
|---|---|
| Dev server | My own vite on **127.0.0.1:5700** from this worktree. Never :5173. `location.href` asserted on every read. |
| Backend | A **local stub API on 127.0.0.1:5701** (`scratchpad/stub-api.mjs`), in-memory canned JSON. `frontend/.env.local` (gitignored) points `VITE_BACKEND_URL` and `VITE_SUPABASE_URL` at loopback ports, so **production and staging Supabase were never reachable, let alone contacted**. No sign-in, no DB read, no DB write. |
| Session | A fake `auth_token` in localStorage + the stub answering `/auth/me`. No real credentials used. |
| Three states | The stub has a mode switch (`/__mode?m=ok\|empty\|error`) so loading / empty / **error** were each driven deliberately and observed separately. |
| Measurement | `javascript_tool` — `getComputedStyle`, `getBoundingClientRect`, `scrollWidth > clientWidth`, DOM identity checks for remount. |
| **Screenshots** | **FAILED** — "the Browser pane is not displayed, so the page is not compositing frames." **No claim in this report rests on having seen a pixel.** Everything is structural or computed-layout evidence. |

**Writes:** none. No campaign was dragged, no order created, no payroll processed, **no email,
WhatsApp or push sent** — the send paths were read, never invoked.

---

## Cross-cutting results

| Check | Result | Evidence |
|---|---|---|
| `.mt__b` bilingual gap | **7px** — correct; the 13px doubling did **not** survive | `getComputedStyle('.mt__b').gap === "7px"`, 6 instances |
| Tab strip → "More" popover | **Present and faithful** | `ModuleTabs.jsx` max=6; live: Dristi/Prachar render 6 inline + `More+2`, popover head `All tabs · 8`, rows carry Hindi |
| Active-tab swap into head | **Works** | Chose `pivot` from popover → it took the last inline slot, `reports` moved to tail, `More+2` held |
| Overflow split across widths | **1280 / 820 / 393 px: always 6 inline + More+2** | Split is **count-based (max=6)**, exactly as the reference — not width-based. At 820/393 the 6 inline tabs scroll inside `.mt`; the More button stays pinned and visible (right edge 366 < 394) |
| Panel remounts on tab change | **Yes** | Tagged the node, switched tab, marker gone, `p0 !== p1`, `animation-name: ixPanelIn` restarts |
| Loading / empty / **error** distinct | **Yes, on all 26 tabs** | Error mode: every tab rendered a named failure block with a retry. **Zero false empty states.** |
| 393px horizontal overflow | **None**, all four routes | `documentElement.scrollWidth === clientWidth === 394`; no uncontained overflow once scroll containers excluded |
| Dark mode | **Correct** | `data-theme=dark` → body `rgb(12,14,17)`, all tokens flip, calendar cells re-tint |
| Token resolution | **53/53 resolve in both themes, 0 fallbacks** | Browser probe + `check-tokens: 0 missing` |
| Hardcoded hex colours | **0 across all 38 files** | Only mentions are in comments explaining their removal |
| Swallowed `catch {}` | **0 across all 38 files** | grep |
| Pricing figures / wrong domain | **None** | grep for pricing patterns and `kartavya.com` |
| Inline styles | Vetana **3**, Vikray **2**, Dristi **3**, Prachar **8** — matches the claims | All are data-driven `--c` / `--w` / `--h` / width carriers, the only correct way to hand a computed value to CSS |

### The "No payroll runs on a failed fetch" bug — eradicated

Driving the stub to 500 on every Vetana tab produced, in order:

> The payroll dashboard did not load. · Salary structures did not load. · Payroll runs did not load. ·
> Payslips did not load. · Loans and advances did not load. · The statutory summary did not load.

Each with the server's own sentence and a **Try again**. None said "No payroll runs". The KPI strip
independently rendered `These figures did not load.` (`role="status"`). The pattern is enforced
structurally by `useResource`/`Resource` (Vetana), `useDristi`/`TabState` (Dristi) and `ErrorState`
(Vikray), which keep `data` null whenever `error` is set — a tab **cannot** collapse the two.

### Owner complaint: "only tab is done not the whole page"

**Not reproduced.** All 26 tabs render full pages. Measured per-tab section/heading counts, e.g.
Vetana dashboard = 3 sections (`Year to date` / `Payroll coverage` / `Department split`, 7 bilingual
pairs); Dristi sales = 3 cards + KPI row; Prachar campaigns = calendar + chips + tray + view switch.
Total 8,489 lines across the 34 tab/helper files.

---

## Per-file verdicts

### Vetana — `frontend/src/pages/`

| File | Verdict | Notes / what differs | Evidence |
|---|---|---|---|
| `VetanaPage.jsx` | **matches** | 4 KPI tiles above the strip in reference order (gross · deductions · net · compliance due); 6 tabs = `MODULE_TABS.vetana` verbatim, Hindi = `TAB_HI` verbatim. Deviation: with no run yet, tile 1 becomes *Headcount* and the rest read "—" rather than ₹0 — deliberate, and better than the reference. | Rendered live; tabs `dashboard मुख्य … statutory अनुपालन`; panel remount confirmed |
| `vetana/_shared.jsx` | **matches** | `useResource`/`useList`/`Resource` keep the three states apart; `errText` surfaces the server's own 403 wording instead of "Failed". | Read; error sweep proved the branch order load→fail→empty |
| `vetana/DashboardTab.jsx` | **matches** | YTD tiles, *Payroll coverage* (names employees with no salary structure — a real gap nothing else surfaces), department split with proportional bar. | Rendered: 3 sections, 7 bilingual pairs, 1 table |
| `vetana/StructuresTab.jsx` | **matches** | Renders one card per structure with effective date and figures. | Rendered 3 rows live (`Aanya Mehta / Effective 2026-04-01`) |
| `vetana/PayrollTab.jsx` | **matches** (content NOT VERIFIED) | Month picker + run history + `runNonce` from the header button. Error and empty states verified; **populated run list NOT VERIFIED** — my stub has no `/payroll/runs` list route, so it correctly showed the empty state. | Error state verified; empty wording correct ("No payroll has been run") |
| `vetana/PayslipsTab.jsx` | **matches** (content NOT VERIFIED) | Same as above — empty + error verified, **populated list NOT VERIFIED**. PDF/disburse are write paths, deliberately not invoked. | Error state verified |
| `vetana/LoansTab.jsx` | **matches** (content NOT VERIFIED) | Header + New loan + list. Error verified; **populated list NOT VERIFIED** (stub field mismatch). | Error state verified |
| `vetana/StatutoryTab.jsx` | **matches** | The statutory calendar tab the brief asked about **exists**: *Compliance calendar अनुपालन* + *Employee-wise register कर्मचारी विवरण*. | Rendered: 2 sections, 3 headings, 7 bilingual pairs |
| `vetana/statutoryCalendar.js` | **matches — exceeds reference** | Reference hard-codes five literal filings. This derives every date from the wage month by named rule (EPF Scheme 1952 para 38; Rule 31A(2) TDS quarters **including the 31-May Q4 exception**) and every amount from live totals. Deliberately omits a PT due date because it is state-specific — refuses to invent a plausible wrong date on a compliance screen. Correct call. | Read in full |

### Vikray — `frontend/src/pages/`

| File | Verdict | Notes / what differs | Evidence |
|---|---|---|---|
| `VikrayPage.jsx` | **differs — deliberate, documented** | **4 tabs, not the reference's 6.** `pipeline` and `customers` were removed because neither has a Vikray endpoint — both are Graha's, and the page lede says so. The file documents this against `Data.jsx:119` ("lifted from staging pages"), i.e. the reference is mirroring the build's *old* tab bar rather than specifying a new one. **Judgement: defensible; flagging it as the one intentional structural divergence in the four modules.** | Read; live tab strip shows 4 |
| `vikray/_shared.jsx` | **matches** | `ORDER_FLOW` = 5 linear states matching the backend's `_VALID_TRANSITIONS`; `previewTotals` explicitly labelled a preview because the server is authoritative on tax. | Read |
| `vikray/DashboardTab.jsx` | **matches — all three claims confirmed** | Status strip counts **do filter**: clicking *Confirmed (2)* switched to Orders and left one row. *Order to cash* table present. *Needs attention* present, naming the stalled order in words ("Kalyan Jewellers — Draft for 36 days"). | Live: `.vk-mix__b` counts 1/2/1/1 with per-status `--c`; filter round-trip measured |
| `vikray/OrdersTab.jsx` | **matches** | Status filter is **server-side** (`params: { status }`), select value propagated from the dashboard count. | Live: select = `draft` then `confirmed`; list filtered accordingly |
| `vikray/OrderRows.jsx` | **matches** | **Five-segment progress bar per row** — `.vko__flow` with exactly 5 children, matching the reference's `FLOW = ['Quote','Sent','Signed','Invoiced','Paid']`. | Live: `segs: 5` on every row |
| `vikray/OrderDetail.jsx` | **matches** | Opens in the **shared `.dr` drawer**, not by replacing the tab: `class="dr vkd"`, `role="dialog"`, `aria-modal="true"`, `position: fixed`, with `dr__scrim`/`dr__head`/`dr__crumb`/`dr__body` chrome — and the tab strip and tab panel **still present behind it**. | Live click on a row |
| `vikray/OrderForm.jsx` | **NOT VERIFIED** | Read only. Exercising it creates an order — a write path, deliberately not invoked. Static read shows `product_id` carried on each line (the omission that used to silently break stock deduction). | Read only |
| `vikray/StockTab.jsx` | **matches** (content NOT VERIFIED) | Low-stock toggle + list. Error state verified; **populated list NOT VERIFIED**. | Error state verified |
| `vikray/TargetsTab.jsx` | **matches** (content NOT VERIFIED) | Target vs actual meters; lede explains actuals come from Graha won deals. Error verified; **populated list NOT VERIFIED**. | Error state verified |

### Dristi — `frontend/src/pages/`

| File | Verdict | Notes / what differs | Evidence |
|---|---|---|---|
| `DristiPage.jsx` | **matches** | 8 tabs verbatim from `MODULE_TABS.dristi`; lede is the reference's **word for word**: "Configure the chart where it sits. No jumping to a separate query console." KPI strip built by pushing, so a withheld source leaves no gap. | Read + live |
| `dristi/_shared.jsx` | **matches — claim confirmed** | **`Bars`, `Funnel`, `Meters` all exist as CSS charts** (the reference's `bar`/`funnel`/`row`), each a few divs whose one data dimension arrives as a custom property, so they inherit theme and density. Each states its own empty case. `RestrictedNote` treats 403 as an ordinary answer, not a fault — correct for a module that reads every other module. | Read; live `.dbars`×2, `.dfun`×1 on the dashboards tab |
| `dristi/OverviewTab.jsx` | **matches** | CRM & Sales + Finance & Orders groups, bilingual throughout. | Rendered: 1 card, KPI groups |
| `dristi/RevenueTab.jsx` | **matches** | Collected-by-month chart + month-by-month card, CSV export. | Rendered: 2 cards; empty wording is specific ("No invoices have been raised in this window.") |
| `dristi/PipelineTab.jsx` | **matches** | Conversion KPIs + funnel + top customers. Funnel never sorts by value — stage order is meaning. | Rendered: 2 cards |
| `dristi/HRTab.jsx` | **matches** | Leave & attendance KPIs + headcount by department. | Rendered: 2 cards |
| `dristi/SalesTab.jsx` | **matches** | Order book KPIs + orders by month + status split + against-target. | Rendered: 3 cards |
| `dristi/ReportsTab.jsx` | **matches** | Scheduled reports (run-now / delete) + export panel that warns an export reads the module its figures come from. | Rendered: 2 cards, live scheduled row |
| `dristi/DashboardsTab.jsx` | **matches — claim confirmed** | **Chart gallery beside a live Configure panel.** | Rendered: `.dbars`×2 + `.dfun`×1 in the gallery, config panel alongside |
| `dristi/PivotTab.jsx` | **matches — claim confirmed** | **Genuine 2-D pivot with row, column and grand totals.** Live grid cross-foots: rows 11,00,000 + 4,70,000 + 1,40,000 = **17,10,000**; columns 6,90,000 + 10,20,000 = **17,10,000**. Missing cells render "—", not 0. Indian digit grouping correct. Build panel carries the load-bearing note that a pivot only aggregates rows your role can already open. | Ran a live query and read the table back |

### Prachar — `frontend/src/pages/`

| File | Verdict | Notes / what differs | Evidence |
|---|---|---|---|
| `PracharPage.jsx` | **matches** | 8 tabs verbatim from `MODULE_TABS.prachar`. Deviation: the reference's Month/Week control and lede sit in the **page header**; here they live on the Campaigns tab, because 7 of 8 tabs are not a calendar and a control that does nothing on the tab you are looking at is worse than none. Documented in-file. Reasonable. | Read + live |
| `prachar/_shared.jsx` | **matches — deviation justified** | Channels are **email / whatsapp / sms**, not the reference's Instagram/LinkedIn/Facebook/WhatsApp, because `prachar_campaigns.channel` really is those three — the channel is *real*, and social publishing belongs to Srijan. Colours are tokens, not the reference's literal brand hexes, because a literal cannot flip by theme and `#0082c6` is the **retired** brand blue. Correct on both counts. | Read |
| `prachar/CampaignsTab.jsx` | **matches — the headline claim confirmed** | **The month calendar exists.** `.pr__cal-grid` with weekday heads `सोम मंगल बुध गुरु शुक्र शनि रवि` — **identical to the reference array**; campaigns land on their scheduled days; `.pr__cal-d.is-today` marks 27. **Week view** (`.pr__week`, "27 Jul – 2 Aug", per-day "Nothing scheduled"). **Unscheduled tray** ("1 campaign with no date"). **Drag to reschedule** fully wired — `draggable`, `onDragStart`/`onDragOver`/`onDrop` → `PATCH /campaigns/{id} {scheduled_at}`, preserving time-of-day across a day move; sent campaigns are non-draggable and say why. **Channel tinting** live (WhatsApp renders distinctly green). Adds a *List* view beyond the reference's Month/Week. | Extensive live measurement; **no drag was actually performed** (write path) |
| `prachar/DashboardTab.jsx` | **matches** | Delivery funnel + campaigns by state + more; four independent regions that fail independently. | Rendered: 4 separate error regions in failure mode |
| `prachar/AdsTab.jsx` | **matches** (content NOT VERIFIED) | Sub-tabs Overview / Campaigns / Insights / AI analysis. Error verified; **populated content NOT VERIFIED**. | Error state verified ×2 regions |
| `prachar/SequencesTab.jsx` | **matches** (content NOT VERIFIED) | Step channels correctly restricted to email/whatsapp/call_task/manual — the old form offered SMS and every such step 400'd. Error verified. | Read + error state |
| `prachar/TemplatesTab.jsx` | **matches** | Category filter + the utility-vs-marketing opt-in warning the reference's Templates note draws. | Rendered live with categories |
| `prachar/AutomationsTab.jsx` | **matches** (content NOT VERIFIED) | Trigger/action list. Error verified. | Error state verified |
| `prachar/UnsubscribesTab.jsx` | **matches** | Copy is exactly right: "Every campaign send is filtered against this list before it goes out, and the skipped count is reported back to you." | Rendered live |
| `prachar/EventsTab.jsx` | **matches** (content NOT VERIFIED) | Status filter + registrations. Error verified. | Error state verified |

---

## Defects found

**No defect was severe enough to warrant a code change, and none was made.** The brief said "fix
only clear defects"; I found none in the 38 files. Two cross-cutting observations, both **outside**
my file scope, are recorded below rather than fixed.

### 1. `lib/tabPanelMotion.js` — panel direction is always `+1` in development

`useTabPanelMotion` writes `prev.current` **during render**. Under `React.StrictMode`
(`frontend/src/index.jsx:46`) React double-invokes render in dev, so the second pass compares
`value` against itself and always yields `dx = 1`. Measured: `overview → sales → overview →
revenue → overview` produced `--ix-dx: 1` on **every** transition; `-1` never occurs. The backward
slide therefore never happens in dev.

In a production build StrictMode does not double-render, so the sign should be correct there —
**I did not verify the production bundle**, so treat that as reasoning, not evidence.

Not fixed because: it is `lib/`, shared by **nine** module pages, outside my four; and the
render-phase write is deliberate and documented (an effect would be one frame late). The correct
fix is probably to derive direction from the previous *committed* value rather than a render-phase
ref. Recommend a separate task.

### 2. `.dr` drawer did not close on Escape (INCONCLUSIVE)

A synthetic `keydown{key:'Escape'}` on `document` did not dismiss the Vikray order drawer, and
clicking `.dr__ico` did not either. This may well be my synthetic event not reaching a handler
bound on `window`, or `.dr__ico` not being the close control. **NOT VERIFIED — do not treat as a
confirmed defect.** Worth one focused check by whoever owns `drawer.css` / the shared drawer.

### Corrections to my own earlier readings

Recorded so they are not repeated: (a) I briefly read `Protected.jsx:85` as `navigate('\login')`
from grep output — `Read` shows `'/login'`; it was a display artifact, **there is no bug**.
(b) I briefly concluded the KPI strip vanishes on error — wrong selector; it renders
`.mk-err` with `role="status"`.

---

## Gates

Run from `frontend/` on this branch, exit codes captured:

```
node scripts/check-tokens.mjs   → 356 declared, 244 referenced, 0 missing      EXIT 0
node scripts/check-classes.mjs  → 3499 selectors, 2690 classes, 0 missing      EXIT 0
npx vite build                  → built in 30.26s                              EXIT 0
npx vitest run                  → 41 files / 665 tests passed                  EXIT 0
grep -ci unhandled              → 0
```

**Baseline 41 files / 665 tests, exit 0 — matched exactly.** No source file was modified in this
pass, so the branch carries only this report.

---

## What remains NOT VERIFIED

Listed plainly rather than papered over:

1. **Pixels.** Screenshots never composited. No claim here rests on visual appearance — only on
   structure, copy and computed layout.
2. **Populated content on 9 tabs** (Vetana payroll/payslips/loans, Vikray stock/targets/order form,
   Prachar ads/sequences/automations/events). Their *loading, empty and error* states are verified;
   their *populated* rendering is not, because my stub's field names diverged from the real API on
   those routes. Each showed a correctly-worded empty state, never an error dressed as emptiness.
3. **All write paths** — create/edit/send/disburse/drag-drop-commit. Deliberately never invoked.
   In particular **no email or WhatsApp was sent**, and Prachar's and Vetana's send paths were read
   but never executed.
4. **Real API contract.** Everything was driven against a stub. Field-name mismatches I hit
   (`total_pf_employee` vs `pf_employee`, `contact_name` vs `customer_name`, `draft_orders` vs a
   nested `status_counts`) were my stub's fault — but they mean **this pass does not prove the
   frontend and the live backend agree on every payload shape.** That needs one run against a real
   staging session, which I could not do without touching the shared database.
5. **Production-build motion direction** (see defect 1).
