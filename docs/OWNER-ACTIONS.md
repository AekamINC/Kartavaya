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

### 6. Attendance photographs have never worked for two of your three orgs

**Status:** OPEN · fixed in code, but somebody should decide whether the missing
photographs matter.

**What I found while moving storage onto one key grammar.** `POST /v1/pahchan/punch`
refuses a photo whose object key does not look like one this product minted —
a sensible guard, without which a punch could name any file in the org's bucket:
an invoice, a payslip, somebody else's face.

The guard compared the key against `pahchan/{org_id}/punch/`. But the uploader
returns the key **with the tenant prefix already on it** — `org/{org_id}/pahchan/…`
for any org that does not have its own Cloudflare account. Two of your three orgs
are in exactly that state (Aekam Inc and the test org; only Unicode Group has its
own bucket). So for them, every punch that carried a photograph was refused with

> "That photo does not belong to this organisation's attendance store"

which was not true, and gave nobody anything to act on.

**Measured on the live database, 2026-08-23: 1,659 punches, ZERO with a photo.**

**Already done, no decision needed:** the guard now strips this org's own tenant
prefix before comparing, still refuses a key naming a different org, and accepts
both the old and the new key shape so a deploy cannot cost somebody a photograph.

**What you decide:** whether the attendance already recorded without photographs
needs anything. I have not touched a single punch row. Every one of those 1,659
punches is still a valid attendance record with its time, its location and its
flags — only the selfie is missing, and it was never captured, so there is
nothing to recover. If any of those days is disputed, the photograph will not
be there to settle it, and that is worth somebody knowing before it comes up.

**What I finish once you say:** nothing is blocked. This is here because a
feature that has never worked is a fact you should have rather than a line in a
commit message.

---

### 7. Two live orgs may have had a person's email rendered as their name

**Status:** OPEN · code is being fixed now; this is about what was already shown.

**What the audit-columns sweep turned up.** About twenty read paths across CRM,
messaging, reports, search, Dristi and Sales resolved a person's display name
with a ladder that ended at their **email address**:

    COALESCE(full_name, name, email)

So on any screen where an account had no name filled in, the product printed
that person's email address as their label — in a table cell, in a report, in a
chat sender line. Two standing rules meet there and both say no: Aekam must not
see client emails, and a person is named by their name.

**Also found and already fixed:** one CRM screen rendered a truncated raw user
id (`slice(0, 12)`) as a person, and the Sales targets table fell back to
rendering a `salesperson_id`. The names-not-ids ratchet is positional, so a
SLICED id walks straight past it — I have asked for that gap to be closed.

**What you decide:** nothing, to make the fix. The ladder now ends at a
non-identifying fallback instead of an address, and that is going in regardless.

**What is worth your judgement** is whether an address having been displayed
matters to you commercially — it would have appeared to whoever could already
open that screen, so this is not an external disclosure, and I have found no
path where one org saw another's. If you want, I can measure exactly how many
live accounts have no name and therefore could ever have triggered it; my
expectation is that the number is small and possibly zero, in which case the
ladder never fired and this is a latent fault rather than a past one.

**What I finish either way:** the ladder, everywhere, and the ratchet gap if it
can be closed without false positives.

---

## DONE

### 1. Two crons — ARMED, 2026-08-23 · nothing needed from you

Both are done, verified live, and this needed nothing from you in the end — the
infrastructure-as-code route did express a cron schedule, which is what this
entry said it was waiting to find out.

**`cron-publish`** was already armed and healthy when I looked: returning
`200 {"result":[],"left_behind":0,"organisations":0}` every fifteen minutes
against an empty queue. So the second half is what was owed — **`publish` is now
out of the `cron-daily` list**. Leaving it in both meant two jobs calling one
endpoint on two schedules, which is how a queue gets published twice.

**`cron-report-dispatch`** is new, at `7 * * * *` — hourly because a schedule's
`send_hour_utc` is hour-granular so nothing finer can be honoured, and offset
off the hour so it does not collide with the three jobs already at :00 and :15.
`REPORT_DISPATCH_SECRET` was NOT set on staging, so a cron would have 403'd; it
is set now and travels in a header, never a query string, because a secret in a
query string lands in every access and proxy log between here and the app.

Verified rather than assumed:

```
POST /api/reports/dispatch  correct secret → 200 {"ok":true,"dispatched":0,"errors":[]}
                            wrong secret   → 403
                            no secret      → 403
```

`report_schedules` holds 0 rows, so it sends nothing until somebody creates the
first schedule — which is exactly why it is worth arming: a job that only starts
working once the first schedule exists is a trap.

**One thing I fixed before arming it, and would not have armed without.** The
dispatcher moved a schedule's `next_run_at` forward only AFTER mailing every
recipient, inside the same `try`. So a schedule with three recipients where the
second address fails would mail all three again an hour later — including the
one that already had it — and the same for the container dying mid-send, and
for two hourly runs overlapping on a job that takes minutes. `OUTBOUND_MODE` has
been `live` since 18 August, so every one of those is real mail to a customer's
clients. The row is now claimed before the send. The trade is deliberate and
stated in the code: a failed send is skipped rather than retried, because a
missed report is visible and recoverable while a duplicate is already in
somebody's inbox.

`/cron/reports` and `/cron/esign` remain unarmed — they are 501 stubs, and the
new service is deliberately named `cron-report-dispatch` rather than
`cron-reports` so the two are not one word apart in a dashboard.

---

