# Tally XML and GSTR-1 JSON exports

Branch `exports-tally-gstr1`, cut fresh from `origin/staging` @ `28b50f04`.
Delivery target: two accounting firms, 15 August.

---

## The boundary, and that it held

The owner decided not to build GST filing automation. This delivers the other
thing: **clean data, handed off, labelled honestly**.

Nothing in this change contacts the GSTN, the IRP or any portal. There is no
IMS, no GSTR-2B ingest, no ECRRS or RCM ledger read, no upload path, and no
computed liability anyone is invited to rely on. Both artefacts state on their
own face that they are data exported for the firm's own software.

Every route is a **GET**. `middleware/subscription._is_write` treats GET as a
read unconditionally, so a viewer entitled to these figures can download them.
`READ_SHAPED_POSTS` was **not** touched — it stays at four entries, under the
`<= 6` cap `test_module_write_level.py` enforces.

---

## What I built

| | |
|---|---|
| `backend/services/tally_xml.py` | Voucher XML builder (new) |
| `backend/services/gstr1_json.py` | GSTR-1 payload builder (new) |
| `backend/routers/documents.py` | Four GET endpoints (appended) |
| `backend/tests/test_exports_tally_gstr1.py` | 101 tests (new) |
| `frontend/src/pages/ganit/StatsTab.jsx` | Two live triggers + an exports panel |
| `frontend/src/__tests__/ganitGstFiling.test.jsx` | Updated + 11 new tests |

Endpoints, all `require_user` + `require_module("ganit")` + `get_org_id`:

```
GET /api/v1/documents/tally/{period}              → XML file
GET /api/v1/documents/tally/{period}/preview      → manifest JSON
GET /api/v1/documents/gst/gstr1/{period}/json     → GSTN payload file
GET /api/v1/documents/gst/gstr1/{period}/preview  → manifest JSON
```

They live in `documents.py` rather than `ganit.py` because GSTR-1 belongs beside
GSTR-3B — same screen, same period parameter, same gate, and the frontend
already calls `/v1/documents/gst/…`. Conventions are `ganit.py`'s throughout.

---

## Export 1 — Tally

### Voucher types produced

| Kartavaya type | Tally voucher | Notes |
|---|---|---|
| `tax_invoice` | **Sales** | party Dr, Sales Cr, output tax Cr |
| `credit_note` | **Credit Note** | every leg reversed |
| `debit_note` | **Debit Note** | |
| vendor bill | **Purchase** | vendor Cr, Purchase Dr, input tax Dr |

### Deliberately NOT produced

- **Quotations and proformas.** An offer is not a transaction; booking one puts
  revenue in the ledger that was never invoiced.
- **Drafts** (`doc_status='draft'`) and **cancelled** documents.
- **Inventory / stock entries.** `INVENTORYENTRIES.LIST` requires stock masters
  to already exist in the target company; when they do not, Tally fails the
  whole file. Line detail rides in `<NARRATION>` instead.
- **Payment / receipt vouchers.** `ganit_payments` exists, but a receipt voucher
  needs the bank or cash ledger it was received into and no column records it.

### The balance property

Tally rejects the **entire file** if one voucher is out by a paisa. So:

1. Every amount is a `Decimal`, quantized to 2dp **once** (`dec2`). No float
   arithmetic touches a rupee figure. `Decimal(repr(x))` for floats, so
   `0.1` does not arrive as `0.1000000000000000055…`.
2. After the legs are built, the residue is measured and booked to a
   **Round Off** leg — which is what Tally itself does.
3. `build_tally_xml` re-checks every voucher before serialising. One that still
   does not balance is held back and named, so it cannot cost the firm the other
   ninety.

Sign convention (the one that is not the intuitive one):
`ISDEEMEDPOSITIVE=Yes` ⇒ debit ⇒ **negative** `AMOUNT`; `No` ⇒ credit ⇒ positive.
Tested with header totals deliberately inconsistent with `subtotal + tax`.

### Held back and named

no party ledger name · foreign currency · date unreadable · missing number ·
tax heads contradicting the row's own flag · a voucher that would not balance.

Each appears in the manifest **and in a comment block at the head of the XML**,
so the file says what is missing from it even after it leaves the screen.

---

## Export 2 — GSTR-1

### Sections EMITTED (only when they have rows)

| Section | Source |
|---|---|
| `b2b` | recipient holds a GSTIN that passes its own check digit |
| `b2cl` | inter-state, unregistered, invoice value above the threshold |
| `b2cs` | remaining unregistered supplies, aggregated by supply type / POS / rate |
| `hsn` | HSN-SAC summary over the invoices actually included above |
| `doc_issue` | document series issued in the period |

Top level is `gstin` + `fp` (MMYYYY) and nothing else.

### Sections deliberately OMITTED, and why

- **`cdnr` / `cdnur` — credit and debit notes.** This is the substantive
  judgement call. Kartavaya records a credit note as an ordinary invoice row
  with `invoice_type='credit_note'`. It stores **no link to the document the
  note amends** and **no reason code** — there is no column for either. A
  `cdnr` entry identifies a note against its original document; one emitted
  without that link is a different statement from the one the section makes.
  I did not emit it.
  **Critically**, credit and debit notes are therefore also excluded from `b2b`
  — where they would otherwise be reported as positive supplies and overstate
  outward tax. They are listed by number in the manifest and on screen, so the
  preparer enters them deliberately rather than assuming they were covered.
  There is a test for exactly this (`test_a_credit_note_is_never_reported_as_a_positive_b2b_supply`).
- **`exp` — exports.** `is_export` exists, but the section needs a shipping bill
  number, its date and the port code. No column holds any of the three. Export
  invoices are also excluded from `b2b`/`b2cs` (they are zero-rated, not
  domestic) and named.
- **`nil` — nil-rated / exempt / non-GST.** `supply_nature` has the right
  domain (`taxable|zero_rated|nil_rated|exempt|non_gst`) but nothing in the
  product writes anything except `taxable`. A section built from it would assert
  a split nobody recorded.
- **`at` / `atadj`** — no row means "advance"; only payments against an invoice.
- **amendment sections** (`b2ba`, `b2cla`, `b2csa`, …) — no revision history
  distinguishes "corrected after filing" from "edited before issue".
- **`txpd` / `supeco` / `ecom`** — no store, no identifying field.

An absent section is not the same as `[]`. `"cdnr": []` reads as *"there were no
credit notes"* to whoever files from it, which is a statement, and a false one.

### Rows held back rather than mis-placed

counterparty GSTIN failing its check digit · a line with no HSN/SAC (rule 46(g))
· no resolvable place of supply on an inter-state supply · foreign currency ·
lines disagreeing with the header by more than ₹1 · cess spread over several
rates with nothing saying how it divides · a document series with gaps.

### Two derivations, both stated

1. **Place of supply.** The column is free text; on the live database 9 of 10
   rows are empty and one says `"Gujarat"`. `parse_state_code` handles a bare
   code, a name, and a name carrying its code. Where it is blank **and the
   invoice is intra-state**, the supplier's own state is used — that is what
   `is_igst = false` *means*, not a new classifier. **Inter-state with no POS is
   held back**: the flag says "elsewhere" and says nothing about where.
2. **UQC.** `unit` is free text (defaults to `"NOS"`). Known units map to GSTN
   codes; anything else becomes `OTH`, which is GSTN's own code for "others" —
   an honest answer rather than a substituted one.

### The ₹2.5 lakh threshold

`B2CL_THRESHOLD` is a named constant with a comment saying it is a **rule that
has moved before and can move again on a GSTN advisory**. Kartavaya does not
track advisories; the firm's own software is the authority for the period being
filed. One line to change.

---

## Reconciliation, with numbers

The manifest reports, for every period:

```
reported_taxable_value / source_taxable_value / taxable_value_difference
reported_tax           / source_tax           / tax_difference
```

`reported` is what the JSON says (summed from the per-rate `itms`); `source` is
what the invoice header columns say. Verified: three invoices of ₹1,000 + 18%
give `reported_taxable_value 3000.0 == source_taxable_value`, `reported_tax
540.0 == source_tax`, both differences `0.0`. Per-invoice drift above ₹1 holds
the invoice back; the CGST/SGST halves are split so that `camt + samt` is
*exactly* the line's tax (one rounding, then the remainder), so a rate whose
half ends in a half-paisa cannot drift.

Both outputs are parse-verified in tests — `ET.fromstring` for the XML,
`json.loads` for the JSON.

---

## Schema verification — and the bug it caught

Verified against `information_schema` on `toacecaewujfxjfrjwco`, schema
`staging`, **read-only**. No writes, no migrations.

Three findings that would each have shipped a broken export:

1. **`ganit_vendor_bills` has NO `is_igst` column.** I had assumed it, because
   `VendorBillCreate` has an `is_igst` field — but it is only an input to
   `_compute_invoice` that decides the split and is then discarded. Selecting it
   would have raised `UndefinedColumnError` on **every** Tally request. A mocked
   pool never notices: `mock_pool.fetch` returns what the test hands it,
   whatever the SELECT asked for. Bills are now classified by the tax heads they
   actually carry, and two tests pin it, including one asserting the column list
   itself.
2. **There are no line-item tables.** No `ganit_invoice_items`, no
   `ganit_vendor_bill_items` — `line_items` is a `jsonb` column on each parent.
3. **`line_items` is double-encoded on every live row.** All 10 invoice rows
   hold a jsonb *string* containing JSON, not a jsonb array. `db.py` installs a
   codec that runs `json.loads` once, so one further `json.loads` lands on a
   list *today* — but that codec is skipped on PgBouncer (`db._init_conn` logs
   and continues), and the same code then yields a **string**, and iterating it
   walks characters. `load_line_items` decodes until it reaches a container.

Finally, the exact SELECT text of all three queries was executed against the
live database with literals substituted: 3 invoice rows, 0 bill rows, 3 GSTR-1
rows. They run.

---

## Frontend

`StatsTab.jsx` — the GST filing screen — carried two **disabled** buttons
labelled "not built". They are now live, in a new **Data exports** panel.

- Download goes through `lib/documents.js` (`useDocumentDownload` /
  `downloadDocument`): object URL, server-chosen filename, `revokeObjectURL`
  **in a `finally`**. Same contract as `ganit/InvoiceDetail.jsx`'s blob path,
  via the shared helper rather than a fourth hand-rolled copy.
- Responses read through `body()` from `lib/api.js`.
- **Three distinct states.** *Loading* — skeleton, no counts, not even zeroes.
  *Error* — `ErrorState` with a retry; a count of zero would be a claim about
  the period rather than a report of a failed fetch. *Ready* — real counts,
  including an explicit zero, which here is the answer.
  A **failed export never produces a file**: the backend answers 422 and the
  reason is rendered in a `DocumentError` alert **beside the button that was
  pressed** (the shared hook's `error.key` is now split between the two panels).
- The previews load with `Promise.allSettled`, so a GSTR-1 refusal (missing org
  GSTIN) does not blank the Tally figures or the GSTR-3B summary above.
- The panel names every held-back document *with its reason*, the sections never
  carried, and the credit notes absent from the file.
- **Zero raw CSS property values in markup, no inline styles, no new CSS.** Only
  existing `gn-*` / `btn` / `gn-chk__*` classes. `scripts/contrast-baseline.json`
  is byte-identical.

---

## Gates

| Gate | Baseline | After |
|---|---|---|
| `backend/` `python -m pytest -q` | 1523 passed, 136 skipped | **1624 passed, 136 skipped, 0 failed** |
| `frontend/` `npm run check` | exit 0, 7 pairs at baseline | **exit 0**, 0 missing rules, no new contrast failures |
| `frontend/` `npx vitest run` | 48 files / 763 tests | **48 files / 774 tests, exit 0** |

`yarn.lock` and the line-ending-only change to
`visual-regression.test.jsx.snap` were both reverted, not committed.

---

## What I did NOT verify — read this before shipping to a client

1. **Neither file was tested against real Tally or the real GSTN offline
   utility.** I have no Tally installation and no GSTN utility here. The XML is
   well-formed, structurally correct per the documented import envelope, and
   every voucher balances. The JSON parses and reconciles. Whether Tally's
   importer accepts every tag, and whether the offline utility accepts this
   payload, is **untested**. Do a one-period dry run into a scratch Tally
   company and the offline utility before either firm relies on it.
2. **Whether the GSTN offline utility tolerates unknown top-level keys.** I
   assumed not, and emit the **strict payload with no Kartavaya keys**.
   Provenance therefore rides on the filename and the `X-Kartavaya-*` response
   headers, not inside the JSON body. The Tally XML *does* carry its provenance
   in a comment, because XML comments are unambiguously ignorable. This is the
   one place the "says on its face what it is" requirement is met by the
   envelope rather than the bytes, and it was a deliberate trade against risking
   someone else's filing.
3. **The exact mandatory field set of the current GSTR-1 schema version.** In
   particular whether `rsn` on a `cdnr` note and the original-invoice reference
   are still required. This is part of why `cdnr` is omitted rather than
   half-filled.
4. **Whether `uqc` should be `"NOS"` or `"NOS-NUMBERS"`.** I emit the three-letter
   code. If the firm's utility wants the long form it is one map away.
5. **The ₹2.5 lakh B2CL threshold in force for any given period.** Used as
   instructed; flagged as a movable rule.
6. **Live end-to-end through the running app.** The queries were executed
   against the real database and the services exercised directly, but no
   authenticated browser request was made — the app needs a session and a
   deployed backend.
7. **Behaviour at scale.** The preview endpoint builds the file and discards it.
   Fine for a period of a few hundred vouchers; not measured beyond that.

## What the data itself says today

Neither org holding invoices on staging has a GSTIN, a `state_code`, or a
billing-address state. **The GSTR-1 export will refuse for both**, with the
message pointing at Settings → Organisation → Company Profile. That is the
correct behaviour and it is worth knowing before a demo: the export cannot be
shown working until an org profile carries a GSTIN.

There are also **zero vendor bills** in the entire `staging` schema, so the
Purchase voucher path has been exercised only against synthetic rows and the
real query (which returns 0 rows, correctly).
