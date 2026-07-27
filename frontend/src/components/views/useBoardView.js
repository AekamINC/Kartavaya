import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import { applyFilters, filterFields } from './FilterBuilder';

/**
 * useBoardView — the state one board toolbar owns, for all seven views.
 *
 * `04 §2` gives the toolbar `view switch · filter · group · fields` and says in
 * the same breath that *"Board, Table, Calendar, Timeline, Workload and
 * Priority all need view-switch, filter and group"*. What the build had instead
 * was search, filter, grouping and field visibility living **inside
 * `TableView`**, which had three consequences:
 *
 *  · Five of the seven views could not be searched or filtered at all — Kanban
 *    included, which is the default view and the one that spec names first.
 *  · `TableView` rendered its own `ViewToolbar` inside a page that had already
 *    rendered one, so switching to Table produced two stacked `.vtb` bars and
 *    moved every control into a different row. That is the exact drift
 *    `ViewToolbar` was extracted to end.
 *  · Nothing was shareable. `IxViews 10.4`: *"Filters serialise into the URL so
 *    a filtered view is a shareable link"*; `10.1`: *"Sort and widths persist
 *    per view in the URL and per user."*
 *
 * So search, filter, group and sort live in the **URL**, and field visibility
 * lives in `localStorage`. That split is the one 10.1 draws: a filter is part of
 * what you are looking at and belongs in a link you can paste to a colleague; a
 * hidden column is a preference about how *you* read a table and would be noise
 * in everybody else's URL. Column widths stay in `localStorage` for the same
 * reason — "per user" in 10.1, and a pixel width in a query string is not a
 * thing anyone wants to send.
 *
 * Every write is `{ replace: true }`. A history entry per keystroke turns Back
 * into a character-by-character undo of the search box.
 */

export const GROUPS = [
  { id: 'none', label: 'No grouping' },
  { id: 'column', label: 'Column' },
  { id: 'status', label: 'Status' },
  { id: 'priority', label: 'Priority' },
];

const SORT_DIRS = new Set(['ascending', 'descending']);

/**
 * `field:op:value`, tilde-separated. A `~` or `:` inside a typed value would
 * otherwise split the clause, so the value is component-encoded on the way out
 * and decoded on the way in; the field and operator are enum ids and cannot
 * contain either.
 *
 * `~` has to be escaped BY HAND. It is one of the unreserved marks
 * `encodeURIComponent` deliberately leaves alone (`- _ . ! ~ * ' ( )`), so a
 * title filter typed as `a~b` came back out of the URL as two half-clauses and
 * the second was silently dropped. `%7E` decodes to `~` on the way back, so
 * only the separator changes.
 */
function encodeClauses(clauses) {
  const usable = (clauses || []).filter(c => c && c.field && c.op);
  if (!usable.length) return '';
  return usable
    .map(c => `${c.field}:${c.op}:${encodeURIComponent(c.value ?? '').replace(/~/g, '%7E')}`)
    .join('~');
}

function decodeClauses(raw) {
  if (!raw) return [];
  return raw.split('~').map((part, i) => {
    const [field, op, ...rest] = part.split(':');
    if (!field || !op) return null;
    let value = '';
    try { value = decodeURIComponent(rest.join(':')); }
    catch { value = rest.join(':'); }   // a hand-edited URL is not a crash
    // The id is presentational — `FilterBuilder` keys rows by it. Deriving it
    // from the index keeps it stable across re-parses of the same URL, which a
    // `Date.now()` id would not be: every keystroke would remount the row and
    // drop focus out of the value input.
    return { id: `f${i}`, field, op, value };
  }).filter(Boolean);
}

function decodeSort(raw) {
  if (!raw) return null;
  const [key, dir] = raw.split(':');
  if (!key || !SORT_DIRS.has(dir)) return null;
  return { key, dir };
}

export default function useBoardView({ tasks, columns, fieldDefs, boardKey }) {
  const [params, setParams] = useSearchParams();

  const search  = params.get('q') || '';
  const groupBy = params.get('group') || 'none';
  const sortRaw = params.get('sort');
  const filtRaw = params.get('filter');

  const sort = useMemo(() => decodeSort(sortRaw), [sortRaw]);

  /**
   * A `column_id` clause names a column of ONE board. `/boards` switches
   * project without leaving the route, so a filter set on Quarterly GST would
   * survive into Diwali campaign, match nothing there, and present an empty
   * board with a chip naming a column that project does not have. The same
   * applies to a pasted link opened against the wrong board.
   *
   * Clauses whose column no longer exists are dropped from what the UI reads.
   * The guard on `columns.length` matters: the list is empty while the board is
   * loading, and pruning then would discard a perfectly good filter on every
   * page load. The URL is left alone — a stale param that stops applying is
   * recoverable; rewriting someone's link out from under them is not.
   */
  const clauses = useMemo(() => {
    const all = decodeClauses(filtRaw);
    if (!columns?.length) return all;
    const known = new Set(columns.map(c => c.column_id));
    return all.filter(c => c.field !== 'column_id' || !c.value || known.has(c.value));
  }, [filtRaw, columns]);

  const write = useCallback((patch) => {
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      Object.entries(patch).forEach(([k, v]) => {
        if (v == null || v === '' || v === 'none') next.delete(k);
        else next.set(k, v);
      });
      return next;
    }, { replace: true });
  }, [setParams]);

  const setSearch  = useCallback(v => write({ q: v }), [write]);
  const setGroupBy = useCallback(v => write({ group: v }), [write]);
  const setClauses = useCallback(v => write({ filter: encodeClauses(v) }), [write]);
  const setSort    = useCallback(
    s => write({ sort: s ? `${s.key}:${s.dir}` : '' }),
    [write],
  );
  // One write, so "Clear all" from an empty state is one history-replacing
  // update rather than two that race each other through `setParams`.
  const clearFilters = useCallback(() => write({ q: '', filter: '' }), [write]);

  // ── Field visibility: per user, per board, not in the URL ─────────────────
  const defs   = useMemo(() => fieldDefs || [], [fieldDefs]);
  const visKey = `kv.table.fields.${boardKey || 'default'}`;
  const [hidden, setHidden] = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem(visKey) || '[]')); }
    catch { return new Set(); }
  });
  // Reconciled by id, never rebuilt: the old effect keyed on `fieldDefs.length`
  // and reset the whole list, so adding one custom field un-hid every column
  // the user had hidden.
  useEffect(() => {
    try { localStorage.setItem(visKey, JSON.stringify([...hidden])); }
    catch { /* quota or private mode — visibility is not worth failing over */ }
  }, [hidden, visKey]);

  const toggleField = useCallback((fieldId) => {
    setHidden(prev => {
      const next = new Set(prev);
      if (next.has(fieldId)) next.delete(fieldId);
      else next.add(fieldId);
      return next;
    });
  }, []);

  const shownFields = useMemo(
    () => defs.filter(f => !hidden.has(f.field_id)),
    [defs, hidden],
  );

  // ── The filtered set every view renders ──────────────────────────────────
  const fields = useMemo(() => filterFields(columns), [columns]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const base = q
      ? (tasks || []).filter(t => (t.title || '').toLowerCase().includes(q))
      : (tasks || []);
    return applyFilters(base, clauses, fields);
  }, [tasks, search, clauses, fields]);

  return {
    search, setSearch,
    groupBy, setGroupBy,
    clauses, setClauses,
    sort, setSort,
    clearFilters,
    fields, filtered,
    defs, hidden, toggleField, shownFields,
    // True when the view is showing less than everything, which is the one
    // thing an empty state has to know: "no tasks match" and "no tasks" are
    // different sentences.
    isFiltered: Boolean(search.trim()) || clauses.length > 0,
  };
}
