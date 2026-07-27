# Settings · Organisation · Customization · Aekam admin — STRUCTURE lens

Branch `worktree-agent-ae427fc5a788c7505`. Reference **rendered**, not read:
`frontend/public/__ref/Settings.html` (gitignored) on the `kartavya-frontend`
dev server, driven by `SetOrg.jsx`, `SetCustomize.jsx`, `SetAdmin.jsx`,
`Chrome.jsx:36` and `ScreensRBAC.jsx:71`.

> The worktree started on `1aa4985`, an old commit with no `design-reference/`
> and no `swarm-reports/` at all. Reset to `origin/staging` (`e9134b2`) first.
> Any other agent handed this worktree should check that before anything else.

> It also had **no `node_modules`**, so nothing could be built or tested in it.
> Junctioned from the main checkout to verify:
> `cmd //c "mklink /J node_modules D:\Projects\Kartavya\frontend\node_modules"`.
> Removed again at the end — leave it in place and an `npm install` run from
> this worktree writes into the main checkout that every other worktree shares.

---

## 0 · Two things that are true regardless of this surface

**`staging` did not compile.** `vite build` has been failing since `8131f24`:
`pages/DristiPage.jsx` carries a `{/* … */}` comment in the consequent of a
ternary, where the braces are an object literal rather than a JSX child. Nothing
caught it because the page is lazily imported — the dev server only parses it
when someone navigates to Dristi, and no gate runs a build. Fixed on its own
commit (`5976e4e`) so it can be taken ahead of everything else here. **Any agent
who has not been running `vite build` has been verifying against a bundle that
cannot be produced.**

**The gates do not cover this.** `check-tokens` and `check-classes` both passed
on a tree that would not build. Worth someone adding a build step.

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

**Six for six on tabs** — but see §6: every one of them was missing its
Devanagari, which is not visible in `SetCustomize.jsx` at all. Header gap: the
reference's `PH` carries a `Reset to defaults` + `Done` action pair; the build's
`PageHeader` has no actions slot in use here.

## 3 · Organisation hub — `SetOrg.jsx:343` vs `pages/OrgSettingsPage.jsx:40`

| # | Reference tab | Build tab | Panel | Verdict |
|---|---|---|---|---|
| 1 | Profile | Profile | `org/TabProfile.jsx` | match |
| 2 | Members · count | Members | `org/TabMembers.jsx` | match; **count not passed** |
| 3 | Billing | Billing | `org/TabBilling.jsx` | match |
| 4 | Modules · count | Modules | `org/TabModules.jsx` | match; **count not passed** |
| 5 | Security | Security | `org/TabSecurity.jsx` | match |
| 6 | Danger zone | Danger | `org/TabDanger.jsx` | match; label truncated |

**Six for six on tabs**, but neither the counts nor the Devanagari were there —
both now shipped, see §6. `components/ui/Tabs.jsx:72` already rendered
`tab.count`; the caller simply never supplied one.

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

---

## 6 · What only the RENDER showed — and where reading the JSX misled me

I enumerated §2 and §3 above from the tab arrays and called both hubs
"six for six". Then I drove the harness. Two corrections and one whole missing
element came out of it, and none of them were legible in the source.

**Every tab carries its Devanagari beside the word.** `SetOrg.jsx:351` and
`SetCustomize.jsx:495` pass `TabBar` a list of bare KEYS; the Devanagari is
looked up two files away in `Data.jsx:134` (`TAB_HI`). Reading either file shows
a plain tab bar. The rendered DOM is
`<span class="tabs__en">members</span><span class="tabs__hi">सदस्य</span>`.
Both hubs were missing this entirely. Now shipped, through a shared `.tabs__hi`
matching `app.css:136`.

**Counts render on Members and Modules**, and — importantly — they are on screen
while *Profile* is the open tab. `Tabs` mounts one panel at a time, so a count
reported by the panel that owns the list is a count nobody ever sees. The shell
fetches them; the panels report again as their lists change.

**Where the render is WRONG and the source is right.** The harness renders
`Danger` with no Devanagari, and `Data`. But `ORG_TABS` labels the tab
`'Danger zone'`, and `TAB_HI` keys its Devanagari under `'danger zone'` — the
key passed to `TabBar` is `'danger'`, so it renders the key and then misses its
own Devanagari entry. Same shortcut gives `Data` where `CUST_TABS` says
`'Data & privacy'`. A label written out longhand next to the key it belongs to
is a decision, not a duplicate, so the labels win and `संकट` is restored.

The lesson generalises: **render first to find what is missing, then read to
find what it should say.** Neither alone was sufficient here.

---

## 7 · Shipped

| Commit | What |
|---|---|
| `5976e4e` | `staging` compiles again (see §0) |
| `fa10d5f` | `Roles & access` and `Aekam admin` destinations; Billing row removed; admin `Overview` → `Users`; nav wording |
| `446247b` | 12 nav tests, incl. the console's role gate |
| `40b4384` | Devanagari tab labels on both hubs; Members/Modules counts; 6 tests |

`/settings/roles` mounts the existing wired `TabMembers` on its matrix half
rather than duplicating a screen that adds, invites, revokes and regrants. The
`Aekam admin` row is gated on `ADMIN_SURFACE_ROLES` — the set `Protected.jsx`
tests, not "any platform role", so `srijan_admin` and `platform_support` do not
get a row into a console where every screen 403s.

The count test caught a real defect the moment it was written: the shell's
effect was keyed on `orgRole`, which `currentUser()` rebuilds on every call, so
it re-fired on every render and fetched both lists twice on arrival.

---

## 8 · Deliberately NOT done, with reasons

- **The other seven `Roles & access` tabs.** Four (role levels, denied states,
  client portal, module rules) are explanatory screens needing no endpoint —
  cheap, and genuinely worth building. Three cannot be built honestly:
  `support access` and `audit log` have no table, `projects` has no read
  endpoint.
- **Admin Dashboard, Support sessions, System settings.** No endpoints, and two
  of the three have no table. Rows documented in place at `adminNav.js:45`.
- **The two spec defects.** Recorded above, not designed around. Both need the
  owner to decide the field shape before anything on those cards can persist.
- **`Categories`.** Build-only, no reference equivalent, but a real page against
  a real endpoint. Kept rather than stranded.
- **The hub header action slots.** The reference's `PH` carries
  `Reset to defaults`/`Done` (Customization) and an `All changes saved` tag plus
  `Done` (Organisation). The build's `PageHeader` supports a `right` slot and
  neither hub uses it. Left for the pixel sibling — it is chrome, and the
  "all changes saved" tag would need a real dirty-state signal to not be a lie.
