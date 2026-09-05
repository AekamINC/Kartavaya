# Marketing collateral — module flows

A4 landscape, one page per module: what a customer actually does inside it,
in five steps. Cover + ecosystem map + the twelve modules = 14 sheets.

| File | What it is |
|---|---|
| `module-flows.html` | **The source.** Design and copy both live here; edit this. |
| `fonts.css` | Generated. The four brand faces, inlined as base64. |
| `build-fonts.mjs` | Regenerates `fonts.css`. Run only when a face changes. |
| `build-pdf.mjs` | Renders the PDFs. |
| `pdf/kartavaya-module-flows.pdf` | The 14-page deck. |
| `pdf/modules/kartavaya-<code>.pdf` | Twelve single-page sheets, one per module. |

```bash
node docs/marketing/build-pdf.mjs
```

The one-pagers are the *same* source as the deck — `?only=<code>` hides every
other sheet — so a sheet handed to a prospect cannot drift from the deck.

## Three things that will bite whoever edits this

**A sheet that overruns is silent.** `.page` is a fixed 210mm box with
`overflow: hidden`. Content past the bottom does not error, warn or reflow — it
is simply absent from the PDF. An unsized footer mark once took 13 of 14 sheets
over the edge and ate their footers. `build-pdf.mjs` now fails the build on it,
and it measures by *releasing* the fixed height first: `scrollHeight` on the
fixed box clamps and reports 210mm whether the page fits exactly or is clipped
by 20mm. Verified against a deliberately broken sheet.

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

Flows are the flows in `docs/modules/<code>.md`, rewritten for a buyer. Screen
and endpoint figures are the generated ones in `docs/MODULES.md`. Palette and
type are the light arm of `frontend/src/styles/kartavaya-design.css`; the lotus
is drawn from the `COURSES`/`lobe()` geometry exported by
`frontend/src/components/brand/Lotus.jsx`, generated at render time rather than
pasted, so the mark cannot drift from the product by a transcription error.

⚠ **These pages describe the product as designed and built. Before handing one
to a prospect, check the module's row in `docs/STATUS.md`** — ✅ there means a
customer completed the flow end to end, and a few of these flows are 🟡.
