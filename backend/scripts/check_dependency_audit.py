#!/usr/bin/env python3
"""check_dependency_audit.py — the backend dependency audit, RATCHETED.

── What this replaces ─────────────────────────────────────────────────────────

    - name: Dependency audit
      run: pip-audit --strict --desc || true

`|| true`. That step has never been able to fail, and on the day this was
written it was hiding **24 known vulnerabilities across 6 shipped packages**:

    pyjwt            2.12.0   5 advisories   fixed in 2.12.1 / 2.13.0
    cryptography     44.0.3   6 advisories   fixed in 46.0.6 and later
    starlette        0.46.2   7 advisories   fixed in 0.47.2 and later
    python-multipart 0.0.29   3 advisories   fixed in 0.0.30 / 0.0.31
    pypdf            6.14.2   2 advisories   fixed in 6.15.0
    weasyprint       68.0     1 advisory     NO FIX AVAILABLE

`pyjwt` is the library this product signs and verifies its sessions with, and
`cryptography` sits under it. Five advisories against the first and six against
the second is not a lint result; it is the sort of thing an audit exists to put
in front of a person. Nobody had been told, because a green tick over `|| true`
looks exactly like a green tick over a clean audit.

── Why a ratchet, and what it deliberately does NOT do ────────────────────────

It does not upgrade anything. Every one of these is a pinned version in
`requirements.txt`, so clearing them is a production dependency change that
needs the 15,127-test suite behind it and a deploy — an owner action with its
own risk, not something to slip into a testing pass. `weasyprint` has no fix at
all, so "fail on any advisory" would be permanently red and therefore
permanently ignored.

What is available today is stopping the number from growing. The 24 known
advisory ids are recorded by name; a TWENTY-FIFTH fails the build. The list may
shrink — and it should, starting with pyjwt — and it may never grow.

── Usage ──────────────────────────────────────────────────────────────────────

    python scripts/check_dependency_audit.py            # from backend/
    python scripts/check_dependency_audit.py --write    # re-record

⚠ It audits `requirements.txt`, NOT the ambient environment. The environment on
a developer's machine carries test and tooling packages that never ship; an
advisory against one of those is not a fact about the product, and a gate that
cannot tell the difference is a gate that gets muted.
"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

# ⚠ Windows console encoding, and why this is not cosmetic.
#
# A bare Python process on this machine writes stdout as cp1252, so the first
# `✓` this script printed died with UnicodeEncodeError — AFTER doing all its
# work and reaching the right answer. A gate that crashes while reporting a
# pass is a gate that reports a failure, and the CI runner (UTF-8 by default)
# would never have shown it. Force the encoding rather than downgrade the
# output to ASCII: the rest of this repo's gates print the same marks.
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):  # already wrapped, or not a real tty
        pass

HERE = Path(__file__).resolve().parent
BACKEND = HERE.parent
BASELINE = HERE / "dependency_audit_baseline.json"
REQUIREMENTS = BACKEND / "requirements.txt"


def run_audit() -> list[dict]:
    """Return pip-audit's dependency records, or exit loudly if it did not run."""
    if not REQUIREMENTS.exists():
        sys.exit(f"check_dependency_audit: no {REQUIREMENTS}. Run from backend/.")

    proc = subprocess.run(
        [sys.executable, "-m", "pip_audit", "--strict", "--format=json", "-r", str(REQUIREMENTS)],
        capture_output=True,
        text=True,
        cwd=BACKEND,
    )

    if not proc.stdout.strip():
        print("check_dependency_audit: pip-audit produced no output.", file=sys.stderr)
        print("The audit did not complete, so the result is UNKNOWN — which is not a pass.", file=sys.stderr)
        print(f"exit={proc.returncode}\nstderr: {proc.stderr[:600]}", file=sys.stderr)
        sys.exit(1)

    try:
        payload = json.loads(proc.stdout)
    except json.JSONDecodeError as exc:
        print(f"check_dependency_audit: pip-audit output is not JSON ({exc}).", file=sys.stderr)
        print(f"stdout starts: {proc.stdout[:300]}", file=sys.stderr)
        sys.exit(1)

    deps = payload.get("dependencies", payload if isinstance(payload, list) else [])

    # ANTI-VACUITY FLOOR. An empty dependency list means pip-audit resolved
    # nothing — a broken requirements file, a network failure, a format change —
    # and "zero packages audited, zero vulnerabilities" would otherwise read as
    # the cleanest possible result. requirements.txt has ~74 packages; anything
    # near zero is a harness failure, not good news.
    if len(deps) < 20:
        print(
            f"check_dependency_audit: pip-audit reported only {len(deps)} package(s) from "
            f"{REQUIREMENTS.name}, which has {sum(1 for line in REQUIREMENTS.read_text().splitlines() if line.strip() and not line.startswith('#'))} "
            "requirement lines. The audit did not really run.",
            file=sys.stderr,
        )
        sys.exit(1)

    return deps


def main() -> int:
    deps = run_audit()

    found: dict[str, str] = {}
    for dep in deps:
        for vuln in dep.get("vulns") or []:
            fix = ", ".join(vuln.get("fix_versions") or []) or "NO FIX AVAILABLE"
            found[vuln["id"]] = f"{dep['name']}=={dep['version']} · fix: {fix}"

    by_pkg: dict[str, int] = {}
    for desc in found.values():
        by_pkg[desc.split("==")[0]] = by_pkg.get(desc.split("==")[0], 0) + 1

    print(
        f"check_dependency_audit: {len(deps)} package(s) audited from requirements.txt · "
        f"{len(found)} known vulnerability(ies) in {len(by_pkg)} package(s)\n"
    )
    for pkg, n in sorted(by_pkg.items(), key=lambda kv: -kv[1]):
        print(f"    {n:3}  {pkg}")
    print("")

    if "--write" in sys.argv:
        BASELINE.write_text(
            json.dumps(
                {
                    "_comment": (
                        "Known vulnerabilities in backend production dependencies. SHRINK ONLY — "
                        "see scripts/check_dependency_audit.py. Clearing these means bumping pinned "
                        "versions in requirements.txt, which needs the full suite and a deploy behind "
                        "it. pyjwt and cryptography are the ones to do first."
                    ),
                    "_recorded": "2026-08-30",
                    "known": dict(sorted(found.items())),
                },
                indent=2,
            )
            + "\n",
            encoding="utf-8",
        )
        print(f"recorded {len(found)} known vulnerability(ies) to {BASELINE.name}")
        return 0

    if not BASELINE.exists():
        print(f"check_dependency_audit: no baseline at {BASELINE}. Create it with --write.", file=sys.stderr)
        return 1

    known: dict[str, str] = json.loads(BASELINE.read_text(encoding="utf-8"))["known"]
    fresh = {k: v for k, v in found.items() if k not in known}
    fixed = [k for k in known if k not in found]

    if fixed:
        print(f"✓ {len(fixed)} baselined vulnerability(ies) are gone. Shrink the baseline (--write):")
        for k in sorted(fixed):
            print(f"    {k}  {known[k]}")
        print("")

    if fresh:
        print(f"✘ {len(fresh)} NEW vulnerability(ies) in production dependencies:\n", file=sys.stderr)
        for k, v in sorted(fresh.items()):
            print(f"    {k}  {v}", file=sys.stderr)
        print(
            "\n  Bump the pinned version in requirements.txt, or — if it cannot be bumped\n"
            "  today — record why in docs/STATUS.md and add it here WITH that entry.\n"
            "  Do not add it silently.",
            file=sys.stderr,
        )
        return 1

    print(f"✓ no new vulnerabilities; {len(known)} held at baseline.")
    print("  Listed in scripts/dependency_audit_baseline.json with the version that fixes each.")
    print("  pyjwt (5) and cryptography (6) are the ones worth doing first.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
