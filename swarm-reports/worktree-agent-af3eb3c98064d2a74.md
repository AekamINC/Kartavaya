# End-to-end test suite — `worktree-agent-af3eb3c98064d2a74`

Owner of this branch: the browser-level / end-to-end suite. Backend unit and
router tests belong to a different agent and are not touched here.

---

## 0 · Isolation strategy — decided before a line was written

> **Nothing in this suite can reach a network, a backend, or a database.**
> Not "should not". Cannot: the escape routes are removed and their removal is
> itself asserted by a test.

### The decision

**A fully mocked API layer, running in-process under Vitest + jsdom.**

Staging and production share one Supabase project. Any test that authenticates
against a deployed URL is authenticating against production's database, and any
test that creates a row creates it in production. That rules out both of the
other options on the table:

| Option | Verdict |
|---|---|
| Mocked API layer, in-process | **Chosen.** No socket is opened at any point. No credentials exist to leak. Runs on every PR in ~2s with no service to stand up. |
| Local backend + local Postgres | Rejected. Correct in principle, but it needs Postgres, a migration path and a seed fixture in CI, and the moment `DATABASE_URL` is mis-set in a workflow file it points at the shared project. The failure mode is silent and it writes. |
| Read-only against staging | Rejected outright. "Read-only" is an intention, not a mechanism. `POST /auth/login` writes a session row and bumps `last_login`; a login is already a write. The existing Playwright suite does exactly this — see §5. |

### How it is enforced, in three layers

1. **The axios instance is stubbed.** Every call the app makes goes through the
   single `api` export in `frontend/src/lib/api.js`. `installMockApi()` in the
   harness replaces `get/post/put/patch/delete` with a route table.
2. **An unregistered route is a test failure, not a passthrough.** The mock
   rejects with `MockApi: no route registered for GET /x`. A test cannot
   accidentally fall through to a real request by forgetting to stub something —
   the standard way a "mocked" suite quietly starts talking to a server.
3. **The transports themselves are removed.** `installNetworkKillSwitch()`
   replaces `globalThis.fetch`, `XMLHttpRequest`, `navigator.sendBeacon` and
   `WebSocket` with throwers for the duration of every e2e test. Any code path
   that escapes layer 1 — a raw `fetch` in a component, a Supabase client, a
   push subscription — dies loudly instead of dialling out.

Layer 3 is the one that matters for the shared-database risk, and
`network-isolation.test.js` asserts all four transports are dead and that the
mock refuses unknown routes. That test is the proof of this section.

**No test in this suite performs a write against anything.** `api.post` is a
spy: assertions are made about *what the app tried to send*, which is the
interesting thing anyway, and nothing receives it.

### Outbound side effects (invites, email, WhatsApp, social)

Covered by the same mechanism. The invite flow's `POST /invites` resolves from
the route table with a canned response; no mail transport exists in the process.
`OUTBOUND_MODE` is a backend concern and the backend is not running.

---

*(sections 1–7 below are filled in as the suite lands)*
