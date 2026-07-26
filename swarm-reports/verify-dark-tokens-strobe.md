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
