# Handover — 2026-08-08, evening

Continues `HANDOVER-2026-08-08.md`, which is still accurate for the morning and
predates everything here. Branch `staging`, head **`f1d45b6e`**, all pushed.

Backend **4,991 pass** from `backend/` — not the repo root. Frontend `npm run
check` and `npm run build` both clean.

## Shipped

| Commit | What |
|---|---|
| `70b06bb5` | `fields.py` was a FOURTH copy of the project access rule |
| `df0b0b3c` | CRM client: delete stops reporting success on 0 rows; Delete gated like Edit |
| `0b2c5ffb` | **P1** — `pay_token`, migration 128, applied to the shared database |
| `236773d9` | **P2** — `GET /api/v1/pay/{token}`, public, verified live |
| `db1a1dcf` | **P3** — the pay page at `/i/{token}`, with a server-rendered QR |

## "No tasks load anywhere" — it was the DRAWER, and I went the long way round

The list was always fine: 200s and rows in all three orgs, for the owner and for
both reporting accounts. I swept four list surfaces, proved them healthy, then
hypothesised the mobile `refreshControl` bug.

The owner's console settled it in one exchange: `/api/fields/team/{id}` and
`/api/fields/task/{id}/values` both 403, and **the drawer swallows both**, so
Details renders a task with no priority, no status, no due date, no category and
no assignees. Indistinguishable from a task that never arrived.

`fields.py::_assert_team_member` asked `project_assignments` UNION
`team_members` — the same membership-only rule `5f71f363` replaced in comments,
time entries and the activity feed. That consolidation missed this file.

**The generalisation:** "nothing loads" from a non-developer means *the screen is
empty*, which is as often a swallowed sub-request as a failed list. Ask which
screen and get the console before sweeping. `fields.py` is now in the existing
ratchet — verified to FAIL on the old body before accepting the pass.

## The pay link, P1 → P3

**P1** — 16-char base64url from 12 random bytes, UNIQUE, NOT NULL, `DEFAULT` on
the column so recurring invoices and the estimate→invoice conversion cannot
produce a NULL token. 759 rows backfilled, 759 distinct. The backfill's
`WHERE pay_token IS NULL` is load-bearing: without it a replay re-mints every
token and kills every link already sent.

**P2** — every refusal is the SAME 404 with the same body. Unknown token,
settled, cancelled, draft, malformed: identical. A 403 on a real token confirms
the token is real. Payload is an allow-list field by field, never `dict(row)`,
and carries no id that addresses another API and no payment history.

**P3** — doorstep first (sender, number, due date, amount, billed-to), invoice
behind a tap. Plain `fetch`, **not** `lib/api`, because that client attaches the
Authorization and org headers from localStorage and a payment link is opened on
borrowed devices. The QR endpoint takes the **token**, not a string: `?data=` is
an open redirect in QR form.

### What P3 still needs

1. **Nobody has opened it in a browser.** Green checks are not a screenshot.
2. **`pay.kartavaya.com` still serves the staging SPA.** Reachable only at
   `staging.kartavaya.com/i/{token}` today.
3. **`segno` is a NEW dependency.** A broken-image QR after deploy means it did
   not install.
4. **No screen exists for an org to set its own UPI ID.** `org_profile` has no
   such field; only Aekam's billing screens do. `9428251061@upi` is set as a
   TEST value on Aekam Inc and Unicode Group; every other org has none, and
   `payable` is null for them — which the page renders as a bank-transfer line,
   not a dead button.

## Two things I got wrong, both corrected

**Migration 127 was already applied.** I reported it unapplied twice. The probe
searched for COLUMNS matching `%credential%`; the columns are
`secrets_encrypted` and `public_fields` — only the table carries the word. P7
was never blocked. **Migration 096 is also applied** despite the README saying
pending. Do not trust `migrations/README.md`; probe the database.

**The two `users.role='client'` rows are NOT corrupt.** I read "the data is
still wrong" from the morning handover, verified only that the column disagreed
with `staging.user_roles`, and treated disagreement as corruption. Both accounts
are genuine members of `team_95beaa7529a9` (**AekamInc-UK**, under Aekam Inc) in
two tables, while being `org_admin` of Unicode Group. I set them to `'admin'`
and reverted on the owner's correction — **net change to the database: none**.

I did ask before writing, but asked *"shall I fix these two rows"* rather than
*"what does client mean for these people"*. The approval was real; the premise
under it was mine and was wrong. **A column disagreeing with a newer table is
not evidence that the column is wrong.**

The real defect: `users.role` is ONE GLOBAL VALUE for a per-org fact, so it
cannot be right in both orgs at once. `task_clients` and `project_assignments`
already model "client on this project". Retiring the column is the fix;
repairing the value is not.

**Live consequence, undecided:** `is_portal_client` requires the column AND the
absence of a staff role, so these two get the STAFF view on AekamInc-UK where
they really are clients. Fails safe, but does not honour the relationship.

## Closed without a root cause

**CRM client edit.** The owner confirms it works. I never found why it failed —
my first diagnosis blamed the write gate on weak evidence ("no server log"),
and `_module_levels` returns None for an org_admin so the button was never
disabled. `df0b0b3c` may have fixed it incidentally. If it recurs, the Network
tab entry for the PATCH is the one thing needed.

## Open, in the order I would take it

1. **Open the pay page** — phone and desktop.
2. **Invoice modal rebuild** to the approved four-column design (ITEM · HSN/SAC
   · RATE · AMOUNT). The current bug is drawer-only: the description track is
   `minmax(0,1.6fr)` and collapses to zero, so ITEM overprints HSN/SAC. It does
   NOT reproduce on the Ganit page — measured at eight viewport widths. Carries
   the owner's "widen the invoice columns" ask; do it as a table-system change,
   not a hand-set width.
3. **P4** — server-rendered OG tags on `/i/:token`. WhatsApp runs no JavaScript.
4. P5 → P8.
5. **Reliability, untouched:** `/api/auth/me` intermittently 500s with
   `ConnectionDoesNotExistError`; `/api/tasks` logged at 6.1s and one task at
   10.7s.
