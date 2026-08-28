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

### 16. Two product defects found on 2026-08-28, deferred by decision — your call on when

Neither is blocked on you in the usual sense: I can fix both. They are here
because §7 of proposal 93 says a fix that is a change of shape rather than a bug
gets raised with its evidence and an estimate instead of being folded silently
into a suite's time. **The reseed run continues past both.**

**(a) Renaming an organisation does not bump `updated_at`.**
Evidence: after the 2026-08-28 repair, `staging.organisations.updated_at` still
read **12 July** for Aekam Inc and **20 August** for E2E — both renamed that day.
Consequence: `updated_at` cannot be used to detect that a company record was
touched, which is exactly what it would be reached for during an incident. It is
also the column a delta-sync `?since=` would key on.
Estimate: **under an hour** — the UPDATE needs `updated_at = now()` and one test
that fails without it. Say the word and it goes in with the next backend change.

**(b) An inactive module tells the customer the wrong thing, on four screens.**
Evidence, measured on day one against an unconfigured org: `/graha` says *"You do
not have access to CRM reports"* — a permission framing, which sends a person to
their administrator to ask for a grant they already have — while the API for the
same condition says *"Module not active, contact your administrator"*, which is
the actionable sentence. Four screens are right (`/manav`, `/vetana`,
`/sanvaad`, `/hub/org`) and four are wrong (`/dashboard`, `/graha`, `/ganit`,
`/dristi`). So the product **knows** the difference and loses it in half the
places it says it.
Why it is not a one-line fix: the copy and the routing are decided per module,
so it is a change across several modules plus the shared empty-state component,
and it needs one agreed sentence rather than four new ones.
Estimate: **half a day**, and it is the single most visible thing a brand-new
customer meets in their first ten minutes — every module they have not bought
yet greets them with it.

⚠ Recorded here rather than fixed on the spot because my own checks accused this
product **four times in one session** and were wrong every time. Both of the
above were confirmed by reading what the screen actually said, not by a regex
over it.

### 15. ✅ CLOSED 2026-08-28 — plus-addressing does NOT work on unicodegroup.com

**Answered by the mailbox.** The owner showed the `control` message sitting in
`test@unicodegroup.com`; the plus-tagged one never arrived and is the bounce SES
recorded. So:

    test@unicodegroup.com          DELIVERS  ✅ (seen in the mailbox)
    test+<tag>@unicodegroup.com    BOUNCES   ❌ IONOS rejects the plus tag

The doubt recorded on 2026-08-18 was correct, and §3's 5% share cannot be seeded
as written. One probe cost one bounce; the assumption would have cost ~550.

**Owner's instruction:** use `test@unicodegroup.com` everywhere §3 said
`test+<tag>@`.

⚠ **Adopted with ONE exception, which the schema forces.** §3 chose per-row tags
because a shared address collides on a unique index. Checked against
`pg_index` rather than assumed — the real picture is narrower than §3 implies:

| Index | Scope | Can `test@` repeat? |
|---|---|---|
| `public.users_email_key` | **table-wide UNIQUE on email** | ❌ **exactly one login** |
| `prachar_event_registrations (event_id, email)` | per event | ✅ one per event |
| `prachar_send_evidence (campaign_id, recipient_email)` | per campaign | ✅ one per campaign |
| `prachar_unsubscribes (org_id, email)` | per org | ✅ one per org |
| `graha_contacts`, `manav_employees`, vendors, candidates | **no unique email index** | ✅ freely |

**So the rule applied is:** `test@unicodegroup.com` for the 5% share everywhere —
contacts, employees, vendors, candidates, registrations, signers — and for
**one** login. The remaining logins keep the `kevalvshah03+` / `kelisweet+` gmail
tags, which are proven deliverable (18 Aug) and which gmail *does* honour.

Nothing else in §3 moves: the 45% simulator share and the 50% gmail share are
unaffected.

---

### 15b. (history) The probe — SENT, AND IT BOUNCED

**Status:** OPEN · ⚠ **the answer is bad, and it changes §3.** You allowed the
send on 2026-08-28 and it went immediately. Three messages, all ACCEPTED by SES:

    simulator  success@simulator.amazonses.com   ACCEPTED
    control    test@unicodegroup.com             ACCEPTED
    probe      test+probe@unicodegroup.com       ACCEPTED

**Then SES's own statistics recorded a BOUNCE.** Read back from
`get_send_statistics`, the 09:39 UTC bucket: `attempts=2, bounces=1`.

    last 3h: attempts=8 bounces=1  ->  12.5% bounce rate in the window

⚠ **`success@simulator.amazonses.com` never bounces** — that is the entire point
of the simulator — so **the bounce is one of the two `unicodegroup.com`
addresses.** This is exactly the risk the probe existed to find, and it fired on
the first attempt.

**What it means for the plan:** proposal 93 §3 seeds ~550 recipients as
`test+<tag>@unicodegroup.com` on the SES account that sends your real invoices.
Had that gone ahead on the assumption, a large share would have hard-bounced.
**That share must not be seeded until the question below is settled.**

**What I cannot tell you, and why.** SES reports bounces in aggregate only.
Per-message outcomes need a configuration set with an SNS event destination,
which does not exist (item 13) — so the API cannot say *which* of the two
bounced. Only the mailbox can.

**What you do — one look settles it.** Check the `unicodegroup.com` mailbox for
two messages, subject `[Kartavaya R0] plus-addressing probe`:

| What you see | What it means | What I do |
|---|---|---|
| Neither arrived | there is no `test@` mailbox at all | the 5% share moves to the gmail-tag scheme |
| Only `control` arrived | **IONOS rejects plus-tags** — the doubt from 18 Aug was right | same: move the 5% to gmail tags |
| Both arrived | the bounce was something else and needs a second look | seed as §3 planned |

**What I finish once you have:** either confirm the §3 recipient mix as written,
or re-point the 5% share at `kevalvshah03+` / `kelisweet+`, both already proven
deliverable. Nothing else in the plan moves either way.

**Not urgent for reputation:** one bounce on eight attempts is a small absolute
number and the simulator traffic is reputation-exempt. It would only have become
dangerous at the ~550 the plan called for — which is precisely why the probe ran
first.

---

### 15a. (superseded) The plus-addressing probe could not be sent

Kept for the record: the send was refused by this session's permission layer
while the read-only half of the identical path succeeded. You lifted it and the
result is above.

**The question.** §3 seeds ~550 recipients shaped `test+<tag>@unicodegroup.com`
and carries an **unresolved** doubt, recorded on 2026-08-18, that IONOS may
reject the plus tag. It was never settled because port 25 is blocked here. If
IONOS does reject them, those 550 hard-bounce **on the SES account that sends
your real invoices**, and a bounce spike is how SES pauses an account.

**Why it is blocked, and it is not a credential.** The session's own permission
layer refuses the send. The read-only half of the same path runs fine — I listed
the SES identities, DKIM state and quota through `railway run` without trouble —
so this is a guard on *sending mail*, not on AWS access or on Railway. Your
"railway tasks approved" does not reach it, and I have not tried to route around
it.

**What you do — either one settles it:**

1. Allow the send in this session (a Bash permission rule), and I run the probe;
   **or**
2. Send one mail yourself, from anywhere, to `test+probe@unicodegroup.com`, and
   tell me whether it arrives.

⚠ **Also check `test@unicodegroup.com` — without the tag.** The two failure
modes need different fixes and the tagged address alone cannot tell them apart:
a plus-tag rejection means fall back to the gmail-tag scheme already proven on
18 Aug, whereas *no `test` mailbox at all* means the 5% share has no home
regardless of tagging.

**What I finish once done:** the §3 recipient mix is confirmed and the mail
suites can assert **arrival** rather than SES acceptance — which is the single
biggest upgrade to this programme's evidence, since SES accepted 960 payslips
that hard-bounced seconds later. If the answer is no, I re-point the 5% share at
the gmail-tag scheme and nothing else in the plan moves.

**Not blocking the programme.** R0 is otherwise complete and Stage 2 does not
depend on this — no email is sent until the suites run in Stage 3.

---

### 11. Repoint the report cron — DONE 2026-08-28 · nothing needed from you

**Status:** ✅ CLOSED. The MCP connector's write scope came back and I applied
both fields plus the missing variable. 6.4 is now complete end to end.

**IT WAS CRASHING, AND HAD BEEN SINCE 6.4 LANDED.** `railway status` showed
`cron-report-dispatch` **● Crashed**, and the deploy log was one line:

    dispatch -> 404 {"detail":"Not Found"}

It was still POSTing to `/api/reports/dispatch` — the endpoint retired with
`public.report_schedules` in migration 236 — with the header
`X-Dispatch-Secret`. So every hourly tick since the retirement 404'd and exited
non-zero. Nothing was lost (that table held 0 rows), but the service had been
red for a day and the failure was invisible from inside the product.

**What was actually wrong: three things, not two.**

1. the URL — now `POST /api/v1/dristi/scheduled-reports/dispatch`;
2. the header — now `X-Cron-Secret`, per CLAUDE.md's rule that cron endpoints
   authenticate via `CRON_SECRET`;
3. ⚠ **the secret was not on the service at all.** It held only
   `REPORT_DISPATCH_SECRET`. Fixing the URL and header alone would have turned
   a 404 into a 401 — a different red, not a green. `CRON_SECRET` is now set as
   a REFERENCE, `${{Kartavya.CRON_SECRET}}`, so it tracks the backend's value
   and there is no second copy of a secret to rotate.

Schedule moved `7 * * * *` -> `*/15 * * * *`.

**Verified by running the exact command the cron runs, with the cron service's
own environment:** the reference resolved (64 chars) and the endpoint answered
**200** with `armed: true, sent: 0, due: 0, failed: [], skipped: []`. Nothing is
due until 31 Aug, which is what the dry preview said before arming.

⚠ A plain redeploy would have reused the OLD config snapshot, so the deploy was
forced with a `DEPLOY_NUDGE` variable. Deployment `232e7a28` is SUCCESS.

⚠ `REPORT_DISPATCH_SECRET` is now unused on that service. Left in place rather
than deleted — it is inert, and deleting a secret nobody asked me to delete is
not mine to do. Remove it whenever you like.

*(the original note, kept because the CLI limitation is still true)*

I could not do it myself: the Railway **CLI cannot set a start command or a cron
schedule** (only `list/delete/link/source/status/logs/redeploy/restart/scale`),
and the MCP refuses every write with *"Unauthorized. Please run `railway login`
again"* while reads still work. Rather than delete the service and leave you to
recreate it from scratch, I left it in place so this is an edit, not a rebuild.

**Re-tested 2026-08-28 after you granted permission explicitly — it is NOT a
permission problem.** `get_service_config` returns the service fine (reads
work), and `update_service` with the exact start command and schedule below
still fails with **`Unauthorized. Please run railway login again`**. So the
Railway MCP connector's own credentials lack write scope; approving me changes
nothing until that connector is re-authenticated. **If you would rather I did
this than you: re-auth the Railway connector and say so, and I will apply both
fields in one call.** Recorded here so nobody re-tries it assuming permission
was the blocker.

**Service: `cron-report-dispatch`** (id `22249f3d-aec4-42b7-9f8c-921eb69b336f`),
staging. Change exactly two things:

**1. Start command** — currently calls `/api/reports/dispatch`, which I deleted
today, so it is failing hourly right now. Replace with:

    sh -c 'c=$(curl -sS -m 600 -o /tmp/o -w "%{http_code}" -X POST -H "X-Cron-Secret: $CRON_SECRET" "https://kartavya-staging.up.railway.app/api/v1/dristi/scheduled-reports/dispatch"); echo "dristi-sweep -> $c $(head -c 1000 /tmp/o)"; [ "$c" = "200" ] || exit 1'

Note it now uses **`CRON_SECRET`**, not `REPORT_DISPATCH_SECRET`. This is the
shape `cron-niyam` already uses, copied rather than invented.

**2. Cron schedule:** `7 * * * *` → **`*/15 * * * *`**.

Not hourly, and the reason is specific: `time_utc` has minute granularity and
six of the seven schedules are set to `03:30`, so an hourly tick delivers up to
59 minutes late. `is_due` is idempotent per slot, so a 15-minute tick cannot
double-send.

**Worth renaming** while you are there — `cron-report-dispatch` now describes
the thing it no longer calls. `cron-dristi-reports` matches what it does.

**Optional cleanup, nothing depends on it:** `REPORT_DISPATCH_SECRET` is now
read by nothing. It is also set in `.github/workflows/ci.yml` (3 places) and
`nightly.yml` — harmless, but tidy.

**What is already done and needs nothing from you:** `DRISTI_REPORT_SWEEP_ARMED`
is set to `true` and **confirmed live** — the running container reports
`armed: true`. Migration 236 is applied and `public.report_schedules` is gone
from both schemas. Until you make the two edits above the sweep simply never
ticks; **nothing is due until 31 Aug**, so there is no urgency and no risk of a
missed send in the meantime.

---

### 9. Mappls — add `www.kartavaya.com` to the whitelist

**Status:** OPEN · two minutes, and it is the last thing between the map and
every domain you serve.

The basemap **works** on `staging.kartavaya.com` and on the apex
`kartavaya.com` — verified from a real browser on each. `www.kartavaya.com` is
still refused. It was on the whitelist earlier in the session and came off it.

**What you do:** Mappls console → app **kv2** → Whitelisting → add BOTH forms:

    https://www.kartavaya.com
    www.kartavaya.com

**What I finish once done:** nothing is blocked behind it — this is the last
origin, not the last feature. The map already draws on staging.

⚠ **The wildcard does not work and must not be relied on.**
`https://*.kartavaya.com` and `*.kartavaya.com` are BOTH on the list, and `www`
is refused anyway while `staging` — listed by name — passes. **Mappls'
whitelist is exact-match only.** Every subdomain you ever add must be listed
individually, or the map fails on that subdomain and nowhere else.

---

### 8. M · APK 2.0.4 REBUILT 2026-08-28 — cold-restart reproduction still owed

**Status:** OPEN · the file exists again; only the live device test remains.

**Phase 0.29 is satisfied on the build side.** 0.29 says a fresh APK is owed
"after ALL phases complete" because you had lost every previous build — and all
phases are now complete, so it was built:

    build/Kartavaya-2.0.4-release.apk     66,301,446 bytes
    signature      v2 scheme, VERIFIED
    JS bundle      assets/index.android.bundle, 3,224,296 bytes  <- checked
    ABIs           arm64-v8a, armeabi-v7a
    backend        https://kartavya-staging.up.railway.app  (STAGING)

⚠ **The JS bundle was verified INSIDE the archive, not assumed.** A debug APK
carries none and is useless off the build machine — it launches and then cannot
find its JavaScript. Reading the zip is the only thing that tells the two apart,
and the file name does not.

⚠ **STILL 2.0.4, and deliberately so.** Nothing in `mobile/` has changed since
that version: phases 5-8 were backend and web, and the app talks to the same
API. Bumping the number to mark "a fresh build" would claim a change the app did
not undergo. This is the same software, rebuilt because the file was lost.
840 mobile tests pass.

⚠ **It points at STAGING.** `src/config.js` compiles
`EXPO_PUBLIC_API_URL ?? https://kartavya-staging.up.railway.app`, and there is a
runtime override at `config.apiBaseUrl`. That is right for a verification
build — the inbox-9 reproduction queues and clears a real punch, and it must not
do that against production.

**What you do:** install it, then reproduce inbox 9 — put the device in
airplane mode, capture a punch with a photo so the upload fails, restore
connectivity, KILL the app and reopen it. The punch should clear.
⚠ Cold restart, not a hot reload: a hot reload keeps the old JS module graph
alive and will tell you the retry works when it does not.

**What I finish once done:** nothing — M is code-complete and this is
verification only.

*(the original note)*



**Status:** OPEN · only the live device test remains.

`build/Kartavaya-2.0.4-release.apk` — 63 MB, v2-signed, built from this
machine's Android Studio JBR + SDK. Install it on a device and cold-restart
to confirm the inbox 9 fix (retryPendingPhotoUploads) actually clears the
stuck punch queue on a real phone.

**What you do:** install the APK on a test device, queue a punch with a
failed photo upload (airplane mode at capture), restore connectivity, kill
and reopen the app. The punch should clear.

**What I finish once done:** nothing — M is code-complete, this is
verification only.

---

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

### 12. `aekaminc.com` has no DKIM — your fallback sender is going out unsigned

**Status:** OPEN · live issue today, independent of any test programme.

Read off the SES console (ap-south-1) on 2026-08-27:

    unicodegroup.com          Domain    Verified
    aekaminc.com              Domain    UNVERIFIED     <--
    no-reply@unicodegroup.com Address   Verified
    no-reply@aekaminc.com     Address   Verified

⚠ **RE-MEASURED 2026-08-28 FROM THE API, AND IT IS WORSE THAN "UNVERIFIED".**
The console reading above was a status word; this is the identity's own
attributes, read through the running service's credentials and region:

    aekaminc.com              verify=Failed   dkim_enabled=True  dkim=Failed
    no-reply@aekaminc.com     verify=Success  dkim_enabled=True  dkim=Failed
    no-reply@unicodegroup.com verify=Success  dkim_enabled=True  dkim=Success
    unicodegroup.com          verify=Success  dkim_enabled=True  dkim=Success

**`Failed` is not `Pending`.** SES looked for the DKIM CNAMEs, did not find
them within its window, and gave up — so "publish the records" is necessary but
**not sufficient**: the identity needs re-verification triggered afterwards, or
it will sit at `Failed` with correct DNS underneath it. That is the difference
between this taking one visit to the console and taking three.

The line that matters for the fallback sender is the second one:
`no-reply@aekaminc.com` is **verified as an address and `dkim=Failed`** — so it
sends today, unsigned, exactly as this item says.

`FROM_EMAIL` defaults to `Kartavaya <no-reply@aekaminc.com>`
(`backend/email_service.py:13`), and it sends **only because the single address
is verified**. The domain is not, so **those messages carry no DKIM signature**
and authenticate weakly — every email from any org that has no sender rows of
its own, which today is Aekam Inc, E2E, UK AekamINC and Demo.

**What you do:** in SES, open the existing `aekaminc.com` domain identity and
publish its three DKIM CNAMEs on aekaminc.com's DNS. The identity is already
created; it just never completed. ⚠ The Cloudflare migration does **not** reach
this — aekaminc.com's mail DNS is on IONOS, on separate nameservers.

**What I finish once done:** nothing is blocked on it, but it also unlocks
`e2e-invoice@aekaminc.com`-style senders as an alternative to the
`unicodegroup.com` prefixes now planned, and it improves deliverability on every
fallback send from today onward.

---

### 13. There is no bounce feedback path — a decision, not a bug

**Status:** OPEN · needs a scoping decision from you before I build anything.

**The product cannot learn that an email bounced.** Verified 2026-08-27:

- **no SNS or SES notification endpoint exists** in any router;
- **`outbound_log` has no `bounced` status** — the vocabulary is
  `queued · sent · suppressed · failed`;
- the code *anticipates* the gap and never closed it —
  `routers/billing.py:1745` refers to "the place nobody would think to update
  **when a webhook adds `bounced`**".

A bounce is asynchronous: SES accepts the message, the row is written `sent`,
and the bounce arrives minutes later **to nobody**. That is precisely how 960
payslips were "sent" and hard-bounced.

**Why it is raised now:** proposal 93 seeds 45% of recipients on AWS's mailbox
simulator, which will generate real bounces and complaints safely. Those will
prove the *send* path — and prove nothing about *handling*, because there is no
handling. I do not want to report that as covered.

**What you do:** tell me whether to scope it. It is **code, not SES
configuration** — a webhook router, SNS subscription confirmation and signature
verification, a `bounced` status, and the suppression logic that acts on it.
Roughly 2–3 days. Adding an SES configuration set today would publish into
nothing, so that is deliberately not done yet.

**What I finish once decided:** if yes, it lands before the reseed so the
simulator traffic actually tests something. If no, the mail suites assert
acceptance only and the report says so in those words.

---

## DONE

### 10. Mappls — the basemap LOADS, 2026-08-27 · your key, carried out

**`MAPPLS_STATIC_KEY` is set and the map works.** Verified from a real Chromium
page on each origin:

    https://staging.kartavaya.com   HTTP 200, javascript, window.mappls = object   ✅
    https://kartavaya.com           HTTP 200, javascript, window.mappls = object   ✅
    https://www.kartavaya.com       401 IP/Domain validation failed                ❌ see item 9

**A key was owed after all, and I told you it was not.** That came from a note
written earlier the same day which had tested the OAuth pair's *minting* and
never its *spending*. Mappls replaced their auth mechanism in **August 2025**
— their own `mappls-web-maps-js` README documents the new one on `main` and
pushed OAuth 2.0 to an `auth-legacy` branch — so the pair on Railway mints
perfectly and is refused by every product. The component that spent eighteen
days saying it needed a key was right that one was missing and wrong about which.

**Three things I got wrong on the way, recorded so nobody repeats them:**

1. **A server-side probe cannot test a browser SDK's domain check, and it lies
   convincingly.** Every `railway run` probe returned `IP/Domain validation
   failed` for our own domains *and* for a control domain we do not own —
   identical answers, which read as "the whitelist is broken" when the whitelist
   was fine and the probe was invalid. Only a real browser page on the real
   origin settles it.
2. **In Chrome a failed SDK load appears as `net::ERR_BLOCKED_BY_ORB` with no
   response at all**, because the 401 arrives as JSON where a script was
   expected. That is indistinguishable from a Content-Security-Policy block and
   will send the next person to `vercel.json` for an hour. It is not one.
3. I flagged our own `SDK_URL_TEMPLATE` as broken while reading the file
   mid-edit. It was not. Verify, then report.

⚠ **A security consequence that outlives this.** A Static Key **does not
expire** and the browser holds it, so it is readable in any network tab, for
ever, until you rotate it in the console. The domain whitelist is therefore not
housekeeping — it is the only control preventing the key being lifted and spent
against your allocation. `sentry_scrub.py` now redacts all three Mappls
variables; it previously guarded a variable name this repo has never had, while
the real credentials went to Sentry unredacted.

---

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
every attendance record in the product — 1,659 punches when this was written, **700 when re-counted on 2026-08-27**, 8 June to 4 August,
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

### 14. Mappls REST — SOLVED IN CODE 2026-08-28 · nothing needed from you

**Status:** ✅ CLOSED, and it did not need the support email after all. You
chose "move autosuggest into the browser" and that turned out to be the right
call for reasons beyond the blocker.

**⚠ MY WARNING ABOUT THE COST WAS WRONG, AND IN YOUR FAVOUR.** I said going
client-side "publishes a non-expiring key on every keystroke". It does not add
one: the Static Key is **already** served to every signed-in browser for the
basemap. The marginal security cost of this change is **zero**.

**It also ANSWERS the Geospatial Data Guidelines question rather than
deepening it.** The concern was that a *foreign* entity may license
finer-than-threshold Indian map data only through APIs that do not let the data
pass through its **own servers**. A server-side proxy is exactly that; a
browser calling Mappls directly is exactly not. Whatever the answer about
Aekam Inc's entity status, this shape is the safe one.

**But NOT the way "client-side" sounds — and this was measured before anything
was rewritten.** A plain browser `fetch` is *impossible*:

    atlas.mappls.com /places/search/json   -> blocked by CORS
    atlas.mappls.com /places/geocode       -> blocked by CORS
    apis.mappls.com  /autosuggest          -> blocked by CORS

    "No Access-Control-Allow-Origin header is present on the requested resource"

No key, header or whitelist entry changes that — the response is blocked before
our code sees it. Had it been assumed rather than probed, the rewrite would
have shipped and failed exactly as the server-side version does.

**What works is the SDK's own `search`**, which ships its own transport. The
map bundle we already load carries 124 keys and not one search surface; the
plugins bundle takes it to 139 and adds `search`, `placePicker` and
`advancePlacePicker`. Live: `mappls.search({query: "Bopal Ahmedabad"})` ->
**11 results**.

⚠ **ONE THING IS STILL YOURS, and it is small: rotate `MAPPLS_STATIC_KEY`.**
The probe that found all this printed the key into a run log on its first pass
— a CORS error quotes the full refused URL and the key is a query parameter in
it. The key is served to every browser by design and the whitelist restrains
it, so the exposure is limited, but a credential in a log should be rotated.
The output is redacted now. Set the new value on Railway as
`MAPPLS_STATIC_KEY`; nothing in the code changes.

*(the server-side investigation, kept — it is why the client-side route was
taken, and the control test is worth not repeating)*



**Status:** OPEN · **one email to Mappls support.** Re-probed live 2026-08-28
and the diagnosis is now exact — it is NOT our code, NOT our credential and NOT
a missing header. Everything on our side works.

**THE CONTROL TEST THAT SETTLES IT.** Same host, same endpoint, two tokens:

    our real minted token  ->  401 "Api Access Denied / Domain validation failed"
    a string of 36 'f's    ->  401 "invalid_token"

**The host tells them apart.** A garbage token is rejected AS a bad token; ours
is accepted as a valid one and then refused on a *different* ground. So
authentication succeeds and authorisation by domain fails. That is the mirror
image of the §7.5 finding, where the SDK host could not tell our token from
garbage — and it is why that one was a wrong credential and this one is not.

**What else was ruled out, each with a live call:**

    OAuth mint                          200, bearer, scope READ, expires 10210
    no Referer header                   401 Domain validation failed
    Referer https://staging.kartavaya.com/   401 (identical)
    Referer https://kartavaya.com/           401 (identical)
    Referer https://www.kartavaya.com/       401 (identical)
    Origin  https://staging.kartavaya.com    401 (identical)
    Referer + Origin together                401 (identical)
    /places/search/json                      401 Domain validation failed
    /places/nearby/json                      401 Domain validation failed

Six referer/origin variants and two separate Places endpoints, all refused
byte-identically. A server-to-server call sends no Referer by design, so if
their REST domain validation requires one, no server-side integration can ever
satisfy it — which is a policy question about the account, not a bug.

**What to send them** (their own error text names this address):

> To: apisupport@mapmyindia.com
> Project: Kartavaya, `prj1787726591i922664629`
> Our OAuth client-credentials token mints successfully (scope READ) and is
> recognised by `atlas.mappls.com` — a deliberately invalid token returns
> `invalid_token`, while ours returns `Api Access Denied / Domain validation
> failed`. We are calling **server-to-server**, so no Referer is sent; we also
> tried Referer and Origin set to each of our whitelisted domains and the
> response is identical. Please enable REST/Places API access for this
> credential for server-side use, or tell us what the credential needs.

⚠ **Do NOT "fix" this by moving autosuggest into the browser.** That publishes
a non-expiring key on every keystroke of every signed-in user, and the domain
whitelist — the only compensating control — does not restrain a key lifted from
a network tab. It is also the shape the Geospatial Data Guidelines question is
about. If the answer from support is "server-side is not supported", that is a
decision for you, not a workaround for me.

**Nothing else in 7.6 is waiting on this.** The pincode → state half runs on our
own 20,144-row government directory with no key, no quota and no vendor call,
and it is live on both the vendor and employee forms.

*(the original investigation, kept)*


**Status:** OPEN · blocks Phase 7.6 from ✅. Everything on our side is now
correct and proved; what remains is one console/support change only you can
make.

⚠ **This item replaces an earlier version that blamed the Autosuggest
entitlement. That was wrong.** Two live probes since then narrowed it, and the
correction matters because the two point at different settings.

**What was actually wrong on our side, and is now fixed** (`3914b68c`):
`atlas.mappls.com` follows OAuth 2.0 and takes a **bearer token in the
Authorization header**. We were sending the **Static Key** as an
`?access_token=` query parameter, on the reasoning that the Web Map SDK takes
the console key in a parameter of that name. It does not transfer. The two
credentials are for different products:

```
Web Map SDK (browser)   MAPPLS_STATIC_KEY   ?access_token= query parameter
REST APIs   (server)    the OAuth pair  ->  bearer token in a header
```

This is the **second** time this codebase has been right that a Mappls
credential was missing and wrong about which one - §7.5 lost months to the
mirror image. PHASE-7 §7.6 specified the OAuth pair from the start and was
right.

**What is left, measured directly from the Railway environment on 2026-08-28:**

```
MINT    https://outpost.mappls.com/...  -> HTTP 200
        token_type bearer | scope READ | expires_in 67178
SEARCH  https://atlas.mappls.com/api/places/search/json
        -> HTTP 401
        {"error":"Api Access Denied",
         "error_description":"Domain validation failed. If you see this often
          please contact MapmyIndia support at apisupport@mapmyindia.com"}
```

**The credential is fine.** The pair mints, the token is real, the scope is
READ. The refusal is **domain validation** - the same words the Web Map SDK
gave during 7.5, when the fix was whitelisting.

**And it cannot be satisfied from our side.** A server-side call sends no
`Origin` or `Referer`, so I tested sending each explicitly, from our own
already-whitelisted domain:

```
Referer: https://staging.kartavaya.com/   -> 401 Domain validation failed
Origin:  https://staging.kartavaya.com    -> 401 Domain validation failed
```

Both refused. So the whitelist that admits the browser SDK does not admit a
server-to-server call, and no header we can set changes that.

**Six routes tried, all refused. Do not re-try these** — each cost a call and
each is written down so the next reader does not spend another:

```
1  static key, server, no referer      401 invalid_token
2  OAuth token, server, no referer     401 Domain validation failed
3  OAuth token, server, + Referer      401 Domain validation failed
4  OAuth token, server, + Origin       401 Domain validation failed
5  static key, server, + Referer       401 invalid_token
6  browser fetch from staging.kartavaya.com, real origin
                                       CORS preflight blocked - no
                                       Access-Control-Allow-Origin on atlas
```

Rows 1 and 5 say the **Static Key is not a credential for `atlas` at all** —
`invalid_token`, a different refusal from the others. Rows 2-4 say the **OAuth
token IS valid** and is stopped one stage later, at the domain check. Row 6
rules out moving the call into the browser, which would otherwise have been the
clean answer: it needs no whitelist entry for a server, and it would moot the
Geospatial Guidelines question below because the data would never pass through
our servers. Mappls does not send CORS headers on that host, so it cannot be
called from a page.

**What to ask for.** On the console for project `prj1787726591i922664629`, this
credential needs to be permitted for **server-side / no-referer** use of the
REST APIs - or Mappls support (`apisupport@mapmyindia.com`, named in their own
error) needs to enable it. Their message asks you to contact them directly, so
that is likely the route. Quote the error verbatim and say it is a
server-to-server call with no referer.

**Cost so far: six live calls**, all against the same generic public place
(`Bopal Circle`) and never a customer record - the allocation is 200 hits and
every call is both billable and a submission under Mappls' perpetual,
sub-licensable content licence.

⚠ **Settle item 2 before paying for or enabling anything.** If Aekam Inc is a
*foreign* entity, the Geospatial Data Guidelines 2021 forbid this shape
outright - a foreign licensee may not route finer-than-threshold Indian map
data through its own servers - and the answer decides whether this is a console
toggle or a different feature with a published browser key. The repo carries an
org named `UK AekamINC`, so the name is not proof either way.
