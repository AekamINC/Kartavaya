# Vikray · pipeline + customers — restored from the approved design

Branch `feat/vikray-pipeline-customers`, cut fresh from `origin/staging` at
`71d93426`. Frontend and backend, both tabs.

---

## 1. The disputed judgement, and why it was wrong

`VikrayPage.jsx` shipped four tabs behind a comment arguing the reference's six
were a stale mirror of an old tab bar, and that `pipeline` and `customers`
belong to Graha. I read the reference before touching anything. The argument
does not survive it.

| Evidence | What it says |
|---|---|
| `Data.jsx:125` | `vikray: ['dashboard','orders','stock','pipeline','targets','customers']` |
| `Data.jsx:119` | The tab structures were lifted from staging **"— nothing dropped"** |
| `Data.jsx:139` (`TAB_HI`) | `customers: 'ग्राहक'`, and `pipeline: 'प्रवाह'` at `:18` |
| `ScreensBiz.jsx:142` (`ScreenVikray`) | **opens** on `tab: 'pipeline'` |

Two points decide it:

- **`:119` is an instruction, not an excuse.** The previous note cited "lifted
  from staging pages" as proof the list was stale. The rest of that same
  sentence is *"— nothing dropped"*. It is a commitment to preserve the set.
- **Devanagari labels exist for both.** Nobody writes `ग्राहक` for a tab they
  intend to delete.

On the substantive claim that both are Graha's:

- **Pipeline is not Graha's.** Graha's is a CRM *deal* board. The reference
  draws `FLOW = ['Quote','Sent','Signed','Invoiced','Paid']` over `QUOTES` with
  `st: draft|sent|viewed|signed|invoiced` — a sales document moving to cash.
  Different object, different module.
- **Customers is not Graha's either.** Graha owns the *contact* — who they are,
  who owns the relationship, how warm the lead is. Vikray owns the *trading
  history* — what they ordered, how much, when last, what is still open.

The "no endpoint behind it" half of the old argument was true and is now
answered rather than argued with: both endpoints exist.

---

## 2. Backend — two new reads

`backend/routers/vikray.py`. Same `_gate = require_module("vikray")`, same
`require_user` / `get_org_id`, same `{"data": [...]}` envelope as every other
list route in the file (checked: the neighbours all use the envelope).

### `GET /v1/vikray/pipeline`
Returns `{"data": [...orders...], "stages": [...]}`.

- Stage aggregates are computed over **every** active order, not over the
  `LIMIT 400` row list. A stage total derived from a truncated page is a wrong
  rupee figure that looks like a right one.
- All five lifecycle stages are always present, even at zero — a board whose
  columns vanish as orders move reads as a bug in the funnel.

### `GET /v1/vikray/customers?q=`
Per-party rollup: order count, order value, last order date, open orders,
invoiced orders. `GROUP BY` over `vikray_orders`. Search is a bound parameter.

### No new storage
Both derive entirely from tables that already exist. **No migration was written
and none is needed.** I re-read the live catalogue rather than any migration
ledger (`information_schema`, project `toacecaewujfxjfrjwco`, schema `staging`)
and confirmed `vikray_orders` carries `status`, `total`, `invoice_id`,
`expected_delivery`, `contact_id`, `is_active`.

Worth recording for whoever picks up quotes properly: **there is no quote entity
in `vikray_orders`.** The reference is quote-shaped and the build is
order-shaped. The five stages here are the order lifecycle from
`_VALID_TRANSITIONS`, which is the same quote→cash line the design draws, named
for the objects this build actually stores. A true `Sent`/`Viewed`/`Signed`
pipeline would read `ganit_invoices` (`invoice_type`, `estimate_status`,
`sent_at`, `viewed_at`, `converted_invoice_id`) — which is **Ganit**, a
SENSITIVE module, and would require stacking `_ganit_gate` exactly as
`POST /orders/{id}/invoice` already does. I did not do that: it would make the
pipeline tab 403 for every vikray-only member, which is a product decision, not
a build decision. Flagged, not taken.

### The leak I was told not to reproduce
A peer found `/pipeline` and `/sales` on Dristi reading `graha_deals` with no
source-module check. Asserted against directly:

- **Neither endpoint touches `graha_deals`.** Test:
  `test_pipeline_never_reads_the_crm_deal_board`.
- The only Graha table either reads is `graha_contacts`, joined for a party
  **name** on an order that already belongs to this org — which `GET /orders`
  has returned behind this same gate since the module shipped. No new exposure.
- `/customers` does not select `lead_score`, `assigned_to`,
  `last_contacted_at`, `converted_at` or `tags`. Test:
  `test_customers_does_not_select_crm_relationship_columns`.

### One hardening beyond the neighbours
`GET /orders` joins contacts on `c.id = o.contact_id` alone. Both new queries
add `AND c.org_id = o.org_id`, so a `contact_id` that ever pointed outside the
tenant cannot pull a foreign row into the answer. Costs nothing; asserted in
`test_every_query_is_org_scoped`. This is a deliberate deviation from the
neighbouring style — flagging it so it reads as intent, not drift.

---

## 3. Frontend

- `TABS` is now the design's exact order:
  `dashboard, orders, stock, pipeline, targets, customers`.
- `pages/vikray/PipelineTab.jsx`, `pages/vikray/CustomersTab.jsx` — same idiom
  as the existing tabs (`SkeletonRegion` / `ErrorState` / `Empty`, `rows()`,
  `inr`, `ORDER_LABELS`).
- Both **reuse `OrderRows`**, the component Dashboard and Orders already
  render, so the three tabs cannot disagree about what an order looks like.
- The page lede said *"Customers and pipeline live in Graha (CRM)"*. That
  sentence was false once the tabs existed, so it is replaced.

**Distinct from the tabs that already exist.** Dashboard answers "what needs
me" (status counts that jump to Orders, plus the stalled list); Orders is the
list and its CRUD. Neither answers "how much is in each stage", which is what a
pipeline is opened for. So the board is **value** per stage, it filters in
place rather than navigating away, and it includes `closed`.

### Styling
New `frontend/src/styles/vikray.css` (prefixes `vk-pl__`, `vk-cu__`).

The brief said this file existed and was already imported — **it did not exist
in this tree.** Vikray's existing classes live in `module.css`. I created the
module sheet rather than adding to `module.css` precisely because that file is
shared with the four sibling agents. The one line touching shared CSS is the
`@import './vikray.css'` in `index.css`, which is how `graha.css`, `ganit.css`
and the rest register — it appends a line rather than editing any rule.

### Inline styles
Module was at 2 (`DashboardTab` `--c`, `TargetsTab` a raw `width: %`), plus
`OrderRows` `--c`. I added **one**, and it is a custom property
(`style={{ '--c': orderColor(s.stage) }}`) feeding a rule in `vikray.css`.
**Zero raw CSS property values added.**

---

## 4. Loading / empty / ERROR are three states

The named defect. Both tabs hold their data as `null` until a load **succeeds**;
`err` is separate state; the empty branch is unreachable on failure.

Verified twice — in tests, and in a real browser.

| | loading | 200 + rows | 200 + none | 500 | 403 |
|---|---|---|---|---|---|
| **Pipeline** | skeleton, `aria-busy` | board + 5 rows | "No orders in the pipeline" | `role=alert` `data-kind=server`, "Try again" | `data-kind=denied`, "Request access" |
| **Customers** | skeleton, `aria-busy` | 4-row table | "No customers yet" | same | same |

In every failure case the empty sentence is **absent** — asserted, not eyeballed.

---

## 5. How it was verified without touching the database

- Own vite on **:5188** (`--strictPort`), nobody else's. `tabs_context` first;
  peers held 5220/5461/5477/5611/5612/5700/5877 and **none were closed**.
  Never :5173.
- Loopback stub API on **:5199** (scratchpad, not in the repo) with a
  `/__mode/<ok|empty|error|denied|hang>` switch.
- Gitignored `frontend/.env.local` points `VITE_BACKEND_URL`,
  `VITE_SUPABASE_URL` and every other outbound URL at `127.0.0.1`, so
  staging/production was **physically unreachable** for the whole run.
- Database access was **read-only**: `information_schema` only. No writes, no
  migrations. No email, WhatsApp or push — the stub answers everything.
- `node_modules` was a **junction to the main checkout** (`package.json` and
  `yarn.lock` verified byte-identical first), so no install ran and no lockfile
  was rewritten.

**Screenshots did work here**, contrary to the warning — but `zoom` region crop
is unsupported and the capture renders too small to read text, so it confirms
gross layout only. **Every precise claim above comes from `javascript_tool`
computed-layout and DOM inspection, plus `read_page`**, not from the image.

---

## 6. Responsive — and a real defect found

At **1280** and **820**: no page overflow, all six tabs inline, no More
popover, board reflows 6→5 columns.

At **393**: no page-level horizontal overflow, board reflows to 2 columns,
nothing in `.vk-pl` extends past the viewport — **but the tab strip itself
clips.** 347px hidden; only `dashboard`, `orders`, `stock` are reachable.
`pipeline`, `targets` and `customers` sit behind a horizontal scroll with
`scrollbar-width: none`.

**This is pre-existing and systemic, not introduced here.** `/vetana` — six
tabs, untouched, already on staging — hides **354px** and **4 of 6** tabs at the
same width. Root cause: `ModuleTabs` defaults to `max = 6`, so the More popover
only engages at **seven** or more tabs; at exactly six the strip falls back to
the `overflow-x: auto` behaviour that ModuleTabs' own docblock calls *"present
in the DOM, absent from the product"*.

My change does move Vikray into the affected set (four tabs fit at 393px, six
do not). I did **not** fix it: the fix is a responsive `max` in `ModuleTabs`
plus `module.css`, both shared with the four sibling agents. A peer had already
filed chip `task_d2c5197b` for it, so I withdrew my duplicate and recorded the
root cause here.

---

## 7. Gate results (exact)

| Gate | Baseline | After |
|---|---|---|
| `check-tokens.mjs` | 0 missing | **0 missing** (356 declared, 244 referenced), exit 0 |
| `check-classes.mjs` | 0 missing | **0 missing** (3517 selectors, 2707 used), exit 0 |
| `vite build` | — | **exit 0**, built in 24.47s |
| `vitest run` | 41 files / 665 tests | **42 files / 675 tests, exit 0, unhandled: 0** |
| `pytest -q` | 1465 passed, 31 skipped | **1475 passed, 31 skipped, 0 failed** |

+10 frontend tests (`pages/vikray/__tests__/vikrayTabStates.test.jsx`),
+10 backend tests (`tests/test_vikray_pipeline_customers.py`). No test modified.

`vk-pl__st` appears in check-classes' *unused* report. That is the interpolated-
className limitation the script documents; existing `vk-att__i`, `vko__seg` and
`vk-tg__fill` sit in the same list. Report-only, does not fail.

---

## 8. What I did NOT verify

- **Neither endpoint has ever executed against real data.** Every backend test
  runs on `mock_pool`, and every browser check ran against the stub. The SQL is
  asserted for org-scoping and for which tables it touches, **not** for
  returning correct rows from a live `staging` schema. First run against real
  data is unexercised — most likely failure would be a column-name or
  `Decimal`-serialisation surprise in the `GROUP BY`.
- **No cross-tenant test with two real orgs.** Scoping is asserted on the query
  text, matching the documented `test_finance_cross_org.py` approach, not by
  observing a denial.
- **The module gate was overridden in every behavioural test.** I assert `_gate`
  is *attached* to both routes (`test_route_carries_the_vikray_module_gate`,
  which also proves they are mounted) but never observed a real 403 from a
  member genuinely lacking the vikray grant.
- **`q` search is untested against real ILIKE data** — only that the term is
  bound rather than inlined.
- **No dark-theme or contrast check** on the new surfaces. Tokens are reused
  from `module.css`, so they should inherit, but I did not measure.
- **The customers row disclosure** was exercised against a stub that ignores
  `contact_id`, so it returned all orders. The filtering itself is the existing
  `/orders?contact_id=` parameter and was not verified end to end.
- **Screenshot legibility** — see §5. Layout claims come from computed values.
