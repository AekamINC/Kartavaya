"""
The API map must not be served to anonymous visitors in production.

`/openapi.json` once returned 116 endpoint paths and 54 data schemas — the whole
`/api/admin/*` surface, every request and response shape, every field name on a
payslip — to an unauthenticated request against production. It was closed by
setting `docs_url` / `redoc_url` / `openapi_url` to None off-production.

That fix handled the EMPTY variable and missed the SPELLING. The gate read

    _DOCS_ON = _EXPOSE_DOCS or _ENVIRONMENT != "production"

which is a denylist with exactly one entry: any value that was not that precise
ten-character lowercase string turned the docs back on. `RAILWAY_ENVIRONMENT`
carries whatever the environment was NAMED in the Railway dashboard, so
`Production` is not a hypothetical typo — it is what you get by creating the
environment through the UI and capitalising it. `prod`, `main` and `live` are
all likewise ordinary names for the environment that must never serve this.

The gate is now an ALLOWLIST — docs are served only for a recognised
non-production name — so the property under test is:

    ANY value that is not explicitly known to be non-production serves nothing.

These tests pin the resolution logic rather than the FastAPI app object, because
`docs_url` is fixed at import time: the app is constructed once per process and
cannot be re-created per parametrised case.
"""

import pytest


def _resolve(environment=None, railway_environment=None, expose=None, monkeypatch=None):
    """Re-run server.py's gate logic exactly as written, under the given env."""
    import os

    env = {}
    if environment is not None:
        env["ENVIRONMENT"] = environment
    if railway_environment is not None:
        env["RAILWAY_ENVIRONMENT"] = railway_environment
    if expose is not None:
        env["EXPOSE_API_DOCS"] = expose

    def _env(name, default=""):
        return (env.get(name) or "").strip() or default

    import server
    resolved = (
        _env("ENVIRONMENT") or _env("RAILWAY_ENVIRONMENT") or "production"
    ).casefold()
    expose_docs = _env("EXPOSE_API_DOCS").casefold() in ("1", "true", "yes")
    return expose_docs or resolved in server._NON_PRODUCTION_ENVIRONMENTS


# ── Values that must NEVER serve the API map ─────────────────────────────────

@pytest.mark.parametrize("value", [
    "production",
    "Production",          # Railway dashboard, title-cased by hand
    "PRODUCTION",
    "PrOdUcTiOn",
    "  production  ",      # padded
    "prod",
    "Prod",
    "prd",
    "main",                # the branch name used as the environment name
    "live",
    "release",
    "default",
    "",                    # set but empty
    "   ",                 # set to whitespace
    None,                  # never set at all
    "staging-2",           # near-miss on an allowed name
    "production-eu",
    "pre-production",      # contains "production" but is not it
])
def test_environment_never_exposes_docs(value):
    assert _resolve(environment=value) is False, (
        f"ENVIRONMENT={value!r} served /openapi.json — the gate must fail CLOSED "
        f"on every value it does not explicitly recognise as non-production"
    )


@pytest.mark.parametrize("value", [
    "production", "Production", "PRODUCTION", "prod", "main", "live", "", None,
])
def test_railway_environment_never_exposes_docs(value):
    """RAILWAY_ENVIRONMENT is the fallback and carries the same free-text risk."""
    assert _resolve(railway_environment=value) is False


def test_unset_everything_is_production():
    """No variables at all is the Railway-misconfiguration case. Fail closed."""
    assert _resolve() is False


# ── Values that legitimately DO serve it ─────────────────────────────────────

@pytest.mark.parametrize("value", [
    "local", "Local",
    "dev", "development", "Development",
    "test", "testing", "qa", "preview",
])
def test_recognised_non_production_serves_docs(value):
    assert _resolve(environment=value) is True, (
        f"ENVIRONMENT={value!r} should serve docs — a laptop is genuinely not "
        f"the product"
    )


@pytest.mark.parametrize("value", ["staging", "Staging", "STAGING", "stage"])
def test_staging_no_longer_serves_docs(value):
    """⚠ THIS TEST INVERTED ON 2026-08-30, AND IT MUST NOT BE INVERTED BACK.

    "staging" and "stage" used to be on the allowlist, on the reasoning that
    staging "is the environment that exists to be poked at". There is no staging
    environment any more — everything moved to production — but the Railway
    environment still exists carrying ENVIRONMENT=staging, and it was serving the
    complete API map UNAUTHENTICATED against the SAME production database:

        GET https://kartavaya-staging.up.railway.app/openapi.json
        -> HTTP 200, 1,022,070 bytes            (measured 2026-08-30)
        GET https://api.kartavaya.com/openapi.json
        -> HTTP 404                             (correct)

    That is reconnaissance handed to anyone: which fields exist on a payslip,
    which admin routes to try first, for a product holding payroll and bank
    details. A deployment that still calls itself staging is not a reason to
    publish the map, because the name no longer describes a separate place.
    """
    assert _resolve(environment=value) is False, (
        f"ENVIRONMENT={value!r} served the API map. There is no staging "
        f"environment — that name now points at production data."
    )


def test_railway_environment_staging_no_longer_serves_docs():
    assert _resolve(railway_environment="staging") is False


def test_environment_wins_over_railway_environment():
    """ENVIRONMENT is read first; a RAILWAY_ENVIRONMENT value must not override it."""
    assert _resolve(environment="production", railway_environment="dev") is False


# ── The deliberate production escape hatch ───────────────────────────────────

@pytest.mark.parametrize("value", ["1", "true", "TRUE", "True", "yes", "YES"])
def test_expose_api_docs_opens_them_in_production(value):
    """An explicit opt-in still works — an hour of debugging without a deploy."""
    assert _resolve(environment="production", expose=value) is True


@pytest.mark.parametrize("value", ["0", "false", "no", "", "   ", "maybe", "on"])
def test_expose_api_docs_requires_an_affirmative_value(value):
    """Anything that is not an explicit yes leaves production closed."""
    assert _resolve(environment="production", expose=value) is False


# ── The allowlist itself ─────────────────────────────────────────────────────

def test_allowlist_contains_no_production_spelling():
    """A production-ish name must never be added to the allowlist by accident."""
    import server
    for name in server._NON_PRODUCTION_ENVIRONMENTS:
        assert name == name.casefold(), f"{name!r} must be lowercase to ever match"
        assert "prod" not in name, f"{name!r} would serve the API map in production"
        assert name not in ("main", "live", "release", "default")
