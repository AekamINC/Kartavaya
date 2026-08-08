# Cloudflare migration — everything only you can do

**This is the file to work from.** The plan is `docs/CLOUDFLARE-MIGRATION.md`; the reasoning is
`docs/proposals/40-vercel-hobby-licence.html`. This file is the checklist plus the store for every
value we collect, so that on cutover weekend nothing has to be looked up.

> ## ⚠ No secrets in this file
> It is committed to git. Put **names, IDs, hostnames and settings** here. Anything sensitive —
> API keys, tokens, passwords — goes in `.env.cloudflare` at the repo root, which is gitignored.
> `VITE_*` values are baked into the public JS bundle and are not secret, but copy them from the
> Vercel dashboard rather than retyping from memory.

Fill in every `_____` as you go. Tick boxes as they complete.

---

## ⏰ Do this Monday 10 August

> ### ✅ Registrar risk is closed
> **Confirmed by Keval, 8 August 2026: the domain is ours, registered directly — not bought through
> Vercel.** Vercel only runs the nameservers (`ns1/ns2.vercel-dns.com`), which is a setting we can
> change at will. **No transfer, no 60-day lock, nothing that can move the cutover date.**
> The weekend of 15–16 August is firm.

- [ ] **A1 · Note the registrar login, so nobody is hunting for it on cutover morning.**
  We only need to change two nameserver fields there — nothing else.

  - Registrar: `_____`  *(if it is IONOS, that is the same place `unicodegroup.com` lives)*
  - Login is with: `_____`
  - Domain expiry date: `_____`  *(worth a glance — an expiry mid-migration would be its own outage)*
  - [ ] Confirm the domain is **unlocked** for nameserver changes, and that you can reach the
        NS fields. Do not change them yet — just confirm you can.

- [ ] **A2 · Export the DNS zone file.**
  Vercel dashboard → **Domains → `kartavaya.com` → DNS Records**. Export, or screenshot every record
  if there is no export button. Save as `docs/dns-zone-vercel-2026-08.txt`.

  > This is **the only authoritative list of DNS records.** Cloudflare's auto-scan cannot see through
  > the wildcard `*.kartavaya.com` and will silently miss records. Do not skip this and do not let
  > the scan be the source of truth.

  - Saved to: `_____`
  - Total record count: `_____`
  - Any record that surprises you: `_____`

- [ ] **A3 · Decide on interim cover.**
  One month of Vercel Pro (~₹1,750 / $20) removes the licence exposure today, so the migration
  happens without a clock running. Optional, recommended.

  - Decision: **buy / skip** → `_____`

---

## 🔧 Wednesday 12 August — while I build

- [ ] **B1 · Confirm the Cloudflare account to use.**
  You already have Cloudflare for R2. Same account or a new one for Aekam Inc?

  - Account email: `_____`
  - Account ID: `_____`
  - Same account as R2? **yes / no** → `_____`

- [ ] **B2 · Give me access, or drive the dashboard yourself.**
  I need either an API token (scoped: *Pages: Edit*, *Zone: Edit*, *DNS: Edit*) or ten minutes of
  screen-share to click through it.

  - Method: `_____`
  - Token stored in `.env.cloudflare` as `CLOUDFLARE_API_TOKEN`: **yes / no**

- [ ] **B3 · Collect the eight environment variables from Vercel.**
  Vercel → project → **Settings → Environment Variables**. Copy the current *production* values.
  These get entered into the Pages project for **both** Production and Preview.

  | Variable | Where it comes from | Copied? |
  |---|---|---|
  | `VITE_BACKEND_URL` | Railway production URL | ☐ |
  | `VITE_SUPABASE_URL` | Supabase project URL | ☐ |
  | `VITE_SUPABASE_ANON_KEY` | Supabase publishable key | ☐ |
  | `VITE_ENVIRONMENT` | `production` | ☐ |
  | `VITE_PAY_BASE_URL` | payment link base | ☐ |
  | `VITE_LEAD_CTA_HREF` | lead CTA target | ☐ |
  | `VITE_AEKAM_STATE_CODE` | GST state code | ☐ |
  | `BACKEND_URL` | same as `VITE_BACKEND_URL`, for the OG function | ☐ |

  - Any variable in Vercel **not** on this list: `_____`
    *(If there is one, tell me — it means something in the app reads config I did not find.)*

- [ ] **B4 · Enable Cloudflare Web Analytics.**
  Cloudflare dashboard → **Analytics & Logs → Web Analytics → Add a site**.

  - Site tag / beacon token: `_____`
  - *(This replaces `@vercel/analytics`. It is cookieless, which is better for DPDP.)*

---

## 🚀 Weekend 15–16 August — cutover

Do these in order. Nothing before D4 affects production.

- [ ] **C1 · Add the site to Cloudflare and note the assigned nameservers.**

  - Nameserver 1: `_____`
  - Nameserver 2: `_____`

- [ ] **C2 · Reconcile the zone against the A2 export, line by line.**

  - [ ] apex `A` → Pages
  - [ ] `www` → Pages
  - [ ] **`*.kartavaya.com` wildcard** ← *the one that breaks everything if missed*
  - [ ] every remaining record from the export
  - Records that existed in the export but were **not** auto-detected: `_____`

- [ ] **C3 · SSL/TLS → Full (strict).**
  Cloudflare → SSL/TLS → Overview. The default on some zones is *Flexible*, which speaks plain HTTP
  to the origin. Confirmed set to Full (strict): `_____`

- [ ] **C4 · Verify the new zone before it is live** — I run this, you confirm it passed. `_____`

- [ ] **C5 · Attach `kartavaya.com` and `www` to the Pages project.**
  Certificates issue automatically and free. Confirmed both issued: `_____`

- [ ] **D4 · ⚠ Switch nameservers at the registrar.** *This is the irreversible-feeling one.*
  Replace `ns1.vercel-dns.com` / `ns2.vercel-dns.com` with the C1 pair.

  - Time and date switched: `_____`
  - **Do not touch the Vercel project after this.** It stays paid and live as the rollback for two
    days of propagation. NS records at the TLD have a **48-hour TTL**.

- [ ] **D5 · Confirm propagation complete** (~48 h later): `_____`

---

## 🧹 A week after propagation — not before

- [ ] **E1 · Cancel Vercel Pro** (if bought in A3): `_____`
- [ ] **E2 · Delete the Vercel project** `prj_RAQVCxQFFq51jDvvUbp2b1MV8ZN2`: `_____`
- [ ] **E3 · I delete** `frontend/vercel.json`, `frontend/api/og.js`, and rewrite `docs/DEPLOY.md`

> `docs/DEPLOY.md` is badly out of date regardless of this migration — it describes MongoDB Atlas and
> Create React App, and the app uses Supabase and Vite. It should not be trusted for anything today.

---

## Reference — verified 8 August 2026

Facts confirmed against the live Vercel API and public DNS, so nothing here needs re-deriving.

| | |
|---|---|
| Vercel account | `kevalvshah03-6145s-projects` (personal **Hobby**) |
| Team ID | `team_N8EhJHswADGRjRZmnFkiK2xL` |
| Project | `kartavya` · `prj_RAQVCxQFFq51jDvvUbp2b1MV8ZN2` |
| Node version | 24.x |
| Domains on Vercel | `kartavaya.com`, `www.kartavaya.com`, 3× `*.vercel.app` |
| **Current nameservers** | `ns1.vercel-dns.com`, `ns2.vercel-dns.com` |
| Apex `A` records | `64.29.17.1`, `216.198.79.65` |
| Zone default TTL | 600s (10 min) |
| **Wildcard** | `*.kartavaya.com` exists — `staging`, `app`, `api` are **not** real records |
| **MX / SPF / DMARC** | **none — no email on this domain** |
| Email actually runs on | `unicodegroup.com` → IONOS (`mx00/mx01.ionos.co.uk`), separate nameservers |
| Serverless functions | one — `frontend/api/og.js` |
| Vercel SDK in app | `@vercel/analytics`, injected `src/index.jsx:5` |
| Build output | `frontend/dist`, 7.2 MB |
| Config files | **two** `vercel.json` with conflicting CSPs — root one is almost certainly dead |

### Two known defects to fix in passing

1. **CSP names the wrong domain.** `frontend/vercel.json` allows
   `connect-src https://staging.kartavya.com` — `kartavya`, not `kartavaya`. It permits a domain that
   is not ours and blocks the one that is.
2. **No SPF or DMARC on `kartavaya.com`.** Unrelated to hosting, but it means anyone can send mail
   spoofing `@kartavaya.com`. Since the domain sends no mail, the fix is cheap and worth doing while
   the zone is open: a null MX (`0 .`) plus `v=DMARC1; p=reject`. Say the word and I will add it to
   the weekend list.
