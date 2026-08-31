#!/usr/bin/env python3
r"""The adb/uiautomator driver Suite 21 is built on.

Split out of `android_e2e.py` so the flows read as flows. Everything here is
mechanism; every assertion lives in the suite file.

── The environment facts this layer encodes ────────────────────────────────────

Four, not the three the original file listed. The fourth was measured on
2026-08-29 and had been latent since the file was written.

1. **Git Bash rewrites device paths.** `adb shell uiautomator dump /sdcard/ui.xml`
   writes to `/Files/Git/sdcard/ui.xml` on the HOST and reports success. The dump
   then reads as an empty file and looks like a broken app. Every device path
   here is doubled (`//sdcard/...`) and MSYS_NO_PATHCONV is set by the caller.

2. **The dump is UTF-8 and Windows Python is not.** The app is bilingual, so the
   hierarchy is full of Devanagari; decoding it as cp1252 raises
   UnicodeDecodeError mid-read and the failure surfaces as `NoneType` several
   frames later. Every subprocess here decodes UTF-8 explicitly.

3. **The password field cannot be found by its placeholder.** It renders as
   bullets, which do not survive the shell round trip. Fields are located by
   `class="android.widget.EditText"` in screen order instead.

4. **Decoding UTF-8 is only half of fact 2 — PRINTING it is the other half.**
   `sys.stdout` on Windows Python is cp1252, so the moment any check prints a
   Devanagari label it raises UnicodeEncodeError and the run dies. The original
   file passed `texts(xml)[:6]` as the failure DETAIL of two checks, so this
   could only ever fire on a FAILING assertion: the harness crashed instead of
   reporting, and precisely when it had something to report. `install()` below
   reconfigures stdout, and it is called before anything prints.

── Host paths vs device paths ─────────────────────────────────────────────────

`MSYS_NO_PATHCONV=1` fixes device paths and BREAKS host ones: `adb install
/d/Projects/...` then fails to stat. Host paths go to adb in native Windows form
(`D:\...`); device paths stay doubled. Both forms appear here on purpose.
"""
from __future__ import annotations

import os
import re
import subprocess
import sys
import threading
import time
from pathlib import Path

PKG = "com.aekaminc.Kartavaya"
ACTIVITY = PKG + "/.MainActivity"
DEVICE_DUMP = "//sdcard/ui.xml"          # doubled: see fact 1

# Private-use codepoints: the icon font renders its glyphs as text nodes, and
# they are noise in every label comparison and every printed dump.
GLYPH = re.compile(r"^[\ue000-\uf8ff]+$")

UUID_RE = re.compile(
    r"\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b", re.I
)


def install() -> None:
    """Make this process safe for a bilingual hierarchy. See fact 4."""
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass
    os.environ.setdefault("MSYS_NO_PATHCONV", "1")


# ── adb ───────────────────────────────────────────────────────────────────────

def adb(*args: str, timeout: int = 120) -> str:
    out = subprocess.run(
        ["adb", *args], capture_output=True, encoding="utf-8",
        errors="replace", timeout=timeout,
    )
    return (out.stdout or "") + (out.stderr or "")


def sh(*args: str, timeout: int = 120) -> str:
    """adb shell, decoded as UTF-8 — the hierarchy is bilingual (fact 2)."""
    out = subprocess.run(
        ["adb", "shell", *args], capture_output=True, encoding="utf-8",
        errors="replace", timeout=timeout,
    )
    return out.stdout or ""


def pause(seconds: float) -> None:
    """Sleep on the DEVICE, never on the host.

    The host runner forbids a foreground `sleep`, and a device-side wait also
    sits on the same clock as the thing being waited for.
    """
    sh("sleep", str(seconds), timeout=int(seconds) + 60)


# ── the view hierarchy ────────────────────────────────────────────────────────

def dump() -> str:
    sh("uiautomator", "dump", DEVICE_DUMP)
    return sh("cat", DEVICE_DUMP)


def texts(xml: str) -> list[str]:
    return [t for t in re.findall(r'text="([^"]*)"', xml) if t.strip()]


def labels(xml: str) -> list[str]:
    """Readable text only — the icon-font glyphs dropped."""
    return [t for t in texts(xml) if not GLYPH.match(t)]


def descs(xml: str) -> list[str]:
    return [d for d in re.findall(r'content-desc="([^"]*)"', xml) if d.strip()]


def has(xml: str, needle: str) -> bool:
    """Anywhere on the screen — a label, a content-desc, a hint."""
    return needle in xml


def node_center(xml: str, label: str) -> tuple[int, int] | None:
    m = re.search(
        r'text="' + re.escape(label) + r'"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"',
        xml,
    )
    if not m:
        m = re.search(
            r'content-desc="' + re.escape(label)
            + r'"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"',
            xml,
        )
    if not m:
        return None
    a, b, c, d = map(int, m.groups())
    return (a + c) // 2, (b + d) // 2


def all_bounds(xml: str) -> list[tuple[int, int, int, int]]:
    out = []
    for m in re.finditer(r'bounds="\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]"', xml):
        a, b, c, d = map(int, m.groups())
        out.append((a, b, c, d))
    return out


def edit_fields(xml: str) -> list[tuple[int, int]]:
    """Every text input, in screen order — the only reliable way to reach the
    password box, whose placeholder is bullets (fact 3)."""
    out = []
    for m in re.finditer(
        r'class="android\.widget\.EditText"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"',
        xml,
    ):
        a, b, c, d = map(int, m.groups())
        out.append(((a + c) // 2, (b + d) // 2))
    return out


# ── input ─────────────────────────────────────────────────────────────────────

def tap(pt: tuple[int, int]) -> None:
    sh("input", "tap", str(pt[0]), str(pt[1]))


def tap_label(label: str, settle: float = 4) -> bool:
    xml = dump()
    pt = node_center(xml, label)
    if not pt:
        return False
    tap(pt)
    pause(settle)
    return True


def type_text(s: str) -> None:
    # `input text` takes ONE token: a space ends the argument and everything
    # after it is dropped silently, so a two-word title arrives as one word.
    sh("input", "text", s.replace(" ", "%s"))


def field_text(xml: str, index: int) -> str | None:
    """What is actually IN the nth text input, read back off the screen.

    ⚠ THIS WAS INOPERATIVE UNTIL 2026-08-31, AND IT FAILED OPEN INTO A
    NEGATIVE. The pattern was:

        <node[^>]*class="android\.widget\.EditText"[^>]*text="([^"]*)"[^>]*>

    which requires `class` to appear BEFORE `text` on the node. uiautomator
    emits them the other way round. Measured against a live dump from
    `emulator-5554` on 2026-08-31 — the attribute order is:

        index, text, resource-id, class, package, content-desc, checkable, ...

    So the regex matched ZERO nodes on every screen, `field_text` returned None
    for every index, and `type_verified` took its `got is None` branch and
    reported **"the field vanished after typing"**. Two red lines that say a
    control disappeared, from a guard that never ran.

    `[^>]*` cannot cross a `>`, which is what makes the ordering load-bearing
    rather than incidental: both attributes must sit on the same node AND in the
    written order.

    It is matched on `text` first now, and `class` is still required so this
    cannot start reading a TextView. The docstring below explains why the guard
    exists at all — it is the check that caught `adb shell input text` dropping
    and doubling characters, and for however long the pattern was reversed that
    check was not being made.
    """
    fields = re.findall(
        r'<node[^>]*text="([^"]*)"[^>]*class="android\.widget\.EditText"', xml)
    return fields[index] if index < len(fields) else None


def type_verified(index: int, value: str, attempts: int = 3) -> tuple[bool, str]:
    """Type into the nth input and CHECK WHAT LANDED, retyping if it is wrong.

    ⚠ `adb shell input text` IS NOT RELIABLE against a React Native TextInput
    on a software-rendered emulator. Measured on `Tab_A11_Plus`, 2026-08-29: the
    string `isha.desai.emp001@example.com` arrived in the field as
    `issha.desai.emp001@example.co` — the first character duplicated AND the
    last one dropped. The server answered "Invalid email or password", the
    harness reported "signing in leaves the login screen: FAIL", and every
    assertion after it failed too, because the run never got into the app. Nine
    red lines that read as nine product defects, from one dropped keystroke.

    The phone never showed it: that AVD had a warm session, so the login path
    was skipped entirely and the typing was never exercised.

    So the field is read back and compared. A password cannot be read back —
    it renders as bullets — so it is checked by LENGTH, which is exactly the
    property a dropped or doubled character breaks.
    """
    for _ in range(attempts):
        xml = dump()
        fields = edit_fields(xml)
        if index >= len(fields):
            return False, f"no input at index {index}"
        tap(fields[index])
        pause(1)
        # Clear whatever a previous attempt left behind.
        sh("input", "keyevent", "--longpress", "KEYCODE_DEL")
        for _ in range(len(value) + 8):
            sh("input", "keyevent", "KEYCODE_DEL")
        type_text(value)
        pause(2)
        got = field_text(dump(), index)
        if got is None:
            return False, "the field vanished after typing"
        # Bullets: compare the length, which is all a masked field will tell us.
        if got == value or (set(got) <= {"•", "*", "·"} and len(got) == len(value)):
            return True, got
    return False, f"landed as {got!r} after {attempts} attempts, wanted {value!r}"


def key(name: str) -> None:
    sh("input", "keyevent", name)


def back() -> None:
    key("KEYCODE_BACK")


def hide_keyboard() -> bool:
    """Close the IME — and ONLY if one is actually open.

    ⚠ BACK IS NOT "dismiss the keyboard". It is "dismiss the keyboard IF one is
    up, otherwise pop the stack, otherwise leave the app." The harness used it
    unconditionally after typing, and all three outcomes happened:

      · on the new-task sheet it closed the SHEET, so the run then tapped
        whatever else answered to "Done", created nothing, and read the title
        back out of the input field it had just typed into — four green checks
        over an empty table;
      · on the tablet's login screen it left the app for the launcher, and the
        sign-in check then reported "still on: ['Play Store', 'Gmail', …]".

    `mInputShown` is the input-method service's own answer, so this presses BACK
    only when there is a keyboard for it to close.
    """
    if "mInputShown=true" not in sh("dumpsys", "input_method"):
        return False
    key("KEYCODE_BACK")
    pause(1)
    return True


def scroll(direction: str = "down", times: int = 1) -> None:
    w, h = screen_px()
    x = w // 2
    if direction == "down":
        y1, y2 = int(h * 0.72), int(h * 0.30)
    else:
        y1, y2 = int(h * 0.30), int(h * 0.72)
    for _ in range(times):
        sh("input", "swipe", str(x), str(y1), str(x), str(y2), "320")
        pause(1.5)


def wait_for(predicate, timeout: float = 30, step: float = 2) -> str:
    """Poll the hierarchy until `predicate(xml)` or the clock runs out.

    Returns the LAST dump either way, so the caller asserts against what was
    actually on screen rather than against a boolean it cannot explain.
    """
    deadline = time.time() + timeout
    xml = dump()
    while time.time() < deadline:
        if predicate(xml):
            return xml
        pause(step)
        xml = dump()
    return xml


# ── the app ───────────────────────────────────────────────────────────────────

def cold_restart(settle: float = 14) -> str:
    """Hot reload lies. Only a cold start proves a fix."""
    sh("am", "force-stop", PKG)
    sh("am", "start", "-n", ACTIVITY)
    pause(settle)
    dismiss_system_dialogs()
    return dump()


def dismiss_system_dialogs() -> None:
    """The emulator throws a systemui ANR under software rendering. Answering
    "Wait" keeps it alive; killing it takes the navigation bar with it."""
    for _ in range(3):
        xml = dump()
        if "responding" not in xml:
            return
        hit = False
        for label in ("Wait", "Close app"):
            pt = node_center(xml, label)
            if pt:
                tap(pt)
                pause(3)
                hit = True
                break
        if not hit:
            return


# ── the device ────────────────────────────────────────────────────────────────

def rotation() -> int:
    """0, 1, 2 or 3 — quarter turns clockwise from the natural orientation."""
    m = re.search(r"mCurrentRotation=ROTATION_(\d+)", sh("dumpsys", "window"))
    if m:
        return {0: 0, 90: 1, 180: 2, 270: 3}.get(int(m.group(1)), 0)
    m = re.search(r"\bmRotation=(\d)", sh("dumpsys", "window"))
    if m:
        return int(m.group(1))
    return int((sh("settings", "get", "system", "user_rotation").strip() or "0") or 0)


def screen_px() -> tuple[int, int]:
    """The window as it is ORIENTED, not as the panel is wired.

    ⚠ `wm size` reports `Physical size: 1200x1920` and keeps reporting it after
    a rotation, because it is a fact about the hardware. Reading it alone made
    the tablet section conclude "portrait 800dp `medium` -> landscape 800dp
    `medium`" — that rotating a tablet changes nothing — while the app had in
    fact rotated and 63 nodes were sitting past the reported width. The width a
    layout responds to is the width of the WINDOW.
    """
    m = re.search(r"Physical size:\s*(\d+)x(\d+)", sh("wm", "size"))
    if not m:
        return (1080, 1920)
    w, h = int(m.group(1)), int(m.group(2))
    return (h, w) if rotation() % 2 else (w, h)


def density() -> int:
    m = re.search(r"Physical density:\s*(\d+)", sh("wm", "density"))
    return int(m.group(1)) if m else 160


def window_dp() -> tuple[int, int]:
    """The window in dp — the only number `windowClass()` is allowed to read.

    31-tablet.md: "Read the window, never the device." A physical pixel must
    never reach the class function, which is exactly the mistake that makes a
    480dpi phone look like a tablet.
    """
    w, h = screen_px()
    scale = density() / 160.0
    return int(w / scale), int(h / scale)


def window_class(width_dp: int) -> str:
    """`mobile/src/lib/windowClass.ts`, transcribed. Four classes, no fifth."""
    return ("compact" if width_dp < 600 else
            "medium" if width_dp < 840 else
            "expanded" if width_dp < 1200 else "large")


def rotate(landscape: bool) -> None:
    sh("settings", "put", "system", "accelerometer_rotation", "0")
    sh("settings", "put", "system", "user_rotation", "1" if landscape else "0")
    pause(5)


def geo_fix(lon: float, lat: float) -> bool:
    """Stand somewhere. `adb emu geo fix <LON> <LAT>` — longitude FIRST.

    The order is the one thing about this command that is easy to get wrong and
    impossible to notice: 23.16, 72.68 is a valid point in the Arabian Sea off
    Somalia, so a reversed pair produces a clean 'outside the geofence' refusal
    that looks exactly like the behaviour under test.
    """
    return "OK" in adb("emu", "geo", "fix", str(lon), str(lat))


def device_location() -> tuple[float, float] | None:
    """Where the device believes it is, from the location service itself.

    The only way to tell "the location was set" from "the command was accepted",
    and those are not the same thing — see `geo_fix`.
    """
    out = sh("dumpsys", "location")
    m = re.search(r"last location=Location\[gps (-?[\d.]+),(-?[\d.]+)", out)
    if not m:
        m = re.search(r"last location=Location\[fused (-?[\d.]+),(-?[\d.]+)", out)
    return (float(m.group(1)), float(m.group(2))) if m else None


def mock_location(on: bool) -> bool:
    """Put a test provider behind `gps`, which `fused` then mirrors.

    ⚠⚠ `adb emu geo fix` ANSWERS `OK` AND DOES NOTHING on this emulator build
    (36.5, `google_apis_playstore` API 37). Measured 2026-08-29: after `geo fix
    72.6846 23.1596` returned OK, `dumpsys location` still read
    `Location[gps 37.421998,-122.084000]` — the AVD's default at Google HQ —
    with an unchanged `et=` timestamp, so not even a stale update had been
    delivered. Proposal 93 §11 lists `geo fix` as one of the three things the
    emulator does better than a phone; on this machine, as configured, it does
    not work at all, and the punch's "Location took too long" was the emulator
    saying so in the app's words.

    A test provider does work, and it is what Android's own location tests use:

        appops set com.android.shell android:mock_location allow
        cmd location providers add-test-provider gps
        cmd location providers set-test-provider-enabled gps true
        cmd location providers set-test-provider-location gps --location LAT,LON

    ⚠ `--location` takes LATITUDE FIRST. `geo fix` takes LONGITUDE first. The
    two commands for the same job disagree, and a transposed pair is a valid
    point in the sea that produces a clean out-of-geofence result indis-
    tinguishable from the behaviour under test.

    The cost, stated rather than hidden: a mocked fix arrives with
    `Location.mocked = true`, and `ClockScreen.readFix` reads it into
    `mock_location`, so every punch taken this way is flagged as a simulated
    location. That is a real product path worth asserting — but it means the
    emulator cannot produce an UNFLAGGED punch, and the clean-punch case stays
    a real-device check.
    """
    if on:
        sh("appops", "set", "com.android.shell", "android:mock_location", "allow")
        sh("cmd", "location", "providers", "add-test-provider", "gps")
        sh("cmd", "location", "providers", "set-test-provider-enabled", "gps", "true")
        return True
    sh("cmd", "location", "providers", "remove-test-provider", "gps")
    sh("appops", "set", "com.android.shell", "android:mock_location", "deny")
    return True


def stand_at(lat: float, lon: float, accuracy_m: int = 12) -> bool:
    """Put the device at a point and confirm the service took it."""
    sh("cmd", "location", "providers", "set-test-provider-location", "gps",
       "--location", f"{lat},{lon}", "--accuracy", str(accuracy_m))
    here = device_location()
    return here is not None and abs(here[0] - lat) < 1e-3 and abs(here[1] - lon) < 1e-3


class geo_hold:
    """Keep standing somewhere while the app asks where it is.

    A single location push is one update to whoever is listening AT THAT
    INSTANT. `getCurrentPositionAsync` subscribes after the shutter fires, so a
    fix pushed before the tap reaches nobody and the read waits out its whole
    8-second timeout. The location is therefore HELD across the flow rather
    than set before it.

        with geo_hold(SITE_LAT, SITE_LON) as fix:
            tap(shutter)
            xml = wait_for(...)
        assert fix.accepted
    """

    def __init__(self, lat: float, lon: float, every: float = 1.0) -> None:
        self.lat, self.lon, self.every = lat, lon, every
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self.accepted = False

    def _loop(self) -> None:
        while not self._stop.is_set():
            if stand_at(self.lat, self.lon):
                self.accepted = True
            self._stop.wait(self.every)

    def __enter__(self) -> "geo_hold":
        mock_location(True)
        self.accepted = stand_at(self.lat, self.lon)
        self._thread = threading.Thread(target=self._loop, daemon=True)
        self._thread.start()
        return self

    def __exit__(self, *exc) -> None:
        self._stop.set()
        if self._thread:
            self._thread.join(timeout=15)


def network(on: bool) -> None:
    """The emulator is on wifi, not mobile data, so BOTH have to move — and
    `svc data disable` alone leaves the app fully online, which reads as a
    passing offline test that never went offline."""
    sh("svc", "wifi", "enable" if on else "disable")
    sh("svc", "data", "enable" if on else "disable")
    pause(6)


def camera_clients() -> list[tuple[str, str]]:
    """Which package holds which camera device, from the camera service itself.

    This is the assertion that cannot be faked by a black preview: the camera
    server names the client, so a screen that merely LOOKS like a viewfinder
    does not appear here.
    """
    out = sh("dumpsys", "media.camera")
    block = out.split("Active Camera Clients:", 1)[-1].split("Allowed user IDs", 1)[0]
    # ⚠ `(\S+)` swallows the comma that follows the package name in the dump, so
    # a plain `pkg == PKG` compared "com.aekaminc.Kartavaya," against
    # "com.aekaminc.Kartavaya" and reported the camera as NOT open while it was
    # open. Caught 2026-08-29; it is a defect in the test, not in the product.
    return [(cid, pkg.strip().rstrip(",;"))
            for cid, pkg in re.findall(
                r"Camera ID: (\d+).*?Client Package Name: (\S+)", block)]


def front_camera_id() -> str | None:
    out = sh("dumpsys", "media.camera")
    for m in re.finditer(r"device@[\d.]+/internal/(\d+).*?Facing:\s*(\w+)", out, re.S):
        if m.group(2).lower() == "front":
            return m.group(1)
    return None


def screencap(host_path: str) -> bool:
    """PNG straight off the framebuffer. `exec-out`, never `shell` — the latter
    translates every 0x0a in the stream and corrupts the image."""
    with open(host_path, "wb") as fh:
        p = subprocess.run(["adb", "exec-out", "screencap", "-p"], stdout=fh, timeout=120)
    return p.returncode == 0 and os.path.getsize(host_path) > 1024


def raw_frame() -> tuple[int, int, bytes] | None:
    """The framebuffer as raw RGBA, with no PNG decoder in the way.

    `screencap` without `-p` writes a small header — width, height, pixel
    format, and on API 30+ a colour space — followed by width*height*4 bytes.
    Reading it directly is what lets this harness sample pixels at all: a pure
    python PNG decode of a 1280x2856 screen takes tens of seconds, and a
    harness nobody will wait for is a harness that gets commented out.

    The header length is DERIVED rather than assumed, because it grew by four
    bytes at API 30 and hard-coding either value breaks on the other image.
    """
    p = subprocess.run(["adb", "exec-out", "screencap"], capture_output=True, timeout=180)
    buf = p.stdout or b""
    if len(buf) < 16:
        return None
    for header in (16, 12):
        w = int.from_bytes(buf[0:4], "little")
        h = int.from_bytes(buf[4:8], "little")
        if w and h and len(buf) - header == w * h * 4:
            return w, h, buf[header:]
    return None


def viewfinder_is_live(top_frac: float = 0.30,
                       bottom_frac: float = 0.60) -> tuple[bool, str]:
    """Is a camera FEEDING this screen, or is the viewfinder a black rectangle?

    A `CameraView` that has opened the device and is receiving no frames renders
    flat black behind the overlay, and every single label assertion still
    passes — the screen says "Look at the camera and tap" over nothing. That is
    the exact shape of a green suite over a broken feature, so the check reads
    pixels rather than labels.

    The band sampled is the middle of the screen: the top carries the heading
    over a scrim and the bottom carries the shutter, and both are opaque UI that
    would supply variety on their own. Whatever is between them is the feed.

    Proven to fail on the case it is for: with `-camera-front none` the AVD
    hands `CameraView` no device, the band reads a single colour, and this
    returns False.
    """
    frame = raw_frame()
    if frame is None:
        return False, "could not read the framebuffer"
    w, h, px = frame
    y0, y1 = int(h * top_frac), int(h * bottom_frac)
    seen: set[tuple[int, int, int]] = set()
    dark = 0
    total = 0
    for y in range(y0, y1, max(1, (y1 - y0) // 40)):
        for x in range(0, w, max(1, w // 32)):
            o = (y * w + x) * 4
            r, g, b = px[o], px[o + 1], px[o + 2]
            seen.add((r >> 3, g >> 3, b >> 3))     # 5-bit buckets: ignore noise
            total += 1
            if r < 24 and g < 24 and b < 24:
                dark += 1
    if total == 0:
        return False, "sampled no pixels"
    if dark > total * 0.9:
        return False, f"{dark}/{total} sampled pixels are black — no frames"
    if len(seen) < 4:
        return False, f"the viewfinder band is {len(seen)} flat colour(s) — no frames"
    return True, f"{len(seen)} distinct colours across {total} sampled pixels"


def frames_are_live(dir_path: str, tag: str = "frame") -> tuple[bool, str]:
    """Is a camera FEEDING this screen, or is the viewfinder a black rectangle?

    A `CameraView` that has opened the device and is receiving no frames renders
    flat black behind the overlay, and every single label assertion still
    passes — the screen says "Look at the camera and tap" over nothing. That is
    the exact shape of a green suite over a broken feature, so the check has to
    read something other than labels.

    SECONDARY EVIDENCE ONLY — `viewfinder_is_live` is the assertion.

    Two captures a beat apart, compared as bytes. It was written as the primary
    check on the assumption that the emulated front camera renders a MOVING
    scene, and measured on 2026-08-29 it does not: two captures two seconds
    apart came back byte-identical over a viewfinder that was demonstrably
    working, because the AVD's synthetic scene is a STILL pattern. Motion is
    therefore evidence when it is present and means nothing when it is absent,
    which is not something an assertion may be built on.
    """
    a = os.path.join(dir_path, tag + "-a.png")
    b = os.path.join(dir_path, tag + "-b.png")
    if not screencap(a):
        return False, "screencap failed"
    pause(2)
    if not screencap(b):
        return False, "second screencap failed"
    ba, bb = open(a, "rb").read(), open(b, "rb").read()
    if ba == bb:
        return False, f"two captures 2s apart are byte-identical ({len(ba)}B) — no frames"
    return True, f"frames differ across 2s ({len(ba)}B vs {len(bb)}B)"


def env() -> dict[str, str]:
    """`.env.e2e` at the repo root — the same file the Playwright suites read."""
    path = Path(__file__).resolve().parents[2] / ".env.e2e"
    vals: dict[str, str] = {}
    if path.exists():
        for line in path.read_text(encoding="utf-8").splitlines():
            m = re.match(r"^([A-Z0-9_]+)=(.*)$", line)
            if m:
                vals[m.group(1)] = m.group(2)
    return vals
