# Agent report — dashboard ("Today"), customize hub, shared UI primitives

Branch: `worktree-agent-ab5735a3876bb7112`
Surface owned: `frontend/src/pages/DashboardPage.jsx`, `frontend/src/pages/today/**`,
`frontend/src/components/CustomizePanel.jsx`, `frontend/src/pages/customize/**`,
`frontend/src/components/customize/**`, `frontend/src/components/ui/**`.

Written incrementally. Each entry was confirmed by reading the file at the stated
line before it was written down.

---

## 0 · Worktree base was wrong

The worktree was cut from `origin/main`, not `origin/staging` — `git rev-list
--left-right --count HEAD...origin/staging` reported `13 271`. The 13 "ahead"
commits were `main`'s own tip (R2 attachment fixes), not work belonging to this
agent. Reset to `origin/staging` (`2a2a27b`) before any edit. The 13 commits
remain reachable from `main`, so nothing was lost.

Anyone else seeing a stale worktree should check the same thing before reporting
a file as missing — several of the files in this task's brief only exist on
`staging`.

Baseline gates on `2a2a27b`, run from `frontend/`:

- `check-tokens` — 279 declared, 229 referenced, 0 missing. PASS
- `check-classes` — 2096 selectors, 1416 classes used, 0 missing. PASS

Both scripts `process.exit(1)` unless run with `frontend/` as cwd; run them as
`cd frontend && node scripts/check-tokens.mjs`, not from the repo root.

---

## 1 · The five named primitive bugs — ALL STALE, all already fixed

Every one of the five defects in the brief is already repaired on `staging`.
Verified against the code, not against the comment claiming the fix.

### 1.1 StatTile cross-file specificity — STALE (fixed)

Claim: `components.css` `.k-stat--ok .k-stat__val` at (0,2,0) beat
`editorial.css` `.k-stat__val` at (0,1,0) across files, so `ok`/`danger` painted
the number and `info`/`blue`/`teal` did not.

Evidence it is fixed: `grep -rn "k-stat--" frontend/src/styles/` returns
**zero** rules in `components.css`. The variant vocabulary is declared once, in
`editorial.css:866-875`, and only ever as `--c` / `--c-text` custom properties —
never as a `color` on a descendant. `components.css:832-846` is now a comment
recording the deletion. `.k-stat__val` (`editorial.css:887`) sets
`color: var(--on-surface)` and nothing overrides it, so the number is ink in all
nine variants. The tone reaches the 2px cap via `.k-stat::before` and the
Devanagari sub-label via `--c-text`.

`ui/StatTile.jsx:33-39` carries the alias table including `info: 'info'`, so all
nine names resolve.

### 1.2 DueChip painted the suppressed case — STALE (fixed)

`ui/DueChip.jsx:87` reads:

```js
if (DONE_STATUSES.has(status) && (!date || tone === 'danger')) return null;
```

The `!date` arm is present, so done-with-no-due-date returns `null` rather than
a bare em-dash `k-due--muted` chip. `relDue(null)` at line 19 returns
`{ label: '—', tone: 'muted' }`, which is what the old `tone === 'danger'`-only
guard missed.

### 1.3 `variant="dangerfill"` fell through to `ghost` — STALE (fixed)

`ui/Button.jsx:23`:

```js
const VARIANTS = ['fill', 'tonal', 'out', 'text', 'ghost', 'danger', 'dangerfill'];
```

`dangerfill` is in the list, so line 34's `VARIANTS.includes(variant)` keeps it
and `btn--dangerfill` is emitted. The rule exists in `components.css`.

### 1.4 `Toggle` had both `role="switch"` and `aria-pressed` — STALE (fixed)

`ui/Toggle.jsx:22-27` emits `role="switch"` + `aria-checked={checked}` only.
No `aria-pressed` anywhere in the file.

### 1.5 `Popover` exit animation never played — STALE (fixed)

`ui/Popover.jsx:24,34-40` — `EXIT_MS = 130`, `close()` sets `closing` then
unmounts on a timer, line 69 renders `pop is-closing`, and line 40 clears the
timer on unmount so a fast close/unmount cannot leak. `.pop.is-closing` animates
`dmPopOut`. Matches Picker's 130ms.

---

## 2 · EmptyState existed twice under one name — HELD, converged

`ui/EmptyState.jsx` (class `.empty`) and a second `EmptyState` exported from
`components/module/Note.jsx` (class `.mempty`). Not variants of one component —
different props and very different capability. The module one rendered three
bare elements from `title`/`children`/`action`; the ui one has eight SVG
illustrations, a `{ en, hi | gu }` bilingual title **with the matching `lang`
attribute**, an `icon` glyph set, a CTA, and the `tone="ok"` state that
separates "finished" from "empty".

**The module copy had zero importers.** Only four files import from
`components/module/Note` and all four take the default `Note`:

| File | Import |
|---|---|
| `frontend/src/pages/esign/DetailTab.jsx:9` | `import Note from …` |
| `frontend/src/pages/EsignPage.jsx:30` | `import Note from …` |
| `frontend/src/pages/pahchan/EnrollQueue.jsx:8` | `import Note from …` |
| `frontend/src/pages/pahchan/PahchanPolicy.jsx:5` | `import Note from …` |

`EnrollQueue.jsx` is the proof the collision was already live — line 5 imports
the **ui** `EmptyState` and line 8 imports `Note`, so it sits one line away from
both and reaches past the local one.

Removed the export and the three `.mempty` rules (`module.css:183-185`), whose
only user it was. `editorial/ModuleUI.jsx`'s `Empty` was already a pass-through
to `ui/EmptyState`, so the module surfaces route to the survivor.

## 3 · Buttons existed three times — HELD, converged as far as is provable

### 3.1 `brand.css` — dead, deleted

`.k-btn`, `.k-btn-primary`, `.k-btn-outline`, `.k-btn-ghost`. Three findings,
each independently sufficient:

- **The file is imported by nothing.** Not `styles/index.css` (which lists 13
  `@import`s, none of them brand), not `App.jsx` (which imports the barrel,
  `kartavaya-design.css` and `editorial.css`), not `index.html`. `styles/README.md`
  says `lib/brand.js` imports it — **`frontend/src/lib/brand.js` does not exist.**
  The README is stale.
- `.k-btn-primary` / `-outline` / `-ghost` have **zero call sites** in `src`.
- The bare `.k-btn` collided by name with the live one (454 call sites) while
  declaring a different button: `10px 20px` padding against `8px 14px`, weight
  800 against 600, plus `letter-spacing: 1px` and `text-transform: uppercase`.
  One `@import` line away from restyling every button in the product.

It also used `transition: all 0.18s ease` — a literal that ignores `--ix`, which
`16-animations.md` §"Audit before you ship" says is always a bug.

Deleting an unloaded rule cannot move a pixel. This is the one third of the
convergence that is provable rather than argued.

### 3.2 The two live copies — merged, one deliberate pixel change

`.k-btn` was declared in **both** `kartavaya-design.css` and `editorial.css`, at
identical specificity, with `App.jsx` importing them in that order. So the
winner was decided **per property** by document order, and **the button that
rendered was described by neither file**:

| Property | Winner |
|---|---|
| `border-radius` | editorial's literal `8px` beat kartavaya-design's `var(--r-md)` |
| `font-family` | editorial's `inherit` beat `var(--font-ui)` |
| `.k-btn--sm` padding | editorial's `7px 12px` beat `6px 12px` |
| `--primary` box-shadow | editorial's inset + `--k-deep` beat the `--primary-vivid` one |
| `transition` | **survived from kartavaya-design** — editorial declared none |
| `:active` | **survived from kartavaya-design** — editorial declared none |
| `--primary:hover` | **both applied** — kartavaya-design's box-shadow AND editorial's transform, because they set different properties |

That last row is the tell, and it is the same shape as the `.k-stat__val`
cross-file bug: invisible in either file alone.

Merged into one block in `editorial.css` carrying the interleaved result
verbatim, so all 454 call sites are unchanged — **with one deliberate
exception**. `00-tokens.md:96` says, verbatim:

> Never hard-code a radius. A literal `border-radius: 8px` breaks the Sharp and
> Pill settings in exactly that one place.

`editorial.css` **was** that exact literal. Because it outranked
kartavaya-design's `var(--r-md)` by document order, the customize hub's **Corner
radius** control (`pages/customize/TabLayout.jsx:42-49`, writing `--radius-base`
via `applyPrefs`) moved cards, inputs and chips while the product's most-used
button stayed at 8px under all three settings. Restored to `var(--r-md)`:
Sharp 4px, Default 10px, Pill 20px. **+2px at the default** — the point of the fix.

### 3.3 NOT converged, and why

`.btn` (components.css, canonical per 02 §1) and `.k-btn` (legacy, 454 sites)
are left as two. They are not the same button — `.btn` is `8px 15px` with `gap:
7px`, `justify-content: center` and a flat `--primary` fill; `.k-btn` is `8px
14px` with `gap: 6px` and a gradient fill. Rewriting 454 call sites cannot be
done without moving pixels, so it is a call-site sweep, not a stylesheet edit.
Flagged for whoever takes that on. `.btn` is the correct target — it already
matches 02 §34 almost character for character, including `var(--r-sm)`,
`var(--dur-fast)` and `var(--ease-spring)`.

## 4 · Overlay exits ignored the user's Animations preference — NEW, fixed

Not in the brief. Found while checking primitive transition durations per the
coordinator's pixel-perfect note.

`Popover`, `Picker` and `Sheet` each unmounted on a hardcoded constant
(130 / 130 / 220ms) while their CSS exits are `--dur-fast` / `--dur-base` —
`calc(140ms * var(--ix))` and `calc(220ms * var(--ix))`. `--ix` is scaled by the
user's Animations preference (`applyPrefs` writes `--ix-user`; 1 / .5 / .001).
**No constant could have been correct:**

| Setting | CSS exit | JS unmount | Result |
|---|---|---|---|
| full | 140ms | 130ms | unmounted early, exit clipped |
| reduced | 70ms | 130ms | 60ms of dead panel after the fade ended |
| none | ~0ms | 130ms | the setting that asks for *no* animation still made the user wait |

`Sheet` was worst: it holds `overflow: hidden` on `document.body`, so at
`anim: none` the **scroll lock outlived the sheet by the full 220ms**.

Fixed by unmounting on the panel's own `animationend`, so the JS follows
whatever the motion layer sets at any `--ix` without this code knowing the
numbers — **deliberately not a second mechanism**, per the coordinator's note
that the motion agent owns reduced motion. `--ix: .001` rather than `0` is what
makes this reliable, and `CustomizePanel.jsx:253` already documents that as the
reason for `.001`. The constants remain as ceilings for an interrupted or
hidden animation, raised above the CSS duration so they are a fallback rather
than a race.

Both handlers guard on `closingRef.current` **and** `e.target ===
e.currentTarget`. The ENTRANCE keyframe fires `animationend` too — without the
guard each overlay would dismiss itself the instant it finished opening.

**Still hardcoded, not mine:** `components/TaskDrawer.jsx:45` `EXIT_MS = 220`
has the same defect. Left for the drawer's owner.

## 5 · Today dashboard

### 5.1 "Threw before it painted" — STALE

`pages/DashboardPage.jsx` renders. Route wiring is intact
(`App.jsx:45` lazy import, `:101` `withContext`, `:190`
`<Route path="dashboard" element={<DashboardWithContext />} />`). The file
parses (esbuild, JSX loader). No unguarded access on the render path: `tasks` is
seeded `[]` and re-set only via `Array.isArray(...) ? … : []`, `derived` is a
`useMemo` over that, and `teams` defaults to `[]`.

### 5.2 Every tile pulls real backend data — HELD, all four endpoints exist

| Call | Server |
|---|---|
| `GET /api/tasks` | `backend/server.py` `list_tasks` |
| `GET /api/verse-of-the-day` | `backend/server.py:2803` |
| `GET /api/activity/feed` | `backend/routers/activity.py:87` |
| `GET /api/v1/ganit/stats` | `backend/routers/ganit.py:585` (`_gate`-protected) |

No mock data, no stubs anywhere in `pages/today/**`. Every figure is derived
from `/tasks` in the `derived` `useMemo` or comes from one of the other three.

### 5.3 Loading / empty / error — error was MISSING, now fixed

- **Loading** — present and good: `TodaySkeleton` for the body, plus a
  `SkeletonText` lede so the hero does not change height when counts arrive.
- **Empty** — present per surface: `TaskListCard` → `EmptyState`, `TeamPulse` →
  "No activity in the last few days.", `ProjectStatus` → `aria-label="No tasks yet"`,
  `ReceivablesKPI` → returns `null` when ungranted.
- **Error** — **absent.** `/tasks` rejecting landed in a bare
  `.catch(logger.error)`, so `tasks` stayed `[]` and the page rendered its zero
  state in full confidence: four tiles reading 0, "Nothing is assigned to you
  right now", and — the one that makes it a real defect — **"The board is
  clear."** The user is told their work is done when the request failed.

  Fixed. The other two calls in the `Promise.all` swallow their own rejections
  deliberately, so anything reaching the catch is unambiguously the task load
  and `errorKind()` can classify it (offline / 403 / 404 / 5xx) instead of one
  generic message. `load` is a `useCallback` so `ErrorState`'s retry re-runs it.
  `ReceivablesKPI` stays mounted above the switch — separate source, own null
  guard, so a task failure must not blank a figure that did load.

## 6 · Customize hub

### 6.1 Nine delivery modes + overnight schedule — HELD, real and round-tripping

`components/customize/NotifyPrefs.jsx`, mounted at
`pages/customize/TabNotifications.jsx:118`.

- `GET /api/me/notification_prefs` — `backend/server.py:812`
- `PUT /api/me/notification_prefs` — `backend/server.py:824`
- Table `notification_prefs` (`server.py:2879`), columns `prefs` jsonb,
  `quiet_start`, `quiet_end`.
- **Enforced, not decorative**: `services/push_service.py:91-108` reads the row,
  `_in_quiet_hours()` refuses delivery inside the window, and a suppressed kind
  is dropped.

The nine kinds in `KINDS` match `DEFAULT_PREFS` in `server.py:797-807` exactly —
same nine keys, same defaults. GET merges over defaults, PUT upserts the whole
row, and the component always sends the merged object, so no field resets
another. **Round-trip confirmed by reading both ends.**

*(A note on the brief's wording: it is nine event KINDS × four delivery modes —
`off` / `mine_only` / `project` / `always` — not nine modes.)*

### 6.2 The one real defect: a rejected write kept the new value — HELD, fixed

`setMode` painted the new mode before the PUT resolved (correct — a segmented
control that lags a round-trip feels broken) but **never rolled back on
failure**. The switch kept showing a value the server had never accepted, and
the only feedback was the status span inside the *quiet-hours* block, several
rows above the control that was clicked. Realistic outcome: a user believes they
turned "New tasks" off and keeps being notified. This is exactly the brief's
"a settings control that does not persist is worse than no control".

Fixed: `saved.current` now also carries the last **server-confirmed** prefs and
is updated only on a successful PUT, `save()` reports success, `setMode` reverts
on failure, and the error is stated beside the switches with `role="alert"`.
Rollback is prefs-only so a failed mode change cannot discard a half-typed
quiet-hours edit.

The quiet-hours window itself was already correct: commits on blur (not on
change, so a partially-typed `0` is never sent), `isHHMM` validated, no-op
guarded against double PUTs, with a visible `Saving… / Saved / Not saved`
status. Not mirrored into `k_prefs`, and `CustomizePanel.jsx:86-91` explains
why — a localStorage copy no sender reads would make the schedule appear set
and silence nothing. That reasoning is correct.

## 7 · Spec defects, as instructed

### 7.1 Tooltip delay: 400ms vs 300ms — the build is RIGHT, `02` and `16` are wrong

The conflict is worse than two-way:

- `02-common-components.md:198` and `:259` — **400ms**
- `16-animations.md:129` — **400ms**
- `26-component-inventory.md:259` — **300ms**
- **`design-reference/Kartavaya Redesign/MOTION-SPEC.md:53` — "fade + `scale(.94)`
  · `--dur-instant`, after a `300ms` dwell"**

I initially concluded 400 on a 2-to-1 majority. That was wrong, and the
`_SOURCE-MAP.md` the coordinator pushed is what corrected it: the reference
implementation beats the prose. `MOTION-SPEC.md` is the designer's own motion
source and says **300ms**, and `MOTION-SPEC.md:147` names the component
directly — "`Tooltip.jsx` has the 300ms delay but no edge auto-flip". The spec
author was describing the 300ms build as correct.

**Followed: 300ms. Left `ui/Tooltip.jsx` unchanged.** The 400ms in `02` and `16`
is the defect. Worth noting it would have been a silent, unfalsifiable change —
`Tooltip` currently has **zero call sites** outside the `ui/index.js` barrel.

### 7.2 Segmented control `aria-selected` on `role="radio"` — spec is invalid, standard followed

`26-component-inventory.md` §5 puts `aria-selected` on the segmented group.
`aria-selected` is only valid on `option`, `tab`, `row`, `gridcell` and
`treeitem`; on `role="radio"` it is not a supported attribute and is ignored.
A segmented control that sets a value **is** a radio group.

`components/customize/Seg.jsx:43-52` already deviates deliberately —
`role="radiogroup"` + `role="radio"` + `aria-checked` — and documents it. That
is the pairing that actually announces "2 of 3, selected". **The standard wins;
the build is already correct.** No change.

The same file was right to add roving tabindex: one tab stop per group, arrows
within. Also correct, and `focused` falls back to `options[0]` so a stored value
matching no option cannot leave the group keyboard-unreachable.

### 7.3 Two more, recorded not acted on

- **`26` §5 says "aria-pressed on the switch"** — same class of error.
  `ui/Toggle.jsx` correctly uses `role="switch"` + `aria-checked`. But
  `components.css:709-712` still carries the comment *"aria-pressed on the
  switch"* describing markup that no longer exists. Comment-only; left alone to
  avoid colliding with the dark-tokens agent in that file.
- **Popover exit: `MOTION-SPEC.md:47` says `119ms`**, while the motion layer's
  own mapping (`animations.css:41`) uses `--dur-fast` (140ms). I did **not**
  reconcile this — durations are the motion agent's, and the coordinator said
  not to fight them. My change makes the JS follow the CSS whatever it says, so
  it is correct either way.

## 8 · Every call site verified

Primitives I changed, and where they are consumed:

| Primitive | Call sites checked |
|---|---|
| `ui/Popover.jsx` | `components/drawer/DrawerAttachments.jsx:69`, `components/views/TableView.jsx:231`. No prop changed — the fix is internal. |
| `ui/Picker.jsx` | Both `usePicker` consumers are **inside** `Picker.jsx` (`:145` Picker, `:264` PickerDate) and both updated. External importers all take the `Picker` / `PickerDate` default: `drawer/DrawerMeta.jsx`, `drawer/DrawerSubtasks.jsx`, `fields/DateField.jsx`, `fields/DropdownField.jsx`, `fields/PersonField.jsx`, `fields/StatusField.jsx`. The hook change is additive (one extra returned key). |
| `ui/Sheet.jsx` | `pages/org/TabMembers.jsx:359` — the only one. Props `open`/`onClose`/`title` unchanged. |
| `module/Note.jsx` | `pages/esign/DetailTab.jsx:9`, `pages/EsignPage.jsx:30`, `pages/pahchan/EnrollQueue.jsx:8`, `pages/pahchan/PahchanPolicy.jsx:5` — all four take the default export; the removed one had none. |
| `.k-btn` (CSS) | 454 occurrences across the tree — `k-btn` 454, `--ghost` 230, `--primary` 214, `--sm` 49, `--reject` 1. Merged block reproduces the interleaved cascade property by property; the only intended change is the radius token. |
| `ui/EmptyState.jsx` | Unchanged. Consumers confirmed present: `editorial/ModuleUI.jsx` (pass-through), `pages/today/TaskListCard.jsx`, `pages/pahchan/EnrollQueue.jsx`, `components/views/TableView.jsx` + ~25 more. |
| `ui/StatTile.jsx` | Unchanged. `pages/today/StatRow.jsx` renders all four tones through it (`neutral` / `info` / `danger` / `ok`) — `info` proves the alias gap is closed. |
| `ui/Tooltip.jsx` | **Zero call sites** outside the barrel. |
| `customize/Seg.jsx` | `pages/customize/TabAppearance.jsx`, `TabLayout.jsx`, `TabNotifications.jsx`, `pages/pahchan/Register.jsx`, `customize/NotifyPrefs.jsx`. Unchanged. |

## 9 · Gates

Run from `frontend/` after every change. Final state:

```
check-tokens:  279 declared, 229 referenced, 0 missing        PASS
check-classes: 2090 selectors defined, 1413 used, 0 missing   PASS
```

Dead-selector count fell 613 → 610 (brand.css buttons) → and the three
`.mempty` rules left with their component; `defined` fell 2096 → 2090.

Changed JSX parsed with esbuild (JSX loader): `DashboardPage`, `NotifyPrefs`,
`Note`, `EmptyState`, `Popover`, `Picker`, `Sheet` — all clean.

## 10 · What I could not finish

- **`.btn` / `.k-btn` are still two vocabularies.** §3.3 — needs a 454-site
  sweep, not a stylesheet edit. The two buttons genuinely differ, so it cannot
  be done pixel-neutrally and should be an explicit design decision.
- **`TaskDrawer.jsx:45`** has the same hardcoded `EXIT_MS = 220` fixed in the
  three overlay primitives. Outside my surface.
- **`Tooltip` has no edge auto-flip** — named as a live defect in
  `MOTION-SPEC.md:147` ("tooltips on the rightmost toolbar buttons render
  off-screen"). Not built: the component has zero call sites, so it cannot
  manifest today, and adding untested positioning logic to an unused primitive
  is speculative. Flagged rather than guessed at.
- **No browser render.** `frontend/node_modules` is not installed in this
  worktree and installing it would rewrite `yarn.lock`, which is forbidden.
  Verification is: both gates, esbuild parse of every changed file, and reading
  each call site. The CSS merge is argued property-by-property from the cascade
  rather than observed.
- **`styles/README.md` is stale** — it says `lib/brand.js` imports `brand.css`
  and `lib/brand.js` does not exist. Not corrected here; `brand.css`'s wordmark
  half is outside my surface and the file appears to be dead in its entirety,
  which is a bigger call than a button cleanup.

