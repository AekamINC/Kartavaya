/**
 * orgContext.js — which organisation this browser session is acting as.
 *
 * ── Why an interceptor here, when the admin console refuses one ─────────────
 * `pages/admin/orgScope.js` is emphatic that the org must be passed explicitly
 * at each call site, never attached globally: "a page reading it out of module
 * state would be one stale render away from billing the wrong company."
 *
 * That is right THERE and does not apply here, because the two are different
 * operations. The admin console is platform staff reaching into other people's
 * organisations for one screen at a time, so the scope is per-call by nature.
 * This is a member choosing which of THEIR OWN organisations the whole session
 * is looking at — every request, every page, until they choose otherwise. A
 * per-call scope would mean threading the org through several hundred call
 * sites, and the one that got missed would silently read the wrong tenant.
 *
 * The failure mode the admin file warns about is handled instead by making a
 * switch a hard boundary: `setActiveOrg` writes the choice and reloads the
 * document, so nothing rendered, cached or in flight under the previous org can
 * survive into the new one. There is no window in which a stale component holds
 * the old org's data while requests carry the new org's header.
 *
 * ── Safety ──────────────────────────────────────────────────────────────────
 * The header is not authority. `middleware/org_resolver.get_org_id` validates
 * it on every request and answers 403 for an org the caller does not belong to,
 * 404 for one that is inactive. A tampered value widens nothing; it only
 * changes which of the caller's own organisations is being read.
 */

const KEY = 'Kartavaya_active_org';

/** The org this session is acting as, or null to let the server decide. */
export function getActiveOrg() {
  try {
    return localStorage.getItem(KEY) || null;
  } catch {
    // Private-mode Safari and friends. No selection is a valid state: the
    // server falls back to the user's oldest membership, which is exactly the
    // behaviour that existed before the switcher.
    return null;
  }
}

/**
 * Switch, and reload so nothing from the previous org survives the change.
 *
 * The reload is the point, not a shortcut. Every module page holds fetched
 * rows in component state; re-rendering them under a new org header without a
 * reload would leave one tenant's invoices on screen while the next request
 * returns another's.
 */
export function setActiveOrg(orgId) {
  try {
    if (orgId) localStorage.setItem(KEY, orgId);
    else localStorage.removeItem(KEY);
  } catch { /* selection simply will not persist; the reload still scopes it */ }
  window.location.assign('/today');
}

/** Forget the selection — on sign-out, so the next user does not inherit it. */
export function clearActiveOrg() {
  try { localStorage.removeItem(KEY); } catch { /* nothing to clear */ }
}
