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
import uuid
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
            if org_id:
                await pool.execute(
                    "INSERT INTO staging.usage_tracking (org_id, metric, value, recorded_at) "
                    "VALUES ($1::uuid, 'ai_calls', 1, CURRENT_DATE) "
                    "ON CONFLICT (org_id, metric, recorded_at) "
                    "DO UPDATE SET value = staging.usage_tracking.value + 1",
                    org_id,
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


# ── Image Generation ─────────────────────────────────────────

async def generate_image(
    prompt: str,
    style: str = "auto",
    aspect_ratio: str = "1:1",
    org_id: Optional[str] = None,
) -> dict:
    """Generate image via: HuggingFace → Gemini Flash Image → FLUX.2 Pro → Recraft → Gemini native. Uploads to R2."""
    import base64 as b64mod
    from services.storage import upload_file

    pool = await get_pool()
    result = None
    start = time.monotonic()
    log.info("generate_image: prompt=%s, hf=%s, or=%s", prompt[:60], bool(os.getenv("HF_API_KEY")), bool(os.getenv("OPENROUTER_API_KEY")))

    # 1. HuggingFace Flux Dev (free, high quality)
    hf_key = os.getenv("HF_API_KEY", "")
    if hf_key and result is None:
        try:
            result = await _generate_hf_image(hf_key, prompt)
        except Exception as e:
            log.warning("HuggingFace Flux Dev failed: %s", e)

    # 2. OpenRouter Gemini Flash Image (cheap, good quality)
    or_key = os.getenv("OPENROUTER_API_KEY", "")
    if or_key and result is None:
        try:
            result = await _generate_openrouter_image(or_key, prompt, aspect_ratio, "google/gemini-3.1-flash-lite-image")
        except Exception as e:
            log.warning("OpenRouter Gemini Flash Image failed: %s", e)

    # 3. OpenRouter FLUX.2 Pro (high quality)
    if or_key and result is None:
        try:
            result = await _generate_openrouter_image(or_key, prompt, aspect_ratio, "black-forest-labs/flux.2-pro")
        except Exception as e:
            log.warning("OpenRouter FLUX.2 Pro failed: %s", e)

    # 4. OpenRouter Recraft V4 (good for marketing/design)
    if or_key and result is None:
        try:
            result = await _generate_openrouter_image(or_key, prompt, aspect_ratio, "recraft/recraft-v4")
        except Exception as e:
            log.warning("OpenRouter Recraft V4 failed: %s", e)

    # 5. Gemini native (last resort)
    if result is None:
        gemini_key = os.getenv("GEMINI_API_KEY", "")
        if gemini_key:
            try:
                result = await _generate_gemini_imagen(gemini_key, prompt, aspect_ratio)
            except Exception as e:
                log.warning("Gemini Imagen failed: %s", e)

    if result is None:
        raise RuntimeError("All image providers failed")

    latency = int((time.monotonic() - start) * 1000)
    img_bytes = b64mod.b64decode(result["image_b64"])
    upload = await upload_file(
        file_bytes=img_bytes,
        filename=f"srijan-{uuid.uuid4().hex[:8]}.png",
        content_type="image/png",
        user_id="system",
        folder="srijan/images",
        org_id=org_id,
    )
    result["image_url"] = upload["url"]
    del result["image_b64"]

    await pool.execute(
        "INSERT INTO staging.hub_ai_logs "
        "(org_id, provider, model, prompt_tokens, completion_tokens, "
        " latency_ms, status, cost_usd) "
        "VALUES ($1::uuid, $2, $3, 0, 0, $4, 'success', $5)",
        org_id, result["provider"], result["model"], latency, result.get("cost_usd", 0.0),
    )
    if org_id:
        await pool.execute(
            "INSERT INTO staging.usage_tracking (org_id, metric, value, recorded_at) "
            "VALUES ($1::uuid, 'ai_calls', 1, CURRENT_DATE) "
            "ON CONFLICT (org_id, metric, recorded_at) "
            "DO UPDATE SET value = staging.usage_tracking.value + 1",
            org_id,
        )
    return result


async def _generate_hf_image(api_key: str, prompt: str) -> dict:
    """Generate image via HuggingFace Inference API — Flux Dev (free tier)."""
    async with httpx.AsyncClient(timeout=180) as client:
        resp = await client.post(
            "https://router.huggingface.co/hf-inference/models/black-forest-labs/FLUX.1-dev",
            headers={"Authorization": f"Bearer {api_key}"},
            json={"inputs": prompt},
        )
        resp.raise_for_status()
        img_bytes = resp.content

    import base64 as b64mod
    return {
        "image_b64": b64mod.b64encode(img_bytes).decode(),
        "provider": "huggingface",
        "model": "FLUX.1-dev",
        "cost_usd": 0.0,
    }


async def _generate_openrouter_image(api_key: str, prompt: str, aspect_ratio: str = "1:1", model: str = "black-forest-labs/flux-pro-1.1") -> dict:
    """Generate image via OpenRouter Images API — Flux Pro or Ideogram."""
    async with httpx.AsyncClient(timeout=120) as client:
        resp = await client.post(
            "https://openrouter.ai/api/v1/images/generations",
            headers={"Authorization": f"Bearer {api_key}"},
            json={
                "model": model,
                "prompt": prompt,
                "n": 1,
                "aspect_ratio": aspect_ratio,
                "output_format": "png",
            },
        )
        resp.raise_for_status()
        data = resp.json()

    b64 = data["data"][0]["b64_json"]
    cost = data.get("usage", {}).get("cost", 0.04)
    return {
        "image_b64": b64,
        "provider": f"openrouter",
        "model": model,
        "cost_usd": cost,
    }


async def _generate_gemini_imagen(api_key: str, prompt: str, aspect_ratio: str = "1:1") -> dict:
    """Generate image via Gemini native image generation (last resort)."""
    url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key={api_key}"

    async with httpx.AsyncClient(timeout=120) as client:
        resp = await client.post(url, json={
            "contents": [{"parts": [{"text": f"Generate an image: {prompt}"}]}],
            "generationConfig": {"responseModalities": ["TEXT", "IMAGE"]},
        })
        resp.raise_for_status()
        data = resp.json()

    for part in data.get("candidates", [{}])[0].get("content", {}).get("parts", []):
        if "inlineData" in part:
            b64 = part["inlineData"]["data"]
            return {
                "image_b64": b64,
                "provider": "gemini_native",
                "model": "gemini-2.0-flash-exp",
                "cost_usd": 0.0,
            }

    raise RuntimeError("Gemini returned no image in response")


# ── Rich content generation (text + image in one call) ─────

RICH_CONTENT_MODEL = "google/gemini-3.1-flash-lite-image"
RICH_CONTENT_FALLBACK = "google/gemini-3.1-flash-image"


async def generate_rich_content(
    prompt: str,
    system: str = "",
    max_tokens: int = 4096,
    org_id: Optional[str] = None,
) -> dict:
    """Generate rich content with text + image using Gemini's native image model.
    Returns {"text": str, "images": [{"url": str, "mime": str}], ...}."""
    import base64 as b64mod
    from services.storage import upload_file

    or_key = os.getenv("OPENROUTER_API_KEY", "")
    if not or_key:
        raise RuntimeError("OPENROUTER_API_KEY not set")

    messages = []
    if system:
        messages.append({"role": "system", "content": system})
    messages.append({"role": "user", "content": prompt})

    last_error = None
    for model in [RICH_CONTENT_MODEL, RICH_CONTENT_FALLBACK]:
        start = time.monotonic()
        try:
            async with httpx.AsyncClient(timeout=120) as client:
                resp = await client.post(
                    "https://openrouter.ai/api/v1/chat/completions",
                    headers={
                        "Authorization": f"Bearer {or_key}",
                        "Content-Type": "application/json",
                    },
                    json={
                        "model": model,
                        "messages": messages,
                        "max_tokens": max_tokens,
                        "temperature": 0.8,
                    },
                )
                resp.raise_for_status()
                data = resp.json()

            latency = int((time.monotonic() - start) * 1000)
            choice = data["choices"][0]
            usage = data.get("usage", {})
            cost_usd = float(usage.get("cost", 0) or 0)
            if not cost_usd:
                cost_usd = _estimate_cost(model, usage.get("prompt_tokens", 0), usage.get("completion_tokens", 0))

            content = choice["message"].get("content", "")
            text_parts = []
            images = []

            if isinstance(content, list):
                for part in content:
                    if isinstance(part, dict):
                        if part.get("type") == "text":
                            text_parts.append(part["text"])
                        elif part.get("type") == "image_url":
                            img_url = part.get("image_url", {}).get("url", "")
                            if img_url.startswith("data:"):
                                mime, b64_data = img_url.split(";base64,", 1)
                                mime = mime.replace("data:", "")
                                ext = "png" if "png" in mime else "jpg"
                                img_bytes = b64mod.b64decode(b64_data)
                                upload = await upload_file(
                                    file_bytes=img_bytes,
                                    filename=f"srijan-{uuid.uuid4().hex[:8]}.{ext}",
                                    content_type=mime,
                                    user_id="system",
                                    folder="srijan/images",
                                    org_id=org_id,
                                )
                                images.append({"url": upload["url"], "mime": mime})
                            else:
                                images.append({"url": img_url, "mime": "image/png"})
                    elif isinstance(part, str):
                        text_parts.append(part)
            else:
                text_parts.append(str(content))

            pool = await get_pool()
            await pool.execute(
                "INSERT INTO staging.hub_ai_logs "
                "(org_id, provider, model, prompt_tokens, completion_tokens, "
                " latency_ms, status, cost_usd, generation_id) "
                "VALUES ($1::uuid, $2, $3, $4, $5, $6, 'success', $7, $8)",
                org_id, "openrouter", model,
                usage.get("prompt_tokens", 0), usage.get("completion_tokens", 0),
                latency, cost_usd, data.get("id", ""),
            )
            if org_id:
                await pool.execute(
                    "INSERT INTO staging.usage_tracking (org_id, metric, value, recorded_at) "
                    "VALUES ($1::uuid, 'ai_calls', 1, CURRENT_DATE) "
                    "ON CONFLICT (org_id, metric, recorded_at) "
                    "DO UPDATE SET value = staging.usage_tracking.value + 1",
                    org_id,
                )

            return {
                "text": "\n".join(text_parts),
                "images": images,
                "provider": "openrouter",
                "model": model,
                "prompt_tokens": usage.get("prompt_tokens", 0),
                "completion_tokens": usage.get("completion_tokens", 0),
                "cost_usd": cost_usd,
            }

        except Exception as e:
            last_error = e
            log.warning("Rich content model %s failed: %s", model, e)

    # Fallback: generate text + image separately
    log.info("Falling back to separate text + image generation")
    text_result = await generate(prompt=prompt, system=system, max_tokens=max_tokens,
                                  language="en", agent_type="social_media")
    image_result = await generate_image(prompt=f"Create a professional image for: {prompt[:200]}",
                                         org_id=org_id)
    return {
        "text": text_result["text"],
        "images": [{"url": image_result["image_url"], "mime": "image/png"}],
        "provider": text_result["provider"],
        "model": text_result["model"],
        "prompt_tokens": text_result["prompt_tokens"],
        "completion_tokens": text_result["completion_tokens"],
        "cost_usd": text_result.get("cost_usd", 0) + image_result.get("cost_usd", 0),
    }


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
    "image": 3,
}

CREDIT_PRICE_INR = 4


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


async def _maybe_reset_monthly_credits(conn, org_id: str):
    """Reset credits to plan default if we've crossed into a new month. No carry-over."""
    from datetime import datetime, timezone
    now = datetime.now(timezone.utc)
    wallet = await conn.fetchrow(
        "SELECT credits_reset_at FROM staging.hub_org_credits WHERE org_id=$1::uuid",
        org_id,
    )
    if not wallet or not wallet["credits_reset_at"]:
        return
    last_reset = wallet["credits_reset_at"]
    if last_reset.year == now.year and last_reset.month == now.month:
        return
    plan_credits = await conn.fetchval(
        "SELECT p.default_credits FROM staging.plans p "
        "JOIN staging.subscriptions s ON s.plan_id = p.id "
        "WHERE s.org_id=$1::uuid AND s.status='active' LIMIT 1",
        org_id,
    )
    if not plan_credits:
        return
    await conn.execute(
        "UPDATE staging.hub_org_credits SET balance=$1, credits_reset_at=NOW(), updated_at=NOW() "
        "WHERE org_id=$2::uuid",
        plan_credits, org_id,
    )
    await conn.execute(
        "INSERT INTO staging.hub_org_credit_transactions "
        "(org_id, amount, balance_after, tx_type, description) "
        "VALUES ($1::uuid, $2, $2, 'reset', 'Monthly credit reset')",
        org_id, plan_credits,
    )


async def deduct_org_credits(org_id: str, user_id: str, agent_type: str, description: str = "") -> int:
    """Deduct credits from org wallet + user allocation. Returns new org balance.
    Checks user allocation first, then deducts from org wallet.
    Auto-resets credits at month boundary (no carry-over)."""
    cost = CREDIT_COSTS.get(agent_type, 2)
    pool = await get_pool()
    from fastapi import HTTPException

    async with pool.acquire() as conn:
        async with conn.transaction():
            await _maybe_reset_monthly_credits(conn, org_id)

            user_wallet = await conn.fetchrow(
                "SELECT allocated, used FROM staging.hub_user_credits "
                "WHERE org_id=$1::uuid AND user_id=$2 FOR UPDATE",
                org_id, user_id,
            )
            if user_wallet:
                remaining = user_wallet["allocated"] - user_wallet["used"]
                if remaining < cost:
                    raise HTTPException(402, f"Insufficient credits. Need {cost}, have {remaining} allocated")
                await conn.execute(
                    "UPDATE staging.hub_user_credits SET used=used+$1, updated_at=NOW() "
                    "WHERE org_id=$2::uuid AND user_id=$3",
                    cost, org_id, user_id,
                )

            org_wallet = await conn.fetchrow(
                "SELECT balance FROM staging.hub_org_credits "
                "WHERE org_id=$1::uuid FOR UPDATE",
                org_id,
            )
            if not org_wallet:
                raise HTTPException(402, "No credit wallet — contact your admin to activate credits")
            if org_wallet["balance"] < cost:
                raise HTTPException(402, f"Credits exhausted. Contact Aekam to top up. Need {cost}, have {org_wallet['balance']}")

            new_balance = org_wallet["balance"] - cost
            await conn.execute(
                "UPDATE staging.hub_org_credits SET balance=$1, updated_at=NOW() "
                "WHERE org_id=$2::uuid",
                new_balance, org_id,
            )
            await conn.execute(
                "INSERT INTO staging.hub_org_credit_transactions "
                "(org_id, user_id, amount, balance_after, tx_type, description, created_by) "
                "VALUES ($1::uuid, $2, $3, $4, 'debit', $5, $2)",
                org_id, user_id, -cost, new_balance,
                description or f"{agent_type} generation",
            )

    return new_balance
