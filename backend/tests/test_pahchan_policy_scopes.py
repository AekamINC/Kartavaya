"""One attendance policy per org was one policy too few.

`staging.pahchan_policy` is keyed on `org_id` and nothing else, so a firm had a
single attendance policy for everybody. One radius for every site is the
clearest failure of that: 150m is generous around a city office and useless
around a factory compound, and widening it for the compound widens it for the
office too. The same goes for every figure in the row — a shift that starts at
09:00 for staff and 07:00 for plant, a grace period that is ten minutes for
salaried people and zero for contractors on an hourly rate.

Migration 196 adds `staging.pahchan_policy_overrides` and four scopes, most
specific wins:

    org  →  site  →  category  →  employee

`category` is `manav_employees.employment_type`, which already exists and
already separates the people whose rules genuinely differ — measured live
2026-08-22: 69 full_time, 15 intern, 14 contract. A second taxonomy would mean
an HR admin maintaining two classifications of the same people.

── THE THREE PROPERTIES THIS FILE EXISTS FOR ───────────────────────────────

1 · AN ORG WITH NO OVERRIDES RESOLVES EXACTLY WHAT IT RESOLVED BEFORE. That is
    what made 196 additive in effect and not merely in form, and it is the first
    test below.

2 · OVERRIDES MERGE KEY BY KEY, NEVER WHOLESALE. A full policy copy per scope
    would freeze every other setting at the value it had when the override was
    written, so an org that later shortened its grace period firm-wide would
    find one site silently keeping the old one — screen showing the new value,
    punch judged by the old.

3 · RETENTION AND REPORTING STAY ORG-LEVEL. Retention is a DPDP promise made to
    every person in the organisation, in ONE notice quoting ONE number, and
    `_retention` exists because a notice quoting a figure that was not in force
    has already shipped here. A per-employee window would make that notice wrong
    for somebody BY CONSTRUCTION, and they would be the last to know.

And the standing rule that outranks all three: 07 §2, nothing blocks a punch.
That applies to the code deciding the rules as much as to the code applying
them, so an unreadable override or a scope naming a deleted site is SKIPPED and
the level above stands — never a 500 on the punch path.
"""
import asyncio
import inspect
import json
from unittest.mock import AsyncMock, MagicMock

import pytest

from routers import pahchan
from routers.pahchan import POLICY_OVERRIDABLE_KEYS, _resolve_policy


ORG = "00000000-0000-0000-0000-0000000000aa"
SITE = "00000000-0000-0000-0000-0000000000bb"
EMP = {"id": "00000000-0000-0000-0000-0000000000cc",
       "name": "Asha", "employment_type": "contract"}

BASE = {
    "org_id": ORG,
    "default_radius_m": 150,
    "grace_minutes": 10,
    "allow_outside_geofence": True,
    "accuracy_flag_threshold_m": 100,
    "punch_photo_retention_days": 90,
    "record_retention_years": 3,
    "standard_hours_per_day": 8,
    "overtime_enabled": False,
}


def _pool(overrides_rows):
    """A pool that answers the policy row and the override rows, and nothing else."""
    pool = MagicMock()
    pool.fetchrow = AsyncMock(return_value=dict(BASE))
    pool.fetch = AsyncMock(return_value=overrides_rows)
    return pool


def _row(kind, ref, overrides, *, as_text=False):
    return {
        "scope_kind": kind,
        "scope_ref": ref,
        "overrides": json.dumps(overrides) if as_text else overrides,
    }


def _resolve(rows, **kw):
    return asyncio.run(_resolve_policy(_pool(rows), ORG, **kw))


# ── 1 · an org with no overrides is unchanged ───────────────────────────────

def test_no_overrides_resolves_the_org_policy_untouched():
    assert _resolve([], employee=EMP, site_id=SITE) == BASE


def test_no_overrides_does_not_even_look_at_the_employee():
    """The early return matters: this runs on every punch."""
    assert _resolve([]) == BASE


# ── 2 · most specific wins, key by key ──────────────────────────────────────

def test_a_site_override_replaces_only_the_key_it_names():
    out = _resolve([_row("site", SITE, {"default_radius_m": 400})],
                   employee=EMP, site_id=SITE)
    assert out["default_radius_m"] == 400
    # Everything else is exactly the org's.
    assert out["grace_minutes"] == BASE["grace_minutes"]
    assert out["accuracy_flag_threshold_m"] == BASE["accuracy_flag_threshold_m"]


def test_a_category_override_beats_the_site():
    out = _resolve([
        _row("site", SITE, {"grace_minutes": 5}),
        _row("category", "contract", {"grace_minutes": 0}),
    ], employee=EMP, site_id=SITE)
    assert out["grace_minutes"] == 0


def test_an_employee_override_beats_everything():
    out = _resolve([
        _row("site", SITE, {"grace_minutes": 5}),
        _row("category", "contract", {"grace_minutes": 0}),
        _row("employee", EMP["id"], {"grace_minutes": 20}),
    ], employee=EMP, site_id=SITE)
    assert out["grace_minutes"] == 20


def test_the_levels_compose_rather_than_replace_each_other():
    """The site sets the radius, the category sets the grace, the employee sets
    the hours — and all three hold at once."""
    out = _resolve([
        _row("site", SITE, {"default_radius_m": 400}),
        _row("category", "contract", {"grace_minutes": 0}),
        _row("employee", EMP["id"], {"standard_hours_per_day": 6}),
    ], employee=EMP, site_id=SITE)
    assert out["default_radius_m"] == 400
    assert out["grace_minutes"] == 0
    assert out["standard_hours_per_day"] == 6
    assert out["allow_outside_geofence"] is True     # nobody touched it


# ── The levels that do not apply ────────────────────────────────────────────

def test_an_override_for_a_different_site_is_ignored():
    out = _resolve([_row("site", "other-site", {"default_radius_m": 400})],
                   employee=EMP, site_id=SITE)
    assert out["default_radius_m"] == 150


def test_an_override_for_a_different_category_is_ignored():
    out = _resolve([_row("category", "full_time", {"grace_minutes": 0})],
                   employee=EMP, site_id=SITE)
    assert out["grace_minutes"] == 10


def test_a_punch_with_no_site_skips_the_site_level():
    """Location off entirely, or nowhere near a site. The level cannot match and
    must not be matched against an empty string."""
    out = _resolve([_row("site", SITE, {"default_radius_m": 400})], employee=EMP)
    assert out["default_radius_m"] == 150


def test_an_employee_with_no_category_skips_the_category_level():
    out = _resolve([_row("category", "contract", {"grace_minutes": 0})],
                   employee={"id": EMP["id"], "name": "Asha", "employment_type": None})
    assert out["grace_minutes"] == 10


def test_no_employee_at_all_still_resolves():
    """`_employee_for` returns None for most accounts on this database — the
    employee↔login link is the missing join. A policy lookup must not need it."""
    out = _resolve([_row("employee", EMP["id"], {"grace_minutes": 0})])
    assert out["grace_minutes"] == 10


# ── 3 · retention and reporting cannot be scoped ────────────────────────────

@pytest.mark.parametrize("key", [
    "punch_photo_retention_days", "reference_photo_grace_days",
    "record_retention_years", "report_recipients",
    "report_daily", "report_weekly", "report_monthly",
])
def test_retention_and_reporting_are_not_overridable(key):
    assert key not in POLICY_OVERRIDABLE_KEYS


def test_a_retention_key_that_somehow_reached_a_row_is_still_ignored():
    """The CHECK constraint stops the row existing. This is the second door: a
    key that WAS overridable and is not any more must stop applying rather than
    keep applying invisibly."""
    out = _resolve([_row("employee", EMP["id"],
                         {"punch_photo_retention_days": 5, "grace_minutes": 0})],
                   employee=EMP)
    assert out["punch_photo_retention_days"] == 90
    assert out["grace_minutes"] == 0


def test_the_allowlist_and_the_constraint_name_the_same_keys():
    """Two places, one list. The constraint stops a bad row existing whatever
    writes it; the Python list gives the person a sentence instead of a
    constraint name."""
    from pathlib import Path

    sql = (Path(__file__).resolve().parents[1]
           / "migrations" / "196_pahchan_policy_scopes.sql").read_text(encoding="utf-8")
    block = sql[sql.index("pahchan_policy_overrides_allowed_keys_ck"):][:600]
    for key in ("punch_photo_retention_days", "reference_photo_grace_days",
                "record_retention_years", "report_recipients",
                "report_daily", "report_weekly", "report_monthly"):
        assert f"'{key}'" in block, f"the constraint no longer refuses {key}"


# ── Nothing here can stop somebody clocking in ──────────────────────────────

def test_an_unreadable_override_is_skipped_rather_than_raised():
    """07 §2 applies to the code that decides the rules, not only to the code
    that applies them."""
    out = _resolve([{"scope_kind": "site", "scope_ref": SITE,
                     "overrides": "{not json"}], site_id=SITE)
    assert out == BASE


def test_a_json_string_override_is_parsed():
    """asyncpg hands jsonb back as a str on some paths."""
    out = _resolve([_row("site", SITE, {"default_radius_m": 400}, as_text=True)],
                   site_id=SITE)
    assert out["default_radius_m"] == 400


def test_an_override_that_is_not_an_object_is_skipped():
    out = _resolve([{"scope_kind": "site", "scope_ref": SITE, "overrides": [1, 2]}],
                   site_id=SITE)
    assert out == BASE


def test_the_resolver_raises_nothing():
    src = inspect.getsource(_resolve_policy)
    assert "raise" not in src
    assert "HTTPException" not in src


# ── The punch path uses it, and in the right order ──────────────────────────

def test_the_punch_path_resolves_the_policy_after_the_site():
    """Reading the policy first would resolve the ORG-wide accuracy threshold
    and then judge the punch against a site that overrides it."""
    src = inspect.getsource(pahchan.create_punch)
    assert "_resolve_policy(" in src
    assert src.index("_nearest_site") < src.index("_resolve_policy(")


def test_the_me_tab_shows_this_persons_own_rules():
    """A screen whose entire purpose is "the rule you are judged by" is worse
    than nothing if it states a rule somebody else is judged by."""
    src = inspect.getsource(pahchan.my_punches)
    assert "_resolve_policy(pool, org_id, employee=employee)" in src


def test_the_effective_endpoint_runs_the_same_merge_as_the_punch_path():
    """Not a second implementation. Two merges is how the screen and the engine
    come to disagree about what somebody's grace period is."""
    src = inspect.getsource(pahchan.effective_policy)
    assert "_resolve_policy(" in src


# ── The write path ──────────────────────────────────────────────────────────

def test_the_scope_write_refuses_a_retention_key_with_a_sentence():
    with pytest.raises(Exception) as exc:
        pahchan._validated_overrides({"punch_photo_retention_days": 5})
    assert "privacy notice" in str(getattr(exc.value, "detail", exc.value))


def test_the_scope_write_refuses_an_empty_override():
    with pytest.raises(Exception) as exc:
        pahchan._validated_overrides({})
    assert "change something" in str(getattr(exc.value, "detail", exc.value))


def test_a_scope_naming_something_that_does_not_exist_is_refused_on_create():
    """The resolver treats an orphan as matching nothing, which is right for a
    site deleted AFTER the override was written and quite wrong as a way to
    CREATE one: an override that has never applied is a setting somebody
    believes is in force."""
    src = inspect.getsource(pahchan.upsert_policy_scope)
    assert "No such site in this organisation" in src
    assert "No such employee in this organisation" in src
    assert "would never apply" in src


def test_the_scope_listing_never_hands_the_client_an_id_to_render():
    """`scope_ref` is a uuid for two of the three kinds."""
    src = inspect.getsource(pahchan.list_policy_scopes)
    assert "scope_label" in src
    assert "(no longer exists)" in src


def test_setting_a_scope_is_audited_at_warn():
    """It decides how somebody's attendance is judged."""
    src = inspect.getsource(pahchan.upsert_policy_scope)
    assert "pahchan.policy_scope_set" in src
    assert 'severity="warn"' in src
