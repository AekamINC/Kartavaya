# 05 · Today (dashboard)

Prereq: `00-tokens.md`, `02-common-components.md`, `04-boards-table-views.md`. Skeleton and page-transition behaviour in `MOTION-SPEC.md` §12.

Design source: `ScreensCore.jsx` → `ScreenToday`, `app.css` §Hero, §Stat tiles.

---

## Six real bugs found reading `DashboardPage.jsx`

### 1 · The task IDs on "On your plate" are fabricated from the array index

```js
<span className="k-taskrow__id">KAR-{String(i+100)}</span>
```

`i` is the map index. So the third task in the list is `KAR-102` — until a task above it closes, at which point a *different* task becomes `KAR-102`. Two tasks in different lists can carry the same ID, and an ID a user quotes in a message ("can you look at KAR-103") refers to nothing.

Everywhere else in the app the ID is `#${task_id.slice(-6)}` (`DrawerHeader.jsx`, `KanbanCard.jsx`). Use that. If a human-readable sequential key is genuinely wanted, it has to be a persisted column on the task, not a render-time index.

### 2 · The onboarding checklist can never complete

```js
const done = { logo: false, team: (teams||[]).length > 1, project: (teams||[]).length > 0,
               contact: false, invoice: false };
…
if (doneCount >= total) return null;
```

`logo`, `contact` and `invoice` are **hardcoded `false`**. Three of five steps can never be satisfied, so `doneCount` maxes at 2/5, so the self-dismissing branch is unreachable. A user who uploads a logo, adds a contact and sends an invoice still sees "2 of 5 steps complete" forever, with three ticks they cannot earn.

Also `team: teams.length > 1` infers "invited your team" from having more than one *team* (project), which is a different fact entirely.

Each step needs a real signal:

| Step | Signal |
|---|---|
| logo | `org.logo_url != null` |
| team | `org.member_count > 1` |
| project | `boards.length > 0` |
| contact | `graha.contact_count > 0` |
| invoice | `ganit.invoice_count > 0` |

One endpoint: `GET /v1/me/onboarding` → `{logo, team, project, contact, invoice}` as booleans. And it should read the onboarding wizard's completion (`12-auth-onboarding.md`) — a user who finished the wizard has already done three of these, and being asked again is the fastest way to teach someone the checklist is noise.

### 3 · "across 1 project" when there are no projects

```js
openProjectCount: new Set(open.map(t => t.team_id).filter(Boolean)).size || 1
```

`|| 1` turns zero into one. A brand-new org with nothing in it is told its open tasks span one project. Drop the `|| 1` and let the empty state say something true.

### 4 · "Done this week" counts the wrong timestamp

```js
completedWeek: safeTasks.filter(t => t.status === 'done' && t.updated_at && new Date(t.updated_at) >= weekAgo)
```

`updated_at`, not `completed_at`. A task finished two months ago but edited yesterday counts as done this week; a task genuinely completed on Monday but edited today… also counts, by accident. `completed_at` exists and `DueChip` already uses it. The derived "completion rate" inherits the error.

### 5 · "On your plate" includes work you delegated

```js
const myTasks = safeTasks.filter(t => t.created_by_user_id === myId || t.user_id === myId || t.assignee_user_ids?.includes(myId));
```

Tasks you created and assigned to someone else appear on *your* plate. For a manager that makes the list useless — it becomes "everything I've ever touched". Your plate is `assignee_user_ids.includes(myId)`. If created-but-delegated work matters, it is a second section ("Waiting on others"), not the same list.

### 6 · The Vikram Samvat date is approximate, and presented as exact

```js
const year  = now.getFullYear() + 56 + (now.getMonth() >= 3 ? 1 : 0);
const month = VIKRAM_MONTHS[(now.getMonth() + 1) % 12];
```

The Vikram Samvat year rolls over at Chaitra Śukla Pratipadā — a lunar date that lands anywhere from mid-March to mid-April — not at a fixed Gregorian month boundary. And the month is a naive `+1` offset from the Gregorian month, so the named month is wrong for most of any given month.

The **year** is right to within a couple of weeks a year, which is honest enough for a decorative date line. The **month name** is not. Either compute it properly from a panchāng source or show only `विक्रम संवत् {year}`. Displaying a specific Hindu month name that is wrong is worse than showing no month at all, particularly to the audience most likely to notice.

### And: emoji in the quick actions

```js
{ label: '+ New Task', icon: '✏️' }, { label: 'Create Invoice', icon: '🧾' },
{ label: 'Add Contact', icon: '👤' }, { label: 'Log Time', icon: '⏱️' },
```

Four emoji, rendering differently on every platform, in a product whose iconography is otherwise a consistent 16px stroke set. Use `navIcons.jsx` (`01-navigation.md`).

---

## 1 · Exact CSS

### Hero

```css
.hero{position:relative;overflow:hidden;padding:26px 28px;border-radius:var(--r-lg);background:var(--s-low);border:1px solid var(--outline-variant)}
.hero__wm{position:absolute;right:-2%;top:-18%;font-family:var(--font-hindi);font-size:190px;line-height:1;color:var(--on-surface);opacity:.03;pointer-events:none;user-select:none}
.hero__date{display:flex;flex-wrap:wrap;align-items:baseline;gap:9px;font-size:10.5px;letter-spacing:.16em;text-transform:uppercase;color:var(--on-surface-3);font-weight:600}
.hero__date .hi{font-family:var(--font-indic);font-size:12.5px;letter-spacing:0;text-transform:none;color:var(--primary)}
.hero__h{font-family:var(--font-display);font-size:clamp(26px,3vw,34px);font-weight:400;letter-spacing:-.026em;margin:12px 0 0}
.hero__lede{font-size:14.5px;line-height:1.65;color:var(--on-surface-2);margin:9px 0 0;max-width:66ch;text-wrap:pretty}
.hero__lede b{font-weight:600;color:var(--on-surface)}
```

The Devanagari watermark is `opacity: .03` — at anything above about `.05` it competes with the lede text sitting on top of it.

### Week strip

```css
.wk{display:flex;gap:5px;margin-top:18px}
.wd{flex:1;min-width:0;display:flex;flex-direction:column;align-items:center;gap:3px;padding:7px 4px;border-radius:var(--r-sm);border:1px solid transparent}
.wd.today{background:var(--surface);border-color:var(--primary);box-shadow:var(--shadow-1)}
.wd__hi{font-family:var(--font-indic);font-size:10.5px;color:var(--on-surface-3)}
.wd__n{font-family:var(--font-mono);font-size:15px;font-weight:600}
.wd.today .wd__n{color:var(--primary)}
.wd__dots{display:flex;gap:2px;height:4px}
.wd__dots i{width:4px;height:4px;border-radius:50%;background:var(--primary);opacity:.5}
```

Dots cap at 4 (staging's `Math.min(dots, 4)` — keep it; five dots in a 40px cell is noise). `.wd__dots` keeps its 4px height when empty so the row doesn't jump between days with and without tasks.

Note the two week-start conventions in staging: `WeekStrip.jsx`'s `WEEK_HI` starts Monday and is indexed by position, while `DashboardPage.jsx`'s `DAYS_HI` starts Sunday and is indexed by `getDay()`. Both are correct in place, but they are trivially confusable — put both arrays in `lib/dates.js` with the indexing documented.

### Stat tiles

```css
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(196px,1fr));gap:11px}
.st{--c:var(--on-surface-3);position:relative;overflow:hidden;padding:16px 17px;border-radius:var(--r-md);background:var(--surface);border:1px solid var(--outline-variant)}
.st::before{content:'';position:absolute;inset:0 0 auto;height:2px;background:var(--c)}
.st__l{display:flex;align-items:baseline;gap:7px;font-size:9.5px;letter-spacing:.16em;text-transform:uppercase;color:var(--on-surface-3);font-weight:700}
.st__l .hi{font-family:var(--font-indic);font-size:11px;letter-spacing:0;text-transform:none;color:var(--c)}
.st__v{font-family:var(--font-display);font-size:31px;font-weight:400;letter-spacing:-.03em;line-height:1.1;margin-top:8px}
.st__s{font-size:11.5px;color:var(--on-surface-3);margin-top:3px}
```

Variants become **semantic, not colour-named**. Staging uses `variant="blue|teal|amber|red"`, and assigns `red` to "DONE THIS WEEK" — the one tile that is unambiguously good news. Map:

| Tile | Variant | `--c` |
|---|---|---|
| Open tasks | `neutral` | `--on-surface-3` |
| Due today | `info` → use `--primary` | `--primary` |
| Overdue | `danger` | `--danger` |
| Done this week | `ok` | `--ok` |

### Receivables KPI

```css
.kpi{display:grid;grid-template-columns:minmax(0,1.15fr) minmax(0,1fr);gap:18px;padding:20px 22px;border-radius:var(--r-lg);background:var(--surface);border:1px solid var(--outline-variant);box-shadow:var(--shadow-1)}
.kpi__v{font-family:var(--font-display);font-size:clamp(30px,4vw,44px);font-weight:400;letter-spacing:-.032em;line-height:1;font-variant-numeric:tabular-nums}
.kpi__cards{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;align-content:center}
.kpi__c{padding:11px 12px;border-radius:var(--r-sm);background:var(--s-low)}
.kpi__cv{font-family:var(--font-display);font-size:19px;letter-spacing:-.02em}
```

`tabular-nums` on rupee figures, always — a receivables number that changes width as it updates reads as unstable.

### Task rows

```css
.trow{display:flex;align-items:center;gap:10px;width:100%;padding:11px 18px;border-bottom:1px solid color-mix(in srgb,var(--outline-variant) 60%,transparent);text-align:left;transition:background var(--dur-fast)}
.trow:hover{background:var(--s-low)}
.trow:last-child{border-bottom:0}
.trow__id{font-family:var(--font-mono);font-size:10.5px;color:var(--on-surface-faint);flex-shrink:0}
.trow__t{flex:1;min-width:0;font-size:13.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
```

### Stacked bar + legend

```css
.sbar{display:flex;height:9px;border-radius:var(--r-pill);overflow:hidden;background:var(--s-high)}
.sbar__seg{transition:flex var(--dur-slow) var(--ease-emph-in)}
.slegend{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:7px;margin-top:13px}
.slegend__r{display:flex;align-items:baseline;gap:7px;font-size:12px}
.slegend__d{width:8px;height:8px;border-radius:50%;flex-shrink:0}
.slegend__c{margin-left:auto;font-family:var(--font-mono);font-size:11.5px;color:var(--on-surface-3)}
```

Segment colours come from `ui/statusColors.js` — **not** from `drawer/constants.js`, which is what staging imports here and is the reason the dashboard's "done" segment is a different green from the drawer's (`03-task-drawer.md`).

---

## 2 · Component tree

```
TodayPage                                  pages/TodayPage.jsx
├── Hero
│   ├── DateLine        en · hi · vikram year
│   ├── Lede            counts, honest when zero
│   └── WeekStrip                          editorial/WeekStrip.jsx (keep)
├── OnboardingChecklist real signals, dismissible          rewritten
├── ReceivablesKPI      only when Ganit is active + granted
├── StatRow ×4          semantic variants
├── QuickActions        stroke icons, not emoji
└── TwoCol
    ├── main:  OnYourPlate · WaitingOnOthers · ProjectStatus
    └── side:  UpcomingWeek · TeamPulse · Verse
```

`WaitingOnOthers` is new — it is where the delegated tasks currently polluting "On your plate" belong.

---

## 3 · New files

```
frontend/src/pages/TodayPage.jsx           ← DashboardPage.jsx, renamed to match the nav label
frontend/src/components/today/OnboardingChecklist.jsx
frontend/src/components/today/ReceivablesKPI.jsx
frontend/src/components/today/StatRow.jsx
frontend/src/components/today/QuickActions.jsx
frontend/src/components/today/ProjectStatus.jsx
frontend/src/components/today/TeamPulse.jsx
frontend/src/lib/dates.js                  week arrays, both indexings, documented
frontend/src/lib/vikram.js                 year only, or a real panchāng
frontend/src/styles/today.css
```

The page is 21,289 bytes with five components declared inline. Splitting it is what lets the mobile Today screen (`17-mobile-app.md`) share `StatRow` and `OnboardingChecklist` instead of reimplementing them.

---

## 4 · Endpoints

| Endpoint | Notes |
|---|---|
| `GET /v1/tasks?scope=mine&open=1` | today's plate — **server-side filter**, not `/tasks` then filter 1,000 rows client-side |
| `GET /v1/tasks?due_before=&open=1` | upcoming week |
| `GET /v1/me/stats` | new — `{open, due_today, overdue, completed_week, project_count}` computed server-side against `completed_at` |
| `GET /v1/me/onboarding` | new — the five real booleans |
| `GET /v1/activity/feed?limit=6` | exists |
| `GET /v1/ganit/stats` | exists. **Gate on module-active AND a Ganit grant** — see `RBAC-SPEC.md`. A member with no Ganit access should not see org receivables on their home screen |
| `GET /v1/verse-of-the-day` | exists, optional, has a hardcoded fallback |

Note staging mixes `/tasks` and `/v1/ganit/stats` in the same `Promise.all` — two API generations. Settle on `/v1`.

---

## 5 · What changes in existing files

| File | Bytes | Change |
|---|---|---|
| `pages/DashboardPage.jsx` | 21,289 | Rename `TodayPage`. Extract the five inline components. Fix all six bugs above. Import status colour from `ui/statusColors.js`, not `drawer/constants.js`. Drop `STATUS_HI` — it is the fourth status-label map in the codebase; fold the Hindi into `statusColors.js` |
| `components/OnboardingChecklist.jsx` | 6,220 | There is **already a standalone file** with this name, and `DashboardPage.jsx` declares its own inline `OnboardingChecklist` instead of importing it. Reconcile — one of the two is dead code |
| `editorial/WeekStrip.jsx` | 809 | Keep as-is. Class rename only |
| `editorial/Hero.jsx` | 1,076 | Restyle to `.hero`. Keep the `dateLine` array API — it handles the mixed-script line cleanly |
| `editorial/StatTile.jsx` | 445 | Semantic variants (see table above) |
| `editorial/Citation.jsx` | 341 | Keep |
| `ui/Skeleton.jsx` | 5,370 | The page uses `SkeletonCardGrid` for the stat row and `SkeletonRegion` for the body — two systems. Consolidate to one `<Skeleton preset="today">` |
