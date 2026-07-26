# Agent report — module pages (Reports, TimeReport, Automations, Templates, ganit, vikray, prachar, dristi)

Branch: `worktree-agent-a422b6e2513904575`
Base: `origin/staging` @ `2a2a27b`

**Written incrementally.** Each finding is appended the moment it is confirmed by opening the
file, never from a second-hand claim.

---

## 0 · Worktree was created off the wrong base — fixed before any work

The worktree branch was cut from **`main` (production)**, not `staging`. It sat **271 commits
behind `origin/staging`** and carried 13 commits that exist only on `main`:

```
1aa4985 feat: add admin endpoint to recover corrupted R2 attachments
e541cdf fix: remove broken PUB_URL from upload — always use signed URLs
… 11 more, all reachable from origin/main
```

A `git rebase origin/staging` conflicted immediately in `frontend/src/components/drawer/DrawerAttachments.jsx`
— a file outside my scope. Since I had produced no work yet and every one of those 13 commits is
reachable from `main`, I aborted the rebase and `git reset --hard origin/staging`. **Nothing was
lost; `main` is untouched.**

> **Flag for the coordinator:** if other agents' worktrees were cut the same way, they are also
> based on production and 271 commits stale. Worth checking before their merges land.

Both gates were green on that baseline before I changed anything:

```
check-tokens:  279 declared, 229 referenced, 0 missing
check-classes: 2096 selectors defined, 1416 classes used, 0 missing a rule
```

Note both gate scripts must be run **from `frontend/`** — from the repo root they print
`src/styles not found` and **exit 0 anyway**, so a root-level invocation is a false pass.

---

## 1 · Governing handover files

Identified by reading `design-handover/` directly rather than trusting a mapping:

| File | Why it governs my pages |
|---|---|
| `13-module-pages.md` | The module-page file. Shared chrome, the fifteen modules, per-file change table listing `ReportsPage`, `DristiPage`, `AutomationsPage`, `PracharPage` by name |
| `24-bilingual-devanagari.md` | The Yes/No list for Devanagari; the uppercase + tracking prohibition |
| `04-boards-table-views.md` | `.tb` table spec that module tables reuse |
| `02-common-components.md` | The shared primitive set (`ui/Table`, `EmptyState`, `ErrorState`, `Skeleton`) |
| `27-vikray.md` | Vikray specifically |
| `design-reference/Kartavaya Redesign/docs/` | Print/export specification (`Project Report.html` is mine) |

---

## 2 · Claim verification

### CLAIM 1 — Devanagari in table column headers — **HELD** (line numbers exact, not ~34 low)

- `frontend/src/pages/ReportsPage.jsx:271` — header row built from
  `[['FREQUENCY','आवृत्ति'],['FORMAT','प्रारूप'],['RECIPIENTS','प्राप्तकर्ता'],['NEXT RUN','अगला'],['LAST SENT','अंतिम'],['','']]`
- `frontend/src/pages/TimeReportPage.jsx:273` — header row built from
  `[['DATE','तारीख'], ['MEMBER','सदस्य'], ['TASK','कार्य'], ['NOTE','टिप्पणी'], ['HOURS','घंटे']]`

`24-bilingual-devanagari.md` "Where Devanagari appears — and where it must not" lists
**table column headers** under **No**, alongside form field labels and anything inside a data cell.

### CLAIM 2 — `ErrorBoundary.jsx` renders Devanagari error text — **HELD**

`frontend/src/components/ErrorBoundary.jsx:18-20` rendered
`कुछ गलत हो गया — कृपया पुनः प्रयास करें`. **Error text** is on the same No list.

### CLAIM 3 — Devanagari inside 700/800 tracked-uppercase labels — **HELD, with CSS proof**

The claim is not merely that Tiro is single-weight; the *containing classes* are the problem.
Opened `frontend/src/styles/`:

| Class | File:line | Declaration |
|---|---|---|
| `.k-fld-label` | `editorial.css:3061` | `font-weight:700; letter-spacing:0.14em; text-transform:uppercase; font-family:var(--font-ui), var(--font-hindi)` |
| `.k-time-total__lbl` | `editorial.css:3051` | `font-weight:700; letter-spacing:0.18em; text-transform:uppercase` |
| `.k-rule__step-lbl` | `editorial.css:1951` | `font-weight:700; letter-spacing:0.16em; text-transform:uppercase` |
| `.k-label` | `editorial.css:2857` | `font-weight:700; letter-spacing:0.1em; text-transform:uppercase` |

Each has `var(--font-hindi)` in its own font stack, so Devanagari written directly inside one
inherits **weight 700** (Tiro Devanagari Hindi ships 400 only → synthesised faux-bold),
**letter-spacing** (breaks क्ष / ज्ञ conjunct ligatures), and **uppercase** (a no-op on unicase
Devanagari while the Latin beside it changes — breaking the pair). All three are forbidden by
`24-bilingual-devanagari.md`.

Partial mitigation already in the stylesheet: `editorial.css:2456`
`[lang="hi"],[lang="sa"],[lang="gu"]{letter-spacing:0 !important}` — so an element carrying
`lang` already escapes the tracking. It does **not** reset `font-weight` or `text-transform`,
which is why a `lang` attribute alone is not the fix.

### CLAIM 5 — `.k-segctrl` hand-rolled at ~6 call sites — **HELD but NOT IN MY FILES**

Call sites: `components/views/ViewToolbar.jsx:43`, `pages/ActivityFeedPage.jsx:99`,
`pages/ApprovalsPage.jsx:182`, `pages/TasksListPage.jsx:216`. **Zero** in any of my eight
assigned surfaces. Also partly stale as stated: `ViewToolbar.jsx` *is* a component wrapping it.
Left alone — it belongs to whoever owns those four pages.
