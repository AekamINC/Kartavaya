/**
 * useColumnPrefs — the column ORDER, VISIBILITY and WIDTH a person chose for
 * one table, persisted, applied on load, and resettable. Inbox item 3.
 *
 * Verified by absence 2026-08-22: nothing in this tree persisted any of the
 * three. A user who hid a column, dragged one left, or widened a divider lost
 * it on the next refresh — on every table, every day.
 *
 * ── THE SHAPE, AND WHY IT IS A SIBLING OF useTableView ──────────────────────
 *
 * `useTableView` derives WHICH ROWS a table shows. This derives WHICH COLUMNS,
 * in what order, at what width. A table opts in by DECLARING its columns once
 * and rendering from the result — not by keeping arrangement state of its own,
 * which is the fifty-copies outcome this exists to prevent:
 *
 *     const cols = useColumnPrefs('graha.contacts', CONTACT_COLUMNS);
 *     …
 *     <tr>{cols.columns.map(c => <HeadCell key={c.id} …>{c.label}</HeadCell>)}</tr>
 *     …
 *     <tr>{cols.cells({ name: <td>…</td>, email: <td>…</td> })}</tr>
 *
 * `cells()` is what makes the opt-in mechanical rather than a rewrite: a page
 * keeps writing one `<td>` per column, keyed by id, and the hook puts them in
 * the arranged order and drops the hidden ones. A cell whose id is not in the
 * arrangement is not rendered — which is the client half of the compatibility
 * promise (see reconcileColumnPrefs).
 *
 * ── STORAGE IS THREE LAYERS, weakest first — useTabPrefs' design ────────────
 *
 *   base    the page's own column array — the truth about what EXISTS, and the
 *           floor. Frontend CODE, never a row, so a default that improves is
 *           not frozen at whatever version an org signed up under.
 *   warm    localStorage `kcols:<tableKey>`, written on every server answer and
 *           every save, so the FIRST paint after a reload is already in the
 *           user's arrangement. Without it every table renders shipped order
 *           for one frame and then jumps.
 *   server  GET /v1/me/column-prefs, fetched ONCE per app life (module cache
 *           below) and shared by every table on the page — a page with four
 *           tables makes one request, not four. The server wins on arrival: the
 *           warm copy is a guess about what the server will say, never an
 *           authority, and a table the server has no row for CLEARS its stale
 *           warm entry rather than keeping it.
 *
 * The server resolves personal > org default > nothing before it answers
 * (routers/column_prefs.py), so this hook never sees two candidate rows and
 * cannot disagree with any other surface about which one won.
 */
import { cloneElement, createElement, isValidElement, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, body } from '../lib/api';
import { useToastMaybe } from '../components/ui/toast';

/* One GET for the whole app. `cache` is the landed answer, `inflight` the
   promise while it is out — four tables mounting in the same tick share the
   request rather than quadrupling it. A failed GET resets `inflight` so a later
   mount can retry; the warm copy carries the session until then. `epoch` guards
   against a stale landing: reset() invalidates and re-fetches, and a GET issued
   before the invalidation must not write the pre-DELETE world back over the
   fresh answer. (useTabPrefs learned all four of these the hard way.) */
let cache = null;
let inflight = null;
let epoch = 0;

/** Test seam — module state would otherwise leak between test cases. */
export function _resetColumnPrefsCache() { cache = null; inflight = null; epoch += 1; }

const warmKey = (tableKey) => `kcols:${tableKey}`;

/** The router's bounds, restated so the UI cannot offer a width the API will
 *  refuse. Keep in step with routers/column_prefs.py MIN_WIDTH/MAX_WIDTH. */
export const MIN_WIDTH = 48;
export const MAX_WIDTH = 2000;
/** The server's array cap (routers/column_prefs.py MAX_COLUMNS). Restated so
 *  the carry-forward below cannot build a body the API will refuse. */
export const MAX_COLUMNS = 64;

export const clampWidth = (w) => {
  const n = Math.round(Number(w));
  if (!Number.isFinite(n)) return null;
  return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, n));
};

/* A corrupt warm entry must read as "no preference", never throw on first
   paint. Anything that is not a list of {id} is discarded whole. */
function normalizeEntry(v) {
  const raw = Array.isArray(v) ? v : (v && typeof v === 'object' ? v.columns : null);
  if (!Array.isArray(raw)) return null;
  const columns = [];
  for (const c of raw) {
    if (!c || typeof c !== 'object' || typeof c.id !== 'string') continue;
    const width = typeof c.width === 'number' && Number.isFinite(c.width)
      ? clampWidth(c.width) : null;
    columns.push({ id: c.id, hidden: Boolean(c.hidden), width });
  }
  return columns.length ? { columns } : null;
}

function readWarm(tableKey) {
  try {
    const raw = localStorage.getItem(warmKey(tableKey));
    return raw ? normalizeEntry(JSON.parse(raw)) : null;
  } catch { return null; }
}

function writeWarm(tableKey, entry) {
  try {
    if (entry) localStorage.setItem(warmKey(tableKey), JSON.stringify(entry));
    else localStorage.removeItem(warmKey(tableKey));
  } catch { /* private mode — the server copy still follows the user */ }
}

/* `/v1/…` like every other call through the house api lib (its baseURL already
   carries `/api`, and routers/column_prefs.py registers under `/api/v1`). A
   bare `/me/column-prefs` is a 404 that looks like an empty answer. */
function parseAll(r) {
  const b = body(r);
  const map = b && typeof b === 'object' && !Array.isArray(b)
    ? (b.tables && typeof b.tables === 'object' ? b.tables : b)
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
    inflight = api.get('/v1/me/column-prefs')
      .then((r) => {
        const parsed = parseAll(r);
        if (at === epoch) { cache = parsed; inflight = null; }
        return parsed;
      })
      .catch((err) => { if (at === epoch) inflight = null; throw err; });
  }
  return inflight;
}

/** A page's column declaration, normalised. Accepts `'name'` or
 *  `{id, label, …}`; everything except `id` is the page's business and travels
 *  through untouched. */
function normalizeBase(baseColumns) {
  const out = [];
  const seen = new Set();
  for (const c of baseColumns || []) {
    const col = typeof c === 'string' ? { id: c, label: c } : c;
    if (!col?.id || seen.has(col.id)) continue;
    seen.add(col.id);
    out.push({ ...col, label: col.label ?? col.id });
  }
  return out;
}

/**
 * The reconcile contract, pure so the tests can state it without a DOM. It is
 * the whole compatibility promise, and the reason this API validates a grammar
 * rather than a per-table catalogue of legal column names:
 *
 *   · a saved id the page no longer ships is DROPPED — it renders as nothing,
 *     never as an error, so deleting a column cannot break a saved
 *     arrangement;
 *   · a column the page shipped AFTER the row was saved APPENDS at the end, in
 *     base order, and is visible — it never steals a slot the user arranged,
 *     and it never silently fails to appear;
 *   · a saved width outside the bounds is clamped, not discarded;
 *   · a column declared `defaultHidden` ships hidden and stays hidden until a
 *     saved row says otherwise. This is NOT a hole in the rule above it: the
 *     ships-later promise is that a column nobody has decided about must not
 *     silently fail to appear, and `defaultHidden` is the page deciding, in
 *     code, out loud — the same kind of assertion as `fixed`. The task list is
 *     why it exists: it shipped seven columns of which five are on by default,
 *     and without this, adopting the shared hook would have turned Category
 *     and Last Updated on for every user in the product overnight. A column
 *     with `fixed` wins, since a page cannot both pin a column and hide it;
 *     and if EVERY column were marked, the flag is ignored whole rather than
 *     rendering a table with no columns.
 *   · a column declared `fixed` can never be hidden, whatever the row says —
 *     that is the page asserting a column is load-bearing (the identity
 *     column, the row's actions), and a stale row must not override it;
 *   · if the result would hide EVERYTHING, the arrangement is refused whole and
 *     the base list stands. The server refuses the same case on write; this is
 *     the reader's half, for a row written before that rule or by hand.
 *
 * Returns the full ordered list including hidden ones — the customise sheet
 * needs the hidden columns to offer them back.
 */
/** The page's shipped arrangement: base order, base widths, and `defaultHidden`
 *  honoured — unless honouring it would leave nothing on screen, in which case
 *  the flag is dropped whole rather than half-applied. Used both as the
 *  no-row answer and as what "Reset to standard" rearranges a draft to, so the
 *  two cannot disagree about what "standard" means. */
function shipped(base) {
  const out = base.map((c) => ({
    ...c,
    hidden: Boolean(c.defaultHidden) && !c.fixed,
    width: c.width ?? null,
  }));
  return out.every((c) => c.hidden) ? out.map((c) => ({ ...c, hidden: false })) : out;
}

export function reconcileColumnPrefs(baseColumns, saved, { visibility } = {}) {
  /* `visibility: 'external'` — the arrangement owns ORDER and WIDTH, and
     something else owns which columns exist at all.

     `views/TableView.jsx` is why. Its custom-field columns are chosen in
     `BoardToolbar`, and that control is SHARED with the Kanban board: hiding a
     field there hides it in both places. Letting this hook hide columns too
     would fork one control into two, so that hiding a field on the table
     stopped hiding it on the board — the user would have two half-working
     switches for one idea and no way to tell which one they were looking at.

     It is a mode on the hook rather than a filter at the call site because a
     call site that merely ignored `hidden` would still SHOW the tick boxes,
     still let a user hide the last visible column, and still write `hidden:
     true` into a row that nothing reads. Expressing it here means the sheet
     can drop the checkbox column, and the write path never records a decision
     the product does not honour.

     The page then passes only the columns it wants rendered, in base order,
     and the existing grammar does the rest: a field that goes away is dropped,
     a field that comes back appends. */
  const external = visibility === 'external';
  const base = normalizeBase(baseColumns);
  const byId = new Map(base.map((c) => [c.id, c]));
  const seen = new Set();
  const head = [];
  for (const s of (Array.isArray(saved?.columns) ? saved.columns : [])) {
    const col = byId.get(s?.id);
    if (!col || seen.has(col.id)) continue;   // dropped column, or a dupe
    seen.add(col.id);
    head.push({
      ...col,
      hidden: external ? false : (col.fixed ? false : Boolean(s.hidden)),
      width: s.width == null ? (col.width ?? null) : clampWidth(s.width),
    });
  }
  // Ships-later rule: anything not in the saved arrangement APPENDS, visible —
  // unless the page marked it `defaultHidden`, which is the page deciding
  // rather than nobody deciding. See the contract above.
  const tail = (external ? base.map((c) => ({ ...c, hidden: false, width: c.width ?? null }))
    : shipped(base)).filter((c) => !seen.has(c.id));
  const all = head.concat(tail);
  if (!all.length || all.every((c) => c.hidden)) {
    return external
      ? base.map((c) => ({ ...c, hidden: false, width: c.width ?? null }))
      : shipped(base);
  }
  return all;
}

/** What goes on the wire: the three facts, and nothing the page put on its own
 *  column objects. Sending `label` or `render` would store the frontend's own
 *  code in a database row and freeze it there. */
export const toWire = (all) => (all || []).map((c) => ({
  id: c.id, hidden: Boolean(c.hidden), width: c.width ?? null,
}));

/**
 * @param {string} tableKey   'module.table', e.g. 'graha.contacts'. It is the
 *                            row's identity for ever — renaming it abandons
 *                            every arrangement saved under the old name.
 * @param {Array}  baseColumns  `[{id, label, num?, fixed?, width?, …}]`, the
 *                            page's declaration of what exists.
 * @param {object} [options]
 * @param {'external'} [options.visibility]  Order and width are the
 *   arrangement's; SOMETHING ELSE decides which columns exist. See
 *   `reconcileColumnPrefs` for the argument. The sheet drops its tick boxes
 *   and nothing ever writes `hidden: true`.
 * @param {() => (Record<string, number>|null)} [options.seedWidths]  A
 *   one-time migration from wherever this table used to keep its widths. See
 *   the seeding effect below — this is how a user's existing hand-dragged
 *   widths reach the server instead of being thrown away.
 * @param {() => void} [options.onSeeded]  Called once, after the seed PUT has
 *   actually landed, so the caller can retire the old store.
 */
export default function useColumnPrefs(tableKey, baseColumns, options = {}) {
  const { visibility, seedWidths, onSeeded } = options;
  const external = visibility === 'external';
  // Provider-optional on purpose: an arrangement is an enhancement, and a
  // table must render where the toast chrome is absent (bare page specs).
  const { pushToast } = useToastMaybe();

  const [saved, setSaved] = useState(
    () => (cache ? (cache[tableKey] ?? null) : readWarm(tableKey)),
  );
  /* Whether the server has ANSWERED, which is not the same question as whether
     `saved` is null — it is null before the answer and also when the answer is
     "no row". Only the migration below needs to tell those apart, and telling
     them apart is the difference between seeding an empty table and
     overwriting a real arrangement with a stale local one on every load. */
  const [settled, setSettled] = useState(() => Boolean(cache));

  useEffect(() => {
    let on = true;
    fetchAll()
      .then((all) => {
        if (!on) return;
        const entry = all[tableKey] ?? null;
        writeWarm(tableKey, entry);   // server wins — including "no row"
        setSaved(entry);
        setSettled(true);
      })
      .catch(() => { /* warm copy carries the session; nothing to toast */ });
    return () => { on = false; };
  }, [tableKey]);

  const base = useMemo(() => normalizeBase(baseColumns), [baseColumns]);
  // Keyed on the id LIST, not the array reference — every page builds its
  // columns inline, and a fresh array each render would re-reconcile for ever.
  // U+0001 can appear in no column id, so the key cannot collide the way a
  // bare join would ('ab','c' vs 'a','bc').
  const idsKey = base.map((c) => c.id).join('');

  const all = useMemo(
    () => reconcileColumnPrefs(base, saved, { visibility }),
    [idsKey, saved, visibility], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const columns = useMemo(() => all.filter((c) => !c.hidden), [all]);
  const visible = useMemo(() => new Set(columns.map((c) => c.id)), [columns]);

  /** The page's shipped arrangement, as one value: what "Reset to standard" in
   *  the sheet rearranges its DRAFT to. Draft-only by contract — the
   *  server-row reset is `reset()` below, and the two must not be merged into
   *  one button (the sheet's Save is what writes). */
  const standard = useMemo(
    () => (external ? base.map((c) => ({ ...c, hidden: false, width: c.width ?? null }))
      : shipped(base)),
    [idsKey, external], // eslint-disable-line react-hooks/exhaustive-deps
  );

  /**
   * CARRY WHAT WE DO NOT CURRENTLY RENDER, on every write.
   *
   * `reconcileColumnPrefs` drops a saved id the page no longer ships — that is
   * the READ contract and it is right: an unknown column renders as nothing
   * rather than as an error. Applying the same rule on WRITE is a different
   * thing entirely, and it is destructive.
   *
   * `views/TableView.jsx` is the case that forced this. Its base list is the
   * custom fields `BoardToolbar` is currently showing. Hide one there, then
   * drag any other column: the width PUT would have been built from `all`,
   * which no longer contains the hidden field, so its saved POSITION would be
   * silently erased — and turning the field back on would return it to the end
   * of the table rather than where the user had put it. The user would have
   * lost arrangement work by using an unrelated control.
   *
   * So a saved entry whose id is not in the page's current base list rides
   * along untouched. It is capped at MAX_COLUMNS because the server refuses a
   * longer array, and the columns actually on screen are the ones that must
   * survive that cap.
   */
  const carry = useCallback((next) => {
    const known = new Set(base.map((c) => c.id));
    const wire = toWire(next);
    const room = MAX_COLUMNS - wire.length;
    if (room <= 0) return wire;
    const orphans = (Array.isArray(saved?.columns) ? saved.columns : [])
      .filter((c) => c && typeof c.id === 'string' && !known.has(c.id)
        && !wire.some((w) => w.id === c.id))
      .slice(0, room)
      .map((c) => ({ id: c.id, hidden: Boolean(c.hidden), width: c.width ?? null }));
    return wire.concat(orphans);
  }, [idsKey, saved]); // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * Render a row's cells in the arranged order, dropping the hidden ones.
   *
   * `byId` is `{columnId: node}`. A node for a column that is not in the
   * arrangement is DROPPED rather than appended, and a column with no node
   * renders an empty `<td>` — because a table row must have the same number of
   * cells as the header, and a missing cell shifts every column after it.
   *
   * `createElement`/`cloneElement` rather than JSX because this is a `.js`
   * hook next to `useTableView`, and the key is CLONED onto the page's node
   * rather than asked of the page: every call site would otherwise have to
   * repeat a key it already told us, on a list it does not control the order
   * of.
   */
  const cells = useCallback((byId) => columns.map((c) => {
    const node = byId?.[c.id];
    if (node === undefined || node === null) return createElement('td', { key: c.id });
    if (isValidElement(node)) return cloneElement(node, { key: c.id });
    // A bare string/number for a column is a convenience worth allowing; it
    // still has to become a cell, or the row loses a column.
    return createElement('td', { key: c.id }, node);
  }), [columns]);

  /**
   * ── THE DIV-GRID HALF ──────────────────────────────────────────────────
   *
   * `cells()` above cannot serve `.k-trow` (the task list) and it is not a
   * near miss: it *manufactures* `<td>` elements. A column with no node
   * becomes `createElement('td')` and a bare string becomes `<td>{s}</td>`,
   * because in a `<table>` a row must have exactly as many cells as the
   * header or every column after the gap is drawn under the wrong heading.
   * Put either of those inside a `<div class="k-trow">` and you get a `<td>`
   * with no table ancestor — which the HTML parser keeps, React renders, and
   * CSS grid then lays out as a track nobody declared. So the shape is the
   * same and the ELEMENT is not, and that is the whole reason this is a
   * second function rather than a `tag` option: a caller that got the option
   * wrong would produce exactly that invisible breakage.
   *
   * The second, larger difference: a `<table>` distributes its own widths, so
   * `cells()` never has to know one. A grid does not — the ROW owns the track
   * list, so a per-column width has to be collected into one
   * `grid-template-columns` string and put on the row AND on the head, or the
   * two slide apart by a column. That is `gridTemplate`.
   *
   * What is deliberately NOT here is a second preferences model. Both halves
   * read the same `columns`, resolved from the same server rows under the
   * same table key; only the rendering differs.
   */

  /**
   * The row's track list, in the arranged order. A column with no width takes
   * `minmax(0, 1fr)` rather than `auto`: `auto` sizes to CONTENT, so one long
   * task title would widen its track and shift every other column on that row
   * out of line with the header, which is the one thing a grid "table" must
   * never do. `minmax(0, …)` — not `1fr` alone — because a grid track's
   * default `min-width: auto` refuses to shrink below its content, which is
   * how an un-truncatable cell overflows a row that already says `overflow:
   * hidden`.
   */
  const gridTemplate = useMemo(
    () => columns.map((c) => (c.width ? `${c.width}px` : 'minmax(0, 1fr)')).join(' '),
    [columns],
  );

  /**
   * Render a div-grid row's cells in the arranged order, dropping hidden ones.
   *
   * Same `{columnId: node}` contract as `cells()`, and the same key-cloning
   * rule. A missing column yields an empty `<div>` — a grid places children
   * into tracks IN ORDER, so a skipped cell pulls every later cell one track
   * to the left, under the wrong heading, exactly as it would in a `<table>`.
   * `className` defaults to the page's cell class so the common case is one
   * node per column and nothing else.
   */
  const gridCells = useCallback((byId, { className = 'k-trow__cell' } = {}) => columns.map((c) => {
    const node = byId?.[c.id];
    if (node === undefined || node === null) {
      return createElement('div', { key: c.id, className });
    }
    if (isValidElement(node)) return cloneElement(node, { key: c.id });
    return createElement('div', { key: c.id, className }, node);
  }), [columns]);

  const put = useCallback(async (next, { forTeam = false } = {}) => {
    const payload = { columns: carry(next) };
    let orgFailed = false;
    let orgDetail = null;
    // The org row goes FIRST when both are written — useTabPrefs' rule, and
    // for its reason: personal-then-org left the server's personal row ahead
    // of everything on screen when the second PUT failed. Org-first means the
    // personal row only changes if its own PUT succeeds.
    if (forTeam) {
      try {
        await api.put(`/v1/org/column-prefs/${tableKey}`, payload);
      } catch (e) {
        orgFailed = true;
        orgDetail = e?.response?.data?.detail;
      }
    }
    try {
      await api.put(`/v1/me/column-prefs/${tableKey}`, payload);
    } catch (e) {
      pushToast({
        type: 'error',
        title: !forTeam ? 'Could not save your columns'
          : orgFailed ? 'Could not save — neither your columns nor the team default'
            : 'Saved the team default, but not your own columns',
        message: e?.response?.data?.detail || 'Please try again.',
      });
      return false;
    }
    const entry = { columns: payload.columns };
    if (cache) cache[tableKey] = entry;
    writeWarm(tableKey, entry);
    setSaved(entry);
    if (orgFailed) {
      pushToast({
        type: 'error',
        title: 'Saved your columns, but not the team default',
        message: orgDetail || 'Please try again.',
      });
      return false;
    }
    pushToast({
      type: 'success',
      title: forTeam
        ? 'Saved — and set as the team default'
        : 'Saved — your columns, on every device',
    });
    return true;
  }, [tableKey, pushToast, carry]);

  /**
   * ── THE MIGRATION ────────────────────────────────────────────────────────
   *
   * Moving a table's widths to the server is only an improvement if the widths
   * the user ALREADY dragged come with them. Otherwise the first thing that
   * happens after shipping is that somebody opens a board they spent ten
   * minutes sizing and finds it reset — the product throwing away work
   * somebody did by hand, which is worse than never having shipped the
   * feature. So: when the server answers "no row for this table" and the
   * caller can produce the widths from wherever it used to keep them, they are
   * written UP rather than dropped.
   *
   * Four things this has to get right, and each is a line below:
   *
   *  · ONCE. `seeded` is a ref keyed on the table key, so a re-render, a
   *    parent remount or a second table on the same key does not re-PUT.
   *  · ONLY on a genuine absence. `saved` is `null` both before the GET has
   *    landed and after it landed empty, so the effect waits for `settled` —
   *    seeding on the pre-answer null would overwrite a real server row with
   *    localStorage every time the page loaded.
   *  · ONLY forward. `onSeeded` fires AFTER the PUT resolves, never before, so
   *    a caller that retires its old store on that callback cannot lose the
   *    widths to a failed request. A failure leaves the old store intact and
   *    the next load tries again.
   *  · In BASE ORDER. There is no saved order to preserve — that is the whole
   *    premise — so the arrangement written is the page's own order carrying
   *    the migrated widths, which is exactly what the user was looking at.
   */
  const seeded = useRef(null);
  useEffect(() => {
    if (!seedWidths || !settled || saved || seeded.current === tableKey) return;
    const widths = seedWidths();
    if (!widths || typeof widths !== 'object') return;
    const next = base
      .map((c) => ({ id: c.id, hidden: false, width: clampWidth(widths[c.id]) }))
      .filter((c) => c.width != null);
    if (!next.length) return;
    seeded.current = tableKey;
    // The FULL arrangement, base order, only the migrated widths set. A column
    // the old store had no width for keeps `null` — "whatever the table
    // decides" — rather than inheriting some other column's number.
    const payload = {
      columns: base.map((c) => ({
        id: c.id, hidden: false, width: clampWidth(widths[c.id]) ?? null,
      })).slice(0, MAX_COLUMNS),
    };
    api.put(`/v1/me/column-prefs/${tableKey}`, payload)
      .then(() => {
        const entry = { columns: payload.columns };
        if (cache) cache[tableKey] = entry;
        writeWarm(tableKey, entry);
        setSaved(entry);
        onSeeded?.();
      })
      .catch(() => {
        // Silent, and the old store is deliberately NOT retired: the next load
        // will find the same absence and try again. A toast here would tell a
        // user about a migration they never asked for and cannot act on.
        seeded.current = null;
      });
    // `base` moves by reference every render; `idsKey` is its identity.
    // eslint-disable-line react-hooks/exhaustive-deps
  }, [tableKey, settled, saved, idsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  /** The sheet's Save. Same signature as useTabPrefs' `save`. */
  const save = useCallback(
    ({ columns: next, forTeam = false }) => put(next, { forTeam }),
    [put],
  );

  /**
   * A dragged divider. It is one column's width and nothing else, so it saves
   * silently — a toast per drag would fire five times while the user settles on
   * a width. It still goes through the same PUT: a width that lives only in
   * React state is the bug this whole file exists to close.
   */
  const setWidth = useCallback((id, width) => {
    const next = all.map((c) => (
      c.id === id ? { ...c, width: width == null ? null : clampWidth(width) } : c));
    const payload = { columns: carry(next) };
    const entry = { columns: payload.columns };
    // Optimistic: the divider must track the pointer, not the round trip.
    if (cache) cache[tableKey] = entry;
    writeWarm(tableKey, entry);
    setSaved(entry);
    return api.put(`/v1/me/column-prefs/${tableKey}`, payload).catch(() => {
      // Silent by design. The width is applied locally and warm-stored; the
      // next successful save or GET is the authority. Toasting here would
      // interrupt a drag over a preference nobody would call a failure.
    });
  }, [all, tableKey, carry]);

  /**
   * DELETE the personal row. What the user gets next is NOT necessarily the
   * shipped columns: the server resolves personal → org default → shipped, so
   * removing the personal layer may surface an org default underneath. The
   * module cache is a picture of the pre-DELETE world, so it is invalidated and
   * the answer re-fetched rather than guessed at — and the toast only says
   * "standard" when the server actually resolved to nothing.
   */
  const reset = useCallback(async () => {
    try {
      await api.delete(`/v1/me/column-prefs/${tableKey}`);
    } catch (e) {
      pushToast({
        type: 'error',
        title: 'Could not reset your columns',
        message: e?.response?.data?.detail || 'Please try again.',
      });
      return false;
    }
    epoch += 1;
    cache = null;
    inflight = null;
    let entry = null;
    try {
      const fresh = await fetchAll();
      entry = fresh[tableKey] ?? null;
    } catch {
      // The DELETE landed; the re-read did not. The warm copy of the deleted
      // row still has to go — the next successful GET is the authority.
    }
    writeWarm(tableKey, entry);
    setSaved(entry);
    pushToast({
      type: 'success',
      title: entry
        ? 'Back to your team’s column layout'
        : 'Back to the standard columns',
    });
    return true;
  }, [tableKey, pushToast]);

  return {
    /** Visible columns, in order, each with its `width` (or null). */
    columns,
    /** Every column including hidden ones — what the customise sheet edits. */
    all,
    /** `shows('email')` — for a page that cannot express a cell as a node. */
    shows: useCallback((id) => visible.has(id), [visible]),
    cells,
    /** The div-grid pair — `.k-trow`'s half of the same contract. */
    gridCells,
    gridTemplate,
    /** False when something else decides which columns exist — the sheet drops
     *  its tick boxes rather than offering a switch that does nothing. */
    ownsVisibility: !external,
    standard,
    save,
    setWidth,
    reset,
    tableKey,
  };
}
