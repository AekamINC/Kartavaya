import axios from "axios";
import { getActiveOrg } from "./orgContext";

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL;
if (!BACKEND_URL) {
  // Guard: only touch DOM in a real browser context (not SSR / test / Storybook)
  if (typeof document !== 'undefined' && document.body) {
    document.body.innerHTML =
      '<div style="display:flex;height:100vh;align-items:center;justify-content:center;font-family:sans-serif;flex-direction:column;gap:12px">' +
      '<h2 style="color:#dc2626">Configuration Error</h2>' +
      '<p style="color:#555">VITE_BACKEND_URL is not set. Please check your deployment environment.</p>' +
      '</div>';
  }
  throw new Error('VITE_BACKEND_URL is not set');
}
const API = `${BACKEND_URL}/api`;

export const api = axios.create({
  baseURL: API,
  withCredentials: true, // send httpOnly session_token cookie
});

// Attach JWT from localStorage as Bearer fallback (migration period)
api.interceptors.request.use((config) => {
  const token = localStorage.getItem("auth_token");
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }

  // Which of the user's own organisations this session is acting as.
  //
  // Without it the server resolves to the user's OLDEST membership and nothing
  // else is reachable — see `lib/orgContext.js` and `routers/org_switch.py`.
  // A caller that has already set the header explicitly (the admin console's
  // `scoped()`, which reaches into other people's orgs one call at a time)
  // keeps its own value: that is a narrower, deliberate scope and this must not
  // overwrite it.
  const activeOrg = getActiveOrg();
  if (activeOrg && !config.headers['X-Org-Id']) {
    config.headers['X-Org-Id'] = activeOrg;
  }
  return config;
});

/**
 * Routes that render without a session. A 401 raised while the user is on one
 * of these is not an expired session — it is the answer to a form they just
 * submitted — so it must never bounce them somewhere else mid-flow.
 */
const PUBLIC_PATHS = [
  '/login', '/accept-invite', '/forgot-password', '/reset-password',
  '/approve', '/sign/',
];

/**
 * Endpoints whose 401 means "these credentials are wrong", not "your session
 * ended". `POST /auth/login` is the whole list today: it is the only route that
 * answers 401 to an unauthenticated caller by design. Everything else that
 * answers 401 does so from `require_user`, which has exactly three causes — no
 * token, an undecodable or expired token, or a user row that no longer exists —
 * and all three mean the session is over.
 */
const CREDENTIAL_401 = ['/auth/login'];

/**
 * One redirect per page life. Six requests in flight when a token expires
 * produce six 401s; without this latch they produce six navigations, and the
 * last one wins a race against the first one's cleanup.
 */
let sessionEnded = false;

/** Test seam — a module-level latch would otherwise leak between test cases. */
export function _resetSessionLatch() { sessionEnded = false; }

/**
 * The session is over. Drop the local copies and send the user to sign in with
 * a reason, so the login screen can say "your session expired" instead of
 * showing an empty form and letting them wonder what they did.
 *
 * NOT a refresh attempt. `POST /auth/refresh` requires a token `require_user`
 * still accepts, so by the time a 401 has arrived the token it would send is
 * already the rejected one — retrying it would be a second 401 dressed up as
 * recovery. Refresh is proactive and lives in `Protected`; this is the failure
 * path, and its only correct move is to stop pretending there is a session.
 */
function endSession() {
  if (sessionEnded) return;
  sessionEnded = true;
  try {
    localStorage.removeItem('auth_token');
    localStorage.removeItem('Kartavaya_user');
    localStorage.removeItem('kv_teams_cache');
  } catch { /* private mode — the redirect still has to happen */ }
  if (typeof window === 'undefined') return;
  const from = window.location.pathname + window.location.search;
  const q = new URLSearchParams({ expired: '1' });
  // `from` only when it is worth returning to. Carrying `/login` forward would
  // make signing in bounce to itself.
  if (from && from !== '/' && !PUBLIC_PATHS.some((p) => from.startsWith(p))) q.set('from', from);
  window.location.replace(`/login?${q.toString()}`);
}

// Retry on network errors / 502-504 (Railway restart window) — up to 3 attempts
// noRetry: true skips retries (used for file uploads to avoid double-sending)
api.interceptors.response.use(undefined, async (error) => {
  const config = error.config;
  const status = error.response?.status;

  /**
   * 401 handling — 12-auth-onboarding.md §5 and AUTH-SPEC ask for an expired
   * session and a bad credential to be told apart. Before this there was no
   * 401 branch at all: an expired token produced whatever error each caller
   * happened to render, the stale `Kartavaya_user` stayed in localStorage, and
   * the nav kept drawing modules for a session that no longer existed.
   *
   * Deliberately ahead of the retry block. Retrying a 401 cannot change the
   * answer and would delay the redirect by up to 4.8s.
   */
  if (status === 401) {
    const url = config?.url || '';
    const isCredentialCheck = CREDENTIAL_401.some((p) => url.includes(p));
    const onPublicPage =
      typeof window !== 'undefined' &&
      PUBLIC_PATHS.some((p) => window.location.pathname.startsWith(p));
    if (!isCredentialCheck && !onPublicPage) endSession();
    return Promise.reject(error);
  }

  if (!config || config.noRetry) return Promise.reject(error);
  config._retryCount = config._retryCount ?? 0;
  /**
   * Only methods that can be repeated safely.
   *
   * A 502 does not mean "nothing happened" — it means the reply did not arrive.
   * On a POST the work may have run in full, so a retry runs it AGAIN, and the
   * three retries here turn one click into four.
   *
   * Measured on staging, 2026-07-31: `POST /v1/scrapers/run` debits credits
   * BEFORE calling Apify. One click on a scraper whose actor no longer exists
   * produced four 502s, four debits and zero runs — the wallet went 173 → 169
   * with nothing to show for it and no run row to refund against.
   *
   * The Railway restart window this was written for is real, and GET keeps its
   * retries — repeating a read costs nothing. A write has to be idempotent
   * before it can be repeated, and none of these are.
   */
  const method = String(config.method || 'get').toLowerCase();
  const isReplayable = ['get', 'head', 'options'].includes(method);
  const isRetryable =
    isReplayable && (
      !error.response ||                        // network error
      [502, 503, 504].includes(status));
  if (isRetryable && config._retryCount < 3) {
    config._retryCount += 1;
    await new Promise(r => setTimeout(r, config._retryCount * 800));
    return api(config);
  }
  return Promise.reject(error);
});

/* ── Response unwrapping ───────────────────────────────────────────────────
 * `api` is a bare axios instance, so `api.get(p)` resolves to the RESPONSE and
 * the body is `r.data`. What the body then looks like is decided per route and
 * there is no rule: 99 GET routes answer `{"data": [...]}` and 28 answer a bare
 * array. Every call site therefore has to remember which kind it is calling,
 * and getting it wrong fails in the two worst ways available —
 *
 *   · `r.data.map(...)` on an envelope throws, and takes the panel down blank;
 *   · `Array.isArray(r.data) ? r.data : []` on an envelope silently renders an
 *     EMPTY LIST, which on a payroll or invoice screen is not a broken page,
 *     it is a false statement about the business.
 *
 * That mismatch is what left five Prachar tabs blank and both Dristi list
 * endpoints reading as empty. Route reads through `rows()` and the shape stops
 * mattering. Unwrapping belongs here rather than in one module's helpers,
 * because the inconsistency is codebase-wide.
 */

/** The array out of a list route, tolerant of both `{"data": [...]}` and a bare array. */
export const rows = (r) => {
  const b = r?.data;
  if (Array.isArray(b)) return b;
  if (Array.isArray(b?.data)) return b.data;
  return [];
};

/** The object out of a single-object route. */
export const body = (r) => r?.data ?? {};

export { BACKEND_URL, API };
