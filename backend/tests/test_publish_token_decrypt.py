"""
The publish path must hand the platform a token, not a ciphertext.

`services/encryption.encrypt` protects `hub_social_accounts.access_token` at
rest, because in the clear a database dump lets anyone post as a customer's
brand. Two readers loaded that column and only one of them decrypted:

  `_get_account`     decrypted, and is used by the manual-connect path.
  `publish_content`  selected `sa.access_token` through a JOIN and passed the
                     CIPHERTEXT to the platform.

So every scheduled post and every cron dispatch would have failed with a token
no network ever issued — and the error would have arrived from Facebook rather
than from us, reading as the *customer's* credentials being wrong.

It never surfaced because `hub_social_accounts` has held zero rows for the
whole life of the feature. The first firm to connect an account would have
found it.

These tests use the real `encrypt`/`decrypt` rather than mocking them: the bug
was that a value was passed through UNCHANGED, and a mocked codec that returns
its input cannot tell the fixed code from the broken code.
"""
from __future__ import annotations

import ast
import inspect
from pathlib import Path

import pytest

from services.encryption import decrypt, encrypt
from services.social_publisher import with_plain_tokens


def test_a_stored_token_comes_back_usable():
    stored = encrypt("EAAG-a-real-looking-graph-token")
    assert stored != "EAAG-a-real-looking-graph-token", (
        "encrypt returned its input, so this test cannot prove anything — check "
        "FIELD_ENCRYPTION_KEY is set in the test environment"
    )
    out = with_plain_tokens({"access_token": stored, "refresh_token": None})
    assert out["access_token"] == "EAAG-a-real-looking-graph-token"


def test_it_decrypts_the_refresh_token_too():
    """The refresh token buys the next access token. A ciphertext here fails
    the renewal rather than the post, which reads as 'reconnect this account'
    for an account that is perfectly healthy."""
    out = with_plain_tokens({
        "access_token": encrypt("access"),
        "refresh_token": encrypt("refresh"),
    })
    assert out["access_token"] == "access"
    assert out["refresh_token"] == "refresh"


def test_a_row_written_before_encryption_still_works():
    """`decrypt` passes unmarked values through. Rows predating encryption must
    keep publishing rather than being mangled into nonsense."""
    out = with_plain_tokens({"access_token": "plain-legacy-token"})
    assert out["access_token"] == "plain-legacy-token"


def test_calling_it_twice_is_harmless():
    """Both readers may end up calling it as the code moves. Decrypting an
    already-plain value must not corrupt it."""
    once = with_plain_tokens({"access_token": encrypt("t")})
    twice = with_plain_tokens(once)
    assert twice["access_token"] == "t"


def test_it_does_not_mutate_the_row_it_was_given():
    """The caller keeps `item` around and writes queue rows from it. Decrypting
    in place would put a plaintext token into whatever that row is used for
    next."""
    row = {"access_token": encrypt("secret"), "platform": "facebook"}
    before = row["access_token"]
    with_plain_tokens(row)
    assert row["access_token"] == before


def test_missing_and_empty_tokens_are_left_alone():
    out = with_plain_tokens({"access_token": None, "refresh_token": ""})
    assert out["access_token"] is None
    assert out["refresh_token"] == ""


# ── the ratchet ─────────────────────────────────────────────────────────────

def test_no_reader_of_the_token_column_skips_the_decrypt():
    """THE SHAPE OF THE BUG, pinned so a third reader cannot repeat it.

    Any function in `social_publisher` that names `access_token` in SQL must
    also route the row through `with_plain_tokens`. Source-read rather than
    executed, because reproducing it needs a live account row and the table is
    empty — which is precisely why the bug survived.
    """
    src = Path("services/social_publisher.py").read_text(encoding="utf-8")
    tree = ast.parse(src)

    offenders = []
    for node in ast.walk(tree):
        if not isinstance(node, (ast.AsyncFunctionDef, ast.FunctionDef)):
            continue
        body = ast.unparse(node)
        selects_token = "access_token" in body and (
            "SELECT" in body.upper() or "hub_social_accounts" in body
        )
        if not selects_token:
            continue
        if node.name in ("with_plain_tokens", "_refresh_token_if_needed",
                         "_refresh_meta_token", "_refresh_linkedin_token"):
            # `with_plain_tokens` IS the decrypt; the refresh helpers are handed
            # an already-decrypted dict by their caller and write back through
            # `encrypt`.
            continue
        if "with_plain_tokens" not in body:
            offenders.append(node.name)

    assert not offenders, (
        f"{offenders} read the token column without decrypting it. That is the "
        f"bug that made every scheduled post fail with a token no network "
        f"issued — route the row through with_plain_tokens()."
    )


def test_the_publish_path_names_the_helper():
    """Belt and braces: the specific function the bug lived in."""
    from services import social_publisher

    src = inspect.getsource(social_publisher.publish_content)
    assert "with_plain_tokens" in src
    assert "account = dict(item)" not in src, (
        "publish_content is back to using the raw joined row — that hands the "
        "platform a ciphertext"
    )
