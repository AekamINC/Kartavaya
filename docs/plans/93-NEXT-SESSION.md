# Proposal 93 — the next session's plan

Written 2026-08-28, at the end of Wave 1. **This is a route, not a substitute
for the document.** Read `docs/proposals/93-reseed-and-reverify.html` IN FULL
first — the single biggest failure of the 28 Aug sessions was planning from a
compressed summary of 93 and silently losing most of its scope.

---

## 0. The first twenty minutes, before any test runs

1. **Read, in order:** memory `session_state_2026_08_28b` → proposal 93 in full
   → `CLAUDE.md` → this file.
2. **Verify BOTH deploys.** Backend: confirm which SHA Railway staging is
   running and that `meta.branch` says `staging` — it has silently tracked
   `main` before. Frontend: hash what `staging.kartavaya.com` actually serves;
   "READY" in Vercel never establishes what the domain returns.
3. **Check the tokens are alive.** `.env.e2e` at the repo root. They were minted
   2026-08-28 and **expire ~2026-09-04**. If they are dead, the owner must sign
   in with **"Keep me signed in"** ticked (365 days vs 7). Do not change
   `JWT_TTL_DAYS` — it is a product security setting.
4. **Confirm the lane before writing.** `frontend/e2e-real/_lanes.ts`. Write
   suites use ORG-SCOPED accounts only; god mode is Suite 19 and nothing else.
   `assertOrg()` asserts the org **ID**, never the name — the name is what got
   corrupted in the cross-org incident.

---

## 1. Where things stand

| | |
|---|---|
| ✅ | R0 · R1 freeze · R2 backup + proven restore · R3 · R4 delete (25,854 rows) |
| ✅ | Suite 00 — 31/31 · Suite 01 — 4/4 · **Suite 02 — 8/8, green twice** |
| ⬜ | Waves 2–8 · Stage 4 (UK replay) · Stage 5 (mobile) · R9 |

⚠ **8/8 is 8 of what is WRITTEN, not of what §10 requires.** §10 lists **18
screens** for org settings. Ten tests do not exist yet. Do not let "Suite 02
green" read as "Suite 02 done" — that conflation is the exact failure mode
`STATUS.md` exists to prevent.

⚠ **The backup is still the only copy of 25,854 deleted rows**, and **seven
crons still sit at `0 0 1 1 *`** — they fire once on 1 January if forgotten.
R9 is pre-approved and restores both. **Do it at R9, not before.**

---

## 2. The order of work, and why this order

### A. Finish Suite 02 — the ten missing screens (start here)

Not because it is unfinished, but because **members invite → accept produces the
accounts every later wave depends on**. Wave 2 onward needs people to assign
work to, approve leave for, and route territories to. Build them by typing, once.

1. **members: invite → accept → role change → remove** ← do this first
2. per-member module grants
3. the role matrix across all 4 tiers
4. storage: browse, upload, download, delete
5. compliance toggles
6. support access: grant → revoke
7. Danger tab: opened and **cancelled** (never confirmed)
8. logo upload

Each asserts its own observable consequence. Not "it did not throw".

### B. Wave 2 — Suite 07 Manav, Suite 04 Graha

These are independent by construction, so they run concurrently.
**`workers: 4` is safe** — settled by reading `limiter.py`: `Limiter` is built
with **no `default_limits`**, so only auth-shaped routes are limited, and the
token bootstrap never calls `POST /auth/login`. **Only Suite 01 must stay
`workers: 1`**, because it is the suite that deliberately trips the 5/min login
limit.

### C. Waves 3–8, then Stage 4, Stage 5, R9

- **R5 fixtures get built BEFORE Wave 3 needs them**: 30 synthetic faces, 3
  real-format bank statements, 6 multi-page PDFs, 8 KB documents, the oversized
  file.
- **Stage 5 (mobile) — ask the camera question FIRST.** Both AVDs
  (`Pixel_9_Pro`, `Tab_A11_Plus`) exist and `adb` is 1.0.41, but no device was
  attached at the end of this session and **Expo Go cannot run this app**. Use
  the x86_64 release APK; a debug APK carries no JS bundle. Mobile probes need a
  **cold restart** — hot reload lies.
- **R9 last:** drop `reseed_backup_20260828`, restore the seven crons from
  `docs/plans/93-R1-FREEZE-LEDGER.md`.

---

## 3. The rules that cost something to learn

**Rule 1 — every row is typed by a user.** Playwright fills the real form and
clicks the real button. No SQL seeding, no API shortcut. The CI gate is
`frontend/scripts/check-e2e-no-bypass.mjs`; five bypasses in `real-user.spec.ts`
are baselined and owned by Suite 08.

**Rule 2 — stop and fix, but PROVE product-bug vs test-bug first.** Suite 02
opened at 3/7 and **three of the four failures were test bugs**. A fourth
near-miss came from 02.2b's own first run. The pattern each time: read the wire,
the captured page context, or the Railway log **before** writing the words
"product bug".

- `page.reload()` on the line after Save races the write → use `saveAndWait()`.
- `fill('')` does not register with a controlled input → use real keystrokes
  (`click`, `ControlOrMeta+a`, `Delete`).
- `.tst__t` is the toast **title**; `.tst__s` is the message
  (`components/ui/toast.jsx:328-329`).
- `.or()` chains resolve in DOM order and will happily match the sidebar → scope
  to `getByRole('menu')` (suite rule 6).

**§6 idempotence is proved by running the suite twice, never by claiming it.**
Two Suite 02 defects were visible only on the second run.

**Never call a table, column or constraint anything without a live query.**
Migration 238 exists because a CHECK was live that two repo files both declared
"NOT APPLIED", in two mutually contradictory forms. Read `pg_constraint`.

⚠ **Staging and production share one Supabase database.** State write-path side
effects before any migration, in the five-section form, and measure the exposure
before running rather than after.

---

## 4. Open, and owed to the owner

- **A platform-admin session writes to Aekam Inc with no on-screen indication of
  which org is being edited.** A support engineer in god mode would do exactly
  what the suite did. The `/org/profile` GET now echoes `id` and the heading now
  names the resolved org, but the general problem stands.
- **Renaming an org does not bump `updated_at`** (~1h). `OWNER-ACTIONS.md` #16a.
- **An inactive module tells the customer the wrong thing on 4 of 8 screens** —
  `/graha` says "You do not have access to CRM reports" (permission framing)
  where the API says "Module not active, contact your administrator" (the
  actionable one). ~half a day. `OWNER-ACTIONS.md` #16b.
- **Ganit's open tab is local state with no URL param.** Document numbering is
  reachable only via `More +14 → settings`; it cannot be linked, bookmarked or
  recovered by refreshing. Recorded as a product fact, not filed as a defect.
- **Unicode has ZERO rows in `module_subscriptions`**, so no module can be
  switched on from the UI even once the grid is wired. Provisioning is Aekam
  platform staff's job — this blocks §3's "enable modules" step.
