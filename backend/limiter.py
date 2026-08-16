"""Rate limiter singleton — import this in auth_router and server.py.

── WHY THIS IS NOT `get_remote_address` ────────────────────────────────────

`slowapi.util.get_remote_address` returns `request.client.host`. Behind
Railway's edge that is the PROXY, not the caller, because uvicorn's
`ProxyHeadersMiddleware` only rewrites `scope["client"]` for peers listed in
`forwarded_allow_ips` — which defaults to `127.0.0.1` and is configured nowhere
in this repo.

So every caller in the world collapsed onto a handful of Railway addresses, and
every limit in the product became a limit on the PRODUCT rather than on a
person:

    3/hour   password reset ... three per hour, for every customer combined
    5/minute auth ............ five logins a minute, across the whole user base
    3/minute auth ............ three a minute, shared

That is not a weak control, it is an inverted one. Legitimate people were
refused because of strangers, and anyone who wanted to lock every customer out
of the product only had to spend the shared bucket.

── WHY THE LAST ENTRY, NOT THE FIRST ───────────────────────────────────────

`X-Forwarded-For` is a list, appended to by each proxy it passes. The leftmost
entry is whatever the CLIENT sent, so trusting it hands the spoofer exactly the
control this is meant to take away: `X-Forwarded-For: 1.2.3.4` and every
attempt looks like a different person.

With one trusted hop in front — which is what Railway is — the RIGHTMOST entry
is the one that hop wrote, and it is the only one nobody upstream could forge:

    client sends nothing  ->  "203.0.113.7"                last = the caller
    client sends a lie    ->  "9.9.9.9, 203.0.113.7"       last = the caller

If a second proxy is ever put in front of this app, that assumption changes and
this function must change with it. `test_rate_limit_key.py` states the
assumption so it fails loudly rather than degrading quietly.

Deliberately NOT solved with `FORWARDED_ALLOW_IPS='*'`: that would make uvicorn
rewrite `request.client` globally, which silently changes every other reader of
it — audit rows, logs, anything added later — on the strength of an environment
variable that is invisible in the code and easy to lose in a redeploy. This is
narrower: the rate limiter's key, in git, with a test.
"""
from fastapi import Request
from slowapi import Limiter
from slowapi.util import get_remote_address


def client_ip(request: Request) -> str:
    """The caller's address as well as it can be known behind one proxy hop."""
    forwarded = request.headers.get("x-forwarded-for", "")
    if forwarded:
        # `split(",")[-1]`: the nearest trusted proxy appends its view of the
        # caller last. See the header for why the first entry is worthless.
        candidate = forwarded.split(",")[-1].strip()
        if candidate:
            return candidate
    # No header at all — a direct call, a health check, or a test client.
    return get_remote_address(request) or "unknown"


limiter = Limiter(key_func=client_ip)
