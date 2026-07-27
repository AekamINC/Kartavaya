# Settings · Organisation · Customization · Aekam admin — STRUCTURE lens

Branch `worktree-agent-ae427fc5a788c7505`. Reference **rendered**, not read:
`frontend/public/__ref/Settings.html` (gitignored) on the `kartavya-frontend`
dev server, driven by `SetOrg.jsx`, `SetCustomize.jsx`, `SetAdmin.jsx`,
`Chrome.jsx:36` and `ScreensRBAC.jsx:71`.

> The worktree started on `1aa4985`, an old commit with no `design-reference/`
> and no `swarm-reports/` at all. Reset to `origin/staging` (`e9134b2`) first.
> Any other agent handed this worktree should check that before anything else.

---

## 1 · Sidebar section `Settings · व्यवस्था`

Reference `Chrome.jsx:36` against build `components/layout/navConfig.js:121`.

| # | Reference | Build | Verdict |
|---|---|---|---|
| 1 | Roles & access · अधिकार · badge 1 | — | **destination missing**; the content exists inside Organisation ▸ Members |
| 2 | Customization · रूपांकन | Customize · सजावट | present; label and Devanagari are a paraphrase |
| 3 | Organisation · संस्था | Organisation · संगठन | present; Devanagari is a paraphrase |
| 4 | Aekam admin · ऐकम | — | **destination missing**; the console is built at `/admin` and reachable only by typing the URL |
| — | — | Categories · वर्ग | build-only; real wired page (`/categories`). Kept. |
| — | — | Billing · बिलिंग → `/settings/organisation?tab=billing` | build-only; points at a tab of the row above it |

## 2 · Customization hub — `SetCustomize.jsx:469` vs `pages/CustomizeSettingsPage.jsx:24`

| # | Reference tab | Build tab | Verdict |
|---|---|---|---|
| 1 | Appearance · रूप | Appearance | match |
| 2 | Typography · अक्षर | Typography | match |
| 3 | Layout · ढाँचा | Layout | match |
| 4 | Language · भाषा | Language | match |
| 5 | Notifications · सूचना | Notifications | match |
| 6 | Data & privacy · गोपनीयता | Data | match; label truncated |

**Six for six.** The only header gap: the reference's `PH` carries a
`Reset to defaults` + `Done` action pair; the build's `PageHeader` has no
actions slot in use here.

## 3 · Organisation hub — `SetOrg.jsx:343` vs `pages/OrgSettingsPage.jsx:40`

| # | Reference tab | Build tab | Panel | Verdict |
|---|---|---|---|---|
| 1 | Profile | Profile | `org/TabProfile.jsx` | match |
| 2 | Members · count | Members | `org/TabMembers.jsx` | match; **count not passed** |
| 3 | Billing | Billing | `org/TabBilling.jsx` | match |
| 4 | Modules · count | Modules | `org/TabModules.jsx` | match; **count not passed** |
| 5 | Security | Security | `org/TabSecurity.jsx` | match |
| 6 | Danger zone | Danger | `org/TabDanger.jsx` | match; label truncated |

**Six for six.** `TabBar … counts={{ members, modules }}` in the reference;
`components/ui/Tabs.jsx:72` already renders `tab.count`, the caller just never
supplies one.

### Section inventory inside each Organisation tab (reference)

- **Profile** — Company / Billing address / Bank details in the left column;
  Logo (+ "Where it appears" 4 switches) / Invoice note in the right.
- **Members** — roster table `Member · Org role · Module grants · Last active`,
  `Role guide` + `Add member` actions, and a note pointing at Roles & access.
- **Billing** — Subscription + Invoices (left), Change plan + Payment method (right).
- **Modules** — grid of module cards with a switch each, sensitive ones flagged.
- **Security** — 2FA / Sessions (left), Password policy / IP restrictions (right).
- **Danger zone** — Transfer ownership, Delete organisation.

## 4 · Aekam admin console — `SetAdmin.jsx:4` (ADM_NAV) vs `components/admin/adminNav.js:45`

| # | Reference row | Build row | Backend | Verdict |
|---|---|---|---|---|
| 1 | Dashboard · मुख्य | — | no `GET /v1/admin/dashboard` | **missing, not wireable** |
| 2 | Organisations · संस्था | `/admin/orgs` | `GET /v1/admin/orgs` | present; detail is a SlideOver, not `/admin/orgs/:id` |
| 3 | Users · उपयोगकर्ता | `/admin` labelled **"Overview"** | `GET /admin/users`, `…/roles/platform` | **present but misnamed** |
| 4 | Billing & invoices · बीजक | `/admin/billing` "Billing" | yes | present |
| 5 | Cost analytics · व्यय | `/admin/costs` "Cost dashboard" | yes | present |
| 6 | Support sessions · सहायता | — | `platform_support_sessions` **table does not exist** (`middleware/role_tiers.py:46`) | **missing, not wireable** |
| 7 | System settings · व्यवस्था | — | no `GET/PATCH /v1/admin/system-settings` | **missing, not wireable** |

`/admin` (`pages/AdminPage.jsx:870`) is really the users console — its own tabs
are `Overview · Accounts · Invites · Platform roles`. Only the first of those is
an overview, and it is stat tiles plus an R2 folder map, not the reference's
cross-org Dashboard.

## 5 · Roles & access — `ScreensRBAC.jsx:71`

Ten reference tabs, against what the build has and what the database allows:

| Reference tab | Build | Wireable today |
|---|---|---|
| members | `org/TabMembers.jsx` (List view) | yes — already wired |
| matrix | `org/AccessMatrix.jsx` (Access matrix view) | yes — already wired |
| invitations | `org/TabMembers.jsx` invited section | yes — already wired |
| role levels | — | explanatory screen, no endpoint needed |
| denied states | — | explanatory screen |
| client portal | — | explanatory screen |
| module rules | — | explanatory screen |
| projects | — | project-level grants; not surveyed |
| support access | — | **no** — `platform_support_sessions` absent |
| audit log | — | **no** — `staging.audit_log` absent (`routers/org_modules.py:150`) |

---

## Spec defects — recorded, NOT invented around

1. **"One device at a time"** switch renders at `SetOrg.jsx:270`. The contract at
   `design-handover/10-org-settings.md:212` and `SETTINGS-ADMIN-SPEC.md:236`
   gives `/v1/org/security` exactly `tfa_allowed`, `tfa_enforced`,
   `idle_timeout`, `ip_ranges[]`, `password_policy` — no single-session field.
2. **Four-control password policy** (`SetOrg.jsx:276`: minimum length, require a
   number and a symbol, block common passwords, expire every 90 days) sits
   behind one opaque `password_policy` key. No per-control shape is specified.

Neither is schema I am entitled to invent. They need a decision from the owner
before either surface can honestly persist.

## Verified rather than redone

`Add a member` falling back to an invitation, and pending invitations rendering
beside the roster because they hold a seat — both confirmed live at
`org/TabMembers.jsx:378` and `:411`. Left alone.
