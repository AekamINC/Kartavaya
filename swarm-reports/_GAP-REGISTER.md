# Gap register — the approved design vs what exists

**Measured 2026-07-27. Ship date 15 August — 19 days.**

This is the document that should have existed before any agent ran. Every gap
the owner has found by opening a page is in here, plus the ones nobody has
opened yet. Regenerate every number; never transcribe.

---

## 1. PRINT DOCUMENTS — the largest undiscovered gap

`design-reference/Kartavaya Redesign/docs/` is the approved specification for
every PDF this product generates. **Nine documents are specified. Two are
built.**

| document | spec file | generator | state |
|---|---|---|---|
| Tax Invoice | `Tax Invoice.html` | `services/invoice_pdf.py` | **built** |
| Payslip | `Payslip.html` | `services/payslip_pdf.py` | **built** |
| Quotation | `Quotation.html` | `invoice_pdf.py` doc_type label only | **partial — renders through the invoice generator, not matched to its own spec** |
| Statement of Account | `Statement of Account.html` | — | **MISSING** |
| GSTR-3B Summary | `GSTR-3B Summary.html` | — | **MISSING** |
| TDS Challan | `TDS Challan.html` | — | **MISSING** |
| Service Agreement | `Service Agreement.html` | — | **MISSING** |
| Project Report | `Project Report.html` | — | **MISSING** |
| Document Kit | `Document Kit.html` | — | **MISSING** (cover/index for the set) |

**Why this is the top item.** The two waiting clients are Indian accounting
firms. **GSTR-3B and TDS Challan are not nice-to-haves for that buyer — they are
the daily work.** A CA firm evaluating this product will look for them first.
Five missing documents is backend work, and the owner has authorised building
backend where it is missing.

`services/doc_validation.py` validates only `validate_tax_invoice` and
`validate_payslip`, so the five new documents need validators too, not just
renderers.

---

## 2. SCREENS — route coverage is complete, page completeness is not

All 18 reference screens have a route in `App.jsx`. Nothing is unrouted. The
problem is not missing pages — it is that pages are **one tab deep**.

Reference screens, all present as routes: `ScreenDash`, `ScreenBoards`,
`ScreenTasks`, `ScreenApprovals`, `ScreenGraha`, `ScreenGanit`, `ScreenManav`,
`ScreenVetana`, `ScreenVikray`, `ScreenDristi`, `ScreenPrachar`, `ScreenSrijan`,
`ScreenHub`, `ScreenEsign`, `ScreenSanvaad`, `ScreenPahchan`, `ScreenRoles`,
`ScreenPlatform`.

### Inline-style debt, which is the proxy for "not converted"

**3,215 real inline styles** (comments excluded) across the page tree. Every one
ignores the theme, the density control and the corner-radius control, so a page
carrying a hundred cannot look like the design and cannot respond to any
preference the customer sets.

| area | files | inline | state |
|---|---|---|---|
| (top-level pages) | 42 | **1,187** | Srijan/Hub ≈830 of it — **agent running** |
| graha tabs | 20 | **648** | **agent running** |
| manav tabs | 16 | **609** | **agent running** |
| ganit tabs | 11 | **548** | **agent running** |
| pahchan | 7 | 120 | not started |
| org | 12 | 26 | near done |
| marketing | 8 | 23 | near done |
| customize | 6 | 10 | near done |
| prachar / dristi / vetana / vikray | 33 | **16** | **DONE, verified** |
| inbox, sanvaad, esign, today, onboarding | 37 | 28 | near done |
| admin, client | 12 | 0 | done |

Four agents are running against the four largest rows — **2,635 of the 3,215**.
After they land, the remaining material gap is **pahchan (120)** and the
long tail of top-level pages outside Srijan/Hub (≈357).

---

## 3. MOBILE

Reference: `Mobile.jsx`, `MobileModules.jsx`, `MobileMore.jsx`, `MobileBoard.jsx`,
`MobileTask.jsx` + `Mobile App.html`.

The app has screens for Today, Tasks, Boards, Messages/Chat, Inbox, Approvals,
More, Settings, Reminders, Me, Client Portal, Pahchan (5 screens) and 7 module
screens. **Route coverage looks broadly complete; per-screen fidelity against
the reference has NOT been checked.** Nobody has done a screen-by-screen mobile
pass. Flagged, not measured — do not report mobile as done.

---

## 4. EMAIL

`design-reference/Kartavaya Redesign/Auth Emails.html` and `Email System.html`
are the spec. `backend/email_service.py` plus `services/employee_email.py` send
mail; there are **no HTML templates on disk** in the backend, so the markup is
inline in Python. **Fidelity against the email spec has not been checked.**

`backend/scripts/preview_emails.py` exists and is the way to check this without
sending anything.

---

## 5. CONFIRMED DEFECTS ALREADY FIXED THIS RUN

Kept because they show the class of bug that the styling metric cannot see, and
because each was live in a module that looked finished:

- **Vikray — stock never moved.** `fillFromProduct` dropped `product_id`, so
  confirming an order deducted nothing, forever. The Stock tab read zero for
  every product. It looked *empty* rather than *wrong*, which is why it survived.
- **Vetana — a failed request rendered "No payroll runs"**, which on a payroll
  screen asserts that nobody is owed anything, and is pixel-identical to a
  company with no employees. Six `catch {}` blocks each followed by a
  `length === 0` check.
- **Vetana — `process_payroll` emailed every employee** their payslip, re-sending
  on any re-run, and fired on one unconfirmed click.
- **Prachar — five of eight tabs could not render**; every ad spend figure showed
  `0`; the reference's scheduling calendar did not exist at all.
- **Dristi — every saved dashboard and scheduled report was invisible**; all five
  export buttons dead; `/pipeline` and `/sales` had no source-module check, so a
  Dristi grant alone read the full CRM pipeline and every salesperson's numbers.
- **All six module pages dropped the tab-panel key**, so the panel never
  re-entered and the motion the hook exists to produce never happened.

---

## 6. WHAT IS NOT VERIFIED, STATED PLAINLY

Do not let any of these read as done:

1. **No real end-to-end test exists.** Every verification so far is
   component-level or one agent's own browser against stubbed fixtures. The
   owner named Playwright e2e as a priority; it has not started.
2. **Mobile fidelity** — not checked screen by screen.
3. **Email fidelity** — not checked against the spec.
4. **Pahchan (120 inline)** — no agent has run on it.
5. **The 5 missing print documents** — not started.
6. The `_COVERAGE.md` metric counts `style={{` textually; files containing prose
   about inline styles overstate themselves. Numbers here exclude comments.

---

## 7. RECOMMENDED ORDER FOR 19 DAYS

1. **The 5 missing print documents** (GSTR-3B, TDS Challan, Statement of Account,
   Service Agreement, Project Report) — backend work, buyer-critical for a CA
   firm, and nothing else depends on it so it can run fully in parallel.
2. **Finish the four running conversions**, then pahchan and the top-level tail.
3. **Real Playwright e2e** across the ten module pages, both failure states and
   the RBAC gate — this is what replaces "an agent said it works".
4. **Mobile and email fidelity passes** — cheapest to leave last, but they must
   not ship unchecked.

## The rule this register exists to enforce

A thing is done when it has been measured on the artefact the customer sees —
the tab directory, the generated PDF, the sent email — never on the file that
routes to it.
