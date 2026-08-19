"""
case.py — what a golden eval case is, and what makes one invalid.

A case is one question, plus everything that must be true of the answer to it:
the facts it must contain, the sources it must cite, and the things it must
refuse. Cases are JSON files, one per file, under `cases/`. There is no
database anywhere in this package and there is no model call in this module.

── Why one file per case, and why an unknown key is fatal ─────────────────────

The person who knows which answers are wrong is the owner, not a developer, and
the owner edits these by hand. Two consequences shape the format.

One file per case means a broken edit names itself: a stray comma reports the
file it is in and takes exactly one case out of the run, instead of a single
combined file failing to parse and silently taking the whole eval set with it.

An unknown key is a hard error rather than something ignored. `must_countain`
typed once is a check that stops running while the report still says PASS,
which is the failure mode this whole mechanism exists to prevent — a gate whose
presence reads as coverage. A misspelt key fails the load with the file name and
the key, before any question is asked.

── The two halves of a case ───────────────────────────────────────────────────

OFFLINE expectations are about the deterministic half of Sahayak — which
records a question makes it read (`must_plan`), and which house words it makes
the glossary explain (`must_define`). They are evaluated by calling
`services.sahayak_answer.plan_for` and `services.glossary.terms_for`, need no
API key, no network and no database, and they run on every push.

`must_define` is the vocabulary half's only gate, and it exists because there
was none: the glossary cases were scored by the model alone, so a term file
deleted or an alias narrowed cost the product a rule and cost the build nothing.

MODEL expectations are about the prose. They need an answer, which means either
a live call to a cheap model or a recorded answer file. Nothing here scores an
answer with another model: an LLM judge costs money on every run, and this
product runs cheap models on purpose.
"""
from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Optional

#: The directory the runner reads by default.
CASES_DIR = Path(__file__).parent / "cases"

#: Every key a case file may carry. Anything else fails the load.
ALLOWED_KEYS = frozenset({
    "id", "question", "note", "tags", "expect",
    "must_plan", "must_not_plan", "is_org_question", "must_define",
    "context", "must_contain", "must_not_contain", "must_cite", "max_words",
})

REQUIRED_KEYS = frozenset({"id", "question", "note", "expect"})

#: `answer` — the question should be answered from what was read.
#: `refusal` — the answer must decline and say what it would need. A refusal
#: case carries no context, because a refusal is what happens when nothing was
#: readable; supplying rows and then demanding a refusal tests nothing.
EXPECT_KINDS = frozenset({"answer", "refusal"})


class CaseError(ValueError):
    """A case file that cannot be trusted to mean what it says."""


@dataclass(frozen=True)
class ContextSource:
    """One numbered record set placed in front of the model.

    Mirrors `sahayak_answer.render_readings`: a label, the route a reader could
    call to see the same rows, and the rows themselves. The rows are a fixture
    written into the case file, never a read of the live database — staging and
    production share one Supabase project, so an eval that read real records
    would be a production read on every push, and its expected answers would
    move under it whenever anybody used the product.

    RECORDS ONLY. The glossary is not one of these and must never be written as
    one: `routers/hub.py` prefixes vocabulary unnumbered and keeps it out of
    `citable`, so a case that numbers it and then demands a citation scores the
    opposite of what the product does — the set shipped that way once. Name the
    terms in `must_define` instead; the runner injects them from the shipped
    files, exactly as the product does.
    """
    source: str
    label: str
    route: str
    rows: Any


@dataclass(frozen=True)
class Case:
    id: str
    question: str
    note: str
    expect: str
    path: Optional[Path] = None
    tags: tuple[str, ...] = ()
    must_plan: Optional[tuple[str, ...]] = None
    must_not_plan: Optional[tuple[str, ...]] = None
    is_org_question: Optional[bool] = None
    must_define: tuple[str, ...] = ()
    context: tuple[ContextSource, ...] = ()
    must_contain: tuple[tuple[str, ...], ...] = ()
    must_not_contain: tuple[str, ...] = ()
    must_cite: tuple[str, ...] = ()
    max_words: Optional[int] = None


def _as_groups(raw: Any, where: str) -> tuple[tuple[str, ...], ...]:
    """`must_contain` accepts a phrase, or a list of alternatives, per entry.

    Written for the hand that edits it. "the answer must mention the client" is
    one entry; "the answer must say three, or 3" is one entry with two spellings
    in it. Every entry must be satisfied; within an entry, any one alternative
    satisfies it.
    """
    if not isinstance(raw, list):
        raise CaseError(f"{where}: must be a list")
    out = []
    for i, entry in enumerate(raw):
        if isinstance(entry, str):
            alts = (entry,)
        elif isinstance(entry, list) and entry and all(isinstance(a, str) for a in entry):
            alts = tuple(entry)
        else:
            raise CaseError(
                f"{where}[{i}]: must be a phrase, or a non-empty list of "
                f"alternative phrases"
            )
        if any(not a.strip() for a in alts):
            raise CaseError(f"{where}[{i}]: an empty phrase matches everything")
        out.append(alts)
    return tuple(out)


def _as_str_list(raw: Any, where: str) -> tuple[str, ...]:
    if not isinstance(raw, list) or any(not isinstance(x, str) for x in raw):
        raise CaseError(f"{where}: must be a list of strings")
    if any(not x.strip() for x in raw):
        raise CaseError(f"{where}: an empty string matches everything")
    return tuple(raw)


def parse_case(data: Any, *, path: Optional[Path] = None) -> Case:
    """Build a Case from already-decoded JSON, or say precisely what is wrong."""
    where = str(path) if path else "case"
    if not isinstance(data, dict):
        raise CaseError(f"{where}: a case file must hold one JSON object")

    unknown = sorted(set(data) - ALLOWED_KEYS)
    if unknown:
        raise CaseError(
            f"{where}: unknown key(s) {unknown}. A key this loader does not "
            f"recognise is a check that would never run, so it is refused "
            f"rather than ignored. Allowed: {sorted(ALLOWED_KEYS)}"
        )
    missing = sorted(REQUIRED_KEYS - set(data))
    if missing:
        raise CaseError(f"{where}: missing required key(s) {missing}")

    for key in ("id", "question", "note"):
        if not isinstance(data[key], str) or not data[key].strip():
            raise CaseError(f"{where}: {key!r} must be a non-empty string")

    if data["expect"] not in EXPECT_KINDS:
        raise CaseError(
            f"{where}: 'expect' must be one of {sorted(EXPECT_KINDS)}, "
            f"not {data['expect']!r}"
        )

    if path is not None and data["id"] != path.stem:
        raise CaseError(
            f"{where}: 'id' is {data['id']!r} but the file is named "
            f"{path.stem!r}. They must match, so a failure in the report names "
            f"the file to open."
        )

    ctx: list[ContextSource] = []
    for i, raw in enumerate(data.get("context") or []):
        if not isinstance(raw, dict):
            raise CaseError(f"{where}: context[{i}] must be an object")
        unknown_ctx = sorted(set(raw) - {"source", "label", "route", "rows"})
        if unknown_ctx:
            raise CaseError(f"{where}: context[{i}] unknown key(s) {unknown_ctx}")
        for key in ("source", "label", "route"):
            if not isinstance(raw.get(key), str) or not raw[key].strip():
                raise CaseError(
                    f"{where}: context[{i}].{key} must be a non-empty string"
                )
        if "rows" not in raw:
            raise CaseError(f"{where}: context[{i}].rows is required")
        ctx.append(ContextSource(raw["source"], raw["label"], raw["route"], raw["rows"]))

    source_names = [c.source for c in ctx]
    if len(set(source_names)) != len(source_names):
        raise CaseError(
            f"{where}: the same context source appears twice. Citation markers "
            f"are positional, so two blocks under one name cannot be told apart."
        )

    if data["expect"] == "refusal" and ctx:
        raise CaseError(
            f"{where}: a refusal case carries no context. A refusal is what "
            f"happens when nothing could be read; handing the model the rows "
            f"and then demanding it decline tests nothing that ever occurs."
        )

    must_cite = _as_str_list(data.get("must_cite") or [], f"{where}: must_cite")
    for name in must_cite:
        if name not in source_names:
            raise CaseError(
                f"{where}: must_cite names {name!r}, which is not one of this "
                f"case's context sources {source_names}. A citation the case "
                f"never supplied can only ever fail."
            )

    must_define = _as_str_list(
        data.get("must_define") or [], f"{where}: must_define"
    )
    if must_define:
        # Checked against the SHIPPED term files, the same store `hub.py` reads.
        # `must_define: ["gst"]` when the file is named `gstin` is a check that
        # can only ever fail, and it would sit in the baseline looking like a
        # product defect — the same reasoning as `must_cite` above.
        #
        # Imported here rather than at module scope: this package is loaded by
        # the case editor's `--check` run and by the test suite, and neither
        # should pay for the glossary parse unless a case actually names a term.
        from services import glossary
        known = {term.name for term in glossary.load_terms()}
        for name in must_define:
            if name not in known:
                raise CaseError(
                    f"{where}: must_define names {name!r}, which is not a term "
                    f"in services/glossary_terms/. Known terms: {sorted(known)}. "
                    f"The name is the '# ' heading inside the file, not the "
                    f"filename."
                )

    max_words = data.get("max_words")
    if max_words is not None and (isinstance(max_words, bool) or not isinstance(max_words, int) or max_words < 1):
        raise CaseError(f"{where}: max_words must be a positive whole number")

    is_org = data.get("is_org_question")
    if is_org is not None and not isinstance(is_org, bool):
        raise CaseError(f"{where}: is_org_question must be true or false")

    must_plan = data.get("must_plan")
    must_not_plan = data.get("must_not_plan")

    return Case(
        id=data["id"],
        question=data["question"],
        note=data["note"],
        expect=data["expect"],
        path=path,
        tags=_as_str_list(data.get("tags") or [], f"{where}: tags"),
        must_plan=(
            _as_str_list(must_plan, f"{where}: must_plan")
            if must_plan is not None else None
        ),
        must_not_plan=(
            _as_str_list(must_not_plan, f"{where}: must_not_plan")
            if must_not_plan is not None else None
        ),
        is_org_question=is_org,
        must_define=must_define,
        context=tuple(ctx),
        must_contain=_as_groups(data.get("must_contain") or [], f"{where}: must_contain"),
        must_not_contain=_as_str_list(
            data.get("must_not_contain") or [], f"{where}: must_not_contain"
        ),
        must_cite=must_cite,
        max_words=max_words,
    )


def load_case_file(path: Path) -> Case:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise CaseError(
            f"{path}: not valid JSON — {exc.msg} at line {exc.lineno}, "
            f"column {exc.colno}. The usual cause is a comma after the last "
            f"entry in a list, or a missing quote."
        ) from exc
    return parse_case(data, path=path)


def load_cases(directory: Path = CASES_DIR) -> list[Case]:
    """Every case in a directory, ordered by id, or the first reason one failed.

    Loading is all-or-nothing on purpose. A run that silently drops the two
    files it could not read prints a smaller, greener eval set than the one
    that exists.
    """
    directory = Path(directory)
    if not directory.is_dir():
        raise CaseError(f"{directory}: no such directory")
    paths = sorted(directory.glob("*.json"))
    if not paths:
        raise CaseError(f"{directory}: holds no case files")
    cases = [load_case_file(p) for p in paths]
    ids = [c.id for c in cases]
    dupes = sorted({i for i in ids if ids.count(i) > 1})
    if dupes:
        raise CaseError(f"{directory}: duplicate case id(s) {dupes}")
    return sorted(cases, key=lambda c: c.id)
