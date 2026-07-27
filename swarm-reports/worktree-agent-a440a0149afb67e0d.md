# Pahchan — STRUCTURE lens

Branch: `worktree-agent-a440a0149afb67e0d`, cut from `staging` (`e9134b2`).

**The worktree was created from the wrong base.** HEAD was `1aa4985` — 507 commits
behind `staging` and 13 commits ahead on an abandoned lineage (R2 signed-URL fixes
that staging already carries functional equivalents of, per `_COORDINATION.md` §3).
`frontend/src/pages/pahchan/` and `backend/routers/pahchan.py` did not exist on it.
Reset to `staging` before any work. **If your surface "does not exist", check your
base before concluding the brief is stale** — this is `_COORDINATION.md` §1 with a
different lineage.

Reference rendered, not read: `frontend/public/__ref/Pahchan v1.html` on the
`kartavya-frontend` preview. Nine sections confirmed live, `.rv__r` renders 15 rows,
`.rv__hd` reads `['', Person, Punch · reference pair, Time, Where, Verdict]`.

---

## 1 · Every screen, enumerated

Sources: `Pahchan v1.html` §01–§09 (driven by `PahchanClock.jsx`, `PahchanAdmin.jsx`,
`PahchanReview.jsx`, `PahchanData.jsx`), `ScreensPahchan.jsx` (the earlier full-module
mockup inside `Kartavaya Redesign.html`), `design-handover/07-pahchan.md`, and
`17-mobile-app.md`'s screen table.

| # | Screen | Reference | In the build | Endpoint |
|---|---|---|---|---|
| 1 | Clock in / out — immersive camera | §01 `PhClock` | `mobile/…/pahchan/ClockScreen.tsx` ✅ | `POST /punch`, `/punch/photo` |
| 2 | Degraded punch states (GPS off, weak, offline, no refs) | §02 `PhClock` variants | mobile ✅ | same |
| 3 | **The register** | §03 `PhRegister` | `pages/pahchan/Register.jsx` ✅ | `GET /register`, `PATCH /punches/{id}/review` |
| 3b | **Register inline detail** — three photos full size, map, metadata | §03 `.rv-det` | ❌ **`openId` is written and never read** | `/punches/{id}/photo` |
| 4 | Enrollment capture, two slots | §04 `PhEnroll` | `mobile/…/pahchan/EnrollScreen.tsx` ✅ | `POST /enrollment` |
| 5 | Enrollment approval queue | §04 `PhQueue` | `pages/pahchan/EnrollQueue.jsx` ✅ | `GET /enrollment/queue/pending`, `POST /enrollment/{id}/approve` |
| 6 | Two-tab shell — Clock · Me | §05 `PhMini` | `mobile/…/MeScreen.tsx` + `MyBiometrics.tsx` ~partial | `GET /me` |
| 7 | Privacy notice, six lines | §05 `PhNotice` | mobile — not audited here | none |
| 8 | Policy — geofence, flags, retention, reports | §06 `PhPolicy` | `pages/pahchan/PahchanPolicy.jsx` ✅ | `GET`/`PATCH /policy` |
| 8b | **Shift definition and overtime** (migration 082) | not in the v1 harness; `ScreensPahchan.jsx` `shifts` tab | ❌ **nine columns, no UI** | `PATCH /policy` |
| 9 | Monthly register + the photo-free email | §07 `PhReport` | ❌ none | `GET /me` |
| 10 | **History — month calendar, states, legend** | `17-mobile-app.md:129`, `ScreensPahchan.jsx` `my attendance` | ❌ **none, anywhere** | `GET /me` |
| 11 | **Corrections / regularisation** | `ScreensPahchan.jsx` `regularization` tab | ❌ **none** | `POST`/`GET`/`PATCH /regularisations` |
| 12 | **Push attendance to payroll** | new — no reference | ❌ **none** | `POST /attendance/publish` |
| 13 | Sites / geofence locations | `ScreensPahchan.jsx` `geo-fence` tab | ❌ none | `GET`/`POST /sites` |
| 14 | Platform console — one count | §08 | `AdminOrgsPage.jsx:572` renders it when the payload carries it ✅ | platform |

Web tabs today: **register · enrollment · policy**. Three.

---

## 2 · Verified: the register can verify again

The finding from the last pass — `Triple` initialised `urls.refs = []` and never wrote
to it, so reviewers approved against two boxes showing a loading ellipsis forever —
**has stayed fixed.**

- `GET /register` returns `reference_ids` (`pahchan.py:552-556`, `array_agg(r.id ORDER BY r.slot)`).
- `GET /enrollment/photos/{photo_id}/url` exists (`pahchan.py:741`), signs by row id,
  audits at `severity=warn`, and admits self **or** `_may_view_others_biometrics`.
- `Register.jsx:117` fetches it per reference id; `Triple` keeps a per-slot state
  machine (`load` | `ok` | `gone` | `err`) so a retention-deleted photo does not read
  as a permanent spinner.
- `EnrollQueue.jsx:46` uses the same endpoint, so HR now sees the face it is vouching for.

No regression. The per-image fetch is now a shared `usePhotoUrl` hook so the row triple
and the detail cannot drift apart, and each slot keeps its four-state machine —
`load | ok | gone | err` — so a retention-deleted photo never reads as a permanent
spinner.

---

## 3 · Live defects found, all in code nothing had ever called

### 3.1 · Every flag chip in the register showed the wrong word

`StatusChip`'s signature is `({ status, approvalStatus, columnName, columnColor })`.
There is no `label` prop. The register called:

```jsx
<StatusChip status={FLAG_TONE[f] || 'todo'} label={FLAG_LABEL[f] || f} />
```

so `label` was dropped on the floor and the chip rendered whatever `FLAG_TONE` mapped
to. The reviewer's only per-row summary of **why** a punch needed a look was:

| The flag | What rendered |
|---|---|
| `geo` — outside the site | **Requested** |
| `mock` — simulated location | **Rejected** |
| `accuracy` — weak GPS | **In Review** |
| `noref` — nothing to compare against | **Requested** |
| `reuse` — same photo on two punches | **Rejected** |

Four task-tracker nouns standing in for six attendance conditions, two of which
(`mock`, `reuse`) imply intent and two of which (`accuracy`, `noref`) explicitly do not.
`EnrollQueue` lost its two labels the same way, so an employee nobody has photographed
yet was being shown to HR as **Rejected**.

Fixed where `07 §"Attendance states are not in statusColors.js"` says to fix it — a
sixth map, `PUNCH_COLORS` / `PUNCH_LABELS`, folded into `StatusChip`'s own map. The two
private maps on the register are deleted and the raw flag is passed through. No punch
key collides with a task or approval state.

### 3.2 · `GET /regularisations` returned 500 on every call

```sql
SELECT r.id, r.employee_id, e.full_name, …
  FROM staging.pahchan_regularisations r
  LEFT JOIN staging.manav_employees e ON e.id = r.employee_id
```

`staging.manav_employees` has no `full_name`. Migration 018:181 names it `name`;
`full_name` exists only on `staging.manav_candidates` (migration 037:19, recruitment).
`UndefinedColumnError` on every request. `/register` two files over already does
`e.name AS employee_name`, which is now what this does too.

### 3.3 · A correction could be approved but never declined

`RegularisationDecision.status` matched `^(approved|rejected)$`. Migration 064:170:

```sql
status TEXT NOT NULL DEFAULT 'pending'
       CHECK (status IN ('pending', 'approved', 'declined'))
```

`rejected` is not a value the table can hold, so `PATCH` with it was a CHECK violation
surfacing as a 500. Approve worked; decline did not. Now `declined`.

### 3.4 · A decline with no reason was a 500, not a sentence

064's `pahchan_reg_decline_needs_reason` requires a non-empty `decision_note` on a
decline. `decision_note` was `Optional` and unvalidated, so the constraint name reached
the caller inside a 500. `17-mobile-app.md:130` asks for "decline gated on a reason".
Now a 400 with the sentence, and the UI gates on it too.

**3.2, 3.3 and 3.4 are all in `routers/pahchan_attendance.py`, which no client had ever
called.** They were found by building the screen, not by reading the file — reading it
shows three plausible handlers.

### 3.5 · The geofence has never existed for any organisation

`GET`/`POST /sites` existed and nothing called them, so `staging.pahchan_sites` is empty
for every org. Follow that through:

```
_nearest_site()  → (None, None) on an empty table
create_punch()   → distance_m stays None
_compute_flags() → `if distance_m is not None and site_radius_m is not None`
                   never fires
```

So the `geo` flag has only ever meant *"location was off entirely"* and never *"outside
the site"* — while `PahchanPolicy` offered **"Geofence radius — how close to a site a
punch has to be"**, a setting for a thing that could not be created. Built (§4).

### 3.6 · `staging` has not built since `8131f24` — NOT MY SURFACE, FIXED ANYWAY

`npx vite build` fails at `DristiPage.jsx:581`:

```
Expected ")" but found "columns"
```

A `{/* … */}` comment was placed inside a ternary branch. That is an **expression**
position, not a JSX children position, so the braces parse as an object literal. It
takes the **whole bundle** down, not that page — a Vercel deploy from `staging` fails,
and every gate downstream of a bundle is unrunnable.

Fixed by removing the braces; the comment is correct and stays. Flagged here because the
commit that introduced it (`8131f24`, a sibling's genuine `cols`→`columns` fix) reads as
a careful change and its own gates would have been `check-tokens`/`check-classes`, which
do not parse JSX. **`vite build` is not in the run's stated gate list and should be.**

---

## 4 · What was built

| Screen | File | Endpoint |
|---|---|---|
| Register detail — three photos full size, accuracy geometry, metadata | `pages/pahchan/Register.jsx` | `/punches/{id}/photo`, `/enrollment/photos/{id}/url` |
| Register day picker | `pages/pahchan/Register.jsx` | `GET /register?on=` |
| Shift and overtime policy | `pages/pahchan/PahchanPolicy.jsx` | `PATCH /policy` |
| Sites / geofence | `pages/pahchan/Sites.jsx` | `GET`/`POST /sites` |
| Corrections | `pages/pahchan/Corrections.jsx` | `GET`/`PATCH /regularisations` |
| Payroll push | `pages/pahchan/PublishPayroll.jsx` | `POST /attendance/publish` |
| History — month calendar, states, legend, day detail, retention promise | `pages/pahchan/History.jsx` | `GET /me` |

Web tabs: **register · corrections · payroll · my attendance · enrollment · policy**.

### The register could only ever show today

`GET /register` has always taken `?on=` and nothing sent it. A reviewer away on Friday
had no route back to Friday, and those punches sat until the seven-day auto-accept
swallowed them. Now a date input capped at today — a register for tomorrow is always
empty, and its empty state would tell a reviewer that nobody has clocked in, which is
true and useless. Both empty states are day-aware: *"Nobody has clocked in **yet**"* said
to somebody looking at last Tuesday reads as a page that has not finished loading.

### The detail draws its own geometry rather than loading a map

The prototype (`PahchanReview.jsx:58-75`) uses Leaflet against
`tile.openstreetmap.org`. This does not, and the reason is not that the dependency was
inconvenient. **A tile request puts the employee's punch coordinates in a URL path to a
third-party host, on every detail open.** §7 will not let Aekam — who runs the product —
resolve a location; shipping the same coordinates to a public tile server would be a
strictly worse leak than the one the spec forbids.

What survives is what the map was FOR. §3: *"the accuracy figure is drawn as a radius on
the map, not a dot — a dot makes a ±184m fix look like proof of presence, which is the
one thing it is not."* The SVG puts the site at one end of a scaled baseline and the
punch at its distance, with the accuracy as a filled circle underneath the marker, so a
±184m fix at 412m visibly overlaps the site and settles nothing either way. Which is
the honest reading.

`GET /register` now also returns `lat`/`lng`, behind the same reviewer gate as the rest
of the row.

### The payroll push will not write before it has been previewed

`dry_run` is the endpoint's own idea and this screen enforces the order: Publish is
disabled until a preview of **that exact range** has come back, and editing either date
re-arms it. A preview whose figures the operator never saw is not a preview.

Withheld days get their own table with the reason. A day whose punches are flagged and
unreviewed builds no row at all — the bridge refuses, because emitting `absent` would
assert somebody did not work on the strength of a punch nobody has looked at, which is
07 §3's manufactured verification pointed at payroll instead of at a checkmark.

### History never renders "absent"

`/me` returns punches, not a muster roll. An empty day can be leave, a weekly off, or a
punch still queued inside the 72-hour offline buffer. Colouring it red would be the same
manufactured fact, with the employee on the wrong side of the argument. Days with no
punch read "nothing recorded", which is what is actually known.

§9's retention promise is on the same screen, from the same request — 90 days for punch
selfies, 45 after leaving for the reference pair, 3 years for the record because the
register is a statutory document. "Someone whose face is photographed twice a day should
be able to see what is held and for how long without asking."

---

## 5 · Gates

Run from `frontend/`, unpiped, per `_COORDINATION.md` §2.

Measured on `a2e6c804`, the merge that carried this work onto `staging`.

| Gate | Result |
|---|---|
| `node scripts/check-tokens.mjs` | 344 declared, 239 referenced, **0 missing** |
| `node scripts/check-classes.mjs` | 2264 selectors, 1560 classes, **0 missing a rule** |
| `npx vite build` | **succeeds** — it did not before §3.6 |
| `npx vitest run` | **560 passed / 34 files, 0 failed** |
| `python -m pytest` (backend) | **1263 passed, 3 failed** — pre-existing, see §5.1 |

## 5.1 · ⚠ `staging` IS RED, and it is not this branch — Sanvaad cross-org isolation

`backend/tests/test_separated_duty.py`, three failures:

```
test_cannot_add_a_user_from_another_org_to_a_channel   assert 403 == 404
test_cannot_open_a_dm_with_a_user_from_another_org     assert 403 == 404
test_same_org_check_queries_user_roles_with_the_callers_org
    assert 'staging.user_roles' in
      'SELECT role FROM staging.org_member_modules
         WHERE user_id=$1 AND org_id=$2::uuid AND module_code=$3'
```

**Not mine, and it predates my push.** Both halves were already ancestors of
`ee89543e`, the staging tip before me — verified with `git merge-base --is-ancestor`:

- `0e7b4bf8` *feat(sanvaad): the viewer level refuses…* changed `messaging.py`'s
  same-org check to read `staging.org_member_modules`.
- `fc87be50` *test: pin separated duty and cross-org refusal…* pins that it must read
  `staging.user_roles`.

Two green branches, one red integration — the same shape as the invite test above, but
this one is **a tenancy control, not a label**. `architecture_tenancy` records
`user_roles` as the sole tenant path. A same-org check answered from a module-grant
table is answering a different question: "does this user hold a grant on this module"
is not "is this user in my org", and the two diverge for any member with no grant row.
The `403 == 404` pairs suggest the refusal currently still happens — but for the module
reason rather than the org one, which means the isolation is incidental rather than
enforced.

**Deliberately not fixed here.** It is a cross-org isolation control on a surface I do
not own, the owning agent is active in it right now, and `_COORDINATION.md` §5 already
records unresolved ownership in exactly this area. Guessing at a security check to turn
a suite green is how a real hole gets papered over. **This needs the Sanvaad owner or
the coordinator.**

### The palette snapshot — resolved by a sibling mid-run

`visual-regression.test.jsx > semantic-palette` failed on `--outline` for most of this
session (`#ADA692` → `#78725F` light) because a sibling moved the token and did not
re-record the baseline. I left it alone on purpose — re-recording someone else's visual
baseline silently ratifies a palette change nobody reviewed, which is the one thing that
snapshot exists to prevent. Someone else re-recorded it deliberately and it is green now.

The two `Unhandled Rejection`s vitest reported earlier came from `task-flow.test.jsx` via
`TaskDrawer.jsx:168` (`r.data.forEach` on a mock returning a non-array). Also gone.

### Two siblings fixed things this branch also fixed

Both landed while this was in flight, and both are worth knowing about because the
resolutions were not symmetric:

- **`8131f24`'s build break (§3.6)** — fixed identically by a sibling. Took theirs.
- **The flag pills (§3.1)** — `4b64d6f` added a `label` prop to `StatusChip`; this
  branch instead folded `PUNCH_*` into `STATUS_MAP`, which is what 07 asks for by name.
  **Kept both, because they are not duplicates.** `label` is the general escape hatch for
  any caller; the map is what makes the register correct with no override at all. Their
  comments each falsified the other's and were reconciled.

### One integration break, fixed: `Invoicing` → `Finance`

`ab740fc` renamed Ganit to **Finance** (the module holds expenses, payables, bank and
contracts, so "Invoicing" named a tenth of it — `_DESIGN-GAP.md` #2 settled the way it
says to settle it). `auth-invite-expiry.test.jsx` asserted the literal `'Invoicing'`.
Both landed green; staging went red where they met.

Fixed by asserting through `moduleMeta()` rather than swapping one literal for another.
The claim that test makes — its own comment says so — is *"the screen shows the product
name rather than the code"*, not *"the product name is Finance"*. A literal restates the
registry and goes stale at the next deliberate rename; reading it cannot. A sibling fixed
the same line with a literal concurrently; the registry version won the merge and their
reasoning was folded into the comment.

**This is now the third instance of the same failure mode in one session** — two green
branches, one red integration, nobody at fault. §5.1 is the fourth and it is a security
control. Worth a coordinator note: the swarm has no pre-merge integration gate, and the
per-branch gates cannot see it by construction.

`frontend/node_modules` had to be installed to run the last three. **`npm install`
rewrote both `package-lock.json` and `yarn.lock`** — restored with `git checkout --`
before any commit, per §9. Worth knowing before the next agent installs.

---

## 6 · Still open on this surface

| # | Gap | Why it was left |
|---|---|---|
| 3b | The detail re-signs its three photos rather than reusing the row's URLs | Each view is audited `severity=warn` deliberately. A second, larger viewing IS a second viewing, and recording it is correct |
| 7 | Privacy notice (§05 `PhNotice`) on web | Mobile owns the first-run notice; not audited here |
| 6 | Two-tab shell — Clock · Me | Mobile's `MeScreen` + `MyBiometrics` cover part of it. `17-mobile-app.md` §"attendance-only shell" is a nav-structure change, not a screen |
| 13 | Sites have no edit or delete | The backend has neither, and it is not a UI decision: moving a site retroactively changes whether punches **already reviewed** were inside it |
| — | Reports (§07 `PhReport`) — monthly register table + the photo-free email preview | `History` covers the employee's own month. The org-wide monthly register and the email preview are a reporting surface, not an attendance one |
| — | `POST /regularisations` has no employee-facing form on web | The reviewer half is built. The request half belongs with the two-tab shell, where the person who needs it actually is |
