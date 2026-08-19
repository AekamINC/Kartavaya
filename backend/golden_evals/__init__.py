"""
golden_evals — the golden eval set for Sahayak. Proposal 69, mechanism C.

Question in; the facts the answer must contain, the sources it must cite, the
things it must refuse. Files only: no table, no migration, no model call from
anything in this package except the runner, which lives in
`backend/scripts/run_golden_evals.py`.

It exists because without it nobody can say whether any change to the assistant
helped — including the model swaps, of which there have been four this quarter.
It is the difference between improving and merely changing.

Read `README.md` in this directory before adding a case. Everything here is
imported by `backend/tests/test_golden_evals.py`, which runs offline in the
normal pytest suite; the runner's model half never runs there.
"""
from golden_evals.case import (  # noqa: F401
    Case, CaseError, ContextSource, load_case_file, load_cases, parse_case,
)
from golden_evals.scoring import (  # noqa: F401
    Check, MODEL, OFFLINE, normalise, score_answer, score_offline,
)
