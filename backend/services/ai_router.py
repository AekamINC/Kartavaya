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

CREDITS ARE NO LONGER PRICED OR MOVED HERE. As of migration 095 there is one
ledger and it lives in `services/credits.py`. The four functions at the foot of
this file — `deduct_credits`, `deduct_org_credits`, `refund_org_credits`,
`_maybe_reset_monthly_credits` — survive only as DEPRECATED WRAPPERS, because
their names are pinned by callers this agent does not own and by
`tests/test_skill_module_access.py`. They hold no money logic. Read
`services/credits.py` for the model; read the block comment above `CREDIT_COSTS`
for why that dict is still here and why nothing may read it.
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

# Display names, for the one caller that has to put a language into a PROMPT
# rather than into a routing decision. Picking a model that handles Gujarati
# does not make it answer in Gujarati; only asking it to does.
LANGUAGE_NAMES = {
    "en": "English", "hi": "Hindi", "gu": "Gujarati", "bn": "Bengali",
    "ta": "Tamil", "te": "Telugu", "kn": "Kannada", "ml": "Malayalam",
    "mr": "Marathi", "or": "Odia", "pa": "Punjabi",
}

# Unicode block → language code, one entry per writing system this product
# routes on. Script detection is sufficient here precisely because these ten
# languages do not share scripts: a Gujarati question arrives in Gujarati script
# and nothing else uses it.
#
# The single collision is Devanagari, which Hindi and Marathi share exactly.
# Nothing short of a real classifier separates them from characters alone, so
# Devanagari maps to "hi". That costs nothing where it matters — both are in
# INDIC_LANGS and `_select_providers` treats them identically — and where it
# does show, in the language NAME handed to the system prompt, the model is
# reading the user's actual Marathi and follows it regardless of the label.
_SCRIPT_RANGES = (
    (0x0900, 0x097F, "hi"),   # Devanagari — Hindi, Marathi
    (0x0980, 0x09FF, "bn"),   # Bengali
    (0x0A00, 0x0A7F, "pa"),   # Gurmukhi — Punjabi
    (0x0A80, 0x0AFF, "gu"),   # Gujarati
    (0x0B00, 0x0B7F, "or"),   # Odia
    (0x0B80, 0x0BFF, "ta"),   # Tamil
    (0x0C00, 0x0C7F, "te"),   # Telugu
    (0x0C80, 0x0CFF, "kn"),   # Kannada
    (0x0D00, 0x0D7F, "ml"),   # Malayalam
)

# How much of a message's alphabet an Indic script has to account for before it
# decides the routing. A majority rule would be wrong in the common direction:
# Indian users write heavily code-mixed and "please મને GST invoice મોકલો" is an
# ordinary sentence with more Latin letters in it than Gujarati ones. The floor
# exists for the opposite case — one pasted name in a long English message must
# not move the whole conversation onto an Indic model.
_SCRIPT_SHARE_FLOOR = 0.20


def detect_language(text: str) -> str:
    """Return a code from INDIC_LANGS, or "en".

    Script detection, not language identification, and deliberately so: it needs
    no model, no network and no dependency, it cannot fail open into a billed
    call, and for the ten languages routing cares about it is very nearly exact.
    An English message with no Indic characters in it can only ever come back
    "en", which is the answer the product has been hard-coding anyway — so the
    worst case of this function is the status quo.

    Counts LETTERS only. Digits, punctuation, whitespace and emoji are evidence
    of nothing: "GSTR-3B ક્યારે?" is a Gujarati question with more non-letters
    in it than letters.
    """
    if not text:
        return "en"

    counts: dict[str, int] = {}
    letters = 0
    for ch in text:
        if not ch.isalpha():
            continue
        letters += 1
        cp = ord(ch)
        for lo, hi, code in _SCRIPT_RANGES:
            if lo <= cp <= hi:
                counts[code] = counts.get(code, 0) + 1
                break

    if not letters or not counts:
        return "en"

    code, hits = max(counts.items(), key=lambda kv: kv[1])
    return code if (hits / letters) >= _SCRIPT_SHARE_FLOOR else "en"


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
        # Gemini direct leads whatever the language, because it is the only
        # provider in this chain `_call_gemini` can hang
        # `tools: [{google_search: {}}]` on, and grounding is ON for chat by the
        # owner's decision. What the language changes is what stands BEHIND it.
        #
        # This branch sits above the Indic branch below and so used to swallow
        # it whole: an Indic chat that fell past Gemini landed on Qwen Plus, our
        # strongest ENGLISH reasoner, which answers a Gujarati question in
        # English or in transliterated mush. The Indic fallbacks are the two
        # Gemini-family models on OpenRouter — the same pair the Indic content
        # branch below already picks — and Qwen only after them.
        if language in INDIC_LANGS:
            return ["gemini", "gemini_flash_or", "gemini_lite_or", "qwen_plus", "groq"]
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
    url = f"{base_url}/models/{model}:generateContent"
    # `x-goog-api-key`, not `?key=` — httpx logs the request URL at INFO, so a
    # key in the query string is written to the deploy log on every call.
    # See services/apify.py for the same fix and the log line that proved it.
    headers = {"x-goog-api-key": api_key}
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
        resp = await client.post(url, json=payload, headers=headers)
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
    org_id: Optional[str] = None,
) -> dict:
    """Generate text using smart provider routing.
    Routes based on language (Indic → Gemini family), task type (quality → Qwen),
    and falls back through the chain on failure.

    Returns {"text", "provider", "model", "prompt_tokens", "completion_tokens",
    "cost_usd", "grounding_sources"}.

    `grounding_sources` is a list of {"title", "url"} and is only ever non-empty
    for `task="chatbot"`, which is the one task that turns Google Search
    grounding on. It is present and empty on every other path so that callers
    never have to test which provider answered.

    NOTE ON `task` vs `agent_type`: routing branches on TASK. `agent_type` picks
    quality/premium tiers within a task. A caller that means "this is the
    chatbot" must pass `task="chatbot"` — `agent_type="chatbot"` reaches no
    branch in `_select_providers` at all and silently lands on the English bulk
    chain. That was true of every chat answer this product gave until 2026-08-05.
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
                # TASK, not agent_type. Nothing in the product passed
                # `task="chatbot"` to this function until 2026-08-05 — the chat
                # router passed `agent_type="chatbot"` and no task at all — so
                # this was `False` on every call ever made and web grounding,
                # which is the whole reason the chatbot chain leads with Gemini
                # direct, had never once been switched on for a user's question.
                use_grounding = task == "chatbot"
                result = await _call_gemini(api_key, prov["api_base_url"], model, prompt, system, max_tokens, grounded=use_grounding)
            else:
                result = await _call_openai_compat(api_key, prov["api_base_url"], model, prompt, system, max_tokens)

            latency = int((time.monotonic() - start) * 1000)
            cost_usd = result.get("cost_usd", 0.0)

            # `org_id` as well as `client_id`. Every TEXT generation was written
            # with neither: the org routes reach this function without a client
            # (there is no `hub_clients` row behind `/org/generate`), and the
            # column was simply never passed. Measured 2026-07-29 over 21 calls —
            # 18 landed with `org_id` NULL and only the three IMAGE rows, which
            # go through `generate_image` and do pass it, were attributable.
            #
            # `hub_ai_logs` is the only place a call's provider, model, tokens,
            # latency and USD cost are recorded, so an org's entire text spend
            # was unattributable to it — and `GET /hub/analytics/spend`, which is
            # org-scoped, could only ever report the images.
            await pool.execute(
                "INSERT INTO staging.hub_ai_logs "
                "(client_id, org_id, provider, model, prompt_tokens, completion_tokens, "
                " latency_ms, status, cost_usd, generation_id) "
                "VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, 'success', $8, $9)",
                client_id, org_id, code, model,
                result["prompt_tokens"], result["completion_tokens"],
                latency, cost_usd, result.get("generation_id", ""),
            )
            if client_id:
                _org_id = await pool.fetchval(
                    "SELECT org_id FROM staging.hub_clients WHERE id=$1::uuid", client_id
                )
                if _org_id:
                    await pool.execute(
                        "INSERT INTO staging.usage_tracking (org_id, metric, value, recorded_at) "
                        "VALUES ($1::uuid, 'ai_calls', 1, CURRENT_DATE) "
                        "ON CONFLICT (org_id, metric, recorded_at) "
                        "DO UPDATE SET value = staging.usage_tracking.value + 1",
                        _org_id,
                    )

            return {
                "text": result["text"],
                "provider": code,
                "model": model,
                "prompt_tokens": result["prompt_tokens"],
                "completion_tokens": result["completion_tokens"],
                "cost_usd": cost_usd,
                # `_call_gemini` collects these out of `groundingMetadata` and
                # returns them under `grounding_sources`; this dict listed six
                # keys and dropped them on the floor. So a grounded answer —
                # paid for, and answered out of live web results — arrived at
                # the chat layer indistinguishable from an ungrounded one, with
                # nothing to cite. `routers/hub_chat.py` has read
                # `ai_result["grounding_sources"]` the whole time and has always
                # got `[]`.
                #
                # `.get` with a default rather than `result["…"]`, because
                # `_call_openai_compat` — every provider that is not Gemini
                # direct — does not produce the key at all. Defaulting here is
                # what keeps the return shape identical for all of them, so no
                # caller has to branch on which provider answered.
                "grounding_sources": result.get("grounding_sources", []),
            }

        except Exception as e:
            latency = int((time.monotonic() - start) * 1000)
            last_error = e
            log.warning("AI provider %s failed: %s", code, e)

            # The failures matter as much as the successes: a provider ahead of
            # the working one in the chain charges every call its round trip.
            # Two of them are 400ing on every request as of 2026-07-29.
            await pool.execute(
                "INSERT INTO staging.hub_ai_logs "
                "(client_id, org_id, provider, model, latency_ms, status, error_message) "
                "VALUES ($1::uuid, $2::uuid, $3, $4, $5, 'error', $6)",
                client_id, org_id, code, model, latency, str(e)[:500],
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
    # The KEY as well as the URL. `upload["url"]` is a presigned R2 link that
    # dies in nine hours; the key is what lets any later read re-sign it. Stored
    # by every caller, so re-signing never has to parse a key back out of an
    # expired URL (`storage.refresh_signed_url`, deprecated for exactly this).
    result["image_key"] = upload.get("key") or ""
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
    url = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent"
    # `x-goog-api-key`, not `?key=` — httpx logs the request URL at INFO, so a
    # key in the query string is written to the deploy log on every call.
    # See services/apify.py for the same fix and the log line that proved it.
    headers = {"x-goog-api-key": api_key}

    async with httpx.AsyncClient(timeout=120) as client:
        resp = await client.post(url, headers=headers, json={
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


# ── Credits: DEPRECATED WRAPPERS OVER services/credits.py ───
#
# Everything below this line used to be money. It is now four wrappers.
#
# Migration 095 collapsed five disagreeing debit implementations into one choke
# point, `services/credits.py`. These four names survive because deleting them
# would mean editing routers this agent does not own, and because
# `tests/test_skill_module_access.py:268-269` asserts BY NAME that `run_skill`
# calls `deduct_credits` and `run_org_skill` calls `deduct_org_credits` before
# it checks module access. The names are load-bearing; the bodies are not.
#
# Do not add logic here. A new caller should call `services.credits` directly:
# it is the only place allowed to name a price or a credit table, and
# `tests/test_credits_isolation.py` walks the tree to prove it.

# DEPRECATED 2026-08-04. This is no longer a price list — the price table that
# migration 095 seeds is, and `credits.price_of` is the only function permitted
# to read it. (The table is not named here, and neither is any other credit
# table: `tests/test_credits_isolation.py` scans file TEXT, so a name in a
# comment is as much of a second reference as a name in a query.) The dict is
# kept BOUND, with its values untouched, for exactly two importers:
# `tests/test_credit_refund.py` and `tests/test_skill_template_validation.py:229`
# (which asserts a template estimate equals this dict's "email" entry).
#
# It was never a price list in the honest sense anyway: every call site read it
# through `.get(agent_type, 2)`, so a kind nobody had listed — "chatbot",
# "content" — silently cost 2 credits and looked deliberate. That fallback is
# what `credits.UnknownPrice` now refuses to do.
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

# DEPRECATED 2026-08-04. The rupees-per-credit figure moved to
# `services/credits.py` with `price_of_scraper_usage`, which is the one function
# that multiplies it by a forex rate and an org markup. Kept bound only until
# `routers/scrapers.py:100` stops importing it from here.
CREDIT_PRICE_INR = 4


def _no_idempotency_key(scope: str) -> str:
    """A fresh key on every call — which is to say NO idempotency at all.

    Stated plainly rather than hidden, because `credits.spend` REQUIRES a key and
    a wrapper that invented a deterministic one would be worse than useless. The
    only identifiers these wrappers receive are `(org_id, user_id, agent_type)`,
    and two legitimate generations of the same kind by the same person a minute
    apart must both be charged. A key built from those three would collapse the
    second into a replay and silently under-bill.

    So a retry through a wrapper charges twice — exactly as it did before 095.
    That is not a regression; it is the reason these wrappers are deprecated. A
    caller that can name its unit of work (`skillrun:{run_id}:step:{n}`,
    `scraper:{run_id}:min`, `gen:{org}:{request_id}`) must call `credits.spend`
    directly and get the guarantee.
    """
    return f"legacy:{scope}:{uuid.uuid4().hex}"


async def deduct_credits(client_id: str, agent_type: str, user_id: str = None) -> int:
    """DEPRECATED wrapper. Charges the ORG, not the per-client wallet.

    This function used to be the fifth debit implementation, and the only one
    that spent `staging.hub_credit_wallets` — a per-CLIENT wallet with 53 rows
    that nothing else in the product can see. The balance every other path reads,
    every report totals and every invoice bills is the ORG wallet. So a
    generation booked through a client route came out of one pot while the
    customer was shown, charged for, and topped up another. The top-up form in
    the frontend writes the client wallet, which is why topping up has been
    raising the spendable balance by zero.

    It now charges the org, resolving the org the way `generate()` already does
    (see `client_id` handling above) with one lookup on `staging.hub_clients`.

    BEHAVIOUR CHANGE, deliberate and worth saying out loud: the 53 per-client
    balances become unspendable. Some of them are non-zero. Per the owner the
    table and its rows are retained — nothing here drops or zeroes them — but a
    client that could generate yesterday against a client-wallet balance now
    needs org credits. That is the point of the programme; it is not a side
    effect of it.

    Everything charged through here is booked as `kind='content'`, because three
    arguments is all the wrapper gets — a step of `run_skill` is indistinguishable
    from a one-off generation from in here. So `usage_summary`'s `by_kind` will
    under-count `skill_step` until the caller passes `credits.spend` its own kind.
    The money is right either way; only the breakdown is coarse.

    Returns the new ORG balance. Raises 402/404 through `services.credits`.
    """
    # Imported inside the function, matching the `HTTPException` and
    # `services.storage` imports above: `credits` is landing in this same
    # programme and a module-level import would make every router in the product
    # fail to load if it were a minute behind.
    from fastapi import HTTPException
    from services import credits

    pool = await get_pool()
    org_id = await pool.fetchval(
        "SELECT org_id FROM staging.hub_clients WHERE id=$1::uuid", client_id
    )
    if not org_id:
        # Was "Credit wallet not found", which named the wrong thing even before
        # 095: the wallet was missing because the client was.
        raise HTTPException(404, "Client not found")

    receipt = await credits.spend_standalone(
        org_id=str(org_id),
        user_id=user_id,
        kind="content",
        ref_id=agent_type,
        idempotency_key=_no_idempotency_key("client"),
        description=f"{agent_type} generation",
    )
    return receipt.balance_after


async def _maybe_reset_monthly_credits(conn, org_id: str):
    """DEPRECATED wrapper over `credits.roll_period`.

    What this used to do, and why none of it survives:

      · `SET balance = $1` — it OVERWROTE the balance with the month's grant, so
        a top-up the client had been invoiced for was annihilated at the roll and
        the ledger row called it a 'reset'. `roll_period` sets the ALLOWANCE
        bucket and leaves PURCHASED alone; that is the whole two-bucket model.
      · `if not org_credits: <fall through to the plan default>` — a deliberately
        negotiated 0 is falsy, so an org Aekam had agreed to give nothing was
        handed the plan's default credits every single month.
        `organisations.monthly_credits` is now the sole source and 0 means 0.
      · it took NO ROW LOCK and ran before the caller's `FOR UPDATE`, so two
        first-of-month spends could each roll the period.

    That last one is worth being explicit about, because the two legacy callers
    (`routers/hub.py`, `routers/scrapers.py`) hand over a connection with no lock
    on the wallet row and this wrapper does not take one either. It does not need
    to: `roll_period` takes the row lock itself precisely "so a caller cannot
    forget", and it heals a missing wallet row on the way through — which is what
    stops an org created with 0 credits answering 402 forever. Adding a second
    lock here would be a redundant round trip on a path that `GET /hub/org/credits`
    hits on every read.

    Runs inside the CALLER'S transaction, as it always has, so a caller that
    rolls back un-rolls the period with it.
    """
    from services import credits

    await credits.roll_period(conn, org_id)


async def refund_org_credits(org_id: str, user_id: str, agent_type: str, description: str = "") -> int:
    """DEPRECATED wrapper over `credits.refund`. Put back what a failure charged.

    The reason this exists at all is unchanged and still true: every caller that
    spends before it generates — all three image sites — was charging for a
    failure. The deduction commits, `generate_image` raises, the `except` writes a
    log line, and the credits are gone with no image. HuggingFace sits first in
    the image chain and has answered `410 Gone` on every call since its
    serverless route for FLUX.1-dev was retired; the chain survives only because
    OpenRouter is behind it.

    What changed is that it no longer moves money and no longer guesses an
    amount. The old signature named an AGENT TYPE, never a transaction, so it
    could only ever return that type's LIST price — not what was actually
    charged, and never a trued-up scraper run, which has no agent type at all.
    `credits.latest_spend_id` turns the agent type back into the transaction it
    almost certainly meant, and `credits.refund` returns the real amount to the
    bucket it came from, decrements the member's period spend, and is
    refund-once by a unique index rather than by hope.

    "Almost certainly" is the honest word: two concurrent runs of the same kind
    by the same person are indistinguishable from here, so a failure may reverse
    the sibling's row. Both cost the same, so the balance lands in the right
    place and only the attribution is wrong — and a caller that wants the right
    row calls `credits.refund(tx_id=…)` with the id its own spend returned. That
    is the whole argument for deprecating this signature.

    Matched on `ref_id` alone, not on `kind`, so a refund reaches a step charged
    as `skill_step` as readily as one charged as `content`. Rows written before
    095 carry neither column and cannot be matched — which costs nothing, because
    a refund follows its charge by seconds inside one request, and no charge made
    after this deploy is a pre-095 row.

    Still NEVER RAISES. It runs inside an `except` that is already handling a
    failure, and a refund that throws would replace a lost 3 credits with a 500
    for a user who is waiting on text that already generated. A refund it cannot
    place returns 0 and says so in the log, exactly as a missing wallet always
    did.
    """
    from datetime import datetime, timedelta, timezone

    from services import credits

    try:
        pool = await get_pool()
        async with pool.acquire() as conn:
            # A refund is written in the `except` of the call that failed, so it
            # follows its charge by seconds. A day is already absurdly generous,
            # and the bound is what stops this reaching into a closed month.
            tx_id = await credits.latest_spend_id(
                conn, org_id,
                user_id=user_id,
                ref_id=agent_type,
                since=datetime.now(timezone.utc) - timedelta(days=1),
            )

        if not tx_id:
            log.warning(
                "No matching %s debit to refund for org %s user %s — "
                "call credits.refund(tx_id) with the id spend() returned",
                agent_type, org_id, user_id,
            )
            return 0

        receipt = await credits.refund_standalone(
            tx_id=tx_id,
            reason=description or f"Refund — {agent_type} did not complete",
            user_id=user_id,
        )
        # `refund_standalone` already swallows its own failures and returns None,
        # logging what the customer is owed. Mirror the old contract: 0.
        return receipt.balance_after if receipt else 0
    except Exception as exc:
        log.warning("Credit refund failed for org %s (%s): %s", org_id, agent_type, exc)
        return 0


async def deduct_org_credits(org_id: str, user_id: str, agent_type: str, description: str = "") -> int:
    """DEPRECATED wrapper over `credits.spend_standalone`. Returns the new balance.

    Everything this used to do by hand is now `credits.spend`, and every one of
    those hand-rolled steps was wrong in a way that cost somebody money:

      · it opened ITS OWN pool connection and committed on its own, so a caller
        that raised afterwards — `routers/hub.py` does, twice — left a committed
        debit with nothing to reverse it. `spend()` requires the caller's
        connection for exactly that reason; this wrapper cannot supply one, which
        is why it uses `spend_standalone` and why converted callers must not.
      · it locked the member allocation row and THEN the org wallet row, while
        `refund_org_credits` locked them the other way round — two tables, one
        org, opposite orders, one concurrent debit-and-refund away from a
        deadlock. The house order is org row first, always.
      · it treated the member allocation as a SECOND WALLET to debit. It is a
        CEILING on the shared org balance; nothing is ever taken from a member.
      · it priced the work out of the legacy dict below through a two-credit
        default, so an unlisted kind cost 2 credits by accident and looked
        deliberate in the ledger.
      · no idempotency of any sort — see `_no_idempotency_key`.

    Signature and name are unchanged on purpose: `test_skill_module_access.py`
    asserts by source order that `run_org_skill` checks module access before it
    reaches this call.
    """
    from services import credits

    receipt = await credits.spend_standalone(
        org_id=org_id,
        user_id=user_id,
        kind="content",
        ref_id=agent_type,
        idempotency_key=_no_idempotency_key("org"),
        description=description or f"{agent_type} generation",
    )
    return receipt.balance_after
