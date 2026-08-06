# 29 · Sahayak — the assistant

**Srijan is now Sahayak.** The module keeps its route and its tables; the name,
the surface and the centrepiece change. `सहायक` is *helper* — which is what an
assistant over your own books is, where *सृजन* (creation) described only the
content-generation half.

**Prerequisites:** `00-tokens.md`, `02-common-components.md`.
**Prototype:** `Kartavaya Redesign/Sahayak.html` · `sahayak.css` · `lotus.css` ·
`Sahayak.jsx`, `SahayakData.jsx`, `Lotus.jsx`.

**Build this surface to the pixel.** `sahayak.css` is the reference — match
spacing, radii, shadow steps and type exactly as drawn, in both themes. Where
this file and the stylesheet disagree, the stylesheet is right.

## Read this before anything else — the palette is settled, and it costs something

**Decision, 2026-08-06: Sahayak ships on the product's cream palette, matching this prototype exactly.**

Upstream already has `frontend/src/styles/sahayak.css` (28 KB) and `pages/srijan/SahayakTab.jsx` (27 KB), built from `docs/proposals/19-sahayak-final.html`, "the layout the owner approved." That build scopes `k-surface-theme` on `.sh`, so every token in it resolves to the **Slate / indigo** palette in `surface-theme.css`. That scope is what goes.

**The change itself is one line: remove `k-surface-theme` from `.sh`.** Nothing in this prototype's `sahayak.css` carries a palette — every colour is a token, so the surface simply resolves to whatever palette is in scope, and with the scope gone that is the product's own. The layout, spacing and type in the existing build are not in question and do not change.

**What it costs, and do not skip this:** the existing file's contrast work was measured *by hand, against Slate and indigo specifically* — its own header says `check-contrast.mjs` cannot see scope and measures the file against a palette it never renders on. Every one of those measurements is now void. **Re-run the pass against cream and dark before this ships.** Two known traps:

- `--mc` is declared only on `.sh-ac[data-kind]`, so it is invisible to the contrast gate. Any rule reading `--mc` is unmeasured by `npm run check` on either palette.
- The pairs to re-check first are `--primary-text` on `--primary-container` (`.sh-card__hd`, `.sh__a-av`, every `cite:hover`), `--on-surface-3` on `--surface` (all four `__fig-l`/`__fig-s`/`__work-r code` label runs), and `--warn` on `--surface` (`.sh-src__w`).

**Build from this prototype's `sahayak.css`, not from the upstream file.** It is the pixel reference. Two things in it were fixed on the way to this decision and must come along:

- The four literal warm shadows (`rgba(28, 24, 16, …)`) are now `--shadow-card`, `--shadow-block` and `--shadow-seat` in `tokens.css`, with black counterparts in dark. Light values are byte-identical to what was drawn; a literal warm shadow on `#12151A` is a smudge, and this surface is mostly blocks floating on a patterned ground.
- `.sh` no longer carries a fallback inside `var(--shadow-1, …)`. The token is defined; the fallback was hiding whether it was.

## Files to change
- `pages/srijan/SahayakTab.jsx` and `srijan/sahayak/` (`AnswerCards.jsx`, `SourcesPanel.jsx`, `sources.js`)
- `pages/srijan/*` → `pages/sahayak/*`, and the nav label. Route stays `/srijan`
- `lib/labels.js`, `navConfig.js`, `moduleColors.js` — the rename, whole-string only

## Estimated scope
A rename, one restyled surface, and the contrast re-measurement the palette
decision above forces. The rename is mechanical; the re-measurement is not.

---

## 1 · What it is

An assistant that answers over **your own records**, and cites them. Not a
chatbot: it has no general-knowledge mode, and there is nothing in it that
answers a question the product's own data cannot.

Distinct from `hub/ChatTab.jsx`, which is the marketing chatbot embedded on a
*client's* website for their visitors. Two different products with two different
audiences; do not merge them and do not share a component between them.

## 2 · The answer contract

Four rules. Everything on the surface exists to serve one of them.

1. **Every claim carries a source, and the source is a control.** A cite opens
   the record. An answer that cannot point at where it came from is not shown.
2. **It refuses rather than guesses.** Every answer carries a *what it would not
   tell you* block when the question had a part the data cannot support. This is
   the most important element on the screen and it is not optional — an
   assistant that always produces something is one you cannot trust when it
   matters.
3. **Only records the caller can already open.** A question whose answer sits
   behind a permission they do not hold returns the refusal, not the answer. The
   assistant is not a route around RBAC. Enforced server-side; the RBAC filter is
   deliberately **not narrated** to the reader — the owner removed a "what I can
   see" panel from an earlier draft, so do not put it back.
4. **The work is named, not spun.** A spinner over a data question tells the
   reader nothing about what is being read on their behalf. `.sh__work` lists the
   steps as they resolve, with the function name and whether it is free.

## 3 · Free steps and metered steps

The same split `skill_dispatcher` makes, surfaced:

| Step | Cost | Shown as |
|---|---|---|
| `skill_function` | free — it is a database read | "Reads your data" |
| `agent_type` | metered in credits | "Writes with AI" |

A figure the assistant states must be **attributable and copyable** — `.sh__fig`
carries the route it came from in its `title`. Never render a number with no
provenance; that is the one thing worse than not answering.

## 4 · Three answer layouts

| | What it is | When |
|---|---|---|
| **Cited prose** | Paragraph with numbered cites, sources panel beside | The answer is a judgement — "is this moving or stuck" |
| **Answer-first** | Figures first, prose second, no panel | **Ship this as the default.** Most questions in an accounting product have a number as the answer |
| **Split evidence** | The answer beside the rows it was computed from | The most trustworthy and the most expensive in space. Offer as a toggle on any answer |

Split evidence earns its own note: it lets the reader **check** the assistant
rather than believe it, and that is what earns a second question. The panel shows
the query result, not a copy of it.

## 5 · The conversation ground

Sahayak shares `data-conv-pattern` / `data-conv-ground` with Sanvaad, at twice
the motif scale — `--conv-motif-lg`. See `28-messaging-v2.md` §6. These are the
two surfaces in the product where you talk rather than work, and they are the two
that get a ground of their own.

**Including `kamal`, the sixth pattern that `28` §6 asks you to add** — the lotus
rosette, drawn from the same `LOTUS_COURSES` table as §6's loader. It matters
most here: this is the surface where the figure is already on screen at 30px
beside every reply, so the ground and the waiting state visibly share a hand.
Read the constraints in `28` before drawing it — rosette course only, no outer
petals, or it becomes a watermark.

## 6 · The lotus is the only waiting state

`components/brand/Lotus.jsx` and `layout/BrandLoader.jsx` already ship. **There
is no second spinner in this product**, and the assistant does not get one.

- **At rest** beside a finished reply, 30px, in place of an avatar.
- **Drawing** while a reply is on its way — the same component, unchanged.
- **104px** in the empty state, above the Devanagari wordmark.

The canonical CSS is `styles/components.css:1380–1446`. `lotus.css` in this
bundle is a transcription for the prototype: its timing is reconstructed from the
shipped component's documented pace and its stroke width is measured off the
render. **Lift the real block, not mine.**

Three properties of it are load-bearing and easy to lose: one pen (uniform stroke
width at every size), one colour (no opacity ramp), and it undraws rather than
fades — a fade leaves a grey ghost frame, and an indicator that goes momentarily
invisible is indistinguishable from one that has died.

## 7 · Feedback goes to the skill, not the conversation

`hub_skill_feedback` already exists. Thumbs-down opens four reasons — wrong
figure, missed a record, cited the wrong source, should not have answered — and
the row is stored against the **skill template**, so it improves the next
person's answer and not just this thread.

## 8 · Endpoints

| Verb | Route | Note |
|---|---|---|
| POST | `/v1/hub/chat` | The turn. Appends numbered sources to the prompt |
| GET | `/v1/hub/org/credits` | The live cost table. **Never print a figure this did not return** |
| GET | `/v1/hub/skills/capabilities` | What this server can actually run |
| POST | `/v1/hub/skills/feedback` | §7 |

## 9 · What changes

| File | Change |
|---|---|
| `SahayakTab.jsx` | Answer-first default; named work steps; the refusal block as a first-class element |
| `sahayak/AnswerCards.jsx` | Two of three card kinds already renderable — waiting on the model returning sections, which is a response-schema change, not styling |
| `sahayak/SourcesPanel.jsx` | Add the split-evidence mode (§4) |
| `styles/sahayak.css` | Drop `k-surface-theme` from `.sh`; rebuild against this bundle's `sahayak.css`; re-run contrast on cream **and** dark |
| `navConfig.js`, `labels.js` | Srijan → Sahayak, whole quoted strings only |
