/**
 * useTableView — sort, filter and pagination for a table, in one place.
 *
 * Owner, 2026-08-09: "all tables need sort, filter and pagination — 25 / 50 /
 * 100." Twenty-two tables in the build are hand-rolled `<table className="tbl">`
 * and each one solves this differently or not at all. Twenty-two
 * implementations is twenty-two chances to sort a rupee column as text.
 *
 * ── WHAT IT DOES NOT DO ─────────────────────────────────────────────────────
 *
 * It does not fetch. It takes the rows a page already has and derives a view of
 * them, so a table adopts it by wrapping its array and rendering `view.rows` —
 * no change to how the data arrives, and no server work required first.
 *
 * That has a limit worth stating plainly: **every list endpoint in this product
 * caps at 200 rows**, so this paginates what arrived, not what exists. Where the
 * server reports a bigger `total` than the array it sent, `truncated` says so
 * and the toolbar shows it. A pager that reads "1–25 of 200" over a true 510 is
 * a confident wrong answer, which is worse than no pager.
 *
 * ── SORTING KNOWS WHAT A COLUMN IS ──────────────────────────────────────────
 *
 * Numbers compare as numbers, dates as dates, everything else with
 * `localeCompare`. Sorting "₹1,20,000" as a string puts it below "₹9,000",
 * which looks like a working sort and is wrong every time.
 *
 * Sort is three-state — ascending, descending, none — matching `ui/Table`'s
 * `nextSort`. The third state matters: it returns to the order the server sent,
 * which is usually the only order that means anything (most recent first).
 */
import { useMemo, useState, useCallback, useEffect } from 'react';

export const PAGE_SIZES = [25, 50, 100];

/** Read a column out of a row: a key, or a function for a derived column. */
function read(row, col) {
  if (typeof col === 'function') return col(row);
  return row?.[col];
}

const NUMERIC = /^-?[\d.,\s₹%]+$/;

function compare(a, b) {
  if (a == null && b == null) return 0;
  if (a == null) return 1;   // blanks sort last in BOTH directions — see below
  if (b == null) return -1;

  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (typeof a === 'boolean' || typeof b === 'boolean') return (a ? 1 : 0) - (b ? 1 : 0);

  const sa = String(a).trim();
  const sb = String(b).trim();

  // A date column arrives as an ISO string far more often than as a Date.
  const da = Date.parse(sa);
  const db = Date.parse(sb);
  if (!Number.isNaN(da) && !Number.isNaN(db)
      && /^\d{4}-\d{2}-\d{2}/.test(sa) && /^\d{4}-\d{2}-\d{2}/.test(sb)) {
    return da - db;
  }

  if (NUMERIC.test(sa) && NUMERIC.test(sb) && /\d/.test(sa) && /\d/.test(sb)) {
    const na = parseFloat(sa.replace(/[^\d.-]/g, ''));
    const nb = parseFloat(sb.replace(/[^\d.-]/g, ''));
    if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;
  }
  return sa.localeCompare(sb, undefined, { numeric: true, sensitivity: 'base' });
}

/**
 * @param {Array}  rows            the rows the page already has
 * @param {object} [opts]
 * @param {Array}  [opts.searchKeys]  keys (or reader functions) the search box
 *                                    looks in. Omitted = search every value.
 * @param {object} [opts.columns]     {sortKey: key|fn} for columns whose sort
 *                                    value is not simply `row[sortKey]`.
 * @param {number} [opts.pageSize]    initial size; one of PAGE_SIZES.
 * @param {number} [opts.total]       the server's count, when it reports one.
 */
export default function useTableView(rows, opts = {}) {
  const {
    searchKeys = null, columns = {}, pageSize: initialSize = PAGE_SIZES[0], total = null,
  } = opts;

  const [query, setQuery] = useState('');
  const [sort, setSort] = useState(null);          // {key, dir} | null
  const [pageSize, setPageSize] = useState(initialSize);
  const [page, setPage] = useState(1);

  const all = useMemo(() => (Array.isArray(rows) ? rows : []), [rows]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return all;
    return all.filter((row) => {
      const values = searchKeys
        ? searchKeys.map(k => read(row, k))
        : Object.values(row || {});
      return values.some(v => v != null && String(v).toLowerCase().includes(q));
    });
  }, [all, query, searchKeys]);

  const sorted = useMemo(() => {
    if (!sort?.key) return filtered;
    const col = columns[sort.key] ?? sort.key;
    // A copy: sorting the caller's array in place mutates React state and the
    // re-render that follows shows the OLD order, because the reference did not
    // change. That bug is invisible until someone sorts twice.
    const out = [...filtered];
    out.sort((x, y) => compare(read(x, col), read(y, col)));
    if (sort.dir === 'descending') out.reverse();
    return out;
  }, [filtered, sort, columns]);

  const pageCount = Math.max(1, Math.ceil(sorted.length / pageSize));

  // Filtering down to fewer pages while sitting on page 9 shows an empty table
  // and no explanation. Clamp instead.
  useEffect(() => { if (page > pageCount) setPage(pageCount); }, [page, pageCount]);

  const start = (Math.min(page, pageCount) - 1) * pageSize;
  const visible = useMemo(
    () => sorted.slice(start, start + pageSize), [sorted, start, pageSize]);

  const onSearch = useCallback((v) => { setQuery(v); setPage(1); }, []);
  const onSort = useCallback((s) => { setSort(s); setPage(1); }, []);
  const onPageSize = useCallback((n) => { setPageSize(n); setPage(1); }, []);

  return {
    rows: visible,
    // Everything the toolbar needs, so a table passes ONE object to it.
    query, onSearch,
    sort, onSort,
    page, setPage, pageCount, pageSize, onPageSize,
    matched: sorted.length,
    loaded: all.length,
    from: sorted.length ? start + 1 : 0,
    to: Math.min(start + pageSize, sorted.length),
    //: The server sent fewer rows than it says exist. The pager can only page
    //: what arrived, and must say so rather than implying otherwise.
    truncated: total != null && total > all.length,
    total,
  };
}
