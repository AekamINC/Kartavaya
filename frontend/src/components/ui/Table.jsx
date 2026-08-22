import React from 'react';

/**
 * Table · Head · Row · Cell · three-state sort · bulk bar
 * (02-common-components.md §2).
 *
 * Three details the hand-rolled tables in the build each get wrong differently:
 *
 *  · **Sort is three-state** — ascending → descending → none. A two-state sort
 *    gives a user no way back to the order the server sent, which is usually
 *    the only order that means anything (most recent first).
 *  · **`aria-sort` on the <th>**, not a coloured arrow only. A screen reader
 *    otherwise cannot tell a sorted column from an unsorted one.
 *  · **Numbers are mono with tabular-nums**, so a column of money lines up on
 *    the decimal instead of drifting by digit width.
 */
export function Table({ children, className = '', ...rest }) {
  return (
    <div className="tbl__wrap">
      <table className={`tbl ${className}`.trim()} {...rest}>{children}</table>
    </div>
  );
}

export const TableHead = ({ children }) => <thead><tr>{children}</tr></thead>;
export const TableBody = ({ children }) => <tbody>{children}</tbody>;

export function Row({ on, className = '', children, ...rest }) {
  return <tr className={[on ? 'on' : '', className].filter(Boolean).join(' ')} {...rest}>{children}</tr>;
}

export function Cell({ num, className = '', children, ...rest }) {
  return <td className={[num ? 'tbl__num' : '', className].filter(Boolean).join(' ')} {...rest}>{children}</td>;
}

/** asc → desc → none, then back to asc. */
export function nextSort(dir) {
  return dir === 'ascending' ? 'descending' : dir === 'descending' ? null : 'ascending';
}

export function HeadCell({ sortKey, sort, onSort, num, className = '', children }) {
  const cls = [num ? 'tbl__num' : '', className].filter(Boolean).join(' ');

  /* The unsortable guard runs BEFORE `dir` is derived, and that order is the
     whole fix. A plain `<HeadCell>Status</HeadCell>` passes neither `sortKey`
     nor `sort`, so the old `sort?.key === sortKey` compared undefined to
     undefined — TRUE — and then read `.dir` off undefined and threw. Every
     header in `AdminBillingPage` and `OrgTable`'s Status column is that shape,
     which crashed /admin and /admin/billing into the ErrorBoundary outright. */
  if (!sortKey || !onSort) return <th className={cls} scope="col">{children}</th>;

  const dir = sort?.key === sortKey ? sort.dir : null;

  return (
    <th className={cls} scope="col" aria-sort={dir || 'none'}>
      <button type="button" className="tbl__sort" aria-sort={dir || 'none'}
        onClick={() => { const d = nextSort(dir); onSort(d ? { key: sortKey, dir: d } : null); }}>
        {children}
        <svg className="pk-chev" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
    </th>
  );
}

/**
 * The bulk bar replaces the row list's own header while a selection is live.
 * It states the count first: "3 selected" before the verbs, so the user reads
 * what they are about to act on before what the action is.
 */
export function BulkBar({ count, children, onClear }) {
  if (!count) return null;
  return (
    <div className="tbl__bulk" role="status">
      <strong>{count} selected</strong>
      {children}
      {onClear && <button type="button" className="btn btn--text btn--sm" onClick={onClear}>Clear</button>}
    </div>
  );
}

export default Table;
