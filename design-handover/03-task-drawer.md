# 03 · Task drawer

Prereq: `00-tokens.md`, `02-common-components.md`, `16-animations.md`. Interaction behaviour is in `MOTION-SPEC.md` §1–§8 and demonstrated live in `Interaction Catalogue.html` sections 1, 2, 6, 7, 8. Permission gating is in `RBAC-SPEC.md`.

Design source: `IxDrawer.jsx`, `IxFiles.jsx`, `IxWork.jsx`, `motion.css` §Section 1 demos.

---

## The finding that governs this file

**The drawer is a third token vocabulary.** `02-common-components.md` documents two systems; the drawer is neither of them:

| Vocabulary | Where | Example tokens |
|---|---|---|
| Tailwind utilities | `ui/*.js`, `views/*` | `bg-accent`, `textMuted`, `borderDefault` |
| `k-*` CSS classes | `editorial/*` | `k-card`, `k-statuschip`, `k-due` |
| **`--ink*` / `--rule*` custom properties** | **`drawer/*`, `k-input`, `k-btn`** | **`--ink`, `--ink-2`, `--ink-3`, `--ink-faint`, `--rule`, `--rule-soft`, `--rule-strong`, `--bg-soft`, `--side-active`, `--k-primary`, `--k-danger`** |

Three vocabularies, one app. The drawer's names map cleanly onto the redesign's, and this table is the migration:

| Drawer token | Redesign token |
|---|---|
| `--ink` | `--on-surface` |
| `--ink-2` | `--on-surface-2` |
| `--ink-3` | `--on-surface-3` |
| `--ink-faint` | `--on-surface-faint` |
| `--rule` | `--outline-variant` |
| `--rule-soft` | `color-mix(in srgb, var(--outline-variant) 60%, transparent)` |
| `--rule-strong` | `--outline` |
| `--bg-soft` | `--s-low` |
| `--surface` | `--surface` (already correct) |
| `--side-active` | `--primary-container` |
| `--k-primary` | `--primary` |
| `--k-danger` | `--danger` |

### And the status colours disagree across files

Three files define status colour. They do not agree:

| State | `drawer/constants.js` | `editorial/StatusChip.jsx` | Target |
|---|---|---|---|
| `todo` | `#64748b` | `#94a3b8` | `var(--st-todo)` |
| `in_progress` | `#0082c6` | `#0082c6` | `var(--st-in-progress)` |
| `in_review` | `#8b5cf6` | `#a78bfa` | `var(--st-in-review)` |
| `done` | **`#16a34a`** | **`#05b7aa`** | `var(--st-done)` |
| `requested` | **`#9333ea`** | **`#f59e0b`** | `var(--st-requested)` |
| `rejected` | `#ef4444` | `#ef4444` | `var(--st-rejected)` |
| `pending` | `#d97706` | `#f59e0b` | `var(--ap-pending)` |
| `pending_client` | `#7c3aed` | `#8b5cf6` | `var(--ap-pending-client)` |
| `approved` | `#16a34a` | `#05b7aa` | `var(--ap-approved)` |

The Target column names tokens, not hexes. It listed hexes until `00-tokens.md` §9 revised four of them, at which point this table was quietly wrong — the same failure as `14`. `00` §9 holds the values and both themes.

**A task that is `done` renders green in the drawer header and teal in the task list. A `requested` task renders purple in the drawer and amber in the list.** Same task, same state, two colours, depending on which component is drawing. The labels drift too: `rejected` is "Declined" in `drawer/constants.js` and "Rejected" in `editorial/StatusChip.jsx`.

`ui/statusColors.js` (from `02-common-components.md`) is the single source. Delete both local maps.

---

## 1 · Exact CSS

### Shell

```css
.dr{position:fixed;z-index:60;top:0;right:0;bottom:0;width:min(720px,78vw);display:flex;flex-direction:column;background:var(--surface);border-left:1px solid var(--outline-variant);box-shadow:var(--shadow-4);animation:dmDrawerIn var(--dur-base) var(--ease-emph-in)}
.dr.out{animation:dmDrawerOut var(--dur-base) var(--ease-exit) forwards}
.dr__scrim{position:fixed;inset:0;z-index:59;background:var(--scrim);animation:dmFade var(--dur-base) var(--ease-enter)}
.dr__head{display:flex;align-items:center;gap:10px;padding:11px 14px;border-bottom:1px solid var(--outline-variant);flex-shrink:0}
.dr__body{flex:1;overflow-y:auto;padding:16px 18px 24px}
```

Width is `min(720px, 78vw)` — the 78% of the catalogue demo is right proportionally but must cap, or the drawer becomes 1500px on a wide monitor and the list behind it is unreadable.

### Title and section labels

```css
.dr__title{font-family:var(--font-display);font-size:22px;font-weight:500;letter-spacing:-.012em;width:100%;padding:7px 9px;border:1px solid transparent;border-radius:var(--r-sm);background:transparent;text-align:left}
.dr__title:hover{background:var(--s-container)}
.dr__title--edit{background:var(--s-lowest);border-color:var(--primary);box-shadow:0 0 0 3px color-mix(in srgb,var(--primary) 16%,transparent);outline:none}
.dr__id{font-family:var(--font-mono);font-size:11px;color:var(--on-surface-faint)}
.dr__lbl{display:block;font-size:10px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:var(--on-surface-3);margin-bottom:5px}
.dr__lbl-hi{font-family:var(--font-indic);font-size:12px;letter-spacing:0;text-transform:none;font-weight:400;color:var(--on-surface-faint)}
```

`.dr__lbl` replaces the `lbl` **inline style object** exported from `drawer/constants.js`. An inline style object cannot be themed, cannot be overridden per-surface, and does not respond to the density setting — it is a class in everything but name.

The title is 22px `--font-display` at 500 and it **saves on blur, only if changed** — that behaviour is correct and should survive the rewrite. Keep the `#{last-6-of-task_id}` monospace id beside it.

### Status pipeline

Replaces the static status badge. Full interaction in `MOTION-SPEC.md` §3.

```css
.dr__pipe{display:flex;align-items:stretch;width:100%}
.dr__stage{--c:var(--on-surface-3);position:relative;flex:1;min-width:74px;display:flex;align-items:center;justify-content:center;gap:5px;padding:8px 12px;font-size:11.5px;font-weight:600;background:var(--s-low);color:var(--on-surface-3)}
.dr__stage:first-child{border-radius:var(--r-pill) 0 0 var(--r-pill)}
.dr__stage:last-child{border-radius:0 var(--r-pill) var(--r-pill) 0}
.dr__stage.past{background:color-mix(in srgb,var(--c) 15%,var(--surface));color:var(--c)}
.dr__stage.on{background:var(--c);color:#fff;z-index:3}
.dr__stage:not(:last-child)::after{content:'';position:absolute;right:0;top:50%;transform:translate(50%,-50%);z-index:4;width:0;height:0;border-top:13px solid transparent;border-bottom:13px solid transparent;border-left:8px solid var(--s-low)}
.dr__stage.on:not(:last-child)::after{border-left-color:var(--c)}
.dr__stage.past:not(:last-child)::after{border-left-color:color-mix(in srgb,var(--c) 15%,var(--surface))}
```

The chevron is a **CSS triangle from border widths**, not an SVG or a clip-path — it inherits the stage's colour through `border-left-color` in three states, so the arrow always matches the segment behind it. `13px` top/bottom against a stage of `8px 12px` padding gives a 26px notch on a ~33px stage; if you change stage padding, change the 13.

### Subtasks

```css
.dr__st{display:flex;align-items:center;gap:8px;padding:6px 10px;background:var(--s-low);border:1px solid var(--outline-variant);border-radius:var(--r-sm)}
.dr__st-box{width:16px;height:16px;border-radius:4px;border:2px solid var(--on-surface-3);flex-shrink:0;display:grid;place-items:center}
.dr__st-box.on{background:var(--primary);border-color:var(--primary)}
.dr__st-t{flex:1;font-size:13px}
.dr__st.done .dr__st-t{color:var(--on-surface-3);text-decoration:line-through}
.dr__st-as{display:flex;align-items:center;gap:4px;border-radius:var(--r-pill);border:1px solid var(--outline-variant);padding:2px 8px 2px 3px;font-size:11px;font-weight:500;background:var(--primary-container)}
.dr__st-as--none{padding:2px 8px;background:var(--s-low);color:var(--on-surface-faint)}
.dr__st-av{width:16px;height:16px;border-radius:50%;font-size:8px;font-weight:700;color:#fff;display:grid;place-items:center;flex-shrink:0}
```

Checkmark inside the box is 10px at `stroke-width: 3` — at 10px a 2px stroke reads as grey rather than white. The assignee pill shows **first name only** (`name.split(' ')[0]`) and its asymmetric padding (`2px 8px 2px 3px`) is what keeps the 16px avatar optically centred against the text.

Progress meter above the list — new, not in staging:

```css
.dr__st-bar{height:3px;border-radius:var(--r-pill);background:var(--s-high);overflow:hidden}
.dr__st-bar i{display:block;height:100%;background:var(--primary);transition:width var(--dur-slow) var(--ease-emph-in)}
```

### Comments

```css
.dr__cm{display:flex;gap:10px;margin-bottom:14px}
.dr__cm-av{width:28px;height:28px;border-radius:50%;background:color-mix(in srgb,var(--primary) 15%,var(--surface));color:var(--primary);font-size:11px;font-weight:700;display:grid;place-items:center;flex-shrink:0}
.dr__cm-b{margin:4px 0 0;font-size:13px;line-height:1.55;white-space:pre-wrap}
.dr__cm-m{color:var(--primary);font-weight:600}
.dr__cm-act{margin-left:auto;display:flex;gap:4px;opacity:0;transition:opacity var(--dur-fast)}
.dr__cm:hover .dr__cm-act,.dr__cm:focus-within .dr__cm-act{opacity:1}
```

`white-space: pre-wrap` preserves the line breaks a user typed. Edit and delete are revealed on hover **and on `:focus-within`** — hover-only reveals are unreachable by keyboard, which staging's always-visible version at least didn't break.

### Time entries

```css
.dr__tm{display:flex;align-items:center;gap:12px;padding:12px 16px;background:var(--s-low);border:1px solid var(--outline-variant);border-radius:var(--r-md)}
.dr__tm-el{font-family:var(--font-mono);font-variant-numeric:tabular-nums;font-weight:600}
.dr__tm-row{display:flex;justify-content:space-between;align-items:center;padding:9px 0;border-bottom:1px solid color-mix(in srgb,var(--outline-variant) 60%,transparent);font-size:13px}
```

`font-variant-numeric: tabular-nums` on the running timer is mandatory — without it the digits change width every second and the whole row jitters.

---

## 2 · Component tree

```
TaskDrawer                                    components/drawer/TaskDrawer.jsx
├── DrawerScrim
├── DrawerHeader        crumb · pipeline · archive · delete · close
│   └── StatusPipeline                        drawer/StatusPipeline.jsx
├── DrawerTitle         inline edit, save on blur, save indicator
├── DrawerMeta          assignee · due · priority · project · labels
│   ├── PersonPicker                          fields/PersonField.jsx
│   ├── DatePicker                            ui/DatePicker.jsx
│   └── PriorityPicker
├── DrawerTabs          Details · Files (n) · Time · Activity
├── DrawerDescription   autosave textarea
├── DrawerSubtasks
│   ├── SubtaskProgress                       new
│   ├── SubtaskRow  → SubtaskAssigneePicker
│   └── SubtaskAdd
├── DrawerComments  → MentionTextarea · CommentRow (edit/delete)
├── DrawerAttachments   drop zone · progress · retry · lightbox · privacy
├── DrawerTimeEntries → ElapsedTimer · ManualLog · EntryList · Total
└── DrawerApproval      request · pending · approve · decline · client forward
```

---

## 3 · New files

```
frontend/src/components/drawer/StatusPipeline.jsx
frontend/src/components/drawer/SubtaskProgress.jsx
frontend/src/components/drawer/DrawerTabs.jsx
frontend/src/components/drawer/DrawerTitle.jsx
frontend/src/hooks/useAutosave.js         debounce 800ms, idle → saving → saved → error
frontend/src/lib/mentions.js              parse, store and render mention entities
frontend/src/styles/drawer.css
```

---

## 4 · Endpoints

| Endpoint | Notes |
|---|---|
| `GET /v1/tasks/:id` | full task with subtasks, comments, attachments, entries, approval |
| `PATCH /v1/tasks/:id` | partial — `{title}`, `{status}`, `{assignee_user_id}`, `{due_date}`, `{priority}`, `{description}` |
| `POST /v1/tasks/:id/archive` · `/unarchive` | already exists |
| `DELETE /v1/tasks/:id` | permission-gated per `RBAC-SPEC.md` |
| `POST /v1/tasks/:id/subtasks` · `PATCH /v1/subtasks/:id` · `DELETE /v1/subtasks/:id` | `PATCH` carries `{is_done}` or `{assignee_user_id}` |
| `POST /v1/tasks/:id/comments` · `PATCH /v1/comments/:id` · `DELETE /v1/comments/:id` | **`POST` must accept `mentions: [{user_id, offset, length}]`** — see below |
| `POST /v1/tasks/:id/attachments` | multipart, per-file progress |
| `POST /v1/tasks/:id/timer/start` · `/stop` · `POST /v1/tasks/:id/time-entries` · `DELETE /v1/time-entries/:id` | |
| `GET /v1/tasks/:id/activity` | new — the Activity tab has no endpoint today |

---

## 5 · What changes in existing files

| File | Bytes | Change |
|---|---|---|
| `TaskDrawer.jsx` | 32,003 | Orchestration only. Extract `StatusPipeline`, `DrawerTitle`, `DrawerTabs`; move autosave into `useAutosave` |
| `TaskEditor.jsx` | 34,039 | **Audit for deletion.** It overlaps `TaskDrawer` heavily; two 32 KB components editing the same entity is how the status-colour drift happened. If it is still routed, converge them |
| `drawer/constants.js` | 1,088 | `STATUS_COLORS`, `STATUS_LABELS`, `APPROVAL_STATUS_*` → `ui/statusColors.js`. `lbl` inline object → `.dr__lbl` class. Keep `fmtMinutes` verbatim — `0m` / `Xh Ym` / `Ym` is right |
| `drawer/DrawerHeader.jsx` | 4,099 | Static badge → `StatusPipeline`. Token rename. Keep the scrolled-title collapse (`maxWidth: 200`) and save-on-blur-if-changed |
| `drawer/DrawerMeta.jsx` | 11,367 | Token rename; pickers → `ui/Menu.jsx` so they share dismiss and roving-focus behaviour |
| `drawer/DrawerSubtasks.jsx` | 9,791 | Add `SubtaskProgress`. Inline styles → classes. **The assignee dropdown opens upward (`bottom: calc(100% + 4px)`) with a hardcoded `z-index: 300`** — move to `ui/Menu.jsx` with collision-aware placement, since a subtask near the top of a scrolled drawer currently opens off-screen |
| `drawer/DrawerComments.jsx` | 4,692 | Three fixes below |
| `drawer/DrawerTimeEntries.jsx` | 4,516 | Keep `ElapsedTimer` — it recomputes from `startedAt` every tick instead of incrementing, so it does not drift across a backgrounded tab. Replace the hardcoded `#dc2626` Stop button with `.btn--danger` |
| `drawer/DrawerAttachments.jsx` | 22,095 | Largest drawer file. Restyle to the drop-zone spec in `MOTION-SPEC.md` §6; keep the upload machinery |
| `drawer/DrawerApproval.jsx` | 9,304 | Restyle; gate on `RBAC-SPEC.md` roles. Labels come from `statusColors.js` |
| `MentionTextarea.jsx` | 5,058 | See below |

### Three real bugs in `DrawerComments.jsx`

**1 · Mentions are a client-side regex over the comment body.**

```js
c.body.split(/(@[\w.-]+)/g).map(part => part.startsWith('@') ? <strong>…</strong> : part)
```

Nothing is stored. Consequences: renaming a user silently breaks every past mention; a literal `@` in prose ("email me @ work") renders as a mention; and there is no way to notify the mentioned person from the body alone. Store mention entities on the comment (`{user_id, offset, length}`) and render from those. `lib/mentions.js` owns both directions.

**2 · The timestamp ignores the user's time-format preference.** `new Date(c.created_at).toLocaleString()` — while `lib/timeFormat.js` exists and `DueChip` already uses it. A user who set 24-hour time still sees 12-hour comments.

**3 · The docstring says "threaded comment list". It is flat.** There is no `parent_comment_id` anywhere. Either implement threading or fix the comment — a wrong docstring on a 4 KB file is how the next person wastes an afternoon.
