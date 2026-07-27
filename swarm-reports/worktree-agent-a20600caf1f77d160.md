# Mobile app — STRUCTURE lens, against the RENDERED reference

Branch: `worktree-agent-a20600caf1f77d160`. Surface: `mobile/` (Expo 51 + RN + TypeScript).
Reference: `design-reference/Kartavaya Redesign/Mobile App.html` — **rendered and driven**,
not read. Spec: `design-handover/17-mobile-app.md`, `07-pahchan.md §9`.

> **Worktree note.** This worktree was cut from `main`, not `staging` — `_COORDINATION.md` §1
> exactly. It sat 13 ahead / 507 behind. All 13 commits are reachable from `main` and
> `origin/main` (verified with `git branch -a --contains`), so nothing was lost by
> `git reset --hard staging`. `main` was not touched.

---

## 0. How the reference was actually rendered

The browser pane and the Playwright tab are both shared across ~20 agents in this run;
tabs were reassigned out from under me twice mid-read. Rendering the reference reliably
needed an instance nobody else could touch:

1. `frontend/public/__ref/` ← copy of `design-reference/Kartavaya Redesign/*.{html,jsx,css,png}` (gitignored).
2. `python -m http.server 5291` from `frontend/public` — my own port, read-only, no Vite.
3. React/ReactDOM/Babel **vendored locally** into `__ref/`. Headless Chrome would not
   wait for the unpkg CDN, and `--virtual-time-budget` did not help.
4. `__ref/__enum.html` — a driver page I wrote that imports the same JSX bundle and
   renders **every reference screen at once** via the components the harness exports on
   `window` (`MToday`, `MTasks`, `MMessages`, `MChat`, `MPahchan`, `MApprovals`, `MMore`,
   `MTaskDetail`, `MBoardDetail`, `MInbox`, `MSettings`, `MTime`, `MReminders`, `MModule`,
   `MState`). This sidesteps click-driving a contended browser entirely.
5. Headless Chrome + a ~90-line CDP driver over Node 24's global `WebSocket`
   (`--remote-debugging-port=9333`), which waits for `[data-case]` to appear and then
   dumps each `.mscreen`'s `innerText`.

`--dump-dom` alone is not enough — it snapshots before in-browser Babel finishes. Anyone
repeating this should use CDP with a wait condition, not `--dump-dom`.

**All 25 reference cases rendered.** Everything below is read off that output.

---

## 1. Screen inventory — reference vs build

25 rendered cases → 19 distinct reference screens. The build has 24 screen files.

| # | Reference screen | Reference route | Build file | Verdict |
|---|---|---|---|---|
| 1 | Today | tab | `screens/TodayScreen.tsx` | present |
| 2 | Tasks | tab | `screens/TasksScreen.tsx` | present, **missing the My tasks \| Boards segment** (§3.3) |
| 3 | Messages | tab | `screens/MessagesScreen.tsx` | present |
| 4 | Chat | push | `screens/ChatScreen.tsx` | present |
| 5 | More | tab | `screens/MoreScreen.tsx` | present, **restructured** (§3.4) |
| 6 | Task detail | modal | `screens/TaskDetailScreen.tsx` | present |
| 7 | Board detail | push | `screens/BoardScreen.tsx` | present |
| 8 | Approvals | push | `screens/ApprovalsScreen.tsx` | present |
| 9 | Inbox | push | `screens/InboxScreen.tsx` | present |
| 10 | Settings | push | `screens/SettingsScreen.tsx` | present |
| 11 | Time | push | `screens/TimeScreen.tsx` | present |
| 12 | Reminders | push | `screens/RemindersScreen.tsx` | present |
| 13 | Pahchan · **Clock** tab | push | `screens/pahchan/ClockScreen.tsx` | present |
| 14 | Pahchan · **My attendance** tab | segment on 13 | — | **ABSENT** (§2) |
| 15 | Module · CRM (ग्रह / Graha) | push | `screens/modules/GrahaScreen.tsx` | present |
| 16 | Module · Finance (गणित / Ganit) | push | `screens/modules/GanitScreen.tsx` | present |
| 17 | Module · HRMS (मानव / Manav) | push | `screens/modules/ManavScreen.tsx` | present |
| 18 | Module · Payslips (वेतन / Vetana) | push | `screens/modules/VetanaScreen.tsx` | present |
| 19 | Module · Reports (दृष्टि / Dristi) | push | `screens/modules/DristiScreen.tsx` | present |
| 20 | Module · Assistant (सृजन / Srijan) | push | `screens/modules/SrijanScreen.tsx` | present |
| 21 | Module · **eSign (हस्ताक्षर / Hastakshar)** | push | — | **ABSENT** (§3.1) |
| — | *(no reference equivalent)* | — | `screens/modules/PracharScreen.tsx` | **extra** (§3.1) |
| — | *(no reference equivalent)* | — | `screens/BoardsScreen.tsx` | **orphaned** (§3.3) |
| — | *(not a screen in the reference)* | — | `screens/MeScreen.tsx` | present, **missing the register** (§2) |

Build-only screens with no reference case, all legitimate: `LoginScreen`,
`ClientPortalScreen`, `pahchan/EnrollScreen` (the reference harness has no auth,
client-portal or enrolment case at all).

### Tab bar — confirmed correct, and the `MOB_NAV` note is a red herring

My brief flagged `Chrome.jsx:301` `MOB_NAV` (`Home · Tasks · CRM · Chat · Money`) against
the build's five tabs. **These are two different navs and the build is right.**
`MOB_NAV` drives `MobileNav`, which is the **web app at narrow width**. The native app
harness uses `MTABS` in `Mobile.jsx:9`:

| MTABS (reference) | Build `MainTabParamList` |
|---|---|
| `today` · Today · आज | `Today` |
| `tasks` · Tasks · कर्तव्य | `Tasks` |
| `add` · ＋ (centre pill) | `Create` (stub; `BottomBar` intercepts) |
| `msgs` · Messages · संवाद · **badge 7** | `Messages` — **no badge** |
| `more` · More · अधिक | `More` — carries `unread` |

Exact match on identity and order. One delta: the reference badges **Messages**; the
build badges **More**. Defensible either way (More holds Inbox), but Messages currently
carries no unread count at all. Left alone — flagging, not fixing.

Devanagari: build uses `सन्देश` for Messages, reference uses `संवाद` (Sanvaad, the
module's own name). Same class of issue as `_DESIGN-GAP.md` §2 for the web sidebar.

---

## 2. Pahchan history — was absent, now built · **FIXED**

Both open items in my brief turned out to be **one** missing thing.

**What the reference actually shows.** `MPahchan` (`Mobile.jsx:311`) is not one screen —
it is a segmented pair, `[['clock','Clock'], ['cal','My attendance']]`. The `cal` tab
carries: a four-stat row (Present / Late / Leave / Hours), a **month heat-map calendar**
with a legend (Present · Late · Leave · Weekly off), and a **day detail block**
(Clock in / Clock out / Total / Location). None of it existed in the build in any form.

**The `MeScreen` claim was 2/3 stale.** My brief said `MeScreen` "does not carry what
`07 §9` requires — the reference pair, register, retention promise". Verified against
the code:

| 07 §9 requirement | Status before this branch |
|---|---|
| Reference pair | **already present** — `screens/pahchan/MyBiometrics.tsx`, rendered as actual images via `enrollmentApi.photoUrl`, with per-slot `Not taken` / `Awaiting HR` states |
| Retention promise | **already present** — same file, read from `mine.retention` (the org's real policy numbers, not constants) |
| Register | **genuinely absent** |

`MyBiometrics` is mounted at `MeScreen.tsx:269` and is not a stub. Only the register was
missing — and the register is the same data as the reference's "My attendance" tab.

**What I built.** `screens/pahchan/AttendanceHistory.tsx` — one component, both mount
points, no duplication:

- **Full shell** — `ClockScreen` gains the reference's `Clock | My attendance` segment.
- **Attendance-only shell** — mounted in `MeScreen` under the reference pair, so the
  employee's *record* sits beside *what is held about them*, which is what §9 asks for.
  Only renders for someone who is actually a Pahchan employee.

Wired to the existing `pahchanApi.me(days)` — `{ employee, punches[], retention }`. No new
endpoint, no new API surface, no DB write. Days-window is a real parameter and drives the
month shown.

Offline is a first-class state, not an edge case: the screen reads `useOnline()` and
renders through `ScreenState`, so cached punches beat an offline placeholder and
`forbidden` stays distinct from `error` (the six states already established for the module
surfaces). Locally-queued punches from `offline/punchQueue` are shown **merged into the
register and marked as not-yet-sent** — an employee who punched in a basement must see
that punch on their own record, or they will punch again.

---

## 3. New structural gaps found only by rendering

### 3.1 The seventh module is **eSign**, not Marketing

`MobileModules.jsx:6` — `MODS` is exactly:

| key | hi | en | full |
|---|---|---|---|
| `crm` | ग्रह | CRM | Graha |
| `fin` | गणित | Finance | Ganit |
| `hr` | मानव | HRMS | Manav |
| `pay` | वेतन | Payslips | Vetana |
| `rep` | दृष्टि | Reports | Dristi |
| `ai` | सृजन | Assistant | Srijan |
| `sign` | **हस्ताक्षर** | **eSign** | **Hastakshar** |

The build shipped **Prachar (Marketing)** as its seventh and has **no eSign surface**.
`MMODULES` (`Mobile.jsx:16`) confirms it from the other direction: the More grid lists
`['eSign','हस्ताक्षर','sign',1,'sign']` with a **badge of 1**, and lists no Prachar tile
anywhere.

The rendered eSign screen is a real surface, not a placeholder: a three-stat row
(Awaiting you / Awaiting others / Completed), a document list with per-item state
(`Review & sign`, `Waiting on client`, `Signed`), and the boundary sentence *"Signing on a
phone needs the full document readable first — tapping opens the paged view, not a
signature box."*

This is a substitution, not an omission, so nothing reported it as missing. **Not fixed
here** — it needs the eSign/Hastakshar endpoints and a decision on whether Prachar stays.
Flagging for whoever owns that call.

### 3.2 More screen — three whole sections missing

`MMore` (`Mobile.jsx:481`) renders, top to bottom:

1. **Profile row** — avatar, name, `Owner · Aekam Inc`, chevron. **Build has none.**
2. **`Pinned`** — the first three modules as large tiles (Approvals · Time · Reminders). **Build has none.**
3. `All modules` — a **flat grid of 12**, count in the heading.
4. **`Settings` as five list rows** — Notifications & sounds · Language · Offline & sync · Account · About. **Build has one "Settings" row.**
5. **Closing hint** — *"Accent colour, fonts and density are set once on desktop — but theme, language, push and time format are here, because those change where you are."* **Build has none.**

The build instead splits into `Work` (5) + `Modules` (8) and appends a single Settings row.
The reference's flat 12 mixes what the build calls Work and Modules — Approvals, Time,
Reminders, Notifications sit in the same grid as CRM and Payslips.

Label deltas in the same grid: reference `Finance` / build `Invoicing`; reference `HRMS` /
build `HR`; reference `Reports` / build `Analytics`; reference CRM is **ग्रह** and the build
says **ग्राहक**. Identical to `_DESIGN-GAP.md` §2's finding for the web sidebar, so it
should be settled once for both surfaces rather than twice.

Not fixed here — it is a layout rewrite that would collide head-on with the pixel/theming
sibling working the same file.

### 3.3 Boards is unreachable from where the reference puts it

The reference's Tasks screen (`MTasks`, `Mobile.jsx:166`) opens with a segmented
`My tasks | Boards`, and *below* it the filter chips `All · Due today · Overdue · Urgent`.

The build's `TasksScreen`:
- has **no** `My tasks | Boards` segment — its own docstring at line 20 says 17 requires one;
- its segments are the **filters** (`open · today · done`), one level up from where the
  reference has them, and the set differs (no Overdue, no Urgent).

Meanwhile **`screens/BoardsScreen.tsx` is orphaned** — `grep -rn "BoardsScreen"` across
`mobile/src` returns only its own definition. Never imported, never routed, dead. The
build reaches boards via a `Boards` tile in More that routes to `Board` (singular — one
project's board), not to the project list.

So the project list screen exists, is written, and no user can reach it. Flagged, not
fixed — wiring it is a Tasks-screen restructure that belongs with the segment work.

### 3.4 `components/Sheet.tsx` — confirmed absent; the count was low

My brief said four screens roll their own modal. It is **nine sheet/dialog sites across
eight files**, each hand-rolling `<Modal transparent>` + its own scrim:

| File | Shape |
|---|---|
| `components/NewTaskSheet.tsx` | slide-up + `backdrop` |
| `components/AttachmentSourceSheet.tsx` | slide-up + `backdrop` |
| `screens/BoardScreen.tsx` | **two** — a picker sheet + `NewTaskModal`, both slide-up + `backdrop` |
| `screens/RemindersScreen.tsx` | slide-up + `scrim` |
| `screens/modules/ManavScreen.tsx` | slide-up + `scrim` |
| `screens/taskdetail/AssigneePickerModal.tsx` | slide-up |
| `screens/taskdetail/MoveModal.tsx` | slide-up | 
| `screens/ApprovalsScreen.tsx` | centre dialog (fade) |
| `screens/taskdetail/ApprovalModal.tsx` | centre dialog (fade) |

Two spellings of the same thing (`backdrop` at `rgba(0,0,0,0.45)`, `scrim` at
`rgba(0,0,0,0.4)`) and seven copies of the same slide-up scaffold.

See §4 for what I did about it.

---

## 4. `components/Sheet.tsx`

Added as the single bottom-sheet primitive: `<Modal transparent>`, one scrim value, the
grab handle the reference draws (`msheet__grab`), safe-area-aware padding, `onRequestClose`
wired for Android hardware back, and `accessibilityViewIsModal`.

**Deliberately no animation logic of its own** — it uses RN's built-in `animationType`.
The motion sibling owns the sheet's motion curve, and a Sheet that hardcodes its own
timing is exactly the thing that would have to be torn out again. The primitive is the
seam they need; it is not the motion.

Migrated the pure slide-up sheets. The two centre dialogs are a different component and
were left alone.

---

## 5. Gates

| Gate | Command | Result |
|---|---|---|
| Mobile typecheck | `cd mobile && npx tsc --noEmit` | see §6 |
| Web tokens | `cd frontend && node scripts/check-tokens.mjs` | see §6 |
| Web classes | `cd frontend && node scripts/check-classes.mjs` | see §6 |

Run unpiped from `frontend/` per `_COORDINATION.md` §2. Mobile deps installed with
`npm ci --ignore-scripts`; **`mobile/package-lock.json` is unmodified** and `__ref/` is
gitignored — neither is committed.
