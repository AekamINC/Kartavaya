# Proposal 93 · R4 · the delete plan

Derived 2026-08-28 from `pg_constraint` and live row counts on Supabase
`toacecaewujfxjfrjwco`, read-only. **Nothing has been deleted.**

Target orgs:

    Unicode Group           fae87907-2f99-4b35-a241-c94d9e1e4a17
    E2E Test & Associates   64e7bea6-6abe-490c-a2a4-27a60c6be916
    UK AekamINC             4d7e9380-ff98-4c1d-bffd-a76df7e91f21

Never touched: Aekam Inc `045b76ad-…`, Demo - Kartavaya `4ea8208f-…`.

The full table-by-table ordering was produced by a delegated agent carrying the
same seat. **Its load-bearing claims were re-verified here rather than taken on
trust, and one was wrong** — see "What the check caught" below.

---

## The five findings that decide whether this plan works

### 1. `public` has almost no referential integrity — verified

    child schema   foreign keys
    public                    2
    staging                 391

`public` carries exactly two FKs: `task_reminders_task_id_fkey` and
`org_settings_org_id_fkey`. `tasks`, `teams`, `team_members`, `task_comments`,
`time_entries`, `mentions`, `activity_events`, `notifications`, `approvals`,
`boards` have **none**.

**So in `public`, Postgres will not stop a wrong delete order and will not
report one afterwards.** The order there is application semantics only. This is
the opposite of the usual safety assumption and it is why Phase A below is
written out explicitly rather than derived.

### 2. ⚠ 926 rows the `org_id` predicate cannot see — verified exactly

    null-org notifications on target-org tasks        926
    ...of which sit on the PROTECTED 20 tasks           3
    all notifications on the protected 20 tasks        84

`public.notifications` rows carry `task_id` but **no `org_id`**. An org-scoped
delete misses all 926 and leaves them pointing at deleted tasks.

**The single easiest way to destroy the protected set** is to fix that with a
join-based sweep —
`DELETE FROM notifications USING tasks WHERE tasks.org_id = ANY(targets)` —
and forget the team guard. It takes 3 protected rows, and **no `org_id`
predicate would have saved them**, because the rows have no `org_id` at all.

Five more tables share the blind spot, all `org_id IS NULL`, none belonging to a
kept org: `prachar_campaign_contacts` 62, `hub_chat_messages` 49,
`sign_audit_log` 49, `sign_signers` 13, `hub_brand_profiles` 3,
`hub_credit_wallets` 2, plus 1 `public.task_comments` row **on a protected
task**. 1,104 rows in total.

### 3. ⚠ Never delete a `staging.organisations` row

    FKs with organisations as parent:  152 CASCADE, 17 NO ACTION

One of them crosses schemas: `public.org_settings.org_id → staging.organisations`
**ON DELETE CASCADE**. Deleting an org row is a whole-database cascade across
both product schemas, and it is not what "delete the org's data" was approved to
mean. The plan stops at `staging.user_roles` and leaves the org rows standing —
which is also what makes UK AekamINC's "configuration cleared through the real
screens" possible at all.

### 4. 69% of the FK graph would act on delete — and the plan uses none of it

    NO ACTION  121      CASCADE  242      SET NULL  21      RESTRICT  9
    SET DEFAULT  0                                    393 total

**The 21 SET NULLs matter more than the 242 CASCADEs.** A CASCADE deletes a row
that was going to be deleted anyway; a SET NULL silently mutates a **surviving**
row, and no row count reveals it. Deleting a target-org `graha_clients` row
before its children nulls `client_id` on anything left behind.

The 9 RESTRICTs are the opposite and are welcome: they hard-fail on a wrong
order. Eight are real tripwires converging on `graha_clients`,
`manav_employees`, `client_service_lines`, `org_billing_lines` and `notice_type`.

### 5. No FK cycles

A recursive walk over all 393 edges to depth 10 returns zero cycles. Three
self-references exist (`analytics_entities.parent_id`,
`samvada_messages.parent_message_id`, `ganit_invoices.converted_invoice_id`), all
nullable, none forming a table-level cycle. A single-pass delete per table
handles them because the whole org's rows go in one statement. **No
cycle-breaking step is needed.**

---

## Scope and volume

**248 tables carry a direct `org_id`** (224 `staging`, 24 `public`); **142 hold
rows for the three targets**. The other 106 are empty for these orgs — verified
by query, not assumed.

| Org | org-scoped rows |
|---|---:|
| Unicode Group | 5,452 |
| E2E Test & Associates | 20,280 |
| UK AekamINC | 331 |
| **Total** | **26,063** |

Plus 223 join-scoped rows and 1,104 NULL-org rows. Proposal §4 quoted 5,357 /
19,929 / 331 on 2026-08-27; the drift is ordinary and the counts must be re-read
immediately before the delete regardless.

## The protected set — measured, with its exclusion predicates

`public.tasks WHERE team_id = 'team_ae1d58543b21'` — 20 tasks, all Unicode,
**11 with a non-empty `attachments` jsonb**.

| Child | Rows | Exclusion predicate the delete MUST carry |
|---|---:|---|
| `tasks` | 20 | `AND team_id IS DISTINCT FROM 'team_ae1d58543b21'` |
| `notifications` | 84 (3 null-org) | `AND (task_id IS NULL OR task_id NOT IN (protected))` |
| `activity_events` | 56 | `AND (task_id IS NULL OR task_id NOT IN (protected))` |
| `task_comments` | 5 (1 null-org) | `AND task_id NOT IN (protected)` |
| `team_members` | 3 | `AND team_id <> 'team_ae1d58543b21'` |
| `mentions` | 2 | `AND comment_id NOT IN (protected_comments)` — deletes 0 |
| `task_reminders` | 2 | `AND task_id NOT IN (protected)` |
| `teams` | 1 | `AND team_id <> 'team_ae1d58543b21'` |
| `time_entries` | 1 | `AND task_id NOT IN (protected)` |

⚠ `task_reminders_task_id_fkey` is **the one CASCADE reaching the protected
set**: deleting a protected task takes its 2 reminders silently. Reminders are
deleted explicitly *before* tasks so the cascade never has the chance to fire.

⚠ Unicode has exactly **2 `mentions` rows in its entire history and both are on
protected tasks** — so the mentions delete is correctly a no-op, and Suite 03's
"mentions gets its first row" claim needs restating: it would be its first row
*after* the reseed, not ever.

## Order — the shape

Full step-by-step ordering (117 steps) is held with this plan. The shape:

- **Phase A — `public`** (18 steps): mentions → comments → time entries →
  **reminders before tasks** → approvals → activity/notifications (org-scoped
  *and* null-org sweeps, both with the protected guard) → tasks → boards →
  team_members → teams.
- **Phase B — `staging` leaves** (steps 19–61): samvada, sign, niyam, prachar,
  hub, varta, dristi, pahchan — each with its null-org sibling sweep.
- **Phase C — finance / HR / CRM cores** (62–109): the RESTRICT territory,
  converging on `graha_clients` and `manav_employees` last.
- **Phase D — org bookkeeping** (110–117): billing, modules, senders,
  `audit_log` **deliberately last** as the evidence trail, then
  `staging.user_roles`. **STOP** — no `organisations` row is deleted.

**Never in this plan:** `public.users` (global, production-shared),
`staging.organisations`, and the global reference tables (`plans`, `hub_tiers`,
`credit_prices`, `pin_directory`, `statute_calendar`, `hub_skill_templates`,
`prachar_compliance_rules`, `udin_window`, …).

## Stranded-FK check — clean

For every FK where child and parent both carry `org_id`, no row in a **kept** org
references a target-org row. Seven constraints returned non-zero and **every
child row was `org_id IS NULL`**, not Aekam or Demo. Same for the `public`
logical joins: zero kept-org tasks on a target team, zero mismatched
`team_members`, `board_columns`, `time_entries`, `approvals`.

## What the check caught — why agent output is verified, not trusted

The delegated agent reported **"`organisations` is the parent of 242 CASCADE
constraints"**. Re-run here: **152 CASCADE and 17 NO ACTION**. The 242 is the
whole-schema CASCADE total, attached to the wrong subject.

The conclusion it supported — never delete an org row — is unaffected and if
anything clearer. But the number was wrong, in a report that was otherwise
accurate, and it is the number a reader would quote. Its two safety-critical
claims (2 FKs in `public`; 926 null-org notifications with 3 on protected tasks)
were re-run and are **exact**.

## Still undetermined — named, not silently dropped

- **`staging.unicode_emails_backup_20260806`, 18 rows.** Named for Unicode, no
  `org_id`, no FK, no approval by name. Not in the plan. Needs the owner's word.
- **12 user-scoped tables, 61 rows** for users seated only in target orgs
  (`pulse_logins` 48, `categories` 8, `pulse_app_versions` 2, `push_tokens` 2,
  `notification_prefs` 1). They hang off the global `public.users` and **9 users
  straddle a target and a kept org**. Needs a decision.
- **40 `public.tasks` rows with `org_id IS NULL`** — no join path to any org.
  Not attributable, not covered, and they survive. The post-delete count must
  not be misread as a failed wipe.
- **R2 objects behind the `attachments` jsonb** — not reachable from SQL. See
  `93-R2-OBJECT-INVENTORY.md`; the key list must be captured before this runs.
