# 04 · Boards, table and views

Prereq: `00-tokens.md`, `02-common-components.md`, `03-task-drawer.md`, `16-animations.md`. Drag, sort, resize and bulk behaviour are in `MOTION-SPEC.md` §9–§10, demonstrated live in `Interaction Catalogue.html` sections 9 and 10.

Design source: `IxWork.jsx`, `IxViews.jsx`.

---

## The findings that govern this file

### 1 · Due-date logic exists three times, and the three disagree

`editorial/DueChip.jsx`, `views/KanbanCard.jsx` and `views/TableView.jsx` each compute due-date presentation independently:

| | DueChip | KanbanCard | TableView |
|---|---|---|---|
| overdue | `3d overdue` | `⚠ 3d overdue`, weight 700 | `⚠` suffix, weight 700 |
| today | `Today, 4:30 pm` | `Due today, 4:30 pm` | plain date |
| 2 days out | `In 2d` (normal) | `In 2d` (**soon**, amber) | plain date |
| 5 days out | `In 5d` (normal) | `In 5d` (normal) | plain date |
| far | `02 Aug` | `02 Aug` | `Aug 2` |
| done on time | `✓ Done 3h ago` | `✓ Done on time` | *nothing* |
| done late | `✓ Done · 2d late` | `✓ Done · 2d late` | *nothing* |

So the same task reads "Today, 4:30 pm" in a list, "Due today, 4:30 pm" on a board, and "Jul 25" in the table — and only the board has a "soon" tier. **Use `ui/DueChip.jsx` in all three.** Its logic is the reference (`02-common-components.md` §DueChip); adopt the board's `soon` tier into it if you want the amber two-day warning, but adopt it *once*.

The "done on time" comparison is likewise written three times, with `#16a34a` hardcoded in two of them.

### 2 · `--k-danger` and `--danger` are both used, in sibling files

`KanbanCard.jsx` uses `var(--k-danger)`; `TableView.jsx` uses `var(--danger)` for the same overdue colour. One of the two is undefined, and an undefined colour in a `color:` declaration silently falls back to inherited text — so overdue rows in one of these views are not actually red. Resolve to `--danger` (`00-tokens.md`).

### 3 · Kanban drag does not work on touch

`KanbanCard.jsx` uses the HTML5 drag API — `draggable`, `onDragStart`, `onDragEnd`. **HTML5 drag-and-drop does not fire on touch devices.** Board drag is desktop-only today, which is also why there is no 3px threshold: the native API has no concept of one, so a click and a drag can't be told apart by distance.

Replace with pointer events via `useDrag` (`16-animations.md`). That single change gives touch support, the 3px threshold, and the lift/tilt as a transform you control.

### 4 · Grouping order is insertion order

`TableView.jsx` builds groups with `Object.entries(groups)`, so "Group by priority" lists them in whatever order rows happened to arrive — not `urgent → high → medium → low`. `PRIORITY_ORDER` already exists in the same file for sorting; grouping just doesn't use it.

---

## 1 · Exact CSS

### Board

```css
.bd{display:flex;gap:12px;align-items:flex-start;overflow-x:auto;padding-bottom:10px}
.bd__col{width:288px;flex-shrink:0;display:flex;flex-direction:column;gap:8px;padding:10px;border-radius:var(--r-md);background:var(--s-low);border:1px solid transparent;transition:background var(--dur-base),border-color var(--dur-base)}
.bd__col.over{background:color-mix(in srgb,var(--primary) 7%,var(--s-low));border-color:color-mix(in srgb,var(--primary) 34%,transparent)}
.bd__ch{display:flex;align-items:center;gap:8px;padding:2px 4px 8px}
.bd__cdot{width:8px;height:8px;border-radius:50%;flex-shrink:0;background:var(--c)}
.bd__cn{font-size:13px;font-weight:800;letter-spacing:-.005em}
.bd__cc{font-family:var(--font-mono);font-size:11px;color:var(--on-surface-faint);margin-left:auto}
```

The drop target highlights the **column**, not a gap between cards. A card-level insertion indicator is more precise than anyone needs on a kanban board and costs a hit-test per pointermove.

### Card

```css
.bc{display:flex;flex-direction:column;gap:7px;padding:11px 12px;border-radius:var(--r-sm);background:var(--surface);border:1px solid var(--outline-variant);box-shadow:var(--shadow-1);text-align:left;transition:box-shadow var(--dur-fast),transform var(--dur-fast)}
.bc:hover{box-shadow:var(--shadow-2)}
.bc__top{display:flex;align-items:center;gap:7px}
.bc__id{font-family:var(--font-mono);font-size:10px;color:var(--on-surface-faint)}
.bc__prio{margin-left:auto;font-size:10px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--c)}
.bc__t{font-size:13px;line-height:1.4;font-weight:500;text-wrap:pretty}
.bc__foot{display:flex;align-items:center;gap:9px;font-size:11px;color:var(--on-surface-3)}
.bc__av{width:26px;height:26px;border-radius:50%;font-size:10px;font-weight:700;letter-spacing:-.3px;color:#fff;display:grid;place-items:center;border:2px solid var(--surface);box-shadow:0 1px 3px rgba(0,0,0,.15);flex-shrink:0}
.bc__av+.bc__av{margin-left:-8px}
.bc.drag{transform:rotate(2deg) scale(1.02);box-shadow:var(--shadow-4);cursor:grabbing}
.bc__ghost{border:1px dashed var(--outline);background:color-mix(in srgb,var(--primary) 5%,transparent);border-radius:var(--r-sm)}
```

`rotate(2deg)` on lift is staging's value and it is a good one — keep it. `.bc__av + .bc__av { margin-left: -8px }` replaces the `marginLeft: i > 0 ? -8 : 0` conditional; the sibling selector means the overlap survives reordering and doesn't need an index.

Approval pill — staging hardcodes `#d97706` / `#fef3c7` / `#fbbf24`, which are light-mode literals that render as a pale-yellow chip on a dark board:

```css
.bc__appr{font-size:10.5px;font-weight:600;padding:1px 7px;border-radius:var(--r-pill);color:var(--warn);background:var(--warn-container);border:1px solid color-mix(in srgb,var(--warn) 40%,transparent)}
```

### Table

```css
.tb{width:100%;border-collapse:collapse;font-size:13px}
.tb__wrap{overflow-x:auto;border-radius:var(--r-md);border:1px solid var(--outline-variant)}
.tb th{position:sticky;top:0;z-index:2;padding:9px 14px;text-align:left;font-size:10.5px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--on-surface-3);white-space:nowrap;background:var(--s-low);border-bottom:1px solid var(--outline-variant);user-select:none}
.tb th.sortable{cursor:pointer}
.tb th.sortable:hover{color:var(--on-surface)}
.tb__sort{display:inline-flex;width:12px;margin-left:5px;opacity:0;transition:opacity var(--dur-fast)}
.tb th.sortable:hover .tb__sort,.tb th.on .tb__sort{opacity:1}
.tb td{padding:10px 14px;vertical-align:middle;border-bottom:1px solid color-mix(in srgb,var(--outline-variant) 60%,transparent)}
.tb tbody tr{cursor:pointer;transition:background var(--dur-fast)}
.tb tbody tr:hover{background:var(--s-low)}
.tb tbody tr.sel{background:var(--primary-container)}
.tb__grp td{padding:8px 14px;font-size:10.5px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--on-surface-3);background:var(--s-low)}
.tb__grip{position:absolute;right:0;top:0;bottom:0;width:7px;cursor:col-resize}
.tb__grip:hover,.tb__grip.on{background:color-mix(in srgb,var(--primary) 40%,transparent)}
```

Three changes from staging worth stating because each fixes a specific defect:

- **Sort is a reserved-width SVG, not an appended arrow.** Staging appends `' ↑'` to the label text, so toggling sort reflows the header and the columns beside it shift. A 12px slot that fades in holds its space.
- **Sort is three-state**: asc → desc → none. Two-state means once you sort you cannot get back to `sort_order`, which is the board's manual ordering and the only view that reflects deliberate human sequencing.
- **`:hover` is CSS.** Staging mutates `e.currentTarget.style.background` in `onMouseEnter`/`onMouseLeave`, which writes an inline style that then wins over any selection or focus styling you add later.

### Bulk selection — new, does not exist in staging

```css
.tb__bulk{position:sticky;bottom:0;z-index:3;display:flex;align-items:center;gap:12px;padding:10px 14px;background:rgba(var(--glass-tint),.94);backdrop-filter:blur(18px);border-top:1px solid var(--outline-variant);animation:dmSheetIn var(--dur-base) var(--ease-emph-in)}
.tb__cb{width:16px;height:16px;border-radius:4px;border:1.5px solid var(--outline);display:grid;place-items:center;flex-shrink:0}
.tb__cb.on{background:var(--primary);border-color:var(--primary)}
.tb__cb.part{background:var(--primary);border-color:var(--primary)}
.tb__cb.part i{width:8px;height:2px;border-radius:1px;background:#fff}
```

The header checkbox has a genuine **indeterminate** state (a dash, not a tick) when some but not all rows are selected. `input[type=checkbox].indeterminate` also needs setting on the DOM node for assistive tech — the visual dash alone is not the state.

---

## 2 · Component trees

```
BoardView                                  views/BoardView.jsx
├── BoardToolbar     view switch · filter · group · fields
├── BoardColumn ×n   drop target
│   ├── ColumnHeader dot · name · count · ⋯
│   ├── TaskCard ×n                        views/TaskCard.jsx
│   ├── CardGhost    insertion placeholder
│   └── AddCard      inline composer
└── TaskDrawer                             03-task-drawer.md

TableView                                  views/TableView.jsx
├── TableToolbar     search · group · fields · FilterBuilder
├── FilterBuilder    field → operator → value                new
├── Table
│   ├── HeaderRow    3-state sort · resize grip · select-all
│   ├── GroupRow     ordered, not insertion-ordered
│   └── Row          inline-editable cells
├── BulkBar          status · assignee · due · delete        new
└── TaskDrawer
```

Views sharing one toolbar: `views/ViewToolbar.jsx` — Board, Table, Calendar, Timeline, Workload and Priority all need view-switch, filter and group, and today each has its own.

---

## 3 · New files

```
frontend/src/components/views/ViewToolbar.jsx
frontend/src/components/views/FilterBuilder.jsx
frontend/src/components/views/BulkBar.jsx
frontend/src/components/views/TaskCard.jsx        ← KanbanCard.jsx, renamed
frontend/src/components/views/CardGhost.jsx
frontend/src/hooks/useColumnResize.js
frontend/src/hooks/useTableSelection.js           anchor + shift-range
frontend/src/lib/grouping.js                      ordered group keys
frontend/src/styles/views.css
```

---

## 4 · Endpoints

| Endpoint | Notes |
|---|---|
| `GET /v1/boards/:id` | columns + tasks |
| `PATCH /v1/tasks/:id/move` | `{column_id, sort_order}` — **must be a single call.** Two calls (set column, then set order) leaves a visible wrong-position frame if the second fails |
| `POST /v1/tasks` | inline add-card: `{board_id, column_id, title}` |
| `PATCH /v1/tasks/bulk` | `{task_ids[], patch{}}` — new, for BulkBar |
| `DELETE /v1/tasks/bulk` | `{task_ids[]}` — new |
| `GET /v1/boards/:id/tasks?q=&group=&sort=` | server-side once a board exceeds ~500 tasks; client-side filtering is fine below that |

---

## 5 · What changes in existing files

| File | Bytes | Change |
|---|---|---|
| `views/KanbanCard.jsx` | 6,028 | Rename `TaskCard`. **Replace HTML5 drag with `useDrag`** (touch + 3px threshold). Delete local `relDue` and `DUE_COLORS` → `ui/DueChip.jsx`. Delete the duplicated done-on-time block. Approval pill → `.bc__appr` tokens, not light-mode hexes. `--k-danger` → `--danger`. Avatar overlap → sibling selector |
| `views/KanbanView.jsx` | 16,823 | Column drop targets via pointer events; `.over` highlight; `CardGhost`; optimistic move with rollback on failure |
| `views/TableView.jsx` | 11,216 | 3-state sort; SVG sort indicator; column resize; bulk selection; `FilterBuilder`; CSS `:hover`; ordered grouping via `lib/grouping.js`; sticky header. Remove the `⏳` emoji — use the `.bc__appr` chip |
| `views/CalendarView.jsx` | 20,403 | Restyle only. **Not in the interaction catalogue** — its drag-to-reschedule and multi-day-event behaviour is unspecified and needs a design pass before it is touched |
| `views/TimelineView.jsx` | 10,349 | Restyle only. Same caveat |
| `views/WorkloadView.jsx` | 7,415 | Restyle only. Same caveat |
| `views/PriorityView.jsx` | 7,014 | Restyle only. Same caveat |
| `views/MyTasksView.jsx` | 8,551 | Adopt `ui/DueChip.jsx` and `ui/StatusChip.jsx` |
| `fields/FieldRenderer.jsx` | 1,016 | Add an editable mode — the table calls it with `readOnly` and `onChange={() => {}}`, so custom-field cells are permanently read-only |
| `ui/EmptyState.jsx` | 6,346 | Keep. It is correctly used inside a `<td colSpan>` |

### The field-visibility reset

```js
React.useEffect(() => { setVisible((fieldDefs || []).map(f => f.field_id)); }, [fieldDefs?.length]);
```

Adding or removing any custom field resets every hidden column back to visible, discarding the user's choice. Persist visibility per board in `localStorage` (or in preferences) and reconcile by id — show new fields by default, leave existing choices alone.

### The `<details>` dropdown

Field visibility uses native `<details>`/`<summary>` as a menu. It doesn't close on outside click, doesn't close on Escape, and announces as a disclosure rather than a menu. Move to `ui/Menu.jsx` (`02-common-components.md`), which owns all three behaviours.
