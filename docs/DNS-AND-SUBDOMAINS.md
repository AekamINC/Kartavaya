# DNS and subdomains — the whole map, and why each host exists

**Written 2026-08-30.** Derived from what the code and the shipped CSP actually
reference, not from a wish list. Every row carries the file that needs it.

⚠ **State when this was written: the zone has THIRTEEN records and NO site
routing at all.** The apex, `www` and the `*` wildcard were deleted (correctly —
they pointed at a dead Vercel deployment) and nothing replaced them. So
`kartavaya.com` answers `530 / error 1016` and **every subdomain below either
404s or does not resolve.**

---

## The five production hosts

| Host | What it is | Points at | Proxy | Set by |
|---|---|---|---|---|
| `kartavaya.com` | the front door / marketing | Cloudflare Pages | 🟠 Proxied | — |
| `www.kartavaya.com` | redirect to the apex | Cloudflare Pages | 🟠 Proxied | — |
| **`app.kartavaya.com`** | **the product** | Cloudflare Pages | 🟠 Proxied | `FRONTEND_URL` |
| **`pay.kartavaya.com`** | **the public invoice** | Cloudflare Pages | 🟠 Proxied | `PAY_URL` |
| `api.kartavaya.com` | the backend | Railway (production) | ⚪ **DNS only** | `BACKEND_URL` |

### 🔴 Two of these are inside emails, and neither resolves today

**`app.` and `pay.` are not cosmetic.** They are written into mail that goes to
customers and to *customers' customers*:

- **`FRONTEND_URL`** — `backend/email_service.py:23`, `invite_router.py:34`.
  Invites, approvals, password resets. Its own comment records the bug that
  named it: *"every approval mail this product has ever sent pointed a customer
  at the front door and asked them to find their way in. `app.` is the app."*
- **`PAY_URL`** — `email_service.py:36`. **Every invoice.**
  `pay.kartavaya.com/i/{token}`, opened by *the customer's customer*, who has no
  account and never will.

⚠ **With `OUTBOUND_MODE=live`, a v5 run emails real invoices containing
`https://pay.kartavaya.com/i/…` links — to a host that does not resolve.**
Both are Railway variables and are SET, so the deployed values may differ from
these code defaults. **Read them before any wave that mails** — if they are the
defaults, every link in every invoice is dead.

### Why `pay.` is a separate host, and must stay one

`email_service.py:25-31` states the design and it is deliberate:

> the person opening it is the customer's customer, has no account here and never
> will, and the whole surface is one unauthenticated document plus a UPI string.
> Keeping it on its own host means an invoice link can never be mistaken for a
> session, and the two can be firewalled, cached and rate-limited apart.

It is the **same Pages project** — `/i/:token` is a route in the same SPA
(`frontend/src/App.jsx:178`) — just reached on its own hostname. So it costs one
extra Custom Domain, not a second build.

---

## The two staging hosts

| Host | What it is | Points at | Proxy |
|---|---|---|---|
| `staging.kartavaya.com` | staging frontend | Cloudflare Pages (staging) | 🟠 Proxied |
| `api-staging.kartavaya.com` | staging backend | Railway (staging) | ⚪ **DNS only** |

### ⚠ `api-staging`, NOT `staging-api` — and the repo disagrees with itself

| Source | Spelling |
|---|---|
| `frontend/vercel.json` CSP · **and the deployed CSP** | `api-staging.kartavaya.com` |
| `docs/STAGING_SETUP.md` | `staging-api.kartavaya.com` |

**The CSP wins, because it is what enforces.** `connect-src` names
`api-staging.kartavaya.com`; a frontend pointed at `staging-api.` would have
every request blocked by the browser with a CSP violation and no server-side
trace. Create `api-staging`; the doc is wrong and should be corrected.

**`PAY_URL` must be set per environment.** Its comment says so explicitly: unset,
it points at production, "which is correct for production and wrong for anywhere
else, because a staging invoice token lives in the staging schema and production
would answer 404." If staging ever mails an invoice, it needs
`pay-staging.kartavaya.com` or staging's own origin.

---

## Not real — do not create these

Found in the grep and deliberately excluded, so nobody re-adds them:

| Host | Why it appeared | Verdict |
|---|---|---|
| `aekam.kartavaya.com` | sample text in a design mock (`AuthForms.jsx:244`, "aekam.kartavaya.com · 6 members") | ❌ a mockup, never a real host |
| `files.kartavaya.com` | one test fixture URL | ❌ files live in R2 behind its own public URL |
| `uk.` / `e2e.` / `dmarc.` | doc prose and test strings | ❌ |
| `zzz-probe.` / `zzq7x-nonexistent.` | negative-test probes, including mine | ❌ they must NOT resolve — that is the assertion |

⚠ **Do not restore a `*.kartavaya.com` wildcard.** It is what made every
subdomain answer with the dead Vercel deployment, and it makes the
"does-not-resolve" negative tests meaningless.

---

## The confirmed topology — owner, 2026-08-30

| Host | Role |
|---|---|
| `www.kartavaya.com` | the landing page and where the CTA lands |
| `app.kartavaya.com` | login, and the product behind it |
| `pay.kartavaya.com` | viewing an invoice, the QR and the UPI string |
| `api.kartavaya.com` | the backend |
| `staging.kartavaya.com` | future staging work |

**All four web hosts are ONE Cloudflare Pages project.** `frontend/src/App.jsx:156`
— `RootGate` renders `<LandingPage />` when there is no user and the app shell
when there is, so a single build already serves both faces. `/i/:token` is owned
by a Pages Function (`frontend/functions/i/[token].js`), so `pay.` needs no
separate deployment either.

⚠ **One consequence worth deciding.** Because it is one build, a logged-out
visitor to `app.kartavaya.com` gets the **landing page**, not the login form.
The owner's intent is "app is where login goes". Two ways:

- **A Cloudflare Redirect Rule** — on hostname `app.kartavaya.com`, path `/`,
  redirect to `/login`. No deploy, no code. Recommended.
- A hostname check in `RootGate`, alongside the `isInstalledApp()` branch that
  already does exactly this for the installed app.

---

## Setup, in order — and what breaks if you skip it

### 1 · Cloudflare Pages custom domains (fixes the outage)

**Workers & Pages** → the project serving `kartavaya.pages.dev` → **Custom
domains** → **Set up a custom domain**, once each:

    kartavaya.com
    www.kartavaya.com
    app.kartavaya.com
    pay.kartavaya.com

Cloudflare writes the DNS and issues the certificates. **Do not hand-write a
record** — that is what produced both the Vercel 404 and the current `1016`.

### 2 · Railway custom domain for the API

Service **Kartavaya** → **Settings → Networking → Custom Domain** →
`api.kartavaya.com`. Keep the DNS record **⚪ DNS only** — behind the proxy
Railway cannot complete its ACME challenge.

### 3 · Railway variables — ⚠ THIS IS THE STEP THAT SILENTLY BREAKS EMAIL

| Variable | Set to | Breaks if wrong |
|---|---|---|
| `FRONTEND_URL` | `https://app.kartavaya.com` | invite, approval and reset links |
| `PAY_URL` | `https://pay.kartavaya.com` | **every invoice link** |
| `FROM_EMAIL` | `Kartavaya <no-reply@kartavaya.com>` | SPF/DKIM — `kartavaya.com` is the only SES-verified domain |
| `CORS_ORIGINS` | must include `https://www.kartavaya.com`, `https://app.kartavaya.com`, `https://pay.kartavaya.com`, `https://kartavaya.com` | **the browser blocks every API call** from the new hosts |

`CORS_ORIGINS` is the one with no visible symptom in a log: the request never
reaches the server, and the only trace is a console error in the visitor's
browser.

### 4 · CSP — add the two new hosts

The live CSP is **`frontend/public/_headers`**, not `vercel.json`; the site is on
Pages and Vercel's header block is inert. `connect-src` currently names the apex,
`www`, `staging`, `api` and `api-staging` — **not `app.` or `pay.`**. Strictly,
`connect-src` governs where a page may send requests, so the app calling
`api.kartavaya.com` is already allowed. Add them anyway so a future
cross-host fetch does not fail with a console-only error, and keep `vercel.json`
in step so the two files never disagree.

⚠ Adding hosts to `connect-src` is safe. **Do not touch the `sha256-` in
`script-src`** — one stale hash there stopped the inline theme bootstrap running
on every load, silently, for days.

### 5 · Cookies — no change needed, and here is why

`COOKIE_DOMAIN` is unset in Railway, so the session cookie is **host-only to
`api.kartavaya.com`**. That still works from `app.kartavaya.com`: both share the
registrable domain `kartavaya.com`, so they are **same-site**, and
`samesite="lax"` does not block the request. It requires only that CORS allows
credentials — hence step 3.

Set `COOKIE_DOMAIN=.kartavaya.com` **only** if a cookie must be readable across
subdomains. It widens the blast radius of a session and is not needed today.

### 6 · Staging, when you get to it

`staging.kartavaya.com` on the staging Pages project, and
`api-staging.kartavaya.com` on the Railway **staging** service. Also set
`PAY_URL` on staging to a staging origin — its own comment warns that unset it
points at production, "and production would answer 404" for a staging token.

### 7 · Verify

    node scripts/check-production-targets.mjs

---

## How to create them


### Pages hosts — apex, `www`, `app`, `pay`, `staging`

**Do not hand-write DNS.** Cloudflare dashboard → **Workers & Pages** → the
project → **Custom domains** → **Set up a custom domain**, once per hostname.
Cloudflare writes the record and issues the certificate itself.

A hand-written CNAME to `*.pages.dev` without the project binding returns a Pages
404, and a hand-written proxied record with no origin is the `1016` the zone is
serving right now. Both failure modes have already happened here.

### Railway hosts — `api`, `api-staging`

Railway dashboard → service → **Settings → Networking → Custom Domain**. Railway
issues its own Let's Encrypt certificate, which is why these must stay
**⚪ DNS only** — behind Cloudflare's proxy Railway cannot complete the ACME
challenge and will never issue one.

⚠ `api.kartavaya.com` already has its CNAME and a `_railway-verify` TXT, so the
flow was started and never finished. Measured: the host serves
`CN=*.up.railway.app` with SAN `*.up.railway.app, up.railway.app` —
`api.kartavaya.com` is **not in the SAN**. Adding it as a custom domain on the
service is the missing step. CAA already permits `letsencrypt.org`.

---

## Verifying

    node scripts/check-production-targets.mjs

Checks `.env.e2e`, `mobile/.env`, the URL inlined in the built APK, `/api/health`
on both services, and whether the public domain actually serves. Exits 1 on any
staging reference during a production run.

---

## The order to do it in

1. **Pages custom domains** — apex and `www` first; the site is down until these exist.
2. **`app.` and `pay.`** — before any wave that mails, because they are inside the mail.
3. **Read `FRONTEND_URL` and `PAY_URL` in Railway** and make them match what you created.
4. **`api.` custom domain on Railway** so the certificate issues.
5. **Staging pair** — `staging.` and `api-staging.` — before the staging half of anything.

---

## Mail — measured 2026-08-30, after the Cloudflare Email Routing setup

    node scripts/check-sender-dns.mjs

| Leg | State | Notes |
|---|---|---|
| **SPF** | ✅ | `v=spf1 include:amazonses.com include:_spf.mx.cloudflare.net -all` |
| **DMARC** | ✅ | `p=none; rua=mailto:kevalvshah03@gmail.com` |
| **MX** | ✅ | 3 × `route{1,2,3}.mx.cloudflare.net` |
| **DKIM** | 🟡 | **1 of 3 SES selectors publishes a key** |

### ⚠ The SPF record had to be MERGED, not added

Cloudflare Email Routing offers to "Add missing records", which would have
written a **second** SPF TXT. RFC 7208 §3.2: more than one SPF record is a
`permerror`, and a permerror is a *fail* — it would have taken SES authorisation
down while appearing to fix something. The live record is one string carrying
both includes. **Cloudflare's Email Routing page may keep showing
"Misconfigured" because it string-matches its own exact value. That is cosmetic;
the gate is the authority.**

### 🟡 Two of the three DKIM selectors have no key — and it is not ours to fix

| Selector | Our CNAME | What Amazon serves |
|---|---|---|
| `ody3xdzxnqda…` | ✅ correct | **empty TXT** |
| `xupbuue3mpqb…` | ✅ correct | ✅ 2048-bit key |
| `zp4yebqf6x7c…` | ✅ correct | **empty TXT** |

All three CNAMEs in this zone are right and resolve to
`<selector>.dkim.amazonses.com`. Amazon serves nothing at two of them, so no DNS
edit here changes it — it is an SES-side state (re-verify the identity in the SES
console if it persists).

⚠ **Do not blame the `*._domainkey` wildcard.** RFC 4592 §2.2.1: a wildcard is
not synthesised when an exact match for the name exists, of any type. The
selectors each have their own CNAME, so the wildcard never applies to them — the
gate proves this every run with a control probe for a selector that cannot exist.
The wildcard is a deliberate catch-all revoking everything *else*, which is an
anti-spoofing measure, not a fault. An earlier version of the gate got this
wrong and would have sent someone hunting the wrong record.

**Impact:** SES rotates among its selectors, so an unknown share of mail signs
with a dead one and fails DKIM. Under `p=none` nothing is rejected, but Gmail's
bulk-sender rules want DKIM to pass. **The decisive test is one real send with
the headers read** — `Authentication-Results` is ground truth and DNS is not.

### Receiving — Email Routing is enabled but routes NOTHING yet

Measured from the dashboard: **Status Enabled**, DNS records **Locked**,
destination `kevalvshah03@gmail.com` **Verified** — and the only rule is
**Catch-all → Drop → Disabled**.

So the MX records accept mail and then nothing forwards it. **One rule is still
owed:** Routing rules → *Create routing rule* → custom address
`no-reply@kartavaya.com` → *Send to* → `kevalvshah03@gmail.com`.

Prefer that specific rule over enabling the catch-all: a catch-all accepts mail
for every address that has ever been guessed at the domain, which is how a new
domain acquires a spam problem. Leaving the catch-all on *Drop* means anything
unmatched is refused at SMTP rather than silently swallowed.

⚠ `no-reply@` still needs to *receive*, despite the name — it is where bounces
and human replies land. Without the rule they hard-bounce.
