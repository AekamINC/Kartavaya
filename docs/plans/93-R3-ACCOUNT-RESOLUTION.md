# Proposal 93 · R3 · the account keep/delete set, recomputed live

Measured 2026-08-28 against Supabase `toacecaewujfxjfrjwco`, read-only.
Supersedes the split in proposal 93 §2, which was computed on 2026-08-27.

**The proposal says 20 keep / 30 delete. Live, under the proposal's own stated
rules, it is 24 keep / 26 delete.** The rules did not change; the data did. This
is why §14 requires the set to be recomputed immediately before R4 rather than
taken from the document.

Seats come from `staging.user_roles`; accounts from `public.users`. ⚠
`public.users` is **global and shared with production** — deleting a row removes
that login everywhere at once.

---

## The four findings that must be settled before R4 runs

### 1. ✅ `Sid` — the owner said KEEP, 2026-08-28

Raised because §2 never mentions this account and every mechanical rule swept a
**platform-level administrator** into the delete list on the strength of one
Unicode/E2E seat. Put to the owner by name, per the standing rule that an
irreversible delete outside the approved list is named and confirmed regardless.

**Owner's answer: keep it.** The split becomes **25 keep / 25 delete**. Sid's
seat was not touched by R4, which removed only `org_member` seats.

### 1a. (resolved) Why it was raised — `Sid` is a `platform_admin`

    name  Sid          email sid@aekaminc.com
    role  platform_admin     seats 1 (Unicode/E2E only)

Proposal 93 §2 never mentions this account. It is not a seeded persona: it is a
**platform-level administrator** whose only seat happens to sit in an org being
rebuilt, so every mechanical rule in §2 sweeps it into the delete list.

**Deleting a platform_admin is not the same act as deleting a seeded org_member,
and the owner's approval was given against a list that did not contain it.**
Held out of the delete set pending the owner's word, by name, per the standing
rule that a DROP — and by the same logic an irreversible account delete outside
the approved list — is named and confirmed regardless.

### 2. The protected-task creators are not the three accounts §2 names

§2 says the 20 protected tasks were created 12 by Kasti ORG, 7 by Kasti Pranami,
1 by Keval UK. Measured, `public.tasks WHERE team_id='team_ae1d58543b21'` has
**3 distinct `created_by_user_id`**, and resolving them by id gives:

    Rohan Kasti     aekaminc1+org@gmail.com     (2 seats, org_admin)
    Devang Bhatt    kevalvshah03+1@gmail.com    (1 seat,  org_admin)

**`Devang Bhatt` appears nowhere in §2.** It holds a single Unicode seat, so
every rule in the proposal deletes it — and deleting it strands the creator
attribution on tasks the owner said to keep exactly as they stand. Kept, for the
same reason §2 kept "Keval UK": the protected set's authorship is part of what is
protected.

### 3. Four accounts qualify as bootstrap admins, where §2 assumed two

`org_admin` on Unicode/E2E only, none with a seat in a kept org:

    E2E Approver     kevalvshah03+e2e-approver@gmail.com
    Rajesh Bhatt     kevalvshah03+rajesh-bhatt@gmail.com
    Isha Desai       isha.desai.emp001@example.com
    Kabir Malhotra   kabir.malhotra.emp002@example.com

§2's physical constraint is that **at least one** admin account per org must
survive so Playwright has something to log in as. One per org satisfies it; four
is over-conservative and leaves seeded personas alive that the reseed is supposed
to recreate through the invite flow.

**Recommendation:** keep one per org as the bootstrap seat and delete the other
three, which restores the spirit of "remove means remove". Not actioned — this
changes the delete count and is the owner's call.

### 4. ✅ The `full_name`-is-an-email defect is confirmed, and it deletes itself

§2 logged a Unicode member whose `full_name` renders as an email address.
Confirmed live, and it is **not** the account §2 implies:

    name   aekaminc1+org@gmail.com      email  aekaminc1+m@gmail.com

A different row from `Rohan Kasti`, whose *email* is `aekaminc1+org@gmail.com`.
The defective row is in the DELETE set, so the wipe removes it. The underlying
product gap — nothing stops a machine string being stored where a human name
belongs, and the names-not-IDs ratchet does not catch it because it is not a
UUID — survives the wipe and stays open.

---

## The resolved set — 24 keep / 26 delete

### KEEP · 24

| n | Basis | Accounts |
|---|---|---|
| 5 | system | the five `niyam_<org>` actors, one per org, `is_system`. ⚠ A blanket "delete all users" removes these and breaks Niyam attribution in **all five** orgs, including the two never touched |
| 12 | seat in a kept org | Aekam Admin, Bansi Prajapati, Bhoomi Shah, Bhumi Shrimali, Demo - Keval, Kasti Pranami, KEVAL SHAH, manthan varaliya, Om Chauhan, Parth Chavda, Sneha Kshatriya, UK Aek Keval |
| 1 | org owner | E2E Owner |
| 2 | protected-task creator | Rohan Kasti, Devang Bhatt |
| 4 | bootstrap admin | E2E Approver, Rajesh Bhatt, Isha Desai, Kabir Malhotra — see finding 3; three of these are candidates for deletion |

### DELETE · 26

| n | Basis | Accounts |
|---|---|---|
| 6 | no seat anywhere | Harsh Modi, Ishita Rao, Meera Nair, Neha Chauhan, Nisha Trivedi, Ritu Agarwal. ⚠ Three of these created 32 Unicode tasks while holding no seat at all — orphaned authorship predating this plan |
| 20 | Unicode/E2E seat only | Advik Rao, `aekaminc1+org@gmail.com`, Amit Sharma, Anaya Saxena, Arnav Kulkarni, E2E Invited Member ×3, Keval LAB, Kiara Agarwal, Myra Bansal, Pooja Barot, Priya Mehta, Reyansh Patel, Saanvi Verma, **Sid**, Tara Mehta, Vihaan Iyer, Vikram Joshi, Vivaan Joshi |

**`Sid` is inside that 20 and is held out pending finding 1.** Settling findings
1 and 3 moves the split; nothing is deleted until they are settled.

---

## The query, so it can be re-run rather than believed

```sql
with seats as (
  select ur.user_id,
         bool_or(ur.org_id in (
           '045b76ad-654b-42dd-b4b1-731700efc6c3',  -- Aekam Inc
           '4d7e9380-ff98-4c1d-bffd-a76df7e91f21',  -- UK AekamINC
           '4ea8208f-892d-4943-8e2e-7bfd335c0d28'   -- Demo
         )) as kept_org,
         bool_or(ur.role_code in ('org_owner','owner')) as is_owner,
         bool_or(ur.role_code in ('org_admin','admin')) as is_admin,
         string_agg(distinct ur.role_code, ',') as roles
  from staging.user_roles ur group by ur.user_id
),
prot as (
  select distinct created_by_user_id uid
  from public.tasks where team_id='team_ae1d58543b21'
)
select u.name, u.email, u.is_system, s.roles,
  case
    when u.is_system            then 'KEEP system'
    when s.kept_org             then 'KEEP kept-org seat'
    when p.uid is not null      then 'KEEP protected creator'
    when s.is_owner             then 'KEEP org owner'
    when s.is_admin             then 'KEEP bootstrap admin'
    when s.user_id is null      then 'DELETE no seat'
    else 'DELETE unicode/e2e only'
  end as disposition
from public.users u
left join seats s on s.user_id = u.user_id
left join prot  p on p.uid     = u.user_id
order by disposition, u.name;
```

⚠ Note what the first draft of this query got wrong, because the mistake is
instructive: ordering the `case` with `kept_org` before the owner and admin
branches is correct, but **omitting the owner and admin branches entirely** —
the obvious first cut — deletes `Kasti ORG`, `KEVAL SHAH` and `E2E Owner`,
i.e. the bootstrap admins and two org owners, leaving nothing able to sign in and
create the replacements. The rule that keeps them is not "they are important";
it is §2's physical constraint that Playwright must have an account to log in as.
