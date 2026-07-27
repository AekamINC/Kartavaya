# Auth & Onboarding — STRUCTURE lens

Branch: `worktree-agent-a7503caa41d7bdbbd`
Reference: `design-reference/Kartavaya Redesign/` — `Auth Screens.html` + `Auth.jsx` +
`AuthForms.jsx`, `Onboarding.html` + `Onboarding.jsx`, `AUTH-SPEC.md`.
Build: `frontend/src/pages/LoginPage.jsx`, `pages/onboarding/*`,
`components/layout/AuthShell.jsx`, `components/layout/Protected.jsx`,
`lib/api.js`, `backend/auth_router.py`, `backend/routers/org_invites.py`.

Two siblings own pixels and motion. Everything below is **what exists, what it
contains, what order it runs in, and what is absent** — nothing about size,
colour or timing.

## 0 · Worktree correction, before anything else

This worktree was cut from **`main`** (HEAD `1aa4985`, 13 production commits,
no `design-reference/`, no `swarm-reports/`). Reset to `origin/staging`
(`8ad2890`) before a single file was read. This is the *second* run in which the
auth agent hit this — `_COORDINATION.md` §1 predicted it exactly.

The reference harness renders: `frontend/public/__ref/` (gitignored),
`http://localhost:5173/__ref/Auth%20Screens.html` and `.../Onboarding.html`,
both confirmed loading and driving the real JSX. Note for whoever is next: the
Browser pane's tab is **shared across agents** and gets navigated out from under
you mid-call. Read the JSX for structure; use the render to confirm order and
presence, and expect to re-navigate.

---

## 1 · Screen inventory — reference vs build

### Auth surfaces

`AU_SCREENS` in `AuthForms.jsx:277` is the reference's own list of eight.

| # | Reference screen | Build route / state | Verdict |
|---|---|---|---|
| 1 | Log in | `/login` · `LoginPage` | **present** |
| 2 | Sign up · step 1 (account) | — | **absent by decision.** AUTH-SPEC:11 "Decided 25 Jul 2026 — Kartavaya is invite-only… NOT in scope." Correct as built. |
| 3 | Sign up · step 2 (organisation) | — | same decision. The org is created by Aekam's console. |
| 4 | Forgot | `/forgot-password` | **present** |
| 5 | Link sent | inline `sent` state of the same page | **present**, and correctly conditional ("If … has an account") |
| 6 | Reset | `/reset-password` | **present** |
| 7 | Expired link | banner + shake on the reset form | **GAP** — the reference makes this a dead-end screen with *Request a new link*. The build already has that exact shape for a **missing** token and does not use it for a **rejected** one. Fixed, §3.4. |
| 8 | Invite · new user | `/accept-invite` | **present but thin** — see §2 |
| 8b | Invite · existing user | — | **unreachable by construction** — see §2.3 |

States the reference builds that the build also has: inline field errors,
invalid-credential banner + shake, loading, strength meter, live confirm
match, 60s resend countdown, no-token dead ends.

States the reference has that the build deliberately omits: Google OAuth,
magic link, "Create an account" footer link. All three are signup/OAuth surface
that invite-only removes and no endpoint backs. Correct as built — an unwired
button is worse than an absent one.

**New state added by this agent:** expired-session banner on `/login`, driven by
`?expired=1`, which only the new 401 path can set. §3.2.

### Onboarding

Reference rail, read off the rendered harness (`.ob-prog__s`):
`Welcome · Modules · Team · First project · Done` — five, with **Done in the
rail** and a `step/5` progress bar.

Build rail (`OnboardingPage.ALL_STEPS`):
`Profile · Organisation · Modules · Team · Project` — five, **Done is not a rail
entry**, no progress bar.

| Reference step | Build step | Verdict |
|---|---|---|
| 1 Welcome (splash: mark, marquee, *Set up my workspace* / *Skip setup*) | `StepProfile` — the same heading and lede, plus one name field | **deliberate deviation, kept.** The build's own comment: "opens on a step that asks for one thing rather than on a splash screen, so the first click is progress instead of acknowledgement." Skip-all is preserved in the footer. Not a defect. |
| — | `StepOrg` (name · industry · size) | **build-only.** It is the reference's *signup step 2*, moved here because signup does not ship. No endpoint — saves locally, reported PENDING on the done screen. Honest. |
| 2 Modules | `StepModules` | present |
| 3 Team | `StepInvite` | present — **but it called an endpoint that 403s for the people who run it.** §3.5 |
| 4 First project | `StepTemplate` | present |
| 5 Done | `StepDone` (rendered after the rail, not in it) | present |

Invited-member path. AUTH-SPEC:24 wants `1 → 3 → 4 → 5` (skip Modules only).
The build filters to `profile` + `project`, i.e. it also drops **Team**. That is
right for a plain `org_member`, who cannot invite anyone — `POST /api/v1/org/invites`
is `require_org_role("org_admin","org_owner")`. Recorded, not changed: offering a
form that will 403 is worse than not offering it, and the filter key is
`isOrgOwner`, so an invited **admin** does still get the step.

---

## 2 · Accept-invite, against the reference

`InviteScreen` (`AuthForms.jsx:232`) puts a context block **above** the form:

```
Mark · org name · org host · member count
  ↳ inviter avatar + "Keval Shah invited you as <Member>"
  ↳ "With access to  कर्तव्य Editor   गणित Viewer"     ← the module grants
foot: "Invitation expires in 7 days. Only this email address can accept it."
Decline / Decline this invitation
```

The build showed **none of it** — name, password, confirm, and nothing about
what is being accepted. `auth.css:362` says so out loud and explains why: the
panel needs `GET /auth/invite/:token`, which did not exist, and shipping CSS for
a panel that can never be populated is how dead rules accumulate. That was the
correct call at the time. The endpoint now exists (§3.3), so the panel ships.

### 2.1 The data was already there and nobody could read it

`org_invites.create_org_invite` writes `org_id`, `member_role` (the org role) and
`module_grants` (jsonb, `[{code, role}]`) onto the invite row, and
`auth_router.accept_invite:254-303` consumes all three. Every field the
reference's panel wants was being stored and applied — with no way to show the
person what they were about to accept.

### 2.2 Which invite you got changes what you land in

| Path | `org_id` | Invitee ends up |
|---|---|---|
| `POST /api/admin/invites` (Aekam console) | **NULL** | an account belonging to no organisation |
| `POST /api/v1/org/invites` (the org itself) | set | `user_roles` + `org_member_modules` written on accept |

Both send the same mail to the same `/accept-invite?token=` screen. The screen
now says which one it is, because "you are joining Aekam Inc as an Admin with
Ganit Viewer" and "you are getting an account" are not the same event.

### 2.3 The existing-user branch cannot happen — do not build it

AUTH-SPEC:81 wants an existing-user variant, and `AU_SCREENS` ships it as
`invite2`. **Both invite creators refuse an email that already has an account:**
`invite_router.py:365-367` (409) and `org_invites.py:236-242` (409, "Add them
from the Members tab instead"). So no invite can ever be issued to an existing
user, and a screen for it would be a screen no one can reach.

The one variant that *can* occur is a user who creates an account in the seven
days between issue and acceptance. `accept_invite` answers that with 409, and the
build already routes it to sign-in. That is the reachable half of the branch and
it is wired. The unreachable half is recorded here rather than built.

---

## 3 · What I changed

Five structural gaps, three commits. Each is "the reference has this and the
build does not", or "the build calls something that cannot answer it".

### 3.1 Three routes the design assumed and the backend never had — `8fb8d0e`

```
GET  /api/auth/invite/{token}          backend/auth_router.py
POST /api/auth/invite/{token}/decline
POST /api/auth/refresh
```

`GET /auth/invite/:token` is what `auth.css:362` was waiting for, in those
words. Returns org name and member count, inviter name, org role, module grants,
expiry and `account_exists`.

**On disclosure, since it is unauthenticated and returns an email:** the caller
must hold a 256-bit `secrets.token_urlsafe(32)` mailed to that address, and
`accept_invite` accepts nothing else and would let the same caller *set the
password on the account*. A preview strictly discloses less than the accept it
precedes. What it will not do is say **why** a token is bad — unknown, expired,
spent and revoked are one 404 with one string, so it cannot be swept for live
tokens, and a test asserts the three bodies are identical.

Grants are re-validated against live `module_subscriptions`, matching what
`accept_invite` does before writing them. An invite lives seven days and a
module can be switched off inside that window; the screen must not promise
access the acceptance will then silently drop.

`SELECT *` on the invite row, not a column list — `org_id` and `module_grants`
arrive with `PROPOSED_073`, which is a **proposal**. Naming them would raise
`UndefinedColumnError` on an unmigrated database instead of degrading to the
platform-invite shape. Same guard `accept_invite` already uses.

**`/auth/refresh` is a sliding window, not a resurrection**, and the docstring
says so first. `require_user` rejects an expired JWT, so the route only ever
sees a live one. There is no refresh token in `auth_router.py` and no table to
hold one, so this is the honest ceiling — anything more needs the same token
store `reset_password` would need to revoke other sessions. A test pins the
expired-token 401, because the frontend now treats a 401 as "the session is
over" and that has to stay true.

### 3.2 `api.js` had no 401 branch at all — `1a49ea2`

There was no 401 handling of any kind. An expired token produced whatever error
each caller happened to render, the stale `Kartavaya_user` stayed in
localStorage, and the nav kept drawing modules for a session that no longer
existed.

Now a 401 from anywhere **except** `POST /auth/login`, and not while the user is
on a public page, ends the session and redirects to `/login?expired=1` with the
path they were on. `/auth/login` is the whole exception list: it is the only
route that answers 401 to an unauthenticated caller *by design*. Everything else
answering 401 does so from `require_user`, whose three causes all mean the
session is over.

The login screen reads `expired` and explains the empty form. `from` is
validated as a same-origin absolute path — `//evil.example` is pathname-shaped
and the browser reads it as protocol-relative; there is a test.

**Deliberately not a refresh attempt on 401.** `/auth/refresh` needs a token
`require_user` still accepts, so by the time a 401 arrived the token it would
send is the rejected one. Refresh is proactive and lives in `Protected`, every
six hours while a tab is open.

### 3.3 `Protected` treated a dead network as a sign-out — `1a49ea2`

Every `/auth/me` failure deleted `auth_token` and bounced to `/login`. `api.js`
retries a dead network three times at 800/1600/2400ms and then rejects, so a
lift, a tunnel or a Railway restart ended with the user signed out and their
token destroyed — with nothing to tell that apart from a real expiry. Only a 401
is the session now; anything else gets a screen that says the session is still
valid and offers a retry.

The 401 eviction is repeated in `Protected` rather than left to the interceptor,
so the gate is correct without it. Both agree on destination and query, so
whichever runs first the outcome is the same.

### 3.4 The accept-invite context panel, decline, and two dead ends — `1a49ea2`

`InviteContext` renders org · inviter · role · grants · expiry above the fields,
because the decision comes before the typing. Grants render through
`lib/moduleColors.js`, the one registry, so this screen names no module and no
colour of its own. A platform-console invite (`org_id` NULL) is described as
what it is — an account on Kartavaya — rather than given an invented workspace.

Three states became screens instead of banners over a form the user cannot
submit:

| Was | Now |
|---|---|
| accept-invite, dead token → banner after typing a password | dead-end screen, checked before any form is drawn |
| accept-invite, server unreachable → same as "expired" | its own screen, so nobody asks an admin to reissue a link that was fine |
| reset-password, rejected token → banner over the filled form | the "Expired link" screen `AU_SCREENS` lists, with *Request a new link* |

Decline had no route at all. Someone who did not want an invitation could only
close the tab and leave a live token in their inbox for a week.

### 3.5 Onboarding's Team step 403'd for everyone it was written for — `b2a9ca3`

**The largest live defect I found.** `sendInvites` posted to `/admin/invites` —
`invite_router.py`, behind `require_platform_role(*CONSOLE_ROLES)`, which reads
`staging.user_roles WHERE org_id IS NULL`. A customer's `org_owner` has no such
row, so the one step of the wizard that sends mail answered **403 for exactly
the people the wizard exists for**. Aekam's own staff were the only ones it
worked for, and for them it wrote `org_id NULL` — an account belonging to no
organisation, which is not what "invite your team" means.

Now `POST /v1/org/invites`, which writes `user_roles` and `org_member_modules`
on acceptance, counts the seat against the org's cap before promising anything,
and refuses to let an admin mint an owner.

The role vocabulary had to move with it. `StepInvite` offered `member` / `admin`
— `users.role` account types from a different ladder — and the endpoint
validates `org_role` against `org_owner` / `org_admin` / `org_member`, so the
old values would have returned "Invalid role: member" even once the path was
right. Now `org_member` / `org_admin`, which is what the reference uses verbatim
(`Onboarding.jsx`: `OB_ROLES`). `kv_onboarding` outlives a release, so a list
saved under the old vocabulary is upgraded on read.

`noRetry` carries over unchanged and now has a test: this endpoint sends an
email, and `api.js` retries a 503 three times.

### Gates

| Gate | Result |
|---|---|
| `cd frontend && node scripts/check-tokens.mjs` | 341 declared · 235 referenced · **0 missing** · exit 0 |
| `cd frontend && node scripts/check-classes.mjs` | 2134 selectors · 1457 classes · **0 missing a rule** · exit 0 |
| `npx vite build` | clean |
| `npx vitest run` | **453 passed / 0 failed** (was 449; +20 mine, and 16 of them are new files) |
| `pytest tests/` | **1256 passed / 0 failed** (+10 mine) |

Run bare from `frontend/`, unpiped, per `_COORDINATION.md` §2.

**No email, invite or reset was ever sent.** Backend tests run under
`OUTBOUND_MODE=dry`; the frontend suites install the network kill switch and
mock the API. Nothing was written to the database and no migration was run.

---

## 4 · For whoever owns onboarding next — two structural questions I did not settle

Neither is a defect. Both are places where the build and the reference disagree
on purpose, and the disagreement should be *decided* rather than drifted into.

1. **`StepOrg` is the reference's signup step 2, living in the wizard.** It has
   no endpoint (`AUTH-SPEC` §API lists `POST /v1/auth/orgs`; it does not exist),
   so it collects a name, an industry and a size and writes them to
   localStorage. The industry does real work — it drives module preselection —
   but the org name is typed into a field that reaches nothing, on a screen
   whose organisation was created by Aekam's console and already has a name.
   Either give it `PATCH /v1/org/profile` (which exists) or drop the name field.
2. **`Done` is a rail step in the reference and not in the build.** The
   reference's rail is `Welcome · Modules · Team · First project · Done` with a
   `step/5` progress bar; the build's is five entries ending at `Project`, with
   `StepDone` rendered after it. A five-step rail whose fifth step you never see
   yourself reach is a small honesty gap in a wizard that is otherwise careful
   about them.

## 5 · Gaps confirmed and left alone

- **No `GET/PATCH /v1/onboarding`.** Resume is `localStorage.kv_onboarding` only,
  and the footer says "Saved on this device" rather than claiming a handoff.
- **Three onboarding steps have no endpoint** (profile, organisation, module set).
  `StepDone` reports them PENDING rather than ticking them.
- **`reset-password` does not invalidate other sessions.** The screen does not
  claim it does. Revoking requires a token store the backend has not got.
- **No `emails/` directory** — the four templates in AUTH-SPEC §"Email templates"
  are built inline in `email_service.py`. Belongs to the email agent.
- **Existing-user invite** — §2.3, unreachable, not built.
- **Sign-up, Google OAuth and magic link** — three reference surfaces the build
  omits. All three are signup/OAuth and no endpoint backs any of them; the
  invite-only decision (AUTH-SPEC:11) removes the first outright. Correct as
  built. An unwired button is worse than an absent one.

## 6 · Claims from my brief: held vs stale

| Claim | Verdict |
|---|---|
| There is no `/auth/refresh` endpoint anywhere | **HELD, now closed.** §3.1 |
| `api.js` has no 401 handling at all | **HELD, now closed.** §3.2 |
| Check the accept-invite screen against the reference | **HELD — it was missing every context field the reference has.** §2, §3.4 |
| Login submits correctly and was never broken | **STALE, confirmed stale.** Unchanged. |
| Onboarding is wired to every endpoint that exists | **STALE AS WRITTEN, and it hid a live defect.** Every endpoint it called was real; the Team step called the *wrong* real endpoint and 403'd for every org owner. §3.5 |
| Dark mode is correct in both themes | **STALE.** Not re-litigated. |
