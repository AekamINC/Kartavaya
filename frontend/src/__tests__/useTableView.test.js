/**
 * useTableView — the shared sort/filter/pagination behind every table.
 *
 * Sorting is where a table goes wrong SILENTLY: "₹1,20,000" below "₹9,000"
 * looks like a working sort and is wrong every time. Most of these pin that.
 */
import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import useTableView, { PAGE_SIZES } from '../hooks/useTableView';

const ROWS = [
  { name: 'Zeta Ltd',  amount: '₹9,000',     when: '2026-03-01', n: 3 },
  { name: 'alpha Pvt', amount: '₹1,20,000',  when: '2026-01-15', n: 1 },
  { name: 'Mid Co',    amount: '₹45,000',    when: '2026-07-30', n: 2 },
];

const sortBy = (view, key, dir) => act(() => view.current.onSort({ key, dir }));

describe('page sizes', () => {
  it('are the three the owner asked for', () => {
    expect(PAGE_SIZES).toEqual([25, 50, 100]);
  });
});

describe('sorting', () => {
  it('sorts a rupee column as a NUMBER, not as text', () => {
    const { result } = renderHook(() => useTableView(ROWS));
    sortBy(result, 'amount', 'ascending');
    expect(result.current.rows.map(r => r.amount))
      .toEqual(['₹9,000', '₹45,000', '₹1,20,000']);
  });

  it('sorts an ISO date column as a date', () => {
    const { result } = renderHook(() => useTableView(ROWS));
    sortBy(result, 'when', 'ascending');
    expect(result.current.rows.map(r => r.when))
      .toEqual(['2026-01-15', '2026-03-01', '2026-07-30']);
  });

  it('sorts text case-insensitively', () => {
    const { result } = renderHook(() => useTableView(ROWS));
    sortBy(result, 'name', 'ascending');
    expect(result.current.rows[0].name).toBe('alpha Pvt');
  });

  it('returns to the server order on the third state', () => {
    // The whole reason sort is three-state: the order the server sent is
    // usually the only one that means anything (most recent first).
    const { result } = renderHook(() => useTableView(ROWS));
    sortBy(result, 'name', 'ascending');
    act(() => result.current.onSort(null));
    expect(result.current.rows.map(r => r.n)).toEqual([3, 1, 2]);
  });

  it('does not mutate the array it was given', () => {
    // Sorting in place mutates React state, and the re-render shows the OLD
    // order because the reference did not change. Invisible until you sort twice.
    const rows = [...ROWS];
    const { result } = renderHook(() => useTableView(rows));
    sortBy(result, 'name', 'ascending');
    expect(rows.map(r => r.n)).toEqual([3, 1, 2]);
  });

  it('sends blanks last in both directions', () => {
    const withGap = [...ROWS, { name: 'No amount', amount: null, when: null, n: 4 }];
    const { result } = renderHook(() => useTableView(withGap));
    sortBy(result, 'amount', 'ascending');
    expect(result.current.rows[3].n).toBe(4);
  });

  it('reads a derived column through a function', () => {
    const { result } = renderHook(() =>
      useTableView(ROWS, { columns: { total: r => r.n * 10 } }));
    sortBy(result, 'total', 'descending');
    expect(result.current.rows[0].n).toBe(3);
  });
});

describe('filtering', () => {
  it('matches any value when no keys are named', () => {
    const { result } = renderHook(() => useTableView(ROWS));
    act(() => result.current.onSearch('mid'));
    expect(result.current.rows).toHaveLength(1);
    expect(result.current.matched).toBe(1);
    expect(result.current.loaded).toBe(3);
  });

  it('only looks in the named keys', () => {
    const { result } = renderHook(() => useTableView(ROWS, { searchKeys: ['name'] }));
    act(() => result.current.onSearch('2026-01-15'));
    expect(result.current.rows).toHaveLength(0);
  });
});

describe('pagination', () => {
  const many = Array.from({ length: 60 }, (_, i) => ({ name: `Row ${i}`, i }));

  it('shows one page and reports the range', () => {
    const { result } = renderHook(() => useTableView(many));
    expect(result.current.rows).toHaveLength(25);
    expect(result.current.from).toBe(1);
    expect(result.current.to).toBe(25);
    expect(result.current.pageCount).toBe(3);
  });

  it('clamps the page when a filter shortens the list', () => {
    // Filtering down to one page while sitting on page 3 shows an empty table
    // and no explanation.
    const { result } = renderHook(() => useTableView(many));
    act(() => result.current.setPage(3));
    act(() => result.current.onSearch('Row 7'));
    expect(result.current.page).toBe(1);
    expect(result.current.rows.length).toBeGreaterThan(0);
  });

  it('goes back to page one when the size changes', () => {
    const { result } = renderHook(() => useTableView(many));
    act(() => result.current.setPage(3));
    act(() => result.current.onPageSize(100));
    expect(result.current.page).toBe(1);
    expect(result.current.rows).toHaveLength(60);
  });

  it('reports zero honestly rather than showing 1–0', () => {
    const { result } = renderHook(() => useTableView([]));
    expect(result.current.from).toBe(0);
    expect(result.current.matched).toBe(0);
    expect(result.current.pageCount).toBe(1);
  });
});

describe('per-column filters', () => {
  const opts = { filters: [{ key: 'status', label: 'Status' }] };
  const rows = [
    { name: 'a', status: 'Paid' }, { name: 'b', status: 'Draft' },
    { name: 'c', status: 'Paid' }, { name: 'd', status: '' },
  ];

  it('takes its options FROM THE DATA, with counts', () => {
    // The owner's words: "options driven by that table's data". A hardcoded
    // list goes stale the day a status is added and offers options that match
    // nothing.
    const { result } = renderHook(() => useTableView(rows, opts));
    expect(result.current.filterOptions.status)
      .toEqual([{ value: 'Draft', count: 1 }, { value: 'Paid', count: 2 }]);
  });

  it('ignores blanks rather than offering an empty option', () => {
    const { result } = renderHook(() => useTableView(rows, opts));
    expect(result.current.filterOptions.status.map(o => o.value)).not.toContain('');
  });

  it('offers nothing for a column where every value is blank', () => {
    const blank = [{ status: '' }, { status: null }];
    const { result } = renderHook(() => useTableView(blank, opts));
    expect(result.current.filterOptions.status).toEqual([]);
  });

  it('filters the rows and the count together', () => {
    const { result } = renderHook(() => useTableView(rows, opts));
    act(() => result.current.onFilter('status', 'Paid'));
    expect(result.current.rows).toHaveLength(2);
    expect(result.current.matched).toBe(2);
  });

  it('combines with the search box rather than replacing it', () => {
    const { result } = renderHook(() => useTableView(rows, opts));
    act(() => result.current.onFilter('status', 'Paid'));
    act(() => result.current.onSearch('c'));
    expect(result.current.rows.map(r => r.name)).toEqual(['c']);
  });

  it('counts what is active, and clears both', () => {
    const { result } = renderHook(() => useTableView(rows, opts));
    act(() => result.current.onFilter('status', 'Paid'));
    act(() => result.current.onSearch('c'));
    expect(result.current.activeFilters).toBe(2);
    act(() => result.current.clearFilters());
    expect(result.current.activeFilters).toBe(0);
    expect(result.current.rows).toHaveLength(4);
  });
});

describe('the server truncated', () => {
  it('says so when it sent fewer rows than it counted', () => {
    // Every list endpoint here caps at 200. "1–25 of 200" over a true 510 is a
    // confident wrong answer — the measured case was the pipeline screen
    // reporting 199 deals with no next step against a real 510.
    const rows = Array.from({ length: 200 }, (_, i) => ({ i }));
    const { result } = renderHook(() => useTableView(rows, { total: 510 }));
    expect(result.current.truncated).toBe(true);
  });

  it('does not cry truncation when everything arrived', () => {
    const { result } = renderHook(() => useTableView(ROWS, { total: 3 }));
    expect(result.current.truncated).toBe(false);
  });
});
