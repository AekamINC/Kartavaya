-- 098_outbound_log.sql
--
-- ONE ROW PER ATTEMPTED SEND. THE PRODUCT HAS NEVER HAD ONE.
--
-- THERE IS ONLY ONE `staging` SCHEMA AND PRODUCTION WRITES TO IT TOO. Applying
-- this file is a production change. Read that sentence twice, as 093, 094, 095,
-- 096 and 097 also ask you to. Apply by hand, in a low-traffic window:
--     psql "$DATABASE_URL" -f backend/migrations/098_outbound_log.sql
-- Nothing here is applied automatically and no application code applies it.
--
-- REQUIRES only `staging.organisations`, which has existed since the beginning.
-- GUARD 0 names it anyway, because a missing-relation error on a foreign key
-- sends people looking for a typo in a table name that is spelled correctly.
--
-- Additive only. ONE new table, four indexes on it, comments. No DROP, no ALTER
-- of anything that already exists, no backfill, no trigger, no data touched.
-- Every statement is `IF NOT EXISTS`, so the file is replayable: run it twice
-- and the second run does nothing.
--
-- ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
--
-- AWS said 2,586 of 3,000 SES message units had been used in August. The
-- question "how many emails have you sent?" then took an hour to answer badly,
-- by inference from `staging.vetana_payslips` row counts and E2E run history,
-- and the number that came out is a FLOOR rather than a total — because NOTHING
-- IN THIS PRODUCT RECORDED A SEND.
--
-- What that hour found: `routers/vetana.py` mails every employee a payslip with
-- a PDF attached on every payroll run (the loop at :783, through
-- `services/employee_email.send_payslip_email`); the E2E suite ran payroll 16
-- times against an org with 71 employees; all ~960 of those went to
-- `@example.com`, which is undeliverable BY DEFINITION — RFC 2606 reserves it —
-- so every one was a hard bounce against the SES identity that production
-- shares. Nobody could see it happening while it happened, and nobody could
-- reconstruct it afterwards: Railway rotates logs per deployment, so the
-- `logger.info("Email sent via SES ...")` line that recorded each one is gone.
--
-- A log line is not a record. A row is. That is the whole of this file.
--
-- ── THE THREE QUESTIONS, AND NOTHING ELSE ───────────────────────────────────
--
-- This table exists to answer three questions, and section 2 is built one index
-- per question and no index for anything else:
--
--   1. WHAT DID WE SEND THIS ORG THIS MONTH   — the invoice-side and
--      support-side question, and, with `channel` and `bytes`, the AWS-side one
--      that started this.
--   2. DID THIS PERSON GET IT                 — asked with an email address, by
--      someone who does not know which org the address belongs to.
--   3. WHAT FAILED                            — the standing question nobody
--      could ask at all, which is why 960 bounces were invisible.
--
-- A fourth question gets a fourth index in a later migration with a reason
-- attached. An index here is paid for on every send forever, and this will be
-- the highest-insert table in the product.
--
-- ── THE ONE WRITER, AND THE FACT THAT THIS FILE IS ITS CONTRACT ─────────────
--
-- READ THIS BEFORE RENAMING ANY COLUMN BELOW.
--
-- `backend/services/outbound_log.py` is the ONE writer, holding the rule
-- `services/credits.py` holds for the four credit tables and
-- `services/billing_lines.py` holds for `org_billing_lines`: no router and no
-- other service may INSERT, UPDATE or DELETE here, and reads are open. It is
-- already wired into `email_service.send_email`, `email_service.
-- send_report_email`, `services/push_service.send_push`,
-- `services/expo_push_service.send_expo_push` and `outbound.begin()`, which
-- covers every sender in the product.
--
-- THE TWO FILES ARE ONE CONTRACT AND THEY ARE COUPLED BY NAME, in both
-- directions. This file names the columns; that module names them back —
-- `_INSERT_COLUMNS` lists all thirteen it writes, `_split_channel` quotes
-- `outbound_log_channel_ck` in its warning text, `_as_bytes` exists because of
-- the `bytes >= 0` CHECK, `_detail` strips exactly the four keys
-- `outbound_log_no_body_ck` refuses, and `_INSERT` omits `id` precisely because
-- it is GENERATED ALWAYS.
--
-- A DISAGREEMENT BETWEEN THEM IS SILENT, WHICH IS WHY THIS PARAGRAPH IS LONG.
-- `_DORMANT_CODES` treats `42703 undefined_column` as "the table is not what we
-- were promised": it sets `_dormant = True`, discards the buffer, logs ONE
-- warning, and never writes again for the life of that process. So one renamed
-- column does not produce a stream of errors anybody would notice. It produces
-- one line in a Railway log that rotates away, and then silence — precisely the
-- condition this table exists to end. Verification step 2 at the bottom is the
-- check for it and it takes two seconds; run it.
--
-- ── WHY THE CONSTRAINTS ARE AFFORDABLE HERE AND ARE NOT IN THE LEDGER ──────
--
-- `hub_org_credit_transactions` earns trust through constraints, and the brief
-- for this file said to model it on that. The reasoning does not transfer
-- unchanged, and the difference is worth stating because it is what makes the
-- CHECKs below defensible instead of reckless:
--
--   · A ledger row failing MUST fail the spend with it — that is the point, and
--     it writes inside the caller's transaction on purpose.
--   · A LOG ROW FAILING MUST NEVER FAIL A SEND. `outbound_log.write()` cannot
--     raise at all; it buffers and returns. So a constraint here cannot stop
--     the bad thing the way a unique index stops a double charge. It can only
--     lose the record of it.
--   · And the writer FLUSHES IN BATCHES — one `INSERT … SELECT * FROM UNNEST`
--     carrying up to `_MAX_BATCH` = 500 rows. A single CHECK, NOT NULL or
--     foreign-key violation aborts the whole statement, so naively a constraint
--     here costs 500 records of sends that really happened.
--
-- THAT LAST POINT IS ANSWERED IN THE WRITER, NOT HERE, AND IT IS THE REASON
-- THIS FILE IS ALLOWED TO CONSTRAIN ANYTHING. `_write_batch` catches SQLSTATE
-- class 23 (`_INTEGRITY_CLASS`) and re-runs the batch ONE ROW AT A TIME, so a
-- violation costs exactly the offending row and the other 499 land. The
-- constraints below are priced at one row, not five hundred. If that salvage
-- path is ever removed, every CHECK in this file has to be reconsidered in the
-- same commit.
--
-- So the vocabulary IS checked, in both places: as module constants where it is
-- authored, and as a CHECK here, because a typo in `channel` or `status` drops
-- rows out of question 1 or question 3 silently, and silence is the disease.
-- `purpose` and `provider` are deliberately NOT checked — see their columns.
--
-- ── NO BODIES. NOT NOW, NOT LATER, NOT IN `detail` ──────────────────────────
--
-- A payslip body contains somebody's salary. A campaign body is the client's
-- own content, posted through the client's own OAuth token. This table will be
-- read by support, by whoever reconciles the AWS bill, and one day by whoever
-- is debugging something at 2am — none of whom should be reading salaries to
-- find out whether an email went out. `recipient` and `subject_or_title` answer
-- all three questions; a body answers none of them.
--
-- So the body is not stored, and `outbound_log_no_body_ck` refuses the four
-- obvious key names in `detail`. THAT CONSTRAINT IS A TRIPWIRE, NOT A SECURITY
-- BOUNDARY: anyone who wants to can spell the key `payload` and it goes
-- straight in. Its job is to make the OBVIOUS mistake fail in a test rather
-- than in production six months from now, when the table holds two million rows
-- and the fix is a rewrite. The writer strips those four keys BEFORE they
-- arrive (`_detail`), so a caller that reaches for one loses a key rather than
-- a row — that is the belt, and this is the braces.
--
-- ONE SPECIFIC TRAP, because it is loaded and it nearly fired.
-- `services/social_publisher._guarded` passes `(text or "")[:80]` as its
-- `detail` argument — the first 80 characters of the CUSTOMER'S OWN POST. That
-- is survivable in a Railway warning that rotates away and is NOT survivable in
-- a column kept for 400 days. `outbound.begin(channel, target, detail)` has the
-- same positional signature as the old `suppressed()` and maps `detail` onto
-- the subject, so the mechanical conversion of that call — change the name,
-- keep the arguments — would have started persisting client post content and
-- would have looked correct in review. The writer closes it structurally with
-- `_NO_SUBJECT_CHANNELS`: for `channel = 'social'`, `subject_or_title` is
-- dropped and stored as NULL. A social post has no subject. NULL IS THE CORRECT
-- VALUE THERE, NOT MISSING DATA, and a future author who "fixes" that NULL
-- reopens the hole.
--
-- ── user_id IS TEXT, org_id IS UUID, BOTH IN THE SAME ROW ───────────────────
--
-- A user id in this product is TEXT of the form `user_549c9cac35aa`, because
-- `public.users.user_id` is text. This repo has paid for forgetting that twice:
-- 030_created_by_uuid_to_text.sql ("500 errors on every INSERT") and
-- 092_sales_target_salesperson_is_a_user_id.sql (a sales target that could
-- never be saved by anyone, in any org, surfacing in the browser as a CORS
-- error with no body). 096 and 097 wrote the same reasoning out for
-- `created_by`, `ended_by` and `updated_by`.
--
-- It matters TWICE here. `user_id` holds the person who CAUSED the send. And
-- `recipient` holds a user id too whenever the channel is push —
-- `push_service.send_push` passes `recipient_id`, `expo_push_service` passes
-- `user_id`, neither is a UUID — while also holding email addresses and Meta
-- page ids for other channels. `org_id` is UUID, because
-- `staging.organisations.id` is UUID. Two id columns, two types, one row, and
-- neither is a mistake.
--
-- ── APPLYING THIS FILE RECORDS NOTHING BY ITSELF, AND THE GAP IS SILENT ─────
--
-- 097 carries the same warning; this one has a sharper edge. Any process that
-- has already tried to write this table before it existed has set `_dormant`
-- and WILL NOT RETRY — the flag is per-process and nothing resets it. So:
--
--     1. apply this file
--     2. REDEPLOY THE BACKEND
--     3. verify with the queries at the bottom
--
-- Skipping step 2 leaves a running process logging nothing while the table sits
-- there looking correct and empty. That is the one way to apply this migration
-- successfully and still learn nothing.
--
-- ── LOCKS ───────────────────────────────────────────────────────────────────
--
-- This is one transaction, so every lock is held until COMMIT, which for this
-- file is a few milliseconds away.
--
-- ONLY ONE STATEMENT TOUCHES A RELATION THAT ALREADY EXISTS: the
-- `REFERENCES staging.organisations(id)` in section 1 takes a
-- ShareRowExclusiveLock on `organisations`. That BLOCKS WRITES to organisations
-- — it does NOT block reads, which matters because `organisations` is read on
-- essentially every request in this product. Writes to it are rare (an admin
-- editing org settings) and the lock is held for a catalog update at 3 rows.
--
-- Everything else — the CREATE TABLE itself, the four CREATE INDEXes, the
-- COMMENTs — operates on a relation this transaction created and nothing else
-- can see, so it cannot contend with anything whatever lock it nominally takes.
-- Unlike 096 and 097 there is no ALTER on a live table at all. Nothing is
-- scanned, nothing is rewritten, no row is written.
--
-- `SET LOCAL lock_timeout` still earns its place: the foreign key queues behind
-- any open transaction already holding a lock on `organisations`, and while it
-- queues it blocks writers arriving after it. Five seconds turns the bad case
-- into a clean rollback instead of a hope.
--
-- ── DEPLOY ORDER ────────────────────────────────────────────────────────────
--
-- Apply BEFORE the application change, and it is the only possible order: the
-- writer cannot INSERT into a table that does not exist. Applying it early is
-- free — nothing reads this table and nothing joins to it. Applying it late
-- means every send between the deploy and the migration is lost, one warning at
-- a time, and then silently.

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
--
-- Modelled on `staging.audit_log` (migration 060), which got the SHAPE right —
-- `id BIGINT IDENTITY`, `ts`, a nullable `org_id` UUID, a `user_id` TEXT, a
-- `detail` jsonb — and is barely used: 471 of its 740 rows carry a NULL
-- `resource_type` and only three call sites in the product ever name one. The
-- shape is not what failed there; the discipline of writing it was. Hence the
-- single-writer rule above, and hence NOT NULL on the four columns that make a
-- row mean anything (`channel`, `purpose`, `recipient`, `status`) — audit_log
-- made all but `action` optional and got exactly the fill rate that invites.
--
-- It is deliberately NOT an extension of audit_log. That table answers "who did
-- what to what" for security review; this one answers "what left the building
-- and what did it cost". They share three column names and no queries, and
-- merging them would give the security log a million payslip rows to wade
-- through.
CREATE TABLE IF NOT EXISTS staging.outbound_log (
    -- BIGINT IDENTITY, not UUID, and this is the one place this file disagrees
    -- with 095/096 on a primary key. Those tables hold hundreds of rows and are
    -- referenced by other tables, so a UUID costs nothing there. This one takes
    -- an INSERT on every send forever and is referenced by nothing. A random
    -- UUID key on a high-insert table scatters every insert to a different page
    -- of the index; a monotonic identity appends to one. `audit_log` made the
    -- same call for the same reason.
    --
    -- GENERATED ALWAYS, so the database assigns it and a caller cannot supply
    -- one — which is why the writer carries a correlation id of its own in
    -- `detail->>'event'` and reads the assigned key back with RETURNING rather
    -- than upserting on a key it chose. `_INSERT` in that module omits this
    -- column deliberately; naming it would be an error, not an override.
    --
    -- It is also the tiebreaker for ordering: see the note on `ts`.
    id                   BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

    -- WHEN THE ATTEMPT WAS MADE — the axis all three questions are asked on.
    -- The writer stamps it per row from `datetime.now(timezone.utc)`, so rows
    -- flushed together in one batch keep their own true times; the DEFAULT is
    -- for a hand-written row in a psql session and does not normally fire.
    --
    -- There is deliberately no second timestamp for "when the provider
    -- answered". Two clocks means two answers to "when was this sent", and the
    -- gap is milliseconds for every sender in this product.
    --
    -- NOTE FOR ANY QUERY THAT ORDERS BY IT: NOW() is transaction time, so a
    -- row that did fall back to the default shares a `ts` to the microsecond
    -- with everything else in its statement. ORDER BY `ts DESC, id DESC` — `id`
    -- is what preserves order within a batch, and that is a second reason it is
    -- monotonic rather than random.
    ts                   TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- NULLABLE, and NULL is a real answer: an invite, a password reset and a
    -- magic link are all sent before any org context exists, and a
    -- platform-wide notice belongs to no tenant. Forcing a value would mean
    -- inventing one, and an invented org id makes question 1 wrong for
    -- whichever org got invented at. The writer's `_as_uuid` turns a malformed
    -- org id ('platform', a slug, '') into NULL for the same reason.
    --
    -- ON DELETE CASCADE, matching `hub_org_credit_transactions` (052) and
    -- `org_billing_lines` (096). The alternative, SET NULL, would leave rows
    -- holding a deleted tenant's employees' email addresses with nothing left
    -- to say whose they were — an orphaned pile of personal data is a worse
    -- outcome than a lost row count, and it is exactly the shape of thing the
    -- retention section exists to prevent.
    --
    -- The FK is affordable because a violation costs ONE row: see the batch
    -- salvage paragraph in the header.
    org_id               UUID REFERENCES staging.organisations(id) ON DELETE CASCADE,

    -- WHO CAUSED IT. TEXT (`user_<hex12>`), never UUID — see the header, 030
    -- and 092. NULL for a system send: the cron that mails a report, the
    -- scheduler that fires a reminder, a webhook. Nobody clicked those, and
    -- naming somebody would be a lie in the column people will use to work out
    -- who to ask.
    user_id              TEXT,

    -- THE FAMILY, NOT THE PROVIDER, AND FOUR VALUES ONLY.
    --
    -- Senders speak a compound vocabulary that predates this table —
    -- `suppressed("push:expo", …)`, `(f"social:{platform}", …)` — and the
    -- writer's `_split_channel` is the translation: 'push:expo' becomes channel
    -- 'push' + provider 'expo', 'social:whatsapp_business' becomes channel
    -- 'whatsapp' + provider 'meta'. Doing it there rather than here is what
    -- keeps fourteen senders from having to learn a schema, and it means an
    -- unmappable channel is DROPPED with a named warning rather than filed
    -- under a legal-looking family — a row under the wrong family is a wrong
    -- answer to question 1 and nothing about it looks wrong afterwards.
    --
    -- 'whatsapp' is in the list even though nothing sends WhatsApp today —
    -- `routers/whatsapp.py:send_wa_message` stores 'pending' behind a
    -- `TODO: Call Meta Cloud API`, and `outbound.py` says it must be guarded
    -- before it ships. Leaving it out would mean the first real WhatsApp
    -- message in this product is unlogged, which is the failure this file is
    -- about. `_SUBCHANNELS` already routes `social:whatsapp_business` here.
    --
    -- THE CONSTRAINT IS NAMED BECAUSE THE WRITER NAMES IT BACK, in the warning
    -- it prints when it drops a channel it cannot map. Renaming it here makes
    -- that message point at nothing.
    --
    -- TO ADD A CHANNEL LATER ('sms', 'voice'), DO NOT WRITE A PLAIN
    -- `ADD CONSTRAINT`: on a table this size it validates every existing row
    -- under AccessExclusiveLock. Write it as
    --     ALTER TABLE staging.outbound_log DROP CONSTRAINT outbound_log_channel_ck;
    --     ALTER TABLE staging.outbound_log ADD CONSTRAINT outbound_log_channel_ck
    --         CHECK (channel IN (…)) NOT VALID;
    -- which skips the scan, then VALIDATE CONSTRAINT later under
    -- ShareUpdateExclusiveLock, which blocks nothing.
    channel              TEXT NOT NULL
                         CONSTRAINT outbound_log_channel_ck
                         CHECK (channel IN ('email','push','whatsapp','social')),

    -- WHAT IT WAS FOR: payslip, invoice, campaign, mention, reminder, invite,
    -- password_reset, report. DELIBERATELY NOT A CHECKED VOCABULARY, and that
    -- is the opposite call from `channel` one line up.
    --
    -- The set is open and grows every time somebody adds an email to the
    -- product. A CHECK here would mean a new notification needs a migration —
    -- and, worse, that shipping the notification without it loses the log row.
    -- The failure mode of an unchecked `purpose` is a typo that splits one
    -- bucket into two on a report, which a human notices. The failure mode of a
    -- checked one is silence.
    --
    -- NOT NULL, with the writer defaulting to `_DEFAULT_PURPOSE` =
    -- 'unclassified' rather than inventing a category: senders do not all pass
    -- one yet, and an obviously unfinished bucket is honest where a plausible
    -- category would quietly absorb everything. When it derives one from a
    -- `ref` like 'payslip:PS-2026-08-42' it takes the part before the colon and
    -- keeps the whole string in `detail.ref`.
    --
    -- WATCH THE 'unclassified' COUNT. It should fall as senders are taught to
    -- pass a purpose; if it is still most of the table in a month, question 1
    -- cannot be broken down and this column is decoration.
    purpose              TEXT NOT NULL,

    -- WHO IT WAS AIMED AT, as the sender addressed it: an email address, a
    -- `user_<hex12>` for push, a Meta page id or account name for social.
    --
    -- NOT NULL — nothing in this product sends into the void, and every sender
    -- has a target in hand at the choke point. Where one genuinely does not,
    -- the writer stores `_UNKNOWN_RECIPIENT` = '(unknown)' rather than NULL:
    -- NOT NULL forces the writer to NAME what it aimed at, and '(unknown)' is
    -- itself a countable finding. If a future channel broadcasts, the recipient
    -- is the topic or page it was broadcast to.
    --
    -- STORED VERBATIM, NOT NORMALISED. The case and form the provider saw is
    -- what a bounce investigation needs. Case-insensitive lookup is an index on
    -- `lower(recipient)` in section 2, NOT lowercasing on write — see the
    -- warning attached to that index, because a query written the ordinary way
    -- will silently not use it.
    --
    -- THIS COLUMN IS PERSONAL DATA. It is why section 4 exists and why org
    -- deletion cascades.
    recipient            TEXT NOT NULL,

    -- The email Subject or the push title. NULL for social, which has no
    -- subject — and NULL is the correct value there, not missing data. Do not
    -- fill it with the first N characters of the post; see the header. Clipped
    -- to 200 characters by the writer, which doubles as the ceiling on anything
    -- mistaken for a subject.
    subject_or_title     TEXT,

    -- WHO CARRIED IT: 'ses', 'resend', 'expo', 'webpush', 'meta', 'google',
    -- 'x'. NOT CHECKED — the provider list changes with commercial decisions,
    -- not schema decisions, and `email_service.send_email` picks between Resend
    -- and SES at call time depending on which client is configured, so it is
    -- not derivable from the channel and has to be recorded.
    --
    -- NULL when no provider was ever chosen, which is the normal case for
    -- `status = 'suppressed'`: the kill switch returns before any client is
    -- touched. A suppressed row with a provider set would be claiming a
    -- decision that was never made — the writer withholds even the provider it
    -- could have inferred from 'social:facebook', for exactly that reason.
    provider             TEXT,

    -- The id the provider handed back: SES `MessageId`, Resend `id`, the Expo
    -- ticket id (or a comma-joined list, one per device). THE ONLY STRING THAT
    -- TIES A ROW HERE TO A RECORD ON THE PROVIDER'S SIDE, which is what turns
    -- "we think we sent it" into "here is the receipt". NULL until the provider
    -- answers, and permanently NULL for a suppressed send and for a failure
    -- that never reached the provider.
    provider_message_id  TEXT,

    -- 'queued'     handed to the sender, outcome not yet known.
    -- 'sent'       the provider ACCEPTED it and usually returned an id.
    -- 'suppressed' `OUTBOUND_MODE=dry` refused it. NOT a failure: it is the
    --              correct, expected outcome for every send on staging, which
    --              is why it is deliberately absent from the trouble index.
    -- 'failed'     the provider refused it or the call raised.
    --
    -- 'queued' IS AN ADDITION TO THE THREE VALUES THIS TABLE WAS SPECIFIED
    -- WITH, and it is here because of how `email_service.send_email` is built:
    -- it hands the message to a thread and returns True BEFORE the provider is
    -- called, so the outcome exists only inside that thread. A writer that logs
    -- only when the outcome is known records nothing at all if the process dies
    -- mid-flight — and Railway redeploys this service constantly, which is how
    -- the original log history was lost. A row written 'queued' and moved to
    -- 'sent'/'failed' survives that, AND A ROW STILL READING 'queued' AN HOUR
    -- LATER IS ITSELF THE FINDING.
    --
    -- IN PRACTICE MOST ROWS ARE NEVER WRITTEN AS 'queued' AT ALL: a send takes
    -- milliseconds, the writer's buffer is keyed by correlation id, and an
    -- outcome that arrives before the flush supersedes the attempt in memory so
    -- one row is inserted already final. 'queued' is what survives the case
    -- where that does not happen, which is the case worth surviving.
    --
    -- 'bounced' IS DELIBERATELY ABSENT even though hard bounces caused this
    -- whole investigation. Nothing in this product could write it: there is no
    -- SNS topic, no webhook and no handler for SES delivery notifications. A
    -- status no code path can produce is a column that lies by looking
    -- complete. When that handler is built, note that a bounce is a LATER FACT
    -- about a row that was genuinely 'sent' — overwriting the status would
    -- destroy the fact that SES accepted and BILLED it — so it wants its own
    -- column, not a fifth value here.
    --
    -- NAMED, like the channel constraint, because the writer's constants
    -- reference it.
    status               TEXT NOT NULL
                         CONSTRAINT outbound_log_status_ck
                         CHECK (status IN ('queued','sent','suppressed','failed')),

    -- Why it failed, in whatever words the provider or the exception used.
    -- Also carries partial-success detail: the Expo path records per-device
    -- refusals here even on a 'sent' row, because "delivered to the phone but
    -- not the tablet" is a third fact neither status word alone can state.
    --
    -- NOT length-constrained. A CHECK here would drop the log row for the
    -- longest error message, which is invariably the interesting one. The
    -- writer caps it at 500 characters instead, by TRUNCATING — never by
    -- discarding the row.
    error                TEXT,

    -- SIZE OF THE PAYLOAD, IN BYTES. This is the column the AWS bill is made of.
    --
    -- SES bills in message units: one unit per 256 KB, a larger message costs
    -- ceil(size / 256 KB) units, minimum one. So a payslip email with a PDF
    -- attached costs several times what a plain notification costs, and A COUNT
    -- OF ROWS IS NOT A COUNT OF THE BILL. The arithmetic, stated once here and
    -- repeated in the verification block:
    --
    --     GREATEST(1, ceil(bytes / 262144.0))
    --
    -- (Check the current SES pricing page before quoting a figure back to AWS.
    -- The unit size is theirs to change and this comment is not authoritative
    -- about their pricing.) There is deliberately NO generated column holding
    -- that result: it would bake a third party's constant into stored data on
    -- the biggest table in the product, and changing it later would be a table
    -- rewrite. `bytes` is the fact; units are a derivation, and derivations
    -- belong in the query.
    --
    -- IT IS A FLOOR, NOT A METER READING, and that must be said because the
    -- number looks exact. `send_email` records `len(html) + len(text)`; the
    -- MIME framing, the headers and the base64 expansion of any attachment are
    -- added downstream, and base64 alone inflates an attachment by about a
    -- third (`encoders.encode_base64` in `services/employee_email.py`). What it
    -- captures is the part that varies by orders of magnitude, which is the
    -- part that explains a bill.
    --
    -- NULLABLE, AND NULL IS NOT ZERO. NULL = not measured or not applicable —
    -- `expo_push_service` deliberately leaves it unset because Expo bills
    -- nothing by size and a number here for a push would make the column mean
    -- two things. 0 would claim a measurement of nothing, which is never true
    -- of an email. Any sum over this column must be read beside a count of the
    -- NULLs under it; see the verification block, which does.
    --
    -- The CHECK can only fire on a coding error, and the writer's `_as_bytes`
    -- turns a negative or unparseable size into NULL before it gets here. It is
    -- a statement of what the column means, not a filter.
    bytes                INTEGER
                         CONSTRAINT outbound_log_bytes_ck
                         CHECK (bytes IS NULL OR bytes >= 0),

    -- Structured context: `mode` ('dry'/'live'), `ref` (the full
    -- 'payslip:PS-2026-08-42'), `event` (the writer's correlation id, present
    -- only while a row is still completable and removed when it is finalised),
    -- and whatever else names a thing. NAMES OF THINGS, NEVER CONTENTS OF
    -- THINGS.
    --
    -- `detail.mode` is worth calling out: there is no `mode` column, and this
    -- is the only value on the row that says whether the process was in
    -- `OUTBOUND_MODE=dry` or live. Staging and production write to the SAME
    -- `staging` schema, so without it the two are indistinguishable in this
    -- table — and a row that says 'dry' but 'sent' is a sender that bypassed
    -- the kill switch, which has happened twice in this codebase (both via a
    -- sender that built its own MIME and called SES directly; both closed).
    -- Query (e) in the verification block is that check.
    --
    -- NOT NULL DEFAULT '{}' so every read is `detail->>'x'` with no COALESCE
    -- and no third state, and so the constraint below is evaluated on every
    -- row: on a NULL `detail`, `detail ? 'body'` is NULL, `NOT NULL` is NULL,
    -- and a CHECK only fails on FALSE — so it would pass vacuously. Nothing is
    -- lost by that (a NULL detail holds no body either), but "the constraint
    -- applies to every row" is a simpler sentence than "…to every row that has
    -- a detail", and simple sentences are what a log is for. The writer's
    -- UPDATE path also does `l.detail || u.detail`, which would yield NULL if
    -- either side could be NULL.
    detail               JSONB NOT NULL DEFAULT '{}'::jsonb,

    -- THE TRIPWIRE. See the header for why this is not a security boundary and
    -- why the writer strips these four keys before they arrive. They are the
    -- names somebody reaches for when they want "just a bit of the email for
    -- debugging", which is how a table of subjects becomes a table of salaries.
    -- `?` tests for an exact key, so `content_id` and `body_html_url` are
    -- unaffected.
    CONSTRAINT outbound_log_no_body_ck CHECK (
        NOT (detail ? 'body' OR detail ? 'html' OR detail ? 'text' OR detail ? 'content')
    )
);
-- ── WHAT THIS LOCKS ─────────────────────────────────────────────────────────
--
-- AccessExclusiveLock on a relation that does not exist yet, so nothing can be
-- waiting on it and nothing can arrive to wait on it — the table is invisible
-- outside this transaction until COMMIT.
--
-- The `REFERENCES staging.organisations(id)` takes a ShareRowExclusiveLock on
-- `organisations`: it blocks WRITES to that table, not reads, for a catalog
-- update at 3 rows. This is the only statement in the file that can contend
-- with live traffic, and `lock_timeout` above is set for it.
--
-- No table is scanned. No row is written. Nothing is backfilled.


-- ════════════════════════════════════════════════════════════════════════════
-- 2. FOUR INDEXES, THREE QUESTIONS
-- ════════════════════════════════════════════════════════════════════════════
--
-- Every index below is on a relation this transaction just created, holding
-- zero rows. Each is a catalog entry and an empty index: instant, and unable to
-- contend with anything.
--
-- NOT CREATED CONCURRENTLY, AND THEY CANNOT BE — `CREATE INDEX CONCURRENTLY` is
-- illegal inside a transaction block and this file must stay one BEGIN/COMMIT.
-- At zero rows the point is moot; it is stated so the next author does not
-- reintroduce the question. It IS the right question for any index added to
-- this table LATER: by then a plain CREATE INDEX takes a ShareLock that blocks
-- every send trying to write a row, and the answer will be CONCURRENTLY,
-- outside a transaction.

-- QUESTION 1: "what did we send this org this month".
-- org_id leads because it is always an equality; ts DESC because the answer is
-- always a bounded recent window, read newest-first.
CREATE INDEX IF NOT EXISTS idx_outbound_log_org_ts
    ON staging.outbound_log (org_id, ts DESC);

-- QUESTION 2: "did THIS person get it".
--
-- FUNCTIONAL, ON lower(recipient), AND THE QUERY MUST MATCH THE EXPRESSION OR
-- THE INDEX IS NOT USED:
--
--     WHERE lower(recipient) = lower($1)      -- uses the index
--     WHERE recipient = $1                    -- SEQUENTIAL SCAN, and worse
--
-- Both forms return an answer, which is what makes this dangerous rather than
-- merely slow. The second is unusably slow at scale AND WRONG in the ordinary
-- case: an address stored as `Keval.Shah@Example.com` and searched as
-- `keval.shah@example.com` returns ZERO ROWS. "We never emailed them" is the
-- worst possible wrong answer this table can give, and a plain index invites
-- it.
--
-- The alternative — normalising on write — was rejected in the column comment:
-- the exact string the provider was given is what a bounce investigation needs,
-- and lowercasing destroys evidence to save an index expression. Push and
-- social recipients (`user_<hex12>`, numeric page ids) are already lowercase,
-- so lower() is a no-op for them and one index serves all four channels.
CREATE INDEX IF NOT EXISTS idx_outbound_log_recipient
    ON staging.outbound_log (lower(recipient), ts DESC);

-- QUESTION 3: "what failed" — and "what never came back", which is the same
-- screen and the same index.
--
-- PARTIAL, because 'sent' and 'suppressed' will be very nearly the whole table
-- and nobody scans this log for successes without an org filter (which question
-- 1 already serves). A partial index over the trouble states stays small enough
-- to live in cache permanently, which is what makes "what is broken right now"
-- an instant answer instead of a report.
--
-- A PARTIAL PREDICATE IS A SECOND PLACE THE STATUS VOCABULARY LIVES, and that
-- is only safe because the vocabulary is CHECKed. Adding 'bounced' already
-- requires a migration to widen `outbound_log_status_ck`; THAT MIGRATION MUST
-- ALSO WIDEN THIS PREDICATE, in the same file, or the new status is invisible
-- to the only query that looks for trouble. If the CHECK is ever dropped, this
-- index must become a plain `(status, ts DESC)` in the same commit — an
-- unchecked vocabulary and a hand-maintained predicate is how a failure query
-- silently starts under-reporting.
--
-- 'queued' is in the predicate deliberately: a row still queued an hour later
-- is a failure of a different kind — the process died between the provider call
-- and the answer — and belongs on the same screen as the refusals.
--
-- COST, HONESTLY: a row written 'queued' ENTERS this index at insert and LEAVES
-- it at the completing update, and because `status` is in the predicate that
-- update cannot be a HOT update. That is smaller than it sounds, because the
-- writer's buffer collapses an attempt and a fast outcome into ONE insert that
-- is already final and never enters this index at all. Only a message whose
-- provider answers after its batch has flushed pays for it. Whoever changes the
-- writer's buffering should reread this paragraph rather than rediscover it.
CREATE INDEX IF NOT EXISTS idx_outbound_log_trouble
    ON staging.outbound_log (ts DESC)
    WHERE status IN ('queued','failed');

-- THE QUESTION THAT STARTED ALL OF THIS, which has no org filter: "how many
-- emails went out in August, and how many message units was that".
--
-- BRIN, NOT BTREE. This table is append-only and `id` is monotonic, so physical
-- order correlates almost perfectly with `ts` — the exact condition BRIN exists
-- for. It costs kilobytes where a btree on `ts` would cost hundreds of
-- megabytes, and almost nothing to maintain per insert, which is what matters
-- on this table. A month-wide scan reads a fraction of the heap instead of all
-- of it.
--
-- It also serves the retention DELETE in section 4, which is `WHERE ts < …` and
-- would otherwise scan the entire table every single day forever.
--
-- ITS ONE PRECONDITION IS THAT CORRELATION, and nothing enforces it. If a
-- future migration backdates rows — importing history from a provider's API,
-- say — this index degrades toward useless and NOTHING WARNS YOU. Import in
-- `ts` order, or REINDEX afterwards.
CREATE INDEX IF NOT EXISTS idx_outbound_log_ts_brin
    ON staging.outbound_log USING BRIN (ts);

-- DELIBERATELY NOT INDEXED:
--   · `purpose`, `provider`, `channel` on their own. Every real question about
--     them is already scoped by org or by time, so they are filters on a small
--     result set rather than entry points into a large one.
--   · `user_id`. "What did this person cause to be sent" is not one of the
--     three questions and has never been asked. If it starts being asked, that
--     is an index in a later migration, created CONCURRENTLY.
--   · `detail` (no GIN). Nothing queries into the jsonb yet, and a GIN index on
--     a high-insert table is expensive and speculative. "What did this payroll
--     run send" is answerable today via `org_id` + `ts` and a filter on
--     `detail->>'ref'`, over one org-month.
--   · `provider_message_id`. Looked up ~never, and only by someone already
--     holding a receipt from the provider's side.
--
-- Four indexes and a primary key is the budget. Each is paid for on every send,
-- forever. A fifth needs a question attached that these four cannot answer.


-- ════════════════════════════════════════════════════════════════════════════
-- 3. THE RULES, ON THE SCHEMA ITSELF
-- ════════════════════════════════════════════════════════════════════════════
--
-- `\d+ staging.outbound_log` shows these. Somebody will meet this table through
-- the schema and not through this file, and the rules that must survive that
-- meeting belong where they will be read.
COMMENT ON TABLE staging.outbound_log IS
  'One row per ATTEMPTED send, every channel. Written by exactly ONE module, '
  'services/outbound_log.py; no router and no other service may INSERT or '
  'UPDATE here, reads are open. NEVER STORE MESSAGE BODIES: subject and '
  'recipient answer every question this table exists for, and a body turns a '
  'support query into a salary disclosure. Retention: 400 days, enforced by '
  'staging.cleanup_old_data(). See migration 098.';

COMMENT ON COLUMN staging.outbound_log.user_id IS
  'Who CAUSED the send. TEXT (user_<hex12>), never UUID — see migrations 030 '
  'and 092. NULL for a system send: cron, scheduler, webhook.';

COMMENT ON COLUMN staging.outbound_log.channel IS
  'The family only: email | push | whatsapp | social. Senders speak a compound '
  'vocabulary (push:expo, social:facebook); services/outbound_log.py splits it '
  'into this column and provider.';

COMMENT ON COLUMN staging.outbound_log.purpose IS
  'What it was for: payslip, invoice, reminder. Unchecked on purpose — a new '
  'notification must not need a migration. ''unclassified'' means the sender '
  'has not been taught to pass one yet; watch that count fall.';

COMMENT ON COLUMN staging.outbound_log.recipient IS
  'Who it was aimed at, verbatim as the provider saw it: email address, '
  'user_<hex12> for push, page/account id for social. PERSONAL DATA. Look it '
  'up as lower(recipient) = lower($1) or the index is not used and the answer '
  'may be a false negative. ''(unknown)'' means the sender had no target.';

COMMENT ON COLUMN staging.outbound_log.subject_or_title IS
  'Email Subject or push title. NULL for social, which has no subject — do NOT '
  'fill it with an excerpt of the post; that is the client''s content.';

COMMENT ON COLUMN staging.outbound_log.status IS
  'queued | sent | suppressed | failed. queued = the provider never answered; '
  'a row still queued an hour later means the process died. sent = accepted, '
  'which is not arrived. suppressed = OUTBOUND_MODE=dry, and not a failure.';

COMMENT ON COLUMN staging.outbound_log.bytes IS
  'Payload size the sender could measure. A FLOOR: MIME framing and base64 '
  'expansion are added downstream. SES message units = '
  'GREATEST(1, ceil(bytes/262144.0)). NULL = not measured or not applicable '
  '(Expo bills nothing by size); NULL is not 0.';

COMMENT ON COLUMN staging.outbound_log.detail IS
  'Names of things, never contents of things: mode (dry|live — the only record '
  'of which environment produced the row), ref, event. '
  'outbound_log_no_body_ck refuses the four obvious body key names; it is a '
  'tripwire, not a boundary — the writer strips them first.';


-- ════════════════════════════════════════════════════════════════════════════
-- 4. RETENTION — 400 DAYS, AND WHO ENFORCES IT
-- ════════════════════════════════════════════════════════════════════════════
--
-- THIS SECTION EXECUTES ONE DO BLOCK THAT ONLY RAISES A MESSAGE. It creates no
-- job, no trigger and no function. Read on for why that is the correct amount
-- of machinery and not a gap.
--
-- ── THE POLICY ──────────────────────────────────────────────────────────────
--
--     A row is deleted 400 days after its `ts`. Deleted, not archived.
--
-- 400 days, not 90 and not 365. The whole purpose of this table is answering a
-- question about a bill, and the second question anyone asks after "why is
-- August 2,586 units" is "what was August LAST year". At exactly 365 days last
-- August is gone on the day you ask; 400 gives five weeks of slack for a bill
-- that arrives at the start of the following month and a dispute that takes a
-- fortnight. Below a year the table cannot answer its own reason for existing.
--
-- ONE WINDOW, ONE MEANING, and no early anonymisation. Nulling `recipient` at
-- 90 days and deleting the row at 400 was considered and rejected: it creates a
-- period where question 2 returns a row with no recipient, an answer
-- indistinguishable from a bug, and it doubles the write cost of retention by
-- passing over the same rows twice. If a client DPA ever requires the shorter
-- window on the personal data, it is one more statement in the same function —
-- not a different design.
--
-- NOT PER-ORG, unlike `pahchan_policy`'s retention windows. Those are a promise
-- made to a tenant's employees about a tenant's biometric data and are
-- genuinely a per-tenant legal question. This is Aekam's own operational record
-- of Aekam's own sending against Aekam's own AWS account. One number.
--
-- Org deletion takes rows out early via the ON DELETE CASCADE in section 1.
-- That is intended: a deleted tenant's recipient addresses must not outlive the
-- tenant.
--
-- ── WHO ENFORCES IT: THE JOB THAT ALREADY EXISTS ────────────────────────────
--
-- `POST /api/internal/cron/retention` (routers/scheduler.py:55) runs daily from
-- the `retention-cron` service already in production, and its entire body is:
--
--     SELECT * FROM staging.cleanup_old_data()
--
-- That function is where this table's DELETE belongs. NOT a second cron entry,
-- NOT a trigger, NOT a partition-drop scheme:
--
--   · A second job is a second thing to notice has stopped. `pahchan-retention`
--     earned its own entry because it deletes photographs of people's faces on
--     a promise made to a client and its failure has to be visible on its own;
--     trimming an operational log does not clear that bar.
--   · PARTITIONING BY MONTH WAS CONSIDERED AND REJECTED, and this is the one
--     rejection worth spelling out, because it is otherwise the obvious answer
--     for a log this size. Retention would become DROP PARTITION — instant, no
--     bloat, no vacuum. But a range-partitioned table needs next month's
--     partition to exist BEFORE next month, and if it does not, every INSERT
--     raises 23514 "no partition of relation found for row". The writer treats
--     class 23 as one bad row, retries the batch one row at a time, loses all
--     of them, and warns once a minute — so a forgotten maintenance task
--     becomes A MONTH OF MISSING SENDS discovered by nobody. A DEFAULT
--     partition avoids the error and quietly reintroduces the unbounded table
--     this was meant to solve. The failure mode of a missed DELETE is a table
--     that grows; the failure mode of a missed partition is a hole in the
--     record. Not worth it at this volume.
--
-- ── THE STATEMENT TO ADD TO cleanup_old_data() ──────────────────────────────
--
-- Batched, not a single unbounded DELETE. One DELETE over a year of this table
-- holds a long transaction, bloats WAL, and blocks autovacuum from cleaning up
-- behind it:
--
--     WITH doomed AS (
--         SELECT id FROM staging.outbound_log
--          WHERE ts < NOW() - INTERVAL '400 days'
--          LIMIT 20000
--     )
--     DELETE FROM staging.outbound_log l
--      USING doomed d
--      WHERE l.id = d.id;
--
-- No ORDER BY: any 20,000 of the doomed set will do, and ordering would force a
-- sort on top of the BRIN bitmap scan for nothing.
--
-- AND IT MUST DRAIN, NOT SLICE. `services/pahchan_retention.py` carries the
-- scar tissue and states it plainly: a fixed slice per run "quietly could not
-- keep up… The job completed, logged `photos_deleted: 500` and looked healthy
-- every single day while falling further behind — a retention job that reports
-- success while not keeping the promise is worse than one that fails loudly,
-- because it manufactures a record of compliance." The arithmetic is identical
-- here: if a day's sends exceed one run's deletions, the 400-day window is
-- never honoured and the job says it is. So loop the statement until it deletes
-- zero, under a per-run ceiling, and RETURN THE COUNT — the cron logs whatever
-- `cleanup_old_data()` returns, one row per table, and a table MISSING from
-- that output is a table nobody is pruning.
--
-- ── THE THING THIS FILE COULD NOT VERIFY ────────────────────────────────────
--
-- `staging.cleanup_old_data()` IS CALLED BY routers/scheduler.py:60 AND IS
-- DEFINED IN NO MIGRATION IN THIS REPOSITORY. It arrived in commit 2b1c4442
-- ("scheduler: add /cron/retention endpoint for daily data cleanup",
-- 2026-07-23), which changed three Python files and no SQL. Either it was
-- created by hand against the database and its definition lives nowhere in
-- version control, or it does not exist and that endpoint has raised
-- UndefinedFunction on every daily run since — in which case NOTHING in this
-- product is being pruned and this table's growth is the least of it.
--
-- This file does not resolve that, deliberately. Writing `CREATE OR REPLACE
-- FUNCTION staging.cleanup_old_data()` here would either overwrite a function
-- whose body nobody in this repo has read — silently disabling every other
-- retention rule it holds — or invent a new one and make this migration the
-- second retention mechanism it was told not to build. Both are worse than
-- saying so out loud.
--
-- The DO block below says it out loud, at apply time, at zero risk: a WARNING,
-- never an exception. The table is created either way — a log with an
-- unenforced retention policy is still enormously better than no log — but
-- nobody gets to apply this file without being told.
DO $$
BEGIN
    IF to_regprocedure('staging.cleanup_old_data()') IS NULL THEN
        RAISE WARNING
          'staging.cleanup_old_data() DOES NOT EXIST. routers/scheduler.py:60 '
          'calls it daily, so POST /api/internal/cron/retention has been '
          'failing on every run: nothing in this database is being pruned, '
          'including the table this migration just created. Fix that before '
          'outbound_log starts taking a row per send. See section 4 of '
          '098_outbound_log.sql.';
    ELSE
        RAISE NOTICE
          'staging.cleanup_old_data() exists. It does NOT yet prune '
          'staging.outbound_log: add the batched DELETE from section 4 of '
          '098_outbound_log.sql to it, or this table grows forever.';
    END IF;
END $$;
-- Lock: AccessShareLock on the catalog only. Instant. Writes nothing.

COMMIT;


-- ════════════════════════════════════════════════════════════════════════════
-- RUN THIS AFTER COMMIT AND READ IT WITH YOUR EYES. DO NOT AUTOMATE IT.
-- ════════════════════════════════════════════════════════════════════════════
--
-- 0. REDEPLOY THE BACKEND BEFORE BELIEVING ANY COUNT BELOW. Any process that
--    tried to write this table before it existed has set its in-memory
--    `_dormant` flag and will never retry — the flag is per-process and nothing
--    resets it. An empty table after a successful migration usually means the
--    running process gave up hours ago, not that nothing was sent.
--
-- 1. The table is there and the two id columns have the two types this file
--    spent a section on. `user_id` MUST say `text`; if it says `uuid`, every
--    send is dropped exactly as 030 and 092 describe. `org_id` MUST say `uuid`.
--    `id` MUST be `bigint` and its column_default MUST be null with
--    is_identity = YES — a plain default here means the writer's RETURNING
--    correlation cannot work:
SELECT column_name, data_type, is_nullable, column_default, is_identity
  FROM information_schema.columns
 WHERE table_schema = 'staging'
   AND table_name   = 'outbound_log'
 ORDER BY ordinal_position;

-- 2. THE COLUMN NAMES MUST MATCH THE WRITER EXACTLY. This returns nothing if
--    they do. Any row it returns is a column `services/outbound_log.py`
--    `_INSERT_COLUMNS` names and this table does not have — which means 42703,
--    dormancy, one warning, and then silence:
SELECT expected
  FROM unnest(ARRAY['ts','org_id','user_id','channel','purpose','recipient',
                    'subject_or_title','provider','provider_message_id',
                    'status','error','bytes','detail']) AS expected
 WHERE expected NOT IN (
       SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'staging' AND table_name = 'outbound_log');

-- 3. The four constraints the writer names back at this file. All four must be
--    present, spelled exactly like this, or its warnings point at nothing and
--    its `_detail`/`_as_bytes` coercions are guarding a rule that is not there:
SELECT conname, pg_get_constraintdef(oid)
  FROM pg_constraint
 WHERE conrelid = 'staging.outbound_log'::regclass
   AND contype IN ('c','f')
 ORDER BY conname;
-- expect: outbound_log_bytes_ck, outbound_log_channel_ck,
--         outbound_log_no_body_ck, outbound_log_status_ck, and the org_id fkey

-- 4. Four indexes plus the primary key, and the shapes they were argued for —
--    one partial, one BRIN, one functional on lower(recipient):
SELECT indexname, indexdef
  FROM pg_indexes
 WHERE schemaname = 'staging'
   AND tablename  = 'outbound_log'
 ORDER BY indexname;

-- 5. AFTER the redeploy, these are the questions, written out so nobody has to
--    reinvent them — and so the lower() form and the message-unit arithmetic
--    are copied rather than guessed.
--
--    (a) What did we send this org this month:
--
--        SELECT channel, purpose, status,
--               count(*)                                        AS sends,
--               sum(GREATEST(1, ceil(bytes / 262144.0)))::bigint AS ses_units,
--               count(*) FILTER (WHERE bytes IS NULL)            AS unmeasured
--          FROM staging.outbound_log
--         WHERE org_id = $1
--           AND ts >= date_trunc('month', NOW())
--         GROUP BY 1, 2, 3
--         ORDER BY sends DESC;
--
--        `unmeasured` is not decoration. NULL is not 0, and GREATEST IGNORES
--        NULLs — `GREATEST(1, NULL)` is 1, not NULL — so an unmeasured row
--        quietly contributes one unit. The total is a FLOOR, which is exactly
--        the kind of number this table exists to stop us reporting as a total.
--        Read the two columns together or not at all.
--
--    (b) Did this person get it — note lower() on BOTH sides:
--
--        SELECT ts, channel, purpose, subject_or_title, status,
--               provider, provider_message_id, error, detail->>'mode' AS mode
--          FROM staging.outbound_log
--         WHERE lower(recipient) = lower($1)
--         ORDER BY ts DESC, id DESC
--         LIMIT 50;
--
--    (c) What failed, and what never came back — this is the partial index:
--
--        SELECT ts, channel, purpose, recipient, status, provider, error
--          FROM staging.outbound_log
--         WHERE status IN ('queued','failed')
--           AND ts > NOW() - INTERVAL '7 days'
--         ORDER BY ts DESC, id DESC;
--
--        A row still reading 'queued' after a few minutes is not waiting for
--        anything. The process died between the provider call and the answer.
--
--    (d) The one that started all of this — the whole AWS month, every org:
--
--        SELECT date_trunc('day', ts) AS day,
--               count(*)                                        AS emails,
--               sum(GREATEST(1, ceil(bytes / 262144.0)))::bigint AS ses_units
--          FROM staging.outbound_log
--         WHERE channel = 'email'
--           AND status  = 'sent'
--           AND detail->>'mode' = 'live'
--           AND ts >= date_trunc('month', NOW())
--         GROUP BY 1
--         ORDER BY 1;
--
--    (e) DID ANYTHING BYPASS THE KILL SWITCH. Must return zero rows forever. A
--        row here is a sender that built its own MIME and called the provider
--        directly instead of going through the guarded path, which has happened
--        twice already:
--
--        SELECT ts, channel, purpose, recipient, provider, provider_message_id
--          FROM staging.outbound_log
--         WHERE detail->>'mode' = 'dry'
--           AND status IN ('sent','failed');
--
--    (f) WERE WE MAILING NOWHERE. The 960 payslips went to `@example.com`,
--        reserved by RFC 2606, which can only ever hard-bounce. This is the
--        query nobody could run in August:
--
--        SELECT date_trunc('day', ts) AS day, count(*)
--          FROM staging.outbound_log
--         WHERE channel = 'email' AND detail->>'mode' = 'live'
--           AND (recipient ILIKE '%@example.com' OR recipient ILIKE '%@example.org'
--                OR recipient ILIKE '%@test.%'   OR recipient ILIKE '%@localhost')
--         GROUP BY 1 ORDER BY 1;
--
--    (g) IS `purpose` REAL YET. If 'unclassified' is still most of the table in
--        a month, question 1 cannot be broken down and the column is decoration:
--
--        SELECT purpose, count(*) FROM staging.outbound_log
--         GROUP BY 1 ORDER BY 2 DESC;
--
-- 6. Retention is NOT enforced until staging.cleanup_old_data() prunes this
--    table. This is the check that it does, and it must eventually return a row
--    whose table_name is 'outbound_log':
--
--        SELECT * FROM staging.cleanup_old_data();
--
--    Until it does, this is the size of the problem accumulating:
--
--        SELECT count(*) AS rows, min(ts) AS oldest,
--               pg_size_pretty(pg_total_relation_size('staging.outbound_log')) AS on_disk
--          FROM staging.outbound_log;
