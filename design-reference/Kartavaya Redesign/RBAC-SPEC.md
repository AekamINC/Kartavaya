# RBAC — authoritative role model

**Source:** `PLAN_RBAC.md`, supplied by the product owner. Supersedes `PLAN_ROLES.md` on staging.
Recorded here because `PLAN_RBAC.md` is not committed to `staging` or `main` as of 2026-07-25.

## Structure

Four **independent** tiers. Each is checked separately — **a higher tier does not grant lower-tier access.**

```
Request → JWT auth → Org resolution → Platform role → Module access + role → Project membership → Endpoint logic
```

## Tier 1 — Platform (Aekam internal staff)

| Role | Access |
|---|---|
| `platform_admin` | God mode across all orgs. **Exactly 3 users:** bhoomi@aekaminc.com, sid@aekaminc.com, kevalvshah03@gmail.com |
| `platform_support` | **Zero by default.** Needs org-admin approval granting: time limit (2hr / 24hr / 7 days / until revoked), module scope, access level (**viewer or editor only**). Auto-expires. Full audit trail in `platform_support_sessions`. |
| `account_finance` | Read-only billing, spend analytics, subscriptions across orgs. **No operational data.** |
| `srijan_admin` | AI config, skill templates, model routing, cost tracking only. |

`account_manager` is **removed** — it was a duplicate.

## Tier 2 — Organisation

| Role | Access |
|---|---|
| `org_owner` | One per org. Full management + delete org + transfer ownership. |
| `org_admin` | Full management minus ownership transfer and org deletion. Manages members, module access and module roles. |
| `org_member` | Base membership. Only explicitly granted modules. Every grant carries a role level. |

## Tier 3 — Project

| Role | Access |
|---|---|
| `owner` | Creator. Delete project, manage members, configure columns/views/automations. |
| `admin` | Settings, add/remove members, create views. Cannot delete the project. |
| `member` | Create/edit tasks, log time, upload files, use views. No project settings. |
| `client` | External guest. **Read-only on assigned tasks.** No time logging, no other members' data, no sensitive modules. |

## Tier 4 — Module role (per grant)

`admin` — full CRUD + settings + configuration + reports
`approver` — everything editor can, plus approve/reject workflows
`editor` — create/edit records; no approve, no settings
`viewer` — read-only; view, run reports, export

### Permission matrix — note which modules have NO approver level

| Module | Viewer | Editor | Approver | Admin |
|---|---|---|---|---|
| Kartavya (PM) | View tasks, boards | Create/edit tasks, log time | **—** | Manage views, templates, automations |
| Graha (CRM) | View contacts, deals | Create/edit contacts, deals | Approve deal stages | Manage pipelines, import/export |
| Vikray (Sales) | View orders, invoices | Create orders, draft invoices | Approve quotes, confirm invoices | Manage products, price lists, taxes |
| Vetana (Payroll) ⚠️ | View own payslips | Prepare payroll runs | Approve payroll, release payments | Manage salary structures |
| Ganit (Accounting) ⚠️ | View journal entries | Create entries, reconcile | Approve entries, close periods | Manage chart of accounts |
| Manav (HRMS) ⚠️ | View org chart, own profile | Manage employee records | Approve leave, expenses | Manage policies, departments |
| Prachar (Marketing) | View campaigns | Create campaigns, posts | Approve for publish | Manage channels, budgets |
| Dristi (Analytics) | View dashboards | Create/edit reports | **—** | Manage data sources |
| Srijan (AI) | Use chatbot | Manage KB docs | **—** | Configure models, publish bots |
| eSign | View signed docs | Create/send sign requests | **—** | Manage templates |
| Sanvaad (Messaging) | Read channels | Send messages, create channels | **—** | Manage channel settings |

**Sensitive modules are role-derived, not granted.** *Decided 25 Jul 2026.* Vetana, Ganit and Manav have **no per-member grant row at all**. Access is a function of the org role:

```
SENS_BY_ROLE = { org_owner: 'admin', org_admin: 'admin', manager: 'none', member: 'none', client: 'none' }
```

Enforce this in the resolver, not the UI: a grant row naming a sensitive module is invalid input and must be rejected, so a direct API call cannot do what the locked cell prevents. The matrix renders those rows as one spanning, non-interactive band.

**Default level on a new grant (non-sensitive only):** `admin`.

## Approver and Admin are not a hierarchy

Settled while building the Vetana degradation study (Roles → **role levels**).

- **Approver is depth, Admin is breadth.** Admin manages salary structures and statutory config;
  Approver approves runs and releases payments. **Admin cannot approve a payroll run.**
- Rationale: whoever defines what people are paid must not also be the one who releases the money.
  Enforced server-side, not by hiding a button.
- Same shape in Ganit: Admin owns the chart of accounts, Approver closes periods. A period-close
  eligibility list only ever contains people at Approver or above.
- **Viewer on Vetana is scoped to self**, not to the org. It is the only module where viewer means
  "my own record". The other five rows are not sent to the browser — there is no masked column.

## Denied states — five kinds, one rule each

1. **No access → absent from the sidebar**, never a greyed-out row that advertises what is missing.
2. **Field-level:** send the column as *absent* with a plain reason. Never a `••••` mask — a mask
   confirms the value exists and invites a screenshot.
3. **Locked action:** control stays visible, names the level that would unlock it, offers a request.
4. **Deep link:** name the record, name the level, name a human who can grant it. Logged as denied.
5. **Read-only is not a dead end:** comments, mentions and thread replies stay open at Viewer.

## AI inherits the asker's grants

Srijan answers with the permissions of the person asking, never its own service account. Payroll is
excluded from the assistant's readable sources **for everyone at every level** — some data should not
be summarisable. Configured in Roles → **module rules**.

## Support agent side

The agent's request screen (`request-access`) requires a free-text reason shown verbatim to the
customer, caps the level at Editor, and defaults to the shortest duration. Broad requests are
expected to be declined. The agent holds zero access until approval.

## Support approval flow

Support agent requests access → org admin is notified → approves with time limit + module scope +
access level → access auto-expires → full audit trail in `platform_support_sessions`.

## Client visibility

Project-level access only. No org membership, no module access, no sidebar. Assigned tasks only.
**Internal-only tasks and comments must be flagged** so clients never see internal notes.

---

## Current code state (staging, for reference)

- `frontend/src/pages/OrgSettingsPage.jsx` — member list, add/remove, org role select, and a
  **boolean** module checkbox grid with a `sensitive` flag on ganit/manav/vetana. Needs replacing
  with a level-per-module control.
- `backend/middleware/roles.py` — `require_role` (legacy `users.role`), `require_platform_role`,
  `require_org_role`, `get_user_roles`.
- Live endpoints: `GET|POST /v1/org/members`, `DELETE /v1/org/members/{id}`,
  `PUT /v1/org/members/{id}/role`, `PUT /v1/org/members/{id}/modules`, `GET|PATCH /v1/org/profile`.

### Known gaps this design addresses
- **G1** — `get_org_id()` reads `team_members`, so a project guest resolves to the org owning the
  project and can call every module endpoint. Fix: reject `role='client'` in org resolution.
- **No `internal_only` flag** on tasks or comments (zero matches in the codebase).
- **`role='client'` unenforced inside a project** — `create_task` checks membership, not role.
- ⚠️ `users.member_role` is a free-text **job title** (`"SM Account Manager"`) and must never be
  read as the permission `account_manager`.

### Endpoints this design needs added

| Method | Path | For |
|---|---|---|
| `POST` | `/v1/support/access-requests` | support raises a request |
| `GET` | `/v1/org/access-requests` | org admin queue |
| `POST` | `/v1/org/access-requests/{id}/approve` | modules + level + TTL |
| `POST` | `/v1/org/access-requests/{id}/deny` | with reason |
| `GET` | `/v1/org/support-sessions` | active sessions + expiry countdown |
| `DELETE` | `/v1/org/support-sessions/{id}` | revoke now |
| `GET` | `/v1/org/audit-log` | filterable access, role-change, denied-attempt events |
| `PUT` | `/v1/org/members/{id}/modules` | **new shape:** `{ ganit: 'viewer', graha: 'admin' }` |
| `PATCH` | `/v1/tasks/{id}/visibility` | `internal_only` toggle |
