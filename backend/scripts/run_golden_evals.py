#!/usr/bin/env python
"""
run_golden_evals.py — run the golden eval set and say whether anything regressed.

    cd backend
    python scripts/run_golden_evals.py                 # offline half only
    python scripts/run_golden_evals.py --ci            # what CI runs
    python scripts/run_golden_evals.py --answers a.json  # score recorded answers
    python scripts/run_golden_evals.py --check         # validate the case files

── What this does NOT do, and why ─────────────────────────────────────────────

It does not touch the database. Not to read the questions, not to log the run,
not through `ai_router.generate` — which needs a pool, writes a row to
`public.hub_ai_logs` for every call, and would therefore make a CI run a
production write. Staging and production share one Supabase project.

It does not call the Sahayak chat route either, for the same reason: that route
creates chat rows, spends credits and moves an org's data. The model half calls
the provider directly over HTTP with a fixture context written into the case
file, so the same question produces the same prompt on every machine forever.

It does not judge with a model. Every rule in `golden_evals/scoring.py` is a
string or a structure rule. A judge would be a paid call per case per run
against a product whose lifetime AI spend is $2.19.

── The two halves, and which one gates ────────────────────────────────────────

OFFLINE runs always, needs no key, and gates from the first run: it calls
`sahayak_answer.plan_for`, which is deterministic, so a failure is a real
change in behaviour and never a flake.

MODEL needs OPENROUTER_API_KEY. Without it the half SKIPS, loudly, and the
process exits 0 — an unset secret in a fork must never be what turns a build
red. With a key it runs, and it gates only once somebody has recorded a run
into the baseline (`--update-baseline`), because prose from a cheap model
cannot be baselined by anyone who has not seen it.

A key that IS set and answers nothing at all is the third outcome, and it is
fatal — see `dead_notice`. Zero answers produce zero checks, which reports as a
clean run; that is the shape the set shipped in.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
import time
from pathlib import Path
from typing import Optional

_BACKEND = Path(__file__).resolve().parent.parent
if str(_BACKEND) not in sys.path:
    sys.path.insert(0, str(_BACKEND))

# The report prints Devanagari, because a real staging question is in Hindi and
# the set is written from what people actually type. A Windows console runs
# cp1252 by default and raises UnicodeEncodeError on the first such character,
# which kills the run with a traceback that looks like a bug in the eval set.
# `errors="replace"` rather than a narrower charset: a question mark in place of
# a glyph loses nothing that matters here, and losing the run does.
#
# Broad except: this runs at import, before argument parsing, and under pytest
# stdout is whichever capture object the active mode installed. None of them are
# worth a crash before the run has begun.
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except Exception:  # noqa: BLE001 — a stream that cannot be reconfigured
        pass

from golden_evals import baseline as baseline_mod  # noqa: E402
from golden_evals.case import CASES_DIR, Case, CaseError, load_cases  # noqa: E402
from golden_evals.report import render, summarise, write_json  # noqa: E402
from golden_evals.scoring import Check, MODEL, OFFLINE, score_answer, score_offline  # noqa: E402

#: The provider every text chain in this product actually reaches. All six
#: model ids in `ai_router.REACHABLE_MODELS` that are not Groq are served from
#: here, so one key runs the whole eval set.
API_BASE = os.getenv("EVAL_API_BASE", "https://openrouter.ai/api/v1")
API_KEY_ENV = "OPENROUTER_API_KEY"

#: `gemini_flash_or` in the provider table, and the only OpenRouter id in
#: `ai_router.REACHABLE_MODELS` that has ever ANSWERED anything: 19 calls, 19
#: successes, zero errors, p50 3,555 ms, $0.0197 of lifetime spend.
#:
#: NOT THE FREE ONE, and that is the correction. `thudm/glm-4.5-air:free` stood
#: here first, on the strength of "81 calls, 195 ms average, $0.0000". That is
#: the status-unfiltered figure `ai_router.PROVIDER_LATENCY_MS` was rewritten to
#: warn about: split by `status`, every one of glm's 84 calls is a rejection.
#: OpenRouter answers `thudm/glm-4.5-air:free is not a valid model ID` with a
#: 400 — still on 2026-08-19 — and its public model list does not carry that id
#: at all; the live GLM 4.5 Air is `z-ai/glm-4.5-air`, and it is not free. The
#: 195 ms is how fast the refusal comes back.
#:
#: An eval scored by a model that cannot be reached obtains no answers, produces
#: no MODEL checks, finds no regressions and reports green — a gate whose
#: presence reads as coverage, which is the one failure this whole mechanism
#: exists to prevent. So the id is one measured to answer, AND `main` now fails
#: loudly when a run that asked for answers got none.
#:
#: It costs about a cent and a half a set: ~20 short questions, fixture context,
#: capped at 1,024 tokens out. Against $2.19 of lifetime AI spend that is the
#: price of the answer half running at all, and the answer half is the half that
#: reads the prose nothing else in the repo looks at.
#:
#: NOT a statement about which model should answer users. `EVAL_MODEL` overrides
#: it, the model that answered is recorded in every report, and
#: `tests/test_golden_evals.py` asserts this id is one the product can reach and
#: is not one of the ids measured never to have answered — so neither a retired
#: model nor a dead one can go on scoring this product.
DEFAULT_MODEL = "google/gemini-2.5-flash"

#: Deterministic sampling. Not zero everywhere — some providers reject 0 — but
#: low enough that a case which still flaps is a badly written case rather than
#: an unlucky one. The README says what to do about a flapping case.
TEMPERATURE = 0.1

#: Long enough for the slowest provider ever measured here (37,576 ms, gemini
#: pro through OpenRouter) plus room, short enough that a hung request does not
#: hold a CI job open.
TIMEOUT_S = 60

#: Answers in flight at once. The eval set is ~20 questions; four keeps a run
#: under a minute without looking like abuse.
CONCURRENCY = 4


# ── The prompt ───────────────────────────────────────────────────────────────

def _render_context(case: Case) -> tuple[str, int]:
    """The numbered record block, in the shape `sahayak_answer` produces.

    Deliberately built here rather than by calling `render_readings`: that
    function takes `Reading` objects assembled from live reads, and the whole
    point of a case fixture is that no read happens. The SHAPE is copied — the
    `[n] label - route` header and the JSON body — because the model is being
    scored on how it handles the block the product really sends it.
    """
    if not case.context:
        return "", 0
    out = [
        "CONTEXT - this organisation's own current records, read just now for "
        "this question. Ground every claim in it and do not invent figures.",
    ]
    for i, src in enumerate(case.context, start=1):
        body = json.dumps(src.rows, ensure_ascii=False, default=str)
        out.append(f"\n[{i}] {src.label} - {src.route}\n{body}")
    return "\n".join(out), len(case.context)


def build_prompt(case: Case) -> tuple[str, str]:
    """(system, user) for one case, using the product's own system prompt.

    `sahayak_answer.system_prompt` is imported rather than restated. A copy here
    would drift from the real one, and the eval would then certify a prompt the
    product does not send — which is worse than no eval, because it reads as
    coverage.

    THE VOCABULARY BLOCK IS NOT A RECORD, and getting that wrong was exactly the
    drift this docstring promises not to have. The set shipped with the glossary
    written into `context` as a numbered source and `must_cite: ["glossary"]` on
    top of it — so a model was marked FAILED for answering the way the product
    requires, and rewarded for emitting an `[n]` the product deletes.
    `routers/hub.py` prefixes `glossary.for_question` UNNUMBERED, keeps it out of
    `citable`, and `sahayak.strip_invalid_refs` then strips any marker outside
    that set. So it is prefixed here the same way, from the same call, above the
    numbered block and outside `cite_max`.

    Reading the SHIPPED `glossary_terms/*.md` rather than prose copied into the
    case is the other half of it: editing a term file has to be able to change
    what this eval measures, or mechanism B has no test at all.
    """
    from services import glossary
    from services.ai_router import LANGUAGE_NAMES, detect_language
    from services.sahayak_answer import system_prompt

    block, cite_max = _render_context(case)
    lang = detect_language(case.question)
    system = system_prompt(None, LANGUAGE_NAMES.get(lang, "English"), cite_max)

    # `\n\n---\n\n` between every part, which is how hub.py joins them. The
    # separator is the only thing telling a cheap model where the records stop
    # and the question starts.
    parts = [p for p in (glossary.for_question(case.question), block) if p]
    parts.append(case.question)
    return system, "\n\n---\n\n".join(parts)


# ── The model half ───────────────────────────────────────────────────────────

async def _ask(client, model: str, api_key: str, case: Case) -> tuple[str, int]:
    system, user = build_prompt(case)
    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        "max_tokens": 1024,
        "temperature": TEMPERATURE,
    }
    start = time.monotonic()
    resp = await client.post(
        f"{API_BASE}/chat/completions",
        json=payload,
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
    )
    resp.raise_for_status()
    data = resp.json()
    elapsed = int((time.monotonic() - start) * 1000)
    return data["choices"][0]["message"]["content"] or "", elapsed


async def collect_answers(
    cases: list[Case], model: str, api_key: str
) -> tuple[dict[str, str], dict[str, int], dict[str, str]]:
    """Ask every case, in parallel, and keep the failures rather than raising.

    One provider hiccup must not throw away the nineteen answers that did
    arrive: a run that reports "1 error, 19 scored" is usable and a run that
    reports a traceback is not.
    """
    import httpx

    answers: dict[str, str] = {}
    timings: dict[str, int] = {}
    errors: dict[str, str] = {}
    gate = asyncio.Semaphore(CONCURRENCY)

    async with httpx.AsyncClient(timeout=TIMEOUT_S) as client:
        async def one(case: Case) -> None:
            async with gate:
                try:
                    text, ms = await _ask(client, model, api_key, case)
                    answers[case.id] = text
                    timings[case.id] = ms
                except Exception as exc:  # noqa: BLE001 - reported, not swallowed
                    errors[case.id] = f"{type(exc).__name__}: {exc}"

        await asyncio.gather(*(one(c) for c in cases))
    return answers, timings, errors


# ── Wiring ───────────────────────────────────────────────────────────────────

def run_offline(cases: list[Case]) -> list[Check]:
    """The half that needs no key, and — since `must_define` — the half that
    covers the vocabulary work.

    `glossary.terms_for` is the same call `hub.py` makes to decide which
    definitions ride along with a question, and it reads the shipped term files.
    Asking it here is what makes deleting `glossary_terms/gstin.md`, or narrowing
    its aliases until the term stops firing, turn the build red on the push that
    does it. Before this, every vocabulary case was scored only by the model
    half, and four of them produced no gating check at all.
    """
    from services import glossary
    from services.sahayak_answer import looks_like_org_question, plan_for

    checks: list[Check] = []
    for case in cases:
        planned = [intent.key for intent in plan_for(case.question)]
        checks.extend(score_offline(
            case,
            planned=planned,
            is_org_question=looks_like_org_question(case.question),
            defined=[term.name for term in glossary.terms_for(case.question)],
        ))
    return checks


def load_recorded(path: Path) -> dict[str, str]:
    """Answers recorded elsewhere: a real Sahayak reply, or a captured run.

    Accepts either {"case-id": "answer"} or [{"id": ..., "text": ...}], because
    both are shapes a person plausibly pastes together by hand.
    """
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    if isinstance(data, dict):
        return {str(k): str(v) for k, v in data.items()}
    if isinstance(data, list):
        return {str(row["id"]): str(row.get("text", "")) for row in data}
    raise SystemExit(f"{path}: expected an object or a list of answers")


def skip_notice(reason: str, cases: int) -> str:
    """Loud, and it names the variable. A silent skip is indistinguishable from
    a pass, and this job runs on pushes from forks where no secret exists."""
    bar = "!" * 78
    return "\n".join([
        "", bar,
        "!!  GOLDEN EVAL SET - MODEL HALF SKIPPED",
        f"!!  {reason}",
        f"!!  {cases} case(s) had their answers left unscored.",
        f"!!  Set {API_KEY_ENV} to run them. The offline half above still ran.",
        bar, "",
    ])


def dead_notice(model: Optional[str], cases: int, errors: dict[str, str]) -> str:
    """Every case errored. That is a broken run, not a set of failures.

    It has to be its own outcome and it has to be fatal, because the shape it
    takes is silence: no answer reaches `score_answer`, so no MODEL check is
    produced, so there is nothing to regress and the report is green. The set
    shipped in exactly that state — its default model was an id OpenRouter
    rejects with a 400 — and it could not be recovered by the documented
    procedure either, since `--update-baseline` arms the answer half only when
    MODEL checks exist and none ever did.
    """
    bar = "!" * 78
    first = next(iter(errors.values()), "")
    return "\n".join([
        "", bar,
        "!!  GOLDEN EVAL SET - THE ANSWER HALF GOT NOTHING BACK",
        f"!!  All {cases} case(s) errored" + (f" against {model}." if model else "."),
        f"!!  First error: {first[:160]}",
        "!!  Zero answers means zero MODEL checks, which would otherwise report",
        "!!  as a clean run. Check the model id is one the provider serves, and",
        "!!  that the key is live. To proceed without the answer half, pass",
        f"!!  --offline or unset {API_KEY_ENV} — both skip it honestly.",
        bar, "",
    ])


def main(argv: Optional[list[str]] = None) -> int:
    ap = argparse.ArgumentParser(
        description="Run the Sahayak golden eval set (proposal 69, mechanism C).",
    )
    ap.add_argument("--cases", type=Path, default=CASES_DIR,
                    help="directory of case files (default: golden_evals/cases)")
    ap.add_argument("--only", action="append", default=[],
                    help="run one case id; repeatable")
    ap.add_argument("--tag", action="append", default=[],
                    help="run only cases carrying this tag; repeatable")
    ap.add_argument("--answers", type=Path,
                    help="score recorded answers from this file instead of "
                         "calling a model. Fully offline.")
    ap.add_argument("--model", default=os.getenv("EVAL_MODEL", DEFAULT_MODEL))
    ap.add_argument("--json", dest="json_out", type=Path,
                    help="write the machine-readable summary here")
    ap.add_argument("--baseline", type=Path, default=baseline_mod.DEFAULT_PATH)
    ap.add_argument("--check", action="store_true",
                    help="validate every case file and stop")
    ap.add_argument("--list", action="store_true",
                    help="list the cases and stop")
    ap.add_argument("--offline", action="store_true",
                    help="skip the model half even if a key is present")
    ap.add_argument("--ci", action="store_true",
                    help="CI mode: annotate failures, gate every new failure "
                         "the baseline arms, never fail for a missing key")
    ap.add_argument("--gate", action="store_true",
                    help="fail on any new failure, model half included once "
                         "the baseline is armed")
    ap.add_argument("--verbose", action="store_true",
                    help="print every check, not only the failures")
    ap.add_argument("--update-baseline", action="store_true",
                    help="record this run's failures as the accepted baseline")
    args = ap.parse_args(argv)

    try:
        cases = load_cases(args.cases)
    except CaseError as exc:
        print(f"golden evals: {exc}", file=sys.stderr)
        return 2

    if args.only:
        wanted = set(args.only)
        unknown = sorted(wanted - {c.id for c in cases})
        if unknown:
            print(f"golden evals: no such case id(s) {unknown}", file=sys.stderr)
            return 2
        cases = [c for c in cases if c.id in wanted]
    if args.tag:
        tags = set(args.tag)
        cases = [c for c in cases if tags & set(c.tags)]
        if not cases:
            print(f"golden evals: no cases carry {sorted(tags)}", file=sys.stderr)
            return 2

    if args.check:
        print(f"golden evals: {len(cases)} case file(s) valid in {args.cases}")
        return 0

    if args.list:
        for case in cases:
            plan = ",".join(case.must_plan) if case.must_plan else "-"
            print(f"{case.id:<40} {case.expect:<8} plan={plan:<24} {case.question}")
        return 0

    baseline = baseline_mod.load(args.baseline)
    checks: list[Check] = list(run_offline(cases))

    answers: dict[str, str] = {}
    timings: dict[str, int] = {}
    errors: dict[str, str] = {}
    mode = "offline"
    model: Optional[str] = None
    skipped = ""

    if args.answers:
        answers = load_recorded(args.answers)
        mode = "recorded"
        missing = [c.id for c in cases if c.id not in answers]
        for case_id in missing:
            errors[case_id] = f"no recorded answer in {args.answers}"
    elif args.offline:
        skipped = "--offline was passed."
    elif not os.getenv(API_KEY_ENV):
        skipped = f"{API_KEY_ENV} is not set."
    else:
        mode = "model"
        model = args.model
        answers, timings, errors = asyncio.run(
            collect_answers(cases, model, os.environ[API_KEY_ENV])
        )

    for case in cases:
        if case.id in answers:
            checks.extend(score_answer(case, answers[case.id]))

    summary = summarise(
        checks, baseline,
        mode=mode, model=model, case_ids=[c.id for c in cases],
        timings_ms=timings, errors=errors,
    )
    print(render(summary, checks, verbose=args.verbose))
    if skipped:
        print(skip_notice(skipped, len(cases)))
    if args.json_out:
        write_json(summary, args.json_out)
        print(f"  summary written to {args.json_out}")

    # Before the baseline is touched and before any gate is consulted: a run
    # that asked for answers and got none scored nothing, so it can neither be
    # recorded nor be passed.
    if mode in ("model", "recorded") and cases and not answers:
        print(dead_notice(model, len(cases), errors), file=sys.stderr)
        return 1

    if args.update_baseline:
        ran_kinds = {c.kind for c in checks}
        for case_id in {c.case_id for c in checks}:
            keep = {
                name for name in baseline.known_failures.get(case_id, set())
                if not any(
                    c.name == name and c.kind in ran_kinds
                    for c in checks if c.case_id == case_id
                )
            }
            baseline.known_failures[case_id] = keep
        for chk in checks:
            if not chk.passed:
                baseline.known_failures.setdefault(chk.case_id, set()).add(chk.name)
        if MODEL in ran_kinds:
            baseline.model_checks_armed = True
        baseline_mod.save(baseline)
        print(f"  baseline rewritten: {baseline.count} accepted failure(s)")
        return 0

    gating = args.gate or args.ci
    if not gating:
        return 0

    fatal = [c for c in summary["regressions"] if c["kind"] == OFFLINE]
    # `gating`, not `args.gate`. The CI step passes `--ci` alone, so keying this
    # on `--gate` meant the answer half could never fail a build no matter what
    # the baseline said — and the workflow's own comment promises the opposite,
    # that it "starts gating only once somebody has recorded a run". Two
    # independent routes to the same silence: a model id that answered nothing,
    # and a flag that gated nothing.
    #
    # Safe to widen, because `model_checks_armed` is the real switch and it is
    # false until somebody deliberately runs `--update-baseline` against a key.
    # `--ci` without a key still skips the half entirely, so a fork with no
    # secret is untouched by this line.
    if baseline.model_checks_armed and gating:
        fatal += [c for c in summary["regressions"] if c["kind"] == MODEL]

    if os.getenv("GITHUB_ACTIONS") == "true":
        for chk in summary["regressions"]:
            level = "error" if chk in fatal else "warning"
            print(f"::{level} title=golden eval {chk['case']}::"
                  f"{chk['check']} - {chk['detail']}")

    if fatal:
        print(f"golden evals: {len(fatal)} NEW failure(s). "
              f"Fix the behaviour, or — if this is a deliberate change to what "
              f"the product should say — edit the case that describes it.",
              file=sys.stderr)
        return 1
    if summary["model_regressions"] and not baseline.model_checks_armed:
        print("golden evals: model failures above are reported only. Run "
              "`python scripts/run_golden_evals.py --update-baseline` once with "
              f"{API_KEY_ENV} set to arm them.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
