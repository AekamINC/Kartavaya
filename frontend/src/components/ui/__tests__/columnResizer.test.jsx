/**
 * ColumnResizer — the divider on a table header.
 *
 * Keyboard accessibility in this build was fixed BY HAND (5cb76413; React Aria
 * was rejected), so a resize control that only answers a pointer would undo a
 * fix somebody already paid for. jsdom has no layout and no real pointer
 * capture, so what is pinned here is the CONTRACT: it is a focusable button in
 * the header's own DOM order, arrows commit a width, Home clears it, and a
 * press on it never reaches the sort button beside it.
 *
 * Rendered with react-dom directly — @testing-library/react is installed but
 * its @testing-library/dom peer is not (see moduleTabs.test.jsx).
 */
import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { HeadCell } from '../Table';

let container = null;
let root = null;

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function head(props = {}) {
  act(() => root.render(
    <table><thead><tr>
      <HeadCell {...props}>Email</HeadCell>
    </tr></thead></table>,
  ));
  return {
    th: container.querySelector('th'),
    grip: container.querySelector('.tbl__grip'),
    sort: container.querySelector('.tbl__sort'),
  };
}

const key = (el, k, init = {}) => act(() => {
  el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, ...init }));
});

describe('HeadCell without onResize', () => {
  it('renders exactly what it always rendered', () => {
    // Every one of the ~96 tables that has not opted in must be untouched.
    const { th, grip } = head({});
    expect(grip).toBe(null);
    expect(th.className).toBe('');
    expect(th.getAttribute('style')).toBe(null);
    expect(th.textContent).toBe('Email');
  });

  it('is still safe with neither sortKey nor onSort', () => {
    // The crash this component was fixed for: `sort?.key === sortKey` compared
    // undefined to undefined, then read `.dir` off undefined.
    expect(() => head({})).not.toThrow();
  });
});

describe('HeadCell with onResize', () => {
  it('grows a divider and marks the cell as the positioning context', () => {
    const { th, grip } = head({ onResize: vi.fn() });
    expect(grip).not.toBe(null);
    expect(grip.tagName).toBe('BUTTON');
    expect(th.className).toContain('tbl__th--rz');
  });

  it('applies an explicit width, and none when the width is null', () => {
    expect(head({ onResize: vi.fn(), width: 240 }).th.style.width).toBe('240px');
    expect(head({ onResize: vi.fn(), width: null }).th.style.width).toBe('');
  });

  it('is focusable and announces what the arrows do', () => {
    const { grip } = head({ onResize: vi.fn() });
    // A <button>, so it is in the tab order at the position it appears in —
    // right after this column's sort control, which is why the header's focus
    // order is unchanged rather than reshuffled.
    expect(grip.disabled).toBe(false);
    expect(grip.getAttribute('role')).toBe('separator');
    expect(grip.getAttribute('aria-orientation')).toBe('vertical');
    expect(grip.getAttribute('aria-label')).toMatch(/Resize Email/);
    expect(grip.getAttribute('aria-label')).toMatch(/arrows adjust the width/);
  });

  it('the arrows commit a width, Shift makes the step fine, Home clears it', () => {
    const onResize = vi.fn();
    const { grip } = head({ onResize, width: 200 });
    key(grip, 'ArrowRight');
    expect(onResize).toHaveBeenLastCalledWith(216);
    key(grip, 'ArrowLeft');
    expect(onResize).toHaveBeenLastCalledWith(184);
    key(grip, 'ArrowLeft', { shiftKey: true });
    expect(onResize).toHaveBeenLastCalledWith(196);
    key(grip, 'Home');
    // null is "whatever the table decides" — a real state, not a zero width.
    expect(onResize).toHaveBeenLastCalledWith(null);
  });

  it('never shrinks a column below the width the API accepts', () => {
    const onResize = vi.fn();
    const { grip } = head({ onResize, width: 50 });
    key(grip, 'ArrowLeft');
    expect(onResize).toHaveBeenLastCalledWith(48);
  });

  it('a press on the divider does not also re-sort the table', () => {
    // The last 7px of a header resize rather than sort. A resize that also
    // re-sorts is a resize nobody attempted.
    const onSort = vi.fn();
    const { grip } = head({ onResize: vi.fn(), onSort, sortKey: 'email', sort: null });
    act(() => grip.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(onSort).not.toHaveBeenCalled();
  });

  it('keeps the sort button working beside it', () => {
    const onSort = vi.fn();
    const { sort } = head({ onResize: vi.fn(), onSort, sortKey: 'email', sort: null });
    act(() => sort.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(onSort).toHaveBeenCalledWith({ key: 'email', dir: 'ascending' });
  });
});
