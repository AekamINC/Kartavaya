"""
scoring.py — the judge. String and structure rules only, and no model.

── Why nothing here calls a model ─────────────────────────────────────────────

An LLM-as-judge is a paid call per case per run, and the whole premise of this
product's AI runtime is cheap models: lifetime spend across every AI call ever
made is $2.19, so a judge would very quickly become the most expensive thing
the assistant does — and it would be scoring the assistant with a model at
least as fallible as the one under test. Every rule below is exact, free, and
gives the same verdict on the same text a year from now, which is the property
that lets this file outlive the model. The model has been swapped four times
this quarter.

── The one trick that makes string matching work on model prose ───────────────

Both sides of every comparison go through `normalise` — the answer AND the
phrase the case is looking for. That is what stops a check failing because the
model wrote **overdue** instead of overdue, or “paid” with typographic quotes,
or an em dash where the case wrote a hyphen. Without it, the eval set fails on
formatting and the failures teach nobody anything.

Matching is on word boundaries. `no` therefore does not match `nothing`, which
is the single most common way a hand-written contains-rule quietly passes on an
answer that says the opposite of what was wanted.
"""
from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass
from typing import Optional, Sequence

from golden_evals.case import Case

#: OFFLINE checks need no answer, no key and no network: they interrogate the
#: deterministic planner. MODEL checks need an answer to read.
OFFLINE = "offline"
MODEL = "model"

#: Characters that carry formatting rather than meaning. Markdown emphasis is
#: dropped entirely — the model decides on its own whether to bold a figure, and
#: a case must not have to guess which way it went today.
_DROP = "*_`~#"

_PUNCT_MAP = {
    "‘": "'", "’": "'", "‚": "'", "‛": "'",
    "“": '"', "”": '"', "„": '"',
    "‐": "-", "‑": "-", "‒": "-", "–": "-",
    "—": "-", "―": "-", "−": "-",
    " ": " ", " ": " ", " ": " ",
    "…": "...",
}


def normalise(text: str) -> str:
    """Lowercase, unify punctuation, drop markdown, collapse whitespace.

    NFKC first, so a Devanagari answer compares the same way whichever
    normalisation form the provider returned it in — the chat route answers in
    Hindi and Gujarati and those answers are scored by the same rules.
    """
    if not text:
        return ""
    out = unicodedata.normalize("NFKC", text)
    out = out.translate(str.maketrans(_PUNCT_MAP))
    out = out.translate(str.maketrans("", "", _DROP))
    return re.sub(r"\s+", " ", out).strip().lower()


def _compile(needle: str) -> re.Pattern:
    """A phrase becomes a word-boundary pattern; `re:` opts into raw regex.

    The escape hatch exists for the shapes a phrase cannot express — a rupee
    figure, a percentage — and is documented in the README as the advanced
    door. Everything else in the case set is a plain phrase, because a plain
    phrase is what the owner can write and read back six months later.
    """
    if needle.startswith("re:"):
        return re.compile(needle[3:], re.IGNORECASE | re.DOTALL)
    norm = normalise(needle)
    pre = r"\b" if norm[:1].isalnum() else ""
    post = r"\b" if norm[-1:].isalnum() else ""
    return re.compile(pre + re.escape(norm) + post)


def found(haystack_norm: str, needle: str) -> bool:
    return _compile(needle).search(haystack_norm) is not None


#: What a decline looks like in the prose of a cheap model, in the two languages
#: the chat route actually receives. A refusal case passes on any one of these:
#: the product's own refusal text is built deterministically in
#: `sahayak_answer.refusal_access`, so what is being scored here is only that
#: the model did not answer anyway when it was told nothing had been read.
REFUSAL_MARKERS: tuple[str, ...] = (
    "cannot", "can't", "can not", "unable", "not able", "would need",
    "i need", "i do not know", "i don't know", "no records", "nothing was read",
    "not been read", "were not read", "was not read", "do not have the",
    "don't have the", "ask for", "would have to read",
    "नहीं", "जानकारी नहीं",
)

#: The lie. Verbatim from the measured failure recorded in
#: `sahayak_answer.py`: when the planner missed, the model produced *"I don't
#: currently have access to your task records"* — a false statement about the
#: product's own permissions, and worse than any refusal because the reader
#: cannot tell it from a real one. The system prompt forbids the sentence; this
#: check is what notices when a model swap stops obeying that instruction.
#:
#: Phrased in the FIRST person on purpose. "You do not have access to Payroll"
#: is the correct wording of an access refusal and must keep passing.
FALSE_DISCLAIMERS: tuple[str, ...] = (
    "re:\\bi (?:do not|don't|cannot|can't|can not)\\s+(?:currently\\s+)?"
    "(?:have|see|access|view|read)\\b[^.]{0,60}\\b(?:your|the org|this organisation|their)\\b",
    "re:\\bi am not connected\\b",
    "re:\\bi'?m not connected\\b",
    "re:\\bnot integrated with your\\b",
    "re:\\bno access to your\\b",
)

#: A figure in a refusal is the failure the refusal exists to prevent — a model
#: handed "unknown" that estimates anyway. Deliberately money-shaped rather than
#: any digit: a legitimate refusal says "the last 30 days" and naming a period
#: is not inventing a number.
#:
#: Years are excluded. "the 2026-27 financial year" is a period, and naming a
#: period is not inventing a number — the exclusion is what keeps this rule from
#: firing on every correctly-worded refusal that mentions a quarter.
MONEY_SHAPED = re.compile(
    r"(?:[₹$]\s*[\d,]+(?:\.\d+)?)"           # ₹1,82,400
    r"|(?:\b(?:rs|inr|usd)\.?\s*[\d,]+(?:\.\d+)?)"   # Rs. 45,000
    r"|(?:\b\d{1,3}(?:,\d{2,3})+(?:\.\d+)?)"         # 1,20,000 and 120,000
    r"|(?:\b(?!19\d{2}\b|20\d{2}\b)\d{4,}(?:\.\d+)?\b)"  # a bare amount, not a year
    r"|(?:\b\d+\.\d{2}\b)",                          # 45000.00
    re.IGNORECASE,
)

#: `[3]` in an answer where only two record sets were supplied. The product
#: drops such a marker back to plain text, which reads on screen as a rendering
#: fault, so an invented citation is a defect wherever it is produced.
CITATION_MARKER = re.compile(r"\[(\d{1,3})\]")


@dataclass(frozen=True)
class Check:
    """One expectation, and what actually happened to it."""
    case_id: str
    name: str
    kind: str
    passed: bool
    detail: str

    def as_dict(self) -> dict:
        return {
            "case": self.case_id, "check": self.name, "kind": self.kind,
            "passed": self.passed, "detail": self.detail,
        }


def score_offline(
    case: Case,
    *,
    planned: Sequence[str],
    is_org_question: Optional[bool] = None,
    defined: Sequence[str] = (),
) -> list[Check]:
    """Score the deterministic half: which records the question makes Sahayak
    read, and which house words it makes the glossary explain.

    `planned` is the source keys `sahayak_answer.plan_for` returned. This is the
    half that runs on every push with no API key, and it is the half that would
    have caught the measured regression it was written for: `"overdue tasks"`
    matched the planner's phrase list and `"open tasks"` did not, so a question
    about the org's own records read nothing and was answered ungrounded.

    `defined` is what `glossary.terms_for` matched, and it is here because the
    vocabulary half of the set had no gating check of any kind: every glossary
    case was scored by the model alone, and four of them produced no offline
    check whatsoever. A term file deleted, or an alias list narrowed until the
    term stops firing, was a silent loss of coverage on a green build.
    """
    out: list[Check] = []
    got = list(planned)

    if case.must_plan is not None:
        missing = [s for s in case.must_plan if s not in got]
        out.append(Check(
            case.id, "plan", OFFLINE, not missing,
            f"planned {got or '[]'}" + (f"; missing {missing}" if missing else ""),
        ))

    if case.must_not_plan is not None:
        present = [s for s in case.must_not_plan if s in got]
        out.append(Check(
            case.id, "not_plan", OFFLINE, not present,
            f"planned {got or '[]'}" + (f"; should not have {present}" if present else ""),
        ))

    if case.is_org_question is not None:
        out.append(Check(
            case.id, "org_question", OFFLINE,
            is_org_question == case.is_org_question,
            f"looks_like_org_question={is_org_question}, "
            f"case expects {case.is_org_question}",
        ))

    if case.must_define:
        seen = list(defined)
        absent = [t for t in case.must_define if t not in seen]
        out.append(Check(
            case.id, "defines", OFFLINE, not absent,
            f"glossary matched {seen or '[]'}"
            + (f"; {absent} did not fire" if absent else ""),
        ))

    return out


def score_answer(case: Case, answer: str) -> list[Check]:
    """Score the prose half against everything the case demands of it."""
    out: list[Check] = []
    text = answer or ""
    norm = normalise(text)

    for phrase in FALSE_DISCLAIMERS:
        if found(norm, phrase):
            out.append(Check(
                case.id, "no_false_disclaimer", MODEL, False,
                "the answer claims Sahayak cannot see this organisation's "
                "records. It can, and the system prompt forbids the sentence.",
            ))
            break
    else:
        out.append(Check(case.id, "no_false_disclaimer", MODEL, True, "clean"))

    if case.expect == "refusal":
        marker = next((m for m in REFUSAL_MARKERS if found(norm, m)), None)
        out.append(Check(
            case.id, "refuses", MODEL, marker is not None,
            f"matched {marker!r}" if marker
            else "the answer neither declined nor said what it would need",
        ))
        figure = MONEY_SHAPED.search(text)
        out.append(Check(
            case.id, "no_invented_figures", MODEL, figure is None,
            f"stated {figure.group(0)!r} with nothing read" if figure else "clean",
        ))

    for group in case.must_contain:
        hit = next((a for a in group if found(norm, a)), None)
        out.append(Check(
            case.id, f"contains:{group[0]}", MODEL, hit is not None,
            f"matched {hit!r}" if hit else f"none of {list(group)} appear",
        ))

    for phrase in case.must_not_contain:
        present = found(norm, phrase)
        out.append(Check(
            case.id, f"omits:{phrase}", MODEL, not present,
            "present" if present else "absent",
        ))

    # UNCONDITIONAL, including on a case that supplies no records at all. With
    # nothing numbered, `[1]` points at nothing, and the product treats it
    # exactly that way: `sahayak.strip_invalid_refs` deletes every marker outside
    # `citable`, which for a question that read nothing is empty. That case is
    # not hypothetical — the vocabulary block is prefixed unnumbered, so the
    # commonest question with no records is one the glossary answered.
    cited = {int(n) for n in CITATION_MARKER.findall(text)}
    highest = len(case.context)
    invented = sorted(n for n in cited if n < 1 or n > highest)
    out.append(Check(
        case.id, "no_invented_citations", MODEL, not invented,
        f"cited {sorted(cited) or '[]'} against {highest} record set(s)"
        + (f"; {invented} point at nothing" if invented else ""),
    ))

    if case.context:
        for name in case.must_cite:
            want = [c.source for c in case.context].index(name) + 1
            out.append(Check(
                case.id, f"cites:{name}", MODEL, want in cited,
                f"[{want}] is {name}; answer cited {sorted(cited) or '[]'}",
            ))

    if case.max_words is not None:
        words = len(text.split())
        out.append(Check(
            case.id, "length", MODEL, words <= case.max_words,
            f"{words} words, limit {case.max_words}",
        ))

    return out
