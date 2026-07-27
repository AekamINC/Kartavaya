"""A `viewer` grant reads. It does not write.

`require_module` used to ask `SELECT 1 FROM org_member_modules` — does a grant
ROW exist — and never looked at its level. Since `DEFAULT_GRANT_LEVEL` is
`viewer`, every new grant and every invite is created read-only and was then
permitted to write on **210 of 234** module-gated write routes. Only ten
enforced a level, each by hand.

The whole suite stayed green through the fix, which is the more useful fact:
nothing here ever exercised a viewer attempting a write, so the tests could not
have caught the original defect either. That is what this file is for.

The rung is decided by the HTTP verb rather than per route. 210 hand
classifications would be a week of work and wrong somewhere, and a rule in one
place cannot drift out of sync with 210 handlers the way an annotation can.
"""
import pytest
from unittest.mock import AsyncMock, MagicMock

from middleware.subscription import _is_write, READ_SHAPED_POSTS


def _req(method: str, path: str):
    r = MagicMock()
    r.method = method
    r.url = MagicMock()
    r.url.path = path
    return r


class TestWhichRequestsCount:
    """`_is_write` is the whole rule. If it is wrong, the gate is wrong."""

    @pytest.mark.parametrize("method", ["GET", "HEAD", "OPTIONS"])
    def test_reads_are_never_writes(self, method):
        assert _is_write(_req(method, "/api/v1/ganit/invoices")) is False

    @pytest.mark.parametrize("method", ["POST", "PUT", "PATCH", "DELETE"])
    def test_everything_else_is(self, method):
        assert _is_write(_req(method, "/api/v1/ganit/invoices")) is True

    @pytest.mark.parametrize("path", [
        "/api/v1/documents/gst/gstr3b/2026-07/pdf",
        "/api/v1/documents/tds/challan/2026-07/pdf",
        "/api/v1/documents/contracts/abc/agreement/pdf",
        "/api/v1/dristi/query",
        "/api/v1/me/export",
    ])
    def test_read_shaped_posts_are_not_writes(self, path):
        """These take a POST because their parameters do not fit in a URL, not
        because anything changes. Requiring Editor would stop a viewer
        downloading a GSTR-3B they are entitled to read."""
        assert _is_write(_req("POST", path)) is False

    def test_a_trailing_slash_does_not_defeat_the_exception(self):
        assert _is_write(_req("POST", "/api/v1/dristi/query/")) is False

    def test_the_exception_list_matches_a_suffix_not_a_substring(self):
        """`/pdf` must not exempt `/pdf-settings`, which would be a write.

        A substring match here would be a hole big enough to drive a route
        through, and the list is meant to be a small, auditable set of holes.
        """
        assert _is_write(_req("POST", "/api/v1/ganit/pdf-settings")) is True
        assert _is_write(_req("POST", "/api/v1/ganit/invoices/pdf")) is False

    def test_the_exception_list_stays_short(self):
        """Every entry is a hole in the rule that closed 210 routes. This is a
        tripwire, not a limit — if it needs to grow, that is a decision worth
        making deliberately rather than by accretion."""
        assert len(READ_SHAPED_POSTS) <= 6, (
            f"READ_SHAPED_POSTS has grown to {len(READ_SHAPED_POSTS)}. Each entry "
            "lets a viewer through on a POST; confirm each one truly reads."
        )


class TestTheGateItself:
    """End to end through `require_module`, with the pool stubbed."""

    @staticmethod
    def _pool(held_level):
        """A member of the org — no platform row, no org_owner/org_admin role —
        holding `held_level` on the module."""
        pool = MagicMock()
        calls = {"n": 0}

        async def _fetchval(sql, *a):
            s = " ".join(sql.split())
            if "platform" in s.lower():
                return None
            if "user_roles" in s:
                return None            # not org_owner / org_admin
            if "org_member_modules" in s:
                return held_level      # the grant's level
            return None

        pool.fetchval = AsyncMock(side_effect=_fetchval)
        pool.fetch = AsyncMock(return_value=[])
        pool.fetchrow = AsyncMock(return_value=None)
        pool.execute = AsyncMock()
        pool._calls = calls
        return pool

    ORG = "00000000-0000-0000-0000-000000000001"

    @pytest.fixture(autouse=True)
    def _wire(self, monkeypatch):
        import middleware.subscription as sub
        from datetime import datetime, timezone
        monkeypatch.setattr(sub, "is_god_mode", AsyncMock(return_value=False))
        # Whether the ORG has paid for the module is a separate gate further
        # down this same dependency, and it is not what these tests are about.
        # Pre-warm its cache as active so a failure here can only be the grant
        # level — otherwise every "should pass" case returns "Subscription is
        # not active" and looks like the thing under test.
        warm = {f"{self.ORG}:{m}": (datetime.now(timezone.utc), True)
                for m in ("graha", "ganit", "vetana", "sanvaad")}
        monkeypatch.setattr(sub, "_cache", warm)
        self.sub = sub

    async def _run(self, held, method, path, module="graha"):
        from fastapi import HTTPException
        import middleware.subscription as sub

        dep = sub.require_module(module)
        # `_check` is the inner dependency; call it directly with a stub request.
        req = _req(method, path)
        req.state = MagicMock()
        req.state._auth_user = {"user_id": "u_member"}
        pool = self._pool(held)

        async def _get_pool():
            return pool
        import db
        original, db._pool = getattr(db, "_pool", None), pool
        monkey = sub.get_pool
        sub.get_pool = _get_pool
        try:
            inner = dep.dependency if hasattr(dep, "dependency") else dep
            return await inner(req, org_id=self.ORG)
        except HTTPException as e:
            return e
        finally:
            sub.get_pool = monkey
            db._pool = original

    @pytest.mark.asyncio
    async def test_a_viewer_may_read(self):
        from fastapi import HTTPException
        out = await self._run("viewer", "GET", "/api/v1/graha/contacts")
        assert not isinstance(out, HTTPException), "a viewer was refused a READ"

    @pytest.mark.asyncio
    async def test_a_viewer_may_not_write(self):
        """The defect. This passed silently on 210 routes."""
        from fastapi import HTTPException
        out = await self._run("viewer", "POST", "/api/v1/graha/contacts")
        assert isinstance(out, HTTPException), "a VIEWER was allowed to write"
        assert out.status_code == 403
        # The message must say what to do about it, not merely refuse.
        assert "Editor" in out.detail

    @pytest.mark.asyncio
    async def test_an_editor_may_write(self):
        from fastapi import HTTPException
        out = await self._run("editor", "POST", "/api/v1/graha/contacts")
        assert not isinstance(out, HTTPException), "an editor was refused a write"

    @pytest.mark.asyncio
    async def test_a_viewer_may_still_generate_a_document(self):
        """A read-shaped POST. Refusing this would take a report away from
        someone entitled to read it, which is the failure mode of over-correcting."""
        from fastapi import HTTPException
        out = await self._run(
            "viewer", "POST", "/api/v1/documents/gst/gstr3b/2026-07/pdf", module="ganit",
        )
        assert not isinstance(out, HTTPException)

    @pytest.mark.asyncio
    async def test_a_legacy_or_unknown_level_reads_as_the_weakest(self):
        """A row written before the level column existed must not write.

        Failing upward here would hand write access to every legacy row, which
        is the opposite of the fix.
        """
        from fastapi import HTTPException
        out = await self._run("wizard", "POST", "/api/v1/graha/contacts")
        assert isinstance(out, HTTPException) and out.status_code == 403

    @pytest.mark.asyncio
    async def test_no_grant_at_all_is_still_refused_for_reads(self):
        """The original behaviour, unchanged: reach is still required."""
        from fastapi import HTTPException
        out = await self._run(None, "GET", "/api/v1/graha/contacts")
        assert isinstance(out, HTTPException) and out.status_code == 403
        assert "don't have access" in out.detail
