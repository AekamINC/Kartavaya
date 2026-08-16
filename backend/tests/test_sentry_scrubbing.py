"""Nothing identifying may reach the error sink.

WHY THIS FILE IS LONG
---------------------
Turning Sentry on sends application data to a third party, in a product whose
standing rules are that Aekam must not see client emails, that a user id is
never shown where a name belongs, and whose database sits in Singapore on
purpose. "We configured it carefully" is not a control. These are.

THE DEFAULTS ARE THE DANGER, measured against the pinned SDK:

  - `include_local_variables` defaults TRUE, so every frame's locals are
    serialized and a 500 in payroll or CRM ships salary figures and PAN.
  - request BODIES are attached regardless of `send_default_pii`; only cookies
    and identity are PII-gated.
  - `LoggingIntegration` is a DEFAULT integration, so every `logger.error`
    becomes an event, and four of this backend's error lines interpolate a
    recipient's email address.
  - SQL breadcrumbs are unconditional, from a database production shares.
  - The SDK's header denylist has seven entries and includes none of
    `X-Cron-Secret`, `X-Dispatch-Secret`, `X-Org-Id`.

WHAT THIS FILE CANNOT PROVE - read `sentry_scrub`'s header. Exception MESSAGES
are regex-only, because `exception.values[].value` is the exception's own
`str()` and no switch removes it. A client's company name and a short plaintext
password both survive. The control for that is a code rule, not a config.
"""
from __future__ import annotations

import pathlib

import pytest

import sentry_scrub

EMAIL = "priya@acme.co.in"
SECRET = "f83a607dadfc104312cc4bdde3793eda"
JWT = "eyJhbGciOiJIUzI1NiJ9.abc.def"
ORG = "64e7bea6-6abe-490c-a2a4-27a60c6be916"
UID = "user_549c9cac35aa"


def _event(**over):
    e = {
        "request": {
            "method": "POST",
            "url": ("https://api.example.com/api/task-reminders/dispatch"
                    "?request_secret=" + SECRET),
            "query_string": "request_secret=" + SECRET,
            "headers": {
                "Authorization": "Bearer " + JWT,
                "X-Cron-Secret": SECRET,
                "X-Org-Id": ORG,
                "Content-Type": "application/json",
            },
            "cookies": {"session": "abc123"},
            "data": {"email": EMAIL, "password": "hunter2"},
            "env": {"REMOTE_ADDR": "203.0.113.7"},
        },
        "user": {"id": UID, "email": EMAIL},
        "modules": {"fastapi": "0.115.0"},
        "logentry": {"message": "send failed -> %s", "params": [EMAIL]},
    }
    e.update(over)
    return e


def _flat(node, out=None):
    """Every string anywhere in the structure, keys included."""
    out = [] if out is None else out
    if isinstance(node, str):
        out.append(node)
    elif isinstance(node, dict):
        for k, v in node.items():
            out.append(str(k))
            _flat(v, out)
    elif isinstance(node, (list, tuple)):
        for v in node:
            _flat(v, out)
    return out


# -- the things that must never appear ---------------------------------------

@pytest.mark.parametrize("needle", [
    EMAIL,    # a client's email address
    SECRET,   # the cron / dispatch secret
    JWT,      # a session token
    ORG,      # an org uuid
    UID,      # a user id
])
def test_it_never_leaves(needle):
    blob = "\n".join(_flat(sentry_scrub.before_send(_event(), None)))
    assert needle not in blob, needle + " was transmitted"


def test_the_request_body_is_removed_entirely():
    """Not filtered - REMOVED. Bodies are attached regardless of
    send_default_pii, and a payroll POST body has no safe subset."""
    out = sentry_scrub.before_send(_event(), None)
    assert "data" not in out["request"]
    assert "cookies" not in out["request"]
    assert "env" not in out["request"]


def test_the_query_string_is_dropped_and_the_url_is_trimmed():
    """`scrub_request` touches headers, cookies and data only. query_string is
    scrubbed by nothing, and this product has a cron whose URL carries a 64-hex
    secret in one."""
    out = sentry_scrub.before_send(_event(), None)
    assert out["request"]["query_string"] is None
    assert "?" not in out["request"]["url"]


def test_headers_are_an_allowlist_not_a_denylist():
    """The SDK's denylist knows nothing of X-Cron-Secret or X-Org-Id."""
    out = sentry_scrub.before_send(_event(), None)
    kept = {k.lower() for k in out["request"]["headers"]}
    assert kept <= sentry_scrub._ALLOWED_HEADERS
    assert "authorization" not in kept
    assert "x-cron-secret" not in kept
    assert "x-org-id" not in kept


def test_identity_and_the_package_inventory_are_dropped():
    out = sentry_scrub.before_send(_event(), None)
    assert "user" not in out
    assert "modules" not in out, "a version inventory is a map of what to attack"


def test_a_log_message_parameter_is_redacted():
    """LoggingIntegration turns every logger.error into an event, and four of
    this backend's error lines interpolate a recipient's address."""
    out = sentry_scrub.before_send(_event(), None)
    assert out["logentry"]["params"] == ["[email]"]


def test_an_env_secret_is_redacted_by_exact_value():
    """Regexes are guesswork; the actual value is not. Snapshotted at import,
    so a secret that matches no pattern is still caught."""
    secret = "not-a-pattern-just-a-value-9021"
    sentry_scrub._SECRETS.insert(0, secret)
    try:
        out = sentry_scrub.before_send(
            _event(logentry={"message": "boom", "params": [secret]}), None)
        assert secret not in "\n".join(_flat(out))
    finally:
        sentry_scrub._SECRETS.remove(secret)


# -- breadcrumbs -------------------------------------------------------------

def test_sql_breadcrumbs_are_dropped():
    """Unconditional, not tracing-gated - the SQL text and the database user and
    host would travel, from a database production shares."""
    assert sentry_scrub.before_breadcrumb(
        {"category": "query", "message": "SELECT email FROM users"}, None) is None


def test_info_log_breadcrumbs_are_dropped():
    assert sentry_scrub.before_breadcrumb(
        {"type": "log", "level": "info", "message": "sending to " + EMAIL},
        None) is None


def test_a_kept_breadcrumb_is_still_redacted():
    crumb = sentry_scrub.before_breadcrumb(
        {"type": "log", "level": "error", "message": "failed for " + EMAIL},
        None)
    assert crumb is not None
    assert EMAIL not in crumb["message"]


# -- the transaction path takes a SEPARATE hook ------------------------------

def test_transactions_get_the_same_treatment():
    """`before_send` does NOT run on transaction events, and the ASGI processor
    attaches url and query_string to them with no gate."""
    out = sentry_scrub.before_send_transaction(_event(), None)
    assert out["request"]["query_string"] is None
    assert "?" not in out["request"]["url"]
    assert "user" not in out


# -- structure ---------------------------------------------------------------

def test_redaction_reaches_arbitrary_nesting():
    """The SDK's own scrubber defaults to non-recursive, so nested dicts leak."""
    deep = {"a": {"b": {"c": [{"d": EMAIL}]}}}
    assert EMAIL not in str(sentry_scrub._walk(deep))


def test_the_walker_terminates_on_deep_nesting():
    node = {"k": "v"}
    for _ in range(60):
        node = {"n": node}
    assert sentry_scrub._walk(node) is not None


# -- the one thing no regex can do -------------------------------------------

def test_the_init_never_ships_frame_locals():
    """The four kwargs that matter, asserted against the source.

    A regex cannot substitute for these: a short plaintext password inside a
    model repr has no pattern to match. Frame variables must be OFF, not
    filtered - so this reads the init rather than the behaviour, because the
    behaviour it guards against is the SDK's own default.
    """
    src = (pathlib.Path(__file__).resolve().parents[1] / "server.py").read_text(
        encoding="utf-8")
    init = src[src.index("sentry_sdk.init("):]
    init = init[:init.index("\n    )")]
    for kwarg in ("include_local_variables=False",
                  "include_source_context=False",
                  'max_request_body_size="never"',
                  "send_default_pii=False"):
        assert kwarg in init, "the Sentry init no longer sets " + kwarg


def test_all_three_hooks_are_wired():
    """A hook that exists but is not passed protects nothing. before_send alone
    leaves the transaction and breadcrumb channels wide open."""
    src = (pathlib.Path(__file__).resolve().parents[1] / "server.py").read_text(
        encoding="utf-8")
    for hook in ("before_send=sentry_scrub.before_send",
                 "before_send_transaction=sentry_scrub.before_send_transaction",
                 "before_breadcrumb=sentry_scrub.before_breadcrumb"):
        assert hook in src, "the Sentry init no longer passes " + hook
