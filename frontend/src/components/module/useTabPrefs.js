import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, body } from '../../lib/api';
import { useToastMaybe } from '../ui/toast';
import { apiErrorText } from '../../lib/apiError';

/**
 * useTabPrefs — a person's own order for a module's tabs, and the tab the
 * module opens on (proposal 67 · demo 2).
 *
 * Storage is three layers, weakest first, and the hook is the only place the
 * three meet:
 *
 *   base       the page's own TABS array — the truth about what EXISTS.
 *   warm       localStorage `ktabs:<module>`, written on every server answer
 *              and every save. It exists so the FIRST paint after a reload is
 *              already in the user's order — without it the strip renders the
 *              shipped order for one frame and then jumps, on every module,
 *              every day.
 *   server     GET /v1/me/tab-prefs, fetched ONCE per app life (module-level
 *              cache below) and shared by all nine module pages. The server
 *              wins on arrival: the warm copy is a guess about what the server
 *              will say, never an authority. A module the server has no row
 *              for clears a stale warm entry rather than keeping it.
 *
 * The reconcile rules live in `reconcileTabPrefs` and are exported for the
 * unit tests, because they are the contract that keeps an old saved row from
 * breaking a page that has since changed its tabs:
 *
 *   · a saved id the page no longer ships is dropped;
 *   · a tab the page shipped AFTER the row was saved appends at the end —
 *     it never steals a slot the user arranged;
 *   · a saved default that no longer exists falls back to the page's own
 *     opening tab, never to undefined.
 */

/* One GET for the whole app. `cache` is the landed answer, `inflight` the
   promise while it is out — two module pages mounting in the same tick share
   the request rather than doubling it. A failed GET resets `inflight` so a
   later mount can retry; the warm copy carries the session until then.
   `epoch` guards the cache against a stale landing: reset() invalidates and
   re-fetches, and a GET issued before the invalidation must not write the
   pre-DELETE world back over the fresh answer. */
let cache = null;
let inflight = null;
let epoch = 0;

/** Test seam — module state would otherwise leak between test cases. */
export function _resetTabPrefsCache() { cache = null; inflight = null; epoch += 1; }

const warmKey = (moduleKey) => `ktabs:${moduleKey}`;

function readWarm(moduleKey) {
  try {
    const raw = localStorage.getItem(warmKey(moduleKey));
    return raw ? normalizeEntry(JSON.parse(raw)) : null;
  } catch { return null; }
}

function writeWarm(moduleKey, entry) {
  try {
    if (entry) localStorage.setItem(warmKey(moduleKey), JSON.stringify(entry));
    else localStorage.removeItem(warmKey(moduleKey));
  } catch { /* private mode — the server copy still follows the user */ }
}

/* Accepts both spellings (`default_tab` on the wire, `defaultTab` in JS) and
   refuses anything that is not a string list — a corrupt warm entry must read
   as "no preference", never throw on first paint. */
function normalizeEntry(v) {
  if (!v || typeof v !== 'object') return null;
  const order = Array.isArray(v.order) ? v.order.filter((x) => typeof x === 'string') : null;
  const raw = typeof v.default_tab === 'string' ? v.default_tab
    : typeof v.defaultTab === 'string' ? v.defaultTab : null;
  if (!order && !raw) return null;
  return { order, default_tab: raw };
}

/* `/v1/...` like every other call through the house api lib (its baseURL
   already carries `/api`, and `routers/tab_prefs.py` registers under
   `/api/v1`). A bare `/me/tab-prefs` is a 404 that looks like an empty
   answer. */
function parseAll(r) {
  const b = body(r);
  // `{modules: {...}}` and a bare `{module: entry}` map both read; the
  // route is another agent's file and this must not couple to its
  // envelope choice.
  const map = b && typeof b === 'object' && !Array.isArray(b)
    ? (b.modules && typeof b.modules === 'object' ? b.modules : b)
    : {};
  const out = {};
  for (const k of Object.keys(map)) {
    const e = normalizeEntry(map[k]);
    if (e) out[k] = e;
  }
  return out;
}

function fetchAll() {
  if (cache) return Promise.resolve(cache);
  if (!inflight) {
    const at = epoch;
    inflight = api.get('/v1/me/tab-prefs')
      .then((r) => {
        const parsed = parseAll(r);
        if (at === epoch) { cache = parsed; inflight = null; }
        return parsed;
      })
      .catch((err) => { if (at === epoch) inflight = null; throw err; });
  }
  return inflight;
}

/**
 * The reconcile contract, pure so the tests can state it without a DOM.
 *
 * `baseTabs` may be ids or `{id}` objects — the pages hold both shapes.
 * Returns `{ order, defaultTab }`; `defaultTab` is null when the saved one no
 * longer exists, and the HOOK (which knows the page's fallback) resolves it.
 */
export function reconcileTabPrefs(baseTabs, saved) {
  const base = (baseTabs || [])
    .map((t) => (typeof t === 'string' ? t : t?.id))
    .filter(Boolean);
  const known = new Set(base);
  const seen = new Set();
  const head = [];
  for (const id of (Array.isArray(saved?.order) ? saved.order : [])) {
    if (!known.has(id) || seen.has(id)) continue; // dropped tab, or a dupe
    seen.add(id);
    head.push(id);
  }
  // Ships-later rule: anything not in the saved order APPENDS, in base order.
  const order = head.concat(base.filter((id) => !seen.has(id)));
  const def = saved?.default_tab;
  return { order, defaultTab: def && known.has(def) ? def : null };
}

export default function useTabPrefs(moduleKey, baseTabs, { fallback } = {}) {
  // Provider-optional on purpose: prefs are an enhancement, and a module
  // page must render even where the toast chrome is absent (bare page specs).
  const { pushToast } = useToastMaybe();

  // First render: the in-memory cache when the GET has already landed (a
  // second module page in the same session), the warm copy otherwise.
  const [saved, setSaved] = useState(
    () => (cache ? (cache[moduleKey] ?? null) : readWarm(moduleKey)),
  );

  useEffect(() => {
    let on = true;
    fetchAll()
      .then((all) => {
        if (!on) return;
        const entry = all[moduleKey] ?? null;
        writeWarm(moduleKey, entry); // server wins — including "no row"
        setSaved(entry);
      })
      .catch(() => { /* warm copy carries the session; nothing to toast */ });
    return () => { on = false; };
  }, [moduleKey]);

  // Keyed on the id LIST, not the array reference — every page builds its
  // baseTabs inline, and Dristi's genuinely changes when the catalogue lands.
  const ids = (baseTabs || [])
    .map((t) => (typeof t === 'string' ? t : t?.id))
    .filter(Boolean);
  // U+0001 can appear in no tab id, so the key cannot collide the way a
  // bare join would ('ab','c' vs 'a','bc').
  const idsKey = ids.join('\u0001');
  const { order, defaultTab: savedDefault } = useMemo(
    () => reconcileTabPrefs(ids, saved),
    [idsKey, saved], // eslint-disable-line react-hooks/exhaustive-deps
  );

  // The page's own opening tab is the floor: a fallback that itself no longer
  // exists degrades to the first tab rather than to undefined.
  const fb = fallback && ids.includes(fallback) ? fallback : ids[0];
  const defaultTab = savedDefault ?? fb;

  // The page's shipped arrangement, as one value: what "Reset to standard"
  // in the customise sheet rearranges its DRAFT to. Draft-only by contract —
  // the server-row reset is `reset()` below, and the two must not be merged
  // back into one button (the sheet's Save is what writes).
  const standard = useMemo(
    () => ({ order: ids, defaultTab: fb }),
    [idsKey, fb], // eslint-disable-line react-hooks/exhaustive-deps
  );

  /**
   * PUT the arrangement. Personal always; `forTeam` ALSO writes the org
   * default row underneath (`/org/tab-prefs/<module>`), which is what "Make
   * this the team default" means — the admin keeps their own row too, so
   * unticking it later does not lose their personal order.
   *
   * The org row goes FIRST when both are written. The two writes can diverge,
   * and the divergence has to be one local state can tell the truth about:
   * personal-then-org left the server's personal row ahead of everything on
   * screen when the second PUT failed. Org-first means the personal row only
   * changes if its own PUT succeeds — and that success is applied locally
   * whatever the org half did, with the toast naming the half that failed.
   *
   * Returns false on any failure so the sheet can stay open over unsaved work.
   */
  const save = useCallback(async ({ order: nextOrder, defaultTab: nextDefault, forTeam = false }) => {
    const payload = { order: nextOrder, default_tab: nextDefault };
    let orgFailed = false;
    let orgDetail = null;
    if (forTeam) {
      try {
        await api.put(`/v1/org/tab-prefs/${moduleKey}`, payload);
      } catch (e) {
        orgFailed = true;
        orgDetail = e?.response?.data?.detail;
      }
    }
    try {
      await api.put(`/v1/me/tab-prefs/${moduleKey}`, payload);
    } catch (e) {
      // The personal row did not change on the server, so local state must
      // not change either — the toast still owes the org half's outcome.
      pushToast({
        type: 'error',
        title: !forTeam ? 'Could not save your tabs'
          : orgFailed ? 'Could not save — neither your tabs nor the team default'
            : 'Saved the team default, but not your own tabs',
        message: apiErrorText(e, 'Please try again.'),
      });
      return false;
    }
    // The personal write landed: apply it locally regardless of the org half.
    const entry = { order: [...nextOrder], default_tab: nextDefault };
    if (cache) cache[moduleKey] = entry;
    writeWarm(moduleKey, entry);
    setSaved(entry);
    if (orgFailed) {
      pushToast({
        type: 'error',
        title: 'Saved your tabs, but not the team default',
        message: orgDetail || 'Please try again.',
      });
      return false;
    }
    pushToast({
      type: 'success',
      title: forTeam
        ? 'Saved — and set as the team default'
        : 'Saved — your tabs, on every device',
    });
    return true;
  }, [moduleKey, pushToast]);

  /**
   * DELETE the personal row. What the user gets next is NOT necessarily the
   * shipped order: the server resolves personal → org default → shipped, so
   * removing the personal layer may surface an org default underneath. The
   * module cache is a picture of the pre-DELETE world, so it is invalidated
   * and the answer re-fetched rather than guessed at — and the toast only
   * says "standard" when the server actually resolved to nothing.
   */
  const reset = useCallback(async () => {
    try {
      await api.delete(`/v1/me/tab-prefs/${moduleKey}`);
    } catch (e) {
      pushToast({
        type: 'error',
        title: 'Could not reset your tabs',
        message: apiErrorText(e, 'Please try again.'),
      });
      return false;
    }
    epoch += 1;
    cache = null;
    inflight = null;
    let entry = null;
    try {
      const all = await fetchAll();
      entry = all[moduleKey] ?? null;
    } catch {
      // The DELETE landed; the re-read did not. The warm copy of the deleted
      // row still has to go — the next successful GET is the authority.
    }
    writeWarm(moduleKey, entry);
    setSaved(entry);
    pushToast({
      type: 'success',
      title: entry
        ? 'Back to your team’s default tabs'
        : 'Back to the standard tabs',
    });
    return true;
  }, [moduleKey, pushToast]);

  return { order, defaultTab, standard, save, reset };
}
