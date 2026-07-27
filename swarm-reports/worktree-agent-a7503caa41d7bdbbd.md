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

Filled in as each lands. See the commits on this branch.

---

## 4 · Gaps confirmed and left alone

- **No `GET/PATCH /v1/onboarding`.** Resume is `localStorage.kv_onboarding` only,
  and the footer says "Saved on this device" rather than claiming a handoff.
- **Three onboarding steps have no endpoint** (profile, organisation, module set).
  `StepDone` reports them PENDING rather than ticking them.
- **`reset-password` does not invalidate other sessions.** The screen does not
  claim it does. Revoking requires a token store the backend has not got.
- **No `emails/` directory** — the four templates in AUTH-SPEC §"Email templates"
  are built inline in `email_service.py`. Belongs to the email agent.
- **Existing-user invite** — §2.3, unreachable, not built.
