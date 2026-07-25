# RBAC Plan — Kartavya कर्तव्य

## Overview

Four independent tiers of access control. A user can hold one role at each tier simultaneously. Higher tiers don't automatically grant lower-tier access — each is checked independently.

```
Request → JWT Auth → Org Resolution → Platform Role → Module Access + Role → Project Membership → Endpoint Logic
```

---

## Tier 1 — Platform (Aekam internal staff)

| Role | Who | Access |
|------|-----|--------|
| `platform_admin` | bhoomi@aekaminc.com, sid@aekaminc.com, kevalvshah03@gmail.com | Full god-mode across all orgs, all modules. No approval needed. |
| `platform_support` | Other Aekam staff | Zero access by default. Must request org admin approval. Time-limited, module-scoped, fully audited. |
| `account_finance` | Aekam finance team | Read-only billing, spend analytics, subscription data across orgs. No operational data. |
| `srijan_admin` | AI/Srijan team | Manage AI config, skill templates, model routing, cost tracking. No other module access. |

> **God-mode is limited to exactly 3 people.** The `account_manager` role is removed — it was a duplicate of `platform_admin`. All other Aekam staff use `platform_support` with the approval flow.

### Support approval flow

`platform_support` agents have zero org access by default:

1. Support agent requests access to a specific org
2. Org admin receives notification (in-app + email)
3. Org admin approves with:
   - Time limit (2 hours / 24 hours / 7 days / until revoked)
   - Module scope (e.g. only Kartavya + Graha, or all modules)
   - Access level (`viewer` or `editor`)
4. Support agent gets temporary access — scoped to approved modules only
5. Access auto-expires at the time limit
6. Full audit trail: what was accessed, when, by whom

**Table: `platform_support_sessions`**

| Column | Type | Purpose |
|--------|------|---------|
| `id` | UUID | Primary key |
| `org_id` | UUID | Which org granted access |
| `user_id` | TEXT | Which support agent |
| `modules` | TEXT[] | Which modules they can see (`{*}` for all) |
| `access_level` | TEXT | `viewer` or `editor` |
| `granted_by` | TEXT | Org admin user_id who approved |
| `requested_at` | TIMESTAMPTZ | When access was requested |
| `granted_at` | TIMESTAMPTZ | When org admin approved |
| `expires_at` | TIMESTAMPTZ | Auto-revoke time |
| `revoked_at` | TIMESTAMPTZ | NULL unless manually revoked early |

---

## Tier 2 — Organisation (customer company)

| Role | Access |
|------|--------|
| `org_owner` | Full org management. Can delete org, transfer ownership, manage billing, add/remove modules, manage all members. One per org. |
| `org_admin` | Full org management minus ownership transfer and org deletion. Can add/remove members, assign module access + module roles, create projects, manage org settings. |
| `org_member` | Base org membership. Can only access modules explicitly granted. Each module grant comes with a role level. |

---

## Tier 3 — Project (within a module)

| Role | Access |
|------|--------|
| `owner` | Project creator. Can delete project, manage members, configure columns/views/automations. |
| `admin` | Manage project settings, add/remove members, create views, manage templates. Cannot delete project. |
| `member` | Create/edit tasks, log time, upload files, use views. Cannot change project settings or manage members. |
| `client` | External guest. Read-only on assigned tasks. Cannot log time, cannot see other members' data, cannot access sensitive modules. |

---

## Tier 4 — Module role (per module grant)

Each user's module access includes a role level. Stored in `org_member_modules.role`.

| Role | Access |
|------|--------|
| `admin` | Full CRUD + settings + configuration + reports |
| `approver` | Everything an editor can do + approve/reject workflows (expense claims, leave requests, purchase orders, invoices, payroll) |
| `editor` | Create and edit records. Cannot approve, cannot change module settings. |
| `viewer` | Read-only. View records, run reports, export data. Cannot create, edit, or delete. |

### Module permission matrix

| Module | Viewer | Editor | Approver | Admin |
|--------|--------|--------|----------|-------|
| **Kartavya (PM)** | View tasks, boards | Create/edit tasks, log time | — | Manage views, templates, automations |
| **Graha (CRM)** | View contacts, deals | Create/edit contacts, deals | Approve deal stages | Manage pipelines, import/export |
| **Vikray (Sales)** | View orders, invoices | Create orders, draft invoices | Approve quotes, confirm invoices | Manage products, price lists, taxes |
| **⚠️ Vetana (Payroll)** | View own payslips | Prepare payroll runs | Approve payroll, release payments | Manage salary structures, components |
| **⚠️ Ganit (Accounting)** | View journal entries, reports | Create entries, reconcile | Approve entries, close periods | Manage chart of accounts, fiscal years |
| **⚠️ Manav (HRMS)** | View org chart, own profile | Manage employee records | Approve leave, expenses, claims | Manage policies, departments, assets |
| **Prachar (Marketing)** | View campaigns, analytics | Create campaigns, posts | Approve campaigns for publish | Manage channels, budgets, templates |
| **Dristi (Analytics)** | View dashboards | Create/edit custom reports | — | Manage data sources, shared dashboards |
| **Srijan (AI)** | Use chatbot | Manage KB documents, FAQs | — | Configure models, publish bots |
| **eSign** | View signed documents | Create/send sign requests | — | Manage templates, signatories |
| **Sanvaad (Messaging)** | Read channels | Send messages, create channels | — | Manage channel settings, integrations |

> ⚠️ **Sensitive modules** (Vetana, Ganit, Manav) default new grants to `viewer`. All other modules default to `admin`.

---

## DB changes required

### 1. Add `role` column to `org_member_modules`

```sql
ALTER TABLE staging.org_member_modules
ADD COLUMN role TEXT NOT NULL DEFAULT 'admin'
CHECK (role IN ('viewer', 'editor', 'approver', 'admin'));
```

Additive — existing rows get `admin`, no breaking change.

### 2. Create `platform_support_sessions` table

See schema above.

### 3. Update `user_roles` CHECK constraint

```sql
-- Remove account_manager, add platform_support
ALTER TABLE staging.user_roles
DROP CONSTRAINT user_roles_role_code_check,
ADD CONSTRAINT user_roles_role_code_check
CHECK (role_code IN ('platform_admin', 'platform_support', 'account_finance', 'srijan_admin', 'org_owner', 'org_admin', 'org_member'));
```

### 4. Update `require_module()` middleware

Return the module role level instead of just pass/fail. Each router checks the level:

```python
module_role = await require_module("ganit")  # returns "viewer" | "editor" | "approver" | "admin"
if module_role == "viewer":
    raise HTTPException(403, "Read-only access to this module")
```

### 5. Migrate existing `account_manager` rows

```sql
-- Demote existing account_managers to platform_support
UPDATE staging.user_roles
SET role_code = 'platform_support'
WHERE role_code = 'account_manager'
AND user_id NOT IN (
    SELECT user_id FROM staging.users
    WHERE email IN ('bhoomi@aekaminc.com', 'sid@aekaminc.com', 'kevalvshah03@gmail.com')
);
```

---

## Real-world scenarios

### New employee joins ABC Corp
1. Org admin adds Rahul as `org_member`
2. Grants: Kartavya (`editor`), Ganit (`viewer`), Manav (`viewer`)
3. Assigns to "Q3 Launch" project as `member`
4. **Can:** create tasks, view accounting reports, view own HR profile
5. **Cannot:** approve payroll, create journal entries, manage project settings, access CRM

### Finance manager
1. Already `org_member`
2. Grants: Ganit (`admin`), Vetana (`approver`), Vikray (`viewer`)
3. **Can:** manage chart of accounts, approve payroll runs, view sales invoices
4. **Cannot:** create sales orders, edit HR records, access CRM

### External client
1. Added to "Q3 Launch" project as `client`
2. No org membership needed — project role is sufficient
3. **Can:** view assigned tasks, add comments
4. **Cannot:** log time, see other members' tasks, access any module

### Aekam support agent
1. Has `platform_support` role — zero access by default
2. Requests access to ABC Corp for troubleshooting
3. Org admin approves: 24 hours, Kartavya + Graha only, viewer
4. **Can:** view tasks and CRM data for that org for 24 hours
5. **Cannot:** see payroll, accounting, HR — even with platform role

---

## Implementation order

1. **Commit RBAC security fixes** (staging, code-only, no DB) — remove `users.role == "admin"` god-mode
2. **Merge staging → main**
3. **Migration: add `role` column** to `org_member_modules` (additive, forward-compatible)
4. **Migration: create `platform_support_sessions`** table
5. **Update `require_module()`** to return role level
6. **Update routers** to check module role level on write operations
7. **Build support approval UI** (org admin notification + approval flow)
8. **Migrate `account_manager` → `platform_support`**
9. **Frontend: module role picker** in org member management UI
