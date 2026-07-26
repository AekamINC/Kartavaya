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
| Messages | `samvada` | god, manager, staff, members granted `samvada` |
| Attendance | `pahchan` | god, manager, members granted `pahchan` — **not staff** |
| Srijan / Srijan Admin | `srijan` | god, manager, staff — **not `platform_support`** |

Derived by running `role_tiers.modules_for()` over each code and by mirroring
`require_module`'s three gates in `auth_router.py::_module_grants`.

---
