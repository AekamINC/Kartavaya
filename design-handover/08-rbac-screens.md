# 08 · RBAC screens

Prereq: `00-tokens.md`, `02-common-components.md`. Roles, levels, the grant matrix, degradation rules and the support-access flow are all in `RBAC-SPEC.md` — this file is CSS, trees, endpoints and diffs only.

Design source: `ScreensRBAC.jsx`, `ScreensRBAC2.jsx`.

Staging source: `pages/ApprovalsPage.jsx` (19,827 bytes), `pages/ClientPagesImpl.jsx` (36,808 bytes), `pages/AdminPage.jsx` (36,495 bytes), `lib/auth.js`.

---

## What the staging approvals flow already gets right

Worth saying, because most of this file is corrections: the approve-with-client-forward flow is real and works. `openApproveFlow` branches on approval type, loads `/teams/:id/clients`, and offers "Approve & Send to Client" or "Approve & Mark Done" with an honest empty state ("No clients added to this project yet"). Reject is gated on a reason with `disabled={!rejectNote.trim()}`. Client and admin views diverge from one `isClient` check. The state machine in `RBAC-SPEC.md` matches what's implemented.

---

## What's broken

### `var(--k-danger)` and `var(--danger)` in the same file

```jsx
<button … style={{ color: 'var(--danger)' }}>✕ Reject</button>              {/* row action */}
<button … style={{ color: 'var(--k-danger)', borderColor: 'var(--k-danger)' }}>✕ Confirm Reject</button>
```

Two names for one colour, 200 lines apart in `ApprovalsPage.jsx`. One of them is undefined, so **one of those two buttons is not red** — and which one depends on which stylesheet won. This is the clearest single illustration of the token problem catalogued in `00-tokens.md`.

### Two hand-rolled modals in a file that could import the real one

```jsx
<div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', … zIndex: 9999 }}>
```

`components/ui/modal.jsx` exists (`02-common-components.md`). These two don't use it, so neither the approve nor the reject dialog has a focus trap, an Escape handler, scroll lock, or `role="dialog"`. A keyboard user can Tab out of the reject dialog into the page behind it and approve something by accident.

### A seventh status-colour map

`'--c': '#f59e0b'` for pending, `'#05b7aa'` for approved, `'#C0392B'` for rejected — hardcoded, and `#05b7aa` is the legacy teal, not the current `--ok`.

### "Approved today" is computed from a truncated list

```js
const approved = history.filter(h => h.status === 'approved' && new Date(h.updated_at) >= today).length;
```

`history` is whatever `/approvals/history` returned — no date filter, no pagination contract. If the endpoint caps at 50 rows and someone approved 60 things today, the tile under-reports. A headline count must come from a count endpoint, not from `.filter()` over a page of rows.

### Clients can decline with a reason but not approve with a comment

`clientDecideTask(r.approval_id, 'approved')` passes no notes; reject opens a modal that requires one. A client approving a deliverable often wants to say "fine, but fix the logo size next time" — and there is nowhere to put it.

### `approval_id` is a composite string used as a type tag

```js
if (approvalId.startsWith('task_approval--')) …
const taskId = approvalId.replace('task_approval--', '');
```

Type dispatch by string prefix, and the task id recovered by string surgery. Add a real `type` field and a real `task_id` field.

### `request_data` is sometimes a JSON string

```js
const data = typeof r.request_data === 'string' ? JSON.parse(r.request_data) : (r.request_data || {});
```

Same double-serialization defence as Sanvaad's reactions (`06-sanvaad-varta.md`). Systemic — the backend returns JSONB inconsistently across endpoints, and every consumer pays for it.

### `PageHeader`'s fourth prop signature

`kicker` + `title` + `sanskrit` + `lede` + `right` here; `sanskrit` + `lede` in `CustomizeSettingsPage`; `sans` + `subtitle` in `SanvaadPage`; `subtitle` alone in `BillingPage`. Two files agree on `sanskrit`/`lede`, so `SanvaadPage`'s `sans`/`subtitle` is the likely casualty. Verify against `editorial.jsx` and fix the odd ones out.

---

## 1 · Exact CSS

### Role badge

```css
.rb{display:inline-flex;align-items:center;gap:5px;padding:2px 9px;border-radius:var(--r-pill);font-size:11px;font-weight:600;white-space:nowrap;background:color-mix(in srgb,var(--c) 14%,transparent);color:var(--c)}
.rb__dot{width:5px;height:5px;border-radius:50%;background:var(--c);flex-shrink:0}
```

`--c` per role from `lib/roles.js`. Owner and admin must be distinguishable at a glance in a member list — those are the two rows an auditor looks for.

### Grant chip

```css
.gc{display:inline-flex;align-items:baseline;gap:5px;padding:2px 8px;border-radius:var(--r-sm);font-size:11px;background:color-mix(in srgb,var(--c) 12%,transparent);color:var(--c);white-space:nowrap}
.gc__m{font-weight:600}
.gc__l{font-size:10px;opacity:.8;text-transform:lowercase}
```

Reads `Ganit · admin` — module then level, one chip. Levels take the colour, not the module, because the level is the thing that matters when you're scanning for who can do what.

### Access matrix

```css
.amx{border:1px solid var(--outline-variant);border-radius:var(--r-md);overflow:auto}
.amx table{border-collapse:separate;border-spacing:0;min-width:720px;font-size:12.5px}
.amx th{position:sticky;top:0;z-index:2;background:var(--s-low);padding:9px 11px;text-align:left;font-size:10px;font-weight:700;letter-spacing:.09em;text-transform:uppercase;color:var(--on-surface-3);border-bottom:1px solid var(--outline-variant)}
.amx th:first-child,.amx td:first-child{position:sticky;left:0;z-index:1;background:var(--surface);border-right:1px solid var(--outline-variant);min-width:168px}
.amx th:first-child{z-index:3}
.amx td{padding:7px 11px;border-bottom:1px solid color-mix(in srgb,var(--outline-variant) 55%,transparent)}
.amx__cell{width:100%;padding:4px 7px;border-radius:var(--r-sm);font-size:11px;text-align:center;background:var(--s-container);color:var(--on-surface-3)}
.amx__cell.set{background:color-mix(in srgb,var(--c) 14%,transparent);color:var(--c);font-weight:600}
```

Both axes sticky, with `z-index` 3 on the corner so it stays above both. A grant matrix is 15 modules × N members; without a frozen first column you lose track of whose row you're in after the third scroll.

### Denied state

```css
.dny{display:flex;gap:13px;padding:17px 19px;border-radius:var(--r-md);background:var(--s-container);max-width:62ch}
.dny__ic{color:var(--on-surface-3);flex-shrink:0;margin-top:1px}
.dny__t{font-size:14px;font-weight:600;margin-bottom:5px}
.dny__p{font-size:13px;line-height:1.6;color:var(--on-surface-2);margin:0;text-wrap:pretty}
.dny__who{margin-top:11px;font-size:12px;color:var(--on-surface-3)}
```

**Neutral, never red.** No `--danger`, no warning triangle. A member without a Ganit grant is not in an error state — they're in a normal state that happens to be limited. Red teaches them something is broken and generates a support ticket. Name who can grant access, and offer the request button.

### Support-access banner

```css
.sab{display:flex;align-items:center;gap:11px;padding:9px 18px;background:color-mix(in srgb,#7c5cbf 16%,transparent);border-bottom:1px solid color-mix(in srgb,#7c5cbf 34%,transparent);font-size:12.5px}
.sab__dot{width:7px;height:7px;border-radius:50%;background:#7c5cbf;flex-shrink:0;animation:sabP 2s var(--ease-standard) infinite}
@keyframes sabP{0%,100%{opacity:1}50%{opacity:.35}}
.sab__t{font-variant-numeric:tabular-nums;font-family:var(--font-mono);font-size:12px}
```

Violet, because that is the platform-surface colour (`11-platform-admin.md`) — a customer seeing violet chrome in their own workspace is being told, correctly, that someone from outside is in here. Persistent for the whole session, with a live countdown and a revoke button. Never dismissible.

---

## 2 · Component trees

```
ApprovalsPage                            pages/ApprovalsPage.jsx
├── PageHeader (settle props) · StatTiles (from a count endpoint)
├── Seg  Task requests · Work approvals
├── ApprovalRow → PriorityDot · DueChip · RoleBadge
├── ApproveDialog   ← ui/modal.jsx, notes + client forward
├── RejectDialog    ← ui/modal.jsx, reason required
└── TaskDrawer

MemberAccess                             components/rbac/
├── MemberTable → RoleBadge · GrantChips
├── EditGrantsSheet → AccessMatrix
└── InviteFlow  email · role · grants · preview

Denied / degraded                        components/rbac/
├── DeniedPanel      neutral, names the granter
├── RequestAccess    → request row in the granter's approvals
└── SupportBanner    violet, countdown, revoke
```

---

## 3 · New files

```
frontend/src/lib/roles.js                 role → label, colour, rank
frontend/src/lib/grants.js                can(module, level) — one predicate, used everywhere
frontend/src/components/rbac/RoleBadge.jsx
frontend/src/components/rbac/GrantChips.jsx
frontend/src/components/rbac/AccessMatrix.jsx
frontend/src/components/rbac/DeniedPanel.jsx
frontend/src/components/rbac/RequestAccess.jsx
frontend/src/components/rbac/SupportBanner.jsx
frontend/src/components/rbac/InviteFlow.jsx
frontend/src/components/rbac/EditGrantsSheet.jsx
frontend/src/styles/rbac.css
```

`lib/grants.js` matters more than the rest combined: **one** `can()` predicate, imported everywhere. Fifteen modules × five levels reimplemented per page is how a payroll figure ends up visible to someone who shouldn't see it.

---

## 4 · Endpoints

Existing: `GET /approvals/pending` · `GET /approvals/history` · `POST /approvals/:id/review` · `GET /client/approvals` · `POST /tasks/:id/client-approve|client-reject` · `GET /teams/:id/clients`.

| Endpoint | Change |
|---|---|
| `GET /approvals/counts` | **new** — `{pending, approved_today, rejected_today}`, so the tiles stop counting a truncated page |
| `GET /approvals/pending` | add a real `type` field and `task_id`; stop encoding both into `approval_id` |
| `POST /tasks/:id/client-approve` | accept `notes` — clients should be able to approve *with* a comment |
| `GET /v1/org/members` | include `grants[]` as `{module, level}` for the chips |
| `PATCH /v1/org/members/:id/grants` | **new** — set grants; audited |
| `POST /v1/org/invites` | **new** — email + role + initial grants |
| `POST /v1/access-requests` | **new** — a member asking for a module |
| `GET/POST/DELETE /v1/support-sessions` | **new** — request, approve, revoke; see `11-platform-admin.md` |

All grant and role changes write to the org's own audit log, including changes made by platform support.

---

## 5 · What changes in existing files

| File | Bytes | Change |
|---|---|---|
| `pages/ApprovalsPage.jsx` | 19,827 | Replace both hand-rolled modals with `ui/modal.jsx`. Fix `--k-danger`/`--danger`. Status hexes → tokens. Counts from `/approvals/counts`. `✓`/`✕` glyphs → `navIcons.jsx`. Client approve gets a notes field |
| `pages/ClientPagesImpl.jsx` | 36,808 | Split (three 130-byte route stubs already re-export from it). Client portal gets `DeniedPanel` for anything outside its grant, and must never render internal-only fields |
| `pages/AdminPage.jsx` | 36,495 | Project-level user management moves into `org/TabMembers.jsx` (`10-org-settings.md`); the platform half moves to `/admin/*` (`11-platform-admin.md`). **Not read in full** — expect surprises |
| `lib/auth.js` | — | `currentUser()` stays, but `role === 'client'` checks scatter through pages; route them through `lib/grants.js` |
| `components/editorial.jsx` | — | Settle `PageHeader`. `StatTile` already takes `variant` + `sanskrit`; keep both |
| `components/ui/EmptyState.jsx` | — | Keep. `illustration="success"` + `{en, hi}` title shape is good and should be the pattern elsewhere |

### One rule worth restating

**Support access is never silent.** It appears in the customer's own audit log with the operator's name and stated reason, it emails the owner, and the violet banner sits in the chrome for the whole session. There is no quiet mode, no "read-only so it doesn't count", and no config flag to suppress the banner. If that is ever built, this design has been broken rather than extended.
