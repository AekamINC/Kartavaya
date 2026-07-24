"""
conftest.py — Pytest fixtures for RAG evaluation tests.
"""
import asyncio
import json
import os
from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest


@pytest.fixture(scope="session")
def event_loop():
    loop = asyncio.new_event_loop()
    yield loop
    loop.close()


@pytest.fixture
def mock_pool():
    """Mock asyncpg pool that returns predefined rows."""
    pool = AsyncMock()
    pool.fetch = AsyncMock(return_value=[])
    pool.fetchrow = AsyncMock(return_value=None)
    pool.fetchval = AsyncMock(return_value=0)
    pool.execute = AsyncMock()
    return pool


@pytest.fixture
def mock_embedding():
    """Mock embedding function that returns a deterministic 768-dim vector."""
    async def _embed(text: str):
        # Simple deterministic embedding based on text hash
        import hashlib
        h = hashlib.sha256(text.encode()).hexdigest()
        seed = int(h[:8], 16)
        import random
        rng = random.Random(seed)
        return [rng.uniform(-1, 1) for _ in range(768)]
    return _embed


@pytest.fixture
def mock_ai_generate():
    """Mock AI generate function for reranker tests."""
    async def _generate(**kwargs):
        return {
            "text": json.dumps([
                {"index": i, "score": 10 - i}
                for i in range(min(5, 20))
            ]),
            "model": "mock-model",
        }
    return _generate


@pytest.fixture
def rag_eval_dataset():
    """Load the RAG retrieval evaluation dataset."""
    dataset_path = Path(__file__).parent / "datasets" / "rag_retrieval.json"
    with open(dataset_path) as f:
        return json.load(f)
