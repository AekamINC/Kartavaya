"""
ai_router.py — Multi-provider AI routing for Srijan (सृजन).
Tries providers in priority order (Gemini → Groq → OpenRouter).
Falls back automatically on failure.
"""
import json
import logging
import os
import time
from typing import Optional

import httpx

from db import get_pool

log = logging.getLogger(__name__)

_PROVIDER_KEYS = {
    "gemini": "GEMINI_API_KEY",
    "groq": "GROQ_API_KEY",
    "openrouter": "OPENROUTER_API_KEY",
}

_providers_cache: list | None = None


async def _get_providers() -> list[dict]:
    global _providers_cache
    if _providers_cache is not None:
        return _providers_cache
    pool = await get_pool()
    rows = await pool.fetch(
        "SELECT code, api_base_url, default_model, priority, config "
        "FROM staging.hub_ai_providers WHERE is_active=TRUE ORDER BY priority"
    )
    _providers_cache = [dict(r) for r in rows]
    return _providers_cache


def clear_provider_cache():
    global _providers_cache
    _providers_cache = None


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
    """OpenAI-compatible API call (works for Groq and OpenRouter)."""
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
) -> dict:
    """Generate text using the AI provider chain.
    Returns {"text": str, "provider": str, "model": str, "prompt_tokens": int, "completion_tokens": int}.
    Raises RuntimeError if all providers fail.
    """
    providers = await _get_providers()
    pool = await get_pool()
    last_error = None

    for prov in providers:
        code = prov["code"]
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
