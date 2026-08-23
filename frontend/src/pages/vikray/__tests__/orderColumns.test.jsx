/**
 * The order list is arrangeable — and the dashboard's copy is not.
 *
 * This list was the one table in Vikray with no column control. It was missed
 * because it is not a `<table>`: the row is a `<button>`, so there were no
 * table cells for the arrangement to attach to. These tests hold the shape of
 * the fix — the grid half of the same contract — and, just as importantly, hold
 * the line that the shared component does NOT drag the dashboard along with it.
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import OrderRows from '../OrderRows';
import { ORDER_COLUMNS } from '../_shared';

const ORDERS = [{
  id: 'o1', order_number: 'SO-2026-0309', contact_name: 'Wipro Consumer',
  total: 8850, status: 'draft', order_date: '2026-08-05',
}];

const head = (c) => c.querySelector('.vko__head');
const row = (c) => c.querySelector('.vko__row');

describe('Vikray · the order list arranges', () => {
  it('renders the shipped columns when no arrangement is passed', () => {
    const { container } = render(<OrderRows orders={ORDERS} onOpen={() => {}} />);
    for (const c of ORDER_COLUMNS) expect(screen.getByText(c.label)).toBeTruthy();
    // The row is still a real button — the reason this is a grid at all.
    expect(row(container).tagName).toBe('BUTTON');
  });

  it('gives the head and the rows the SAME template', () => {
    // A header whose columns can drift from its rows is worse than no header,
    // and once a person can reorder them the only defence is one source.
    const { container } = render(<OrderRows orders={ORDERS} onOpen={() => {}} />);
    expect(head(container).style.gridTemplateColumns)
      .toBe(row(container).style.gridTemplateColumns);
  });

  it('keeps the party column wider than an even share', () => {
    // MEASURED: at 1 : 1 in the dashboard's ~650px card, "Wipro Consumer"
    // wrapped onto two lines in a 54px row.
    const { container } = render(<OrderRows orders={ORDERS} onOpen={() => {}} />);
    expect(head(container).style.gridTemplateColumns).toContain('1.6fr');
  });

  it('follows a passed arrangement — order, hiding and width', () => {
    const cols = {
      columns: [
        { id: 'state', label: 'State', width: 106 },
        { id: 'order', label: 'Order', width: 92 },
      ],
      gridCells: (byId) => [byId.state, byId.order].map((n, i) =>
        React.cloneElement(n, { key: i })),
    };
    const { container } = render(<OrderRows orders={ORDERS} onOpen={() => {}} cols={cols} />);
    const labels = [...head(container).children].map(n => n.textContent);
    expect(labels).toEqual(['State', 'Order']);
    expect(head(container).style.gridTemplateColumns).toBe('106px 92px');
    // Value and Progress were hidden, so neither may render.
    expect(container.querySelector('.vko__val')).toBeNull();
    expect(container.querySelector('.vko__flow')).toBeNull();
  });

  it('places a MISSING cell as an empty track, never by shifting the next one', () => {
    // A grid fills tracks in order, so a skipped cell pulls every later cell
    // one column to the left, under the wrong heading.
    const cols = {
      columns: [{ id: 'nope', label: 'Nope' }, { id: 'order', label: 'Order' }],
      gridCells: (byId) => [byId.nope, byId.order].map((n, i) =>
        n == null ? <div key={i} /> : React.cloneElement(n, { key: i })),
    };
    const { container } = render(<OrderRows orders={ORDERS} onOpen={() => {}} cols={cols} />);
    const cells = [...row(container).children];
    expect(cells).toHaveLength(2);
    expect(cells[0].textContent).toBe('');
    expect(cells[1].textContent).toBe('SO-2026-0309');
  });
});
