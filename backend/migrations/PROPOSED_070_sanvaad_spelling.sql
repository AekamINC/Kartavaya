-- PROPOSED — one spelling for the messaging module: `sanvaad`.
-- Review before running. NOT APPLIED by whoever merges this.
--
-- ═════════════════════════════════════════════════════════════════════════════
-- THE PROBLEM, VERIFIED IN THE LIVE DATABASE
-- ═════════════════════════════════════════════════════════════════════════════
-- One module, two spellings, split by which table you are looking at:
--
--   staging.module_subscriptions            'sanvaad'   (1 row, 0 active)
--   staging.add_on_modules                  'sanvaad'
--   frontend navConfig.js / moduleColors.js 'sanvaad'
--   middleware/role_tiers.ALL_MODULES       'samvada'
--   middleware/role_tiers.HIERARCHICAL_MODULES / NO_APPROVER_MODULES
--                                           'samvada'
--   CHECK org_member_modules_level_is_meaningful
--                                           'samvada'
--
-- 'samvada' occurs NOWHERE in staging.module_subscriptions. Confirmed by
-- grouping the table: dristi, ganit, graha, manav, pahchan, prachar, sanvaad,
-- srijan, vetana, vikray.
--
-- So an entitlement is written `sanvaad` and a grant is written `samvada`, and
-- comparing one against the other by string equality silently finds nothing.
-- `catalogue.js` already carries a `subCode` field that exists purely to bridge
-- this, and `TabModules.jsx` has a comment explaining that without it Sanvaad
-- renders as two cards. `backend/routers/org_modules.py` carries a matching
-- `_ENTITLEMENT_SPELLING` map. Three workarounds for one inconsistency.
--
-- ═════════════════════════════════════════════════════════════════════════════
-- WHY `sanvaad` WINS
-- ═════════════════════════════════════════════════════════════════════════════
-- It is what the DATA holds. Converging on `samvada` would mean UPDATEing rows
-- in a database shared with production so they match a Python constant;
-- converging on `sanvaad` means changing the constant. When code and data
-- disagree about a spelling, the cheaper and safer edit is always the code.
-- It is also what the nav and the frontend catalogue already use, so it is what
-- anyone reading the product sees.
--
-- ═════════════════════════════════════════════════════════════════════════════
-- RISK: MEDIUM — THIS ONE IS NOT SELF-CONTAINED
-- ═════════════════════════════════════════════════════════════════════════════
--   CORRECTION, 2026-07-26. The paragraph that stood here claimed the ordering
--   was dangerous in one direction:
--
--     "Apply the code FIRST and the SQL second → for the gap, a grant naming
--      `sanvaad` violates the OLD CHECK and returns 500. Worse."
--
--   THAT IS WRONG, and it was wrong when it was written. The constraint is a
--   PROHIBITION, not a whitelist:
--
--     CHECK (NOT (module_code='kartavya' AND role='viewer')
--        AND NOT (module_code = ANY(ARRAY[...,'samvada',...]) AND role='approver'))
--
--   A row it does not name passes it. Verified by evaluating the live
--   expression against candidate rows rather than by reading it:
--
--     module_code  role      passes OLD   passes NEW
--     sanvaad      approver  TRUE         FALSE
--     samvada      approver  FALSE        TRUE
--     sanvaad      admin     TRUE         TRUE
--     kartavya     viewer    FALSE        FALSE
--
--   So neither order can produce a constraint violation or a 500. What the two
--   orders actually differ in is which spelling loses its DATABASE BACKSTOP for
--   the length of the gap — the "no approver level on messaging" rule. The
--   application layer (`valid_levels_for` / `NO_APPROVER_MODULES`) enforces it
--   either way, and `staging.org_member_modules` is EMPTY, so today the gap
--   costs nothing in either direction.
--
--   THE CODE HALF HAS ALREADY SHIPPED — `role_tiers.py`, `messaging.py`,
--   `search.py`, `admin_orgs.py`, `org_modules.py` and the frontend catalogue
--   all say `sanvaad` as of this branch. So this file is now the REMAINING half,
--   and applying it restores the database backstop under the spelling the code
--   already uses. Until it runs, that one rule is application-enforced only.
--
--   DEPENDENCY: `PROPOSED_066_tier3_tier4_roles.sql` §1 is what CREATED this
--   CHECK and still spells it `samvada`. It is already applied. If 066 is ever
--   re-run AFTER this file, it will silently re-introduce the old spelling.
--   Run 070 after 066, never before, and never re-run 066 alone.
--
--   Rows affected : 0 today. `staging.org_member_modules` is EMPTY — verified,
--                   the GROUP BY over it returns no rows at all. That is what
--                   makes this cheap, and it stops being cheap the moment
--                   anyone is granted the messaging module.
--                   `staging.module_subscriptions` already holds `sanvaad`, so
--                   the UPDATE below is a no-op safety net, not the point.
--   Reversible    : Yes. The rollback restores the old CHECK verbatim.
--   Shared project: `staging.*` only.
--
--   DO THIS BEFORE THE FIRST MESSAGING GRANT EXISTS. After that it becomes a
--   data migration with a window where a grant is unreadable by one spelling or
--   the other.

-- ═════════════════════════════════════════════════════════════════════════════
-- APPLY  (step 1 of 2 — step 2 is the Python change below)
-- ═════════════════════════════════════════════════════════════════════════════

-- Safety net. Expected to affect 0 rows: the table is empty. If it reports more
-- than 0, STOP and re-read the risk note — grants exist and this is no longer
-- the cheap migration described above.
UPDATE staging.org_member_modules
   SET module_code = 'sanvaad'
 WHERE module_code = 'samvada';

-- Same, for the entitlement table. Expected 0: it already holds 'sanvaad'.
UPDATE staging.module_subscriptions
   SET module_code = 'sanvaad'
 WHERE module_code = 'samvada';

-- The CHECK named `samvada` in its list of modules with no approver level.
-- Re-created identically except for the spelling.
ALTER TABLE staging.org_member_modules
    DROP CONSTRAINT IF EXISTS org_member_modules_level_is_meaningful;
ALTER TABLE staging.org_member_modules
    ADD CONSTRAINT org_member_modules_level_is_meaningful
    CHECK (
        NOT (module_code = 'kartavya' AND role = 'viewer')
        AND NOT (module_code IN ('kartavya','dristi','srijan','sanvaad','esign')
                 AND role = 'approver')
    );

-- ═════════════════════════════════════════════════════════════════════════════
-- STEP 2 OF 2 — ALREADY DONE, recorded here so the pair stays legible
-- ═════════════════════════════════════════════════════════════════════════════
--
-- The code half shipped on `verify/org-endpoints`. Nothing to do; this is the
-- checklist it was verified against, kept so anyone rolling back knows the full
-- extent of the change.
--
--   backend/middleware/role_tiers.py   ALL_MODULES, STAFF_MODULES,
--                                      HIERARCHICAL_MODULES, NO_APPROVER_MODULES
--   backend/routers/messaging.py       require_module("sanvaad") — the gate that
--                                      made Sanvaad unreachable for everyone
--   backend/routers/search.py          _ENTITY_MODULE["messages"]
--   backend/routers/admin_orgs.py      ALL_MODULES union dropped
--   backend/routers/org_modules.py     _ENTITLEMENT_SPELLING + both helpers
--                                      + the `entitlement_code` response field
--   frontend/src/pages/org/catalogue.js  code, subCode, colorKey,
--                                        subscriptionCode, isModuleActive
--   frontend/src/pages/org/levels.js     NO_APPROVER_MODULES
--   frontend/src/pages/org/TabModules.jsx  the subscriptionCode comparison
--   frontend/src/pages/AdminOrgsPage.jsx   the console's module list
--
-- NOT changed, deliberately: `staging.samvada_*`, the six messaging tables.
-- They are applied and the design reference names them. A table name is not a
-- module code.

-- ═════════════════════════════════════════════════════════════════════════════
-- VERIFY
-- ═════════════════════════════════════════════════════════════════════════════
-- SELECT module_code, count(*) FROM staging.org_member_modules GROUP BY 1;
-- SELECT module_code, count(*) FROM staging.module_subscriptions GROUP BY 1;
-- Neither may contain 'samvada'.
--
-- SELECT pg_get_constraintdef(oid) FROM pg_constraint
--  WHERE conname = 'org_member_modules_level_is_meaningful';
-- Must read 'sanvaad', not 'samvada'.

-- ═════════════════════════════════════════════════════════════════════════════
-- ROLLBACK
-- ═════════════════════════════════════════════════════════════════════════════
-- Revert the Python and frontend changes FIRST, then:
--
-- UPDATE staging.org_member_modules
--    SET module_code = 'samvada' WHERE module_code = 'sanvaad';
--
-- ALTER TABLE staging.org_member_modules
--     DROP CONSTRAINT IF EXISTS org_member_modules_level_is_meaningful;
-- ALTER TABLE staging.org_member_modules
--     ADD CONSTRAINT org_member_modules_level_is_meaningful
--     CHECK (
--         NOT (module_code = 'kartavya' AND role = 'viewer')
--         AND NOT (module_code IN ('kartavya','dristi','srijan','samvada','esign')
--                  AND role = 'approver')
--     );
--
-- NOTE: do NOT roll back staging.module_subscriptions to 'samvada'. It has held
-- 'sanvaad' since it was created and was never part of the inconsistency.
