"""The house words: what fires, what does not, and what reaches the model.

The glossary is the one part of the assistant a non-developer edits, so its
failure modes are not the usual ones. Nobody breaks it with a bad refactor; it
breaks when a term stops matching the words people actually type, when a file is
saved half-written, or when somebody widens an alias list until every question
carries every definition and the question itself is buried.

Five things are pinned here, in that spirit:

  1. THE SHIPPED FILES PARSE. `read_dir` skips what it cannot read so a
     half-saved file cannot stop the assistant answering — which is the right
     behaviour in production and would be silence in CI. This asserts the
     skipped list is empty, which is what makes the skip safe rather than quiet.

  2. A TERM MATCHES ITS ALIASES, IN BOTH SCRIPTS. The word in the file is almost
     never the word in the question: nobody types "gstin" when they mean PAN,
     nobody types "upi" when they are asking about PhonePe, and a Hindi question
     types none of them in English at all. Matching is on letters, so a glossary
     whose words are all Latin is invisible to every Devanagari question — which
     is the traffic `detect_language` and `INDIC_LANGS` exist for, and which
     arrives: the Hindi case in `golden_evals/cases/` is a real one, asked on
     staging on 2026-08-06.

  3. AN UNRELATED QUESTION CARRIES NOTHING, and neither does a question that
     merely contains a term inside a longer word. Both halves matter — a
     glossary that fires on everything costs latency on every answer and teaches
     nothing, which is the failure this design exists to avoid.

  4. THE CAP HOLDS at `MAX_TERMS`, most specific first.

  5. A CLIENT IS THE COMPANY, AND A MISSING GSTIN BLOCKS NOTHING. The two
     business mistakes this was built for. The first is the one the assistant
     repeats most — asked about a client it answers about a person. The second
     is the one that costs most, because a definition rides FIRST in the prompt
     under a header telling the model that where a general definition disagrees,
     the house one wins: a blocking claim written in here is not one wrong
     answer among several, it is the authority every other one is resolved
     against.

And then the wiring, which is the part that could be perfectly correct and reach
nobody: `_sahayak_answer` is the shared pipeline behind both `POST /chat` and
`POST /chat/stream`, so the injection is asserted to live there and nowhere
else, and asserted end to end to arrive in the prompt a provider is handed.
"""
from __future__ import annotations

import inspect
import re

import pytest

from routers import hub
from services import glossary

from tests.test_sahayak_answer import (  # noqa: F401 — fixtures, used by name
    ask, bypass_module_gate, grants, reads, rows_for_receivables, wired,
)


def _named(terms) -> set[str]:
    return {t.name for t in terms}


#: The one Indic block `glossary._NOT_WORD` keeps as letters. Hindi and Marathi
#: share it exactly, and between them they are the Indic traffic this product
#: actually sees.
_DEVANAGARI = re.compile(r"[ऀ-ॿ]")


# ── 1 · the files the owner edits ───────────────────────────────────────────

def test_every_shipped_term_file_parses():
    """A skipped file is invisible at runtime by design. Here it is loud."""
    terms, skipped = glossary.read_dir(glossary.TERMS_DIR)
    assert not skipped, f"unreadable term files: {', '.join(skipped)}"
    assert len(terms) >= 8, "the glossary is thinner than the rules it exists for"


def test_every_term_says_what_it_means_and_what_would_be_wrong():
    """The wrong answer is not decoration — it is the half that works.

    `sahayak_answer.system_prompt` names the sentence it does not want written
    rather than describing it, because that is what holds on the cheap models
    this route runs on. A term file with no wrong answer gives the model a
    definition and no counterexample.
    """
    for term in glossary.load_terms():
        assert term.meaning, f"{term.source} defines nothing"
        assert term.wrong, f"{term.source} names no wrong answer"
        assert "[1]" not in term.meaning and "[1]" not in term.wrong, (
            f"{term.source} carries a citation marker; vocabulary is not evidence"
        )


def test_notes_in_the_folder_are_not_loaded_as_terms():
    """`_HOW-TO-ADD-A-TERM.md` is the file the owner reads, not one the model does."""
    assert "how to add a term" not in _named(glossary.load_terms())


# ── 2 · a term matches the words people actually type ───────────────────────

@pytest.mark.parametrize("question, expected", [
    ("Where do I put our PhonePe number?", "upi"),
    ("Is a VPA the same as a UPI handle?", "upi"),
    ("Do I have to fill in the PAN before saving?", "gstin"),
    ("How many customers do we have?", "client"),
    ("Can this be signed on Android?", "mobile app"),
    ("What does Graha do?", "module names"),
])
def test_a_term_matches_its_aliases(question, expected):
    assert expected in _named(glossary.terms_for(question)), question


def test_a_term_matches_the_plural_of_its_own_name():
    """`_stem` exists so the owner writes the singular once and is done."""
    assert "contact" in _named(glossary.terms_for("List the contacts at that firm"))


@pytest.mark.parametrize("question, expected", [
    ("इस क्लाइंट का कितना भुगतान बाकी है?", "client"),
    ("मुझे कितना पेमेंट बाकी है?", "paid"),
    ("क्या यह इनवॉइस एडिट हो सकता है?", "doc status"),
    ("हमारा जीएसटी नंबर कहाँ डालें?", "gstin"),
    ("पेटीएम का यूपीआई आईडी कहाँ है?", "upi"),
    ("क्या मोबाइल ऐप से साइन कर सकते हैं?", "esign"),
    ("इस यूजर की भूमिका क्या है?", "role"),
])
def test_a_hindi_question_reaches_the_term_an_english_one_would(question, expected):
    """The half the glossary shipped without, and could not have been seen to.

    `_NOT_WORD` admits the Devanagari range and `_normalise` stems and pads those
    tokens as it does any others, so the machinery was never the gap — the WORDS
    were. Every alias was Latin, so a Hindi question matched nothing at all and
    the failure was silent: the answer came back fluent, in the right script, and
    without the one definition it turned on. "मुझे कितना पेमेंट बाकी है?" is
    exactly the question `paid.md` was written to stop being answered with "the
    invoice will mark itself paid when the customer uses the link".

    The first of these is the real staging question the golden eval carries.
    """
    assert expected in _named(glossary.terms_for(question)), question


def test_a_hindi_question_about_nothing_here_still_carries_nothing():
    """The control, and the reason `module-names.md` has no Hindi spellings.

    The module names are ordinary Hindi words — पहचान is Pahchan and is also
    just "identify" — so a file carrying them would attach the attendance module
    to any sentence that used the word. Widening aliases until every question
    carries a definition is the failure this design exists to avoid, and it is
    reached faster in a script where the product's own names are common nouns.
    """
    for question in ("फ्रांस की राजधानी क्या है?", "पहचान करना जरूरी है क्या?"):
        assert glossary.terms_for(question) == [], question
        assert glossary.for_question(question) == "", question


def test_every_term_carries_the_words_a_hindi_question_would_use():
    """Per file, because a term added later is a term added in English only.

    `module-names.md` is exempt for the reason the control above states: its
    words are common Hindi nouns and the English names are what people type for
    the modules anyway. Anything else without a Devanagari spelling is a
    definition that cannot be reached by a whole class of this product's traffic.
    """
    exempt = {"module names"}
    for term in glossary.load_terms():
        if term.name in exempt:
            continue
        assert any(_DEVANAGARI.search(phrase) for phrase in term.phrases), (
            f"{term.source} carries no Devanagari spelling, so no Hindi or "
            f"Marathi question can reach it — see _HOW-TO-ADD-A-TERM.md"
        )


# ── 3 · and stays out of the way otherwise ──────────────────────────────────

@pytest.mark.parametrize("question", [
    "What is the capital of France?",
    "What is the current RBI repo rate?",
    "Summarise this paragraph in two lines.",
])
def test_an_unrelated_question_injects_nothing(question):
    assert glossary.terms_for(question) == []
    assert glossary.for_question(question) == "", (
        "an empty match must render nothing at all — an empty heading is still "
        "tokens in front of every question the product ever answers"
    )


def test_a_term_does_not_fire_from_inside_a_longer_word():
    """Whole tokens, not substrings.

    `role` and `account` are both bare nouns short enough to sit inside other
    words, and a glossary that fired `role` on "payroll" would attach a lecture
    about per-organisation permissions to every payroll question ever asked.
    """
    fired = _named(glossary.terms_for(
        "Who is the accountant handling this payroll run?"
    ))
    assert "role" not in fired
    assert "client" not in fired


# ── 4 · the cap ─────────────────────────────────────────────────────────────

def test_the_cap_holds_and_keeps_the_most_specific_match():
    """Five house words in one sentence; four definitions come back.

    Ordering is by the length of the phrase that matched, so the term the asker
    reached through a deliberate three-word phrase survives and the one reached
    through a passing noun is what gets dropped.
    """
    question = (
        "For our client, can I edit this final invoice, mark as paid over UPI, "
        "and does the GSTIN have to be filled in first?"
    )
    all_hits = glossary.terms_for(question, limit=99)
    assert len(all_hits) > glossary.MAX_TERMS, (
        "this question no longer touches more terms than the cap, so it proves "
        "nothing about the cap"
    )

    capped = glossary.terms_for(question)
    assert len(capped) == glossary.MAX_TERMS
    assert capped[0].name == "paid", "the three-word phrase lost to a bare noun"
    assert glossary.for_question(question).count("Do not answer like this:") == \
        glossary.MAX_TERMS


# ── 5 · the mistakes this was built for ─────────────────────────────────────

def test_a_question_about_a_client_gets_the_company_not_the_contact():
    """The whole reason for mechanism B, in one assertion.

    "Who is our biggest client" is a question about a COMPANY. The definition
    that reaches the model has to say so, and the contact definition — a person
    at a client — must not be what answers it.
    """
    terms = glossary.terms_for("Who is our biggest client this year?")
    names = _named(terms)
    assert "client" in names
    assert "contact" not in names, (
        "the contact definition was injected for a question about a company"
    )

    block = glossary.for_question("Who is our biggest client this year?")
    assert "COMPANY" in block
    assert "contacts" in block, (
        "the definition must draw the line it exists to draw, not just assert "
        "one side of it"
    )
    assert "Ramesh" in block, "the wrong answer was dropped on the way to the model"


def test_asking_about_a_contact_still_gets_the_contact_definition():
    """The pair. Without it the test above passes against a glossary that has
    simply deleted the contact term."""
    assert "contact" in _named(
        glossary.terms_for("Add a new point of contact for that account")
    )


def test_the_gstin_term_does_not_reinvent_the_blocker_it_exists_to_remove():
    """The rule that keeps drifting back, pinned where it would do most damage.

    A missing GSTIN blocks nothing, in either place it could: `doc_validation`
    puts a blank supplier GSTIN in `advisory` and never in `blocking`, and
    `invoice_pdf` returns an empty ids line and renders the document anyway —
    both on the owner's ruling of 2026-08-03, because a supplier below the
    registration threshold legitimately has none and blocking would stop that
    firm invoicing at all.

    A blocking claim is worse HERE than anywhere else it has appeared. The
    definition is prepended above the records under a header telling the model
    that where a general definition disagrees, the house one is what the software
    does — so the model does not weigh it against what it knows about GST, it
    defers to it, and the answer stops an invoice going out.

    Only `meaning` is searched. The wrong-answer section quotes these sentences
    deliberately, which is the whole mechanism.
    """
    term = next(t for t in glossary.load_terms() if t.name == "gstin")
    lowered = term.meaning.lower()
    for claim in (
        "cannot be produced", "cannot be generated", "cannot be raised",
        "cannot be issued", "is mandatory", "is required", "must be filled",
        "must be entered",
    ):
        assert claim not in lowered, (
            f"{term.source} tells the model a missing GSTIN stops something: "
            f"{claim!r}. It stops nothing — see CLAUDE.md, and the advisory in "
            f"services/doc_validation.py"
        )
    assert "optional" in lowered
    assert "advisory" in lowered, (
        "the definition denies the blocker without saying what does happen "
        "instead, which leaves the model to supply the rest itself"
    )


# ── 6 · what the block looks like ───────────────────────────────────────────

def test_the_block_carries_no_citation_number():
    """`strip_invalid_refs` deletes any `[n]` outside the numbered context.

    A definition carrying one would either be cited at a number pointing at
    somebody's invoice, or have the marker stripped out of the answer and read
    as a rendering fault. The block says it is not citable and contains nothing
    that looks like it is.
    """
    block = glossary.for_question(
        "Can I edit this invoice for our client, and is the GSTIN needed?"
    )
    assert block
    assert re.search(r"\[\d+\]", block) is None
    assert "never cite it" in block


# ── 7 · the wiring, which is the part that could reach nobody ───────────────

def test_the_injection_lives_in_the_pipeline_both_endpoints_share():
    """One call site, and it is inside `_sahayak_answer`.

    `POST /chat` and `POST /chat/stream` are the same code — the two handlers
    differ only in what they do with the events the generator yields. A second
    call site would mean two glossaries drifting apart on the first fix only one
    of them received, and a call site in either handler would mean one endpoint
    answering with vocabulary and the other without.
    """
    whole = inspect.getsource(hub)
    assert whole.count("glossary.for_question(") == 1, \
        "the glossary is injected in more than one place"

    pipeline = inspect.getsource(hub._sahayak_answer)
    assert "glossary.for_question(" in pipeline

    for handler in (hub.sahayak_chat, hub.sahayak_chat_stream):
        assert "glossary" not in inspect.getsource(handler), \
            f"{handler.__name__} builds vocabulary of its own"


@pytest.mark.asyncio
async def test_the_words_reach_the_prompt_ahead_of_the_records(
    api_client, as_member, with_org_id, wired, grants, reads,
):
    """End to end, through the real route, into the arguments a provider gets.

    Ahead of the records deliberately: the readings below talk about invoices
    and clients in this product's sense, and a model that meets those rows
    before it is told what the words mean has already decided what they mean.
    """
    grants["held"] = {"ganit", "graha"}
    reads["receivables"] = {"ok": True, "kind": "simple",
                            "label": "Overdue customer invoices",
                            "data": rows_for_receivables(2), "dropped": 0}

    resp = await ask(api_client, "Is an unpaid invoice locked once it is final?")
    assert resp.status_code == 200
    assert wired["generated"], "no provider was asked, so nothing is proven"

    prompt = wired["generated"][0]["prompt"]
    assert "HOUSE VOCABULARY" in prompt
    assert "DOC STATUS" in prompt, "the term the question was about never arrived"
    assert prompt.index("HOUSE VOCABULARY") < prompt.index("CONTEXT —"), \
        "the definitions arrive after the records they define"


@pytest.mark.asyncio
async def test_a_question_touching_no_term_sends_no_vocabulary(
    api_client, as_member, with_org_id, wired, grants, reads,
):
    """The control for the test above.

    Without it, "the block is in the prompt" passes just as well against a route
    that pastes all eleven definitions in front of every question ever asked —
    which is the expensive failure, and the one nobody would notice.
    """
    grants["held"] = {"ganit", "graha"}
    reads["receivables"] = {"ok": True, "kind": "simple",
                            "label": "Overdue customer invoices",
                            "data": rows_for_receivables(1), "dropped": 0}

    await ask(api_client, "Who owes us money and what have we chased?")
    assert wired["generated"]
    assert "HOUSE VOCABULARY" not in wired["generated"][0]["prompt"]


# ── 8 · a file saved half-written ───────────────────────────────────────────

def test_an_unusable_file_is_skipped_and_the_rest_still_load(tmp_path):
    """The owner edits these live. A bad save costs one term, never the answer."""
    (tmp_path / "good.md").write_text(
        "# widget\n\n## Also called\ngizmo\n\n## What it means here\n"
        "A widget is a thing.\n\n## A wrong answer looks like\nA gadget.\n",
        encoding="utf-8",
    )
    (tmp_path / "half-written.md").write_text("# doohickey\n\n## Also ca",
                                              encoding="utf-8")
    (tmp_path / "empty.md").write_text("", encoding="utf-8")

    terms, skipped = glossary.read_dir(tmp_path)

    assert _named(terms) == {"widget"}
    assert set(skipped) == {"half-written.md", "empty.md"}
    assert "widget" in _named(glossary.terms_for("what about a gizmo", terms=terms))


def test_a_term_with_no_aliases_still_matches_its_own_word():
    term = glossary.parse_term(
        "# reconciliation\n\n## What it means here\nMatching bank lines.\n"
    )
    assert term is not None
    assert term.aliases == ()
    assert glossary.terms_for("explain reconciliation", terms=(term,)) == [term]


def test_a_missing_directory_is_an_empty_glossary_not_a_crash(tmp_path):
    assert glossary.read_dir(tmp_path / "nowhere") == ((), ())
