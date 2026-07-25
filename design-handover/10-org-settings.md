# 10 · Organisation settings hub

Prereq: `00-tokens.md`, `02-common-components.md`, `09-customization.md` (shares `settings.css`). Tab-by-tab behaviour in `SETTINGS-ADMIN-SPEC.md` §B; member grants and roles in `RBAC-SPEC.md`.

Design source: `SetOrg.jsx`, `settings.css`.

Staging source: `pages/OrgSettingsPage.jsx` (20,978 bytes), `pages/BillingPage.jsx` (8,947 bytes).

---

## What's wrong today

### `/v1/subscription/plans` is fetched on every load and never used

```js
const [plans, setPlans] = useState([]);
const [availableModules, setAvailableModules] = useState([]);
…
setPlans(catalog.data.plans || []);
setAvailableModules(catalog.data.modules || []);
```

Neither `plans` nor `availableModules` appears anywhere in the JSX. So the page makes a fourth parallel API call on every mount, stores the result, and renders none of it — **there is no plan comparison and no upgrade path in the product at all**, despite the data being right there. This is the tab-3 gap.

### A sixth status-colour map, with a fragile alpha hack

```js
const STATUS_COLORS = { active: '#10b981', trialing: '#f59e0b', paused: '#6E7B91', cancelled: '#ef4444', … };
background: `${c}18`
```

Hardcoded hexes again, and `${c}18` appends hex alpha by string concatenation — it works only because `c` is always a 6-digit literal. The moment anyone substitutes a token, `var(--ok)18` is an invalid colour and the badge loses its background silently. Use `color-mix(in srgb, var(--ok) 14%, transparent)`.

### A failed credit request deletes the credit section

```js
if (!data) return null;
```

`CreditUsage` fetches `/v1/subscription/cost-report?period=30d`, swallows the error with `.catch(() => {})`, and returns `null`. So when the request fails the entire credit block **vanishes with no message** — a user who was about to check whether they're near their limit sees a page that simply doesn't mention credits. Needs an error state.

### Raw enums and raw ISO dates as display values

`<StatTile label="Status" value={sub?.status || 'active'} />` prints `active` lowercase. `{inv.period_start} → {inv.period_end}` prints `2026-07-01 → 2026-07-31`. Both need formatting; the invoice period should read `Jul 2026`.

### Rupee formatting is right here and wrong elsewhere

`₹{inv.total?.toLocaleString('en-IN')}` is correct — 2,2,3 grouping. Promote it to `lib/inr.js` (`13-module-pages.md`) so it stops being reimplemented per file.

### Missing entirely

Company description, industry, team size, founded year · drag-drop logo upload · module grants on the member rows · plan comparison · module toggles · any security tab · any danger zone.

---

## 1 · Exact CSS

Reuses `.st`, `.sr`, `.seg` from `09-customization.md`. Additions:

### Form grid

```css
.of{display:grid;grid-template-columns:repeat(auto-fit,minmax(232px,1fr));gap:14px}
.of--3{grid-template-columns:repeat(auto-fit,minmax(158px,1fr))}
.of__f{display:flex;flex-direction:column;gap:5px}
.of__l{font-size:11.5px;font-weight:500;color:var(--on-surface-2)}
.of__i{padding:9px 11px;border-radius:var(--r-sm);border:1px solid var(--outline-variant);background:var(--s-lowest);font:inherit;font-size:13px;color:var(--on-surface)}
.of__i:focus{outline:none;border-color:var(--primary);box-shadow:0 0 0 3px color-mix(in srgb,var(--primary) 16%,transparent)}
.of__i--mono{font-family:var(--font-mono);letter-spacing:.02em;text-transform:uppercase}
.of__h{font-size:11px;color:var(--on-surface-3);line-height:1.45}
.of__i[aria-invalid="true"]{border-color:var(--danger)}
```

GSTIN, PAN and IFSC get `.of__i--mono` — they are fixed-format codes, and uppercase monospace both signals that and makes a mistyped character findable. GSTIN is 15 characters, PAN 10, IFSC 11; validate on blur, not per keystroke.

### Logo drop zone

```css
.olg{display:flex;gap:16px;align-items:flex-start;flex-wrap:wrap}
.olg__z{width:172px;height:172px;border-radius:var(--r-md);border:1px dashed var(--outline-variant);background:var(--s-lowest);display:grid;place-items:center;text-align:center;padding:16px;transition:border-color var(--dur-fast),background var(--dur-fast)}
.olg__z.over{border-color:var(--primary);border-style:solid;background:color-mix(in srgb,var(--primary) 8%,transparent)}
.olg__z img{max-width:100%;max-height:100%;object-fit:contain}
.olg__hint{font-size:11.5px;color:var(--on-surface-3);line-height:1.5}
.olg__where{flex:1;min-width:200px;display:flex;flex-direction:column;gap:8px}
.olg__w{display:flex;align-items:center;gap:9px;font-size:12.5px;color:var(--on-surface-2)}
```

`border-style` flips from dashed to solid on dragover as well as the colour change — a colour-only cue is invisible to a colour-blind user mid-drag.

The **"where it appears"** list beside the zone (invoice header, client portal, sign-in page, system emails) with a toggle each. A logo upload with no indication of where the logo lands means the first time anyone sees it at the wrong size is on a customer's invoice.

### Member table

```css
.omt{width:100%;border-collapse:collapse;font-size:13px}
.omt th{padding:9px 12px;text-align:left;font-size:10px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--on-surface-3);border-bottom:1px solid var(--outline-variant)}
.omt td{padding:11px 12px;border-bottom:1px solid color-mix(in srgb,var(--outline-variant) 60%,transparent);vertical-align:middle}
.omt__who{display:flex;align-items:center;gap:10px;min-width:0}
.omt__av{width:32px;height:32px;border-radius:50%;flex-shrink:0;display:grid;place-items:center;font-size:12px;font-weight:700;color:#fff}
.omt__n{font-size:13px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.omt__e{font-size:11.5px;color:var(--on-surface-3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.omt__gr{display:flex;flex-wrap:wrap;gap:4px;max-width:280px}
.omt__more{font-size:10.5px;color:var(--on-surface-3);padding:2px 6px}
```

Grant chips use `LVL[level]` colours from `RBAC-SPEC.md`. Show the first three and `+n` — a member with eleven grants would otherwise make the row 60px tall and push everyone else off screen.

### Module cards

```css
.omod{display:grid;grid-template-columns:repeat(auto-fill,minmax(226px,1fr));gap:11px}
.omod__c{display:flex;flex-direction:column;gap:8px;padding:15px;border-radius:var(--r-md);border:1px solid var(--outline-variant);background:var(--surface)}
.omod__c.off{opacity:.68}
.omod__h{display:flex;align-items:flex-start;gap:10px}
.omod__ic{width:32px;height:32px;border-radius:var(--r-sm);display:grid;place-items:center;background:color-mix(in srgb,var(--c) 14%,transparent);color:var(--c);flex-shrink:0}
.omod__lock{display:inline-flex;align-items:center;gap:4px;font-size:10px;font-weight:700;padding:2px 7px;border-radius:var(--r-pill);background:var(--danger-container);color:var(--danger);letter-spacing:.04em}
```

`opacity: .68` for inactive rather than a grey palette swap — the module keeps its identity colour so the grid stays scannable, and the toggle is the state, not the styling.

Sensitive modules (Vetana, Ganit, Manav) carry the lock tag. **Turning a module off must revoke grants without deleting data, and re-enabling must restore the previous grants** — a soft flag on `org_modules`, never a cascade delete. An admin who toggles Vetana off to tidy up and back on ten seconds later must not have destroyed the payroll history.

### Switch

```css
.sw{position:relative;width:38px;height:22px;border-radius:var(--r-pill);background:var(--s-high);flex-shrink:0;transition:background var(--dur-base) var(--ease-standard)}
.sw::after{content:'';position:absolute;top:3px;left:3px;width:16px;height:16px;border-radius:50%;background:#fff;box-shadow:var(--shadow-1);transition:transform var(--dur-base) var(--ease-spring)}
.sw.on{background:var(--primary)}
.sw.on::after{transform:translateX(16px)}
```

### Plan comparison

```css
.opl{display:grid;grid-template-columns:repeat(auto-fit,minmax(196px,1fr));gap:12px}
.opl__c{display:flex;flex-direction:column;gap:13px;padding:19px;border-radius:var(--r-md);border:1px solid var(--outline-variant);background:var(--surface)}
.opl__c.cur{border-color:var(--primary);box-shadow:0 0 0 1px var(--primary)}
.opl__cur{font-size:9.5px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--primary)}
.opl__n{font-size:15px;font-weight:600;text-transform:capitalize}
.opl__cr{font-family:var(--font-display);font-size:29px;font-weight:400;letter-spacing:-.03em;font-variant-numeric:tabular-nums}
.opl__u{font-size:11.5px;color:var(--on-surface-3)}
```

The four real plans — **free 200, starter 500, growth 1,000, scale 2,000 credits/month**. Price is per-org negotiated, so the card shows **credits** as the headline number and "On quote" for price. Inventing a monthly figure here would contradict the actual billing model (`11-platform-admin.md`).

### Danger zone

```css
.odz{padding:19px;border-radius:var(--r-md);border:1px solid color-mix(in srgb,var(--danger) 30%,transparent);background:color-mix(in srgb,var(--danger) 5%,transparent)}
.odz__t{font-size:14px;font-weight:600;color:var(--danger);margin-bottom:6px}
.odz__i{padding:9px 11px;border-radius:var(--r-sm);border:1px solid var(--outline-variant);background:var(--surface);font-family:var(--font-mono);font-size:13px;width:100%;max-width:320px}
```

---

## 2 · Component tree

```
OrgHub                                   pages/OrgSettingsPage.jsx
├── PageHeader
├── Tabs  profile · members · billing · modules · security · danger
├── TabProfile
│   ├── LogoUpload      drop · preview · where-it-appears
│   ├── CompanyFields   name, description, industry, team size, founded
│   ├── TaxFields       GSTIN, PAN (mono, validated on blur)
│   ├── AddressFields · BankFields  (IFSC mono)
│   └── InvoiceNote
├── TabMembers
│   ├── MemberTable → GrantChips · RoleBadge · RowMenu
│   ├── InviteFlow      (08-rbac-screens.md)
│   └── EditMemberSheet role + module grants
├── TabBilling
│   ├── SubscriptionCard · CreditUsage (with an error state)
│   ├── PlanComparison  ← the dead `plans` state, finally rendered
│   └── InvoiceTable    formatted period, GST column, download
├── TabModules          ModuleCard grid, sensitive locks
├── TabSecurity         2FA allow/enforce · idle timeout · IP ranges · password policy
└── TabDanger           TransferOwnership · DeleteOrg
```

---

## 3 · New files

```
frontend/src/pages/org/TabProfile.jsx
frontend/src/pages/org/TabMembers.jsx
frontend/src/pages/org/TabBilling.jsx
frontend/src/pages/org/TabModules.jsx
frontend/src/pages/org/TabSecurity.jsx
frontend/src/pages/org/TabDanger.jsx
frontend/src/components/org/LogoUpload.jsx
frontend/src/components/org/MemberTable.jsx
frontend/src/components/org/GrantChips.jsx
frontend/src/components/org/ModuleCard.jsx
frontend/src/components/org/PlanComparison.jsx
frontend/src/lib/inr.js                  shared with 13-module-pages
frontend/src/lib/validators.js           GSTIN 15 · PAN 10 · IFSC 11
```

---

## 4 · Endpoints

Existing: `GET/PATCH /v1/org/profile` · `GET /v1/subscription/current|invoices|usage|plans` · `GET /v1/subscription/cost-report` · `GET /v1/subscription/cost-report/pdf`.

| Endpoint | Change |
|---|---|
| `PATCH /v1/org/profile` | add `description`, `industry`, `team_size`, `founded_year` |
| `POST /v1/org/logo` | **new** — multipart; returns `logo_url`; PNG/SVG, ≥512px |
| `GET/PATCH /v1/org/modules` | **new** — `{code, active}[]`; **soft flag, grants preserved** |
| `GET/PATCH /v1/org/security` | **new** — `tfa_allowed`, `tfa_enforced`, `idle_timeout`, `ip_ranges[]`, `password_policy` |
| `POST /v1/org/transfer-ownership` | **new** — `{to_user_id, password, totp}`; target must already be `org_admin` |
| `POST /v1/org/delete` | **new** — queues with a 7-day window |
| `POST /v1/subscription/change-plan` | **new** — the upgrade path the dead `plans` state was for |

New tables: `org_security`, `org_modules`.

---

## 5 · What changes in existing files

| File | Bytes | Change |
|---|---|---|
| `pages/OrgSettingsPage.jsx` | 20,978 | Becomes the tab shell; profile + members move into `org/*` |
| `pages/BillingPage.jsx` | 8,947 | Folded in as `org/TabBilling.jsx`; route redirects to `/settings/org?tab=billing`. Render `plans`. Fix `STATUS_COLORS`, `${c}18`, the `return null` on error, the raw enum and raw ISO dates |
| `components/editorial.jsx` | — | `StatTile` needs a formatter prop, or callers must format before passing — it currently prints whatever it is handed |
| `components/ui/toast.jsx` | 3,553 | `pushToast` is used correctly here; keep as the reference call site |
| `lib/api.js` | — | `/v1/subscription/plans` is currently fetched and discarded — once rendered this becomes a real dependency, so cache it |

### Two things to settle

**2FA enforce needs a lockout count before it is switchable.** Turning on "require 2FA for all members" when 6 of 14 members have no authenticator locks out 6 people immediately. The control must state the number and be disabled until it is knowable — otherwise the first use of this feature is an outage.

**IP whitelisting must validate against the admin's own address.** Saving a range that excludes the browser you are saving from locks the org out of its own settings with no path back except support. Check before save, and refuse.
