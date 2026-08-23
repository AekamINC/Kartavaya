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

/**
 * ColumnResizer — the divider a user drags to widen a column, and the reason
 * this is a `<button>` and not a bare `<div onMouseDown>`.
 *
 * Keyboard accessibility here was fixed BY HAND once already (5cb76413; React
 * Aria was rejected), so a control that only answers a pointer would be a
 * regression of a fix somebody paid for. A button is focusable and in the DOM
 * order it appears in — right after this column's sort button — so it does not
 * reorder the header's focus ring, and ←/→ resize by 16px, Shift by 4 for the
 * fine adjustment, Home resets the column to automatic width.
 *
 * `onCommit(width|null)` fires on pointer-up and on each key press, never on
 * every pointermove: the drag is local state (so the divider tracks the
 * pointer) and the PUT is one write per gesture.
 *
 * ── Why it also serves the div grid ────────────────────────────────────────
 *
 * `.k-trow` (the task list) has no `<th>`, and it had its own resize handle:
 * a bare `<span onPointerDown>`, which is not focusable and answers no key at
 * all. Giving it a second implementation would mean two answers to "how do I
 * widen a column with the keyboard", and only one of them the audited one. So
 * the ancestor lookup is `closest('th, [data-colhead]')` and the live preview
 * is a hook rather than a hardcoded write:
 *
 *   · a `<table>` column honours `th.style.width` directly, which is why the
 *     default preview writes it and nothing re-renders mid-drag;
 *   · a GRID column does not — the row owns `grid-template-columns`, so
 *     writing a width on the cell changes nothing visible. A grid host passes
 *     `onPreview` and rewrites the track list itself.
 *
 * Everything above the preview — the role, the label, ←/→/Home, the
 * stopPropagation that keeps a resize from also re-sorting — is shared, which
 * is the point.
 */
export function ColumnResizer({ label, width, onCommit, onPreview }) {
  const ref = React.useRef(null);
  const drag = React.useRef(null);

  const measured = () => {
    // The header cell this handle sits in — its rendered width is the starting
    // point when the column has no explicit one yet, so the first drag does not
    // jump the column to some invented default.
    const head = ref.current?.closest('th, [data-colhead]');
    return head ? Math.round(head.getBoundingClientRect().width) : 120;
  };

  const onPointerDown = (e) => {
    // Left button only, and never let the press reach the sort button beside
    // it — a resize that also re-sorts the table is a resize nobody attempted.
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    drag.current = { x: e.clientX, from: width ?? measured() };
    ref.current?.setPointerCapture?.(e.pointerId);
  };

  const onPointerMove = (e) => {
    if (!drag.current) return;
    const next = Math.max(48, drag.current.from + (e.clientX - drag.current.x));
    // Live feedback without a render of the whole table: the <th> is written
    // directly, and onCommit makes it real on release. A grid host has no <th>
    // to write, so it supplies its own preview and this write is skipped.
    if (onPreview) onPreview(next);
    else {
      const th = ref.current?.closest('th');
      if (th) th.style.width = `${next}px`;
    }
    drag.current.to = next;
  };

  const endDrag = (e) => {
    if (!drag.current) return;
    const { to } = drag.current;
    drag.current = null;
    ref.current?.releasePointerCapture?.(e.pointerId);
    // The preview is torn down BEFORE the commit either way: leaving it up
    // while the arrangement round-trips means a column that visibly springs
    // back for a frame when the real width lands on the same number.
    if (onPreview) onPreview(null);
    if (to != null) onCommit(to);
  };

  const onKeyDown = (e) => {
    const step = e.shiftKey ? 4 : 16;
    const from = width ?? measured();
    if (e.key === 'ArrowLeft') { e.preventDefault(); onCommit(Math.max(48, from - step)); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); onCommit(from + step); }
    else if (e.key === 'Home') { e.preventDefault(); onCommit(null); }
  };

  return (
    <button
      ref={ref}
      type="button"
      className="tbl__grip"
      // A separator with a value is what a screen reader can actually report a
      // width from; the role is on the button so the tab order is unchanged.
      role="separator"
      aria-orientation="vertical"
      aria-label={`Resize ${label}. Left and right arrows adjust the width, Home clears it.`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onKeyDown={onKeyDown}
      onClick={(e) => e.stopPropagation()}
    />
  );
}

/**
 * `width` and `onResize` are the arrangeable-columns half (inbox item 3) and
 * both are optional: every existing `<HeadCell>` call site keeps its props and
 * renders exactly what it rendered before. A header with `onResize` grows a
 * divider; one without does not.
 */
export function HeadCell({ sortKey, sort, onSort, num, width, onResize, className = '', children }) {
  const cls = [num ? 'tbl__num' : '', onResize ? 'tbl__th--rz' : '', className]
    .filter(Boolean).join(' ');
  // An explicit width on the <th> is all a `table-layout: auto` table needs to
  // honour it, and null means "whatever the table decides" — which is the
  // state Home returns a column to.
  const style = width ? { width: `${width}px` } : undefined;
  const grip = onResize
    ? <ColumnResizer label={typeof children === 'string' ? children : (sortKey || 'column')}
        width={width} onCommit={onResize} />
    : null;

  /* The unsortable guard runs BEFORE `dir` is derived, and that order is the
     whole fix. A plain `<HeadCell>Status</HeadCell>` passes neither `sortKey`
     nor `sort`, so the old `sort?.key === sortKey` compared undefined to
     undefined — TRUE — and then read `.dir` off undefined and threw. Every
     header in `AdminBillingPage` and `OrgTable`'s Status column is that shape,
     which crashed /admin and /admin/billing into the ErrorBoundary outright. */
  if (!sortKey || !onSort) {
    return <th className={cls} scope="col" style={style}>{children}{grip}</th>;
  }

  const dir = sort?.key === sortKey ? sort.dir : null;

  return (
    <th className={cls} scope="col" aria-sort={dir || 'none'} style={style}>
      <button type="button" className="tbl__sort" aria-sort={dir || 'none'}
        onClick={() => { const d = nextSort(dir); onSort(d ? { key: sortKey, dir: d } : null); }}>
        {children}
        <svg className="pk-chev" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {grip}
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
