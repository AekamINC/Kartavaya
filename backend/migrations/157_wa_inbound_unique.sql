-- 157 · staging.varta_messages gets the unique index the webhook's dedupe
--       comment promised ("A unique index on (org_id, wa_message_id) is the
--       eventual guarantee; it is a shared-DB migration and ships separately").
--       This is that migration.
--
-- THE RACE IT CLOSES: Meta redelivers a whole batch whenever the webhook
-- fails to 200 — and it does not wait politely. `webhook_receive` dedupes
-- with a SELECT-1 seen-check inside each message's own transaction, so two
-- deliveries of the same batch arriving concurrently can BOTH observe "not
-- seen" before either commits, and one customer message lands twice: two
-- inbox rows, and only the event layer's `dedupe_key="wa.in:{id}"` belt
-- stopping the second whatsapp.inbound. The seen-check closes the loop
-- between committed transactions; this index closes the window inside it —
-- the second INSERT now fails, its transaction rolls back whole (row, event,
-- contact bump all together), and the batch still 200s or errors honestly.
--
-- The key is (org_id, direction, wa_message_id) — the three columns the
-- router's own seen-check names, in its own scope.
--
-- WHY PARTIAL, term by term:
--   wa_message_id IS NOT NULL — outbound `suppressed` rows carry no wamid by
--       design, and MEASURED LIVE every current row is NULL (below). NULLs
--       never collide under a unique index anyway; the predicate makes the
--       exclusion stated rather than incidental, and keeps the index empty
--       until a real Meta id arrives.
--   wa_message_id <> '' — the webhook stores '' (not NULL) for a message
--       Meta sends without an id, SKIPS the seen-check for it, and
--       `test_an_empty_wa_id_still_inserts_with_no_dedupe_key` pins that
--       id-less messages may repeat per org. An index that counted '' would
--       500 the second id-less message in any org — a contract this
--       migration has no business rewriting.
--   direction = 'inbound' — the seen-check's own scope. Outbound is excluded
--       ON PURPOSE: Meta's Cloud API deduplicates identical sends inside a
--       short window and can hand back the SAME wamid twice, and
--       `send_wa_message` records the row AFTER Meta accepts. A unique index
--       over outbound rows would fail that INSERT post-send — manufacturing
--       the "customer has it, we have no record" failure the send path
--       tolerates only as a rare accident, never as a constraint's doing.
--
-- MEASURED LIVE BEFORE THIS RAN (2026-08-19, SELECT-only probe):
-- staging.varta_messages exists in ONE schema (no public twin — consistent
-- with migration 142); 500 rows, 250 inbound + 250 outbound, ALL 500 with
-- wa_message_id NULL (seed data — no real Meta message has ever landed,
-- which matches varta_business_accounts having nothing connected); zero
-- empty-string ids; ZERO duplicate groups under any scope; no existing index
-- touches wa_message_id. So zero rows qualify for the partial index today:
-- no dedupe pass, nothing to back up, an instant build on a 500-row table.
--
-- SHARED-DATABASE NOTE: production's code (main, 1aa49855) mounts no varta
-- or whatsapp route at all — nothing in production reads or writes this
-- table. Additive only: one index, no rows touched, and it constrains only
-- future inbound writes that carry a real Meta id, whose sole writer is the
-- webhook it protects.

BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS varta_messages_inbound_wamid_key
    ON staging.varta_messages (org_id, direction, wa_message_id)
    WHERE wa_message_id IS NOT NULL
      AND wa_message_id <> ''
      AND direction = 'inbound';

COMMIT;

-- Verify:
--   SELECT indexrelid::regclass, indisunique, pg_get_indexdef(indexrelid)
--   FROM pg_index WHERE indrelid = 'staging.varta_messages'::regclass;
-- then redeliver (or replay) one signed inbound webhook twice and confirm one
-- row, one whatsapp.inbound event.
--
-- DOWN (manual):
--   DROP INDEX IF EXISTS staging.varta_messages_inbound_wamid_key;
