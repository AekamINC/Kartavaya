/**
 * A MISSING HASHED ASSET MUST 404, NOT BECOME THE APP SHELL.
 *
 * ── THE INCIDENT THIS EXISTS TO PREVENT (2026-08-31) ────────────────────────
 *
 * `public/_redirects` ends with the SPA catch-all:
 *
 *     /* /index.html 200
 *
 * and `public/_headers` gives everything under `/assets/*`:
 *
 *     Cache-Control: public, max-age=31536000, immutable
 *
 * Static files match before this function and before the catch-all, so both
 * rules are right on their own. Together they are a trap. The moment a request
 * for `/assets/index-<hash>.css` does NOT resolve to a file — a deploy where
 * the browser holds a newer `index.html` than the asset set being served —
 * the catch-all answers it with **index.html, status 200**, and the `/assets/*`
 * header rule stamps that HTML `immutable, max-age=31536000`.
 *
 * The edge then caches the app shell UNDER A STYLESHEET'S URL FOR A YEAR.
 *
 * What that looks like, because it does not look like a cache bug: every
 * visitor on that edge gets `Refused to apply style from … MIME type
 * ('text/html')`, the app renders unstyled, and `cf-cache-status` says HIT on a
 * 200. It is invisible to `curl` from a machine whose own cache entry is
 * healthy — I measured `text/css` from the command line and `text/html` from a
 * browser against the same URL in the same minute — and it survives redeploys,
 * because nothing about a new deploy evicts a year-long immutable entry keyed
 * on a filename that has not changed.
 *
 * It cost four full e2e runs, read as ~40 product failures, before the
 * screenshot of an unstyled "Loading Kartavaya" splash pointed at the cache
 * rather than the code.
 *
 * ── WHAT THIS DOES ─────────────────────────────────────────────────────────
 *
 * Pages routes a request to a static file first; only if there is no such file
 * does it reach `functions/`, and only after that the `_redirects` catch-all.
 * So this runs EXACTLY in the gap that caused the incident, and it closes it by
 * answering the truth: the asset is not there.
 *
 * A 404 is honest, is not cached as immutable, and surfaces as a real error in
 * the console and in Sentry instead of a silently unstyled page. `no-store`
 * makes certain of it, so a bad minute can never outlive itself.
 *
 * ⚠ It must NEVER serve a body that could be mistaken for an asset. An empty
 * body with an explicit `text/plain` is deliberate: returning HTML here would
 * recreate the exact defect, one layer further in.
 */
export function onRequest(context) {
  const url = new URL(context.request.url);
  return new Response('', {
    status: 404,
    statusText: 'Not Found',
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      // The whole point. Anything cacheable here can be frozen by an edge the
      // same way the app shell was.
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      // Names the file that was asked for, so the next person reading a console
      // or a Sentry breadcrumb sees which build the client is on.
      'X-Missing-Asset': url.pathname.slice(0, 200),
    },
  });
}
