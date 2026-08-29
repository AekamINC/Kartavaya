"""
base.py — Base class for deterministic agents.

Every agent extends BaseAgent and implements `run()`.
The orchestrator calls `execute()` which wraps `run()` with
logging, timing, and error handling.
"""
import time
import logging
from abc import ABC, abstractmethod
from typing import Any

logger = logging.getLogger(__name__)


class BaseAgent(ABC):
    """Abstract agent with built-in execution wrapper."""

    name: str = "unnamed_agent"
    description: str = ""
    module: str = "general"  # kaam, daam, crm, hr, etc.

    @abstractmethod
    async def run(self, pool, org_id: str, context: dict) -> dict:
        """Execute agent logic. Return a result dict."""
        ...

    async def execute(self, pool, org_id: str, context: dict) -> dict:
        """Wrapper: logs run, catches errors, records to hub_skill_runs."""
        import uuid

        run_id = f"agr_{uuid.uuid4().hex[:12]}"
        start = time.time()
        status = "success"
        result = {}

        try:
            logger.info("agent.start name=%s org=%s run=%s", self.name, org_id, run_id)
            result = await self.run(pool, org_id, context) or {}
        except Exception as exc:
            status = "error"
            result = {"error": str(exc)}
            logger.exception("agent.error name=%s run=%s: %s", self.name, run_id, exc)
        finally:
            elapsed_ms = int((time.time() - start) * 1000)
            logger.info(
                "agent.done name=%s run=%s status=%s elapsed=%dms",
                self.name, run_id, status, elapsed_ms,
            )
            # Record run — best-effort
            try:
                await pool.execute(
                    """
                    INSERT INTO public.hub_skill_runs
                        (run_id, org_id, skill_type, skill_name, status, result, elapsed_ms)
                    VALUES ($1, $2, 'agent', $3, $4, $5::jsonb, $6)
                    """,
                    run_id, org_id, self.name, status,
                    __import__("json").dumps(result), elapsed_ms,
                )
            except Exception:
                logger.debug("Could not log agent run to hub_skill_runs (table may not exist yet)")

        return result
