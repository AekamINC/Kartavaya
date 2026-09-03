/**
 * TerritoryMap — the shapes of the PINs a territory claims. Phase 7.5.
 *
 * ── WHAT THE OLD ONE DID, AND WHY IT LOOKED FINISHED ────────────────────────
 *
 * It built a Mappls map centred on the geometric middle of India and then
 * stopped. `pincodes` was used for ONE thing — whether to open at zoom 6 or
 * zoom 4 — and no marker, line or polygon was ever added. It also loaded a SDK
 * URL that has been dead since Aug 2025, from a `VITE_MAPPLS_KEY` that was
 * never bought and never needed, and told the reader the key was the problem.
 * A component that says "I need a credential" is trusted; nobody checks whether
 * the URL under it works. See `lib/mapplsSdk.js`.
 *
 * ── THE FOUR BUCKETS ARE THE WHOLE POINT ────────────────────────────────────
 *
 * `GET /territories/{id}/geometry` (Phase 7.3) answers 200 always, and splits
 * every claimed PIN into exactly one of four places. This component's job is to
 * keep them apart, because merging any two of them produces a confident lie:
 *
 *     features     drawn
 *     unmatched    the government published no boundary. ORDINARY — 58 PINs in
 *                  their own directory are in this state. A correct answer.
 *     unavailable  R2 did not answer. WE DO NOT KNOW if a boundary exists. An
 *                  OUTAGE — and the territory is not wrong.
 *     invalid      not a PIN at all. Something to fix, in the territory.
 *
 * The distinction that costs money is the middle two. Told "there is no shape
 * for 110001" during an outage, an admin goes and edits a territory that was
 * never wrong, and the routing that depended on it changes. So:
 *
 *     no features + unavailable  ->  OUTAGE. Never "no shapes".
 *     no features + unmatched    ->  a correct, complete answer.
 *
 * ── TWO CREDITS, TWO SOURCES, NEITHER HARDCODED ─────────────────────────────
 *
 * The boundaries are Government of India data under GODL, and the basemap is
 * Mappls. They are different obligations over different things and one does not
 * cover the other. Each is rendered from the response of the call that supplied
 * the thing it credits — `attribution` from the geometry endpoint, `attribution`
 * from the token endpoint — so a screen cannot show data whose credit it does
 * not also have. Mappls' credit must additionally never be hidden, which is why
 * it is not inside anything collapsible.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { loadMappls, MAP_OFF } from '../lib/mapplsSdk';
import { ringsOf, boundsOf } from '../lib/geoRings';

/** Centre of India — the opening view when there is nothing to fit to. */
const INDIA = { lat: 22.9734, lng: 78.6569 };

/**
 * Every ring of a GeoJSON geometry as Mappls `{lat, lng}` paths.
 *
 * GeoJSON is [lng, lat] and every map SDK is {lat, lng}; a territory drawn in
 * the Indian Ocean is what getting this backwards looks like. Holes are dropped
 * — ring 0 of each polygon only. A PIN boundary with a hole in it is a PIN
 * enclosing another PIN, and an outline that ignores it is a better answer than
 * no outline at all.
 */

export default function TerritoryMap({ territoryId, pincodes = [], height = 240 }) {
  const holder = useRef(null);
  const mapRef = useRef(null);
  /* The container's ID, and it is load-bearing: `mappls.Map` takes the id of a
     DOM element as a STRING, not the element. Handed the element it answers
     `Error: Map conatainer not defined!!` on their own console (their typo),
     returns something that is not a map, and every polygon then fails with
     `Please pass map object for polygon or use under load event`. Both were
     live on staging until this was fixed — the SDK had loaded, the credit and
     the coverage line rendered, and the map box was simply empty.

     Unique per instance because the territory list mounts one of these per open
     row, and two elements sharing an id would silently draw both territories
     into whichever the SDK found first. */
  const mapId = useRef(`terr-map-${Math.random().toString(36).slice(2, 10)}`);
  const [cover, setCover] = useState(null);     // the geometry response
  const [coverErr, setCoverErr] = useState(null);
  const [basemap, setBasemap] = useState(null); // { attribution, attributionHref }
  const [basemapErr, setBasemapErr] = useState(null); // MAP_OFF | MAP_DOWN
  const [drawErr, setDrawErr] = useState(null);

  const claimedNow = pincodes.length;

  const fetchCover = useCallback(async () => {
    if (!territoryId) return;
    setCoverErr(null);
    try {
      const r = await api.get(`/v1/graha/territories/${territoryId}/geometry`);
      setCover(r.data);
    } catch (e) {
      setCover(null);
      setCoverErr(e);
    }
  }, [territoryId]);

  useEffect(() => { fetchCover(); }, [fetchCover]);

  // The basemap is fetched independently of the shapes, because the buckets are
  // worth reading even when no map can be drawn: "3 of your 12 pincodes have no
  // published boundary" is the same true sentence with or without a basemap.
  useEffect(() => {
    if (!territoryId) return undefined;
    let live = true;
    loadMappls()
      .then(cfg => { if (live) setBasemap(cfg); })
      .catch(err => { if (live) setBasemapErr(err.reason || 'unavailable'); });
    return () => { live = false; };
  }, [territoryId]);

  // Draw. Runs when both halves have arrived, and again whenever the shapes
  // change — a saved edit re-fetches and must not leave the old outline behind.
  useEffect(() => {
    if (!basemap || !cover || !holder.current) return undefined;
    const { mappls } = basemap;
    let map = null;
    setDrawErr(null);

    try {
      const features = cover.features || [];
      const allPaths = features.flatMap(f => ringsOf(f.geometry)).filter(p => p.length > 2);
      const box = boundsOf(allPaths);

      // The ID string, and `center` as `{lat, lng}` — both are what the SDK
      // documents and neither is what an array-and-element guess produces.
      map = new mappls.Map(mapId.current, {
        center: box
          ? { lat: (box.n + box.s) / 2, lng: (box.e + box.w) / 2 }
          : { lat: INDIA.lat, lng: INDIA.lng },
        zoom: box ? 9 : 4,
      });
      mapRef.current = map;

      const drawAll = () => {
        try {
          allPaths.forEach(path => {
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
          if (box && typeof map.fitBounds === 'function') {
            /* `[[west, south], [east, north]]` — LNG FIRST, and this was wrong
               in the opposite order until 2026-08-27. `fitBounds` is the one
               place in this file that takes [lng, lat] pairs rather than a
               `{lat, lng}` object, so it does not look wrong beside the
               `center` above it.

               The symptom was not a broken map, which is why it survived a
               screenshot: for Surat (21.2 N, 72.9 E) the swapped pair reads as
               lng 21, lat 72 — the Norwegian Sea — so the map opened correctly
               on Gujarat and then flew to empty ocean, and the reader saw the
               right place for an instant before it left. */
            map.fitBounds([[box.w, box.s], [box.e, box.n]], { padding: 24 });
          }
        } catch (err) {
          // A shape that will not draw is reported, never swallowed. Silently
          // drawing nothing is precisely the failure this rewrite exists to end.
          setDrawErr(err);
        }
      };

      // The SDK wants the style loaded before anything is added to it.
      if (typeof map.addListener === 'function') map.addListener('load', drawAll);
      else drawAll();
    } catch (err) {
      setDrawErr(err);
    }

    return () => {
      if (map && typeof map.remove === 'function') {
        try { map.remove(); } catch { /* the SDK is third-party; teardown is best effort */ }
      }
      mapRef.current = null;
    };
  }, [basemap, cover]);

  // ── An unsaved territory has no id, so there is nothing to ask about ──────
  if (!territoryId) {
    return (
      <div className="terr__mapnote" role="status">
        {claimedNow > 0
          ? `${claimedNow} pincode${claimedNow === 1 ? '' : 's'} — the shapes are drawn once this territory is saved.`
          : 'Add a pincode, and its shape is drawn once this territory is saved.'}
      </div>
    );
  }

  if (coverErr) {
    return (
      <div className="terr__mapnote terr__mapnote--bad" role="alert">
        The pincode shapes could not be loaded.{' '}
        <button type="button" className="k-btn k-btn--ghost k-btn--sm" onClick={fetchCover}>
          Try again
        </button>
      </div>
    );
  }

  if (!cover) {
    return <div className="terr__mapnote" role="status">Loading the pincode shapes…</div>;
  }

  const unmatched = cover.unmatched || [];
  const unavailable = cover.unavailable || [];
  const invalid = cover.invalid || [];
  const matched = cover.matched ?? (cover.features || []).length;

  /* The endpoint's own documented arithmetic, asserted rather than trusted:
     `matched + unmatched + unavailable === claimed`. It is the one statement
     that proves no PIN was silently dropped between the server and this screen,
     and a screen that quietly loses a PIN is how a territory stops routing.
     Shown to the reader, not merely logged: this is their data. */
  const accounted = matched + unmatched.length + unavailable.length;
  const balances = accounted === cover.claimed;

  /* The distinction the whole endpoint was shaped around. Nothing drawn plus a
     non-empty `unavailable` is OUR outage, and saying "no shapes" there would
     send someone to edit a territory that is not wrong. */
  const outage = unavailable.length > 0;
  const nothingDrawn = matched === 0;

  /* The endpoint reads the SAVED row, so while someone is editing the pincode
     list the outlines below are the coverage as it stands, not as it will be.
     Without saying so, adding a pincode and seeing the map not change reads as
     the map being broken. Deduplicated before comparing, because the server
     deduplicates too and a repeated entry is not a pending change. */
  const distinctTyped = new Set(pincodes).size;
  const editedSinceSave = distinctTyped > 0
    && distinctTyped !== cover.claimed + invalid.length;

  return (
    <div className="terr__mapwrap">
      {editedSinceSave && (
        <div className="terr__mapnote" role="status">
          Showing this territory's saved coverage. Save to redraw it with the
          pincodes you have just changed.
        </div>
      )}
      {outage && (
        <div className="terr__mapnote terr__mapnote--bad" role="alert">
          {nothingDrawn
            ? 'The shapes are temporarily unreachable — this territory is not wrong.'
            : `${unavailable.length} pincode${unavailable.length === 1 ? '' : 's'} could not be looked up just now.`}
          {' '}We could not read the boundary data, so we cannot say whether a
          shape exists for {unavailable.length === 1 ? 'it' : 'them'}: {unavailable.join(', ')}.{' '}
          <button type="button" className="k-btn k-btn--ghost k-btn--sm" onClick={fetchCover}>
            Try again
          </button>
        </div>
      )}

      {basemapErr === MAP_OFF && (
        <div className="terr__mapnote" role="status">
          No map is configured in this environment, so the outlines are not drawn
          here. Everything below is still accurate.
        </div>
      )}
      {basemapErr && basemapErr !== MAP_OFF && (
        <div className="terr__mapnote terr__mapnote--bad" role="alert">
          The map could not be loaded. The pincodes and their coverage below are
          unaffected.
        </div>
      )}
      {drawErr && (
        <div className="terr__mapnote terr__mapnote--bad" role="alert">
          The map loaded but the outlines could not be drawn.
        </div>
      )}

      {basemap && !drawErr && (
        <>
          <div ref={holder} id={mapId.current} className="terr__map"
               style={{ '--h': `${height}px` }}
               role="img"
               aria-label={`Map of ${matched} pincode area${matched === 1 ? '' : 's'} covered by ${cover.territory_name}`} />
          {/* Mappls' terms: "Powered by Mappls" shall be clearly presented and
              in no instance removed or hidden. It sits outside every collapsible
              region on this screen for that reason, and its text comes from the
              same response as the token. */}
          <a className="terr__mapbrand" href={basemap.attributionHref}
             target="_blank" rel="noopener noreferrer">
            {basemap.attribution}
          </a>
        </>
      )}

      <div className="terr__cover">
        <div className="terr__coverline">
          <strong>{matched}</strong> of <strong>{cover.claimed}</strong> pincode
          {cover.claimed === 1 ? '' : 's'} drawn
          {nothingDrawn && !outage && unmatched.length > 0 && (
            <> — none of them has a published boundary, which is not an error</>
          )}
        </div>

        {unmatched.length > 0 && (
          <div className="terr__coverline terr__coverline--soft">
            No boundary has been published for {unmatched.length === 1 ? '' : 'these '}
            {unmatched.length} pincode{unmatched.length === 1 ? '' : 's'}: {unmatched.join(', ')}.
            {' '}They still route normally.
          </div>
        )}

        {invalid.length > 0 && (
          <div className="terr__coverline terr__coverline--warn">
            {invalid.length} entr{invalid.length === 1 ? 'y is' : 'ies are'} not a
            pincode and {invalid.length === 1 ? 'is' : 'are'} ignored, here and by
            routing: {invalid.map(v => `"${v}"`).join(', ')}.
          </div>
        )}

        {!balances && (
          /* Unreachable if the endpoint holds its contract. Rendered anyway,
             because the alternative to noticing is a territory quietly covering
             fewer pincodes than it claims. */
          <div className="terr__coverline terr__coverline--warn" role="alert">
            {accounted} of {cover.claimed} pincodes are accounted for. Some are
            unaccounted for — please report this.
          </div>
        )}

        {/* GODL, from the geometry response. A different credit, for the
            boundaries rather than the basemap, and never hardcoded here: a
            frontend constant drifts from the dataset it names. */}
        {cover.attribution && (
          <div className="terr__mapcredit">{cover.attribution}</div>
        )}
      </div>
    </div>
  );
}
