"""
report.py — one run, printed for a person and written for a machine.

Two audiences, one pass over the same results. The readable half is what the
owner scans to find out which answer is wrong; the machine half is a JSON file
that survives the run, so two runs on different models can be diffed rather than
remembered. That diff is the whole point of the eval set: the model has changed
four times this quarter, and without a recorded run before and after, nobody can
say which direction any of those swaps moved the product.

Latency is recorded per case because it is the measured defect this proposal
opens with: the assistant is not expensive, it is slow — 7,330 ms average
against a free provider in the same chain that answers in 195 ms. A run that
prints an accuracy figure and no timing hides half the story.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional, Sequence

from golden_evals.baseline import Baseline
from golden_evals.scoring import Check, MODEL, OFFLINE

SCHEMA = "kartavya.golden_evals/1"

_GREEN = "PASS"
_RED = "FAIL"


def summarise(
    checks: Sequence[Check],
    baseline: Baseline,
    *,
    mode: str,
    model: Optional[str],
    case_ids: Sequence[str],
    timings_ms: Optional[dict[str, int]] = None,
    errors: Optional[dict[str, str]] = None,
) -> dict:
    """Sort every check into passed / known / regression / fixed.

    `fixed` is a check the baseline expects to fail that has started passing.
    It is not a failure and it is the only good news this file can report, so it
    is printed rather than swallowed — that is how the baseline shrinks.
    """
    timings_ms = timings_ms or {}
    errors = errors or {}

    passed, known, regressions, fixed = [], [], [], []
    for chk in checks:
        expected_to_fail = baseline.knows(chk.case_id, chk.name)
        if chk.passed and expected_to_fail:
            fixed.append(chk)
        elif chk.passed:
            passed.append(chk)
        elif expected_to_fail:
            known.append(chk)
        else:
            regressions.append(chk)

    offline_regressions = [c for c in regressions if c.kind == OFFLINE]
    model_regressions = [c for c in regressions if c.kind == MODEL]

    latencies = sorted(timings_ms.values())
    return {
        "schema": SCHEMA,
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "mode": mode,
        "model": model,
        "cases": len(case_ids),
        "case_ids": list(case_ids),
        "checks": {
            "total": len(checks),
            "passed": len(passed),
            "known_failures": len(known),
            "regressions": len(regressions),
            "fixed": len(fixed),
        },
        "regressions": [c.as_dict() for c in regressions],
        "offline_regressions": len(offline_regressions),
        "model_regressions": len(model_regressions),
        "known": [c.as_dict() for c in known],
        "fixed": [c.as_dict() for c in fixed],
        "errors": [{"case": k, "error": v} for k, v in sorted(errors.items())],
        "latency_ms": {
            "count": len(latencies),
            "p50": latencies[len(latencies) // 2] if latencies else None,
            "max": latencies[-1] if latencies else None,
            "per_case": dict(sorted(timings_ms.items())),
        },
        "baseline_size": baseline.count,
        "model_checks_armed": baseline.model_checks_armed,
    }


def render(summary: dict, checks: Sequence[Check], *, verbose: bool = False) -> str:
    """The readable report. Failures first, because that is what gets read."""
    lines: list[str] = []
    add = lines.append

    add("")
    add("=" * 78)
    add("  GOLDEN EVAL SET — Sahayak (proposal 69, mechanism C)")
    add("=" * 78)
    model = summary["model"] or "—"
    add(f"  mode        {summary['mode']}")
    add(f"  model       {model}")
    add(f"  cases       {summary['cases']}")
    c = summary["checks"]
    add(f"  checks      {c['total']}  "
        f"passed {c['passed']}  known {c['known_failures']}  "
        f"NEW FAILURES {c['regressions']}  fixed {c['fixed']}")
    lat = summary["latency_ms"]
    if lat["count"]:
        add(f"  latency     p50 {lat['p50']} ms   slowest {lat['max']} ms "
            f"over {lat['count']} answers")
    add("")

    by_case: dict[str, list[Check]] = {}
    for chk in checks:
        by_case.setdefault(chk.case_id, []).append(chk)

    regressed = {(r["case"], r["check"]) for r in summary["regressions"]}
    known = {(r["case"], r["check"]) for r in summary["known"]}
    fixed = {(r["case"], r["check"]) for r in summary["fixed"]}

    for case_id in summary["case_ids"]:
        case_checks = by_case.get(case_id, [])
        bad = [k for k in case_checks if (case_id, k.name) in regressed]
        if not bad and not verbose:
            continue
        verdict = _RED if bad else _GREEN
        add(f"  [{verdict}] {case_id}")
        for chk in case_checks:
            key = (case_id, chk.name)
            if key in regressed:
                tag = "NEW FAILURE"
            elif key in known:
                tag = "known"
            elif key in fixed:
                tag = "FIXED"
            elif not verbose:
                continue
            else:
                tag = "ok"
            add(f"      {tag:<12} {chk.name}: {chk.detail}")
        add("")

    if summary["fixed"]:
        add("  FIXED — these are in the baseline and have started passing.")
        add("  Delete them from golden_evals/baseline.json; it only ever shrinks.")
        for chk in summary["fixed"]:
            add(f"      {chk['case']} :: {chk['check']}")
        add("")

    if summary["errors"]:
        add("  ERRORS — no answer was obtained for these cases.")
        for err in summary["errors"]:
            add(f"      {err['case']}: {err['error']}")
        add("")

    add("-" * 78)
    return "\n".join(lines)


def write_json(summary: dict, path: Path) -> None:
    Path(path).write_text(
        json.dumps(summary, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
