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

*(remainder appended as work proceeds)*
