/**
 * mapplsSdk.js — load the Mappls Web Map SDK once, with a token from our backend.
 *
 * ── A KEY *IS* NEEDED. IT JUST IS NOT A `VITE_` ONE ─────────────────────────
 *
 * `TerritoryMap.jsx` read `VITE_MAPPLS_KEY` from 2026-08-09 to 2026-08-27 and
 * told every reader "the territory map needs a MapMyIndia key". On 2026-08-27
 * that was declared false, on the grounds that the OAuth pair on Railway mints
 * tokens successfully. **The mint was tested; the SPEND was not.** Probed
 * against Mappls the same day, the minted token is refused by every one of
 * their products, and the post-2025 SDK host cannot distinguish it from a
 * randomly generated string.
 *
 * Mappls **replaced the mechanism in August 2025** (their `mappls-web-maps-js`
 * README; the OAuth flow now lives on an `auth-legacy` branch). The SDK takes
 * the console's **Static Key**, a different credential from the Client ID and
 * Secret. So the original message was right that a key was missing — it was
 * only wrong about which one.
 *
 * What survives of that decision is the part worth keeping: the key lives on
 * Railway as `MAPPLS_STATIC_KEY` and is served by `GET /api/v1/maps/token`,
 * NOT baked into the bundle as a `VITE_` variable. A build-time key cannot be
 * rotated without a frontend redeploy.
 *
 * ⚠ A Static Key **does not expire**, and this hands it to the browser, so it
 * is readable in any network tab. The console's DOMAIN WHITELIST is the only
 * thing stopping it being lifted and spent elsewhere — it is the security
 * control, not a formality.
 *
 * ── THE SDK URL IS SERVED, NOT BUILT HERE ───────────────────────────────────
 *
 * `sdk_url` comes from the backend beside the key it embeds, so there is
 * exactly one place that can be wrong about it. That mattered: the legacy URL
 * form and the legacy credential were consistent with each other, and a comment
 * here previously called that URL "dead since Aug 2025" — which was backwards,
 * and is the kind of confident wrong note that sends the next reader down the
 * same path. It was the auth MECHANISM that changed, not the URL alone.
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

/** The plugins bundle, injected at most once per page. */
let pluginPromise = null;

/**
 * `window.mappls` with `search` attached, or throws `MapUnavailable`.
 *
 * The plugins script is served from the same host and takes the same
 * `access_token`, so it is derived from the map URL rather than given a second
 * definition — the dead-SDK-URL episode in §7.5 is what one more hand-written
 * Mappls URL costs.
 */
function loadSearchPlugin(sdkUrl) {
  if (pluginPromise) return pluginPromise;

  const token = String(sdkUrl).split('access_token=')[1] || '';
  const url = `https://sdk.mappls.com/map/sdk/plugins?v=3.0&access_token=${token}`;

  pluginPromise = (async () => {
    if (typeof window.mappls?.search === 'function') return window.mappls;
    await injectScript(url);
    if (typeof window.mappls?.search !== 'function') {
      // Loaded and did not attach `search`: the same shape a wrong SDK URL
      // takes, and it must not read as "Mappls is off".
      throw new MapUnavailable(MAP_DOWN);
    }
    return window.mappls;
  })();

  pluginPromise.catch(() => { pluginPromise = null; });
  return pluginPromise;
}

/**
 * `{ mappls, attribution, attributionHref, loadSearch }`, or throws
 * `MapUnavailable`.
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
      /* ── The PLUGINS bundle, loaded ONLY when something asks ─────────────
         The map bundle above carries 124 keys and NOT ONE search surface —
         enumerated in a real browser, not read off the docs. The plugins
         bundle takes it to 139 and adds `search`, `placePicker` and
         `advancePlacePicker`.

         It is a SEPARATE, LAZY call because most screens that draw a map never
         search, and a second script on every map is a cost paid by all of them
         for a feature few use. `loadSearch()` is what an address field calls.

         ⚠ THIS IS THE ONLY WAY A BROWSER CAN REACH MAPPLS PLACES. Measured
         2026-08-28 from a signed-in page on the whitelisted origin: a plain
         `fetch` to `atlas.mappls.com/api/places/search/json`,
         `/places/geocode` and `apis.mappls.com/.../autosuggest` is blocked by
         CORS on all three — "No Access-Control-Allow-Origin header is present
         on the requested resource". That is not a key, header or whitelist
         problem and cannot be fixed from this side: the response is blocked
         before our code sees it. The SDK ships its own transport, so it is not
         subject to that wall. Do not "simplify" this into a fetch. */
      loadSearch: () => loadSearchPlugin(cfg.sdk_url),
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
