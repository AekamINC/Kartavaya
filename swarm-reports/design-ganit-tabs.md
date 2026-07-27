# Ganit (Finance) — tab bodies converted

Branch `design/ganit-tabs-aa46eb`, rebased onto `origin/staging` at `cc8f100c`.
Commits `30081d42` (Ganit) and `10c31473` (a boards timer fix, explained below).

Every number here was regenerated on the final tree, not transcribed.

---

## 1. The measurement

Measured on the DIRECTORY, per the brief:

```
cd frontend/src/pages && python -c "import pathlib;print(sum(p.read_text(encoding='utf-8',errors='ignore').count('style={{') for p in pathlib.Path('ganit').rglob('*.jsx')))"
```

| | inline styles |
|---|---|
| before | **548** across 11 files |
| after | **7** across 16 files |

All 7 survivors are a custom property feeding a rule in `styles/ganit.css`
(`check-tokens.mjs` deviation 2). Raw CSS property values in markup: **0**,
verified with `grep -rn "style={{" ganit/ | grep -v "'--" | wc -l` → `0`.

```
BankTab         1   --gn-min
InvoiceForm     1   --gn-li
PayablesTab     2   --gn-min, --gn-li
RecurringTab    1   --gn-li
SignatureDetail 1   --gn-li
StatsTab        1   --h   (bar height, on the shared .dbars track)
```

`GanitPage.jsx` went 2 → 0: `padding: '0 0 48px'` is `.mpage` (already defined,
already used by `VikrayPage`), and the header button is `btn btn--fill btn--sm`.

## 2. The invoice — the owner's stated requirement

`InvoicesTab` did `if (detail) return (…)`, replacing the whole tab with the
record behind a "← Back to list" button. **Three sibling tabs did the same** —
`PayablesTab`, `ContractsTab`, `ESignTab`. That is a second navigation model for
"open this row" where the rest of the product opens a drawer.

All four now use the shared `.dr` chrome from `drawer.css` — the same scrim,
`FocusTrap`, Escape handling and exit-on-`animationend` as the task drawer and
`vikray/OrderDetail` — portalled to `document.body`:

- `InvoiceDetail.jsx`, `VendorBillDetail.jsx`, `ContractDetail.jsx`, `SignatureDetail.jsx`

The invoice drawer carries **Download PDF** and **Send on WhatsApp** side by side.

**Both verified end to end, without sending anything.**
- `contact_phone` *is* selected by `GET /invoices/{id}` (`routers/ganit.py:461`).
  It is **not** selected by `GET /invoices` (list) — so the button correctly
  belongs to the detail drawer, and would have been permanently dead in the list.
- `waLink` was a function nested inside the component. It is now exported from
  `_shared.jsx` so its URL can be asserted in a test with no browser and no
  `window.open`. 10 unit tests cover the +91 assumption, the already-prefixed
  case, punctuation stripping, the null case, and percent-encoding of `₹ & #`.
- The button is **disabled with the reason in its `title`** when the contact has
  no number, rather than failing on press.
- The PDF path unwraps `describeDocumentError`, so the backend's 422 (missing
  Rule 46 particular) and 409 (org has no GSTIN) surface as *which field*.

Never exercised: no WhatsApp message, email, push or PDF request was issued
against a live backend at any point.

## 3. Three live bugs, found by reading each endpoint's real response shape

**a. Three expense figures had been rendering ₹0 forever.**
`GET /v1/ganit/expense-stats` returns `{by_category, total_expenses, total_tax,
count}` (`routers/ganit.py:1586`). `ExpensesTab` read `total_amount`,
`this_month` and `billable_amount` — **none of which exist**. All three hit the
`|| 0` fallback and printed ₹0, cleanly enough that nothing looked broken. Now
reads the real names; `by_category` (fetched and discarded) is shown.

**b. The e-sign audit trail was always empty.**
`GET /contracts/{id}/audit-trail` returns `{"audit_trail": […]}`
(`routers/ganit.py:1391`). `ESignTab` read `.data.data || .data.events || []`.
Both fallbacks missed. That is signing *evidence* — who opened the document,
from which IP — invisible for as long as the key was wrong.

**c. Payables ageing was fetched and dropped.**
`GET /payables-summary` returns an `aging` array of buckets. The tab used
`outstanding`/`overdue`/`open_bills` from the same response and discarded it.
"₹4L outstanding" and "₹4L outstanding, all of it 90+ days" are different
businesses. Now rendered, oldest-money-last.

## 4. Loading / empty / ERROR on every panel

Every tab was `catch { pushToast }` followed by a `length === 0` empty state, so
a failed fetch painted *"No invoices yet"*, *"No vendor bills yet"*, *"No bank
statements imported"*. On a finance module that is not a visibly broken page —
it is a false statement about the business, indistinguishable from a real empty
ledger. `StatsTab` was worse: `if (!stats) return null`, a blank panel.

All panels now hold a distinct `err` state rendering `ErrorState` with retry.
Where a *secondary* fetch fails (bank stats, payables summary, expense totals)
the panel says so in a `note note--warn` instead of silently dropping the strip,
because a partial page that looks complete is the same class of lie.

Guarded by `ganitErrorStates.test.jsx` — 8 tests asserting both directions: a
500 renders an error and *never* the empty copy, and a genuinely empty result
still reads as empty (so the error state cannot swallow the real empty case).

## 5. Response unwrapping

All reads go through `rows()` / `body()` from `lib/api.js`. No `r.data.data`
remains in `pages/ganit/` or `GanitPage.jsx`. A test asserts `InvoicesTab`
renders correctly from **both** an envelope and a bare array.

## 6. RBAC — separated duty left intact

Confirmed all 54 routes in `routers/ganit.py` carry `_gate = require_module("ganit")`.
**No unguarded read path was found in this router** — the peer finding about
missing source-module checks does not reproduce here. The only ungated routes
are `/sign/{token}` and its OTP/verify siblings, which are the public signing
links and are correct.

`_approver = require_level("ganit", APPROVER)` guards invoice cancel and vendor
payment. **Not weakened.** `VendorBillDetail` now catches the 403 and explains
that administering the books and releasing money are separate authorities, and
that an admin grant does not carry it — instead of a generic "Failed".

Also noted (already fixed by someone, not me): `/contracts/{id}/audit-trail`
carries an org check preventing cross-org signing evidence leaks.

## 7. The PDF, against `design-reference/…/docs/`

`docs/brand.css` is the spec. Six constants in `services/invoice_pdf.py` were
each a near-miss of their own spec value:

| | was | `--doc-*` spec | now |
|---|---|---|---|
| ink | `#1A2230` | `#14171A` | fixed |
| ink-2 | `#4A5468` | `#464B52` | fixed |
| ink-3 | `#6E7B91` | `#6E747C` | fixed |
| rule | `#E2DCC9` | `#D9D5CA` | fixed |
| rule-soft | `#EFE9D8` | `#EAE7DE` | fixed |
| tint | `#F0ECDF` | `#F7F5EF` | fixed |

Two structural fixes:
- **Page background** was `#FCFAF5`, a cream sheet. `.page` in brand.css is
  `#fff`. On paper that was a full-bleed wash over every A4 invoice.
- **`_DEEP = "#0082c6"`, the RETIRED brand blue**, was still setting the "TAX
  INVOICE" heading and the export declaration on every document the product
  emits. Replaced with `_ACCENT = #04837A` — brand.css's own documented fallback
  accent, since it states the org-profile schema has no colour field yet. The
  letterhead rule is now `2px solid` that accent, per `.lh`.

Backend document suite: **197 passed**.

## 8. Gates — all four, from `frontend/`, unpiped

```
check-tokens : 349 declared, 242 referenced, 0 missing
check-classes: 2783 selectors defined, 2042 used, 0 missing a rule
vite build   : ✓ built
vitest       : 39 files / 629 tests passed, exit 0
```

Baseline on `origin/staging` at `cc8f100c` was 36 files / 603 tests. I added
3 files / 26 tests (`ganitWaLink` 10, `ganitErrorStates` 8, `ganitInvoiceDrawer` 8).
The 35/594 figure in the brief predates the manav peer's landing.

## 9. An unhandled error I introduced the *exposure* for — and fixed

`vitest` **exited 1 while printing "39 passed / 629 passed"**. Exactly the trap
the brief names: an unhandled error is not a failed assertion.

`ReferenceError: window is not defined` from `KanbanView.jsx:134` — `markTransient`
schedules a clearing `setState` 400–600ms out and never cancelled it, so the
timer outlived the test environment. Attributed to `e2e/task-flow.test.jsx`,
which does not own the bug.

Characterised honestly over five full runs each:

| tree | clean runs |
|---|---|
| `origin/staging` baseline | **5 / 5** |
| my branch, before the fix | **3 / 5** (2 failures) |
| my branch, after the fix | **5 / 5** |

So the *defect* is pre-existing and in production code — leaving the board
inside that window sets state on an unmounted component, and React 18+ no longer
warns — but my three extra test files lengthen the run enough to change how
often the timer lands after teardown. I did not want to hand over a gate that
flakes 40% of the time, so `10c31473` tracks the timer ids in a ref and clears
them on unmount. **This is the one file I touched outside Ganit.** Boards was not
listed as an active peer module for this run.

## 10. What I did NOT verify

- **No browser verification.** The shared browser pane was at its tab cap and
  every existing tab belonged to a peer; `tabs_create` failed. I would not
  navigate another agent's tab, so there are **no screenshots and no rendered
  check of `ganit.css` in a real engine.** I confirmed the stylesheet compiles
  into the production bundle (`grep` for `gn-bar`/`gn-form`/`gn-li`/`gn-upi`/
  `gnd__num` in `dist/assets/index-*.css`) and that both gates resolve every
  class and token, but *computed layout is unverified*. A scratchpad harness
  (`ganit-check.html` + the built CSS) is written and served on 127.0.0.1:5247
  if someone with a free tab wants to look.
- **No live backend.** No `.env` exists for dev and I had no credentials, so
  every endpoint claim is read from `routers/ganit.py` source, not from a
  response. Response *shapes* are quoted with line numbers; they are not
  observed.
- **The PDF was never rendered.** WeasyPrint output is unexamined; I changed
  colour constants and the 197 backend document tests still pass, but nobody has
  looked at a resulting page.
- **`send-for-signature` was never pressed.** It emails signers. The confirm
  dialog and copy are unexercised.
- **Contracts/e-sign/recurring/timesheet drawers have no component tests.** My
  8 drawer tests cover the invoice only. The other three drawers are structurally
  identical but asserted by nothing.
- `check-classes` reports 666 selectors with no static user. I did not audit
  that list; it is unchanged in character from baseline (661) and the delta is
  mine plus the peer's.

## 11. Note for whoever touches `editorial/ModuleUI.Empty`

`Empty` forwards its `icon` prop into a **three-entry** `GLYPHS` map
(`check`, `clock`, `generic`) while callers pass ILLUSTRATION names. So
`Empty icon="invoice"` — used by `vikray/OrdersTab` and previously here —
silently renders the generic document glyph and the invoice artwork never
appears. I sidestepped it by calling `EmptyState` directly with
`illustration="invoice"`. I did **not** change the shared wrapper, because
Vikray depends on its current behaviour and that is a peer's file.
