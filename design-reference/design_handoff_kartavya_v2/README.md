# Handoff: Kartavya v2 — Editorial UI Rebuild

**Repo:** [github.com/kevalvshah/Kartavya](https://github.com/kevalvshah/Kartavya) · branch `main`
**Owner:** Aekam Inc · **Designer:** Keval Shah
**Date:** May 2026

---

## 1. Overview

This package ports the **editorial-typographic redesign** of Kartavya (an HTML
prototype that lives in `prototype/`) into the live SaaS codebase on `main`.

The prototype is a **design reference, not production code**. The task is to
**recreate it inside the existing `frontend/` React app**, page by page, using
the same routes, the same API endpoints, the same data hooks, and the same
auth flow. The backend (`backend/`) is **not changing**. The mobile app
(`mobile/`) is **not changing**.

### Three parallel deliverables

| # | What | Where it lands |
|---|---|---|
| **A** | Rebuild the **internal app** (admin + member) screens with editorial UI | `frontend/src/pages/*` + a new editorial design system in `frontend/src/styles/` and `frontend/src/components/editorial/` |
| **B** | Reskin the **client portal** AS A FULL COLLABORATOR surface — clients can create task requests; admins/owners approve them | `frontend/src/pages/ClientPagesImpl.jsx`, `ClientProjectsPage.jsx`, `ClientBoardPage.jsx`, plus a new `requested` Kanban column visible to admins on every project board |
| **C** | Build the **5 transactional emails** + **public `/approve` landing page** (magic-link approval) | `backend/email_service.py` templates (out of frontend scope), new `pages/ApprovePage.jsx`, new `/approve` route in `App.js` |

**For B (client portal):** see `CLIENT_PORTAL_NOTES.md` — clients are full
collaborators (can comment, attach files, create tasks). The only constraint
is that tasks they create land in a new `requested` status until an admin or
project owner approves them. Approval can happen in-app (`/approvals` page)
or via email (one-click magic link → `/approve` page).

**For C (emails + approval flow):** see `prototype/emails/README.md` and
open `prototype/emails/Email System.html` to review all six designs.

---

## 2. About the design files

`prototype/` contains an HTML+React-via-Babel prototype with 13 screens, a
task drawer, a new-task modal, and a tweaks panel. It is **not** a CRA
project, it's not bundled, it has no API calls — it runs as static HTML with
mock data inlined in `prototype/src/data.jsx`.

**Do not copy `prototype/` into the live app.** Use it as the spec for:

- Visual layout (spacing, grid, hierarchy)
- Typography choices (Newsreader display, Tiro Devanagari Hindi, Inter UI)
- Color tokens (paper canvas, ink scale, accent gradients)
- Component patterns (hero, page header, stat tile, due chip, status stack,
  task row, kanban card, project card, member card, activity feed, drawer)
- Copy/labels (English + Devanagari pairings)

The live app uses **CRA + craco + Tailwind + Radix-ish UI primitives**. Recreate
each screen in that environment using its existing patterns (`api` from
`lib/api.js`, hooks from `hooks/`, layout from `components/layout/AppShell`,
toast from `components/ui/toast`).

---

## 3. Fidelity

**High-fidelity (hifi).** Final colors, spacing, typography, and motion. Match
the prototype pixel-by-pixel within the constraints of the live data shapes.
Where the prototype shows mock data and the live API returns a different
shape, **the live shape wins** — but the visual treatment must match.

---

## 4. Files in this package

```
design_handoff_kartavya_v2/
├── README.md                       ← this file (full spec)
├── CLAUDE_CODE_PROMPT.md           ← copy/paste prompt to start Claude Code
├── SCREEN_MAP.md                   ← prototype screen → repo page mapping
├── CLIENT_PORTAL_NOTES.md          ← collaborative model + request/approval workflow
├── ATTACHMENTS_AND_STORAGE.md      ← attachment audit, R2 verification, Gita verse API
├── DESIGN_TOKENS.md                ← every CSS variable, with hex values
└── prototype/
    ├── Kartavya App.html           ← prototype entry
    └── src/
        ├── app.jsx                 ← screen router + tweak wiring
        ├── chrome.jsx              ← sidebar + topbar
        ├── data.jsx                ← mock data (ignore at runtime — for shape reference)
        ├── modals.jsx              ← NewTask + Notifications + Help modals
        ├── screens.jsx             ← Today, Tasks, Boards, Projects, Team
        ├── screens-2.jsx           ← Inbox, Approvals, Activity, Automations, Time, Templates, Categories, Admin
        ├── task-drawer.jsx         ← TaskDrawer (right-side panel)
        ├── tweaks-panel.jsx        ← theme/font/density picker (do NOT port — see §9)
        ├── styles.css              ← core design system (~1250 lines)
        ├── styles-2.css            ← screens-2 + reports/templates/admin styles
        └── styles-modals.css       ← NewTask + drawer styles
```

---

## 5. Implementation order (10 commits)

Each step is one PR-able commit. Each step ends with `npm start` working.

| # | Commit | Files touched | Why this order |
|---|---|---|---|
| 1 | `feat(styles): add editorial design tokens` | `frontend/src/styles/editorial.css` (new), `frontend/src/styles/index.css` (import) | Tokens-only commit — nothing visual changes yet. Verify CSS variables compile. |
| 2 | `feat(components): editorial primitives` | `frontend/src/components/editorial/` (new dir: `Hero`, `PageHeader`, `Card`, `StatTile`, `DueChip`, `StatusChip`, `PriorityDot`, `ProjectTag`, `AvatarStack`, `WeekStrip`, `Citation`) | Build the atoms next. No page uses them yet — no regression risk. |
| 3 | `feat(layout): editorial Sidebar + Topbar` | `frontend/src/components/layout/Sidebar.jsx`, `Topbar.jsx`, `AppShell.jsx` | The shell wraps every page — do this in a single commit so the chrome is consistent across all routes immediately. |
| 4 | `feat(dashboard): editorial Today page` | `frontend/src/pages/DashboardPage.jsx` | First page — proves the pattern. Keep the existing `useDashboard`/`useTasks` hooks; only the JSX changes. |
| 5 | `feat(tasks): editorial Tasks + Boards + Projects` | `pages/TasksListPage.jsx`, `ProjectBoardPage.jsx`, `ProjectsPage.jsx`, `components/views/TableView.jsx`, `KanbanView.jsx`, `KanbanCard.jsx` | The three main work surfaces. Same hooks, new JSX. |
| 6 | `feat(team+inbox+activity+approvals): editorial pages` | `pages/TeamsPage.js`, `InboxPage.jsx`, `ActivityFeedPage.jsx`, `ApprovalsPage.jsx` | Mostly list-style screens — reuse `<Card>`, `<AvatarStack>`, `<DueChip>` from step 2. |
| 7 | `feat(reports+templates+automations+categories+admin): editorial settings & reports` | `pages/TimeReportPage.jsx`, `TemplatesPage.jsx`, `AutomationsPage.jsx`, `CategoriesPage.jsx`, `AdminPage.jsx`, `NotificationsSettingsPage.js` | Lower-traffic surfaces. Save for last. |
| 8 | `feat(client-portal): collaborative client surface + request workflow` | `pages/ClientPagesImpl.jsx`, `ClientProjectsPage.jsx`, `ClientBoardPage.jsx`, `pages/ApprovalsPage.jsx` (add task-request tab), `components/views/KanbanView.jsx` (render `requested` column for admins) | **See CLIENT_PORTAL_NOTES.md.** Clients become full collaborators; their new tasks land in `requested` until approved. Coordinate with backend on STATUS enum + `POST /api/tasks` role gate. |
| 9 | `feat(emails): 5 transactional templates` | `backend/email_service.py` (handoff to backend owner — see `prototype/emails/README.md`) | Invite, welcome, approval-request, approved, task-done. Convert the HTML in `prototype/emails/Email System.html` to table-based templates with premailer; register with AWS SES. Out of frontend scope but listed so it isn't forgotten. |
| 10 | `feat(approve): magic-link approval landing page` | New: `pages/ApprovePage.jsx`. Edit: `App.js` (add `/approve` route, public — no `Protected` wrapper). Reference: `prototype/emails/Email System.html` → `ApproveScreen` artboard. | Public route. Validates JWT via `GET /api/approvals/by-token/:token`, renders the editorial approval card, two big buttons. Coordinate with backend on token endpoints. |

**After each commit:** run `npm start`, hit the affected route, screenshot it,
diff against the prototype screen. If anything diverges in layout or color,
fix before moving on.

---

## 6. Design tokens (summary — full list in DESIGN_TOKENS.md)

**Brand accents** (unchanged from `main`'s `tokens.css`):

```css
--k-primary: #05b7aa;   /* teal */
--k-mid:     #03a1b6;
--k-deep:    #0082c6;
--k-grad:    linear-gradient(90deg, #0082c6, #03a1b6, #05b7aa);
--k-gradD:   linear-gradient(135deg, #0082c6, #05b7aa);
```

**Light theme (default) — paper canvas:**

```css
--bg:        #F6F3EC;   /* warm paper */
--bg-soft:   #F0ECDF;
--surface:   #FCFAF5;   /* card */
--surface-2: #FFFFFF;
--ink:       #1A2230;   /* primary text */
--ink-2:     #4A5468;
--ink-3:     #6E7B91;
--ink-faint: #A5B0C2;
--rule:      #E2DCC9;
--rule-soft: #EFE9D8;
--rule-strong: #C8C0AA;
```

**Sidebar (dark, unchanged):**

```css
--side-bg:   #050E1A;
--side-fg:   rgba(255,255,255,.72);
--side-active: rgba(5, 183, 170, .16);
```

**Typography:**

```css
--font-display: "Newsreader", Georgia, serif;          /* display + page H1 */
--font-ui:      Inter, ui-sans-serif, system-ui, sans-serif;
--font-hindi:   "Tiro Devanagari Hindi", "Noto Serif Devanagari", "Newsreader", serif;
--font-mono:    "JetBrains Mono", ui-monospace, "Menlo", monospace;
```

Google Fonts URL (paste into `frontend/public/index.html`):

```
https://fonts.googleapis.com/css2?family=Newsreader:ital,opsz,wght@0,6..72,300;0,6..72,400;0,6..72,500;0,6..72,600;1,6..72,300;1,6..72,400&family=Inter:wght@400;500;600;700&family=Tiro+Devanagari+Hindi:ital@0;1&family=JetBrains+Mono:wght@400;500&display=swap
```

**Spacing scale:** `--sp-1: 4px` through `--sp-8: 56px` (1, 2, 3, 4, 5, 6, 7, 8 = 4, 8, 12, 16, 20, 28, 40, 56).
**Radius scale:** `--r-sm: 8px`, `--r-md: 12px`, `--r-lg: 18px`, `--r-xl: 22px`.
**Density:** `[data-density="compact"]` shrinks spacing + row height to 36px; `[data-density="comfy"]` keeps row height at 48px.
**Theme switch:** `[data-theme="dark"]` flips bg/ink/rule via the same variable names — see `prototype/src/styles.css:72-87`.

Apply density + theme by setting `data-theme` and `data-density` attributes on `<html>` (the existing `CustomizePanel` already does this — keep that integration).

---

## 7. Component primitives to build (commit 2)

Each primitive lives in `frontend/src/components/editorial/<Name>.jsx`. The
prototype implementation is in `prototype/src/screens.jsx` and
`screens-2.jsx`; copy the JSX structure and the class names, swap mock data
for props.

| Component | Props | Prototype reference | Used by |
|---|---|---|---|
| `<Hero>` | `name`, `tithi`, `samvat`, `lede`, `weekDays` | `screens.jsx:65-150` | Dashboard only |
| `<PageHeader>` | `kicker`, `title`, `sanskrit`, `lede`, `right` | `screens.jsx:259-280`, used by every non-dashboard page | Tasks, Boards, Projects, Team, Inbox, Approvals, Activity, Automations, Time, Templates, Categories, Admin, Client Projects, Client Board |
| `<Card>` | `title`, `sanskrit`, `right`, children | `screens.jsx:170-200` | Everywhere |
| `<StatTile>` | `label`, `sanskrit`, `value`, `sub`, `variant` (`blue\|teal\|amber\|red`) | `screens.jsx:90-130` | Dashboard, Time Report, Admin |
| `<DueChip>` | `date`, `variant` (`danger\|warn\|normal\|muted`) | `chrome.jsx` (DueChip component) | Tasks rows, Kanban cards, drawer |
| `<StatusChip>` | `label`, `color` | `chrome.jsx` | Drawer, table view |
| `<PriorityDot>` | `priority` (`urgent\|high\|medium\|low`) | `chrome.jsx` | Tasks rows, Kanban cards |
| `<ProjectTag>` | `project` (`{name, sanskrit, color}`) | `chrome.jsx` | Tasks rows, Kanban cards, drawer |
| `<AvatarStack>` | `users[]`, `max` | `chrome.jsx` | Tasks rows, Kanban cards, drawer, Project cards, Member cards |
| `<WeekStrip>` | `days[]`, `tasksByDay` | `screens.jsx:130-150` | Dashboard hero |
| `<Citation>` | `sanskrit`, `source` | `screens.jsx:240` | Dashboard right column |

Class names map directly from the prototype CSS — keep them prefixed `k-`
so the existing CSS files port cleanly. **Don't rewrite the CSS in Tailwind.**
Copy `prototype/src/styles.css` + `styles-2.css` + `styles-modals.css` into
`frontend/src/styles/editorial.css` (concat into one file) and import it from
`styles/index.css`. Tailwind classes can still be used for one-off layout
tweaks elsewhere, but the editorial primitives are CSS-class-driven.

---

## 8. Screen-by-screen spec

**See `SCREEN_MAP.md`** for the table of every prototype screen → repo page.
Each page in the live app already exists and already fetches its own data —
your job is to **replace its JSX**, not its hooks. Below is the contract for
each screen; read each entry alongside the matching prototype function.

For every screen the layout is the same envelope:

```
<AppShell>
  <Sidebar />                       ← shared, already updated in commit 3
  <main className="k-main">
    <Topbar />                      ← shared, already updated in commit 3
    <div className="k-content">
      <div className="k-screen">    ← max-width: 1400px, gap: 28px, flex-column
        {…page content…}
      </div>
    </div>
  </main>
</AppShell>
```

Inside `k-screen`, the first child is either `<Hero>` (Dashboard only) or
`<PageHeader>` (everything else).

### 8.1 Dashboard (`/dashboard` → `DashboardPage.jsx`)

Prototype: `screens.jsx` → `ScreenToday`

```
<Hero name={user.name} tithi=… samvat=… lede=… weekDays=…/>
<div className="k-stats">              ← 4-column grid of <StatTile>
  <StatTile variant="blue"  label="DUE TODAY"     value={dueToday.length}     sub="…" />
  <StatTile variant="teal"  label="IN PROGRESS"   value={inProgress.length}   sub="…" />
  <StatTile variant="amber" label="AWAITING REVIEW" value={inReview.length}   sub="…" />
  <StatTile variant="red"   label="OVERDUE"       value={overdue.length}      sub="…" />
</div>
<div className="k-twocol">              ← 1.6fr / 1fr grid
  <div className="k-col">
    <Card title="My tasks today" sanskrit="आज के कार्य" right={<filter chips>}>
      <TaskList rows={myTasksToday} onOpen={openDrawer}/>
    </Card>
    <Card title="Project status" sanskrit="परियोजना स्थिति">
      <StatusStackBar segments={byColumn}/>
      <StatusLegend rows={byColumn}/>
      <Meter label="Quarter on track" value={0.62}/>
    </Card>
  </div>
  <div className="k-col">
    <Card title="Upcoming this week" sanskrit="आगामी सप्ताह"><UpcomingList rows={upcoming}/></Card>
    <Card title="Recent activity" sanskrit="हाल की गतिविधि"><ActivityList rows={activity.slice(0,6)}/></Card>
    <Citation sanskrit="कर्तव्ये अधिकारस्ते…" source="Bhagavad Gita 2.47"/>
  </div>
</div>
```

Data: use the existing `GET /api/dashboard/summary` response. If a widget
needs more, fetch it from existing endpoints (`GET /api/tasks?assignee=me`,
`GET /api/activity?limit=6`). **No new backend endpoints.**

### 8.2 Tasks list (`/tasks` → `TasksListPage.jsx`)

Prototype: `screens.jsx` → `ScreenTasks`

```
<PageHeader kicker="WORK" title="Tasks" sanskrit="कार्य सूची"
            lede="Everything assigned to me or my teams." />
<FilterBar>                  ← segmented control: Mine / All / Done
  <SegControl options=[…]/>
  <Field label="Group by"  options=[priority, project, due, assignee]/>
  <Field label="Sort"      options=[due, updated, priority]/>
</FilterBar>
<TableWrap>
  <TableHead cols=[TASK, PROJECT, ASSIGNEE, PRIORITY, DUE]/>
  {groups.map(g => (
    <Group title={g.title} sanskrit={g.sanskrit} count={g.tasks.length} color={g.color}>
      {g.tasks.map(t => <TaskRow t={t} onClick={openDrawer}/>)}
    </Group>
  ))}
</TableWrap>
```

Hook in `useTasks()` from `hooks/useTasks.js`. Grouping is client-side. Row
columns: id (mono), title, project tag, avatar stack, priority chip, due chip.
Click anywhere on the row → opens `<TaskDrawer>` (see 8.13).

### 8.3 Boards / Kanban (`/projects/:projectId` → `ProjectBoardPage.jsx`)

Prototype: `screens.jsx` → `ScreenBoards`

```
<PageHeader … right={
  <div className="k-headerright">
    <ViewSwitch active="board" options=[board,table,calendar,timeline]/>
    <ProjectPicker projects={projects} active={projectId}/>
  </div>
}/>
<div className="k-board">
  {columns.map(col => (
    <BCol title={col.title} sanskrit={col.devanagari} count={col.tasks.length} color={col.color}>
      {col.tasks.map(t => <BCard t={t} onClick={openDrawer}/>)}
    </BCol>
  ))}
</div>
```

Use existing `<KanbanView>` and `<KanbanCard>` — replace their JSX, keep
the DnD wiring untouched. Card structure: top row `id · priority`, title (1-3
lines, ellipsis), foot row `<AvatarStack> · meta (comments, attachments, due chip)`.

### 8.4 Projects (`/projects` → `ProjectsPage.jsx`)

Prototype: `screens.jsx` → `ScreenProjects`

```
<PageHeader kicker="WORK" title="Projects" sanskrit="परियोजनाएँ"
            lede="Every active engagement, internal and client."/>
<div className="k-pgrid">              ← auto-fill, minmax(280px, 1fr)
  {projects.map(p => (
    <PCard onClick={() => navigate(`/projects/${p.id}`)}>
      <Head bar={p.color} sanskrit={p.sanskrit} name={p.name} client={p.client.toUpperCase()}/>
      <Body>
        <Stat n={p.tasks} label="TASKS"/>
        <Stat n={`${Math.round(p.progress*100)}%`} label="DONE"/>
        <Stat n={daysUntil(p.due)} label="DAYS"/>
      </Body>
      <ProgressBar value={p.progress} color={p.color}/>
    </PCard>
  ))}
</div>
```

### 8.5 Team (`/teams` → `TeamsPage.js`)

Prototype: `screens.jsx` → `ScreenTeam`

```
<PageHeader kicker="PEOPLE" title="Team" sanskrit="दल"
            lede="Members, roles, current load."/>
<div className="k-teamgrid">
  {members.map(m => (
    <MCard>
      <Head avatar={m} name={m.name} role={m.role} tz={m.tz}/>
      <Stats open={m.openTaskCount} done={m.doneThisWeek} avg={m.avgCycleDays}/>
      <Work>
        {m.openTasks.slice(0,3).map(t => (
          <Row dot={priorityColor(t.priority)} title={t.title} id={t.id}/>
        ))}
      </Work>
    </MCard>
  ))}
</div>
```

Existing `TeamsPage.js` has the data fetch — just replace its render.

### 8.6 Inbox (`/inbox` → `InboxPage.jsx`)

Prototype: `app.jsx` → `ScreenInbox`

```
<PageHeader kicker="ATTENTION" title="Inbox" sanskrit="सूचना"
            lede="Mentions, assignments, approvals — read once, act now."/>
<div className="k-inbox">
  {notifications.map(n => (
    <InboxRow>
      <Avatar user={n.from}/>
      <div>
        <Head><Kind kind={n.kind}/> <b>{n.from.name}</b> <span>{n.summary}</span> <time>{n.when}</time></Head>
        <Snip>{n.preview}</Snip>
      </div>
      <Actions><Button onClick={…}>Open</Button></Actions>
    </InboxRow>
  ))}
</div>
```

Kind chips: `mention` (teal), `assign` (green), `approval` (amber). Map from
the existing `notifications` shape.

### 8.7 Approvals (`/approvals` → `ApprovalsPage.jsx`)

Prototype: `screens-2.jsx` → `ScreenApprovals`

```
<PageHeader kicker="REVIEW" title="Approvals" sanskrit="अनुमोदन"
            lede="Items waiting on you. Review, approve, or send back."/>
<StatRow>
  <StatTile variant="amber" label="PENDING"   value={pending.length}   sub="awaiting your call"/>
  <StatTile variant="teal"  label="APPROVED"  value={approvedToday.length} sub="today"/>
  <StatTile variant="red"   label="REJECTED"  value={rejectedToday.length} sub="today"/>
</StatRow>
<Card title="Pending approval" sanskrit="लंबित">
  {pending.map(a => (
    <ApprovalRow>
      <ProjectTag …/> <Title>{a.title}</Title> <Requester user={a.requestedBy}/>
      <DueChip date={a.due} variant="warn"/>
      <Actions><Approve/><Reject/><OpenInDrawer/></Actions>
    </ApprovalRow>
  ))}
</Card>
```

Keep `useApprovals()` and the existing `POST /api/approvals/:id/approve|reject`
calls.

### 8.8 Activity feed (`/activity` → `ActivityFeedPage.jsx`)

Prototype: `screens-2.jsx` → `ScreenActivity`

```
<PageHeader … />
<FilterBar>
  <SegControl options=[all, mentions, assignments, status, comments]/>
  <Field label="Member" options=[all, …team]/>
  <Field label="Project" options=[all, …projects]/>
</FilterBar>
<div className="k-activity k-activity--full">
  {activity.map(a => (
    <ActivityRow>
      <Avatar user={a.actor}/>
      <div>
        <Line><b>{a.actor.name}</b> {a.verb} <a>{a.subjectTitle}</a> {a.detail}</Line>
        <When>{relativeTime(a.at)}</When>
      </div>
    </ActivityRow>
  ))}
</div>
```

### 8.9 Automations (`/automations` → `AutomationsPage.jsx`)

Prototype: `screens-2.jsx` → `ScreenAutomations`

```
<PageHeader … right={<Button primary onClick={openNew}>+ New automation</Button>}/>
<Card title="Active rules" sanskrit="नियम">
  <RuleList rules={rules}/>           ← each row: enabled toggle · trigger phrase · "then" actions · run count · last run · edit/delete
</Card>
<Card title="Recent runs" sanskrit="पिछले परिणाम"><RunsTable rows={runs}/></Card>
```

Reuse the existing automation editor modal — just restyle its chrome.

### 8.10 Time Report (`/time` → `TimeReportPage.jsx`)

Prototype: `screens-2.jsx` → `ScreenTimeReport`

```
<PageHeader … right={<DateRangePicker from to/>}/>
<StatRow>                          ← 4 stat tiles: TOTAL HOURS, BILLABLE, NON-BILLABLE, UTILIZATION
<div className="k-twocol">
  <Card title="Hours by day"     sanskrit="दैनिक"><BarChart bars=…/></Card>
  <Card title="Top projects"     sanskrit="शीर्ष परियोजनाएँ"><PBarList rows=…/></Card>
</div>
<Card title="Member load"        sanskrit="सदस्य भार"><LoadList rows=…/></Card>
```

Existing chart uses Recharts — keep it. Just wrap in editorial `<Card>` and
restyle the bar colors to use `--k-grad`.

### 8.11 Templates (`/templates` → `TemplatesPage.jsx`)

Prototype: `screens-2.jsx` → `ScreenTemplates`

```
<PageHeader … right={<Button primary>+ Save current as template</Button>}/>
<Tabs>
  <Tab key="project">Project templates</Tab>
  <Tab key="task">Task templates</Tab>
  <Tab key="workflow">Workflow templates</Tab>
</Tabs>
<div className="k-pgrid">{templates[tab].map(t => <TemplateCard …/>)}</div>
```

### 8.12 Categories (`/settings/categories` → `CategoriesPage.jsx`)

Prototype: `screens-2.jsx` → `ScreenCategories`

```
<PageHeader … />
<div className="k-twocol">
  <Card title="Existing categories" sanskrit="श्रेणियाँ"><CategoryList rows=…/></Card>
  <Card title="New category"        sanskrit="नई श्रेणी"><Form/></Card>
</div>
```

### 8.13 Admin (`/admin` → `AdminPage.jsx`)

Prototype: `screens-2.jsx` → `ScreenAdmin`

Tabs: **Workspace · Members · Invites · Billing · Audit log · Danger zone.**
Each tab is a `<Card>` with the editorial styling. Existing `AdminPage.jsx`
already has all the data — just replace the chrome.

### 8.14 Task drawer (right panel, opens on row click — every screen)

Prototype: `task-drawer.jsx` → `TaskDrawer`

```
<Scrim onClick={close}/>
<Drawer>
  <Head><Crumb project={p}/> <Actions><Star/><More/><Close/></Actions></Head>
  <Title><ID>{t.id}</ID><H2>{t.title}</H2></Title>
  <Props>                  ← 2-column grid: Status, Priority, Assignees, Due, Project, Estimate, Reporter, Updated
  <Tabs>Details · Comments(N) · Files(N) · Activity(N)</Tabs>
  <Body>{tabContent}</Body>
</Drawer>
```

Replace `TaskDrawer.jsx` body with the editorial markup. Keep the existing
mutation hooks (`useUpdateTask`, comments, files).

### 8.15 New Task modal

Prototype: `modals.jsx` → `NewTaskModal`

Existing `NewTaskModal.jsx` — replace its chrome (header, fields, button row)
to match the prototype styling. Keep the form schema + submit handler exactly.

---

## 9. What to **not** port

- **Tweaks panel** (`prototype/src/tweaks-panel.jsx`). The live app has
  `CustomizePanel.jsx` — keep that. Theme/density/accent persist to
  `localStorage` and apply via `data-*` attributes on `<html>`. Wire its
  controls to the new design tokens (theme: light/dark, accent: teal/blue/saffron/indigo, density: comfy/compact, font: newsreader/spectral/inter/geist).
- **Mock data** in `prototype/src/data.jsx`. The live app fetches everything.
- **The `app.jsx` screen-switch** in the prototype. The live app uses React
  Router — the screens already exist as separate pages.

---

## 10. Client portal (commit 8)

**Read `CLIENT_PORTAL_NOTES.md` before starting commit 8.** Short version:

- `ClientProjectsPage.jsx` re-uses the `<Projects>` page layout from §8.4,
  but reads from `GET /api/client/projects` (not `/api/teams`).
- `ClientBoardPage.jsx` re-uses the `<Boards>` page layout from §8.3,
  but uses the read-only Kanban variant from `ClientPagesImpl.jsx`.
- **No new endpoints, no permission changes, no role checks moved.** The
  same `Protected` wrapper, the same `useAuth()` role gate, the same
  client-restricted prop set as on `main` today.

---

## 11. Assets

- **Fonts** — all from Google Fonts, free. URL in §6.
- **Icons** — keep using `lucide-react` (already in `package.json`). The
  prototype uses inline SVG icons defined in `chrome.jsx` — substitute
  Lucide equivalents (`Bell`, `Search`, `Plus`, `MoreHorizontal`, etc.).
- **Wordmark** — keep `KWordmark` component as-is. The editorial sidebar
  renders it inside `.k-wordmark__main` with the Newsreader font.
- **No new image assets needed.**

---

## 12. Acceptance criteria

For each commit:

1. `npm run build` succeeds with no new warnings.
2. `npm start` → the route opens → screenshot matches the prototype within
   ±4px on all major dimensions.
3. All existing E2E tests in `tests/` pass without modification (they test
   behavior, not visuals).
4. Lighthouse accessibility score ≥ 92 on Dashboard and Tasks pages
   (contrast on the paper canvas is the main risk — `--ink-3` on `--bg`
   must remain ≥ 4.5:1).
5. Mobile breakpoints (`max-width: 720px`) render the screen without
   horizontal scroll. Kanban becomes a horizontal scroll strip below
   1280px (already in `prototype/src/styles.css:744-755`).

---

## 13. Files in repo that change

Confirmed during exploration of `main`:

```
frontend/src/
├── App.js                                  ← no change (route tree is correct)
├── styles/
│   ├── editorial.css                       NEW    (commit 1)
│   ├── kartavya-design.css                 EXISTS (keep for now, phase out gradually)
│   └── index.css                           EDIT   (add editorial import)
├── components/
│   ├── editorial/                          NEW    (commit 2)
│   │   ├── Hero.jsx
│   │   ├── PageHeader.jsx
│   │   ├── Card.jsx
│   │   ├── StatTile.jsx
│   │   ├── DueChip.jsx
│   │   ├── StatusChip.jsx
│   │   ├── PriorityDot.jsx
│   │   ├── ProjectTag.jsx
│   │   ├── AvatarStack.jsx
│   │   ├── WeekStrip.jsx
│   │   ├── Citation.jsx
│   │   └── index.js                        ← barrel export
│   ├── layout/
│   │   ├── Sidebar.jsx                     EDIT  (commit 3)
│   │   ├── Topbar.jsx                      EDIT  (commit 3)
│   │   └── AppShell.jsx                    EDIT  (commit 3, mostly className changes)
│   ├── views/
│   │   ├── TableView.jsx                   EDIT  (commit 5)
│   │   ├── KanbanView.jsx                  EDIT  (commit 5)
│   │   └── KanbanCard.jsx                  EDIT  (commit 5)
│   ├── TaskDrawer.jsx                      EDIT  (commit 5 — used by Tasks/Boards/Dashboard)
│   ├── NewTaskModal.jsx                    EDIT  (commit 5)
│   └── CustomizePanel.jsx                  EDIT  (commit 1 — re-wire to new tokens)
├── pages/
│   ├── DashboardPage.jsx                   EDIT  (commit 4)
│   ├── TasksListPage.jsx                   EDIT  (commit 5)
│   ├── ProjectBoardPage.jsx                EDIT  (commit 5)
│   ├── ProjectsPage.jsx                    EDIT  (commit 5)
│   ├── TeamsPage.js                        EDIT  (commit 6)
│   ├── InboxPage.jsx                       EDIT  (commit 6)
│   ├── ActivityFeedPage.jsx                EDIT  (commit 6)
│   ├── ApprovalsPage.jsx                   EDIT  (commit 6)
│   ├── TimeReportPage.jsx                  EDIT  (commit 7)
│   ├── TemplatesPage.jsx                   EDIT  (commit 7)
│   ├── AutomationsPage.jsx                 EDIT  (commit 7)
│   ├── CategoriesPage.jsx                  EDIT  (commit 7)
│   ├── AdminPage.jsx                       EDIT  (commit 7)
│   ├── NotificationsSettingsPage.js        EDIT  (commit 7)
│   ├── ClientPagesImpl.jsx                 EDIT  (commit 8 — see CLIENT_PORTAL_NOTES.md)
│   ├── ClientProjectsPage.jsx              EDIT  (commit 8)
│   └── ClientBoardPage.jsx                 EDIT  (commit 8)
└── public/index.html                       EDIT  (commit 1 — add Google Fonts preconnect + URL)
```

**Backend: zero changes.**
**Mobile: zero changes.**
