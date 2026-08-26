/**
 * useDockData — the six reads behind the corner dock, and the one rule about
 * when they happen.
 *
 * ── NOTHING IS PERSISTED. ANYWHERE. ─────────────────────────────────────────
 *
 * There is no localStorage key, no sessionStorage key, no "seen", no "unread",
 * no dismissed-set and no server-side counter in this file or anywhere else in
 * the dock. That is the condition the count on the pill was accepted on: a
 * number that never remembers what you have already looked at cannot become a
 * second inbox, because there is nothing for it to nag you about. It is a
 * signpost — "there are nine things on this page" — and it says the same nine
 * every time until the catalogue itself changes.
 *
 * Grep this directory for `localStorage` and the result is empty. It is meant
 * to stay empty.
 *
 * ── When the fetch happens, and why not on every navigation ─────────────────
 *
 * The pill carries a number, so something has to be known before the dock is
 * opened. But six requests on every page load, for every user, on every
 * navigation, is the shape of the bug `OnboardingChecklist` shipped and had to
 * have measured out of it (209 requests in 8 seconds — see that file's header).
 * So:
 *
 *   ONCE PER SESSION, AT IDLE.  The catalogue is org-wide and route-independent
 *     — the same forty templates, the same fourteen metric declarations, the
 *     same rules, whatever page you are on. It is fetched once, on the first
 *     mount, inside `requestIdleCallback` so it never competes with the page
 *     the user actually asked for, and held in module-level memory.
 *
 *   NOTHING ON NAVIGATION.  Moving from /ganit to /vetana re-FILTERS what is
 *     already in memory. Zero requests.
 *
 *   EVERY OPEN, AGAIN.  Opening the dock refetches. "Computed fresh on open"
 *     is taken literally: the list you are looking at was fetched because you
 *     opened it, not read out of a cache from twenty minutes ago. The cached
 *     copy renders immediately underneath so the panel never opens empty.
 *
 * Module-level memory, not a React ref: two shells are never mounted at once,
 * but a remount (an ErrorBoundary reset, a theme change that reparents) must
 * not re-run six requests. It dies on page reload, which is the only lifetime
 * anything in this dock is allowed to have.
 *
 * ── The four sources, and what each one refuses ─────────────────────────────
 *
 *   /v1/hub/org/skills        the org's ACTIVE grants — the only skills that
 *                             can actually be run. 403 for a caller with no
 *                             Sahayak grant (`_hub_gate`).
 *   /v1/hub/skills/templates  `SELECT *`, so `module` and `skill_type` are on
 *                             the wire today. This is also the fallback that
 *                             makes the dock work BEFORE the two columns are
 *                             added to the org-skills SELECT — see `joinModule`.
 *   /v1/hub/skills/capabilities  what this server can actually run, so a skill
 *                             naming a withdrawn handler is greyed with the
 *                             reason instead of failing on click.
 *   /v1/analytics/catalogue   already entitlement-filtered SERVER-side
 *                             (`_reachable`), so the dock shows a metric only
 *                             if the caller may read it. Nothing to filter here.
 *   /v1/niyam/rules           the org's live rules. `require_org_role`, so a
 *                             plain member gets 403 — reported as restricted,
 *                             never as "you have no automations".
 *   /v1/niyam/templates       the starter rules, same gate.
 *   /v1/statute/due           the dated law in force TODAY, every authority,
 *                             with each obligation's next occurrence already
 *                             projected server-side. Not org-scoped — the law
 *                             is the same for every tenant — and fetched
 *                             UNFILTERED for the same reason the other five
 *                             are: the whole calendar is fifteen dated rows,
 *                             and filtering it per page in memory keeps
 *                             navigation at zero requests.
 *
 * A 403 is NOT an error here. It is an answer — "not for you" — and the panes
 * say that sentence rather than showing an empty list, because an empty list
 * and a refusal look identical and mean opposite things.
 *
 * A statute failure is a THIRD thing again, and it is kept separate from both.
 * "The calendar did not answer" and "nothing statutory falls on this page" are
 * opposite claims about the law, and a due-dates tab that shows the second when
 * the first is true has told a firm it has no filing to make.
 */
import { useCallback, useEffect, useState } from 'react';
import { api, rows as unwrapRows } from '../../../lib/api';
import { DUE_SOURCE } from '../../../lib/routeModules';

/** The empty answer. `null` lists mean NOT LOADED; `[]` means loaded and empty. */
const BLANK = {
  orgSkills: null,
  templates: null,
  caps: null,
  metrics: null,
  rules: null,
  ruleTemplates: null,
  due: null,
  dueAsOf: '',
  dueUnavailable: false,
  skillsRestricted: false,
  niyamRestricted: false,
  failed: '',
};

/**
 * Session memory. Not storage — a module-level variable, gone on reload.
 * Holds the last successful catalogue so a remount and a navigation cost
 * nothing, and so the panel never opens on a spinner.
 */
let cached = null;
let inflight = null;

/** 403 is an answer, not a failure. Everything else is a failure. */
const refused = (err) => err?.response?.status === 403;

async function getList(path) {
  const r = await api.get(path);
  return unwrapRows({ data: r.data });
}

/**
 * One pass over all seven. `Promise.allSettled`, never `all`: the Niyam pair is
 * refused for most callers and the metrics call is refused for none, and one
 * refusal must not blank the other three tabs.
 */
async function fetchAll() {
  const [orgSkills, templates, caps, metrics, rules, ruleTemplates, due] =
    await Promise.allSettled([
      getList('/v1/hub/org/skills'),
      getList('/v1/hub/skills/templates'),
      api.get('/v1/hub/skills/capabilities').then(r => r.data),
      api.get('/v1/analytics/catalogue').then(r => r.data?.metrics || []),
      api.get('/v1/niyam/rules').then(r => r.data?.rules || []),
      api.get('/v1/niyam/templates').then(r => r.data?.templates || []),
      // The envelope, not just the list: `as_of` is the date every countdown
      // in the answer was measured from and the pane prints it. Taking only
      // `data` here would leave the pane with a number of days and no anchor.
      //
      // `DUE_SOURCE` stays the single switch it was written to be. Emptied, it
      // does not fall through to a request for `undefined` — it reports the
      // calendar as unreachable, which is the same true sentence the pane says
      // when the route itself is down.
      DUE_SOURCE
        ? api.get(DUE_SOURCE).then(r => r.data)
        : Promise.reject(new Error('DUE_SOURCE is empty')),
    ]);

  const val = s => (s.status === 'fulfilled' ? s.value : null);
  const denied = s => s.status === 'rejected' && refused(s.reason);

  // A failure that is NOT a refusal is worth one sentence, once. The dock does
  // not toast — a corner popover raising a toast for a background fetch is
  // noise on a surface the user did not ask for.
  const broke = [orgSkills, templates, metrics].some(
    s => s.status === 'rejected' && !refused(s.reason));

  const dueBody = val(due);

  return {
    orgSkills: val(orgSkills),
    templates: val(templates),
    caps: val(caps),
    metrics: val(metrics),
    rules: val(rules),
    ruleTemplates: val(ruleTemplates),
    due: Array.isArray(dueBody?.data) ? dueBody.data : null,
    dueAsOf: dueBody?.as_of || '',
    // Kept out of `failed` on purpose. A statute read that did not answer is
    // not "some of this did not load" — it is the one tab whose empty state
    // would otherwise read as "you have no filings due", which is a claim
    // about a firm's compliance that this dock must never make by accident.
    dueUnavailable: due.status === 'rejected',
    skillsRestricted: denied(orgSkills) || denied(templates),
    niyamRestricted: denied(rules) && denied(ruleTemplates),
    failed: broke ? 'Some of this did not load. Nothing was changed.' : '',
  };
}

/**
 * Share one in-flight request between every caller.
 *
 * The dock mounts once, so this looks like belt and braces — until the user
 * opens the panel while the idle fetch is still running, which is exactly when
 * it happens, because opening it is what makes them wait.
 */
function load() {
  if (!inflight) {
    inflight = fetchAll()
      .then((data) => { cached = data; return data; })
      .finally(() => { inflight = null; });
  }
  return inflight;
}

/**
 * `requestIdleCallback` where it exists, a short timeout where it does not.
 * Safari has shipped rIC since 16.4 and this degrades to the same behaviour
 * one frame later, which is well inside the time it takes to open a dock.
 */
function whenIdle(fn) {
  if (typeof window === 'undefined') return () => {};
  if (typeof window.requestIdleCallback === 'function') {
    const id = window.requestIdleCallback(fn, { timeout: 4000 });
    return () => window.cancelIdleCallback?.(id);
  }
  const id = setTimeout(fn, 1200);
  return () => clearTimeout(id);
}

export default function useDockData() {
  const [data, setData] = useState(cached || BLANK);
  const [loading, setLoading] = useState(!cached);

  // The idle first read. Runs once per session because `cached` survives the
  // unmount; a remount with a warm cache does nothing at all.
  useEffect(() => {
    if (cached) return undefined;
    let live = true;
    const cancel = whenIdle(() => {
      load().then((d) => { if (live) { setData(d); setLoading(false); } })
            .catch(() => { if (live) setLoading(false); });
    });
    return () => { live = false; cancel(); };
  }, []);

  /**
   * Fresh on open. Shows the cached copy while it runs — `loading` stays false
   * when there is something to render, so the panel never flashes a skeleton
   * over a list it already has.
   */
  const refresh = useCallback(() => {
    if (!cached) setLoading(true);
    return load()
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return { ...data, loading, refresh };
}

/**
 * TEST SEAM. Vitest holds one module instance across the cases in a file, so
 * the cache above would leak the first test's fixtures into the second.
 * Exported rather than reached for through internals, and used by nothing else.
 */
export function __resetDockCache() {
  cached = null;
  inflight = null;
}
