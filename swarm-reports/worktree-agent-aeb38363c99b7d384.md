# Routing · App shell · Navigation · Platform admin console

**Agent branch:** `worktree-agent-aeb38363c99b7d384`
**Ownership:** `frontend/src/App.jsx`, `components/layout/**`, `components/admin/**`, `navConfig.js`, admin pages
**Base:** `origin/staging` @ `2a2a27b`
**Spec read:** `design-handover/01-navigation.md` (220 lines, read in full)
**Backend source of truth read:** `backend/middleware/role_tiers.py` (280 lines, read in full)

> Worktree note: this worktree was created from a stale `main`-era commit (`1aa4985`,
> 271 commits behind `origin/staging`). It was reset to `origin/staging` before any
> work began. Nothing was lost — `1aa4985` is reachable from `main`.

---

## 0 · Status legend

| Mark | Meaning |
|---|---|
| **FIXED (verified)** | The prior report's claim was real and the fix is present in the code I just opened. Not stale, not regressed. |
| **STALE** | The claim no longer describes the code. |
| **STILL LIVE** | The claim is real and the defect is still present. |
| **NEW** | Not in any prior report. Found this pass. |

---

## 1 · Verification of the six inherited claims

### 1.1 Client could reach the entire staff product — **FIXED (verified)**

`frontend/src/components/layout/Protected.jsx:114-118`:

```js
  // 2 · Client confinement. Allow-list, not deny-list.
  if (ctx.isClient) {
    if (!underPath(path, CLIENT_HOME)) return <Navigate to={CLIENT_HOME} replace />;
    return children;
  }
```

`CLIENT_HOME = '/client'` (`Protected.jsx:50`). `underPath(p, prefix)` is
`p === prefix || p.startsWith(prefix + '/')` (`Protected.jsx:55-57`) — the `+ '/'`
matters: `/clientele` does **not** satisfy it, so there is no prefix-confusion hole.

The deny-list is gone. Full route × role table in §3 below.

### 1.2 `/admin` gated on org `role === 'admin'` while `AdminShell` gates on platform roles — **FIXED (verified)**

The two predicates now match token-for-token.

- `Protected.jsx:105` — `const isPlatform = ctx.isPlatform || user?.role === 'admin';`
  where `ctx.isPlatform` is `platform_roles.length > 0` (`navConfig.js:101`)
- `AdminShell.jsx:29-30` — `const hasPlatformRole = Array.isArray(user?.platform_roles) && user.platform_roles.length > 0;`
  `const isPlatform = hasPlatformRole || user?.role === 'admin';`

Both read Tier-1 `platform_roles`. Neither reads an org role. The route can no longer
resolve-then-render-nothing.

### 1.3 `canSeeNavItem` never read `item.module` — **PARTIALLY FIXED; the data half is STILL LIVE**

The filter now exists (`navConfig.js:135`):

```js
  if (item.module && ctx.moduleGrants && !ctx.moduleGrants.includes(item.module)) return false;
```

But `ctx.moduleGrants` is **always `null` in production**, so the predicate never fires.
`navConfig.js:114` reads `user.module_grants`, and `backend/auth_router.py:125 _safe_user`
returns only `id/user_id/name/email/role/avatar` plus optional `platform_roles` and
`org_roles`. There is no `module_grants` key on any `/auth/me` response.

`design-handover/01-navigation.md:177` requires it:
`GET /v1/me` → `role`, `org_roles[]`, `platform_roles[]`, `module_grants[]` —
"drives every nav predicate".

**Net effect today: entitlements still do not hide a single module from the nav.**
Fix implemented this pass — see §5.

### 1.4 `ICONS.settings` never existed — **FIXED (verified)**

`navIcons.jsx:13` defines `settings`. `documents` (`:14`) and `pahchan` (`:15`) were added
in the same change. Cross-checked every `icon:` key used by `NAV_FULL`, `NAV_CLIENT`,
`MOBILE_NAV` and `ADMIN_NAV` against the `ICONS` object — **all 28 resolve**, none
render `undefined`.

### 1.5 Pahchan in no nav list — **FIXED (verified)**

`navConfig.js:66` — `{ to: '/pahchan', icon: 'pahchan', en: 'Attendance', … module: 'pahchan' }`
inside the `modules` group, alongside the other ten.

### 1.6 `ROUTE_META` last-wins → Organisation breadcrumb read "Billing" — **FIXED (verified)**

`navConfig.js:224-239` builds the map through a `claim()` helper that is a no-op when the
key already exists (first-wins), and keys are stripped of their query string
(`it.to.split('?')[0]`). Organisation is declared at `:74`, Billing at `:79`, so
`/settings/organisation` resolves to Organisation.

### 1.7 `components/icons/**` does not exist — **CONFIRMED**

`frontend/src/components/icons/` is absent. Icons live in
`frontend/src/components/layout/navIcons.jsx` and are imported from there by
`Sidebar.jsx`, `Topbar.jsx`, `MobileNav.jsx`, `AppShell.jsx` and `admin/AdminShell.jsx`.
The earlier brief that claimed otherwise was wrong.

> Path correction for the next agent: both coordinator briefs and
> `_SOURCE-MAP.md` write the location as `frontend/src/layout/navIcons.jsx`.
> The real path has `components/` in it —
> `frontend/src/components/layout/navIcons.jsx`. There is no `frontend/src/layout/`.

---

## 2 · Route × role reachability

Every route declared in `frontend/src/App.jsx`, enumerated from
`grep -n "Route path" App.jsx` — 51 declarations, none omitted.

### 2.1 The six role classes

| Class | Predicate, and where it is computed |
|---|---|
| **anon** | no `auth_token` in localStorage → `Protected` navigates to `/login` |
| **client** | `navConfig.js:106` — `user.role === 'client' && org_roles.length === 0` |
| **member** | an `org_roles` row of `org_member` |
| **org admin** | `org_admin` or `org_owner` (`navConfig.js:102-103`) |
| **platform** | `platform_roles.length > 0` — 8 distinct Tier-1 codes, split in §2.4 |
| **legacy admin** | `users.role === 'admin'`, the pre-`user_roles` fallback |

A client who ALSO holds an org role is staff-who-is-flagged, not a portal client.
That is deliberate (`navConfig.js:105`) — confining them would lock a colleague
out of their own workspace. `/auth/me` only returns `org_roles` rows whose
`role_code` is one of `org_owner|org_admin|org_member`, so the predicate cannot be
tripped by a Tier-3 project row.

### 2.2 Public routes — no `Protected` wrapper, by design

| Route | Element | anon | client | member | org admin | platform |
|---|---|---|---|---|---|---|
| `/login` | LoginPage | ✅ | ✅ | ✅ | ✅ | ✅ |
| `/accept-invite` | AcceptInvitePage | ✅ | ✅ | ✅ | ✅ | ✅ |
| `/forgot-password` | ForgotPasswordPage | ✅ | ✅ | ✅ | ✅ | ✅ |
| `/reset-password` | ResetPasswordPage | ✅ | ✅ | ✅ | ✅ | ✅ |
| `/approve` | ApprovePage | ✅ | ✅ | ✅ | ✅ | ✅ |
| `/sign/:token` | SigningPage | ✅ | ✅ | ✅ | ✅ | ✅ |

These are token-gated at the backend, not by role. Correct — an external signer
has no account at all, so a route guard here would make the product unusable.

### 2.3 Gated routes

Legend: **render** = the element mounts · **→ /x** = redirected before render.

| Route | anon | client | member | org admin | platform |
|---|---|---|---|---|---|
| `/` (RootGate) | LandingPage | → `/client` | → `/dashboard` | → `/dashboard` | → `/dashboard` |
| `/onboarding` | → `/login` | **→ `/client`** | render | render | render |
| `/client` | → `/login` | render | → `/dashboard` | → `/dashboard` | → `/dashboard` |
| `/client/projects` | → `/login` | render | → `/dashboard` | → `/dashboard` | → `/dashboard` |
| `/client/project/:id` | → `/login` | render | → `/dashboard` | → `/dashboard` | → `/dashboard` |
| `/client/approvals` | → `/login` | → `/client?view=approvals` | → `/dashboard` | → `/dashboard` | → `/dashboard` |
| `/client/files` | → `/login` | → `/client?view=files` | → `/dashboard` | → `/dashboard` | → `/dashboard` |
| `/client/legacy` | → `/login` | → `/client` | → `/dashboard` | → `/dashboard` | → `/dashboard` |
| `/dashboard` | → `/login` | → `/client` | render | render | render |
| `/boards` | → `/login` | → `/client` | render | render | render |
| `/projects` | → `/login` | → `/client` | render | render | render |
| `/projects/:projectId` | → `/login` | → `/client` | render | render | render |
| `/tasks` | → `/login` | → `/client` | render | render | render |
| `/teams` | → `/login` | → `/client` | render | render | render |
| `/inbox` | → `/login` | → `/client` | render | render | render |
| `/approvals` | → `/login` | → `/client` | render | render | render |
| `/templates` | → `/login` | → `/client` | render | render | render |
| `/activity` | → `/login` | → `/client` | render | render | render |
| `/automations` | → `/login` | → `/client` | render | render | render |
| `/time` | → `/login` | → `/client` | render | render | render |
| `/reports` | → `/login` | → `/client` | render | render | render |
| `/settings/categories` | → `/login` | → `/client` | render | render | render |
| `/settings/notifications` | → `/login` | → `/client` | → customize?tab | → customize?tab | → customize?tab |
| `/settings/customize` | → `/login` | → `/client` | render | render | render |
| `/settings/organisation` | → `/login` | → `/client` | render | render | render |
| `/billing` | → `/login` | → `/client` | → org?tab=billing | → org?tab=billing | → org?tab=billing |
| `/hub` | → `/login` | → `/client` | render | render | render |
| `/hub/clients` | → `/login` | → `/client` | render | render | render |
| `/hub/clients/:id` | → `/login` | → `/client` | render | render | render |
| `/hub/clients/:id/skills` | → `/login` | → `/client` | render | render | render |
| `/hub/org` | → `/login` | → `/client` | render | render | render |
| `/graha` `/ganit` `/manav` `/vikray` `/pahchan` `/vetana` `/dristi` `/prachar` `/esign` `/sanvaad` | → `/login` | → `/client` | render | render | render |
| `/admin` (+ `billing` `orgs` `costs`) | → `/login` | → `/client` | → `/dashboard` | → `/dashboard` | see §2.4 |
| `*` (anything else) | → `/login` | → `/client` | → `/dashboard` | → `/dashboard` | → `/dashboard` |

**The allow-list is airtight.** The client column has exactly seven ✅-equivalent
cells and they are all under `/client`. Not one staff route resolves for a client,
including the ten module routes and the four admin routes. Two structural reasons,
both verified by opening the code:

1. **Every gated route is inside a `<Protected>`.** Comparing the route inventory
   against the `Protected` wrappers: `/onboarding` (`App.jsx:153`), the three
   `/client/*` pages (`:168-170`), the app-shell layout (`:187`) and the admin
   layout (`:252`). The remaining unwrapped routes are the six public ones plus
   four bare `<Navigate>` elements that render no page of their own and land on a
   protected target.
2. **The rule is an allow-list keyed on a prefix, not a path list.** A route added
   next month is covered the day it lands.

**Prefix-confusion checked and clean.** `underPath(p, prefix)` is
`p === prefix || p.startsWith(prefix + '/')` (`Protected.jsx:55-57`). The trailing
`'/'` is what stops `/clientele`, `/client-portal` or `/clients` satisfying the
`/client` allow-list. Same shape guards `/admin`, so `/administrators` is not an
admin path.

**Case sensitivity checked.** React Router matches case-insensitively by default,
so `/Dashboard` resolves the `/dashboard` route, but `location.pathname` keeps the
original casing — `underPath('/Dashboard', '/client')` is false, so a client is
still bounced. Casing can only over-restrict here, never under-restrict: a client
typing `/CLIENT` is sent to `/client` rather than let through.

**Route ranking at `/` checked.** Two routes declare `path="/"` — `RootGate`
(`:140`) and the protected shell layout (`:187`). React Router pushes a branch for
a layout route as well as its children, so both are candidates for the exact
pathname `/` and they score identically. The tie breaks on declaration order, and
`RootGate` is declared first. An anonymous visitor therefore gets the landing page
rather than being bounced to `/login`, which is the whole reason that route exists.
This is correct today but **order-dependent** — recorded in §5 as a fragility, not
a defect.

**localStorage forgery checked.** `RootGate` and `Sidebar` read `currentUser()`,
which parses `localStorage.Kartavaya_user` — user-controlled. It is not
exploitable: `Protected` fetches `/auth/me` and **overwrites** that key
(`Protected.jsx:74`) before rendering any child, and every gate in `Protected`
reads the server response rather than the cache. A forged `platform_roles` array
survives exactly one render of `RootGate`, whose only effect is to choose a
redirect target. The backend is the authority regardless.

### 2.4 `/admin` × the eight Tier-1 codes

`role_tiers.py` defines eight platform codes. Before this pass, all eight resolved
all four console rows. Matrix after the fix, produced by actually running
`adminNavFor()` over each code:

| Tier-1 code | `/admin` | `/admin/orgs` | `/admin/billing` | `/admin/costs` |
|---|---|---|---|---|
| `platform_owner` | ✅ | ✅ | ✅ | ✅ |
| `platform_admin` (legacy alias) | ✅ | ✅ | ✅ | ✅ |
| `platform_manager` | ✅ | ✅ | ✅ | → `/admin` |
| `platform_staff` | ✅ | ✅ | → `/admin` | → `/admin` |
| `account_manager` | ✅ | ✅ | ✅ | → `/admin` |
| `account_finance` | → `/admin/billing` | → `/admin/billing` | ✅ | ✅ |
| `srijan_admin` | → `/dashboard` | → `/dashboard` | → `/dashboard` | → `/dashboard` |
| `platform_support` | → `/dashboard` | → `/dashboard` | → `/dashboard` | → `/dashboard` |
| legacy `users.role === 'admin'` | ✅ | ✅ | ✅ | ✅ |

Backing guards, opened and read rather than inferred:

| Row | Required set | Call sites |
|---|---|---|
| Overview | `CONSOLE_ROLES` | `invite_router.py:24, 28` → `/admin/users`, `/admin/invites`, `/admin/teams` |
| Organisations | `CONSOLE_ROLES` | `admin_orgs.py:30, 88, 496, 568, 625, 720, …` |
| Billing | `BILLING_CONSOLE_ROLES` | `subscription.py:129, 193, 245, 287, 328, 361` |
| Cost dashboard | `FINANCE_CONSOLE_ROLES` | `admin_orgs.py:247` (`platform-analytics`), `:381`, `:443` |

`srijan_admin`'s surface is the Srijan hub at `/hub`, which is a separate route
under the app shell — it is not losing access, it never had any under `/admin`.
`platform_support` is specified at zero until an org admin approves a time-boxed
session, and `platform_support_sessions` does not exist yet.

### 2.5 Module routes × entitlement, after wiring `module_grants[]`

The ten module routes still *render* for any staff user — route-level module
gating is not something `Protected` does, and should not be: the module APIs are
the enforcement point and they already 403. What changed is the **nav**, which per
RBAC-SPEC denied state 1 must not advertise them.

| Nav row | `module` key | visible to |
|---|---|---|
| CRM | `graha` | god, manager, staff, members granted `graha` |
| Invoicing | `ganit` | god, manager, org admins — **never a plain member** (sensitive) |
| HRMS | `manav` | god, org admins — **never manager or staff** (HR) |
| Payroll | `vetana` | god, org admins — **never manager or staff** (HR) |
| Sales | `vikray` | god, manager, staff, members granted `vikray` |
| Analytics | `dristi` | god, manager, staff, members granted `dristi` |
| Marketing | `prachar` | god, manager, staff, members granted `prachar` |
| E-Sign | `esign` | god, manager, members granted `esign` — **not staff** |
| Messages | `sanvaad` | god, manager, staff, members granted `sanvaad` |
| Attendance | `pahchan` | god, manager, members granted `pahchan` — **not staff** |
| Srijan / Srijan Admin | `srijan` | god, manager, staff — **not `platform_support`** |

Derived by running `role_tiers.modules_for()` over each code and by mirroring
`require_module`'s three gates in `auth_router.py::_module_grants`.

### 2.6 What enforcement actually is, versus what `role_tiers.py` describes

Recording this because the file reads as though more is enforced than is.

**Module LEVEL is not enforced anywhere.** `level_satisfies` (`role_tiers.py:241`)
encodes the viewer/editor/approver/admin ladder and the separated-duty carve-out
for Vetana and Ganit correctly — and has **zero call sites in the entire
backend**. There is no `require_module_level` dependency. `require_module` checks
only that a grant row *exists*, never what level it names. Independently verified
by the coordinator (`_COORDINATION.md` §5) and by grepping this tree.

The practical consequence: **an `org_admin` can approve a payroll run today**
(`PATCH /payroll/runs/{run_id}/approve`, `vetana.py:664`), which is precisely the
separation `role_tiers.py:212-224` says must not exist — *"whoever defines what
people are paid must not also be the one who releases the money."*

This does **not** change my nav work: the nav gates on grant *existence*, which is
exactly what the backend gates on, so the sidebar and the API still agree. It does
mean the Tier-4 half of the "4-tier role model" is documentation, not behaviour.

`_COORDINATION.md` §5 records an unresolved contradiction blocking the fix
(RBAC-SPEC says sensitive modules have no grant row at all; the Tier-4 model
assumes a grant row carrying a level is how approver is held). Both cannot be
true, and building enforcement against the wrong one is worse than the gap. **Not
mine to guess — flagged, not fixed.**

---

## 3 · What I changed

### 3.1 `module_grants[]` — the field `01 §4` requires and nothing sent

`backend/auth_router.py` — `_module_grants()` plus a fourth argument to
`_safe_user`. It mirrors `middleware/subscription.py::require_module` gate for
gate, so the sidebar cannot promise what the API refuses:

| Caller | Returned | Why |
|---|---|---|
| any platform role | `sorted(modules_for(role))` | mirrors gate 1 |
| `org_owner` / `org_admin` | key **absent** | mirrors gate 2 — their reach is the plan, not a grant row |
| `org_member` | `org_member_modules` **minus** `SENSITIVE_MODULES` | mirrors gate 3 + RBAC-SPEC's role-derived rule |
| no org at all | key **absent** | a portal client renders no module rail |

`_safe_user` tests `module_grants is not None`, not truthiness — an **empty list**
is the one answer that has to survive the trip, because "granted nothing" is
exactly the case the nav must act on.

> **BEHAVIOUR CHANGE, and the highest-visibility one I made.** A plain
> `org_member` now sees **no modules group at all** unless someone has granted
> them something, and `routers/org_modules.py:109` states
> `staging.org_member_modules` **is empty**. So in practice every plain member
> loses all ten module links.
>
> I checked this before shipping it rather than after: **every** module router
> applies `require_module` — `graha.py:27`, `ganit.py:27`, `manav.py:23`,
> `vikray.py:21`, `vetana.py:29`, `dristi.py:24`, `prachar.py:24`, `esign.py:40`,
> `pahchan.py:45`, `messaging.py:27`. A grant-less member gets 403 on all of them
> today. **Nobody loses working access; they lose ten links that already failed.**
> That is what RBAC-SPEC denied state 1 asks for, and it makes an existing
> breakage visible instead of hiding it behind links.
>
> Rollback if the owner disagrees: return `None` instead of the list in
> `_module_grants`' final branch. One line.

### 3.2 Platform console gated on the sets its endpoints require

`adminNav.js` had no role predicate at all — see §2.4 for the resulting matrix and
the call sites behind each row. `Protected` imports the same exported
`ADMIN_SURFACE_ROLES` that `AdminShell` uses, so the two cannot drift again.

### 3.3 Two guards upstream of every route (`_COORDINATION.md` §6, unowned)

**`middleware/roles.py` · `require_org_role`** probed the bare string
`role_code = 'platform_admin'`, so a `platform_owner` row failed the god-mode pass
and fell through to the org-role lookup — where god mode has no row, because it is
not org-scoped. Now reads `GOD_MODE_ROLES`. Renaming the legacy rows is a data
change and nothing else.

**`middleware/org_resolver.py`** admitted all eight Tier-1 codes on the
`X-Org-Id` path. Narrowed to exclude **`platform_support` only**.

> The brief named four zero-reach roles. **Excluding all four would have been an
> outage, not a fix.** The evidence, checked before acting:
>
> - `account_finance`, `account_manager` — `subscription.py`'s admin endpoints
>   (`:144` set-plan, `:208`, `:260`, `:302`) take
>   `require_platform_role(*BILLING_CONSOLE_ROLES)` **and** `Depends(get_org_id)`,
>   and `AdminBillingPage` reaches them by sending this very header
>   (`pages/admin/orgScope.js:69`). Both roles are in `BILLING_CONSOLE_ROLES`.
>   Denying them breaks the billing console for the two roles it exists for.
> - `srijan_admin` — `routers/hub.py` depends on `get_org_id` in **44** places.
>
> `modules_for()` returning `frozenset()` for those three is about MODULE reach
> *inside* a customer org — a different question from whether they may resolve
> one. `platform_support` is the one unambiguous case: RBAC-SPEC says "Zero by
> default", `role_tiers.py:41` says it "gets nothing", and
> `platform_support_sessions` does not exist. Excluding it cannot break anything
> because no endpoint admits it today.
>
> **The real fix for the other three** is an explicit `{org_id}` path parameter on
> the billing and hub endpoints, the way `admin_orgs.py` already does it, so the
> org is an argument the guard can see rather than a header the resolver trusts.
> That is an endpoint-shape change across two routers — recorded, not smuggled in.
> **Please do not re-broaden this exclusion without doing that work first.**

Two tests in `test_rbac_isolation.py` keyed on the literal SQL string rather than
on behaviour; updated to assert on the role set passed, which is the stronger
assertion. Added the `platform_owner` case the fix exists for — it fails against
the old code.

### 3.4 Shell chrome

- **Rail toggle rendered in rail.** It was hidden whenever Rail was the stored
  preference, so choosing Sidebar = Rail in Customize left no way to widen it
  again. `editorial.css:324-326` had already been written for the state that never
  mounted (32px button, chevron rotated 180°); `Chrome.jsx:124-125` spells it
  `setRail(!rail)` with `rail ? I.chevR : I.chevL`. `COLLAPSED_KEY` keeps its name
  and its `'1'`/`'0'` values verbatim (01 §5) — what changed is that an *absent*
  key is no longer folded into `'0'`, which is what made "never touched the
  control" read as "chose wide".
- **Breadcrumb names the page.** It printed a hardcoded `कर्तव्य`, so every screen
  read the same thing on the left — "कर्तव्य / CRM" on Graha. `ROUTE_META` had
  been returning `hi` and `gu` for that slot the whole time and nothing read
  either, which is also why the earlier first-wins `ROUTE_META` fix (Organisation
  no longer resolving to "Billing") could not be seen on this surface.
  `Chrome.jsx:260-261` is the reference. `.crumb__hi` keeps `--font-hindi` and
  takes `--font-indic` only on `[lang="gu"]`, because the Gujarati face has zero
  Devanagari coverage and drops conjuncts silently rather than failing visibly.

### 3.5 Dead code — adjudicated

**`pages/BillingPage.jsx` — DELETED.** The prior report said dead; a later grep
found "6 remaining references" and blocked it. All six are prose:

| Reference | Kind |
|---|---|
| `App.jsx:62`, `App.jsx:217` | comments explaining the redirect |
| `navConfig.js:76` | comment |
| `lib/statusColors.js:77` | comment |
| `pages/org/TabBilling.jsx:15` | comment naming what it replaced |
| `pages/BillingPage.jsx:214` | its own `export default` |

**Zero import statements** in `frontend/src/`. The two other grep hits are
`AdminBillingPage`, a different file. Folded into `org/TabBilling.jsx` by
`10-org-settings.md`; `/billing` survives as a redirect.

**`pages/ScrapersPage.jsx` — DELETED.** Zero importers, zero references outside
itself. Superseded by the inline tab at `OrgSrijanPage.jsx:932`.

---

## 4 · Stale, wrong, and corrected claims

| Claim | Verdict |
|---|---|
| Client could reach the entire staff product | **Real, and genuinely fixed.** Allow-list verified airtight — §2.3 |
| `/admin` gated on org role while shell gated on platform | **Real, fixed.** Both now read `platform_roles` |
| `canSeeNavItem` never read `item.module` | **Half stale.** Filter present; the *data* was never sent, so entitlements still hid nothing. Fixed this pass |
| `ICONS.settings` never existed | **Stale** — present at `navIcons.jsx:13`. All 28 icon keys resolve |
| Pahchan in no nav list | **Stale** — present at `navConfig.js:66` |
| `ROUTE_META` last-wins | **Stale** — first-wins via `claim()`. But the fix was *invisible* until §3.4 |
| `components/icons/**` does not exist | **Confirmed.** Path is `components/layout/navIcons.jsx` — every brief and `_SOURCE-MAP.md` omit `components/` |
| `BillingPage.jsx` has 6 live references | **Wrong** — all six are prose. Deleted |
| `ScrapersPage.jsx` zero importers | **Correct.** Deleted |
| `org_resolver` — 4 zero-reach roles must be excluded | **Half wrong.** Excluding all four is an outage. Only `platform_support` is safe — §3.3 |
| My own `module: 'samvada'` change | **I was wrong.** `4a966c6` settled it as `sanvaad`, correctly. Reverted |

### A correction to my own earlier gate claims

My first three commits reported gates green from output that had been piped
through `tail`, which reports **`tail`'s** exit status, not the script's — the
same mistake `_COORDINATION.md` §2 says three agents made. The *text* those runs
printed did say `0 missing` / `0 missing a rule`, so the conclusion held, but the
method was unsound. Every gate run from §3.3 onward is unpiped with the real exit
code checked. Final state verified that way: **exit 0.**

---

## 5 · Recorded, not fixed

1. **`MOBILE_NAV` is not entitlement-filtered.** `MobileNav.jsx:31` maps it
   directly, and its Messages slot carries no `module` key — so a member without a
   `sanvaad` grant still gets a bottom-bar tap that 403s. I did **not** change it:
   01 §1 is unconditional that there are **five slots — Today · Tasks · ＋ ·
   Messages · More** — and dropping one silently deviates from a pixel spec. **Spec
   gap**: 01 does not say what the bottom bar does when a slot is not entitled.
   Needs a designer decision, not an agent's guess.
2. **Route ranking at `/` is order-dependent.** `RootGate` and the protected shell
   both declare `path="/"` and score identically; the tie breaks on declaration
   order. Correct today, fragile — reordering those two `<Route>`s would send
   anonymous visitors to `/login` instead of the landing page. An `index` route on
   the shell would make it explicit.
3. **Module-level enforcement is absent backend-wide** — §2.6. Blocked on an
   owner decision, per `_COORDINATION.md` §5.
4. **`role_tiers.py:33` says god mode is "Four people."** `RBAC-SPEC.md:18` says
   **exactly 3**, and names them. Prose defect in the backend, not code — I did not
   edit it because the count appears in a comment I have no authority to settle.
5. **The plans catalogue and the grant vocabulary are separate namespaces.**
   `migrations/010_…:147` sells modules under catalogue codes; `org_member_modules`
   stores `require_module` codes. `sanvaad` is now consistent across both, but
   nothing structurally prevents the next divergence.

### Divergences from `Chrome.jsx` I deliberately did **not** implement

`01-navigation.md` supersedes the reference mock in each case, explicitly:

- **Toolbar affordances.** `Chrome.jsx:248-278` has a SyncChip, a `?` shortcuts
  button and an Appearance popover. 01 §2's tree lists only `Crumb`,
  `SearchTrigger` and `actions bell · new task`. Followed 01.
- **Search control.** `Chrome.jsx:264` is a real `<input>`; 01 §1 explicitly
  overrides it — *"Search is a button that opens the palette, not an input"*.
  Followed 01.
- **Bottom bar.** `Chrome.jsx:301-307` is Home/Tasks/CRM/Chat/Money with
  Devanagari labels and no FAB. 01 §1 mandates Today · Tasks · ＋ · Messages ·
  More, one English label per slot. Followed 01.
- **Sidebar taxonomy.** `Chrome.jsx:36-69` groups nav as
  Workspace/Revenue/People/Growth/Settings/Clients; the build uses
  workspace/operations/team/srijan/modules/settings. **Not changed**, for three
  reasons: Chrome's ids (`dash`, `roles`, `aekam`) are not routes; 01 §5's diff
  table asks only that the existing `NAV_FULL` **move** into `navConfig.js`, not be
  re-taxonomised; and section names are the localStorage keys inside
  `kartavya_sidebar_sections`, so renaming them silently resets every user's
  expanded/collapsed state — the exact failure 01 §5 warns about for those keys.
