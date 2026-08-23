"""
Targeted coverage for what workstream L changed in routers/org_security.py:
the `enforced` dict now tells the truth about tfa_allowed/tfa_enforced, and
the lockout-count mechanism (`_enrolment`) actually activates now that
`staging.user_totp` is a real table — this router had no test file before,
and a full PATCH-validation suite for idle_timeout/ip_ranges/password_policy
is out of scope for the 2FA workstream that touched only these two things.
"""


async def test_enforced_dict_reports_2fa_as_real(api_client, mock_pool, admin_user, app):
    """tfa_allowed/tfa_enforced must read True now that login() actually
    reads them — reporting False here would be the settings page lying in
    the OTHER direction (claiming no protection when there is one)."""
    from auth_router import require_user
    from middleware.org_resolver import get_org_id

    app.dependency_overrides[require_user] = lambda: admin_user
    app.dependency_overrides[get_org_id] = lambda: "11111111-1111-1111-1111-111111111111"

    async def fetchval_side_effect(query, *args):
        if "org_id IS NULL" in query and "role_code = ANY" in query:
            return "platform_admin"  # require_org_role's is_platform probe
        if "org_id=$2::uuid AND role_code = ANY($3::text[])" in query and "LIMIT 1" not in query:
            return "org_owner"  # require_org_role's own-org role probe
        if "to_regclass('staging.org_security')" in query:
            return "staging.org_security"
        if "to_regclass($1)" in query:
            return None  # no TOTP table -> uncountable, exercised separately below
        return 0

    mock_pool.fetchval.side_effect = fetchval_side_effect
    mock_pool.fetchrow.return_value = None  # no saved row yet -> defaults

    resp = await api_client.get("/api/v1/org/security")
    assert resp.status_code == 200
    data = resp.json()
    assert data["enforced"]["tfa_allowed"] is True
    assert data["enforced"]["tfa_enforced"] is True
    assert data["enforced"]["idle_timeout"] is False

    app.dependency_overrides.pop(require_user, None)
    app.dependency_overrides.pop(get_org_id, None)


async def test_lockout_count_activates_once_user_totp_exists(api_client, mock_pool, admin_user, app):
    """The whole point of naming the table `staging.user_totp`: org_security.py
    needed zero code changes to start counting real enrolment."""
    from auth_router import require_user
    from middleware.org_resolver import get_org_id

    app.dependency_overrides[require_user] = lambda: admin_user
    app.dependency_overrides[get_org_id] = lambda: "11111111-1111-1111-1111-111111111111"

    async def fetchval_side_effect(query, *args):
        if "org_id IS NULL" in query and "role_code = ANY" in query:
            return "platform_admin"  # require_org_role's is_platform probe
        if "org_id=$2::uuid AND role_code = ANY($3::text[])" in query and "LIMIT 1" not in query:
            return "org_owner"  # require_org_role's own-org role probe
        if "to_regclass('staging.org_security')" in query:
            return "staging.org_security"
        if "to_regclass($1)" in query:
            return "staging.user_totp"
        if "SELECT COUNT(DISTINCT user_id) FROM staging.user_roles" in query:
            return 5
        if "JOIN staging.user_roles ur ON ur.user_id = t.user_id" in query:
            return 2
        return 0

    mock_pool.fetchval.side_effect = fetchval_side_effect
    mock_pool.fetchrow.return_value = None

    resp = await api_client.get("/api/v1/org/security")
    assert resp.status_code == 200
    two_factor = resp.json()["two_factor"]
    assert two_factor["countable"] is True
    assert two_factor["members"] == 5
    assert two_factor["enrolled"] == 2
    assert two_factor["would_be_locked_out"] == 3

    app.dependency_overrides.pop(require_user, None)
    app.dependency_overrides.pop(get_org_id, None)
