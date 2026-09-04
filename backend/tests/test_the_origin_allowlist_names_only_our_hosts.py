"""The CORS allowlist, and the two ways it silently stops being one.

Nothing tested the origin allowlist before this file — `grep -l DEFAULT_ORIGINS
tests/` returned nothing on 2026-09-04. That is worth saying plainly, because
`allow_credentials=True` is set on the same middleware: a permitted origin may
READ responses that carried the caller's credentials. The list is the control.

Two failures put a host on it that should not be there, and neither one edits
the list:

  1. **A name we do not own.** `kartavya.com` — the misspelling, one letter
     short of `kartavaya.com` — sat in `DEFAULT_ORIGINS` three times until
     2026-09-04. Measured that day: it serves an nginx parking page titled
     "Kartavya.com is for sale - Premium Domain". It is not this company's
     domain and anyone may buy it.

     It was NOT exploitable, and the honest severity is the undramatic one:
     the `session_token` cookie is `SameSite=Lax`, which a browser will not
     attach to a cross-site fetch, and `COOKIE_DOMAIN` is unset so the cookie
     is host-only on the API. Auth is otherwise a Bearer token in
     `localStorage`, which no other origin can read. Both mitigations are one
     config change from gone, which is why the entries went rather than being
     annotated.

  2. **A prefix match.** `_ALLOWED_ORIGIN_RE` is passed as
     `allow_origin_regex` and is UNANCHORED. Starlette applies it with
     `fullmatch`, so `https://kartavaya.com.attacker.example` is refused —
     verified against the live production API on 2026-09-04, which returned no
     `access-control-allow-origin` for it. Under `re.match` that same string
     matches `https://([a-z0-9-]+\\.)?kartavaya\\.com` as a PREFIX and the
     attacker's host is allowed with credentials. Starlette used `match` in
     older releases. The tests below drive the real app rather than reading the
     pattern, so a library downgrade, a resolver change or an added `.*` turns
     them red instead of turning the allowlist into a suggestion.

And a third, which is the same failure with a delay fuse:

  3. **A name that is ours only until somebody tidies up.** Seven
     `kartavya-*.vercel.app` origins were on this list, and unlike the
     `kartavaya.com` entries they were ENFORCEMENT — no regex covered them, so
     production really did return
     `access-control-allow-origin: https://kartavya.vercel.app`. Two of the
     seven were UNSCOPED Vercel project names carrying no team suffix, so
     whoever holds the project holds the origin. On 2026-09-04 that was still
     this account — and `kartavya.vercel.app` served a bare "Create Next App"
     scaffold, not this product. Delete that project and the name frees up for
     any Vercel account to claim, inheriting a credentialed grant on this API.

     The trigger is not an attack. It is housekeeping.

     All seven went on 2026-09-04, together with the three Vercel alternatives
     in the regex, because Vercel no longer serves this product at all: the
     frontend is Cloudflare Pages, `vercel.json` and `.vercel-trigger` are
     deleted, and no workflow deploys there. `_VERCEL_PREVIEW_RE` was renamed
     `_ALLOWED_ORIGIN_RE` in the same change — three of its four alternatives
     were Vercel patterns, but the only one that mattered in production was the
     `kartavaya.com` one, and a name should say what a thing is for.

⚠ The `vercel.app` tests below are written against the SUFFIX, not against the
seven names that were removed. Listing the names would only assert that the
past stayed deleted; a rule about the suffix also catches the eighth.
"""

import re
from urllib.parse import urlsplit

import pytest

import server


# The domain the company owns. One letter longer than the one it is mistyped as.
REAL = "kartavaya.com"
TYPO = "kartavya.com"


def _host(origin: str) -> str:
    """The host of an origin, lowercased, port stripped."""
    return urlsplit(origin).hostname or ""


def _is_under(host: str, domain: str) -> bool:
    """True when `host` IS `domain` or a subdomain of it.

    A substring test would be wrong in both directions, which is the whole
    reason this helper exists rather than an `in`: `kartavya.com` is not a
    substring of `kartavaya.com` (the letters diverge at `kartav|a` vs
    `kartav|y`), so a substring test would happen to work here and quietly stop
    working for the next near-miss. And `evil-kartavaya.com` CONTAINS
    `kartavaya.com` while being an entirely different registrable domain.
    """
    return host == domain or host.endswith("." + domain)


# ── The list ──────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("origin", server.ALLOWED_ORIGINS)
def test_no_allowlist_entry_is_under_the_misspelled_domain(origin):
    assert not _is_under(_host(origin), TYPO), (
        f"{origin!r} is under {TYPO}, which this company does not own — it "
        f"serves a domain-for-sale page. The domain is {REAL}."
    )


def test_the_real_domain_is_on_the_allowlist():
    """Anti-vacuity floor for the test above.

    Without this, emptying `DEFAULT_ORIGINS` — or renaming the constant — makes
    every parametrised case above vanish and the file reports green over
    nothing at all. Zero parametrised cases is a pass, not a failure.
    """
    hosts = {_host(o) for o in server.ALLOWED_ORIGINS}
    assert REAL in hosts
    assert f"www.{REAL}" in hosts
    assert f"app.{REAL}" in hosts


@pytest.mark.parametrize("origin", server.ALLOWED_ORIGINS)
def test_no_allowlist_entry_is_a_vercel_host(origin):
    """Vercel does not serve this product, and two of the seven that were here
    were unscoped project names anyone could claim once the project is deleted.

    ⚠ Written against the SUFFIX rather than the seven names that went, because
    a test that lists them only asserts the past stayed deleted. This one also
    fails on the eighth.

    ⚠ AND IT COVERS `CORS_ORIGINS` TOO, which is the half a commit cannot
    reach. `ALLOWED_ORIGINS` is `DEFAULT_ORIGINS + _extra`, and `_extra` is the
    environment variable — on 2026-09-04 production's held only `kartavaya.com`
    hosts but STAGING's still carried
    `kartavya-git-staging-kevalvshah03-6145s-projects.vercel.app`, which no
    edit to this file can remove. Parametrising over `ALLOWED_ORIGINS` rather
    than `DEFAULT_ORIGINS` means a deploy carrying that variable fails here.
    """
    assert not _host(origin).endswith(".vercel.app"), (
        f"{origin!r} is a Vercel host. Vercel no longer serves this product. "
        f"If previews come back, use the TEAM-SCOPED form "
        f"(<project>-<something>-<team-slug>.vercel.app), never a bare project "
        f"name — a bare name is claimable by anyone once the project is deleted."
    )


@pytest.mark.parametrize("origin", [
    "https://kartavya.vercel.app",
    "https://kartavya-aekam.vercel.app",
    "https://kartavya-kevalvshah03-6145s-projects.vercel.app",
    "https://kartavaya-git-main-kevalvshah03-6145s-projects.vercel.app",
])
def test_the_regex_matches_no_vercel_host(origin):
    """The regex carried three Vercel alternatives until 2026-09-04.

    The last case is CORRECTLY spelled on purpose: the point is not the typo.
    """
    assert _RE.fullmatch(origin) is None


def test_the_allowlist_carries_no_wildcard():
    """`*` with `allow_credentials=True` is the one combination that makes
    every other assertion in this file pointless."""
    assert "*" not in server.ALLOWED_ORIGINS


def test_every_allowlist_entry_is_a_bare_origin():
    """A trailing slash or a path never matches anything, and never says so.

    The Origin header a browser sends is scheme + host + port, never a path.
    `"https://app.kartavaya.com/"` on this list is not a stricter rule than
    `"https://app.kartavaya.com"` — it is a rule that matches no request ever
    sent, and the symptom is the product looking dead from one host with no
    server error to point at.
    """
    for origin in server.ALLOWED_ORIGINS:
        parts = urlsplit(origin)
        assert parts.scheme, origin
        assert parts.netloc, origin
        assert parts.path == "", f"{origin!r} has a path; an Origin never does"
        assert parts.query == "" and parts.fragment == "", origin


# ── The regex ─────────────────────────────────────────────────────────────────

_RE = re.compile(server._ALLOWED_ORIGIN_RE)


@pytest.mark.parametrize("origin", [
    f"https://{TYPO}",
    f"https://www.{TYPO}",
    f"https://public.{TYPO}",
    f"https://app.{TYPO}",
])
def test_the_regex_matches_nothing_under_the_misspelled_domain(origin):
    assert _RE.fullmatch(origin) is None


def test_the_regex_matches_the_real_domain(origin=f"https://app.{REAL}"):
    """Anti-vacuity floor: a regex that matches nothing passes every test above.

    This is not hypothetical here — the regex is the thing that ACTUALLY
    decides for `kartavaya.com`. It matches every subdomain, which is why the
    three `kartavaya` entries on the list above are documentation rather than
    enforcement. Break the regex and the product loses CORS on every host it is
    served from.
    """
    assert _RE.fullmatch(origin) is not None
    assert _RE.fullmatch(f"https://{REAL}") is not None


# ── What the running application actually answers ─────────────────────────────
#
# The tests above read the configuration. These drive the app, because the
# question that matters is not what the pattern says but what the middleware
# does with it — and the gap between those two is exactly the `match` /
# `fullmatch` bug.

async def _acao(api_client, origin: str):
    """The `access-control-allow-origin` the app returns for `origin`, or None.

    `None` is a refusal: a browser with no ACAO header refuses to hand the
    response body to the calling page.
    """
    resp = await api_client.get("/api/health", headers={"Origin": origin})
    return resp.headers.get("access-control-allow-origin")


async def test_a_real_host_is_allowed(api_client):
    """Anti-vacuity floor for every refusal test below.

    An app that refuses EVERY origin passes all of them. This is the assertion
    that makes those refusals mean something.
    """
    assert await _acao(api_client, f"https://app.{REAL}") == f"https://app.{REAL}"


async def test_the_misspelled_domain_is_refused(api_client):
    """The ratchet on the 2026-09-04 removal. Put the entry back, this is red."""
    assert await _acao(api_client, f"https://{TYPO}") is None
    assert await _acao(api_client, f"https://www.{TYPO}") is None


@pytest.mark.parametrize("origin", [
    # The two UNSCOPED project names — the ones a stranger inherits the day the
    # Vercel project is deleted. These are the reason the removal happened.
    "https://kartavya.vercel.app",
    "https://kartavya-aekam.vercel.app",
    # A team-scoped one, and the correctly-spelled preview pattern. Dead weight
    # rather than exposure, but Vercel serves nothing here now.
    "https://kartavya-kevalvshah03-6145s-projects.vercel.app",
    "https://kartavaya-git-main-kevalvshah03-6145s-projects.vercel.app",
])
async def test_a_vercel_host_is_refused_by_the_running_app(api_client, origin):
    """The ratchet on the 2026-09-04 removal, at the surface that decides."""
    assert await _acao(api_client, origin) is None


@pytest.mark.parametrize("origin", [
    # A SUFFIX of the real domain. Refused under `fullmatch`, ALLOWED under
    # `match` — this is the whole reason these tests drive the app.
    f"https://{REAL}.attacker.example",
    f"https://app.{REAL}.attacker.example",
    # A PREFIX of it. `evil-kartavaya.com` is a different registrable domain
    # that contains the real one as a substring.
    f"https://evil-{REAL}",
    f"https://x{REAL}",
])
async def test_a_lookalike_of_the_real_domain_is_refused(api_client, origin):
    assert await _acao(api_client, origin) is None


async def test_credentials_are_allowed_which_is_why_the_list_is_the_control(api_client):
    """States the stake the rest of the file is protecting.

    Asserted against the configured middleware rather than a response header,
    because Starlette emits `access-control-allow-credentials` on every CORS
    response whether or not the origin was permitted — reading it back off a
    refusal proves nothing.
    """
    cors = [m for m in server.app.user_middleware
            if m.cls.__name__ == "CORSMiddleware"]
    assert len(cors) == 1, "one CORS middleware, or this test is reading the wrong one"
    assert cors[0].kwargs["allow_credentials"] is True
