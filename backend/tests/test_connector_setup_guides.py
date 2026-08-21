"""Every connector card must be able to explain how its app is created.

The failure this guards against is not a crash. It is a platform being added to
`connector_credentials.SPECS` — a form, a console link, a redirect URL — with no
word anywhere about creating the app that fills it, which is exactly the state
every card was in before `connector_setup.py`. That gap is invisible: the page
renders, the form saves, and only a first-time operator discovers there is
nothing to follow.

So the pairing is asserted rather than trusted, in both directions.
"""
import pytest

from services import connector_credentials as cc
from services import connector_setup as cs


def test_every_platform_has_a_guide():
    missing = [s.key for s in cc.SPECS if not cs.guide(s.key)]
    assert not missing, (
        "These platforms have a credentials form and no setup guide: "
        + ", ".join(missing)
        + ". Add one in services/connector_setup.py."
    )


def test_no_guide_for_a_platform_that_does_not_exist():
    """A guide for a removed platform is prose nothing renders."""
    orphans = [g.platform for g in cs.GUIDES if not cc.spec(g.platform)]
    assert not orphans, f"Guides with no platform: {', '.join(orphans)}"
    assert not (set(g.platform for g in cs.GUIDES) & cc.RETIRED_PLATFORMS)


@pytest.mark.parametrize("key", [s.key for s in cc.SPECS])
def test_guide_is_substantive(key):
    """A stub guide is worse than none — it looks answered."""
    g = cs.guide(key)
    assert len(g.steps) >= 3, f"{key}: a guide under three steps is a stub"
    assert all(step.strip() for step in g.steps)
    assert g.errors, f"{key}: no error is explained, which is the part that bites"


@pytest.mark.parametrize("key", [s.key for s in cc.SPECS])
def test_public_view_carries_the_short_steps(key):
    """The card renders from `public_view`. If the steps are not in it, the
    guide exists and nobody ever sees it."""
    view = cc.public_view(key, None)
    assert view["setup_steps"] == list(cs.guide(key).steps)


@pytest.mark.parametrize("key", [s.key for s in cc.SPECS])
def test_public_guide_is_json_shaped(key):
    g = cs.public_guide(key)
    assert g["platform"] == key
    assert isinstance(g["errors"], list)
    assert all({"says", "means"} == set(e) for e in g["errors"])
    assert all({"title", "body"} == set(s) for s in g["sections"])


def test_public_guide_is_empty_for_an_unknown_platform():
    assert cs.public_guide("myspace") == {}


def test_no_secret_leaks_into_a_guide():
    """Prose is written by hand and a guide is returned to the browser without
    a row behind it, so the redaction `public_view` gets by construction has to
    be asserted here instead."""
    for g in cs.GUIDES:
        blob = " ".join(g.steps + g.prerequisites + (g.gate,)).lower()
        for word in ("password:", "secret is:", "token is: "):
            assert word not in blob
