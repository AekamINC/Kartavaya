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

── AND ON 2026-08-30 A SECOND PROXY WAS PUT IN FRONT ───────────────────────

`api.kartavaya.com` went behind the Cloudflare proxy. There are now TWO hops:
Cloudflare sets `X-Forwarded-For: <caller>`, Railway appends Cloudflare's edge
address, and the rightmost entry stopped being the caller:

    via Cloudflare  ->  "203.0.113.7, 172.71.4.9"     last = CLOUDFLARE
    direct to app   ->  "203.0.113.7"                 last = the caller

The bug is the inverted control all over again, one layer up: every visitor
behind one Cloudflare edge shared a single bucket. Login is 5/minute, so a
handful of sign-ins from one city locked out everyone behind that edge, and
one abusive client could spend the bucket on purpose. Measured on production
by saturating through the proxy and then calling the origin directly inside
the same window — 429 through Cloudflare, 404 direct, i.e. two different keys.

⚠ **`CF-Connecting-IP` MUST NOT BE TRUSTED ON ITS OWN.** It is the obvious fix
and it is worse than the bug. The Railway hostname is still publicly
reachable, so anyone may call the origin directly and set that header to
whatever they like — earning a private bucket per forged value and removing
rate limiting altogether. A header from Cloudflare is only evidence if the
request actually came from Cloudflare.

So the test is on the HOP, not on the header: believe a Cloudflare header only
when the address that Railway itself observed — the rightmost entry, the one
nobody upstream can forge — is inside Cloudflare's published ranges. When it
is not, nothing changes and the rightmost entry is still the answer.

This keeps the property the one-hop version had: the value used is always
either written by a hop we trust, or vouched for by one.

Deliberately NOT solved with `FORWARDED_ALLOW_IPS='*'`: that would make uvicorn
rewrite `request.client` globally, which silently changes every other reader of
it — audit rows, logs, anything added later — on the strength of an environment
variable that is invisible in the code and easy to lose in a redeploy. This is
narrower: the rate limiter's key, in git, with a test.
"""
from ipaddress import ip_address, ip_network

from fastapi import Request
from slowapi import Limiter
from slowapi.util import get_remote_address

#: Cloudflare's published edge ranges — https://www.cloudflare.com/ips/
#:
#: Hardcoded rather than fetched: this module is imported at start-up and on
#: every request, and a limiter whose correctness depends on an outbound HTTP
#: call is a limiter that fails open the first time that call is slow. The list
#: changes rarely; `test_rate_limit_key.py` pins the shape, and if Cloudflare
#: ever adds a range the symptom is a return to the OLD behaviour for that
#: range — degraded, never bypassed.
_CLOUDFLARE_CIDRS = (
    "173.245.48.0/20", "103.21.244.0/22", "103.22.200.0/22", "103.31.4.0/22",
    "141.101.64.0/18", "108.162.192.0/18", "190.93.240.0/20", "188.114.96.0/20",
    "197.234.240.0/22", "198.41.128.0/17", "162.158.0.0/15", "104.16.0.0/13",
    "104.24.0.0/14", "172.64.0.0/13", "131.0.72.0/22",
    "2400:cb00::/32", "2606:4700::/32", "2803:f800::/32", "2405:b500::/32",
    "2405:8100::/32", "2a06:98c0::/29", "2c0f:f248::/32",
)
_CLOUDFLARE_NETS = tuple(ip_network(c) for c in _CLOUDFLARE_CIDRS)


def _is_cloudflare(addr: str) -> bool:
    """True when `addr` is one of Cloudflare's edge addresses.

    Anything unparseable is False. A malformed entry must never be mistaken for
    a trusted hop, because that is the direction that loses the control.
    """
    try:
        ip = ip_address(addr)
    except ValueError:
        return False
    return any(ip in net for net in _CLOUDFLARE_NETS)


def client_ip(request: Request) -> str:
    """The caller's address, through one trusted hop or two."""
    forwarded = request.headers.get("x-forwarded-for", "")
    parts = [p.strip() for p in forwarded.split(",") if p.strip()]
    if parts:
        # The rightmost entry is written by the hop nearest this app and is the
        # only one nobody upstream could forge. Everything below decides whether
        # that hop is the caller or Cloudflare — it never stops being trusted.
        last = parts[-1]
        if not _is_cloudflare(last):
            return last

        # Reached Railway FROM Cloudflare, so a Cloudflare header is now
        # evidence rather than an assertion by a stranger.
        cf = (request.headers.get("cf-connecting-ip") or "").strip()
        if cf:
            return cf

        # No CF-Connecting-IP: Cloudflare appends the address it saw, so the
        # caller is the entry before the edge.
        if len(parts) >= 2:
            return parts[-2]

        # Cloudflare, but nothing before it. Do not invent a caller — key on the
        # edge, which is the old behaviour and merely coarse, not unsafe.
        return last

    # No header at all — a direct call, a health check, or a test client.
    return get_remote_address(request) or "unknown"


limiter = Limiter(key_func=client_ip)
