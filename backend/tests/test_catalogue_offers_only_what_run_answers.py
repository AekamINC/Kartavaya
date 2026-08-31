"""The metric menu must not list work the product then refuses.

── THE FINDING, SUITE 12.03 ON 2026-08-31 ──────────────────────────────────

`GET /api/v1/analytics/catalogue` is the "Add a metric…" picker
(`ViewGrid.AddWidget`). It offered **4 metrics `/run` refuses**, every one of
them `varta.*`, on an org that holds twelve active modules and NO
`module_subscriptions` row for `varta` at all:

    varta.sends          varta.delivery_rate
    varta.read_rate      varta.reply_rate

(The registry declares six `varta` metrics; the other two are `absent` and were
already filtered, which is why the count is exactly four.)

Pick one out of the dropdown and the widget answers 403 the moment it draws. A
menu that lists dishes the kitchen refuses is worse than a short menu: the
person picks one, gets an error they cannot act on, and learns nothing about
which module they would have had to buy.

── THE CAUSE: TWO GATES, AND THE WEAKER ONE DREW THE MENU ──────────────────

`/run` calls `require_module(m.module)`. `_reachable` called
`held_level(...) is not None`. Those are not the same question:

    held_level        does this PERSON hold a grant on this module?
                      → returns "admin" for ANY org owner/admin, unconditionally
    require_module    that, AND is the module active for the ORG, AND is the
                      subscription live?

An org admin therefore "reached" every module in the registry, including ones
their org has never bought.

── THE FIX, AND WHY IT IS NOT `require_module` IN A LOOP ───────────────────

The org half moved into `subscription.org_module_refusal`, which RETURNS the
refusal instead of raising it. `require_module` raises what it returns and
`_reachable(runnable=True)` hides what it names, so the menu and the door
cannot drift — there is one implementation.

Calling `require_module` itself in a loop was the obvious alternative and is
wrong: it runs the PLATFORM branch once per module, and `platform_audit_needed`
writes an audit row for every sensitive module a platform role reads. Twelve
rows per catalogue GET would bury the ~330 warn-severity rows the audit exists
for — the volume regression that function's own docstring argues against.

⚠ `runnable` is OPT-IN and only `/catalogue` takes it. `/report-sections`
argues its own case in its docstring for listing a register's NAME on
`held_level`, and that argument is untouched here.

MUTATION-PROVED 2026-08-31: dropping the `runnable` clause from `_reachable`,
and passing `runnable=False` at the call site, each turn
`test_a_module_the_org_has_not_bought_is_not_offered` and
`test_the_menu_and_the_door_agree_module_for_module` red.
"""
import asyncio

import pytest

from routers import analytics as ax

ORG = "00000000-0000-0000-0000-0000000000aa"
USER = {"user_id": "user_admin001"}

#: The reference org's shape on 2026-08-31: twelve modules bought, `varta` not
#: among them. Written as the org's own list rather than "everything except
#: varta" so a new module defaults to NOT offered — the direction this defect
#: went wrong in.
BOUGHT = frozenset({
    "dristi", "esign", "ganit", "graha", "kray", "manav",
    "pahchan", "prachar", "sahayak", "sanvaad", "vetana", "vikray",
})


def run(coro):
    return asyncio.run(coro)


class RecordingPool:
    """Answers nothing. Every question this file cares about is monkeypatched
    at the seam above it, so a pool that returned real-looking rows would only
    make the tests depend on SQL they are not about."""

    async def fetch(self, sql, *a):
        return []

    async def fetchrow(self, sql, *a):
        return None

    async def fetchval(self, sql, *a):
        return 0


@pytest.fixture
def pool(monkeypatch):
    p = RecordingPool()

    async def _get_pool():
        return p
    monkeypatch.setattr(ax, "get_pool", _get_pool)
    return p


@pytest.fixture
def org_admin_everywhere(monkeypatch):
    """The person half says yes to everything — which is what an org admin
    genuinely gets from `held_level`, and is the whole reason the org half has
    to be asked separately."""
    async def _held(pool_, user_id, org_id, code):
        return "admin"
    monkeypatch.setattr(ax, "held_level", _held)


@pytest.fixture
def org_owns(monkeypatch):
    """The org half, answering from `BOUGHT`. Records what it was asked, so a
    test can tell "refused" from "never consulted"."""
    asked = []

    async def _refusal(pool_, org_id, code):
        asked.append(code)
        if code in BOUGHT:
            return None
        from middleware.subscription import ModuleRefusal
        return ModuleRefusal(f"Module '{code}' is not active. "
                             "Contact your administrator to activate it.",
                             stage="module_inactive", module_code=code)
    monkeypatch.setattr(ax, "org_module_refusal", _refusal)
    return asked


def modules_offered(out):
    return {m["module"] for m in out["metrics"]}


def keys_offered(out):
    return {m["key"] for m in out["metrics"]}


# ── the defect ──────────────────────────────────────────────────────────────

def test_a_module_the_org_has_not_bought_is_not_offered(
        pool, org_admin_everywhere, org_owns):
    """THE DEFECT. RED without `runnable=True`: every `varta` metric is listed
    to an org admin whose org has no varta subscription."""
    out = run(ax.catalogue(user=USER, org_id=ORG))
    assert "varta" not in modules_offered(out), (
        "the picker offers varta metrics to an org that has not bought varta — "
        "every one of them 403s the moment the widget draws")


def test_the_four_metrics_12_03_named_are_gone(
        pool, org_admin_everywhere, org_owns):
    """The finding by name, so a regression says what came back."""
    offered = keys_offered(out := run(ax.catalogue(user=USER, org_id=ORG)))
    for key in ("varta.sends", "varta.delivery_rate",
                "varta.read_rate", "varta.reply_rate"):
        assert key not in offered, f"{key} is back in the menu"
    assert out["withheld_count"] == len(ax.REGISTRY) - len(out["metrics"])


def test_the_menu_and_the_door_agree_module_for_module(
        pool, org_admin_everywhere, org_owns):
    """The property, stated once: nothing is offered that the org half refuses.

    Asserted over whatever the registry holds rather than over a list of
    module names, so a metric declared for a thirteenth module is covered on
    the day it is written.
    """
    out = run(ax.catalogue(user=USER, org_id=ORG))
    for module in modules_offered(out) - ax.UNGATED_MODULES:
        assert module in BOUGHT, (
            f"{module} is on the menu and the org has not bought it")


# ── the other direction, which a careless fix breaks ────────────────────────

def test_what_the_org_DOES_own_is_still_offered(
        pool, org_admin_everywhere, org_owns):
    """A gate that hides everything also "fixes" the defect. This is the half
    that says the menu is still a menu."""
    offered = modules_offered(run(ax.catalogue(user=USER, org_id=ORG)))
    for module in ("ganit", "graha"):
        assert module in offered, f"{module} is bought and active but withheld"


def test_core_is_never_gated(pool, org_admin_everywhere, org_owns):
    """`UNGATED_MODULES` — org membership is core PM's whole entitlement, and
    no `module_subscriptions` row for it will ever exist. Asking the org half
    about it would refuse every org its own task counts."""
    out = run(ax.catalogue(user=USER, org_id=ORG))
    assert "core" in modules_offered(out)
    assert "core" not in org_owns, (
        "the org gate was consulted for `core`, which has no row to find")


def test_the_person_half_is_still_asked(pool, monkeypatch, org_owns):
    """Adding the org half must not REPLACE the grant check.

    Without this, a fix that swapped one gate for the other would pass every
    assertion above while handing a Viewer-less member the whole catalogue.
    """
    async def _held(pool_, user_id, org_id, code):
        return None
    monkeypatch.setattr(ax, "held_level", _held)
    out = run(ax.catalogue(user=USER, org_id=ORG))
    assert modules_offered(out) == {"core"}


def test_a_paused_subscription_empties_the_menu(pool, org_admin_everywhere,
                                                monkeypatch):
    """The org half's other refusal stage. `/run` refuses everything when the
    subscription is paused, so the menu must be empty rather than full of
    buttons that all fail the same way."""
    from middleware.subscription import ModuleRefusal

    async def _paused(pool_, org_id, code):
        return ModuleRefusal("Your subscription is paused.",
                             stage="subscription", module_code=code)
    monkeypatch.setattr(ax, "org_module_refusal", _paused)
    out = run(ax.catalogue(user=USER, org_id=ORG))
    assert modules_offered(out) == {"core"}
