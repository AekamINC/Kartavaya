"""Web search: that it stays cheap, stays quiet, and stays off the org's data.

The cost control is not the price per query, it is the gate. Every test here
exists because the failure it describes would either send an organisation's
private question to a search engine or turn a free tier into an invoice.
"""
from __future__ import annotations

import ast
import inspect
from pathlib import Path

import pytest

from services import web_search


def test_no_key_means_no_search_and_no_error():
    """Search is an enhancement. Missing key must be ordinary, not fatal."""
    assert web_search.is_configured() in (True, False)


@pytest.mark.asyncio
async def test_search_without_a_key_returns_empty(monkeypatch):
    monkeypatch.delenv("SERPER_API_KEY", raising=False)
    assert await web_search.search("what is the GST rate on cement") == []


@pytest.mark.asyncio
async def test_a_failing_search_never_raises(monkeypatch):
    """A slow search engine must not 500 the chatbot."""
    monkeypatch.setenv("SERPER_API_KEY", "test-key")

    class Boom:
        async def __aenter__(self): return self
        async def __aexit__(self, *a): return False
        async def post(self, *a, **k): raise TimeoutError("serper is slow today")

    monkeypatch.setattr(web_search.httpx, "AsyncClient", lambda **k: Boom())
    assert await web_search.search("anything") == []


@pytest.mark.asyncio
async def test_the_key_goes_in_a_header_not_the_query_string(monkeypatch):
    """httpx logs request URLs at INFO — a key in the URL lands in the logs."""
    monkeypatch.setenv("SERPER_API_KEY", "sk-secret-value")
    seen = {}

    class Fake:
        async def __aenter__(self): return self
        async def __aexit__(self, *a): return False
        async def post(self, url, headers=None, json=None, **k):
            seen["url"], seen["headers"] = url, headers or {}

            class R:
                def raise_for_status(self): pass
                def json(self): return {"organic": []}
            return R()

    monkeypatch.setattr(web_search.httpx, "AsyncClient", lambda **k: Fake())
    await web_search.search("cement")
    assert "sk-secret-value" not in seen["url"], (
        "The API key is in the request URL. httpx writes that URL to the deploy "
        "log on every search."
    )
    assert seen["headers"].get("X-API-KEY") == "sk-secret-value"


@pytest.mark.asyncio
async def test_results_match_the_shape_the_source_cards_already_render(monkeypatch):
    monkeypatch.setenv("SERPER_API_KEY", "k")

    class Fake:
        async def __aenter__(self): return self
        async def __aexit__(self, *a): return False
        async def post(self, *a, **k):
            class R:
                def raise_for_status(self): pass
                def json(self):
                    return {"organic": [
                        {"title": "GST rates", "link": "https://x.example/gst",
                         "snippet": "Cement is taxed at 28%."},
                        {"title": "no link here", "snippet": "dropped"},
                    ]}
            return R()

    monkeypatch.setattr(web_search.httpx, "AsyncClient", lambda **k: Fake())
    out = await web_search.search("gst on cement")
    assert len(out) == 1, "A result with no URL must be dropped, not rendered."
    assert set(out[0]) >= {"title", "url", "snippet"}


def test_the_chat_route_never_searches_a_question_about_their_own_records():
    """The gate. Without it, private questions go to a search engine.

    Asserted against the route's own source rather than by calling it, because
    reaching that line needs a database, a session and a credit ledger — and a
    test that expensive is a test that gets skipped.
    """
    src = Path("routers/hub.py").read_text(encoding="utf-8")
    tree = ast.parse(src)
    calls = [n for n in ast.walk(tree)
             if isinstance(n, ast.Await)
             and isinstance(n.value, ast.Call)
             and isinstance(n.value.func, ast.Attribute)
             and n.value.func.attr == "search"
             and getattr(n.value.func.value, "id", "") == "web_search"]
    assert calls, "Nothing in hub.py calls web_search.search any more."

    # The guard must mention BOTH conditions. Matching the whole file would
    # match the comment that explains the guard, which passes for the wrong
    # reason — so this looks at the enclosing `if` test only.
    guards = [ast.unparse(n.test) for n in ast.walk(tree) if isinstance(n, ast.If)
              and "web_search.search" in ast.unparse(n)]
    assert guards, "web_search.search is called unconditionally."
    joined = " ".join(guards)
    assert "looks_like_org_question" in joined, (
        "The search is not gated on `looks_like_org_question`. Questions about "
        "the organisation's own invoices and tasks would be sent to a public "
        "search engine — a cost problem and a privacy one."
    )
    assert "is_configured" in joined, (
        "The search is not gated on a key being present, so every deployment "
        "without SERPER_API_KEY pays a network round trip per question."
    )


def test_web_citations_survive_the_reference_stripper():
    """Web refs must be added to `citable` or every citation is deleted."""
    src = Path("routers/hub.py").read_text(encoding="utf-8")
    assert "citable.add(" in src, (
        "Web results are numbered but never added to `citable`, so "
        "`strip_invalid_refs` removes every [n] pointing at a web source and "
        "the answer loses its attribution without saying so."
    )
