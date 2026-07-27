# Documents — the 285mm page budget

Branch `feat/doc-pagination-285mm`, cut fresh from `origin/staging` at `f27837fe`.

> "keep pagination … agree but design remain the same."
> "make it perfect without any brokn pieces or ugly. 285mm so roam for error."

A4 is 297mm. Content now breaks at **285mm**, leaving 12mm of headroom. The
design's look is unchanged: same letterhead, type, colour, spacing, icons,
colophon. Only where pages break changed.

---

## 1. The starting numbers in the brief were measuring the wrong thing

The brief reported seven of eight documents at **297.1mm** and treated five of
them as "just fits". They are not at 297.1mm. That figure is the height of the
`.page` **box**, and `.page` carried `min-height: 296mm` — so a document whose
content stopped at 199mm still reported the floor plus a rounding artefact. Five
identical readings of 297.1mm across five documents of visibly different lengths
is the tell.

Measured as **ink** — the lowest edge of anything that actually marks the paper —
against the same fixtures, the real starting heights were:

| document | brief said | actually (ink) | over 285? |
|---|---:|---:|---|
| Tax Invoice | 297.1 | **199.2** | no, 86mm spare |
| Payslip | 297.1 | **265.5** | no |
| Statement of Account | 297.1 | **187.5** | no, 97mm spare |
| Quotation | 297.1 | **267.7** | no |
| Service Agreement | 297.1 ×2 | **266.4 / 211.1** | no |
| Project Report | 380.2 | **282.2** | no, by 2.8mm |
| TDS Challan | 327.0 | **286.9** | yes, by 1.9mm |
| GSTR-3B Summary | 406.7 | **295.3** (p1 of 2) | yes, by 10.3mm |

So the five "fits" documents needed **neither breaking nor tightening** — they
had between 17mm and 97mm of room under the new budget already. That is the
answer to "decide per document which is right and say why": for five of the
eight the right action was to change nothing, and the apparent problem was a
measurement artefact. Only the TDS challan and GSTR-3B were genuinely over.

All numbers in this report were regenerated from real WeasyPrint 68.0 renders on
this branch. None is transcribed.

---

## 2. What was changed

Everything lives in `backend/services/doc_render.py` — one place, not eight.

**The budget.** `PAGE_HEIGHT_MM = 297`, `CONTENT_BUDGET_MM = 285`,
`PAGE_TAIL_MM = 12`. Spent as `@page { margin: 0 0 12mm 0 }`. The **top margin
stays 0** and `.page` keeps its `0.62in` inset, so the letterhead sits exactly
where the design puts it and every measurement down the page is unmoved. The
only change is where the flow is allowed to run out — 12mm sooner, into space
that was blank on a correctly-laid-out sheet anyway. `.page`'s `min-height` went
from `296mm` to `285mm` to match.

**Break-quality rules**, following the grain `brand.css` already set on
`.gap-note`. Each answers one named defect:

| defect | rule |
|---|---|
| table row split across a break | `.lines tbody tr { break-inside: avoid }` |
| `<thead>` stranded with no rows | `.lines thead { display: table-header-group; break-inside: avoid; break-after: avoid }` |
| heading at the foot with content overleaf | `.block__l, .party__l, .meta__l, .tile__l { break-after: avoid }` |
| total separated from its rows | `.totals { break-inside: avoid }`, `.lines tr.lines__foot { break-before: avoid }` |
| amount-in-words separated from the figure | `.words { break-inside: avoid; break-before: avoid }` |
| signature separated from what it signs | `.sign { break-inside: avoid; break-before: avoid }` |
| page carrying only the colophon | `.foot { break-before: avoid }` |
| orphan / widow lines | `html { orphans: 3; widows: 3 }` |

**The bug that caused the worst gap.** `.block` was `break-inside: avoid`. That
is right for the short labelled panels the design uses it for and catastrophic
for the ones wrapping a line table: a 24-row TDS deduction table could not
split, so the whole table moved to the next sheet and **page one kept its
letterhead and 189mm of white**. `block()` now marks a table-bearing block
`.block--flow` and lets it break; the table's own row rules and repeating
`<thead>` take over. This alone took the TDS challan at large volume from 3
pages to 2 and page one from 96.4mm to 281.3mm.

**Continuation identity.** `running_id()` builds `kind · org · number/period`;
`document(..., running=)` threads it through all eight generators. It prints in
the reserved 12mm tail alongside `Page N of M` from the real page counters, in
`.foot`'s own type (7pt, `INK3`) — no new furniture, no new rule, and it costs
the content budget nothing. Suppressed on page one via `@page :first`, because
page one is not a continuation page: it has the letterhead, and suppressing it
keeps single-page documents pixel-identical to the design.

---

## 3. Two defects found on the way

**The agreement's colophon lied about the page count.** It printed a hardcoded
`Page 1 of 2` / `Page 2 of 2`. With 16 milestones the authored first page spills
onto a third sheet and the paper asserts something false. Removed; `Page N of M`
now comes from the page counters, so it is counted rather than predicted.

**A stylesheet injection I introduced and then closed.** The running identity is
the only user-supplied value in this codebase that lands inside a `<style>`
element. `<style>` is a raw text element — the HTML parser does not decode
entities there, it scans for `</style` and stops — so `html.escape` is **not** a
defence. An org named `</style><script>…` would have closed the stylesheet and
injected markup into every document carrying that firm's name. `css_string()`
now emits `<` and `>` as CSS numeric escapes, which the CSS parser resolves back
for display while the HTML tokeniser never sees a tag opener. Pinned by
`test_the_running_identity_cannot_break_out_of_the_stylesheet`.

---

## 4. Measured result — every document, both volumes

Ink height per page, in mm. Budget 285. Large volumes are past any real-world
figure: 28 invoice lines, 24 TDS deduction lines, 34 statement transactions, 18
quotation lines, 16 milestones, 15 report measures, 12 decisions.

### Spec fixture volume

| document | before | after |
|---|---|---|
| Tax Invoice | 1p · 199.2 | 1p · 199.2 |
| Payslip | 1p · 265.5 | 1p · 265.5 |
| GSTR-3B Summary | 2p · **295.3** / 226.3 | 2p · 281.9 / 251.1 |
| TDS Challan | 1p · **286.9** | 2p · 227.3 / 57.5 |
| Statement of Account | 1p · 187.5 | 1p · 187.5 |
| Quotation | 1p · 267.7 | 1p · 267.7 |
| Service Agreement | 2p · 266.4 / 211.1 | 2p · 266.4 / 211.1 |
| Project Report | 1p · 282.2 | 1p · 282.2 |

### Large volume

| document | before | after |
|---|---|---|
| Tax Invoice | 2p · **296.5** / 160.1 | 2p · 278.0 / 178.6 |
| Payslip | 1p · 265.5 | 1p · 265.5 |
| GSTR-3B Summary | 3p · 181.0 / 225.7 / 222.4 | 3p · 281.9 / 277.5 / 79.1 |
| TDS Challan | 3p · **96.4** / **292.7** / 87.2 | **2p** · 281.3 / 207.6 |
| Statement of Account | 2p · **292.9** / 189.2 | 2p · 283.6 / 198.4 |
| Quotation | 2p · **295.1** / 200.1 | 2p · 281.6 / 213.6 |
| Service Agreement | 3p · 174.0 / 218.9 / 211.1 | 3p · 284.2 / 119.2 / 211.1 |
| Project Report | 2p · 280.0 / 154.2 | 2p · 280.0 / 154.2 |

No page anywhere exceeds 285mm. Bold marks a page that did.

Two page counts read low and are correct, not gaps:
* **Service Agreement p2 (119.2mm)** — this is the end of *authored* page 1;
  authored page 2 must start a fresh sheet (`.page + .page { break-before: page }`).
  That boundary is the design's, not a too-eager break.
* **GSTR-3B p3 (79.1mm)** — carries the full gap-note panel plus the colophon.
  Substantive content, not a scrap.

---

## 5. The one document the budget costs a page

**TDS Challan at spec volume (3 deduction lines) is now 2 pages.** Its content
measures **286.9mm** against a 285mm budget — over by **1.9mm**. Under a hard
285mm rule it must break; there is no way to fit it without changing the design,
which is out of bounds.

The break is placed at the boundary between the money and the attestation: page
one carries the letterhead through the amount in words, page two the CIN, the
signature, the notes and the colophon, plus the running identity. Neither sheet
is a scrap, and the alternative break (colophon alone on page two) is explicitly
forbidden and is blocked by `.foot { break-before: avoid }`.

**This is a decision for the owner, and it is one constant.** Setting
`CONTENT_BUDGET_MM = 290` in `doc_render.py` returns the challan to one page and
still leaves 7mm of headroom. I have not made that change — 285 was the stated
number. Flagging it because a two-page challan for three deduction lines is the
kind of thing an accounting firm will notice on 15 August.

---

## 6. Verification

Real PDF bytes, at both volumes, for all eight documents:

1. **Budget** — every page's ink measured; all ≤ 285mm.
2. **Page count** — pinned per document per volume, not bounded. A change that
   turns a one-page invoice into two fails.
3. **Rasterised to PNG and looked at.** This is what caught the 189mm white gap
   and the agreement's false page count; no HTML-level assertion would have.
   Every page of every document at both volumes was rendered; the break
   boundaries and all 24 individual pages were inspected.
4. **Text read back with `pypdf`** — the closing element of each document
   (colophon / closing block) is asserted present, so a page overrun that
   dropped the tail fails.

Added as `backend/tests/test_document_pagination.py` — **91 tests**, all passing
under WeasyPrint 68.0. They cache renders (`lru_cache`), so the file costs ~55s
rather than ~124s.

### Suite

* **Windows** (`cd backend && python -m pytest -q`): **1450 passed, 122 skipped,
  0 failed.** Baseline was 1450 passed, 31 skipped. The 91 extra skips are
  exactly the new pagination tests, which skip where WeasyPrint's native stack
  is absent — 31 + 91 = 122. No test lost, none newly failing.
* **WSL, WeasyPrint present**: `test_document_set.py` +
  `test_document_generation.py` → **325 passed, 5 skipped**;
  `test_document_pagination.py` → **91 passed**.

### Not verified

* **`cost_report_pdf.py`** (cost report, credit report) — a ninth and tenth
  generated document, not in the brief's list and not built on `doc_render`. It
  owns its own `@page { size: A4; margin: 20mm 18mm }`, a **257mm** content box,
  28mm inside the budget, so no data volume can breach 285mm. Verified **by
  geometry and pinned by a test**; **not rasterised and not visually inspected.**
  Migrating it onto the brand layer is a separate job.
* **Real database rows.** Read-only on the DB was respected: no row was read or
  written. Everything is synthetic fixtures. The new `ganit_tds_challans`,
  `project_milestones`, `project_risks` and `project_baselines` tables are not
  wired into the generators here — that is a data-layer job. The project report
  still prints a gap note saying "No milestone store exists — see
  `backend/migrations/PROPOSED_documents.sql` §7", which is **now stale** since
  that migration landed. Worth a follow-up.
* **Printer behaviour.** The 12mm headroom is the defence against driver margins
  and font substitution; nothing was printed on real hardware.
* **Fonts other than the vendored stack.** Substitution tolerance is the reason
  for the headroom but was not simulated.

No email, WhatsApp or push was sent on any path. No pricing figures appear
anywhere; all amounts are obviously synthetic round numbers.
