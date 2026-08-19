"""Generated images that were paid for and never appeared.

Owner, 2026-08-03: "I don't see any images on the portal which has been created."
Measured before the fix: 208 content items, 40 carrying a generated image, 6 of
them visible. Three defects, independent of each other:

  1. `quick_generate` — the route the Generate tab uses — deducted three credits
     for an image, uploaded it, and wrote the URL only into `metadata.images`.
     The content library renders `image_url`, the COLUMN. 34 of the 40 images
     were invisible for this reason alone: bought, stored, and unreachable.

  2. `image_url` holds a PRESIGNED R2 link that expires after nine hours
     (storage.upload_file, ExpiresIn=32400), and only the org-level list
     re-signed it. `/clients/{id}/content` and the single-item read returned the
     stored string, so those images were broken by the next morning.

  3. There was no key to re-sign FROM — only the dead URL, parsed by
     `storage.refresh_signed_url`, which storage.py itself marks deprecated for
     exactly this. `image_key` is now written at generation.

The signing helper is asserted on behaviour; the write paths on the SQL they
execute, because a missing column in an INSERT is invisible until someone counts
the money.
"""
import inspect
import re

import pytest

import routers.hub as hub


def _sql(fn) -> str:
    return re.sub(r"\s+", " ", inspect.getsource(fn))


# ── 1 · every route that makes an image stores it where the UI reads ──────────

@pytest.mark.parametrize(
    "fn",
    [hub.quick_generate, hub.generate_org_content, hub.execute_org_skill],
    ids=lambda f: f.__name__,
)
def test_a_generated_image_lands_on_the_column_not_only_in_metadata(fn):
    sql = _sql(fn)
    assert "image_url" in sql, \
        f"{fn.__name__} generates an image the content library will never show"
    assert "image_key" in sql, \
        f"{fn.__name__} stores no key, so the link cannot be re-signed once it expires"


def test_quick_generate_still_reports_the_image_to_its_caller():
    """The metadata copy is kept — the Generate tab shows the result inline
    before it is ever saved, and reads it from the response."""
    src = inspect.getsource(hub.quick_generate)
    assert 'result["images"] = [{"url": img_result["image_url"]' in src


def test_the_image_key_is_taken_from_the_generator_not_derived():
    """`generate_image` returns the key `upload_file` actually used. Deriving it
    from the URL is the deprecated path this whole change exists to retire."""
    from services import ai_router
    src = inspect.getsource(ai_router.generate_image)
    assert 'result["image_key"] = upload.get("key")' in src


# ── 2 · every read path re-signs ──────────────────────────────────────────────

@pytest.mark.parametrize(
    "fn",
    [hub.list_content, hub.get_content, hub.list_org_content],
    ids=lambda f: f.__name__,
)
def test_every_content_read_path_re_signs_its_images(fn):
    assert "sign_content_images" in inspect.getsource(fn), \
        f"{fn.__name__} hands back a presigned URL that expires in nine hours"


@pytest.mark.asyncio
async def test_signing_prefers_the_stored_key(monkeypatch):
    calls = {}

    async def _sign_key(org_id, key):
        calls["key"] = key
        return f"https://r2.invalid/{key}?fresh=1"

    async def _refresh(org_id, url):
        calls["fell_back"] = True
        return url

    monkeypatch.setattr("services.storage.sign_key", _sign_key)
    monkeypatch.setattr("services.storage.refresh_signed_url", _refresh)

    items = [{"image_url": "https://r2.invalid/srijan/images/a.png?expired=1",
              "image_key": "srijan/images/a.png"}]
    out = await hub.sign_content_images("org", items)

    assert calls["key"] == "srijan/images/a.png"
    assert "fresh=1" in out[0]["image_url"]
    assert "fell_back" not in calls


@pytest.mark.asyncio
async def test_signing_falls_back_for_rows_that_predate_the_key(monkeypatch):
    """The six images that already existed keep working."""
    async def _sign_key(org_id, key):
        return None

    async def _refresh(org_id, url):
        return url + "&resigned=1"

    monkeypatch.setattr("services.storage.sign_key", _sign_key)
    monkeypatch.setattr("services.storage.refresh_signed_url", _refresh)

    items = [{"image_url": "https://r2.invalid/srijan/images/b.png?expired=1", "image_key": None}]
    out = await hub.sign_content_images("org", items)
    assert out[0]["image_url"].endswith("&resigned=1")


@pytest.mark.asyncio
async def test_a_data_uri_is_left_alone(monkeypatch):
    """An org with no R2 gets base64 back from `upload_file`. Signing it would
    destroy it."""
    async def _boom(*a, **k):
        raise AssertionError("a data: URI must not be sent for signing")

    monkeypatch.setattr("services.storage.sign_key", _boom)
    monkeypatch.setattr("services.storage.refresh_signed_url", _boom)

    items = [{"image_url": "data:image/png;base64,AAAA", "image_key": None}]
    out = await hub.sign_content_images("org", items)
    assert out[0]["image_url"] == "data:image/png;base64,AAAA"


@pytest.mark.asyncio
async def test_an_item_with_no_image_is_untouched(monkeypatch):
    async def _boom(*a, **k):
        raise AssertionError("nothing to sign")

    monkeypatch.setattr("services.storage.sign_key", _boom)
    monkeypatch.setattr("services.storage.refresh_signed_url", _boom)

    items = [{"image_url": None}, {"image_url": ""}, {}]
    assert await hub.sign_content_images("org", items) == items
