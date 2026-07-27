# Manav (HR) — tab bodies converted

Branch `design/manav-tabs-a7c402`, commit `932e7f9`, branched fresh from
`origin/staging` @ `cfdf4a40`.

Every number below was regenerated in this worktree, not transcribed.

---

## Branch hygiene — the worktree WAS stale

The worktree seeded at `1aa49855`, **737 commits behind** `origin/staging`
(`cfdf4a40`). `frontend/src/pages/manav/` did not exist at that commit.

Before re-branching I checked the 13 commits that were on the stale branch and
not on `origin/staging`. All 13 are reachable from `main`,
`backup/agent-a54bd25b975919175-premain`, `claude/quirky-wiles-2af4ca` and ~18
other worktree branches — verified with `git branch -a --contains` on both the
newest (`1aa49855`) and oldest (`1ab6f012`) of them. Nothing was lost.
`main` was not touched.

---

## The count

Regenerate with:

```
cd frontend/src/pages && python -c "import pathlib;print(sum(p.read_text(encoding='utf-8',errors='ignore').count('style={{') for p in pathlib.Path('manav').rglob('*.jsx')))"
```

| | before | after |
|---|---|---|
| `pages/manav/` inline styles | **609** | **14** |
| — of which custom-property (`'--c'`) | 0 | **14** |
| — of which raw CSS property values | 609 | **0** |
| `ManavPage.jsx` | 1 | **0** |

All 14 survivors are `style={{ '--c': … }}` feeding a CSS rule — check-tokens
deviation 2, the only permitted form. Verified by regex, not by eye: the script
that produced this table classifies each occurrence and prints any raw one.

Per-file before → after: EmployeesTab 87→2, AssetsTab 66→0, LeavesTab 68→0,
AttendanceTab 56→4, RecruitmentTab 53→2, ShiftDefinitions 45→1, ExpensesTab
43→0, ScheduleGrid 38→0, AnnouncementsTab 33→0, SwapRequests 26→0, HolidaysTab
24→0, DepartmentsTab 23→0, ShiftBids 23→0, PerformanceTab 22→5, ShiftsTab 2→0,
`_shared.jsx` 0→0.

---

## Gates — all four, from `frontend/`, unpiped

```
node scripts/check-tokens.mjs   → 347 declared, 239 referenced, 0 missing
node scripts/check-classes.mjs  → 2690 selectors, 1949 used, 0 missing a rule
npx vite build                  → built clean
npx vitest run                  → 36 files / 603 tests passed
```

Zero `Unhandled Rejection` blocks — checked explicitly with a case-insensitive
grep for "unhandled" over the full vitest output, which returned 0.

Baseline was 35 files / 594 tests. I added **1 file / 9 tests**
(`pages/manav/__tests__/manavTabs.test.jsx`); no existing test was modified.
Gates were re-run after reverting the environment artifacts noted below and are
green in the committed state.

---

## The rule this module was rebuilt around

**A failed fetch must never render as an empty state.**

Every one of the eleven tabs was `catch { pushToast(…) }` over a list left at
`[]`, then `list.length === 0 ? <empty> : <table>`. On HR that renders:

- "No employees yet" when the directory failed to load
- "No attendance in this range" when the ledger that decides pay failed
- "No leave requests", "No holidays configured", "No expense claims", …

Each is a false statement about the business, printed from an error, under a
toast that has already faded. This is the same shape the Vetana agent found on
payroll — it was here too, eleven times.

All eleven now go through `useList` in `_shared.jsx`, which keeps loading /
error / data distinct and returns `items: null` whenever `error` is set, so a
call site *cannot* collapse the two. **Ten bare `catch {}` blocks** were removed;
each had been hiding a dropdown that would silently render empty.

The 9 added tests pin this. I verified they are real guards rather than
decoration: with the original `EmployeesTab.jsx` restored from `origin/staging`,
**3 of the 9 fail**; with the rebuilt file they pass.

---

## Four live bugs found and fixed

### 1. The leave clash check had never worked — not once

`LeavesTab.checkConflicts` called
`/v1/manav/leaves/check-conflicts?start_date=…&end_date=…&department=…`.

The route signature (`backend/routers/manav.py:1211`) is
`(employee_id, start_date, end_date)` — `employee_id` **required**, and there is
no `department` parameter. FastAPI rejects a missing required query param with
422 before the handler runs, so every press of "Check" produced the toast
"Failed to check" and nothing else, permanently.

Had it returned 200 the panel would still have rendered blank: all four fields
it read are names the server has never sent.

| UI read | server actually sends |
|---|---|
| `overlap_count` | `conflict_count` |
| `overlap_percentage` | *(nothing — not computed server-side)* |
| `has_conflict` | `exceeds_threshold` |
| `overlapping_leaves` | `conflicts` |
| `ol.leave_type` | *(not in the SELECT)* |

Rebuilt against the real contract. The employee is now picked (the department
the check runs over is derived from that employee's own record, which is why the
parameter is required); the percentage is derived here from `on_leave_count` and
`department_size`; and the 30% verdict is read from the server's own
`exceeds_threshold` rather than recomputed, so UI and server cannot drift.

### 2. The Coverage button fetched successfully and rendered nothing

`ScheduleGrid.loadCoverage` did `r.data.data || r.data || []`, but
`/v1/manav/schedules/coverage` answers `{"coverage": [...], "total_employees": N}`
— there is no `data` key. So `r.data.data` was undefined, the `||` fell through
to `r.data`, and state became the **envelope object**. The panel then gated on
`coverage.length > 0`, and an object has no `length`, so the condition was
`undefined > 0` — false, always.

This is the exact hazard `lib/api`'s `rows()` exists to end, and also the case
where `rows()` alone is *not* the answer: the key is `coverage`, and
`total_employees` beside it is what makes a per-shift headcount meaningful. That
call site keeps the whole body deliberately, as does the attendance summary
(see below).

### 3. The shift colour picker could not round-trip its own value

`ShiftDefinitions` defaulted `color` to the **string** `'var(--st-in-progress)'`
and fed it to `<input type="color">`. A native colour input accepts `#rrggbb`
and nothing else; anything unparseable is silently coerced to `#000000`. So the
swatch opened black every time, and a shift created without touching the picker
POSTed the literal text `var(--st-in-progress)` into
`manav_shift_definitions.color` — a column whose backend default is the hex
`#3B82F6` (`manav.py:1321`).

A token sweep applied one field too far. This is the one colour in the module
that *cannot* be a token: it is user-chosen, persisted per row, and rendered
through a control that only speaks hex. `DEFAULT_SHIFT_COLOR` and `isHexColor`
in `_shared.jsx` carry that reasoning next to the value so it is not "fixed"
again. Rows already written with a token string open on the default rather than
becoming black.

### 4. The swap form asked for a raw UUID

`SwapRequests` had a text input labelled "Schedule ID — Your schedule ID".
Nothing on screen showed anyone their schedule IDs, so the field was unfillable
without the network tab. It is now a select over the caller's own roster.

---

## Attendance → payroll: the bridge is complete; the UI was silent about it

The brief asked me to report precisely rather than invent. **The bridge exists
and is coherent.** Two paths, both landing in `staging.manav_attendance`, which
is what Vetana prices:

1. **Pahchan (device):** punch → `pahchan_punches`; a correction is a
   `pahchan_regularisations` row (request → approve/decline);
   `POST /v1/pahchan/attendance/publish` pairs approved corrections with punches
   and upserts `manav_attendance` with `marked_by='pahchan'`.
   Lives in `backend/routers/pahchan_attendance.py` (not `pahchan.py` — worth
   knowing, it is easy to grep for and miss).
2. **Manav (by hand):** `POST /v1/manav/attendance` upserts the same rows
   directly with `marked_by='manual'`, EDITOR level, effective immediately.

The two interlock correctly: the publish upsert's `DO UPDATE … WHERE` refuses to
overwrite a `marked_by='manual'` row, so an HR correction typed in Manav
**outranks the device permanently**. Nothing is missing or half-built.

What *was* missing is that none of this appeared on screen. Attendance is the
input to pay and the tab did not say so, and the manual-wins rule is invisible
and consequential. Both are now stated on the Attendance tab and again in the
Mark form. I did not invent an endpoint.

**Not verified:** I did not exercise the bridge end-to-end. That needs a write
to a shared Supabase project, and I was read-only.

---

## Backend review

- **All 64 routes in `manav.py` carry `Depends(_gate)`** — checked
  programmatically by parsing each decorator's signature block, not by reading.
  Zero routes missing a module/permission check. `_gate` is
  `require_module_or_self("manav")`; the PII route adds `_pii_gate`
  (`require_org_role(*ORG_MANAGEMENT_ROLES)`).
- **Every list route returns `{"data": [...]}`** — all 30 GETs enumerated. Call
  sites now unwrap through `rows()` from `lib/api.js` so they do not encode that
  assumption. Three routes carry extra envelope keys and deliberately keep the
  whole body: `/attendance/summary` (`month` — the brief's example, left alone),
  `/performance/summary` (`from_date`/`to_date`), `/schedules/coverage`
  (`coverage` + `total_employees`).
- **No backend file was modified.** No migrations, no writes, no
  `PROPOSED_*.sql` was needed.

---

## Also changed

Destructive actions that fired on a single unguarded click now confirm through
the existing `ConfirmDialog` and name the consequence: delete asset (says if it
is currently out with someone), delete holiday, delete department (says how many
employees are attached and that clash checks will stop working for them), delete
announcement, hire candidate (says it creates a personnel record), approve swap
(names both people).

Shift sub-navigation is now a real tablist with arrow-key movement and
`aria-selected`; the employee table rows are keyboard-operable. Filters that
previously re-fetched per keystroke or lagged one change behind now derive from
the URL, so the request and the label cannot disagree. Emoji used as UI
furniture (📌 for pinned) is gone per 07 §175; the `icon=` props on `Empty` are
unchanged, since `EmptyState` maps those to real SVG glyphs.

`styles/manav.css` is new and registered in `styles/index.css`. **No shared CSS
was modified** — the peer-collision risk the brief flagged does not apply here.
Cards, forms, tables, detail panes, stat strips, shimmer and note blocks all
reuse the existing `k-*` vocabulary from `editorial.css` rather than a second
implementation under a new name.

`useTabPanelMotion` was **not** introduced — `ManavPage.jsx` did not call it
before and does not now, so the React 19 key-in-spread guard is untouched.

---

## What I did NOT verify — read this part

- **No in-browser check.** I started my own vite on port 5219 from this worktree
  (never :5173) and confirmed it served HTTP 200, but the shared browser was at
  its tab cap and **all nine open tabs belonged to peer agents**. Evicting one is
  exactly the cross-agent interference the brief warned about, so I stopped and
  killed my server. **Nothing in this report rests on looking at the rendered
  page.** It rests on the four gates, the build, and 9 tests proven to fail
  against the pre-change code.
- **No visual/pixel comparison** against `ScreenManav()` or the rendered HTML
  harnesses. I read `ScreensMore.jsx:68`, `ScreensThin.jsx:70` (`ManavLeaves`)
  and `Data.jsx` for the tab list and Devanagari labels, and followed the
  converted sibling `vetana/` for structure. I did not open
  `Kartavaya Redesign.html`. Layout fidelity is therefore **unconfirmed**.
- **No live API call.** All behaviour is asserted against mocked responses shaped
  from the router source. The four bugs above are read from code and contract,
  and three of them (clash check 422, coverage `undefined > 0`, colour coercion)
  are deterministic from the source; I did not observe them in a browser.
- **`design-handover/_SOURCE-MAP.md` has no Manav entry.** Per the brief, that
  means no Manav handover spec exists — I did not invent one, and did not treat
  any other `.md` as authoritative for this module.
- **The `mn-*` responsive breakpoints (760px, 560px) are untested** at those
  widths for the same reason as the first bullet.
- Two files were touched by my toolchain and **reverted**, not committed:
  `frontend/yarn.lock` (my Windows install swapped the Linux esbuild/rollup
  binaries) and the visual-regression snapshot (line endings only — confirmed
  with `git diff --ignore-all-space`, which was empty).

---

## Suggested follow-up

Rows may already exist in `manav_shift_definitions.color` holding the literal
string `var(--st-in-progress)` from bug 3. The UI now degrades safely, but a
read-only audit would say how many. I did not query — read-only on a shared
database, and this is a SELECT someone should run deliberately:

```sql
SELECT org_id, count(*) FROM staging.manav_shift_definitions
 WHERE color !~ '^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$' GROUP BY org_id;
```
