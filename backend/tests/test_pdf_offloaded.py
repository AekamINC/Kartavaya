"""PDF rendering must not block the event loop.

WeasyPrint is CPU-bound and synchronous. Every PDF this product renders went
through `HTML(...).write_pdf()` called DIRECTLY from an async handler — seven
sites across ganit, vetana, documents, dristi and esign, none of them offloaded.

That was survivable on two gunicorn workers. `WEB_CONCURRENCY` is now 1 on
production, so a single process serves everything: one person downloading an
invoice or running payroll stalled EVERY other request for the length of the
render. Payroll is the worst of them — `process_payroll` renders a payslip per
employee in a loop.

── WHAT THESE ASSERT

Not "the source contains to_thread" — that is a spelling test and it would pass
against a `to_thread` call that was never awaited. The first test runs a real
blocking function through the same mechanism and proves OTHER coroutines make
progress while it runs. The rest pin the call sites.
"""
import asyncio
import inspect
import time

import pytest


def _burn(seconds: float = 0.3):
    """A CPU-bound render, in the only way that matters here: it does not yield."""
    end = time.monotonic() + seconds
    while time.monotonic() < end:
        pass
    return b"%PDF-1.4"


async def _ticks_during(render_awaitable_factory):
    """
    How many 10ms ticks a concurrent coroutine completes WHILE the render runs.

    Sampled the instant the render returns and BEFORE the ticker is awaited —
    which is the whole trick. The first version of this test counted ticks after
    `await task`, and the ticker always reached 20 either way: blocking the loop
    only DELAYS those ticks, it does not cancel them. Measuring at the end
    therefore compared nothing, and the control passed when it should have
    failed. Sample mid-flight or the number means nothing.
    """
    ticks = 0

    async def ticker():
        nonlocal ticks
        for _ in range(40):
            await asyncio.sleep(0.01)
            ticks += 1

    task = asyncio.create_task(ticker())
    await asyncio.sleep(0)               # let the ticker reach its first await
    await render_awaitable_factory()
    during = ticks                       # <- sampled before the ticker is drained
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass
    return during


@pytest.mark.asyncio
async def test_offloading_the_render_keeps_the_event_loop_serving():
    """
    The property that matters: a 300ms CPU-bound render must not stop other
    requests from being served.

    ASSERTED RELATIVELY, against the same work run inline, because an absolute
    tick count is a property of the machine and not of the code. `asyncio.sleep`
    granularity is ~1ms on Linux and ~15ms+ on Windows, so a 300ms window is
    worth ~250 ticks on one and ~8 on the other. A fixed threshold would either
    pass everywhere or flake in CI; the ratio holds on both.

    Run directly rather than through the handlers — those need a database, an
    org and a real WeasyPrint install, none of which change the answer to "does
    to_thread release the loop".
    """
    async def inline():
        _burn()                          # on the loop, exactly as the old code was

    offloaded = await _ticks_during(lambda: asyncio.to_thread(_burn))
    blocking  = await _ticks_during(inline)

    assert blocking <= 2, (
        f"the inline control managed {blocking} ticks — it did not block, so this "
        "machine cannot demonstrate the difference and the comparison is void"
    )
    assert offloaded >= 4 * max(blocking, 1), (
        f"offloaded render allowed {offloaded} concurrent ticks against {blocking} "
        "inline — the event loop is still being blocked, which is what this fix "
        "exists to prevent"
    )


# ── The call sites ───────────────────────────────────────────────────────────

def _code(fn) -> str:
    src = inspect.getsource(fn)
    return " ".join("\n".join(
        l for l in src.splitlines() if not l.strip().startswith("#")).split())


@pytest.mark.parametrize("module_path,handler", [
    ("routers.ganit",     "download_invoice_pdf"),
    ("routers.vetana",    "download_payslip_pdf"),
    ("routers.vetana",    "process_payroll"),
    ("routers.documents", "download_gstr3b_pdf"),
    ("routers.documents", "download_agreement_pdf"),
    ("routers.dristi",    "export_report"),
    ("routers.esign",     "_generate_signed_pdf"),
])
def test_every_pdf_handler_offloads_its_render(module_path, handler):
    import importlib
    fn = getattr(importlib.import_module(module_path), handler)
    code = _code(fn)
    assert "asyncio.to_thread" in code, f"{handler} renders on the event loop"
    assert "await asyncio.to_thread" in code, (
        f"{handler} calls to_thread without awaiting it — that returns a coroutine, "
        "so the PDF would be a coroutine object and the render would never run"
    )
