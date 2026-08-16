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

| what broke | for how long | how it was eventually found |
|---|---|---|
| `PATCH /api/tasks/{id}` 500'd for every user | 10 days | by accident, probing something else |
| staging's cron POSTing to production | 11 days | reading logs by hand |
| `cron-hourly` running 2 of its 3 jobs | 10 days | comparing config to log output |

**I cannot create the account** — signing up is not something I'm able to do.

**What to do**
1. Create a Sentry account and a **Python / FastAPI** project.
2. Choose the **EU** region if offered. This product deliberately keeps its
   database in Singapore; sending error payloads to a US region is a separate
   data-residency decision you should make knowingly.
3. Copy the DSN and set `SENTRY_DSN` as a Railway variable on the backend
   service — **staging first**, and leave production unset until you have
   watched staging for a day.

**Already done for you.** Scrubbing, sampling, environment and release tagging,
the non-request paths (the cron-driven sweep has no request context), and tests
that fail if a bearer token, a cron secret or a client email could ever be
transmitted. Setting the variable is the only step left.

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

## 5 · Two real contact rows in a test org · **5 minutes, your call**

Everything in the test orgs is dummy — `@example.com`, `@simulator.amazonses.com`,
`+91 98765 43210` — with these exceptions in **Unicode Group**:

| contact | email | phone |
|---|---|---|
| S K Joshi | `sk…@gmail.com` | `+91 78945 61230` |
| Bhumi | — | `+447405382925` (UK mobile) |

Nothing scheduled can reach them: Niyam is in-app only and notifies org
*members*, never contacts, and the reminder cron has zero email-channel rows.
They would only matter if a **Prachar** campaign ran against that org — and
marketing on staging sends through SES with no dry-run guard.

Say the word and I will replace both with simulator values.

---

## 6 · The small ones

- **The `422` URL.** It ended `.../pdf/1` and matches no route in
  `/openapi.json`. Right-click the red console line → Copy link address.
- **The £0.04 Google charge.** Compare the billing project against the project
  your Gemini key belongs to. One lookup; I cannot see billing. Note this got
  *less* urgent on 16 Aug — the direct Gemini provider is now retired and
  nothing spends that prepay.
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
