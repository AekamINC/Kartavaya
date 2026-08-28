# Proposal 93 — the next session's plan

Rewritten **2026-08-28, late evening**, at `3c1642af`. **This is a route, not a
substitute for the document.** Read `docs/proposals/93-reseed-and-reverify.html`
IN FULL first — the single biggest failure of the 28 Aug sessions was planning
from a compressed summary of 93 and silently losing most of its scope. If you
find yourself planning from a summary, stop and re-read.

---

## 0. The first twenty minutes, before any test runs

1. **Read, in order:** memory `session_state_2026_08_28c` → proposal 93 in full
   → `CLAUDE.md` → this file.
2. **Verify BOTH deploys.** Backend: confirm which SHA Railway staging runs and
   that `meta.branch` says `staging` — it has silently tracked `main` before.
   Frontend: check what `staging.kartavaya.com` actually serves; "READY" in
   Vercel never establishes what the domain returns. Last verified state:
   Railway `ce9191d8` SUCCESS and Vercel `dpl_FC7ds…` READY, both on
   `3c1642af`.
3. **Check the tokens are alive.** `.env.e2e` at the repo root (gitignored).
   Minted 2026-08-28, **expire ~2026-09-04**, including `E2E_SUPPORT_TOKEN`. If
   they are dead the owner must sign in with **"Keep me signed in"** ticked
   (365 days vs 7). Do not change `JWT_TTL_DAYS` — it is a product security
   setting. To capture a fresh one: `copy(localStorage.getItem('auth_token'))`
   in the browser console on a signed-in tab.
4. **Confirm the lane before writing.** `frontend/e2e-real/_lanes.ts`. Write
   suites use ORG-SCOPED accounts only; god mode is Suite 19 and nothing else.
   `assertOrg()` asserts the org **ID**, never the name — the name is what got
   corrupted in the cross-org incident.

**Facts worth not re-deriving:** the table is `staging.organisations` (British
spelling — not `organizations`, not `orgs`). **Aekam Inc = `045b76ad`,
Unicode Group = `fae87907`**, UK AekamINC = `4d7e9380`, E2E = `64e7bea6`,
Demo = `4ea8208f`.

---

## 1. Where things stand

| | |
|---|---|
| ✅ | R0 · R1 freeze · R2 backup + proven restore · R3 · R4 delete · R4b accounts |
| ✅ | Suite 00 — 31/31 · Suite 01 — 4/4 · Suite 19 — modules 0→12, both orgs on `scale` |
| 🟡 | **Suite 02 — 16 of §10's 18.** Wave 1 overall **26/28** |
| ⬜ | The recycle bin · Suite 19.3 · Waves 2–8 · Stage 4 (UK replay) · Stage 5 (mobile) · R9 |

⚠ **The backup is still the only copy of 25,854 deleted rows and 25 purged
accounts**, and **seven crons still sit at `0 0 1 1 *`** — they fire once on
1 January if forgotten. R9 is pre-approved and restores both. **At R9, not
before.**

⚠ **Aekam Inc's §12 baseline moved to 11 seats / 1482 rows** (was 10 / 1471).
The support account was created through a god-mode session, which seats people
in Aekam Inc silently. Compare against the new number.

---

## 2. The order of work, and why this order

### A. Close the two Wave 1 items (start here — both are small)

**1. Suite 19.3 — raise a support session request.** This is the *only* thing
between 02.17 and green, and it is sequencing rather than a defect. The
customer lane cannot manufacture its own precondition: `_lanes.ts` rule 1
forbids borrowing a platform credential, and there is deliberately no
customer-side control to invite support in (`TabSupportAccess.jsx:35`).

So the support side raises it, exactly as 19.0 set the plans that unblocked
modules. Everything needed is in place:
- `platform_support` exists on `user_40223c0afab1`
  (`kevalvshah03+support@gmail.com`), `org_id NULL`, applied 28 Aug. **It is
  the only holder in the system.**
- The real screen is `pages/admin/SupportSessionsPage.jsx`, routed at
  `/admin/support` (`App.jsx:376`), and it posts `/v1/support-sessions`. It has
  no Approve button by design — the customer approves, which is 02.17's half.
- `isDormant` is computed from the error response, never hardcoded, so the page
  offers its form now the routes answer.
- Both tables resolve live and hold **0 rows** — nobody has ever used this.

Mint a storage state for the support token and drive the real form. Then 02.17
finds a pending request and decides it.

**2. The recycle bin — owner-approved 28 Aug, spec settled, not yet built.**
This is not a nice-to-have: **there is no delete anywhere in the product, and
the one "remove" that exists destroys the file.**

- `TaskDrawer.jsx:621` `removeAttachment` filters the array and saves the task.
  It drops the pointer and orphans the R2 object — the file is billed forever
  and, with the key gone from the row, unreachable by anyone including Aekam.
  No confirmation, no undo.
- `services/storage.py:832` `delete_file` has **zero callers**. Written, never
  wired.
- `routers/uploads.py` mounts exactly one route, `POST /upload`.
- `routers/graha.py:4917` is the one surface that does it right, and is the
  shape to copy: `UPDATE … SET is_active=FALSE`, recording who did it.

**The owner's decisions, all three settled — do not re-litigate:**
- Delete asks for confirmation, then the file goes to a bin the customer does
  not see.
- **Hidden at 14 days; the R2 object hard-deleted at 90.** A real recovery
  window and a real floor on cost. Aekam can recover from R2 in between.
- **Binned files still count against the org's storage quota**, or an org sits
  permanently over its limit by deleting things.
- **No delete control on Ganit invoices or eSign documents.** Books of account
  carry an 8-year Income Tax retention and GST records 72 months; a customer
  who deletes a signed invoice finds out at assessment. Delete is wired to
  **task attachments and CRM documents only.**
- **The Storage tab stays read-only** — that is a *separate* decision and it
  stands. `TabStorage.jsx:40-45` is right that a delete there removes an object
  without its row. Delete belongs on the surfaces that own the row.

Then 02.12 stops being a measurement of an absence and becomes a real round
trip.

### B. Wave 2 — Suite 07 Manav, Suite 04 Graha

Write them **fresh on the Unicode lane at §4 volumes.** The existing specs are
E2E-lane, `OWNER_STATE`-based and Phase-4 volumes; they cannot simply be
re-pointed.

These are independent by construction, so they run concurrently. **`workers: 4`
is safe** — settled by reading `limiter.py`: `Limiter` is built with **no
`default_limits`**, so only auth-shaped routes are limited, and the token
bootstrap never calls `POST /auth/login`. **Only Suite 01 must stay
`workers: 1`**, because it deliberately trips the 5/min login limit.

Both orgs are on the **`scale`** plan and hold 12 active modules, so Wave 2 is
unblocked. `scale` was chosen over `growth` because §4 needs 25 clients and
`growth` caps at 15; **never `free`** — it deactivates every add-on module.

### C. Waves 3–8, then Stage 4, Stage 5, R9

- **R5 fixtures get built BEFORE Wave 3 needs them**: 30 synthetic faces, 3
  real-format bank statements, 6 multi-page PDFs, 8 KB documents, the oversized
  file.
- **Stage 4 is the point of the UK org.** Its `state_code` is now `27`
  Maharashtra against Unicode's Gujarat `24`, so identical suites must produce
  IGST between the orgs and CGST/SGST within them, and Maharashtra's 3
  professional-tax bands against Gujarat's 4 must move the figure on identical
  salaries. **Identical figures would mean the ladders are not read at all.**
- **Stage 5 (mobile) — ask the camera question FIRST.** Both AVDs
  (`Pixel_9_Pro`, `Tab_A11_Plus`) exist and `adb` is 1.0.41. **Expo Go cannot
  run this app.** Use the x86_64 release APK; a debug APK carries no JS bundle.
  Mobile probes need a **cold restart** — hot reload lies.
- **R9 last:** drop `reseed_backup_20260828`, restore the seven crons from
  `docs/plans/93-R1-FREEZE-LEDGER.md`.

---

## 3. The rules that cost something to learn

**Rule 1 — every row is typed by a user.** Playwright fills the real form and
clicks the real button. No SQL seeding, no API shortcut. The CI gate is
`frontend/scripts/check-e2e-no-bypass.mjs`; five bypasses in `real-user.spec.ts`
are baselined and owned by Suite 08, and that number may go DOWN, never up.
`page.request.get` is verification and is permitted; a write is not.

**Rule 2 — stop and fix, but PROVE product-bug vs test-bug first.** Suite 02
opened at 3/7 and **three of the four failures were test bugs**; the final two
of Wave 1 split the same way — one test bug, one real absence. The pattern each
time: read the wire, the captured page context, or the Railway log **before**
writing the words "product bug".

- `page.reload()` on the line after Save races the write → use `saveAndWait()`.
- `fill('')` does not register with a controlled input → use real keystrokes.
- `.tst__t` is the toast **title**; `.tst__s` is the message.
- `.or()` chains resolve in DOM order and will happily match the sidebar →
  scope to `getByRole('menu')` (suite rule 6).
- **A row menu can be detached mid-click** by the members list refetching under
  it. `rowMenuItem` settles first, then re-resolves **only** on the detach
  signature — never widen that to a blind retry, or a genuinely missing control
  passes.
- ⚠ **Any API read helper must send `X-Org-Id`.** `api.js:39-40` does it on
  every product request; a helper that omits it makes the server fall back to
  **oldest membership**, which can answer for a different org than the screen
  beside it. This hole existed inside the suite written to catch cross-org
  leaks. Copy `orgHeaders()`.
- **A vacuous assertion passes forever.** 02.3 looped over
  `input[type="checkbox"]` where the product renders `<button role="switch">`,
  so it asserted nothing and always passed. **Assert a COUNT before looping.**

**§6 idempotence is proved by running the suite twice, never by claiming it.**

**Never call a table, column or constraint anything without a live query.**
Migration 238 exists because a CHECK was live that two repo files both declared
"NOT APPLIED". **Three separate frontend files claimed
`platform_support_sessions` did not exist**, all reading one `to_regclass` NULL
from 6 August; it resolves with 20 columns. A schema-qualified negative is a
fact about THAT SCHEMA only.

⚠ **Staging and production share one Supabase database.** State write-path side
effects before any migration, in the five-section form, and measure the exposure
before running rather than after.

**Bash heredocs fail on prose in this environment.** Write Python to the
scratchpad with the Write tool and run it; use `git commit -F <file>`.

---

## 4. Open, and owed to the owner

- **A platform-admin session writes to Aekam Inc with no on-screen indication
  of which org is being edited.** Demonstrated twice now — once by the harness,
  once by a real account creation that seated the support user in Aekam Inc.
  The `/org/profile` GET echoes `id` and the heading names the resolved org,
  but the general problem stands.
- **Renaming an org does not bump `updated_at`** (~1h). `OWNER-ACTIONS.md` #16a.
- **An inactive module tells the customer the wrong thing on 4 of 8 screens** —
  `/graha` says "You do not have access to CRM reports" (permission framing)
  where the API says "Module not active, contact your administrator" (the
  actionable one). ~half a day. `OWNER-ACTIONS.md` #16b.
- **Ganit's open tab is local state with no URL param.** Document numbering is
  reachable only via `More +14 → settings`; it cannot be linked, bookmarked or
  recovered by refreshing. A product fact, not filed as a defect.
- **Four agent-reported findings are still UNTRIAGED** and must be proved
  before being repeated: TabDanger names the org via `orgRole?.org_name` (the
  mechanism `ae7f0510` declared wrong); AccessMatrix mis-renders `hr_admin`;
  `kray` carries a SENSITIVE lock but never raises its confirmation; a customer
  has no UI to request support (`/requests` exists, nothing calls it).
