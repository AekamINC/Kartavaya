"""Nothing may spend the Google prepay balance.

OWNER, 2026-08-17: "i dont want this cost at all."

Three surfaces can reach `generativelanguage.googleapis.com`, and each is
pinned here by BEHAVIOUR rather than by reading the source. That distinction is
the whole point of the file: a source-scanning assertion is satisfied by the
author's own comment — `test_niyam_*` had three that were — and a comment
explaining that Gemini is off would have passed a text scan while the call went
out anyway.

The environment variable is also deleted from Railway, which is the real
guarantee. These tests exist so that RESTORING the variable does not silently
restore the spend.
"""
import os

import pytest


class _NetworkTouched(BaseException):
    """Deliberately NOT an Exception.

    `rag._embed_gemini` wraps its whole body in `except Exception: return None`,
    so a tripwire raising AssertionError is SWALLOWED and the test passes while
    the call goes out. That is not hypothetical — it is what this file did on
    its first run: sabotaging `generate_embedding` to read the key again broke
    fourteen chain tests and none of the embedding ones. Inheriting from
    BaseException is what makes the tripwire reach the test runner.
    """


# ── 1 · EMBEDDINGS ────────────────────────────────────────────────────────
#
# `services/rag.py::generate_embedding` was the last live reader. It ran on
# every knowledge-base ingest AND every question asked of Sahayak's knowledge
# base, so it was the one path that spent per user action.

@pytest.mark.asyncio
async def test_embedding_makes_no_network_call_even_with_a_key_present(monkeypatch):
    """A key in the environment must not be enough to start spending again.

    The key is set here deliberately: the danger is not an unset variable (that
    spends nothing by definition) but somebody putting it BACK — for the image
    branch, say — and silently re-arming embeddings with it.
    """
    import httpx

    from services import rag

    monkeypatch.setenv("GEMINI_API_KEY", "AIza-not-a-real-key")
    monkeypatch.setenv("OPENROUTER_API_KEY", "sk-or-not-a-real-key")

    def _no(*a, **k):
        raise _NetworkTouched(
            "generate_embedding opened an HTTP client. It must return None "
            "without touching the network — see the docstring in rag.py."
        )

    monkeypatch.setattr(httpx, "AsyncClient", _no)

    # NOT `pytest.raises`-free by accident: the call must simply return.
    assert await rag.generate_embedding("anything at all") is None


@pytest.mark.asyncio
async def test_embedding_is_none_with_no_keys_either(monkeypatch):
    """The no-key case must not differ. Same answer, no warning worth acting on."""
    from services import rag

    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.delenv("OPENROUTER_API_KEY", raising=False)
    assert await rag.generate_embedding("anything at all") is None


def test_the_broken_openrouter_embedding_fallback_is_gone():
    """It posted a model OpenRouter does not have.

    Probed 2026-08-17 with the live key:
        400 {"error":{"message":"Model google/text-embedding-004 does not exist"}}

    So it never returned a vector in its life. Keeping it would leave a reader
    believing embeddings survive the Gemini removal.
    """
    from services import rag

    assert not hasattr(rag, "_embed_openrouter"), (
        "The OpenRouter embedding fallback is back. It cannot work — that model "
        "is not served there. If you have a REAL embedding provider, wire it "
        "into generate_embedding and give it its own test, dimension included."
    )


# ── 2 · TEXT ──────────────────────────────────────────────────────────────
#
# `_select_providers` is the whole routing table. `gemini` is the only provider
# code keyed to GEMINI_API_KEY; the `gemini_*_or` codes are the same MODELS
# billed through OpenRouter and are fine.

def _every_chain():
    from services.ai_router import INDIC_LANGS, PREMIUM_AGENTS, QUALITY_AGENTS, _select_providers

    agents = sorted(PREMIUM_AGENTS | QUALITY_AGENTS | {"social_media", "ad_copy", "whatsapp", ""})
    langs = sorted(INDIC_LANGS | {"en", ""})
    tasks = ["content", "chatbot", ""]
    for a in agents:
        for lg in langs:
            for t in tasks:
                yield (lg, a, t), _select_providers(language=lg, agent_type=a, task=t)


def test_the_input_domain_is_not_empty():
    """pytest SKIPS an empty parametrize set rather than failing it, so the
    generator below has to be proved non-empty on its own."""
    chains = list(_every_chain())
    assert len(chains) >= 100, f"only {len(chains)} chains enumerated"


@pytest.mark.parametrize("case,chain", list(_every_chain()))
def test_no_chain_names_the_direct_gemini_provider(case, chain):
    assert "gemini" not in chain, (
        f"_select_providers{case} returned {chain}. The bare `gemini` code is "
        f"the Google prepay balance. Use `gemini_flash_or` / `gemini_lite_or` / "
        f"`gemini_pro_or` — the same models, billed through OpenRouter."
    )


def test_a_chain_that_did_name_it_would_be_caught():
    """The test above is only worth its runtime if it can fail. Prove it can."""
    with pytest.raises(AssertionError):
        test_no_chain_names_the_direct_gemini_provider(("x",), ["gemini", "groq"])


# ── 3 · IMAGES ────────────────────────────────────────────────────────────

def test_the_imagen_branch_stays_behind_its_flag():
    """The Gemini image call must sit inside an `if` that tests the flag.

    Structural on purpose. A test that searched `generate_image`'s source for
    the string "GEMINI_IMAGE_ENABLED" would be satisfied by the long comment
    above the branch explaining why the flag is there — the comment would
    survive somebody deleting the `if`. So: find the CALL node, walk back up
    the enclosing `if` statements, and require the flag in one of their tests.
    """
    import ast
    import inspect

    import services.ai_router as ar

    tree = ast.parse(inspect.getsource(ar.generate_image))

    parents = {}
    for node in ast.walk(tree):
        for child in ast.iter_child_nodes(node):
            parents[child] = node

    calls = [n for n in ast.walk(tree)
             if isinstance(n, ast.Call)
             and isinstance(n.func, ast.Name)
             and n.func.id == "_generate_gemini_imagen"]
    if not calls:
        return  # branch removed outright — that is stronger, and fine

    for call in calls:
        guards = []
        node = call
        while node in parents:
            node = parents[node]
            if isinstance(node, ast.If):
                guards.append(ast.dump(node.test))
        assert any("GEMINI_IMAGE_ENABLED" in g for g in guards), (
            "_generate_gemini_imagen is reachable without GEMINI_IMAGE_ENABLED. "
            "That key is the Google prepay balance and the owner has asked for "
            "zero spend on it."
        )


async def _ungated_sabotage_example():
    """NEVER CALLED. It exists to give the guard check a known-bad input.

    Written as real code rather than a string so there is no escaping between
    this file and the parser — the point of the check is the SHAPE, and a
    hand-built source string is one more thing that can be wrong.
    """
    result = None
    if result is None:
        return await _generate_gemini_imagen(None, "", "")  # noqa: F821


def test_that_flag_check_would_notice_an_ungated_call():
    """The guard check above is only worth its runtime if it can fail."""
    import ast
    import inspect

    tree = ast.parse(inspect.getsource(_ungated_sabotage_example))
    parents = {}
    for node in ast.walk(tree):
        for child in ast.iter_child_nodes(node):
            parents[child] = node
    call = next(n for n in ast.walk(tree)
                if isinstance(n, ast.Call)
                and getattr(n.func, "id", "") == "_generate_gemini_imagen")
    guards = []
    node = call
    while node in parents:
        node = parents[node]
        if isinstance(node, ast.If):
            guards.append(ast.dump(node.test))

    assert guards, "the sabotage has no enclosing if at all — it proves nothing"
    assert not any("GEMINI_IMAGE_ENABLED" in g for g in guards), (
        "the sabotage accidentally contains the flag; it cannot prove the check"
    )
