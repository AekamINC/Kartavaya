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

### CLAIM 4 — "the same table implemented 9 separate times" — **HELD, and understated**

Counted across `frontend/src`, there are not two table systems but three:

| System | Where | Call sites |
|---|---|---|
| `components/ui/Table.jsx` (`.tbl`, three-state sort, `aria-sort`) | admin / org surfaces | `TableView`, `AdminBillingPage`, `AdminCostDashboardPage`, `AdminPage`, `admin/OrgTable`, `org/TabBilling` |
| `components/editorial/ModuleUI.jsx` → `DataTable`/`Td` (`.k-modtable`) | module surfaces | 27 call sites across Dristi, Prachar, Vikray, Vetana, Pahchan, and now Reports + TimeReport |
| Raw `<table>` with inline styles | everywhere else | **~29 files** — `ganit/*` (5), `graha/*` (6), `manav/*` (6), `org/*` (2), Hub, Billing, Scrapers, OrgSrijan … |

So the real number is closer to **29 than 9**.

**What I did:** converged my files onto **`DataTable`/`Td` from `components/editorial`**. It
already *was* the module-surface table — Vikray, Prachar and Dristi (three of my eight
surfaces) plus Vetana and Pahchan use it — so this was adoption, not invention. No new
component was created.

`ReportsPage` (schedules) and `TimeReportPage` (entries) each hand-rolled their own
`<table style={{…}}>` with per-cell inline styles. Both now use `DataTable`. They gain the
sticky header, the `--ix`-scaled row hover (so the motion-reduction multiplier applies), and
`data-align="right"` + mono/tabular numerics that the inline copies never had.

> **For other agents:** for a **module page**, use `DataTable`/`Td` from
> `components/editorial` — it is the de-facto standard at 27 call sites and needs no new
> code. `ui/Table` is the richer one (three-state sort, `aria-sort`, `BulkBar`) and is the
> right target for any table that needs sorting or selection. The ~29 raw `<table>` sites are
> the remaining debt; I only converted the ones in my own scope.

---

## 3 · Every span split I made

The rule I applied, from `24-bilingual-devanagari.md`:

- surface named on the **"No"** list → **remove** the Devanagari
- surface legitimately bilingual but sitting in a **tracked / uppercase / bold** context →
  **span split** with `.k-lbl__in` + `lang="hi"`

### Removed — 16 sites, all explicitly on the "No" list

| File | Sites | Surface |
|---|---|---|
| `components/ErrorBoundary.jsx` | 1 | error text |
| `pages/ReportsPage.jsx` | 5 header cells + 7 `.k-fld-label` | table column headers, form field labels |
| `pages/TimeReportPage.jsx` | 5 header cells + 3 `.k-fld-label` | table column headers, form field labels |
| `pages/TemplatesPage.jsx` | 3 `.k-label` | form field labels |

The `TemplatesPage` three were also internally inconsistent: **9 of the 12** `.k-label` sites in
that same form were already English-only.

### Span-split — 5 sites

Line numbers below are **post-change**, re-read after the edits landed.

| File:line | Was | Now | Context that made it faux-bold |
|---|---|---|---|
| `AutomationsPage.jsx:343` | `WHEN · प्रसंग` | `WHEN <span class="k-lbl__in" lang="hi">प्रसंग</span>` | `.k-rule__step-lbl` 700 / .16em / uppercase |
| `AutomationsPage.jsx:351` | `IF · यदि` | same pattern | as above |
| `AutomationsPage.jsx:358` | `THEN · क्रिया` | same pattern | as above |
| `TimeReportPage.jsx:190` | `TOTAL · कुल` | `TOTAL <span class="k-lbl__in" lang="hi">कुल</span>` | `.k-time-total__lbl` 700 / .18em / uppercase |
| `TemplatesPage.jsx:572` | `USE TEMPLATE · साँचा` | `USE TEMPLATE <span class="k-lbl__in" lang="hi">साँचा</span>` | inline **800** / .18em / uppercase — the worst instance found |

`TOTAL · कुल` is kept bilingual rather than stripped because `24` lists **stat labels** among the
surfaces that take Devanagari; `WHEN/IF/THEN` are structural step labels in the rule builder,
nearer a section header than a field label.

### The new class

`.k-lbl__in` in `editorial.css`, added directly beneath the existing `[lang]` rules:

```css
.k-lbl__in {
  font-family: var(--font-hindi);
  font-weight: 400;
  text-transform: none;
  font-size: 0.95em;
  color: var(--ink-3);
  margin-left: 5px;
}
```

The existing `[lang="hi"]{letter-spacing:0 !important}` at `editorial.css:2456` already handles
tracking, which is why a `lang` attribute alone was **not** sufficient — nothing was resetting
`font-weight` or `text-transform`.

**`--font-hindi`, not `--font-indic`** — the coordinator's flagged spec defect landing exactly
on my work. Every string this class carries (`प्रसंग`, `यदि`, `क्रिया`, `कुल`, `साँचा`) is a
Devanagari **literal hardcoded in JSX**; `24` itself records that there is no translation layer,
so none of them change with the language setting. `--font-indic` repoints to Noto Sans Gujarati
under EN+GU, which has **zero Devanagari coverage**. I initially wrote `--font-indic`, caught it
against the `_SOURCE-MAP.md` known-defects list, and corrected it before merge. The same
reasoning is already applied in-repo to `.crumb__hi` and `.k-pageh__sans`.

### Cleanups that followed

- `.k-fld-label` dropped `var(--font-hindi)` from its font stack — with the Devanagari gone
  from all ten call sites it was dead, and its comment (`"PROJECT · योजना" … both scripts in
  one node`) was describing something that no longer existed.
- Verified the **remaining 37** Devanagari occurrences in my four main pages all sit on
  weight-400, untracked, non-uppercase classes (`.k-card__sans`, `.gr__block-sans`,
  `.k-citation__sans`, `.k-pageh__sans`, `.k-tmpl-tab__sans`, `.k-rule__step-sans`) — all
  correctly on `--font-hindi`. Nothing left in a faux-bold context.

---

## 4 · Bugs found that nobody claimed

### A live crash in Dristi — `DristiPage.jsx:577` (now `:581` after the fix)

```jsx
<DataTable cols={['Label', 'Value']}>     // prop is `columns`, not `cols`
```

`DataTable` destructures `{ columns, children }` and calls `columns.map(...)` with **no guard**,
so this threw `TypeError: Cannot read properties of undefined` on **every successful grouped
pivot query**. It is the only one of **27** `DataTable` call sites using `cols`; all 26 others
pass `columns`. Fixed, and `Value` now right-aligns per `13-module-pages.md` on numeric columns.

### Every PDF font was silently falling back to DejaVu

`backend/services/report_generator.py` named `Helvetica Neue`, `Arial`, `Georgia`,
`Times New Roman`, `Courier New`. `backend/Dockerfile:17-18` installs **`fonts-dejavu-core` and
`fonts-noto` and nothing else**. Not one of those five families is present in the render image,
so every stack missed and fell through to its generic — the whole report rendered in DejaVu,
with none of the editorial character the design carries.

Stacks now name the spec faces first (`Newsreader` / `Inter` / `Tiro Devanagari Hindi` /
`JetBrains Mono`, per `docs/brand.css` and `Report PDF.html`) and degrade onto Noto, which is
actually installed. The PDF becomes pixel-correct the moment the faces are installed, with no
further code change.

**Deployment task I deliberately did NOT do:** Newsreader and Tiro are not Debian-packaged, so
installing them needs vendored TTFs `COPY`d in at build time. I did not guess an apt package
name — a wrong one fails the image build and takes production with it — and I did not add a
webfont `@import`, because `generate_pdf` runs `HTML(string=…, base_url=None)` with an explicit
"no external requests from WeasyPrint" comment, and that is the right call for a server
renderer. Needs a human to verify package availability.

### A failed fetch was rendering as an empty list — three pages

Each swallowed its rejection into an empty array:

| Page | Endpoint | What a 403/500/offline showed |
|---|---|---|
| `TimeReportPage` | `GET /time/report` | "No entries for this period" |
| `ReportsPage` | `GET /reports/schedules/{id}` | "No schedules yet" |
| `AutomationsPage` | `GET /automations/team/{id}` | "No automations yet" |

The Automations one is the most damaging: it tells someone whose rules failed to load that they
have none, and the obvious next action is to recreate a rule that is **already live and firing**.

All three now classify with `errorKind()` and render `ErrorState` — the four distinguishable
failures from `02-common-components.md`, each with one correct action — with retry wired to the
real loader. `ErrorState` and `errorKind` already existed and were simply unused here.

---

## 5 · Endpoint map — every page renders real backend data

No page in my scope renders a hardcoded array. Verified by reading each call site.

| Page | Endpoints | Loading | Empty | Error |
|---|---|---|---|---|
| `ReportsPage` | `GET /teams`, `GET /teams/{id}/members`, `GET /reports/data/{id}`, `GET /reports/download/{id}`, `GET·POST·DELETE /reports/schedules/{id}` | yes | yes | **added** |
| `TimeReportPage` | `GET /time/report`, `GET /teams/{id}` | yes | yes | **added** |
| `AutomationsPage` | `GET /teams`, `GET·POST /automations/`, `GET /automations/team/{id}`, `PUT·DELETE /automations/{id}`, `POST /automations/{id}/run` | yes | yes | **added** |
| `TemplatesPage` | `GET·POST·DELETE /templates/projects`, `POST /templates/projects/{id}/apply`, `GET·POST·PATCH·DELETE /templates/tasks`, `POST /templates/tasks/{id}/set-default`, `GET /projects/{id}/columns`, `GET /fields/team/{id}`, `POST /upload` | yes | yes | toast |
| `DristiPage` | `/v1/dristi/{overview,revenue,pipeline,hr,sales,dashboards,widget-types,scheduled-reports}`, `POST /v1/dristi/query` | yes | yes | toast |
| `VikrayPage` | `/v1/vikray/{dashboard,orders,stock,targets}`, `/v1/graha/contacts`, `/v1/ganit/products` | yes | yes | toast |
| `PracharPage` | `/v1/prachar/{dashboard,campaigns,ads/*,sequences,templates,automations,unsubscribes,events}` | yes | yes | toast |
| `ganit/*` | `/v1/ganit/*` (tabs already split out of the old 125 KB file) | yes | yes | toast |

`13-module-pages.md` §"the module pages are unmaintainable" lists `GanitPage.jsx` at 124,938
bytes needing a split. **That is now STALE** — `GanitPage.jsx` is **55 lines** and the tabs live
in `pages/ganit/`. The same is true of `graha/`, `manav/` and `pahchan/`. The split has already
been done by an earlier pass.

---

## 6 · Print / export documents

`design-reference/Kartavaya Redesign/docs/` holds eight documents. **I covered the reports
surface only:**

| Document | Owner |
|---|---|
| `Project Report.html` | **mine** — reviewed, see below |
| `Statement of Account.html` | **not done** — see §7 |
| `Tax Invoice.html`, `Quotation.html` | invoice agent |
| `Payslip.html` | payslip agent |
| `GSTR-3B Summary.html`, `TDS Challan.html`, `Service Agreement.html`, `Document Kit.html` | unclaimed as far as I can see |

**What I changed:** the font layer of the generated PDF (above) — the part of the print brand
that was provably wrong and mechanically fixable.

**What I did NOT change, and why.** `Project Report.html` specifies a *client-facing* project
report — org letterhead with GSTIN/PAN/logo, a "Prepared for" client party block, a
plan-vs-actual variance table, a numbered milestone schedule and a risk register. What
`report_generator.py` produces today is a *five-page internal team activity report* — KPI tiles,
task-status breakdown, member leaderboard, task list, daily throughput. **These are two
different documents**, not two renderings of one. Building the specced document needs milestone
and risk data models plus org-profile fields (`brand.css` itself notes the `/v1/org/profile`
schema has no colour field yet) that I could not confirm exist.

I could not render or diff a PDF here — no `node_modules` in the worktree and no WeasyPrint in
this environment — so a structural rewrite of a live export path would have been unverifiable.
I stopped at the change I could prove correct and am flagging the rest rather than half-doing it.

**Recommended follow-up:** treat "Project Report" as a *new* document generated from Ganit/Hub
project data against `docs/brand.css` and the `<doc-page>` component, and leave the existing
team report as its own artifact. They serve different readers.

---

## 7 · Not done / handed on

- **`Statement of Account.html`** — adjacent to my reports surface but is a Ganit finance
  document; left to whoever owns Ganit's exports to avoid colliding.
- **The specced `Project Report` document** — see §6.
- **Newsreader + Tiro TTFs in the backend image** — see §4.
- **`.k-segctrl`** — 4 call sites, none in my files. Left alone.
- **~29 raw `<table>` sites** outside my scope — the convergence target is documented in §2 so
  another agent can adopt it without re-deciding.
- **`GET /v1/dristi/pivot` with `excluded_count`** — `13-module-pages.md` §5 asks for a pivot
  endpoint that reports how many rows it filtered out for permissions, so the UI can say so. The
  build has `POST /v1/dristi/query`, which returns no such field. I fixed the crash in that tab
  but did **not** add the honesty field — it is a backend change with RBAC implications and
  belongs with whoever owns Dristi's API.

## 8 · Process notes

- **Shared files touched:** `components/ErrorBoundary.jsx` (removed Devanagari) and
  `styles/editorial.css` (added `.k-lbl__in`, cleaned `.k-fld-label`, added `.trp__*`). The
  `editorial.css` edits are additive at specific anchors to minimise collision. If another agent
  reports a conflict there, mine is the smaller change — take theirs and re-apply the
  `.k-lbl__in` block.
- **One force-push**, `--force-with-lease`, on my own agent branch only, required after
  rebasing onto `origin/staging`. Never on a shared branch.
- Lockfiles checked on every commit; `frontend/yarn.lock` and `package-lock.json` untouched.
