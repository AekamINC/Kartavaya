# Proposal 93 · C — migration 240, the user-id columns declared UUID

> **Written BEFORE the statement runs.** The standing migration authorisation
> removes the wait, not the report. Verified from `information_schema` and
> `pg_constraint` afterwards, never from this file or from the one it supersedes.

Found by Suite 04 (Graha) on 2026-08-29: **contact merge has never once
worked.** It is the fix `migrations/PROPOSED_083_catchup_tables_created_by_type.sql`
proposed on 2026-07-28 and nobody applied.

---

## 0. The finding, from the wire and the log — not from the proposal file

Suite 04 drove the real merge control. The screen is correct; the request is
not. Railway deploy log, 2026-08-29 01:31:38 UTC:

```
asyncpg.exceptions.InvalidTextRepresentationError:
  invalid input syntax for type uuid: "user_21457956f010"
```

User ids in this system are `user_` + 12 hex — 17 characters, never UUIDs.
`024_graha_dedupe_merge.sql:93` declares `graha_contact_merges.actor_id UUID`.
**`staging.graha_contact_merges` holds 0 rows, and always has.** That is not a
coincidence beside the bug; it is the bug's consequence.

Reproduced on three consecutive runs.

---

## 1. What changes

Four columns, `UUID → TEXT`. **Not five.**

| Table | Column | Live type | Action |
|---|---|---|---|
| `graha_automations` | `created_by` | `uuid` | → `text` |
| `graha_web_forms` | `auto_assign_to` | `uuid` | → `text` |
| `graha_contact_merges` | `actor_id` | `uuid` | → `text` |
| `graha_contact_merges` | `undone_by` | `uuid` | → `text` |
| `graha_web_forms` | `created_by` | **`text` already** | **none** |

⚠ **PROPOSED_083 lists five and the catalogue says four.**
`graha_web_forms.created_by` is ALREADY `text` — converted at some point without
the proposal being updated. Applying that file verbatim would not have broken
anything (`created_by::text` on a text column is valid), but it would have been
a statement written against a schema that had moved, which is the precise habit
migration 238 exists to punish. **Read the catalogue, never the migration file.**

No table is created or dropped. No row is written by this migration. No
constraint is added or removed — these columns carry no foreign key
(`REFERENCES` was never declared on them), so there is nothing to drop first and
nothing pointing at them.

---

## 2. Write-path side effects

**The migration itself has none.** Four `ALTER COLUMN … TYPE` inside one
transaction. No trigger, no default, no view, no backfill.

What it CHANGES about the running product, which is the point:

| Route | Today | After |
|---|---|---|
| `POST /v1/graha/contacts/{id}/merge` | **500**, `InvalidTextRepresentationError` | writes a merge row |
| `POST /v1/graha/contacts/merges/{id}/undo` | same, unreachable — nothing to undo | works |
| `POST /v1/graha/automations` | **500** (proven live 2026-07-28) | writes |
| `POST /v1/graha/web-forms` with `auto_assign_to` | 500 — dormant only because the screen never surfaces the field | writes |

⚠ **The 500 reaches the browser as a CORS error**, because the exception escapes
before `CORSMiddleware` attaches its headers. Anybody debugging this from the
console is sent looking at CORS. That is worth knowing when judging whether this
has been hit before and misattributed.

---

## 3. Live exposure, measured before the change rather than after

```
staging.graha_automations       0 rows
staging.graha_contact_merges    0 rows
staging.graha_web_forms         2 rows,  auto_assign_to non-null on 0 of them
public.graha_automations        does not exist
public.graha_contact_merges     does not exist
public.graha_web_forms          does not exist
```

Both product schemas checked, because a schema-qualified negative is a fact
about that schema alone.

**Not one value is being rewritten.** Every column being cast is NULL on every
row that exists. `uuid → text` is lossless in any case, so the `USING` clause is
a formality rather than a conversion — but the count is what makes that a
measurement instead of an assumption.

⚠ **PROPOSED_083's own precondition has moved and this is the fresh look it
asks for.** It says "all four tables are empty… verify empty first. If any count
is non-zero, STOP and re-read." `graha_web_forms` now holds **2 rows**, created
by Suite 04 an hour ago. The premise changed; the conclusion does not, because
the two rows' `auto_assign_to` is NULL and `created_by` is already text. Recorded
rather than waved through.

---

## 4. Reversal, written before the change

```sql
ALTER TABLE staging.graha_automations    ALTER COLUMN created_by     TYPE UUID USING NULLIF(created_by,'')::uuid;
ALTER TABLE staging.graha_web_forms      ALTER COLUMN auto_assign_to TYPE UUID USING NULLIF(auto_assign_to,'')::uuid;
ALTER TABLE staging.graha_contact_merges ALTER COLUMN actor_id       TYPE UUID USING NULLIF(actor_id,'')::uuid,
                                         ALTER COLUMN undone_by      TYPE UUID USING NULLIF(undone_by,'')::uuid;
```

⚠ **This reversal expires.** It succeeds only while every value is UUID-shaped
or NULL — i.e. only until the first real merge writes a `user_…` id. After that
the honest rollback is Supabase PITR, and reverting would mean **discarding merge
history**, since the rows that block the cast are exactly the ones the feature
was fixed to create.

Stated plainly because it is the one asymmetry here: the change is trivially
reversible today and not reversible in the ordinary sense tomorrow. That is an
argument for applying it while the tables are empty, which is also PROPOSED_083's
own argument — "run it before the tables acquire data, not after."

---

## 5. Why TEXT, and not "make user ids UUIDs"

Because TEXT is already what the rest of the live schema uses. `graha_deals`,
`graha_contacts` and `graha_activities` all accept `user_…` in `created_by`
today — which is why the disagreement went unnoticed: migration **081** created
these tables on 2026-07-27 by replaying 023/024/059 verbatim, faithfully
reproducing a declaration that had drifted out of truth long before.

The id format is load-bearing across auth, tokens and every existing row.
Changing it to satisfy four columns would be the larger and far riskier change.
This aligns four outliers with the convention the database already keeps.

---

## 6. Verification — by re-query, never by the statement reporting success

1. All four columns read `text` in `information_schema.columns`;
   `graha_web_forms.created_by` still `text` and untouched.
2. Row counts unchanged: automations 0, merges 0, web forms 2.
3. **The merge driven again through the real control**, and a row appears in
   `graha_contact_merges` where there have never been any. That is the ✅
   standard — a customer completing the flow, not the migration succeeding.
4. Aekam Inc's §12 fingerprint re-measured: 11 seats / 220 tasks.

---

## Assessment

**Low risk and overdue.** Four columns, zero values rewritten, one transaction,
no constraints, no foreign keys, no data loss possible in either direction
today. It repairs a feature that has never worked once in the product's life and
two others that 500 on first use.

The only real consideration is timing, and it points the same way: the reversal
is free while the tables are empty and expensive once they are not.
