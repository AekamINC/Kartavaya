"""
A file never reaches a column as bytes — the JSON half of that guarantee.

`services/storage.upload_file` used to answer with a base64 `data:` URI when no
bucket resolved, and that is how 99MB of files came to live in the database.
Removing that fallback closes the multipart doors. It does not close these:
`POST /graha/documents`, `POST /ganit/expenses`, `PATCH /ganit/expenses/{id}`,
`POST /ganit/vendor-bills`, `PATCH /ganit/contracts/{id}`,
`POST /manav/expense-claims`, `POST /manav/candidates` and the three
`/api/templates` writers all take a URL as a STRING the caller chose and write
it straight to its column. R2 being healthy does not help against a caller who
simply posts the bytes.

Two things are proved here and both matter:

  · the `data:` body is refused with a 422 that NAMES the field, and for a list
    it names the index — every element is checked, not the first;
  · the ordinary body still succeeds unchanged, and a hand-typed link without a
    scheme (`drive.google.com/…`, which the recruitment tab and the template
    attach-by-URL row both invite) is still accepted. The refusal is a scheme
    denylist plus a length ceiling for exactly that reason.
"""

import pytest

from utils import (
    MAX_FILE_URL_ITEMS,
    MAX_FILE_URL_LEN,
    assert_config_attachments,
    assert_file_url,
    assert_file_urls,
)
from fastapi import HTTPException

TINY_PNG = (
    "data:image/png;base64,"
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk"
    "YPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="
)

ORG = "00000000-0000-0000-0000-000000000001"


# ── The helper itself ────────────────────────────────────────────────────────

def _detail(exc_info) -> str:
    return exc_info.value.detail


def test_a_plain_storage_url_is_accepted():
    assert_file_url(
        "https://acct.r2.cloudflarestorage.com/bucket/org/1/x.pdf?X-Amz-Signature=ab",
        "file_url",
    )


def test_empty_and_missing_are_accepted():
    """Every one of these columns defaults to '' and most rows have no file."""
    assert_file_url("", "file_url")
    assert_file_url(None, "file_url")
    assert_file_urls(None, "receipt_urls")
    assert_file_urls([], "receipt_urls")


def test_a_hand_typed_link_without_a_scheme_is_still_accepted():
    """`RecruitmentTab.jsx` gives a plain text box and the template attach row
    takes a pasted URL. Somebody filing `drive.google.com/…` is naming a
    location, not smuggling a file, and an http(s) allowlist would 422 them."""
    assert_file_url("drive.google.com/file/d/1a2b3c/view", "resume_url")
    assert_file_url("/local-files/org/1/receipt.jpg", "receipt_urls[0]")


def test_a_data_uri_is_refused_and_the_message_names_the_field():
    with pytest.raises(HTTPException) as exc:
        assert_file_url(TINY_PNG, "attachment_url")
    assert exc.value.status_code == 422
    assert "attachment_url" in _detail(exc)


@pytest.mark.parametrize("value", [
    "DATA:image/png;base64,AAAA",
    "Data:image/png;base64,AAAA",
    "  data:image/png;base64,AAAA",
    "\n\tdata:image/png;base64,AAAA",
    "\x00data:image/png;base64,AAAA",
])
def test_the_scheme_is_read_the_way_a_browser_reads_it(value):
    """A URL parser drops leading C0 controls and space before it looks at the
    scheme, and the scheme is case-insensitive. Postgres stores the bytes
    either way, so neither dodge may pass."""
    with pytest.raises(HTTPException) as exc:
        assert_file_url(value, "file_url")
    assert exc.value.status_code == 422


@pytest.mark.parametrize("value", [
    "blob:https://kartavaya.com/9f0c",
    "javascript:fetch('/api/me')",
    "vbscript:msgbox",
    "file:///etc/passwd",
])
def test_the_other_inline_schemes_are_refused_too(value):
    """`resume_url` is rendered straight into an `<a href>`, so a `javascript:`
    résumé is stored XSS rather than a file in a column."""
    with pytest.raises(HTTPException) as exc:
        assert_file_url(value, "resume_url")
    assert exc.value.status_code == 422


def test_a_url_longer_than_the_ceiling_is_refused():
    """The ceiling is the part that holds whatever scheme nobody thought of:
    2048 characters cannot carry a file."""
    with pytest.raises(HTTPException) as exc:
        assert_file_url("https://x.test/" + "a" * MAX_FILE_URL_LEN, "file_url")
    assert exc.value.status_code == 422
    assert str(MAX_FILE_URL_LEN) in _detail(exc)


def test_a_presigned_url_is_nowhere_near_the_ceiling():
    signed = (
        "https://a1b2c3d4e5f6.r2.cloudflarestorage.com/kartavaya-platform/"
        "org/64e7bea6-0000-0000-0000-000000000001/documents/"
        "a-fairly-long-original-file-name-from-a-phone-camera.jpeg"
        "?X-Amz-Algorithm=AWS4-HMAC-SHA256"
        "&X-Amz-Credential=" + "c" * 64 +
        "&X-Amz-Date=20260819T101500Z&X-Amz-Expires=32400"
        "&X-Amz-SignedHeaders=host&X-Amz-Signature=" + "f" * 64
    )
    assert len(signed) < MAX_FILE_URL_LEN
    assert_file_url(signed, "file_url")


def test_every_element_of_a_list_is_checked_not_the_first():
    """A list is where one unchecked string becomes twenty."""
    with pytest.raises(HTTPException) as exc:
        assert_file_urls(
            ["https://x.test/a.jpg", "https://x.test/b.jpg", TINY_PNG],
            "receipt_urls",
        )
    assert exc.value.status_code == 422
    assert "receipt_urls[2]" in _detail(exc)


def test_a_list_has_a_length_of_its_own():
    with pytest.raises(HTTPException) as exc:
        assert_file_urls(["https://x.test/a.jpg"] * (MAX_FILE_URL_ITEMS + 1),
                         "receipt_urls")
    assert exc.value.status_code == 422


def test_template_config_attachments_are_inspected_by_url_and_by_key():
    for key in ("url", "key", "file_url", "file_key"):
        with pytest.raises(HTTPException) as exc:
            assert_config_attachments(
                {"attachments": [{"name": "shot.png", key: TINY_PNG}]}
            )
        assert exc.value.status_code == 422
        assert f"config.attachments[0].{key}" in _detail(exc)


def test_template_config_reaches_the_tasks_a_project_template_seeds():
    with pytest.raises(HTTPException) as exc:
        assert_config_attachments({
            "columns": [{"name": "To Do"}],
            "sample_tasks": [
                {"title": "Kickoff"},
                {"title": "Site visit",
                 "attachments": [{"name": "map.png", "url": TINY_PNG}]},
            ],
        })
    assert "config.sample_tasks[1].attachments[0].url" in _detail(exc)


def test_a_template_that_merely_describes_a_data_uri_is_not_refused():
    """The scan is the documented attachment carriers, not every string in the
    blob. A blanket scan refuses a template whose description explains what a
    data URI is — and `config` is free-form JSONB holding prose."""
    assert_config_attachments({
        "title": "Onboarding",
        "description": "Never paste a data:image/png;base64,… into the URL box.",
        "attachments": [{"name": "policy.pdf", "url": "https://x.test/p.pdf"}],
        "custom_fields": {},
    })


def test_a_bare_string_attachment_is_still_checked():
    with pytest.raises(HTTPException) as exc:
        assert_config_attachments({"attachments": ["https://x.test/a.pdf", TINY_PNG]})
    assert "config.attachments[1]" in _detail(exc)


# ── Graha · documents ────────────────────────────────────────────────────────

@pytest.fixture
def graha_gate(app):
    from routers.graha import _gate
    app.dependency_overrides[_gate] = lambda: None
    yield
    app.dependency_overrides.pop(_gate, None)


async def test_graha_document_refuses_a_data_uri(
    api_client, mock_pool, as_admin, with_org_id, graha_gate,
):
    resp = await api_client.post("/api/v1/graha/documents", json={
        "name": "Signed NDA", "file_url": TINY_PNG,
    })
    assert resp.status_code == 422
    assert "file_url" in resp.json()["detail"]
    mock_pool.fetchrow.assert_not_awaited()


async def test_graha_document_refuses_a_data_uri_in_the_key(
    api_client, mock_pool, as_admin, with_org_id, graha_gate,
):
    resp = await api_client.post("/api/v1/graha/documents", json={
        "name": "Signed NDA", "file_url": "https://x.test/nda.pdf",
        "file_key": TINY_PNG,
    })
    assert resp.status_code == 422
    assert "file_key" in resp.json()["detail"]


async def test_graha_document_still_files_an_ordinary_link(
    api_client, mock_pool, as_admin, with_org_id, graha_gate,
):
    mock_pool.fetchrow.return_value = {
        "id": "d001", "name": "Signed NDA",
        "file_url": "https://x.test/nda.pdf", "file_key": "org/1/nda.pdf",
    }
    resp = await api_client.post("/api/v1/graha/documents", json={
        "name": "Signed NDA",
        "file_url": "https://x.test/nda.pdf",
        "file_key": "org/1/nda.pdf",
    })
    assert resp.status_code == 200
    assert resp.json()["file_key"] == "org/1/nda.pdf"


# ── Ganit · expenses, vendor bills, contracts ────────────────────────────────

@pytest.fixture
def ganit_gate(app):
    from routers.ganit import _gate
    app.dependency_overrides[_gate] = lambda: None
    yield
    app.dependency_overrides.pop(_gate, None)


async def test_ganit_expense_refuses_a_data_uri_anywhere_in_the_list(
    api_client, mock_pool, as_admin, with_org_id, ganit_gate,
):
    resp = await api_client.post("/api/v1/ganit/expenses", json={
        "title": "Site travel", "total": 1200,
        "receipt_urls": ["https://x.test/ok.jpg", TINY_PNG],
    })
    assert resp.status_code == 422
    assert "receipt_urls[1]" in resp.json()["detail"]
    mock_pool.fetchrow.assert_not_awaited()


async def test_ganit_expense_patch_is_closed_as_well_as_the_post(
    api_client, mock_pool, as_admin, with_org_id, ganit_gate,
):
    """A hole closed on create and left open on update is not closed."""
    resp = await api_client.patch(
        "/api/v1/ganit/expenses/e0000000-0000-0000-0000-000000000001",
        json={"receipt_urls": [TINY_PNG]},
    )
    assert resp.status_code == 422
    assert "receipt_urls[0]" in resp.json()["detail"]
    mock_pool.execute.assert_not_awaited()


async def test_ganit_expense_still_records_ordinary_receipts(
    api_client, mock_pool, as_admin, with_org_id, ganit_gate,
):
    mock_pool.fetchrow.return_value = {"id": "e001", "title": "Site travel", "total": 1200}
    resp = await api_client.post("/api/v1/ganit/expenses", json={
        "title": "Site travel", "total": 1200,
        "receipt_urls": ["https://x.test/a.jpg", "https://x.test/b.jpg"],
    })
    assert resp.status_code == 200
    assert resp.json()["status"] == "created"


async def test_ganit_vendor_bill_refuses_a_data_uri(
    api_client, mock_pool, as_admin, with_org_id, ganit_gate,
):
    resp = await api_client.post("/api/v1/ganit/vendor-bills", json={
        "vendor_id": "00000000-0000-0000-0000-0000000000aa",
        "line_items": [{"description": "Steel", "quantity": 1, "rate": 100, "gst_rate": 18}],
        "attachment_url": TINY_PNG,
    })
    assert resp.status_code == 422
    assert "attachment_url" in resp.json()["detail"]
    mock_pool.fetchrow.assert_not_awaited()


async def test_ganit_contract_patch_refuses_a_data_uri(
    api_client, mock_pool, as_admin, with_org_id, ganit_gate,
):
    """`ContractCreate` has no file field at all, so this PATCH is the only
    door to `ganit_contracts.file_url` and `file_key`."""
    resp = await api_client.patch(
        "/api/v1/ganit/contracts/c0000000-0000-0000-0000-000000000001",
        json={"file_url": TINY_PNG},
    )
    assert resp.status_code == 422
    assert "file_url" in resp.json()["detail"]
    mock_pool.execute.assert_not_awaited()


async def test_ganit_contract_patch_still_attaches_a_stored_file(
    api_client, mock_pool, as_admin, with_org_id, ganit_gate,
):
    resp = await api_client.patch(
        "/api/v1/ganit/contracts/c0000000-0000-0000-0000-000000000001",
        json={"file_url": "https://x.test/c.pdf", "file_key": "org/1/c.pdf"},
    )
    assert resp.status_code == 200
    assert resp.json()["status"] == "updated"


async def test_ganit_contracts_list_re_signs_from_the_stored_key(
    api_client, mock_pool, as_admin, with_org_id, ganit_gate, monkeypatch,
):
    """Storing the key is half of it; the read has to be able to SEE the key.

    `graha.list_documents` re-signs this identical shape off a `SELECT *`.
    `list_contracts` lists its columns instead, and while that list named
    `file_url` without `file_key` the re-sign branch could not fire on any row —
    silently, because the stored URL was returned unchanged. Nine hours after
    the PATCH that attached it, every contract document was a 403.
    """
    async def _sign(org_id, key):
        return f"https://r2.test/{key}?X-Amz-Signature=fresh"

    monkeypatch.setattr("services.storage.sign_key", _sign)
    mock_pool.fetch.return_value = [{
        "id": "ct1", "title": "MSA",
        "file_url": "https://r2.test/org/1/msa.pdf?X-Amz-Signature=expired",
        "file_key": "org/1/msa.pdf", "_total": 1,
    }]
    resp = await api_client.get("/api/v1/ganit/contracts")
    assert resp.status_code == 200
    assert "ct.file_key" in mock_pool.fetch.await_args.args[0], \
        "the projection must name file_key or the re-sign below it is dead code"
    doc = resp.json()["data"][0]
    assert doc["file_url"].endswith("X-Amz-Signature=fresh")
    assert "_total" not in doc


async def test_ganit_contracts_list_keeps_a_row_that_has_no_key(
    api_client, mock_pool, as_admin, with_org_id, ganit_gate, monkeypatch,
):
    """All 63 contracts in the database predate the key and have `file_key=''`.
    They must keep whatever URL they already hold rather than losing it to a
    signature over an empty key."""
    async def _sign(org_id, key):  # pragma: no cover - must not be reached
        raise AssertionError("signed an empty key")

    monkeypatch.setattr("services.storage.sign_key", _sign)
    mock_pool.fetch.return_value = [{
        "id": "ct2", "title": "Old NDA",
        "file_url": "https://x.test/old.pdf", "file_key": "", "_total": 1,
    }]
    resp = await api_client.get("/api/v1/ganit/contracts")
    assert resp.status_code == 200
    assert resp.json()["data"][0]["file_url"] == "https://x.test/old.pdf"


# ── Manav · expense claims, candidates ───────────────────────────────────────

@pytest.fixture
def manav_gate(app):
    from routers.manav import _gate
    app.dependency_overrides[_gate] = lambda: frozenset({"admin"})
    yield
    app.dependency_overrides.pop(_gate, None)


async def test_manav_expense_claim_refuses_a_data_uri(
    api_client, mock_pool, as_admin, with_org_id, manav_gate,
):
    resp = await api_client.post("/api/v1/manav/expense-claims", json={
        "expense_date": "2026-08-19", "amount": 450,
        "receipt_urls": [TINY_PNG],
    })
    assert resp.status_code == 422
    assert "receipt_urls[0]" in resp.json()["detail"]
    mock_pool.fetchrow.assert_not_awaited()


async def test_manav_candidate_refuses_a_data_uri_resume(
    api_client, mock_pool, as_admin, with_org_id, manav_gate,
):
    resp = await api_client.post("/api/v1/manav/candidates", json={
        "job_opening_id": "00000000-0000-0000-0000-0000000000bb",
        "full_name": "A Candidate",
        "resume_url": TINY_PNG,
    })
    assert resp.status_code == 422
    assert "resume_url" in resp.json()["detail"]
    mock_pool.fetchrow.assert_not_awaited()


async def test_manav_candidate_writes_the_resume_key_beside_the_url(
    api_client, mock_pool, as_admin, with_org_id, manav_gate,
):
    """`manav_candidates.resume_key` has existed since migration 057 and had no
    writer, so `list_candidates` could never re-sign a résumé and every stored
    presigned URL died after nine hours."""
    mock_pool.fetchrow.side_effect = [
        {"id": "job1"},
        {"id": "cand1", "full_name": "A Candidate",
         "resume_url": "https://x.test/cv.pdf", "resume_key": "org/1/cv.pdf"},
    ]
    resp = await api_client.post("/api/v1/manav/candidates", json={
        "job_opening_id": "00000000-0000-0000-0000-0000000000bb",
        "full_name": "A Candidate",
        "resume_url": "https://x.test/cv.pdf",
        "resume_key": "org/1/cv.pdf",
    })
    assert resp.status_code == 200
    insert = mock_pool.fetchrow.await_args_list[-1]
    assert "resume_key" in insert.args[0]
    assert "org/1/cv.pdf" in insert.args


# ── Templates · config.attachments[] ─────────────────────────────────────────

async def test_task_template_refuses_a_data_uri_attachment(
    api_client, mock_pool, as_admin,
):
    resp = await api_client.post("/api/templates/tasks", json={
        "name": "Site survey",
        "config": {"title": "Survey", "attachments": [{"name": "map.png", "url": TINY_PNG}]},
    })
    assert resp.status_code == 422
    assert "config.attachments[0].url" in resp.json()["detail"]
    mock_pool.fetchrow.assert_not_awaited()


async def test_task_template_patch_refuses_a_data_uri_attachment(
    api_client, mock_pool, as_admin,
):
    resp = await api_client.patch("/api/templates/tasks/ttmpl_1", json={
        "name": "Site survey",
        "config": {"attachments": [{"name": "map.png", "url": TINY_PNG}]},
    })
    assert resp.status_code == 422
    assert "config.attachments[0].url" in resp.json()["detail"]
    mock_pool.fetchrow.assert_not_awaited()


async def test_project_template_refuses_a_data_uri_on_a_seeded_task(
    api_client, mock_pool, as_admin, with_org_id,
):
    # `with_org_id` since migration 200: `POST /api/templates/projects` resolves
    # the caller's organisation now, because `project_templates` had no tenant
    # column at all and was scoped by AUTHOR — which showed platform staff every
    # customer's template and hid a colleague's from their own firm. Without the
    # override this 403s at the org gate before the payload is looked at, which
    # would test the gate rather than the data URI.
    resp = await api_client.post("/api/templates/projects", json={
        "name": "Site build",
        "config": {"sample_tasks": [
            {"title": "Survey", "attachments": [{"name": "map.png", "url": TINY_PNG}]},
        ]},
    })
    assert resp.status_code == 422
    assert "config.sample_tasks[0].attachments[0].url" in resp.json()["detail"]
    mock_pool.fetchrow.assert_not_awaited()


async def test_project_template_with_an_ordinary_config_still_saves(
    api_client, mock_pool, as_admin, with_org_id,
):
    # `org_id` is in the returned row because the INSERT writes it (migration
    # 200). The handler returns `dict(row)`, so a fixture row missing the column
    # is a fixture that no longer models the table.
    mock_pool.fetchrow.return_value = {
        "template_id": "ptmpl_1", "name": "Site build", "org_id": with_org_id,
    }
    resp = await api_client.post("/api/templates/projects", json={
        "name": "Site build",
        "config": {"columns": [{"name": "To Do"}], "sample_tasks": [{"title": "Survey"}]},
    })
    assert resp.status_code == 200
    assert resp.json()["template_id"] == "ptmpl_1"
