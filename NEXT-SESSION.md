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
1. **F32** — write buttons render from the page shell, not the caller's level.
   A `ganit:viewer` is handed the full Create Invoice form; a member with no
   grants is offered `Run payroll`. The API refuses every one, so nothing is at
   risk but trust. **The level is already resolved per request and simply is not
   consulted at render time — this is one central fix, not per-screen.**
2. **The UI sweep** — 5 surfaces done of 9 modules, ~85 leaves, CRUD on most.
3. **F33** — nav hides a module the user holds (`/v1/org/modules` returns `[]`
   for a member who demonstrably has a grant).
4. **F4 step (b)** — 16 of 26 `LIMIT` sites carry `total`/`truncated`. Remaining:
   graha 3, manav 4, hub/prachar/scrapers 1 each. Pattern is
   `COUNT(*) OVER() AS _total` + `return _listed(rows, limit=N)`; `_listed` is in
   `routers/graha.py`, tested, and shared.
5. **F4 step (a)** — raise the caps. Needs the frontend reading `total` first.
6. **Exports** — GST/Tally verified by file content; the *scheduled* report path
   (F11) still mails raw JSON.

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

1. F32 — write buttons render from the page shell, not the caller's
   level. A ganit:viewer is handed the full Create Invoice form; a member
   with no grants is offered "Run payroll". Check EVERY module for more
   instances, then fix it centrally: the level is already resolved per
   request and simply is not consulted at render time.

2. F33 — the nav hides a module the user actually holds.
   GET /v1/org/modules returns [] for a member with a live grant.

3. Then the full sweep, module by module, role by role. 5 of 9 modules
   have had any UI testing at all.

QA accounts (QA Test Corp, org fae87907-2f99-4b35-a241-c94d9e1e4a17):
  qaadmin  user_76cd525348e1  org_admin
  qamember user_fc914df642c3  org_member, no grants
  qaviewer user_31197c478761  grantable per test

Tokens are in NEXT-SESSION.md and expire 2026-08-04. If expired, ask the
owner for fresh ones — never type a password into a login form.

Change grants as the org_admin token:
  PUT /api/v1/org/members/{user_id}/modules
  {"modules":[{"code":"ganit","role":"viewer"}]}
Takes effect on the next request; verified over 22 cycles.

SETTLED — do not re-raise: the org GSTIN stays 24AAAAA0000A1Z8, QA Test
Corp and its accounts are kept, and the owner stays org_admin there.

Read the "Traps" section before probing anything. Five specific mistakes
cost hours on 2026-07-28 and are all repeatable.
```
