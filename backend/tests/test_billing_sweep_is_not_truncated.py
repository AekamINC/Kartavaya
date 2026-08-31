"""The nightly billing sweep: who it bills, and what it does when one org fails.

── TWO DEFECTS IN `advance_periods`, FOUND 2026-08-31 ─────────────────────────

**1 · IT BILLED DEACTIVATED ORGANISATIONS.** The query joined `organisations`
already — it had the row in hand — and never looked at `is_active`.
`scheduler._for_each_org` states the rule for every other cron in the product
("A deactivated organisation should not have invoices generated for it") and
filters on it. This one did not.

**2 · ONE ORG'S FAILURE SILENTLY TRUNCATED THE SWEEP.** The loop had no guard.
A single raise aborted the run; because each UPDATE commits on its own, the orgs
already advanced STAYED advanced while every org after the failure was silently
not — and the cron answered 500 with no record of how far it got, so a re-run
would advance the first group a SECOND time. This is the codebase's dominant bug
class wearing a different hat: not a swallowed exception, but a partial result
indistinguishable from a complete one.

── ON EXPOSURE, STATED HONESTLY ───────────────────────────────────────────────

Measured live 2026-08-31: **0 inactive organisations**, 4 subscriptions, all
`active`, and a UNIQUE index on `subscriptions.org_id`. So defect 1 is LATENT
and the `WHERE org_id` / `WHERE org_id AND status='active'` change is a no-op
today. Neither is written up as a live loss, and the tests below assert the
GUARDS rather than comparing live numbers — a comparison would pass right now
for want of an inactive org, which is not the same as passing.

Defect 2 is NOT latent: it needs only one raise, and nothing about the current
data prevents one.
"""
import inspect

import pytest

from services import billing_cycle


class FakePool:
    """Enough asyncpg surface for `advance_periods`, with a scripted failure.

    `fail_on` is a set of org_ids whose UPDATE raises, which is the only way to
    exercise the isolation: the real failure is a lock timeout or a bad row, and
    neither can be provoked from a live database without breaking it.
    """

    def __init__(self, rows, fail_on=frozenset()):
        self._rows = rows
        self._fail_on = set(fail_on)
        self.updated = []
        self.update_sql = []

    async def fetch(self, *_a, **_k):
        return self._rows

    async def execute(self, sql, *args):
        org_id = args[0]
        self.update_sql.append(sql)
        if org_id in self._fail_on:
            raise RuntimeError(f"lock timeout on {org_id}")
        self.updated.append(org_id)
        return "UPDATE 1"


def _row(org_id, anchor=1):
    from datetime import date
    return {"org_id": org_id, "billing_cycle": "monthly",
            "current_period_end": date(2026, 8, 1), "billing_anchor_day": anchor}


# ── 1 · a deactivated organisation is not billed ────────────────────────────

def test_the_sweep_filters_inactive_organisations():
    sql = inspect.getsource(billing_cycle.advance_periods)
    sql = "\n".join(l for l in sql.splitlines() if not l.lstrip().startswith("#"))
    assert "is_active IS NOT FALSE" in sql, (
        "the billing sweep advances periods for DEACTIVATED organisations; "
        "`scheduler._for_each_org` states the opposite rule for every other cron"
    )


def test_the_active_filter_keeps_legacy_null_rows():
    """`IS NOT FALSE`, never `= TRUE`. Getting this backwards stops billing every
    organisation whose row predates the column — a worse and much quieter
    failure than the one being fixed, and one that looks like a tightening."""
    sql = inspect.getsource(billing_cycle.advance_periods)
    assert "o.is_active = TRUE" not in sql and "o.is_active=TRUE" not in sql


# ── 2 · one org's failure does not truncate the sweep ───────────────────────

@pytest.mark.asyncio
async def test_a_failing_org_does_not_stop_the_others():
    """The defect: org B raising meant orgs C and D were never advanced."""
    pool = FakePool([_row("A"), _row("B"), _row("C"), _row("D")], fail_on={"B"})
    out = await billing_cycle.advance_periods(pool)
    assert pool.updated == ["A", "C", "D"], (
        "a single failing organisation truncated the sweep; every org after it "
        "was silently skipped while the ones before it stayed advanced"
    )
    assert out["advanced"] == 3
    assert out["checked"] == 4


@pytest.mark.asyncio
async def test_the_failure_is_REPORTED_and_not_swallowed():
    """Isolating a failure and reporting it are different things. Without this,
    the caller reads {"advanced": 3} and a partial sweep looks complete."""
    pool = FakePool([_row("A"), _row("B")], fail_on={"B"})
    out = await billing_cycle.advance_periods(pool)
    assert "failed" in out, "a partial sweep returned a clean result"
    assert "B" in out["failed"]
    assert "RuntimeError" in out["failed"]["B"], "the failure gives no cause"


@pytest.mark.asyncio
async def test_a_clean_sweep_reports_NO_failed_key():
    """Anti-vacuity for the two above: if `failed` were always present the
    caller's `if failed:` would fail every healthy night, and if it were never
    present the tests above would be checking nothing."""
    pool = FakePool([_row("A"), _row("B")])
    out = await billing_cycle.advance_periods(pool)
    assert "failed" not in out
    assert out == {"advanced": 2, "checked": 2}


@pytest.mark.asyncio
async def test_the_update_is_scoped_to_the_active_subscription():
    """The SELECT filters `status='active'`; the UPDATE targeted `org_id` alone.

    A UNIQUE index on `subscriptions.org_id` makes these the same row TODAY, so
    this is a no-op — it is asserted because the day an org is allowed a second
    subscription row, the unscoped form rewrites a cancelled plan's period dates
    with no error and no log line.
    """
    pool = FakePool([_row("A")])
    await billing_cycle.advance_periods(pool)
    assert "status = 'active'" in pool.update_sql[0], (
        "the UPDATE is scoped by org_id alone while the SELECT that chose the "
        "row filtered on status"
    )


# ── 3 · the cron surfaces the verdict ───────────────────────────────────────

@pytest.fixture
def cron(monkeypatch):
    """`/cron/billing` with its secret check and both sweeps stubbed.

    ⚠ THIS WAS A SOURCE ASSERTION AND MUTATION TESTING KILLED IT. It checked
    that the function's source contained "failed" and "HTTPException"; replacing
    the whole verdict with `failed = None` left both strings in place, so the
    test passed over a fully reverted guard. A grep is not a behaviour. The only
    thing that settles this is calling the endpoint and seeing what it raises.
    """
    from routers import client_billing, scheduler
    from services import billing_cycle as bc

    async def _no_secret(_s):
        return None

    async def _sweep(*_a, **_k):
        return {"created": 0}

    monkeypatch.setattr(scheduler, "_verify_cron", _no_secret)
    monkeypatch.setattr(client_billing, "sweep_client_auto_invoices", _sweep)

    def _with(periods):
        async def _cycle(*_a, **_k):
            return {"date": "2026-08-31", "periods": periods, "trials": {"expired": 0}}
        monkeypatch.setattr(bc, "run_billing_cycle", _cycle)
        return scheduler.run_billing
    return _with


@pytest.mark.asyncio
async def test_the_cron_fails_the_tick_when_any_org_failed(cron):
    """A tick that advanced 3 orgs and failed 40 must not answer 200."""
    from fastapi import HTTPException

    run = cron({"advanced": 3, "checked": 43, "failed": {"B": "RuntimeError: boom"}})
    with pytest.raises(HTTPException) as ei:
        await run(x_cron_secret="s")
    assert ei.value.status_code == 500
    assert ei.value.detail["failed_orgs"] == 1
    assert ei.value.detail["advanced"] == 3, (
        "the failure must still carry how far the sweep got — without it an "
        "operator cannot tell whether a re-run would double-advance"
    )


@pytest.mark.asyncio
async def test_a_clean_night_still_answers_normally(cron):
    """Anti-vacuity: if it raised unconditionally the test above proves nothing
    and every healthy night would page somebody."""
    run = cron({"advanced": 2, "checked": 2})
    out = await run(x_cron_secret="s")
    assert out["periods"]["advanced"] == 2
    assert "client_auto_invoices" in out
