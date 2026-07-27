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

## In flight

Four agents, one per module, briefed to build rather than audit: **prachar,
vikray, dristi, vetana**. Each carries split-then-style, `vite build` in the
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
