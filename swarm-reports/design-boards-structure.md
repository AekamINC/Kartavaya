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

## B · Still open, by how structural it is

1. Toolbar: filter / group / search / fields reach only Table (A2).
2. Two stacked toolbars in Table view (A2.1).
3. Column-header ⋯ menu absent; rename is double-click-only (A3).
4. `/boards` has no Archived toggle; `/projects/:id` does (A2).
5. Filter, sort and column widths are not in the URL. `IxViews 10.4`: *"Filters
   serialise into the URL so a filtered view is a shareable link"*; `10.1`:
   *"Sort and widths persist per view in the URL and per user."* Today all three
   are `useState` + `localStorage`, so a filtered board cannot be sent to anyone.
6. `ProjectBoardPage` has no error state and no skeleton — `load()` is
   `catch (e) { logger.error(e) }` and loading is a bare `<p>Loading board…</p>`.
   Both are the defects a sibling fixed on `BoardsPage` and left here.
7. Devanagari second line on view tabs and column headers (A1, A3).
