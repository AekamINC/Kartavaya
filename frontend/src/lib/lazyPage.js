/**
 * lazyPage — `React.lazy`, but it survives a deploy that happened while the
 * page was open.
 *
 * THE FAILURE THIS FIXES
 * ----------------------
 * Reported live: every page showing "This page didn't load", for the owner and
 * for every other member at once. The console said:
 *
 *     Failed to load module script: Expected a JavaScript-or-Wasm module
 *     script but the server responded with a MIME type of "text/html"
 *     Failed to fetch dynamically imported module: .../GanitPage-CJQr3QBN.js
 *
 * Nothing was wrong with the build. A FRESH load of the same site served
 * `index-CevFkrRc.js` as `application/javascript`, correctly. The open tabs
 * were holding an OLDER `index.html`, whose chunk filenames carry content
 * hashes that no longer exist after a redeploy. Requests for those files fall
 * through the SPA rewrite and come back as `index.html` — HTML where the
 * browser demanded JavaScript.
 *
 * So the app was fine and every open tab was broken, and the only cure was for
 * each person to know to hard-reload. That is not something users should have
 * to know.
 *
 * WHAT THIS DOES
 * --------------
 * On a chunk that fails to load, reload the page ONCE. The reload fetches the
 * current `index.html` and with it the current chunk names, and the navigation
 * completes normally.
 *
 * ONCE is the whole design. A reload loop is a far worse failure than the one
 * being fixed — it would make the product unusable rather than one page — so
 * the attempt is recorded in `sessionStorage` and a second failure is allowed
 * to fall through to the ErrorBoundary, which already says something true.
 * The flag is per-tab and dies with it.
 *
 * A GENUINE import error is not swallowed: only failures that look like a
 * missing or mistyped module trigger the reload. A page that throws while
 * evaluating still reaches the boundary on the first try.
 */
import { lazy } from 'react';

const FLAG = 'kartavaya:chunk-reloaded';

/** Does this look like a chunk that vanished under us, rather than a bug? */
function isStaleChunk(err) {
  const msg = String(err?.message || err || '');
  return (
    /Failed to fetch dynamically imported module/i.test(msg)
    || /Importing a module script failed/i.test(msg)          // Safari
    || /error loading dynamically imported module/i.test(msg) // Firefox
    // The MIME complaint that appears when the SPA rewrite returns index.html
    // in place of a missing .js — the exact shape seen in the live report.
    || (/Expected a JavaScript/i.test(msg) && /MIME type/i.test(msg))
  );
}

export function lazyPage(factory) {
  return lazy(() => factory().catch((err) => {
    if (!isStaleChunk(err)) throw err;

    let already = false;
    try {
      already = sessionStorage.getItem(FLAG) === '1';
      if (!already) sessionStorage.setItem(FLAG, '1');
    } catch {
      // Private mode, or storage disabled. Without somewhere to record the
      // attempt there is no way to stop a loop, so do not start one.
      throw err;
    }

    if (already) throw err;

    window.location.reload();
    // Never resolves: the reload is already underway and rendering anything
    // here would flash a boundary the user is about to navigate away from.
    return new Promise(() => {});
  }));
}

/**
 * Clear the guard once the app has actually rendered, so a LATER deploy in the
 * same tab gets its own single retry. Without this, one stale chunk early in a
 * session would spend the tab's only attempt for as long as it stays open.
 */
export function markAppLoaded() {
  try {
    sessionStorage.removeItem(FLAG);
  } catch {
    /* nothing to clear */
  }
}

export default lazyPage;
