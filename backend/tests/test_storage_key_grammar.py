"""One grammar for every object key, and the two bugs the old ones caused.

Proposal 83 §3 read every caller of `upload_file` and found FOUR grammars for
one idea:

    esign/originals                module / kind — no document id anywhere
    crm/{client_id}/documents      module / id / kind
    pahchan/{org_id}/punch         module / TENANT / kind
    projects/{team_id}             module / id — no kind
    srijan/images                  module / kind
    personal/{user_id}             the default when no folder was passed

A reader could not predict a key without reading the caller. The concrete
costs, each of which this file pins the fix for:

  · eSIGN HAD NO ENTITY ID. Every signature ever captured, for every document,
    sat in one flat prefix. "Show me the files for this agreement" could only
    be answered from the database.
  · NO DATE ANYWHERE, so no cheap listing, no retention sweep and no lifecycle
    rule — with 1,659 punches today and hundreds of thousands under one prefix
    with any real customer.
  · THE ORIGINAL FILENAME WAS DISCARDED. The key was a bare uuid.
  · `crm/unfiled/documents` — §3's "bucket of last resort that nothing ever
    revisits".
  · THE ORG ID APPEARED TWICE, which is §3's bug 2 and was not cosmetic — see
    the last section of this file.

── AND THE ONE THING THAT MUST NOT BREAK ───────────────────────────────────

`_client_for_key` decides the BUCKET from the key: one starting `org/` or
`shared/` is on the platform bucket, anything else is on the org's own. That is
what keeps an org which adds its own credentials later working — its old files
stay signable against the platform bucket instead of 404ing against a new empty
one. No minted key may begin with either prefix.
"""
import datetime as dt
import inspect

import pytest

from services import storage
from services.storage_keys import MODULES, build_key

AT = dt.datetime(2026, 8, 23, 4, 15, tzinfo=dt.timezone.utc)
ORG = "045b76ad-654b-42dd-b4b1-731700efc6c3"


def _parts(key: str) -> list[str]:
    return key.split("/")


def _code(obj) -> str:
    """Source with comment lines stripped.

    Every one of these fixes is explained in a comment that quotes the shape it
    replaced — `folder = f"pahchan/{org_id}/punch"`, `user_id="system"`,
    `crm/unfiled/documents`. A substring sweep over raw source therefore
    matches the explanation and fails forever, and the only way to make it pass
    would be to delete the explanation.
    """
    return "\n".join(
        line for line in inspect.getsource(obj).splitlines()
        if not line.lstrip().startswith("#")
    )


# ── The shape ───────────────────────────────────────────────────────────────

def test_the_module_owns_the_top_folder():
    for module in MODULES:
        key = build_key(module, user_id="user_abc", filename="x.pdf", at=AT)
        assert _parts(key)[0] == module


def test_the_acting_user_is_the_last_folder_before_the_date():
    """The owner stated the rule in those words. It is what makes "everything
    this person put here" a prefix listing rather than a database query."""
    key = build_key("esign", scope=["doc_9f2a", "signature"],
                    user_id="user_abc", filename="agreement.pdf", at=AT)
    parts = _parts(key)
    assert parts == ["esign", "doc_9f2a", "signature", "user_abc",
                     "2026", "08", parts[-1]]


def test_every_key_carries_a_year_and_a_month():
    """Without a date there is no retention sweep and no lifecycle rule — and
    that is the difference between 1,659 punches and hundreds of thousands of
    them under one prefix."""
    for module in MODULES:
        parts = _parts(build_key(module, user_id="u", filename="x", at=AT))
        assert parts[-3:-1] == ["2026", "08"]


def test_the_original_filename_survives():
    """§3's fourth complaint: the key was a bare uuid, so "I uploaded
    Invoice-Mar.pdf" could not be answered from storage at all."""
    key = build_key("crm", scope=["cl_1"], user_id="u",
                    filename="GST Certificate FY26.pdf", at=AT)
    assert key.endswith("--gst-certificate-fy26.pdf")


def test_the_id_prefix_sorts_by_time():
    """A uuid sorts randomly, so a prefix listing has no useful order and a
    lifecycle rule cannot stop early."""
    early = build_key("personal", user_id="u", filename="a.png",
                      at=dt.datetime(2026, 1, 1, tzinfo=dt.timezone.utc))
    late = build_key("personal", user_id="u", filename="a.png",
                     at=dt.datetime(2026, 12, 1, tzinfo=dt.timezone.utc))
    assert early.rsplit("/", 1)[-1] < late.rsplit("/", 1)[-1]


def test_personal_names_the_user_once():
    """There the user IS what the file belongs to, so the segment does not
    appear twice."""
    key = build_key("personal", user_id="user_abc", filename="shot.png", at=AT)
    assert _parts(key) == ["personal", "user_abc", "2026", "08", _parts(key)[-1]]


# ── The reserved prefixes ───────────────────────────────────────────────────

@pytest.mark.parametrize("module", MODULES)
def test_no_minted_key_can_be_mistaken_for_a_platform_key(module):
    """`_client_for_key` reads the FIRST segment to choose the bucket. A key
    starting `org/` or `shared/` would be written to the org's own bucket and
    looked for on the vendor's."""
    key = build_key(module, user_id="u", filename="x.pdf", at=AT)
    assert not key.startswith(("org/", "shared/"))


@pytest.mark.parametrize("bad", ["org", "shared"])
def test_the_reserved_tops_cannot_be_used_as_modules(bad):
    with pytest.raises(ValueError):
        build_key(bad, user_id="u", filename="x")


def test_an_unknown_module_is_refused():
    """A typo produces a file nobody can find and a retention rule that never
    matches it, so a new module is declared rather than invented at a call
    site."""
    with pytest.raises(ValueError) as exc:
        build_key("invoices", user_id="u", filename="x")
    assert "not a storage module" in str(exc.value)


# ── Bug 2: the org appeared twice ───────────────────────────────────────────

def test_the_organisation_id_may_not_appear_in_a_key():
    """The storage layer supplies the tenant — as the BUCKET on an org's own
    account, and as the `org/{id}/` PREFIX on the platform bucket. A caller that
    adds it too produced `org/{org}/pahchan/{org}/punch/…`."""
    with pytest.raises(ValueError) as exc:
        build_key("pahchan", scope=[ORG, "punch"], org_id=ORG, filename="a.jpg")
    assert "must not appear in a storage key" in str(exc.value)


def test_the_pahchan_uploader_no_longer_puts_the_org_in_the_folder():
    from routers import pahchan

    src = _code(pahchan.upload_punch_photo)
    assert 'f"pahchan/{org_id}' not in src
    assert 'module="pahchan"' in src


def test_the_punch_guard_accepts_a_key_from_the_platform_bucket():
    """THE DEFECT THIS FOUND, and it is why the assertion is worth having.

    `upload_file` returns the key WITH the tenant prefix on it — for an org
    with no R2 account of its own that is `org/{org_id}/pahchan/…`. The guard
    checked `startswith(f"pahchan/{org_id}/punch/")`, so for those orgs it
    raised on EVERY punch that carried a photograph, with a 400 saying the
    photo belonged to another organisation. Two of the three orgs are in that
    state. Measured 2026-08-23: 1,659 punches, ZERO with a photo_key.
    """
    from routers import pahchan

    src = _code(pahchan.create_punch)
    assert 'tenant_prefix = f"org/{org_id}/"' in src
    # And the OLD shape is still accepted, because a client may hold a key
    # minted seconds before a deploy and a release must not cost a photograph.
    assert '"pahchan/punch/"' in src
    assert 'f"pahchan/{org_id}/punch/"' in src


# ── Bug 2's sibling: Sahayak images hid the person entirely ─────────────────

def test_generate_image_takes_the_person_who_asked():
    """Both call sites passed `user_id="system"` and `folder="srijan/images"`,
    so every image any person generated landed in one flat folder with the
    requester recorded nowhere. Nothing could answer "which of these did I
    make", and a shared folder with no owner is one nobody may safely delete
    from."""
    from services import ai_router

    assert "user_id" in inspect.signature(ai_router.generate_image).parameters
    src = _code(ai_router)
    assert 'user_id="system"' not in src
    assert '"srijan/images"' not in src


def test_the_hub_threads_the_caller_into_every_image_call():
    from routers import hub

    src = _code(hub)
    calls = src.count("await generate_image(")
    threaded = src.count("user_id=user.get(\"user_id\")") + src.count("user_id=user_id,")
    assert calls >= 3
    assert threaded >= calls, (
        f"{calls} image calls and only {threaded} carry the requester — an "
        "image with no owner is the bug this fixed"
    )


# ── The callers that moved ──────────────────────────────────────────────────

@pytest.mark.parametrize("module_name, fn_name, expected", [
    ("routers.esign", "upload_document_file", "esign"),
    ("routers.graha", "upload_document", "crm"),
    ("routers.uploads", None, "projects"),
])
def test_the_callers_pass_a_module_rather_than_a_folder(module_name, fn_name, expected):
    import importlib

    mod = importlib.import_module(module_name)
    src = _code(getattr(mod, fn_name)) if fn_name else _code(mod)
    assert f'module="{expected}"' in src


def test_a_document_with_no_client_is_owned_rather_than_pooled():
    """§3 names `crm/unfiled/documents` "a bucket of last resort that nothing
    ever revisits".

    THE COLUMN KEEPS IT AND THE KEY DOES NOT, and the distinction is the point:
    `graha_documents.folder` is a fact about the record that the documents list
    filters on and the folders rollup groups by, and `unfiled` is the right
    value there — a document arrives before anyone has decided whose it is.
    The OBJECT KEY is a different question, and there a missing scope segment
    is DROPPED, so the file is stored under its uploader instead of pooled with
    every other homeless document in the org.
    """
    key = build_key("crm", scope=[None], user_id="user_abc", filename="x.pdf", at=AT)
    assert _parts(key) == ["crm", "user_abc", "2026", "08", _parts(key)[-1]]


def test_the_crm_folder_column_still_gets_its_value():
    """I deleted this assignment when moving the key onto the grammar, and
    `folder` is a NameError two statements later — the documents list and the
    folders rollup both read that column."""
    from routers import graha

    src = _code(graha.upload_document)
    assert "folder = f\"crm/{client_id or 'unfiled'}/documents\"" in src
    assert "folder, json.dumps([])" in src


# ── The old shape still works, deliberately ─────────────────────────────────

def test_a_caller_that_still_passes_folder_is_not_broken():
    """`folder` is kept because a caller that has not moved must keep working —
    not because it is an option."""
    src = _code(storage.upload_file)
    assert "folder or f\"personal/{user_id}\"" in src
    assert "if module and not LEGACY_KEYS:" in src


def test_module_wins_when_a_caller_passes_both():
    """A caller mid-move gets the grammar, which is the one that will still be
    here."""
    src = _code(storage.upload_file)
    assert src.index("if module and not LEGACY_KEYS:") < src.index("prefix = folder or")
