"""The GEMINI_API_KEY is scoped to text. These tests are the fence.

Google gives no way to restrict an AI Studio key per-model: chat, image
generation and the `text-embedding-004` embeddings all sit behind the single
Generative Language API. Restricting the key to that API would kill the chatbot
and RAG along with images. So the restriction lives in our code, and these tests
are what stop it eroding.

Three things are pinned:

  1. Image generation via the Gemini key is OFF unless GEMINI_IMAGE_ENABLED=1.
  2. `_call_gemini` sends TEXT parts only — never `inlineData`/`fileData`, which
     is how an image or PDF would ride in and turn a text call into a multimodal
     one at multimodal prices.
  3. The models we actually call have a price in MODEL_PRICING, so a Gemini call
     is never logged at $0.00 while the Google bill says otherwise.

None of these are theoretical. (3) was real: the table had no entry matching
`gemini-flash-latest`, so `_estimate_cost` fell through to 0.0 for every direct
Gemini call ever made.
"""
from __future__ import annotations

import ast
import inspect
from pathlib import Path

import pytest

from services import ai_router


SOURCE = Path(ai_router.__file__).read_text(encoding="utf-8")


def _fn_source(name: str) -> str:
    """The body of one function, with its docstring stripped.

    Asserting on raw file text matches the explanatory comments that describe
    the very thing being forbidden, which passes for the wrong reason.
    """
    tree = ast.parse(SOURCE)
    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name == name:
            body = list(node.body)
            if (body and isinstance(body[0], ast.Expr)
                    and isinstance(body[0].value, ast.Constant)
                    and isinstance(body[0].value.value, str)):
                body = body[1:]
            return "\n".join(ast.unparse(stmt) for stmt in body)
    raise AssertionError(f"{name} not found in ai_router")


def test_image_generation_on_the_gemini_key_is_off_unless_explicitly_enabled():
    """The last-resort Imagen branch must be behind GEMINI_IMAGE_ENABLED."""
    body = _fn_source("generate_image")
    assert "_generate_gemini_imagen" in body, (
        "The Gemini image fallback was removed entirely. That is fine, but this "
        "test and its GEMINI_IMAGE_ENABLED switch should go with it."
    )
    assert "GEMINI_IMAGE_ENABLED" in body, (
        "The Gemini image branch is reachable without a flag. The GEMINI_API_KEY "
        "is meant to spend on text only — put the branch back behind "
        "os.getenv('GEMINI_IMAGE_ENABLED') == '1'."
    )


@pytest.mark.parametrize("forbidden", ["inlineData", "fileData", "file_data", "inline_data"])
def test_the_chat_call_never_sends_media_parts(forbidden):
    """Text parts only. An image riding in makes it a multimodal call."""
    body = _fn_source("_call_gemini")
    assert forbidden not in body, (
        f"_call_gemini builds a {forbidden!r} part. That turns every chat request "
        f"into a multimodal one on a key that is supposed to be text-only. If "
        f"multimodal input is genuinely wanted, that is a decision to take "
        f"deliberately — and to price — not to acquire by editing this function."
    )


def test_the_models_we_call_all_have_a_price():
    """A model with no MODEL_PRICING entry is logged at $0.00, silently."""
    for model in (ai_router.GEMINI_TEXT_MODEL, ai_router.GEMINI_GROUNDING_MODEL):
        cost = ai_router._estimate_cost(model, prompt_tokens=1_000, completion_tokens=1_000)
        assert cost > 0, (
            f"{model} matched nothing in MODEL_PRICING, so every call on it is "
            f"recorded as free. The spend report will say the chatbot costs "
            f"nothing while Google invoices for it."
        )


def test_the_price_keys_do_not_shadow_each_other():
    """The keys are prefixes of one another, so a first-match scan mis-prices.

    `gemini-2.0-flash` is a substring of `gemini-2.0-flash-lite`. Under a
    first-match scan the Lite model was billed at full Flash rates purely
    because of dict insertion order. `_estimate_cost` takes the LONGEST match
    for this reason.
    """
    # Named models, not the constants — the constants are equal today, so
    # comparing them would prove nothing about the matcher.
    lite = ai_router._estimate_cost("google/gemini-2.5-flash-lite-preview", 1_000_000, 0)
    full = ai_router._estimate_cost("google/gemini-2.5-flash-preview", 1_000_000, 0)
    assert lite < full, (
        "The Lite model is priced at or above the full one. `_estimate_cost` is "
        "matching a shorter key that happens to be a prefix — it must take the "
        "LONGEST matching key, not the first one it meets."
    )


@pytest.mark.parametrize("const", ["GEMINI_TEXT_MODEL", "GEMINI_GROUNDING_MODEL"])
def test_no_floating_aliases(const):
    """`-latest` is a standing order to Google to move us up a price tier.

    `gemini-flash-latest` resolved to 3.6 Flash the moment Google promoted it,
    and the first grounded call that succeeded on it billed £0.04 — a model
    nobody chose, at a price nobody agreed, with no code change to point at.
    Models are pinned by version and upgraded deliberately.
    """
    model = getattr(ai_router, const)
    assert not model.endswith("-latest"), (
        f"{const} is the floating alias {model!r}. Pin the version instead — an "
        f"alias moves us onto Google's newest and dearest model on Google's "
        f"schedule, and the first anyone knows of it is the invoice."
    )


def test_grounding_and_text_are_chosen_separately():
    """The two paths must pick their model independently.

    Deliberately NOT asserting the models differ — today they are equal, because
    grounding 429s on every model on this key and there is nothing to choose
    between. What matters is that the branch still reads the two constants, so
    separating them later is a one-line change rather than a rediscovery.
    """
    body = _fn_source("route_ai_request") if "route_ai_request" in SOURCE else ""
    if body:
        assert "GEMINI_GROUNDING_MODEL" in body and "GEMINI_TEXT_MODEL" in body, (
            "The Gemini branch no longer chooses between the pinned models — it "
            "is probably back on the provider row's default_model, which is "
            "exactly where a `-latest` alias creeps in from the database."
        )
