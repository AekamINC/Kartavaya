/**
 * TableToolbar — the search box, the count and the pager that go with
 * `useTableView`.
 *
 * One component so twenty-two tables cannot disagree about what "3 of 40" means
 * or where the page size lives.
 *
 * ── THE COUNT IS THE POINT ──────────────────────────────────────────────────
 *
 * "Showing 1–25 of 40" and, when a search is on, what it was narrowed from. A
 * pager that shows only arrows leaves the reader unable to tell a filtered
 * table from an empty one.
 *
 * And when the SERVER truncated — every list endpoint in this product caps at
 * 200 — it says so. "1–25 of 200" over a true 510 is a confident wrong answer;
 * the measured case is the pipeline screen that reported 199 deals with no next
 * step against a real 510.
 */
import React from 'react';
import { PAGE_SIZES } from '../../hooks/useTableView';

export default function TableToolbar({
  view, label = 'rows', searchPlaceholder = 'Search…', children, showSearch = true,
}) {
  const {
    query, onSearch, from, to, matched, loaded,
    filters, filterOptions, picked, onFilter, clearFilters, activeFilters,
    page, setPage, pageCount, pageSize, onPageSize, truncated, total,
  } = view;

  return (
    <div className="tv">
      {showSearch && (
        <label className="tv__search">
          <span className="k-sr-only">Search {label}</span>
          <input
            className="inp tv__input"
            type="search"
            value={query}
            placeholder={searchPlaceholder}
            onChange={e => onSearch(e.target.value)}
          />
        </label>
      )}

      {/* ONE DROPDOWN PER FILTERABLE COLUMN, and its options are the values
          actually present in the data — never a hardcoded list, which goes
          stale the day a status is added. A column whose values are all blank
          offers nothing rather than an empty select. */}
      {(filters || []).map(f => {
        const opts = filterOptions?.[f.key] || [];
        if (!opts.length) return null;
        return (
          <label key={f.key} className="tv__f">
            <span className="k-sr-only">Filter by {f.label}</span>
            <select
              className={`inp tv__sel${picked?.[f.key] ? ' is-on' : ''}`}
              value={picked?.[f.key] ?? ''}
              onChange={e => onFilter(f.key, e.target.value)}
            >
              <option value="">{f.label}: all</option>
              {opts.map(o => (
                <option key={o.value} value={o.value}>{o.value} ({o.count})</option>
              ))}
            </select>
          </label>
        );
      })}

      {activeFilters > 0 && (
        <button type="button" className="k-btn k-btn--ghost" onClick={clearFilters}>
          Clear
        </button>
      )}

      {children}

      <span className="tv__count" role="status">
        {matched === 0
          ? `No ${label}`
          : `${from}–${to} of ${matched}`}
        {query && matched !== loaded && ` (filtered from ${loaded})`}
      </span>

      <span className="tv__sp" />

      <label className="tv__size">
        <span className="tv__lbl">Per page</span>
        <select
          className="inp tv__sel"
          value={pageSize}
          onChange={e => onPageSize(Number(e.target.value))}
        >
          {PAGE_SIZES.map(n => <option key={n} value={n}>{n}</option>)}
        </select>
      </label>

      <span className="tv__pager">
        <button
          type="button" className="k-btn k-btn--ghost"
          disabled={page <= 1} onClick={() => setPage(page - 1)}
          aria-label="Previous page"
        >‹</button>
        <span className="tv__pg">{page} / {pageCount}</span>
        <button
          type="button" className="k-btn k-btn--ghost"
          disabled={page >= pageCount} onClick={() => setPage(page + 1)}
          aria-label="Next page"
        >›</button>
      </span>

      {truncated && (
        <span className="tv__trunc" role="status">
          Showing the first {loaded} of {total} — narrow the search to reach the rest.
        </span>
      )}
    </div>
  );
}
