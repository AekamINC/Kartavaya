# Kartavya

PM SaaS for Indian firms, by Aekam Inc. Vite + React (`frontend/`), FastAPI +
asyncpg (`backend/`), Supabase Postgres, Railway backend + Vercel frontend,
Expo React Native app (`mobile/`). Two branches only: `staging` is where work
happens, `main` is production. Test against staging.kartavaya.com. The domain
is **kartavaya.com** — not kartavya.com.

## The one dangerous fact

**Staging and production share a single Supabase database.** Only the
`staging` and `public` schemas exist, and production writes to `staging` too —
so every migration and every write-path probe touches production data.

- Never test validation by writing to the live DB.
- Before trusting any live probe, confirm which SHA the service is actually
  running (staging has silently tracked `main` before — check `meta.branch`).
- Always state write-path side effects before running a migration; provide a
  short report of risks first.

## Commands

- **Backend tests: run from `backend/`, never the repo root.** The root
  invocation reports ~58 spurious failures; from `backend/` the suite is
  ~5,200 green. `cd backend && python -m pytest -q`.
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
- `vercel.json` accepts no comments: a `"//"` key kills the deploy before the
  build starts, with no logs, and the site silently stays on the old build.
- Cron endpoints authenticate via `CRON_SECRET`; `/cron/reports` and
  `/cron/esign` are 501 stubs — never arm them.
