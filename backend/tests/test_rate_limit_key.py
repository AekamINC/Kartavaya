"""Rate limits must count a PERSON, not the proxy in front of everyone.

WHAT WAS WRONG
--------------
`slowapi.util.get_remote_address` returns `request.client.host`. Behind
Railway's edge that is the proxy: uvicorn's `ProxyHeadersMiddleware` only
rewrites `scope["client"]` for peers in `forwarded_allow_ips`, which defaults to
`127.0.0.1` and is configured nowhere in this repo.

Every caller therefore shared one bucket, and every limit in the product became
a limit on the product:

    3/hour   password reset — three an hour for every customer combined
    5/minute auth          — five logins a minute across the whole user base
    120/min  global writes — the entire product's write budget

Not a weak control: an inverted one. Real people were refused because of
strangers, and locking every customer out required nothing more than spending
the shared bucket.

THE SPOOFING HALF, WHICH IS WHY THE LAST ENTRY
----------------------------------------------
`X-Forwarded-For` is appended to by each hop. The leftmost entry is whatever the
CLIENT sent, so keying on it hands an attacker a fresh identity per request —
strictly worse than the shared bucket. With one trusted hop the rightmost entry
is the one that hop wrote, and it is the only value nobody upstream could forge.

That "one hop" is an ASSUMPTION about the deployment, stated here so that adding
a second proxy fails a test rather than quietly restoring the hole.

AND ON 2026-08-30 THE SECOND PROXY ARRIVED
------------------------------------------
`api.kartavaya.com` went behind Cloudflare. Two hops now: Cloudflare sets
`X-Forwarded-For: <caller>` and Railway appends Cloudflare's edge address, so
the rightmost entry became CLOUDFLARE and every visitor behind one edge shared
a bucket again — the same inverted control, one layer up.

The fix tests the HOP, not the header. `CF-Connecting-IP` is believed only when
the address Railway itself observed is inside Cloudflare's published ranges.
Trusting that header unconditionally would be WORSE than the bug: the origin
stays publicly reachable, so anyone could set it directly and mint a private
bucket per forged value. `test_a_forged_cloudflare_header_on_the_direct_path_is_ignored`
is the test that says so, and it is the one that must never be deleted.
"""
from __future__ import annotations

from types import SimpleNamespace

import pytest

from limiter import client_ip, limiter


def _req(headers=None, client_host="10.0.0.1"):
    return SimpleNamespace(
        headers=headers or {},
        client=SimpleNamespace(host=client_host, port=1234),
        scope={"client": (client_host, 1234), "headers": []},
    )


def test_the_caller_is_read_from_the_forwarded_header():
    assert client_ip(_req({"x-forwarded-for": "203.0.113.7"})) == "203.0.113.7"


def test_two_callers_behind_one_proxy_get_different_keys():
    """THE REGRESSION. Both used to key on the proxy and share every limit."""
    a = client_ip(_req({"x-forwarded-for": "203.0.113.7"}))
    b = client_ip(_req({"x-forwarded-for": "198.51.100.4"}))
    assert a != b, "two different people still share one rate-limit bucket"


def test_a_spoofed_entry_cannot_win():
    """A client that sends its own X-Forwarded-For gets it APPENDED to, so the
    proxy's value is last. Keying on the first entry would give an attacker a
    fresh identity per request — worse than the bug being fixed."""
    spoofed = _req({"x-forwarded-for": "9.9.9.9, 203.0.113.7"})
    assert client_ip(spoofed) == "203.0.113.7"
    assert client_ip(spoofed) != "9.9.9.9"


def test_many_spoofed_entries_still_resolve_to_the_proxys_value():
    req = _req({"x-forwarded-for": "1.1.1.1, 2.2.2.2, 3.3.3.3, 203.0.113.7"})
    assert client_ip(req) == "203.0.113.7"


def test_no_header_falls_back_rather_than_failing():
    """Health checks and the test client send no header at all."""
    assert client_ip(_req()) == "10.0.0.1"


def test_an_empty_header_does_not_produce_an_empty_key():
    """An empty key would put every such caller in one bucket named ''."""
    assert client_ip(_req({"x-forwarded-for": ""})) == "10.0.0.1"
    assert client_ip(_req({"x-forwarded-for": "  "})) == "10.0.0.1"


def test_the_limiter_uses_it():
    """Wiring, asserted — a correct helper nothing calls is not a fix."""
    assert limiter._key_func is client_ip


def test_the_global_write_middleware_uses_it_too():
    """server.py had its own copy reading `get_remote_address` directly.

    Asserted against the AST, not the source text: the fixed code names the old
    function in a COMMENT explaining what was wrong with it, and a substring
    check cannot tell an explanation from a call. That is the second time in
    this codebase a "the bad thing is not present" test has been fooled by the
    comment describing the bad thing.
    """
    import ast
    import inspect
    import textwrap

    import server

    tree = ast.parse(textwrap.dedent(inspect.getsource(server.global_write_rate_limit)))
    called = {
        (n.func.id if isinstance(n.func, ast.Name) else getattr(n.func, "attr", None))
        for n in ast.walk(tree) if isinstance(n, ast.Call)
    }
    assert "get_remote_address" not in called, (
        "the global write limiter still keys on the proxy address, so the "
        "product shares one 120/minute write budget")
    assert "client_ip" in called or "_client_ip" in called


# ── the Cloudflare hop ──────────────────────────────────────────────────────
#
# 172.71.4.9 is inside 172.64.0.0/13, a real Cloudflare range. 203.0.113.x is
# TEST-NET-3 and is deliberately NOT Cloudflare, so it exercises the ordinary
# single-hop path unchanged.
_CF_EDGE = "172.71.4.9"


def test_a_caller_behind_cloudflare_is_not_keyed_on_cloudflare():
    """The production bug, in one assertion."""
    req = _req({
        "x-forwarded-for": f"203.0.113.7, {_CF_EDGE}",
        "cf-connecting-ip": "203.0.113.7",
    })
    assert client_ip(req) == "203.0.113.7"
    assert client_ip(req) != _CF_EDGE, (
        "every visitor behind one Cloudflare edge is sharing a rate-limit bucket"
    )


def test_two_callers_behind_cloudflare_get_different_keys():
    a = client_ip(_req({"x-forwarded-for": f"203.0.113.7, {_CF_EDGE}",
                        "cf-connecting-ip": "203.0.113.7"}))
    b = client_ip(_req({"x-forwarded-for": f"198.51.100.4, {_CF_EDGE}",
                        "cf-connecting-ip": "198.51.100.4"}))
    assert a != b, "two different people still share one bucket behind Cloudflare"


def test_a_forged_cloudflare_header_on_the_direct_path_is_ignored():
    """The reason the fix tests the HOP and not the header.

    The origin is still publicly reachable. If `CF-Connecting-IP` were trusted
    on its own, anyone calling it directly could mint a fresh bucket per forged
    value and remove rate limiting entirely — worse than the bug it fixes.
    """
    req = _req({
        "x-forwarded-for": "203.0.113.7",          # last hop is NOT Cloudflare
        "cf-connecting-ip": "9.9.9.9",             # ...so this is a stranger talking
    })
    assert client_ip(req) == "203.0.113.7"
    assert client_ip(req) != "9.9.9.9"


def test_a_forged_cloudflare_header_cannot_mint_a_new_bucket_per_request():
    keys = {
        client_ip(_req({"x-forwarded-for": "203.0.113.7",
                        "cf-connecting-ip": f"9.9.9.{n}"}))
        for n in range(1, 20)
    }
    assert keys == {"203.0.113.7"}, "a forged header is still buying separate buckets"


def test_behind_cloudflare_without_the_header_the_entry_before_the_edge_wins():
    req = _req({"x-forwarded-for": f"9.9.9.9, 203.0.113.7, {_CF_EDGE}"})
    assert client_ip(req) == "203.0.113.7"


def test_cloudflare_with_nothing_before_it_keys_on_the_edge_rather_than_inventing_one():
    # Coarse, and identical to the pre-fix behaviour — but never unsafe.
    assert client_ip(_req({"x-forwarded-for": _CF_EDGE})) == _CF_EDGE


def test_an_unparseable_last_entry_is_not_mistaken_for_a_trusted_hop():
    assert client_ip(_req({"x-forwarded-for": "203.0.113.7, not-an-ip"})) == "not-an-ip"


def test_the_cloudflare_range_list_is_actually_populated():
    """Anti-vacuity: an empty list would make every test above pass trivially."""
    from limiter import _CLOUDFLARE_NETS, _is_cloudflare
    assert len(_CLOUDFLARE_NETS) >= 15
    assert _is_cloudflare(_CF_EDGE), "the fixture is not in any configured range"
    assert _is_cloudflare("2606:4700::1"), "IPv6 edges are not covered"
    assert not _is_cloudflare("203.0.113.7")
