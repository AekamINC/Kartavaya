# Documents — GSTR-3B compliance and the two-stylesheet split

Branch `agent/documents-compliance`, cut fresh from `origin/staging` at `2693d2c0`
(verified; the worktree had seeded 737 commits stale at `1aa49855`, which is
reachable from `main` and eleven other branches, so nothing was lost re-branching).

**Tests: 1450 passed, 31 skipped, 0 failed.** Baseline was 1404 passed, 31 skipped.
+46 tests, no regressions.

**Database: read-only throughout.** No migration applied, no `execute_sql`, no
`apply_migration`. No email, WhatsApp or push on any path touched.

---

## TASK 1 — GSTR-3B Table 4

### What the notified form actually says

I did not take the brief's list as the specification. I checked it against
primary sources and **two of the four points needed correcting**.

Authorities used, read in full rather than summarised:

| Source | What it settles |
|---|---|
| **CBIC Circular 170/02/2022-GST**, 6 July 2022 (`cbic-gst.gov.in/pdf/Circular-170-02-2022-GST.pdf`) | Para 4.3(A)–(F), para 4.4, and a worked Annexure with figures |
| **GSTN advisory**, 2 September 2022 (`tutorial.gst.gov.in/downloads/news/advisory_of_label_change_in_GSTR_3B_02_09_2022.pdf`) | The exact notified row labels, verbatim |
| **Notification 14/2022-Central Tax**, 5 July 2022 | The instrument that notified the revised Table 4 |

The notified Table 4, quoted from the GSTN advisory:

```
(A) ITC Available (whether in full or part)
    (1) Import of goods
    (2) Import of services
    (3) Inward supplies liable to reverse charge (other than 1 & 2 above)
    (4) Inward supplies from ISD
    (5) All other ITC
(B) ITC Reversed
    (1) As per rules 38, 42 and 43 of CGST Rules and Section 17(5)
    (2) Others
(C) Net ITC Available (A) – (B)
(D) Other Details
    (1) ITC reclaimed which was reversed under Table 4(B)(2) in earlier tax period
    (2) Ineligible ITC under section 16(4) and ITC restricted due to PoS provisions
```

Live on the portal from 01.09.2022, applying "for the GSTR-3B to be filed for the
period August 2022 onwards". Every period this product can generate is after that
date, so there is no old-form case to support.

I searched for anything post-dating this that restructures Table 4 and found
none. The live 2026 change is **hard-locking** — from the July 2026 period ITC
values in Table 4 become non-editable and auto-populate from GSTR-2B/IMS. That
changes who may edit the figures, not what the rows are. See "What I did not
verify" below.

### The brief's four points, checked

| # | Brief said | Verdict |
|---|---|---|
| 1 | Import of services missing; form separates 4(A)(1) goods from 4(A)(2) services | **Correct.** Implemented as 4(A)(2). |
| 2 | ISD credit missing — 4(A)(4) | **Correct.** Implemented as 4(A)(4). |
| 3 | ITC reclaimed missing — "**4(A)(5)**, credit reversed earlier under **rule 37**" | **Wrong in a way that would have caused double-counting.** See below. |
| 4 | s.17(5) is a reversal inside 4(B)(1); (D) carries reclaimed + s.16(4)/PoS | **Correct in substance**, three labels off. See below. |

#### Point 3 — the correction that matters

The brief located ITC reclaimed at **4(A)(5)**. Had I implemented that as an
availment row, **4(A) and therefore 4(C) would have been overstated by the full
reclaimed amount** — the product would have told a firm it could claim credit
twice. That is precisely the "worse than leaving it alone" failure.

What the sources actually say:

- The dedicated row is **4(D)(1)**, not 4(A)(5). 4(A)(5) is "All other ITC".
- Reclaimed credit is *availed* inside 4(A)(5) and *disclosed separately* in
  4(D)(1). GSTN advisory note 3(II): credit reversed under 4(B)(2) "can be
  reclaimed in table 4(A)(5) at appropriate time and the break-up detail of such
  reclaimed ITC should be provided in **4(D)(1) in the same return**."
- So 4(D)(1) is a **break-up of a number already counted**, never an addition.
- The reversal being reclaimed is one made under **4(B)(2)**, which covers rule
  37 (non-payment within 180 days) *and* section 16(2)(b) and 16(2)(c). Rule 37
  is one ground of several, not the definition.

Implemented accordingly: `itc_reclaimed` prints at 4(D)(1), is excluded from
`net_itc`, and `validate_gstr3b` **blocks** a paper where 4(D)(1) exceeds
4(A)(5), because a break-up cannot exceed the row it breaks up.

#### Point 4 — substance right, three labels wrong

The substance is correct and is the change with the largest financial effect.
Circular 170/02/2022 para 4.4: "the reversal of ITC of ineligible credit under
section 17(5) … is required to be made under Table 4(B) and **not** under Table
4(D)". Para 4.2 gives the reason — 4(C) is what gets credited to the electronic
credit ledger, so anything ineligible must come out before it.

Three label corrections:

- 4(D) is headed **"Other Details"**, not "ITC not available".
- 4(D)(1) is ITC **reclaimed** (past tense — already taken), not "reclaimable".
- 4(B)(1) covers **rules 38, 42 and 43** plus s.17(5). The brief and the old code
  both said "rule 42 / 43"; **rule 38** — reversal by a banking company or
  financial institution — was missing, and Kartavaya sells to accounting firms
  whose clients include NBFCs.

### The arithmetic, regenerated

`4C = 4A − [4B(1) + 4B(2)]`, from Circular 170/02/2022 para 4.3(D) verbatim.
Table 4(D) is excluded by construction.

I recomputed the circular's own Annexure independently before touching the code:

| Head | 4(A) | 4(B) | 4(C) computed | 4(C) printed in the circular |
|---|---|---|---|---|
| IGST | 4,00,000 | 1,35,500 | **2,64,500** | 2,64,500 ✓ |
| CGST | 1,75,000 | 52,500 | **1,22,500** | 1,22,500 ✓ |
| SGST | 1,75,000 | 52,500 | **1,22,500** | 1,22,500 ✓ |

Exact agreement, so the formula as implemented is the formula the CBIC applies.

**Effect on the design's own figures.** Moving s.17(5) (₹6,240 CGST + ₹6,240
SGST) from a standalone (D) memo into the 4(B)(1) reversal:

| | Design as printed | Notified form | Δ |
|---|---|---|---|
| 4(C) CGST | 99,152 | **92,912** | −6,240 |
| 4(C) SGST | 99,152 | **92,912** | −6,240 |
| Total via ITC | 3,58,884 | **3,46,404** | −12,480 |
| **Payable in cash** | 4,11,804 | **4,24,284** | **+12,480** |

₹12,480 moves from credit to cash. Total tax payable (₹7,70,688) is unchanged —
the liability was never wrong, only how much of it the paper claimed could be
paid from credit.

The full 6.1 derivation is written out line by line in the test fixture
(`SPEC_GSTR3B_PRINTED`) so a reviewer can check it without running the code.

### Data model

Kept as inputs, mapped to notified rows:

| Key | Row | Status |
|---|---|---|
| `itc_import_goods` | 4(A)(1) | existing |
| `itc_import_services` | 4(A)(2) | **new** |
| `itc_reverse_charge` | 4(A)(3) | existing |
| `itc_isd` | 4(A)(4) | **new** |
| `itc_all_other` | 4(A)(5) | existing, derived from `ganit_vendor_bills` |
| `itc_reversed` | 4(B)(1) rules 38/42/43 | existing, relabelled |
| `itc_blocked_17_5` | 4(B)(1) s.17(5) | **new**, renamed from `itc_ineligible` |
| `itc_reversed_other` | 4(B)(2) | **new** |
| `itc_reclaimed` | 4(D)(1), memo | **new** |
| `itc_ineligible_16_4_pos` | 4(D)(2), memo | **new** |

4(B)(1) prints as **one row with two inputs**, because the form prints one row —
the circular's Annexure sums them the same way (₹1,25,500 = ₹75,500 rules 42/43 +
₹50,000 s.17(5)). The s.17(5) component is named in a `.lines__sub` under the
row so a preparer can reconcile it.

**Backward compatibility, deliberately.** The old `itc_ineligible` key meant
s.17(5). I did **not** silently repoint it at the new 4(D)(2), which means
something else entirely — that would have moved a blocked-credit figure into a
row about time-barring. It is accepted as a deprecated alias for
`itc_blocked_17_5`, keeping its original meaning and now reversing where the form
requires. Dropping it from the Pydantic model instead would have made Pydantic
discard it silently, losing a reversal — the one failure worse than reporting it
in the old place. Test: `test_the_deprecated_ineligible_key_still_reverses_section_17_5`.

### Validator

`validate_gstr3b` gained, all in `backend/services/doc_validation.py`:

- **blocking** `gstr3b.net_itc.{head}` — 4(C) must equal 4(A) − 4(B).
- **blocking** `gstr3b.reclaimed.{head}` — 4(D)(1) may not exceed 4(A)(5).
- **blocking** `gstr3b.itc.balance` — credit applied to liabilities must equal
  credit drawn from pools.
- **advisory** `gstr3b.net_itc_negative.{head}` — a negative 4(C) is legitimate
  (reversals can exceed availment) and `compute_set_off` correctly utilises
  nothing from it, but the preparer should be told the liability falls to cash.

### A pre-existing bug found by the new fixture

`validate_gstr3b` compared `set_off[h]["via_itc"]` against `net_itc[h]` — credit
applied to the **liability** of head *h* against the **credit pool** of head *h*.
Those are different quantities. Rule 88A **requires** IGST credit to be exhausted
first and lets it pay CGST and SGST, so a CGST liability is routinely discharged
with more credit than the CGST pool holds.

**This refused correct returns.** Any firm whose IGST credit exceeds its IGST
liability — an importer, or an inter-State buyer selling intra-State — hits it.
It never fired before because the design's fixture has IGST liability (₹3,74,220)
far exceeding IGST credit (₹1,60,580), so IGST credit never spilled to another
head. My fully-populated fixture has *no* IGST liability and ₹1,15,000 of IGST
credit, and the document was **refused outright**.

Fixed to check each credit **pool** via `credit_left`, plus a global
applied-equals-drawn invariant. Pinned by
`test_cross_utilised_igst_credit_is_not_mistaken_for_an_overdraw`, with two
contrast tests so it cannot be satisfied by checking nothing.

The three set-off constraints named in the brief are untouched and still tested:
rule 88A ordering, CGST/SGST non-cross-utilisation, reverse-charge-is-cash-only.

### Working-paper framing — preserved and strengthened

Unchanged: meta strip "Filing status: Working — not filed" / "ARN: Not
generated"; the note "Figures are a working, not a filed return"; the colophon
"not a filed return · retain with books under section 35".

Added to "Before you file": the authority for the s.17(5) treatment (Circular
170/02/2022 paras 4.2 and 4.4) and the form revision the paper follows
(Notification 14/2022-CT). A CA seeing a smaller 4(C) than the old form gave can
now check why without opening the code.
Test: `test_the_working_paper_framing_survives_the_table_4_change`.

### Styling

Unchanged, as instructed. Letterhead, fonts, colours, icons, chips, spacing,
meta strip and colophon are byte-identical in approach; only rows were added to
the existing `.lines` table. No new components, no layout change.

### No DB column needed

All five new rows are request-body overrides on `Gstr3bOverrides`, like the three
override rows before them. None is derivable: 4(A)(2)/4(A)(4) would need an
import/ISD classification `ganit_vendor_bills` does not have, and 4(B)(2),
4(D)(1), 4(D)(2) are figures a preparer ascertains or reads from GSTR-2B. The
reasoning is recorded in `PROPOSED_documents.sql` section 4. **No DDL added, none
applied.**

---

## TASK 2 — invoice and payslip onto the shared stylesheet

`invoice_pdf.py` and `payslip_pdf.py` now build from `doc_render.py` (brand.css +
the `<doc-page>` translation). Both keep A4. Their own palettes, font stacks,
`.pdf__*` class vocabulary and entire embedded stylesheets are gone.

`payslip_pdf.py` had drifted furthest of the whole set and still carried the
**retired brand blue `#0082c6`** on its "Payslip" heading, plus `--doc-ink` as
`#1A2230` (spec `#14171A`), `--doc-rule` as `#E2DCC9` (spec `#D9D5CA`) and a
cream `#FCFAF5` sheet where brand.css says `#fff`. All gone. `invoice_pdf.py`'s
recently-corrected ink/rule constants were **not** reintroduced — they are
deleted in favour of `doc_render`'s, which hold the same values.

### One extension to the shared layer

`doc_render.letterhead` gained `ids_html`, defaulting to `None` (existing
behaviour). Only `invoice_pdf` passes it. It exists because one document has a
statutory reason to leave a missing GSTIN unmarked: a quotation or proforma is an
offer, not a tax document, and flagging it would put a red warning on correct
paperwork. `_org_gstin_line` still owns that decision; only its markup became
brand.css's. Verified inert for the other seven — see below.

### Verified with real bytes

WeasyPrint 68.0 under WSL (`~/wpvenv/bin/python`), matching `requirements.txt`.
All documents generated as real PDFs, read back with `pypdf` 6.14.2, and
rasterised to PNG with PyMuPDF **and looked at**.

Baseline PDFs were generated from a clean `git archive origin/staging` export and
compared:

| Document | Baseline pages | Now | Text vs baseline |
|---|---|---|---|
| tax-invoice | 1 | **1** | changed (intended) |
| payslip | 1 | **1** | changed (intended) |
| gstr3b | 2 | **2** | changed (Table 4) |
| gstr3b, full Table 4 | — | 2 | new fixture |
| tds-challan | 1 | **1** | **identical** |
| statement | 1 | **1** | **identical** |
| quotation | 1 | **1** | **identical** |
| agreement | 2 | **2** | **identical** |
| project-report | 1 | **1** | **identical** |

**No document gained a page.** GSTR-3B was already two pages at baseline; adding
five Table 4 rows did not add a third. No page is colophon-only — page 2 of the
GSTR-3B carries the whole of Table 6.1, the totals, the words line, "Before you
file", the signature and the gap note.

The five untouched documents extract **character-for-character identical text**,
which is the evidence that the `ids_html` addition is inert for them.

A word-level diff of the invoice and payslip confirms **no content was lost** —
every identifier, figure, label, term and declaration survives. Differences are
presentational only (logo mark, GSTIN/PAN below the address per `.lh__ids`,
uppercase tracked `.meta__l` labels, tinted rather than solid-black table header,
`.words` strip, `.foot` colophon).

One real content difference was caught **by looking at the PNGs, not by any
test**: my first cut dropped the "Balance due" row when nothing had been paid.
Restored — Total and Paid stay as ordinary rows and Balance due is the grand
figure whenever one is recorded, which is what the document has always printed.

---

## Test changes, named individually

Only three existing assertions were altered. Everything else is additive.

1. **`test_document_set.py` — `SPEC_GSTR3B_INPUTS` / `SPEC_GSTR3B_PRINTED`.**
   The fixture the brief said would need updating. Inputs keep the design's Table
   3.1 and Table 4 figures **unchanged**; only the row s.17(5) is reported in
   moved. The expected output is **derived by hand in a comment block** showing
   every step, not copied from the implementation. The to-the-rupee
   reconciliation is preserved and extended: 4(A)/4(B)/4(C), an identity test
   that 4(C) = 4(A) − 4(B) for any figures, all twelve 6.1 cells, all four
   totals, and a join test that 6.1 consumes exactly what 4(C) offers.

2. **`test_document_set.py` — `EXPECTED_IN_PDF["gstr3b"]`.** `4,11,804` →
   `4,24,284`, plus four new row labels asserted in the real PDF bytes.

3. **`test_document_generation.py` — `test_the_mark_is_visually_loud_not_a_quiet_blank`.**
   Asserted `class="pdf__unset"` and `.pdf__unset`. That assertion is *inherently*
   unsatisfiable under unification — the bespoke class is the gap being closed.
   Rewritten to `class="unset"` / `.unset{` against brand.css, preserving both
   assertions and the stated intent (the mark is classed, and the class is
   declared). The other three "GSTIN NOT SET" assertions pass **unchanged**: I
   kept this document's louder uppercase wording deliberately.

**No test was deleted, weakened, or made conditional.**

---

## Statutory judgements I made

Named explicitly, because a wrong GSTR-3B is worse than a missing one.

1. **s.17(5) reverses inside 4(B)(1) and reduces 4(C).** High confidence —
   Circular 170/02/2022 para 4.4 says it in terms, para 4.2 gives the reason, and
   the Annexure works it. This changes what a firm can claim.
2. **4(D) never touches 4(C).** High confidence — para 4.3(D) states the formula
   and the Annexure obeys it.
3. **4(D)(1) ≤ 4(A)(5) is blocking, not advisory.** *My judgement.* The sources
   make 4(D)(1) a break-up of 4(A)(5); they do not say a portal validation
   enforces it. I made it blocking because the module's stated principle is that
   a paper whose columns do not sum is worse than no paper, and because a
   preparer trusting it would claim credit twice. **A CA firm may reasonably want
   this advisory instead** — it is one line in `doc_validation.py`.
4. **A negative 4(C) is advisory, not blocking.** *My judgement.* Reversals
   exceeding availment in a period is legitimate. The figure is not wrong, so it
   should not refuse the document.
5. **Rule 38 added to the 4(B)(1) label.** The notified label names it; the old
   code said only "rule 42 / 43".
6. **`itc_ineligible` kept as a deprecated alias with its ORIGINAL meaning.**
   *My judgement.* The alternative — reading it as the new 4(D)(2) — would
   silently relabel blocked credit as time-barred credit.
7. **Monthly due date unchanged** (20th, s.39(7) with rule 61(1)(i)). QRMP filers
   are the 22nd or 24th by State group and nothing records the scheme; the
   existing advisory `gstr3b.filing_scheme` still says so. Not my change, but I
   checked it still holds.

## Where I am unsure

- **Whether 4(D)(1) should ever be non-zero when 4(B)(2) is nil in the same
  period.** Reclaims typically relate to a *prior* period's 4(B)(2), so I did
  **not** add a cross-check between them. A tighter reading might.
- **Cess in Table 4(D).** The notified table has a Cess column across all rows
  and I carry it, but I found no worked example of cess in 4(D). Harmless
  (it is disclosure) but unverified.
- **Whether the portal itself rejects 4(D)(1) > 4(A)(5).** I asserted the
  arithmetic; I could not verify portal behaviour.

## What I did NOT verify

- **Notification 14/2022's own gazette text.** I read the GSTN advisory that
  reproduces the notified table verbatim and the CBIC circular, both primary and
  both official domains, but not the gazette PDF itself.
- **Any 2023–2026 amendment to Table 4's structure.** I searched and found none;
  the 2026 change is hard-locking (who may edit), not re-rowing. I did not read
  every notification since 14/2022, so I cannot state this exhaustively.
- **The July 2026 hard-locking change against this document.** From the July 2026
  period ITC in Table 4 becomes non-editable and auto-populates from GSTR-2B/IMS.
  This is a **working paper**, not a filing, so it is unaffected mechanically —
  but a firm's *workflow* changes, and nobody has assessed what that means for
  this product. **Worth the owner's attention before 15 August.**
- **Anything against the live GST portal.** No portal account was used, no
  figures were reconciled against a real GSTR-2B.
- **Whether real `ganit_vendor_bills` data populates 4(A)(5) sensibly.** The DB
  was read-only and I ran no queries; 4(A)(5) is exercised only through fixtures.
- **Print output on paper.** Verified as rendered PNGs at 100 dpi, not physically
  printed. Mono-laser rendering of the teal accent is unverified.
- **`cost_report_pdf.py` and `report_generator.py`**, which still carry live
  `#0082c6` constants. They are outside the eight-document print set and outside
  both tasks; deliberately untouched.

## One thing flagged, not fixed

`doc_render.ACCENT2_DEFAULT = "#0082c6"` — the retired brand blue — is still
defined and returned by `accent()`, but `{a2}` is never interpolated into
`stylesheet()`, so it is **never painted**. Not a live defect; a loaded gun. The
moment anyone uses `a2` in a rule, the retired blue returns across all eight
documents at once. Left alone because changing a shared accent contract days
before delivery is the wrong trade. Raised as a separate task.
