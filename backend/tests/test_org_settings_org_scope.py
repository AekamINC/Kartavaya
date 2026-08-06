"""The brand kit belongs to ONE organisation, and until now it belonged to all of them.

`/api/settings` reads and writes `org_settings`, a table whose whole content is
two rows — `brand_colors` and `brand_fonts` — keyed on nothing but `key`:

    CREATE TABLE IF NOT EXISTS org_settings (
        key   TEXT PRIMARY KEY,
        value JSONB NOT NULL DEFAULT '[]'
    )                                            -- server.py:4367

Measured against the live database on 2026-08-06, `staging.org_settings` DOES
carry an `org_id` column (nullable, added by an earlier catch-up) while
`public.org_settings` does not — but the primary key is `(key)` on BOTH, and no
code path has ever written the column. So:

  * `GET /api/settings` returned the same brand kit to every organisation.
  * `PUT /api/settings` upserted `ON CONFLICT (key)`, which means the LAST org
    to save its colours overwrote every other org's colours in place. Not a
    read leak — a cross-tenant WRITE, silently, on a settings screen.
  * the admin gate was `is_org_admin(user["user_id"])` with no org, which is
    True for an `org_owner`/`org_admin` row in ANY organisation. An admin of one
    tenant could rewrite another tenant's branding while their own switcher said
    something else entirely.

These tests assert on the BIND PARAMETERS, not on the returned dict, for the
same reason `test_approvals_org_scope.py` does: the defect is the absence of an
org in the statement, and a fix that reshapes Python without putting the org
into the SQL has fixed nothing.
"""
import pytest

import server

ORG_A = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa"   # Aekam Inc — the other tenant
ORG_B = "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb"   # E2E Test  — the active org

CALLER = "user_admin_of_b"


class Pool:
    """Records every statement and its bind parameters."""

    def __init__(self, rows=None):
        self.rows = rows or []
        self.queries = []
        self.executed = []

    async def fetch(self, sql, *args):
        self.queries.append((" ".join(sql.split()), args))
        return list(self.rows)

    async def fetchrow(self, sql, *args):
        self.queries.append((" ".join(sql.split()), args))
        return None

    async def fetchval(self, sql, *args):
        self.queries.append((" ".join(sql.split()), args))
        return None

    async def execute(self, sql, *args):
        self.executed.append((" ".join(sql.split()), args))
        return "INSERT 0 1"

    def bound(self):
        return {str(a) for _, args in self.queries + self.executed for a in args}


@pytest.fixture
def admin_of_b(monkeypatch):
    """org_admin of ORG_B and of nowhere else — but an admin SOMEWHERE.

    That last clause is the whole point: the unscoped call answers True for this
    caller, so any gate that asks the unscoped question lets them through in
    every organisation in the database.
    """
    async def _is_org_admin(uid, org_id=None):
        if org_id is None:
            return uid == CALLER
        return uid == CALLER and str(org_id) == ORG_B

    monkeypatch.setattr(server, "is_org_admin", _is_org_admin)


# ── the read ─────────────────────────────────────────────────────────────────

async def test_get_settings_binds_the_active_org():
    """A read of the brand kit must name the organisation it is reading."""
    pool = Pool(rows=[])
    await server.get_org_settings(pool=pool, user={"user_id": CALLER}, org=ORG_B)

    selects = [(q, a) for q, a in pool.queries if "org_settings" in q]
    assert selects, "no org_settings query was issued at all"
    for q, args in selects:
        assert ORG_B in {str(x) for x in args}, (
            f"the brand kit was read with no organisation bound:\n{q}"
        )


async def test_get_settings_with_no_active_org_reads_nobodys_kit():
    """Portal clients and org-less staff resolve no org.

    They must not fall through to "read whatever row exists", which is the
    behaviour that made one org's kit everyone's kit. An empty kit is the
    correct answer, and it must not 403 or 500 — `active_org_id` returns None
    for these two populations by design.
    """
    pool = Pool(rows=[{"key": "brand_colors", "value": ["#123456"]}])
    out = await server.get_org_settings(pool=pool, user={"user_id": "portal_1"},
                                        org=None)
    assert out == {"brand_colors": [], "brand_fonts": []}


# ── the writes ───────────────────────────────────────────────────────────────

async def test_admin_of_b_cannot_write_org_as_settings(admin_of_b):
    """The gate must ask about the ACTIVE org, not about admin-ness anywhere.

    This is the org-admin half of the package brief: an admin of org A must not
    pass an org-admin check while org B is active.
    """
    pool = Pool()
    with pytest.raises(server.HTTPException) as exc:
        await server.update_org_settings(
            {"brand_colors": ["#ff0000"]}, pool=pool,
            user={"user_id": CALLER}, org=ORG_A)
    assert exc.value.status_code == 403
    assert not pool.executed, (
        f"another tenant's brand kit was written: {pool.executed}"
    )


async def test_admin_of_b_cannot_write_org_as_colours_through_the_alias(admin_of_b):
    """`PUT /settings/brand-colors` is the same write behind an older path.

    It must not be the easier way in — an alias that skips the narrowing is a
    hole with a different URL.
    """
    pool = Pool()
    with pytest.raises(server.HTTPException) as exc:
        await server.update_brand_colors_compat(
            {"colors": ["#ff0000"]}, pool=pool,
            user={"user_id": CALLER}, org=ORG_A)
    assert exc.value.status_code == 403
    assert not pool.executed


async def test_a_caller_with_no_active_org_cannot_write_settings(admin_of_b):
    """No org resolved means there is no organisation to be an admin OF.

    The read degrades to empty; the WRITE must refuse. Allowing it would let the
    unscoped question back in through the None branch, which is exactly how the
    other twelve call sites in this file were left half-fixed.
    """
    pool = Pool()
    with pytest.raises(server.HTTPException) as exc:
        await server.update_org_settings(
            {"brand_colors": ["#ff0000"]}, pool=pool,
            user={"user_id": CALLER}, org=None)
    assert exc.value.status_code == 403
    assert not pool.executed


async def test_the_write_binds_the_org_and_conflicts_on_it(admin_of_b):
    """Inside their own org the admin still saves — and the row is theirs.

    Two assertions, and the second is the one that matters: `ON CONFLICT (key)`
    is what let org B's save overwrite org A's row. The conflict target has to
    include the org or the upsert is still a cross-tenant write.
    """
    pool = Pool()
    await server.update_org_settings(
        {"brand_colors": ["#ff0000"], "brand_fonts": ["Inter"]},
        pool=pool, user={"user_id": CALLER}, org=ORG_B)

    assert pool.executed, "the save wrote nothing"
    for q, args in pool.executed:
        assert ORG_B in {str(x) for x in args}, (
            f"the brand kit was written with no organisation bound:\n{q}"
        )
        assert "org_id" in q.lower(), (
            f"the upsert does not mention org_id, so one org's row is still "
            f"every org's row:\n{q}"
        )


async def test_the_alias_write_binds_the_org(admin_of_b):
    pool = Pool()
    await server.update_brand_colors_compat(
        {"colors": ["#00ff00"]}, pool=pool, user={"user_id": CALLER}, org=ORG_B)

    assert pool.executed
    for q, args in pool.executed:
        assert ORG_B in {str(x) for x in args}, (
            f"the alias wrote with no organisation bound:\n{q}"
        )
        assert "org_id" in q.lower(), q
