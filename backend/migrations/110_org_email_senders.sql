-- 110_org_email_senders.sql
--
-- ONE FROM-ADDRESS PER PURPOSE, PER ORG. THE PRODUCT HAS EXACTLY ONE, TOTAL.
--
-- THERE IS ONLY ONE `staging` SCHEMA AND PRODUCTION WRITES TO IT TOO. Applying
-- this file is a production change, as 093–098, 105 all say. Apply by hand, in
-- a low-traffic window:
--     psql "$DATABASE_URL" -f backend/migrations/110_org_email_senders.sql
-- Nothing here is applied automatically and no application code applies it.
--
-- REQUIRES only `staging.organisations`, which has existed since the beginning.
-- GUARD 0 names it anyway, for the same reason 098 does: a missing-relation
-- error on a foreign key sends people looking for a typo in a table name that
-- is spelled correctly.
--
-- Additive only. ONE new table, ONE index, comments. No DROP, no ALTER of
-- anything that already exists, no backfill, no trigger, no data touched. Every
-- statement is `IF NOT EXISTS`, so the file is replayable: run it twice and the
-- second run does nothing.
--
-- ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
--
-- Every message this product sends leaves as `FROM_EMAIL`, a single Railway
-- environment variable: "Unicode Group <info@unicodegroup.com>" on staging,
-- "no-reply@aekaminc.com" in production's default. Three senders put it on the
-- wire — `email_service.send_email` (both the Resend and the SES branch),
-- `email_service.send_report_email`, and the payslip sender in
-- `services/employee_email.py` — and all three read the same module constant.
--
-- So a payslip, a marketing campaign and a password reset arrive from the same
-- address. SENDER REPUTATION AND DELIVERABILITY ARE PER-ADDRESS: a recipient
-- who marks the campaign as spam, or a campaign that hits enough spam traps to
-- move the address's reputation, takes the payslip and the password reset down
-- with it. The payslip is the one that MUST arrive — it carries somebody's
-- salary and there is a statutory expectation behind it — and today it is
-- underwritten by the reputation of the marketing send.
--
-- The owner has provisioned NINE addresses on unicodegroup.com, one per
-- purpose. This table is where an org says which is which.
--
-- ── PURPOSE IS A CLOSED SET HERE AND AN OPEN ONE IN outbound_log ────────────
--
-- READ THIS BEFORE ADDING A VALUE TO THE CHECK BELOW, AND BEFORE "FIXING" THE
-- INCONSISTENCY WITH 098.
--
-- There are TWO purpose vocabularies in this product and they are deliberately
-- different sizes:
--
--   · `staging.outbound_log.purpose` is OPEN and 098 argues at length for that:
--     "The set is open and grows every time somebody adds an email to the
--     product. A CHECK here would mean a new notification needs a migration —
--     and, worse, that shipping the notification without it loses the log row."
--     It currently holds ~30 distinct values (payslip, task_reminder, mention,
--     password_reset, prachar_campaign …), one per notification.
--
--   · `staging.org_email_senders.purpose` is CLOSED, and this file CHECKs it.
--     It is not "what the mail was for"; it is WHICH REPUTATION IT IS SENT ON,
--     and the set is fixed by the product — by the nine addresses the owner
--     provisioned — not by users and not by whoever adds the next notification.
--
-- The failure modes are opposite, which is what makes the opposite call right.
-- An unchecked `outbound_log.purpose` costs a typo that splits one bucket in
-- two on a report, which a human notices. An unchecked purpose HERE costs a row
-- nothing will ever read: `services/email_senders.py` looks the address up by
-- one of the nine names, so a row filed under 'payrol' or 'billing' is not a
-- wrong From, it is silently no From at all — the org configured an address,
-- the screen shows it, and every message still leaves as FROM_EMAIL. A CHECK
-- turns that into an error at the moment of typing.
--
-- THE MAPPING FROM ONE VOCABULARY TO THE OTHER LIVES IN
-- `backend/services/email_senders.py` (`_BUCKET`), not here. It is a product
-- decision that changes with every new notification — payslip -> payroll,
-- prachar_campaign -> marketing, task_reminder -> notifications — and putting
-- it in SQL would mean a migration per notification, which is exactly what 098
-- refused for the same reason.
--
-- A TENTH ADDRESS IS A MIGRATION, AND THAT IS THE POINT. It means buying and
-- verifying a tenth address with the provider first, which is work that has to
-- happen out of band anyway (see is_verified). The CHECK is what makes the code
-- and the mailbox impossible to disagree about.
--
-- TO WIDEN IT LATER, DO NOT WRITE A PLAIN `ADD CONSTRAINT` if this table has
-- grown: that validates every existing row under AccessExclusiveLock. Write it
-- as DROP CONSTRAINT / ADD … NOT VALID / VALIDATE CONSTRAINT, as 098 spells out
-- for `outbound_log_channel_ck`. At three orgs it is moot; it is written down so
-- the next author does not have to rediscover it.
--
-- ── THE FALLBACK IS THE FEATURE ─────────────────────────────────────────────
--
-- AN ORG WITH NO ROWS IN THIS TABLE MUST KEEP SENDING EXACTLY AS IT DOES TODAY.
-- That is not politeness, it is the whole safety property: this table is empty
-- for every org on the day it is created, and there are three orgs whose mail
-- is currently working. A resolver that returned NULL, or an empty string, or
-- raised, would break every email in the product on deploy.
--
-- So the resolver falls back to `FROM_EMAIL` at four separate points — no
-- table, no row for the org, no row for the purpose, row not verified — and
-- `tests/test_email_senders.py` pins each one individually rather than pinning
-- "it works". Three of the four are reachable RIGHT NOW, because this file is
-- not applied.
--
-- ── is_verified IS NOT A CHECKBOX AND MUST NEVER BECOME ONE ─────────────────
--
-- An unverified From address does not degrade delivery. It fails it:
--
--   · RESEND rejects the API call outright — 403, "The <domain> domain is not
--     verified". The message never leaves. Since `send_email` reports that
--     through `att.failed()` it would at least be visible in outbound_log, but
--     the payslip still did not go.
--   · SES rejects with MessageRejected, "Email address is not verified", for
--     the same reason. In production (out of the sandbox) an unverified
--     *identity* is the failure; the DOMAIN is what SES and Resend both verify,
--     via DNS records only the domain owner can publish.
--
-- NEITHER PROVIDER CAN BE VERIFIED FROM INSIDE THIS PRODUCT. It is DKIM, SPF
-- and a return-path CNAME published in DNS and then confirmed in the provider's
-- own dashboard. There is no API call this codebase can make that turns an
-- unverified address into a verified one, and there is no webhook wired up that
-- would tell us when it happened.
--
-- Therefore:
--
--   · `is_verified` DEFAULTS TO FALSE and the org settings screen cannot set
--     it. `PUT /api/v1/org/profile/senders` accepts `from_email` and
--     `from_name` and nothing else; a body naming `is_verified` is ignored.
--     A control an org can tick that claims their DNS is correct is a control
--     that lies, and the thing it lies about is whether payslips arrive.
--   · AN UNVERIFIED ROW IS NOT USED. `services/email_senders.py` treats
--     `is_verified = FALSE` as "not configured" and returns FROM_EMAIL. So the
--     worst case of a wrong entry is today's behaviour, never a bounce.
--   · Aekam sets the flag by hand, after looking at the provider dashboard.
--     The statement is at the bottom of this file. That is a deliberate manual
--     step and not an unfinished one.
--
-- ── HEADER INJECTION: THREE LAYERS, AND WHICH ONE IS THE BOUNDARY ───────────
--
-- Both `from_email` and `from_name` are interpolated into an RFC 5322 `From:`
-- header. A stored value containing CR or LF splits that header and lets the
-- rest of the line be anything — `Bcc:`, a second `To:`, a forged
-- `Reply-To:`. `email_service._safe_subject` already exists because the same
-- hole was closed on the Subject.
--
--   1. `services/email_senders.py` STRIPS control characters on read. This is
--      the boundary. It is on the read side deliberately: this table can be
--      written by a psql session, by a future admin tool, or by a restore, and
--      only the read side is guaranteed to run before the header is built.
--   2. The router validates on write and returns 400.
--   3. The CHECKs below are the TRIPWIRE, in 098's exact sense: they make the
--      obvious mistake fail loudly at the moment somebody hand-writes a row,
--      rather than six months later in a delivered header.
--
-- Do not delete layer 1 because layers 2 and 3 exist. Layer 3 can be dropped by
-- a migration and layer 2 is bypassed by every writer that is not the router.
--
-- ── LOCKS ───────────────────────────────────────────────────────────────────
--
-- One transaction, so every lock is held until COMMIT — a few milliseconds.
--
-- ONLY ONE STATEMENT TOUCHES A RELATION THAT ALREADY EXISTS: the
-- `REFERENCES staging.organisations(id)` takes a ShareRowExclusiveLock on
-- `organisations`. That BLOCKS WRITES to organisations — not reads, which
-- matters because organisations is read on essentially every request. Writes to
-- it are rare (an admin editing the company profile) and the lock is held for a
-- catalog update at 3 rows.
--
-- Everything else operates on a relation this transaction created, which
-- nothing else can see until COMMIT. Nothing is scanned, nothing is rewritten,
-- no row is written.
--
-- `SET LOCAL lock_timeout` earns its place for the foreign key alone: it queues
-- behind any open transaction holding a lock on `organisations`, and while it
-- queues it blocks writers arriving after it. Five seconds turns the bad case
-- into a clean rollback instead of a hope.
--
-- ── DEPLOY ORDER, AND WHY IT IS UNUSUALLY RELAXED HERE ──────────────────────
--
-- EITHER ORDER IS SAFE, which is not true of 096, 097 or 098.
--
-- `services/email_senders.py` treats `42P01 undefined_table` as "no org has
-- configured anything" and goes dormant after ONE warning — the same mechanism
-- `services/outbound_log.py` uses, and for the same reason. So the application
-- change deployed against an unmigrated database sends exactly as it does
-- today, which is the fallback described above.
--
-- The one asymmetry, and it is the same one 098 carries: DORMANCY IS PER
-- PROCESS AND NOTHING RESETS IT. A process that tried to read this table before
-- it existed will not try again. So if you deploy the code first:
--
--     1. apply this file
--     2. REDEPLOY THE BACKEND
--     3. run the verification block at the bottom
--
-- Skipping step 2 leaves a running process sending from FROM_EMAIL while the
-- table sits there holding the addresses, looking correct. Nothing breaks; the
-- feature simply does not switch on, and the settings screen shows addresses
-- that are not being used.

BEGIN;

-- Fail fast rather than block admin writes to `organisations`. Without
-- lock_timeout the foreign key below waits indefinitely for its
-- ShareRowExclusiveLock. Five seconds is far longer than any honest transaction
-- on a three-row table. SET LOCAL is scoped to this transaction and reverted at
-- COMMIT; it changes nothing for anyone else.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';


-- ════════════════════════════════════════════════════════════════════════════
-- GUARD 0 — THE TABLE THIS ONE POINTS AT
-- ════════════════════════════════════════════════════════════════════════════
--
-- The transaction rolls back either way and nothing is left half-applied. This
-- guard buys a legible error, not safety — and it catches the likelier mistake,
-- which is being connected to the wrong database rather than to one where
-- `organisations` is genuinely missing.
DO $$
BEGIN
    IF to_regclass('staging.organisations') IS NULL THEN
        RAISE EXCEPTION
          'ABORT: staging.organisations does not exist. This is not a table '
          'this migration can create. Either you are connected to the wrong '
          'database, or search_path is wrong, or this is a Supabase branch '
          'that was never migrated.';
    END IF;
END $$;
-- Lock: AccessShareLock on the catalog only. Instant.


-- ════════════════════════════════════════════════════════════════════════════
-- 1. THE TABLE
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS staging.org_email_senders (
    -- WHOSE ADDRESS. NOT NULL, unlike `outbound_log.org_id`: a From address
    -- belonging to no org is not a fact about anything. The platform-wide
    -- default already exists and is called FROM_EMAIL.
    --
    -- ON DELETE CASCADE, matching 052, 096 and 098. A deleted tenant's sending
    -- identity must not outlive the tenant — it is the address their invoices
    -- and payslips came from, and leaving it behind is both a data-retention
    -- problem and a way for a recycled org id to inherit somebody else's From.
    org_id       UUID NOT NULL
                 REFERENCES staging.organisations(id) ON DELETE CASCADE,

    -- WHICH REPUTATION, not what the mail was for. Nine values, fixed by the
    -- product — see the long note in the header on why this is CHECKed while
    -- `outbound_log.purpose` deliberately is not, and why the ~30 finer-grained
    -- notification purposes are mapped onto these nine in Python rather than
    -- being added here.
    --
    -- The names are the local parts of the nine addresses the owner
    -- provisioned, verbatim and lowercase, so the row reads as the mailbox it
    -- is about: 'payroll' is payroll@, 'no-reply' is no-reply@. THE HYPHEN IN
    -- 'no-reply' IS PART OF THE VALUE — `services/email_senders.py` spells it
    -- the same way and `tests/test_email_senders.py` asserts the two lists are
    -- identical, because a silent 'no_reply' here would be a bucket nothing
    -- ever resolves to.
    --
    -- WHAT IS DELIBERATELY ABSENT: there is no 'legal', 'documents' or
    -- 'support' value. E-signature traffic therefore maps onto 'notifications'
    -- (see `_BUCKET`), which is a real compromise and is recorded as one: if
    -- signature requests should carry their own reputation, that is a tenth
    -- address to buy and verify, and then one line here.
    purpose      TEXT NOT NULL
                 CONSTRAINT org_email_senders_purpose_ck
                 CHECK (purpose IN ('invoice','sales','payroll','crm',
                                    'notifications','attendance','hr',
                                    'marketing','no-reply')),

    -- THE ADDRESS ONLY — never "Name <addr>". The display name is `from_name`
    -- and the two are assembled at send time, because a single field holding
    -- both cannot be validated: `Acme <a@b.com>` and `a@b.com` and
    -- `"A, B" <a@b.com>` are all legal and only one of them is checkable.
    --
    -- THE CHECK IS A SHAPE TEST AND NOT AN RFC 5322 PARSER, on purpose. A full
    -- parser in a CHECK constraint is unreadable, wrong at the edges, and
    -- rejects legal addresses people actually hold. What this catches is the
    -- mistake that matters and the one somebody makes at 2am: whitespace, a CR
    -- or LF (see HEADER INJECTION in the header — `[[:space:]]` covers both),
    -- angle brackets, a missing @, a missing dot in the domain.
    --
    -- It is NOT the boundary. `services/email_senders.py` strips control
    -- characters on read and re-checks the shape; this fails the INSERT so the
    -- bad row never exists to be read.
    from_email   TEXT NOT NULL
                 CONSTRAINT org_email_senders_from_email_ck
                 CHECK (from_email ~ '^[^[:space:]<>@,;:"]+@[^[:space:]<>@,;:"]+\.[^[:space:]<>@,;:"]+$'),

    -- The display name: "Unicode Group Payroll". NULLABLE, and NULL means "send
    -- as the bare address", which is a legal and common choice — not missing
    -- data.
    --
    -- `[[:cntrl:]]` rather than a CR/LF pair: every control character is
    -- illegal in an unquoted display name, and enumerating two of them invites
    -- somebody to find a third. Length is capped so a pasted paragraph cannot
    -- become a header line; 100 is comfortably past any real company name.
    from_name    TEXT
                 CONSTRAINT org_email_senders_from_name_ck
                 CHECK (from_name IS NULL
                        OR (from_name !~ '[[:cntrl:]]' AND length(from_name) <= 100)),

    -- HAS THE DOMAIN BEEN VERIFIED WITH THE PROVIDER. See the header section:
    -- this cannot be discovered from inside this product, the org settings
    -- screen cannot set it, and FALSE means the resolver ignores the row and
    -- sends from FROM_EMAIL instead.
    --
    -- DEFAULT FALSE is the load-bearing part. A row inserted by anything that
    -- does not name this column — the settings screen, a psql INSERT, a future
    -- admin tool — is inert until somebody has actually looked at the provider
    -- dashboard. The safe state is the default state.
    --
    -- It is NOT a timestamp and NOT a per-address fact, although it is stored
    -- per address. Both providers verify DOMAINS, so in practice all nine rows
    -- for one org flip together, and the UPDATE at the bottom of this file is
    -- written that way. Storing it per row anyway costs a byte and means an org
    -- that later moves one purpose to a different domain does not silently
    -- inherit the old domain's answer.
    is_verified  BOOLEAN NOT NULL DEFAULT FALSE,

    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- ONE ROW PER ORG PER PURPOSE, enforced by the key rather than by a
    -- separate unique index over a surrogate id. There is no `id` column
    -- because nothing references this table and nothing ever should: the
    -- natural key IS the lookup — `WHERE org_id = $1` — and a surrogate would
    -- only add a way for two rows to disagree about the same purpose.
    --
    -- It also gives the settings screen its UPSERT target for free:
    -- `ON CONFLICT (org_id, purpose) DO UPDATE`.
    PRIMARY KEY (org_id, purpose)
);
-- ── WHAT THIS LOCKS ─────────────────────────────────────────────────────────
--
-- AccessExclusiveLock on a relation that does not exist yet, so nothing can be
-- waiting on it and nothing can arrive to wait on it.
--
-- The `REFERENCES staging.organisations(id)` takes a ShareRowExclusiveLock on
-- `organisations`: it blocks WRITES to that table, not reads, for a catalog
-- update at 3 rows. This is the only statement in the file that can contend
-- with live traffic, and `lock_timeout` above is set for it.


-- ════════════════════════════════════════════════════════════════════════════
-- 2. ONE INDEX, AND IT IS THE PRIMARY KEY
-- ════════════════════════════════════════════════════════════════════════════
--
-- THE PRIMARY KEY INDEX ALREADY SERVES EVERY READ THIS TABLE HAS. There is
-- exactly one query — `services/email_senders.py`:
--
--     SELECT purpose, from_email, from_name, is_verified
--       FROM staging.org_email_senders
--      WHERE org_id = $1::uuid
--
-- which is a prefix scan of `(org_id, purpose)` returning at most nine rows.
-- The settings screen runs the same query. Nothing looks anything up by
-- `from_email`, by `is_verified`, or by `purpose` across orgs.
--
-- So no index is created here at all, and that is a decision rather than an
-- omission. This table is read once per org per cache TTL and written when
-- somebody edits a settings form; at nine rows per org, three orgs, a
-- sequential scan would be free too. The right number of indexes is the number
-- with a question attached, and the key already answers the only question.

-- DELIBERATELY NOT INDEXED, with the question each one would answer:
--   · `from_email` — "which org sends as this address" is a support question
--     nobody has asked, over a table small enough to scan. Note it is NOT
--     unique either: two orgs may legitimately share an address while both are
--     on unicodegroup.com, and one org may point several purposes at the same
--     mailbox. Separation is what this table MAKES POSSIBLE, not what it
--     compels.
--   · `is_verified` — "what is waiting on DNS" is a nine-row scan.


-- ════════════════════════════════════════════════════════════════════════════
-- 3. THE RULES, ON THE SCHEMA ITSELF
-- ════════════════════════════════════════════════════════════════════════════
--
-- `\d+ staging.org_email_senders` shows these. Somebody will meet this table
-- through the schema and not through this file, and the two rules that must
-- survive that meeting — the fallback, and what is_verified means — belong
-- where they will be read.
COMMENT ON TABLE staging.org_email_senders IS
  'Per-org, per-purpose From address. One row per org per purpose; an org with '
  'no rows sends everything from the FROM_EMAIL environment variable, which is '
  'what every org does today and what must keep working. Read by '
  'services/email_senders.py, which maps the ~30 outbound_log purposes onto '
  'these nine buckets. See migration 110.';

COMMENT ON COLUMN staging.org_email_senders.purpose IS
  'WHICH REPUTATION, not what the mail was for: invoice | sales | payroll | '
  'crm | notifications | attendance | hr | marketing | no-reply. CHECKed, '
  'unlike outbound_log.purpose — the set is fixed by the nine addresses that '
  'exist, and an unrecognised value here is silently no From at all.';

COMMENT ON COLUMN staging.org_email_senders.from_email IS
  'The bare address, never "Name <addr>" — the display name is from_name and '
  'the two are joined at send time. Goes into an RFC 5322 header: the CHECK is '
  'a tripwire, services/email_senders.py stripping control characters on read '
  'is the boundary.';

COMMENT ON COLUMN staging.org_email_senders.is_verified IS
  'Has the DOMAIN been verified with Resend/SES, checked by a human in the '
  'provider dashboard. NOT settable from the org settings screen and NOT '
  'discoverable from inside this product — it is DNS. FALSE means the row is '
  'ignored and the send falls back to FROM_EMAIL, so a wrong entry costs '
  'today''s behaviour and never a bounce.';


COMMIT;


-- ════════════════════════════════════════════════════════════════════════════
-- RUN THIS AFTER COMMIT AND READ IT WITH YOUR EYES. DO NOT AUTOMATE IT.
-- ════════════════════════════════════════════════════════════════════════════
--
-- 0. REDEPLOY THE BACKEND. `services/email_senders.py` goes dormant per process
--    on 42P01 and nothing resets it, so a process that served a send before
--    this file was applied will keep sending from FROM_EMAIL for ever. Same
--    trap as 098 step 0.
--
-- 1. The table is there, `org_id` is uuid, `is_verified` defaults false:
SELECT column_name, data_type, is_nullable, column_default
  FROM information_schema.columns
 WHERE table_schema = 'staging' AND table_name = 'org_email_senders'
 ORDER BY ordinal_position;

-- 2. The three CHECKs and the foreign key. `services/email_senders.py` and
--    `routers/org_profile.py` both assume the purpose CHECK exists; if it is
--    missing, a typo'd purpose is accepted and silently never resolves:
SELECT conname, pg_get_constraintdef(oid)
  FROM pg_constraint
 WHERE conrelid = 'staging.org_email_senders'::regclass
   AND contype IN ('c','f','p')
 ORDER BY conname;
-- expect: org_email_senders_from_email_ck, org_email_senders_from_name_ck,
--         org_email_senders_pkey, org_email_senders_purpose_ck, and the
--         org_id fkey

-- 3. THE CHECK ACTUALLY REFUSES THE THINGS IT IS FOR. Four statements that must
--    each raise. Run them one at a time in a transaction you ROLL BACK — this
--    is the only place in this file that writes anything, and it must not
--    commit. Substitute a real org id for :org.
--
--        BEGIN;
--        -- purpose outside the nine -> org_email_senders_purpose_ck
--        INSERT INTO staging.org_email_senders (org_id, purpose, from_email)
--        VALUES (:org, 'billing', 'a@b.com');
--        -- a display name in from_email -> org_email_senders_from_email_ck
--        INSERT INTO staging.org_email_senders (org_id, purpose, from_email)
--        VALUES (:org, 'payroll', 'Payroll <payroll@unicodegroup.com>');
--        -- a newline in from_email -> org_email_senders_from_email_ck
--        INSERT INTO staging.org_email_senders (org_id, purpose, from_email)
--        VALUES (:org, 'payroll', E'payroll@unicodegroup.com\nBcc: x@y.com');
--        -- a newline in from_name -> org_email_senders_from_name_ck
--        INSERT INTO staging.org_email_senders (org_id, purpose, from_email, from_name)
--        VALUES (:org, 'payroll', 'payroll@unicodegroup.com', E'Payroll\nBcc: x@y.com');
--        ROLLBACK;
--
--    A migration whose constraints were never made to fire is a migration that
--    proved nothing. `tests/test_email_senders.py` proves the Python half the
--    same way, against the same four cases.
--
-- 4. SEED THE NINE ADDRESSES — BY HAND, DELIBERATELY, AND NOT BY THIS FILE.
--
--    This migration writes no data. Which org gets which addresses is a
--    business fact, `unicodegroup.com` belongs to one org and not to the other
--    two, and a seeded row that lands on the wrong org sends that org's
--    payslips from somebody else's domain.
--
--    Read the org id first and look at it:
--        SELECT id, name FROM staging.organisations ORDER BY created_at;
--
--    Then, with the right id substituted:
--
--        INSERT INTO staging.org_email_senders (org_id, purpose, from_email, from_name)
--        VALUES
--          (:org, 'invoice',       'invoice@unicodegroup.com',       'Unicode Group Invoicing'),
--          (:org, 'sales',         'sales@unicodegroup.com',         'Unicode Group Sales'),
--          (:org, 'payroll',       'payroll@unicodegroup.com',       'Unicode Group Payroll'),
--          (:org, 'crm',           'crm@unicodegroup.com',           'Unicode Group'),
--          (:org, 'notifications', 'notifications@unicodegroup.com', 'Unicode Group'),
--          (:org, 'attendance',    'attendance@unicodegroup.com',    'Unicode Group Attendance'),
--          (:org, 'hr',            'hr@unicodegroup.com',            'Unicode Group HR'),
--          (:org, 'marketing',     'marketing@unicodegroup.com',     'Unicode Group'),
--          (:org, 'no-reply',      'no-reply@unicodegroup.com',      'Unicode Group')
--        ON CONFLICT (org_id, purpose) DO NOTHING;
--
--    Every row lands with is_verified = FALSE and is therefore INERT. Nothing
--    changes about how mail is sent until step 5. That is the intended order:
--    the rows exist, the screen shows them, and the product still sends exactly
--    as it did.
--
-- 5. VERIFY THE DOMAIN, THEN FLIP THE FLAG. IN THAT ORDER.
--
--    THIS IS THE STEP NOBODY IN THIS PROCESS CAN DO FOR YOU, and doing it out
--    of order is how payslips stop arriving.
--
--    THE TWO ENVIRONMENTS USE DIFFERENT PROVIDERS, AND THE DOMAIN HAS TO BE
--    VERIFIED IN BOTH, SEPARATELY, WITH DIFFERENT DNS RECORDS. Measured from
--    the Railway variable names on 2026-08-06, service `Kartavya`, project
--    `Kartavya Production`:
--
--        staging      FROM_EMAIL, RESEND_API_KEY, AWS_ACCESS_KEY_ID, OUTBOUND_MODE
--        production   FROM_EMAIL, AWS_ACCESS_KEY_ID — and NO RESEND_API_KEY,
--                     and NO OUTBOUND_MODE (so it is live)
--
--    `email_service` picks Resend when RESEND_API_KEY is set and falls through
--    to SES otherwise, so STAGING SENDS VIA RESEND AND PRODUCTION SENDS VIA
--    SES. Verifying only the one you happened to test against leaves the other
--    rejecting every message the moment a row goes is_verified = TRUE.
--
--    (a) RESEND — for staging. Open Domains and confirm unicodegroup.com reads
--        Verified. If it does not, publish the DKIM CNAMEs, the SPF TXT and the
--        return-path record it lists, at the registrar, and wait for it to go
--        green. DNS propagation is minutes to hours; there is nothing to do but
--        wait.
--
--        Resend verifies the DOMAIN. Once unicodegroup.com is verified, ALL
--        NINE addresses at it can send — there is no per-address step, which is
--        why one UPDATE covers all nine rows.
--
--    (b) AWS SES — for production, and for scheduled reports in BOTH
--        environments. `send_report_email` speaks only SES and has no Resend
--        path; it says so in its own comment in `email_service.py`, and on a
--        Resend deployment every scheduled report already lands in its
--        `att.failed("no SES client")` branch. Verify the domain identity in
--        SES with its own DKIM records, and check the account is out of the SES
--        sandbox in that region — inside the sandbox, EVERY RECIPIENT must be
--        verified too, not just the sender.
--
--    (c) Only then:
--
--        UPDATE staging.org_email_senders
--           SET is_verified = TRUE
--         WHERE org_id = :org
--           AND split_part(from_email, '@', 2) = 'unicodegroup.com';
--
--        Scoped by DOMAIN, not by org alone, so an address on some other domain
--        that happens to be in the same org is not swept up by a verification
--        that was never about it.
--
--    (d) Redeploy or wait out the cache. `services/email_senders.py` holds the
--        answer for 300 seconds per org, so the flag takes up to five minutes
--        to take effect; the settings screen's PUT clears that org's entry
--        immediately, but a hand-written UPDATE does not.
--
-- 6. WHAT IS CONFIGURED, AND WHAT IS LIVE. The two are different questions and
--    the second is the one that matters:
--
--        SELECT o.name, s.purpose, s.from_email, s.from_name, s.is_verified
--          FROM staging.org_email_senders s
--          JOIN staging.organisations o ON o.id = s.org_id
--         ORDER BY o.name, s.purpose;
--
--    Any row reading is_verified = false is an address the product is NOT
--    using. That is the correct and safe state, and it is also the state a
--    forgotten step 5 leaves behind, so read this list before concluding the
--    feature is on.
--
-- 7. DID THE FROM ACTUALLY CHANGE. `staging.outbound_log` HAS NO from-address
--    COLUMN — it records recipient, subject, purpose, provider and status, and
--    nothing about the sending identity — so this table cannot confirm itself
--    from the log. It is not added here: another column on the
--    highest-insert table in the product needs its own argument, and 098's
--    budget paragraph is explicit about that.
--
--    Until it exists, the only proof is a real message. Send one and read the
--    headers:
--
--        SELECT ts, purpose, recipient, status, provider, detail->>'mode'
--          FROM staging.outbound_log
--         WHERE channel = 'email' AND org_id = :org
--         ORDER BY ts DESC, id DESC
--         LIMIT 20;
--
--    tells you WHICH purpose was used, and `_BUCKET` in
--    `services/email_senders.py` tells you which address that purpose resolves
--    to. The two together are the answer; neither alone is.
