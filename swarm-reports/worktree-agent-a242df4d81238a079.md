# Dashboard + Tasks — STRUCTURE lens

Branch `worktree-agent-a242df4d81238a079`. Surface: `frontend/src/pages/DashboardPage.jsx`
(Today), `frontend/src/pages/TasksListPage.jsx` and `frontend/src/pages/today/*`.
Reference: `ScreensCore.jsx::ScreenDash` and `ScreensWork.jsx::ScreenTasks`, **as
rendered**, not as read.

---

## 0. Before anything else — staging did not compile

`frontend/src/pages/DristiPage.jsx:581` had a JSX comment in expression position:

```jsx
{Array.isArray(result.data) ? (
  {/* ... */}                       // ← empty object literal, then an element,
  <DataTable columns={…}>           //   with no operator between them
```

esbuild stopped with `Expected ")" but found "columns"`. That is not a Dristi bug —
it takes the whole dev server and the production build down, so **no agent in this
run could render the build at all.** Fixed in `8ad2890`, pushed straight to
`staging` ahead of any design work. Vite starts clean now.

---

## 1. How this was rendered

Two servers, and neither touches the shared database.

* Reference — `frontend/public/__ref/` (gitignored copy of
  `design-reference/Kartavaya Redesign/`), served by a Vite on `:5174` from this
  worktree.
* Build — the same Vite, with `VITE_BACKEND_URL` pointed at a **throwaway mock of
  the backend** on `:8099` (lives in the scratchpad, never committed). This matters:
  `TasksListPage` fires `POST /tasks/auto-archive` on mount, and staging and
  production share one Supabase project, so pointing the build at the real API to
  take a screenshot would have archived real tasks. It never ran against the real
  API.

Screenshots were taken through headless Chrome over CDP rather than the shared MCP
browser — that browser is driven by ~20 agents at once and its "current tab" moved
under me three times, twice producing a screenshot of a sibling's page. Anyone
comparing renders should assume the same and verify the URL inside the page before
trusting a capture.

| | Reference | Build |
|---|---|---|
| Dashboard | `img/a242-ref-dashboard.png` | `img/a242-build-today.png` |
| Tasks | `img/a242-ref-tasks.png` | `img/a242-build-tasks.png` |

---

## 2. Dashboard — block by block

Reference order, top to bottom. "Position" is against the reference's own order.

| # | Reference block | In build? | Position | Contents |
|---|---|---|---|---|
| 1 | Page header — kicker, `नमस्ते, केवल` + `DASHBOARD`, lede | yes (`Hero`) | same | different shape: `Hero` not `PH`, watermark, no kicker/title/lede triad |
| 1a | header actions **This week** + **New task** | **NO** | — | build's hero has no action slot at all |
| 2 | `div.stats` — **five** tiles: Pipeline · Receivables · Collected MTD · GST due · Team in today | partial | same | build has **four**, and they are different quantities: Open tasks · Due today · Overdue · Done this week |
| — | — | build-only: `k-hero-kpi` Receivables band | between hero and stats | reference carries receivables as one of the five tiles, not a band |
| 3 | week strip — 7 day chips with load dots | yes | **moved** — reference puts it *below* the stats as its own row; build puts it *inside* the hero, above everything | same content |
| — | — | build-only: `k-quickacts` (4 shortcut buttons) | after stats | not in the reference |
| 4 | left col ① **Needs you today** / आज के कार्य — 4-column table `Task · Project · Owner · Due`, "View all" | yes as **On your plate** / आपके हाथ में | same | list, not a table: no column header row, no Project column heading |
| 5 | left col ② **Cash position** / नकदी — 12-bucket inflow/outflow bars, `30d`/`Quarter` toggle, Inflow/Outflow/Net legend | **NO** | — | nothing equivalent anywhere in the build |
| — | — | build-only: **Waiting on others** | left col | |
| — | — | build-only: **Project status** (stack bar + legend + % meter) | left col | |
| 6 | right col ① **Approvals** / सम्मति — `N waiting` tag, rows of avatar + title + who·meta + inline ✓/✗ | **NO** | — | build's right column starts with something else |
| — | — | build-only: **Upcoming this week** | right col, first | |
| 7 | right col ② **Activity** / गतिविधि | yes as **Team pulse** / दल की गतिविधि | same slot | |
| 8 | right col ③ tonal Gītā card | yes (`Citation`) | same | |

**The two blocks the build never built are Cash position and Approvals.** Both are
addressed below. The stat-tile divergence is a product decision, not an oversight —
`DashboardPage.jsx:28-33` records it deliberately — so it is raised here, not
silently changed.

## 3. Tasks — block by block

| # | Reference block | In build? | Notes |
|---|---|---|---|
| 1 | `PH` — kicker `Workspace · कार्यक्षेत्र`, `कर्तव्य` + `TASKS`, lede | yes | see §4: the two words are in the opposite order |
| 1a | right action: one filled `Task` button carrying a `N` keyboard hint | partial | build has the button, **no `N` hint**, and the global `n` shortcut it advertises does not exist in the build |
| 2 | `Seg` — Mine / All open / Overdue / Done, each with a count | yes | build adds an **Archived** toggle in the same control |
| — | — | build-only: Columns popover, Group-by select, Search field | more capable than the reference; not a gap |
| 3 | table head `Task · Project · Assignees · Due · Status` | yes | identical five, same order |
| 4 | priority group rows — dot + name + count | yes | build also groups by project and status |
| 5 | rows: **stable id** + title, project, avatars, due tag, status tag | **defective** | see §5 |

Structurally Tasks is the closer of the two screens. Its one real problem is the
row identifier.

---

## 4. Found by rendering, NOT changed — the bilingual header is inverted

The reference `PH` (`Data.jsx:27`) renders Devanagari **first**, Latin second:

```jsx
<h1 className="ph__h1"><span className="ph__hi">{hi}</span><span className="ph__en">{en}</span></h1>
```

and styles the Devanagari as the display word — the rendered Tasks header reads
`कर्तव्य TASKS`, with `कर्तव्य` large in the serif and `TASKS` small and uppercase.

The build's `PageHeader` (`components/editorial/PageHeader.jsx`) renders
`{title}` then `{sanskrit}` and gives the display treatment to the Latin word —
`Tasks कर्तव्य`. Same on every one of its 38 call sites.

**Deliberately not changed.** Swapping the DOM order alone makes it worse — you get
a small `कर्तव्य` followed by a large `Tasks`. It needs the `.k-pageh__h1` type
scale swapped with it, and two siblings own pixels and type on this exact surface
right now; a CSS change to the shared page header from the structure agent would
collide with both. Flagging it is the correct move, and reading the prose could
never have found it.

---

## 5. Live defect — the task reference number on Tasks is fabricated

`TasksListPage.jsx:360`:

```jsx
<span className="k-trow__id">KAR-{String(idx + 100)}</span>
```

`idx` is the row's index **within its priority group**, so every group restarts at
100. In `img/a242-build-tasks.png` you can read `KAR-100` three times on one
screen — once under Urgent, once under High, once under Medium — and the same task
gets a different number the moment you switch Group by, filter, or search.

This is worse than having no identifier: it looks exactly like a real ticket
reference, so it is the thing a user would quote in an email. The reference screen
carries genuinely distinct ids (`KAR-582`, `KAR-184`, `KAR-090`).

There is no human-readable key on the `tasks` table — no `task_number`,
`task_key` or sequence column anywhere in `backend/migrations/`. Fixed by deriving
the code from the task's own UUID, which is at least stable and unique per task
(see §6.3), and a real per-org sequence is filed as the proper fix.

---

## 6. What was built

### 6.1 Approvals card on Today

_(filled in as it lands)_

### 6.2 Cash position card on Today

_(filled in as it lands)_

### 6.3 Stable task reference

_(filled in as it lands)_

---

## 7. For whoever picks this up

* `frontend/public/__ref/` is gitignored. Recreate with the copy in
  `swarm-reports/_DESIGN-GAP.md` §"How to render the reference".
* Rendering the *build* needs `VITE_BACKEND_URL` set — there is no `.env` in
  `frontend/`, only `.env.production`, so a bare `npm start` shows the
  "Configuration Error" panel from `lib/api.js:7` and nothing else. That alone may
  explain why several agents concluded the build could not be rendered.
* **Do not point a local build at the real API to look at Tasks.** `TasksListPage`
  POSTs `/tasks/auto-archive` on mount.
