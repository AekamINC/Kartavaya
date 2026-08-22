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

## DONE

*(nothing yet — items move here with the date and what I finished)*
