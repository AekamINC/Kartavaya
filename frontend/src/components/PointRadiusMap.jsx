/**
 * PointRadiusMap — one coordinate, an optional radius around it, drawn AND said
 * in words. Built for Phase 8.1 (the Pahchan geofence); deliberately not named
 * after it.
 *
 * ── THE FAULT THIS EXISTS TO CLOSE ──────────────────────────────────────────
 *
 * A Pahchan geofence is configured by typing two decimal numbers and a radius,
 * and until now there was no way to see any of them. `pages/pahchan/Sites.jsx`
 * names the risk in its own header — "a radius typed as 15 instead of 150, or a
 * pin dropped on the wrong side of a building" — and the consequence is not
 * cosmetic: `_nearest_site` matches a punch against the closest site and
 * `_compute_flags` decides the `geo` flag from `distance_m` against `radius_m`.
 * A fence in the wrong place flags every honest punch at that site, every
 * morning, and a punch keeps the flags it was given AT CAPTURE — so nobody can
 * go back and fix yesterday once it has happened.
 *
 * ── IT MUST BE USEFUL WITH NO BASEMAP, AND TODAY IT HAS NONE ────────────────
 *
 * The Mappls basemap 401s on every domain right now ("Domain validation failed"
 * / "Token was not recognised") — an account matter on the Mappls console,
 * recorded in STATUS.md, and NOT a fault in this file. A component whose only
 * output was tiles would therefore ship as a blank box indistinguishable from
 * breakage, verifiable by nobody until the console is fixed. So the words come
 * first and the tiles are an enhancement on top of them:
 *
 *   - the coordinates read back with their hemispheres, because `18.93` and
 *     `-18.93` are one keystroke apart and land 4,200 km apart;
 *   - the radius in metres AND as a distance across the ground, because `15`
 *     and `150` look equally reasonable in a number input and only one of them
 *     lets somebody stand at the gate;
 *   - whether the point is even in India and — the specific typo — whether
 *     SWAPPING the two numbers would put it there. `72.83, 18.93` is a
 *     perfectly valid coordinate pair in the Arabian Sea and no validator
 *     anywhere in this product rejects it.
 *
 * None of that needs a tile server, so all of it works today. That is the test
 * of this component: every sentence it prints is true in the state the product
 * is actually in.
 *
 * `MAP_OFF` and `MAP_DOWN` are kept apart for the reason `lib/mapplsSdk.js`
 * gives: "no map is configured here" is a fact about the environment, and "the
 * map could not be loaded" is a fault someone must go and fix. Saying the
 * second when the first is true sends a person hunting a bug that is not there.
 *
 * ── PERSONAL DATA ───────────────────────────────────────────────────────────
 *
 * A site centre and a punch coordinate are personal data under the DPDP Act
 * once they sit beside a person. So this component:
 *
 *   - takes its figures as PROPS and fetches nothing. No coordinate is ever put
 *     in a URL, a query string or a request body from here;
 *   - logs nothing, ever. Not `console.log`, not a `debug` guard — a coordinate
 *     written to a console is a coordinate in someone's session recording;
 *   - accepts no id of any kind, so it cannot render a UUID (the
 *     `check-rendered-ids.mjs` ratchet). What it labels a point with is a NAME,
 *     supplied by the caller.
 *
 * ── WHY IT IS GENERIC ───────────────────────────────────────────────────────
 *
 * Phase 8's later steps want this same picture for other things: 8.2 opens a
 * PIN area from an address block, and 8.4 drops a deliberate pin on a client's
 * premises. A component called `SiteGeofenceMap` that hardcoded the word "site"
 * would be copied rather than reused, and the second copy is where the two
 * drift. So the subject noun and the one domain-specific sentence arrive as
 * props, and everything else here is true of any point on the earth.
 *
 * What it is NOT, deliberately: interactive. Nothing here writes a coordinate.
 * Drag-to-place belongs to 8.4, which owes `geo_source` and `geo_fetched_at`
 * columns alongside the coordinate it captures; adding a silent drag handler
 * now would create exactly the provenance-free coordinate that plan forbids.
 *
 * ── WHAT IS DELIBERATELY NOT DRAWN ──────────────────────────────────────────
 *
 * Pahchan's altitude pair. A circle is horizontal, the vertical window is
 * already explained in words on `Rules.jsx` and on the site form, and drawing a
 * cylinder would imply a precision consumer GNSS does not have. Phase 8.1 says
 * so explicitly.
 */
import React, { useEffect, useRef, useState } from 'react';
import { loadMappls, MAP_OFF } from '../lib/mapplsSdk';

/**
 * India's bounding box, generously drawn (mainland plus the island groups).
 * Used ONLY to write a sentence — never to reject anything, and nothing in this
 * component can block a save. Kartavya already has a UK org on its books, and
 * "outside India" is unusual rather than wrong.
 */
const IN = { s: 6.0, n: 37.6, w: 68.0, e: 97.5 };

const inIndia = (lat, lng) =>
  lat >= IN.s && lat <= IN.n && lng >= IN.w && lng <= IN.e;

/**
 * A form field's value as a number, where blank is blank and never zero.
 *
 * `Number('')` is `0`, which is how an empty coordinate field becomes a point
 * in the Gulf of Guinea. The same trap `Sites.jsx`'s own `blankOr` was written
 * against, guarded again here because this component is given raw form strings.
 */
function numOr(v) {
  if (v == null) return null;
  const s = String(v).trim();
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** `18.933300° N` — the hemisphere spelled out, because a lost minus sign is
 *  invisible in a number input and moves the point to the other hemisphere. */
const hemi = (v, pos, neg) => `${Math.abs(v).toFixed(6)}° ${v < 0 ? neg : pos}`;

/**
 * What a radius means on the ground, in a sentence.
 *
 * Not decoration. The documented typo is one decimal place, and the only
 * defence against it that works with no basemap is telling the operator what
 * the number they have typed actually covers.
 */
function radiusSense(r) {
  if (r < 25) {
    return 'Tight enough that somebody at the far side of a large room is '
      + 'outside it — check this is not a missing digit.';
  }
  if (r < 75) return 'About one building frontage. Enough for a single entrance.';
  if (r < 250) return 'A building and its approach — the usual setting.';
  if (r < 1000) return 'A whole compound, and the street outside it.';
  return 'Over a kilometre across: most of a neighbourhood falls inside it.';
}

export default function PointRadiusMap({
  /** What the point is called. A NAME — never an id. */
  label,
  /** The noun this component uses for the thing being placed. */
  subject = 'point',
  lat: latIn,
  lng: lngIn,
  /** Optional. Omit for a bare marker with no circle. */
  radiusM: radiusIn,
  /** One caller-supplied sentence on what the radius means for their module. */
  radiusNote,
  height = 240,
}) {
  const holder = useRef(null);
  /* `mappls.Map` takes the container's ID as a STRING, not the element. Handed
     the element it logs `Error: Map conatainer not defined!!` (their typo) and
     returns something that is not a map, after which every overlay fails with
     `Please pass map object for polygon or use under load event`. Both were
     live on staging in TerritoryMap before this was found — the SDK loaded, the
     credit rendered, and the map box was simply empty, which reads as a styling
     problem rather than a broken call.

     Unique per instance: a site list can mount several of these, and a shared
     id would draw every geofence into whichever container the SDK found first. */
  const mapId = useRef(`ph-geomap-${Math.random().toString(36).slice(2, 10)}`);
  const overlays = useRef([]);
  const [basemap, setBasemap] = useState(null);        // { mappls, attribution, … }
  const [basemapErr, setBasemapErr] = useState(null);  // MAP_OFF | MAP_DOWN
  const [drawErr, setDrawErr] = useState(null);

  const lat = numOr(latIn);
  const lng = numOr(lngIn);
  const radius = numOr(radiusIn);

  /* Exactly (0, 0) is a point in the Atlantic and it is what an empty form
     looks like once `Number('')` has been allowed to happen somewhere upstream.
     Treated as "not placed" rather than drawn, and the reason is said out loud:
     silently ignoring a pair of zeroes is how the same bug survives unnoticed. */
  const nullIsland = lat === 0 && lng === 0;
  const inRange = lat != null && lng != null
    && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
  const placed = inRange && !nullIsland;

  /* Three radius states, not two. A radius that is absent is a caller who does
     not have one; a radius of 0 or less is a typed number that makes the circle
     impossible to be inside, and the two must not read the same. */
  const hasRadius = radius != null;
  const sized = hasRadius && radius > 0;

  // The basemap is loaded whether or not a point has been typed yet, so the
  // tiles are already there the moment one is.
  useEffect(() => {
    let live = true;
    loadMappls()
      .then(cfg => { if (live) setBasemap(cfg); })
      .catch(err => { if (live) setBasemapErr(err?.reason || 'unavailable'); });
    return () => { live = false; };
  }, []);

  /**
   * Draw. Rebuilt whenever the figures change, because that is the entire point
   * on a form being typed into: a circle that lags the fields is a picture of a
   * decision somebody already changed their mind about.
   */
  useEffect(() => {
    if (!basemap || !holder.current || !placed) return undefined;
    const { mappls } = basemap;
    let map = null;
    setDrawErr(null);

    const clear = () => {
      overlays.current.forEach(o => {
        try {
          if (o && typeof o.remove === 'function') o.remove();
          else if (o && typeof o.setMap === 'function') o.setMap(null);
        } catch { /* the SDK is third-party; teardown is best effort */ }
      });
      overlays.current = [];
    };

    try {
      // Zoom follows the radius. A 15 m circle at zoom 12 is a dot, which is
      // precisely the misreading this component exists to prevent.
      const r = sized ? radius : 150;
      const zoom = r <= 50 ? 18 : r <= 150 ? 17 : r <= 500 ? 15 : r <= 2000 ? 13 : 11;

      // Id string, and `{lat, lng}` — both as the SDK documents them.
      map = new mappls.Map(mapId.current, { center: { lat, lng }, zoom });

      const draw = () => {
        try {
          clear();
          overlays.current.push(new mappls.Marker({
            map,
            position: { lat, lng },
            title: label || undefined,
          }));
          if (sized) {
            overlays.current.push(new mappls.Circle({
              map,
              center: { lat, lng },
              radius,
              strokeColor: '#1d4ed8',
              strokeOpacity: 0.9,
              strokeWeight: 2,
              fillColor: '#3b82f6',
              fillOpacity: 0.15,
            }));
          }
        } catch (err) {
          // Reported, never swallowed. A map that quietly draws nothing is
          // indistinguishable from one showing a fence that is correct.
          setDrawErr(err);
        }
      };

      // The SDK wants its style loaded before anything is added to it.
      if (typeof map.addListener === 'function') map.addListener('load', draw);
      else draw();
    } catch (err) {
      setDrawErr(err);
    }

    return () => {
      clear();
      if (map && typeof map.remove === 'function') {
        try { map.remove(); } catch { /* best effort */ }
      }
    };
  }, [basemap, placed, sized, lat, lng, radius, label]);

  /* The transposition. Only worth saying when the pair as typed is NOT in India
     and the pair reversed would be — otherwise it is noise on every UK address. */
  const swapped = placed && !inIndia(lat, lng)
    && lng >= -90 && lng <= 90 && inIndia(lng, lat);

  const named = label ? `${label}` : `this ${subject}`;

  return (
    <div className="ph__geo">
      {/* ── The numbers, first and unconditionally ────────────────────────── */}
      {!placed ? (
        <div className="ph__geonote" role="status">
          {nullIsland
            ? `A latitude and longitude of 0, 0 is a real point in the Atlantic, `
              + `not a blank. Clear both fields or type where the ${subject} `
              + `actually is.`
            : lat == null && lng == null
              ? `No coordinates yet. Type a latitude and longitude and the `
                + `${subject} is drawn here.`
              /* Half-filled BEFORE off-the-earth. A missing longitude fails the
                 range test too, and reporting it as "off the earth" would send
                 the operator to re-check a latitude that is perfectly fine.
                 This ordering was wrong on the first draft and a test caught
                 it. */
              : lat == null || lng == null
                ? `Only one of the two coordinates is set, so there is nothing to `
                  + `place yet.`
                : 'Those coordinates are off the earth — latitude runs −90 to 90 '
                  + 'and longitude −180 to 180.'}
        </div>
      ) : (
        <div className="ph__geofacts">
          {/* WHICH thing these figures belong to. Omitted when the caller has
              no name yet — an unnamed row is better than a row labelled
              "undefined" — and it is a NAME, never an id: this component is
              given no identifier it could render. */}
          {label && (
            <div className="ph__geoline">
              <span className="ph__geok">{subject}</span>
              <span className="ph__geov"><strong>{label}</strong></span>
            </div>
          )}
          <div className="ph__geoline">
            <span className="ph__geok">Centre</span>
            <span className="ph__geov ph__mono">
              {hemi(lat, 'N', 'S')}, {hemi(lng, 'E', 'W')}
            </span>
          </div>

          {hasRadius && (
            <div className={`ph__geoline${sized ? '' : ' ph__geoline--warn'}`}
                 role={sized ? undefined : 'alert'}>
              <span className="ph__geok">Radius</span>
              <span className="ph__geov">
                {sized ? (
                  <>
                    <span className="ph__mono">{radius} m</span> out from that
                    point — <span className="ph__mono">{radius * 2} m</span>{' '}
                    across the ground. {radiusSense(radius)}
                  </>
                ) : (
                  <>
                    <span className="ph__mono">{radius} m</span> is a circle
                    nothing can be inside. Every reading taken here would fall
                    outside it.
                  </>
                )}
              </span>
            </div>
          )}

          {!inIndia(lat, lng) && (
            <div className="ph__geoline ph__geoline--warn" role="alert">
              <span className="ph__geok">Check</span>
              <span className="ph__geov">
                {named} is outside India.{' '}
                {swapped
                  ? 'Swapping the latitude and longitude would put it inside '
                    + 'India — they look the wrong way round.'
                  : 'Nothing is blocked by that, but it is worth a second look '
                    + 'before saving.'}
              </span>
            </div>
          )}

          {radiusNote && sized && (
            <div className="ph__geoline ph__geoline--soft">
              <span className="ph__geok" aria-hidden="true" />
              <span className="ph__geov">{radiusNote}</span>
            </div>
          )}
        </div>
      )}

      {/* ── The tiles, when there are any ─────────────────────────────────── */}
      {basemapErr === MAP_OFF && (
        <div className="ph__geonote" role="status">
          No map is configured in this environment, so the {subject} is not drawn
          here. The figures above are the ones that will be saved.
        </div>
      )}
      {basemapErr && basemapErr !== MAP_OFF && (
        <div className="ph__geonote ph__geonote--bad" role="alert">
          The map could not be loaded, so the {subject} cannot be shown on one.
          The figures above are unaffected — check them before saving.
        </div>
      )}
      {drawErr && (
        <div className="ph__geonote ph__geonote--bad" role="alert">
          The map loaded but the {subject} could not be drawn on it.
        </div>
      )}

      {basemap && placed && !drawErr && (
        <>
          <div
            ref={holder}
            id={mapId.current}
            className="ph__geomap"
            style={{ '--h': `${height}px` }}
            role="img"
            aria-label={
              sized
                ? `Map of ${named}, with a ${radius} metre circle around it`
                : `Map of ${named}`
            }
          />
          {/* Mappls' terms require their credit to be clearly presented, and it
              may "in no instance" be removed or hidden. The words come from the
              same response as the token, so a screen cannot obtain a basemap
              without also receiving what it owes for one, and
              `scripts/check-mappls-attribution.mjs` keeps it that way. It sits
              outside every collapsible region here for the same reason. */}
          <a
            className="terr__mapbrand"
            href={basemap.attributionHref}
            target="_blank"
            rel="noopener noreferrer"
          >
            {basemap.attribution}
          </a>
        </>
      )}
    </div>
  );
}
