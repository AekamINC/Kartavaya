# design/boards-structure — Boards, views and the task drawer · STRUCTURE lens

Branch `design/boards-structure`, cut fresh from `staging` (`e9134b2`). The worktree
arrived on a stale branch — 13 commits on a base predating `staging`, all of them
already in `staging` under different hashes (`caba74f`, `42fd6f0`, `52c9c32` …).
Nothing was reset or discarded; a new branch was created beside it.

Reference **rendered**, not read: `frontend/public/__ref/` (gitignored), Vite on
5173, `Kartavaya Redesign.html` → Boards, and `Interaction Catalogue.html` for
`IxViews` / `IxWork` / `IxDrawer` / `IxFiles`. The Boards screen only appears if
`localStorage.kv_view` is set — `App.jsx:4` seeds `view` from it and the sidebar's
click handler does not fire through CDP-synthesised events in a background tab.
`localStorage.setItem('kv_view','boards'); location.reload()` is the way in.

---

## A · Enumeration, before any change

### A1 · Views

`MODULE_TABS.boards` (`Data.jsx:132`) is the reference's list. `viewDefs.jsx:25`
is the build's. Same seven, same order.

| # | Reference id | Reference label | Build id | Build label | Verdict |
|---|---|---|---|---|---|
| 1 | `kanban` | Kanban · फलक | `kanban` | Board | label differs, no Devanagari |
| 2 | `table` | Table · सूची | `table` | List | label differs, no Devanagari |
| 3 | `calendar` | Calendar · पंचांग | `calendar` | Calendar | no Devanagari |
| 4 | `timeline` | Timeline · कालरेखा | `timeline` | Timeline | no Devanagari |
| 5 | `workload` | Workload · भार | `workload` | Workload | no Devanagari |
| 6 | `priority` | Priority · प्राथमिकता | `priority` | Priority | no Devanagari |
| 7 | `mytasks` | Mytasks · मेरे कार्य | `mytasks` | My Tasks | no Devanagari |

Nothing is missing and nothing is extra. The reference's `TabBar` renders a Latin
line and a Devanagari line per tab; the build's `ViewToolbar` renders one line.
That is a missing element per tab, seven times — reported, not silently changed,
because `Board`/`List` may be a deliberate product choice (same class of decision
as Finance-vs-Invoicing in `_DESIGN-GAP.md` §2).

### A2 · Toolbar

`04 §2` component tree: `BoardToolbar — view switch · filter · group · fields`,
and directly under it *"Board, Table, Calendar, Timeline, Workload and Priority
all need view-switch, filter and group"*.

| Control | Reference | `/boards` | `/projects/:id` | In which view |
|---|---|---|---|---|
| View switch | ✓ | ✓ | ✓ | all |
| Search | ✓ | **absent** | **absent** | table only, via TableView's own toolbar |
| Group by | ✓ | **absent** | **absent** | table only |
| Filter (builder) | ✓ 10.4 | **absent** | **absent** | table only |
| Fields (column visibility) | ✓ | **absent** | **absent** | table only |
| Count | — | absent | absent | table only |
| Archived toggle | — | **absent** | ✓ | all |
| Save view | — | **absent** | ✓ | all |
| New task | ✓ (`+ Task`) | ✓ | ✓ | non-kanban |

Two findings here.

1. **`TableView` renders a second `ViewToolbar` inside a page that already
   rendered one** (`TableView.jsx:222`, under `BoardsPage.jsx:213` /
   `ProjectBoardPage.jsx:187`). In Table view the page shows two stacked `.vtb`
   bars. The seg control is only in the outer one and search/group/filter/fields
   only in the inner one, so the row a control lives in changes when you switch
   view — which is the exact drift `ViewToolbar` was created to end.
2. **Five of the seven views have no search, no filter and no grouping at all.**
   Kanban included, which is the default view and the one `04 §2` names first.

### A3 · Column header

`04 §2`: `ColumnHeader — dot · name · count · ⋯`. `IxViews 9.3`: *"Header menu is
the shared ⋯ primitive from 5.1."*

| Element | Reference | Build (`KanbanView.jsx:378`) |
|---|---|---|
| colour dot | ✓ | ✓ `.bd__cdot` |
| name | ✓ | ✓ `.bd__cn` |
| Devanagari name | ✓ (`STATUS[k][1]`, every column) | synthetic columns only |
| count | ✓ | ✓ `.bd__cc`, with the 9.1 drag preview |
| **⋯ menu** | ✓ | **absent** — a bare ✕ delete, plus rename on **double-click only** |

Rename has no affordance at all: it is a `title` attribute on a span. A keyboard
user cannot reach it.

### A4 · Drawer sections

Reference `DTABS` (`IxDrawer.jsx:346`) against `DrawerTabs.jsx:30`.

| # | Reference | Build | Verdict |
|---|---|---|---|
| 1 | Details | Details | ✓ same position |
| 2 | Comments (4) | Comments (count) | ✓ |
| 3 | Files (2) | Files (count) | ✓ |
| 4 | Time | Time (count, hidden for clients) | ✓ |
| 5 | Activity (9) | Activity (count) | ✓ |

Order and counts match. Above the tabs, in order: `DrawerHeader` → `DrawerTitle`
→ `StatusPipeline` → `DrawerMeta` → body. Inside Details: Description →
Subtasks → Custom fields → Approval. Every catalogue section 01–03 and 06–08 has
a build component:

| Catalogue | Cards | Build file | Present |
|---|---|---|---|
| 01 Drawer & fields | 9 | `TaskDrawer.jsx` + `drawer/*` | ✓ |
| 02 Subtasks | 5 | `drawer/DrawerSubtasks.jsx` | ✓ |
| 03 Comments | 5 | `drawer/DrawerComments.jsx` | ✓ |
| 06 Files | 5 | `drawer/DrawerAttachments.jsx` | ✓ |
| 07 Time tracking | 3 | `drawer/DrawerTimeEntries.jsx` | ✓ |
| 08 Approvals | 4 | `drawer/DrawerApproval.jsx` | ✓ |

**The drawer is structurally complete.** No section is missing and none is out of
order. Everything left in the drawer is pixels and motion, which two siblings own.

### A5 · Prior agent's claims, re-verified against the rendered reference

| Claim | Verdict |
|---|---|
| `components/TaskEditor.jsx` deleted, zero importers | HELD — no file, `grep -rn TaskEditor frontend/src` returns only the three prose comments that say it is gone |
| `fieldValueMap` never passed to `TableView` on `/boards`, now via `GET /api/fields/team/{id}/values` | HELD — `BoardsPage.jsx:56` + `:347` |
| `BoardsPage` swallowed both load errors | HELD — `ErrorState` on both paths now |
| BulkBar on `PATCH`/`DELETE /v1/tasks/bulk` | HELD |
| Inline add composer (9.3) | HELD and matches the rendered card: ⏎ creates and clears without closing, ⇧⏎ newlines, Esc/Done closes, blur closes only while empty |
| Quick-complete tick (9.4) | HELD, `stopPropagation` in `TaskCard` |
| Optimistic `opacity .6` (MOTION §7.1) | HELD on both move and tick |

---

## B · What was changed

### B0 · A build break that predates this branch — `594eb06`

`npm run build` failed for the **whole app** on `staging`. `DristiPage.jsx:577`
had a `{/* … */}` sitting directly inside a ternary's expression branch, which
is an object literal, not a comment, so esbuild read the next line's
`<DataTable columns` as a syntax error. Not this surface; landed in its own
commit so it can be dropped if the file's owner fixes it too. Worth noting that
**`npm run check` passes on this file** — neither gate parses JSX, so a syntax
error reaches `staging` with all gates green. Flagged as a follow-up task.

### B1 · Archived on `/boards`, and the column-header ⋯ — `334ab2c`

`/boards` now carries the Archived toggle `/projects/:id` already had, in the
same trailing slot, and `loadBoard` sends `archived=true` (`GET /tasks` takes
it — `server.py:2185`).

The column header's bare ✕ became a `Menu`: Rename, Add task, ─, Delete. Rename
was previously reachable **only** by double-clicking the name, an affordance
documented in a `title` attribute, so no keyboard or touch user could reach it
at all. Double-click still works; it is a shortcut now rather than the route.

### B2 · One toolbar for all seven views — `ae208be`

`useBoardView` (new) owns `q` / `filter` / `group` / `sort` in the **URL** and
field visibility + column widths in `localStorage`. `BoardToolbar` (new) is the
one bar both routes render. `TableView` lost its second `ViewToolbar`, its
search, its clauses and its field-visibility state, and renders a table.

Consequences worth stating plainly:

- Kanban, Calendar, Timeline, Workload, Priority and My Tasks can be searched
  and filtered. None of them could be before.
- Table view no longer stacks two `.vtb` bars.
- A filtered board is a link.
- **Drag had to follow.** `destination.index` is an index into what is
  *visible*. Once a column can show 3 of 11 cards that is not the server's
  index — dropping a card second would file it second among all eleven, and it
  would move once the filter cleared. The index now resolves through the card
  it lands above, in both lists taken without the dragged one, which returns
  `destination.index` exactly when nothing is filtered. `KanbanView` takes
  `allTasks` for this and falls back to `tasks`, so the one call site that does
  not pass it (`task-flow.test.jsx`) is unaffected.

`ProjectBoardPage` also gained the `ErrorState` and the shaped skeleton
`BoardsPage` already had. Its load was `catch { logger.error }` — a failed
board looked like an empty project — and its loading state replaced the entire
page, header and toolbar included, with one italic line.

### B3 · Thirteen tests, and the tilde they caught — `820f4fc`, `7dc6c9e`

`__tests__/e2e/board-toolbar.test.jsx` asserts the structural claims rather
than describing them: one `.vtb` in each of the seven views, search and the
filter builder present in all of them, group-by and Fields only where they can
act, and the URL contract from `IxViews` 10.1/10.4.

Two real bugs came out of writing them:

1. **`~` is not escaped by `encodeURIComponent`.** It is an unreserved mark,
   alongside `- _ . ! * ' ( )`. `~` is also the clause separator, so a title
   filter typed as `a~b` came back out of the URL as two half-clauses and the
   second was dropped silently. Escaped to `%7E` by hand.
2. **A `column_id` clause survived a project switch.** `/boards` changes board
   without leaving the route, so a filter naming a column of the previous
   project emptied the next one and showed a chip for a column it does not
   have. Clauses whose column is unknown are dropped from what the UI reads,
   guarded on the column list having loaded. The URL is left intact.

### Gates, and what was NOT verified

`check-tokens: 0 missing` · `check-classes: 0 missing a rule` · `vite build`
green · **448 of 449 tests pass**, my 13 among them. Merged to `staging` as a
fast-forward after three rounds of merging `staging` back in.

Two failures in the suite are **not this branch's**, and both are stated here
rather than buried:

- `visual-regression.test.jsx > semantic-palette` fails on a stale baseline.
  `c41128a` ("--outline failed 1.4.11 on eleven of twelve surfaces") changed
  `--outline` deliberately — light `#ADA692`→`#78725F`, dark `#5B626C`→`#7E8590`
  — and did not update the snapshot. `git diff staging` over
  `__snapshots__/` is empty for this branch. Not updated here: a visual
  baseline is that agent's instrument, and refreshing someone else's on a
  reading of their commit message is how a real regression gets cemented.
  Flagged as a follow-up.
- Two unhandled rejections in `task-flow.test.jsx` from an unstubbed
  `/fields/task/:id/values`. `git diff staging` over that file and
  `TaskDrawer.jsx` is likewise empty.

**Not verified in a browser.** The reference harnesses were rendered and read
directly. The build's own `/boards` was not: it needs an authenticated session
against a backend, and this agent will not enter credentials. So the build side
of the comparison is source, `vite build`, and the thirteen structural tests —
which is why those tests exist and assert the DOM rather than describing it. A
human with a session should still put the two on screen side by side before
this is called done; the open items in §C are the list to check while doing it.

---

## C · Still open, by how structural it is

Items 1–6 of the original list are closed by §B. What is left is either
somebody else's surface or a decision that is not mine to take alone.

1. **Devanagari second line on the view tabs.** The reference's `TabBar` draws
   a Latin line and a Devanagari line per tab — Kanban फलक, Table सूची,
   Calendar पंचांग, Timeline कालरेखा, Workload भार, Priority प्राथमिकता,
   Mytasks मेरे कार्य. `ViewToolbar` draws one line. This is a missing element
   seven times, but it is also a type-and-layout change inside `.k-segctrl`,
   which the pixels sibling owns. **Not changed. Needs a call on `Board`
   vs `Kanban` and `List` vs `Table` at the same time** — those are the
   designer's words against somebody's paraphrase, the same class of decision
   as Finance-vs-Invoicing in `_DESIGN-GAP.md` §2.

2. **Column headers have no Devanagari.** They cannot: real column names come
   from `projects/:id/columns` and carry no second field. Only the two
   synthetic columns have one, hard-coded. Giving real columns a Devanagari
   name is a schema change, not a UI one.

3. **The page header is inverted against the reference.** The reference titles
   the page with the MODULE (`फलक` / `Boards`), puts the project in the lede
   (`Quarterly GST filing — Aekam Inc.`), and gives the project chips **their
   own full-width row** below the header (`.chips`). The build titles the page
   with the project name and nests the chips inside the header's right rail
   (`.k-projectpicker`, right-aligned, capped at 560px and wrapping). With six
   projects that rail wraps into the avatars. Placement is the pixels sibling's
   file (`editorial.css`) — reported, not moved.

4. **Kicker text and spelling.** Reference `Workspace · कार्यक्षेत्र`; build
   `AEKAM INC · फ़लक`. Note `फ़लक` (with nukta) against the reference's `फलक`.
   `24-bilingual-devanagari.md` should settle it; both spellings are currently
   in the tree.

5. **Kanban has no filtered-empty state.** Filtering to nothing now leaves N
   empty columns rather than the "no tasks match" state the table gets. The
   count and the filter chips are both visible in the toolbar above, so it is
   discoverable, but `02 §Two empty states` wants the sentence.

6. **WIP limits.** `IxViews 9.3` — *"WIP limit warns rather than blocks"*.
   Nothing in `columns` stores one; a backend field first.

7. **Fractional move ordering.** `IxViews 9.1` asks for *"a fractional position
   so one row is written"*. The server takes an integer index and re-sequences
   the whole column under an advisory lock (`server.py:395`). Works, and is
   safe; it is more writes than the reference wants. Backend surface.
