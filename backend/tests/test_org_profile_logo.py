"""The company logo is a URL and a KEY — never the image, and never a URL alone.

Two faults, both measured, both on `PATCH /api/v1/org/profile`:

  1. `logo_url` had no validator at all while `description`, `industry` and
     `team_size` each had one, so a `data:image/png;base64,…` went straight into
     `staging.organisations`. Nothing has to be broken for that to happen — the
     field is a client-supplied string on a JSON endpoint, so the image lands in
     the column while object storage is perfectly healthy. It is the same shape
     that put 99MB inside the database before those rows were repointed at R2 on
     2026-08-19.

  2. `logo_key` — the pointer that lets the logo be RE-signed — has not been
     written by any router since migration 057 backfilled it once. The upload
     endpoint hands back a presigned URL that lapses in nine hours; the profile
     stored only that; and by the evening `GET /api/v1/org/profile` and
     `pay.py:_logo_url` have nothing to sign from and the letterhead is a broken
     image. The same missing pointer left five executed e-sign PDFs unservable.

The key is DERIVED from the submitted URL and verified by round trip, not taken
from the body: `ProfileUpdate` does not declare `logo_key`, so an org admin
cannot aim the profile at some other object in the org's bucket and have this
API sign it for them.
"""
import pytest


BUCKET_URL = "https://acct.r2.cloudflarestorage.com/kartavya-storage"
LOGO_KEY = "org/64e7bea6/logo/9f8e7d.png"
LOGO_URL = f"{BUCKET_URL}/{LOGO_KEY}?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Signature=abc"


@pytest.fixture
def our_bucket(monkeypatch):
    """`sign_key` as R2 answers it: path-style, `/<bucket>/<key>`, presigned."""
    import services.storage as storage

    async def _sign(org_id, key):
        return f"{BUCKET_URL}/{key}?X-Amz-Signature=fresh"

    monkeypatch.setattr(storage, "sign_key", _sign)


def _updates(pool):
    """Every `UPDATE staging.organisations` the handler issued, with its binds."""
    return [
        c.args for c in pool.fetchrow.call_args_list
        if c.args and isinstance(c.args[0], str)
        and "UPDATE public.organisations" in c.args[0]
    ]


# ── 1 · the image itself is refused, by name ──────────────────────────────────

@pytest.mark.parametrize(
    "value",
    [
        "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==",
        "DATA:image/svg+xml;base64,PHN2Zz48L3N2Zz4=",
        "data:application/pdf;base64,JVBERi0xLjQK",
    ],
    ids=["png", "uppercase-scheme", "pdf"],
)
async def test_a_data_uri_logo_is_refused_and_names_the_field(
        api_client, mock_pool, as_admin, with_org_id, value):
    mock_pool.fetch.return_value = []
    resp = await api_client.patch("/api/v1/org/profile", json={"logo_url": value})

    assert resp.status_code == 422
    assert any("logo_url" in str(d.get("loc", "")) for d in resp.json()["detail"])
    assert not _updates(mock_pool), "the image reached the column anyway"


async def test_an_unbounded_logo_url_is_refused(
        api_client, mock_pool, as_admin, with_org_id):
    """A presigned R2 URL is around 500 characters. The cap is a URL's, not an
    image's — an unbounded TEXT column fed from a form is a row-size problem
    waiting for whoever pastes something into it."""
    mock_pool.fetch.return_value = []
    resp = await api_client.patch(
        "/api/v1/org/profile",
        json={"logo_url": "https://cdn.example.invalid/" + "a" * 4000},
    )
    assert resp.status_code == 422
    assert not _updates(mock_pool)


# ── 2 · the key is written, so the logo can be re-signed ──────────────────────

async def test_a_logo_url_also_writes_the_key_it_came_from(
        api_client, mock_pool, as_admin, with_org_id, our_bucket):
    mock_pool.fetch.return_value = []
    mock_pool.fetchrow.return_value = {"name": "QA Org", "logo_url": LOGO_URL}

    resp = await api_client.patch("/api/v1/org/profile", json={"logo_url": LOGO_URL})

    assert resp.status_code == 200
    sql, *binds = _updates(mock_pool)[-1]
    assert "logo_key=" in sql
    assert LOGO_KEY in binds, "the key was not written, so nothing can re-sign the logo"


async def test_clearing_the_logo_clears_the_key_too(
        api_client, mock_pool, as_admin, with_org_id, our_bucket):
    """Otherwise GET keeps re-signing the removed object and the logo can never
    come off the letterhead."""
    mock_pool.fetch.return_value = []
    mock_pool.fetchrow.return_value = {"name": "QA Org", "logo_url": ""}

    resp = await api_client.patch("/api/v1/org/profile", json={"logo_url": ""})

    assert resp.status_code == 200
    sql, *binds = _updates(mock_pool)[-1]
    assert "logo_key=" in sql
    assert binds[:2] == ["", ""]


async def test_a_url_from_somewhere_else_writes_no_key_at_all(
        api_client, mock_pool, as_admin, with_org_id, our_bucket):
    """The derivation is verified by round trip and fails CLOSED. A wrong key is
    worse than none: GET prefers `logo_key`, so it would replace a URL that
    works for nine hours with one that never works."""
    mock_pool.fetch.return_value = []
    foreign = "https://cdn.example.invalid/brand/logo.png"
    mock_pool.fetchrow.return_value = {"name": "QA Org", "logo_url": foreign}

    resp = await api_client.patch("/api/v1/org/profile", json={"logo_url": foreign})

    assert resp.status_code == 200
    sql, *_ = _updates(mock_pool)[-1]
    assert "logo_key=" not in sql


async def test_the_caller_cannot_choose_which_object_the_logo_points_at(
        api_client, mock_pool, as_admin, with_org_id, our_bucket):
    """`logo_key` is not a field on `ProfileUpdate`, so a body naming it is
    dropped — an org admin cannot point the profile at an executed contract in
    the same bucket and have the API mint a signed URL for it."""
    mock_pool.fetch.return_value = []
    mock_pool.fetchrow.return_value = {"name": "QA Org", "logo_url": LOGO_URL}

    resp = await api_client.patch(
        "/api/v1/org/profile",
        json={"logo_url": LOGO_URL, "logo_key": "esign/signed/someone-elses.pdf"},
    )

    assert resp.status_code == 200
    sql, *binds = _updates(mock_pool)[-1]
    assert "esign/signed/someone-elses.pdf" not in binds
    assert LOGO_KEY in binds


async def test_a_derivation_that_blows_up_does_not_refuse_the_save(
        api_client, mock_pool, as_admin, with_org_id, monkeypatch):
    """One field must not refuse a form — the same rule that stopped a
    mistyped GSTIN taking the whole profile with it. A missing pointer leaves
    the profile exactly where it already was."""
    import services.storage as storage

    async def _boom(org_id, key):
        raise RuntimeError("R2 credentials would not decrypt")

    monkeypatch.setattr(storage, "sign_key", _boom)
    mock_pool.fetch.return_value = []
    mock_pool.fetchrow.return_value = {"name": "QA Org", "logo_url": LOGO_URL}

    resp = await api_client.patch("/api/v1/org/profile", json={"logo_url": LOGO_URL})

    assert resp.status_code == 200
    sql, *_ = _updates(mock_pool)[-1]
    assert "logo_url=" in sql
    assert "logo_key=" not in sql
