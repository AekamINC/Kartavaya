# Next session — start here

Paste the block at the bottom into a fresh Claude Code session. Everything above
it is context for you, not for the agent.

---

## The one rule that matters

**The brief requires testing through the UI, as the user, clicking controls.**
The 2026-07-28 session ran API probes for the entire RBAC section instead and
reported it as fully correct. Twenty minutes of actual clicking afterwards found
two user-facing defects (F32, F33) that no status code could have shown.

Hours were lost to that. Do not repeat it.

- Sign in as the role → open the page → **click the control** → watch what happens.
- A status code is evidence only where there is no control to click.
- `200` and `403` say nothing about whether the button should have been there,
  what the form did with the input, or what the user was told.

## State as of 2026-07-28 evening

- **Branch:** `staging`. `main` is production — never touch it.
- **Test at:** https://staging.kartavaya.com — never `kartavaya.com`.
- **Full report:** `swarm-reports/LIVE-SESSION-2026-07-28.md` (~2,400 lines).
  Read its final section first.
- Backend suite: 1671 passed / 137 skipped. CI green.

### Verified and shipped
F14 F16 F17 F20 F21 F22 F23 F24 F26 F29 F30 · glass on four overlays · tabs 6→8 ·
Tally purchase path (ITC ties exactly) · payroll 863ms · RBAC 9/9 + 22
grant/revoke cycles.

### Open, in priority order

> **This list was written at the end of session A and went stale the same
> day.** F33 was already fixed and verified live in session B before it was
> ever read as open, and F4 (b) and most of F32 have since been done. Corrected
> below; check `git log` before trusting any priority list, including this one.

1. **The UI sweep** — 5 surfaces done of 9 modules, ~85 leaves, CRUD on most.
   **Still the job**, and now the only way to close F32 properly: it is defined
   by what a viewer SEES, and none of the work below was verified in a browser.
2. **F32 — written across all nine modules, verified in a browser NOWHERE.**
   ~130 write controls now gate on the caller's level, detail drawers included.
   The machinery: `/auth/me` carries `module_levels`, `ModuleAccess` publishes
   the module code from `AppShell` for every route in `ROUTE_META`, and
   `useModuleWrite` / `WriteGate` answer for any component under it.
   `npm run check` includes `check-write-gates.mjs`, which catches the hook
   being declared in a tab and spent in a sibling component — valid JSX that
   builds clean and white-screens the drawer at runtime.

   **What is left is looking at it.** Sign in as `ganit: viewer` and as a
   grantless member and walk the modules. The rule applied was
   `require_module`'s own — gated exactly when the click issues a non-GET —
   so the two things to watch for are a *read* that got greyed out (GST filing
   and the leave conflict-check are GETs and were deliberately left alone) and
   a write that was missed.

   **Sanvaad still has its own `useSanvaadAccess`**, deliberately: two access
   models beside each other are free to disagree. Its bespoke
   `GET /v1/messaging/me` predates `module_levels` and is now redundant —
   folding it into `useModuleWrite` is real, bounded work nobody has done.
3. **F4 step (a)** — raise the caps. Needs the frontend reading `total` first.
   Step (b) is **done**: all 26 `LIMIT` sites now carry `total`/`truncated`.
4. **Exports** — GST/Tally verified by file content; the *scheduled* report path
   (F11) still mails raw JSON.

### Closed since this file was written
- **F33** — fixed and verified live in session B. `/v1/org/modules` was never
  the mechanism; the nav reads `user.module_grants` from `/auth/me`, and
  `auth_router` was subtracting `SENSITIVE_MODULES` from a member's grants. Its
  docstring still argued for the subtraction long after the code stopped doing
  it, which is corrected too.
- **F4 (b)** — the remaining ten capped lists report `total`/`truncated`.
- **F42, F49, F50** — see `git log` on `staging` for 2026-07-29.

### Owner decisions — SETTLED 2026-07-28, do not re-raise

- **Org GSTIN stays `24AAAAA0000A1Z8`.** It was changed from `...1Z5` in error by
  a write probe; the owner has confirmed the new value stands. `...1Z5` fails its
  own check digit and can no longer be written anyway, now that the org profile
  validates on write. **Do not attempt to restore it.**
- **QA Test Corp and its accounts are KEPT for ongoing live testing.**
  **No action is needed to protect them.** Checked every scheduled job on
  2026-07-28: there is no automated test-data wipe. The 13 cron endpoints in
  `routers/scheduler.py` are reminders, publishing, invoices, CRM, HR, marketing,
  reports, e-sign, stock, agents and skills, plus two retention jobs — and both
  retention jobs are narrow (`/cron/retention` deletes old log/activity rows,
  `/cron/pahchan-retention` handles the biometric 72-hour buffer). Neither
  touches users, orgs or module grants, and no script in `backend/scripts/` does
  either. The plan's "test data is wiped at the end of the week" describes a
  manual intention, not a running job.
- **The owner's account stays `org_admin` in QA Test Corp.** It was added there
  to issue the invites and is deliberately left in place — it is how grants get
  changed between tests.

### QA accounts — QA Test Corp `fae87907-2f99-4b35-a241-c94d9e1e4a17`

| Account | user_id | Role |
|---|---|---|
| `kevalvshah03+qaadmin@gmail.com` | `user_76cd525348e1` | org_admin |
| `kevalvshah03+qamember@gmail.com` | `user_fc914df642c3` | org_member, no grants |
| `kevalvshah03+qaviewer@gmail.com` | `user_31197c478761` | grantable per test |

**CORRECTION, 2026-07-28 session B — there are NO tokens in this file, and there
never were.** The line below said "tokens expire 2026-08-04" without any token
beside it; there is no JWT anywhere in the repo or in any ignored file. A session
nearly reported itself blocked on that.

**How to actually get in: the Playwright browser profile is already signed in as
`qaadmin`.** Open `https://staging.kartavaya.com` with the Playwright MCP tools
and the session is live — `localStorage.Kartavaya_user` reads
`user_76cd525348e1`, org_admin, QA Test Corp. That is a full org_admin sweep with
no owner involvement.

**`qamember` and `qaviewer` are still blocking**, and F32/F33 are defined by what
those two see. Getting them needs the owner to sign in as each and read
`localStorage.getItem('auth_token')` from the browser console — you cannot type a
password into a login form, and you do not need to.

**These accounts are KEPT deliberately** (owner decision, 2026-07-28) and nothing
scheduled deletes them — see the settled-decisions section above. They are the
only way to test RBAC as a real user; `platform_admin` bypasses the gates and
proves nothing.

Change grants (as the org_admin token):

    PUT /api/v1/org/members/{user_id}/modules
    {"modules": [{"code": "ganit", "role": "viewer"}]}

Takes effect on the next request — verified across 22 cycles, no cache lag.

### Traps that cost time on 2026-07-28

- A **CORS error on an endpoint whose GET works is a 500**, not CORS — the
  exception escapes before `CORSMiddleware` attaches headers.
- **Never use a write as a validation probe.** One changed the org's GSTIN
  irreversibly. Confirm the deployed SHA first.
- **Read router prefixes from source.** Guessed URLs produced several phantom
  404s. `/api/v1/documents`, not `/api/documents`.
- **Two agreeing measurements are not corroboration if they share an
  implementation.** F28 was published and escalated on one broken selector.
- `platform_admin` **bypasses module gating** (`subscription.py:120`). Anything
  tested as platform staff proves nothing about a real org user. F27 was
  published and retracted for exactly this.

### Traps added 2026-07-29

- **The backend needs Python 3.12**, which is what CI pins. On 3.11 the suite
  cannot even collect: `email_service.py` uses a PEP 701 f-string and raises
  `SyntaxError: f-string expression part cannot include a backslash`. That
  reads like a broken file and is not one. `pywebpush` also fails to build a
  wheel here; nothing in the suite needs it.
- **`vitest` is not the strict check — `vite build` is.** A duplicate import in
  `AppShell.jsx` passed all 790 tests and failed the build outright. Run the
  build before believing a frontend change.
- **A remote/web session may not be able to reach staging at all.** In this
  environment `staging.kartavaya.com` answered `403 CONNECT` at the agent proxy
  (`curl "$HTTPS_PROXY/__agentproxy/status"` confirms the denial), as did
  `supabase.com`. Chromium and the repo's Playwright config are present and
  fine — there is simply nothing reachable to point them at. If that is your
  session, do the code work and say plainly that nothing was verified as a
  user; do not report a gating fix as done because its unit tests pass.

---

## Paste this

```
Read NEXT-SESSION.md at the repo root first, then the final section of
swarm-reports/LIVE-SESSION-2026-07-28.md.

THE JOB IS THE UI SWEEP. Every module, every tab, every button, every
CRUD path, as each role. Sign in as the role, open the page, CLICK the
control, watch what happens.

Do NOT substitute API probes. The last session did that for the whole
RBAC section, reported it correct, and missed two user-facing defects
that twenty minutes of clicking found. A status code is evidence only
where there is no control to click.

Work on staging only: https://staging.kartavaya.com — never kartavaya.com.
Push to `staging` only; `main` is production.

START HERE, in order:

1. The sweep itself, module by module, role by role. 5 of 9 modules have
   had any UI testing at all. This is the job.

2. F32 verification. The machinery is built and unit-tested, and Ganit,
   Vetana, Graha, Vikray and Sanvaad are gated — but NONE of it has been
   seen in a browser, and F32 is defined by what a viewer sees. Sign in
   as ganit:viewer and as a grantless member and look.

3. F32 application, where the sweep finds it missing. Manav, Prachar,
   Pahchan, Dristi, Esign and Srijan have no in-tab gating yet.
   `useModuleWrite({ label: '…' })` then disabled + title; WriteGate only
   where the JSX cannot take a prop.

F33 is DONE — fixed and verified live in session B. Do not re-open it,
and do not trust a priority list over `git log`.

QA accounts (QA Test Corp, org fae87907-2f99-4b35-a241-c94d9e1e4a17):
  qaadmin  user_76cd525348e1  org_admin
  qamember user_fc914df642c3  org_member, no grants
  qaviewer user_31197c478761  grantable per test

There are NO tokens in this file and there never were — an earlier
version of this very paste block said there were, and a session nearly
reported itself blocked on it. The Playwright browser profile is already
signed in as qaadmin, which is a full org_admin sweep with no owner
involvement. qamember and qaviewer need the owner to sign in as each and
read localStorage.getItem('auth_token') from the console. Never type a
password into a login form.

Change grants as the org_admin token:
  PUT /api/v1/org/members/{user_id}/modules
  {"modules":[{"code":"ganit","role":"viewer"}]}
Takes effect on the next request; verified over 22 cycles.

SETTLED — do not re-raise: the org GSTIN stays 24AAAAA0000A1Z8, QA Test
Corp and its accounts are kept, and the owner stays org_admin there.

Read the "Traps" section before probing anything. Five specific mistakes
cost hours on 2026-07-28 and are all repeatable.
```
