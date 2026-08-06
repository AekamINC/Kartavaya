# Vikray — Sales · विक्रय

## Prerequisites
- `00-tokens.md`
- `02-common-components.md` — DataTable, Badge, Empty, Shimmer, form controls
- `13-module-pages.md` — the shared module page frame
- `04-boards-table-views.md` — table interactions this page reuses

## Files to modify
- `frontend/src/pages/VikrayPage.jsx` — 26,466 bytes, four tabs, one of which crashes
- `frontend/src/lib/statusColors.js` — `ORDER_COLORS` already exists; align it to `00` §9

## Files to create
- `frontend/src/pages/vikray/TargetsTab.jsx` — **restored upstream**; move the recovered file here
- `frontend/src/components/LineItemEditor.jsx` — one editor, currently written twice
- `frontend/src/pages/vikray/OrderDetail.jsx` — extracted from the 400-line `OrdersTab`

## Estimated scope
~1 page split into 5 files, 2 new shared components. The crash is already fixed upstream.

---

## 0 · Fixed upstream — the Targets tab threw

```jsx
const TABS = ['dashboard', 'orders', 'stock', 'targets'];
…
{tab === 'targets' && <TargetsTab />}
```

`TargetsTab` was **not defined in this file and not exported from anywhere in `frontend/src`**, while `'targets'` stayed in `TABS` and `<TargetsTab />` stayed in the render. Clicking *Targets* was an uncaught `ReferenceError` that took down the page.

**Fixed on `staging`.** Commit `cae0e0a` had set out to drop the two tabs duplicating Graha — pipeline and customers — and removed a third component with them. The 135-line implementation was recovered from `cae0e0a^` rather than rewritten, and its tokens were corrected on the way back in per this file: `#10b981` → `var(--ok)`, `var(--k-primary)` → `var(--primary)`, emoji removed.

The crash fix is **not** the restyle work below. The split into `vikray/`, the single `LineItemEditor`, the detail drawer and the `ConfirmDialog` on cancel are all still open.

**What it should be**, if built: quarterly revenue target vs actual per salesperson, sourced from the same `/v1/vikray/dashboard` figures the first tab already pulls. A target is a number, a period and an owner — one table, one inline-editable column, one progress bar per row. It does not need a new endpoint family — `/v1/vikray/targets` already carries GET, POST, PATCH and DELETE, plus `/targets/leaderboard`.

## 1 · What this module actually is

Sales orders, stock and targets. **Not** customers and **not** pipeline — those live in Graha (CRM), and the page header says so. The distinction matters because "Sales" invites scope creep toward CRM, and the two modules already have a clean seam: `OrdersTab` reads `/v1/graha/contacts` for the customer dropdown and `/v1/ganit/products` for line items, but owns neither.

Three cross-module dependencies, all one-directional:

| | |
|---|---|
| Graha | `GET /v1/graha/contacts` — customer picker |
| Ganit | `GET /v1/ganit/products` — line-item autofill (name, HSN, rate, GST rate, unit) |
| Ganit | `POST /v1/vikray/orders/{id}/invoice` — an order becomes an invoice |

That last one is the module's reason to exist. An order that cannot become an invoice is a note.

## 2 · Already fixed — do not redo

Commit `cae0e0a` landed before this spec was written and **already removed two of the defects the ledger attributes to this file.** Verified in source:

```jsx
import { ORDER_COLORS } from '../lib/statusColors';
import { inr } from '../lib/inr';
const STATUS_COLORS = ORDER_COLORS;
const FMT = inr;
```

The private ninth hex map is gone — its `confirmed` was `#0082c6`, the retired blue — and the local Indian-digit-grouping function is gone. `lib/statusColors.js` and `lib/inr.js` both exist.

**This changes two other files.** `14-dark-mode.md` proposes creating `lib/statusColors.js`; it is already there, so that work is *aligning `ORDER_COLORS` to `00` §9*, not authoring. Check what `ORDER_COLORS` currently holds before assuming either.

## 3 · The order lifecycle

```jsx
const NEXT_STATUS = { draft: 'confirmed', confirmed: 'dispatched', dispatched: 'delivered', delivered: 'closed' };
const NEXT_LABEL  = { draft: 'Confirm Order', confirmed: 'Mark Dispatched', dispatched: 'Mark Delivered', delivered: 'Close Order' };
```

Five states, strictly linear, one forward action at a time. This is good and should be **shown as a pipeline, not a button** — the same `StatusBar` treatment as the task drawer (`03-task-drawer.md` §4), so a user sees where an order sits and what remains, rather than a single button whose label changes.

Rules already encoded, keep them:

- Invoice only after `draft`, and only once — `o.status !== 'draft' && !o.invoice_id`
- Edit and Cancel only in `draft` or `confirmed`. After dispatch, an order is a shipped fact
- Cancel is `DELETE`, and it is **not confirmed**. Add `ConfirmDialog` — this is the destructive action most likely to be hit by mistake, since it sits beside Edit

```css
.vk-pipe{display:flex;align-items:stretch;width:100%;border-radius:var(--r-sm);overflow:hidden;border:1px solid var(--outline-variant)}
.vk-pipe__s{flex:1;padding:8px 10px;font-size:11.5px;font-weight:600;text-align:center;background:var(--s-low);color:var(--on-surface-3);position:relative}
.vk-pipe__s--done{background:color-mix(in srgb,var(--ok) 16%,transparent);color:var(--on-surface-2)}
.vk-pipe__s--now{background:var(--primary);color:var(--on-primary)}
.vk-pipe__s+.vk-pipe__s{border-left:1px solid var(--outline-variant)}
.vk-pipe__s--cancelled{background:color-mix(in srgb,var(--danger) 14%,transparent);color:var(--danger)}
```

## 4 · The line-item editor is written twice

`OrdersTab` contains two independent implementations of the same thing:

| | Create form | Edit form |
|---|---|---|
| Grid | `2fr 1fr .8fr .8fr 1fr .8fr auto` (7 col) | `2fr 1fr .8fr 1fr .8fr auto` (6 col) |
| Product picker | yes | **no** |
| Live line amount | yes | **no** |
| Input class | `k-formpanel__input` | `k-input` |
| Add/remove | `addLine` / `removeLine` / `updateLine` | `editAddLine` / `editRemoveLine` / `editUpdateLine` |

Same data shape, same seven fields, two divergent editors — so editing an order silently loses the product picker and the running total. Extract one `<LineItemEditor value onChange products />` and use it in both. That deletes six functions and one of the two grids.

**The grid has no mobile form.** Seven columns at `.8fr` on a 393px screen is unusable. Below 768px each line item becomes a card: description full width, then a 3-up row of qty / rate / GST, with the amount right-aligned in the card footer.

```css
.vk-li{display:grid;grid-template-columns:2fr 1fr .8fr .8fr 1fr .8fr auto;gap:8px;align-items:end}
@media(max-width:767px){
  .vk-li{grid-template-columns:repeat(3,1fr);gap:7px;padding:11px;border:1px solid var(--outline-variant);border-radius:var(--r-sm);background:var(--s-low)}
  .vk-li__desc{grid-column:1/-1}
  .vk-li__amt{grid-column:1/-1;text-align:right;font-family:var(--font-mono);font-weight:600;padding-top:4px;border-top:1px solid var(--outline-variant)}
}
```

## 5 · Money is computed in two places

The create form computes `computedSubtotal`, `computedGst`, `computedTotal` client-side. The detail view reads `o.subtotal`, `o.cgst`, `o.sgst`, `o.igst`, `o.total` from the server. Two implementations of GST arithmetic on the same order, and they can disagree — the client applies `discount_pct` per line then a flat `discount`, and nothing guarantees the server does the same in the same order.

**The client figure is a preview, and must be labelled as one.** Render it as "Estimated total" until the order is saved, then show only server values. The alternative — making the client authoritative — puts tax arithmetic in a place you cannot audit.

CGST/SGST vs IGST is already correct: `is_igst` splits inter-state from intra-state, which is the one piece of GST logic that must not be got wrong.

## 6 · Detail is a page replacement, not a drawer

```jsx
if (detail) { … return <div><BackButton …/>…</div>; }
```

The whole tab is replaced. Everywhere else in the product, opening a record opens a **drawer** over the list (`03-task-drawer.md`). Two navigation models for "open this row" is a learned inconsistency.

Use the drawer at ≥1024px, and a full-screen push below it — which is what the drawer already does on mobile, so the current behaviour becomes the mobile branch rather than being thrown away.

## 7 · Token dialect

This page is on the legacy vocabulary: `--ink-2`, `--ink-3`, `--rule-soft`, `--k-primary`, `--k-btn`, `--k-input`. Map per `00` §2:

| Legacy | Target |
|---|---|
| `--ink-2` | `--on-surface-2` |
| `--ink-3` | `--on-surface-3` |
| `--rule-soft` | `--outline-variant` |
| `--k-primary` (as text) | `--primary-text` |
| `.k-btn.k-btn--primary` | `.btn.btn--fill` |
| `.k-btn.k-btn--ghost` | `.btn.btn--ghost` |

Note `style={{ background: 'var(--ok)' }}` on the Generate Invoice button — a semantic token used as a brand fill. Invoice generation is a primary action, not a success state; use `.btn--fill`.

`Empty icon="📦"` — the design system has no emoji. Use the outline glyph set from `02`.

## 8 · Stock tab

Simpler and mostly sound. Three real issues:

**Threshold saves on `onBlur` with no feedback.** Tab out of the field and a PATCH fires silently; if it fails you get a toast with no indication of which row. Use the inline save state from `02` (`.is-loading` → `.is-saved`), on the field.

**`+1` / `−1` only.** `adjust(productId, ±1, reason)` — reconciling a delivery of 40 units is forty clicks. Keep the steppers for correction, add a quantity + reason dialog for real adjustments. The `reason` field is already in the API (`'restock'`, `'manual_adjustment'`) and is not surfaced.

**"Low Stock" is a Badge inside a `<td>` beside the name.** It should also mark the row — `.is-low` with a `--warn` left keyline — because the scan pattern here is "which rows need me", not "read every name".

## 9 · Component tree

```
VikrayPage
├─ PageHeader (title, sanskrit, lede)
├─ TabBar ['dashboard','orders','stock','targets']
├─ DashboardTab      → 2 Sections × 4 StatTile · GET /v1/vikray/dashboard
├─ OrdersTab
│  ├─ toolbar: status <select> · "+ New Order"
│  ├─ OrderForm      → LineItemEditor · estimated totals · POST /v1/vikray/orders
│  ├─ list           → ModCard per order (number, customer, date, total, Badge)
│  └─ OrderDetail (drawer ≥1024, push <1024)
│     ├─ vk-pipe     → 5 states
│     ├─ actions     → advance · invoice · edit · cancel(confirm)
│     ├─ DataTable   → line items
│     ├─ k-totals    → subtotal · CGST/SGST | IGST · discount · total
│     └─ OrderEdit   → LineItemEditor (same component)
├─ StockTab          → DataTable · low-stock filter · threshold · adjust
└─ TargetsTab        → restored · /v1/vikray/targets + /targets/leaderboard
```

## 10 · Endpoints

| Method | Path | Used by |
|---|---|---|
| GET | `/v1/vikray/dashboard` | Dashboard |
| GET | `/v1/vikray/orders?status=` | Orders list |
| POST | `/v1/vikray/orders` | Create |
| GET | `/v1/vikray/orders/{id}` | Detail |
| PATCH | `/v1/vikray/orders/{id}` | Edit |
| PATCH | `/v1/vikray/orders/{id}/status` | Advance |
| POST | `/v1/vikray/orders/{id}/invoice` | → Ganit |
| DELETE | `/v1/vikray/orders/{id}` | Cancel |
| GET | `/v1/vikray/stock?low_stock=` | Stock |
| PATCH | `/v1/vikray/stock/{id}` | Adjust / threshold |
| GET | `/v1/graha/contacts` | Customer picker |
| GET | `/v1/ganit/products` | Line-item autofill |
| GET · POST · PATCH · DELETE | `/v1/vikray/targets` | Exists, with `/targets/leaderboard` and `staging.vikray_targets`. An earlier draft of this file listed it as missing — it was not |

## 11 · RBAC

Vikray is not in the sensitive set (Vetana, Ganit, Manav) — see `RBAC-SPEC.md`. But `POST /invoice` reaches into Ganit, which **is** sensitive. A user with Vikray access and no Ganit access can currently mint an invoice they cannot then see. Gate the invoice button on Ganit write, and say why when it is hidden — a disabled button with no reason is worse than an absent one.

## 12 · Before → after

| File | Change |
|---|---|
| `VikrayPage.jsx` | Split into `vikray/`. `TargetsTab` is restored — move it, do not rebuild it. One `LineItemEditor`. Detail → drawer. Legacy tokens → `00` §2. `ConfirmDialog` on cancel. Client totals labelled "estimated". No emoji |
| `lib/statusColors.js` | `ORDER_COLORS` → `00` §9 pairs, both themes. Already the single source; only the values need aligning |
| `lib/inr.js` | No change — already shared |
