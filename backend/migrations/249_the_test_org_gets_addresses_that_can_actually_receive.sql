-- 249 · Unicode Group's people get email addresses that can actually receive.
--
-- ── 1 · WHAT IS WRONG ─────────────────────────────────────────────────────
--
--     graha_contacts    52 of 84 carry an @example.com address
--     ganit_vendors     16 of 16 carry an @example.com address
--     manav_employees   30 of 30 carry NO ADDRESS AT ALL
--
--     `example.com` is RFC 2606 and has a null MX: mail to it cannot be
--     delivered and hard-bounces at the sending domain. So two whole suites
--     refuse to run rather than damage the sender reputation of
--     no-reply@kartavaya.com:
--
--       05.08  fifteen invoice emails   — NOT sent, deliberately
--       05.15  nine signature invites   — NOT sent, deliberately
--
--     And thirty employees with no address means NO PAYSLIP CAN EVER BE
--     MAILED to anybody on this org. That one is not a test artefact — it is
--     the reason 08.x can prove a payslip generates and never that it arrives.
--
-- ── 2 · WHY THIS AND NOT OUTBOUND SUPPRESSION ─────────────────────────────
--
--     The alternative was `OUTBOUND_SUPPRESSED_ORGS`, which would stamp every
--     send `suppressed` and let the suites proceed without delivering. Owner's
--     decision, 2026-08-31, and it is the better one: a send that is suppressed
--     proves the button was pressed and nothing more. A send that ARRIVES
--     proves the template rendered, the sender domain is trusted, the link in
--     the body resolves, and the recipient is reachable. Those are four
--     different things and only delivery tests all four.
--
--     Every address becomes a `+tag` alias on the owner's own mailbox. Gmail
--     ignores everything after the `+`, so all of them land in one inbox and
--     each is filterable by the suite that caused it.
--
-- ── 3 · WHAT THIS STATEMENT TOUCHES ───────────────────────────────────────
--
--     ONE organisation, named by id. Nothing outside Unicode Group can be
--     reached by any statement below, and Aekam Inc is not touched.
--
--     The tag is derived from what the row already carries — the local part of
--     the address for contacts and vendors, the employee code for staff — so
--     it is stable across re-runs and identifies the row on sight. Verified
--     before writing: 52 contact tags, 16 vendor tags and 30 employee tags,
--     ZERO collisions in any of the three sets. That matters more than it
--     looks: two contacts sharing an address would break the web form's own
--     de-duplication, which looks a contact up by email before it creates one.
--
-- ── 4 · SIDE EFFECTS OF THE WRITE ─────────────────────────────────────────
--
--     · `updated_at` moves on every row touched. `updated_by` is NOT set on
--       any of them: no person made this change, and stamping one would put a
--       name against a repair they did not make. Same choice as 246 and 248.
--     · NO event is emitted. `contact_created` and `employee_joined` already
--       fired when these rows were born; re-firing would re-run automation
--       rules against people who have been on the books for days.
--     · ⚠ THE NEXT SUITE RUN WILL SEND REAL MAIL, AND THAT IS THE POINT.
--       Fifteen invoices, nine signature invitations, and any campaign
--       addressed to the contact book. All of it arrives in one inbox.
--     · ⚠ THE DAILY CAP WILL STOP IT UNLESS IT IS RAISED. Measured the same
--       moment as this file: `email_cap_daily` is 100 and 105 have already
--       gone today, so the org is ALREADY over and sends are being refused at
--       `status='capped'` before the suppression gate is even consulted. The
--       cap is raised separately, as config rather than as a migration,
--       because it is a knob that goes up and down to TEST the cap itself.
--
-- ── 5 · REVERSAL ──────────────────────────────────────────────────────────
--
--     Exact, because the transform is reversible from the value it wrote:
--
--       UPDATE public.graha_contacts
--       SET email = split_part(split_part(email,'+',2),'@',1) || '@example.com'
--       WHERE org_id = 'fae87907-2f99-4b35-a241-c94d9e1e4a17'
--         AND email LIKE 'kevalvshah03+%';
--       -- the same for ganit_vendors
--       UPDATE public.manav_employees SET email = ''
--       WHERE org_id = 'fae87907-2f99-4b35-a241-c94d9e1e4a17'
--         AND email LIKE 'kevalvshah03+%';
--
--     The dot removed from a contact local part is not restored by the above
--     (`s04.contact01` comes back as `s04contact01`). Recorded rather than
--     worked around: the address is a test fixture and the dot carries nothing.

-- ── Contacts ──────────────────────────────────────────────────────────────
UPDATE public.graha_contacts
SET email = 'kevalvshah03+'
          || lower(regexp_replace(split_part(email, '@', 1), '[^A-Za-z0-9]', '', 'g'))
          || '@gmail.com',
    updated_at = NOW()
WHERE org_id = 'fae87907-2f99-4b35-a241-c94d9e1e4a17'
  AND email ILIKE '%@example.com';

-- ── Vendors ───────────────────────────────────────────────────────────────
UPDATE public.ganit_vendors
SET email = 'kevalvshah03+'
          || lower(regexp_replace(split_part(email, '@', 1), '[^A-Za-z0-9]', '', 'g'))
          || '@gmail.com',
    updated_at = NOW()
WHERE org_id = 'fae87907-2f99-4b35-a241-c94d9e1e4a17'
  AND email ILIKE '%@example.com';

-- ── Employees ─────────────────────────────────────────────────────────────
-- `employee_code` where there is one; the name otherwise. Two people hired
-- through recruitment carry NO employee code at all — `hire_candidate` does
-- not assign one, which is its own finding and is reported separately.
UPDATE public.manav_employees
SET email = 'kevalvshah03+'
          || lower(regexp_replace(COALESCE(NULLIF(employee_code, ''), name),
                                  '[^A-Za-z0-9]', '', 'g'))
          || '@gmail.com',
    updated_at = NOW()
WHERE org_id = 'fae87907-2f99-4b35-a241-c94d9e1e4a17'
  AND is_active = TRUE
  AND COALESCE(email, '') = '';
