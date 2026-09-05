"""The personnel file gets documents, and documents are the most sensitive rows in it.

`manav_employee_documents` (migration 269) holds scans of PAN cards, Aadhaar
cards and signed contracts. Manav had no document table at all before it — the
employee record carried an ENCRYPTED AADHAAR NUMBER and nothing that proves it.

── WHAT THIS FILE PINS ────────────────────────────────────────────────────────

Not that upload works — that it is SCOPED. Four properties, each of which is a
disclosure if it breaks:

  · a cross-tenant employee id answers 404, NOT 403;
  · reading somebody else's documents needs admin on Manav;
  · reading YOUR OWN does not;
  · `uploaded_by` never leaves the API.

The gate is deliberately stricter than `employee_assets` directly above it in
the router, which settles for VIEWER. Assets are kit. These are identity
documents.
"""
import pytest

EMP = "0efbf133-1626-462e-be7b-fb3f1b0adfee"
OTHER = "11111111-2222-3333-4444-555555555555"
DOC = "99999999-8888-7777-6666-555555555555"
PATH = f"/api/v1/manav/employees/{EMP}/documents"


def gate(app, *levels):
    from routers.manav import _gate
    app.dependency_overrides[_gate] = lambda: list(levels)


@pytest.fixture(autouse=True)
def clear_gate(app):
    yield
    from routers.manav import _gate
    app.dependency_overrides.pop(_gate, None)


@pytest.fixture
def employee_exists(monkeypatch):
    async def _yes(pool, employee_id, org_id):
        return True
    monkeypatch.setattr("routers.manav._employee_in_org", _yes)


class TestACrossTenantIdIsNotFound:
    @pytest.mark.anyio
    async def test_404_not_403(self, api_client, app, mock_pool, as_admin, with_org_id, monkeypatch):
        """⚠ THE ORDER OF THE TWO CHECKS IS THE PROPERTY.

        A 403 here would confirm that the id names a real employee SOMEWHERE,
        which is exactly the disclosure `_employee_in_org` exists to stop. The
        org check therefore runs before the scope check, and a foreign id is
        indistinguishable from one that does not exist.

        ⚠ THE CALLER IS A VIEWER, NOT AN ADMIN, AND THAT IS THE WHOLE TEST.
        With an admin caller `_doc_scope_or_403` returns immediately, so both
        orderings answer 404 and the test proves nothing. As a viewer whose own
        employee row is a DIFFERENT person, the wrong order answers 403 — which
        is the disclosure — and the right order answers 404.
        """
        async def _no(pool, employee_id, org_id):
            return False
        monkeypatch.setattr("routers.manav._employee_in_org", _no)

        async def _own(pool, user, org_id):
            return OTHER
        monkeypatch.setattr("routers.manav._own_employee_id", _own)

        gate(app, "viewer")
        r = await api_client.get(PATH)
        assert r.status_code == 404, (
            f"a foreign employee id answered {r.status_code} — a 403 here "
            f"confirms the row exists in another tenant, which is the "
            f"disclosure the ordering exists to stop"
        )


class TestReadingSomebodyElsesNeedsAdmin:
    @pytest.mark.anyio
    async def test_a_viewer_is_refused_another_persons_documents(
            self, api_client, app, mock_pool, as_admin, with_org_id, employee_exists, monkeypatch):
        async def _own(pool, user, org_id):
            return OTHER          # the caller is a DIFFERENT employee
        monkeypatch.setattr("routers.manav._own_employee_id", _own)
        gate(app, "viewer")
        r = await api_client.get(PATH)
        assert r.status_code == 403, (
            "a viewer read another employee's identity documents — `employee_assets` "
            "allows this for kit, and that gate must not be inherited here"
        )

    @pytest.mark.anyio
    async def test_a_caller_with_no_employee_row_is_refused(
            self, api_client, app, mock_pool, as_admin, with_org_id, employee_exists, monkeypatch):
        """None means NO ACCESS, not unrestricted access."""
        async def _none(pool, user, org_id):
            return None
        monkeypatch.setattr("routers.manav._own_employee_id", _none)
        gate(app, "viewer")
        r = await api_client.get(PATH)
        assert r.status_code == 403

    @pytest.mark.anyio
    async def test_your_own_documents_are_readable_without_admin(
            self, api_client, app, mock_pool, as_admin, with_org_id, employee_exists, monkeypatch):
        async def _own(pool, user, org_id):
            return EMP            # the caller IS this employee
        monkeypatch.setattr("routers.manav._own_employee_id", _own)
        mock_pool.fetch.return_value = []
        gate(app, "viewer")
        r = await api_client.get(PATH)
        assert r.status_code == 200, r.text


class TestTheUploaderIdNeverLeaves:
    @pytest.mark.anyio
    async def test_uploaded_by_is_stripped_from_the_response(
            self, api_client, app, mock_pool, as_admin, with_org_id, employee_exists, monkeypatch):
        """NAMES, NEVER IDS — `frontend/scripts/check-rendered-ids.mjs` is the
        ratchet, and it is positional, so a field that never reaches the client
        is the only reliable way to keep a UUID off the screen.

        The column stays in the table for audit. It is dropped on the way out.
        """
        async def _url(org_id, key):
            return "https://example.invalid/signed"
        monkeypatch.setattr("services.storage.sign_key", _url)
        mock_pool.fetch.return_value = [{
            "id": DOC, "employee_id": EMP, "doc_type": "pan", "name": "PAN card",
            "file_key": "hr/x/y.pdf", "file_size": 1024, "mime_type": "application/pdf",
            "issued_on": None, "expires_on": None, "notes": "",
            "uploaded_by": "user_f1a0deadbeef", "created_at": None,
        }]
        gate(app, "admin", "editor", "viewer")
        r = await api_client.get(PATH)
        assert r.status_code == 200, r.text
        body = r.json()["data"][0]
        assert "uploaded_by" not in body, (
            "the uploader's user id reached the client — a raw user_… is exactly "
            "what the rendered-ids ratchet exists to keep off a screen"
        )
        assert body["file_url"] == "https://example.invalid/signed", (
            "the stored url was returned instead of a fresh signature — a stored "
            "presigned url is nine hours from useless"
        )


class TestBadInputIsRefusedBeforeAnythingIsStored:
    @pytest.mark.anyio
    async def test_an_unknown_doc_type_is_refused(
            self, api_client, app, mock_pool, as_admin, with_org_id, employee_exists):
        gate(app, "admin", "editor", "viewer")
        r = await api_client.post(
            PATH,
            files={"file": ("x.pdf", b"%PDF-1.4 x", "application/pdf")},
            data={"doc_type": "passport_photo_scan_v2"},
        )
        assert r.status_code == 400
        assert "doc_type" in str(r.json().get("detail", ""))

    @pytest.mark.anyio
    async def test_a_malformed_date_is_refused_and_nothing_is_uploaded(
            self, api_client, app, mock_pool, as_admin, with_org_id, employee_exists, monkeypatch):
        """⚠ REFUSED BEFORE `upload_file`, NOT AFTER IT.

        A refusal that ran after the object was stored would leave an orphan in
        R2 that no row points at, on every mistyped date — and the database
        cannot reach R2 to clean it up.
        """
        uploaded = []

        async def _spy(**kw):
            uploaded.append(kw)
            return {"url": "", "key": "", "content_type": ""}
        monkeypatch.setattr("services.storage.upload_file", _spy)

        gate(app, "admin", "editor", "viewer")
        r = await api_client.post(
            PATH,
            files={"file": ("x.pdf", b"%PDF-1.4 x", "application/pdf")},
            data={"doc_type": "pan", "expires_on": "31-12-2026"},
        )
        assert r.status_code == 400, r.text
        assert "expires_on" in str(r.json().get("detail", ""))
        assert not uploaded, "an object was stored for a request that was refused"

    @pytest.mark.anyio
    async def test_upload_needs_admin_even_for_your_own_record(
            self, api_client, app, mock_pool, as_admin, with_org_id, employee_exists, monkeypatch):
        """Reading your own file is fine. Filing INTO it is not.

        An employee who could upload their own "experience letter" could file
        anything at all into their own personnel record.
        """
        async def _own(pool, user, org_id):
            return EMP
        monkeypatch.setattr("routers.manav._own_employee_id", _own)
        gate(app, "viewer")
        r = await api_client.post(
            PATH,
            files={"file": ("x.pdf", b"%PDF-1.4 x", "application/pdf")},
            data={"doc_type": "experience"},
        )
        assert r.status_code == 403


class TestDeletePinsBothIds:
    @pytest.mark.anyio
    async def test_the_where_clause_names_the_employee_too(
            self, api_client, app, mock_pool, as_admin, with_org_id, employee_exists):
        """The document id alone would find the row.

        Pinning `employee_id` as well means a mismatched pair answers 404
        instead of soft-deleting a document belonging to a different person in
        the same organisation.
        """
        mock_pool.fetchrow.return_value = {"id": DOC}
        gate(app, "admin", "editor", "viewer")
        r = await api_client.delete(f"{PATH}/{DOC}")
        assert r.status_code == 200, r.text
        sql = " ".join(
            " ".join(str(c.args[0]).split())
            for c in mock_pool.fetchrow.await_args_list
            if "manav_employee_documents" in str(c.args[0])
        )
        assert "employee_id=$2::uuid" in sql and "org_id=$3::uuid" in sql, (
            f"the delete does not pin employee and org: {sql}"
        )
        assert "is_active=FALSE" in sql, "the delete is hard, not soft"
