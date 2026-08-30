#!/usr/bin/env python3
"""mutate.py — mutation testing, aimed at THIS repository's dominant bug class.

── Why a bespoke tool and not mutmut ─────────────────────────────────────────

Mutation testing is already the practice here; it is just done by hand, one
change at a time, and only when somebody remembers. The record is in
`docs/STATUS.md`: "4 mutations proved to bite, 196 tests green", "27 tests, 19
mutations each", "five mutations each bit a different set". Every one of those
was a person editing a file, running pytest, and putting it back.

That works and it does not scale, and what does not scale gets skipped exactly
when the change is big enough to need it.

`mutmut` was not adopted because a general mutation tool over 490 test files
and ~15,127 tests is a multi-hour run that mutates getters and log lines with
equal enthusiasm. The value here is narrow and known, so the tool is narrow:

    ⚠ THE DOMINANT DEFECT CLASS IN THIS CODEBASE IS A HANDLER THAT TURNS
      FAILURE INTO SILENCE.

Five instances in a single day, including a 2FA bypass and a separation-of-duties
fail-open. Grep cannot find them, because the code looks correct — an `except`
that swallows, or a guard whose condition can never be true, reads exactly like
one that works. A test suite that never exercises the failing branch cannot
find them either, and it stays green while it fails to.

Mutation testing is the one method that does find them: break the guard on
purpose, and if every test still passes, nothing was ever checking it.

── The operators, and why each one is here ──────────────────────────────────

  guard-never-fires   `if <cond>: raise/return`  ->  `if False: ...`
                      THE ONE THAT MATTERS. Every authorisation check, tenancy
                      check and validation in this codebase has this shape. If
                      a guard can be disabled with the whole suite still green,
                      that guard is decoration.

  handler-swallows    `except E: <body>`  ->  `except E: pass`
                      The fail-open shape, directly. A handler that logs and
                      re-raises and a handler that swallows are one keyword
                      apart and look identical in review.

  compare-flip        `>` <-> `>=`, `==` <-> `!=`, `<` <-> `<=`
                      Off-by-one and inverted-condition faults.

  bool-flip           `True` <-> `False`
                      Catches a default that nothing asserts.

── What a result means ──────────────────────────────────────────────────────

  KILLED    the tests went red. The behaviour is pinned. Good.
  SURVIVED  the tests stayed GREEN with the code deliberately broken. Nothing
            is checking that line. This is the finding.
  ERROR     the mutant did not import or collect — not a result either way,
            reported separately so it cannot be mistaken for a kill.

A SURVIVED mutation is not automatically a bug; some are equivalent mutants, or
guard clauses that genuinely cannot be reached. It is always a question worth
answering, and right now nothing is asking it.

── Usage ────────────────────────────────────────────────────────────────────

    cd backend
    python scripts/mutate.py approvals_router.py tests/test_approvals_authorisation.py
    python scripts/mutate.py auth_router.py tests/test_2fa_is_actually_enforced.py --only guard-never-fires
    python scripts/mutate.py <src> <tests> --limit 20 --json report.json

⚠ It EDITS THE SOURCE FILE IN PLACE and restores it from an in-memory copy
after every run, including on Ctrl-C. It refuses to start on a file with
unstaged changes, so an interrupted run can always be recovered with
`git checkout`.
"""
from __future__ import annotations

import argparse
import ast
import json
import signal
import subprocess
import sys
from dataclasses import dataclass, field
from pathlib import Path

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass

BACKEND = Path(__file__).resolve().parent.parent


@dataclass
class Mutation:
    operator: str
    line: int
    before: str
    after: str
    status: str = "?"
    detail: str = ""


@dataclass
class Plan:
    source: Path
    tests: str
    mutations: list[Mutation] = field(default_factory=list)


# ── Finding the mutations ────────────────────────────────────────────────────

FLIP = {ast.Gt: ast.GtE, ast.GtE: ast.Gt, ast.Lt: ast.LtE, ast.LtE: ast.Lt,
        ast.Eq: ast.NotEq, ast.NotEq: ast.Eq}
FLIP_TEXT = {ast.Gt: ">", ast.GtE: ">=", ast.Lt: "<", ast.LtE: "<=", ast.Eq: "==", ast.NotEq: "!="}


def _raises_or_returns(node: ast.If) -> bool:
    """A guard clause: its body only raises, or returns early."""
    return all(isinstance(s, (ast.Raise, ast.Return, ast.Pass)) for s in node.body) and bool(node.body)


def find_mutations(tree: ast.AST, lines: list[str]) -> list[Mutation]:
    out: list[Mutation] = []
    for node in ast.walk(tree):
        # guard-never-fires
        if isinstance(node, ast.If) and _raises_or_returns(node):
            src = lines[node.lineno - 1].strip()
            out.append(Mutation("guard-never-fires", node.lineno, src, "if False:  # MUTANT"))
        # handler-swallows
        elif isinstance(node, ast.ExceptHandler):
            body_is_pass = len(node.body) == 1 and isinstance(node.body[0], ast.Pass)
            if not body_is_pass:
                out.append(
                    Mutation("handler-swallows", node.lineno, lines[node.lineno - 1].strip(), "pass  # MUTANT")
                )
        # compare-flip
        elif isinstance(node, ast.Compare) and len(node.ops) == 1 and type(node.ops[0]) in FLIP:
            op = type(node.ops[0])
            out.append(
                Mutation("compare-flip", node.lineno, f"{FLIP_TEXT[op]} on line {node.lineno}",
                         FLIP_TEXT[FLIP[op]])
            )
        # bool-flip
        elif isinstance(node, ast.Constant) and isinstance(node.value, bool):
            out.append(
                Mutation("bool-flip", node.lineno, str(node.value), str(not node.value))
            )
    return out


# ── Applying one mutation ────────────────────────────────────────────────────

def apply(original: str, m: Mutation) -> str | None:
    """Return the mutated source, or None when the edit cannot be made safely."""
    lines = original.split("\n")
    i = m.line - 1
    if i >= len(lines):
        return None
    line = lines[i]
    indent = line[: len(line) - len(line.lstrip())]

    if m.operator == "guard-never-fires":
        if not line.strip().startswith(("if ", "elif ")):
            return None
        kw = "elif" if line.strip().startswith("elif") else "if"
        lines[i] = f"{indent}{kw} False:  # MUTANT"
    elif m.operator == "handler-swallows":
        if "except" not in line:
            return None
        # Replace the handler body with `pass`, keeping the `except ...:` line.
        # The body is every following line indented deeper than the `except`.
        j = i + 1
        body_indent = None
        while j < len(lines):
            stripped = lines[j].strip()
            if not stripped:
                j += 1
                continue
            cur = len(lines[j]) - len(lines[j].lstrip())
            if body_indent is None:
                body_indent = cur
            if cur < (body_indent or 0) or cur <= len(indent):
                break
            j += 1
        if body_indent is None:
            return None
        lines[i + 1 : j] = [f"{' ' * body_indent}pass  # MUTANT"]
    elif m.operator == "compare-flip":
        before = m.before.split(" on line")[0]
        if before not in line:
            return None
        lines[i] = line.replace(before, m.after, 1)
    elif m.operator == "bool-flip":
        # Word-boundary replace so `True` inside an identifier is untouched.
        import re

        new, n = re.subn(rf"\b{m.before}\b", m.after, line, count=1)
        if n == 0:
            return None
        lines[i] = new
    else:
        return None

    mutated = "\n".join(lines)
    try:
        ast.parse(mutated)          # a mutant that cannot parse is not a test
    except SyntaxError:
        return None
    return mutated


# ── Running ──────────────────────────────────────────────────────────────────

def run_tests(tests: str, timeout: int) -> tuple[bool, str]:
    """True when the suite PASSES. A pass over broken code is a survivor."""
    proc = subprocess.run(
        # `tests.split()` — a caller naming several files passes them as one
        # shell word, and pytest then treats the whole string as a single path
        # and collects nothing. That produced "no tests ran in 0.00s" reported
        # as a RED BASELINE, which is the right refusal for the wrong reason.
        [sys.executable, "-m", "pytest", *tests.split(), "-q", "-x", "--no-header", "-p", "no:cacheprovider"],
        cwd=BACKEND, capture_output=True, text=True, timeout=timeout,
    )
    tail = (proc.stdout or "").strip().split("\n")[-1][:120]
    return proc.returncode == 0, tail


def main() -> int:
    ap = argparse.ArgumentParser(description="Mutation testing for the guard/handler bug class.")
    ap.add_argument("source")
    ap.add_argument("tests", help="one or more pytest paths, space-separated in a single argument")
    ap.add_argument("--only", action="append", help="restrict to an operator (repeatable)")
    ap.add_argument("--limit", type=int, default=40, help="max mutants to run (default 40)")
    ap.add_argument("--timeout", type=int, default=600)
    ap.add_argument("--json", help="write the full result to this path")
    args = ap.parse_args()

    src = (BACKEND / args.source).resolve()
    if not src.exists():
        sys.exit(f"mutate: no such file {src}")

    # Refuse to mutate a file with uncommitted work: this edits in place, and an
    # interrupted run must always be recoverable with `git checkout`.
    dirty = subprocess.run(["git", "status", "--porcelain", str(src)],
                           cwd=BACKEND, capture_output=True, text=True).stdout.strip()
    if dirty:
        sys.exit(f"mutate: {args.source} has uncommitted changes. Commit or stash first —\n"
                 "        this tool edits the file in place and `git checkout` is the safety net.")

    # ⚠ `newline=""` ON BOTH THE READ AND EVERY WRITE.
    #
    # `Path.write_text` uses universal newline translation, so on Windows it
    # turns every LF back into CRLF on the way out. This tool restores the file
    # from an in-memory copy after every mutant, and without this the "restore"
    # rewrote a 955-line LF file as CRLF, leaving the whole file dirty in git
    # after a run that had changed nothing. Caught by this tool's own
    # uncommitted-changes guard on the very next invocation, which is the one
    # place it was guaranteed to be noticed.
    original = src.read_text(encoding="utf-8", newline="")
    lines = original.split("\n")
    tree = ast.parse(original)

    mutations = find_mutations(tree, lines)
    if args.only:
        mutations = [m for m in mutations if m.operator in args.only]

    # Deterministic order, and the guard/handler operators FIRST — they are the
    # ones this tool exists for, and `--limit` should spend its budget there.
    priority = {"guard-never-fires": 0, "handler-swallows": 1, "compare-flip": 2, "bool-flip": 3}
    mutations.sort(key=lambda m: (priority.get(m.operator, 9), m.line))
    selected = mutations[: args.limit]

    print(f"mutate: {args.source} against {args.tests}")
    print(f"        {len(mutations)} candidate mutation(s), running {len(selected)}\n")

    # Baseline: the suite must be GREEN before any of this means anything. A
    # suite that is already red kills every mutant for free and reports perfect
    # coverage.
    print("        baseline (unmutated) ... ", end="", flush=True)
    ok, tail = run_tests(args.tests, args.timeout)
    if not ok:
        print("RED")
        sys.exit(f"\nmutate: the suite is already failing — {tail}\n"
                 "        Every mutant would 'die' against a red suite and the score would be a lie.")
    print(f"GREEN ({tail})\n")

    def restore(*_a):
        with open(src, "w", encoding="utf-8", newline="") as fh:
            fh.write(original)

    signal.signal(signal.SIGINT, lambda *a: (restore(), sys.exit(130)))

    try:
        for n, m in enumerate(selected, 1):
            mutated = apply(original, m)
            if mutated is None:
                m.status = "SKIPPED"
                m.detail = "could not be applied safely"
                print(f"  {n:3}/{len(selected)}  {m.operator:18} line {m.line:5}  SKIPPED")
                continue
            with open(src, "w", encoding="utf-8", newline="") as fh:
                fh.write(mutated)
            try:
                passed, tail = run_tests(args.tests, args.timeout)
            except subprocess.TimeoutExpired:
                m.status, m.detail = "ERROR", "timed out"
                print(f"  {n:3}/{len(selected)}  {m.operator:18} line {m.line:5}  ERROR (timeout)")
                continue
            finally:
                restore()
            m.detail = tail
            if passed:
                m.status = "SURVIVED"
                print(f"  {n:3}/{len(selected)}  {m.operator:18} line {m.line:5}  ⚠ SURVIVED  {m.before[:52]}")
            else:
                m.status = "KILLED"
                print(f"  {n:3}/{len(selected)}  {m.operator:18} line {m.line:5}  killed")
    finally:
        restore()

    survived = [m for m in selected if m.status == "SURVIVED"]
    killed = [m for m in selected if m.status == "KILLED"]
    other = [m for m in selected if m.status not in ("SURVIVED", "KILLED")]

    print(f"\n  {len(killed)} killed · {len(survived)} SURVIVED · {len(other)} not run")
    if killed and not survived:
        print("\n✓ every mutation was caught. The behaviour on those lines is pinned.")
    if survived:
        print(f"\n⚠ {len(survived)} mutation(s) left the suite GREEN. Nothing is checking these lines:\n")
        for m in survived:
            print(f"    {args.source}:{m.line}  [{m.operator}]")
            print(f"        {m.before[:88]}")
        print("\n  Each is a question, not automatically a bug — an equivalent mutant and an")
        print("  unreachable guard both survive honestly. But a guard that can be disabled")
        print("  with the suite still green is the exact shape of the 2FA bypass and the")
        print("  separation-of-duties fail-open this repo has already shipped twice.")

    if args.json:
        Path(args.json).write_text(json.dumps({
            "source": args.source, "tests": args.tests,
            "killed": len(killed), "survived": len(survived), "not_run": len(other),
            "mutations": [vars(m) for m in selected],
        }, indent=2), encoding="utf-8")
        print(f"\n  full result written to {args.json}")

    # Exit 0 even with survivors: this is an INSTRUMENT, not a gate. Wiring it
    # to fail a build would mean choosing a survivor threshold, and there is no
    # honest one — equivalent mutants exist and pretending otherwise turns a
    # sharp tool into a number people game.
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
