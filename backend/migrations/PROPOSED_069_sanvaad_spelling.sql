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
--   THE SQL BELOW IS NOT SUFFICIENT ON ITS OWN. `middleware/role_tiers.py` must
--   change in the SAME deploy, and that file is owned by another agent — which
--   is why this is proposed and not applied, and why `org_modules.py` translates
--   at the boundary in the meantime rather than assuming this has run.
--
--   Order matters and is NOT symmetric:
--     · Apply the SQL FIRST and the code second → for the gap between them, a
--       grant naming `samvada` violates the new CHECK. But there are ZERO rows
--       in staging.org_member_modules, so the gap is harmless today.
--     · Apply the code FIRST and the SQL second → for the gap, a grant naming
--       `sanvaad` violates the OLD CHECK and returns 500. Worse.
--   So: SQL first, then the one-line constant change, then deploy.
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
-- APPLY  (step 2 of 2 — REQUIRED, in the same deploy)
-- ═════════════════════════════════════════════════════════════════════════════
--
-- In `backend/middleware/role_tiers.py`, replace `samvada` with `sanvaad` in
-- all four places it appears:
--
--     ALL_MODULES            (line 63-66)
--     STAFF_MODULES          (line 70-72)
--     HIERARCHICAL_MODULES   (line 208-210)
--     NO_APPROVER_MODULES    (line 227-229)
--
-- and update the comment on line 62, which currently reads:
--     "Note `samvada` — the nav calls the same module `sanvaad`."
--
-- Then in `backend/routers/org_modules.py`, `_ENTITLEMENT_SPELLING` becomes an
-- empty dict and the two translation helpers become identity functions. Delete
-- them and the §4 section of that file's docstring.
--
-- And in `frontend/src/pages/org/catalogue.js`, the `samvada` entry becomes
-- `sanvaad` and `subCode` is deleted, along with `subscriptionCode` and the
-- `subscriptionCode` branch of `isModuleActive`.
--
-- Leaving any one of these undone re-creates the split in a new place.

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
