"""
ai_router.py — Smart multi-provider AI routing for Srijan (सृजन).
Routes by language + task type:
  - Indic languages → Gemini 2.5 Flash Lite (free, strong Indic support)
  - English bulk (social, ads) → GLM-4.5-Air (free)
  - English quality (blog, email, lead magnet) → Qwen3.6 Flash
  - Chatbot/RAG → Qwen3.5 Plus
  - Premium (campaign/SEO) → Gemini 2.5 Pro
  - Fallback chain → Gemini Flash → Groq Llama

Cost tracking: actual USD cost is extracted from OpenRouter response headers
and logged per generation for real spend analytics.
"""
import json
import logging
import os
import time
from typing import Optional

import httpx

from db import get_pool

log = logging.getLogger(__name__)

INDIC_LANGS = {"hi", "gu", "bn", "ta", "te", "kn", "ml", "mr", "or", "pa"}
QUALITY_AGENTS = {"blog", "email", "lead_magnet"}
PREMIUM_AGENTS = {"campaign", "seo"}

# Per-token pricing (USD per 1 token) — updated from OpenRouter, used for estimation when headers missing
MODEL_PRICING = {
    "google/gemini-2.5-flash-lite-preview": {"prompt": 0.0, "completion": 0.0},
    "glm-4-air": {"prompt": 0.0, "completion": 0.0},
    "qwen/qwen3-30b-a3b": {"prompt": 0.0000001, "completion": 0.0000004},
    "qwen/qwen-plus": {"prompt": 0.0000008, "completion": 0.0000020},
    "google/gemini-2.5-flash-preview": {"prompt": 0.00000015, "completion": 0.0000006},
    "google/gemini-2.5-pro-preview": {"prompt": 0.0000025, "completion": 0.000015},
    "gemini-2.0-flash": {"prompt": 0.0000001, "completion": 0.0000004},
    "llama-3.3-70b-versatile": {"prompt": 0.00000059, "completion": 0.00000079},
}

_PROVIDER_KEYS = {
    "gemini_lite_or": "OPENROUTER_API_KEY",
    "glm": "OPENROUTER_API_KEY",
    "qwen_flash": "OPENROUTER_API_KEY",
    "qwen_plus": "OPENROUTER_API_KEY",
    "gemini_flash_or": "OPENROUTER_API_KEY",
    "gemini_pro_or": "OPENROUTER_API_KEY",
    "gemini": "GEMINI_API_KEY",
    "groq": "GROQ_API_KEY",
}

_providers_cache: dict | None = None


async def _get_providers() -> dict[str, dict]:
    global _providers_cache
    if _providers_cache is not None:
        return _providers_cache
    pool = await get_pool()
    rows = await pool.fetch(
        "SELECT code, api_base_url, default_model, priority, config "
        "FROM staging.hub_ai_providers WHERE is_active=TRUE ORDER BY priority"
    )
    _providers_cache = {r["code"]: dict(r) for r in rows}
    return _providers_cache


def clear_provider_cache():
    global _providers_cache
    _providers_cache = None


def _select_providers(language: str = "en", agent_type: str = "social_media", task: str = "content") -> list[str]:
    """Return ordered list of provider codes based on language, agent type, and task."""
    # Campaign & SEO — always use best model regardless of language
    if agent_type in PREMIUM_AGENTS:
        return ["gemini_pro_or", "gemini_flash_or", "qwen_flash", "gemini", "groq"]

    if task == "chatbot":
        return ["gemini", "qwen_plus", "qwen_flash", "gemini_lite_or", "groq"]

    if language in INDIC_LANGS:
        if agent_type in QUALITY_AGENTS:
            return ["gemini_flash_or", "gemini_lite_or", "qwen_flash", "gemini", "groq"]
        return ["gemini_lite_or", "gemini_flash_or", "qwen_flash", "gemini", "groq"]

    if agent_type in QUALITY_AGENTS:
        return ["qwen_flash", "glm", "gemini", "groq"]

    # English bulk (social_media, ad_copy, whatsapp)
    return ["glm", "qwen_flash", "gemini", "groq"]


async def _call_gemini(api_key: str, base_url: str, model: str, prompt: str, system: str = "", max_tokens: int = 2048, grounded: bool = False) -> dict:
    url = f"{base_url}/models/{model}:generateContent?key={api_key}"
    contents = []
    if system:
        contents.append({"role": "user", "parts": [{"text": system}]})
        contents.append({"role": "model", "parts": [{"text": "Understood. I will follow these instructions."}]})
    contents.append({"role": "user", "parts": [{"text": prompt}]})

    payload = {
        "contents": contents,
        "generationConfig": {"maxOutputTokens": max_tokens, "temperature": 0.7},
    }

    if grounded:
        payload["tools"] = [{"google_search": {}}]

    async with httpx.AsyncClient(timeout=60) as client:
        resp = await client.post(url, json=payload)
        resp.raise_for_status()
        data = resp.json()

    candidate = data["candidates"][0]
    parts = candidate["content"]["parts"]
    text = "".join(p.get("text", "") for p in parts if "text" in p)

    grounding_sources = []
    if grounded:
        grounding_meta = candidate.get("groundingMetadata", {})
        for chunk in grounding_meta.get("groundingChunks", []):
            web = chunk.get("web", {})
            if web.get("uri"):
                grounding_sources.append({"title": web.get("title", ""), "url": web["uri"]})

    usage = data.get("usageMetadata", {})
    prompt_tokens = usage.get("promptTokenCount", 0)
    completion_tokens = usage.get("candidatesTokenCount", 0)
    return {
        "text": text,
        "prompt_tokens": prompt_tokens,
        "completion_tokens": completion_tokens,
        "cost_usd": _estimate_cost(model, prompt_tokens, completion_tokens),
        "generation_id": "",
        "grounding_sources": grounding_sources,
    }


def _estimate_cost(model: str, prompt_tokens: int, completion_tokens: int) -> float:
    """Estimate USD cost from token counts when headers don't provide it."""
    for key, prices in MODEL_PRICING.items():
        if key in model.lower():
            return (prompt_tokens * prices["prompt"]) + (completion_tokens * prices["completion"])
    return 0.0


async def _call_openai_compat(api_key: str, base_url: str, model: str, prompt: str, system: str = "", max_tokens: int = 2048) -> dict:
    """OpenAI-compatible API call (works for Groq, OpenRouter, and all OR-hosted models).
    Extracts actual USD cost from OpenRouter response headers when available."""
    messages = []
    if system:
        messages.append({"role": "system", "content": system})
    messages.append({"role": "user", "content": prompt})

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }

    payload = {
        "model": model,
        "messages": messages,
        "max_tokens": max_tokens,
        "temperature": 0.7,
    }

    async with httpx.AsyncClient(timeout=60) as client:
        resp = await client.post(f"{base_url}/chat/completions", json=payload, headers=headers)
        resp.raise_for_status()
        data = resp.json()

    choice = data["choices"][0]
    usage = data.get("usage", {})
    prompt_tokens = usage.get("prompt_tokens", 0)
    completion_tokens = usage.get("completion_tokens", 0)

    # OpenRouter returns actual cost in usage.cost or total_cost
    cost_usd = 0.0
    if usage.get("cost") is not None:
        cost_usd = float(usage["cost"])
    elif usage.get("total_cost") is not None:
        cost_usd = float(usage["total_cost"])
    elif data.get("usage", {}).get("cost") is not None:
        cost_usd = float(data["usage"]["cost"])
    else:
        cost_usd = _estimate_cost(model, prompt_tokens, completion_tokens)

    generation_id = data.get("id", "")

    return {
        "text": choice["message"]["content"],
        "prompt_tokens": prompt_tokens,
        "completion_tokens": completion_tokens,
        "cost_usd": cost_usd,
        "generation_id": generation_id,
    }


async def generate(
    prompt: str,
    system: str = "",
    client_id: Optional[str] = None,
    max_tokens: int = 2048,
    language: str = "en",
    agent_type: str = "social_media",
    task: str = "content",
) -> dict:
    """Generate text using smart provider routing.
    Routes based on language (Indic → Sarvam-M), task type (quality → Qwen),
    and falls back through the chain on failure.
    Returns {"text", "provider", "model", "prompt_tokens", "completion_tokens"}.
    """
    all_providers = await _get_providers()
    pool = await get_pool()
    last_error = None

    provider_order = _select_providers(language, agent_type, task)

    for code in provider_order:
        prov = all_providers.get(code)
        if not prov:
            continue

        env_key = _PROVIDER_KEYS.get(code)
        api_key = os.getenv(env_key, "") if env_key else ""
        if not api_key:
            continue

        model = prov["default_model"]
        start = time.monotonic()

        try:
            if code == "gemini":
                use_grounding = task == "chatbot"
                result = await _call_gemini(api_key, prov["api_base_url"], model, prompt, system, max_tokens, grounded=use_grounding)
            else:
                result = await _call_openai_compat(api_key, prov["api_base_url"], model, prompt, system, max_tokens)

            latency = int((time.monotonic() - start) * 1000)
            cost_usd = result.get("cost_usd", 0.0)

            await pool.execute(
                "INSERT INTO staging.hub_ai_logs "
                "(client_id, provider, model, prompt_tokens, completion_tokens, "
                " latency_ms, status, cost_usd, generation_id) "
                "VALUES ($1::uuid, $2, $3, $4, $5, $6, 'success', $7, $8)",
                client_id, code, model,
                result["prompt_tokens"], result["completion_tokens"],
                latency, cost_usd, result.get("generation_id", ""),
            )

            return {
                "text": result["text"],
                "provider": code,
                "model": model,
                "prompt_tokens": result["prompt_tokens"],
                "completion_tokens": result["completion_tokens"],
                "cost_usd": cost_usd,
            }

        except Exception as e:
            latency = int((time.monotonic() - start) * 1000)
            last_error = e
            log.warning("AI provider %s failed: %s", code, e)

            await pool.execute(
                "INSERT INTO staging.hub_ai_logs "
                "(client_id, provider, model, latency_ms, status, error_message) "
                "VALUES ($1::uuid, $2, $3, $4, 'error', $5)",
                client_id, code, model, latency, str(e)[:500],
            )

    raise RuntimeError(f"All AI providers failed. Last error: {last_error}")


# ── Credit cost per agent type ──────────────────────────────
CREDIT_COSTS = {
    "social_media": 2,
    "blog": 5,
    "ad_copy": 3,
    "email": 2,
    "whatsapp": 1,
    "lead_magnet": 8,
    "campaign": 10,
    "seo": 8,
    "ad_analysis": 5,
}


async def deduct_credits(client_id: str, agent_type: str, user_id: str = None) -> int:
    """Deduct credits for an AI generation. Returns new balance.
    Raises HTTPException(402) if insufficient credits."""
    cost = CREDIT_COSTS.get(agent_type, 2)
    pool = await get_pool()

    async with pool.acquire() as conn:
        async with conn.transaction():
            wallet = await conn.fetchrow(
                "SELECT balance FROM staging.hub_credit_wallets "
                "WHERE client_id=$1::uuid FOR UPDATE",
                client_id,
            )
            if not wallet:
                from fastapi import HTTPException
                raise HTTPException(404, "Credit wallet not found")

            if wallet["balance"] < cost:
                from fastapi import HTTPException
                raise HTTPException(402, f"Insufficient credits. Need {cost}, have {wallet['balance']}")

            new_balance = wallet["balance"] - cost

            await conn.execute(
                "UPDATE staging.hub_credit_wallets SET balance=$1, updated_at=NOW() "
                "WHERE client_id=$2::uuid",
                new_balance, client_id,
            )

            await conn.execute(
                "INSERT INTO staging.hub_credit_transactions "
                "(client_id, amount, balance_after, tx_type, description, created_by) "
                "VALUES ($1::uuid, $2, $3, 'debit', $4, $5)",
                client_id, -cost, new_balance, f"{agent_type} generation", user_id,
            )

    return new_balance
