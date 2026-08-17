# What needs you — 16 August 2026

Everything on this list is blocked on something only you can do: an account, a
credential, a Railway edit my token is refused, or a decision that is yours.
Everything *around* each item is already built, so each one should be minutes,
not an evening.

Ordered by consequence, not by effort.

---

## 1 · Rotate the reminder-cron dispatch secret · **10 minutes**

**Why it matters.** `task-reminder-cron` carries its secret as a URL query
string, and I read the whole thing with ordinary project-read access without
trying:

```
.../api/task-reminders/dispatch?request_secret=f83a607d…
```

Anyone with read access to the Railway project has it, and Railway's own HTTP
logs record request paths. It is shared with production's cron, which is why I
did not rotate it myself — changing one side without the other stops reminders.

**Already done for you.** The staging service was pointed back at staging and
redeployed on 16 Aug (it had been POSTing to **production** every 15 minutes
since at least 5 August — its config said staging, but a config edit is not a
deployment, so the container from 5 August kept running the old command).
Production was left untouched, as you asked.

**What to do**
1. Generate a new secret: `openssl rand -hex 32`
2. Set it as a Railway **variable** on the backend service in both environments
   (call it `TASK_REMINDER_SECRET`), not in a URL.
3. Update both cron services' start commands to pass it as a header, matching
   the shape `cron-niyam` now uses:
   `-H "X-Cron-Secret: $CRON_SECRET"`
4. **Redeploy both cron services.** A config edit alone will not take effect —
   that is the exact bug that sent staging's traffic to production for eleven
   days.
5. Confirm from the logs, not the config: the deployed container should emit no
   curl progress meter (impossible under `-sS`), which is how I detected the
   divergence.

---

## 2 · Arm the daily scraper price watch · **2 minutes**

**Why it matters.** Third-party Apify actors reprice silently. `gstin-scraper`
went up **21.5×** unnoticed. The endpoint, the migration, the service and 24
tests are all shipped; nothing is calling them.

**What to do.** Railway → `cron-daily` (staging) → Settings → Start command.
Add `scraper-prices` to the job list:

```
sh -c 'rc=0; for p in hr invoices crm stock marketing publish skills scraper-prices; do c=$(curl -sS -m 600 -o /tmp/o -w "%{http_code}" -X POST -H "X-Cron-Secret: $CRON_SECRET" "https://kartavya-staging.up.railway.app/api/internal/cron/$p"); echo "$p -> $c $(head -c 400 /tmp/o)"; [ "$c" = "200" ] || rc=1; done; exit $rc'
```

Only `skills` → `skills scraper-prices` changes. **Then redeploy the service**,
and check the next run's log shows a `scraper-prices -> 200` line. If it does
not appear, the deploy did not take — `cron-hourly` has been silently skipping
its third job for the same reason since 6 August.

---

## 3 · Sentry DSN · **15 minutes**

**Why it matters.** There is no error sink at all. `sentry_sdk.init()` is
guarded behind `SENTRY_DSN`, which is unset, so every `log.exception` in the
product goes to Railway's log stream and nothing alerts. That is why these all
went unnoticed:

| what broke | for how long | would Sentry have caught it? |
|---|---|---|
| `PATCH /api/tasks/{id}` 500'd for every user | 10 days | **yes** — verified by running the failure against a stubbed transport |
| staging's cron POSTing to production | 11 days | **no** — every request returned 200; the wrong host is not an error |
| `cron-hourly` running 2 of its 3 jobs | 10 days | **no** — a job that never runs raises nothing |

So it is worth doing, and it is not a monitor. Two of the three above are
silent-success failures, which need the `/api/internal/niyam/status` check at
the end of this document, not an error sink. And `log.warning` produces **zero**
events by design, so 157 of this backend's 266 broad exception handlers stay
invisible even after you set the DSN — they swallow and warn rather than raise.

**I cannot create the account** — signing up is not something I'm able to do.

**A residency decision, and it is one-way.** Sentry SaaS has exactly two
regions: **United States (Iowa)** and **European Union (Frankfurt)**. There is
no APAC region, so error payloads cannot sit beside the database. The region is
chosen when the **organisation** is created and **cannot be changed afterwards**
— moving means a new organisation and a new DSN. Pick **EU (Frankfurt)** unless
you have a reason not to: it is the one with a data-protection regime, and this
product already keeps its database in Singapore deliberately rather than by
default.

**What to do**
1. Create a Sentry account, choosing the region at the organisation step.
2. Create a **Python / FastAPI** project.
3. Copy the DSN and set `SENTRY_DSN` as a Railway variable on the backend
   service — **staging first**, and leave production unset until you have
   watched staging for a day.

**Already done for you.** Scrubbing, sampling, environment and release tagging,
the non-request paths (the cron-driven sweep has no request context), and 19
tests that fail if a bearer token, a cron secret, a client email, an org id or a
user id could ever be transmitted. I broke the scrubber deliberately and watched
16 of them go red before restoring it, so they are checks rather than claims.
Setting the variable is the only step left.

**Measured on the real app, not on the config.** A genuine 500 was driven
through the running application with the transport captured, so this is
literally what Sentry's servers would have received:

| carried in the request | transmitted? |
|---|---|
| a client's email address | no |
| the cron secret (in a query string) | no |
| a session token (`Authorization: Bearer`) | no |
| an org uuid (`X-Org-Id`) | no |
| the session cookie | no |
| the query string at all | no - dropped, and the URL trimmed at `?` |

Headers arrived reduced to three: `accept`, `accept-encoding`, `user-agent`.
Volume is **one event per failure** - the duplicate copy the framework raises is
deduplicated, and transactions are dropped at the sample rate.

**What it does NOT do, and you should know before turning it on.** The config
narrows the channel; it does not close it. Measured, under exactly this
configuration:

```
raise ValueError(f"auth failed for {company}, {email}, pw {pw}")
```

was transmitted as `auth failed for Sharma Textiles Pvt Ltd, [email], pw hunter2`.

The email was caught. **The client's company name and the plaintext password
were not** — neither has a pattern to match, and no SDK switch removes an
exception's own message text. Frame variables, request bodies, cookies, query
strings, headers and SQL are all off or stripped; exception *messages* are the
one channel left, and the control for it is a code rule (never interpolate user
or client data into an exception) rather than a setting.

---

## 4 · Decide production · **a conversation, not a task**

Production runs `main` at 1,144 commits behind staging — 12 routers against 46 —
**and shares one database with staging**. That is why `retention-cron` crashes
nightly: old code against a newer schema. Everything built since June reaches
nobody.

Three options, and the third is not a joke:

1. Promote `staging` → `main` and accept a large, mostly-tested jump.
2. Keep production frozen and stop pretending it serves anyone.
3. **Retire the production service** and let staging be production. It already
   holds the real data.

Nothing else on this list changes as much as settling this. Nobody has measured
whether real users log into production at all — 755 notification rows carry a
`read_at`, but staging and production write the same table, so that number
cannot tell them apart.

---

## 5 · Two real contact rows in a test org · **DONE 17 Aug**

`S K Joshi` held a real gmail address and a real Indian mobile — it had come in
from a scrape (`source: fishfabiogenics.com`). Replaced on your instruction with
`kevalvshah03+test@gmail.com` and your own `+44 7405…`. One row, one UPDATE.

Nothing belonging to a third party remains: every gmail address left on any
contact in any org is your own, including the three `Prachar Send Test` rows in
the E2E org, which are deliberate.

## 5b · The automation's identity · **DECIDED 17 Aug — building it**

Your ruling: **a standard `Niyam` account, created by default for every org, and
not billed as a seat.** So automation runs as Niyam rather than as a person, and
nobody pays for it.

That settles what `task.add_comment` needed. Building it means: a system account
per org, excluded from seat counts, and filtered out of member lists, @mention
pickers and team counts — the three places a fake person would otherwise appear.

## 5c · Two things that changed under you on 17 August

Neither needs you now. Both change what an earlier line of this document said.

**WhatsApp could send with the kill switch off.** `OUTBOUND_MODE=dry` stopped
every email and every social post and did **not** stop WhatsApp — and no
WhatsApp message ever reached `outbound_log`, the product's only record of what
it has sent. `outbound.py` had listed the exemption itself, with the condition
for ending it ("when that TODO is implemented, guard it here before it ships");
the TODO was implemented in P7 and nobody came back to the line.

It could not actually fire — no WhatsApp number is connected, so there are no
credentials — which is why it was fixed now rather than after you connect one.
**If you were about to connect a real number, this was the thing standing in
front of it.**

**Prachar said "sent" about campaigns nobody received.** The same fault cured
for reminders, still live in the module whose only job is sending, on a daily
cron. A fully suppressed campaign is now `paused` with `total_sent = 0` and no
`sent_at`, and each contact carries the reason.

**Optional, whenever you like:** Niyam's event pruning is now reachable at
`POST /api/internal/niyam/prune` (same `X-Cron-Secret`). It is deliberately not
scheduled — about 10 events a day, and pruning too early re-arms dedupe keys and
re-notifies people. Nothing needs doing until the table is large.

## 6 · The small ones

- **The `422` URL.** It ended `.../pdf/1` and matches no route in
  `/openapi.json`. Right-click the red console line → Copy link address.
- **The £0.04 Google charge — CLOSED 17 Aug. You said "i dont want this cost
  at all", so it is now structurally impossible.** Two things I told you about
  this on 16 Aug were wrong, and the corrections are why the fix was easy:

  - I said **embeddings** were spending it. They are not, and never were:
    `staging.hub_kb_chunks` holds **zero rows**, so not one vector has ever been
    stored. The 60 documents in the knowledge base are E2E seed rows written
    straight into the table, which is why they have no chunks. The £0.04 is 25
    chat calls made before 16 Aug, when chat still used the Google key
    directly; `hub_ai_logs` puts the lifetime total at **$0.0045**.
  - I said unsetting the key would silently degrade search because the
    OpenRouter fallback is "a different vector space". **There is no fallback.**
    I probed it with the live key: OpenRouter answers
    `400 — Model google/text-embedding-004 does not exist`. It has never
    returned a vector. So there was nothing to protect and nothing to re-embed.

  What changed: `services/rag.py` no longer reads `GEMINI_API_KEY` at all, the
  dead OpenRouter fallback is deleted, and `GEMINI_API_KEY` is removed from
  Railway. `backend/tests/test_no_google_spend.py` (331 assertions) holds it
  shut across all three surfaces — embeddings, every one of the 324 text
  routing chains, and the image branch — and each was proved to fail before it
  passed.

  **What you lose:** knowledge-base search is now text-only (keyword matching,
  no semantic similarity). Today that costs nothing, because the vector half
  was already searching an empty set. If you ever want semantic search on real
  documents, that is a deliberate decision with a bill attached — tell me and
  I will price the options.

- **APK 2.0.3 smoke test.** Sign in, `adb shell am force-stop com.aekaminc.Kartavaya`,
  reopen. If it ever closes on its own, send the text from **Settings → LAST
  CRASH**; that record is the diagnosis.
- **Sessions: rolling or fixed?** Everyone is signed out on day 7. `/auth/refresh`
  exists and mobile never calls it. Wiring it changes behaviour, so it is yours.

---

## 7 · Blocked on things that cost money

- **JustDial / IndiaMART live test** — needs real marketplace accounts. I will
  not run it against a live one without you watching.
- **iOS build** — needs an Apple Developer account. The config and the iPadOS
  code are complete and tested.

---

## What is running unattended right now

- **`cron-niyam`**, `*/15 * * * *`, staging only. Drains the automation outbox,
  runs the time triggers, resumes waits. Verified firing on its own.
- **`NIYAM_ARMED=true`** with one armed rule (*"when a task is finished, tell
  whoever asked for it"*) in the E2E test org. It has reached a person. Turn the
  whole engine off with `NIYAM_ARMED=false`; turn the one rule off from
  Settings → Automations.
- **Health check in one call** — this is the thing to look at if you suspect
  something is wrong:

```bash
curl -s -H "X-Cron-Secret: $CRON_SECRET" https://kartavya-staging.up.railway.app/api/internal/niyam/status
```

Read `last_tick_at` first. If it is more than ~20 minutes old, the cron has
stopped and nothing else in that response means anything.
