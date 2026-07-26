"""
Generate Kartavaya app icons from the brand spec:
  - 135° gradient #026B64 → #04837A → #05b7aa
  - Devanagari "क" mark in white, ~62% of icon height
  - Inner shine: 18% white top-to-transparent (0→35%)
  - Bottom-left accent orb (18% white radial, blurred)

Outputs:
  icon.png          1024×1024  (iOS App Store + Expo default)
  adaptive-icon.png 1024×1024  (Android adaptive foreground — safe-zone centred)
  splash.png        1284×2778  (iPhone 14 Pro Max native, Expo splash)
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


def draw_ka(img: Image.Image, font_size_ratio: float = 0.62) -> Image.Image:
    """Draw Devanagari 'क' centred on the icon with a soft blurred shadow."""
    size = img.size[0]
    font_size = int(size * font_size_ratio)
    font = ImageFont.truetype(FONT_PATH, font_size)
    char = "क"

    # Measure on a temp canvas
    tmp_draw = ImageDraw.Draw(Image.new("RGBA", (size, size)))
    bbox = tmp_draw.textbbox((0, 0), char, font=font)
    w = bbox[2] - bbox[0]
    h = bbox[3] - bbox[1]
    x = int((size - w) / 2 - bbox[0])
    y = int((size - h) / 2 - bbox[1] + size * 0.04)

    # Render a blurred shadow layer
    shadow_layer = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    sd = ImageDraw.Draw(shadow_layer)
    sd.text((x, y + int(size * 0.008)), char, font=font, fill=(0, 0, 0, 70))
    shadow_layer = shadow_layer.filter(ImageFilter.GaussianBlur(radius=size * 0.012))

    base = img.convert("RGBA")
    base.alpha_composite(shadow_layer)

    # White mark on top
    draw = ImageDraw.Draw(base)
    draw.text((x, y), char, font=font, fill=(255, 255, 255, 255))
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
    img = draw_ka(img)
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
    Android adaptive icon: foreground must keep mark inside the 72dp safe zone
    (66% of 108dp). Expo uses 1024×1024; safe zone = centre 66% = 676px.
    We render at 676px, paste onto transparent 1024×1024 canvas.
    """
    inner = 676
    mark = build_icon(inner)
    out = Image.new("RGBA", (1024, 1024), (0, 0, 0, 0))
    offset = (1024 - inner) // 2
    out.paste(mark.convert("RGBA"), (offset, offset))
    out.save(os.path.join(ASSETS, "adaptive-icon.png"), "PNG", optimize=True)
    print("adaptive-icon.png 1024×1024 (Android foreground, safe-zone centred)")


# ── splash.png — 1284×2778 ────────────────────────────────────────────────────
def gen_splash():
    """
    Full-gradient splash with the icon mark centred (no border radius).
    Expo scales this to fill the screen.
    """
    W, H = 1284, 2778
    # Build gradient at splash dimensions
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

    # Icon mark centred — 320px
    icon_size = 320
    mark = build_icon(icon_size)
    ix = (W - icon_size) // 2
    iy = (H - icon_size) // 2 - int(H * 0.04)   # slightly above centre
    img.alpha_composite(mark.convert("RGBA"), (ix, iy))

    # App name text below mark
    draw = ImageDraw.Draw(img)
    try:
        name_font = ImageFont.truetype(FONT_PATH, 72)
    except Exception:
        name_font = ImageFont.load_default()
    name = "Kartavaya"
    nb = draw.textbbox((0, 0), name, font=name_font)
    nw = nb[2] - nb[0]
    nx = (W - nw) / 2 - nb[0]
    ny = iy + icon_size + 40
    draw.text((nx, ny), name, font=name_font, fill=(255, 255, 255, 200))

    out = img.convert("RGB")
    out.save(os.path.join(ASSETS, "splash.png"), "PNG", optimize=True)
    print("splash.png        1284×2778")


if __name__ == "__main__":
    gen_icon()
    gen_adaptive()
    gen_splash()
    print("Done.")
