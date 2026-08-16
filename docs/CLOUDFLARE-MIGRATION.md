# Cloudflare Pages migration — the plan

**Owner:** Keval Shah · **Written:** 8 August 2026
**Build day:** ~~Wednesday 12 August~~ · **Cutover:** ~~weekend of 15–16 August~~ — **dates lapsed; awaiting new ones.**

## Status, 2026-08-16 — the code half is DONE and inert in the repo

Everything that could be prepared without a Cloudflare account is on `staging`,
shipping harmlessly through Vercel today (Vercel ignores all three), live the
moment a Pages project builds from `frontend/`:

- **W1** ✅ settled by measuring the live site: `frontend/vercel.json` is the real
  config (the live headers exist only there); the root `vercel.json` was dead and
  is deleted.
- **W2** ✅ `frontend/public/_headers` — live header set reproduced, the
  `staging.kartavya.com` misspelling fixed, analytics hosts pre-swapped to the
  Cloudflare pair (pairs with the S3 code swap below).
- **W3** ✅ `frontend/public/_redirects` — SPA fallback.
- **W4** ✅ `frontend/functions/i/[token].js` — the OG crawler card as a Pages
  Function; it does the crawler/human split itself since `_redirects` cannot
  match a User-Agent. The token-guessing defence carried over verbatim.
- **W5** prepared, NOT landed (by design — S3, cutover day): in
  `frontend/src/index.jsx` remove the `@vercel/analytics` `inject()` import+call
  and add `<script defer src="https://static.cloudflareinsights.com/beacon.min.js"
  data-cf-beacon='{"token": "<B4 token>"}'></script>` to `index.html`. The CSP in
  `_headers` already allows it and already dropped the Vercel pair.

**Next actionable step is yours: A1–A2 (registrar check + DNS zone export).**
Everything below keeps its sequence; only the dates need replacing.

Background and the reasoning behind every choice: `docs/proposals/40-vercel-hobby-licence.html`.
Everything *you* have to do by hand, and the data we collect along the way:
**`docs/CLOUDFLARE-OWNER-ACTIONS.md`**.

---

## The one design decision that makes this safe

**The migration branch is additive. It does not break Vercel.**

Vercel and Cloudflare read different files and ignore each other's:

| File | Vercel | Cloudflare Pages |
|---|---|---|
| `frontend/vercel.json` | reads | **ignores** |
| `frontend/api/og.js` | reads | **ignores** |
| `frontend/public/_headers` | ignores | **reads** |
| `frontend/public/_redirects` | ignores | **reads** |
| `frontend/functions/` | ignores | **reads** |

So both configurations live side by side in one branch. On Wednesday we get a working Cloudflare
deployment at a `*.pages.dev` URL **while `kartavaya.com` continues to serve from Vercel, untouched**.
Nothing about production changes until the nameservers move at the weekend, and rollback at any point
is "leave the nameservers alone".

The only genuinely either/or item is analytics, and we keep both until cutover.

---

## Wednesday 12 August — the build

Branch: `cloudflare-migration`, cut from `staging` at whatever `staging` is that morning.

### W1 · Cut the branch and confirm which `vercel.json` is live *(30 min)*

There are two `vercel.json` files with **conflicting** Content-Security-Policies. The root one allows
`script-src 'unsafe-inline' 'unsafe-eval'`; `frontend/`'s pins a script hash and allows neither. Only
one is in effect.

`docs/DEPLOY.md` says Root Directory is `frontend`, which would make the root file dead — but that
doc is badly stale (it still describes MongoDB and Create React App), so it is corroboration, not
proof. Settle it by reading the header off the live site:

```bash
curl -sI https://kartavaya.com | grep -i content-security-policy
```

If the hash appears, `frontend/vercel.json` is live and the root file is dead. Delete the dead one.
**Do not merge them** — the weaker CSP must not win.

### W2 · Translate the headers *(1–2 h)*

Create `frontend/public/_headers` reproducing, exactly, what the live `vercel.json` sends:

- `/assets/*` → `Cache-Control: public, max-age=31536000, immutable`
- `/sw.js` → `no-cache, no-store, must-revalidate` **and** `Service-Worker-Allowed: /`
- `/index.html` → `no-cache, no-store, must-revalidate`
- `/*` → the full CSP, plus HSTS, `X-Frame-Options`, `X-Content-Type-Options`,
  `Referrer-Policy`, `Permissions-Policy`

Two edits to the CSP while we are in there:

1. **Fix the misspelling.** It currently allows `connect-src https://staging.kartavya.com` —
   `kartavya`, not `kartavaya`. It permits a domain that is not ours and blocks the one that is.
2. Leave the Vercel analytics hosts in place for now; they come out in W5 at cutover.

`_headers` syntax is *not* `vercel.json` syntax — no JSON, indentation-sensitive, first match wins.
Verify by diffing live response headers, never by reading the file (see W7).

### W3 · Translate the routing *(30 min)*

`frontend/public/_redirects`:

```
/*    /index.html   200
```

The crawler rule does **not** go here. It becomes a function — next step.

### W4 · Port the OG function *(1 h)*

`frontend/api/og.js` currently exists because `vercel.json` rewrites `/i/:token` to it *only* for
crawler User-Agents. Its header comment is candid that the cleaner design was rejected only because
it meant reproducing Vite's hashed asset names by hand.

Cloudflare Pages Functions have an `ASSETS` binding, so that objection disappears. New file
`frontend/functions/i/[token].js`:

```js
const CRAWLER = /(whatsapp|facebookexternalhit|facebookcatalog|twitterbot|telegrambot|slackbot|linkedinbot|discordbot|skypeuripreview|embedly|bitlybot|googlebot)/i;

export async function onRequest({ request, params, env }) {
  const ua = request.headers.get('user-agent') || '';
  if (!CRAWLER.test(ua)) {
    // A human. Serve the real built shell — no hashed-filename guessing.
    return env.ASSETS.fetch(new URL('/index.html', request.url));
  }
  return ogCard(params.token, env);
}
```

`ogCard` is the body of today's `api/og.js`, moved across unchanged.

> **This must not change:** a draft, cancelled, settled or unknown token all produce the *same*
> generic card. That is deliberate — a card that said "this invoice is settled" would confirm a
> guessed token to anyone holding one. `routers/pay.py` is written to avoid exactly that. Carry the
> behaviour over verbatim and test it.

Leave `api/og.js` in place. Vercel still needs it until cutover.

### W5 · Prepare the analytics swap — do not pull the trigger *(45 min)*

Write the change but keep it inert until cutover:

- `@vercel/analytics` and the `inject()` call in `src/index.jsx:5`
- Cloudflare Web Analytics beacon added
- CSP loses `va.vercel-scripts.com` and `vitals.vercel-insights.com`

Cloudflare Web Analytics is cookieless, which quietly improves the DPDP posture by removing a
third-party beacon from every page.

### W6 · Create the Pages project and deploy to `*.pages.dev` *(1 h)*

Build config: root `frontend`, build `npm run build`, output `dist`, Node 24.
Env vars — eight of them, production *and* preview — are listed in the owner-actions file.
**No custom domain attached yet.** This step must not touch `kartavaya.com`.

### W7 · Verify on `*.pages.dev` *(1–2 h)*

The whole point of Wednesday is that this list is green four days before anyone touches DNS.

```bash
# headers must match byte for byte
diff <(curl -sI https://kartavaya.com          | tr -d '\r' | sort) \
     <(curl -sI https://<project>.pages.dev    | tr -d '\r' | sort)

# the crawler path
curl -sA "WhatsApp/2.0" https://<project>.pages.dev/i/<live-token> | grep -i "og:"
# a human on the same URL must get the SPA shell, not the card
curl -s  https://<project>.pages.dev/i/<live-token> | grep -c "id=\"root\""
```

Then by hand: deep-link into a few SPA routes, confirm the service worker registers at scope `/`,
confirm Supabase realtime connects over `wss://`, and send one real WhatsApp message containing a
`*.pages.dev` share link to check the preview card renders.

`npm run check` **exits 0 on unparseable CSS** and will not catch any of this. Run `npm run build`
too, and trust the response headers over the files.

### W8 · Write it down, push, stop *(30 min)*

Fill in every value collected into `docs/CLOUDFLARE-OWNER-ACTIONS.md`, push the branch, and change
nothing else. Production is still Vercel and still fine.

**Wednesday total: ~6–8 hours. Zero production impact.**

---

## Before the weekend — one thing only you can do

**The registrar risk is closed.** Confirmed 8 August: the domain is ours, registered directly. Vercel
only operates the nameservers, which is a setting we change at will — no transfer, no 60-day lock,
nothing that can move the date. **The weekend of 15–16 August is firm.**

That leaves one prerequisite, in the owner-actions file:

- **Export the zone file** from the Vercel dashboard. This is the only authoritative list of DNS
  records. Cloudflare's auto-scan cannot see through a wildcard and will silently miss things.

Plus one convenience: have the registrar login to hand, and confirm the domain is unlocked for
nameserver changes, so nobody is hunting for credentials on cutover morning.

---

## Weekend 15–16 August — the cutover

Saturday morning IST. Roughly two hours of work, then a two-day propagation window during which
nothing is required of anyone.

### S1 · Rebuild the zone at Cloudflare *(1 h)*

Add the site, let the auto-scan run, then **reconcile it against the Vercel export line by line**.
Recreate explicitly:

- apex `A` → Pages
- `www` → Pages
- **`*.kartavaya.com`** — the wildcard. `staging`, `app`, `api` are *not* real records today; they
  are the wildcard answering. Miss it and every subdomain dies at once.

Set **SSL/TLS → Full (strict)**. Do not change nameservers yet.

### S2 · Verify the new zone before it is live *(45 min)*

Query Cloudflare's assigned nameservers directly, while the world still sees Vercel:

```bash
for n in kartavaya.com www.kartavaya.com zzq7x-nonexistent.kartavaya.com; do
  echo "== $n"; nslookup $n <cf-nameserver>
done
```

The nonsense subdomain is the wildcard test — it must resolve. Diff every answer against the live
zone. This step is what makes the cutover boring.

### S3 · Attach the custom domain to Pages, land the analytics swap *(30 min)*

Certificates issue automatically and free — same as Vercel. HSTS on this domain is
`preload; includeSubDomains`, so **no subdomain may drop to plain HTTP at any point**.

### S4 · Switch nameservers at the registrar *(30 min + up to 48 h)*

Zone TTL is already 600s, but **NS records at the TLD carry a 48-hour TTL**. Resolvers will serve
old and new for up to two days and both must answer correctly throughout — which is precisely why
the Vercel project stays paid, live and untouched.

### S5 · Merge, then wait

Merge `cloudflare-migration` → `staging` → `main`. Then wait a **full week after propagation
completes** — not after the switch — before cancelling anything.

### S6 · Decommission

Delete `frontend/vercel.json`, `frontend/api/og.js`, the Vercel project, and rewrite the stale
`docs/DEPLOY.md`.

---

## Rollback

Until S4, rollback is *do nothing* — production never moved.
After S4, revert the nameservers at the registrar; the Vercel zone is still live and still correct.
The rollback stops being free only at S6, which is why S6 waits a week.

---

## Risks, ranked

| Risk | Mitigation |
|---|---|
| A zone record nothing outside can see is silently dropped | Export the zone from Vercel first; treat that file, never the auto-scan, as truth |
| The wildcard is not recreated and every subdomain dies | Explicit item in S1; nonsense-subdomain test in S2 |
| CSP differs subtly after translation and a page breaks quietly | Diff live response headers in W7; `npm run check` will not catch it |
| The invoice preview card regresses unnoticed | Crawler paths are invisible in normal use — test with `curl -A whatsapp` **and** a real WhatsApp send |
| Service worker scope changes, clients cache a stale shell | `Service-Worker-Allowed: /` and the no-store rule reproduced exactly; verified in W7 |
| Mobile builds point at the wrong origin | `build:staging` feeds the Capacitor APK; confirm `VITE_*` parity before the mobile pipeline next runs |

---

## What this does not touch

Resend, Apify, Gemini, Serper, WhatsApp Cloud, the connector OAuth flows, the payment link
programme — all terminate on **FastAPI on Railway**. None run on Vercel.

**Email is not affected at all.** `kartavaya.com` has no MX, SPF, DKIM or DMARC record. Mail runs on
`unicodegroup.com` at IONOS on entirely separate nameservers. This removes the most dangerous failure
mode a DNS migration normally carries.
