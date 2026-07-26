# boards-surface — findings and work log

Agent branch: `boards-surface` (started from `salvage/boards-toolbar`, commit `5e073b1`).
Surface owned: `pages/BoardsPage.jsx`, `components/views/**`, `components/NewTaskModal.jsx`,
`styles/boards.css`, `components/drawer/**`.
Governing specs: `design-handover/04-boards-table-views.md` (boards, table, views),
`design-handover/03-task-drawer.md` (drawer), with `00-tokens.md`, `02-common-components.md`
and `16-animations.md` as prerequisites.

Written incrementally. Each section is appended the moment the finding is confirmed against
code that was opened in this session.

---

## A · The salvage fragment — VERIFIED, HELD

`5e073b1` touched three files. All three changes are correct and both gates pass with them
applied (`check-tokens: 0 missing`, `check-classes: 0 missing a rule`).

| Change | Verdict |
|---|---|
| `NewTaskModal.jsx`: `AVATAR_COLORS[i % len]` + `userInitials` → `<Avatar name>` at two call sites | HELD. The old form keyed colour off the **array index** while the loop above it `continue`s past members with no name, so a person's colour changed when someone above them was skipped. `Avatar` hashes the name. |
| `NewTaskModal.jsx`: `.k-input` → `.inp` on the due input and the description textarea | HELD |
| `ViewToolbar.jsx`: group `<select>` `.k-input` → `.inp` | HELD |
| `boards.css`: `.vtb__group .inp { width: auto; height: 32px }` | HELD, and necessary — `.inp` is `width: 100%`, so without this the select ate the toolbar row. 32px matches `.k-searchpill` beside it. |

Nothing in the fragment was wrong. It was incomplete, not incorrect: it converted two of the
three `.k-input` sites on the surface and left `BulkBar.jsx:134`.

---

## B · Claims from the brief, adjudicated

### B1 · Hex-alpha `${c}18` in MyTasksView, PriorityView, WorkloadView — **STALE**

Already fixed before this session. Evidence: a repo-wide grep for the idiom
(`\$\{[a-zA-Z_.]+\}(18|1a|20|33|0d|14|26|40)\b`) returns **no hit in any of the three files**.
All three now carry a header comment describing the bug in the past tense, and read
`var(--danger)` / `var(--warn)` / `var(--ok)` / `PRIORITY_COLORS` tokens directly. `MyTasksView`
and `PriorityView` both use `StatusChip`; `WorkloadView` computes its load tone from
`var(--danger)` / `var(--warn)` / `var(--primary)`.

The idiom **does** still live in files outside this surface, and is reported here only so it is
not lost: `pages/HubClientDetailPage.jsx:22`, `pages/HubDashboardPage.jsx:22`,
`pages/HubSkillsPage.jsx:37`, `pages/OrgSrijanPage.jsx:31` and `:303`. Those belong to other
surface owners; not edited.

### B2 · `components/TaskEditor.jsx` has zero importers — **HELD**. Deleted.

Proof, run before deleting:

- `grep -rnE "^\s*(import|const|let|var).*TaskEditor|from ['\"].*TaskEditor"` over `frontend/src`,
  `frontend/*.js`, `frontend/*.json`, `e2e`, `tests` → **exit 1, no match**.
- `grep -rn "<TaskEditor"` over `frontend/`, `e2e/`, `tests/` → **no match**.
- The only files containing the string were: its own definition; three prose comments
  (`documents/FileDropZone.jsx`, `documents/fileMeta.js`, `layout/AppShell.jsx`); and
  `BoardsPage.jsx` / `ProjectBoardPage.jsx`, where every hit is the local state variable
  `newTaskEditor`, not the component.

`03-task-drawer.md` §215 rules: "**Audit for deletion.** … If it is still routed, converge them."
It was not routed, so it was deleted rather than converged. Removed with it: 595 lines, 22
hardcoded colour literals, a third drop zone, a duplicate lightbox, and a fourth private copy of
the file-extension tests. The three prose comments were updated to say the file is gone, so the
next reader does not go looking for it.

### B3 · Drop zones exist ~4 times — **HELD, now 3**

Implementations found: `documents/FileDropZone.jsx` (the shared one, used by
`esign/CreateTab.jsx`), `drawer/DrawerAttachments.jsx` (the drawer's — the correct one per the
brief), `NewTaskModal.jsx`, and `TaskEditor.jsx`. The `TaskEditor` copy is deleted.
`CalendarView.jsx` and `org/LogoUpload.jsx` also match a drag-handler grep but are not file drop
zones — Calendar's handlers are task-onto-day rescheduling, LogoUpload is a single org asset.

---

## C · Changes made

### C1 · `TaskEditor.jsx` deleted; `BulkBar`'s `.k-input` converted — commit `506c009`

`BulkBar.jsx:134` was the last `.k-input` on this surface. The legacy class hard-codes
`border-radius: 8px` (00 §3 forbids a literal radius — it ignores the Sharp/Pill setting) and
takes its focus border from `--k-primary`, an alias of `--primary-vivid`, which is a FILL and
fails contrast as a 1px ring. Converted to `.inp` with `.tbl__bulk .inp { width: auto; height: 30px }`
in `boards.css` — 30px is `.btn--sm`'s height, because the field replaces a button in that row
and must not change the bar's height when it opens. Without the width rule `.inp`'s `width: 100%`
pushed the other four verbs off the bar.

### C2 · Bulk field-values endpoint, and real error states — commit `d3736b8`

**New backend route: `GET /api/fields/team/{team_id}/values`** (`backend/routers/fields.py`).
Returns `{task_id: {field_id: value}}` for a whole board in one query. Two defects shared one
root — nothing was fetching the (task × custom field) matrix the table renders:

- `BoardsPage.jsx` never passed `fieldValueMap` to `TableView` at all. `TableView:113` destructures
  it and `:326` reads it, so **every custom-field cell on `/boards` rendered blank** regardless of
  what the task actually held. Confirmed by grep: before this change the only `fieldValueMap`
  producers in the repo were `ProjectBoardPage` and the README.
- `ProjectBoardPage.jsx` built the map with `Promise.all` over `tasks`, calling
  `GET /fields/task/{id}/values` **once per task**. A 200-task board opened 200 requests, each
  re-running the same `_assert_team_member` lookup, and committed the map only when the slowest
  settled.

Both now use the new `useFieldValueMap(teamId, enabled)` hook in `hooks/useFields.js`. The handler
guards jsonb arriving as raw text, because `db.py:41` logs `set_type_codec skipped (PgBouncer)` and
carries on in that mode — without the guard a checkbox field reaches the renderer as the string
`"false"`, which is truthy. `_norm_field` already guards `config` identically.

**Error states.** `BoardsPage`'s board load was `catch (_) {}` and its project list
`.catch(() => {})`. A board that failed to load rendered as a board with no columns and no tasks —
indistinguishable from an empty one, and unrecoverable short of a page reload. Both now render
`ErrorState` with `errorKind`, which separates offline / 403 / 404 / 500; a 403 is a real answer
and not the same instruction as "try again". A genuinely empty account gets `EmptyState` instead,
which is a different sentence from "we could not ask".

### C3 · Board interaction and motion, to the reference implementation — commit `3839324`

Read against `design-reference/Kartavaya Redesign/IxViews.jsx` §9–§10 and `motion.css`.

| Spec | Was | Now |
|---|---|---|
| 9.3 inline add composer | "Add opens a full New Task modal, so adding six cards means six modals" — still literally true | Composer in the column foot. Enter creates and **clears without closing**, Shift+Enter newlines, Esc/Done closes, blur closes only while empty. Wired to `POST /tasks`. |
| 9.4 quick-complete tick | absent; marking done took three clicks through the drawer | Hover-revealed tick, permanently visible on touch (MOTION §7.7), `stopPropagation` so ticking does not also open the card |
| 9.1 lift | `rotate(2deg) scale(1.02)` + `--shadow-4` | `scale(1.02) rotate(.6deg)` + `--shadow-2` per `motion.css .kb__card.lift` |
| 9.2 press | absent | `.bc:active { scale(.985) }` at `--dur-instant` |
| 9.1 drop target | solid border, 7%/34% | **dashed** border, 9%/48% per `.kb__col.over` |
| 9.1 count preview | count updated after the drop | badge previews the new total while held over |
| 9.1 settle | absent | one `--primary` flash, `calc(--dur-slow * 1.5) --ease-exit` |
| MOTION §7.1 optimistic | write looked identical to a commit | `opacity: .6` until acknowledged, on both the move and the tick |

`onColumnChange` had no caller left after the composer replaced its only action
(`('new_task', columnId)`) and is removed from `KanbanView` and both pages.

**BulkBar now uses the real bulk endpoints.** `PATCH` / `DELETE /api/v1/tasks/bulk` landed in
`backend/routers/tasks_bulk.py` (another agent, same batch); BulkBar's own header asked for exactly
this "the day the two bulk endpoints land". Forty selected rows were forty round trips and could
end up half-applied; it is one transaction with per-id savepoints now. The route answers
`{task_id, ok, status}` per row rather than whole records, so `TableView`'s `onPatched` had to
become a **merge** — substituting that partial for the task would have blanked every field the bar
does not set, title first.

`KanbanView` also gains an empty state (a board with no columns rendered as an empty flex row) and
`PriorityView` a view-level one (four "Nothing at this priority" blocks is not an empty-board
message).

### C4 · Drawer easing — `styles/drawer.css`

MOTION-SPEC §3 gives the desktop task drawer `--dur-slow --ease-emph`. The code used
`--ease-emph-in`, which §2 reserves for "bottom sheets rising" — its very early acceleration reads
as a sheet thrown up from the edge rather than a panel sliding in from the side. The keyframes were
already correct (`translateX(28px)` + `opacity .3→1` in, `translateX(16px)` out, `--dur-slow` /
`--dur-base`), and the exit is properly wired through an `is-closing` class rather than
`if (!open) return null`. Only the curve was wrong.

---

## D · Spec conflicts — recorded, not silently resolved

1. **Card lift.** `04-boards-table-views.md` §1 gives `.bc.drag{transform:rotate(2deg) scale(1.02);
   box-shadow:var(--shadow-4)}` and argues in prose "`rotate(2deg)` on lift is staging's value and
   it is a good one — keep it". `IxViews.jsx` 9.1 and `motion.css .kb__card.lift` both give
   `scale(1.02) rotate(.6deg)` + `--shadow-2` at 140ms. Resolved toward the **reference
   implementation** per `_SOURCE-MAP.md` ("the .md files tell you the intent; these files ARE the
   answer"). 2deg on a 288px column also clips the neighbouring card's edge in a tall list.
2. **Drop-target tint.** 04 §1 gives 7% tint / 34% border over `--s-low` with a solid border;
   `motion.css` gives 9% / 48% and a **dashed** border. Reference again.
3. **Drawer easing.** MOTION-SPEC §3 says `--ease-emph`; `styles/animations.css`'s own summary
   table (line 39) and its `.ix-enter-drawer` utility (line 281) both say `--ease-emph-in`. Fixed
   in `drawer.css` for the actual drawer element; the generic utility and that table are **another
   surface's file** and are reported here rather than edited.

## E · Data paths — every view verified against a real endpoint

All seven views receive `tasks` from `GET /tasks?team_id=`, and `columns` from
`GET /projects/:id/columns`. No mock data, no stubbed handler on this surface.

| View | Writes | Loading | Empty | Error |
|---|---|---|---|---|
| Kanban | `PATCH /tasks/:id/move`, `POST /tasks`, `PATCH /tasks/:id`, column CRUD | page skeleton | **added** | page `ErrorState` + per-action toast |
| Table | `PUT /fields/task/:id/values`, `PATCH`/`DELETE /v1/tasks/bulk` | page skeleton | two states (filtered vs genuinely empty) | toast |
| Calendar | `PUT /tasks/:id` (drag-to-reschedule) | page skeleton | grid renders regardless | toast |
| Timeline | read-only | page skeleton | `EmptyState` | page `ErrorState` |
| Workload | read-only | page skeleton | `EmptyState` | page `ErrorState` |
| Priority | read-only | page skeleton | **added** | page `ErrorState` |
| My tasks | read-only | page skeleton | `EmptyState` + not-signed-in state | page `ErrorState` |
