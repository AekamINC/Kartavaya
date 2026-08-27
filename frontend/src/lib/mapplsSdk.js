/**
 * mapplsSdk.js — load the Mappls Web Map SDK once, with a token from our backend.
 *
 * ── THERE IS NO `VITE_MAPPLS_KEY`, AND THERE NEVER WAS ──────────────────────
 *
 * `TerritoryMap.jsx` read one from 2026-08-09 to 2026-08-27 and told every
 * reader "the territory map needs a MapMyIndia key". That sentence was false
 * for the whole of its life. Two different credentials were being confused: a
 * frontend build-time key nobody ever bought, and the OAuth pair
 * `MAPPLS_CLIENT_ID` / `MAPPLS_CLIENT_SECRET` that has been on Railway minting
 * tokens successfully the entire time.
 *
 * So the browser asks `GET /api/v1/maps/token` and the credential pair stays on
 * the server. A build-time key would sit in a public bundle, never expire, and
 * need a frontend redeploy to rotate; this token lives ~24h and is handed only
 * to a signed-in user.
 *
 * ── THE SDK URL IS SERVED, NOT BUILT HERE ───────────────────────────────────
 *
 * The old component composed `apis.mappls.com/advancedmaps/api/{KEY}/map_sdk`,
 * a URL that has been **dead since Aug 2025**. Because the component also
 * claimed to need a key, a URL fault read as a credential fault for months and
 * nobody looked further. `sdk_url` now comes from the backend beside the token
 * it embeds, so there is exactly one place that can be wrong about it.
 *
 * ── TWO FAILURES, NEVER MERGED ──────────────────────────────────────────────
 *
 * Same discipline the Phase 7.3 geometry endpoint applies to `unmatched` vs
 * `unavailable`, because the two need opposite responses from the reader:
 *
 *     MAP_OFF   this environment holds no Mappls credentials. A local
 *               checkout, or a preview deploy. Nothing is broken. Say so
 *               plainly and show the data that does not need a basemap.
 *     MAP_DOWN  we hold credentials and could not get a basemap. That IS a
 *               fault and must not be dressed up as "the map is off here".
 */
import { api } from './api';

/** This environment was never given Mappls credentials. Not a fault. */
export const MAP_OFF = 'not_configured';

/** We hold credentials and could not get a basemap. A fault. */
export const MAP_DOWN = 'unavailable';

/**
 * Resolved once per page life, whatever the outcome.
 *
 * A rejected promise is NOT cached: a failed load must be retryable without a
 * reload, the same rule `services/pin_boundaries.py` applies to its R2 index.
 * Only a success is remembered — the SDK attaches `window.mappls` and loading
 * it twice would register its classes twice.
 */
let sdkPromise = null;

export class MapUnavailable extends Error {
  constructor(reason) {
    super(reason === MAP_OFF ? 'Mappls is not configured here' : 'Mappls is unavailable');
    this.name = 'MapUnavailable';
    this.reason = reason;
  }
}

function injectScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.onload = () => {
      // A 200 that did not attach the global is still a failure, and it is the
      // shape a wrong SDK URL takes when the host answers with an error page.
      if (window.mappls) resolve(window.mappls);
      else reject(new MapUnavailable(MAP_DOWN));
    };
    s.onerror = () => reject(new MapUnavailable(MAP_DOWN));
    document.head.appendChild(s);
  });
}

/**
 * `{ mappls, attribution, attributionHref }`, or throws `MapUnavailable`.
 *
 * `attribution` is the "Powered by Mappls" credit and it is returned FROM the
 * same call that returns the token on purpose. Mappls' terms require it to be
 * "clearly presented" and it may "in no instance" be removed or hidden, so a
 * screen must not be able to obtain a basemap here without also receiving what
 * it owes for one. It is a separate obligation from the GODL boundary credit,
 * which belongs to the government dataset and comes from the geometry endpoint.
 */
export function loadMappls() {
  if (sdkPromise) return sdkPromise;

  sdkPromise = (async () => {
    let cfg;
    try {
      const r = await api.get('/v1/maps/token');
      cfg = r.data;
    } catch {
      // The token endpoint always answers 200 when it is reachable, so a throw
      // here is our own backend or the network — never "Mappls is off".
      throw new MapUnavailable(MAP_DOWN);
    }

    if (!cfg?.available) throw new MapUnavailable(cfg?.reason || MAP_DOWN);

    const mappls = window.mappls || (await injectScript(cfg.sdk_url));
    return {
      mappls,
      attribution: cfg.attribution,
      attributionHref: cfg.attribution_href,
    };
  })();

  // Forget a failure so the next mount can try again; keep a success.
  sdkPromise.catch(() => { sdkPromise = null; });

  return sdkPromise;
}

/** Drop the memoised loader. Tests only. */
export function _resetSdkForTests() {
  sdkPromise = null;
}
