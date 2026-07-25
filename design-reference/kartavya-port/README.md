# Kartavya — Editorial port (handoff package)

This folder contains **two complementary deliverables** for moving the
editorial-typographic redesign from the HTML prototype into your live
`frontend/` codebase on `main`.

```
kartavya-port/
├── README.md               ← this file
├── COMMIT_GUIDE.md         ← exact branch + commit sequence
├── frontend/               ← drop-in files that mirror your repo structure 1:1
│   └── src/
│       ├── styles/editorial.css           NEW
│       ├── lib/brand.js                   EXTENDED (keeps original exports)
│       ├── context/AppearanceContext.js   NEW
│       ├── components/AppearancePanel.jsx NEW
│       ├── components/editorial/          NEW — design primitives
│       └── pages/DashboardPage.jsx        REWRITTEN — wired to real API
└── design_handoff_editorial/
    ├── README.md           ← screen-by-screen spec
    ├── Kartavya App.html   ← HTML reference (copy of prototype root)
    └── src/                ← HTML reference (copy of prototype src/)
```

## How to use this

### Path A — You commit it yourself
1. Open `COMMIT_GUIDE.md`. Follow the steps top to bottom on `main`.
2. Each commit is small, scoped, and labeled. Pause after each `npm start`
   check; if the build breaks, the last commit is your suspect.

### Path B — Claude Code takes over
1. Pull this `kartavya-port/` folder into your repo's root (or wherever
   convenient — Claude Code will read it from anywhere).
2. Open Claude Code in your repo.
3. Prompt:
   > "Read `kartavya-port/COMMIT_GUIDE.md` and `kartavya-port/design_handoff_editorial/README.md`. Then apply the changes in order on `main`. After the first commit (`editorial.css` + tokens), run `npm start` and screenshot the dashboard. Continue if it loads."
4. Claude Code will copy each file into place, run the dev server between
   commits, and stop on errors. The handoff README gives it the full screen
   spec for the remaining 11 screens (it can carry the same patterns forward).

## What's in scope here

Already ported and committed in this package:
- **Editorial design system** as a thin layer over your existing `tokens.css` — paper-cream surfaces, Devanagari typography, Newsreader display font, accent variants.
- **Appearance context + Customize panel** — theme/lang/density/font/accent, persisted to `localStorage`, drives `data-*` attributes on `<html>`.
- **Dashboard page** rewrite, fully wired to your real `/dashboards/`, `/tasks`, `/teams` endpoints. Drop-in replacement for `pages/DashboardPage.jsx`.
- **Editorial primitives** (`Hero`, `PageHeader`, `Card`, `StatTile`, `DueChip`, `AvatarStack`, `PriorityDot`, `ProjectTag`) — used by the new dashboard, and by every other page when you port them next.

Not yet ported (specs in `design_handoff_editorial/README.md`):
- Tasks, Boards/Kanban, Projects, Team, Inbox, Approvals, Activity, Automations, TimeReport, Templates, Categories, Admin.
- They share the same primitives and the same data plumbing pattern as Dashboard. Each is ~30 min of work with the prototype open.

## Brand compatibility

Your existing tokens (`--accent-default: #1AB8B0`, sidebar `#050e1a`,
Inter UI, Harabara Mais wordmark) all stay. The editorial layer adds
**new variables on top** (paper canvas, ink-2/ink-3 scale, Newsreader,
Tiro Devanagari Hindi). Nothing existing is overwritten — the original
Nunito + Tailwind utility classes keep working in every screen you
haven't migrated yet.

## Branch policy

You asked for direct-to-`main`. The COMMIT_GUIDE is structured so each
step is independently revertable. If you'd rather use a feature branch,
just `git checkout -b feat/editorial-redesign` before step 1 and PR at
the end.
