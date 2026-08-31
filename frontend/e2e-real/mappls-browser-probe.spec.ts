/**
 * Does Mappls' Places API answer a BROWSER on a whitelisted origin?
 *
 * ── Why this exists, and why it is a spec rather than a console paste ────────
 *
 * Phase 7.6's autosuggest is refused server-side with `Api Access Denied /
 * Domain validation failed`. Measured 2026-08-28, the refusal is specific:
 *
 *     our real minted OAuth token  ->  401 "Domain validation failed"
 *     a string of 36 'f's          ->  401 "invalid_token"
 *
 * The host TELLS THEM APART, so authentication succeeds and authorisation by
 * DOMAIN fails. Six Referer/Origin variants sent from the server were refused
 * byte-identically — which is expected, because a forged `Referer` on a
 * server-to-server call is exactly what domain validation exists to reject.
 *
 * The owner chose to move autosuggest into the browser. That is only worth
 * building if a REAL browser, on a REAL whitelisted origin, gets a different
 * answer — the browser sends an `Origin` the server cannot forge. This spec is
 * that test, and it runs before any of the feature is rewritten.
 *
 * ⚠ IT ASSERTS NOTHING ABOUT SUCCESS. It reports what each call returned, so
 * the decision is made on a measurement rather than on a hope. Read the
 * console output; the expectations only check that the probe RAN.
 *
 * ── What it costs ───────────────────────────────────────────────────────────
 *
 * At most three calls against an allocation of 200, and each is a submission
 * under Mappls' licence — so the query is a PLACE NAME ("Bopal Ahmedabad"),
 * never a customer's stored address. Same rule the feature itself follows.
 */
import { test, expect } from '@playwright/test';
import { APPROVER_STATE } from './real.config';

test.use({ storageState: APPROVER_STATE });

test('Mappls Places, called from a signed-in browser on a whitelisted origin', async ({ page }) => {
  /* `fetch` reports every cross-origin refusal as the same opaque "Failed to
     fetch", and the two causes need OPPOSITE responses: a CSP block is OURS to
     fix in `vercel.json`, while a missing `Access-Control-Allow-Origin` is
     Mappls' and cannot be fixed from this side at all. Only the console and the
     network layer say which. Attached before the first navigation so nothing
     that happens during load is missed. */
  const console_: string[] = [];
  page.on('console', m => { if (m.type() === 'error') console_.push(m.text()); });
  page.on('requestfailed', r => console_.push(
    'requestfailed ' + r.url().split('?')[0] + ' :: ' + (r.failure()?.errorText || '')));

  await page.goto('/');

  /* Load the Web SDK the same way the product does, so the probe can ask what
     the SDK offers rather than what the docs claim. `loadMappls()` is the
     product's loader and it fetches the URL our own token endpoint serves. */
  await page.evaluate(async () => {
    const API = 'https://api.kartavaya.com/api';
    const auth = localStorage.getItem('auth_token');
    const tr = await fetch(API + '/v1/maps/token', {
      headers: auth ? { Authorization: 'Bearer ' + auth } : {},
    });
    if (!tr.ok) return;
    const { sdk_url } = await tr.json();
    if (!sdk_url) return;
    const load = (src: string) => new Promise<void>((res) => {
      const el = document.createElement('script');
      el.src = src; el.onload = () => res(); el.onerror = () => res();
      document.head.appendChild(el);
    });
    await load(sdk_url);
    /* The map bundle carries NO search surface — 124 keys, none matching
       search/suggest/geocode/place. Mappls ships place search as a separate
       LIBRARY, and `&libraries=placesearch` is the documented way to get it.
       This is the last in-browser route: if the plugin does not appear, there
       is no client-side autosuggest at all. */
    await load(sdk_url + '&libraries=placesearch');
    // And the separate plugins bundle, which is where their docs put the
    // place-search widget in the post-2025 SDK.
    const key2 = sdk_url.split('access_token=')[1];
    await load('https://sdk.mappls.com/map/sdk/plugins?v=3.0&access_token=' + key2);
    await load('https://apis.mappls.com/advancedmaps/api/' + key2 + '/map_sdk_plugins?v=3.0');
  });
  await page.waitForTimeout(3000);

  const report = await page.evaluate(async () => {
    const API = 'https://api.kartavaya.com/api';

    // The key never leaves the browser and never enters a transcript: the page
    // asks our own endpoint for it, exactly as the map loader already does.
    //
    // `Authorization: Bearer` from localStorage, NOT `credentials: 'include'`.
    // The app authenticates with a token the shell keeps in localStorage; the
    // httpOnly cookie alone answers 401, which is what the first run of this
    // probe reported and read like "not signed in" when the page was plainly on
    // /dashboard. `_helpers.ts::api` does exactly this.
    const auth = localStorage.getItem('auth_token');
    const tr = await fetch(API + '/v1/maps/token', {
      headers: auth ? { Authorization: 'Bearer ' + auth } : {},
    });
    if (!tr.ok) return ['token endpoint -> ' + tr.status + ' (auth_token present: ' + !!auth + ')'];
    const key = (await tr.json()).token as string;

    const out: string[] = ['static key length: ' + (key ? key.length : 0)];

    const trials: [string, string][] = [
      ['atlas search  ?access_token',
       'https://atlas.mappls.com/api/places/search/json?query=Bopal%20Ahmedabad&access_token=' + key],
      ['atlas geocode ?access_token',
       'https://atlas.mappls.com/api/places/geocode?address=Bopal%20Ahmedabad&access_token=' + key],
      ['apis autosuggest (key in path)',
       'https://apis.mappls.com/advancedmaps/v1/' + key + '/autosuggest?query=Bopal'],
    ];

    for (const [name, url] of trials) {
      try {
        const r = await fetch(url);
        const t = await r.text();
        out.push(name + ' -> ' + r.status + '  ' + t.slice(0, 220));
      } catch (e: any) {
        // A CSP block and a network refusal both land here, and they are
        // different problems — the message distinguishes them.
        out.push(name + ' -> THREW ' + (e && e.message));
      }
    }

    /* ── THE ONLY SUPPORTED IN-BROWSER PATH ──────────────────────────────────
       A plain `fetch` cannot work: Mappls' REST hosts send no
       `Access-Control-Allow-Origin`, so every browser blocks the response
       before our code sees it, and no key or header changes that. Their Web
       SDK is the exception — it ships its own transport and is designed to run
       in a page. If it exposes a search or autosuggest surface, that is the
       client-side autosuggest route; if it does not, there is no client-side
       route at all and the choice collapses back to the server-side one. */
    const sdk = (window as any).mappls;
    out.push('SDK loaded on this page: ' + !!sdk);
    if (sdk) {
      const surfaces = ['search', 'placeSearch', 'autoSuggest', 'autosuggest',
                        'Autosuggest', 'PlaceSearch', 'geocode', 'textSearch'];
      const named = surfaces.filter(n => typeof sdk[n] !== 'undefined')
        .map(n => n + ':' + typeof sdk[n]);
      out.push('SDK guessed names present: ' + (named.join(', ') || 'none'));
      /* Guessing names is how the last two Mappls mistakes started, so
         ENUMERATE instead: every key on the SDK object whose name suggests it
         takes a query. This is the list a decision should be made from. */
      const keys = Object.keys(sdk);
      out.push('SDK total keys: ' + keys.length);
      out.push('window search-ish globals: ' + (Object.keys(window as any)
        .filter(k => /mappls|search|suggest/i.test(k)).join(', ') || 'NONE'));
      out.push('SDK search-ish keys: ' + (keys
        .filter(k => /search|suggest|geocode|place|autoc/i.test(k))
        .map(k => k + ':' + typeof sdk[k]).join(', ') || 'NONE'));

      /* THE ONE THAT DECIDES IT. A surface existing is not a surface working —
         the REST hosts send no CORS headers, so this only helps if the SDK
         carries its own transport. Called with a PLACE NAME, never a stored
         address, for the same licence reason the feature follows. */
      if (typeof sdk.search === 'function') {
        const got: any = await new Promise((res) => {
          const t = setTimeout(() => res({ timeout: true }), 15000);
          try {
            sdk.search({ query: 'Bopal Ahmedabad' }, (data: any) => {
              clearTimeout(t); res(data);
            });
          } catch (e: any) { clearTimeout(t); res({ threw: e && e.message }); }
        });
        if (got && got.timeout) out.push('mappls.search -> NO CALLBACK in 15s');
        else if (got && got.threw) out.push('mappls.search -> THREW ' + got.threw);
        else {
          const list = Array.isArray(got) ? got
            : (got && (got.suggestedLocations || got.copResults || got.results)) || [];
          const arr = Array.isArray(list) ? list : [list];
          out.push('mappls.search -> ' + arr.length + ' result(s)');
          if (arr.length) {
            const f: any = arr[0];
            // EVERY key on the first result, because the mapping to our seven
            // address keys has to be built from what is actually there rather
            // than from what the docs list. Values truncated; a place name is
            // not a secret but a log is a log.
            out.push('  first keys: ' + Object.keys(f).join(','));
            out.push('  first: ' + JSON.stringify(f).slice(0, 400));
          } else {
            out.push('  raw keys: ' + Object.keys(got || {}).join(','));
          }
        }
      }
    }
    return out;
  });

  console.log('\n=== Mappls from a browser on ' + page.url() + ' ===');
  report.forEach(line => console.log('  ' + line));
  /* ⚠ REDACT THE KEY BEFORE PRINTING. The first run of this probe printed the
     Static Key into the run log, because a CORS error message quotes the FULL
     URL it refused and the key is a query parameter in that URL. The key is
     served to every signed-in browser by design and the domain whitelist is
     what restrains it — but a credential in a log is a credential in a log, and
     the one that leaked had to be rotated. A 32+ character run of lower-case
     letters and digits in a mappls.com URL is the key; nothing else in these
     messages looks like that. */
  const redact = (line: string) =>
    line.replace(/(access_token=|advancedmaps\/v1\/)[a-z0-9]{20,}/gi, '$1<REDACTED>');

  console.log('--- browser console / network refusals ---');
  console_.filter(l => /mappls/i.test(l)).forEach(l => console.log('  ' + redact(l)));

  expect(report.length, 'the probe did not run').toBeGreaterThan(1);
});
