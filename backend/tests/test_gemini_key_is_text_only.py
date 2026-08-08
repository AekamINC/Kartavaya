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
    called = {"gemini-flash-lite-latest", "gemini-flash-latest"}
    for model in called:
        cost = ai_router._estimate_cost(model, prompt_tokens=1_000, completion_tokens=1_000)
        assert cost > 0, (
            f"{model} matched nothing in MODEL_PRICING, so every call on it is "
            f"recorded as free. The spend report will say the chatbot costs "
            f"nothing while Google invoices for it."
        )


def test_the_price_keys_do_not_shadow_each_other():
    """`_estimate_cost` is a substring match, so ordering can mis-price."""
    lite = ai_router._estimate_cost("gemini-flash-lite-latest", 1_000_000, 0)
    full = ai_router._estimate_cost("gemini-flash-latest", 1_000_000, 0)
    assert lite < full, (
        "The lite model is priced at or above the full one, which means a key "
        "in MODEL_PRICING is matching the wrong model by substring."
    )
