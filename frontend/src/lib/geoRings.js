/**
 * geoRings.js — GeoJSON rings → the {lat, lng} paths the Mappls SDK draws, and
 * the bounding box that frames them.
 *
 * ⚠ **GeoJSON IS [lng, lat]. THE MAP SDK IS {lat, lng}.** Reading the pair in
 * the order it is written puts every Indian PIN in the Indian Ocean, and it
 * fails silently — a polygon is drawn, it is simply somewhere else. That swap
 * is the whole reason this function exists rather than a `.map()` at each call
 * site, and it is why the two copies of it that shipped in
 * `components/PinAreaPopover.jsx` and `components/TerritoryMap.jsx` until
 * 2026-09-03 were worth collapsing: the same swap, written out twice, is two
 * places to get it backwards.
 *
 * HOLES ARE DROPPED — ring 0 of each polygon only. A PIN boundary with a hole
 * in it is a PIN enclosing another PIN, and an outline that ignores the hole is
 * a better answer than no outline at all. Anything derived from the outer ring
 * — an area, a centroid — is therefore approximate, and the sentences that
 * report it say "about".
 */

/** A geometry's outer rings as `{lat, lng}[][]`, ready for the SDK. */
export function ringsOf(geometry) {
  if (!geometry) return [];
  const toPath = (ring) => ring
    .filter(pt => Array.isArray(pt) && pt.length >= 2)
    .map(([lng, lat]) => ({ lat, lng }));

  if (geometry.type === 'Polygon') {
    return (geometry.coordinates || []).slice(0, 1).map(toPath);
  }
  if (geometry.type === 'MultiPolygon') {
    return (geometry.coordinates || []).map(poly => toPath(poly?.[0] || []));
  }
  return [];
}

/**
 * The bounding box of a set of paths, or null when none of them carried a
 * finite coordinate — null rather than the degenerate `{n:-90, s:90}` seed,
 * because a caller that fits the map to that box ends up looking at the whole
 * planet and cannot tell it from a real answer.
 */
export function boundsOf(paths) {
  let n = -90, s = 90, e = -180, w = 180, seen = false;
  paths.forEach(path => path.forEach(({ lat, lng }) => {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    seen = true;
    if (lat > n) n = lat; if (lat < s) s = lat;
    if (lng > e) e = lng; if (lng < w) w = lng;
  }));
  return seen ? { n, s, e, w } : null;
}
