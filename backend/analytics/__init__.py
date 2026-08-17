"""The metric registry — proposal 62, phase D2.

A metric is declared ONCE, in the module that owns it, and every surface —
the module's own analytics tab, Dristi, the exports — renders that single
declaration. The registry is the layer that makes "one definition of revenue"
a property of the code rather than a hope.
"""
from analytics.registry import REGISTRY, Metric, MetricRequest, catalogue_for, metric  # noqa: F401
