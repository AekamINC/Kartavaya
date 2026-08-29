"""Migration 157, pinned to the contract the webhook's comment promised.

`webhook_receive` in routers/whatsapp.py dedupes redelivered Meta batches with
a SELECT-1 seen-check and says in as many words that "a unique index on
(org_id, wa_message_id) is the eventual guarantee; it is a shared-DB migration
and ships separately". 157 is that migration, and this file is the reader that
keeps it shaped like the promise — same pattern as
`test_migration_155_is_additive_and_names_the_contract` in test_pulse.py.

The predicate terms are each load-bearing:
  · `IS NOT NULL` — suppressed outbound rows carry no wamid by design;
  · `<> ''` — the webhook stores '' for an id-less message and
    `test_an_empty_wa_id_still_inserts_with_no_dedupe_key` pins that those may
    repeat per org, so counting '' would 500 the second one;
  · `direction = 'inbound'` — Meta can return the SAME wamid for an identical
    outbound send inside its dedup window, and `send_wa_message` records AFTER
    Meta accepts, so a unique index over outbound rows would manufacture the
    "customer has it, we have no record" failure.
Loosen any of them and this file is where you meet the argument.
"""

import pathlib
import re

_BACKEND = pathlib.Path(__file__).resolve().parent.parent
_SQL = (_BACKEND / "migrations" / "157_wa_inbound_unique.sql").read_text(
    encoding="utf-8")


def _executable(sql: str) -> str:
    """The lines that run — `--` prose stripped, DOWN block included with it."""
    return "\n".join(l for l in sql.splitlines()
                     if not l.strip().startswith("--"))


def test_migration_157_is_additive_and_names_the_contract():
    assert "CREATE UNIQUE INDEX IF NOT EXISTS varta_messages_inbound_wamid_key" in _SQL
    # Schema named, never bare — the migration-142 lesson.
    assert "ON staging.varta_messages" in _SQL
    # The key is the seen-check's own column list.
    assert re.search(
        r"ON\s+staging\.varta_messages\s*"
        r"\(org_id,\s*direction,\s*wa_message_id\)", _SQL)
    # All three predicate terms, none negotiable (see module docstring).
    live = _executable(_SQL)
    assert "wa_message_id IS NOT NULL" in live
    assert "wa_message_id <> ''" in live
    assert "direction = 'inbound'" in live
    assert "BEGIN;" in _SQL and "COMMIT;" in _SQL
    # Shared database: every executable line must be additive. The DOWN block
    # and the dedupe discussion live in comments, which is why they're stripped.
    for verb in ("ALTER ", "DROP ", "UPDATE ", "DELETE ", "INSERT "):
        assert verb not in live.upper(), f"{verb.strip()} in a 157 executable line"
    assert "share" in _SQL.lower()   # the shared-DB note is stated, like 152-155


def test_the_index_scope_matches_the_routers_seen_check():
    """The index dedupes exactly the rows the router's seen-check reads. If the
    seen-check's scope ever changes — a column added, the direction dropped —
    the index no longer closes that query's race, and this is the test that
    says so BEFORE a redelivered message lands twice."""
    router = (_BACKEND / "routers" / "whatsapp.py").read_text(encoding="utf-8")
    seen = re.search(
        r'"SELECT 1 FROM public\.varta_messages "\s*'
        r'"WHERE org_id=\$1::uuid AND wa_message_id=\$2 "\s*'
        r'"  AND direction=\'inbound\'"',
        router)
    assert seen, (
        "the webhook's seen-check moved or changed scope — re-read migration "
        "157's index against the new query before trusting either"
    )
