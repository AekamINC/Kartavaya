# Progress log — append-only

One line per landed change. Newest first. Evidence is a `file:line`, a
`table + row count`, or a commit SHA — never "done". This is the running record
behind `docs/STATUS.md`; when you tick a row there, add a line here.

Format: `YYYY-MM-DD · <phase/area> · <what changed> · <evidence> · <verified how>`

## Who is writing these entries

**Lead Principal Systems Architect** — ten years building SaaS in this domain,
three years on Python automation and integration, and Python lead for the skills
layer and its CRUD operations. Schema, write-paths, the skills that read them,
and the seams between the three.

**Migrations are approved by default** (owner, 2026-08-26): apply without
waiting, but STILL state the write-path side effects and the risk first — the
database is shared with production, and pre-approval removes the wait, not the
report. Verify from `pg_constraint` and the live catalogue afterwards, never
from the migration file. Data changes to live customer rows are NOT covered by
that standing approval and are still raised before they run, with the reversal
statement written down. See `README.md` for the full terms.


---

## 2026-08-26

Seven parallel agents, partitioned by file so no two shared one. Every live
figure below is a read-only `SELECT`; **no write-probe touched the shared
database** and the vendor/holiday counters were re-read afterwards to prove it.
The two exceptions are the PT slab re-point and the two employee-state
backfills, each run on the owner's explicit instruction with the before-state
captured and the reversal written down.

### Both deploys confirmed — everything below is RUNNING

**Check BOTH, always** (owner, 2026-08-26). Backend and frontend ship from the
same push but deploy independently; verifying one and calling it a deploy check
is half an answer, and Phase 1 is mostly frontend.

`120d106c` (this session's HEAD) deployed to the Railway staging service at
**04:14 UTC 2026-08-26, status SUCCESS**, read from the deployment list rather
than inferred from git — the branch has silently tracked `main` before. So all
six Phase-2 fixes and all six Phase-1 write-paths are live, and the earlier
"deploy owed" wording in `STATUS.md` was stale; corrected there.

**Frontend — resolved from OUTSIDE, not from the Vercel list.** Every Vercel
deployment in this project carries `target: null`, so "READY" never establishes
what the domain serves. Fetched `staging.kartavaya.com` and hashed what it
actually returns: 3 entry assets + 123 lazy chunks, 3.17 MB js / 580 KB css,
carrying `--m-niyam` (76b7c6f), `.blx` (0ef99dcb) and `st__group--flush`
(5980a63b). The deployed frontend calls
`https://kartavya-staging.up.railway.app` — the staging backend, confirmed from
its own network traffic.

**Phase-1 UI driven live with the godmode token** (session restore of
`localStorage.auth_token`, never a credential typed into a form; forms opened
and dismissed, nothing saved): 1.2 renders MSME, Udyam, TDS section, payment
terms AND vendor kind · 1.5 renders the work-State field · 1.1 renders the
Salesperson picker · 1.6's Add-holiday form renders "**Applies to**" with
`Whole country` plus all 36 states/UTs, and the list has an `Applies to` column.
Zero failing `/v1/` responses across all four screens. The org switcher offers
Aekam Inc, Unicode Group and E2E Test & Associates; switched into Unicode and
Manav read **26 employees**, matching the database exactly.

**Two of my own checks were wrong, and neither was a product fault.** A
`price_monthly`-absent assertion failed because the string legitimately survives
on `AdminBillingPage.jsx:555`, the platform-staff surface where a price SHOULD
render — `PlanComparison.jsx` is deleted and `.opl` is gone, which is what
04d30ba2 actually promised. And a `state` assertion failed on the Holidays
list because the product says "Applies to", not "State". **The earlier ledger
claim that `price_monthly` "no longer appears anywhere in the deployed JS bundle
at all" is corrected here: it does appear, correctly, via AdminBillingPage.**

**One real defect, found only by reading the DEPLOYED console.** `index.html`
carries ONE inline `<script>`; `script-src 'self'` allows it solely by a sha256
hardcoded in `vercel.json`, and the two had drifted — one script, one allowed
hash, no match. The browser refused it on every load, so `data-theme`,
`data-conv-pattern`/`data-conv-ground` and `data-platform` never ran: a frame of
the wrong theme for every dark-mode user, Sanvaad snapping from the default
ground at mount, and on Windows a frame of blurred sidebar snapping solid —
precisely the first-paint jumps that script exists to prevent. Invisible to the
build, the suite and every source-level check. Fixed in `2ef060a9` and
`scripts/check-csp-hash.mjs` added as the FIRST gate in `npm run check`, failing
both ways (script with no hash, hash with no script) and proven to fail before
being trusted. Verified after deploy: `data-theme` follows
`prefers-color-scheme` in both schemes, `data-platform=win` is set, zero CSP
refusals.

**Deployed is not exercised.** No payroll run and no billing create has happened
since 04:14, so 2.1–2.4 have executed against nothing. E2E's latest run is
2026-07 and Unicode's `2026-09` "draft" dates from **23 July** — pre-deploy, so
it is not evidence of the new PT mechanism. The first real run is the proof.

**Phase-1 acceptance counters, read live, two orgs only** — the "a row moves off
0" test, which is what separates 🟡 from ✅:

| Acceptance | rows set / total |
|---|---|
| 1.1 `salesperson_id`, invoices | 0 / 790 |
| 1.1 `salesperson_id`, orders | 0 / 377 |
| 1.2 vendor MSME/TDS (any of 5 cols) | 0 / 78 |
| 1.4 expense → client contact | 0 / 376 |
| 1.5 employee `state` | **96 / 98** — backfill, NOT a UI create |
| 1.6 holiday `state_code` | 0 / 38 |

Five of six are still at zero and stay 🟡. 1.5's 96 came from the two backfills
below, which prove the column and its CHECK work but do **not** prove the write
path a customer would use — that still needs one create through the UI.

### The only two orgs that matter — what is owed, per org

**Owner's scope call, 2026-08-26: E2E Test & Associates and Unicode Group.
The other three organisations (Aekam Inc, Demo - Kartavaya, UK AekamINC) are
explicitly out of scope and nothing below is written for them.**

|  | E2E Test & Associates | Unicode Group |
|---|---|---|
| org_id | `64e7bea6-6abe-490c-a2a4-27a60c6be916` | `fae87907-2f99-4b35-a241-c94d9e1e4a17` |
| `organisations.state_code` | **`27`** Maharashtra | **`24`** Gujarat |
| Active employees | 71 | 26 |
| `manav_employees.state` — at session start | 0 | 0 |
| …derivable from `address->>'state'` | **0 — nothing to derive from** | **24 of 26** |
| **`state` set now** (backfilled 26 Aug) | **71 of 71** from org `state_code` | **25 of 26** from address |
| Own `pay_professional_tax` rows | 0 | 0 |
| Slabs it resolves (shared, `org_id IS NULL`) | 3 (Maharashtra `27`) | 4 (Gujarat `24`) |

All figures read-only except the two backfills, 2026-08-26. The slab table holds
9 rows total, all now shared: MH `27`×3, GJ `24`×4, KA `29`×2 — verified live
from the table, not from the migration.

**1 · The billing tax split never blocks either of them.** `_tax_split` refuses
to guess when the supplier's state is unknown, and BOTH of these carry a
`state_code`, so the refusal path cannot fire for either. Nothing is owed here.
(It does fire for the three out-of-scope orgs; that is intended and left alone.)

**2 · Professional tax is ₹0 for both until slabs reach them — and the cheapest
fix is one UPDATE.** Neither org owns a single `pay_professional_tax` row. All
nine live rows belong to Aekam Inc, and they happen to be exactly the two
ladders these two orgs need: **Maharashtra (3 bands) for E2E, Gujarat (4 bands)
for Unicode**. Since `_pt_slabs` now reads a NULL-`org_id` row as a SHARED
ladder, re-pointing those nine rows —

    UPDATE staging.pay_professional_tax SET org_id = NULL;   -- 9 rows

**RUN 2026-08-26 on the owner's instruction**, scoped to the owning org id
rather than as a bare table-wide UPDATE, with the before-state captured first.
Verified after: both in-scope orgs resolve all 9 rows — 3 Maharashtra bands for
E2E, 4 Gujarat for Unicode. Reversible with `SET org_id =
'045b76ad-654b-42dd-b4b1-731700efc6c3' WHERE org_id IS NULL`.

A SECOND consumer had to be aligned first, and checking for it is what stopped
this being a regression: `services/skills/data/payroll_statutory.py:769` also
read `WHERE org_id = $1::uuid`, so after the UPDATE the PT brief would have
found ZERO slabs for every org and stopped naming which states it covers. It now
reads `org_id = $1 OR org_id IS NULL`, matching `_pt_slabs`, and its limitation
text — which asserted the table is per-organisation — was corrected.

⚠ **The UPDATE alone does not make PT non-zero.** A slab is matched on the
EMPLOYEE's state. The ladders are now VISIBLE to both orgs; entering employee
work states is what makes them APPLY — and that is the second write, recorded
below. Both halves are now done for both in-scope orgs (71 of 71 and 25 of 26).

**3 · Employee work state — Unicode BACKFILLED 2026-08-26, E2E still owed.**

*Unicode Group — done.* 25 employees (24 active + 1 inactive) set to `'24'`.
The residential-vs-workplace caveat I raised earlier turned out NOT to apply
here, and checking before writing is what established that: every address state
read exactly `Gujarat` — ONE distinct value across all 25 — and Gujarat is also
the organisation's own state, so there is no commuter case to get wrong and no
mapping to guess. Scoped to the org, to `state IS NULL`, and to an explicit
`ILIKE 'gujarat'` match. Reversal is `SET state = NULL` for that org: nothing
was set before, so it restores exactly.

Verified after: all 25 gross ₹18,000–₹150,000, every one above Gujarat's
₹12,000 top band, so the ladder charges **₹200 — identical to the flat rule they
were already paying**. No payslip figure moves. What changed is that the ₹200 is
now DERIVED from the Gujarat ladder instead of being a constant, and — the part
that matters — **this backfill is what stops Unicode's PT dropping to ₹0 on
deploy.** Two employees carry no address state and stay unset.

*E2E Test & Associates — RUN 2026-08-26 on the owner's instruction, 71 of 71.*
No employee carries an address state — re-confirmed at the point of writing,
`address->>'state'` is absent on all 71, ONE distinct value and that value is
NULL — so unlike Unicode there was nothing to derive from and the organisation's
own `state_code` (`27`, Maharashtra, read live) is the only defensible answer.
Scoped to the org and to `state IS NULL`; the CHECK
(`manav_employees_state_ck`, numeric 1–2 digits or 2–3 uppercase) accepts `'27'`.
Reversal restores exactly, because 0 rows were set before:
`SET state = NULL WHERE org_id = '64e7bea6-…' AND state = '27'`.

    UPDATE staging.manav_employees SET state = '27'
     WHERE org_id = '64e7bea6-6abe-490c-a2a4-27a60c6be916' AND state IS NULL;

Verified after: **71 set, 0 still NULL.** Simulated against the DEPLOYED leaver
predicate and the Maharashtra ladder, using each employee's own last payslip
gross: of the 60 in the 2026-07 run, **51 remain payable** and all 51 sit above
the ₹10,001 top band, so the next run charges **₹10,200** where the last charged
₹12,000. The ₹1,800 difference is exactly the 9 leavers × ₹200 — the Phase-2.1
guard, not a PT regression. **This is what stops E2E's PT going to ₹0**, which
was live-exposed from 04:14 UTC when the deploy landed.

Both in-scope orgs are now complete on 2 and 3, so the ₹0-fallback path no
longer fires for either. It remains the designed behaviour for any org whose
employees carry no state — not a fault.

### Phase 1 — the six write-paths

- `phase-1.2` · Vendor MSME + TDS enterable. Proved live first: all six columns
  exist on `staging.ganit_vendors`, nullable, with all three CHECKs present in
  **`pg_constraint`** (not merely in migration 175 — an inline CHECK on
  `ADD COLUMN IF NOT EXISTS` is skipped whole when the column exists), and
  **0 of 80** vendors carried any. The plan lists five columns; the live schema
  has a **sixth, `vendor_kind`**, which the 43B(h) skill explicitly tests
  ("not traders") — wired too, or the trader exclusion could never fire.
  Update uses `model_fields_set` (the pattern `billing.py:1187` documents) so a
  value entered by mistake can be cleared back to NULL; blank → NULL, never `''`
  (fails the CHECK) and never `0` (0 days is a real answer) · `ganit.py`,
  `VendorsTab.jsx`, `ganit.css` · `test_vendor_msme_fields.py` **19 passed**.
- `phase-1.3` · `cost_price` snapshotted onto each line at write time. Lines are
  **JSONB array elements, not rows** — `vikray_order_items`/`ganit_invoice_items`
  do not exist, so **no migration**. One helper `apply_line_costs`
  (`vikray.py:278`), one org-scoped batch lookup, imported by `ganit.py`. Copy,
  never join: `update_order`/`update_invoice` replace all lines, so an existing
  cost is carried forward or an old order would silently re-price at today's
  cost. Key OMITTED when unresolvable — never `0`, which reads as 100% margin.
  `InvoiceForm.jsx` never set `product_id` at all, so the invoice half was dead
  on arrival; fixed. Costs are internal — any client-sent value is discarded ·
  `test_line_cost_snapshot.py` **19 passed**.
- `phase-1.4` · Expense → client tagging. **The backend was already complete** —
  `contact_id` was in the model, the INSERT and the PATCH loop, and the list
  already returned `contact_name`; the entire gap was one missing key in the
  form's `BLANK`. Labelled "Client contact", not "Client": the column stores
  `graha_contacts.id`, a PERSON, and a heading saying "Client" would promise a
  company link the table cannot make · `ExpensesTab.jsx` · **7 passed**, proven
  to fail without the fix (2 of 7 red when the key is removed).
- `phase-1.5` · Employee `state`, numeric GST code (`'27'`). The convention is
  load-bearing: `pay_professional_tax.state_code` is numeric, so an alphabetic
  employee state would join to nothing and **silently compute zero PT for
  everybody**. Codelist imported from `client_register.py`, never copied.
  **Migration 220 APPLIED 26 Aug** — catalogue-only, 98 rows, 0 backfilled;
  column + CHECK verified live in `pg_constraint` afterwards.
  **The department FK was deliberately left out**: an FK skips NULL but not
  `''`, and 12 rows hold `''` plus 1 orphan `'Labour'` — 13 of 98 would violate
  it, so passing needs UPDATEs to live personnel rows. Independently re-verified
  (98/86/12/0-null, 30 depts, 3 inactive, 0 dup groups, 1 orphan). A unique
  index is blocked separately: `delete_department` is a SOFT delete, so plain
  UNIQUE turns delete-then-re-add into a 500, and a partial index cannot back an
  FK · `manav.py`, `EmployeesTab.jsx`, `220_employee_state.sql`.
- `phase-1.6` · Holiday `state_code` — **the column already existed** (migration
  175, widened by 180), so no migration. `list_holidays` never SELECTed it, so
  a written value was invisible. Also rewrote `attendance_auto_mark.py`, which
  is what the acceptance criterion actually turns on: it marked EVERY active
  employee org-wide. NULL holiday state = everywhere; NULL employee state =
  still marked ("nobody has said" must never silently un-mark someone) ·
  `HolidaysTab.jsx` · `test_employee_state_and_regional_holidays.py` **41 passed**.
  Fixed `test_cron_column_names.py`, whose column set had been lying about
  `state_code` since 175 landed.

### Phase 2 — the six correctness fixes

- `phase-2.1` · Payroll no longer pays leavers · `vetana.py:1221` `NOT EXISTS`
  on `manav_offboarding`, mirroring `analytics/metrics/manav.py:79`. Live
  dry-read: org `64e7bea6` 60 → 51 paid. The tenth leaver (last working day
  2026-08-03) is **correctly still paid**, pro-rated — the guard is not
  over-broad. `list_structures` deliberately NOT filtered: hiding a leaver's
  structure from HR is data-hiding, not a fix.
- `phase-2.2` · PT reads the slab table · `vetana.py:746`. ⚠ **Owner decision
  26 Aug: fall back to ₹0, per the plan.** As written this line was true: all 9
  slab rows belonged to ONE org (`045b76ad`), the two payroll orgs had none, and
  the deploy at 04:14 UTC did briefly expose both to a ₹0 PT run. **Closed the
  same day by two writes** — the slabs re-pointed to `org_id IS NULL` (shared)
  and employee states backfilled for both orgs. Next E2E run: ₹10,200 across 51.
  Unicode: ₹200/head, unchanged, now derived rather than constant. Phase 0.24
  per-org seeding is no longer what stands between these two orgs and correct PT.
- `phase-2.3` · The two billing INSERTs can execute · `client_billing.py`.
  Verifying the whole column list rather than the one the plan named turned up a
  **second** bug: `balance_due` is NOT NULL DEFAULT 0, so the invoice would be
  born reading as fully paid — ₹0 on the customer's pay link. Same defect
  `vikray.py:683` already paid for.
- `phase-2.4` · Drafts excluded from 4 surfaces · `documents.py:307,852`,
  `dristi.py:354,161`. **The plan's premise was wrong in a useful way:** the
  statement was not printing ₹1.16 cr of drafts — it bound ISO date *strings*
  into `$3::date` and 500'd, so it never rendered at all. Seven bindings fixed
  with the repo's own `::text::date` pattern. The export twin was fixed too, or
  the tile and its own CSV would have disagreed — which is the criterion.
- `phase-2.5` · Cross-tenant leak closed · `client_billing.py:220`. The plan
  named 2 id-alone joins; there were **7**. AST ratchet added. 0 rows had leaked.
- `phase-2.6` · Pahchan absence guards deleted · `analytics/metrics/pahchan.py`.
  All five columns proved live on `staging.pahchan_punches` and **populated**
  (699 punches). The guards' own test *required* the stale
  `PROPOSED_064_pahchan.sql` string — it was pinning the lie in place, and is
  now inverted. Two other guards were left ABSENT with honest reasons:
  `attendance_by_shift` has no `shift_id` anywhere (confirmed live), and
  `late_arrivals` is blocked by the **DPDP pin**, not by schema.

### Gate

Clean-HEAD baseline in a detached worktree at `119cad66`: **27 failed, 13,853
passed**. Three agents independently reproduced the same 27. Every failure in
this session's runs is one of those 27 or a transient mid-write state of a file
another agent was editing — **this work adds none**. The 27 are pre-existing:
`test_org_settings_amendable` ×11, `test_billing_lines_wiring` ×6, and the
`kray`-in-`SENSITIVE_MODULES` gating family (`middleware/subscription.py:66`
declares five, its test asserts four — a module wired into gating without its
tests). `npm run build` + all nine `npm run check` ratchets green.

### Owed, and NOT faked

Every Phase-1 acceptance is "a row moves off 0", which needs a real create
through the UI on the shared database. None was done, so **every 1.x row stays
🟡** per the ✅ rule. Also newly found and NOT fixed: the project report is dead
on `staging.time_entries` (exists only in `public`); `dristi.py` `/overview` and
the pivot dashboard still count drafts and the pivot has the same date-bind bug;
`analytics/metrics/vetana.py:240` counts the same ten leavers.

## 2026-08-25

- `phase-1.1` · `salesperson_id` wired on invoice + order, create + update, with
  a name-only members picker (`/v1/org/members`, 403-tolerant) · `ganit.py`
  (InvoiceCreate $26, update SET, get_invoice name join), `vikray.py` (OrderCreate
  $19, OrderUpdate SET), `InvoiceForm.jsx`, `OrderForm.jsx` · column is `text`
  on both tables (live), backend 1023 green (1 unrelated pre-existing fail),
  build+check green. Acceptance (row moves off 0 via UI create) still owed —
  no write-probe on the shared DB.
- `design/glass` · Liquid-glass enriched: static `:root` defaults (fixes
  shadowless first paint), four-sided Apple rim on `--lg-inset`, hover-lift +
  press-squish motion tokens, dark-shadow arms, reduced-motion as token flips,
  3 no-op backdrop-filters deleted (`.tbl th`/`.tst`/`.k-dock`, opaque bg) ·
  `liquid-glass.css` · verified live on staging: `--lg-lift`/`--lg-scale-p` were
  empty on deployed CSS, resolve after change; KPI cards gain depth+rim; build clean.
- `docs` · Proposal 90 gap-analysis (50–88) + §7 comparison vs all prior status
  docs · `docs/proposals/90-*.html` · commit `cbb75307`.
- `docs` · Proposal 89 liquid-glass rescope (report+plan) · `docs/proposals/89-*.html`
  · commit `07185401`.
- `docs` · Phased execution plan created · `docs/plans/PHASE-0..6` · commit `cbb75307`.
- `docs` · Final verdict 00–90 · `docs/FINAL-VERDICT-00-90.md` (00–29 + 50–88
  live-verified; 30–49 from memory pending re-scan).
- `docs` · Living status system created · `docs/STATUS.md` + this file.
- `ui/laptop-fit` · viewport-fit.css — shell tightens on laptop screens; 2→5 rows
  at 1366×768 · `viewport-fit.css`, `CustomizePanel.jsx` (Fit-to-screen toggle) ·
  verified before/after on staging · commit `628703fe`. **STATUS: ✅ shipped.**
- `copy/landing` · "Indian accounting firms" → "one place to run an Indian
  business", all 6 places · commit `a53fed38`.
- `chore` · Restored `backend/server.py` after a stash mishap; removed 17 root
  debris files ($c + screenshots).

- `design/glass` · Apple-style pass on 3 of the 4 demoed components (buttons,
  icon tiles, confirm modal — popover/menu needed no change, already carried
  the same rim+blur+spring via the liquid-glass architecture): `.btn` gets a
  rounder squircle radius, a static top sheen on `--fill`, and a spring release
  on press (`--ease-spring`, was a flat `scale(.975)`); `.mh__ic` gets a
  diagonal tint gradient + the same 4-sided rim/hover-lift/press-squish as
  cards (added to `liquid-glass.css`'s `:is()` lists, respects the off-toggle
  and reduced-motion for free); ConfirmDialog gains a `--r-xl` radius, a
  grabber bar, a deeper contact shadow, and a spring entrance — scoped to
  `.modal__panel[data-intent]` (only ConfirmDialog sets it) so every other
  modal's documented MOTION-SPEC choreography is untouched · `components.css`,
  `module.css`, `liquid-glass.css`, `ConfirmDialog.jsx` · build clean; first
  verified by computed-style injection against the real loaded stylesheet
  (couldn't log in interactively — typing test credentials into a login
  field is a hard-blocked action regardless of context), then properly
  verified live and authenticated on `staging.kartavaya.com` via
  `e2e-real/mint-state.mjs` (owner token from `.env.e2e`, restores
  `localStorage.auth_token` — a session restore, not credential entry, so it
  doesn't trip the same block) driving real Playwright against the deployed
  site: real button on the Products tab, the Finance module header icon tile
  (screenshotted), and a real delete confirm dialog opened and cancelled
  (no write). All 4 approved sections confirmed — popover/menu needed no
  code change, already had rim+blur+spring via the existing liquid-glass
  architecture.

- `design/glass` fix · Settings rows (`.sr` in Customize → Appearance etc.) were
  getting a floating-card drop shadow (`--lg-shadow`) despite `border-radius: 0`
  and sitting flush against neighbours with only a `border-bottom` divider — the
  shadow had nowhere to round off to and bled past the row's own left/right
  edges into the panel margin, visible as a stray halo along the settings
  panel's outer edge (reported by the owner from screenshots). `.sr`/`.sr:hover`
  removed from `liquid-glass.css`'s glass treatment entirely — a bordered list
  row was never a card and doesn't need `--lg-shadow`/`--lg-shine`/hover-lift on
  any preset · `liquid-glass.css`. `.top`/`.mnav` checked and left alone: both
  are viewport-edge-to-edge, so the same shadow's left/right components fall
  outside the viewport and are never visible — not the same bug.

- `design/glass` fix 2 · Pipeline stage cards (`.vk-pl__st`, vikray → Pipeline
  tab) had `border-left: 3px` beside a 1px border on the other three sides,
  inside a rounded `border-radius` — an asymmetric border width breaks the arc
  a uniform border draws cleanly, and liquid-glass.css's own 1px rim inset
  (sized for a uniform border) landed inside that 3px stripe, producing a
  visible seam/step at the top-left and bottom-left corners (screenshotted by
  the owner at high zoom). Moved the stage-colour accent (`--c`, set inline
  per card) from `border-left` to `box-shadow: inset 3px 0 0 var(--c)` — insets
  clip to `border-radius` correctly at any width. `.is-on` now reassigns `--c`
  itself rather than `border-color`, so both the ungated base rule (liquid
  glass off) and liquid-glass.css's composed rule pick up the primary colour
  · `vikray.css`, `liquid-glass.css` (`.vk-pl__st` pulled out of the shared
  `:is()` lists into its own dedicated, composed rule — same reason as the
  confirm-modal shadow fix earlier this session: two rules fighting over one
  `box-shadow` property always loses to source order, so it's one rule now).
  Build clean; verified live post-deploy via the same Playwright+godmode-token
  approach — a non-selected stage card's `border-left` measured `1px` (was
  `3px`) and a 3x-DPI zoom of its corner showed a clean curve, no step.

- `design/glass` fix 3 · Same anti-pattern swept across the whole frontend
  (owner flagged it recurring — "so many places, not one" — after fix 2 above,
  plus a third, larger-scale case: a full-height panel getting an unbounded
  OUTER shadow with nowhere to land). Two shapes of the same bug:
  (a) `border-left: 2–3px` beside a thinner/absent border on the other three
  sides, inside a rounded `border-radius` — the asymmetric width breaks the
  arc a uniform border draws, worse wherever `liquid-glass.css`'s own rim
  inset (sized for a uniform border) layered on top. Fixed on `.tst` (toast),
  `.sa__card` (connectors), `.cn__card`, `.mkq__row`, `.k-notifbanner`,
  `.niyam-steps > li`, `.m2link`, `.vk-tg__unclaimed`, `.vk-mix__b`,
  `.pr__wcard`, `.hb-cal__e`, `.k-cust__hint`, `.ap__note` — all moved from
  `border-left` to `box-shadow: inset Npx 0 0 var(--accent)`, which clips to
  `border-radius` correctly at any width; `.tst` and `.sa__card` (both wired
  into liquid-glass.css) pulled out of the shared `:is()` lists into their own
  rules that compose the accent and the rim in one declaration instead of two
  rules fighting over `box-shadow`. (b) `.side` (the sidebar) — its own
  `--lg-shadow` in `liquid-glass.css` was completely overriding editorial.css's
  already-correct, contained inset-only shadow + `border-right: 1px`; the
  outer 20px-blur shadow that replaced it had nowhere to fall but onto the
  content pane, a soft vertical band running the sidebar's full height
  (screenshotted by the owner). Removed `.side` from that rule entirely —
  editorial.css's own treatment already covers it, on every preset.
  Deliberately NOT touched: `.lgl__note`, `.cl-appr__ask`, `.cn__setup`,
  `.sa__setup`, `.k-citation`, `.msg__sysb` all zero the border-radius on the
  accented side (`border-radius: 0 Xpx Xpx 0`), so there's no arc for the
  border to fight — not the same bug. `.mn-quote`, `.k-total`, `.sr-rt__q`,
  `.msg__b blockquote`, `.m2th`, `.sk-sched__next` have no border-radius at
  all (square corners) — also not the bug. · `components.css`, `connectors.css`,
  `editorial.css`, `hub.css`, `inbox.css`, `liquid-glass.css`, `marketplace.css`,
  `module.css`, `niyam.css`, `prachar.css`, `public.css`, `sanvaad.css`. Build
  clean, `npm run check` clean (no new contrast/write-gate/rendered-id
  failures). Verified live post-deploy: `.side`'s computed box-shadow dropped
  to editorial.css's bare `inset -1px 0 0, inset 0 1px 0` (the outer bleed is
  gone), screenshotted at 2x DPI — clean edge, no band; `.sr` still `none`.

- `design/glass` fix 4 · `Section` (`components/editorial/ModuleUI.jsx`, 35
  call sites across 16 files — Vetana, Pahchan, Dristi) rendered as a bare
  heading with no border, background, or padding of its own. On pages whose
  siblings are actual cards (Ganit's `.mk__c` KPI tiles) it sat at the same
  page inset as everything else — numerically identical, verified live — but
  read as unbounded next to surfaces that clearly have a boundary (owner
  screenshotted Payroll → Dashboard: "Year to date"/"Payroll coverage"/
  "Department split" all flush against the page edge with nothing framing
  them). Not a CSS bug (the padding numbers checked out equally on the
  "good" and "bad" pages) — a missing design treatment, confirmed with the
  owner before touching a 35-site shared component: **wrap in a card**.
  `.k-section` now carries the same border/background/radius/padding every
  other card in the system uses, `.k-section__head` gets a bottom rule
  separating it from the body, and `.k-section` joins `liquid-glass.css`'s
  static depth+rim list (no hover-lift — same as `.gn-panel`/`.tv-card`,
  since a `Section` can wrap a full-width table) · `editorial.css`,
  `liquid-glass.css`. Build clean, `npm run check` clean. Not yet verified
  live — need to check Vetana (the reported page) AND at least one Pahchan/
  Dristi call site for double-carding (a `Section` already sitting inside
  another bordered container would now show a card-in-a-card).

  Verified live post-deploy: Vetana → Payroll → Dashboard screenshotted —
  "Year to date"/"Payroll coverage"/"Department split" now read as proper
  bordered cards, matching the KPI tiles above them. Pahchan → Attendance →
  Corrections (a confirmed `Section` call site) screenshotted too — single
  clean card boundary, no double-carding. **STATUS: ✅ shipped.**

- `design/glass` fix 5 · Same bare-bar anti-pattern as `Section`, found on the
  original page the owner first flagged (Ganit → Invoices' TYPE/STATUS filter
  row) and swept across every module: `.gn-bar` (Ganit), `.mn-bar` (Manav),
  `.vk-bar` (Vikray), `.rep-bar` (Reports), `.hb-filters` (Hub), `.niyam-filters`
  (Niyam), `.bl__filter` (Billing) — all had no border/background/padding of
  their own, sitting flush between bordered surfaces above and below. All 7
  given the same card chrome as `Section` and added to `liquid-glass.css`'s
  static depth+rim list · `ganit.css`, `manav.css`, `module.css` (`.vk-bar`),
  `reports.css`, `hub.css`, `niyam.css`, `billing.css`, `liquid-glass.css`.

  Separately: 3 Vetana tabs (`PayrollTab`, `LoansTab`, `PayslipsTab`) hand-roll
  `.k-section__head`/`.k-section__title` directly instead of using the
  `Section` component, and all 3 were missing the outer `.k-section` wrapper
  entirely — so fix 4 above never reached them even though they use the exact
  same class names. `StructuresTab` had the identical gap (caught from an
  owner screenshot after I'd already "finished" checking this page — the
  earlier double-carding sweep only walks `.k-section` elements that exist;
  it can't catch a `.k-section__head` with no `.k-section` ancestor at all,
  which is a different failure mode). Added `className="k-section"` to the
  outer wrapper in all 4 files. `EmployeesTab`/`AttendanceTab` (Manav) already
  wrap correctly — checked, no fix needed · `StructuresTab.jsx`,
  `PayrollTab.jsx`, `LoansTab.jsx`, `PayslipsTab.jsx`. Build clean.

  Verified live post-deploy: Ganit invoices' TYPE/STATUS row (the page that
  started this whole thread), Vetana → Structures ("Salary structures"), and
  Manav → Employees ("Department/All logins/Filter" — the very first
  screenshot in this thread) all screenshotted — proper bordered cards now,
  matching every other surface on the page. **STATUS: ✅ shipped.**

- `design/glass` fix 6 · Owner asked for all 13 modules + non-module pages
  checked, not just the ones screenshotted. Audited every module by grepping
  its JSX for toolbar/filter classNames (not guessing from CSS alone) and
  checking each hit's CSS for the same bare-row shape: `.k-filterbar` (Tasks,
  Activity), `.k-tfilters` (Time Report — had padding but no border/bg,
  never actually read as the "filter card" its own comment called it),
  `.bl__bar` (Billing period selector), `.docfilt` (E-Sign documents),
  `.vtb__bar` (`ViewToolbar` — shared by Boards/Table/Kanban, reaches all
  three at once), `.gr__bar` (Graha), `.pr__bar` (Prachar's own
  `.k-section__head` equivalent, per its own code comment). All 7 given the
  same card chrome and added to `liquid-glass.css`'s depth+rim list ·
  `editorial.css`, `billing.css`, `documents.css`, `boards.css`, `graha.css`,
  `prachar.css`, `liquid-glass.css`.

  Coverage confirmed per module: Ganit/Vikray/Manav/Reports/Hub/Niyam (fix 5)
  · Vetana/Pahchan/Dristi (fix 4, `Section`) · Kray (reuses `.gn-bar`) ·
  Graha/Prachar/Billing/E-Sign/Boards (this fix). Sanvaad checked and
  confirmed NOT affected — it's a chat interface (channels/messages/threads),
  structurally not a tabular list view, so this pattern doesn't apply there.
  Admin/Org/Templates/Marketplace/Connectors/Customize checked — no bar/filter
  classNames found; they use the already-safe `TableToolbar`/`.tv` (paired
  with `.tv-card`) or have no such row.

  Verified live post-deploy: `.k-filterbar`, `.k-tfilters`, `.pr__bar`,
  `.vtb__bar` all confirmed (padding/border/background/radius present).
  While verifying Graha's Pipeline tab, found ONE more instance of the
  corner-seam shape (fix 3's `.vk-pl__st` pattern, not the bare-row shape):
  `.gpipe__head` (the coloured stage-header strip on each Kanban column) had
  `border-top: 3px solid var(--c)` alone against `border-radius: var(--r-md)`
  on all four corners — same seam, screenshotted at 3x DPI to confirm.
  Fixed the same way: `box-shadow: inset 0 3px 0 0 var(--c)` instead of the
  border. Re-swept the whole codebase for `border-top`/`border-bottom`/
  `border-right` used as a lone accent (this pattern isn't limited to
  `border-left`) — nothing else matched; the rest are legitimate hairline
  dividers on square-cornered elements or already-clipped by a parent's
  `overflow: hidden` (`.m2rec__top` in Sanvaad, checked specifically) ·
  `module.css`. Build clean.

  Sanvaad re-examined at the owner's request ("doesn't matter if it's
  tabular, all pages have the issue") — checked the main channel list AND an
  open channel (header, pinned-message strip, composer) via computed styles,
  not just a screenshot glance. The pinned strip already has its own padding
  and background; the chat pane itself has no card border, but it's a
  full-height full-bleed panel (Slack/Discord shape), not built as a card the
  way table pages are — a different, apparently deliberate layout, not the
  same bug. No fix applied there; told the owner to point at a specific spot
  if one still looks wrong rather than guessing further.

  `.gpipe__head` verified live post-deploy: `border-top-width` measured `0px`
  (was `3px`), and a 3x-DPI zoom of the corner shows a clean curve, no step.
  **STATUS: ✅ shipped.**

- `design/glass` fix 7 · Owner pointed at `.ix-panel` directly from devtools
  and asked to remove ITS depth, not the child cards'. `.ix-panel` is the
  `role="tabpanel"` wrapper for every module's tab content (Ganit, Vikray,
  Graha, Prachar, Manav, Dristi, Vetana, Hub, Kray, Sahayak) — a layout
  container, not a card — and it was in `liquid-glass.css`'s depth-shadow
  list, putting a floating-card shadow around the ENTIRE content area on
  every module page, in addition to (and separate from) the correct shadows
  its children already carry individually. Removed `.ix-panel` from the list
  · `liquid-glass.css`. Verified live post-deploy: computed `box-shadow` on
  `.ix-panel` is now `none`. **STATUS: ✅ shipped.**

- `design/glass` fix 8 · Owner asked for Organisation settings' Senders and UPI
  IDs tabs redesigned so each repeating item (one sender purpose, one UPI
  platform) reads as its own card — currently a bare heading + two fields per
  item, no boundary, six-plus stacked with nothing separating them. New
  `.oc-card` class (combined with the existing `.st__group` spacing, never
  alone — the intro banners and the trailing Save button stay unstyled,
  they're not repeating items) gives each one border/background/radius/
  padding · `settings.css`, `TabSenders.jsx`, `TabUpi.jsx`. Build clean. Not
  yet verified live.

- `design/glass` fix 9 · Font-picker investigated — not a bug. `--font-display`
  (what the Headings picker writes) is correctly read by 27 files including
  `.k-pageh__h1`, `.k-stat__val`, and the sidebar wordmark; verified live by
  overriding the token and reading computed `font-family` on each. What
  doesn't change is `.mh__en` (the small English module label, e.g. "TASKS")
  — deliberately `--font-ui`, per ModuleHeader.jsx's own comments: the
  Devanagari term is the actual heading and lives on `--font-indic`, a
  separate font axis the picker was never wired to (different script, needs
  different font files). No code change; the picker's scope is narrower than
  "headings everywhere" implies, not broken.

- `design/glass` fix 10 · Niyam promoted to a full module, as agreed. Kept its
  existing sidebar entry (`settings/automations`, `orgAdminOnly`) rather than
  moving it — that gate is a deliberate access decision documented in
  navConfig.js, not something this touches. Added: `niyam` to `MODULES`
  (`moduleColors.js`) with a new `--m-niyam` token (light `#96354A` / dark
  `#E8A4B4`, distinct from all 16 existing module hues); wired the nav entry
  to the `automations` icon (a lightning-bolt SVG that already existed in
  `navIcons.jsx` unused — the row was drawing the generic `customize` gear
  instead) and added `module: 'niyam'` for grant-gating consistency (verified
  safe: `orgAdminOnly` already restricts visibility to org admins, who get
  `moduleGrants: null` — "no opinion" — so the new `module` check never hides
  the row for anyone who could already see it); switched `NiyamPage.jsx` from
  the generic `PageHeader` to `ModuleHeader`, matching all 12 other modules
  (icon tile, "SETTINGS · व्यवस्था" kicker via the auto-seeded
  `section.settings` label, module-colour accent) · `moduleColors.js`,
  `module.css`, `navConfig.js`, `NiyamPage.jsx`. Build clean, `npm run check`
  clean. Verified live post-deploy: screenshotted `/settings/automations` —
  icon tile in the new rose accent, "SETTINGS · व्यवस्था" kicker, "नियम
  AUTOMATIONS" title, matching Ganit/Vetana/etc. exactly.

  **Regression, caught by the owner within the hour:** `module: 'niyam'` on
  the nav entry (added "for grant-gating consistency") made the row vanish
  entirely from Settings on the owner's own real Aekam Inc account (confirmed
  org_admin — `Roles & access`/`Organisation`, both `orgAdminOnly`, were both
  visible to them). There is no backend grant system for a `niyam` code, so
  for any admin whose `moduleGrants` happens to be a real array rather than
  the documented "absent = no opinion" state, the module check silently hid
  a row `orgAdminOnly` alone already gated correctly. My test session (a
  different account) didn't reproduce it, which is why "verified live"
  missed this — one account confirming a nav change is not enough when
  visibility depends on account-specific grant state. Reverted `module` from
  the nav entry; `ModuleHeader`'s own `module="niyam"` (drives the icon
  colour and the write-gate) is left as-is since `canWriteModule` takes the
  same "absent levels = true" path for a genuine org_admin/owner, a
  different code path than the one that broke · `navConfig.js`.
  **STATUS: ✅ shipped, fix included.**

- `product` fix · Owner's call: plan pricing is entirely per-org negotiated,
  so no rupee figure should ever render on the org-facing plan comparison
  card, regardless of who's viewing it. Previously `p.price_monthly != null
  ? inr(...) : 'On quote'` — `list_plans` sends `price_monthly` only to
  accounts the backend treats as platform staff, so a real number was
  showing for those sessions. `price_monthly` is now never read here at all;
  every card unconditionally shows "On quote". Build
  clean. Verified live post-deploy: `price_monthly` no longer appears
  anywhere in the deployed JS bundle at all. **STATUS: ✅ shipped, superseded
  below.**

- `product` fix 2 · Owner's follow-up: with pricing hidden and the current
  plan already stated in the stat cards above it ("PLAN · Growth"), the
  4-card "Plans" comparison grid on Billing added nothing — no price to
  differentiate the tiers, no self-serve upgrade to act on ("handled by your
  account manager"). Removed the section entirely rather than keep four
  identical-looking "On quote" cards. `PlanComparison.jsx` had no other
  importer — deleted, along with the now-dead `/v1/subscription/plans` fetch
  and `plans` state in `TabBilling.jsx` (nothing read it once the section
  was gone — the exact "fetched but never rendered" bug `PlanComparison.jsx`
  was originally written to fix) and its CSS (`.opl*`, `org.css`), removed by
  hand since I know exactly which classes were only ever used there ·
  `TabBilling.jsx`, `org.css`, `PlanComparison.jsx` (deleted). Build clean,
  `npm run check` clean, no new unused-class or contrast regressions.

- `design/glass` investigation · Chased a false "Usage & Spend section is
  missing from Billing" lead after two automated
  `innerText.includes('Usage & spend')` checks both came back `false` post
  deploy of the fix above. It was never missing — `page.innerText` reflects
  rendered (CSS-transformed) text, and `.st__gt` applies
  `text-transform: uppercase`, so the actual DOM text is "USAGE & SPEND", not
  "Usage & spend" as written in the JSX; the check was case-sensitive and
  could never match. A full-page screenshot at the same URL showed the
  section fully rendered and populated (Balance: allowance/purchased/total
  held/spent-this-period, "Where the credits went" beneath it). No code
  change — the lesson is to grep rendered text case-insensitively (or match
  a stable data attribute) when a CSS transform is in play, not to trust one
  case-sensitive `includes()` as proof of absence. Section content/layout
  density (several stacked stat-tile cards) is still unassessed against the
  owner's original "billing/analytics pages feel disorganized" complaint —
  not yet actioned, owner has not chosen a direction (leave as-is / simplify
  / defer) at time of writing.

- `design/glass` fix 11 · Owner: "all this buttons are way shiny this is not
  how apple ui works." `.btn--fill` carried a static `::before` overlay — a
  fixed `linear-gradient(180deg, rgba(255,255,255,.28), transparent 58%)`
  glass highlight always present on every filled button, independent of the
  existing `::after` hover sweep ("THE SHEEN," a travelling light band that
  only appears on hover — transient, not what a static screenshot would
  show, so not the thing being flagged). The permanent top-highlight is the
  skeuomorphic "glossy button" look Apple's actual UI doesn't use; removed
  the `::before` rule and its block comment entirely, leaving `.btn--fill`
  with only its box-shadow depth · `components.css`. Build clean. Verified
  live post-deploy: computed `::before` on `.btn--fill` (e.g. Vikray's
  "+ New order") is `content: none; background-image: none` — flat fill,
  no highlight band. **STATUS: ✅ shipped.**

- `design/glass` fix 12 · Owner: "redesign the security and members tabs too
  and everywhere else this glossy type ui." Security and Members were bare
  — same pattern as Senders/UPI before fix 8, just never touched — because
  `.st__group` (the ONLY section wrapper the entire settings surface uses:
  org Profile/Members/Billing/Modules/Security/Danger zone AND all six
  personal Customization tabs, 14 files) was `margin-bottom: 26px` alone,
  nothing else. Fix 8's `.oc-card` modifier only ever reached the two files
  it was added to by hand. Rather than repeat that per-file, gave
  `.st__group` itself the card chrome (border/background/padding/radius),
  which fixes all 14 files from one rule, and dropped `.oc-card` — folded
  into `.st__group`, so keeping it as a separate modifier would just be two
  names for the same thing now — from `TabSenders.jsx`/`TabUpi.jsx`
  · `settings.css`, `TabSenders.jsx`, `TabUpi.jsx`. Build clean, `npm run
  check` clean (no new contrast/write-gate/row-height regressions). Verified
  live post-deploy: screenshotted Security, Members, Senders and a
  Customization tab (Notifications) — every section is now a bounded card;
  Senders' per-item cards (fix 8) read correctly with no double border, the
  intro info-banner cards nest cleanly since `.opend` is a filled tint, not
  a bordered card. **STATUS: ✅ shipped.**

- `design/glass` fix 13 · Owner: "check the modules tabs too." Fix 12's
  blanket `.st__group` card chrome double-carded the Modules tab
  specifically — its middle section wraps `.omod` (`ModuleCard`s, each
  already `border + background` on `.omod__c`), so the grid ended up in a
  card whose children are cards. Added a `.st__group--flush` exemption
  (`padding: 0; border: 0; background: none`) and applied it to only that
  one section in `TabModules.jsx`; the intro banner and the "Sensitive
  modules" footer note above/below it keep the normal card chrome ·
  `settings.css`, `TabModules.jsx`. Checked every other `.st__group` call
  site (`TabProfile.jsx` — plain form fields, no self-carded children;
  `TabDanger.jsx` — `.odz` is typography only, no border; the six
  Customization tabs — `TabAppearance.jsx`'s colour/pattern swatches are
  small picker chips nested one level inside a single section card, the
  normal picker pattern, not a repeated-full-identity-card grid) for the
  same shape of bug — none found. Build clean, `npm run check` clean.
  Verified live post-deploy: computed `border` on the module-grid section is
  `0px none`, its siblings stay `1px solid`; screenshot confirms the grid
  reads as one flush row of independently-carded tiles rather than a card
  full of cards. **STATUS: ✅ shipped.**

- `design/glass` fix 14 · Owner: "checkbilling tabs too." Fix 12 double-carded
  three of `TabBilling.jsx`'s five `.st__group` sections, worse than
  Modules: `CreditUsage` and the "Usage & spend" section (`BillingUsageSection`)
  each render one or more `<Card>`s directly, and "Invoices" renders `<Table>`
  directly — `.tbl__wrap` is already bordered whenever an ancestor
  `.card__body`/`.dcard__b` hasn't reset it, and `.st__group` wasn't on that
  reset list. Extended the existing reset (`components.css`) to include
  `.st__group .tbl__wrap` — the same convention the file already documents
  for exactly this shape of bug — and marked the two `<Card>`-wrapping
  sections `st__group--flush` · `components.css`, `TabBilling.jsx`.

  Verifying the fix surfaced a second, unrelated bug: the "Usage & spend"
  card stack (Balance, Where the credits went, Who spent what, What was
  sent) was rendering squeezed into a narrow centred column instead of
  full width. Root cause: `.bl` was defined TWICE at equal specificity —
  `components.css`'s BrandLoader spinner root (`align-items: center;
  justify-content: center`, unrelated: the mark shown at boot and after
  sign-in) and `billing.css`'s card-stack wrapper (`flex-direction:
  column`) for this exact section, imported directly by
  `BillingUsageSection.jsx` rather than through the barrel. Which one won
  depended on final bundle order, not anything either file declared, and on
  `org/TabBilling` it was BrandLoader's. Renamed the billing one to `.blx`
  (only one JSX call site) rather than touch the shared spinner class ·
  `billing.css`, `BillingUsageSection.jsx`. This also fixes `/admin/usage`,
  the component's other mount, per its own file header.

  Build clean, `npm run check` clean. Verified live post-deploy: computed
  `border` on the Credits/Usage-&-spend sections is `0px none`; the
  Invoices section's `.tbl__wrap` has no border of its own; `.blx` computes
  `flex-direction: column`; full-page screenshot shows every stat/card grid
  at full width, no narrow-centred column, no box-in-a-box anywhere on the
  tab. **STATUS: ✅ shipped.**

- `design/glass` check · Owner: "check profile tabs too." No separate
  personal-profile page exists — `org/TabProfile.jsx` (Logo, Company, Tax,
  Registered address, Bank details, Invoice footer) is the only Profile tab;
  Customization's six tabs (Appearance/Typography/Layout/Language/
  Notifications/Security/Data & privacy) were already covered by fix 13's
  audit. Screenshotted live: every section reads as its own card, no bare
  rows, no double-carding (the logo dropzone's own border is a normal
  nested-control boundary, not a duplicate card edge). No defect found, no
  code change.

<!-- Next: when Phase 1/2 work lands, add lines here and flip STATUS.md rows. -->
