# Marketing collateral — the module sheets

A4 landscape. **Four sheets per module**, because one was not enough to sell
with: a one-pager answers *what is this* and a buyer's next three questions are
*what is actually in it*, *why should I believe you* and *what does a Tuesday
look like*.

| Sheet | Answers | Shape |
|---|---|---|
| **Overview** | What is this module? | The five-step flow, left to right |
| **Capabilities** | What is actually in it? | Six themed groups + the surface figures |
| **Proof** | Why does it hold up? | Four claims, each with **the mechanism under it** |
| **In practice** | What does a day look like? | A worked scenario, who uses it, the data it holds |

## Three documents, one source

```bash
node docs/marketing/build-pdf.mjs
```

| Output | Sheets | For |
|---|---|---|
| `pdf/kartavaya-product-book.pdf` | 54 | The full book — cover + map + 13 × 4 |
| `pdf/kartavaya-module-flows.pdf` | 15 | The short deck — cover + map + the 13 overviews |
| `pdf/modules/kartavaya-<code>.pdf` | 4 | One module's brochure, to hand over |

All three are the **same source**. `?only=<code>` selects one module's four
sheets; `?level=overview` drops the depth sheets. **A brochure handed to a
prospect therefore cannot drift from the book it came out of** — which is the
whole reason it is built this way rather than as fourteen documents.

Page numbers are stamped **after** that filter, over what is actually visible.
A number baked in at render time would be right in one of the three documents
and wrong in the other two.

| File | What it is |
|---|---|
| `module-flows.html` | **The source.** Design and copy both live here; edit this. |
| `fonts.css` | Generated. The four brand faces, inlined as base64. |
| `build-fonts.mjs` | Regenerates `fonts.css`. Run only when a face changes. |
| `build-pdf.mjs` | Renders the PDFs, and fails on the two silent layout faults below. |
| `pdf/` | **Not in git** — build output. Run the command above to produce it. |

`pdf/` is gitignored on purpose: every rebuild rewrites all sixteen files with
different bytes, which is several MB of undiffable binary added to a PUBLIC
repo's history per edit. The source and the embedded fonts are both committed,
so the build is reproducible from a clean checkout with no network — that is
what makes the outputs safe to leave out.

## Four things that will bite whoever edits this

**A sheet that overruns is silent.** `.page` is a fixed 210mm box with
`overflow: hidden`. Content past the bottom does not error, warn or reflow — it
is simply absent from the PDF. An unsized footer mark once took 13 of 14 sheets
over the edge and ate their footers. `build-pdf.mjs` fails the build on it, and
it measures by *releasing* the fixed height first: `scrollHeight` on the fixed
box clamps and reports 210mm whether the page fits exactly or is clipped by
20mm. Verified against a deliberately broken sheet.

⚠ **The tightest sheets are the OVERVIEW ones, not the dense new ones.**
Measured after the depth sheets landed: `kray/Overview` has **0.7mm** of slack
and `graha`, `ganit` and `manav` overviews are all within 6mm. The Capabilities
sheets have ~5mm, Proof ~8mm, In practice ~32mm. **Adding a sentence to an
overview sheet will overflow it** — the build will catch you, but expect it.

**A capability heading that wraps is silent too, and it is ugly.**
`.cap__label` is a non-wrapping flex row; when the heading and its note are too
wide for the 84mm column the *heading* breaks internally, and that group's rule
drops several millimetres below the other two in its row. Twenty of them wrapped
on the first render. `assertLabelsFit` fails the build on it — also verified
against a deliberately broken label. Keep heading + note **under ~40 characters
combined**.

**Fonts are embedded, not linked, and that is not a preference.** With a
`fonts.googleapis.com` link, nine of the twelve one-pagers embedded Windows'
Nirmala UI in place of Tiro Devanagari Hindi while the deck and three others
were clean — same source, same run. It is not a layout-time fallback: CDP
reports every Devanagari element resolving to Tiro on screen. The substitution
happens in Chromium's *print* pass, which re-resolves fonts, and neither
`networkidle` nor `document.fonts.ready` nor an explicit `document.fonts.load()`
governs it. A data: URI leaves no fetch to lose.

**`--primary #04837A` fails AA on every ground in this document** — 3.08:1 to
4.25:1 on the cream ladder. It is a stroke and fill colour only. Accent *words*
use `--primary-text #046B64`, which holds 4.66:1 on the darkest ground used.

## Where the content comes from

Flows are the flows in `docs/modules/<code>.md`, rewritten for a buyer.

⚠ **Every line in a `caps` group corresponds to a real route or table in
`docs/modules/<code>.md`.** That is the rule the depth content is written under
and the reason it is worth handing to a prospect: the feature list is the
product's own surface restated for a buyer, not a wish list. If you add a
capability line, be able to point at the endpoint.

`owns` names real tables, deliberately. A buyer evaluating a system of record is
buying the schema, and its shape is the honest answer to *what happens when we
outgrow you*.

Palette and type are the light arm of `frontend/src/styles/kartavaya-design.css`;
the lotus is drawn from the `COURSES`/`lobe()` geometry exported by
`frontend/src/components/brand/Lotus.jsx`, generated at render time rather than
pasted, so the mark cannot drift from the product by a transcription error.

### ⚠ The "Screens" figure — corrected, and how

It was wrong on **eleven of thirteen** sheets and inflated on nine of them:
Graha claimed 34 screens against a real 25, Sahayak 25 against 16, Vikray 20
against 13. The figure had been taken from the **Pages** column of
`docs/MODULES.md`, which counts every file under `pages/` — **including
`__tests__`**. A prospect's technical reviewer would have found that.

It is now the pages-directory count **excluding tests**, which is what the word
"screens" can honestly carry. Re-derive rather than cite:

```bash
cd docs/modules && for f in graha vikray ganit kray esign manav pahchan \
  vetana prachar varta sanvaad sahayak dristi; do
  pages=$(sed -n '/^## Frontend/,/^## Integrations/p' $f.md | sed '/\*\*Components\*\*/,$d' | grep -c '^- `')
  tests=$(sed -n '/^## Frontend/,/^## Integrations/p' $f.md | sed '/\*\*Components\*\*/,$d' | grep -c '__tests__')
  printf "%-9s %s\n" "$f" "$((pages-tests))"
done
```

Endpoint and table counts are the generated ones in `docs/MODULES.md` and were
correct.

⚠ **These pages describe the product as designed and built. Before handing one
to a prospect, check the module's row in `docs/STATUS.md`** — ✅ there means a
customer completed the flow end to end, and a few of these flows are 🟡.
Known ones to watch as of 2026-09-07: the **Sahayak** shelf is 78 templates with
**ten armed on a schedule**, not seventy-eight; **Varta** needs the org's own
WhatsApp Business credentials before it sends anything.
