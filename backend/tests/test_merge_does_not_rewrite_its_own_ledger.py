"""The merge audit ledger is evidence, not a row to be re-pointed.

── Two defects, and they compound ────────────────────────────────────────────

1. THE LEDGER WAS IN THE RE-POINT LIST.

   `graha_contact_merges.survivor_id` and `.merged_id` both REFERENCE
   `graha_contacts` (migration 024_graha_dedupe_merge.sql:77-78), so
   `_referencing_tables` returned them like any other foreign key — and both
   `merge_contacts` and `undo_merge` then rewrote the very rows that RECORD the
   merge.

   `undo_merge` reads survivor and loser into locals, then runs

       UPDATE graha_contact_merges SET survivor_id = <loser>
        WHERE survivor_id = <survivor>

   which matches the row being undone and collapses it to `(loser, loser)`.
   Live evidence: all six rows in `graha_contact_merges` carry
   `survivor_id = merged_id` — a state `merge_contacts` cannot even write,
   because line 299 refuses a self-merge. The reversal path destroyed its own
   evidence.

2. THE AGE GUARD NEVER FIRED, WHICH MADE (1) CERTAIN RATHER THAN LIKELY.

   `undo_merge` only re-points rows older than the merge — "Rows created after
   the merge stay with the survivor", says its docstring. That guard is applied
   only `if has_created`, and the probe asked:

       table_schema = split_part($1,'.',1)
       table_name   = split_part($1,'.',2)

   where `$1` came from `conrelid::regclass::text`. **regclass renders a name
   UNQUALIFIED when its schema is on the search_path.** Live, `search_path` is
   `"$user", public, extensions`, so the text is `graha_contact_merges` — and
   `split_part(name, '.', 2)` is the EMPTY STRING.

   Measured against production:

       regclass renders          graha_contact_merges
       split_part(…, '.', 2)     ''            <- empty
       old probe                 false         <- always
       new probe                 true

   So every undo took the unguarded branch and re-pointed EVERY row still on the
   survivor, at any age, in every referencing table — not only the ledger.

── The fixes ─────────────────────────────────────────────────────────────────

The ledger is excluded BY NAME from the catalogue, never by pattern: it is the
one table whose FK to `graha_contacts` is a historical FACT about two contacts
rather than a row belonging to one of them. A prefix rule would be the same
mistake this repo already refuses in a DROP allowlist.

The probe asks `pg_attribute` through `::regclass`, which resolves whichever form
the text arrives in and cannot be defeated by qualification.

⚠ THE SIX CORRUPTED ROWS ARE NOT REPAIRED, and cannot be. `survivor_id` was
overwritten with the loser's id; the original value is not recoverable from
anything that survives. They are Suite 04's own rows and all six are already
`undone_at`-stamped, so nothing hangs on them — but the loss is recorded here
rather than papered over.
"""
from pathlib import Path

SRC = Path(__file__).resolve().parents[1] / "services" / "contact_dedupe.py"


def _code() -> str:
    """The file with comments stripped.

    ⚠ COMMENTS ARE STRIPPED BEFORE MATCHING. Twice in this codebase a
    source-reading assertion passed by matching its own explanatory prose rather
    than the code, and both are recorded in STATUS.md. The comments here explain
    these fixes at length, so they would satisfy every assertion below if left in.
    """
    return "\n".join(
        line for line in SRC.read_text(encoding="utf-8").splitlines()
        if not line.strip().startswith("--") and not line.strip().startswith("#")
    )


def test_the_ledger_is_excluded_from_the_repoint_catalogue():
    """⚠ WITHOUT THIS, AN UNDO DESTROYS THE RECORD OF WHAT IT UNDID."""
    code = _code()
    assert "con.conrelid <> 'graha_contact_merges'::regclass" in code, (
        "`_referencing_tables` no longer excludes the merge ledger. Its "
        "survivor_id and merged_id both reference graha_contacts, so merge and "
        "undo will re-point the rows that record the merge — live, that "
        "collapsed all six to survivor_id = merged_id, a state merge_contacts "
        "refuses to write."
    )


def test_the_exclusion_is_by_name_and_not_a_pattern():
    """A prefix would silently admit the next `graha_contact_*` table.

    The same reasoning this repo applies to a DROP allowlist: a prefix is not a
    stack. `graha_contact_labels` MUST stay in the catalogue — it is real domain
    data and a merge has to carry it across.
    """
    code = _code()
    assert "LIKE 'graha_contact%'" not in code and "~ 'graha_contact" not in code, (
        "the ledger exclusion has become a pattern. graha_contact_labels is "
        "domain data and must still be re-pointed by a merge."
    )


def test_the_created_at_probe_does_not_split_on_a_dot():
    """The old probe could not answer true for ANY table on the search_path."""
    code = _code()
    assert "split_part($1,'.',2)" not in code and 'split_part($1, \'.\', 2)' not in code, (
        "`undo_merge` is string-splitting a regclass name on a dot again. "
        "regclass renders unqualified when the schema is on the search_path, so "
        "split_part(name,'.',2) is '' and the created_at guard can never fire — "
        "every undo then re-points every row at any age."
    )
    assert "attrelid = $1::regclass" in code, (
        "the created_at probe no longer resolves the table through ::regclass, "
        "which is the only form immune to whether the name arrives qualified."
    )


def test_the_guard_it_protects_is_still_there():
    """Widening the probe is worthless if the guarded UPDATE was removed.

    This is the assertion that stops the previous one being satisfiable by
    deleting the branch it tests.
    """
    code = _code()
    assert "created_at < $3" in code, (
        "the age guard is gone from undo_merge. Rows created AFTER a merge "
        "belong to the survivor, and the docstring promises to leave them there."
    )
