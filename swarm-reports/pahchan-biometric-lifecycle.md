# Pahchan — biometric duty of care

Branch: `pahchan/biometric-lifecycle` (rebased onto `origin/staging`)
Earlier refs: `worktree-agent-afce9b7ec86ef03a3` (pre-rebase), `rescue/afce9b7ec86ef03a3`

Spec: `design-handover/07-pahchan.md`.
Gates: `cd frontend && node scripts/check-tokens.mjs && node scripts/check-classes.mjs` — both 0 missing.
**Mobile typecheck: `cd mobile && npm install && npx tsc --noEmit`** — clean. (`npm install` is
required first; `mobile/node_modules` is absent on a fresh clone and bare `npx tsc` will
silently fetch the unrelated `tsc@2.0.4` package and print a red herring. The lockfile was
NOT modified by the install and is not committed.)
Tests: `cd backend && python -m pytest tests/test_pahchan_retention.py` — 8 passed.

---

## 1 · The biometric data lifecycle, end to end

Two classes of face data exist. They are not interchangeable and their lifecycles differ.

### Reference photographs — the identity baseline

Two per employee, slot 1 frontal and slot 2 at an angle.

| | |
|---|---|
| **Captured** | `mobile/src/screens/pahchan/EnrollScreen.tsx` — in-app camera, front lens, resized to 1080px/q0.85 |
| **Uploaded** | `POST /api/v1/pahchan/punch/photo` with `kind=reference` → object store at `pahchan/{org_id}/reference/{uuid}.jpg` |
| **Recorded** | `staging.pahchan_enrollment_photos` — `object_key` only; **no image bytes in Postgres** |
| **Approved** | `POST /enrollment/{photo_id}/approve`. A self-capture lands PENDING; only two APPROVED photos satisfy the punch path |
| **Deleted** | Employment + `reference_photo_grace_days` (default 45) — object AND row, by `purge_reference_photos` |

### Punch selfies — the per-event evidence

| | |
|---|---|
| **Captured** | `ClockScreen.tsx` — front lens, resized to 720px/q0.75 |
| **Uploaded** | same endpoint, `kind=punch` → `pahchan/{org_id}/punch/{uuid}.jpg` |
| **Recorded** | `staging.pahchan_punches.photo_key` |
| **Deleted** | `punch_photo_retention_days` (default 90) — object deleted, `photo_key` NULLed, **row kept** |

### Every path that returns a face — complete enumeration

Only two backend files touch the `pahchan_*` tables at all (`routers/pahchan.py`,
`services/pahchan_retention.py`). Nothing else in the product reads them — no report
service, no Vetana, no Manav. That containment is real and worth preserving.

Fifteen routes exist. These are all the ones that can yield an image or a pointer to one:

| Route | Gate | Returns |
|---|---|---|
| `GET /punches/{id}/photo` | **REVIEW** | signed URL, ~short-lived, audited `severity=warn` |
| `GET /enrollment/photos/{id}/url` | self **or** REVIEW, inline | signed URL, audited `severity=warn` — **added this run** |
| `GET /register` | **REVIEW** | `has_photo` bool + `reference_ids` — **no keys, no URLs** (changed this run) |
| `GET /enrollment/{employee_id}` | self **or** REVIEW, inline | photo rows incl. `object_key` |
| `GET /enrollment/queue/pending` | **REVIEW** | photo ids — **`object_key` removed this run** |
| `GET /me` | module | **no photo keys, no coordinates** — verified field by field |

**REVIEW** = `require_org_role("org_owner","org_admin")`, which additionally admits
`platform_admin` and nothing else.

There is **no endpoint anywhere in the backend that signs an arbitrary key handed to it.**
All 14 `sign_key` call sites take a key the server itself just read from its own row. This
is what makes "ids on the wire, never keys" a real boundary rather than a convention.

---

## 2 · Findings

### 2.1 The register could not verify anyone — FIXED

**The most serious functional finding.** §3 calls the register "the surface that decides
whether this works", because human comparison is the *only* verification mechanism in v1.

`Register.jsx`'s `Triple` initialised `urls.refs` to `[]` and **never wrote to it**. The
effect fetched the punch selfie only. Both reference slots rendered a `…` placeholder
forever — indistinguishable from a slow load.

Root cause was in the backend: **no endpoint signed an enrollment photo key.** The register
returned `reference_keys`, and a key is inert by design (§4), so there was nothing to
exchange them for.

The reviewer saw a selfie beside two empty boxes and pressed ↵. §3 names this outcome
exactly — a reviewer who cannot compare "confirms everything without looking, which is
worse than no review, because it manufactures a record of verification that did not
happen." The J/K/↵ burst path made it fast to do.

The same root cause meant **HR approved reference photos sight-unseen** — the act on which
every future verification rests.

Fixed: added `GET /enrollment/photos/{photo_id}/url`, wired both surfaces, and gave each
photo slot a real state machine so a retention-deleted photo (404) reads as `deleted`
rather than as a permanent spinner.

### 2.2 Biometric reads were gated more weakly than everything else — FIXED

`GET /enrollment/{employee_id}` and the `hr_upload` branch of `POST /enrollment` were
gated on `is_org_admin`, which returns True for **eight platform role codes**:
`platform_owner, platform_admin, platform_manager, platform_staff, account_manager,
account_finance, srijan_admin, platform_support` (`middleware/roles.py:114-144`).

So enrollment was the **widest**-gated biometric surface in the module while `/register`
and `/punches/{id}/photo` were the narrowest. §7 is explicit: the platform sees "the count
of Pahchan users per organisation. Nothing else. No names, no photographs, no locations, no
times." An `account_finance` role could read any employee's reference photo rows — and,
via the write path, **attach a reference photo to someone else's record**, which is the one
attack the entire verification model rests on being impossible.

Fixed: both now use `_may_view_others_biometrics` — org_owner/org_admin in the org, or
`platform_admin`. The same set `_review_gate` admits.

Mitigating the severity of what was exposed: `object_key` alone was not redeemable for an
image, because no endpoint signs arbitrary keys. It was metadata exposure, not image
exposure. The write path was the serious half.

### 2.3 Retention could not keep up, and reported success anyway — FIXED

All three passes issue **real deletes** — verified statement by statement, not archive
moves, not log lines. But each took **one 500-row slice per daily run**.

An employee makes two punches a day, so an org of N employees produces 2N selfies a day
falling due at 90 days. **The break-even is 250 employees.** Above that the backlog grows
without bound and punch selfies are retained past the promised window indefinitely.

What made this serious is that it was invisible: the job completed, logged
`photos_deleted: 500`, and looked healthy every morning while falling further behind. This
is precisely the false-record-of-compliance outcome — worse than failing loudly.

Fixed: all three passes now drain in `BATCH`-sized statements up to `MAX_PER_RUN` (50k),
each returns a `*_drained` flag, and an incomplete pass is raised to a **log WARNING**
naming it. The drain `OFFSET`s past rows that failed to delete this run — a successful
delete leaves the result set on its own, a failed one does not, so without the offset the
job would refetch the same failing rows forever and never return.

Added `backend/tests/test_pahchan_retention.py` — the module had **no tests at all**. Eight,
including termination-under-total-failure (the infinite-loop case) and the §5 independence
properties.

### 2.4 The API let one selfie work forever — FIXED

`photo_key` is client-supplied and was stored verbatim: never validated, never checked for
reuse.

§1 bans the gallery picker precisely so that "one saved selfie works forever" is
impossible — "every punch after the first is a file copy… not a degraded version of the
feature; it is the absence of it." But camera-only is enforced in the **mobile UI**, and
the UI is not the boundary. An employee calling `POST /punch` directly could send the same
key every morning and never take another photograph.

Fixed, matching §2's philosophy rather than overriding it:
- A key outside `pahchan/{org}/punch/` is **refused** (400) — otherwise a punch could name
  any object in the org's bucket, including a payslip or a reference photograph. §2 permits
  exactly one 4xx, a malformed body, and this is one.
- A key already on a different punch is **recorded and flagged** (`reuse`), not refused. A
  blocked punch becomes a payroll dispute a week later, and a reused key is also what a
  buggy client retrying with a stale key looks like. The human reviewer decides.

The idempotent-replay path is unaffected — it returns before the insert, so an offline
punch resent with the same `client_punch_id` never flags.

### 2.5 Punch idempotency ignored who owned the punch — FIXED

The replay lookup matched `(org_id, client_punch_id)` with no ownership check, so a caller
sending an id that already existed got back **somebody else's punch** — id, direction,
capture time, flags. Real clients send a UUIDv4, but the field accepts any 8–64 character
string, so "unlikely" was a property of the well-behaved client rather than of the
endpoint. Now scoped to the calling employee, with a 409 on a genuine cross-employee
collision instead of silent misattribution.

### 2.6 On-device face data outlived its purpose — FIXED

The 72-hour queue holds **no image bytes** — only `photo_uri`, a path into the app sandbox —
and a sent punch *was* correctly removed from the queue. But **nothing ever deleted the
file.** The pointer was freed and the face stayed.

Every capture left two copies, neither read again: the full-resolution camera frame and the
resize. Enrollment did the same at q0.95/1080px — and those are **reference** photos, the
identity baseline. The app never lists those directories, so nothing would have found them
again; they would sit there for the life of the install, outside every retention promise
Kartavaya makes, while the server copies they duplicate are inside windows a real job
enforces.

Now deleted on successful send, on 72-hour expiry, immediately after resize for the
redundant original, and on every path out of enrollment capture including failure.
Deletion never throws and never blocks — the queue entry is the durable record, and a punch
must not fail because the filesystem would not delete a JPEG.

### 2.7 Silently-dropped props — FIXED

Same class as the `DristiPage.jsx:577` defect a sibling found; lower severity (theirs
crashed, these degraded quietly).

- `SkeletonTable cols={6}` — the prop is `columns` (`Skeleton.jsx:75`), so it fell back to
  its default of 5 for a 6-column table: a column-count jump at exactly the moment the
  loading state exists to prevent one.
- `ErrorState title=` / `message=` — the signature is
  `kind/grant/detail/onRetry/backTo/backLabel`. **§3's exact required reassurance —
  "Punches are safe — this is a read failure, not data loss" — never rendered**; the
  generic "something broke on our side" showed instead.

Swept both codebase-wide: every other `SkeletonTable` site already passed `columns`, no
`cols={` remains anywhere, and a scripted check of every `<ErrorState>` site found zero
with props outside the valid set.

### 2.8 Offline state did not exist — FIXED

`kind` was hardcoded `"server"`, so a reviewer with no connection was told the failure was
ours. Now classified through `errorKind`, plus an `OfflineBanner` on the register and an
offline-specific message when a verdict fails to save — the keyboard path advances the
cursor on every ↵, so someone pressing through a dead network walks past people whose
verdicts are not being saved, in the queue whose entire purpose is not skipping anyone.

### 2.9 §9's retention promise to the employee did not exist — BUILT

The backend returned everything needed and the screen rendered none of it. Added
`mobile/src/screens/pahchan/MyBiometrics.tsx` on the Me tab: the employee's own two
reference photographs (shown, not counted) and the three windows **read from their org's
actual policy**, not from constants. Renders nothing for non-Pahchan users.

---

## 3 · Claims from the brief, verified

| Claim | Verdict |
|---|---|
| Offline-first face recognition using **face-api.js** | **STALE, and correctly absent.** `face-api` appears in no source file — only in `IMPLEMENTATION_PLAN.md` and `MESSAGING-ATTENDANCE-SPEC.md`. §0 parks face matching to v2; §8 finds that automated matching needs consent collected again under DPDP. Building it in would contradict the spec. |
| Self-capture enrollment on mobile | **HELD** |
| 72-hour punch queue, flushes on reconnect | **HELD** — `PUNCH_RETENTION_MS`, measured from `captured_at` not enqueue time |
| Camera-only clock-in | **HELD** — front lens, no `expo-image-picker` anywhere, gallery permission never requested |
| Three retention jobs | **HELD as deletes; the capacity defect in 2.3 was real** |
| Reviewer side + enrollment register | **Existed as routes; did not function as verification.** See 2.1 |
| Admin shift policies | **HELD** |
| Vetana/HRMS integration | **STALE — it does not exist.** See §4 |
| Pahchan absent from every nav list | **STALE — already fixed.** `navConfig.js:66` carries the entry with en/hi/gu labels and a module gate; `navIcons.jsx:15` has the icon. Another agent's work; I did not edit nav. |
| Cross-org isolation via `user_roles` | **HELD** — `org_resolver.py` resolves tenancy solely through `staging.user_roles`, both the `X-Org-Id` path and the fallback. No `team_members` path remains. |
| A user cannot punch for someone else | **HELD, structurally.** `PunchBody` has **no `employee_id` field**; the employee is resolved from the JWT via `_employee_for(pool, org_id, user["user_id"])`. Not a check that can be forgotten — there is no input to forge. |

---

## 4 · Open, and why I did not close them

**Pahchan attendance never reaches payroll.** Vetana computes from
`staging.manav_attendance`; Pahchan writes only `staging.pahchan_punches` and never touches
it. An employee can clock in and out every day for a month and payroll will not see one
minute of it. This is a design decision with payroll-correctness consequences (which punch
pairs make a day, how regularisations settle, what an unreviewed punch is worth) and it
needs the owner, not an agent inventing a mapping.

**Admin shift-policy powers and biometric-read powers are the same role, and cannot be
separated today.** `PATCH /policy` and `GET /register` are both `_review_gate`. There is no
narrower "policy only" role, and per the coordinator `level_satisfies` has **zero call
sites backend-wide** — module-level (viewer/editor/approver/admin) enforcement does not
exist to separate them. Building it requires resolving the `RBAC-SPEC.md:65` vs Tier-4
contradiction, which the coordinator flagged as owner-blocked. **Answer to the brief's
question: no, an admin's shift-policy powers cannot be used to read templates *as a
separate escalation* — but only because the same role already grants both directly.**

**The retention schedule is not provable from the repo.** The endpoint
`POST /api/internal/cron/pahchan-retention` exists and is secret-gated, and
`PROPOSED_064`'s closing note says the jobs belong on Railway's existing `retention-cron`.
There is **no cron entry committed** — `backend/railway.toml` has none. The jobs delete
correctly *when invoked*; that anything invokes them daily is external configuration I
cannot verify. **This needs a human to confirm on Railway before the retention promise is
made to a client.**

**§7's platform count has a view but no endpoint.** `staging.pahchan_org_usage` aggregates
correctly in `PROPOSED_064`, and **nothing reads it**. Not a leak — absence of an endpoint
is absence of exposure — but §7 is unfinished, and whoever finishes it must read the view
rather than the roster.

**`platform_owner` is excluded from every Pahchan biometric gate.** My
`_BIOMETRIC_PLATFORM_ROLES` deliberately mirrors `_review_gate`, which hardcodes
`platform_admin` only (`roles.py:74`) — the exact lockout `role_tiers.py:115-121` warns
about, listed as unowned in the coordination file. I matched the module's existing
behaviour rather than diverging from it in a security gate; **fixing it belongs in
`roles.py`, once, not in Pahchan.**

**Superseded reference photos are retained for the duration of employment.**
`purge_reference_photos` has no `replaced_at` clause, so a replaced photo's object survives
until the employee leaves. I judged this **correct, not a defect**: §5's promise is
"Employment + 45 days", the job deletes replaced and live rows alike for departed
employees, and the retained row is the audit trail for exactly the swap attack the schema
comment calls out. Recording it because it is the kind of thing a later reader will flag.

**Not done:** `frontend/src/lib/punch.js` (spec's "files to create") does not exist. The
contract lives in `mobile/src/offline/punchQueue.ts` and the router; there is no web punch
path, so a web-side contract module would have no caller. The web register detail view's
accuracy-radius-on-a-map (§3) is also unbuilt.

---

## 5 · Corrections to things I reported earlier

- I previously reported that `check-tokens.mjs` **exits 0 when run from the repo root**.
  **That was wrong** and I am retracting it. Both gate scripts call `process.exit(1)`; the
  0 I saw was `tail`'s exit status through a pipe. The coordination file flags three agents
  making this same mistake. The scripts are correct — do not "fix" them.
- My first report described the enrollment gate as "the widest biometric surface"; that is
  accurate, but I should have been clearer that a leaked `object_key` was **not** redeemable
  for an image, because no endpoint signs arbitrary keys. Corrected in 2.2.
