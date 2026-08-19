"""
test_golden_evals.py — the golden eval set's own tests, and they run offline.

── What this file guards ──────────────────────────────────────────────────────

The eval set is the thing that says whether a change to Sahayak helped. Nothing
else in the repo can tell anyone that, so an eval set that has quietly stopped
checking is worse than not having one: its green report reads as coverage.

Three failure modes are covered here, in the order they are likely.

  1. A case file that no longer means what it says — a misspelt key, an id that
     does not match its filename, a `must_cite` naming a source the case never
     supplied. All of these are silent by nature: the check simply stops running.

  2. A rule in `scoring.py` that stops firing. Every judgement is a string or a
     structure rule, so every one of them can be exercised here with a
     hand-written answer and no key, no network and no model.

  3. The runner failing for the wrong reason. Two properties are asserted
     directly, because CI depends on both: with no API key the run SKIPS and
     exits 0, and with a real regression in the deterministic half it exits 1.

── And this file must stay offline ────────────────────────────────────────────

The normal backend suite makes no network calls and needs no API key. Nothing
below calls a model. The runner's model half is reached only through
`--answers`, which scores text the test wrote itself.
"""
import importlib.util
import json
from pathlib import Path

import pytest

from golden_evals.baseline import load as load_baseline
from golden_evals.case import CaseError, Case, load_cases, parse_case
from golden_evals.scoring import (
    MODEL, OFFLINE, found, normalise, score_answer, score_offline,
)

BACKEND = Path(__file__).resolve().parent.parent
CASES_DIR = BACKEND / "golden_evals" / "cases"
RUNNER_PATH = BACKEND / "scripts" / "run_golden_evals.py"

#: `scripts/` is not a package — it holds standalone tools, several owned by
#: other work in flight — so the runner is loaded by path rather than imported.
#: Adding an `__init__.py` there to make one test tidier would change how every
#: other script in that directory resolves its imports.
_spec = importlib.util.spec_from_file_location("run_golden_evals", RUNNER_PATH)
runner = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(runner)


@pytest.fixture(scope="module")
def cases() -> list[Case]:
    return load_cases(CASES_DIR)


def _case(**kw) -> Case:
    base = {"id": "x", "question": "q?", "note": "n", "expect": "answer"}
    return parse_case({**base, **kw})


# ── 1. The case files ────────────────────────────────────────────────────────

def test_every_case_file_loads(cases):
    assert len(cases) >= 15, (
        "The starter set is deliberately small and real. Below fifteen cases it "
        "stops covering the vocabulary traps it was built for."
    )


def test_case_ids_match_their_filenames(cases):
    for case in cases:
        assert case.path is not None and case.id == case.path.stem


def test_planned_sources_are_sources_the_planner_can_return(cases):
    """A case may only demand a plan the planner is capable of producing.

    `must_plan: ["invoices"]` — the obvious wrong spelling of "receivables" —
    is a check that can never pass and therefore never fails informatively. It
    would sit in the baseline forever looking like a known defect.
    """
    from services.sahayak_answer import INTENTS
    known = {intent.key for intent in INTENTS}
    for case in cases:
        for name in (case.must_plan or ()) + (case.must_not_plan or ()):
            assert name in known, f"{case.id}: {name!r} is not a planner source"


def test_context_sources_are_named_things(cases):
    """A context block is a RECORD SET, and only ever a key in
    `services/skills/context.py:SOURCES`.

    `glossary` was allowed here once and that was the defect: seven cases wrote
    the house words in as a numbered source and then demanded `must_cite`, so
    they scored the exact behaviour `routers/hub.py` forbids — the vocabulary is
    prefixed unnumbered, is never added to `citable`, and any `[n]` a model puts
    on it is deleted by `sahayak.strip_invalid_refs`. Terms belong in
    `must_define`, which the runner injects the way the product does.
    """
    from services.skills.context import SOURCES
    for case in cases:
        for src in case.context:
            assert src.source in set(SOURCES), (
                f"{case.id}: unknown source {src.source!r}"
            )


def test_every_case_gates_something_offline(cases):
    """No case may be scored by the model alone.

    The answer half needs a key, reports rather than gates until somebody arms
    it, and is prose from a cheap model. If a case makes no offline check then
    on an ordinary push it checks NOTHING, and the report still prints it as a
    case that ran. Four of the vocabulary cases were in that state — the terms
    the glossary was built for were the terms nothing gated.
    """
    from services import glossary
    from services.sahayak_answer import looks_like_org_question, plan_for
    for case in cases:
        checks = score_offline(
            case,
            planned=[i.key for i in plan_for(case.question)],
            is_org_question=looks_like_org_question(case.question),
            defined=[t.name for t in glossary.terms_for(case.question)],
        )
        assert checks, (
            f"{case.id}: makes no offline check, so an ordinary push scores it "
            f"not at all. Give it must_plan, must_not_plan, is_org_question or "
            f"must_define."
        )


def test_refusal_cases_carry_no_context(cases):
    for case in cases:
        if case.expect == "refusal":
            assert not case.context


def test_every_case_says_why_it_exists(cases):
    """The note is what makes a failure actionable six months from now."""
    for case in cases:
        assert len(case.note.split()) >= 20, f"{case.id}: the note is too thin"


def test_unknown_key_is_refused():
    with pytest.raises(CaseError, match="unknown key"):
        parse_case({"id": "x", "question": "q", "note": "n", "expect": "answer",
                    "must_countain": ["oops"]})


def test_must_cite_must_name_a_supplied_source():
    with pytest.raises(CaseError, match="must_cite"):
        parse_case({"id": "x", "question": "q", "note": "n", "expect": "answer",
                    "must_cite": ["receivables"]})


def test_must_define_must_name_a_shipped_term():
    """A term file that does not exist is a check that can only ever fail, and
    it would sit in the baseline looking like a defect in the product."""
    with pytest.raises(CaseError, match="glossary_terms"):
        parse_case({"id": "x", "question": "q", "note": "n", "expect": "answer",
                    "must_define": ["gst"]})


def test_refusal_case_with_context_is_refused():
    with pytest.raises(CaseError, match="refusal case carries no context"):
        parse_case({
            "id": "x", "question": "q", "note": "n", "expect": "refusal",
            "context": [{"source": "tasks", "label": "l", "route": "r", "rows": []}],
        })


def test_duplicate_context_source_is_refused():
    with pytest.raises(CaseError, match="twice"):
        parse_case({
            "id": "x", "question": "q", "note": "n", "expect": "answer",
            "context": [
                {"source": "tasks", "label": "l", "route": "r", "rows": []},
                {"source": "tasks", "label": "l2", "route": "r2", "rows": []},
            ],
        })


def test_empty_phrase_is_refused():
    """An empty needle matches every answer, including a blank one."""
    with pytest.raises(CaseError, match="matches everything"):
        parse_case({"id": "x", "question": "q", "note": "n", "expect": "answer",
                    "must_contain": [""]})


def test_id_must_match_filename(tmp_path):
    path = tmp_path / "wrong-name.json"
    path.write_text(json.dumps(
        {"id": "right-name", "question": "q", "note": "n", "expect": "answer"}
    ), encoding="utf-8")
    with pytest.raises(CaseError, match="must match"):
        load_cases(tmp_path)


def test_broken_json_names_the_file_and_the_line(tmp_path):
    (tmp_path / "broken.json").write_text('{"id": "broken",}', encoding="utf-8")
    with pytest.raises(CaseError, match="line 1"):
        load_cases(tmp_path)


# ── 2. The judge ─────────────────────────────────────────────────────────────

def test_normalise_survives_the_formatting_a_model_chooses():
    assert normalise("**Nandini  Traders**") == "nandini traders"
    assert normalise("don’t") == "don't"
    assert normalise("96 days — overdue") == "96 days - overdue"


def test_matching_is_on_word_boundaries():
    """The single most common way a hand-written rule passes on a wrong answer."""
    assert not found(normalise("nothing is overdue"), "no")
    assert found(normalise("no, it does not"), "no")


def test_alternatives_within_one_entry_are_any_of():
    case = _case(must_contain=[["4", "four"]])
    assert all(c.passed for c in score_answer(case, "There are four open tasks."))
    assert all(c.passed for c in score_answer(case, "There are 4 open tasks."))
    assert not all(c.passed for c in score_answer(case, "There are five."))


def test_must_not_contain_fires():
    case = _case(must_not_contain=["razorpay"])
    checks = score_answer(case, "Settle it through the Razorpay checkout.")
    assert not [c for c in checks if c.name == "omits:razorpay"][0].passed


def test_regex_needle_catches_a_rendered_uuid():
    """Names, not IDs. A UUID in an answer is the defect the frontend ratchet
    `check-rendered-ids.mjs` exists to stop, arriving through the assistant."""
    case = _case(must_not_contain=["re:\\b[0-9a-f]{8}-[0-9a-f]{4}-"])
    leaked = "Assigned to b93d5e41-77aa-4c02-8f16-4a0c9e2b6d70."
    assert not [c for c in score_answer(case, leaked) if c.name.startswith("omits:")][0].passed
    assert [c for c in score_answer(case, "Assigned to Amit Desai.")
            if c.name.startswith("omits:")][0].passed


def test_citation_marker_must_point_at_a_supplied_source():
    case = _case(context=[
        {"source": "tasks", "label": "Overdue tasks", "route": "GET /x", "rows": []},
    ], must_cite=["tasks"])
    ok = {c.name: c.passed for c in score_answer(case, "Four are open [1].")}
    assert ok["cites:tasks"] and ok["no_invented_citations"]

    bad = {c.name: c.passed for c in score_answer(case, "Four are open [2].")}
    assert not bad["cites:tasks"] and not bad["no_invented_citations"]


def test_a_refusal_that_states_a_figure_fails():
    case = _case(expect="refusal")
    checks = {c.name: c.passed for c in score_answer(
        case, "I cannot read payroll, but it was around Rs 45,000."
    )}
    assert checks["refuses"]
    assert not checks["no_invented_figures"]


def test_a_refusal_naming_a_period_is_not_a_figure():
    case = _case(expect="refusal")
    checks = {c.name: c.passed for c in score_answer(
        case, "I cannot answer that for the 2026-27 year without the payroll records."
    )}
    assert checks["no_invented_figures"]


def test_an_answer_that_disclaims_access_fails_every_case():
    """The measured lie. When the planner missed, the model produced *"I don't
    currently have access to your task records"* — false, because the product
    reads tasks for a question it recognises."""
    for expect in ("answer", "refusal"):
        checks = {c.name: c.passed for c in score_answer(
            _case(expect=expect),
            "I don't currently have access to your task records.",
        )}
        assert not checks["no_false_disclaimer"]


def test_naming_the_readers_own_missing_grant_is_allowed():
    """`refusal_access` says "you do not have access to Payroll" and is correct.
    Only the first-person claim is the lie."""
    checks = {c.name: c.passed for c in score_answer(
        _case(expect="refusal"),
        "Answering this means reading the payroll register, which comes from "
        "Payroll — and you do not have access to Payroll. Nothing was read.",
    )}
    assert checks["no_false_disclaimer"]
    assert checks["refuses"]


def test_length_is_scored():
    case = _case(max_words=5)
    assert [c for c in score_answer(case, "one two three") if c.name == "length"][0].passed
    assert not [c for c in score_answer(case, "one two three four five six")
                if c.name == "length"][0].passed


def test_offline_checks_report_what_was_planned():
    case = _case(must_plan=["tasks"], must_not_plan=["receivables"], is_org_question=True)
    good = {c.name: c.passed for c in score_offline(
        case, planned=["tasks"], is_org_question=True)}
    assert good == {"plan": True, "not_plan": True, "org_question": True}

    bad = {c.name: c.passed for c in score_offline(
        case, planned=["receivables"], is_org_question=False)}
    assert bad == {"plan": False, "not_plan": False, "org_question": False}


def test_the_defines_check_fires_when_a_term_stops_matching():
    """The vocabulary gate, and the loss it exists to notice.

    `glossary.terms_for` is what decides whether a definition reaches the model
    at all. A term file deleted, or its alias list narrowed until the question
    no longer matches, silently removes the only thing that makes the answer
    right — and before this check that loss was invisible on a green build.
    """
    case = _case(must_define=["gstin"])
    assert [c for c in score_offline(case, planned=[], defined=["gstin"])
            if c.name == "defines"][0].passed
    gone = [c for c in score_offline(case, planned=[], defined=["client"])
            if c.name == "defines"][0]
    assert not gone.passed and "gstin" in gone.detail


def test_a_marker_on_a_case_with_no_records_is_an_invented_citation():
    """Vocabulary carries no `[n]`. `strip_invalid_refs` deletes any marker
    outside `citable`, and for a question that read nothing that set is empty —
    so a model citing the house words produces a rendering fault, not a source."""
    checks = {c.name: c.passed for c in score_answer(
        _case(), "GSTIN is optional and blocks nothing [1].")}
    assert not checks["no_invented_citations"]
    clean = {c.name: c.passed for c in score_answer(
        _case(), "GSTIN is optional and blocks nothing.")}
    assert clean["no_invented_citations"]


def test_offline_and_model_checks_are_labelled_apart():
    """CI gates one kind and only reports the other, so the label is load-bearing."""
    case = _case(must_plan=["tasks"], max_words=10)
    assert {c.kind for c in score_offline(case, planned=["tasks"])} == {OFFLINE}
    assert {c.kind for c in score_answer(case, "short")} == {MODEL}


# ── 3. The baseline ──────────────────────────────────────────────────────────

def test_baseline_only_names_cases_that_exist(cases):
    """A stale entry is dead weight that reads as a known defect."""
    baseline = load_baseline()
    known_ids = {c.id for c in cases}
    for case_id in baseline.known_failures:
        assert case_id in known_ids, f"baseline names a case that is gone: {case_id}"


def test_baseline_entries_correspond_to_real_checks(cases):
    """An entry for a check the case cannot produce silences nothing, and hides
    the fact that the defect it was recorded for is no longer being looked for."""
    baseline = load_baseline()
    by_id = {c.id: c for c in cases}
    offline_names = {"plan", "not_plan", "org_question"}
    for case_id, checks in baseline.known_failures.items():
        case = by_id[case_id]
        producible = {c.name for c in score_offline(case, planned=[])} | {
            c.name for c in score_answer(case, "")
        }
        for name in checks:
            assert name in producible, (
                f"baseline entry {case_id}::{name} is not a check this case makes"
            )
            if name in offline_names:
                assert getattr(case, {"plan": "must_plan",
                                      "not_plan": "must_not_plan",
                                      "org_question": "is_org_question"}[name]) is not None


# ── 4. The runner, and the two things CI depends on ──────────────────────────

def test_the_default_model_is_one_the_product_can_reach():
    """A model this product has retired must not go on scoring it.

    `REACHABLE_MODELS` is the set of ids the routing chains can actually name,
    kept in step with the live provider table by
    `tests/test_model_pricing_is_complete.py`. Tying the eval default to it means
    a provider swap that retires the model breaks this test rather than quietly
    leaving CI scoring against something nobody ships.
    """
    from services.ai_router import REACHABLE_MODELS
    assert runner.DEFAULT_MODEL in REACHABLE_MODELS


def test_the_default_model_is_one_that_has_ever_ANSWERED():
    """Reachable is not the same as alive, and this test is why.

    The check above passed the whole time the default was
    `thudm/glm-4.5-air:free` — an id `hub_ai_providers` really does name, so it
    is genuinely reachable, and one OpenRouter rejects with a 400 on every call
    it has ever received. `REACHABLE_MODELS` is a name table; it cannot tell a
    working provider from a dead one, and the eval set was scored by the dead
    one, obtaining zero answers and reporting green.

    `PROVIDER_LATENCY_MS` is the half of the split that separates them: a code
    is in it only if it has answered, and in `PROVIDER_REJECTS_MS` only if it
    never has. Both tables are refreshed from the log by
    `scripts/ai_latency_report.py`, so the day the ids in the provider table are
    corrected and glm starts answering, it becomes eligible here rather than
    staying banned by name.
    """
    from services.ai_router import (
        PROVIDER_LATENCY_MS, PROVIDER_REJECTS_MS, REACHABLE_MODELS,
    )
    code = REACHABLE_MODELS[runner.DEFAULT_MODEL]

    assert code not in PROVIDER_REJECTS_MS, (
        f"the eval set is scored by {runner.DEFAULT_MODEL!r}, which is "
        f"{code!r} — a provider measured never to have answered anything. "
        f"Every case would error, no MODEL check would be produced, and the "
        f"run would report green over an eval set that scored nothing.")
    assert code in PROVIDER_LATENCY_MS, (
        f"nothing measures whether {code!r} answers at all. Run "
        f"scripts/ai_latency_report.py and score the set on a provider that "
        f"has.")


def test_case_files_validate_through_the_runner():
    assert runner.main(["--check"]) == 0


def test_the_prompt_is_the_products_own_prompt(cases):
    """`sahayak_answer.system_prompt` is imported, never restated.

    A copy in the runner would drift from the real one, and the eval would then
    certify a prompt the product does not send. The two branches asserted below
    are the ones the answer is scored against: with records the citation rule is
    stated, and with none the model is told it may not claim to lack access.
    """
    by_id = {c.id: c for c in cases}

    system, user = runner.build_prompt(by_id["overdue-invoices-who-owes"])
    assert "CITATIONS" in system and "[1]" in system
    assert "[1] Overdue customer invoices - GET /api/v1/ganit/invoices" in user
    assert "Nandini Traders" in user

    refusal, question = runner.build_prompt(
        by_id["payroll-for-a-named-person-is-refused"])
    assert "No records from this organisation were read" in refusal
    assert "Never say or imply that you lack access" in refusal
    assert question == by_id["payroll-for-a-named-person-is-refused"].question


def test_the_glossary_is_prefixed_unnumbered_and_is_not_citable(cases):
    """The shape `routers/hub.py` sends, and the one the set got backwards.

    Production prefixes `glossary.for_question` ABOVE the records, does not add
    it to `citable`, and lets `strip_invalid_refs` delete any marker the model
    puts on it. The eval used to write the house words into `context` as a
    numbered source and then fail any answer that did not cite them — rewarding
    a marker the product deletes as a rendering fault.

    Both branches are asserted: a question that reads records numbers only the
    records, and a pure-vocabulary question is numbered not at all and gets the
    system prompt's cite_max==0 branch.
    """
    by_id = {c.id: c for c in cases}

    system, user = runner.build_prompt(by_id["unpaid-invoice-stays-editable"])
    assert user.index("HOUSE VOCABULARY") < user.index("[1] Overdue customer")
    assert "carries no [n]: never cite it" in user
    # One record set, so [1] is the invoice and there is no [2] to give the
    # vocabulary — which is the whole reason it is not numbered.
    assert "numbered [1] to [1]" in system
    assert "[2]" not in user

    vocab, question = runner.build_prompt(by_id["gstin-missing-blocks-nothing"])
    assert "CITATIONS" not in vocab
    assert "No records from this organisation were read" in vocab
    assert "HOUSE VOCABULARY" in question and "[1]" not in question


def test_a_vocabulary_case_is_scored_on_the_shipped_term_file(cases):
    """Mechanism B's own test: editing a term file changes the eval.

    The definitions used to be prose hand-copied into the case, so
    `services/glossary_terms/*.md` could be rewritten or deleted without any
    eval outcome moving — the claim that a product decision improves the
    assistant as a side effect was untested. The runner now asks the same
    `glossary` the answer path asks, so the file IS the fixture.
    """
    from services import glossary
    _, user = runner.build_prompt({c.id: c for c in cases}["upi-is-one-id-per-platform"])
    shipped = next(t for t in glossary.load_terms() if t.name == "upi")
    assert shipped.meaning[:60] in user
    assert not any(src.source == "glossary"
                   for case in cases for src in case.context)


def test_a_hindi_question_is_asked_for_a_hindi_answer(cases):
    """Script detection routes the question and the prompt asks for the reply in
    the same script. A model swap that silently answers Hindi in English is a
    regression a user notices immediately and a report never would."""
    by_id = {c.id: c for c in cases}
    system, _ = runner.build_prompt(by_id["hindi-payment-outstanding"])
    assert "written in Hindi" in system


def test_no_api_key_skips_loudly_and_exits_zero(monkeypatch, capsys):
    """The property CI is wired on. A push from a fork has no secret, and an
    unset secret must never be what turns a build red."""
    monkeypatch.delenv(runner.API_KEY_ENV, raising=False)
    code = runner.main(["--ci"])
    out = capsys.readouterr().out
    assert code == 0
    assert "MODEL HALF SKIPPED" in out
    assert runner.API_KEY_ENV in out


def test_a_new_offline_failure_fails_the_gate(monkeypatch, tmp_path, capsys):
    """The other property CI is wired on, proved by breaking it.

    The deterministic half gates from the first run: `plan_for` gives the same
    answer on the same commit forever, so a failure here is a real change in
    which records a question reads and never a flake.
    """
    monkeypatch.delenv(runner.API_KEY_ENV, raising=False)
    case = json.loads(
        (CASES_DIR / "open-tasks-right-now.json").read_text(encoding="utf-8")
    )
    case["must_plan"] = ["receivables"]
    (tmp_path / "open-tasks-right-now.json").write_text(
        json.dumps(case), encoding="utf-8"
    )
    code = runner.main(["--cases", str(tmp_path), "--ci"])
    assert code == 1
    assert "NEW FAILURE" in capsys.readouterr().out


def test_the_committed_set_passes_its_own_gate(monkeypatch):
    """Nothing outside the baseline may fail on the commit that ships it."""
    monkeypatch.delenv(runner.API_KEY_ENV, raising=False)
    assert runner.main(["--ci"]) == 0


def test_recorded_answers_are_scored_without_a_model(monkeypatch, tmp_path, capsys):
    """`--answers` is how a real Sahayak reply gets scored, and how this suite
    exercises the model half with no key and no socket."""
    monkeypatch.delenv(runner.API_KEY_ENV, raising=False)
    answers = tmp_path / "answers.json"
    answers.write_text(json.dumps({
        "gstin-missing-blocks-nothing":
            "No. GSTIN is optional here and blocks nothing — raise the "
            "invoice as normal.",
    }), encoding="utf-8")
    code = runner.main([
        "--answers", str(answers), "--only", "gstin-missing-blocks-nothing", "--ci",
    ])
    out = capsys.readouterr().out
    assert code == 0
    assert "mode        recorded" in out


def test_a_run_that_answers_nothing_is_fatal_and_cannot_arm_the_baseline(
    monkeypatch, tmp_path, capsys
):
    """The shape the set shipped in, asserted so it cannot come back.

    Zero answers produce zero MODEL checks, zero regressions and a report that
    reads exactly like a clean run — which is how a default model OpenRouter
    rejects on every call sat in CI reporting green. The second half is the part
    that made it unrecoverable: `--update-baseline` arms the answer half only
    when MODEL checks exist, so a dead run could not even be baselined into
    honesty. The guard therefore stands in FRONT of the baseline write, and this
    asserts the file is left untouched.
    """
    monkeypatch.delenv(runner.API_KEY_ENV, raising=False)
    answers = tmp_path / "answers.json"
    answers.write_text("{}", encoding="utf-8")
    baseline = tmp_path / "baseline.json"

    code = runner.main(["--answers", str(answers), "--ci",
                        "--update-baseline", "--baseline", str(baseline)])
    err = capsys.readouterr().err

    assert code == 1, "a run that scored nothing reported success"
    assert "GOT NOTHING BACK" in err
    assert not baseline.exists(), (
        "a run with no answers rewrote the baseline — the state it would record "
        "is 'the answer half has no checks', which is what silenced it")


def test_model_failures_gate_only_once_the_baseline_is_armed(monkeypatch, tmp_path):
    """Prose from a cheap model cannot be baselined by anyone who has not run it,
    so until somebody records a run the answer half reports and gates nothing.
    Both sides of that switch are asserted here, against an answer written by
    this test rather than by a model."""
    monkeypatch.delenv(runner.API_KEY_ENV, raising=False)
    answers = tmp_path / "answers.json"
    answers.write_text(json.dumps({
        "gstin-missing-blocks-nothing": "Yes — GSTIN is mandatory before you can raise it.",
    }), encoding="utf-8")

    argv = ["--answers", str(answers), "--only", "gstin-missing-blocks-nothing",
            "--gate", "--baseline", str(tmp_path / "baseline.json")]

    (tmp_path / "baseline.json").write_text(json.dumps(
        {"model_checks_armed": False, "known_failures": {}}), encoding="utf-8")
    assert runner.main(argv) == 0

    (tmp_path / "baseline.json").write_text(json.dumps(
        {"model_checks_armed": True, "known_failures": {}}), encoding="utf-8")
    assert runner.main(argv) == 1


def test_the_flag_ci_actually_passes_is_the_one_that_gates(monkeypatch, tmp_path):
    """The workflow runs `--ci` and nothing else, and the promise is written in
    it: the answer half "starts gating only once somebody has recorded a run".

    That was false. `fatal` added model regressions only under `args.gate`, so
    arming the baseline would have changed nothing about the job — every model
    regression printed as a `::warning` and the build stayed green. It is the
    second of two independent routes to the same silence, the first being a
    default model that answered nothing, and it would have outlived the first.

    So this asserts the CI invocation, verbatim, on both sides of the switch.
    """
    monkeypatch.delenv(runner.API_KEY_ENV, raising=False)
    answers = tmp_path / "answers.json"
    answers.write_text(json.dumps({
        "gstin-missing-blocks-nothing": "Yes — GSTIN is mandatory before you can raise it.",
    }), encoding="utf-8")

    argv = ["--answers", str(answers), "--only", "gstin-missing-blocks-nothing",
            "--ci", "--baseline", str(tmp_path / "baseline.json")]

    (tmp_path / "baseline.json").write_text(json.dumps(
        {"model_checks_armed": False, "known_failures": {}}), encoding="utf-8")
    assert runner.main(argv) == 0, (
        "an unarmed baseline must still report and gate nothing — a build that "
        "goes red on the day the eval set lands gets switched off")

    (tmp_path / "baseline.json").write_text(json.dumps(
        {"model_checks_armed": True, "known_failures": {}}), encoding="utf-8")
    assert runner.main(argv) == 1


def test_a_malformed_case_directory_exits_two(tmp_path):
    """Two, not one: a broken case file is not a failing eval, and CI must be
    able to tell the difference between the product being wrong and the eval set
    being unreadable."""
    (tmp_path / "broken.json").write_text("{", encoding="utf-8")
    assert runner.main(["--cases", str(tmp_path)]) == 2


def test_the_eval_set_is_not_collected_by_the_normal_suite():
    """`pytest.ini` pins `testpaths = tests`, which is what keeps the model half
    out of the offline suite. THIS file is the eval set's presence in it."""
    ini = (BACKEND / "pytest.ini").read_text(encoding="utf-8")
    assert "testpaths = tests" in ini
