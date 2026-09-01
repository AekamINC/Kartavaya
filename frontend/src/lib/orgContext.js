/**
 * orgContext.js — which organisation this browser TAB is acting as.
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
 * ── THE TAB IS THE SESSION, NOT THE BROWSER ─────────────────────────────────
 * This used to read `localStorage` alone, which is shared by every tab of the
 * origin, and that made the reload above a guarantee for exactly one tab. Two
 * tabs, two organisations:
 *
 *     tab A  open on org X, showing X's invoices
 *     tab B  switch to org Y  ->  localStorage = Y, tab B reloads (correct)
 *     tab A  next request     ->  carries Y's header, under X's screen
 *
 * Nothing errors. The server is asked a legitimate question about an org the
 * caller really does belong to, and answers it. Tab A then draws the other
 * company's rows into a page whose heading, filters and totals still say X, and
 * a write from that screen lands in Y. The reload made tab B safe and left the
 * tab the operator was not looking at holding a lie.
 *
 * So the selection now lives in `sessionStorage`, which is per-tab, and is
 * PINNED on first read: a tab decides its org once, at load, and no later
 * switch anywhere else can move it. `localStorage` keeps only the last choice,
 * demoted to one job — the default a brand-new tab starts from.
 *
 * That gives the three cases the behaviour each should have:
 *
 *   · a tab opened from a link in the app  — the browser copies sessionStorage
 *     into the new context, so it opens in the SAME org as the tab it came
 *     from, which is what "open this record in a new tab" has to mean;
 *   · a tab opened cold (typed, restored, a second window) — no sessionStorage,
 *     so it inherits `localStorage`, the org last chosen;
 *   · a switch — pins this tab and updates the default, and leaves every other
 *     tab exactly where its operator left it.
 *
 * The middle case is also why the copy not happening is harmless: a browser
 * that declines to clone sessionStorage falls into it, and the fallback is the
 * same org. Both branches land in the right place.
 *
 * `''` is stored, not removed, for "this tab is pinned to the server's default"
 * — a key that is absent means NOT YET PINNED, and the two must not collide.
 *
 * ── Safety ──────────────────────────────────────────────────────────────────
 * The header is not authority. `middleware/org_resolver.get_org_id` validates
 * it on every request and answers 403 for an org the caller does not belong to,
 * 404 for one that is inactive. A tampered value widens nothing; it only
 * changes which of the caller's own organisations is being read.
 */

const KEY = 'Kartavaya_active_org';

/* Private-mode Safari and friends throw on the storages rather than returning
   null, and a switcher that throws would take the whole shell down with it. */
function read(store, key) {
  try { return store.getItem(key); } catch { return null; }
}
function write(store, key, value) {
  try { store.setItem(key, value); return true; } catch { return false; }
}
function drop(store, key) {
  try { store.removeItem(key); } catch { /* nothing to clear */ }
}

/**
 * The org THIS TAB is acting as, or null to let the server decide.
 *
 * Pins on first call. Everything downstream — `api.js` on every request, the
 * switcher's own initial render — goes through here, so the pin is taken at
 * the first request the tab makes and holds for the tab's lifetime.
 */
export function getActiveOrg() {
  const pinned = read(sessionStorage, KEY);
  if (pinned !== null) return pinned || null;

  // First read in this tab: adopt the last choice and pin it, so that a switch
  // made in another tab from here on cannot move this one.
  const inherited = read(localStorage, KEY) || '';
  write(sessionStorage, KEY, inherited);
  return inherited || null;
}

/**
 * Switch, and reload so nothing from the previous org survives the change.
 *
 * The reload is the point, not a shortcut. Every module page holds fetched
 * rows in component state; re-rendering them under a new org header without a
 * reload would leave one tenant's invoices on screen while the next request
 * returns another's.
 *
 * Both storages are written: `sessionStorage` because this tab is switching
 * now, `localStorage` because the next tab opened cold should start here too.
 */
export function setActiveOrg(orgId) {
  write(sessionStorage, KEY, orgId || '');
  if (orgId) write(localStorage, KEY, orgId);
  else drop(localStorage, KEY);
  window.location.assign('/today');
}

/**
 * Forget the selection — on sign-out, so the next user does not inherit it.
 *
 * BOTH storages, and the session one is the one that matters: it outlives a
 * sign-out within the same tab, which is precisely where the next user is.
 */
export function clearActiveOrg() {
  drop(sessionStorage, KEY);
  drop(localStorage, KEY);
}
