"""The `@metric` declaration and the registry it fills.

Three consequences proposal 62 states, held here in code:

· **Entitlement is not a separate check.** A metric carries its module, so the
  catalogue a caller sees is the intersection of the registry and the modules
  they can reach — a metric whose module is unreachable is ABSENT from the
  response, not disabled in the UI. (The catalogue lists NAMES; the data
  route runs the full `require_module` gate — subscription state and the
  sensitive-module audit row live only there. See routers/analytics.py.)

· **Ratios are never stored and never averaged.** A ratio metric declares SQL
  over summed numerators and denominators for the requested window; the mean
  of daily rates is not the period's rate.

· **A window applies to flows, not stocks** (D1's rule, inherited). A `flow`
  metric REQUIRES a window on the data route; a `stock` metric ignores one
  and answers as-at-today, and the response's window block says which
  happened.

A metric may also be declared ABSENT with a reason (`absent=`): the column its
honest computation needs does not exist. Proposal 62 §10 — an uncomputable
number ships as a stated absence, never as a convincing zero.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Callable, Optional

from services.analytics_window import Window


@dataclass(frozen=True)
class MetricRequest:
    """What one /run call asks of one metric's SQL builder."""

    org_id: str
    window: Optional[Window]          # None only ever reaches a stock metric
    bucket: str = "month"
    group_by: Optional[str] = None    # must be one of the metric's dimensions


@dataclass(frozen=True)
class Metric:
    key: str                          # 'ganit.dso' — module-prefixed, unique
    module: str                       # entitlement falls out of this line
    label: str
    unit: str                         # 'inr' | 'count' | 'days' | 'pct' | 'hours'
    grain: str                        # 'flow' | 'stock'
    dimensions: tuple[str, ...] = ()  # legal group_by values
    sensitivity: str = "operational"  # 'operational' | 'financial'
    drill: Optional[str] = None       # what a click opens, e.g. 'ganit.invoices'
    description: str = ""
    #: Declared-absent reason. When set, `sql` is None and /run answers 422
    #: with this text — the schema cannot support the metric honestly.
    absent: Optional[str] = None
    #: (req) -> (sql, params). The builder OWNS its SQL: schema-qualified
    #: tables, every ambiguous parameter cast ($1::uuid — PgBouncer turns an
    #: untyped parse error into an instant 500), window bounds as $2/$3 when
    #: the metric is a flow.
    sql: Optional[Callable[[MetricRequest], tuple[str, list]]] = field(default=None, compare=False)

    def __post_init__(self):
        if self.grain not in ("flow", "stock"):
            raise ValueError(f"{self.key}: grain must be 'flow' or 'stock'")
        if (self.absent is None) == (self.sql is None):
            raise ValueError(f"{self.key}: exactly one of sql/absent must be set")
        if "." not in self.key or self.key.split(".", 1)[0] != self.module:
            raise ValueError(f"{self.key}: key must be '{self.module}.<name>'")


REGISTRY: dict[str, Metric] = {}


def register(m: Metric) -> Metric:
    if m.key in REGISTRY:
        raise ValueError(f"duplicate metric key: {m.key}")
    REGISTRY[m.key] = m
    return m


def metric(**kwargs):
    """Declare a metric over its SQL builder:

        @metric(key="ganit.invoiced", module="ganit", label="Invoiced",
                unit="inr", grain="flow", dimensions=("invoice_type",))
        def invoiced(req): return sql, params
    """
    def deco(fn):
        register(Metric(sql=fn, **kwargs))
        return fn
    return deco


def absent_metric(**kwargs) -> Metric:
    """Declare a metric the schema cannot honestly compute (reason required)."""
    if not kwargs.get("absent"):
        raise ValueError("absent_metric requires absent=<reason>")
    return register(Metric(**kwargs))


def modules_in_registry() -> set[str]:
    return {m.module for m in REGISTRY.values()}


def catalogue_for(reachable: set[str]) -> list[dict]:
    """The catalogue this caller may see — unreachable modules are ABSENT.

    Declared-absent metrics of a reachable module ARE listed, with their
    reason: the module's owner should see what the product cannot yet answer
    and why, rather than a silent gap that reads as an oversight.
    """
    out = []
    for m in sorted(REGISTRY.values(), key=lambda m: m.key):
        if m.module not in reachable:
            continue
        entry = {
            "key": m.key, "module": m.module, "label": m.label,
            "unit": m.unit, "grain": m.grain,
            "dimensions": list(m.dimensions),
            "sensitivity": m.sensitivity, "drill": m.drill,
            "description": m.description,
        }
        if m.absent:
            entry["absent"] = m.absent
        out.append(entry)
    return out


def load_all() -> None:
    """Import every metrics module so its declarations register.

    Called once at router import. A metrics file that fails to import must
    fail LOUDLY here, at startup — not at the first /run that touches it.
    """
    from analytics.metrics import core, ganit  # noqa: F401
