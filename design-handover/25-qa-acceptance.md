# QA & acceptance

## Prerequisites
- Every other file. This one derives from them.

## Files to create
- `frontend/scripts/check-tokens.mjs`
- `frontend/scripts/check-classes.mjs`

## Estimated scope
Two scripts, one CI step, one checklist.

---

This was parked until implementation started, on the reasoning that a checklist written before any code exists is fiction. That was right. It is unparked now because implementation has started and because the design phase produced a specific, repeating failure that a checklist can catch and a reviewer cannot.

## 1 · Run the mechanical checks first

**Eight defects in this handover were the same bug**, and every one of them was invisible to reading and obvious to a script.

| | What happened |
|---|---|
| `--font-indic` | Mandated across nine files. Declared in no stylesheet. Every Devanagari sub-label rendered in a Latin fallback |
| `--on-ok-container`, `--on-warn-container`, `--on-danger-container`, `--on-danger` | Documented as a rule. Declared nowhere. Three components were unreadable in one theme each |
| 15 `--st-*` / `--ap-*` / `--pr-*` aliases | Specified in `00` §9 with reasoning. Declared nowhere. Every status chip and priority dot painted transparent |
| `--shadow-4` | Used in four files. Defined in dark only. The drawer, drag card, admin sidebar and mobile nav had no shadow in light mode |
| `--dur-instant`, `--dur-xslow` | Lived in `motion.css` only. Any page not loading it skipped the animation silently |
| `btn--pri` | Demonstrated in the component inventory. Defined in no stylesheet. Primary and secondary buttons were visually identical |
| `.btn--ghost`, `.two--wide`, `.note` | Used in markup. No CSS rule |
| Density values | Transcribed into two documents from a third that was already wrong. All five compact values off by 2–4px |

None of these are subtle. All of them survived multiple careful reads. **An unresolved `var()` returns an empty string and CSS drops the declaration — silently, with no console warning.** That is the whole failure mode, and it is why the first two checks below are worth more than the rest of this document.

### `check-tokens.mjs`

Every `var(--x)` referenced in any stylesheet, asserted against every `--x` declared. Fails the build on a miss.

```js
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const DIR = 'src/styles';
const files = readdirSync(DIR).filter(f => f.endsWith('.css'));
const src = files.map(f => readFileSync(join(DIR, f), 'utf8')).join('\n');

const declared = new Set([...src.matchAll(/^\s*(--[\w-]+)\s*:/gm)].map(m => m[1]));
const referenced = new Map();
for (const m of src.matchAll(/var\(\s*(--[\w-]+)\s*(,|\))/g)) {
  // A fallback hides a missing token indefinitely. Record it separately —
  // --on-warn-container "worked" for weeks purely on its fallback.
  const key = m[1], hasFallback = m[2] === ',';
  const cur = referenced.get(key) || { fallback: true };
  referenced.set(key, { fallback: cur.fallback && hasFallback });
}

const missing = [...referenced].filter(([k]) => !declared.has(k));
const hidden  = missing.filter(([, v]) => v.fallback);
const hard    = missing.filter(([, v]) => !v.fallback);

for (const [k] of hard)   console.error(`UNDEFINED  ${k}`);
for (const [k] of hidden) console.error(`UNDEFINED (masked by fallback)  ${k}`);
if (missing.length) process.exit(1);
console.log(`${declared.size} declared, ${referenced.size} referenced, 0 missing`);
```

**Do not give `on-*` tokens a fallback.** A fallback converts a loud failure into a silent wrong colour, which is strictly worse — it is how `--on-warn-container` stayed undefined while light mode looked fine.

### `check-classes.mjs`

Every `className` in JSX, asserted against every selector in CSS. Report both directions: a class with no rule renders unstyled, and a rule with no user is dead weight that the next person will preserve out of caution.

Allow-list the genuinely dynamic ones (`is-*`, `on`, template-literal composites) rather than weakening the match.

### Run both in CI

```json
"scripts": {
  "check": "node scripts/check-tokens.mjs && node scripts/check-classes.mjs",
  "tokens": "node ../mobile/scripts/gen-tokens.mjs"
}
```

`npm run check` on every PR. It takes under a second and would have caught eight of the defects above before review.

## 2 · Contrast, measured against `--bg`

Not `--surface`. `--surface` is a card sitting on the canvas and is always the more forgiving test — three tokens passed against it and failed on the page.

Sweep every leaf text node in both themes with transitions frozen (`* { transition: none !important }`), compositing alpha against the nearest opaque ancestor. Fail below 4.5:1 under 24px.

**Force a full restyle after toggling the theme, or the sweep lies.** Setting `documentElement.dataset.theme` repaints backgrounds but leaves `color` on already-styled nodes resolved to the old custom-property values — so a dark sweep reports light text on dark grounds and invents failures that are not there. A freshly created probe element resolves correctly while its neighbours do not, which is how to spot it. `el.style.display='none'; void el.offsetHeight; el.style.display=''` on `<html>` forces the recalculation. Without it, a clean page measured five false failures and a broken one could measure zero.

**Parse `color(srgb …)`, not just `rgb()`.** Chrome computes `color-mix()` to `color(srgb 0.93 0.90 0.84)` — values in 0–1. A regex that pulls numbers and assumes 0–255 reads every mixed background as near-black and reports the whole page as failing. Same run: 49 false failures, all of them `color-mix` surfaces.

Two more things that sweep alone will not tell you:

- **A host or framework wrapper inherits the authored colour.** A failure reported on a wrapper element is an authored failure — read its parent, do not grep for the wrapper's class name and conclude it is not yours.
- **Only container tokens may sit behind text.** `--outline`, `--outline-variant` and `--scrim` are strokes and overlays with no `on-` partner by design. A count badge on `--outline` was 3.5:1 light and 3.3:1 dark — it failed in *both* themes, so no theme-pairing rule would have caught it.

## 3 · Verify defect claims before acting on them

**Two of the five ship-blockers in `CLAUDE-CODE-START-HERE.md` were false**, and both were produced by grepping for identifier names instead of reading behaviour. The file claimed no focus trap existed anywhere; `FocusTrap.jsx` exists, is imported by `Modal` and `ConfirmDialog`, and is careful work. It claimed `ConfirmDialog` had `aria-modal` with no `role`; it has `role="alertdialog"`, `aria-labelledby`, `aria-describedby` and `useId`.

Worse, the false claims **hid a real defect in the same file**: `FocusTrap` cleanup calls `previous?.focus?.()` with no `isConnected` guard, so after a destructive action — where the trigger's row has just unmounted — the restore is a silent no-op and the user lands on `<body>`. Found only by reading the file the false claims pointed at.

Same pattern in `27-vikray.md`: the ledger attributed a ninth private colour map to `VikrayPage.jsx`, and commit `cae0e0a` had already removed it.

**Every defect claim in this handover is a line-quote, not a behavioural test.** Confirm against the branch. Where a claim is stale, correct the file rather than working around it.

## 4 · Per-screen acceptance

For each screen, in both themes and at 393 / 834 / 1440:

| | |
|---|---|
| Renders | No console error. No unstyled element. No transparent fill where a colour was intended |
| Nav | Every route the sidebar offers resolves to its own screen. `SCREENS.settings` pointed at the HRMS page for a full batch and the gear silently rendered the wrong module |
| Mobile | A hidden desktop nav is **replaced**, never just hidden. Six admin screens and the way back were both unreachable below 1024px because a sidebar was display:none with nothing in its place |
| States | Empty, loading, error, offline — all four, not just the happy path |
| Keyboard | Tab order, focus visible, Escape closes, focus returns to a **connected** element |
| Shortcuts vs states | Any shortcut that *writes* must be unbound while the list is loading, empty or errored — not merely ignored. Press it five times fast during a fetch and confirm nothing is recorded |
| Skeleton CLS | **Measure the offset of the first row from the top of the list container, loading vs loaded — not the total height.** Total height cannot match (a skeleton does not know the row count) and measuring it hides the thing that actually shifts: static chrome that only renders in one state. A column header gated on `state === 'ready'` moved the whole table 31px on arrival, and three rounds of row-level criteria never saw it because the shift was in a *sibling* of the rows. Bind such chrome to a derived condition — `hasTable = loading || (ready && rows.length)` — not to a state literal. Then check the rows themselves at every breakpoint: same resolved `grid-template-columns`, same visible cell count, same height. Achieve that by sharing declarations at both levels, the row selector *and* the cell classes; sharing only the grid leaves `display:none`, alignment and min-width reaching the real row and not the skeleton |
| Measuring layout | Compare both while mounted. `getComputedStyle` on a detached node returns defaults, and a clone appended last inherits `:last-child` rules the original never had — both produce confident, wrong numbers |
| Sweep instrument | A contrast sweep is only as good as its colour parser, and a broken one is worse than none — it reports confident failures on a clean page. Three traps, all encountered here: `color(srgb 0.93 0.90 0.84)` (0–1 values, not 0–255); `rgba(255,255,255,.12)` treated as opaque white, which made every translucent chip in a dark bezel read exactly 1.00; and `element.focus()` not firing React's `onFocus` when the document itself is unfocused, so a focus-dependent style never applies and looks broken. Composite every translucent layer up to the first opaque backdrop, and dispatch `focusin` rather than calling `.focus()` |
| Shortcut binding | Dispatch on the element that owns the handler, not on `window`. And in the component: guard `ev.target.matches(…)` with `instanceof Element` — `window` and `document` have no `.matches`, so a synthetic event throws inside the handler and the feature reads as never bound, with an empty console |
| Burst input | Fire a write shortcut five times in one tick and confirm **five distinct records**. A handler closing over an index reads the same stale value for the whole batch, so it writes one record and silently skips four while the cursor advances correctly |
| Copy | Numbers in prose match what is on screen. A heading that counts its own grid should compute the count |

## 5 · Dark mode

Toggle on every screen, not on a sample. Check specifically:

- Any pair written as `background: X; color: Y` where `X` and `Y` are not a documented `--x` / `--on-x` couple
- Hover direction — lighter on dark, darker on light. A component hardcoding "hover = darker" is wrong in one mode
- `color-mix` percentages, which are not theme-portable
- Anything a `[data-theme="dark"]` override exists for. If the base rule used the right pair, the override is unnecessary and is probably lying

## 6 · What this document cannot do

A checklist catches regressions in things someone already thought about. Every defect in §1 was in a *system* that had been thought about carefully and then not connected to the source. The two scripts are worth more than the six sections after them, and if only one thing here survives contact with the schedule, make it `npm run check`.
