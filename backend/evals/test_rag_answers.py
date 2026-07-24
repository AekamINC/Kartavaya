"""
test_rag_answers.py — Evaluation tests for RAG answer quality.
Tests faithfulness scoring, citation verification, and answer grounding.
"""
import re
from unittest.mock import AsyncMock

import pytest

from evals.scorers import (
    citation_accuracy,
    faithfulness_score,
    llm_judge_faithfulness,
)


class TestCitationAccuracy:
    """Tests for citation verification in generated answers."""

    def test_all_valid_citations(self):
        text = "The refund policy [1] states 30 days [2]."
        result = citation_accuracy(text, {"1", "2", "3"})
        assert result["accuracy"] == 1.0
        assert result["total_citations"] == 2
        assert result["invalid_citations"] == 0

    def test_some_invalid_citations(self):
        text = "According to [1] and [5], the policy is clear."
        result = citation_accuracy(text, {"1", "2", "3"})
        assert result["accuracy"] == 0.5
        assert result["invalid_citations"] == 1

    def test_no_citations(self):
        text = "The refund policy is 30 days."
        result = citation_accuracy(text, {"1", "2"})
        assert result["accuracy"] == 1.0
        assert result["total_citations"] == 0

    def test_all_invalid(self):
        text = "See [10] and [20] for details."
        result = citation_accuracy(text, {"1", "2"})
        assert result["accuracy"] == 0.0
        assert result["invalid_citations"] == 2

    def test_empty_valid_refs(self):
        text = "No sources [1] available."
        result = citation_accuracy(text, set())
        assert result["accuracy"] == 0.0


class TestFaithfulness:
    """Tests for heuristic faithfulness scoring."""

    def test_fully_grounded(self):
        context = ["The company offers 30-day refund policy for all products."]
        answer = "The company provides a 30-day refund policy for their products."
        score = faithfulness_score(answer, context)
        assert score >= 0.5

    def test_ungrounded(self):
        context = ["We sell premium organic coffee beans."]
        answer = "The spacecraft launched successfully into orbit around Mars."
        score = faithfulness_score(answer, context)
        assert score < 0.5

    def test_empty_answer(self):
        assert faithfulness_score("", ["some context"]) == 0.0

    def test_empty_context(self):
        assert faithfulness_score("some answer", []) == 0.0

    def test_partial_grounding(self):
        context = ["Our pricing starts at $10 per month. We offer annual discounts."]
        answer = "Pricing starts at $10 per month. The company was founded in 1999 by astronauts."
        score = faithfulness_score(answer, context)
        assert 0.2 <= score <= 0.8


class TestLLMJudge:
    """Tests for LLM-as-judge faithfulness evaluation."""

    @pytest.mark.asyncio
    async def test_judge_returns_score(self):
        mock_generate = AsyncMock(return_value={
            "text": '{"score": 4, "reasoning": "Mostly faithful with minor additions."}',
            "model": "test",
        })

        result = await llm_judge_faithfulness(
            question="What is the refund policy?",
            answer="The refund policy allows returns within 30 days.",
            context="Refund policy: 30-day return window for all purchases.",
            generate_fn=mock_generate,
        )

        assert result["score"] == 4
        assert "reasoning" in result

    @pytest.mark.asyncio
    async def test_judge_handles_failure(self):
        mock_generate = AsyncMock(side_effect=Exception("API error"))

        result = await llm_judge_faithfulness(
            question="test",
            answer="test",
            context="test",
            generate_fn=mock_generate,
        )

        assert result["score"] == 0
        assert "failed" in result["reasoning"].lower()


class TestCitationPostProcessing:
    """Test that invalid citations are stripped from responses."""

    def test_strip_invalid_refs(self):
        """Simulate the post-processing logic from hub_chat.py."""
        response = "According to [1] and [5], the policy is clear [2]."
        valid_chunk_ids = {"1", "2", "3"}

        cited_refs = set(re.findall(r'\[(\d+)\]', response))
        for ref in cited_refs:
            if ref not in valid_chunk_ids:
                response = response.replace(f"[{ref}]", "")

        assert "[5]" not in response
        assert "[1]" in response
        assert "[2]" in response
