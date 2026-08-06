# 30 · Skills marketplace

**Prerequisites:** `00-tokens.md`, `02-common-components.md`, `29-sahayak.md`.
**Prototype:** `Kartavaya Redesign/Skills Marketplace.html` · `marketplace.css` ·
`Mkt.jsx`, `MktData.jsx`.

## Files to change
- `pages/HubSkillsPage.jsx` and `pages/hub/skills/` (`AssignedTab`, `CatalogTab`, `CreateTab`, `GuideTab`, `_shared.jsx`)
- `pages/srijan/SkillsTab.jsx` — the org-side catalogue
- `styles/marketplace.css` — **15 KB already exists upstream** for the scraper marketplace. Read it before adding; the two may share more than the name

## Files to create
- `components/skills/SkillCard.jsx`, `SkillGlyph.jsx`, `SkillDrawer.jsx`
- `components/skills/ContextStrip.jsx` — the in-module entry point (§6)

## Estimated scope
Two existing surfaces merged into one, plus a drawer and a contextual strip.
No new tables.

---

## 1 · It is a catalogue you request from, not one you install from

**This is the constraint the whole design is built around, and it is real today:**
`assign_skill_to_org` is guarded by `OPERATIONS_CONSOLE_ROLES`, which holds **no
org-tier role**. An owner cannot add a skill. An org admin cannot. A `srijan_admin`
cannot — `SKILL_AUTHOR_ROLES` is authoring, not assignment.

So the existing catalogue already says *"Aekam adds this"* and *"Ask your account
contact"*, which is honest. The design decision was whether to change the rule or
design for it, and the answer is **design for it**.

An app store whose buttons all say "ask someone" is demoralising, so the surface
spends its weight on the two things a requester actually needs — **what the skill
will read and change**, and **what a run costs** — and makes the request itself a
decision rather than a form. The request carries a free-text note, because "what
do you want it for" is the question the account contact would otherwise have to
ask by email.

Three reasons the rule is defensible, and they belong in the copy:

1. Adding a skill changes what **everyone** in the organisation can run.
2. It changes what the organisation **spends**.
3. Some skills read payroll, identity or attendance data (§4).

**Do not build a self-serve install path behind a feature flag.** A button that
403s is worse than a button that is honest about who presses it.

## 2 · One catalogue, two audiences, one surface

There are two skill screens today and they read the same `GET /v1/hub/skills/templates`:

| Today | Reads | Becomes |
|---|---|---|
| `HubSkillsPage.jsx` | `/v1/hub/clients/:id/skills` — per **client**, agency-side | Keeps its client scope. Same card, same drawer |
| `srijan/SkillsTab.jsx` | `/v1/hub/org/skills` — the org's **own** | Becomes the marketplace in Sahayak |

Both get the same components. The only difference is the scope of "assigned".

## 3 · The permission list is the product

Before a request, the drawer states in two separate lists:

- **What it reads** — neutral tone, a check glyph.
- **What it changes** — `--warn`, and it comes **second**, because that is the
  half a person has to think about.

`WRITE_SKILL_FUNCTIONS` is the set that can change something, and it is already
the distinction the dispatcher makes. A read-only skill says so explicitly —
*"Nothing. This skill only reads and reports."* — because an absence announces
nothing, and a missing section reads as an omission rather than as a guarantee.

Where a skill proposes rather than acts, say it in the write list itself:
*"Nothing. Proposals only, until you accept them."* Expense categorisation and
contact de-duplication are both this shape, and both would be alarming without
the sentence.

## 4 · Sensitive skills

A skill touching Vetana, Manav or Pahchan data carries a `Sensitive` marker on
the card and in the drawer. This is not a permission — it is a prompt to think,
and it aligns with the standing rule that Vetana, Manav and Ganit default to no
access **by role, not by opt-out** (`08-rbac-screens.md`).

Attendance is the sharpest case: `staging.manav_employees` stores `aadhaar` and
`pan` as plaintext, and `07-pahchan.md` §10.3 notes that adding face photos to the
same row makes it a full identity kit. A skill that reads those rows should say so
before it is requested, not after.

## 5 · Cost, honestly

| Line | Source |
|---|---|
| Data steps | free — a database read |
| AI steps | metered, from the **live cost table** |
| Per run | the sum |
| One-off setup | optional, per skill, set by Aekam. Most are ₹0 |

**Never print a credit figure this page computed itself.** The catalogue already
shipped this bug once: `t.estimated_credits` was preferred over a live
computation, so *Festival Calendar* read ~99 credits on one tab and 5 on another,
from one endpoint, on the screen a customer buys from. `packPrice()` exists for
exactly this and returns `{live, listed, stale}` — show `live`, and show
`listed` beside it only when they disagree.

The drawer says so out loud: *"Credit costs come from the live cost table, not
from this page."* A figure that disagrees with what you were charged is worse than
no figure.

## 6 · Two entry points

**Global browse**, in Sahayak. Three models; the prototype switches between them.

| | What it is | Ship it? |
|---|---|---|
| Gallery | Featured strip, then cards | **Yes**, as the default. Sets the right expectation — you are choosing something that will run against your books |
| By module | Grouped dense rows | **Yes**, as a toggle. The fastest view for an admin auditing what is on |
| By problem | Starts from the complaint — "customers pay us late" | **Yes, and it is the one that converts.** Nobody wakes up wanting a skill |

**Contextual discovery**, at the foot of the module page. The person staring at a
list of overdue invoices has already had the thought; they are never going to go
looking in a marketplace for it. `.mk-ctx` on the Ganit page lists Ganit skills
with their status and run cost. This is the second entry point and it is not
optional — a marketplace nobody visits is a catalogue nobody reads.

## 7 · Icons — built objects, not line glyphs

A skill is a thing you acquire, so its icon is drawn as an object with volume: an
axonometric solid in **three tonal steps of the module's own colour**, lit from the
upper right, on a soft contact shadow, on a raised chip with a 1px tonal ring and
a white inset along the top edge.

**Three flat fills, not a gradient.** Top face mixed toward white, right face the
colour itself, left face mixed toward black. Flat fills flatten identically at
every size and survive a theme flip; a gradient does neither. Dark mode lifts the
top face further and swaps the tinted shadow for a black one, or the object reads
as a single silhouette.

Everything is composed from **three primitives** — `isoBox`, `isoDisc`, and a
contact ellipse — so twelve icons share one geometry and look like a set. A
thirteenth skill is one row of `MK_SCENES`, not a new drawing.

**Silhouette does the work at 40px; detail is deliberately absent** because it
turns to mud. That constraint is also the thing to check: two rounds were needed
here, and both failures were silhouette failures rather than colour ones.

- The first pass used **one shared glyph per `skill_type`**, which made twelve
  different jobs look like four and left the card's most scannable element
  carrying the least information on it.
- The second pass gave each skill its own object but produced **three near-identical
  stepped-block silhouettes** (stale deals, escalation, shifts) and **two
  near-identical disc-on-a-post ones** (attendance, onboarding). Fixed by making
  the roster grid uniform-height, the pipeline narrowing, and the escalation
  ascending — and by giving attendance a wide dial and onboarding a narrow figure
  on a card.

**Review a new icon against the other eleven at 40px, never on its own.** The pip
in the corner is the `skill_type` in its own tone, and a legend decodes it —
without one, a coloured dot is decoration.

## 8 · A skill that cannot run must not be offered

`blockersFor(steps, caps)` against `GET /v1/hub/skills/capabilities` — a pack
naming an unimplemented `skill_function`, or a module the org has not activated,
shows the reason **on the card** and the action is disabled with the reason as its
title. `caps.data === null` means *not loaded yet*, which must be treated as
unknown rather than as no problems.

Note `esign` and `srijan` are **BUNDLED_MODULES**, gated on `plans.features`
rather than `module_subscriptions`, and **the module gate caches for 5 minutes** —
so a freshly granted skill can read as blocked for up to five minutes. Say
"checked a moment ago" rather than asserting a blocker as permanent.

## 9 · "Reviewed", not "Verified"

Aekam authors every skill, so a verified badge is not a trust signal **between
publishers** — there is only one publisher. The badge says the steps were reviewed
against the modules they touch, which is the claim that can actually be made.
Label it *Reviewed*.

If third-party authoring is ever opened up, this badge has to change meaning
before it changes appearance, and the permission list in §3 becomes the primary
control rather than a supporting one.

## 10 · Endpoints

| Verb | Route | Note |
|---|---|---|
| GET | `/v1/hub/skills/templates` | The catalogue. Both audiences read this |
| GET | `/v1/hub/org/skills` | What this org has active |
| GET | `/v1/hub/clients/:id/skills` | Agency-side, per client |
| GET | `/v1/hub/skills/capabilities` | §8 |
| GET | `/v1/hub/org/credits` | The live cost table. §5 |
| POST | `/v1/hub/org/skills/:id/run` | A run |
| POST | `/v1/hub/skills/:id/request` | **Confirmed in scope, 2026-08-06. Does not exist yet — build it.** §11 |

## 11 · The request endpoint

The primary action on this surface. Everything else on the page is a read.

```
POST /v1/hub/skills/:id/request
{ note: string }                     // free text, the requester's own words
→ 201 { request_id, status: 'open', requested_at }
```

The caller is the requester; do not accept a `user_id` from the body. Scope is
the caller's active org — the same org the catalogue was read as.

- **It lands as a lead for the account contact and emails them.** A request that
  only writes a row is a request nobody sees.
- **The note is the point.** "What do you want it for" is the question the
  account contact would otherwise ask by email, so ask it once, here.
- **Idempotent per org and skill while a request is open.** A second press
  returns the existing `request_id` rather than a second lead — people press
  twice, and two leads for one skill is a worse outcome than a slow first one.
- **The card and drawer read the state back**: *Available* → *Requested · 2 Aug*
  → *Active*. Without the middle state the button is pressed again tomorrow.
- **No status endpoint of its own.** `GET /v1/hub/org/skills` carries
  `request_status` and `requested_at` on each template row; one fetch already
  drives the whole catalogue and a second one would drift from it.

RBAC: any member may request. Requesting is not granting, and gating the request
reintroduces the ask-someone-to-ask-someone loop the surface exists to remove.

## 12 · What changes

| File | Change |
|---|---|
| `HubSkillsPage.jsx` | Four tabs → the marketplace plus an Active list. `CreateTab` stays, gated on `canManageSkills` as it already is |
| `srijan/SkillsTab.jsx` | Becomes the org marketplace. Two panes → gallery / module / problem |
| `hub/skills/_shared.jsx` | `packPrice`, `blockersFor`, `parseSteps`, `extractVariables` all survive unchanged. Add the glyph map |
| `hub/skills/CatalogTab.jsx` | Card → `SkillCard`; the assign button becomes the request drawer |
| — | `ContextStrip.jsx` added to each module page footer (§6) |
| — | `POST /v1/hub/skills/:id/request` in `routers/hub.py`, plus the lead row and the notification email (§11) |
