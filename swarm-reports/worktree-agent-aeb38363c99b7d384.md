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

---
