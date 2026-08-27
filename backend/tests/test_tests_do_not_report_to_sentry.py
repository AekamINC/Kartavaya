"""A test run must not appear in the production error stream.

── What happened ────────────────────────────────────────────────────────────

`server.py` calls `sentry_sdk.init(...)` at import time whenever `SENTRY_DSN` is
set. Locally it is absent, so nothing happens and this looks like a non-issue.
But the live-schema tests are run as

    railway run -e staging -s Kartavya python -m pytest ...

and **`railway run` injects the real service environment** — verified
2026-08-27: `SENTRY_DSN injected: True`. So every live run reported its failures
into the aekaminc Sentry project as though a user had hit them.

Three PIN-boundary issues — `PYTHON-FASTAPI-13`, `-11`, `-12` — were raised that
way by Phase 7.3's own tests. Nobody was affected by any of them. The cost is
not noise for its own sake: an error stream is only worth reading if everything
in it happened to somebody, and test runs in it make real errors harder to find.

── Why the guard is a `pop` and not a fake DSN ──────────────────────────────

A dummy DSN still initialises the SDK; it merely fails to deliver. "The
transport is failing" is a different and noisier state than "Sentry is off", and
it would put retry warnings in every test run instead of events in Sentry.

── Why this file exists at all ──────────────────────────────────────────────

The guard is one line near the top of `tests/conftest.py`, it must run BEFORE
the first app import, and nothing else would notice if it were moved, reordered
or deleted — least of all locally, where `SENTRY_DSN` is unset and the whole
class of failure is invisible. This is the only thing that would.
"""
import os
import sys


def test_the_dsn_is_gone_from_the_environment():
    """conftest removes it, and it must still be gone by the time tests run."""
    assert os.environ.get("SENTRY_DSN") is None, (
        "SENTRY_DSN is set during a test run — under `railway run` this means "
        "test failures are being reported into the production Sentry project. "
        "The guard at the top of tests/conftest.py has been moved or removed."
    )


def test_the_guard_runs_before_the_first_app_import():
    """Order is the whole guard: `sentry_sdk.init` happens at IMPORT time.

    A fixture, or a line further down conftest than the first `import server`,
    would be too late — the SDK would already hold a client and the events would
    already be going out. Asserted by reading conftest rather than by behaviour,
    because by the time a test body runs, the damage this prevents is done.
    """
    from pathlib import Path

    conftest = Path(__file__).resolve().parent / "conftest.py"
    src = conftest.read_text(encoding="utf-8")

    pop_at = src.find('os.environ.pop("SENTRY_DSN"')
    assert pop_at != -1, "the SENTRY_DSN guard is gone from tests/conftest.py"

    # Every app import in conftest must come after it. `server`, `db` and
    # anything under `routers.` all reach `server.py` eventually.
    for needle in ("import server", "from server", "import db", "from db"):
        at = src.find(needle)
        if at != -1:
            assert at > pop_at, (
                f"conftest does `{needle}` at offset {at}, BEFORE the SENTRY_DSN "
                f"guard at {pop_at} — sentry_sdk.init runs at import time, so "
                "the guard would be too late to stop anything"
            )


def test_no_sentry_client_is_bound_during_tests():
    """The behavioural half: if the SDK was initialised, this catches it.

    Skipped rather than failed when sentry_sdk is not installed at all — that is
    a legitimate environment, and a missing dependency is not this file's news.
    """
    sentry_sdk = sys.modules.get("sentry_sdk")
    if sentry_sdk is None:
        import pytest
        pytest.skip("sentry_sdk not imported in this run — nothing could have sent")

    client = None
    for getter in ("get_client", "Hub"):
        obj = getattr(sentry_sdk, getter, None)
        if getter == "get_client" and callable(obj):
            client = obj()
            break
        if getter == "Hub" and obj is not None:
            client = getattr(obj.current, "client", None)
            break

    if client is None:
        return  # no client at all is exactly what we want
    dsn = getattr(getattr(client, "options", None) or {}, "get", lambda *_: None)("dsn")
    assert not dsn, (
        f"a Sentry client is bound with a DSN during tests ({dsn!r}) — test "
        "failures will be reported as production errors"
    )
