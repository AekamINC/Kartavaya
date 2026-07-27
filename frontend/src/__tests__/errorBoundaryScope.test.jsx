/**
 * A page that throws must not take the product down with it.
 *
 * Until now `ErrorBoundary` existed once, wrapping the whole tree in
 * `App.jsx:296`. That is right for a failure in the providers or the router —
 * there is nothing left to render around it. But it was the ONLY one, so a
 * throw inside any tab panel replaced the sidebar, the nav, the toasts and the
 * entire product with a reload button, and the only way out was a reload that
 * also lost whatever the user had been doing. A verification agent found it by
 * measurement: "a throw in any tab blanks the entire app".
 *
 * `AppShell` now wraps `<Outlet>` at `scope="page"`. These tests pin the two
 * properties that makes worth having:
 *
 *   1. the fallback renders instead of the page, and
 *   2. `Try again` CLEARS it — a boundary latches on error, so a retry that
 *      does not reset leaves the user staring at the same panel forever.
 *
 * Rendered with react-dom directly — see pageHeader.test.jsx for why.
 */
import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import ErrorBoundary from '../components/ErrorBoundary';

let container = null;
let root = null;
let consoleError = null;

function Boom({ throwNow }) {
  if (throwNow) throw new Error('the panel exploded');
  return <p data-testid="ok">the page rendered</p>;
}

/** Stands in for the shell: it must still be here after the page throws. */
function Shell({ children }) {
  return (
    <div>
      <nav data-testid="sidebar">Sidebar</nav>
      <main>{children}</main>
    </div>
  );
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  // React logs the caught error itself; the boundary logs it too by design.
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  container = null;
  consoleError.mockRestore();
});

const text = () => container.textContent;
const $ = (sel) => container.querySelector(sel);

describe('ErrorBoundary · scope="page"', () => {
  it('keeps the shell alive when the page throws', () => {
    act(() => root.render(
      <Shell><ErrorBoundary scope="page"><Boom throwNow /></ErrorBoundary></Shell>,
    ));

    // The defect this exists to prevent: the sidebar disappearing.
    expect($('[data-testid="sidebar"]'), 'the shell was destroyed by a page-level throw').toBeTruthy();
    expect($('[data-testid="ok"]')).toBeNull();
    expect(text()).toContain('This page didn’t load');
  });

  it('offers a retry, not a reload, because the shell is still alive', () => {
    act(() => root.render(
      <Shell><ErrorBoundary scope="page"><Boom throwNow /></ErrorBoundary></Shell>,
    ));
    const btn = [...container.querySelectorAll('button')].find(b => b.textContent.includes('Try again'));
    expect(btn, 'a page-scoped failure must not demand a full reload').toBeTruthy();
  });

  it('Try again clears the latch and re-renders the page', () => {
    // A boundary holds its error until state is reset. Without the reset the
    // button is decorative and the page can never come back.
    function Harness() {
      const [broken, setBroken] = React.useState(true);
      React.useEffect(() => { setBroken(false); }, []);
      return <ErrorBoundary scope="page"><Boom throwNow={broken} /></ErrorBoundary>;
    }
    act(() => root.render(<Shell><Harness /></Shell>));
    expect(text()).toContain('This page didn’t load');

    const btn = [...container.querySelectorAll('button')].find(b => b.textContent.includes('Try again'));
    act(() => btn.dispatchEvent(new MouseEvent('click', { bubbles: true })));

    expect($('[data-testid="ok"]'), 'Try again did not clear the boundary').toBeTruthy();
    expect(text()).not.toContain('This page didn’t load');
  });

  it('renders nothing of its own while the child is healthy', () => {
    act(() => root.render(
      <Shell><ErrorBoundary scope="page"><Boom /></ErrorBoundary></Shell>,
    ));
    expect($('[data-testid="ok"]')).toBeTruthy();
    expect($('.k-err')).toBeNull();
  });
});

describe('ErrorBoundary · app scope', () => {
  it('still offers a reload, because nothing is left to retry into', () => {
    act(() => root.render(<ErrorBoundary><Boom throwNow /></ErrorBoundary>));
    const btn = [...container.querySelectorAll('button')].find(b => b.textContent.includes('Reload page'));
    expect(btn).toBeTruthy();
    expect(text()).toContain('Something went wrong');
  });

  it('uses the shared k-err vocabulary rather than inline styles', () => {
    // It used to be a pile of inline styles and a ⚠️ emoji, which ignored the
    // theme, the density control and the type scale — so a crash looked like a
    // different product from every other failure in the app.
    act(() => root.render(<ErrorBoundary><Boom throwNow /></ErrorBoundary>));
    const box = $('.k-err');
    expect(box).toBeTruthy();
    expect(box.getAttribute('role')).toBe('alert');
    expect($('.k-err__ic')).toBeTruthy();
    expect(container.innerHTML).not.toContain('⚠️');
  });
});
