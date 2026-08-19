"""Report definitions — the ROW-LEVEL half of a module report.

Why this package exists at all
------------------------------
`services/module_report.report_widget` runs a Dristi metric and returns
`{label, data: rows}`; `render_report_html` takes a list of that shape and
prints each as a letterhead table. The renderer does not care where the rows
came from — so a row-level report needs no new renderer, no new PDF engine
and no new export code, only a second producer of the same shape.

Dristi cannot be that producer. A `MetricRequest`
(`analytics/registry.py`) carries org_id, window, bucket and group_by and
nothing else: there is no row mode and no entity filter, so a metric can
answer "how much is 90+ days overdue" but never "…and from whom, line by
line". Every metric SQL builder is also an AGGREGATE by construction. That
gap is what a ReportDef fills, and it fills it beside the metric registry
rather than inside it — a metric that could secretly return 400 rows would
break every widget renderer that assumes a metric is small.

What a ReportDef owes
---------------------
· Its own org-scoped SQL, with the same discipline the metric builders carry:
  schema-qualified tables (`staging.x` — a shadow table has bitten this
  repo), asyncpg binds only, every ambiguous parameter cast (`$1::uuid` —
  PgBouncer turns an untyped parse error into an instant 500: the credits
  incident).
· NAMES, NEVER IDS in the rows it returns. These rows are printed on a page
  the firm hands to someone; a member/client/org UUID must never reach one
  (decision_names_not_ids, `frontend/scripts/check-rendered-ids.mjs`).
· The module(s) it READS, so the entitlement falls out of the declaration
  exactly as it does for a metric (`Metric.module`) and for a scheduled
  delivery (`module_report.REPORT_SOURCE_MODULES`). ALL named modules are
  required: a partial export of the books is still an export of the books.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Awaitable, Callable, Optional


@dataclass(frozen=True)
class ReportDef:
    """One row-level section of a module report."""

    key: str                          # 'ganit.receivables_ageing_by_party'
    module: str                       # entitlement falls out of this line
    label: str                        # the table's title on the letterhead
    grain: str                        # 'flow' (windowed) | 'stock' (as-at)
    #: Every module this section's query READS, including its own. A section
    #: that joins a second module's table must say so here or the join is an
    #: entitlement bypass wearing a report's clothes.
    reads: frozenset = frozenset()
    sensitivity: str = "operational"  # 'operational' | 'financial'
    description: str = ""
    #: (pool, org_id, window) -> rows. `window` is None for a stock section,
    #: mirroring `MetricRequest.window`, so a stock section cannot silently
    #: read a window it does not honour.
    run: Optional[Callable[..., Awaitable[list]]] = field(default=None, compare=False)

    def __post_init__(self):
        if self.grain not in ("flow", "stock"):
            raise ValueError(f"{self.key}: grain must be 'flow' or 'stock'")
        if self.run is None:
            raise ValueError(f"{self.key}: run is required")
        if "." not in self.key or self.key.split(".", 1)[0] != self.module:
            raise ValueError(f"{self.key}: key must be '{self.module}.<name>'")
        if self.module not in self.reads:
            # The owning module is always read. Declaring `reads` without it
            # would gate the section on a foreign grant while leaving its own
            # unchecked — the exact hole REPORT_SOURCE_MODULES was written to
            # close ("exporting 'hr' returned the employee register behind
            # dristi alone").
            object.__setattr__(self, "reads", frozenset(self.reads) | {self.module})


REPORT_DEFS: dict[str, ReportDef] = {}


def register(d: ReportDef) -> ReportDef:
    if d.key in REPORT_DEFS:
        raise ValueError(f"duplicate report key: {d.key}")
    REPORT_DEFS[d.key] = d
    return d


def report_def(**kwargs):
    """Declare a report section over its row builder:

        @report_def(key="ganit.receivables_ageing_by_party", module="ganit",
                    label="Receivables ageing by party", grain="stock")
        async def rows(pool, org_id, window): ...
    """
    def deco(fn):
        register(ReportDef(run=fn, **kwargs))
        return fn
    return deco


def load_all() -> None:
    """Import every definition module so its declarations register.

    Called from `module_report.report_section`, not at import time: a report
    definition that fails to import must fail where a caller can SAY so,
    and this package must stay importable by tests that only want ReportDef.
    """
    from services.report_defs import receivables_ageing  # noqa: F401


def sections_for(reachable: set) -> list[dict]:
    """The sections this caller may see — unreachable ones are ABSENT, not
    disabled, the same rule `analytics.registry.catalogue_for` holds."""
    load_all()
    return [
        {"key": d.key, "module": d.module, "label": d.label,
         "grain": d.grain, "sensitivity": d.sensitivity,
         "description": d.description}
        for d in sorted(REPORT_DEFS.values(), key=lambda d: d.key)
        if d.reads <= set(reachable)
    ]


__all__ = ["ReportDef", "REPORT_DEFS", "load_all", "register",
           "report_def", "sections_for"]
