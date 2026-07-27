# Coverage — every screen, and whether it has actually been done

**This is the document that did not exist, and its absence is why the owner kept
being the one to notice.** `_SOURCE-MAP.md`, `_DESIGN-GAP.md` and
`_COORDINATION.md` all record FINDINGS. None of them records COVERAGE. So after
30 agents there was no page saying "here is every screen and here is its state",
and the only way a gap surfaced was the owner opening it.

Regenerate the numbers, never transcribe them:

```
cd frontend/src/pages && python - <<'PY'
import pathlib, collections
g=collections.defaultdict(lambda:[0,0,0])
for f in sorted(pathlib.Path(".").rglob("*.jsx")):
    if "__tests__" in str(f): continue
    src=f.read_text(encoding="utf-8",errors="ignore")
    p=str(f).replace("\\","/").split("/")
    k=p[0] if len(p)>1 else "(top-level)"
    r=g[k]; r[0]+=1; r[1]+=src.count("\n"); r[2]+=src.count("style={{")
for k,(n,l,i) in sorted(g.items(), key=lambda kv:-kv[1][2]):
    print(f"{k:<22}{n:>6}{l:>8}{i:>8}")
PY
```

## The signal, and why it is the right one

`style={{ … }}` counts hardcoded values that bypass the token system. Every one
ignores the theme, the density control and the corner-radius control — so a page
carrying a hundred of them cannot look like the design no matter how correct its
tab bar is, and cannot respond to any preference the customer sets.

It is a proxy, not a proof. A page at zero can still be wrong. But no page above
about twenty has been converted, and that has held every time it has been checked.

## State, measured 2026-07-27

**3,541 inline style blocks across 171 page and tab files.** 64 files are at
zero; **53 are above twenty**.

> **This table is the BASELINE and is deliberately not edited.** vetana, dristi
> and prachar have landed since — see "Landed since this file was written"
> below, and re-run the script for current numbers rather than trusting either.
> Top-level is **1,260** as of the prachar merge, down from the 1,529 here.

| area | files | lines | inline |
|---|---|---|---|
| **(top-level pages)** | 42 | 19,290 | **1,529** |
| **graha** | 20 | 3,090 | **648** |
| **manav** | 16 | 2,302 | **609** |
| **ganit** | 11 | 2,144 | **548** |
| pahchan | 7 | 2,637 | 120 |
| org | 12 | 1,868 | 26 |
| marketing | 8 | 692 | 23 |
| customize | 6 | 590 | 10 |
| inbox | 2 | 127 | 7 |
| sanvaad | 14 | 2,678 | 7 |
| esign | 3 | 623 | 5 |
| today | 10 | 892 | 5 |
| onboarding | 8 | 887 | 4 |
| admin | 5 | 561 | 0 |
| client | 7 | 848 | 0 |

### The correction that matters

I previously told the owner that five modules were "split and styled" and four
were not. **That was wrong.** Splitting a module moves the inline styles into the
tab files; it does not remove them. The thin route file makes the page look
converted while the tabs carry the same debt:

| "done" module | route file | its tabs |
|---|---|---|
| graha | 166 lines, 2 inline | **648 inline across 20 files** |
| manav | 84 lines, 1 inline | **609 across 16** |
| ganit | 146 lines, 2 inline | **548 across 11** |

`ganit/InvoicesTab.jsx` alone carries 117 — more than `PracharPage.jsx`, which I
called unconverted. Splitting is the PRECONDITION for the work, not the work.

### Worst files

| file | lines | inline |
|---|---|---|
| `HubDashboardPage.jsx` | 1,355 | **248** |
| `HubClientDetailPage.jsx` | 1,342 | **241** |
| `OrgSrijanPage.jsx` | 1,291 | **241** |
| `ganit/InvoicesTab.jsx` | 542 | **117** |
| `PracharPage.jsx` | 1,021 | **108** |
| `graha/ContactsTab.jsx` | 361 | **104** |
| `HubSkillsPage.jsx` | 550 | **100** |
| `manav/EmployeesTab.jsx` | 302 | **87** |
| `VetanaPage.jsx` | 857 | **87** |
| `DristiPage.jsx` | 603 | **75** |
| `VikrayPage.jsx` | 756 | **71** |

**Srijan / Hub is the largest single cluster in the codebase** — 830 inline
styles across four files — and it is the area the owner named as half-baked. It
was not in the first four agents.

### Where the work already landed

`admin`, `client`, `onboarding`, `today`, `esign`, `sanvaad` and `customize` are
at or near zero. Those areas were converted properly. The pattern is not random:
they are the surfaces an agent was told to BUILD rather than to audit.

## Landed since this file was written

**vetana — DONE, verified against the directory rather than the entry point.**
`VetanaPage.jsx` 857 lines / 87 inline → **178 / 0**; `vetana/` is 7 tab files
carrying **3** inline between them, all the same `width: ${pct}%` proportion bar,
which is a genuinely per-instance computed value. 87 → 3 for the whole module.
This is what "done" looks like, against which graha's 648 and manav's 609 are
not.

Two defects it found that the measurement could never have shown:
- Six `catch {}` blocks each followed by a `length === 0` check, so **a failed
  request rendered "No payroll runs"** — on a payroll screen that sentence says
  nobody is owed anything, and a broken page is pixel-identical to a company
  with no employees.
- **`process_payroll` emails every employee** with their payslip attached, and
  re-running a month rebuilds them — so a second click is a second round of mail
  to everybody. It fired on one unconfirmed click.

**dristi — DONE, verified on the directory.** `DristiPage.jsx` 603 / 75 → **153 /
0**; `dristi/` is 9 tab files carrying **3**, and all three are `--h`/`--w`
custom properties feeding a rule in `module.css` — the same pattern
`graha/PipelineTab` uses for `--c`, so they are not hardcoded values at all.
Charts are CSS, so they inherit theme, density and type scale.

Its findings, none of which the inline-style metric could see:
- **Both list endpoints were unreadable.** `/scheduled-reports` and `/dashboards`
  answer `{"data":[…]}`; both call sites tested `Array.isArray(r.data)` against
  the **envelope**, so both rendered `[]` unconditionally. Every saved dashboard
  and scheduled report an org had was invisible, under a page offering to make
  another.
- **All five export buttons were dead** — `window.open` on a site-relative path,
  wrong origin in every environment, no bearer token.
- **`/pipeline` and `/sales` had no source-module check** — same class as the
  already-fixed `/overview` bug. A `dristi` grant alone read the full CRM
  pipeline, named customers, the order book, and every salesperson's target vs
  actual.
- **`.mt__b` had no `display`/`gap`**, so the two scripts were glued in every
  module tab — "Overviewसारांश". **Nine pages render that strip; all nine had
  it.** This is part of what the owner meant by "things are not in line". Fixed
  in shared CSS, so the remaining agents inherit it.

**prachar — DONE, verified on the directory.** `PracharPage.jsx` 1,021 lines /
108 inline → **141 / 0**; `prachar/` is 9 tab files. The script above reports
**10** for the directory; **8 are real and all 8 are `style={{ '--c': … }}`** —
a custom property feeding `.pr__pill` / `.pr__wcard` / `.tag`, the same pattern
`graha/PipelineTab` and `dristi/` use, so they are not hardcoded values. The
other **2 are prose inside comments** — the script matches `style={{` textually,
so a docblock quoting the defect it fixed counts as the defect. Worth knowing
before this metric is used to judge a file: **it cannot tell a value from a
token, or code from a comment.** 108 → 8 for the whole module, raw property
values **0**.

What the metric could not see, and what actually made the module unusable:

- **Five of the eight tabs could not render.** `api.get()` resolves to the axios
  RESPONSE and every list route answers `{"data":[…]}`, so the array is
  `r.data.data`. Campaigns, Templates, Automations, Unsubscribes and Events all
  did `setX(r.data)` then `X.map(…)` on the envelope — a `TypeError`, blank
  panel. **This is the third module in this run with the identical bug** (dristi
  had it on both list endpoints); it is a codebase-wide shape problem, not three
  coincidences.
- **Ads set state to the axios object itself**, so every spend, impression and
  conversion figure rendered `0`.
- **The whole design was missing.** The reference for this module is a month
  CALENDAR of campaigns, drag-to-reschedule, tinted by channel. The build had a
  flat list of cards with no date on them. `scheduled_at` and `channel` have been
  on the table since migration 021 and `PATCH` has always accepted a new date —
  every part of it was already backed by the API and none of it was built.
- `POST /sequences` sent three fields the model does not have and omitted
  `exit_on_reply`, which decides whether a contact who **replies** keeps getting
  the drip. The list then rendered `s.channel`, a column that does not exist, as
  "undefined" on every row.
- The step form offered **SMS**; `add_step` validates against
  `(email, whatsapp, call_task, manual)` and 400s otherwise.
- Event edit sliced the **UTC** clock face into a `datetime-local`, so opening an
  event and pressing Save moved it back 5½ hours.

## Cross-cutting, and confirmed twice

- **The :5173 dev server runs from `D:\Projects\Kartavya`, not from any
  worktree.** `preview_start` reuses it, so an agent screenshotting through it is
  looking at whatever code the main checkout has — possibly another agent's.
  The shared Playwright browser was also navigated away mid-session by a peer
  agent. Any agent verifying via the shared browser may be reporting someone
  else's page; only a private port on the agent's own worktree is trustworthy.
- **Worktrees keep seeding from a 710-commit-old commit** (`1aa49855`, unrelated
  R2/CORS work). Six worktrees sit on it. An agent that doesn't check builds
  against a pre-design-run codebase and "cannot find" files that exist.
- `useTabPanelMotion` returns `{key, style}` spread as `{...motion}`; React warns
  on `key` in a spread. Identical across graha/ganit/manav/vikray/dristi — **one
  shared fix, not five**, and deliberately left so five agents don't each edit
  the others' files. (Fixed in `PracharPage` only, where it is that file's own
  line; the other five are untouched.)
- **Two agents fixed the `.mt__b` glued-scripts bug in the same run, in different
  selectors, and git merged both.** dristi used `display:inline-flex; gap:7px` on
  `.mt__b`; prachar used `margin-left:6px` on `.mt__hi`. They do not override
  each other — **a flex gap and a margin ADD** — so the merged result was 13px
  where either alone gives 6–7px. Resolved on the prachar merge by keeping the
  gap and dropping the margin, which also exposed a now-doubled
  `margin-left:6px` on `.mt__b .mt__n` predating the flex change. Re-measured:
  7px on both sides. **Two agents fixing one shared bug is not free — check
  whether a peer already fixed it before adding a second mechanism.**
- **`r.data` vs `r.data.data` is codebase-wide.** dristi (2 endpoints) and
  prachar (6) are fixed. **`TaskDrawer.jsx:196` is still live**:
  `r.data.forEach(…)` on an envelope, throwing `TypeError` as two Unhandled
  Rejections in `task-flow.test.jsx` — and the suite still reports 587 passed,
  because an unhandled rejection is not an assertion. A green suite is not
  evidence here.

## Corrections to agent reports — verify before acting on these

Two claims in the prachar report do not survive checking. Both would cause
damage if acted on, which is the whole reason this section exists.

**1. `TaskDrawer.jsx:196` is NOT the envelope bug.** There is no
response-wrapping middleware; the shape is decided per route, and `fields.py`
returns **bare arrays** at `:105` and `:194`. So `r.data.forEach(…)` there is
correct, and "fixing" it to `r.data.data` would break a working drawer.

There IS a real defect at that spot, smaller and different: the two inner
`api.get(…).then(…)` chains carry **no `.catch`** — the trailing
`.catch(logger.error)` belongs to the outer chain — so a failed fields fetch
rejects unhandled and the drawer silently renders no custom fields. That is what
`task-flow.test.jsx` is surfacing. The report's point about a green suite
hiding it stands; the diagnosis does not.

**2. "codebase-wide shape problem" — overstated as a live bug, understated as a
design flaw.** I scanned every `api.get` call site against its resolved backend
route:

| | |
|---|---|
| call sites consistent with their endpoint | **117** |
| confirmed mismatches | **0** |
| routes I could not resolve statically | **140** |

The single hit my scan produced — `manav/AttendanceTab.jsx:31` — is a false
positive: it keeps the envelope on purpose, because the JSX reads both
`summary.month` and `summary.data`. prachar and dristi's own fixes were real;
there is no third victim among the call sites that can be resolved.

**140 unresolved is a real limit, not a rounding error** — routes defined in
`server.py` rather than in `routers/`, and paths built at runtime. Treat this as
"no evidence of more", never as "there are no more".

The genuine finding underneath is a design inconsistency worth fixing on its own
schedule: **99 GET routes return `{"data": […]}` and 28 return a bare list, with
no rule.** Every call site has to remember which. That is what produced eight
real bugs across two modules, and it will keep producing them.

## In flight

One agent remains, briefed to build rather than audit: **vikray**
(756 lines / 71 inline, unsplit). It carries split-then-style, `vite build` in the
gate, and its verified reference file — `ScreenPrachar`, `ScreenDristi` and
`ScreenVetana` are all in `ScreensMore.jsx`; `ScreenVikray` is in `ScreensBiz.jsx`;
`ScreenGraha` is in `ScreensCore.jsx`. Three briefs this week sent an agent to the
wrong file, so check here before naming one.

## Not started

- **Srijan / Hub** — 830 inline, four files, largest cluster, owner-named.
- **graha / manav / ganit tab bodies** — 1,805 inline between them, behind route
  files that already look finished.
- The remaining top-level pages: `TemplatesPage` 60, `ApprovePage` 52,
  `ProjectsPage` 47.

## The rule this file exists to enforce

A module is done when its TABS are converted, not when its route file is thin.
Measure the directory, never the entry point.
