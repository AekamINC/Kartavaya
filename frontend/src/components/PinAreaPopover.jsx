/**
 * PinAreaPopover — what area a PIN covers, opened from the PIN itself. Phase 8.2.
 *
 * ── WHAT IT COSTS: NOTHING, AND THAT IS THE DESIGN ──────────────────────────
 *
 * No geocode, no address in a query string, no per-open metering. The shape
 * comes from `GET /api/v1/graha/territories/{id}/geometry` — our own endpoint,
 * Phase 7.3, reading a Government of India dataset out of our own R2 bucket —
 * and the only vendor request on the whole path is the Mappls basemap the
 * loader already fetches for every other map in the product.
 *
 * ── THE ENDPOINT IS PER-TERRITORY. THERE IS NO PER-PIN LOOKUP. ───────────────
 *
 * This is the single fact that shapes the whole component, and it is worth
 * stating plainly because the plan's wording ("draw that PIN's polygon from the
 * geometry endpoint") reads as though a per-PIN route exists. It does not.
 * Checked 2026-08-27 against the live tree: `backend/routers/graha.py` exposes
 * `/territories/{territory_id}/geometry` and nothing else that reads
 * `services/pin_boundaries.py`; `staging.pin_directory` (Phase 7.2, 20,144
 * rows) has NO http surface at all — `services/pin_directory.py` is a loader
 * with a CLI over it and no router imports it.
 *
 * Two consequences, and neither is hidden from the reader:
 *
 *   1. A PIN can only be drawn when one of THIS organisation's territories
 *      claims it. The path is: list the territories (they carry
 *      `rules.pincodes`), find the ones claiming this PIN, ask that territory
 *      for its geometry, and pick out the one Feature whose
 *      `properties.pincode` matches. A PIN no territory claims gets a sentence
 *      saying exactly that — never a blank, and never an implied "this PIN does
 *      not exist".
 *   2. THE DISTRICT AND STATE ARE NOT SHOWN. §8.2's acceptance asks the popover
 *      to name "Surat, Gujarat" from the 7.2 directory, and there is no way to
 *      read that directory from a browser today. The honest options were to
 *      omit it or to invent a backend route, and inventing one is not this
 *      change's to make. So it is omitted, and it is owed: one thin
 *      `GET /v1/graha/pincodes/{pin}` over `staging.pin_directory` closes it,
 *      and it would also make the whole component work for a PIN outside every
 *      territory. Nothing here guesses a district from a prefix.
 *
 * ── THE THREE BUCKETS ARE HONOURED, BECAUSE MERGING THEM LIES ───────────────
 *
 * Same discipline as `TerritoryMap.jsx`, for the same reason:
 *
 *     a Feature    drawn
 *     unmatched    the government published no boundary for that PIN. ORDINARY
 *                  — 58 PINs in their own directory are in this state. §8.2
 *                  requires the words "no boundary published for 400097".
 *     unavailable  R2 did not answer. WE DO NOT KNOW whether a boundary exists,
 *                  and saying "there is no area for this PIN" here would be a
 *                  confident lie during an outage of ours.
 *
 * ── IT IS USEFUL WITH NO BASEMAP, AND TODAY THERE IS NONE ───────────────────
 *
 * The Mappls basemap 401s on every domain right now (an account matter on their
 * console, recorded in STATUS.md). `PointRadiusMap.jsx` was built against that
 * reality and this follows it: the words come first and the tiles are an
 * enhancement. The words here are the PIN, the territory that claims it, and
 * the area the polygon actually encloses in km² — computed locally from the
 * same coordinates that would have been drawn, which is what turns the
 * "averages ~82 km²" caption from a slogan into a number the reader can check.
 *
 * ── WHY NOT `PointRadiusMap` ────────────────────────────────────────────────
 *
 * It draws a marker and a circle. A PIN area is a polygon, and drawing a circle
 * around its centroid would be the precision claim §8.2 exists to reset. Its
 * conventions are reused instead of its code: id-string container, `{lat,lng}`
 * centre, `MAP_OFF` kept apart from `MAP_DOWN`, no id ever rendered, nothing
 * logged.
 *
 * ── THE SEAM WHERE EVERY BUG IN THIS FEATURE HAS LIVED ──────────────────────
 *
 * GeoJSON is `[lng, lat]`. The SDK's `center` is `{lat, lng}`. `fitBounds` is
 * `[[west, south], [east, north]]` — LONGITUDE FIRST, unlike everything else.
 * `src/__tests__/mapSdkContract.test.jsx` pins all three for this component as
 * well as for the other two, so the three cannot drift apart.
 *
 * `ringsOf` / `boundsOf` are duplicated from `TerritoryMap.jsx` rather than
 * imported. That is deliberate and it is a cost: they are private to that file
 * and exporting them was not this change's to do. The contract test is what
 * stops the copy drifting — it asserts the bounds order on BOTH components from
 * one fixture.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api, rows } from '../lib/api';
import { loadMappls, MAP_OFF } from '../lib/mapplsSdk';
import Popover from './ui/Popover';

/**
 * "Is this a PIN" — mirroring `services/territory_routing.normalise_pin`
 * EXACTLY, because that function is the product's only definition of the term
 * and this component's job is to say what the server will say.
 *
 * `^[1-9][0-9]{5}$` after a trim: six digits, never starting zero. So `395 002`
 * is not a PIN (the server would not match it either), `NW1 245` is not a PIN
 * (Unicode Group's `INC UK` really holds that in its `pincode` column), and
 * `095002` is not a PIN. A component that was laxer than the server would offer
 * a preview of a PIN the server refuses to look up.
 */
const PIN_RE = /^[1-9][0-9]{5}$/;

export function normalisePin(raw) {
  if (raw == null) return '';
  const t = String(raw).trim();
  return PIN_RE.test(t) ? t : '';
}

/**
 * The PIN out of a stored address column, or `''`.
 *
 * Exported so the `<AddressBlock>` wiring §8.2 asks for can read the PIN the
 * same way this component checks it, rather than growing a second opinion.
 * Only the `pincode` key is read, by name — `AddressBlock.jsx` documents why
 * that matters (Navrang Polymers has 43 keys, "0".."41" spelling a JSON string
 * one character each, and a real `city` as the 43rd), and reassembling anything
 * from character-indexed keys is the guess §8.0 forbids. A doubly-encoded
 * string column is decoded once, which is the shape `backend/db.py`'s
 * `_json_encoder` documents having produced; anything deeper is dropped.
 */
export function pincodeOf(address, depth = 0) {
  if (address == null) return '';
  if (typeof address === 'string') {
    const t = address.trim();
    if (!t || depth > 0 || (t[0] !== '{' && t[0] !== '[')) return '';
    try { return pincodeOf(JSON.parse(t), depth + 1); } catch { return ''; }
  }
  if (typeof address !== 'object' || Array.isArray(address)) return '';
  return normalisePin(address.pincode);
}

/**
 * Every ring of a GeoJSON geometry as Mappls `{lat, lng}` paths.
 *
 * Holes are dropped — ring 0 of each polygon only. A PIN boundary with a hole
 * in it is a PIN enclosing another PIN, and an outline that ignores it is a
 * better answer than no outline. It does mean the area below is the outer
 * ring's, which is why the sentence says "about".
 */
function ringsOf(geometry) {
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

function boundsOf(paths) {
  let n = -90, s = 90, e = -180, w = 180, seen = false;
  paths.forEach(path => path.forEach(({ lat, lng }) => {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    seen = true;
    if (lat > n) n = lat; if (lat < s) s = lat;
    if (lng > e) e = lng; if (lng < w) w = lng;
  }));
  return seen ? { n, s, e, w } : null;
}

/** Kilometres per degree of latitude. Longitude shrinks by cos(latitude). */
const KM_PER_DEG = 111.32;

/**
 * The area a ring encloses, in km², by the shoelace formula on an
 * equirectangular projection about the ring's own mean latitude.
 *
 * Approximate on purpose, and the approximation is far inside the honesty of
 * the claim it supports: over the ~0.1° a PIN spans, the cos(latitude) scaling
 * is wrong by well under a percent, and the sentence says "about". A proper
 * spherical-excess integral would be more arithmetic for a number rounded to
 * the nearest km² either way.
 */
function ringAreaKm2(path) {
  if (path.length < 3) return 0;
  const meanLat = path.reduce((acc, p) => acc + p.lat, 0) / path.length;
  const k = Math.cos((meanLat * Math.PI) / 180);
  let twice = 0;
  for (let i = 0, j = path.length - 1; i < path.length; j = i, i += 1) {
    const x1 = path[j].lng * KM_PER_DEG * k;
    const y1 = path[j].lat * KM_PER_DEG;
    const x2 = path[i].lng * KM_PER_DEG * k;
    const y2 = path[i].lat * KM_PER_DEG;
    twice += x1 * y2 - x2 * y1;
  }
  return Math.abs(twice) / 2;
}

function areaKm2(paths) {
  return paths.reduce((acc, p) => acc + ringAreaKm2(p), 0);
}

/**
 * Which of this organisation's territories claim a PIN, BY NAME.
 *
 * `rules.pincodes` is a free-form jsonb value and the product stores whatever
 * goes in. `pin_boundaries._claim` treats a non-list as claiming nothing (and
 * reports the whole value as invalid), so a non-list claims nothing here
 * either: a screen that were more generous than routing would offer to draw a
 * PIN that no lead will ever be routed by.
 */
function claimantsOf(territories, pin) {
  return territories.filter((t) => {
    const list = t?.rules?.pincodes;
    return Array.isArray(list) && list.some(entry => normalisePin(entry) === pin);
  });
}

/** The load-bearing caption. §8.2: the same expectation reset 7.6 owes. */
const CAPTION = 'PIN area — an Indian PIN averages ~82 km². This shows the '
  + 'postal area, not the building.';

/**
 * The popover's body. Mounted only when the popover is open — `Popover` renders
 * its children lazily — so nothing is fetched until somebody asks.
 */
function PinArea({ pin, height = 220 }) {
  const holder = useRef(null);
  /* The container's ID, and it is load-bearing: `mappls.Map` takes the id of a
     DOM element as a STRING, not the element. Handed the element it answers
     `Error: Map conatainer not defined!!` on their own console (their typo) and
     returns something that is not a map, after which every polygon fails with
     `Please pass map object for polygon or use under load event`. That shipped
     to staging once already, as a correctly-credited empty box.

     Unique per instance because a record can show several addresses and each
     PIN opens its own popover. */
  const mapId = useRef(`pin-area-${Math.random().toString(36).slice(2, 10)}`);
  const [found, setFound] = useState(null);   // the resolved answer, below
  const [fetchErr, setFetchErr] = useState(null);
  const [basemap, setBasemap] = useState(null);
  const [basemapErr, setBasemapErr] = useState(null); // MAP_OFF | MAP_DOWN
  const [drawErr, setDrawErr] = useState(null);

  /**
   * Two of our own calls and no vendor call: the territory list, then the
   * geometry of the first territory claiming this PIN.
   *
   * Only the FIRST claimant is asked. A second would read the same R2 shard
   * through the same server-side cache and answer identically — the buckets are
   * a property of the dataset, not of the territory — so it would be a second
   * request for a guaranteed-identical answer. Every claimant is still NAMED,
   * because two territories claiming one PIN is a configuration question the
   * reader may want to settle.
   */
  const lookup = useCallback(async () => {
    setFetchErr(null);
    setFound(null);
    try {
      const list = rows(await api.get('/v1/graha/territories'));
      const claimants = claimantsOf(list, pin);
      if (!claimants.length) {
        setFound({ kind: 'unclaimed' });
        return;
      }
      const names = claimants.map(t => t.name).filter(Boolean);
      // The id goes into the URL and nowhere else: `check-rendered-ids.mjs`,
      // and the owner's rule behind it — a person or a record is identified on
      // screen by its NAME.
      const r = await api.get(`/v1/graha/territories/${claimants[0].id}/geometry`);
      const d = r.data || {};
      const feature = (d.features || [])
        .find(f => f?.properties?.pincode === pin);
      const common = { names, attribution: d.attribution, vintage: d.vintage };

      if (feature) {
        setFound({ kind: 'drawn', feature, ...common });
      } else if ((d.unavailable || []).includes(pin)) {
        setFound({ kind: 'unavailable', ...common });
      } else if ((d.unmatched || []).includes(pin)) {
        setFound({ kind: 'unmatched', ...common });
      } else {
        /* Unreachable if the endpoint holds its documented arithmetic
           (`matched + unmatched + unavailable === claimed`). Rendered anyway:
           a PIN that falls out of every bucket between the server and this
           screen is exactly the silent loss that arithmetic exists to catch,
           and treating it as "no boundary" would hide it for ever. */
        setFound({ kind: 'dropped', ...common });
      }
    } catch (e) {
      setFound(null);
      setFetchErr(e);
    }
  }, [pin]);

  useEffect(() => { lookup(); }, [lookup]);

  // The basemap is fetched independently of the shape, because every sentence
  // below is worth reading without one — and today there is none.
  useEffect(() => {
    let live = true;
    loadMappls()
      .then(cfg => { if (live) setBasemap(cfg); })
      .catch(err => { if (live) setBasemapErr(err?.reason || 'unavailable'); });
    return () => { live = false; };
  }, []);

  const paths = found?.kind === 'drawn'
    ? ringsOf(found.feature.geometry).filter(p => p.length > 2)
    : [];
  const box = paths.length ? boundsOf(paths) : null;

  // Draw.
  useEffect(() => {
    if (!basemap || !holder.current || !box) return undefined;
    const { mappls } = basemap;
    let map = null;
    setDrawErr(null);

    try {
      // The ID string, and `center` as `{lat, lng}` — both as the SDK
      // documents them, and neither is what an element-and-array guess gives.
      map = new mappls.Map(mapId.current, {
        center: { lat: (box.n + box.s) / 2, lng: (box.e + box.w) / 2 },
        zoom: 11,
      });

      const draw = () => {
        try {
          paths.forEach(path => {
            new mappls.Polygon({
              map,
              paths: path,
              strokeColor: '#1d4ed8',
              strokeOpacity: 0.9,
              strokeWeight: 2,
              fillColor: '#3b82f6',
              fillOpacity: 0.18,
            });
          });
          if (typeof map.fitBounds === 'function') {
            /* `[[west, south], [east, north]]` — LONGITUDE FIRST, and it is the
               one call here that is not `{lat, lng}`, so a swap does not look
               wrong beside the `center` above it. For Surat (21.2 N, 72.9 E)
               the swapped pair reads as lng 21, lat 72 — the Norwegian Sea —
               and the map opens correctly and then flies to empty ocean, which
               a screenshot taken a moment early shows as working. */
            map.fitBounds([[box.w, box.s], [box.e, box.n]], { padding: 16 });
          }
        } catch (err) {
          // Reported, never swallowed: a map that quietly draws nothing looks
          // exactly like a PIN with no boundary, which is the one thing this
          // component must not say when it is not true.
          setDrawErr(err);
        }
      };

      if (typeof map.addListener === 'function') map.addListener('load', draw);
      else draw();
    } catch (err) {
      setDrawErr(err);
    }

    return () => {
      if (map && typeof map.remove === 'function') {
        try { map.remove(); } catch { /* the SDK is third-party; teardown is best effort */ }
      }
    };
    // `box` and `paths` are derived from `found`; `found` is the dependency
    // that actually changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [basemap, found]);

  const covered = found?.names?.length
    ? `Covered by ${found.names.join(', ')}.`
    : null;

  const km2 = paths.length ? areaKm2(paths) : 0;

  return (
    <div className="terr__pinarea">
      <div className="terr__pinhead">{pin}</div>

      {fetchErr && (
        <div className="terr__mapnote terr__mapnote--bad" role="alert">
          The area for this pincode could not be looked up.{' '}
          <button type="button" className="k-btn k-btn--ghost k-btn--sm" onClick={lookup}>
            Try again
          </button>
        </div>
      )}

      {!fetchErr && !found && (
        <div className="terr__mapnote" role="status">Looking up this pincode…</div>
      )}

      {/* No territory claims it, so there is no shape we can ask for. Said in
          full, because "we cannot draw this" and "this PIN has no area" are
          different statements and only the first one is true. */}
      {found?.kind === 'unclaimed' && (
        <div className="terr__mapnote" role="status">
          No territory covers this pincode, and the boundary data can only be
          read one territory at a time — so there is no shape to draw here yet.
          Add it to a territory and its area is drawn.
        </div>
      )}

      {found?.kind === 'unmatched' && (
        <div className="terr__mapnote" role="status">
          No boundary published for {pin}. That is an ordinary answer — 58
          pincodes in the government's own directory have no published shape —
          and it routes normally.
        </div>
      )}

      {found?.kind === 'unavailable' && (
        <div className="terr__mapnote terr__mapnote--bad" role="alert">
          The boundary data could not be read just now, so we cannot say whether
          a shape exists for {pin}. This does not mean the pincode has none.{' '}
          <button type="button" className="k-btn k-btn--ghost k-btn--sm" onClick={lookup}>
            Try again
          </button>
        </div>
      )}

      {found?.kind === 'dropped' && (
        <div className="terr__mapnote terr__mapnote--bad" role="alert">
          This pincode came back in none of the boundary buckets, which should
          not be possible. Please report it.
        </div>
      )}

      {basemapErr === MAP_OFF && found?.kind === 'drawn' && (
        <div className="terr__mapnote" role="status">
          No map is configured in this environment, so the area is not drawn
          here. Everything below is still accurate.
        </div>
      )}
      {basemapErr && basemapErr !== MAP_OFF && found?.kind === 'drawn' && (
        <div className="terr__mapnote terr__mapnote--bad" role="alert">
          The map could not be loaded, so the area cannot be shown on one.
        </div>
      )}
      {drawErr && (
        <div className="terr__mapnote terr__mapnote--bad" role="alert">
          The map loaded but the area could not be drawn.
        </div>
      )}

      {basemap && box && !drawErr && (
        <>
          <div ref={holder} id={mapId.current} className="terr__map"
               style={{ '--h': `${height}px` }}
               role="img"
               aria-label={`Map of the postal area of pincode ${pin}`} />
          {/* Mappls' terms: "Powered by Mappls" shall be clearly presented and
              in no instance removed or hidden. The words come from the same
              response as the token, so a screen cannot obtain a basemap without
              also receiving what it owes for one, and it sits outside every
              collapsible region here for the same reason. */}
          <a className="terr__mapbrand" href={basemap.attributionHref}
             target="_blank" rel="noopener noreferrer">
            {basemap.attribution}
          </a>
        </>
      )}

      <div className="terr__cover">
        {/* The area, from the coordinates themselves. It is what makes the
            caption checkable rather than a slogan, and it is the one useful
            fact this popover can still give with no basemap at all. */}
        {km2 > 0 && (
          <div className="terr__coverline">
            This postal area covers about{' '}
            <strong>{km2 < 1 ? 'a square kilometre' : `${Math.round(km2)} km²`}</strong>
            {km2 >= 1 ? '.' : ' or less.'}
          </div>
        )}
        {covered && <div className="terr__coverline terr__coverline--soft">{covered}</div>}
        <div className="terr__pincap">{CAPTION}</div>
        {/* GODL, for the government boundary data, from the response that
            supplied it. A different credit from the Mappls one, for a different
            thing, and neither substitutes for the other. */}
        {found?.attribution && (
          <div className="terr__mapcredit">{found.attribution}</div>
        )}
      </div>
    </div>
  );
}

/**
 * The PIN, clickable, with the preview behind it.
 *
 * @param {string|number|null} pincode  as stored — anything at all
 * @param {number} height  the map's height in px
 *
 * Three outcomes, and the two that are not a popover matter as much as the one
 * that is:
 *
 *   nothing stored   -> renders NOTHING. Never an em-dash, never an empty
 *                       trigger that opens onto "there is no pincode".
 *   not a PIN        -> renders the text PLAIN and inert. `INC UK` really holds
 *                       `pincode = 'NW1 245'`; there is nothing to preview, and
 *                       offering a button that can only apologise is worse than
 *                       offering none. Nothing is blanked and nothing is
 *                       "corrected" — §8.0's rule, in the other direction.
 *   a PIN            -> the popover.
 */
export default function PinAreaPopover({ pincode, height = 220 }) {
  const raw = pincode == null ? '' : String(pincode).trim();
  const pin = normalisePin(raw);

  if (!raw) return null;
  if (!pin) return <span className="terr__pinplain">{raw}</span>;

  return (
    <Popover
      align="left"
      width={320}
      label={`Postal area of pincode ${pin}`}
      trigger={<span className="terr__pinlink">{pin}</span>}
    >
      <PinArea pin={pin} height={height} />
    </Popover>
  );
}
