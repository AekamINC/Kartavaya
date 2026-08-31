# Kartavya

PM SaaS for Indian firms, by Aekam Inc. Vite + React (`frontend/`), FastAPI +
asyncpg (`backend/`), Supabase Postgres, Railway backend + Vercel frontend,
Expo React Native app (`mobile/`). ⚠ **WORK HAPPENS ON `main`, AND `main` IS
PRODUCTION.** Everything from `staging` was moved to production; the `staging`
branch is 30 commits behind and nothing is developed on it. **Both branches
deploy against the SAME database — see "The one dangerous fact". Testing
"against staging" protects nothing; there is no safe host.** ⚠
`staging.kartavaya.com` does not resolve today, and
`docs/DNS-AND-SUBDOMAINS.md` carries a pending step to create it: **do not
execute that step** without reading this file first — it would turn this line
from fail-closed into fail-open. The domain is **kartavaya.com** — not
kartavya.com.

## Keeping status current — read this before claiming anything is "done"

`docs/STATUS.md` is the single source of truth for what is built, half-built,
and broken. `docs/plans/` holds the phased plan; `docs/FINAL-VERDICT-00-90.md`
the arc. **This structure exists because the team kept losing track of state and
re-deriving it from scratch** — proposals 00, 07, 21, 27, 82 and 90 are all the
same status audit, written over and over. Do not add a proposal 91.

- **When a change lands, update `docs/STATUS.md` and append to
  `docs/plans/PROGRESS.md` in the same commit.** It is part of "done".
- **✅ means a customer can complete the flow end to end**, proven by a row
  appearing where there were zero — not "the code shipped". Code-without-data is
  🟡. This distinction is the entire lesson of the 84–90 era.
- **Never call a table, column or route "missing" without a live query** in your
  report, and **never ship a router without one test that executes its SQL**
  against the real schema. Both failure modes are documented in `docs/plans/PHASE-6`
  and each produced a shipped blocker.

## The one dangerous fact

**There is ONE system. `staging` is a label on a second front door, not a
second place.** One Supabase project (`toacecaewujfxjfrjwco`), one schema
(`public`), one R2 bucket, one JWT secret, one set of provider credentials.
Both Railway environments carry the same `DATABASE_URL` — only the pooler port
differs, and `db.py` rewrites it on failure. **Nothing in the backend branches
on environment before a write** (`git grep -E 'is_production|IS_PRODUCTION' --
backend` returns nothing). A write through the staging front door is a
production write; a DELETE through it is a production DELETE; a file uploaded
through it is a production object.

The staging label buys exactly one thing: `OUTBOUND_MODE=dry`, which suppresses
mail, push and social — **not data** — and it does not skip the business write,
it changes the value written (`status='suppressed'`) into production tables.
Two differences make staging *worse* than production, not safer: it runs a
backend 30 commits stale, and it serves `/docs` + `/openapi.json`
unauthenticated where production 404s both.

Every migration and every write-path probe touches production data. **There is
nowhere to be wrong.**

⚠ **`staging` THE SCHEMA NO LONGER EXISTS.** Migration 241 moved all 258 of its
tables into `public` and `DROP SCHEMA staging RESTRICT` ran the same evening.
`DB_SCHEMA` is gone from the code; nothing reads it. Anything written before
2026-08-29 that names `staging.<table>` is describing history, not the database.

    production /api/health -> {"schema":"public","environment":"production"}

`/api/health` reports `current_schema()` read from the connection, so which
schema a deploy actually resolves is always checkable rather than assumed.

⚠ **RLS IS THE ONLY TENANCY CONTROL THAT WORKS, AND IT WORKS BY DENY-ALL.**
`public` is exposed to PostgREST; the anon key is compiled into the shipped
browser bundle. All 300 tables carry RLS with no policies, which is why a
holder of that key reads nothing. **A new table without RLS is a cross-tenant
leak the moment it is created, and it produces no error and no log line.**
Two views were exactly this hole on 2026-08-29 — `SECURITY DEFINER`, owned by
a `BYPASSRLS` role, readable by `anon` — and were closed with
`security_invoker = on`. Run the Supabase security advisor after any DDL and
treat a new `rls_disabled_in_public` as a breach, not a lint.

⚠ **THE SCHEMA COUNT IS A MEASUREMENT WITH A DATE, NOT A CONSTANT.** It was
fourteen on 08-27, fifteen on 08-29 morning, sixteen after the pre-merge
backup, and fifteen again after the drop. Re-run it; do not cite it:

    SELECT count(*), string_agg(nspname, ', ' ORDER BY nspname)
    FROM pg_namespace
    WHERE nspname NOT LIKE 'pg_%' AND nspname <> 'information_schema';

`public` is the product's only schema. `auth`, `extensions`, `graphql`,
`graphql_public`, `realtime`, `storage`, `supabase_migrations` and `vault` are
Supabase's. The rest are dated restore points, including
**`premerge_backup_20260829`** — 258 tables, 29,608 rows, row-verified, the
reversal path for the consolidation.

- Never test validation by writing to the live DB.
- Before trusting any live probe, confirm which SHA the service is actually
  running (staging has silently tracked `main` before — check `meta.branch`).
- Always state write-path side effects before running a migration; provide a
  short report of risks first.

## Commands

- **Backend tests: run from `backend/`, never the repo root.** The root
  invocation reports ~58 spurious failures. From `backend/` the suite collects
  **15,127** tests (measured 2026-08-27 — this line said "~5,200 green" until
  then, which was roughly a third of the real number). `cd backend && python -m
  pytest -q`. ⚠ **The full local run HANGS after a heavy session** — no output,
  40+ minutes. Run targeted files and let CI be the full check.
- **Frontend:** `npm run check` for the gate suite — but it exits 0 on
  unparseable CSS, so run `npm run build` before pushing style changes.
  Playwright e2e lives in `frontend/e2e-real` (creds in `.env.e2e`).
- **Mobile:** `npm test` in `mobile/` (node test runner, not jest).
  Local APK: `bash mobile/scripts/build-apk.sh release` — debug APKs carry no
  JS bundle and are useless off this machine; the script also applies the
  metaspace bump a release build needs. **Expo Go cannot run this app**
  (react-native-mmkv is a native module); only a dev build or APK runs it.
  Mobile probes need a cold restart — hot reload lies.
- **Module docs are generated.** `docs/modules/*.md` come from
  `scripts/module-facts.mjs` + `scripts/gen-module-docs.mjs`; regenerate,
  never hand-edit.

## Code conventions

- **SQL:** asyncpg bind parameters only; dynamic identifiers (sort keys,
  column names) come from server-side allowlists — follow the existing router
  patterns. Cast ambiguous parameter expressions (`$1::int + $2::int`):
  PgBouncer turns an untyped parse error into an instant 500.
- **Names, not IDs:** never render a user/member/org UUID in any UI. The
  ratchet is `frontend/scripts/check-rendered-ids.mjs`.
- **Dates:** no native `<input type="date">` anywhere — use
  `frontend/src/components/ui/DateInput.jsx`. Playwright must use `setDate()`.
- **Tables:** every table sits on the `--row-h` token (66px default,
  tiers 48/66/76). One row contract; use the DataTable barrel.
- **Design system:** `k-*` classes and `editorial.css` tokens. All pages are
  fluid and left-aligned — no fixed-width centering.
- **Emails:** user-controlled fields are escaped at the `email_service.py`
  choke points (`_safe_subject`, `html.escape`); follow those patterns for any
  new template.
- **Rate limiting:** slowapi on anything auth-shaped (login is 5/min).
- **CSS cleanup is never done by string-matching selectors** — a delete-by-
  selector script once ate an unrelated rule via a comment. Edit rules
  structurally or by hand.
- Proposals go in `docs/proposals/` as self-contained HTML — never temp
  files, never Markdown-only.

## Product rules that keep regressing

- **GSTIN / PAN / TAN are non-mandatory and must block nothing.** This has
  drifted back more than once; do not "fix" it.
  ⚠ **THE RULE IS ABOUT CAPTURE, NOT EMISSION**, and the difference is not a
  loophole. Nothing may *require* a GSTIN/PAN/TAN to save a client, an invoice,
  an employee or a contact. A **statutory form that the law reports under one of
  those registrations may still refuse to be issued without it** — a GSTR-1
  preview has nothing to attribute supplies to without a supplier GSTIN, and an
  ITNS-281 TDS challan without a TAN is invalid under **s.203A**, where a PAN is
  explicitly not a substitute.
  Suite 05.17 hit exactly this on 2026-08-31, refused to rule on it (93 §14) and
  handed it up. The verdict: `validate_tds_challan` and the GSTR-1 preview's
  `supplier_gstin_missing` are **CORRECT and must not be relaxed**. Both name the
  field, the section and the screen that fixes it, which is the behaviour wanted
  — the alternative is emitting a document the department will reject, or
  inventing a number to fill the gap. If a real customer is blocked here, the
  answer is to enter their TAN, not to remove the check.
- Unpaid invoices are editable — and `doc_status` defaults to `'final'`, so
  don't infer editability from that column.
- A CRM client is the **company** (the customer). Contacts are people who
  come and go; the customer stays. Sales customers derive from
  `graha_clients` + `vikray_orders.client_id`.
- `users.role` is a per-org fact stored in one global column. Rows that look
  corrupt (org admins with `role='client'`) are real; never clean them.
- eSign is web-only — not a mobile destination. Mobile invoices are
  read-only.
- UPI is one ID **per platform** (Paytm/PhonePe/GPay), not one VPA field.
- There is no payment gateway and never will be: "paid" only ever comes from
  bank reconciliation.

## AI runtime

Production uses cheap models. Gemini versions are **pinned** — never
`-latest` (2.0 is quota-zero, 2.5 closed to new keys). Web search is Serper,
not Gemini grounding. Claude is a development tool here, not a runtime
dependency.

## Infra

- The database stays on Supabase, permanently — never suggest Neon or any
  migration off it. Region stays Singapore.
- **Vercel is gone — the frontend is Cloudflare Pages.** Verified 2026-08-30: all
  four hosts answer `Server: cloudflare` with no `x-vercel-*` header.
  `frontend/vercel.json` and `.vercel-trigger` are **deleted**, and
  `check-csp-hash.mjs` fails if either returns — a file that looks like config
  and serves nothing is how a rule ends up maintained where nobody reads it.
  (The old rule here was "`vercel.json` accepts no comments: a `\"//\"` key kills
  the deploy with no logs." Obsolete, and kept only so the next person who finds
  a `vercel.json` in an old branch knows why it went.)
- **`frontend/public/_headers` is the ONLY shipped CSP.** It carries the sha256
  of the inline pre-paint bootstrap in `index.html`; if they drift, the browser
  silently refuses the script on every load — a frame of the wrong theme, and on
  Windows a blurred sidebar that snaps solid. `check-csp-hash.mjs` pins the hash
  **and** the directives four incidents were caused by losing (`camera=(self)`,
  the Mappls hosts, `worker-src 'self' blob:`, the `/assets/*` Cache-Control
  detach). ⚠ Cloudflare also injects its own `__CF$cv$` inline script whose hash
  changes every request — its console error is expected, and **must not** be
  silenced with `'unsafe-inline'`.
- Cron endpoints authenticate via `CRON_SECRET`; `/cron/reports` and
  `/cron/esign` are 501 stubs — never arm them.
