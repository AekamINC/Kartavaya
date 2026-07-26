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
