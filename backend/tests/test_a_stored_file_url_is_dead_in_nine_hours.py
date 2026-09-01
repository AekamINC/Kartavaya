"""A file link read back from the database is a nine-hour-old corpse.

── THE DEFECT ────────────────────────────────────────────────────────────────

Files live in R2, never in the database, and the row keeps a `file_key` plus a
`file_url`. The `file_url` is persisted ALREADY SIGNED. Measured on the live
database 2026-09-01, SELECT-only::

    graha_documents      18 rows, 18 with an http url,  0 unsigned
    sign_documents        6 rows,  6 with an http url,  0 unsigned
    every one of them    X-Amz-Expires=32400            (nine hours)
                         X-Amz-Signature present         0 without an expiry

So the column is not a link. It is a SNAPSHOT of a link, correct for nine hours
from the moment of upload and an HTTP 403 for the rest of the row's life.

`list_documents` (`routers/graha.py:4998`) already knew this — it re-signs every
row it returns from `file_key`. That is why the list worked and why opening a
single document did not, which is the most confusing shape a bug can have: the
same file, reachable from one screen and broken from the next.

Three read paths handed back the stored column:

  · `graha.get_document`     GET   /api/v1/graha/documents/{id}
  · `graha.update_document`  PATCH /api/v1/graha/documents/{id}
  · `ganit.get_contract`     GET   /api/v1/ganit/contracts/{id}

⚠ THE PATCH IS THE WORST OF THE THREE. It answers 200 with `RETURNING *`, so a
rename succeeds and hands back a dead link in the same breath — the caller has
just been told the write worked.

── WHAT THIS FILE PINS ───────────────────────────────────────────────────────

That each route re-signs from the KEY, and — the assertion that carries the
weight — that the STORED value does not appear in the response. Asserting only
that a signature is present would pass over a route that returns the stale
column, because the stale column is signed too. Both halves, or the check is
satisfied by the very thing it is meant to catch.
"""
import pytest


#: What the database holds: signed once, at upload, and expired long ago.
DEAD_STORED = (
    "https://7a0e9e97b86e887f17cf923f345059fd.r2.cloudflarestorage.com/"
    "kartavaya/org/doc.pdf?X-Amz-Expires=32400&X-Amz-Signature=deadbeef"
)
#: What a fresh signature looks like. Deliberately unmistakable.
FRESH = "https://r2.example.invalid/SIGNED-FRESH?X-Amz-Signature=fresh"

DOC_ROW = {
    "id": "11111111-1111-1111-1111-111111111111",
    "org_id": "22222222-2222-2222-2222-222222222222",
    "title": "Engagement letter",
    "file_key": "org/22222222/doc.pdf",
    "file_url": DEAD_STORED,
    "contact_id": None,
    "contact_name": None,
    "is_active": True,
}

CONTRACT_ROW = {
    "id": "33333333-3333-3333-3333-333333333333",
    "org_id": "22222222-2222-2222-2222-222222222222",
    "title": "Retainer",
    "file_key": "org/22222222/retainer.pdf",
    "file_url": DEAD_STORED,
    "contact_id": None,
    "contact_name": None,
    "contact_email": None,
    "contact_company": None,
}


@pytest.fixture(autouse=True)
def _open_the_module_gates(app):
    """Both routers gate on a module subscription. The subject of this file is
    the read path, not the gate, so both are opened and neither is asserted."""
    from routers.graha import _gate as graha_gate
    from routers.ganit import _gate as ganit_gate
    app.dependency_overrides[graha_gate] = lambda: ["admin", "editor", "viewer"]
    app.dependency_overrides[ganit_gate] = lambda: ["admin", "editor", "viewer"]
    yield
    app.dependency_overrides.pop(graha_gate, None)
    app.dependency_overrides.pop(ganit_gate, None)


@pytest.fixture
def fresh_signature(monkeypatch):
    """`sign_key` is imported INSIDE each function, so patching the module it
    comes from is what reaches all three call sites."""
    import services.storage as storage

    async def _sign(org_id, key):
        assert key, "sign_key was called with no key"
        return FRESH

    monkeypatch.setattr(storage, "sign_key", _sign)
    return FRESH


class TestTheStoredUrlIsNeverHandedBack:
    @pytest.mark.anyio
    async def test_get_document_resigns(
        self, api_client, mock_pool, as_admin, with_org_id, fresh_signature,
    ):
        mock_pool.fetchrow.return_value = DOC_ROW
        r = await api_client.get(
            "/api/v1/graha/documents/11111111-1111-1111-1111-111111111111")
        assert r.status_code == 200, r.text
        body = r.text
        assert "SIGNED-FRESH" in body, (
            "GET /graha/documents/{id} did not re-sign — it returns the stored "
            "nine-hour URL, which is a 403 for most of the row's life"
        )
        assert "deadbeef" not in body, (
            "the STALE stored signature is still in the response. A route that "
            "returns both looks correct to a check that only asks whether a "
            "signature is present"
        )

    @pytest.mark.anyio
    async def test_patch_document_resigns(
        self, api_client, mock_pool, as_admin, with_org_id, fresh_signature,
    ):
        """⚠ The 200-with-a-dead-link case."""
        mock_pool.fetchrow.return_value = DOC_ROW
        r = await api_client.patch(
            "/api/v1/graha/documents/11111111-1111-1111-1111-111111111111",
            json={"name": "Engagement letter (rev 2)"},  # `name`, not `title` — see DocumentUpdate
        )
        assert r.status_code == 200, r.text
        assert "SIGNED-FRESH" in r.text, (
            "a successful rename answered 200 and handed back the dead stored "
            "link — the caller has just been told the write succeeded"
        )
        assert "deadbeef" not in r.text

    @pytest.mark.anyio
    async def test_get_contract_resigns(
        self, api_client, mock_pool, as_admin, with_org_id, fresh_signature,
    ):
        mock_pool.fetchrow.return_value = CONTRACT_ROW
        mock_pool.fetch.return_value = []
        r = await api_client.get(
            "/api/v1/ganit/contracts/33333333-3333-3333-3333-333333333333")
        assert r.status_code == 200, r.text
        assert "SIGNED-FRESH" in r.text, (
            "GET /ganit/contracts/{id} returns the stored URL — and a contract "
            "is the document a signature is collected against"
        )
        assert "deadbeef" not in r.text


class TestItDegradesRatherThanBreaks:
    @pytest.mark.anyio
    async def test_an_unconfigured_bucket_keeps_the_old_behaviour(
        self, api_client, mock_pool, as_admin, with_org_id, monkeypatch,
    ):
        """`sign_key` returns None when R2 is not configured. The response must
        then be exactly what it was before this fix rather than a null link —
        `or d.get("file_url", "")` is the whole of that promise, and it is the
        difference between a degraded environment and a broken one."""
        import services.storage as storage

        async def _none(org_id, key):
            return None

        monkeypatch.setattr(storage, "sign_key", _none)
        mock_pool.fetchrow.return_value = DOC_ROW
        r = await api_client.get(
            "/api/v1/graha/documents/11111111-1111-1111-1111-111111111111")
        assert r.status_code == 200, r.text
        assert "deadbeef" in r.text, (
            "with no bucket configured the stored value must survive — "
            "returning null here would break an environment that works today"
        )

    @pytest.mark.anyio
    async def test_a_row_with_no_key_is_left_alone(
        self, api_client, mock_pool, as_admin, with_org_id, fresh_signature,
    ):
        """A document predating the key column has a URL and no key. Signing
        nothing would blank it."""
        mock_pool.fetchrow.return_value = {**DOC_ROW, "file_key": None}
        r = await api_client.get(
            "/api/v1/graha/documents/11111111-1111-1111-1111-111111111111")
        assert r.status_code == 200, r.text
        assert "deadbeef" in r.text, "a keyless row lost its only link"
