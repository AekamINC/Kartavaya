# fix-pdf-fonts — the cost report joins the font contract

Branch `fix/pdf-font-contract-cost-report`, cut fresh from `origin/staging`
@ `a1f5dffa` (verified before branching; the worktree was ~758 commits stale at
`1aa49855`).

Rendered with WeasyPrint **68.0** under WSL (`~/wpvenv/bin/python`), matching the
pin in `requirements.txt` and the Pango stack the Dockerfile installs. Every
number below was regenerated in this session. Nothing was transcribed from the
two prior reports.

---

## 1. The defect, confirmed in bytes and in pixels

`backend/services/cost_report_pdf.py` holds **two** client-facing documents, not
one — `generate_cost_report_pdf` and `generate_credit_report_pdf` — and both
were off the contract. Five Devanagari runs between them:

| document | run | was |
|---|---|---|
| cost report | `उपयोग एवं लागत प्रतिवेदन` (subtitle) | tofu |
| cost report | `AI सेवाएं` (heading) | tofu |
| cost report | `डेटा सेवाएं` (heading) | tofu |
| credit report | `क्रेडिट उपयोग प्रतिवेदन` (subtitle) | tofu |
| credit report | `डेटा कैटलॉग` (heading) | tofu |

Pre-fix font resources, walked from `/Resources /Font`, both documents:

```
/KTGASA+DejaVu-Serif-Bold   /XKQQSR+DejaVu-Sans
/UWGIWA+DejaVu-Sans-Bold    /IKCJUC+DejaVu-Sans-Mono
```

No Devanagari face present at all. DejaVu has no Devanagari coverage, so the
headings extracted as `AI Services · AI टटटटटट` and the subtitle as
`ननननन ननन नननन ननननननननन` — every codepoint collapsed onto one substitute
glyph. **I rasterised page 1 of the cost report and looked at it: a row of ▯
boxes under the title and in both section headings.**

### Two measurement traps, both hit

1. **A notdef count is a false negative here.** My `unmappable glyphs` probe
   returned **0** on the tofu document. The substitute glyph is embedded and
   mapped, so nothing reads as unmappable. The discriminating signal is *which
   face the Devanagari span resolved to*, not whether a glyph is missing.
2. **Extracted text lies about Devanagari.** Post-fix, extraction returns
   `'उपयोग एवं लागत प्र'` + `'̫ तवेदन'` (split, with a stray combining mark) and
   `'डिेटा कैटलॉग'` (matra reordered). That is a ToUnicode artefact of visual
   glyph order, **not** broken shaping. I confirmed by rasterising all five runs
   at 520dpi and looking: `प्र` and `क्र` conjuncts are correctly formed, matras
   correctly placed, nothing detached. Judged by eye, as instructed.

Font embedding was checked through `/FontDescriptor → /FontFile2`, never by
`b"FontFile2" in pdf` — that search is permanently False here because the
descriptors sit in compressed object streams.

---

## 2. The fix

Follows `doc_fonts.py`'s grain; no parallel mechanism.

- `font_face_css()` injected into **both** stylesheets — the vendored
  `@font-face` for Tiro Devanagari Hindi plus the `.deva` contract class
  (family, weight 400, `letter-spacing:normal`, `font-synthesis:none`).
- The two subtitles go through `deva_span()` directly.
- The three bilingual headings go through a new `_bi(en, hi)` helper, which
  wraps the Hindi half and **drops the `·` separator along with it** when no
  face is vendored — otherwise the degraded heading reads `AI Services ·` with
  nothing after the middot, which looks as broken as tofu.

Post-fix resources (all four variants): the **same four DejaVu faces as the
baseline**, plus `/GJHCBD+Tiro-Devanagari-Hindi`, embedded `/FontFile2`. Latin
rendering is byte-identical to before. All five Devanagari runs resolve to Tiro.

### A regression I introduced, measured, and reverted

The obvious fix for Devanagari in *tenant data* is to name the Devanagari family
in the three font stacks. I did that, and it was wrong:

> Tiro carries a full Latin repertoire (`latn` sits in its GSUB beside `dev2`),
> and none of Georgia, Times New Roman, Helvetica Neue, Arial or Courier New
> exists in the image. Tiro therefore became the first *present* family in every
> stack and captured the whole document — **all 55 Latin spans moved onto it, the
> bold ones onto a synthesised `Tiro-Devanagari-Hindi-Bold`**, which is exactly
> the weight the contract forbids. Moving it behind the generic did not help.

Reverted; the stacks are unchanged from origin/staging. The span-by-span font
dump is what caught this — the page still *looked* plausible.

**It turned out to be unnecessary anyway.** `@font-face` alone covers tenant
data: WeasyPrint registers the vendored face with fontconfig and Pango reaches
it by per-glyph fallback even though no stack names it. Measured with an org
named `श्री गणेश एंड कंपनी`, plan `मानक`, service `सेवा प्रदाता / मॉडल` — every
run resolved to Tiro, and I looked at the render. The docstring initially
claimed the opposite; I corrected it after measuring.

### Colour — deliberately unchanged, as directed

`cost_report_pdf.py:17` sets `_DEEP = "#0082c6"` on the section headings. Checked
against `design-reference/Kartavaya Redesign/docs/brand.css`:

- `[data-org="aekam"] { --org-accent: #04837A; --org-accent-2: #0082c6; }`
- `--org-accent-2` is live, not retired — line 56 runs the `.lh__mark` logo
  gradient between the two.
- `.lh__kind` (line 68) uses the **primary**.

But `.lh__kind` is not this heading, and **this document is not one of the nine
in `docs/`**, so there is no spec to conform it to. Its whole palette is a
parallel set matching none of brand.css (`_TEAL #05b7aa` vs `#04837A`,
`_INK #1A2230` vs `#14171A`). Repainting one heading would make it the single
conforming value in a non-conforming palette. **Left alone.** Recolouring this
document is a design decision needing a spec, not a font fix.

### Adjacent fixes (call out for review — outside the strict font brief)

- **Escaping.** `org_name`, `signatory_name/designation`, and service/catalog
  names flowed from the DB into HTML unescaped. Not hypothetical: a firm called
  `Shah & Associates` already corrupted the markup. Now via `doc_render.esc`.
  Verified with `Shah & Associates <LLP>` and a service named
  `provider </style><b>x</b> / model` — both render as literal text.
- **`base_url=None`** on both `write_pdf` calls, matching `doc_render.render_pdf`,
  so no relative URL can resolve at render time.
- **`_build_cost_html` / `_build_credit_html` seams** extracted, matching the
  `_build_html` seam the other eight already expose, so the documents are
  measurable without a renderer.

---

## 3. The whole set — what I verified

### Devanagari, all nine

`test_document_statutory.py::test_rendered_documents_wrap_their_devanagari`
scanned only `invoice_pdf` and `payslip_pdf`. **That gap is exactly how this
shipped** — cost_report was never scanned, so nothing objected. Extended to all
nine, with an explicit three-wrapper allowlist (`deva_span(`, `kind_hi=` which
`letterhead()` wraps, `_bi(`).

Proof it bites: run against the pre-fix source it flags **12** unwrapped
literals. It runs without WeasyPrint, so it guards on Windows too.

### The 285mm budget

The eight `doc_render` generators are already covered by `TestPageBudget` at both
volumes, including the exact large ones named in the brief (28 invoice lines, 24
TDS deductions, 34 statement transactions, 16 milestones). **All ran and passed
under WSL**, where they actually execute rather than skip.

The cost report owns its own `@page` (`margin: 20mm 18mm`), so it is inside the
budget *by construction* — a 257mm content box, 28mm of slack — and a prior
agent already pinned that geometrically. Confirmed empirically at large volume;
tallest measured ink on any page was **273.99mm** from the sheet top, against a
277mm floor.

Measured page heights (mm, ink from sheet top):

| document | volume | pages | heights |
|---|---|---|---|
| cost report | 3 + 3 | 1 | 224.82 |
| cost report | **28 + 24** | 2 | 260.57, 260.81 |
| credit report | 3 | 1 | 193.19 |
| credit report | **34 + overage** | 2 | 272.79, 142.98 |

### Orphan pages

No page in any variant carries only a colophon or only a signature. Page 2 of the
large credit report carries the last three catalog rows, the full summary block,
the signature and the footer, with the table header correctly reprinted — I
looked at it. Pinned by a new test asserting every page carries >6 non-empty
lines.

### New tests

`TestCostReportFontContract` — 16 tests, 2 documents × 2 volumes × 4 assertions:
the vendored face is used *and* embedded; no Devanagari run lands on a
synthesised bold; page count; no orphan page.

**Proven to catch the defect:** reverted `cost_report_pdf.py` to the
origin/staging version and re-ran — 4 failed with
`draws no run in Tiro Devanagari Hindi — its Devanagari fell back and is
printing as tofu`, listing the four DejaVu faces. Restored after.

---

## 4. Test results

| run | passed | skipped | failed |
|---|---|---|---|
| **Windows** `cd backend && python -m pytest -q` | **1489** | **138** | **0** |
| **WSL** (WeasyPrint live), same suite | **1622** | **5** | **0** |

Against the 1488 / 122 / 0 baseline: **+1 passed** (the new `_bi` test, which
needs no WeasyPrint) and **+16 skipped** (the new render-level tests, correctly
gated). Totals reconcile: 1489+138 = 1622+5 = **1627**, so all **133** tests that
skip on Windows ran and passed under WSL — the 91 WeasyPrint-only ones the brief
names, plus my 16, plus the rest. **Yes, I ran them under WSL.** The 5 that still
skip are design-intent, not environmental ("only the agreement is explicitly
paginated by the design").

The WSL venv needed `pytest-asyncio`, `fastapi`, `pydantic`, `sentry-sdk`,
`python-dotenv`, `pyjwt` and others installed to run the non-document suites.
`requirements.txt` could not be installed wholesale — the pinned `pydantic-core`
and `asyncpg` fail to build on the venv's Python 3.14 — so **the WSL run uses
newer library versions than production**. The document suites do not touch those
libraries; treat the Windows run as the authoritative gate.

---

## 5. What I did NOT verify

- **I did not view every page of all nine documents.** I rasterised and looked
  at: cost report page 1 (pre-fix, tofu), cost report page 1 (post-fix), the
  hostile/escaping variant, the Devanagari-tenant variant, credit report large
  page 2, and 520dpi crops of all five Devanagari runs. The other eight
  generators were verified by their **test suite** under WSL, not by eye.
- **Nothing was rendered in the real container.** All rendering was WSL with a
  matching WeasyPrint and Pango. Font *selection* depends on what fontconfig
  finds, and the WSL box lacks Georgia/Helvetica/Arial — as does the Docker
  image, but I did not confirm that image-side. The `@font-face` face is
  vendored so the Devanagari result does not depend on this; the Latin
  substitution might differ.
- **No database read or write of any kind**, no email, WhatsApp or push. Every
  document was generated from synthetic fixtures and asserted on as bytes.
  Nothing was dispatched.
- **`nixpacks.toml` still installs no font packages** (noted in `doc_fonts.py`'s
  own docstring). Now less dangerous — the Devanagari face is vendored and
  travels in the PDF — but Latin on that build path is still whatever the base
  image happens to carry. Not in scope; flagging it.
- I did not touch `frontend/` or `mobile/` (peer agents), `main`, or any
  lockfile. Three files changed, all under `backend/`.

## 6. Fixture safety

This is a **cost** report, so fixture figures must not read as a rate card. All
synthetic and obviously so: repdigit charges (`1111.11`), counts as multiples of
111, credits as multiples of 222, services named `Sample Service N`, catalogs
`Sample Catalog N`, plan `Sample Plan`, org `Meghdoot Advisory LLP`. No real
pricing appears anywhere in the diff, including comments.
