# Handover — the corner dock (page-aware quick actions)

**Written 2026-08-20. Research and design only; no product code has been written.**

Paste the "Prompt" section below as the first message of a fresh session to carry this
forward. Everything under it is the supporting detail.

---

## Prompt

~~~text
CONTEXT
You are picking up design research on Kartavya (PM SaaS for Indian firms, Aekam Inc).
Repo: D:\Projects\Kartavya, branch `staging`. Read CLAUDE.md first — house rules are
binding (proposals go in docs/proposals/ as self-contained HTML, never Markdown;
staging and production SHARE ONE Supabase database, so reads only, never write probes).

THE IDEA UNDER INVESTIGATION
A small dock in the bottom-right corner of every module page that surfaces what applies
to THAT page — skills, saved metrics, automation templates, statutory due dates — and
runs them in place instead of making the user navigate to Sahayak/Dristi/Niyam.
Owner's original framing was "a small chatbot"; the research argued for a dock that
lists and acts, with a link into Sahayak chat as the escape hatch, not a second chat box.

WHAT ALREADY EXISTS — READ THESE BEFORE ANYTHING ELSE
  docs/proposals/71-the-skill-that-finds-you.html   the written proposal
  docs/proposals/72-the-corner-interactive.html     a working clickable demo
Both are done and delivered. Nothing has been built in the product. No code in
frontend/ or backend/ has been touched.

VERIFIED FACTS (read live from the DB on 2026-08-20 — do not re-derive, do not trust
any summary that contradicts these)
- 40 active skills in staging.hub_skill_templates.
  By module: ganit 19, srijan 6, graha 4, vetana 4, kartavya 3, manav 2, vikray 2.
  ZERO for: prachar, dristi, sanvaad, esign, varta, pahchan.
- Adoption numbers PROVE NOTHING and must not be used as an argument. There are only
  3 organisations in the entire database, all internal. 21 of the 30 "never adopted"
  skills were seeded on 2026-08-20 by migrations 167 and 171 — they are hours old.
  An earlier draft argued from these numbers and was wrong. The case rests on
  STRUCTURE (a 5-click path to a 40-item catalogue), not on usage.
- Coverage complementarity — this is the central finding:
  skills cover 7 modules, Niyam automations cover 11, analytics metrics cover 14.
  The empty tab is never the same tab twice, so a four-section dock always has
  something true to say. A skills-only dock cannot promise that.

IMPLEMENTATION FACTS ALREADY ESTABLISHED
- Skills are page-scopable today: hub_skill_templates.module exists, with a CHECK
  constraint (migration 166 backfilled the last 8 NULLs).
- ONE BACKEND LINE IS THE WHOLE BACKEND CHANGE: GET /v1/hub/org/skills in
  backend/routers/hub.py (~line 2422) does not select t.module or t.skill_type.
  Add them. /v1/hub/skills/templates is already SELECT *. No migration needed.
- Running reuses POST /v1/hub/org/skills/{id}/run — same call frontend/src/pages/
  sahayak/SkillsTab.jsx already makes. Results render in components/skills/SkillDrawer.jsx.
- Analytics metrics are a code registry: backend/analytics/metrics/*.py, 14 modules,
  each metric has key + label. Presets are CODE not rows (backend/analytics/presets.py).
  Saved views live in staging.analytics_views and DO carry a `module` column, but 11 of
  the 12 live rows are on 'dristi', so the registry is the useful source, not saved views.
- Niyam: 38 templates in backend/services/niyam/templates.py, keyed on event_type NOT
  module — a page-aware section needs an event_type→module map (code only, no migration).
  Live: 4 rules, 2 armed, against 260 events in 7 days. The engine works; the builder
  is a destination nobody visits.
- statute_calendar: 45 rows, keyed on `authority` (gst/epfo/esic), with periodicity and
  due_day. Roughly half are "standing" rules (rates, ceilings) with no date. Dated law —
  any read MUST respect effective_from/effective_to.
- The corner is not empty: .k-onboard (fixed right:20 bottom:20, z-index 400) is real and
  mounted in AppShell. .k-cust-launch (same coords, z-index 90) is DEAD CSS — no JSX
  renders it. Mobile bottom nav owns the corner on phones; dock is desktop-only.
- CmdK already exists with ONE command registry (frontend/src/lib/commands.js). It exists
  because there were once three lists and two palettes both bound to CmdK. Skills join
  that registry — never start a fourth list.

RULES THE DOCK MUST OBEY
- Offer only what the caller can actually run. backend/services/skills/modules.py refuses
  callers lacking any module a handler touches. Grey out with a reason; never 403 on click.
- estimated_credits must be shown truthfully. Migration 166 fixed 13 cards that read
  "0 credits" and charged 2. Never round, hide, or default it.
- Names, not IDs. No UUID reaches the DOM (ratchet: frontend/scripts/check-rendered-ids.mjs).
- Say what a run does BEFORE it runs: "reads only" for a check, "drafts, sends nothing"
  for a pack. The collection pack must never read as though it will send.
- Arming a Niyam rule from a corner popover is deliberately NOT offered.

OPEN QUESTIONS THE OWNER HAS NOT ANSWERED — DO NOT BUILD UNTIL THESE ARE SETTLED
1. Tabs (as demoed) or one merged list ranked by urgency?
2. Does the pill show a count? A count invites a badge, a badge invites "unread", and the
   corner becomes a second inbox.
3. Every page inside the app shell, or module pages only?
4. Phase 1 (skills only) or all four sections at once? The demo's coverage finding argues
   for all four; the recommendation on record was phase 1 only, made before that finding.
5. Ordering rule for the 19 ganit skills — undecided.

WORKING GOTCHAS
- The in-app preview pane renders local HTML as a STATIC SNAPSHOT and does not run
  scripts. To verify an interactive demo: serve it (python -m http.server from
  docs/proposals) and drive it with the Playwright MCP against 127.0.0.1. Playwright
  blocks the file: protocol.
- Every proposal HTML needs <meta charset="utf-8"> as its first line or em-dashes and
  Devanagari mangle. 63 of 74 existing proposals have it; 71 and 72 now do too.
- Backend tests run from backend/, never the repo root.

WHAT TO DO NEXT
Ask the owner the five open questions above before writing any product code. If the
owner has already answered them in the message that follows this prompt, implement
phase 1 as scoped: the one-line backend change, frontend/src/components/skills/
SkillDock.jsx, a route→module map beside lib/moduleColors.js, mounted ONCE in AppShell
next to CommandPalette and OnboardingChecklist. Never mount per page.
~~~

---

## Supporting detail

### Live catalogue distribution, 2026-08-20

| Module | Page | Skills | Shape |
|---|---|---:|---|
| ganit | Accounts / invoices | 19 | 9 check, 7 brief, 3 pack |
| srijan | Content / Sahayak | 6 | 6 content — the only priced ones |
| graha | CRM | 4 | 3 brief, 1 pack |
| vetana | Payroll | 4 | 3 check, 1 brief |
| kartavya | Core PM | 3 | 3 brief |
| manav | HR | 2 | 1 check, 1 brief |
| vikray | Sales / stock | 2 | 2 check |
| prachar, dristi, sanvaad, esign, varta, pahchan | — | 0 | — |

### What each dock section would read

| Section | Source today | Page-scoped already? | Work to wire |
|---|---|---|---|
| Skills | 40 rows, `hub_skill_templates` | yes — `module` column | 2 columns onto one SELECT |
| Numbers | metric registry, `analytics/metrics/*.py`, 14 modules | yes — keyed by module | none; already served |
| Automate | 38 templates, `niyam/templates.py` | no — keyed on `event_type` | event → module map, in code |
| Due | 45 rows, `statute_calendar` | no — keyed on `authority` | authority → module map + next-date maths |

### Queries used (all read-only, against the shared Supabase DB)

```sql
-- catalogue by module and type
SELECT COALESCE(module,'(none)'), skill_type, count(*),
       sum(CASE WHEN estimated_credits>0 THEN 1 ELSE 0 END) AS paid
  FROM staging.hub_skill_templates WHERE is_active GROUP BY 1,2 ORDER BY 1,2;

-- the adoption trap: check seeded dates before arguing from grants
SELECT created_at::date, count(*), count(*) FILTER (WHERE g.n IS NULL) AS never_granted
  FROM staging.hub_skill_templates t
  LEFT JOIN (SELECT template_id, count(*) n FROM staging.hub_org_skills
              WHERE is_active GROUP BY 1) g ON g.template_id = t.id
 WHERE t.is_active GROUP BY 1 ORDER BY 1;

-- how much of the product is actually in use
SELECT (SELECT count(*) FROM staging.organisations) AS orgs_total,
       (SELECT count(*) FROM staging.hub_org_skill_runs) AS org_runs_ever,
       (SELECT count(*) FROM staging.niyam_rules WHERE is_armed) AS rules_armed;
```

### Decisions taken during the research

- **Dock, not chatbot.** Sahayak chat already exists and is unfinished (dead citations,
  nothing streams). A second chat surface doubles the broken surface and still makes the
  user guess the vocabulary. Chat is the escape hatch at the bottom of the dock.
- **Zero AI in the suggestion.** It is a filter on a column, so it costs nothing to open
  and cannot hallucinate a skill that does not exist.
- **Empty states tell the truth** and are the demand signal — which module a firm opened
  the dock on and found nothing is the only roadmap input we can get before customers
  arrive.
- **Rejected from the corner:** a chat box, hand-curated page→skill mappings (the `module`
  column already is one), AI ranking of four rows, notifications/approvals (they have a
  home and a badge), recents (that is CmdK), and the DSC/UDIN registers (0 rows).
