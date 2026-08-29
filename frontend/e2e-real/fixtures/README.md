# e2e-real fixtures — the files the reseed waves upload

Built for proposal 93 §5. §7 stage R5 is "Build the fixtures of §5", gated on
"Bank formats verified against the real parser". This directory is that stage.

**Nothing here is committed as a binary.** Text fixtures a human must read are
committed; every image, PDF and archive is produced by a seeded generator into
`generated/`, which is git-ignored.

```bash
node frontend/e2e-real/fixtures/make-fixtures.mjs           # build generated/
node frontend/e2e-real/fixtures/make-fixtures.mjs --check   # prove determinism
node frontend/e2e-real/fixtures/verify-bank-fixtures.mjs    # bank CSVs vs the real parser
```

Run the generator before any suite that uploads. It is fast, it wipes and
rewrites `generated/` each time, and `--check` re-derives every SHA-256 in
`generated/MANIFEST.txt` and diffs it, so a fixture that drifts says so instead
of quietly changing what a test asserts.

---

## ⚠ First, the thing 93 §5 gets wrong: the parser is not positional

§5 says the bank statements must be "in the real bank formats the parser
expects", because "parsing is positional — a hand-written file with the right
headers and wrong column order proves nothing".

**That describes code that was deleted on 2026-08-09.** Commit `1da2883b`,
*"feat(ganit): read the bank's CSV, not five fields by position"*, replaced it.
The module that superseded it says so in its own opening lines
(`frontend/src/lib/bankCsv.js:4-25`): what it replaces is
`csvText.split('\n')` then `line.split(',')` "with the five fields taken by
POSITION".

Today the importer reads the **header row** and guesses a column map from it —
`guessMapping`, `frontend/src/lib/bankCsv.js:93`. Column **order** no longer
matters at all. Column **names** are now the entire contract, and the failure
mode has inverted: a file with the right headers in the wrong order now parses
correctly, and a file with invented headers proves nothing.

There is a second correction. §5 says "CSV/XLS". **There is no XLS path.** The
file input accepts `.csv,text/csv` only (`frontend/src/pages/ganit/BankTab.jsx:310`)
and no spreadsheet reader exists anywhere in the import path. All three fixtures
are CSV.

Where the parsing actually happens is also worth stating, because it is not
where a reader would look: **the browser parses, the server does not.**
`POST /v1/ganit/bank-statements/import` (`backend/routers/ganit.py:3169`) takes
already-parsed JSON lines. No file ever reaches the backend.

---

## `bank/` — three real formats, committed (3 files)

Derived from `frontend/src/lib/bankCsv.js`, read before a single row was
written. `verify-bank-fixtures.mjs` runs that exact module over these files and
prints the mapping it derives; the expectations in it were **recorded from a
run**, not predicted.

| File | Bank | What it proves |
|---|---|---|
| `hdfc-current-aug2026.csv` | HDFC current account | Two-column `Withdrawal Amt.`/`Deposit Amt.`, `DD/MM/YY` dates, quoted commas, a doubled-quote escape, Indian digit grouping, a skipped opening-balance row and a skipped undated total row |
| `sbi-current-aug2026.csv` | State Bank of India | Space-padded headers, plain `Debit`/`Credit`, and `3 Aug 2026` month-name dates — the branch at `bankCsv.js:150` |
| `icici-current-aug2026.csv` | ICICI Bank | Found the column-name defect. See below. |

Verified behaviour (`node verify-bank-fixtures.mjs`, exit 0):

```
hdfc  → date[0] narration[1] chq/ref[2] debit[4] credit[5] balance[6]
        8 lines imported, 2 skipped, debits negative      ✓
sbi   → txn date[0] description[2] ref[3] debit[4] credit[5] balance[6]
        8 lines imported, 0 skipped, debits negative      ✓
icici → transaction date[2] remarks[4] cheque[3] AMOUNT[5] credit[6] balance[7]
        3 lines imported, 5 SILENTLY SKIPPED             ✗ defect
```

### The ICICI file found a live defect — FIXED 2026-08-29

ICICI writes `Withdrawal Amount (INR )` and `Deposit Amount (INR )` — the word
"Amount" spelled in full. In `guessMapping`, `FIELDS` is ordered
`… amount, debit, credit …` (`bankCsv.js:62-70`), so the `amount` field is
matched **before** `debit`, and its substring hint `'amount'`
(`bankCsv.js:79`) claims `withdrawal amount inr` first. `debit` then finds
nothing left. In `toLines`, `mapping.credit != null` is enough to take the
two-column branch (`bankCsv.js:190`), so `out` reads an unmapped column, comes
back `0`, and **every withdrawal nets to zero and is dropped as a valueless
row** (`bankCsv.js:200`).

Five of eight ICICI rows vanish with no error. The user sees "3 imported".

Confirmed independently: renaming SBI's `Debit` column to `Withdrawal Amount`
reproduces it exactly — 4 of 8 rows dropped. The trigger is the column *name*,
not the bank.

**Do not "fix" the fixture.** It is a real ICICI header, and it is the reason
the defect was found at all.

**The PARSER was fixed instead**, which is the option this section proposed:
`bankCsv.js` now carries a `GUESS_ORDER` that resolves `debit`/`credit` before
`amount`, so the withdrawal column can no longer be claimed by the
signed-amount hint. The fixture asserts **8 imported, 0 skipped**, with the
five withdrawals negative.

`FIELDS` itself is unchanged and still lists "Amount (signed)" above the pair,
because `FIELDS` drives the mapping SCREEN and that is the order a person reads
it in. Only the guessing order moved.

The regression is pinned in `src/__tests__/bankCsv.test.js` — mapping, row
count and signs, plus a case that renames a plain `Debit` column to show the
trigger is the column NAME rather than the bank, plus one that a genuinely
signed `Amount` column still works. Proved to bite by mutation: restoring the
old order turns 4 of them red.

⚠ `verify-bank-fixtures.mjs`'s ICICI expectations were RECORDED FROM THE BROKEN
BEHAVIOUR and have been updated deliberately, with the reason written in the
file. 93 §0: a test that fails on a correct fix is a defect in the test, and
editing one green without saying why is how a real bug gets buried.

---

## `kb/` — eight documents plus an answer key, committed (9 files)

Prose about an invented medical-device company, Zanskar Medtech Limited. Seven
documents ingest as one chunk; `08-commissioning-checklist.txt` is 623 words and
ingests as **two** (`CHUNK_SIZE = 500`, `backend/services/rag.py:46`), so
multi-chunk ingestion is exercised. **9 chunks total** — verified by running the
real `chunk_text` over the files.

`kb-answers.json` is what makes the test falsifiable: 16 questions, each with
the exact strings the answer must contain and the document it must come from,
plus 3 questions the corpus **cannot** answer.

### Two facts that shape every question here

**1. Retrieval is lexical only.** `generate_embedding`
(`backend/services/rag.py:198`) returns `None` unconditionally — "Knowledge-base
search is TEXT-ONLY, deliberately", owner decision 2026-08-17, no Google spend.
The vector half of `search_hybrid` filters on `c.embedding IS NOT NULL` and can
never match. A semantically-correct paraphrase that shares no stemmed term with
the document retrieves **nothing**, and that is not evidence about the KB.

**2. Measured against the live database, 2026-08-29.** A table-free `SELECT`
reproducing rag.py's exact ranking (`setweight(title,'A')||setweight(content,'B')`,
`ts_rank(..., 32)`, the ORed `websearch_to_tsquery`). Every answerable question
ranked its own document **first** and cleared `KB_MIN_SCORE = 0.10`:

```
restocking charge      0.2590      Gold plan price        0.2325
warranty period        0.2198      Silver response        0.2085
commissioning date     0.2085      outbound port          0.1685
RMA format             0.1593
```

**But so did an unanswerable one.** *"What is the calibration interval for the
ZM-4000?"* scores **0.1319** against the commissioning checklist and clears the
threshold, though no ZM-4000 exists anywhere in the corpus. So:

> Assert on the **answer text**, never on whether a chunk came back. A suite
> that asserts "no result for an unknown model" will fail; a suite that asserts
> "a result came back" proves nothing. This is the unfalsifiability §5 warned
> about, and it is a property of `KB_MIN_SCORE`, not of these documents.

Ingestion is not free: `ingest_document` calls `credits.spend` once per
document (`rag.py:302`), so a full ingest costs **8 credits** and needs a
`hub_clients` row — `hub_kb_documents.client_id` is `NOT NULL` and the org that
pays is resolved from it.

---

## `generated/faces/` — 30 synthetic photographs

96×96 PNGs of flat geometry: a bar, a disc, a shoulder wedge, and an index mark
whose length encodes the number. **They are not faces and are not meant to be.**

`backend/routers/pahchan.py:6` — *"Face matching is parked to v2"*. Nothing in
this product compares one of these images to anything. The path a fixture
exercises — upload → R2 → consent gate → access control → retention sweep — is
byte-identical whatever the picture is, so a real face buys zero coverage while
creating a genuine biometric record under DPDP, attributed to a person who does
not exist, in a database production shares. **Do not replace these with real
faces.**

Reusable as the 240 punch selfies (§5 reuses the same set per punch). Each is
~28 KB, comfortably inside `MAX_PHOTO_BYTES`.

## `generated/esign/` — 6 multi-page PDFs

| File | Pages | Placement it exercises |
|---|---|---|
| `esign-01-engagement-letter-2p.pdf` | 2 | Signature + date, page 2 |
| `esign-02-nda-mutual-2p.pdf` | 2 | Two signers, both on page 2 |
| `esign-03-sow-gst-advisory-3p.pdf` | 3 | Initials page 2, signature page 3, three signers |
| `esign-04-office-lease-3p.pdf` | 3 | Initials on pages 1 *and* 2, signatures page 3 |
| `esign-05-board-resolution-4p.pdf` | 4 | Single signer, page 4 |
| `esign-06-audit-representation-6p.pdf` | 6 | Two signers on page 6 — the deep-page case |

Real engagement letters, NDAs, statements of work, a leave-and-licence
agreement, a board resolution pack and a management representation letter. A
human reads these during field placement, so they read as documents.

**PDF 1.4, classic `xref`, no compression, no object streams — deliberately.**
`countPdfPages` (`frontend/src/pages/esign/fieldPlacement.js:229`) counts pages
by scanning raw bytes for `/Type /Page` and `/Count n`, and its own docstring
says both signals are invisible inside a compressed object stream — which is how
most PDF 1.5+ writers store the page tree. A PDF from a modern library reports
**0 pages**, the placer degrades to "assume one page", and the page-2 placement
these fixtures exist for never happens.

Verified: `countPdfPages` returns 2, 2, 3, 3, 4, 6 — matching the filenames —
and `pypdf` (the library `esign_signed_doc` itself uses) extracts real text from
the last page of every one.

## `generated/attachments/` — 40 files, mixed types

8 PNG · 6 PDF (1–3 pages) · 7 TXT · 6 CSV · 5 DOCX · 5 SVG · 3 GIF.

All 40 verified to pass the real server type gate — `_sniff_mime` plus the
`ALLOWED_TYPES`/`ALLOWED_EXTENSIONS` predicate from `backend/routers/uploads.py`
— by importing that module and running it over them. The 5 SVGs pass the real
`_svg_is_safe`. The DOCX files are genuine store-only ZIPs with valid minimal
OOXML and open with `zipfile` cleanly.

`MAX_TASK_ATTACHMENTS = 5` (`backend/server.py:1457`), so six files on one task
is the count limit — a separate assertion from the size limit below.

**No JPEG, WEBP or HEIC.** There is no image encoder in this toolchain and
shipping bytes that cannot be verified to decode would be worse than the gap.
The `\xff\xd8\xff` branch of `uploads.py:_MAGIC` is therefore not covered by
these fixtures. No video either, for the same reason.

## `generated/oversize/` — the limit fixtures

Generated, never committed — this is the whole reason this directory is a
generator.

| File | Size | Limit crossed |
|---|---|---|
| `oversize-10mb-plus-1.pdf` | 10,485,761 B | `MAX_BYTES = 10 * 1024 * 1024` — `backend/routers/uploads.py:25` |
| `oversize-photo-768kb-plus-1.png` | 786,433 B | `MAX_PHOTO_BYTES = 768 * 1024` — `backend/routers/pahchan.py:120` |
| `refused-type.md` | 137 B | *Type* gate, not size — expect **415**, not 413 |

Each is exactly **one byte** over its constant, read from the module rather than
retyped. Both sizes and the type verdict were confirmed by importing the real
constants and running the real predicate.

`MAX_BYTES` is the limit the attachment suites hit: task attachments
(`backend/server.py:5351`), CRM documents (`backend/routers/graha.py:4660`
imports it as `DOCUMENT_MAX_BYTES`) and `/api/upload` all use it. The `.pdf`
extension matters — `uploads.py:163` selects `MAX_BYTES_VIDEO` (25 MB) for a
video extension, so the same bytes named `.mp4` would be **accepted**.

`refused-type.md` is small on purpose: to prove the *type* gate it must not also
cross a size limit, or the 415 and the 413 are indistinguishable.

> **Defect found while sizing these.** The punch-photo 413 message is built as
> `f"{MAX_PHOTO_BYTES // (1024 * 1024)}MB photo"` (`pahchan.py:713`). With
> `MAX_PHOTO_BYTES = 768 * 1024` that integer division is **0**, so a field
> worker whose selfie is refused is told *"File exceeds the 0MB photo limit"*.
> The comment above `_mb` in `services/storage.py:209` records that this exact
> class of drift has already shipped once.

## Org logos — committed (2 files)

`logo-unicode-e2e.svg` (pre-existing, Unicode Group) and
`logo-uk-aekaminc-e2e.svg` (new, UK AekamINC) — the two main test orgs. Both
pass `_svg_is_safe`; `suite02-org-settings.spec.ts:1410` already consumes the
first and documents why that gate matters.

---

## Rules these fixtures were built under

- **Deterministic.** No `Math.random`, no clock. PNG compression is a
  hand-written *stored* deflate stream rather than `node:zlib`, so no zlib build
  can move a byte; ZIP entries carry a fixed 2020-01-01 timestamp.
  `MANIFEST.txt` pins a SHA-256 per file and `--check` proves it.
- **Small.** Committed content is text. `generated/` is git-ignored.
- **Synthetic and obviously so.** No real person, face, PAN, GSTIN, Aadhaar or
  phone number. Every company, address and identifier is invented, and each
  document says it is a fixture. Telephone numbers use the Ofcom drama range
  `+44 7700 900xxx`, which is unassignable — **India has no reserved test range,
  so every well-formed Indian mobile number one might invent is somebody's real
  phone.**
- **Nothing was verified by writing to the database.** The one live query run
  was a table-free `SELECT` of constant expressions, to settle the KB scoring
  question. No row was read and none was written.
