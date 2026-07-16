# Kartavya · Role Model & Client Collaboration

**Session:** 2026-07-16
**Branch:** staging
**Status:** Spec — not yet implemented. Depends on the tenancy fixes in the org study (G1, `org_members`, `X-Org-Id`).
**Related:** artifact `org-tenancy-study`, `architecture_tenancy` memory, `PLAN_ALL_IN_ONE.md`

---

## 1. How client collaboration works TODAY (verified in code + live DB)

This is the honest current state, since you asked.

### The grant
A client is added to a project through **`project_assignments`** (primary) or **`team_members`** (fallback), with `role='client'`. There is no other mechanism. `is_project_member()` (`server.py:230`) checks `project_assignments` first, then falls back to `team_members`.

### What a client can reach
`GET /client/projects` (`server.py:647`) returns **only** projects they are assigned to:
```sql
SELECT t.* FROM teams t
JOIN project_assignments pa ON pa.team_id = t.team_id
WHERE pa.user_id = $1
```
**This is correctly scoped.** A client cannot list projects they were not added to. Your rule — "only if invited to that project" — holds at the project-list level.

From `ClientPagesImpl.jsx`, an invited client can:

| Action | Endpoint | Allowed? |
|---|---|---|
| List their projects | `GET /client/projects` | ✅ only assigned ones |
| Open a project board | `GET /teams/{id}`, `GET /projects/{id}/columns` | ✅ |
| See tasks | `GET /tasks?team_id=` | ⚠️ **all tasks in the project** |
| See project members | `GET /teams/{id}/members` | ✅ |
| **Create tasks** | `POST /tasks` | ✅ — `if not mem: 403` only checks membership, not role |
| **Delete tasks** | `DELETE /tasks/{id}` | ✅ |
| Comment | `POST /tasks/{id}/comments` | ✅ |
| Upload / delete attachments | `POST|DELETE /tasks/{id}/attachments` | ✅ |
| See approvals | `GET /client/approvals` | ✅ scoped to assigned projects |
| Manage columns | `POST/PUT/DELETE /projects/{id}/columns` | ❌ owner/admin only |

### The two real gaps

**Gap 1 — a client sees everything inside the project.**
There is **no** `visible_to_client` / `internal_only` flag anywhere in the codebase (grep: zero matches). Once invited, a client sees *every* task and *every* comment on that board — including internal delivery chatter, cost notes, and anything your team said assuming privacy. Collaboration is all-or-nothing per project.

**Gap 2 — `role='client'` is not enforced inside a project.**
`create_task` only checks `if not mem: raise 403` — membership, not role. Only **9** places in `server.py` enforce `role not in ("owner","admin")`, and they cover columns and some document operations. A client has the same write power as a staff member on that board.

**Gap 3 — the escalation (G1, see org study).**
`get_org_id()` reads `team_members`, so a project guest also resolves to the **org that owns the project** and can call every module endpoint (CRM, invoices, HR, payroll). Live example: `06bhoomi@gmail.com` (`role='client'`) → resolves to the **Labofab India Pvt Ltd org**. Contained today only because module tables are empty.

---

## 2. The role model (your spec)

Kartavya needs **four independent levels**. Today three of them are tangled into one global column.

```
PLATFORM   who works at Aekam and what they may do across the whole product
   ORG     which company you work for  → tenant identity, module data
 PROJECT   which board you may open    → cross-org by design (guests)
   JOB     your job title              → display only, never a permission
```

### 2.1 Platform roles — `staging.user_roles` where `org_id IS NULL`

| role_code | Who | Can |
|---|---|---|
| `platform_admin` **(superadmin)** | admin@aekaminc.com · bhoomi@aekaminc.com · sid@aekaminc.com · kevalvshah03@gmail.com | Everything. Create/deactivate orgs, assign roles, set R2, toggle modules, see plan pricing and real AI cost. |
| `account_manager` | *exists already* | Create orgs, add/remove org members, toggle modules, verify R2, view storage. **No** role assignment, **no** org deactivation. |
| `account_finance` **("accounts")** | *exists already* | List orgs, subscription invoices, record payments, overdue. **Read-only** on orgs. Sees plan pricing. |
| `developer` | **NEW** | Diagnostics, logs, migrations, feature flags. **No** customer PII, **no** billing, **no** role assignment. |
| `srijan_admin` | *exists already* | Skill packs + AI config. Aekam IP. |

**These are not new inventions** — `platform_admin`, `account_manager`, `account_finance` and `srijan_admin` are already in the `role_code` CHECK constraint (`migrations/016`) and already enforced by `admin_orgs.py`. **Only `developer` is genuinely new.**

```sql
-- the only enum change needed
ALTER TABLE staging.user_roles DROP CONSTRAINT user_roles_role_code_check;
ALTER TABLE staging.user_roles ADD CONSTRAINT user_roles_role_code_check
  CHECK (role_code IN (
    'platform_admin', 'account_manager', 'account_finance',
    'developer',                                    -- NEW
    'srijan_admin', 'org_admin', 'org_member'
  ));
```

### 2.2 Org roles — `staging.org_members` (new table, see org study)

| role | Can |
|---|---|
| `org_owner` | Everything in their org. Billing contact. |
| `org_admin` | Invite/remove their users, assign org roles, branding, integrations. **Cannot** toggle modules — that stays an Aekam action on request. |
| `org_member` | Use the modules their org has enabled. |

**Deliberately no `org_client`.** A guest is *not* a member of the tenant — that is the whole point of G1. Guests live only in `team_members`.

### 2.3 Project roles — `team_members` / `project_assignments`

| role | Can | Cross-org? |
|---|---|---|
| `owner` | Full control, delete project | no |
| `admin` | Manage members, columns, tasks | no |
| `member` | Tasks, comments, attachments | no |
| **`client`** | **See and collaborate on this one board only.** Invited individually. Grants **no** org identity and **no** module access. | **yes — by design** |

### 2.4 Job title — `users.member_role`

**This is free text and must stay display-only.** Live values today: `Video Editor`, `Content Writer`, `Editor`, `SM Account Manager`, `Founder`, `CFO`, `Kartavya Admin`.

⚠️ **Naming collision to avoid:** `member_role = 'SM Account Manager'` (a job title, enforcing nothing) is *not* the same as `role_code = 'account_manager'` (a real permission). Keep them apart or this will cause a security mistake later — someone will assume the job title grants the permission.

---

## 3. Applying it to your actual users

Current live state vs. your spec:

| User | Today | Target | Action |
|---|---|---|---|
| admin@aekaminc.com | `admin` + `platform_admin` | superadmin | ✅ correct |
| bhoomi@aekaminc.com | `admin` + `platform_admin` | superadmin | ✅ correct (0 projects — fine) |
| **sid@aekaminc.com** | **does not exist** | superadmin | ⚠️ **create the user first** |
| **kevalvshah03@gmail.com** | `member` + **`org_admin`** | superadmin | ⚠️ **grant `platform_admin`** |
| aekaminc1 · Kasti Pranami | `member`, no user_roles | Aekam team | grant `org_member` @ Aekam Inc |
| aekaminc2 · Sneha Kshatriya | `member`, no user_roles | Aekam team | grant `org_member` @ Aekam Inc |
| aekaminc3 · Bhumi Shrimali | `member`, no user_roles | Aekam team | grant `org_member` @ Aekam Inc |
| aekaminc4 · Om Chauhan | `member`, no user_roles | Aekam team | grant `org_member` @ Aekam Inc |
| aekaminc5 · manthan varaliya | `member`, no user_roles | Aekam team | grant `org_member` @ Aekam Inc |
| aekaminc7 · Parth Chavda | `member`, no user_roles | Aekam team | grant `org_member` @ Aekam Inc |
| **06bhoomi@gmail.com** | **`client` + `org_admin`** | client only | ⚠️ **revoke `org_admin`** |

**Two anomalies worth deciding on:**

1. **`06bhoomi@gmail.com` is `role='client'` yet holds `org_admin`**, with `company_name='Kartavya owner'` and `member_role='CFO'`. A client-role user carrying an org-admin permission is exactly the mix G1 turns into a breach. If this is a test account, delete it; if it is a real person, pick one identity.

2. **The six `aekamincN@gmail.com` users have no `user_roles` rows at all.** They are Aekam team by `users.role='member'` alone — the global column you are trying to retire. They need explicit `org_member` rows at Aekam Inc before `users.role` can stop being load-bearing.

---

## 4. What `users.role` becomes

Today `users.role` (`owner|admin|member|client`) is doing four jobs badly: platform superuser, Aekam-team marker, project role, and guest marker.

**Target: it means one thing — is this person Aekam staff?**

| Old value | Becomes |
|---|---|
| `admin` | `staging.user_roles.role_code='platform_admin'` |
| `member` (Aekam staff) | `org_members` row @ Aekam Inc + `users.is_staff=TRUE` |
| `client` | a `team_members.role='client'` row on specific projects — **and nothing else** |
| `owner` | `team_members.role='owner'` on the project |

Until that migration lands, **`require_admin` must not be given to any customer** (see L1–L3 in the org study).

---

## 5. Recommended additions beyond your spec

Two things your rules imply but did not name:

**5.1 An `internal_only` flag on tasks and comments.**
Your rule is that a client collaborates on a project. Right now that means they read *everything* on it. Before the first real client is invited, tasks and comments need a visibility flag, defaulting to internal, with an explicit "share with client" action. Without it, "invite the client to the board" means "show the client our internal notes about them."

**5.2 A per-project client invite that never touches the global `invites` table.**
Today invites are global and carry no org or project (L5). A client invite should create a `team_members` row for **one** project and nothing more — no global role, no org membership. That is the enforcement point for "only who invited that user, not the whole tenant."

---

## 6. Order

| Step | Work | Why |
|---|---|---|
| **0** | Reject `role='client'` in `get_org_id` | Closes G1 today. ~1h. |
| **1** | Revoke `org_admin` from 06bhoomi; create sid@; grant `platform_admin` to keval | Aligns reality with the spec. ~30m. |
| **2** | Add `developer` to the `role_code` enum; wire `require_platform_role("developer", ...)` on diagnostics | The only genuinely new role. ~2h. |
| **3** | `org_members` + `X-Org-Id` (org study step 3) | Makes G1 structurally impossible; retires `users.role`. ~6h. |
| **4** | `internal_only` on tasks/comments + per-project client invite | Makes client collaboration safe to sell. ~6h. |

**Do not do step 2 before step 0.** Adding roles to a model where a guest resolves to a tenant just adds more ways to be wrong.
