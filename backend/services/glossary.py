"""
glossary.py — the house words, and what a wrong answer about them sounds like.

Sahayak's business failures are vocabulary failures, not intelligence failures.
Asked about a client it answers about a person; asked whether an invoice can be
corrected it reads "final" as issued and says no; asked about GSTIN it invents a
mandatory field. None of those is a reasoning error. Each is a word whose
meaning inside this product is written down in `CLAUDE.md` and in people's
heads, and nowhere the assistant can reach.

Retrieval was not the missing half either. Measured on 2026-08-19: 90 citations
have ever been made, 77 of them web and 13 data, and NOT ONE from the knowledge
base — so even the one store that could have held these definitions has never
returned a single result to anybody. The words had to be put somewhere the
answer path reads unconditionally, which is here.

── Why files, and why the owner owns them ─────────────────────────────────────

A term is a product decision. It changes on the day the decision changes, it is
written by the person who made it, and it has to be reviewable next to the code
that behaves that way. Files in the repo give all three; a table gives none of
them and would additionally cost a migration on a database staging and
production share.

`glossary_terms/*.md` is therefore the whole store, and its format is fixed by
one requirement — a non-developer edits it without asking anybody. Three
headings, plain prose, no punctuation that can be got wrong. See
`glossary_terms/_HOW-TO-ADD-A-TERM.md`, which is the file the owner actually
reads.

── Why only the terms a question touches, and why at most four ────────────────

A glossary injected in full teaches nothing: ten definitions in front of a
one-line question bury the question, and the model answers the definitions. So
matching is on the term and its aliases, and the cap is `MAX_TERMS = 4`.

Four, specifically:

  · `sahayak_answer.MAX_SOURCES` is already 4. The context block is capped at
    four of this organisation's own record sets, and a vocabulary block larger
    than the records it describes inverts what the answer is grounded on.
  · The measured problem with this assistant is latency, not cost — 7,330 ms
    average answer against $2.19 of lifetime spend. Every injected token is
    time, on the one axis that is actually hurting.
  · A question containing five house words is a question about the product
    rather than about the firm's books. The fifth definition displaces the
    question instead of sharpening it.

Ties are broken by specificity: a multi-word alias is a stronger signal than a
bare noun, so "mark as paid" outranks a stray "client", and the remainder go in
alphabetical order so the same question always produces the same block.

── Why the matching is here and not borrowed from the planner ─────────────────

`sahayak_answer._normalise` does the same job for the intent table, and the two
must be free to move apart. That table is tuned by which SOURCES a question
should read; this one is tuned by which WORDS the owner has had to explain. A
retune of the planner that silently changed which definitions reach the model
would be a change nobody made on purpose.

── Why a broken file is skipped rather than raised ────────────────────────────

The owner edits these directly. A file saved mid-sentence must not be able to
stop the assistant answering, let alone stop the process booting — so a file
that cannot be parsed is dropped with a warning and the rest are served.
Silence would be the wrong other half of that, which is why
`tests/test_glossary.py` fails on any file the loader had to skip: broken in
production for one answer, red in CI until somebody fixes it.
"""
from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

log = logging.getLogger(__name__)

#: The store. Everything in it is a term except files starting with `_`, which
#: are notes for whoever is editing.
TERMS_DIR = Path(__file__).resolve().parent / "glossary_terms"

#: How many definitions may ride along with one question. See the header for why
#: this number and not a larger one.
MAX_TERMS = 4

#: The three sections a term file may carry, keyed by the heading the owner
#: writes. Matched after lowercasing and collapsing spaces, so capitalisation
#: and a stray trailing colon are not mistakes anybody has to be told about.
#: An unrecognised heading is ignored rather than rejected — a note left in a
#: file must not cost the definition beside it.
_SECTIONS: dict[str, str] = {
    "also called": "aliases",
    "what it means here": "meaning",
    "a wrong answer looks like": "wrong",
}

#: Everything that is not a word, in either script this product accepts. Same
#: shape as the planner's, and deliberately its own copy.
_NOT_WORD = re.compile(r"[^0-9a-zऀ-ॿ]+")


def _stem(token: str) -> str:
    """One trailing plural `s`, and nothing else.

    So `client` in a file matches "clients" in a question without the owner
    having to write both. `ss` is excluded so "business" and "address" survive.
    """
    if len(token) > 3 and token.endswith("s") and not token.endswith("ss"):
        return token[:-1]
    return token


def _normalise(text: str) -> str:
    """A lowercased, stemmed, space-padded token string.

    Padded at both ends so a term can be matched with its own spaces around it:
    `" upi "` is in `" what is our upi id "` and is NOT in `" upimart "`. That
    boundary is what lets a bare noun like `role` be a term at all — plain
    substring matching would fire it on "payroll".
    """
    lowered = _NOT_WORD.sub(" ", (text or "").lower())
    return " " + " ".join(_stem(t) for t in lowered.split() if t) + " "


@dataclass(frozen=True)
class Term:
    """One file. `source` is the filename, so a test can name what is wrong."""
    name: str
    aliases: tuple[str, ...]
    meaning: str
    wrong: str
    source: str

    @property
    def phrases(self) -> tuple[str, ...]:
        """Everything a question may be matched on — the word and its aliases."""
        return (self.name,) + self.aliases


def _heading(line: str) -> str:
    return " ".join(line.replace(":", " ").lower().split())


def _paragraph(lines: list[str]) -> str:
    """A section, collapsed to one line.

    The file may be laid out however reads best to the person editing it; what
    the model receives is a paragraph. Preserving the author's line breaks would
    make the injected block's shape depend on how wide somebody's editor was.
    """
    return " ".join(part for part in (ln.strip() for ln in lines) if part)


def parse_term(text: str, source: str = "<memory>") -> Optional[Term]:
    """One file's text into a `Term`, or None if it is not usable.

    Usable means: it names a word, and it says what the word means. Aliases and
    the wrong answer are both allowed to be missing — a term with neither still
    fires on its own name and still tells the model something true.
    """
    name = ""
    body: dict[str, list[str]] = {}
    section: Optional[str] = None

    for raw in (text or "").splitlines():
        line = raw.strip()
        if line.startswith("## "):
            section = _SECTIONS.get(_heading(line[3:]))
            if section is not None:
                body.setdefault(section, [])
            continue
        if line.startswith("# "):
            # The first `# ` is the word. A second one is a heading somebody
            # wrote at the wrong level; it ends the section rather than being
            # swallowed into the middle of a definition.
            if not name:
                name = " ".join(line[2:].split()).lower()
            section = None
            continue
        if section is not None:
            body[section].append(raw)

    meaning = _paragraph(body.get("meaning", []))
    if not name or not meaning:
        return None

    aliases: list[str] = []
    for chunk in _paragraph(body.get("aliases", [])).split(","):
        alias = " ".join(chunk.split()).lower()
        if alias and alias != name and alias not in aliases:
            aliases.append(alias)

    return Term(
        name=name,
        aliases=tuple(aliases),
        meaning=meaning,
        wrong=_paragraph(body.get("wrong", [])),
        source=source,
    )


def read_dir(directory: Path) -> tuple[tuple[Term, ...], tuple[str, ...]]:
    """Every term in a directory, and the names of the files that were skipped.

    The skipped list is the whole point of returning a pair: nothing in the
    answer path looks at it, and the test does.
    """
    terms: list[Term] = []
    skipped: list[str] = []
    directory = Path(directory)
    if not directory.is_dir():
        return (), ()
    for path in sorted(directory.glob("*.md")):
        if path.name.startswith("_"):
            continue
        try:
            term = parse_term(path.read_text(encoding="utf-8"), path.name)
        except OSError as exc:                        # noqa: BLE001 — reported
            log.warning("glossary: could not read %s: %s", path.name, exc)
            skipped.append(path.name)
            continue
        if term is None:
            log.warning(
                "glossary: %s names no word or has no 'What it means here'; "
                "skipped", path.name,
            )
            skipped.append(path.name)
            continue
        terms.append(term)
    return tuple(terms), tuple(skipped)


_CACHE: Optional[tuple[Term, ...]] = None


def load_terms(directory: Optional[Path] = None) -> tuple[Term, ...]:
    """The glossary. Read once for the shipped directory, every time otherwise.

    Caching the shipped set is not an optimisation for the read — it is a dozen
    small files — but for the parse, which would otherwise run on every question
    the product ever answers. A directory passed explicitly is a test's, and
    caching those would make two tests share one glossary.
    """
    global _CACHE
    if directory is not None:
        return read_dir(directory)[0]
    if _CACHE is None:
        _CACHE = read_dir(TERMS_DIR)[0]
    return _CACHE


def terms_for(
    question: str,
    limit: int = MAX_TERMS,
    terms: Optional[tuple[Term, ...]] = None,
) -> list[Term]:
    """The terms this question actually touches, most specific first.

    A term matches when the question contains its word or one of its aliases as
    whole words. Specificity is the length of the longest phrase that matched,
    so a term reached through "mark as paid" outranks one reached through a
    passing "client" — the longer phrase is the one the asker chose deliberately.
    """
    padded = _normalise(question)
    if not padded.strip():
        return []

    scored: list[tuple[int, str, Term]] = []
    for term in (load_terms() if terms is None else terms):
        best = 0
        for phrase in term.phrases:
            norm = _normalise(phrase).strip()
            if norm and f" {norm} " in padded:
                best = max(best, len(norm.split()))
        if best:
            scored.append((best, term.name, term))

    scored.sort(key=lambda row: (-row[0], row[1]))
    return [term for _, _, term in scored[:max(0, limit)]]


def render(terms: list[Term]) -> str:
    """The block that goes in front of the question.

    Carries no `[n]` and says so. The context block below it is numbered, the
    source cards on the screen are numbered to match, and `strip_invalid_refs`
    deletes any marker outside that range — so a definition that looked like a
    citable record would either be cited into a number pointing at somebody's
    invoice, or have its marker stripped and read as a rendering fault.
    """
    if not terms:
        return ""
    out = [
        "HOUSE VOCABULARY — what these words mean inside this product. This is "
        "not a record and carries no [n]: never cite it, and never quote it "
        "back as though it were something that was looked up. Where a general "
        "definition disagrees with one below, the one below is what this "
        "software actually does.",
    ]
    for term in terms:
        out.append(f"\n{term.name.upper()}\n{term.meaning}")
        if term.wrong:
            # Named rather than described, which is how the rest of this
            # assistant's prompt is written: on the cheap models this route
            # runs on, quoting the sentence not to write is more reliable than
            # characterising it. See `sahayak_answer.system_prompt`.
            out.append(f"Do not answer like this: {term.wrong}")
    return "\n".join(out)


def for_question(question: str) -> str:
    """Match and render in one call — what the answer path uses."""
    return render(terms_for(question))
