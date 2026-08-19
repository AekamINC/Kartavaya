"""The provider that actually answers is inside the budget for the task.

WHAT WAS MEASURED, 2026-08-19
-----------------------------
`staging.hub_ai_logs`, all 303 rows since 2026-07-12, split by `status` —
which is the split that changes the answer:

    provider          p50 answer   calls
    gemini               2,642 ms     18   direct; retired, named by no chain
    gemini_flash_or      3,555 ms     19   zero errors ever
    qwen_flash          14,491 ms     94
    qwen_plus           32,545 ms     13
    gemini_pro_or       38,696 ms      5

    glm                  NEVER        84   every call a 400, p50 64 ms
    gemini_lite_or       NEVER        16   every call a 400, p50 41 ms
    groq                 NEVER         0   GROQ_API_KEY is unset on staging

`glm` and `gemini_lite_or` have never answered a question — they point at model
ids OpenRouter rejects, and `thudm/glm-4.5-air:free is not a valid model ID` was
still arriving on 2026-08-19. Both lead chains. So every English answer the
product has given came from whatever stood behind them, and for chat that was
`qwen_plus` at 32.5 seconds a reply.

WHY THE HEAD OF THE CHAIN IS THE WRONG THING TO TEST
-----------------------------------------------------
A gate on `chain[0]` would have passed the whole time and said nothing: the head
was free and fast and was not answering. What decides how long a reader waits is
the FIRST PROVIDER IN THE CHAIN THAT HAS EVER ANSWERED, and that is what these
tests measure. Standing a dead free provider in front of it is allowed, and
bounded — `PROVIDER_REJECTS_MS` says trying those two costs 105 ms between them,
and a rejection that stopped being cheap would fail here rather than becoming a
silent tax on every answer.

WHY THE RATCHET MATTERS MORE THAN THE NUMBERS OF TODAY
------------------------------------------------------
Latency moves; the model has changed four times this quarter. So nothing below
asserts that `gemini_flash_or` is 3,555 ms. It asserts the property: whatever
the tables say, the answering provider must fit its task's budget. Retake the
numbers with `scripts/ai_latency_report.py` and this file names the chains that
have to move as a result.
"""
from __future__ import annotations

import pytest

from services import ai_router as R
from services.ai_router import (
    INDIC_LANGS, LATENCY_BUDGET_MS, PREMIUM_AGENTS, PROVIDER_LATENCY_MS,
    PROVIDER_REJECTS_MS, QUALITY_AGENTS, _apply_latency_budget, _declared_chain,
    _latency_class, _select_providers,
)

#: Every routing decision the product can make. Six languages would be a
#: spot-check; the whole cross-product is the only thing that catches a breach
#: in a combination nobody thinks to look at.
CASES = [
    (lang, agent, task)
    for lang in ["en", *sorted(INDIC_LANGS)]
    for task in ["content", "chatbot"]
    for agent in ["social_media", "chatbot", *sorted(QUALITY_AGENTS),
                  *sorted(PREMIUM_AGENTS)]
]


def budget_for(agent: str, task: str) -> int:
    return LATENCY_BUDGET_MS[_latency_class(agent, task)]


def answerer(chain: list[str]) -> tuple[int, str]:
    """Position and code of the first provider in `chain` that has ever answered.

    Not `chain[0]`. See the module docstring: for most of this product's life
    `chain[0]` was a provider returning 400s in 64 ms, and every assertion about
    it was true and irrelevant.
    """
    for i, code in enumerate(chain):
        if code in PROVIDER_LATENCY_MS:
            return i, code
    raise AssertionError(f"{chain} contains no provider that has ever answered")


# ══════════════════════════════════════════════════════════════════════════
# the ratchet
# ══════════════════════════════════════════════════════════════════════════

@pytest.mark.parametrize("lang,agent,task", CASES)
def test_the_provider_that_answers_is_inside_the_budget(lang, agent, task):
    """THE GATE. Whoever answers first sets what the reader waits, and the
    reader of a chat message is not the reader of a campaign brief."""
    chain = _select_providers(language=lang, agent_type=agent, task=task)
    _, code = answerer(chain)
    budget = budget_for(agent, task)
    measured = PROVIDER_LATENCY_MS[code]

    assert measured <= budget, (
        f"({lang}, {agent}, {task}) is answered by {code!r} at {measured:,} ms "
        f"against a {budget:,} ms budget — chain {chain}. Either re-order it in "
        f"`_declared_chain`, or, if the task really can wait that long, change "
        f"its class in `_latency_class` and say why there."
    )


@pytest.mark.parametrize("lang,agent,task", CASES)
def test_every_chain_can_answer_at_all(lang, agent, task):
    """A chain of providers that have only ever returned 400s is not a fallback
    chain, it is an outage with steps. Two of the eight providers are in that
    state right now, which is why this is a test and not an assumption."""
    chain = _select_providers(language=lang, agent_type=agent, task=task)
    working = [c for c in chain if c in PROVIDER_LATENCY_MS]
    assert working, f"({lang}, {agent}, {task}) -> {chain}: none of these has "\
                    f"ever successfully answered a question"


@pytest.mark.parametrize("lang,agent,task", CASES)
def test_only_cheap_known_failures_stand_in_front_of_the_answer(lang, agent, task):
    """Leading with a free provider that 400s in 64 ms is a bet worth taking —
    it costs a rounding error and it pays out the moment somebody corrects the
    model id. Leading with one whose failure is slow, or whose failure has never
    been measured at all, is a tax with no upside.

    So: everything ahead of the answering provider must have a MEASURED
    rejection, and they must sum to under a tenth of the budget.
    """
    chain = _select_providers(language=lang, agent_type=agent, task=task)
    at, code = answerer(chain)
    budget = budget_for(agent, task)

    for ahead in chain[:at]:
        assert ahead in PROVIDER_REJECTS_MS, (
            f"({lang}, {agent}, {task}): {ahead!r} stands in front of {code!r}, "
            f"which does the answering, and nothing measures what trying it "
            f"costs — it has neither answered nor been refused. Measure it "
            f"first (scripts/ai_latency_report.py) or move it behind.")

    wasted = sum(PROVIDER_REJECTS_MS[c] for c in chain[:at])
    assert wasted <= budget // 10, (
        f"({lang}, {agent}, {task}) burns {wasted:,} ms on providers that never "
        f"answer before reaching {code!r} — more than a tenth of the {budget:,} "
        f"ms budget. A free tier is only free while its refusal is instant.")


@pytest.mark.parametrize("lang,agent,task", CASES)
def test_a_chain_never_puts_a_slow_answerer_ahead_of_a_fast_one(lang, agent, task):
    """The first answerer is not the whole story: it is what a reader meets when
    the one before it is rate limited, and 32 seconds is 32 seconds wherever it
    sits.

    Once an over-budget provider appears, everything after it must also be over
    budget or have no answer latency at all. That is the partition
    `_apply_latency_budget` produces, asserted on the OUTPUT of
    `_select_providers` so it tests the mechanism and not the helper.
    """
    chain = _select_providers(language=lang, agent_type=agent, task=task)
    budget = budget_for(agent, task)
    seen_slow: str | None = None
    for code in chain:
        measured = PROVIDER_LATENCY_MS.get(code)
        if measured is not None and measured > budget:
            seen_slow = code
            continue
        assert seen_slow is None or measured is None, (
            f"({lang}, {agent}, {task}) -> {chain}: {code!r} at {measured:,} ms "
            f"is inside the {budget:,} ms budget but sits behind {seen_slow!r}, "
            f"which is not.")


@pytest.mark.parametrize("lang,agent,task", CASES)
def test_a_provider_nothing_measures_is_neither_promoted_nor_demoted(lang, agent, task):
    """The budget may only move a provider on a number somebody measured.

    `_apply_latency_budget` was written as `PROVIDER_LATENCY_MS.get(c, 0)`,
    which scores a provider nobody has ever timed as instant. Indic chat
    declares `[gemini_flash_or, gemini_lite_or, qwen_plus, groq]` — qwen_plus is
    over the interactive budget and is demoted, and `groq` came up to third on
    that nought. So a Gujarati question that got past Gemini was answered by
    Llama 3.3 70B rather than by the fallback the Indic branch had deliberately
    placed ahead of it — in the branch that exists precisely because a model
    reasoning in English answers Gujarati in transliterated mush.

    Demoting on absence would be the same error mirrored, punishing a provider
    for never having been reached. So absence moves nothing in either
    direction, and this asserts the position, not the half.
    """
    declared = _declared_chain(lang, agent, task)
    final = _select_providers(language=lang, agent_type=agent, task=task)

    for code in declared:
        if code in PROVIDER_LATENCY_MS:
            continue
        assert final.index(code) == declared.index(code), (
            f"({lang}, {agent}, {task}): {code!r} was declared at position "
            f"{declared.index(code)} and the latency budget moved it to "
            f"{final.index(code)} — {declared} -> {final}. Nothing has ever "
            f"measured it answering, so there is no number to move it on.")


def test_the_ratchet_is_not_vacuous():
    """Proof the gate would fire, run against an order that deliberately breaks
    it. An assertion that finds nothing looks identical whether it is enforcing
    something or quietly broken."""
    interactive = LATENCY_BUDGET_MS["interactive"]
    assert PROVIDER_LATENCY_MS["gemini_pro_or"] > interactive

    demoted = _apply_latency_budget(["gemini_pro_or", "gemini_flash_or"], interactive)
    assert demoted == ["gemini_flash_or", "gemini_pro_or"], demoted

    # …and under a budget that admits it, the declared order is left alone.
    kept = _apply_latency_budget(["gemini_pro_or", "gemini_flash_or"],
                                 LATENCY_BUDGET_MS["batch"])
    assert kept == ["gemini_pro_or", "gemini_flash_or"], kept

    # The demotion moves the measured provider past the measured one and stops
    # there. `groq` holds its slot: it is the tail of every chain that names it
    # and nothing has ever timed it, so it is not the thing a demotion promotes.
    held = _apply_latency_budget(["gemini_flash_or", "qwen_plus", "groq"], interactive)
    assert held == ["gemini_flash_or", "qwen_plus", "groq"], held
    held = _apply_latency_budget(["qwen_plus", "groq", "gemini_flash_or"], interactive)
    assert held == ["gemini_flash_or", "groq", "qwen_plus"], held

    # The other half: a chain of nothing but providers that never answer is
    # rejected rather than passing for want of a number to compare.
    with pytest.raises(AssertionError):
        answerer(["glm", "gemini_lite_or", "groq"])


# ══════════════════════════════════════════════════════════════════════════
# the budget must not eat the decisions the chains exist for
# ══════════════════════════════════════════════════════════════════════════

def test_the_budget_drops_nothing():
    """A chain that lost its slow tail would turn a rate-limited provider into
    an outage rather than into one wasted round trip. Demotion, never removal."""
    for lang, agent, task in CASES:
        declared = _declared_chain(lang, agent, task)
        final = _select_providers(language=lang, agent_type=agent, task=task)
        assert sorted(final) == sorted(declared), (
            f"({lang}, {agent}, {task}): {sorted(set(declared) - set(final))} "
            f"were declared and are not in the returned chain")


@pytest.mark.parametrize("lang", sorted(INDIC_LANGS))
def test_the_budget_did_not_move_the_indic_lead_off_the_gemini_family(lang):
    """The exact failure mode of bolting a latency pass onto a language decision.

    The Indic branch exists because Qwen Plus "answers a Gujarati question in
    English or in transliterated mush", and the fastest numbers in the whole log
    belong to two providers that are not answering at all — so a naive latency
    sort would hand every Indic chain to a 41 ms rejection and then to whatever
    caught it. `_apply_latency_budget` is a stable partition for this reason.
    """
    for task in ("content", "chatbot"):
        head = _select_providers(language=lang, agent_type="chatbot", task=task)[0]
        assert head.startswith("gemini"), f"{lang}/{task} leads with {head!r}"
        assert head != "gemini", "that is the retired Google-prepay provider"


def test_the_interactive_budget_is_the_tightest_one_any_chain_survives():
    """Why the number is 4,000 and not a rounder, tighter one.

    `gemini_flash_or` at 3,555 ms is the only provider that has ever answered
    anything in under fourteen seconds. A tighter budget would demote it and
    leave every chain — Indic chat included — with no working provider inside
    its own budget at all.
    """
    assert LATENCY_BUDGET_MS["interactive"] > PROVIDER_LATENCY_MS["gemini_flash_or"]
    assert LATENCY_BUDGET_MS["interactive"] < PROVIDER_LATENCY_MS["qwen_flash"]
    faster = [c for c, ms in PROVIDER_LATENCY_MS.items()
              if ms < PROVIDER_LATENCY_MS["gemini_flash_or"]]
    # `gemini`, the retired direct provider, is the only thing quicker, and no
    # chain may name it — see tests/test_no_google_spend.py.
    assert faster == ["gemini"], faster


def test_the_bulk_budget_still_leaves_english_content_a_working_provider():
    """20,000 ms is the smallest round number above `qwen_flash`. Below it,
    English bulk content would have nothing in its chain that answers."""
    assert LATENCY_BUDGET_MS["bulk"] > PROVIDER_LATENCY_MS["qwen_flash"]
    chain = _select_providers(language="en", agent_type="social_media", task="content")
    assert answerer(chain)[1] == "qwen_flash"


# ══════════════════════════════════════════════════════════════════════════
# the decisions, pinned so that changing one costs a test and not a comment
# ══════════════════════════════════════════════════════════════════════════

def test_english_chat_is_no_longer_answered_by_the_slowest_provider_but_one():
    """The measured defect, stated as the sentence that was false.

    English chat led with `glm`, which has never answered, so every English chat
    answer came from `qwen_plus` at a 32,545 ms median — with `gemini_flash_or`
    at 3,555 ms not in the chain at all.
    """
    chain = _select_providers(language="en", agent_type="chatbot", task="chatbot")
    assert chain[0] == "glm", "the free-first decision was dropped"
    assert answerer(chain)[1] == "gemini_flash_or", chain
    # Demoted, not deleted. Qwen Plus is the chatbot chain's strong reasoner and
    # is what distinguishes it from the bulk-caption chain.
    assert "qwen_plus" in chain
    assert chain.index("qwen_flash") < chain.index("qwen_plus"), (
        "of the two providers nobody should meet, the reader meets the slower "
        "one first")


def test_english_quality_content_is_no_longer_written_by_a_fifteen_second_model():
    """Blog, email and lead magnet led with `qwen_flash`, whose long-form median
    is 14,803 ms against `gemini_flash_or`'s 5,914 ms on the same length
    bucket — and 91 of qwen_flash's 94 successes are that long-form traffic."""
    for agent in sorted(QUALITY_AGENTS):
        chain = _select_providers(language="en", agent_type=agent, task="content")
        assert chain[0] == "glm", f"{agent} leads with {chain[0]!r}"
        assert answerer(chain)[1] == "gemini_flash_or", f"{agent}: {chain}"
        assert "qwen_flash" in chain, "the old provider was dropped, not demoted"


def test_the_quality_tier_is_still_a_tier():
    """If English quality returned the bulk chain, the branch would be dead code
    that the next reader deletes — and the tier would be gone without anybody
    deciding so. It differs by which provider answers, which is the whole
    content of the claim that a blog deserves better than a caption does."""
    quality = _select_providers(language="en", agent_type="blog", task="content")
    bulk = _select_providers(language="en", agent_type="social_media", task="content")
    assert quality != bulk
    assert answerer(quality)[1] != answerer(bulk)[1]


def test_english_bulk_content_was_left_alone():
    """`qwen_flash`'s headline 14,491 ms is the long-form work this branch does
    not do; split at 400 completion tokens it answers a short generation in
    1,915 ms. Captions and ad copy are short. A reorder here would buy nothing
    and would cost the cheaper per-token price."""
    assert _select_providers(language="en", agent_type="social_media",
                             task="content") == ["glm", "qwen_flash", "groq"]


def test_campaign_and_seo_are_allowed_to_be_slow_and_nothing_else_is():
    """The one judgement call in this file, and the argument is in
    `_latency_class`: a campaign brief is one deliberate click producing a long
    document, not a turn in a conversation. If that stops being true — if
    campaign is ever streamed into a chat — this test is what has to be edited,
    rather than the comment quietly going stale."""
    for agent in sorted(PREMIUM_AGENTS):
        assert _latency_class(agent, "content") == "batch"
        chain = _select_providers(language="en", agent_type=agent, task="content")
        assert chain[0] == "gemini_pro_or", chain

    slow = PROVIDER_LATENCY_MS["gemini_pro_or"]
    assert slow > LATENCY_BUDGET_MS["interactive"], (
        "the premium model is no longer slow, so the exception it is granted "
        "has nothing left to justify")
    assert LATENCY_BUDGET_MS["batch"] > slow > LATENCY_BUDGET_MS["bulk"]


def test_the_budget_and_the_chain_agree_on_which_branch_won():
    """`_latency_class` and `_declared_chain` both test PREMIUM first, and they
    have to keep doing so. `agent_type="campaign"` with `task="chatbot"` is the
    collision: if the class said "interactive" while the chain came from the
    premium branch, the budget would demote the premium model out of the chain
    it was chosen for, and no other test here would notice."""
    assert _latency_class("campaign", "chatbot") == "batch"
    assert _declared_chain("en", "campaign", "chatbot") == \
        _declared_chain("en", "campaign", "content")
    assert _select_providers(language="en", agent_type="campaign",
                             task="chatbot")[0] == "gemini_pro_or"


# ══════════════════════════════════════════════════════════════════════════
# the structure itself
# ══════════════════════════════════════════════════════════════════════════

def test_routing_reads_no_database():
    """A per-call query to decide routing is itself the latency this mechanism
    exists to remove — and the table it would read, `hub_ai_logs`, is the one
    the call is about to write its own row to.

    `get_pool` is made to raise, and every routing decision is taken anyway.
    """
    def _exploded(*a, **k):
        raise AssertionError("routing touched the database")

    original = R.get_pool
    R.get_pool = _exploded
    try:
        for lang, agent, task in CASES:
            assert _select_providers(language=lang, agent_type=agent, task=task)
    finally:
        R.get_pool = original


def test_every_provider_a_chain_names_is_accounted_for():
    """Keeps both tables in step with the chains, from both sides.

    A provider added to a chain with no entry in either table is invisible to
    every gate above except the one that catches it standing in front of the
    answerer — so it is named here, once, and the exception is a line somebody
    has to write on purpose.
    """
    named: set[str] = set()
    for lang, agent, task in CASES:
        named.update(_declared_chain(lang, agent, task))

    # `groq` has never been called: GROQ_API_KEY is unset on staging, so
    # `generate` skips it without a request. It is a tail fallback in every
    # chain and stands in front of no answerer, which the gate above enforces.
    accounted = set(PROVIDER_LATENCY_MS) | set(PROVIDER_REJECTS_MS) | {"groq"}
    assert not named - accounted, (
        f"{sorted(named - accounted)} are routed to and nothing measures them")

    measured = set(PROVIDER_LATENCY_MS) | set(PROVIDER_REJECTS_MS)
    # The direct `gemini` provider is retired and named by no chain; its figure
    # is kept because re-arming it is a one-line change and 2,642 ms is what
    # says whether that would be a good idea.
    assert measured - named == {"gemini"}, (
        f"{sorted(measured - named)} are measured and unreachable")


def test_a_provider_is_in_one_table_or_the_other_never_both():
    """`PROVIDER_LATENCY_MS` is what a provider costs when it answers;
    `PROVIDER_REJECTS_MS` is what it costs when it has never answered at all. A
    code in both would mean the second table is being used to describe a working
    provider's error rate, which is a different measurement and would let a slow
    provider pass the gate by having a fast failure."""
    assert not set(PROVIDER_LATENCY_MS) & set(PROVIDER_REJECTS_MS)


def test_the_latency_tables_are_flat_positive_integers():
    """`_apply_latency_budget` compares these straight against a budget. A
    string or a None here silently sorts every provider into one half — and the
    tables are edited by hand from a report."""
    for table in (PROVIDER_LATENCY_MS, PROVIDER_REJECTS_MS, LATENCY_BUDGET_MS):
        for key, ms in table.items():
            assert isinstance(ms, int) and ms > 0, key


def test_the_three_budgets_are_ordered():
    """A chat turn may never be given more room than a batch generation. If
    these ever cross, `_latency_class` is returning the wrong name somewhere and
    every gate above is measuring against the wrong number."""
    assert (LATENCY_BUDGET_MS["interactive"]
            < LATENCY_BUDGET_MS["bulk"]
            < LATENCY_BUDGET_MS["batch"])
