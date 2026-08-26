#!/usr/bin/env python
"""prepare_pincode_boundaries.py — turn the 90MB government PIN boundary file
into something a 220px map panel can actually load.

Run this only to refresh the boundaries. The output is committed, so a normal
checkout needs neither this script, nor the 90MB input, nor a network
connection — the territory map must never depend on a third-party fetch.

    python backend/scripts/prepare_pincode_boundaries.py \\
        --src /path/to/Datagov_Pincode_Boundaries.geojsonl

Where the input comes from
--------------------------
India Post delivery-area boundaries, published on data.gov.in in May 2025:
19,312 features, exactly one per PIN code, EPSG:4326, 3.34M vertices, 90MB.
Licence is GODL-India / CC-BY-4.0 — commercial use is permitted **with
attribution**, which is why `TerritoryMap` carries a visible credit line. Do not
remove it.

data.gov.in itself serves the catalogue as a JavaScript application with no
direct download link, so the file is fetched from the india-geodata mirror,
which republishes the same asset:

    https://github.com/yashveeeeeeer/india-geodata
    releases/tag/postal%2Fboundaries → Datagov_Pincode_Boundaries.geojsonl.7z

Feature count and PIN count both match the government's own published figure of
19,312, which is the check that the mirror has not altered anything.

Why the geometry is simplified, and by how much
-----------------------------------------------
The raw file averages 173 vertices per PIN code. A territory covering forty PIN
codes would ship ~7,000 vertices to draw a shape a few hundred pixels wide —
most of that detail lands inside a single pixel and cannot be seen.

Douglas-Peucker is applied per ring, then coordinates are rounded. The default
tolerance is 0.0005° (~55m at Indian latitudes) and 5 decimal places (~1.1m).
That is still far finer than the panel: at 220px showing a 30km city, one pixel
is roughly 136m. The margin exists so the shapes hold up when a user zooms in,
not because the default view needs it.

**A ring that collapses below 4 points is dropped, not repaired.** A polygon
needs 4 positions (first == last) to be valid GeoJSON. Emitting a 3-point ring
would produce a file that parses and renders nothing, which is the failure mode
this codebase keeps re-learning: silence beats a lie, but a valid-looking file
that draws nothing is worse than both. Dropped rings are counted and reported.

Why it is sharded by the first two digits
------------------------------------------
The first digit of a PIN is a region and the first two are a postal circle, so a
sales territory almost always sits inside one or two shards. Sharding on three
digits would give ~800 tiny files; a single file would mean loading every PIN in
India to draw one territory in Mumbai. Ninety files is the middle.

No spatial library is used
--------------------------
`backend/` has no geopandas, shapely, pyproj or GDAL, and this script
deliberately does not add them. They are heavy, they are wheels that break on
image rebuilds, and the only operation needed here — Douglas-Peucker on a
lon/lat ring — is twenty lines. Planar distance in degrees is used rather than
great-circle: over a single PIN code the error is far below the tolerance, and
the output is a drawing, not a measurement.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from collections import defaultdict

#: GeoJSON requires 4 positions for a linear ring (the last repeats the first).
MIN_RING = 4


def _perp_distance(pt, start, end):
    """Perpendicular distance from `pt` to the segment start→end, in degrees."""
    (x, y), (x1, y1), (x2, y2) = pt, start, end
    dx, dy = x2 - x1, y2 - y1
    if dx == 0 and dy == 0:
        return ((x - x1) ** 2 + (y - y1) ** 2) ** 0.5
    # Projection factor of pt onto the segment, clamped to the segment itself.
    t = ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy)
    t = max(0.0, min(1.0, t))
    px, py = x1 + t * dx, y1 + t * dy
    return ((x - px) ** 2 + (y - py) ** 2) ** 0.5


def simplify(points, tol):
    """Douglas-Peucker, iterative so a 30k-vertex ring cannot blow the stack."""
    n = len(points)
    if n < 3:
        return list(points)
    keep = [False] * n
    keep[0] = keep[n - 1] = True
    stack = [(0, n - 1)]
    while stack:
        first, last = stack.pop()
        if last <= first + 1:
            continue
        worst, worst_i = -1.0, -1
        a, b = points[first], points[last]
        for i in range(first + 1, last):
            d = _perp_distance(points[i], a, b)
            if d > worst:
                worst, worst_i = d, i
        if worst > tol:
            keep[worst_i] = True
            stack.append((first, worst_i))
            stack.append((worst_i, last))
    return [p for p, k in zip(points, keep) if k]


#: Rings at or below this many positions are rounded but NOT simplified.
#: Seventeen PIN codes — 500041, 826001, 800023 and the like — are single
#: campuses or depots whose source geometry is already a quadrilateral. Running
#: Douglas-Peucker over them collapsed the ring under MIN_RING and silently
#: dropped the PIN code entirely, so those territories would have drawn nothing
#: with no error anywhere. There is nothing to win simplifying a ring this
#: small, and a missing shape is not worth the handful of bytes.
SIMPLIFY_FLOOR = 12


def _clean_ring(ring, tol, ndigits):
    """Simplify, round, drop consecutive duplicates, and re-close the ring."""
    raw = [(float(x), float(y)) for x, y in ring]
    pts = raw if len(raw) <= SIMPLIFY_FLOOR else simplify(raw, tol)
    out = []
    for x, y in pts:
        p = [round(x, ndigits), round(y, ndigits)]
        if not out or out[-1] != p:
            out.append(p)
    if len(out) >= 3 and out[0] != out[-1]:
        out.append(list(out[0]))
    return out if len(out) >= MIN_RING else None


def _clean_polygon(rings, tol, ndigits, stats):
    """Clean each ring; a polygon whose OUTER ring collapses is dropped whole."""
    cleaned = []
    for i, ring in enumerate(rings):
        r = _clean_ring(ring, tol, ndigits)
        if r is None:
            stats["rings_dropped"] += 1
            if i == 0:
                return None          # no outer ring, no polygon
            continue                 # an interior hole may be dropped alone
        cleaned.append(r)
    return cleaned or None


def convert(src, out_dir, tol, ndigits):
    shards = defaultdict(dict)
    stats = defaultdict(int)

    with open(src, encoding="utf-8") as fh:
        for line in fh:
            line = line.strip().rstrip(",")
            if not line or line in ("[", "]"):
                continue
            try:
                feat = json.loads(line)
            except json.JSONDecodeError:
                stats["unparseable"] += 1
                continue

            props = feat.get("properties") or {}
            pin = str(props.get("Pincode") or "").strip()
            geom = feat.get("geometry") or {}
            gtype, coords = geom.get("type"), geom.get("coordinates")
            if len(pin) != 6 or not pin.isdigit() or not coords:
                stats["skipped_bad_record"] += 1
                continue

            stats["read"] += 1
            stats["vertices_in"] += _count(coords)

            if gtype == "Polygon":
                cleaned = _clean_polygon(coords, tol, ndigits, stats)
                shape = ("P", cleaned) if cleaned else None
            elif gtype == "MultiPolygon":
                parts = [p for p in (_clean_polygon(poly, tol, ndigits, stats)
                                     for poly in coords) if p]
                shape = ("M", parts) if parts else None
            else:
                stats["skipped_bad_record"] += 1
                continue

            if shape is None:
                stats["dropped_empty"] += 1
                continue

            # Compact on purpose: this is read by one function, not by a human.
            shards[pin[:2]][pin] = {"t": shape[0], "c": shape[1]}
            stats["written"] += 1
            stats["vertices_out"] += _count(shape[1])

    os.makedirs(out_dir, exist_ok=True)
    total_bytes = 0
    for prefix, payload in sorted(shards.items()):
        path = os.path.join(out_dir, f"{prefix}.json")
        with open(path, "w", encoding="utf-8") as fh:
            json.dump(payload, fh, separators=(",", ":"))
        total_bytes += os.path.getsize(path)

    stats["shards"] = len(shards)
    stats["bytes_out"] = total_bytes
    return stats


def _count(coords):
    if not coords:
        return 0
    if isinstance(coords[0], (int, float)):
        return 1
    return sum(_count(c) for c in coords)


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--src", required=True,
                    help="Datagov_Pincode_Boundaries.geojsonl")
    ap.add_argument("--out", default=os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
        "data", "pincode_boundaries"))
    ap.add_argument("--tolerance", type=float, default=0.0005,
                    help="Douglas-Peucker tolerance in degrees (default 0.0005 ≈ 55m)")
    ap.add_argument("--precision", type=int, default=5,
                    help="decimal places to round to (default 5 ≈ 1.1m)")
    args = ap.parse_args()

    if not os.path.exists(args.src):
        sys.exit(f"input not found: {args.src}")

    s = convert(args.src, args.out, args.tolerance, args.precision)
    vin, vout = s["vertices_in"], s["vertices_out"]
    print(f"read            : {s['read']:,} features")
    print(f"written         : {s['written']:,} pincodes into {s['shards']} shards")
    # ASCII only: the Windows console is cp1252 and a Unicode arrow here
    # raised UnicodeEncodeError *after* every shard had already been written,
    # which reads as a failed run when the job in fact succeeded.
    print(f"vertices        : {vin:,} -> {vout:,} "
          f"({100 * (1 - vout / max(vin, 1)):.1f}% removed)")
    print(f"output size     : {s['bytes_out'] / 1_048_576:.1f} MB in {args.out}")
    for k in ("rings_dropped", "dropped_empty", "skipped_bad_record", "unparseable"):
        if s.get(k):
            print(f"{k:<16}: {s[k]:,}")


if __name__ == "__main__":
    main()
