/**
 * The Created column, which is going on every record table in the product.
 *
 * It is written once precisely so these rules hold in all 59 places rather
 * than being re-decided in each of them. The two that matter most:
 *
 *   · A MISSING date is an em dash with a reason, never an empty cell. An
 *     empty cell in a date column reads as "created at no time", and the
 *     difference between "we do not show it" and "it is not there" is the
 *     distinction that sent an earlier audit down a wrong path.
 *   · A row with NO date sorts LAST in both directions. Treating a missing
 *     date as epoch zero would put it at the top of a "newest first" list —
 *     a lie the reader cannot see through.
 */
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { CreatedCell, CreatedHead, byCreated, CREATED_KEY } from '../CreatedColumn';
import { Table, TableHead, TableBody, Row } from '../Table';

global.IS_REACT_ACT_ENVIRONMENT = true;

let container;
let root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const render = (ui) => act(() => root.render(ui));

describe('the Created cell', () => {
  it('renders the date, and carries the full timestamp for the row you stop on', () => {
    render(
      <Table><TableBody><Row><CreatedCell value="2026-06-16T10:30:00Z" /></Row></TableBody></Table>,
    );
    const time = container.querySelector('time');
    expect(time).not.toBeNull();
    expect(time.textContent).toMatch(/16 Jun 2026/);
    // Machine-readable as well as human-readable: a screen reader should not
    // have to interpret "16 Jun".
    expect(time.getAttribute('datetime')).toBe(new Date('2026-06-16T10:30:00Z').toISOString());
    expect(time.getAttribute('title')).toBeTruthy();
  });

  it('says a missing date is missing, rather than leaving the cell blank', () => {
    render(<Table><TableBody><Row><CreatedCell value={null} /></Row></TableBody></Table>);
    const none = container.querySelector('.tbl__created-none');
    expect(none).not.toBeNull();
    expect(none.textContent).toBe('—');
    expect(none.getAttribute('title')).toMatch(/no creation date/i);
    expect(container.querySelector('time')).toBeNull();
  });

  it('does not pretend an unreadable value is a date', () => {
    render(<Table><TableBody><Row><CreatedCell value="not-a-date" /></Row></TableBody></Table>);
    expect(container.querySelector('time')).toBeNull();
    expect(container.querySelector('.tbl__created-none').getAttribute('title'))
      .toMatch(/unreadable/i);
  });
});

describe('the Created header', () => {
  it('is sortable on the one key every table shares', () => {
    let got = null;
    render(
      <Table>
        <TableHead><CreatedHead sort={null} onSort={(s) => { got = s; }} /></TableHead>
      </Table>,
    );
    const th = container.querySelector('th');
    expect(th.getAttribute('aria-sort')).toBe('none');

    act(() => th.querySelector('button').dispatchEvent(
      new MouseEvent('click', { bubbles: true })));
    expect(got).toEqual({ key: CREATED_KEY, dir: 'ascending' });
  });

  it('reports the direction it is currently sorted in', () => {
    render(
      <Table>
        <TableHead>
          <CreatedHead sort={{ key: CREATED_KEY, dir: 'descending' }} onSort={() => {}} />
        </TableHead>
      </Table>,
    );
    expect(container.querySelector('th').getAttribute('aria-sort')).toBe('descending');
  });
});

describe('sorting by creation', () => {
  const rows = [
    { id: 'b', created_at: '2026-06-16T00:00:00Z' },
    { id: 'a', created_at: '2026-08-01T00:00:00Z' },
    { id: 'c', created_at: '2025-01-09T00:00:00Z' },
  ];

  it('puts the newest first by default', () => {
    expect(byCreated(rows).map(r => r.id)).toEqual(['a', 'b', 'c']);
  });

  it('reverses on ascending', () => {
    expect(byCreated(rows, 'ascending').map(r => r.id)).toEqual(['c', 'b', 'a']);
  });

  it('sorts a row with NO date last in BOTH directions', () => {
    const withGap = [...rows, { id: 'z', created_at: null }];
    expect(byCreated(withGap, 'descending').map(r => r.id)).toEqual(['a', 'b', 'c', 'z']);
    // The point of the test: ascending must not float it to the top as if it
    // were the oldest record in the list.
    expect(byCreated(withGap, 'ascending').map(r => r.id)).toEqual(['c', 'b', 'a', 'z']);
  });

  it('does not mutate the caller\'s array', () => {
    const original = [...rows];
    byCreated(rows);
    expect(rows).toEqual(original);
  });
});
