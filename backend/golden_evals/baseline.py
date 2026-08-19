"""
baseline.py — the record of what fails today, so that only NEW failures fail CI.

── Why baselined rather than clean ────────────────────────────────────────────

This repo already runs two gates this way and for the same reason: the contrast
gate and the vitest gate both ship a frozen list of accepted failures, because a
gate that goes red on the day it is armed gets switched off within a week, and a
gate that is switched off is worse than no gate — its presence reads as
coverage.

The eval set is written against what Sahayak SHOULD do, not against what it does
today, so several cases fail on arrival. Those are the point: a case in this file
is a defect with a name and a reproduction, not a rule that was quietly relaxed.
A run that fixes one prints it so the entry can be deleted. The file only ever
shrinks; regrowing it is how a known defect becomes a permanent one.

── Why the model half is armed separately ─────────────────────────────────────

Offline checks read the deterministic planner. They give the same answer on the
same commit forever, so they gate from the first run.

Model checks read prose that a cheap model wrote, and no model answers the same
way twice. They cannot be baselined by anyone who has not run them against a
key, and a gate that fails because a secret is unset in a fork fails for the
wrong reason. So `model_checks_armed` stays false until somebody records a real
run with `--update-baseline`; until then model failures are reported loudly and
gate nothing.
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path

DEFAULT_PATH = Path(__file__).parent / "baseline.json"

#: Written into the file, because the file is what somebody finds first.
NOTE = (
    "Failures accepted as of the run that last wrote this file. Proposal 69, "
    "mechanism C. Each entry is a defect with a reproduction: open "
    "golden_evals/cases/<id>.json and read its 'note' for what is wrong and why "
    "it is not fixed yet. THIS FILE ONLY EVER SHRINKS - delete an entry when the "
    "case starts passing; never add one to quieten a new failure."
)


@dataclass
class Baseline:
    #: case id -> the check names that are known to fail on it.
    known_failures: dict[str, set[str]] = field(default_factory=dict)
    #: whether a model failure is allowed to fail the build.
    model_checks_armed: bool = False
    path: Path = DEFAULT_PATH

    def knows(self, case_id: str, check: str) -> bool:
        return check in self.known_failures.get(case_id, set())

    @property
    def count(self) -> int:
        return sum(len(v) for v in self.known_failures.values())


def load(path: Path = DEFAULT_PATH) -> Baseline:
    """Read the baseline, or return an empty one if there is no file yet.

    A missing file is not an error: an eval set with nothing accepted is the
    state this is trying to reach.
    """
    path = Path(path)
    if not path.exists():
        return Baseline(path=path)
    data = json.loads(path.read_text(encoding="utf-8"))
    return Baseline(
        known_failures={
            case_id: set(checks)
            for case_id, checks in (data.get("known_failures") or {}).items()
        },
        model_checks_armed=bool(data.get("model_checks_armed", False)),
        path=path,
    )


def save(baseline: Baseline, *, note: str = NOTE) -> None:
    payload = {
        "_note": note,
        "model_checks_armed": baseline.model_checks_armed,
        "known_failures": {
            case_id: sorted(checks)
            for case_id, checks in sorted(baseline.known_failures.items())
            if checks
        },
    }
    baseline.path.write_text(
        json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
