# Settings, Admin & Customization — implementation handover

Target stack: **Vite + React (JSX, no TypeScript) · plain CSS custom properties in `editorial.css` · FastAPI · Supabase Postgres · no component library.**

Design files: `Settings.html` → `SetCustomize.jsx` (A), `SetOrg.jsx` (B), `SetAdmin.jsx` (C + D), `settings.css`.

---

## What changes in the existing tree

| Existing file | Change |
|---|---|
| `pages/CustomizeSettingsPage.jsx` | Becomes tab 1–4 of a single hub. Keep the page as the shell, move controls into tab components. |
| `pages/NotificationsSettingsPage.jsx` | **Deleted.** Content becomes tab 5. Its route redirects to `/settings/customize?tab=notifications`. |
| `components/CustomizePanel.jsx` | `ACCENTS` grows 4 → 12. `DEFAULTS` gains `uiFont`, `lineHeight`, `radius`, `anim`, `sideBg`, `toastPos`, `dnd`, `dndFrom`, `dndTo`. **Fix the `--font-ui` bug (below).** |
| `pages/OrgSettingsPage.jsx` | Becomes tab 1–2 of the org hub. |
| `pages/BillingPage.jsx` | Folded in as org hub tab 3. Route redirects to `/settings/org?tab=billing`. |
| `pages/AdminPage.jsx` | Superseded by the admin console shell + `/admin/dashboard`. |
| `pages/AdminOrgsPage.jsx` | List redesigned; gains `/admin/orgs/:orgId` detail with 5 tabs. |
| `pages/AdminBillingPage.jsx` | Gains the revenue header, status filters, multi-line invoice builder, payment history, overdue management. |
| `pages/AdminCostDashboardPage.jsx` | Keep the period + currency selectors; add margin, per-org profitability, trend. |
| `components/layout/Sidebar.jsx` | Gains admin mode (section D). |
| **New** | `pages/admin/AdminDashboardPage.jsx`, `AdminUsersPage.jsx`, `AdminSupportPage.jsx`, `AdminSystemPage.jsx`, `components/layout/AdminSidebar.jsx` |

### The `--font-ui` bug, first

`applyPrefs` computes `SANS_IDS.has(prefs.font)` and then sets `--font-ui` to the display font in **both** branches:

```js
if (SANS_IDS.has(prefs.font)) { root.style.setProperty('--font-ui', fnt.value); ... }
else                          { root.style.setProperty('--font-ui', fnt.value); ... }
```

So choosing Newsreader makes every label, table cell, chip and button serif. Replace with two independent lookups:

```js
const dsp = DISPLAY_FONTS.find(f => f.id === prefs.font)   || DISPLAY_FONTS[0];
const ui  = UI_FONTS.find(f => f.id === prefs.uiFont)      || UI_FONTS[0];
root.style.setProperty('--font-display', dsp.value);
root.style.setProperty('--font-ui', ui.value);
document.body.style.fontFamily = 'var(--font-ui)';
```

`SANS_IDS` can then be deleted.

---

## A · Customization hub — `/settings/customize`

Six tabs, one `k_prefs` object, all applied by `applyPrefs` on `documentElement`.

```
CustomizeHub
├── PageHeader (Reset to defaults · Done)
├── Tabs [appearance typography layout language notifications data]
└── TabAppearance | TabType | TabLayout | TabLang | TabNotif | TabData
```

### Preference keys

| Key | Values | Default | Applied as |
|---|---|---|---|
| `mode` | `light` `dark` `system` | `light` | `data-theme`; `system` reads `matchMedia('(prefers-color-scheme: dark)')` and subscribes to `change` |
| `accent` | 12 ids | `teal` | `--k-primary` `--k-mid` `--k-deep` `--k-grad` `--side-active` |
| `customAccent` | hex or null | `null` | overrides `accent`, run through `deriveAccentColors` |
| `sideBg` | `dark` `light` `accent` | `dark` | `data-sidebar-bg` |
| `sidebar` | `wide` `rail` | `wide` | `data-sidebar` |
| `density` | `compact` `comfy` | `comfy` | `data-density`, `--page-pad` `16px`/`28px` |
| `font` | 9 ids | `newsreader` | `--font-display` |
| `uiFont` | 6 ids | `inter` | `--font-ui` |
| `fontSize` | 12–20 | `14` | `--font-size-base`, `body.style.fontSize` |
| `lineHeight` | `1.3` `1.5` `1.7` | `1.5` | `--line-height-base` |
| `radius` | `4` `10` `20` | `10` | `--radius-base` (every `--r-*` derives from it) |
| `anim` | `full` `reduced` `none` | `full` | `--motion-scale` `1` / `0.5` / `0.001` |
| `language` | 6 ids | `en+sa` | `data-language`, `--font-indic` |
| `push` | bool | `false` | web-push subscription |
| `sound` | 10 ids incl. `none` | `bell` | `localStorage k_notif_sound` (existing) |
| `toastPos` | `tr` `br` `bc` | `br` | `data-toast-pos` on the toast root |
| `dnd`, `dndFrom`, `dndTo` | bool, `HH:mm`, `HH:mm` | `false`, `20:00`, `09:00` | checked before push + sound |
| `timeFmt` | `12h` `24h` | `12h` | existing `setTimeFormat` |

`prefers-reduced-motion: reduce` always wins over `anim`.

### Accent grid — 12 presets

3 × 4 grid, `repeat(auto-fit, minmax(96px, 1fr))`, gap `9px`. Swatch `100% × 30px`, `--r-sm`, filled with `linear-gradient(135deg, deep, mid 55%, color)`. Selected cell: `border-color: var(--on-surface)` plus `inset 0 0 0 1px`. New presets carry a `6px` `--ok` dot at `top/right 5px`. The 13th cell is Custom — a conic-gradient swatch opening `<input type="color">`.

Only `color` is stored. `mid` and `deep` come from `deriveAccentColors`: `mid = hsl(h, s+5, l−10)`, `deep = hsl(h, s+10, l−20)`. Base hexes:

`teal #05b7aa` · `blue #3b82f6` · `saffro #f59e0b` · `indigo #6366f1` · `rose #e11d63` · `emerald #059669` · `amber #d97706` · `violet #7c3aed` · `coral #f2643c` · `slate #64748b` · `crimson #be123c` · `forest #3f6212`

Live preview strip below the grid renders a filled button, tonal button, outline button, a link, a status tag, a selected chip and a progress meter — every place the accent actually lands.

### Sidebar background

`data-sidebar-bg` on `<html>`:

```css
[data-sidebar-bg="dark"]   .side { background: rgb(var(--side-ink)); --side-fg: rgba(255,255,255,.8); }
[data-sidebar-bg="light"]  .side { background: var(--s-container); --side-fg: var(--on-surface-2);
                                   --side-rule: var(--outline-variant); --side-hover: var(--s-high); }
[data-sidebar-bg="accent"] .side { background: linear-gradient(160deg, var(--k-mid), var(--k-primary));
                                   --side-fg: rgba(255,255,255,.86); --side-rule: rgba(255,255,255,.16); }
```

The light variant must also flip `.side__item.on` to `--primary-container` and the brand wordmark to `--on-surface`.

### Typography previews

Each font row renders its own name **in its own family** — `Aa` specimen at `21px` in a `34px` gutter, then the name at `14px`. Requires the families to be loaded before the picker paints; import them in `index.html`, not lazily, or every row falls back to the system font on first render.

Live preview card binds `--pv-d` (display), `--pv-u` (UI), `--pv-fs`, `--pv-lh` and sets `h3 { font-family: var(--pv-d); font-size: 1.6em }`, `p { font-family: var(--pv-u); line-height: var(--pv-lh) }`.

### Notification sounds

Card grid, `repeat(auto-fit, minmax(138px, 1fr))`. Tapping a card selects **and** plays it — a separate play button doubles the target count for no gain. Preview uses the existing `playNotifSound()`; the design prototype synthesises tones with `OscillatorNode` (gain ramp to `.16` over `12ms`, exponential decay to `.0001` over `420ms`).

Permission states drive the header chip: `granted` → `--ok`, `default` → `--on-surface-3`, `denied` → `--danger` with the "cannot re-ask" note.

### Email notification types

`assigned` · `mention` · `approval` · `due` · `digest` are user-togglable. `support_access_request` is **locked on** — a customer cannot switch off the email that tells them somebody wants into their data.

---

## B · Organisation hub — `/settings/org`

```
OrgHub → Tabs [profile members billing modules security danger]
```

Profile fields are the existing `/v1/org/profile` payload plus `description`, `industry`, `team_size`, `founded_year`. Logo drop zone: `1px dashed --outline-variant`, on dragover `--primary` + `8%` tint fill; accepts PNG/SVG ≥ 512px; a "where it appears" list (invoice, portal, sign-in, email) with per-surface toggles.

Members table columns: avatar+name/email · org role badge · **module grant chips** (first 3, then `+n`) · last active · ⋯. Grant chips use `LVL[level]` colour and background from the RBAC spec.

Modules tab: `repeat(auto-fill, minmax(226px, 1fr))`. Inactive cards sit at `opacity .68`. Sensitive modules (Vetana, Ganit, Manav) carry a `--danger` lock tag and are **role-derived — never granted per member** (see `RBAC-SPEC.md`). **Turning a module off revokes grants but deletes no data, and re-enabling restores the previous grants** — implement as a soft flag on `org_modules`, never a cascade delete.

Security: 2FA allow + enforce (enforce is disabled until allow is on, and names how many members would be locked out), idle timeout `15m/30m/1h/never` with payroll and roles always re-prompting, password policy, IP ranges with a self-lockout check before save.

Danger zone: ownership transfers only to an existing `org_admin`; deletion needs a retention checkbox plus the org name typed exactly, and is queued for **7 days** rather than executed.

---

## C · Platform admin console

Distinct surface: `data-surface="platform"` sets `--primary: #6B4FBF` (light) / `#C0A9F5` (dark) and a `#7c5cbf` inset stripe on the top bar. An operator can never mistake cross-org context for their own workspace.

| Route | Screen |
|---|---|
| `/admin/dashboard` | Stats, revenue bars, org growth, alerts, system health, activity |
| `/admin/orgs` | Searchable/filterable table |
| `/admin/orgs/:orgId` | Overview · Members · Modules · Invoices · Activity |
| `/admin/users` | All users, slide-over detail, platform role assignment |
| `/admin/billing` | Revenue header, invoice list + filters, builder, payments, overdue |
| `/admin/costs` | Per-model, per-org profitability, margin, trend |
| `/admin/support` | Active · Queue · History |
| `/admin/settings` | Defaults, email templates, maintenance, feature flags |

**Cost transparency rule:** margin, platform cost and profitability exist only on this surface. They must not appear in any tenant response, export, PDF or support-agent view. Enforce at the serializer, not the component.

**Impersonation is never silent.** It writes to the customer's own audit log with the operator's name and reason, and emails the owner. There is no quiet mode.

Invoice builder: multiple line items (`grid-template-columns: minmax(0,1fr) 68px 92px 34px`), GST resolved from the org's billing state — inter-state IGST, Maharashtra CGST+SGST — subtotal/tax/total computed client-side and re-verified server-side.

---

## D · Admin sidebar mode

`AdminSidebar.jsx` replaces `Sidebar.jsx` under `/admin/*`:

- `← Back to Kartavaya` as the first row, above everything, `11.5px`, `--side-fg-mute`.
- A standing badge below it: violet pulse dot, "Aekam platform", org count, and `box-shadow: inset 3px 0 0 #7c5cbf`.
- Nav: Dashboard · Organisations · Users · Billing & invoices · Cost analytics · Support sessions · System settings — each with its Hindi label and a count badge in `color-mix(in srgb, #7c5cbf 34%, transparent)`.
- Active item: `color-mix(in srgb, #7c5cbf 28%, transparent)` fill and a `3px #C0A9F5` left marker.
- Footer shows the operator with a violet avatar and their platform role.

**Below 1024px** the sidebar becomes a `min(282px, 84vw)` overlay drawer (`translateX(-102%)` → `none`, `--dur-slow` `--ease-emph`) opened by a burger in the bar, over a `--scrim`. A second `← App` pill sits in the bar itself so leaving admin mode never depends on opening the drawer. **Never hide the nav by width without shipping the replacement** — that shipped twice in this project (`.side` and `.adm__side`) and both times left a surface with no way out.

---

## Platform roles — five, not two

From `AdminOrgsPage.jsx` `PLATFORM_ROLE_OPTIONS`:

| Code | Reaches cost data |
|---|---|
| `platform_admin` | yes |
| `account_finance` | yes |
| `account_manager` | **no** |
| `developer` | **no** |
| `srijan_admin` | **no** |

The cost dashboard and the margin column must be gated on `platform_admin ∪ account_finance`. Assignment is by email lookup then `POST /v1/admin/orgs/roles/assign`; revoke is `DELETE /v1/admin/orgs/roles/:id`.

---

## Plans and metering — corrected to the real model

The first pass of this design invented a Free/Pro/Enterprise rate card at ₹4,999. The real model is per-org and negotiated:

| `plan_code` | `monthly_credits` |
|---|---|
| `free` | 200 |
| `starter` | 500 |
| `growth` | 1000 |
| `scale` | 2000 |

Each org additionally carries `monthly_price` and `markup_pct` (default `0.30`), both editable per org. There is no published price — the org billing tab shows the **agreed** figure. Credit top-ups are quick amounts (+100 / +200 / +500 / +1000) plus a custom field, via `POST /v1/admin/orgs/:id/credits/topup`.

### Cost analytics is dual-currency

`AdminCostDashboardPage.jsx` meters **Aekam cost in USD**, converts at a live `usd_to_inr` rate, then charges INR with the org's markup. Two cost families, not one:

- **AI**: `provider` · `model` · `cost_usd` · `charged_inr` · `call_count` · `prompt_tokens`/`completion_tokens`
- **Scraper / data**: `scraper_id` · `cost_usd` · `charged_inr` · `billed_inr` · `run_count`

Plus a per-client breakdown inside an org, and a daily trend stacked AI-over-scraper. Show the live rate and the markup on the surface — a margin figure with no visible rate is unauditable.

**The client-facing cost report PDF** (`GET /v1/admin/orgs/:id/cost-report-pdf`) carries charged INR only. USD cost, the live rate and `markup_pct` must never appear on it.

---

## Per-org R2 storage

Each org can hold its own Cloudflare R2 account: `r2_account_id`, `r2_access_key_id`, `r2_secret_access_key`, `r2_bucket_name`, so one customer's files never share a bucket with another's. The form **must** verify before saving (`POST /v1/admin/orgs/r2/verify` returns `{ valid, buckets[], error }`) — a wrong key silently breaks every upload with no error the customer can see. Storage shows `storage_used_bytes` against `storage_limit_bytes`, `0` meaning unlimited.

---

## API endpoints needed

```
GET/PATCH  /v1/me/preferences                 → k_prefs, server-side mirror for cross-device
GET/PATCH  /v1/org/profile                    → exists; add description, industry, team_size, founded_year
POST       /v1/org/logo                        multipart, returns logo_url
GET/PATCH  /v1/org/modules                   → { code, active }[]  (soft flag, grants preserved)
GET/PATCH  /v1/org/security                   → tfa_allowed, tfa_enforced, idle_timeout, ip_ranges[], password_policy
POST       /v1/org/transfer-ownership          body { to_user_id, password, totp }
POST       /v1/org/delete                      queues, 7-day window
GET        /v1/me/sessions                     device, ip, location, last_seen, current
DELETE     /v1/me/sessions/:id  ·  DELETE /v1/me/sessions
POST       /v1/me/export                       async, emails a 7-day link
GET        /v1/admin/dashboard                 stats, revenue[], growth[], alerts[], health
GET        /v1/admin/orgs                     ?q&status&sort  ·  GET /v1/admin/orgs/:id
POST       /v1/admin/orgs/:id/impersonate      audited both sides
GET        /v1/admin/users                    ?q&platform_role  ·  PATCH /v1/admin/users/:id/platform-role
GET/POST   /v1/admin/invoices  ·  POST /v1/admin/invoices/:id/send
POST       /v1/admin/payments                  supports partial
GET        /v1/admin/orgs/platform-analytics  ?period    → totals, margin_inr, ai_cost_by_provider[], top_orgs_by_spend[]
GET        /v1/admin/orgs/cost-summary        ?period    → per-org cost_usd, charged_inr, markup_pct, ai_calls
GET        /v1/admin/orgs/:id/cost-breakdown  ?period    → ai_costs[], scraper_costs[], per_client[], daily_trend[]
GET        /v1/admin/orgs/:id/cost-report-pdf ?period    charged INR only, never USD or markup
PATCH      /v1/admin/orgs/:id/settings                   markup_pct, monthly_credits, monthly_price
POST       /v1/admin/orgs/:id/credits/topup              { amount } → { balance }
POST       /v1/admin/orgs/r2/verify  ·  PUT /v1/admin/orgs/:id/r2
GET/POST/DELETE /v1/admin/orgs/roles/platform · /roles/assign · /roles/:id
GET        /v1/admin/costs                    ?period&currency  → per-model, per-org, margin
GET        /v1/admin/support-sessions         ?state  ·  DELETE /v1/admin/support-sessions/:id
GET/PATCH  /v1/admin/system-settings           defaults, maintenance, feature_flags
```

New tables: `user_preferences`, `org_security`, `org_modules`, `user_sessions`, `platform_feature_flags`, `platform_system_settings`. `platform_support_sessions` already exists per the RBAC spec.

---

## Still open

- Onboarding wizard (5 steps) and auth email templates — designed brief, not yet built.
- Interaction catalogue sections 6–12 (Kanban, table, Sanvaad, global).
- ~~SOC 2 badge~~ **removed 25 Jul 2026** — not certified; the slot now states data residency instead.
- `AdminBillingPage.jsx` was not read this pass — confirm the invoice line-item and payment field names before wiring the builder.
