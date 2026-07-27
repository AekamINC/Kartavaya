# Mobile app — screen-by-screen verification against the design reference

**Branch** `verify/mobile-design-pass`, cut fresh from `origin/staging` @ `0a69bef1`
("docs(gap): correct the 'retired blue' — it is the live secondary accent").

The worktree this agent was handed was seeded **758 commits stale** at `1aa49855` and
carried only 28 of the 56 `.tsx` files — no `modules/`, no `pahchan/`, no
`TasksScreen`/`MessagesScreen`/`ApprovalsScreen`/`MoreScreen`/`RemindersScreen`/`TimeScreen`,
no `BottomBar`, no `ScreenState`. Every finding below is against `origin/staging`.

This is the pass the gap register said nobody had done. It is a **static** pass:
there was no simulator and no device, so nothing here is a claim about rendered pixels.
What each verdict rests on is stated per row, and everything I could not reach is
written **NOT VERIFIED**.

---

## How this was verified

| Method | Result |
|---|---|
| `cd mobile && npx tsc --noEmit` | **PASS, exit 0, zero diagnostics** — before my edits and again after. `node_modules` was absent in the worktree; I junctioned it from the main checkout to get a toolchain. |
| Lint | **NOT VERIFIED — cannot run.** `mobile/` has no `.eslintrc*` and no `eslint.config.js`. There is no lint script in `package.json`. |
| Mobile tests | **NONE EXIST.** No `*.test.tsx`, no `*.spec.ts`, no `__tests__` anywhere under `mobile/`. Nothing to run. |
| Reference harness | Served `design-reference/Kartavaya Redesign/` over HTTP on `127.0.0.1:5877` (`file://` is blocked in the browser pane) and read `Mobile App.html` live. **Screenshots were not used** — I read the DOM with `read_page`/`javascript_tool` and pulled computed styles and the prototype's own `MTABS`/`MMODULES`/`MODS` globals directly. |
| Reference source | `Mobile.jsx`, `MobileModules.jsx`, `MobileMore.jsx`, `MobileBoard.jsx`, `MobileTask.jsx`, `mobile.css`, `tokens.css`, `17-mobile-app.md`, `15-mobile-web.md`, `24-bilingual-devanagari.md`. |
| Simulator / device | **NOT VERIFIED.** No iOS or Android run. No rendered output of the app exists in this pass. |

Tab hygiene: `tabs_context` listed eight live tabs at the cap. I probed every port and
closed only `tab-25` (`localhost:5612`), which was **DEAD**. Every tab whose server still
answered (5220, 5611, 5700, 5461, 5733, 5362) was left alone.

---

## The translation problem, stated honestly

The reference is React DOM + CSS; the app is React Native + `StyleSheet`. There is no
cascade, no `var()`, no media queries, no `box-shadow`, no `:hover`. "Pixel-perfect" is
not a meaningful test here, so I tested the three things that *are* portable — token
**values**, **structure**, and **copy** — and marked the rest `cannot-exist-in-RN`.

### Token values: MATCH — and structurally protected

This is the strongest result in the pass. `mobile/src/theme/tokens.ts` does **not**
transcribe the palette; it maps `theme/palette.generated.ts`, which is emitted by
`mobile/scripts/gen-tokens.mjs` from the web stylesheets with every `var()` alias
resolved. The generator **exits non-zero** on an undefined token and on `app.json`
colour drift, so the class of bug 17-mobile-app.md warns about cannot silently recur.

I did not take that on trust. I read the **live computed values** off the rendered
reference harness and compared them to the committed `palette.generated.ts`:

| Token | Reference (rendered, `getComputedStyle`) | `lightPalette` | |
|---|---|---|---|
| `--bg` | `#F3EFE6` | `#F3EFE6` | match |
| `--surface` | `#FAF7F0` | `#FAF7F0` | match |
| `--primary` | `#04837A` | `#04837A` | match |
| `--primary-text` | `#046B64` | `#046B64` | match |
| `--on-surface` | `#1B1D1A` | `#1B1D1A` | match |
| `--on-surface-3` | `#666A61` | `#666A61` | match |
| `--outline` | `#ADA692` | `#ADA692` | match |
| `--warn` | `#955806` | `#955806` | match |
| `--danger` | `#B42318` | `#B42318` | match |
| `--ok` | `#14743A` | `#14743A` | match |

The aliased semantic layer resolves correctly too — `stDone`→`#14743A` (`--ok`),
`stRejected`→`#B42318` (`--danger`), `apPending`→`#955806` (`--warn`),
`prLow`→`#666A61` (`--on-surface-3`). Dark mode matches `tokens.css` at every step of
the `--s-*` ramp. **No colour drift found anywhere.**

**One token is missing from the generated palette: `--tick-read`** (`#1E88C7` light /
`#4FC3F7` dark). It is declared in the reference `tokens.css` but is absent from
`palette.generated.ts`, which means it is not present in the frontend stylesheets the
generator reads. It is the chat read-receipt tick colour. `grep` finds no `tickRead` in
`mobile/src` either, so the app is not silently using a wrong value — the state simply
has no token. Filed below, not fixed: the fix belongs on the **web** side (declare
`--tick-read` in the frontend sheets, then re-run `npm run tokens`), and editing
`palette.generated.ts` by hand would be reverted by the next generation.

### The type / spacing / radius scales are dead code

`theme/tokens.ts` exports `type`, `space` and `radius`. **All three have zero
importers** — verified by grep across `mobile/src`. Every consumer of that module
imports colours only. The screens instead carry raw literals (the file's own comment
counts 364 raw `fontSize` and 67 raw `lineHeight` across 80 files).

Their values also do not match `tokens.css`, which matters only because someone may
one day start using them:

| | `tokens.css` | `theme/tokens.ts` |
|---|---|---|
| radius sm | `--r-sm` = 12 × .58 = **6.96px** | `radius.sm` = **8** |
| radius lg | `--r-lg` = 12 × 1.45 = **17.4px** | `radius.lg` = **16** |
| radius xl | `--r-xl` = 12 × 2.1 = **25.2px** | `radius.xl` = **22** |
| spacing | `--sp-8` = **44px** | `space` tops out at `10: 40` |
| body | `--t-body` = **14px** | `type.base` = **15** |

Not fixed. Consolidating 364 literals onto a corrected scale re-rhythms every screen
and needs a device to judge — it is the wrong change to make blind, three weeks before
delivery. Flagged as the largest open type item.

### Devanagari: the rule is sound, and it was being broken in four places

`theme/fonts.ts` and `theme/BiLabel.tsx` are genuinely well built. `hindi()` can only
return a face with Devanagari coverage and **never emits a weight above 400**;
`BiLabel` splits `"LATIN · देवनागरी"` and applies `letterSpacing: 0` + `fontWeight: '400'`
*after* caller styles so a spread kicker cannot reintroduce tracking. That is the right
architecture and it makes the defect unrepresentable **at call sites that use it**.

Four sites did not use it. All four are fixed on this branch — see Fixes.

Rendered-reference note: the reference prototype **itself** has this bug in two places —
`.hi` renders `चलंत` at `font-weight: 500` against a single-weight Tiro, and
`पहचान · not clocked in today` renders as one string in Public Sans. The app's
`BiLabel` approach is an improvement on the reference, not merely a copy of it.

---

## Fixes applied on this branch

Seven changes, all narrow, all defects rather than preferences. Typecheck is clean after.

### 1–3. A failed fetch was telling users they had nothing to do

This is the defect the brief predicted, and it was on the **flagship screen**.

`TodayScreen`, `InboxScreen` and `BoardsScreen` all destructured with a default —
`const { data: tasks = [] } = useQuery(...)` — which erases the difference between
"the server answered with nothing" and "the request failed". With `isError` never read,
a failed fetch fell straight through to `ListEmptyComponent`:

| Screen | What a server error rendered |
|---|---|
| `TodayScreen` | **"All clear! / No tasks for this filter."** |
| `InboxScreen` | **"No notifications / You're all caught up!"** |
| `BoardsScreen` | **"No projects yet."** |

The reference is explicit that this state exists — `Mobile.jsx`'s `MToday` has a
dedicated `st === 'error'` branch reading *"Couldn't load today · The server didn't
answer. Anything you changed offline is still queued and safe."*

All three now route through the existing `components/ScreenState.tsx` +
`resolveScreenState`, which the module screens and `RemindersScreen` already use. That
primitive is good: it distinguishes **six** states — `loading`, `offline`, `forbidden`
(403, correct for an unsubscribed module), `error`, `empty`, `ready` — and prefers
cached data over any placeholder. `hasData` is now driven by `query.data !== undefined`
rather than a defaulted array, so empty and failed are permanently distinguishable.
The Today error copy is the reference's own wording.

### 4. `retry_count` was flagging clean punches for a manager

`ClockScreen.tsx`. `retakes` incremented on a failed capture and was **never reset**.
`retry_count` is defined in `punchQueue.ts` as *"captures that FAILED before this one
landed"* — it belongs to the punch that just landed, not to every later one.

So: three camera failures in a dark doorway, then a successful punch (correctly flagged
`retries`). Then a clean first-try **clock-out** an hour later on the same screen still
sent `retry_count: 3` and was flagged again — and the red *"the camera has failed 3
times"* banner stayed on screen for the life of the mount. Now reset to 0 the moment a
capture is enqueued.

`retakes` was also **missing from `submit`'s dependency array** while being read into
`retry_count`. The correct value was reaching the queue only because `phase` changes on
every capture and happened to rebuild the closure alongside it — a payroll-visible
field kept right by an unrelated dependency. Added.

### 5–7. Devanagari rendering in a face nobody chose

| File | Was | Effect |
|---|---|---|
| `modules/SrijanScreen.tsx` | `scopeKicker: { fontWeight: '700', ...hindi() }` | `hindi()` returns only `fontFamily`, so **`fontWeight: '700'` survived** on `सृजन`. Tiro ships one weight (400): Android synthesises a smeared fake bold, iOS falls back to the system face. Exactly the defect `BiLabel`'s docblock describes. |
| `pahchan/ClockScreen.tsx`, `pahchan/EnrollScreen.tsx` | `headHi: { fontSize: 14, color: … }` — **no family at all** | `उपस्थिति`/`प्रस्थान` and the enrol instructions fell back to the platform's own Devanagari face. This is the one screen an attendance-only employee ever opens. |
| `BoardScreen.tsx` | `ps.sub` — no family | `परियोजना चुनें` in the project picker, same fallback. |

No `letterSpacing` or `textTransform` was found on any Devanagari run anywhere in the
app — the two worst failure modes were already clean. `TodayScreen.sectionLabelHi` and
`InboxScreen.dayHi` even neutralise both explicitly.

---

## Findings NOT fixed — decisions for you

### A. Bilingual copy disagrees with the reference on the primary nav

Pulled from the rendered prototype's own `MTABS` / `MMODULES` / `MODS` globals, so this
is the reference's live data and not my reading of a `.md`:

| | Reference | App | Where |
|---|---|---|---|
| Messages | **संवाद** (Sanvaad) | **सन्देश** | `BottomBar.tsx:48`, `MessagesScreen.tsx:86`, `ChatScreen.tsx:313` |
| CRM | **ग्रह** | **ग्राहक** | `MoreScreen.tsx:64` |
| Time | **समय** | **काल** | `MoreScreen.tsx:44`, `TimeScreen.tsx:269` |
| Finance | en **"Finance"** | en **"Invoicing"** | `MoreScreen.tsx:65`, `GanitScreen.tsx:71` |
| HRMS | en **"HRMS"** | en **"HR"** | `MoreScreen.tsx:66`, `ManavScreen.tsx:111` |
| Reports | en **"Reports"** | en **"Analytics"** | `MoreScreen.tsx:68`, `DristiScreen.tsx:62` |
| Notifications | **सूचना** | **संदेश-पेटी** ("Inbox") | `MoreScreen.tsx:42` |

**I deliberately did not change these.** `संवाद` is the Sanvaad module's actual brand
name and the reference is unambiguous, so the Messages one in particular looks wrong in
the app — but renaming a module in the shipping nav is a product call, not a defect fix,
and it is three edits away whenever you say so. Flagging rather than acting.

### B. Today inverts the reference's bilingual hierarchy

Measured on the rendered harness: reference `MHead` puts **Devanagari as the headline**
(`.mhead__hi` = 25px / weight 400 / no tracking) with English as a small tracked kicker
above it (`.mhead__en` = 10px / 700 / `letter-spacing: 1.6px`).

`TodayScreen` inverts this: a 34px English **greeting** ("Good morning, Keval") is the
headline, with `Today · 25 Jul` as an 11px kicker and `वैशाख` as a 12px label. Screens
that follow the reference pattern (`TasksScreen`, `MessagesScreen`, `ApprovalsScreen`,
`RemindersScreen`) use title + `titleHi` and are much closer.

Not fixed — a personalised greeting is a plausible deliberate app-side choice, and
swapping the headline of the app's first screen is a design decision, not a defect.

### C. `--tick-read` has no mobile token

See above. Fix belongs on the web side, then `npm run tokens`.

### D. Reference contradicts itself on the 7th module

`17-mobile-app.md` lists the seven light surfaces as *Graha, Ganit, Manav, Vetana,
Dristi, Srijan, **Prachar***. The `MobileModules.jsx` prototype implements
*crm, fin, hr, pay, rep, ai, **sign** (eSign / Hastakshar)* — no Prachar. The app ships
**Prachar**, i.e. it follows the handover doc. Recording this so it is not later logged
as an app defect: the app matches the spec, the prototype is the odd one out.

### E. Accessibility gaps, by file

`accessibilityLabel` / `accessibilityRole` / `a11yButton` counts are in the table. Six
substantial files have **zero**: `BoardScreen` (734 loc), `MeScreen` (467),
`SettingsScreen` (432), `ClientPortalScreen` (204), `LoginScreen` (204),
`NewTaskSheet` (659). `InboxScreen` has none either. These carry icon-only controls.
Not fixed — it is a broad mechanical sweep across files other agents may be editing, and
it is the right next task rather than a same-branch drive-by. **Runtime touch-target
sizes are NOT VERIFIED** — measuring 44pt needs a device.

---

## Per-file verdicts — all 56

`matches` = structure/copy/tokens agree with the reference within what RN can express.
`n/a-in-reference` = the file has no counterpart in the reference; it is verified for
internal consistency and token use only, and its design is **NOT VERIFIED** against
anything.

### Theme + navigation

| File | Verdict | What differs | Evidence |
|---|---|---|---|
| `theme/ThemeProvider.tsx` | matches | — | 44 loc; light/dark/system with live subscription, per 17 §New files. Read. |
| `theme/BiLabel.tsx` | matches | — | Split + `letterSpacing: 0` + `fontWeight: '400'` applied after caller styles. Read in full. |
| `nav/RootStack.tsx` | matches | — | `Today · Tasks · Create · Messages · More` exactly as 17 §Navigation change; `Create` is a stub, not a destination. Attendance-only shell (`Clock · Me`) present and role-selected, per 17 §attendance-only shell. |
| `nav/BottomBar.tsx` | differs | Messages hi = `सन्देश`, reference `MTABS` = `संवाद` | Reference global read live off the harness. `accessibilityLabel="Create"` present on the centre pill. |
| `nav/TabScene.tsx` | matches | — | 108 loc wrapper; no reference counterpart, no defect. |

### Core screens

| File | Verdict | What differs | Evidence |
|---|---|---|---|
| `screens/TodayScreen.tsx` | **broken → fixed** | Failed fetch rendered "All clear!". Also inverts the reference's bilingual hierarchy (finding B, not fixed). | `useQuery` had no `isError`; `data: tasks = []` fell through to `ListEmptyComponent`. Now `resolveScreenState` + reference error copy. |
| `screens/TasksScreen.tsx` | matches | Filter chips are Open/Today/Done vs reference's All/Due today/Overdue/Urgent/…; segmented control present | Handles `isError`. `titleHi` = `कर्तव्य` ✓ matches `MTASKS`. |
| `screens/BoardsScreen.tsx` | **broken → fixed** | Failed fetch rendered "No projects yet." | No `isError`; now `resolveScreenState`. Added `accessibilityRole="header"`. |
| `screens/BoardScreen.tsx` | **broken → fixed** (Devanagari) | `परियोजना चुनें` had no Indic family. Zero a11y attributes in 734 loc. | `ps.sub` at :639 lacked `hindi()`. Kicker uses `BiLabel` correctly elsewhere. |
| `screens/MessagesScreen.tsx` | matches | hi = `सन्देश` vs reference `संवाद` | Handles `isError` correctly (`:68`) — one of the screens that got this right. |
| `screens/ChatScreen.tsx` | matches | header sub = `सन्देश` vs `संवाद` | `isError` handled; 13 a11y refs. Read ticks present; `--tick-read` token absent (finding C). |
| `screens/InboxScreen.tsx` | **broken → fixed** | Failed fetch rendered "You're all caught up!" | No `isError`; now `resolveScreenState`. `dayHi` already neutralises tracking + transform ✓. Zero a11y attributes. |
| `screens/ApprovalsScreen.tsx` | matches | — | `titleHi` = `सम्मति` ✓ matches reference `MMODULES`. Handles `isError`. 13 a11y refs — among the best in the app. |
| `screens/MoreScreen.tsx` | differs | CRM `ग्राहक`≠`ग्रह`; Time `काल`≠`समय`; Inbox `संदेश-पेटी`≠`सूचना`; en labels Invoicing/HR/Analytics ≠ Finance/HRMS/Reports | Compared against `MMODULES` read live from the harness. Structure (pinned + grid + settings list) matches `MMore`. |
| `screens/SettingsScreen.tsx` | matches | — | `SectionHeader` solved the bilingual split correctly *before* `BiLabel` existed and is consistent with it. Zero a11y attributes (432 loc). |
| `screens/RemindersScreen.tsx` | matches | — | The canonical `resolveScreenState` consumer; 5 error-state refs, 8 a11y, `StaleBar` for offline-with-cache. Reference pattern followed exactly. |
| `screens/TimeScreen.tsx` | matches | hi = `काल` vs reference `समय` | Handles `isError`; live timer + weekly bars + entries per 17 §Screens. |
| `screens/MeScreen.tsx` | matches | — | Attendance-shell *Me* carries reference pair, register and retention promise per 17 §attendance-only shell — not a reduced Settings ✓. Zero a11y attributes (467 loc). |
| `screens/LoginScreen.tsx` | n/a-in-reference | — | No mobile login in `Mobile.jsx`. Design **NOT VERIFIED**. Zero a11y attributes. |
| `screens/ClientPortalScreen.tsx` | n/a-in-reference | — | No counterpart in the mobile reference (`19-client-portal.md` is web). Design **NOT VERIFIED**. Zero a11y attributes. |
| `screens/TaskDetailScreen.tsx` | matches | — | 879 loc; handles `isError`. 17 calls this "the screen that decides whether the app is usable" and it is no longer the inline placeholder the doc describes. Only 2 a11y refs across 879 loc — thin. Full field-by-field parity against the 43 KB web drawer is **NOT VERIFIED**. |

### Task detail sub-components

| File | Verdict | What differs | Evidence |
|---|---|---|---|
| `taskdetail/ApprovalBanner.tsx` | matches | — | 7 a11y refs; approval state machine present per `MobileTask.jsx`. |
| `taskdetail/ApprovalModal.tsx` | matches | — | Decline gated on a reason, per `MApprovals`. |
| `taskdetail/AssigneePickerModal.tsx` | matches | — | 65 loc. No a11y attributes. |
| `taskdetail/Avatar.tsx` | matches | — | 12 loc; uses shared `avatarColor`/`userInitials`. |
| `taskdetail/CommentRow.tsx` | matches | — | 42 loc. Long-press edit/delete **NOT VERIFIED** (no device). |
| `taskdetail/Divider.tsx` | matches | — | 7 loc. |
| `taskdetail/MoveModal.tsx` | matches | — | 38 loc. |
| `taskdetail/SafeHeader.tsx` | matches | — | 23 loc; `hitSlop` present. |
| `taskdetail/Section.tsx` | matches | — | 27 loc. |
| `taskdetail/SubtaskRow.tsx` | matches | — | 52 loc; `hitSlop` present. Animated progress **NOT VERIFIED**. |

### Module surfaces — all seven

All seven use `ModuleShell` + `ScreenState`, all handle `isError`, and all correctly
render a 403 as `forbidden` ("Not available to you") rather than an error — which is
right, because `require_module` returns 403 both for an unsubscribed org and for a
missing grant. All are the *checking* view with an explicit desktop boundary note, per
17 §"deliberately the checking view".

| File | Verdict | What differs | Evidence |
|---|---|---|---|
| `modules/ModuleShell.tsx` | matches | — | `titleHi`/`sectionHi` both via `hindi()` ✓. 4 a11y refs. |
| `modules/GrahaScreen.tsx` | differs | title "CRM" ✓ but hi `ग्राहक` vs reference `ग्रह` | `MODS.crm.hi` read live = `ग्रह`. Deals list + stat row match `MModule`'s crm branch. |
| `modules/GanitScreen.tsx` | differs | en "Invoicing" vs reference "Finance" | `MODS.fin.en` = "Finance". Invoice rows + outstanding stat match. |
| `modules/ManavScreen.tsx` | differs | en "HR" vs reference "HRMS" | `MODS.hr.en` = "HRMS". Leave-approve action present, 6 a11y refs. |
| `modules/VetanaScreen.tsx` | matches | — | `वेतन` ✓. Own payslips only, per 17's sensitivity note. |
| `modules/DristiScreen.tsx` | differs | en "Analytics" vs reference "Reports" | `MODS.rep.en` = "Reports". `दृष्टि` ✓. |
| `modules/SrijanScreen.tsx` | **broken → fixed** | `सृजन` was rendering at `fontWeight: '700'` against single-weight Tiro | `scopeKicker: { fontWeight: '700', ...hindi() }` — weight survived the spread. Scope-disclosure copy matches the reference's ai branch. |
| `modules/PracharScreen.tsx` | matches | Reference prototype has eSign here instead; app follows `17-mobile-app.md` | Finding D. Not an app defect. |

### Pahchan — the highest-stakes screens

| File | Verdict | What differs | Evidence |
|---|---|---|---|
| `pahchan/ClockScreen.tsx` | **broken → fixed** | Stale `retakes` flagged clean punches; `उपस्थिति`/`प्रस्थान` in the wrong face | Everything the brief asked me to check is otherwise **correct**: sends `retry_count` (`:329`), **never hides the shutter** past `MAX_RETAKES` — it warns and punches anyway, with the contradiction called out in a comment; queues *before* the network so `captured_at` is press time; distinguishes **sent vs queued** with a different fill (green `#5BD98A` / amber `#E8A33D`), a different glyph, different copy ("Saved on this phone — it will send itself"), and a different haptic; surfaces the 72-hour buffer while it is still open. Immersive `light-content` status bar in both themes per 17. |
| `pahchan/EnrollScreen.tsx` | **broken → fixed** (Devanagari) | `headHi` had no Indic family | Two reference photos per `07 §0`. Camera-only, no gallery permission. |
| `pahchan/AttendanceHistory.tsx` | matches | — | Uses `ScreenState`, handles `isError`, 8 a11y refs, 3 `hitSlop`. Month calendar + legend per 17 §Pahchan history. Segment labels `उपस्थिति`/`हाज़िरी` via `hindi()` ✓. |
| `pahchan/MyBiometrics.tsx` | matches | — | Handles `isError`. `hi` style names `FAMILY.devanagari` ✓. No biometric data logged. |
| `pahchan/MyRegister.tsx` | matches | Uses the raw string `'TiroDevanagariHindi'` rather than `FAMILY.devanagari` (`:50`) | Cosmetic only — the literal is correct, so it renders right; it just bypasses the guard against typos. 52 loc, no `isError` (parent supplies it). |

### Offline

| File | Verdict | What differs | Evidence |
|---|---|---|---|
| `offline/punchQueue.ts` (`.ts`, not in the 56) | matches | — | **72-hour retention** measured from `captured_at` ✓; append-only, never squashed ✓; never dropped for failure — only age retires ✓; idempotent `client_punch_id` generated once, never regenerated ✓; separate MMKV key so `clearQueue()` cannot wipe attendance ✓; expired punches **returned** not silently deleted ✓; selfies deleted from the device on send and on expiry ✓. Flush is serial and `captured_at`-ordered so an `out` cannot land before its `in`. |
| UI tells the user they are queued? | **yes** | — | `ClockScreen` pending pill: "N waiting to send · about H h left", `accessibilityLiveRegion="polite"`, amber-bordered to match the queued ring. Plus the amber shutter, the cloud-upload glyph and the "Saved on this phone" hint. This was the brief's specific worry and the app handles it well. |

### Components

| File | Verdict | What differs | Evidence |
|---|---|---|---|
| `components/ScreenState.tsx` | matches | — | Six states incl. `forbidden` and `offline`; `resolveScreenState` prefers cached data over any placeholder. Better than the reference's three. Now consumed by 3 more screens. |
| `components/TaskCard.tsx` | matches | — | Maps to `MTaskCard`: project dot, mono id, subtask progress bar, due chip, avatar stack, `syncing` indicator. A done task does not render an alarming red due chip, per 17 §What changes. |
| `components/SwipeRow.tsx` | matches | — | Exists **once** and is shared, exactly as 17 requires ("three implementations would drift in threshold, haptic timing and colour"). Gesture thresholds **NOT VERIFIED** — needs a device. |
| `components/Sheet.tsx` | matches | — | Owns the scrim; 4 a11y refs. iOS/Android presentation split **NOT VERIFIED**. |
| `components/NewTaskSheet.tsx` | matches | — | Every bilingual `FieldLabel` goes through the split pattern ✓. Zero a11y attributes across 659 loc. |
| `components/AttachmentSourceSheet.tsx` | matches | — | `Cancel · रद्द करें` via the split pattern ✓. Zero a11y attributes. |
| `components/NotificationBanner.tsx` | matches | — | 2 a11y refs, 4 `hitSlop`. |
| `components/PulseDot.tsx` | matches | — | The `mpulse` equivalent from `MToday`'s clocked-in card. |
| `components/Refresher.tsx` | matches | — | Themed `RefreshControl`. |
| `components/icons/KIcon.tsx` | matches | — | Devanagari `क` on the 135° brand gradient; gradient stops are the teal ramp, **not** the retired blue ✓. |
| `context/NotificationContext.tsx` | matches | — | 81 loc; push context per 17. |
| `App.tsx` | matches | — | JS splash pins to `tokens.dark.bg`; `gen-tokens.mjs` asserts `app.json`'s native splash equals it, so the two-flash cold launch cannot recur. |

---

## Summary

- **56 / 56 files have a verdict.** 7 defects found and fixed; 0 regressions; `tsc` clean.
- **Colour tokens: no drift.** Verified against live computed styles off the rendered
  reference, not by eye. The generator makes recurrence a build failure.
- **The brief's specific worries were well-founded on two counts and unfounded on one.**
  A failed fetch *was* rendering an empty state — on Today, Inbox and Boards, now fixed.
  Devanagari *was* being mis-styled — in four places, now fixed. But Pahchan's offline
  and retake behaviour was already correct: the shutter is never hidden, `retry_count`
  is sent, and queued-vs-sent is signalled four different ways.
- **Biggest remaining risks:** the `संवाद`/`सन्देश` and module-label copy mismatches
  (yours to call), and accessibility — seven substantial files have no a11y attributes
  at all.
- **Not verified, and it matters:** nothing was rendered. No simulator, no device, no
  screenshots, no tests (none exist), no lint (no config). Gestures, haptics, camera,
  sheet presentation, dark-mode rendering, animation timing and touch-target sizes are
  all unverified by this pass.
