"""
ai_router.py — Smart multi-provider AI routing for Srijan (सृजन).
Routes by language + task type:
  - Indic languages → Sarvam-M (free, purpose-built for 11 Indian languages)
  - English bulk (social, ads) → GLM-4.5-Air (free)
  - English quality (blog, email, lead magnet) → Qwen3.6 Flash
  - Chatbot/RAG → Qwen3.5 Plus
  - Fallback chain → Gemini Flash → Groq Llama
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

_PROVIDER_KEYS = {
    "sarvam": "OPENROUTER_API_KEY",
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
        return ["qwen_plus", "qwen_flash", "sarvam", "gemini", "groq"]

    if language in INDIC_LANGS:
        # Deep Indic content (blog, email, lead magnet) → Gemini Flash for quality
        if agent_type in QUALITY_AGENTS:
            return ["gemini_flash_or", "sarvam", "qwen_flash", "gemini", "groq"]
        # Bulk Indic (social, ads, whatsapp) → Sarvam free first
        return ["sarvam", "gemini_flash_or", "qwen_flash", "gemini", "groq"]

    if agent_type in QUALITY_AGENTS:
        return ["qwen_flash", "glm", "gemini", "groq"]

    # English bulk (social_media, ad_copy, whatsapp)
    return ["glm", "qwen_flash", "gemini", "groq"]


async def _call_gemini(api_key: str, base_url: str, model: str, prompt: str, system: str = "", max_tokens: int = 2048) -> dict:
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

    async with httpx.AsyncClient(timeout=60) as client:
        resp = await client.post(url, json=payload)
        resp.raise_for_status()
        data = resp.json()

    text = data["candidates"][0]["content"]["parts"][0]["text"]
    usage = data.get("usageMetadata", {})
    return {
        "text": text,
        "prompt_tokens": usage.get("promptTokenCount", 0),
        "completion_tokens": usage.get("candidatesTokenCount", 0),
    }


async def _call_openai_compat(api_key: str, base_url: str, model: str, prompt: str, system: str = "", max_tokens: int = 2048) -> dict:
    """OpenAI-compatible API call (works for Groq, OpenRouter, and all OR-hosted models)."""
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
    return {
        "text": choice["message"]["content"],
        "prompt_tokens": usage.get("prompt_tokens", 0),
        "completion_tokens": usage.get("completion_tokens", 0),
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
                result = await _call_gemini(api_key, prov["api_base_url"], model, prompt, system, max_tokens)
            else:
                result = await _call_openai_compat(api_key, prov["api_base_url"], model, prompt, system, max_tokens)

            latency = int((time.monotonic() - start) * 1000)

            await pool.execute(
                "INSERT INTO staging.hub_ai_logs "
                "(client_id, provider, model, prompt_tokens, completion_tokens, latency_ms, status) "
                "VALUES ($1::uuid, $2, $3, $4, $5, $6, 'success')",
                client_id, code, model,
                result["prompt_tokens"], result["completion_tokens"], latency,
            )

            return {
                "text": result["text"],
                "provider": code,
                "model": model,
                "prompt_tokens": result["prompt_tokens"],
                "completion_tokens": result["completion_tokens"],
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
}


async def deduct_credits(client_id: str, agent_type: str, user_id: str = None) -> int:
    """Deduct credits for an AI generation. Returns new balance.
    Raises HTTPException(402) if insufficient credits."""
    cost = CREDIT_COSTS.get(agent_type, 2)
    pool = await get_pool()

    wallet = await pool.fetchrow(
        "SELECT balance FROM staging.hub_credit_wallets WHERE client_id=$1::uuid FOR UPDATE",
        client_id,
    )
    if not wallet:
        from fastapi import HTTPException
        raise HTTPException(404, "Credit wallet not found")

    if wallet["balance"] < cost:
        from fastapi import HTTPException
        raise HTTPException(402, f"Insufficient credits. Need {cost}, have {wallet['balance']}")

    new_balance = wallet["balance"] - cost

    await pool.execute(
        "UPDATE staging.hub_credit_wallets SET balance=$1, updated_at=NOW() WHERE client_id=$2::uuid",
        new_balance, client_id,
    )

    await pool.execute(
        "INSERT INTO staging.hub_credit_transactions "
        "(client_id, amount, balance_after, tx_type, description, created_by) "
        "VALUES ($1::uuid, $2, $3, 'debit', $4, $5)",
        client_id, -cost, new_balance, f"{agent_type} generation", user_id,
    )

    return new_balance
