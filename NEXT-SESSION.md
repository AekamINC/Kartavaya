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

### Owner decisions still outstanding
- Org GSTIN is `24AAAAA0000A1Z8` (was `...1Z5`) — changed in error by a write
  probe, needs confirming.
- Whether the owner's account should stay `org_admin` in QA Test Corp.

### QA accounts — QA Test Corp `fae87907-2f99-4b35-a241-c94d9e1e4a17`

| Account | user_id | Role |
|---|---|---|
| `kevalvshah03+qaadmin@gmail.com` | `user_76cd525348e1` | org_admin |
| `kevalvshah03+qamember@gmail.com` | `user_fc914df642c3` | org_member, no grants |
| `kevalvshah03+qaviewer@gmail.com` | `user_31197c478761` | grantable per test |

Tokens expire **2026-08-04**. After that, sign in and read
`localStorage.getItem('auth_token')` in the console.

**These accounts will be destroyed if the weekly test-data reset runs.** Exempt
QA Test Corp if they should survive.

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
Read swarm-reports/LIVE-SESSION-2026-07-28.md, final section first, then
NEXT-SESSION.md at the repo root.

Test through the UI. Sign in as each role, open each page, CLICK every
control, watch what happens. Do not substitute API probes — the last
session did that and missed two user-facing defects.

Work on staging only. https://staging.kartavaya.com

Start with F32: write affordances render from the page shell rather than
the caller's level. Confirmed on ganit and vetana. Check every module,
then fix it centrally — the level is already resolved per request.

QA tokens are in NEXT-SESSION.md; ask the owner for fresh ones if expired.
```
