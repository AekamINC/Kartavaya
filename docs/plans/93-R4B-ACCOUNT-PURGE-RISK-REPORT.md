# Proposal 93 · R4b — the account purge, and the UK state code

**Written 2026-08-28 BEFORE any statement ran.** The standing authorisation for
migrations "removes the wait, not the report" (93 §0), and a data change to live
rows is a separate decision from a schema change — so both are set out here
first, with the reversal written down before the change.

---

## 0. Why this exists at all — a scope narrowing nobody surfaced

Proposal 93 **§2** is unambiguous: *"Taking remove means remove literally: every
user in the three test orgs is deleted and recreated through the UI."*

**That did not happen.** `93-R4-DELETE-PLAN.md:154` says, in its own words,
**"Never in this plan: `public.users` (global, production-shared)"**. R4 removed
the *seats* and left the *accounts*. Measured live 2026-08-28: **50 users, 24
seats**, so 25 accounts hold an address and no membership anywhere.

That was a defensible engineering instinct — `public.users` is global and
production shares it — and **to its credit it was declared, not hidden**:
`STATUS.md` says plainly *"the accounts themselves still exist in the global,
production-shared `public.users` … deleting the login is a separate act with a
different blast radius."*

**What was missing is narrower, and it is still a gap.** §2 of the proposal had
already weighed that blast radius and ruled the other way, and it named the one
account class that genuinely could not go — the bootstrap admin. So this was not
an open question being deferred; it was a **settled instruction being reversed**,
recorded as a footnote rather than raised as a decision. §0 reserves that call to
the seat and does not let it be made silently: *"Broken, blocked, or excluded by
decision? — three different sentences in the report, and collapsing them is how a
plan looks finished when it is not."* This was the third, written as the second.

**It also blocks the next piece of work.** `backend/routers/org_invites.py:455`
refuses an invitation to an address that already has an account:

```
409  Someone with this email already has an account.
     Add them from the Members tab instead of inviting them.
```

So Suite 02's members lane — the first thing every later wave depends on —
cannot re-invite any of those addresses while the orphan accounts stand.

**Owner's ruling, 2026-08-28:** *"any users of aekam is part of any org keep it
rest remove and then do your test."*

---

## 1. What changes

### Item A — delete the accounts that hold no seat in any organisation

**Keep rule, applied literally:** a `public.users` row survives if it has at
least one `staging.user_roles` row in **any** organisation. Everything else goes.

**Two exclusions added on top of the owner's rule, and why.** Both are cases
where the literal rule would destroy something 93 explicitly protects:

| Excluded | n | Why the literal rule would have been wrong |
|---|---|---|
| `is_system` accounts (`niyam_<org>`) | 5 | 93 §2 names this exact hazard: these are the automation engine's actor identity and **hold no seat by design**. A blanket purge "would have removed them and broken Niyam attribution in every org, including the two that are not being touched" |
| Anyone who created, is assigned to, or approved one of the protected 20 tasks | 0 | 93 §2 kept "Keval UK" for precisely this reason. **Measured: the set is empty** — everyone touching `team_ae1d58543b21` already holds a seat, so this exclusion costs nothing today. It stays in the query anyway, because a guard that happens to be unnecessary is not the same as one that is absent |

**Resolved live:**

| Disposition | n |
|---|---|
| KEEP · holds a seat in an org | 20 |
| KEEP · system account (niyam) | 5 |
| **DELETE · no seat anywhere** | **25** |
| Total | 50 |

All 25 are test personas: 12 `*.empNNN@example.com` dummy logins, 8
`kevalvshah03+<persona>@gmail.com` seed people, 3 `+e2eNNNNNN@` invite
placeholders, 3 `+qa*@` QA accounts, and `aekaminc1+m@gmail.com` — the row whose
`full_name` is literally an email address, the display defect 93 §2 logged.
**None created a single task; none touches the protected 20.** Both measured,
not assumed.

### Item B — `UK AekamINC.state_code = '27'` (Maharashtra)

93 §9, owner-delegated, never applied — the column is `NULL` today. One UPDATE on
one test org's own row. It is what makes Stage 4 a test rather than a repeat:
Unicode is Gujarat `24`, so identical suites must then produce **IGST** between
the orgs and **CGST/SGST** within them, and Maharashtra's 3 professional-tax
bands against Gujarat's 4 must produce a different figure on identical salaries.
Identical figures would mean the ladders are not being read at all.

---

## 2. Write-path side effects

**Item A.** Fifteen foreign keys reference `public.users(id)`, read from
`pg_constraint` rather than from any migration file. Fourteen are `NO ACTION`
(so a referenced row makes the DELETE **fail loudly**, which is the property R4's
own gate asks for: *"a missed dependency must fail, not cascade"*); one,
`notice_register_owner_user_id_fkey`, is `ON DELETE SET NULL`.

**Referencing rows among the 25: zero on all fifteen.** R4 already cleared them.

The unenforced references are the real exposure, so all **270 text
user-reference columns across 166 tables in both product schemas** were swept
(via `query_to_xml`, so no DDL touched this shared database). Four carry rows:

| Table | Rows | Disposition |
|---|---|---|
| `public.notifications.user_id` | 46 | **Delete.** A notification addressed to a deleted account is unreachable by anyone |
| `staging.audit_log.user_id` | 20 | **KEEP — deliberately.** See §3 |
| `staging.pulse_logins.user_id` | 3 | **Delete.** Suite 12 reconciles every headline figure to its module; an orphan login row is an unattributable number |
| `public.push_web_subscriptions.user_id` | 1 | **Delete.** A live push endpoint for a deleted account would deliver to whatever browser still holds it |

Total collateral: **70 rows**, all telemetry, no business data.

**Item B.** `state_code` is read by the GST split and the professional-tax
ladder. Nothing is recomputed retroactively — UK holds no invoices and no payroll
runs after R4 — so there is nothing live to re-price. It changes what **future**
rows compute, which is the entire point.

---

## 3. The judgement being made, stated so it can be overruled

**`staging.audit_log` rows are NOT deleted, even though they reference accounts
that will no longer resolve.**

An audit log is the record of what happened, and this programme has already been
saved by it once: the cross-org incident of 2026-08-28 was diagnosed *from*
`audit_log` showing `org_id=045b76ad` reached via `platform_bypass`. Deleting
audit rows to make a user purge look tidy destroys exactly that evidence, and it
is the same reasoning 93 §12 gives for treating telemetry as append-only.

There is no FK, so the rows are legal after the delete. They will reference a
`user_id` that no longer exists — **which is what the audit trail of a deleted
account is supposed to look like.**

---

## 4. Risk, and what makes each one survivable

| Risk | Assessment |
|---|---|
| **Deleting an account somebody still uses** | The keep-rule is membership, and membership is what makes an account usable. A user with no `user_roles` row in any org can sign in and reach nothing |
| **A production customer caught in the sweep** | The two untouched orgs (Aekam Inc, Demo) have **every** member seated, so none is in the delete set. Checked by listing the 25 individually, not by trusting the count |
| **Breaking Niyam attribution** | Excluded explicitly — the single hazard 93 §2 raised about this operation |
| **Stranding the protected 20** | Excluded explicitly; measured as empty |
| **An unenforced reference orphaned silently** | Swept all 270 candidate columns rather than only the 15 with FKs. Four hits, each dispositioned above |
| **Irreversible** | **Yes.** `reseed_backup_20260828` holds `public.users` as it stood before R4 and remains the only copy. **R9 must not drop it until this is settled** |

---

## 5. Reversal, written before the change

- **Item A** — restore from `reseed_backup_20260828.users` by `user_id`, then the
  three collateral tables from their backup counterparts. The backup schema is
  present and verified (`information_schema.schemata`, 2026-08-28).
- **Item B** — `UPDATE staging.organisations SET state_code = NULL WHERE id =
  '4d7e9380-ff98-4c1d-bffd-a76df7e91f21';` The prior value is `NULL`, recorded
  here before the write.

---

## 6. Verification — by re-query, never by the statement reporting success

1. `public.users` count is **25**, and `is_system` is still **5**.
2. The untouched orgs' seat counts are unchanged: Aekam Inc **10**, Demo **1**.
3. Protected task count on `team_ae1d58543b21` is still **20**.
4. `staging.audit_log` count unchanged — the keep is proved, not asserted.
5. UK reads `state_code = '27'`, re-read from the row.
6. An invitation to a freed address returns something other than `409`.
