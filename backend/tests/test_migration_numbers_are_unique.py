"""One number, one migration — held open by a test rather than by care.

── WHY THIS EXISTS ───────────────────────────────────────────────────────────

`backend/migrations/` is a directory whose ENTIRE PURPOSE is to say what runs
before what. On 2026-08-27 it held two files numbered `PROPOSED_080`:

    PROPOSED_080_statutory_document_identifiers.sql
    PROPOSED_080_team_members_retire.sql

They are unrelated — one adds four statutory identifier columns, the other
records a six-step tenancy retirement that is explicitly not schedulable — and
between them the number 080 said nothing at all. Phase 6 listed the collision;
proposal 82 had listed it before that. It survived both because noticing it is
not the same as preventing it, and the fix (renaming one file) takes a minute
while the next collision arrives whenever two people are working at once, which
on this repository is most of the time.

`PROPOSED_080_statutory_document_identifiers.sql` became `PROPOSED_090_…`. This
test is what stops the third listing of the same problem.

── WHAT IS AND IS NOT CHECKED ────────────────────────────────────────────────

Uniqueness of the NUMBER, per family. `PROPOSED_` files and applied files are
two separate series that have always numbered independently — `PROPOSED_063`
and `063_…` are not a collision, they are two sequences — so they are checked
apart rather than together.

Nothing here reads a database. Whether a migration has been APPLIED is not a
fact about its filename, and this file deliberately makes no claim about it:
`migrations/README.md`'s status column rotted precisely by trying.
"""
from __future__ import annotations

import re
from collections import defaultdict
from pathlib import Path

MIGRATIONS = Path(__file__).resolve().parent.parent / "migrations"

#: `123_some_name.sql` and `PROPOSED_080_some_name.sql`. Anything else — a
#: README, a note, a subdirectory — is not a migration and is not numbered.
_APPLIED = re.compile(r"^(\d{3,4})_(.+)\.sql$")
_PROPOSED = re.compile(r"^PROPOSED_(\d{3,4})_(.+)\.sql$")


def _by_number(pattern: re.Pattern) -> dict[str, list[str]]:
    out: dict[str, list[str]] = defaultdict(list)
    for f in sorted(MIGRATIONS.iterdir()):
        if not f.is_file():
            continue
        m = pattern.match(f.name)
        if m:
            out[m.group(1)].append(f.name)
    return out


def test_the_migrations_directory_is_where_it_is_expected_to_be():
    """A test that silently checks an empty directory passes for ever.

    This one is first on purpose: every assertion below is a statement about a
    set of files, and an empty set satisfies all of them.
    """
    assert MIGRATIONS.is_dir(), f"no migrations directory at {MIGRATIONS}"
    numbered = [f.name for f in MIGRATIONS.iterdir()
                if f.is_file() and (_APPLIED.match(f.name) or _PROPOSED.match(f.name))]
    assert len(numbered) > 100, (
        f"only {len(numbered)} numbered migrations found — the naming convention "
        f"has changed and this test is no longer reading the real series"
    )


def test_no_two_applied_migrations_share_a_number():
    """The dangerous half. Two files at `217_` is two different meanings for one
    position in the order things ran, and a database cannot be reconstructed
    from a sequence that contradicts itself."""
    dupes = {n: files for n, files in _by_number(_APPLIED).items() if len(files) > 1}
    assert not dupes, (
        "two applied migrations share a number:\n  "
        + "\n  ".join(f"{n}: {', '.join(files)}" for n, files in sorted(dupes.items()))
        + "\nRenumber the later one to the next free slot."
    )


def test_no_two_proposed_migrations_share_a_number():
    """The half that actually happened, twice-reported and never fixed until
    Phase 6. A proposal is unapplied, so a collision here breaks nothing today —
    which is exactly why it sat there through two audits."""
    dupes = {n: files for n, files in _by_number(_PROPOSED).items() if len(files) > 1}
    assert not dupes, (
        "two PROPOSED migrations share a number:\n  "
        + "\n  ".join(f"{n}: {', '.join(files)}" for n, files in sorted(dupes.items()))
        + "\nRenumber whichever is referenced from fewer places, and update "
          "those references in the same commit."
    )


def test_the_080_collision_specifically_is_gone():
    """Named, because a general rule passing is not the same as the reported
    fault being fixed — and this one was reported in proposal 82 and again in
    Phase 6 before anybody moved a file."""
    eighty = _by_number(_PROPOSED).get("080", [])
    assert eighty == ["PROPOSED_080_team_members_retire.sql"], (
        f"PROPOSED_080 should be the tenancy retirement alone, got: {eighty}"
    )
    assert (MIGRATIONS / "PROPOSED_090_statutory_document_identifiers.sql").exists(), (
        "the statutory identifiers proposal is not at its new number — if it "
        "moved again, update this test and every reference to the filename"
    )
