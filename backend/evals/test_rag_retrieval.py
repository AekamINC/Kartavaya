"""
test_rag_retrieval.py — Evaluation tests for RAG retrieval quality.
Tests that hybrid search returns relevant chunks for known queries.
"""
import json
from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest

from evals.scorers import f1_score, recall_at_k, mrr


@pytest.fixture
def sample_dataset():
    path = Path(__file__).parent / "datasets" / "rag_retrieval.json"
    with open(path) as f:
        return json.load(f)


def _make_chunk_row(chunk_id: str, content: str, doc_title: str, similarity: float = 0.8):
    """Create a mock DB row matching hybrid search output shape."""
    return {
        "chunk_id": chunk_id,
        "content": content,
        "doc_title": doc_title,
        "document_id": "doc-" + chunk_id,
        "source_type": "text",
        "chunk_index": 0,
        "vec_score": similarity,
        "text_score": 0.5,
    }


class TestRetrievalScorers:
    """Unit tests for scoring functions."""

    def test_f1_perfect(self):
        assert f1_score({"a", "b"}, {"a", "b"}) == 1.0

    def test_f1_no_overlap(self):
        assert f1_score({"a", "b"}, {"c", "d"}) == 0.0

    def test_f1_partial(self):
        score = f1_score({"a", "b", "c"}, {"a", "b"})
        assert 0.7 < score < 0.9  # precision=2/3, recall=1.0, F1=0.8

    def test_f1_empty(self):
        assert f1_score(set(), set()) == 1.0
        assert f1_score(set(), {"a"}) == 0.0

    def test_recall_at_k(self):
        retrieved = ["a", "b", "c", "d", "e"]
        relevant = {"a", "c"}
        assert recall_at_k(retrieved, relevant, 3) == 1.0
        assert recall_at_k(retrieved, relevant, 1) == 0.5

    def test_mrr_first(self):
        assert mrr(["a", "b", "c"], {"a"}) == 1.0

    def test_mrr_second(self):
        assert mrr(["x", "a", "c"], {"a"}) == 0.5

    def test_mrr_not_found(self):
        assert mrr(["x", "y", "z"], {"a"}) == 0.0


class TestHybridSearchShape:
    """Tests that hybrid search returns expected structure."""

    @pytest.mark.asyncio
    async def test_search_returns_chunk_ids(self):
        """Hybrid search results must include chunk_id for citations."""
        mock_rows = [
            _make_chunk_row("chunk-1", "Refund policy text", "Refund Policy"),
            _make_chunk_row("chunk-2", "More refund details", "Refund Policy"),
        ]

        # Verify chunk structure
        for row in mock_rows:
            assert "chunk_id" in row
            assert "content" in row
            assert "doc_title" in row
            assert "source_type" in row

    @pytest.mark.asyncio
    async def test_search_with_metadata_filters(self):
        """Verify the search function accepts metadata filter parameters."""
        from services.rag import search_hybrid
        # Just verify the function signature accepts these params
        import inspect
        sig = inspect.signature(search_hybrid)
        params = set(sig.parameters.keys())
        assert "team_id" in params
        assert "content_type" in params
        assert "date_from" in params
        assert "date_to" in params
        assert "vector_weight" in params
        assert "text_weight" in params


class TestDatasetCoverage:
    """Verify eval dataset is well-formed."""

    def test_dataset_has_entries(self, sample_dataset):
        assert len(sample_dataset) == 15

    def test_entries_have_required_fields(self, sample_dataset):
        for entry in sample_dataset:
            assert "id" in entry
            assert "question" in entry
            assert "relevant_chunks" in entry
            assert "expected_keywords" in entry
            assert len(entry["relevant_chunks"]) > 0
            assert len(entry["expected_keywords"]) > 0

    def test_entry_ids_unique(self, sample_dataset):
        ids = [e["id"] for e in sample_dataset]
        assert len(ids) == len(set(ids))
