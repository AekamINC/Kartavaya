# Proposal 93 v5 — START HERE

**Written 2026-08-30, end of session.** Read this first next session. The full
scope is `docs/proposals/105-93-v5-production-and-the-full-qa-set.html`; the
route file is `93-V5-RESCOPE.md`. This page is only: **what is ready, what is
blocked, and the order.**

⚠ **Real users arrive 31 Aug 09:00 IST.** Everything below runs against
production with `OUTBOUND_MODE=live`. Real mail leaves.

---

## Ready — verified live today

| Surface | State |
|---|---|
| `www` / apex / `app.` / `pay.` | ✅ all HTTP 200, Cloudflare Pages |
| `api.kartavaya.com` | ✅ 200, `environment=production`, `schema=public` |
| `FRONTEND_URL` `PAY_URL` `BACKEND_URL` `FROM_EMAIL` `CORS_ORIGINS` | ✅ all correct |
| SPF · DMARC · MX · MAIL FROM (MX + TXT) | ✅ published |
| APK | ✅ rebuilt, `api.kartavaya.com` only, v2-signed |
| `check-production-targets.mjs` | ✅ green, incl. the 3 email link bases |
| e2e tokens (5) | ✅ all valid to Sep 4–6 |
| Rate-limit **keying** fix | ✅ shipped `0e066d9c`, deployed |

---

## Blocked — and each is one action

### 1 🔴 `OWNER` has no credential — blocks 55 specs

`E2E_UID_OWNER` is **`kevalvshah03+e2e-owner@gmail.com`**. Nothing in
`.env.e2e` authenticates as it. Add either:

    E2E_OWNER_TOKEN=<fresh bearer token>
    # or
    E2E_OWNER_EMAIL=kevalvshah03+e2e-owner@gmail.com
    E2E_OWNER_PASSWORD=<password>

⚠ **Do not point it at the GODMODE token.** `owner.json` on this machine was
already a GODMODE token under the owner's name, which is why 55 "owner" specs
had been running as admin and proving nothing about privilege separation.
`auth.setup.ts` now deletes stale state, so this fails loudly instead.

### 2 🔴 Ten `E2E_DUMMY_*` accounts do not exist

Only `emp001` and `emp002` have a `users` row; `manav_employees` holds **0
rows**. `DUMMY_03`–`12` need creating before any role-matrix wave. No password
will ever work for them.

### 3 🟡 Rate limits are ~2× and Redis is not connected

Redis is provisioned (`redis:7-alpine`, service `68747d2f`, `REDIS_URL` set on
the API) but **its network counters read zero — the app has never reached it.**
The API service has `ipv6EgressEnabled: false` and Railway's private network is
IPv6-only, so `redis.railway.internal` cannot be dialled.

**Next action:** enable IPv6 egress on the Kartavaya service (dashboard toggle,
not exposed by the API), then re-run the threshold probe below. Until then the
limiter runs on in-process storage and limits are per-worker.

⚠ **This is a refinement, not a blocker.** The security half — counting the
CALLER rather than Cloudflare — is fixed and deployed. Limits being 2× is
coarse, not inverted.

**How to measure it** (parallel bursts mislead; a window roll looks like a
second counter):

```bash
for i in $(seq 1 70); do curl -4 -s -o /dev/null -w '%{http_code}\n' \
  https://api.kartavaya.com/api/v1/pay/zzq7x-nonexistent-probe; done | grep -n 429 | head -1
```

First `429` at **#31** = one shared counter, Redis working. Around **#48–55** =
two counters. Leave 90s quiet before running so no window is in flight.

### 4 ✅ DKIM — RESOLVED, it was never broken

SES console: DKIM configuration **Successful**, signatures **Enabled**, custom
MAIL FROM **Successful**. SES holds two of the three selectors empty for
rotation; one live selector is normal. The gate warned per-empty-selector and
has been corrected to fail only at ZERO live keys.

### 5 ✅ Mail routing — ENABLED

Cloudflare Email Routing catch-all is active and forwards to
`kevalvshah03@gmail.com`. Replies and bounces land in an inbox.

---

## The order to run in

1. **Clear blockers 1 and 2** — they gate the widest set of specs.
2. **`node scripts/check-production-targets.mjs`** — must be green before any
   wave. It is the gate that caught the `BACKEND_URL` 404 and the `.env.e2e`
   typo today.
3. **`node scripts/check-sender-dns.mjs`** — expect one amber (DKIM).
4. **Setup states:** `npx playwright test --config=e2e-real/real.config.ts
   --project=setup`. All three must pass. A failure here is a credential
   problem, never a product one.
5. **Stage 1 onward** per proposal 105 §5, waves per §6.

---

## Rules that do not bend

- **✅ means a row appeared where there were zero.** Code shipping is 🟡.
- **Never call a table, column or route missing without a live query.**
- **Update `docs/STATUS.md` and `docs/plans/PROGRESS.md` in the same commit** —
  that is part of "done".
- **Never test validation by writing to the live DB.** Read with SQL instead;
  it answered three questions today that status codes could not.
- **A parallel burst is a bad instrument for a rate limit.** Sequential, after a
  quiet period. Two measurements today disagreed until this was fixed.

---

## Corrections carried out of this session

Recorded because re-deriving them costs more than reading them.

- **`api.` did NOT need to be DNS-only.** Proxied, Cloudflare terminates TLS
  with its own certificate and Railway never issues one. The earlier note was
  wrong.
- **The DKIM gate blamed the wrong record.** A `*._domainkey` wildcard cannot
  shadow an explicit selector (RFC 4592 §2.2.1). It now probes the real
  selectors and carries a control.
- **"Two workers" was asserted before it was measured.** `numReplicas` is 1 and
  the repo says `WEB_CONCURRENCY` is 1, yet two counters are observable — which
  is why item 3 above ends with a probe rather than a claim.
- **`build-apk.sh | tail` reports tail's exit status.** A FAILED build looked
  like exit 0. Redirect to a file instead.
