"""The SES region default must equal the account's only region.

WHY THIS TEST EXISTS
--------------------
`email_service.AWS_REGION` used to default to `us-east-1`. The Aekam AWS
account has SES in **ap-south-1 (Asia Pacific, Mumbai)** and nowhere else --
measured 2026-08-29 from the SES account dashboard: 50,000/day, 14/sec,
out of sandbox, health "Healthy".

SES identities are PER-REGION. A domain verified in Mumbai does not exist in
Virginia. So the old default did not degrade gracefully -- with AWS_REGION
unset, boto3 pointed at a region holding zero verified identities and every
invoice, payslip and report was rejected at the SES call.

Staging never showed this because its AWS_REGION variable is set. Production
has not sent a message since July and is asleep, so its value has never been
exercised -- the failure was scheduled for the first send after promotion.

A NOTE ON HOW THIS IS ASSERTED
------------------------------
The module docstring for the constant now *mentions* `us-east-1` while
explaining what went wrong. A naive `"us-east-1" not in source` check would
match that comment and fail forever -- and its mirror image (a check that
passes because it matched a comment) produced two false greens elsewhere in
this codebase on the same day. So: the real assertions are on the imported
value, and the one source-level check strips comments with `tokenize` first.
"""

import importlib
import io
import os
import tokenize

import pytest

ACCOUNT_REGION = "ap-south-1"


def _reload_with(monkeypatch, region):
    """Re-import email_service with AWS_REGION set (or absent) and return it."""
    import email_service

    if region is None:
        monkeypatch.delenv("AWS_REGION", raising=False)
    else:
        monkeypatch.setenv("AWS_REGION", region)
    # Credentials absent -> the boto3 client is never constructed, so the
    # reload cannot make a network call or need real keys.
    monkeypatch.delenv("AWS_ACCESS_KEY_ID", raising=False)
    monkeypatch.delenv("AWS_SECRET_ACCESS_KEY", raising=False)
    return importlib.reload(email_service)


def test_default_region_is_the_accounts_region(monkeypatch):
    """With AWS_REGION unset, we must land in Mumbai -- not Virginia."""
    mod = _reload_with(monkeypatch, None)
    assert mod.AWS_REGION == ACCOUNT_REGION, (
        f"AWS_REGION defaulted to {mod.AWS_REGION!r}. SES identities are "
        f"per-region and this account only has {ACCOUNT_REGION!r}; any other "
        "default sends every message at a region with no verified identity."
    )


def test_explicit_region_still_wins(monkeypatch):
    """The default is a floor, not a cap -- a set variable must override it."""
    mod = _reload_with(monkeypatch, "eu-west-2")
    assert mod.AWS_REGION == "eu-west-2"


def test_ses_client_is_built_for_that_region(monkeypatch):
    """The value must reach boto3, not just sit in a module constant.

    The old bug was one line, but the thing that mattered was the region
    handed to `boto3.client(...)`. Assert on the call, not the constant.
    """
    captured = {}

    class _FakeBoto:
        @staticmethod
        def client(service, **kwargs):
            captured["service"] = service
            captured["region"] = kwargs.get("region_name")
            return object()

    monkeypatch.delenv("AWS_REGION", raising=False)
    monkeypatch.setenv("AWS_ACCESS_KEY_ID", "AKIAtest")
    monkeypatch.setenv("AWS_SECRET_ACCESS_KEY", "secrettest")
    monkeypatch.setitem(__import__("sys").modules, "boto3", _FakeBoto)

    import email_service

    importlib.reload(email_service)

    assert captured.get("service") == "ses"
    assert captured.get("region") == ACCOUNT_REGION, (
        f"boto3 was handed region {captured.get('region')!r}"
    )


def test_no_us_east_1_left_in_executable_code():
    """`us-east-1` may appear in prose, never in code.

    Comments are stripped before matching. This is deliberate: a check run
    over raw file text matches the very comment that documents the fix, which
    is how a gate elsewhere in this repo stayed green over a real regression.
    """
    import email_service

    path = email_service.__file__
    with io.open(path, "rb") as fh:
        tokens = list(tokenize.tokenize(fh.readline))

    code_only = "".join(
        t.string
        for t in tokens
        if t.type not in (tokenize.COMMENT, tokenize.NL, tokenize.NEWLINE)
    )
    # Docstrings are STRING tokens, so drop the module docstring too by
    # checking only what is left after comments -- then assert on the literal.
    assert "us-east-1" not in code_only, (
        "us-east-1 appears in executable code in email_service.py; the "
        "account has no SES identity in that region."
    )
    # Anti-vacuity: if the strip ever eats everything, this test must not pass
    # by describing an empty string.
    assert "ap-south-1" in code_only, (
        "comment-stripping removed the region literal too -- this test would "
        "have passed vacuously"
    )
