"""
orchestrator.py — Event-to-agent router.

Usage:
    from services.agents.orchestrator import handle_event
    await handle_event(pool, "subtask_completed", org_id, context)
"""
import asyncio
import logging
from typing import Dict, List, Type

from services.agents.base import BaseAgent

logger = logging.getLogger(__name__)

_background_tasks: set = set()

# Lazy imports to avoid circular deps — populated on first call
_registry_built = False
AGENT_REGISTRY: Dict[str, List[Type[BaseAgent]]] = {}


def _build_registry():
    global _registry_built
    if _registry_built:
        return

    from services.agents.status_agent import StatusAgent
    from services.agents.review_agent import ReviewAgent
    from services.agents.workload_agent import WorkloadAgent

    # event_type → list of agent classes that respond to it
    _register("subtask_completed", StatusAgent)
    _register("subtask_status_changed", StatusAgent)
    _register("status_changed", ReviewAgent)
    _register("task_assigned", WorkloadAgent)

    _registry_built = True


def _register(event_type: str, agent_cls: Type[BaseAgent]):
    AGENT_REGISTRY.setdefault(event_type, []).append(agent_cls)


async def handle_event(pool, event_type: str, org_id: str, context: dict):
    """
    Find agents registered for this event and run them as background tasks.
    Non-blocking — swallows all errors.
    """
    _build_registry()

    agent_classes = AGENT_REGISTRY.get(event_type, [])
    if not agent_classes:
        return

    for cls in agent_classes:
        agent = cls()
        logger.info("orchestrator.dispatch event=%s agent=%s org=%s", event_type, agent.name, org_id)
        task = asyncio.create_task(agent.execute(pool, org_id, context))
        _background_tasks.add(task)
        task.add_done_callback(_background_tasks.discard)
