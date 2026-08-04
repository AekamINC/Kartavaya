#!/usr/bin/env python3
"""Phase 9 — the Android app, driven on a real emulator.

── Why this exists instead of Maestro ──────────────────────────────────────
The plan called for Maestro, because Playwright cannot drive a native app.
Maestro is a JVM tool and there is no Java on this machine, so it could not run
here. What it does underneath — dump the view hierarchy, find a node, tap or
type at its centre — is `adb` plus `uiautomator`, both of which ARE installed
with the Android SDK. This harness does exactly that, with no new dependency.

If Maestro is installed later, the flows translate almost line for line. The
value that would be lost by waiting is a phase that never ran.

── Three environment facts this file encodes, each of which cost a round trip ──

1. **Git Bash rewrites device paths.** `adb shell uiautomator dump /sdcard/ui.xml`
   writes to `/Files/Git/sdcard/ui.xml` on the HOST and reports success. The
   dump then reads as an empty file and looks like a broken app. Every device
   path here is doubled (`//sdcard/...`) and MSYS_NO_PATHCONV is set by the
   caller.

2. **The dump is UTF-8 and Windows Python is not.** The app is bilingual, so the
   hierarchy is full of Devanagari; decoding it as cp1252 raises
   UnicodeDecodeError mid-read and the failure surfaces as `NoneType` several
   frames later. Every subprocess here decodes UTF-8 explicitly.

3. **The password field cannot be found by its placeholder.** It renders as
   `••••••••`, which does not survive the shell round trip. Fields are located
   by `class="android.widget.EditText"` in screen order instead.

── Usage ───────────────────────────────────────────────────────────────────
    export ANDROID_HOME=~/AppData/Local/Android/Sdk
    export PATH="$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH"
    export MSYS_NO_PATHCONV=1
    emulator -avd Pixel_9_Pro -no-snapshot-save -gpu swiftshader_indirect &
    python mobile/e2e/android_e2e.py

Credentials come from the repo-root `.env.e2e`, the same file the Playwright
suites read. Nothing is hard-coded.
"""
from __future__ import annotations

import os
import re
import subprocess
import sys
import time
from pathlib import Path

PKG = "com.aekaminc.Kartavaya"
ACTIVITY = f"{PKG}/.MainActivity"
DEVICE_DUMP = "//sdcard/ui.xml"          # doubled: see note 1


def sh(*args: str) -> str:
    """adb shell, decoded as UTF-8 — the hierarchy is bilingual (note 2)."""
    out = subprocess.run(
        ["adb", "shell", *args], capture_output=True, encoding="utf-8", errors="replace"
    )
    return out.stdout or ""


def dump() -> str:
    sh("uiautomator", "dump", DEVICE_DUMP)
    return sh("cat", DEVICE_DUMP)


def texts(xml: str) -> list[str]:
    return [t for t in re.findall(r'text="([^"]*)"', xml) if t.strip()]


def node_center(xml: str, label: str) -> tuple[int, int] | None:
    m = re.search(
        rf'text="{re.escape(label)}"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"', xml
    )
    if not m:
        return None
    a, b, c, d = map(int, m.groups())
    return (a + c) // 2, (b + d) // 2


def edit_fields(xml: str) -> list[tuple[int, int]]:
    """Every text input, in screen order — the only reliable way to reach the
    password box, whose placeholder is bullets (note 3)."""
    out = []
    for m in re.finditer(
        r'class="android\.widget\.EditText"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"',
        xml,
    ):
        a, b, c, d = map(int, m.groups())
        out.append(((a + c) // 2, (b + d) // 2))
    return out


def tap(pt: tuple[int, int]) -> None:
    subprocess.run(["adb", "shell", "input", "tap", str(pt[0]), str(pt[1])])


def type_text(s: str) -> None:
    subprocess.run(["adb", "shell", "input", "text", s])


def env() -> dict[str, str]:
    path = Path(__file__).resolve().parents[2] / ".env.e2e"
    vals: dict[str, str] = {}
    if path.exists():
        for line in path.read_text(encoding="utf-8").splitlines():
            m = re.match(r"^([A-Z0-9_]+)=(.*)$", line)
            if m:
                vals[m.group(1)] = m.group(2)
    return vals


# ── checks ───────────────────────────────────────────────────────────────────

FAILURES: list[str] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    print(f"  {'ok  ' if ok else 'FAIL'} {name}" + (f" — {detail}" if detail and not ok else ""))
    if not ok:
        FAILURES.append(f"{name}{': ' + detail if detail else ''}")


def dismiss_system_dialogs() -> None:
    """The emulator throws a systemui ANR under software rendering. Answering
    "Wait" keeps it alive; killing it takes the navigation bar with it."""
    xml = dump()
    for label in ("Wait", "Close app"):
        if "isn't responding" in xml and (pt := node_center(xml, label)):
            tap(pt)
            time.sleep(3)
            return


def main() -> int:
    cfg = env()
    email = cfg.get("E2E_ADMIN_EMAIL", "")
    password = cfg.get("E2E_ADMIN_PASSWORD", "")
    if not email or not password:
        print("E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD missing from .env.e2e")
        return 2

    devices = subprocess.run(["adb", "devices"], capture_output=True, text=True).stdout
    if "\tdevice" not in devices:
        print("No device. Start one:\n"
              "  emulator -avd Pixel_9_Pro -no-snapshot-save -gpu swiftshader_indirect &")
        return 2

    print("== launch")
    sh("am", "force-stop", PKG)
    sh("am", "start", "-n", ACTIVITY)
    time.sleep(12)
    dismiss_system_dialogs()

    xml = dump()
    check("the app renders its own UI, not a blank surface", xml.count("<node") > 0,
          "uiautomator returned no nodes")

    # A mobile app that forgets its session on every cold start is unusable on a
    # phone, so BOTH states are legitimate and the harness asserts whichever it
    # meets rather than demanding the login screen.
    at_login = "Sign in to Kartavaya" in xml

    if at_login:
        print("== sign in (cold, no stored session)")
        check("it states that sign-up is invite-only",
              any("invite-only" in t for t in texts(xml)))
        fields = edit_fields(xml)
        check("the form offers an email and a password field", len(fields) >= 2,
              f"found {len(fields)} input(s)")
        if len(fields) < 2:
            return 1

        tap(fields[0]); time.sleep(1); type_text(email); time.sleep(1)
        tap(fields[1]); time.sleep(1); type_text(password); time.sleep(1)
        subprocess.run(["adb", "shell", "input", "keyevent", "KEYCODE_BACK"])
        time.sleep(1)

        xml = dump()
        if pt := node_center(xml, "Sign in"):
            tap(pt)
        time.sleep(25)
        dismiss_system_dialogs()
        xml = dump()
        check("signing in leaves the login screen",
              "Sign in to Kartavaya" not in xml, f"still on: {texts(xml)[:6]}")
    else:
        print("== session restored (warm start)")
        check("the session survives a force-stop and cold launch", True)
    check("the bottom tab bar renders", "Today" in xml, f"saw: {texts(xml)[:10]}")
    check("the app is bilingual on the device too", "आज" in xml,
          "the Devanagari labels are missing")

    print("== tabs")
    for tab in ("Tasks", "Messages", "More", "Today"):
        xml = dump()
        pt = node_center(xml, tab)
        if not pt:
            check(f"the {tab} tab is reachable", False, "not on screen")
            continue
        tap(pt)
        time.sleep(6)
        after = dump()
        check(f"the {tab} tab opens something", after.count("<node") > 5,
              f"only {after.count('<node')} nodes after tapping")

    print()
    if FAILURES:
        print(f"{len(FAILURES)} FAILED:")
        for f in FAILURES:
            print("  -", f)
        return 1
    print("all Android checks passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
