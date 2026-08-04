-- 093_sanvaad_slack_parity.sql
--
-- Sanvaad could not tell you that somebody had said your name.
--
-- `staging.samvada_messages` has carried mention text since 058 — the composer
-- inserts `@Full Name ` and `renderMentions` bolds it — but nothing ever
-- RECORDED a mention. There was no row to count, so there was no badge, no
-- mentions feed, and no `public.notifications` row: being named in a channel
-- produced exactly the same silence as not being named. `staging.samvada_mentions`
-- below is that missing record, and it is deliberately its own table rather than
-- a jsonb array on the message: the read that matters is "my unread mentions
-- across the org", which is an index scan on (mentioned_user_id, read_at) and is
-- unservable from inside a message row.
--
-- `read_at` lives here rather than being derived from
-- `samvada_channel_members.last_read_at`, because the two answer different
-- questions. Scrolling past a channel marks the channel read; it must not
-- silently discharge a mention the person never actually looked at. The router
-- clears both in the same transaction on an explicit channel open — that is a
-- policy decision made in code, and keeping the columns separate is what leaves
-- the decision available to change.
--
-- The UNIQUE (message_id, mentioned_user_id) is load-bearing, not hygiene. One
-- message can carry both `@channel` and a named `@Keval Shah`; the fan-out
-- inserts named users FIRST and relies on ON CONFLICT DO NOTHING so that person
-- keeps kind='user' instead of being flattened into the broadcast. It is also
-- what makes an edit idempotent under retry.
--
-- `pinned_at`/`pinned_by` are two nullable columns on the message rather than a
-- pins table: a pin is one bit of state on one message, the partial index below
-- makes "the pins in this channel" a covered lookup, and a join table would buy
-- nothing but a second place for the two to disagree. `pinned_by` is text
-- because every user id in this product is text (public.users.user_id) — see
-- migration 092 for what happens when that is forgotten.
--
-- `samvada_typing` and `samvada_presence` are tables and not an in-process
-- dictionary because the service runs multiple gunicorn workers: a dict lives in
-- one worker and the next poll from the same browser lands in another, so the
-- dots would flicker on and off with worker affinity. They are also not
-- LISTEN/NOTIFY — Supabase's pooler runs transaction mode on :6543 where
-- LISTEN/NOTIFY does not work at all. Both tables are swept by the poll
-- endpoint, hold at most one row per active user, and are cheap to scan.
--
-- Nothing here is applied automatically. Apply by hand:
--     psql "$DATABASE_URL" -f backend/migrations/093_sanvaad_slack_parity.sql
-- Staging and production share one Supabase database — read that sentence twice
-- before running it.

BEGIN;
CREATE TABLE IF NOT EXISTS staging.samvada_mentions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            uuid NOT NULL,
  channel_id        uuid NOT NULL REFERENCES staging.samvada_channels(id) ON DELETE CASCADE,
  message_id        uuid NOT NULL REFERENCES staging.samvada_messages(id) ON DELETE CASCADE,
  mentioned_user_id text NOT NULL,
  kind              text NOT NULL DEFAULT 'user',
  created_at        timestamptz NOT NULL DEFAULT now(),
  read_at           timestamptz,
  CONSTRAINT samvada_mentions_kind_chk CHECK (kind IN ('user','here','channel')),
  CONSTRAINT samvada_mentions_uniq UNIQUE (message_id, mentioned_user_id)
);
CREATE INDEX IF NOT EXISTS samvada_mentions_user_idx
  ON staging.samvada_mentions (mentioned_user_id, read_at, created_at DESC);
CREATE INDEX IF NOT EXISTS samvada_mentions_channel_idx
  ON staging.samvada_mentions (channel_id, mentioned_user_id);

ALTER TABLE staging.samvada_messages
  ADD COLUMN IF NOT EXISTS pinned_at timestamptz,
  ADD COLUMN IF NOT EXISTS pinned_by text;
CREATE INDEX IF NOT EXISTS samvada_messages_pinned_idx
  ON staging.samvada_messages (channel_id, pinned_at DESC) WHERE pinned_at IS NOT NULL;

-- 'simple', not 'english': the product is bilingual and English stemming would
-- mangle Devanagari and make Hindi terms unsearchable.
ALTER TABLE staging.samvada_messages
  ADD COLUMN IF NOT EXISTS search_tsv tsvector
  GENERATED ALWAYS AS (to_tsvector('simple'::regconfig, coalesce(content,''))) STORED;
CREATE INDEX IF NOT EXISTS samvada_messages_search_idx
  ON staging.samvada_messages USING GIN (search_tsv);

-- The trigram index is not an optimisation of the ILIKE arm. It is what makes
-- the GIN index above reachable at all.
--
-- `GET /search` matches with
--     (m.search_tsv @@ to_tsquery('simple', $4)) OR m.content ILIKE $3
-- and the only way Postgres answers an OR from indexes is to bitmap-OR one scan
-- per branch. Every branch must be indexable or none of them is used: with no
-- index on `content`, the second branch is unanswerable from an index, the
-- planner drops the whole predicate to a sequential scan, and
-- samvada_messages_search_idx is never opened. That is the non-obvious part —
-- the OR'd query is SLOWER than either arm would be alone, because half an
-- index is not half the work, it is none of it. Ship both or the first one is
-- decoration.
--
-- `gin_trgm_ops` is left unqualified deliberately. 024 created the
-- graha_contacts trigram indexes exactly this way and `services/contact_dedupe`
-- calls `similarity()` unqualified over a pool whose search_path is
-- "staging, public", so the extension resolves on this database without a
-- schema prefix. If this line ever raises "operator class gin_trgm_ops does not
-- exist for access method gin", the psql session running the file cannot see
-- the schema pg_trgm lives in — check `\dx` and fix the search_path, do not
-- guess `extensions.`, which would be a second wrong name to maintain.
--
-- CREATE EXTENSION is a guard, not a change: 024 already installed pg_trgm and
-- it is present in pg_extension on this database. It stays for the case where
-- 093 is replayed onto a database that never got 024.
--
-- Not CONCURRENTLY: it cannot run inside a transaction block, and 093 must stay
-- one BEGIN/COMMIT because `_parity_ready` in routers/messaging.py probes a
-- single object and concludes from it that the entire migration is applied. The
-- generated column above already rewrites the table under ACCESS EXCLUSIVE, so
-- this index takes no lock the same transaction was not holding anyway.
--
-- What this does NOT fix: `q` is accepted from two characters, and `%ab%`
-- contains no complete trigram, so a two-character search still scans. The
-- index starts paying at three.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS samvada_messages_content_trgm_idx
  ON staging.samvada_messages USING GIN (content gin_trgm_ops);

CREATE TABLE IF NOT EXISTS staging.samvada_typing (
  channel_id uuid NOT NULL REFERENCES staging.samvada_channels(id) ON DELETE CASCADE,
  user_id    text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (channel_id, user_id)
);

CREATE TABLE IF NOT EXISTS staging.samvada_presence (
  org_id       uuid NOT NULL,
  user_id      text NOT NULL,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  status       text NOT NULL DEFAULT 'online',
  PRIMARY KEY (org_id, user_id)
);
COMMIT;
