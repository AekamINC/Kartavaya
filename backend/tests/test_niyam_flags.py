"""The master switch — including the two ways an off switch is usually wrong.

Both failure modes below have happened in this codebase's own history, which is
why they are pinned rather than assumed: a variable SET BUT EMPTY reading as
true, and a value cached at import so a Railway shell flip does nothing until a
redeploy.
"""
import importlib

import pytest

from services.niyam import flags


@pytest.fixture(autouse=True)
def _clean_env(monkeypatch):
    monkeypatch.delenv(flags.ARMED_VAR, raising=False)


def test_unset_means_off():
    """The shipped default. Niyam arrives disarmed."""
    assert flags.engine_armed() is False


@pytest.mark.parametrize("raw", ["", "   ", "0", "false", "no", "off", "maybe", "TRUE_ISH"])
def test_empty_and_unrecognised_mean_off(monkeypatch, raw):
    """A variable that is set but empty is the classic silent-arming bug: it is
    absent as far as anyone reading the dashboard is concerned, and truthy to
    naive code. An unrecognised value is a typo, and a typo must not arm."""
    monkeypatch.setenv(flags.ARMED_VAR, raw)
    assert flags.engine_armed() is False


@pytest.mark.parametrize("raw", ["1", "true", "TRUE", "Yes", " on "])
def test_only_explicit_yes_arms(monkeypatch, raw):
    monkeypatch.setenv(flags.ARMED_VAR, raw)
    assert flags.engine_armed() is True


def test_flag_is_read_live_not_cached_at_import(monkeypatch):
    """Flippable from a shell without a redeploy — the whole point of a switch
    somebody has to reach for at 2am."""
    assert flags.engine_armed() is False
    monkeypatch.setenv(flags.ARMED_VAR, "1")
    assert flags.engine_armed() is True
    monkeypatch.delenv(flags.ARMED_VAR)
    assert flags.engine_armed() is False


def test_reimport_does_not_freeze_state(monkeypatch):
    """Belt and braces: even a module reload must not bake the value in."""
    monkeypatch.setenv(flags.ARMED_VAR, "1")
    reloaded = importlib.reload(flags)
    monkeypatch.delenv(flags.ARMED_VAR)
    assert reloaded.engine_armed() is False


# ── the two gates ────────────────────────────────────────────────────────────

@pytest.mark.parametrize(
    "engine, rule, expected",
    [
        (False, False, "dry"),
        (False, True, "dry"),   # a rule cannot arm itself past the master switch
        (True, False, "dry"),   # the master switch does not arm rules for you
        (True, True, "live"),
    ],
)
def test_both_gates_must_be_open(monkeypatch, engine, rule, expected):
    """Arming the engine must never arm any rule. That is what makes 'flip the
    master switch' a safe, watchable act rather than a fleet-wide send."""
    if engine:
        monkeypatch.setenv(flags.ARMED_VAR, "1")
    assert flags.rule_effective_mode(rule) == expected


def test_describe_answers_why_nothing_is_happening(monkeypatch):
    d = flags.describe()
    assert d["engine_armed"] is False
    assert d["variable"] == flags.ARMED_VAR
    assert "dry run" in d["meaning"]

    monkeypatch.setenv(flags.ARMED_VAR, "1")
    assert flags.describe()["engine_armed"] is True
