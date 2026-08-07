"""
Generate Kartavaya app icons from the brand spec:
  - 135° gradient #026B64 -> #04837A -> #05b7aa
  - THE MARK: the lotus with Devanagari "क" in its eye, in white
  - Inner shine: 18% white top-to-transparent (0->35%)
  - Bottom-left accent orb (18% white radial, blurred)

Outputs:
  icon.png          1024x1024  (iOS App Store + Expo default)
  adaptive-icon.png 1024x1024  (Android adaptive foreground - safe-zone centred)
  splash.png        1284x2778  (iPhone 14 Pro Max native, Expo splash)

-- WHY THIS FILE DRAWS BEZIERS BY HAND ---------------------------------------

The mark is an SVG on both clients. There is no SVG rasteriser on this machine:
cairosvg cannot load libcairo-2.dll, and three earlier attempts to rasterise the
web icons failed the same way. Pillow is present and can stroke a polyline.

So `lobe()` below is the SAME two cubics as `Lotus.tsx` and `Lotus.jsx`,
evaluated numerically and drawn as a closed polyline. That is a THIRD copy of
the geometry, in a third language, and this file has already drifted once --
see the colour note below. `brandMark.test.ts` therefore reads this file as text
and compares COURSES, EYE_R, KA_RATIO and the gradient against the app's, so the
next drift fails a test instead of shipping on somebody's home screen.

What no test can prove is that the PNGs were regenerated after an edit. Run:

    python mobile/assets/gen_icons.py

and LOOK at the result.
"""

from PIL import Image, ImageDraw, ImageFilter, ImageFont
import math, os

ASSETS = os.path.dirname(__file__)
FONT_PATH = os.path.join(ASSETS, "fonts", "NotoSansDevanagari-Bold.ttf")

# ── Brand colours ──────────────────────────────────────────────────────────────
#
# These must stay equal to `brand.gradient` in src/theme/tokens.ts, which is
# ['#026B64', '#04837A', '#05b7aa'] — the deep → mid → vivid teal ramp.
#
# They did not. This script still held the retired brand blue that 00 §9 removed,
# and the committed icon.png was generated from it: sampling the shipped PNG at
# (2,2) gives #2d98cf — the blue, lightened by the shine overlay — running to
# #04b6aa at the opposite corner. So while app.json, the token layer and every
# in-app gradient had moved to teal, the icon on the user's home screen was still
# the old blue.
#
# Changing the constants does NOT change the committed PNGs. Regenerating them
# requires PIL and a human looking at the result, so that is deliberately left as
# a separate step — see the report. What this fixes is the next regeneration
# silently reintroducing the retired colour.
C_START  = (2,  107, 100)   # #026B64
C_MID    = (4,  131, 122)   # #04837A
C_END    = (5,  183, 170)   # #05b7aa
WHITE    = (255, 255, 255)


def lerp_color(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))


def make_gradient(size: int) -> Image.Image:
    """135° diagonal gradient with three colour stops."""
    img = Image.new("RGB", (size, size))
    pixels = img.load()
    diag = math.sqrt(2) * size
    for y in range(size):
        for x in range(size):
            # Project (x,y) onto the 135° direction vector (1,1)/√2
            t = (x + y) / (2 * size)          # 0 at top-left, 1 at bottom-right
            if t < 0.5:
                c = lerp_color(C_START, C_MID, t * 2)
            else:
                c = lerp_color(C_MID, C_END, (t - 0.5) * 2)
            pixels[x, y] = c
    return img


def add_shine(img: Image.Image, strength: float = 0.18) -> Image.Image:
    """Top-to-transparent white gradient, fades out by 35% height."""
    size = img.size[0]
    fade_to = int(size * 0.35)
    overlay = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    for y in range(fade_to):
        alpha = int(255 * strength * (1 - y / fade_to))
        draw.line([(0, y), (size, y)], fill=(255, 255, 255, alpha))
    base = img.convert("RGBA")
    base.alpha_composite(overlay)
    return base


def add_orb(img: Image.Image, strength: float = 0.18) -> Image.Image:
    """Bottom-left radial accent orb, blurred."""
    size = img.size[0]
    orb_r = int(size * 0.55 / 2)
    cx = int(-size * 0.15 + orb_r)
    cy = int(size + size * 0.18 - orb_r)
    orb = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(orb)
    for r in range(orb_r, 0, -1):
        t = r / orb_r
        a = int(255 * strength * (1 - t))
        draw.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(255, 255, 255, a))
    orb = orb.filter(ImageFilter.GaussianBlur(radius=size * 0.015))
    img.alpha_composite(orb)
    return img


# -- THE FIGURE ---------------------------------------------------------------
#
# Every number here is copied from `src/components/brand/Lotus.tsx`, which is
# itself a port of the web's `Lotus.jsx`. A test compares them; do not retune one
# side alone.

# [count, r0, r1, halfWidth, rotationOffset], in the 260 viewbox.
COURSES = [
    (10, 34, 70, 12, 0),      # the rosette
    (10, 35, 56, 7, 18),      # smaller lobes nesting in its gaps
    (20, 76, 120, 11.5, 0),   # the outer petals
    (20, 82, 96, 4.2, 0),     # a bead in each throat
]

# The eye -- the ring क sits inside. r32, not the r11 it started at: the letter
# is sized first and the drawing makes room.
EYE_R = 32

# क's font-size as a fraction of the rendered figure. Derived, not chosen --
# 0.246 * 0.82 / 0.72. See Lotus.tsx.
KA_RATIO = 0.28

VIEWBOX = 260          # the coordinate space the courses are given in
CENTRE = 130           # the figure's centre in that space
OUTER_R = 120          # the outermost course, for the tight crop


def _cubic(p0, p1, p2, p3, steps=24):
    """Flatten one cubic Bezier to points. 24 steps is smooth past 1024px."""
    out = []
    for i in range(steps + 1):
        t = i / steps
        u = 1 - t
        out.append((
            u*u*u*p0[0] + 3*u*u*t*p1[0] + 3*u*t*t*p2[0] + t*t*t*p3[0],
            u*u*u*p0[1] + 3*u*u*t*p1[1] + 3*u*t*t*p2[1] + t*t*t*p3[1],
        ))
    return out


def lobe(r0, r1, w):
    """
    A rounded petal, as a closed polyline in viewbox units.

    The same two cubics as `lobe()` in Lotus.tsx: out along one side from
    (0,-r0) to (0,-r1), back along the mirror. The control-point fractions
    0.30 and 0.26 are what give the petal its shoulder, and they are the
    numbers a test compares.
    """
    s = r1 - r0
    a = _cubic((0, -r0), (w, -r0 - s*0.30), (w, -r1 + s*0.26), (0, -r1))
    b = _cubic((0, -r1), (-w, -r1 + s*0.26), (-w, -r0 - s*0.30), (0, -r0))
    return a + b[1:]


def _rot(pts, deg):
    r = math.radians(deg)
    c, s = math.cos(r), math.sin(r)
    return [(x*c - y*s, x*s + y*c) for x, y in pts]


def draw_mark(img, ratio=0.76, pen_vb=1.6):
    """
    Draw the lotus with क in its eye, centred, at `ratio` of the icon.

    `ratio` is NOT 1.0 even though the in-app chip crops tight to the drawing.
    A launcher icon is masked -- iOS clips a squircle, Android a circle on many
    devices -- and a rosette that reaches the edge loses its outer petals at
    exactly the four corners the mask takes. 0.76 keeps the whole flower inside
    the circular mask (a circle inscribed in the square passes through the edge
    midpoints, so anything within ~0.78 survives) while still filling the tile.

    ONE PEN and ONE COLOUR, as on both clients: every stroke the same width, full
    strength white, no opacity ramp.
    """
    size = img.size[0]
    # The tight crop the clients use: the drawing spans 2*(OUTER_R + pen/2) of
    # the 260 box, so scale against THAT and not against 260, or the figure
    # arrives ~8% smaller than asked for.
    span = 2 * (OUTER_R + pen_vb / 2)
    scale = size * ratio / span
    cx = cy = size / 2
    pen = max(1, round(pen_vb * scale))

    layer = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)

    def to_px(pts):
        return [(cx + (x) * scale, cy + (y) * scale) for x, y in pts]

    def ring(r):
        rp = r * scale
        d.ellipse([cx - rp, cy - rp, cx + rp, cy + rp], outline=WHITE, width=pen)

    # Rings first, so the eye and the collar sit under what hangs off them.
    ring(EYE_R)
    for ci, (n, r0, r1, w, off) in enumerate(COURSES):
        if ci == 2:
            ring(74)
        base = lobe(r0, r1, w)
        for i in range(n):
            pts = to_px(_rot(base, off + (360 / n) * i))
            # `joint="curve"` rounds the corners between segments; without it a
            # 20px pen shows a facet at every flattening step.
            d.line(pts + [pts[0]], fill=WHITE, width=pen, joint="curve")

    base = img.convert("RGBA")
    base.alpha_composite(layer)
    return draw_ka(base, ratio)


def draw_ka(img, mark_ratio=0.76):
    """
    क, centred in the eye of the figure.

    Sized off the FIGURE (mark_ratio * size), not off the icon, because
    KA_RATIO is a fraction of the drawing -- that is what keeps the letter
    inside the ring instead of through it at every size.
    """
    size = img.size[0]
    figure = size * mark_ratio
    font_size = max(8, int(figure * KA_RATIO))
    font = ImageFont.truetype(FONT_PATH, font_size)
    char = "क"

    tmp = ImageDraw.Draw(Image.new("RGBA", (size, size)))
    bbox = tmp.textbbox((0, 0), char, font=font)
    w = bbox[2] - bbox[0]
    h = bbox[3] - bbox[1]
    x = int((size - w) / 2 - bbox[0])
    y = int((size - h) / 2 - bbox[1])

    base = img.convert("RGBA")
    # No shadow. The old bare-letter icon had one because a lone glyph on a flat
    # gradient needed the lift; inside the ornament it muddies the eye, which is
    # the tightest part of the drawing.
    ImageDraw.Draw(base).text((x, y), char, font=font, fill=(255, 255, 255, 255))
    return base


def apply_rounded_mask(img: Image.Image, radius_ratio: float) -> Image.Image:
    """Apply iOS squircle-style rounded rect mask."""
    size = img.size[0]
    r = int(size * radius_ratio)
    mask = Image.new("L", (size, size), 0)
    draw = ImageDraw.Draw(mask)
    draw.rounded_rectangle([0, 0, size, size], radius=r, fill=255)
    img.putalpha(mask)
    return img


# ── Build base icon ────────────────────────────────────────────────────────────
def build_icon(size: int = 1024) -> Image.Image:
    img = make_gradient(size)
    img = add_shine(img)
    img = add_orb(img)
    img = draw_mark(img)
    return img


# ── icon.png — 1024×1024 ──────────────────────────────────────────────────────
def gen_icon():
    img = build_icon(1024)
    # Expo reads icon.png as-is; iOS applies its own squircle clip
    # So we output a full-bleed square (no mask baked in)
    out = img.convert("RGB")
    out.save(os.path.join(ASSETS, "icon.png"), "PNG", optimize=True)
    print("icon.png          1024×1024")


# ── adaptive-icon.png — 1024×1024 (Android foreground) ───────────────────────
def gen_adaptive():
    """
    Android adaptive icon FOREGROUND -- the mark on transparency, nothing else.

    THIS WAS WRONG AND THE FIX IS THE POINT OF THIS FUNCTION. It used to paste a
    676px GRADIENT SQUARE onto the transparent canvas. Android composites the
    foreground over a separate background layer -- `app.json` already supplies
    `adaptiveIcon.backgroundColor: "#04837A"` -- and then masks the pair to
    whatever shape the launcher uses. A gradient square in the foreground meant
    the launcher drew a hard-edged tile floating inside its own circle, with the
    teal background visible around it. Two teals, one seam, on every Android home
    screen.

    So the foreground is the white figure over nothing. The safe zone is the
    centre 66% of the canvas (72dp of 108dp); Android may crop anything outside
    it, so the mark is drawn at 0.66 * 0.76 of the full canvas -- the same 0.76
    the icon uses, applied inside the safe circle rather than the whole tile.
    """
    canvas = Image.new("RGBA", (1024, 1024), (0, 0, 0, 0))
    # `draw_mark` composites onto whatever it is given, so a transparent canvas
    # yields the strokes alone.
    out = draw_mark(canvas, ratio=0.66 * 0.76)
    out.save(os.path.join(ASSETS, "adaptive-icon.png"), "PNG", optimize=True)
    print("adaptive-icon.png 1024x1024 (Android foreground, mark on transparency)")


# ── splash.png — 1284×2778 ────────────────────────────────────────────────────
def _latin_font(size):
    """
    A font that can actually draw "Kartavaya".

    THE SPLASH SHIPPED NINE TOFU BOXES. `NotoSansDevanagari-Bold.ttf` carries
    ADVANCE WIDTHS for Latin but no outlines, so Pillow measured the string
    happily, centred it correctly, and drew .notdef for every character. Nothing
    raised. The only way to catch that is to look at the pixels or to ask the
    font, so this asks.

    Newsreader is the app's display face (`theme/fonts.ts`) and comes from
    node_modules rather than assets/, because that is where the app itself gets
    it. If it is missing the script says so instead of quietly falling back to a
    face that draws boxes.
    """
    candidates = [
        os.path.join(ASSETS, "..", "node_modules", "@expo-google-fonts",
                     "newsreader", "600SemiBold", "Newsreader_600SemiBold.ttf"),
    ]
    for path in candidates:
        if os.path.exists(path):
            font = ImageFont.truetype(path, size)
            if _covers(font, "Kartavaya"):
                return font
    raise SystemExit(
        "No font with Latin outlines found. Run `npm install` in mobile/ so "
        "@expo-google-fonts/newsreader is present, then run this again. "
        "Do NOT fall back to the Devanagari face: it has Latin metrics but no "
        "glyphs, and the splash will ship rows of empty boxes."
    )


def _covers(font, text):
    """True if the face has a real outline for every character."""
    ttf = font.font
    for ch in set(text):
        # Pillow exposes the raw face; a missing glyph maps to index 0 (.notdef).
        try:
            if ttf.getsize(ch)[0][0] == 0 and ch != " ":
                return False
        except Exception:
            return False
    # Metrics alone are not proof — render and check some ink is not a rectangle
    # outline. Cheapest reliable signal: .notdef boxes are identical for every
    # character, so two different letters rendering identically means boxes.
    def bitmap(ch):
        im = Image.new("L", (font.size * 2, font.size * 2), 0)
        ImageDraw.Draw(im).text((0, 0), ch, font=font, fill=255)
        return im.tobytes()
    return bitmap("K") != bitmap("a")


def gen_splash():
    """
    Full-gradient splash with the mark centred.

    The mark is drawn STRAIGHT ONTO the splash, not composited as a finished
    icon tile. Pasting `build_icon(320)` — which is what this used to do — laid a
    320px square carrying its own gradient, shine and orb over a background that
    already had all three, so the tile read as a lighter rectangle with a hard
    edge around the flower. Same defect as the Android foreground, same fix.
    """
    W, H = 1284, 2778
    img = Image.new("RGB", (W, H))
    pixels = img.load()
    for y in range(H):
        for x in range(W):
            t = (x / W + y / H) / 2
            if t < 0.5:
                c = lerp_color(C_START, C_MID, t * 2)
            else:
                c = lerp_color(C_MID, C_END, (t - 0.5) * 2)
            pixels[x, y] = c

    img = img.convert("RGBA")

    # Shine overlay (top 35%)
    fade_to = int(H * 0.35)
    overlay = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    draw_ov = ImageDraw.Draw(overlay)
    for y in range(fade_to):
        a = int(255 * 0.18 * (1 - y / fade_to))
        draw_ov.line([(0, y), (W, y)], fill=(255, 255, 255, a))
    img.alpha_composite(overlay)

    # The mark, on its own transparent layer so it can sit above centre without
    # dragging a background with it.
    mark_px = 460
    layer = Image.new("RGBA", (mark_px, mark_px), (0, 0, 0, 0))
    layer = draw_mark(layer, ratio=1.0)
    mx = (W - mark_px) // 2
    my = (H - mark_px) // 2 - int(H * 0.06)
    img.alpha_composite(layer, (mx, my))

    # The name, in a face that has the letters.
    draw = ImageDraw.Draw(img)
    name_font = _latin_font(76)
    name = "Kartavaya"
    nb = draw.textbbox((0, 0), name, font=name_font)
    nx = (W - (nb[2] - nb[0])) / 2 - nb[0]
    ny = my + mark_px + 48
    draw.text((nx, ny), name, font=name_font, fill=(255, 255, 255, 220))

    out = img.convert("RGB")
    out.save(os.path.join(ASSETS, "splash.png"), "PNG", optimize=True)
    print("splash.png        1284x2778")


if __name__ == "__main__":
    gen_icon()
    gen_adaptive()
    gen_splash()
    print("Done.")
