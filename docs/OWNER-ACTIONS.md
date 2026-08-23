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

**Two more restore schemas now wait on the same word from you**, created for the
deletes you approved on 23 August: `owner_actions_20260823` (the 10 org-less
projects, the offboarding rows before normalising, Unicode Group's roles before
the owner was seated) and `punch_cleanup_20260823` (the test org's 960 punches).
Same answer covers all three, or take them one at a time.

---

### 7. An id WAS being rendered as a person — the email never was

**Status:** OPEN for your information only. Everything here is fixed; the
measurement changed what the finding actually is, and I would rather correct
myself than leave the scarier version standing.

**What I first told you.** About twenty read paths resolved a person's name with
`COALESCE(full_name, name, email)`, so on any screen where an account had no
name the product would print that person's email address as their label.

**What the measurement says.** Live: **0 of 35 accounts have no name.** The email
rung had never fired on real data. It was not a working fallback — it was a
loaded gun, and it is now removed from **56 sites** (my own grep found 47; the
ratchet I built to end it found nine more). The ladder ends at "Unnamed member",
taken from where the house had already made this exact decision rather than
invented.

**What WAS live, and is the real finding.** Three of those sites fell through
past the email to a raw `users.user_id`, and that rung fires whenever the user
row is ABSENT — a deleted approver, which does happen. One of them was the
**organisation switcher, on every page**. Another, `hub.py`, returned
`decided_by` raw, so the approvals queue read "granted 3 Aug by
user_f1a0a472b98f". A further four dead fallback arms drew ids, including in
Aekam's own admin console.

**The check that should have caught all of this had four holes**, and my
diagnosis of why was wrong: I said it was positional rather than textual. It
reads names and never values, so truncation was never the mechanism. The real
holes were `_by` missing from its vocabulary, `?.` classed as control flow so
`{a?.user_id}` was invisible product-wide, its interpolation walker stepping
over nested braces so the `||` fallback arm — the likeliest place for an id —
was structurally unreachable, and `String()` and template literals. All four are
closed, proved against a fixture holding two shipped defects verbatim: the old
check found 0 and exited clean, the new one finds 4 and fails.

**Nothing for you to decide.** No path existed where one org saw another's
address, and the address rung never fired at all. The ids that were rendered
were visible only to people who could already open those screens.

---

## DONE

### 5. The 10 org-less projects — DELETED, 2026-08-23 · your call, carried out

You said: **delete all ten.** Done, in migration `204_owner_actions_2026_08_23.sql`,
applied and verified live.

The measurement held: 8 soft-deleted "Solar Technocast" duplicates created 18 Jul
within 30 seconds of one another, and 2 near-duplicate "FY 2026-27 Statutory
Audit" projects created 28 Jul 43 seconds apart by the QA account evicted on 22
August. Zero tasks between them. Hanging off the ten: 0 tasks, 0 `team_members`,
20 `project_assignments`, 50 `project_columns` — and nothing else.

- `public.teams` is now **42 rows, 0 with a NULL organisation**
- 0 orphaned project assignments
- backed up to `owner_actions_20260823.teams_before` and siblings, from a frozen
  id list taken before anything was deleted

**Children before parents, and that was not a style choice here:** only
`task_reminders` declares a foreign key to `tasks`, so nine other tables carrying
a `team_id` would have orphaned SILENTLY rather than raising.

**What this unblocks:** PROPOSED_079 (`teams.org_id NOT NULL`), phase 4 of the
tenancy cutover, which failed while any of the ten existed. That and PROPOSED_081
are next. PROPOSED_080's rename stays last and stays a separate decision.

---

### 4. The ten clearance rows — NORMALISED, 2026-08-23 · your call, carried out

You said: **rewrite.** Done, in migration `204`, applied and verified live. All
11 exits now carry the array shape; `jsonb_typeof(clearance)` returns `array` for
every row and `object` for none.

**The tick state was carried, not reset.** `it_assets: true` became an item with
`done: true`. There were 16 ticks across the ten rows and all 16 survived —
resetting them would have silently un-ticked work somebody actually did, which is
the opposite of the defect being closed. The three keys in use across all ten
rows are exactly `hr`, `finance` and `it_assets`, measured rather than assumed, so
nothing fell through the mapping.

**`done_at` was left NULL rather than stamped with today.** Those items were
ticked at some earlier moment that was never recorded, and writing today's date
would assert a fact about *when* that is not true.

Backed up to `owner_actions_20260823.offboarding_before`.

**Still yours, and not a code fix:** two exits were completed while clearance was
outstanding, back when the guard could not see it. If a laptop or an ID card is
genuinely still out on either, that is a real-world chase. Say the word and I
will name the two records.

---

### 3. Unicode Group has an owner — APPOINTED, 2026-08-23

You named `kevalvshah03!@gmail.com`. **That address does not exist** — the `!` is
a typo, confirmed by measurement rather than assumed: a count on that exact
string returns 0. `kevalvshah03@gmail.com` does exist, is KEVAL SHAH, and was
already an `org_admin` of Unicode Group, which is the precondition the new
endpoint enforces. The intention was unambiguous, so that is the address used —
flagging it here because I substituted an address you did not type.

Done in migration `204`, doing the same two writes the endpoint does, in the same
order. Verified live: Unicode Group now holds **org_owner 1, org_admin 5,
org_member 6**, and `organisations.owner_user_id` is set.

**It is an INSERT, not an update.** The existing `org_admin` row is untouched:
`org_owner` outranks it everywhere the two are compared, so removing the lower
row would rewrite a live grant to achieve nothing.

That org can now switch its own modules on and off, and appoint a payroll
approver — neither of which it could do before, by any route.

---

### 6. The test org's 960 punches — DELETED, 2026-08-23 · your call, carried out

You said: *"no without photograph remove record they are useless now."* Measuring
what that sentence reached changed it, and you then chose the narrower option:
**delete the test organisation's 960, keep Unicode Group's 699.**

That was the right call and the numbers are why. "Records with no photograph" was
every attendance record in the product — 1,659 punches, 8 June to 4 August,
because the feature had never worked for anybody. **735 of them carry a review
verdict**: occasions on which a manager looked at a flagged punch and decided
something. A punch without its selfie is not a blank record. It still holds its
time, its location, its accuracy and its flags, and for a live customer those are
the rows payroll reads.

**Done:** migration `205_clear_test_org_punches.sql`, applied and verified live.

- `pahchan_punches` now holds **699 rows, all Unicode Group's**, 0 with no org
- **960 test-org rows deleted**, of which 720 carried a review verdict
- backed up in full to `punch_cleanup_20260823.punches_before` **before** the
  delete, from a frozen id list so the set could not drift in between
- `manav_attendance` deliberately untouched — 578 rows, 426 of them the test
  org's. It has no `punch_id` and no foreign key, so nothing there was orphaned
  by this, and whether those should go is a separate question you have not been
  asked

**One thing worth recording, because it nearly went the other way.** The first
draft also deleted the 40 `pahchan_regularisations` rows, reasoning that a
request to amend a particular punch is meaningless once the punch is gone. The
migration's own assertion refused to commit it, and the assertion was right: all
40 belong to the test org and **all 40 already had `punch_id` NULL**. Not one
referenced a punch. They were seeded detached and have always been detached, so
the foreign key was inert, the delete would have removed 40 rows for no reason,
and they are left exactly where they were. The check now asserts all 40 are still
present rather than asserting an absence that was never true.

**Still outstanding from the original finding, and not blocked:** the guard is
fixed in code and deployed, so photographs work from now on. For the 699 kept
records the selfie was never captured and cannot be recovered — if one of those
days is ever disputed, the photograph will not be there to settle it. That is
worth knowing before it comes up rather than after.

**The backup schema `punch_cleanup_20260823` stays** until you tell me nothing is
missing — same standing question as item 2.

---

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

