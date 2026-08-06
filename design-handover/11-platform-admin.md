# 11 · Aekam platform admin

Prereq: `00-tokens.md`, `01-navigation.md`, `02-common-components.md`. Surface rules and the cost-transparency boundary in `SETTINGS-ADMIN-SPEC.md` §C.

Design source: `ScreensPlatform.jsx`, `SetAdmin.jsx`, `settings.css`.

Staging source: `pages/AdminBillingPage.jsx` (18,317 bytes), `pages/AdminOrgsPage.jsx` (39,894 bytes), `pages/AdminCostDashboardPage.jsx` (22,074 bytes), `pages/AdminPage.jsx` (36,495 bytes — **not read in full**).

---

## The finding: `/admin/billing` is not a platform page

Every call it makes is org-scoped:

```js
api.get('/v1/subscription/current')    api.get('/v1/subscription/invoices')
api.get('/v1/subscription/usage')      api.get('/v1/subscription/plans')
api.post('/v1/subscription/admin/set-plan', { plan_code, billing_cycle })
api.post('/v1/subscription/admin/invoices', { period_start, period_end, due_date, line_items })
```

**No `org_id` anywhere.** These are the same endpoints `BillingPage.jsx` uses for the current org. So a page titled "Billing Administration", reached from the platform admin link, can only change the plan of and raise invoices against **the org the operator is logged into**.

The single exception is `/v1/subscription/admin/invoices/overdue`, which does return `inv.org_name` across orgs. So the overdue list is cross-org while every action beside it is not — and the "Record Payment" button next to another org's overdue invoice posts to an endpoint with no org context. That combination is worse than either alone: it looks like a cross-org console and behaves like a single-tenant one.

Every platform endpoint needs an explicit org: `/v1/admin/orgs/:orgId/…`. Until then the console cannot do the job its navigation promises.

---

## A correction to my earlier note on pricing

I previously told you the plans have a negotiated per-org price and had the landing page show "On quote". `AdminBillingPage.jsx` shows the catalogue does carry list prices:

```js
options={plans.map(p => ({ value: p.code, label: `${p.name} — ₹${p.price_monthly}/mo` }))}
₹{m.price_per_user_monthly}/user/mo
```

So there is a `price_monthly` per plan **and** a `price_per_user_monthly` per module, alongside the per-org price field in `AdminOrgsPage.jsx`. The most likely arrangement is a list price with a per-org override — but I have not confirmed which one billing actually charges against. **Verify before the landing page goes public**; if `price_monthly` is real and current, the landing page should show those figures rather than "On quote".

Also: the Modules tab tells the user to *"Upgrade to Professional or higher"*. **Corrected on checking the live catalogue** — a Professional plan does exist, as `code: 'professional'` with `is_active: false`. So the string points at a *retired* tier rather than a missing one, which is a worse failure than stale copy: the upgrade path it names cannot be bought, and nothing on screen says so. `staging.plans` holds seven rows in two generations (`free`/`professional`/`business`/`enterprise`, then `starter`/`growth`/`scale`), and `price_monthly` carries two incompatible unit conventions across them. **Any surface that renders a plan must filter on `is_active`.**

### Seats are entered by hand, and now enforced

`organisations.max_users` is the governing seat allowance; `plans.max_users` is only a fallback default and is null on every paid tier. It is set per org, manually, by Aekam at org creation — and it is now *enforced* rather than decorative. Two consequences for this surface:

- **The org create/edit screen must make the figure deliberate, not skippable.** A forty-worker client needs the allowance set to match, or worker forty-one cannot be created. The field carries the note that attendance users count against it.
- **The seat-limit error must name both the limit and the remedy.** An HR admin who hits the ceiling while adding an employee reads a bare failure as a bug in attendance, not as a commercial limit. The switcher in `01-navigation.md` shows the seat count per org for the same reason — the ceiling should be visible before it is hit.

---

## Other defects

**GST is hardcoded to 18% flat, with a single `gst` column.** The form says "GST (18%) will be calculated automatically". For an Indian tax invoice the *rate* may be 18% but the *breakdown* is not one number — inter-state is IGST 18%, intra-state is CGST 9% + SGST 9%, and the invoice must show whichever applies as separate lines. A single `gst` column cannot represent a compliant intra-state invoice. Resolve from the org's billing state (`lib/gst.js`, `13-module-pages.md`).

**`line_items` is already an array; the form builds one.** `line_items: [{description, amount}]` — the API supports multi-line invoices today and the UI exposes a single description and a single amount.

**Recording a payment has no date and no amount.** Only `payment_method` and `payment_reference`. So a payment received last Tuesday is recorded as today, and a partial payment is impossible — the invoice flips fully paid or stays pending.

**Four primitives redefined locally.** `Card`, `Badge`, `Input`, `Select`, `Btn` are declared in this file, and `Card` + `Badge` are byte-identical copies of the ones in `BillingPage.jsx`. Use `ui/*`.

**An eighth status-colour map**, the `${c}18` alpha hack again, `#ef4444` and `#f59e0b` inline, `⚠` in a card title, and another token dialect (`--surface-1`, `--surface-2`, `--ink-1`, `--k-primary-ghost`).

**Module activation exists in two places** — here and in org settings tab 4 (`10-org-settings.md`). Decide which owns it; two paths to the same toggle will drift.

---

## 1 · The surface must look different

```css
[data-surface="platform"]{--primary:#6B4FBF;--primary-vivid:#7C5CBF;--primary-container:#EDE7FA;--on-primary-container:#2E2153}
[data-theme="dark"][data-surface="platform"]{--primary:#C0A9F5;--primary-vivid:#A98BEF;--primary-container:#2E2153;--on-primary-container:#EDE7FA}
.adm__bar{box-shadow:inset 0 3px 0 #7c5cbf}
```

An operator holding two tabs open — their own org and a customer's — must never be unsure which one they are typing into. The violet is not decoration; it is the answer to "whose data is this".

### Admin sidebar

```css
.adm__side{width:238px;flex-shrink:0;background:rgb(var(--side-ink));display:flex;flex-direction:column;border-right:1px solid var(--side-rule)}
.adm__back{display:flex;align-items:center;gap:7px;padding:13px 16px;font-size:11.5px;color:var(--side-fg-mute);border-bottom:1px solid var(--side-rule)}
.adm__back:hover{color:#fff}
.adm__badge{display:flex;align-items:center;gap:9px;margin:13px;padding:10px 12px;border-radius:var(--r-sm);background:color-mix(in srgb,#7c5cbf 20%,transparent);box-shadow:inset 3px 0 0 #7c5cbf}
.adm__badge b{font-size:12px;color:#fff}
.adm__badge i{font-style:normal;font-size:10.5px;color:var(--side-fg-mute)}
.adm__pulse{width:7px;height:7px;border-radius:50%;background:#C0A9F5;flex-shrink:0;animation:admP 2.4s var(--ease-standard) infinite}
@keyframes admP{0%,100%{opacity:1}50%{opacity:.4}}
.adm__nav{flex:1;overflow-y:auto;padding:4px 9px}
.adm__i{display:flex;align-items:center;gap:10px;width:100%;padding:8px 11px;border-radius:var(--r-sm);color:var(--side-fg);font-size:13px;position:relative}
.adm__i:hover{background:var(--side-hover)}
.adm__i.on{background:color-mix(in srgb,#7c5cbf 28%,transparent);color:#fff;font-weight:600}
.adm__i.on::before{content:'';position:absolute;left:0;top:7px;bottom:7px;width:3px;border-radius:0 2px 2px 0;background:#C0A9F5}
.adm__n{margin-left:auto;font-family:var(--font-mono);font-size:10.5px;padding:1px 6px;border-radius:var(--r-pill);background:color-mix(in srgb,#7c5cbf 34%,transparent)}
```

**`← Back to Kartavaya` is the first row**, above the badge and the nav. Admin mode is a place you can always leave in one click.

### Mobile — the replacement, not just the hide

```css
@media(max-width:1023px){
  .adm__side{position:fixed;inset:0 auto 0 0;z-index:70;transform:translateX(-100%);transition:transform var(--dur-base) var(--ease-emph)}
  .adm__side.open{transform:none;box-shadow:var(--shadow-4)}
  .adm__burger{display:grid}
  .adm__backpill{display:inline-flex}
}
```

The sidebar becomes an overlay drawer with a burger, **and** a second `← App` pill sits in the bar, so leaving admin mode never depends on discovering the drawer. This is the rule from `MOTION-SPEC.md`: never hide a nav by width without shipping its replacement. It was broken three times in this project (`.side`, `.adm__side`, `.ob--m`) before it became a rule.

### Cross-org table

```css
.aot{width:100%;border-collapse:collapse;font-size:12.5px}
.aot th{position:sticky;top:0;z-index:2;padding:9px 11px;text-align:left;font-size:10px;font-weight:700;letter-spacing:.09em;text-transform:uppercase;color:var(--on-surface-3);background:var(--s-low);border-bottom:1px solid var(--outline-variant)}
.aot td{padding:10px 11px;border-bottom:1px solid color-mix(in srgb,var(--outline-variant) 55%,transparent)}
.aot tr:hover{background:var(--s-lowest);cursor:pointer}
.aot__num{text-align:right;font-variant-numeric:tabular-nums;font-family:var(--font-mono)}
.aot__sus{opacity:.6}
.aot__sus td:first-child{box-shadow:inset 3px 0 0 var(--danger)}
```

### Invoice builder

```css
.inb__hd,.inb__r{display:grid;grid-template-columns:minmax(0,1fr) 68px 92px 34px;gap:8px;align-items:center}
.inb__hd{font-size:9.5px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--on-surface-3);padding-bottom:6px}
.inb__r+.inb__r{margin-top:7px}
.inb__sum{margin-top:14px;padding-top:12px;border-top:1px solid var(--outline-variant);display:flex;flex-direction:column;gap:5px;align-items:flex-end;font-size:12.5px}
.inb__sum b{font-family:var(--font-display);font-size:21px;font-weight:400;letter-spacing:-.02em}
.inb__gst{font-size:11px;color:var(--on-surface-3)}
```

The GST rows are rendered from `lib/gst.js` — one IGST line or two CGST/SGST lines, never a generic "GST".

### Margin, and where it may appear

```css
.mgn{display:flex;align-items:baseline;gap:8px}
.mgn__v{font-family:var(--font-display);font-size:21px;letter-spacing:-.02em;font-variant-numeric:tabular-nums}
.mgn__d{font-size:11px;color:var(--on-surface-3);font-family:var(--font-mono)}
```

`.mgn__d` shows the working: USD metered cost, the FX rate used, the org's `markup_pct`, and the INR charged. A margin number with no visible derivation is unauditable, and this is the number the business runs on.

**This class must never render outside `[data-surface="platform"]`.** Enforce it at the serializer: platform cost, margin and markup fields do not belong in any tenant response, export, PDF or support-agent view. A CSS-level or component-level guard is not sufficient — someone will eventually reuse the component.

---

## 2 · Routes and component trees

| Route | Screen |
|---|---|
| `/admin/dashboard` | stats, revenue, org growth, alerts, health, activity |
| `/admin/orgs` | cross-org table: search, filter, sort |
| `/admin/orgs/:orgId` | Overview · Members · Modules · Invoices · Activity |
| `/admin/users` | all users, slide-over detail, platform role assignment |
| `/admin/billing` | revenue header, invoice list + filters, builder, payments, overdue |
| `/admin/costs` | per-model, per-org, margin, trend |
| `/admin/support` | Active · Queue · History |
| `/admin/settings` | defaults, email templates, maintenance, feature flags |

```
AdminShell                               components/layout/AdminShell.jsx
├── AdminSidebar   back · badge · 7 items · operator footer
├── AdminBar       crumb · audited chip · burger · ← App pill
└── <Outlet/>
```

---

## 3 · New files

```
frontend/src/components/layout/AdminShell.jsx
frontend/src/components/layout/AdminSidebar.jsx
frontend/src/pages/admin/AdminDashboardPage.jsx
frontend/src/pages/admin/AdminOrgDetailPage.jsx
frontend/src/pages/admin/AdminUsersPage.jsx
frontend/src/pages/admin/AdminSupportPage.jsx
frontend/src/pages/admin/AdminSystemPage.jsx
frontend/src/components/admin/OrgTable.jsx
frontend/src/components/admin/InvoiceBuilder.jsx
frontend/src/components/admin/PaymentForm.jsx
frontend/src/components/admin/MarginCell.jsx
frontend/src/lib/platformRoles.js        5 roles; only admin + finance see cost
frontend/src/styles/admin.css
```

---

## 4 · Endpoints

| Endpoint | Notes |
|---|---|
| `GET /v1/admin/dashboard` | stats, `revenue[]`, `growth[]`, `alerts[]`, `health` |
| `GET /v1/admin/orgs?q=&status=&sort=` | cross-org list |
| `GET /v1/admin/orgs/:orgId` | detail |
| `POST /v1/admin/orgs/:orgId/plan` | **replaces** `/v1/subscription/admin/set-plan` — needs the org |
| `POST /v1/admin/orgs/:orgId/credits` · `POST …/suspend` · `POST …/impersonate` | audited both sides |
| `GET /v1/admin/users?q=&platform_role=` · `PATCH /v1/admin/users/:id/platform-role` | |
| `GET /v1/admin/invoices?status=` · `POST /v1/admin/invoices` | **must take `org_id`** and full `line_items[]` |
| `POST /v1/admin/invoices/:id/send` | email to the org owner |
| `POST /v1/admin/payments` | `{invoice_id, amount, paid_on, method, reference}` — **amount and date, so partials work** |
| `GET /v1/admin/costs?period=&currency=` | per-model, per-org, margin, `fx_rate`, `markup_pct` |
| `GET/DELETE /v1/admin/support-sessions` | |
| `GET/PATCH /v1/admin/system-settings` | defaults, maintenance, feature flags |

New tables: `platform_feature_flags`, `platform_system_settings`. `platform_support_sessions` already exists per `RBAC-SPEC.md`.

---

## 5 · What changes in existing files

| File | Bytes | Change |
|---|---|---|
| `pages/AdminBillingPage.jsx` | 18,317 | **Re-point every call at `/v1/admin/*` with an explicit org.** Multi-line builder, GST split, payment date + amount, invoice preview, send. Delete the five local primitives. Fix the plan-name copy |
| `pages/AdminOrgsPage.jsx` | 39,894 | Split; table redesign; per-org R2 credentials keep their mandatory verify step |
| `pages/AdminCostDashboardPage.jsx` | 22,074 | Keep period + currency selectors. Add margin with visible FX and markup, per-org profitability, trend |
| `pages/AdminPage.jsx` | 36,495 | Platform half moves to `/admin/*`; project-level user management to `org/TabMembers.jsx`. **Not read in full** |
| `components/layout/Sidebar.jsx` | — | The Admin item switches to `AdminShell` rather than routing inside the app shell |
| `App.jsx` | — | `/admin/*` under `AdminShell`, gated on `platform_role` |
| `lib/api.js` | — | A response interceptor should reject any tenant-scoped response containing cost/margin fields in development — cheap insurance against the leak this file exists to prevent |

### The rule that outranks the rest of this file

**Impersonation is never silent.** It writes to the customer's own audit log with the operator's name and stated reason, it emails the owner, and the violet banner (`08-rbac-screens.md`) stays in their chrome for the session. If a "quiet" or "read-only doesn't count" mode is ever added, this design has been broken, not extended.
