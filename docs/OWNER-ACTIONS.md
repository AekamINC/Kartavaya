# Owner actions — the live blocked list

**This file is the only place I ask you for something.** It is a living file, not a
date-stamped one: I add to it the moment something is blocked on you, and I strike items
off as you action them.

## How this works

- **I never stop.** If a piece of work needs you, it lands here and I carry on with
  everything that does not.
- **A block parks a piece, never a batch, and never a workstream.** Nothing is reported
  as done because the rest of it was blocked.
- **The moment you action an item, I finish the piece it was holding** — you do not need
  to tell me to come back to it.
- Every entry says: what is blocked, exactly what you do, and what I finish once you have.

Status key: **OPEN** — waiting on you · **DONE** — actioned, and I have finished the work
behind it.

---

## OPEN

### 1. Two crons need arming

**Status:** OPEN · not urgent — both queues are empty today, so arming sends nothing.
Housekeeping, not an outage.

**Why it is here:** I have Railway approval and the CLI is authenticated, so I intend to
do this myself via `railway config pull / plan / apply`. This entry exists only in case
the IaC route cannot express the cron schedule — if it can, I will do it and mark this
DONE without you.

**If it falls to you:** Railway → `cron-publish` → Settings.

Start Command (literal — Railway does not shell-interpret this field):

```
sh -c 'rc=0; for p in publish; do c=$(curl -sS -m 600 -o /tmp/o -w "%{http_code}" -X POST -H "X-Cron-Secret: $CRON_SECRET" "https://kartavya-staging.up.railway.app/api/internal/cron/$p"); echo "$p -> $c $(head -c 1000 /tmp/o)"; [ "$c" = "200" ] || rc=1; done; exit $rc'
```

Cron Schedule: `*/15 * * * *`

Then force a **fresh** deploy — a redeploy reuses the old config snapshot, so the service
looks armed while running the empty command. Once it returns 200, `publish` comes out of
the `cron-daily` list (`hr invoices crm stock marketing publish skills scraper-prices`).

**What I finish once done:** verify a live 200, then remove `publish` from `cron-daily`.

---

### 2. Drop the `qa_cleanup_20260822` restore schema?

**Status:** OPEN · no rush, it costs nothing to keep.

It holds the full restore point for the 22 Aug deletion — 263 tasks and their children,
the evicted `team_members` and `user_roles` rows, and `niyam_rules_before_arming`.

**What you do:** tell me you are satisfied nothing is missing.

**What I finish once done:** drop the schema.

---

### 3. Unicode Group has no owner — name one and I will appoint them

**Status:** OPEN · this is the only thing between that org and its own settings.

**What I measured** (live database, 2026-08-22): Unicode Group holds **5
`org_admin` rows and 0 `org_owner`**. Aekam Inc and the test org have one each.

**Why it matters.** `org_owner` is the authority that appoints a payroll
approver, and it is the ONLY role that may switch the organisation's own modules
on and off (`PATCH /v1/org/modules` is gated `ORG_OWNER_ONLY`). Unicode Group
cannot do either, and until today could not acquire an owner by any route: the
console could not assign one, the org could not invite one — only an existing
owner may mint another, a bootstrap that could never start — and
`role_tiers.refuse_grant` carries a documented fallback whose whole purpose is
to stop that org being locked out of appointing an approver.

**What I have already done.** Every organisation created from now on seats its
founder as `org_owner` (`create_org`), and there is a new god-mode-only console
action, `POST /api/v1/admin/orgs/{org_id}/owner`, which appoints an owner for an
org that has NONE. It 409s if the org already has one, and it will only raise
somebody who is already an `org_admin` of that organisation — so it is a
bootstrap, never a way for Aekam to change who runs a customer's firm.

**What you do:** tell me which of Unicode Group's five administrators is the
owner. I will not guess: this decides who can appoint the person that releases
their payroll.

**What I finish once you have:** run the appointment, verify the row, and
re-examine whether `refuse_grant`'s no-owner fallback can be retired.

---

### 4. Ten exits carry an old clearance shape — normalise them, or leave them?

**Status:** OPEN · the guard is fixed either way; this is about the ten rows.

**What I found.** `POST /v1/manav/offboarding/{id}/complete` refuses to close an
exit while clearance is outstanding — "what it cannot do is close silently and
discover next quarter that a laptop was never returned". **That guard has never
fired.** It read the column as a list of `{item, owner, done}`, and 10 of the 11
live exits carry an older shape, an object: `{"hr": false, "finance": false,
"it_assets": true}`. Iterating an object yields strings, nothing is ever counted
as pending, and the exit closes with every item untouched. Two exits have
already been closed that way. The screen showed an empty checklist rather than a
half-ticked one, which is why nobody noticed.

**Already done, no decision needed:** the backend now reads both shapes, and the
screen renders the object form as a real, tickable checklist. Ticking an item
writes the new shape, so the ten rows convert themselves one deliberate click at
a time.

**What you decide:** whether I should also rewrite the ten rows into the new
shape in one pass. I have not, because they are somebody's real clearance state
and changing a customer's data to suit our newer shape is a different decision
from reading what is there.

**Also worth your eye, and NOT something I can decide:** two exits were completed
with clearance untouched. If a laptop or an ID card is genuinely outstanding on
either, that is a real-world chase, not a code fix. I can name the two records
whenever you want them.

**What I finish once you say:** one migration, backed up first, counts verified.

---

### 5. The 10 org-less projects — I measured them, and they are not what we assumed

**Status:** OPEN · this is the last thing between tenancy phase 3 and the
`org_id NOT NULL` constraint (PROPOSED_079). Everything else in the cutover is
done.

**The standing assumption**, which I was told and which I checked rather than
trusted: *"teams with org_id NULL are live projects"*. Measured against the live
database on 2026-08-22, all ten are test debris:

| what | count | evidence |
|---|---|---|
| soft-deleted "Solar Technocast" duplicates | **8** | created 18 Jul within 30 seconds of each other, `deleted_at` 25 Jul, **0 tasks each** |
| "FY 2026-27 Statutory Audit — Shah & Associates" and "…Shah and Associates" | **2** | created 28 Jul 43 seconds apart, near-duplicate names, **0 tasks**, only the 5 default columns |

The two that are not deleted were **created by the QA Org Admin account** — one
of the logins evicted from every live org in the 22 August cleanup — with
Kartavya App Admin as the other owner. Neither belongs to any organisation,
neither has ever held a task, and nobody outside those two accounts can see
them.

**Why it matters now.** PROPOSED_079 constrains `teams.org_id` to NOT NULL.
That is phase 4 of the cutover and it fails while any of these ten exists.
PROPOSED_078's own open question (Q5, decision 1) is exactly this.

**What you decide** — three options, my recommendation first:

1. **Delete all ten.** They are QA artefacts with no tasks, and eight are
   already deleted. Backed up to a restore schema first, counts verified after,
   the same way the 22 August cleanup was done.
2. Assign the two live ones to an organisation, and delete the eight deleted
   ones. Says which firm they belong to — but they have no content to belong to
   anyone.
3. Leave `teams.org_id` nullable permanently, and drop PROPOSED_079's
   constraint. This keeps the door open for a project that belongs to no
   organisation, which is a real thing to want and a real thing to have to
   defend for every query that scopes by org.

**I have not touched them.** You named org-less teams specifically as the thing
not to clean, and the measurement disagreeing with that is exactly when I should
show you the measurement rather than act on it. A delete is irreversible.

**What I finish once you say:** the deletion or the assignment, then PROPOSED_079
and PROPOSED_081 (RLS is on for 98 tables and off for 203). The rename in
PROPOSED_080 stays last and stays a separate decision — its own header says to
watch a full business cycle between the rename and the drop.

---

## DONE

*(nothing yet — items move here with the date and what I finished)*
