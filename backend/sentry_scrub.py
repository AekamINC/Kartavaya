"""Egress control for Sentry. Nothing identifying leaves this process.

── READ THIS BEFORE TRUSTING IT ────────────────────────────────────────────

This module NARROWS the channel. It does not close it.

Measured, under exactly this configuration, against the pinned sentry-sdk with
a stubbed transport:

    raise ValueError(f"auth failed for {company}, {email}, pw {pw}")

was transmitted as

    "auth failed for Sharma Textiles Pvt Ltd, [email], pw hunter2"

The email was caught. **The client's company name and the plaintext password
were not**, because neither has a pattern to match. No SDK switch removes
`exception.values[].value` — it is the exception's own `str()`.

So the real control is a code rule, not a config: **do not interpolate user or
client data into an exception message.** Anyone who reads this file and
concludes "the scrubber handles it" has misread it.

── WHY AN ALLOWLIST FOR HEADERS ────────────────────────────────────────────

The SDK's own denylist covers seven names (REMOTE_ADDR, X_FORWARDED_FOR,
SET_COOKIE, COOKIE, AUTHORIZATION, X_API_KEY, X_REAL_IP). This product sends
`X-Cron-Secret`, `X-Dispatch-Secret` and `X-Org-Id`, none of which are on it —
they would travel verbatim. A denylist protects against the headers somebody
thought of; an allowlist protects against the ones they did not.

── AND THE THREE CHANNELS NO SCRUBBER REACHES ──────────────────────────────

`scrub_request` touches headers, cookies and data only. `query_string` and
`url` are attached unconditionally by the ASGI integration and are scrubbed by
nothing — and this product has a cron whose URL carries a 64-hex secret in a
query string, plus three routers that accept a raw `?email=`. So the request
block is stripped structurally here rather than filtered.
"""
from __future__ import annotations

import os
import re
from typing import Any

_EMAIL = re.compile(r"[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}")
_UUID = re.compile(
    r"\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-"
    r"[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b"
)
#: This product's own id shapes — `task_5160ddfd45ee`, `team_bc82d77e74a7`.
#: The names-not-ids rule is about the UI, but shipping tenant ids to a vendor
#: hands them a tenant map. Same principle, different consumer.
_PREFIXED_ID = re.compile(r"\b(?:task|team|org|user|proj|inv|doc)_[0-9a-fA-F]{8,}\b")
_JWT = re.compile(r"\beyJ[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+\.?[A-Za-z0-9_\-]*")
_BEARER = re.compile(r"(?i)\bbearer\s+\S+")
_BCRYPT = re.compile(r"\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}")
_URLSEC = re.compile(
    r"(?i)([?&](?:request_secret|token|secret|key|api_key|apikey|signature|sig|"
    r"password|email|x-amz-signature|x-amz-credential)=)[^&\s\"'>]+"
)
_OPAQUE = re.compile(r"(?<![:/\w])[A-Za-z0-9_\-]{32,}(?![\w])")

#: Exact-value redaction, because it is lossless where a regex is guesswork.
#: Snapshotted at import: these ARE the values, so no pattern can miss them.
_ENV_SECRET_KEYS = (
    "CRON_SECRET", "JWT_SECRET", "TASK_REMINDER_DISPATCH_SECRET",
    "REPORT_DISPATCH_SECRET", "FIELD_ENCRYPTION_KEY", "RESEND_API_KEY",
    "APIFY_API_KEY", "SERPER_API_KEY", "GEMINI_API_KEY", "GOOGLE_API_KEY",
    "AWS_SECRET_ACCESS_KEY", "AWS_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY",
    "R2_ACCESS_KEY_ID", "DATABASE_URL", "SUPABASE_SERVICE_KEY",
    "SUPABASE_ANON_KEY", "OPENAI_API_KEY", "ANTHROPIC_API_KEY",
    "WHATSAPP_TOKEN", "MAPPLS_KEY", "OPENROUTER_API_KEY",
)
_SECRETS = sorted(
    {v for k in _ENV_SECRET_KEYS if (v := os.environ.get(k)) and len(v) >= 12},
    key=len, reverse=True,
)

_ALLOWED_HEADERS = frozenset({
    "content-type", "content-length", "accept", "accept-encoding",
    "user-agent", "origin", "referer", "x-request-id",
})


def _s(text: str) -> str:
    """Redact one string. Longest secrets first, so a prefix cannot shadow."""
    for secret in _SECRETS:
        if secret in text:
            text = text.replace(secret, "[env-secret]")
    text = _BEARER.sub("Bearer [redacted]", text)
    text = _JWT.sub("[jwt]", text)
    text = _BCRYPT.sub("[hash]", text)
    text = _URLSEC.sub(r"\1[redacted]", text)
    text = _EMAIL.sub("[email]", text)
    text = _UUID.sub("[uuid]", text)
    text = _PREFIXED_ID.sub("[id]", text)
    return _OPAQUE.sub("[opaque]", text)


def _walk(node: Any, depth: int = 0) -> Any:
    """Redact every string anywhere in the event, at any nesting."""
    if depth > 24:
        return "[depth]"
    if isinstance(node, str):
        return _s(node)
    if isinstance(node, dict):
        return {k: _walk(v, depth + 1) for k, v in node.items()}
    if isinstance(node, list):
        return [_walk(v, depth + 1) for v in node]
    if isinstance(node, tuple):
        return tuple(_walk(v, depth + 1) for v in node)
    return node


def _strip_request(event: dict) -> None:
    """Remove the request channels a scrubber does not reach. See the header."""
    req = event.get("request")
    if not isinstance(req, dict):
        return
    req.pop("data", None)         # login / invite / reset / payroll bodies
    req.pop("cookies", None)
    req.pop("env", None)          # REMOTE_ADDR
    req["query_string"] = None
    url = req.get("url")
    if isinstance(url, str):
        req["url"] = _s(url.split("?", 1)[0])
    headers = req.get("headers")
    if isinstance(headers, dict):
        req["headers"] = {k: v for k, v in headers.items()
                          if k.lower() in _ALLOWED_HEADERS}


def before_send(event, hint):
    event.pop("user", None)
    # A package inventory is a map of what to attack. server.py argues exactly
    # this about /docs, at length, and then would have shipped one anyway.
    event.pop("modules", None)
    _strip_request(event)
    return _walk(event)


def before_send_transaction(event, hint):
    """Same treatment. `before_send` does NOT run on transaction events — they
    take a separate hook, and the ASGI processor attaches url and query_string
    to them with no gate."""
    event.pop("user", None)
    event.pop("modules", None)
    _strip_request(event)
    return _walk(event)


def before_breadcrumb(crumb, hint):
    # SQL breadcrumbs are added unconditionally — not tracing-gated. Bind
    # parameters do not travel, but the SQL text and the database user and host
    # do, from a database production shares.
    if crumb.get("category") == "query":
        return None
    if crumb.get("type") == "log" and crumb.get("level") in ("info", "debug"):
        return None
    return _walk(crumb)
