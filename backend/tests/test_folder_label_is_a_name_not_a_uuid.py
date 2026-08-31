"""A document folder is displayed by CLIENT NAME, never by its storage path.

── THE DEFECT, FOUND BY SUITE 20.03 ON 2026-08-30 ─────────────────────────────

`graha_documents.folder` is the R2 storage key: `crm/<graha_clients.id>/documents`.
It contains a UUID. Two places printed it verbatim —

  · the folder picker, which read "crm/19df5798-a669-4318-b9fd-47a52e07685e/documents (1)"
  · the Folder column of the documents table

— and Suite 20.03 found **three distinct UUIDs painted on `graha#documents`**,
the only screen in 187 that painted any.

CLAUDE.md: "**never render a user/member/org UUID in any UI**". The ratchet for
it, `frontend/scripts/check-rendered-ids.mjs`, is static and positional and
stayed GREEN over this — which is the documented lesson that a ratchet is not
coverage, and why the browser-driven scan is the thing that caught it.

── WHY THE LABEL IS COMPUTED IN SQL ───────────────────────────────────────────

Two endpoints display the same folder: `/documents` (the table column) and
`/documents/folders` (the picker). Deriving the name in the client would mean
two derivations of one fact, and the failure mode is the picker and the column
disagreeing about what one folder is called. One expression, both queries.

The raw `folder` STAYS in both payloads: `/documents?folder=` round-trips on
that exact string, so it is the option's `value` while the label is its text.

── AND THE FALLBACK IS DELIBERATE ─────────────────────────────────────────────

`COALESCE(client name, 'Unfiled' for the unfiled path, the raw folder)`.

The last arm looks like the bug being fixed, and it is there on purpose: a
folder shape no one has thought of yet — a later feature inventing
`projects/<id>/…` — renders visibly and is CAUGHT by 20.03 on the next run.
Falling back to blank or to a dash would hide it, which is how a UUID leak
becomes permanent instead of loud.
"""
import re

import pytest

from routers import graha


def _src(fn):
    import inspect
    return inspect.getsource(fn)


FOLDERS = "list_document_folders"


def test_the_folder_picker_returns_a_label():
    q = _src(graha.list_document_folders)
    assert "folder_label" in q, (
        "the folder picker returns only the raw storage path, so it prints a "
        "client UUID to the user — Suite 20.03, 2026-08-30"
    )


def test_the_folder_picker_still_returns_the_RAW_folder_for_the_filter():
    """The label is for reading; the value is what `?folder=` matches. Dropping
    the raw string would make every option filter to nothing."""
    q = _src(graha.list_document_folders)
    assert re.search(r"SELECT\s+f\.folder\b", q), (
        "the raw folder is no longer selected, so the picker's option values "
        "cannot round-trip through the list endpoint's `folder=` filter"
    )


def test_the_documents_LIST_labels_its_folder_column_too():
    """The other half. Labelling only the picker leaves the table column
    printing the UUID, which is where two of the three sightings were."""
    q = _src(graha.list_documents)
    assert "folder_label" in q, "the documents list still returns only the raw folder path"


@pytest.mark.parametrize("fn", ["list_document_folders", "list_documents"])
def test_the_client_id_is_extracted_by_REGEX_and_cast_only_when_it_matches(fn):
    """`crm/unfiled/documents` is a real, deliberate folder — the upload path
    creates it when nobody has said whose the document is. A bare
    `substring(folder from 5 for 36)::uuid` would raise on it and take the whole
    list down with it, turning a display bug into a 500."""
    q = _src(getattr(graha, fn))
    assert "^crm/([0-9a-fA-F-]{36})/" in q, (
        "the client id is not extracted by an anchored regex, so a folder that "
        "is not a client path will fail the ::uuid cast"
    )


@pytest.mark.parametrize("fn", ["list_document_folders", "list_documents"])
def test_the_unfiled_folder_reads_as_a_word(fn):
    q = _src(getattr(graha, fn))
    assert "'Unfiled'" in q and "crm/unfiled/documents" in q


@pytest.mark.parametrize("fn", ["list_document_folders", "list_documents"])
def test_an_unknown_folder_shape_falls_back_to_the_RAW_path_and_stays_visible(fn):
    """Not blank, not a dash. A folder nobody anticipated must remain visible so
    20.03 fails on it next run — hiding it is how a leak becomes permanent."""
    q = _src(getattr(graha, fn))
    at = q.find("AS folder_label")
    assert at != -1, "nothing is aliased as folder_label"
    # The SQL is built from adjacent Python string literals, so the expression
    # arrives with quotes and newlines through it. Strip those before reading
    # the tail — matching across the concatenation is what a naive regex here
    # gets wrong, and a test that cannot parse the thing it guards is worse
    # than no test.
    tail = re.sub(r"['\"\s]+", " ", q[max(0, at - 220):at]).strip()
    assert re.search(r"(f\.folder|d\.folder)\s*\)\s*$", tail), (
        "the last COALESCE arm is not the raw folder, so an unrecognised folder "
        f"shape renders as nothing instead of being caught. Tail was: {tail!r}"
    )
    assert "COALESCE(" in tail, "the label is not a COALESCE chain"


@pytest.mark.parametrize("fn", ["list_document_folders", "list_documents"])
def test_the_client_join_is_org_scoped(fn):
    """`graha_clients.id` is a UUID and unique, but the join is still scoped to
    the org — `graha.py`'s own rule, and the same fail-closed habit the deal
    owner resolver follows. A name is a tenant's data."""
    q = _src(getattr(graha, fn))
    assert re.search(r"(c|_fc)\.org_id\s*=", q), (
        "the client-name join is not org-scoped"
    )
