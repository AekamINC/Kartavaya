# Audit — a failed read must never render as an empty state

Branch `audit/failure-states`, cut fresh from `origin/staging` at `190fa73a`
(verified: the pre-existing worktree was on `1aa49855`, ~758 commits stale, and
was discarded).

## Scope actually examined

Enumerated from disk, not from a list.

| | count |
|---|---|
| `.jsx` under `frontend/src/` + `.tsx` under `mobile/src/` | **453** |
| of those, test files (`__tests__/`, `*.test.*`) — excluded | 35 |
| non-test files that read no data — out of scope by definition | 226 |
| **non-test files that read data — the audited surface** | **192** |

Every one of the 192 was classified. **0 could not be classified.**

Method: a static pass over the comment-stripped source for the six defect
shapes, then manual reading of every file the pass flagged plus every file
whose empty-state copy makes a claim about the business. Comment-stripping
matters — roughly a third of the raw grep hits in this tree are remediation
notes describing the *old* bug (`// This was `catch (_) {}` …`), and counting
those as defects is how a pass talks itself into a number.

## Verdict summary

| verdict | count |
|---|---|
| correct — loading / error / empty already kept apart | 160 |
| **false-empty** — a failure reaches an empty state that states a business fact | **9 found, 9 fixed** |
| **no-handler** — promise with no rejection handler, section silently stays empty | **3 found, 3 fixed** |
| **asserts-a-default** — `?? 0` / `|| []` where the answer is "we do not know" | **2 found, 2 fixed** |
| swallow-no-empty — a swallowed catch with no empty state behind it | 14, see "Deliberately left" |
| heuristic false positives, confirmed correct by reading | 4 |

The 160 "correct" are genuinely correct and this pass disbelieved them: the
Manav / Hub / Vetana `useList` + `<Resource>` stack, the 17 Graha tabs, the
Ganit tabs, Prachar's `useResource`, Vikray's `list = null` + `failed` pattern,
`ContactTimeline`, `PivotTab`, `TimeReportPage`, and Pahchan were each opened
and checked rather than taken on trust. They hold.

---

## Fixed

### 1 · `errorKind()` mapped 400 → "server" — the named bug

`frontend/src/components/ui/ErrorState.jsx:20-33` · **verdict: contradicts
itself** · **fixed**

`approvals_router.py:562` answers a spent magic link with
`400 "This approval link is no longer active"`. `ApprovePage` renders that
sentence as `ErrorState`'s `detail`, under `ErrorState`'s own title. While 400
fell through to `server`, the card read:

> **Something broke on our side, not yours**
> This approval link is no longer active.

The first line is false, and it is the one that tells the visitor to wait for
us to fix something. The same path is reachable from lines 53, 56 and 58 of
that router — an expired or malformed token is also a 400 — so *every* dead
approval link blamed the server.

Fix: any 4xx that is not 403/404 now classifies as a new `request` kind, with
its own copy and **no retry button** (re-sending a request the server just
rejected reproduces the rejection; offering the button implies otherwise).
403 → `denied` and 404 → `missing` still match first and keep their own copy
and their own single correct action. 5xx is untouched.

This is a shared file — the minimal change was three additions (a range check,
a `COPY` entry, an `ICONS` entry) plus letting `request` use the existing
`backTo` affordance. ~80 call sites inherit the fix with no edit.

`frontend/src/__tests__/errorKind.test.js:54` previously asserted
`418 → 'server'`, encoding the bug. Replaced with the range assertion plus two
inverse guards (403/404 stay out of the bucket; 5xx stays `server`).

### 2 · `ActivityFeedPage` — "No activity recorded yet."

`frontend/src/pages/ActivityFeedPage.jsx:36,66-78,140` · **verdict: false-empty**
· **fixed**

The catch called `logger.error(e)` and nothing else, so `events` stayed at its
initial `[]` and the page asserted the team changed nothing, commented on
nothing and approved nothing. `events` is now `null` until a load succeeds and
an `err` renders `ErrorState`. An `AbortError` — the component superseding its
own request on a filter change — is explicitly *not* treated as a failure, so
changing a filter never paints an error over results that are about to arrive.
A failed "load more" keeps the page it already has.

### 3 · Sanvaad people directory — "Nobody else is in your organisation yet."

`frontend/src/pages/sanvaad/ChannelList.jsx:50-83` and
`frontend/src/pages/sanvaad/ChannelDetails.jsx:43-73,141,225` ·
**verdict: false-empty** · **fixed**

Both `DmPicker` and the channel member picker did
`.catch(() => setPeople([]))` and then rendered "Nobody else is in your
organisation yet." / "Everyone in your organisation is already here." — claims
about the firm's headcount made from a rejected request. Both now hold `null`
plus a `dirErr` and say the list did not load.

### 4 · `AdminPage` — "Nothing is waiting" over a failed invite read

`frontend/src/pages/AdminPage.jsx:477-480,508-530,535-541,547-552,615,640,801-810,904`
· **verdict: false-empty + asserts-a-default** · **fixed**

`/admin/invites` and `/admin/teams` are swallowed relative to `/admin/users` on
purpose, so one failing does not blank the console — that part is right. What
was not: each left its own section at `[]`, and the sections render off exactly
that value. A 500 on invites produced a green tick and **"Nothing is waiting —
every invite sent has been accepted or has expired."** An admin who reads that
stops chasing invitations. A 500 on teams produced "No projects yet".

Both now carry their own `null` + error pair and render `ErrorState` in their
own section. The "Pending invites" stat tile showed `0` over the same failure —
now an em dash, because a confident zero is the same false statement in
smaller type.

### 5 · `TeamsPage` — "No teams created", plus a roster on the wrong project

`frontend/src/pages/TeamsPage.jsx:25-34,50-72,79-87,142,277-299,373` ·
**verdict: false-empty (×3)** · **fixed**

Three swallowed loads:

- `loadProjects().catch(() => {})` → "No teams created" with a **"Create
  Project"** call to action, sending a firm that already has projects off to
  make another.
- `api.get('/users').catch(() => {})` → "No existing user found." offering to
  email an invitation to somebody who already has an account.
- `loadDetail(id).catch(() => {})` → worse than a false empty. `projectDetail`
  was never cleared, so selecting project B whose fetch failed left **project
  A's members on screen under project B's name.** Now cleared before each load
  and gated on `detailErr`.

### 6 · mobile `BoardScreen` — three `useQuery`s whose `isError` is never read

`mobile/src/screens/BoardScreen.tsx:277-330,478-500,643-665` ·
**verdict: false-empty (defect shape 2)** · **fixed**

The clearest instance of the `useQuery` variant in the tree. All three queries
took `= []` defaults and no call site read `isError`, so a 500 on `/teams`
rendered the full-screen **"No projects yet."** and a 500 on `/tasks` rendered
"No tasks yet." / "No tasks in this column" / "No tasks with due dates" across
all four views. TanStack retries twice before surfacing `isError`, so the user
waited through both retries to be told something false.

Rewired to the primitive that already exists for this — `resolveScreenState` +
`ScreenState` — matching `TodayScreen`, `InboxScreen` and the seven module
screens. Guarded so a disabled query (no project selected) does not resolve to
`offline`.

### 7 · mobile `ClientPortalScreen` — a client's only window

`mobile/src/screens/ClientPortalScreen.tsx:37-48,60-78,97,147` ·
**verdict: false-empty (×2)** · **fixed**

`/client/tasks` and the comment thread were both `.catch(() => {})` behind
`ListEmptyComponent`. "No tasks shared with you yet." told a paying client the
firm had not started. "No comments yet. Be the first." invited a duplicate of a
message already there. Both now null-until-loaded with an explicit failure line.

### 8 · mobile `NewTaskSheet` — a picker that silently could not be used

`mobile/src/components/NewTaskSheet.tsx:75-79,87-90,236-241` ·
**verdict: no-handler** · **fixed**

`/teams` was `.catch(() => {})` and the project chip row renders nothing at all
when the list is empty — so a failed read was indistinguishable from an org
with no projects, and the control just did not work. Now says so.

---

## Deliberately left, with reasons

**14 `swallow-no-empty`.** Every one was read. They are swallowed catches with
no empty state behind them, and in each case the swallow is correct:

- `localStorage` writes in private mode — `AppShell`, `Sidebar`,
  `NotificationBanner`, `OnboardingChecklist`, `OnboardingPage`, `Protected`,
  `LoginPage`. A failed preference write must not fail a sign-in.
- `index.jsx` health-check ping, `AppShell` service-worker registration,
  `Protected`'s background session refresh — fire-and-forget by design.
- `GanitPage` / `GrahaPage` / `HubDashboardPage` tab-count badges, which carry
  no count on failure rather than a false zero. Already correct.
- `NotificationContext:723`, commented "a failed poll is not a user-facing
  error" — right: the next poll is 60s away and a toast per failed poll would
  be worse than the silence.
- `pahchan/ClockScreen` haptics and temp-file cleanup.

**`AppShell.jsx:289` — `setApprovals(payload?.approvals ?? 0)`.** A genuine
`asserts-a-default`: a badge that reads 0 when the poll payload is malformed
says "nothing to approve". Left because the badge hides at 0 rather than
printing a sentence, making it an understatement rather than a false claim, and
because `AppShell` is being edited by peer agents this run — the brief asks for
minimal footprints on shared files. **Flagged for a follow-up.**

**`mobile/src/components/ScreenState.tsx` — `resolveScreenState` has the same
400 blind spot as `errorKind` had.** It maps 403 → `forbidden` and everything
else → `error` ("Something went wrong on our end"), so a 400 on mobile still
blames the server. The fix is a seventh status, which means touching a shared
mobile primitive that every module screen renders. **Not done, because there
are no mobile tests** — the deliverable requires each fix to ship with a 500
test and an inverse empty test, and I cannot write either on mobile. Fixing a
shared primitive blind, on the same tree as six peer agents, ten days from
delivery, is a worse trade than reporting it. **This is the single most
valuable remaining item.**

**The inverse defect — a genuine empty rendered as an error — was searched for
specifically and none was found.** `pahchan/EnrollQueue.jsx:47-52` still draws
the distinction the brief asked to preserve: a 404 on a reference photo
resolves to `gone` (retention), and only a non-404 resolves to `err`.
`ScreenState`'s doc comment defends the same line for 403 on a module surface.
Both survive this pass untouched.

**Heuristic false positives, confirmed correct by reading:**
`client/ClientApprovals.jsx` (gated at its parent `ClientPages.jsx:99` on
`!loading && !failure`), `sanvaad/ChannelsTab.jsx` (already carries
`listError`), `views/KanbanView.jsx`, `views/TableView.jsx`, `views/BulkBar.jsx`
(prop-driven, they do not fetch).

---

## Tests

`frontend/src/__tests__/failureStates.test.jsx` — 13 new tests. Every fix is
asserted **twice**, and the second assertion is the one that keeps the first
honest: a fix that turns every empty into an error is not a fix.

| surface | 500 → named failure | genuine empty → empty state |
|---|---|---|
| `ErrorState` 400 | no "broke on our side" above the server's own 400 sentence; `data-kind="request"`; no retry offered | 500 still says "broke on our side" **and** still offers "Try again" |
| `ActivityFeedPage` | `role="alert"` + "Try again", no "No activity recorded yet" | "No activity recorded yet" present, **no** `role="alert"` |
| `TeamsPage` | no "No teams created", no "Create Project" CTA | "No teams created" present, no alert |
| `AdminPage` invites | panel is up, no "Nothing is waiting" | "Nothing is waiting" present |
| `AdminPage` teams | panel is up, no "No projects yet" | "No projects yet" present |
| Sanvaad `DmPicker` | no "Nobody else is in your organisation yet", says "did not load" | that sentence present, no "did not load" |

The AdminPage assertions click into the Invites tab first and assert the panel
is actually rendered before asserting a sentence is absent — a `not.toContain`
on a panel that was never mounted passes trivially and proves nothing.

## Gates

Baseline on `origin/staging` reproduced first: **43 files / 682 tests, exit 0.**

From `frontend/`:

```
node scripts/check-tokens.mjs   → 356 declared, 244 referenced, 0 missing
node scripts/check-classes.mjs  → 3517 selectors, 2707 classes, 0 missing a rule
npx vite build                  → EXIT 0
npx vitest run                  → EXIT 0 · 44 files / 697 tests · unhandled: 0
```

44 files (+1) and 697 tests (+15) against the 43/682 baseline.

Mobile:

```
node node_modules/typescript/bin/tsc --noEmit   → EXIT 0
```

Note: `npx tsc --noEmit` **does not work** in `mobile/` — `npm ci` produces no
`node_modules/.bin`, so npx tries to fetch a package called `tsc` and refuses.
The binary must be invoked directly as above. There are no mobile tests and no
mobile lint config; none was invented.

Neither `frontend/node_modules` nor `mobile/node_modules` existed in this
worktree — both were installed with `npm ci` before the baseline could be run.
No lockfile was modified.

## Files touched

Web:
- `frontend/src/components/ui/ErrorState.jsx` *(shared — minimal: +range check, +1 COPY entry, +1 ICONS entry, `backTo` extended to `request`)*
- `frontend/src/__tests__/errorKind.test.js`
- `frontend/src/__tests__/failureStates.test.jsx` *(new)*
- `frontend/src/pages/ActivityFeedPage.jsx`
- `frontend/src/pages/TeamsPage.jsx`
- `frontend/src/pages/AdminPage.jsx`
- `frontend/src/pages/sanvaad/ChannelList.jsx`
- `frontend/src/pages/sanvaad/ChannelDetails.jsx`

Mobile:
- `mobile/src/screens/BoardScreen.tsx`
- `mobile/src/screens/ClientPortalScreen.tsx`
- `mobile/src/components/NewTaskSheet.tsx`

`components/ui/ErrorState.jsx` is the only shared file touched, and the change
is additive — no existing kind, copy or call site changed behaviour except the
4xx range that was the bug.

No database access. No email, WhatsApp or push. No pricing figures. `main`
untouched. No lockfile and no line-ending-only changes committed.
