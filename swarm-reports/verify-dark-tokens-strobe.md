# verify/dark-tokens-strobe — reduced-motion strobe, token scanner blind spot, dark-mode parity

Base: `salvage/dark-tokens-strobe` @ `cba34d2`, itself based on `origin/staging` @ `2a2a27b`.
Working branch: `verify/dark-tokens-strobe`.

The salvage commit was recovered from a killed agent and had **never had a gate run against it**.
This document records what of it held under verification, what was stale, and the measurements.

Written incrementally — entries are appended as each item is confirmed.

---

## 0 · Gate baseline on the recovered commit (before any of my changes)

Run from `frontend/`:

```
node scripts/check-tokens.mjs   → check-tokens: 339 declared, 233 referenced, 0 missing      exit 0
node scripts/check-classes.mjs  → 2096 selectors defined, 1416 classes used, 0 missing a rule exit 0
```

Both gates were already green on `cba34d2`. The recovered work did not leave the tree broken;
it left it **unverified**, which is a different thing.

---

## 1 · check-tokens.mjs blind spot — **HELD**

**Claim:** `check-tokens.mjs` does not scan `src/lib/tokens.css`, so tokens used there are unverified.

**Verified, not assumed.** `origin/staging:frontend/scripts/check-tokens.mjs` line 44:

```js
const STYLE_DIR = 'src/styles';
```

and line 63 `readdirSync(STYLE_DIR)`. `src/lib/tokens.css` exists (7 615 bytes) and is a real part of
the cascade — `src/styles/index.css:6` does `@import '../lib/tokens.css'` and `src/index.css:5`
imports it again. It was invisible to the scanner in **both** directions:

- its ~90 declarations did not count, so any `src/styles` file relying on a name it owns would have
  been reported undefined;
- its own `var()` references were never checked, so it could reference a non-existent token and the
  gate would stay green — in the one file whose entire job is aliasing one token layer onto another.

**Salvage fix is correct.** `STYLE_DIRS = ['src/styles', 'src/lib']`, flat-mapped with `join(d, f)`.

**Does widening it break the gate on pre-existing violations? No.** With `src/lib` included the gate
reports `339 declared, 233 referenced, 0 missing`, exit 0. Nothing had to be suppressed and no
pre-existing violation was surfaced. The blind spot was real but had not yet been stepped in.

---

## 2 · Duplicate `@keyframes k-shimmer` — **HELD**

**Claim:** `k-shimmer` was declared twice in `editorial.css` with opposite directions, so the later
one silently captured `.k-skeleton::after`.

**Verified against `origin/staging:frontend/src/styles/editorial.css`:**

```
1662:@keyframes k-shimmer {
2617:@keyframes k-shimmer {
```

Two declarations of the same name in one file. Later wins for both users, so `.k-skeleton::after`
(authored `-100% → 100%`) was actually running the tile's `200% → -200%` sweep from a `-100%` base
position — backwards, across double its authored range.

Salvage renames the second to `k-shimmer-tile`. Confirmed on HEAD: exactly one `@keyframes k-shimmer`
(editorial.css:1674) and one `@keyframes k-shimmer-tile` (editorial.css:2647), each with exactly one
user (1658 and 2635). Correct fix.

Sweep of all stylesheets for any other duplicate keyframe name found one remaining: **`dmPop`**
(declared twice). Not mine — recorded in §7 for whoever owns `components.css`/`drawer.css`.

---

## 3 · Dark-mode token parity — **no holes found**

**Claim to check:** every token the diff added or changed must be declared in BOTH the light and dark
blocks of `kartavaya-design.css`.

**The diff adds exactly one token: `--motion-scale-user`** (kartavaya-design.css:45). Despite the
branch name, the recovered commit contains **no dark-mode colour token work at all** — the only two
hunks in `kartavaya-design.css` are the §1 motion pair and the §5 reduced-motion comment. The "dark
tokens" half of the branch name is not present in the diff. Recorded as a gap, not a defect.

`--motion-scale-user` is declared in a plain `:root { }` block (lines 23–47), not a
`:root, [data-theme="light"]` block, so it applies in both themes. It is a motion scalar, not a
colour — a dark twin would be meaningless. **No hole.**

I additionally ran a full light-vs-dark parity audit across all 27 stylesheets (throwaway script, not
committed). Result: **0 tokens declared in a dark block but never in light/`:root`.** Nine tokens are
declared in `:root, [data-theme="light"]` with no dark override — `--st-requested`, `--st-done`,
`--st-rejected`, `--ap-pending`, `--ap-approved`, `--ap-rejected`, `--pr-urgent`, `--pr-high`,
`--pr-low`. All nine are **aliases** to `--warn` / `--ok` / `--danger` / `--on-surface-3`, which do
flip in the dark block at kartavaya-design.css:239. The behaviour is intentional and documented in
place. False positive; parity is clean.

---

## 4 · THE STROBE — measured, not reasoned about

### Method

A standalone probe (`probe.html`, **not committed**, held in the session scratchpad) loads the two CSS
trees in the app's real cascade order taken from `App.jsx:18-26`, plus `a11y.css` (SkipLink) and
`auth.css` (AuthShell):

```
src/App.css -> src/styles/index.css (and its 13 @imports) -> kartavaya-design.css
            -> editorial.css -> settings.css -> a11y.css -> auth.css
```

- `?v=before` is `origin/staging` — the four changed stylesheets extracted with `git show`.
- `?v=after` is this branch's HEAD.

Real markup is rendered offscreen for every infinite animation in the build. Durations are read from
`element.getAnimations()` -> `effect.getComputedTiming().duration`, i.e. the live `Animation` objects
the browser is actually running, cross-checked against `getComputedStyle().animationDuration`.
Where the media query kills an animation there is no `Animation` object at all, which is what
distinguishes *stopped* from *running-but-invisible*.

The OS setting is emulated at the browser level with Playwright
`page.emulateMedia({ reducedMotion: 'reduce' })` — the real media query, not a stylesheet swap.
The app preference is exercised by replaying `applyPrefs`' own property writes.

Four conditions were measured, because there are two independent paths into reduced motion: the OS
media query, and the in-app Customization preference (which has no attribute to select on, so CSS
cannot branch on it — only arithmetic reaches it).

### BEFORE — `origin/staging`

**App preference Animations = None, no OS setting.** Staging's `applyPrefs` wrote `--motion-scale`
directly; the resulting inline style read `--ix-user: .001; --motion-scale: 0`.

| Element | File | Live duration | Iterations | Verdict |
|---|---|---|---|---|
| `.k-skeleton::after` | editorial.css | **2 ms** | infinite | **STROBE ~500 Hz** |
| `.k-shimmer__tile` | editorial.css | **1.5 ms** | infinite | **STROBE ~667 Hz** |
| `.snd__c.on .snd__w i` | settings.css | **0.8 ms** | infinite | **STROBE ~1250 Hz** |

**The brief's claim — skeleton shimmer strobing at ~2 ms — is HELD, exactly.** 2.000 ms, on the
app-preference path, on every loading screen in the product.

**OS `prefers-reduced-motion: reduce`**, no app preference set:

| Element | Live duration | Verdict |
|---|---|---|
| `.k-skeleton::after` | — | STOPPED (staging's own `@media` block, editorial.css:1682) |
| `.k-shimmer__tile` | **1.5 ms** | **STROBE ~667 Hz** |
| `.snd__c.on .snd__w i` | **0.8 ms** | **STROBE ~1250 Hz** |

So on staging the OS path stopped the skeleton but **not** the tile grid or the sound-preview bars,
and the in-app "None" preference stopped **nothing** — it accelerated all three into a strobe. Both
paths were affected; the in-app path was the worse of the two.

In the before/OS-reduce run the resolved `--motion-scale` was `0`, which confirms `a11y.css`'s
`!important` containment block **was** load-bearing on staging and was not decorative.

### AFTER — this branch

**No strobe under any condition. The lowest infinite duration anywhere is 640 ms.**

| Element | OS reduce | App = None | Note |
|---|---|---|---|
| `.k-skeleton::after` | STOPPED | 2000 ms, amplitude 0 | `opacity: var(--motion-scale)` |
| `.k-shimmer__tile` | 1500 ms, amplitude 0 | 1500 ms, amplitude 0 | not stopped — see section 5 |
| `.snd__c.on .snd__w i` | 800 ms, amplitude 0 | 800 ms, amplitude 0 | not stopped — see section 5 |
| `.ix-skeleton::after` | STOPPED | 1600 ms, opacity 0 | animations.css section 9 |
| `.ix-pulse` | STOPPED | 2000 ms, amplitude 0 | animations.css section 9 |
| `.au__wm` | STOPPED | 40 000 ms | auth.css:36 |
| `.k-spinner` | STOPPED | 700 ms | functional, but stopped by choice |

### The `--motion-scale-user` fix, proven

The decisive test: **OS reduce ON, app preference set to FULL.** The root's inline style carried
`--ix-user: 1; --motion-scale-user: 1`, and the computed values were:

```
--ix: .001     --motion-scale: 0
```

The media query won over an inline style on `documentElement`. On staging this was impossible —
`applyPrefs` wrote `--motion-scale` itself, inline, and inline beats a media query, so
`--motion-scale: 0` in the reduce block had never once applied without `a11y.css`'s `!important`.
The salvage commit's structural fix is correct and is now demonstrated rather than argued, which
also makes `a11y.css` dropping the `!important` containment safe.

---

## 5 · What the salvage commit did NOT finish, and what I changed

The salvage commit removed the strobe. It did **not** satisfy the rule that an infinite decorative
animation must be *stopped* under reduced motion — it left five of them **running** with amplitude
collapsed to zero. Inert to look at, but a permanent compositor job, and two of the five were not
even inert.

Measured under emulated OS reduce, on the salvage commit:

| Element | State on salvage | Problem |
|---|---|---|
| `.k-shimmer__tile` | running, 1500 ms | never stopped |
| `.snd__c.on .snd__w i` | running, 800 ms | never stopped |
| `.skeleton::after` (legacy) | running, 1700 ms | animations.css §9 named only the `ix-` twin |
| `.animate-pulse` (legacy) | running, 2000 ms | same |
| `.adm__badge-d` | running, 2000 ms, **full amplitude** | literal `.35`, rode nothing |

`.adm__badge-d` and `.au__wm` are the important two: their amplitudes were **literals**
(`opacity: .35`, `translate3d(-14px, -10px, 0) rotate(-1.2deg)`), so they rode neither `--motion-scale`
nor `--ix`. The in-app `Animations = None` preference has no attribute for CSS to select on and can
only be reached through arithmetic — so for those two elements, the in-app preference did **nothing
at all**. The admin "live" dot kept pulsing at full strength for a user who had just turned animation
off.

### Changes made

**`frontend/src/styles/editorial.css`**
- `.k-skeleton::after` → `1.7s var(--ease-standard)` (was `2s ease-in-out`).
- Restored `display: none` beside `animation: none` in its reduce block, matching the reference.
- `.k-shimmer__tile` → `1.7s var(--ease-standard)` (was `1.5s ease-in-out`); added a reduce block.
- `.adm__badge-d`: `@keyframes adm-pulse` 50% step now `calc(1 - .65 * var(--motion-scale, 1))`
  instead of the literal `.35`, plus a reduce block. Duration/easing (`2s var(--ease-standard)`)
  already matched MOTION-SPEC §4's timer dot and were left alone.

**`frontend/src/styles/settings.css`**
- Added a reduce block for `.snd__c.on .snd__w i`.

**`frontend/src/styles/animations.css`**
- `.ix-skeleton::after` and `.skeleton::after` → `1.7s` (were `1.6s`).
- Added a second reduce block at the end of §10 for `.skeleton::after` and `.animate-pulse`.

**`frontend/src/styles/auth.css`**
- `@keyframes auWmDrift` travel now multiplied by `var(--motion-scale, 1)`.

### A cascade trap, found by measuring rather than reading

My first attempt added `.skeleton::after` and `.animate-pulse` to the **existing** §9 reduce block.
The probe showed both still running at 1700 ms and 2000 ms. `@media` contributes **no specificity**,
and those two selectors are declared in §10, *later in the same file* — so the §10 rule won on source
order and the stop never applied. The block had to be repeated at the end of §10.

This is the exact failure the brief warned about, and reading the CSS would not have caught it. It is
recorded in the code comment so it is not re-broken.

### Final state — OS `prefers-reduced-motion: reduce`

```
k-skeleton::after         | decorative | STOPPED
k-shimmer__tile           | decorative | STOPPED
snd__c.on .snd__w i       | decorative | STOPPED
ix-skeleton::after        | decorative | STOPPED
ix-pulse                  | decorative | STOPPED
skeleton::after  (legacy) | decorative | STOPPED
animate-pulse    (legacy) | decorative | STOPPED
adm__badge-d              | decorative | STOPPED
au__wm                    | decorative | STOPPED
k-spinner                 | FUNCTIONAL | STOPPED   (by explicit choice, editorial.css:3430)
spin                      | FUNCTIONAL | 640 ms    running
gr__spin                  | FUNCTIONAL | 900 ms    running
prg--ind .prg__f          | FUNCTIONAL | 1150 ms   running

decorative still running: NONE          strobes: NONE
```

Amplitude at in-app `Animations = None`, read from the live keyframes:

```
sndW bars      scaleY(1) -> scaleY(1)                          identical, no motion
adm dot        1 -> 1 -> 1                                     was 1 -> .35 -> 1
auth watermark none -> translate3d(0px, 0px, 0px) rotate(0deg) was -14px/-10px/-1.2deg
ix-pulse       1 -> 1 -> 1
```

The three functional loading indicators keep running deliberately. That is the documented decision in
`animations.css` §9 — WCAG 2.3.3 governs non-essential animation, and freezing a spinner removes the
only feedback a slow request has. `.k-spinner` is the odd one out: it *is* stopped, with its own
rationale (a static ring plus the progress text beside it). I left the inconsistency alone rather than
widen scope, but it is worth one decision by whoever owns loading states — see §7.

---

## 6 · SPEC DEFECTS FOUND (new — for `_SOURCE-MAP.md`)

Three new ones, all in the motion spec, all pointing the same way.

### D1. `design-handover/16-animations.md` §1 rule 1 mandates the strobe

Line 44, verbatim:

> **Never hardcode a duration.** … Always `var(--dur-*)` or `calc(… * var(--ix))` for one-offs like
> the spinner: `animation: dmSpin calc(.7s * var(--ix)) linear infinite`.

The worked example is an `infinite` animation whose duration is multiplied by `--ix`. At `--ix: .001`
— which the same file sets three lines earlier — that is a **0.7 ms spinner**. This instruction is the
origin of all three strobe sites this branch fixes. It is provably wrong and must not be followed for
infinite animations.

### D2. The reference implementation carries the same bug

`design-reference/Kartavaya Redesign/motion.css:117`:

```css
.dm-spin { … animation: dmSpin calc(.7s * var(--ix)) linear infinite; }
```

with `motion.css:24` setting `:root { --ix: .001 }` under reduce. Same defect, in the file the source
map calls the answer. Note `motion.css:371` (`.tt2__dot`) uses a **fixed** `2s`, so the reference is
inconsistent with itself: one infinite loop is scaled, the other is not.

`motion.css` also has **no per-element `animation: none`** under reduced motion anywhere, so nothing
in the reference motion layer actually stops. The one place the reference gets it right is
`app.css:286-288`, which is the value I built to:

```css
.sk::after { … animation: shim 1.7s var(--ease-standard) infinite; }
@media (prefers-reduced-motion: reduce) { .sk::after { display: none } }
```

Fixed duration, and disabled outright. That is the correct pattern and it contradicts D1/D2.

### D3. `tokens.css` zeroes durations; two other spec files forbid exactly that

`design-reference/Kartavaya Redesign/tokens.css:241`:

```css
@media (prefers-reduced-motion: reduce) { :root { --dur-instant: 0s; --dur-fast: 0s; … } }
```

`0s`. But `16-animations.md` §1 rule 2 and `MOTION-SPEC.md` §1 both insist on `.001`, and give the
reason: a zero-duration animation never fires `animationend`, so any handler unmounting on
exit-complete leaks its node. The build correctly uses `.001`. `tokens.css` is wrong here.

Also worth recording, not a defect but a divergence: `tokens.css` has **no `--ix` at all** (durations
are literals, zeroed by media query) while `motion.css` defines `--ix` and derives durations from it.
Two different mechanisms in two reference files.

### On `--motion-scale`

`--motion-scale` does not exist in the reference implementation. Its only mention anywhere in
`design-reference/` is `SETTINGS-ADMIN-SPEC.md:74`, which gives it the values `1 / 0.5 / 0.001` —
i.e. treats it as a duration scalar. The build's separation (`--ix` = duration, bottoming at `.001`;
`--motion-scale` = distance, bottoming at `0`) is a build invention that is **better than the spec**,
and it is what makes amplitude collapse possible. Keep it; do not "correct" it toward the spec.

---

## 7 · Not mine — for other agents

- **`@keyframes dmPop` is declared twice.** Sweeping every stylesheet for duplicate keyframe names
  turned up exactly one remaining collision after `k-shimmer` was fixed. Same class of bug: later
  declaration silently wins for every user of the name. Owner: whoever holds `components.css` /
  `drawer.css`.
- **`.k-spinner` stops under reduced motion while `.spin`, `.gr__spin` and `.prg--ind .prg__f` keep
  running.** All four are functional loading indicators. Both behaviours are defensible; having both
  is not. One decision needed.
- **`AutomationsPage.jsx:358`** carries an inline `style={{ animation: 'spin 1s linear infinite' }}`.
  Fixed duration so it does not strobe, but it is invisible to every stylesheet-level reduced-motion
  rule and to the `--ix` ladder. Owner: whoever holds that page.

---

## 8 · Claims from my brief, adjudicated

| Claim | Verdict | Evidence |
|---|---|---|
| Infinite animations written `calc(Xs * var(--ix))` strobe under reduced motion | **HELD** | 3 sites, measured at 2 ms / 1.5 ms / 0.8 ms |
| Skeleton shimmer measured at ~2 ms | **HELD, exact** | 2.000 ms, app-preference path |
| `check-tokens.mjs` does not scan `lib/tokens.css` | **HELD** | `origin/staging` line 44, `STYLE_DIR = 'src/styles'` |
| Widening the scan might surface pre-existing violations | **did not happen** | 339 declared / 0 missing, exit 0 |
| Salvage diff fixes the strobe | **HELD** | no duration under 640 ms in any condition |
| Salvage diff *stops* infinite animations under reduce | **STALE / incomplete** | 5 still running; fixed in this branch |
| Dark-mode holes among added/changed tokens | **NOT FOUND** | only `--motion-scale-user` added; theme-independent `:root` |
| Branch name implies dark-mode colour token work | **STALE** | no colour token work in the recovered diff at all |

---

## 9 · What I could not finish

Nothing in scope was left undone. Two things I deliberately did **not** do:

- Did not change the functional spinners (`.spin`, `.gr__spin`, `.prg--ind .prg__f`) — flagged in §7
  as a decision for their owner rather than taken unilaterally.
- Did not touch `AutomationsPage.jsx`'s inline animation — different owner, and it does not strobe.

The probe is not committed, per the brief. It lives in the session scratchpad as `probe.html` with
`before/` and `after/` CSS trees.
