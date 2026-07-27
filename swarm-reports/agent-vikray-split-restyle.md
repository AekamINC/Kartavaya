# Vikray (Sales) — split, then styled

Branch `agent/vikray-split-restyle`, based on `staging`.
Spec: `design-handover/27-vikray.md`. Reference: `ScreensBiz.jsx` → `ScreenVikray`.

## Status: done, gates green, verified in a browser

```
cd frontend && node scripts/check-tokens.mjs && node scripts/check-classes.mjs && npx vite build
  check-tokens   344 declared, 239 referenced, 0 missing
  check-classes  2389 selectors, 1668 classes used, 0 missing a rule
  vite build     clean
  vitest         34 files, 565 tests, all passing
```

## The numbers

| | before | after |
|---|---|---|
| `VikrayPage.jsx` | 756 lines | 133 |
| inline styles, whole module | 71 | **3** |
| tab files in `pages/vikray/` | 0 | 8 |
| line-item editors | 2, divergent | 1, shared |

The three survivors are all the custom-property pattern `check-tokens.mjs`
documents as correct — `--c` for a status colour on the progress segments and
the status-mix strip, and a computed `width: %` on the target bar. Nothing that
should be a class is a style.

## Files

```
frontend/src/pages/VikrayPage.jsx          route shell, 133 lines
frontend/src/pages/vikray/_shared.jsx      lifecycle, attention rules, Ganit probe
frontend/src/pages/vikray/DashboardTab.jsx
frontend/src/pages/vikray/OrdersTab.jsx
frontend/src/pages/vikray/OrderRows.jsx    the row, shared by dashboard + list
frontend/src/pages/vikray/OrderForm.jsx
frontend/src/pages/vikray/OrderDetail.jsx  the drawer
frontend/src/pages/vikray/StockTab.jsx
frontend/src/pages/vikray/TargetsTab.jsx
frontend/src/components/LineItemEditor.jsx
frontend/src/styles/module.css             + the `.vk*` block, and `.mt__hi`
frontend/src/styles/drawer.css             `.dr__lbl-hi`
```

## What each tab does now

**Dashboard** was four counts with nothing to do about any of them. It is the
reference's composition: a status strip whose counts *filter the order list*,
an "Order to cash" table with a five-segment progress bar per row, and a
"Needs attention" panel naming in plain language the orders that have stopped
moving. Every row is a real order from `/v1/vikray/orders`.

**Orders** — toolbar, create form, list, drawer. The row is a real `<button>`,
which is what the reference renders; the build had a `div` with an `onClick`,
not focusable and with no role.

**Order detail** moved from replacing the whole tab to the shared `.dr` drawer
(27 §6) — same scrim, focus trap, Escape and exit as the task drawer, so "open
this record" has one meaning in this product instead of two. Full-screen below
1024. Status is the five-state pipeline, not a button whose label changes
(§3). Cancel is behind `ConfirmDialog` (§79). Client totals are labelled
"estimated" and disappear once the server's figures exist (§5).

**Stock** — low rows carry a `--warn` keyline, not just a badge (§8). The
threshold field says whether it saved. A real quantity + reason dialog replaces
forty clicks of `+1`. Expanding a product reads its movement history.

**Targets** — quarter presets, a real person picker, a current-period standing
from the leaderboard endpoint, inline edit, confirmed delete.

## Four live defects found while building

1. **Stock never moved.** `fillFromProduct` copied description, HSN, rate, GST
   and unit from the catalogue and dropped `product_id`. `_apply_stock_moves`
   (`routers/vikray.py:128`) `continue`s on any line without one, so confirming
   an order deducted nothing — the Stock tab read zero for every product,
   forever. It looked empty rather than wrong, which is why it survived.
   Verified fixed in the browser: the picker now writes `product_id` first.

2. **Edit was offered on `confirmed` orders.** `PATCH /orders/{id}` refuses
   anything but a draft (`:244`), so that button could only ever 400.

3. **The status filter offered `cancelled`.** `DELETE` sets `is_active=FALSE`
   and `GET /orders` filters on it, so that option could only ever return
   nothing — and an always-empty filter reads as "you have no cancelled
   orders", which is a claim this endpoint cannot make. Removed.

4. **`TargetsTab` loaded `/teams` as its person list.** That endpoint returns
   *teams* — the same one `ProjectsPage` reads as its project list — into a
   `members` state that was never rendered, behind a free-text "User ID" box.
   It reads `GET /v1/org/members` now and states plainly why the picker is
   unavailable when a non-admin gets the 403.

## Two endpoints that shipped with no caller, now wired

- `GET /v1/vikray/stock/{id}/moves` — every adjustment was written to an audit
  trail nobody could read.
- `GET /v1/vikray/targets/leaderboard` — the current-period standing, which is
  the question a sales lead opens that tab to ask.

## Cross-page defects fixed in passing

Both were visible on this page, in files this page was already editing.

- **`.dr__lbl-hi` had no left margin**, and worse: `.dr__lbl` tracks at `.15em`
  and the Devanagari zeroes it, so ~1.4px was the entire gap. "CUSTOMERग्राहक"
  in every drawer label, the task drawer's eight included.
- **`.mt__hi` had the same defect** — every module tab rendered as
  "Dashboardमुख्य" — and I fixed it with a `margin-left: 6px`. **Another agent
  in this run found it independently and fixed it better**, with
  `display: inline-flex; gap: 7px` on `.mt__b`, which spaces the Devanagari
  *and* the count from one declaration. The two do not override each other — a
  flex gap and a margin add, and the pair produced 13px. Resolved on the merge
  in their favour; mine is dropped. Measured after merging: 7px, not 13.

## Verified against a live render, not read

Own vite server on **5271** (the shared one on 5173 belongs to another agent),
own tab, `location.href` asserted on every read. API stubbed at the network
layer with fixtures copied field-for-field from `routers/vikray.py` — the real
components, the real CSS, no database touched and no write endpoint exercised.

- all four tabs, the drawer, the create form
- 393px: no horizontal overflow (`scrollWidth` 394 = `innerWidth` 394); order
  rows reflow to cards; line items reflow to cards
- **every vikray read returning 500** → `DashboardTab` shows an error and a
  retry, *not* an endless shimmer; `TargetsTab` shows the error, *not* "No
  targets set". Both original defects confirmed dead.
- **Ganit returning 403** → the invoice action is absent and the drawer says
  why, in words, naming who can grant it (§11).

Screenshots: `swarm-reports/_shots/vikray-*.png`, with the rendered reference
beside them.

## Settled decisions, do not revert

- **Four tabs.** The reference's `MODULE_TABS.vikray` lists six, but
  `Data.jsx:119` records that those structures were "lifted from staging
  pages" — it mirrors the build's *old* tab bar rather than specifying a new
  one. `cae0e0a` removed `pipeline` and `customers` because neither has a
  Vikray endpoint; both are Graha's and the page lede says so.
- **The status pipeline is read-only.** The only legal move is the next one and
  the server enforces it; a clickable segment that 400s on four of its five
  targets teaches the user the control is broken.
- **Server figures are authoritative.** The client preview is labelled and is
  never shown once a stored figure exists.

## Left alone deliberately

`useTabPanelMotion` returns `{ key, style }` and all nine module pages spread
the pair straight onto the panel. React 19 refuses a `key` inside a spread and
**drops it** — so the panel reconciles in place and the enter animation never
restarts, which is the entire purpose of the hook. Fixed in `VikrayPage.jsx`;
the other eight need the same two lines and that is a separate diff.

The backend's invoice RBAC hole named in the brief — `platform_staff` minting
tax invoices through the sales module — **was already closed** before this run:
`routers/vikray.py:37` stacks `require_module("ganit")` on the endpoint, with a
docblock explaining why. Nothing to do there. This branch adds the front-end
half so the user is not told by a 403.
