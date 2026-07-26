/**
 * Tests for useDismiss — the shared popup-dismissal hook.
 *
 * This replaced seven near-identical copies of an outside-click effect across
 * the drawer, the fields, the task editor and the tasks list. None of them
 * handled Escape, so every dropdown was a keyboard trap: openable by keyboard,
 * closable only by clicking elsewhere.
 *
 * Rendered with react-dom directly rather than @testing-library/react: that
 * package is installed but its @testing-library/dom peer dependency is not, so
 * importing it throws. Adding a dependency to make a test pass is the tail
 * wagging the dog — react + react-dom are already here and are enough.
 */

import React, { useRef, useState } from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { useDismiss } from '../hooks/useDismiss';

let container = null;
let root = null;

// React 19 warns unless the environment opts in to act(). Set locally rather
// than in the shared setup file so this cannot change how other suites behave.
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  container = null;
  globalThis.IS_REACT_ACT_ENVIRONMENT = false;
});

function Popup({ startOpen = true, onDismiss }) {
  const [open, setOpen] = useState(startOpen);
  const ref = useRef(null);
  useDismiss(open, ref, () => { setOpen(false); onDismiss?.(); });
  return (
    <div>
      <button id="outside">outside</button>
      {open && <div ref={ref} id="popup"><button id="inside">inside</button></div>}
    </div>
  );
}

const mount = (props) => act(() => { root.render(<Popup {...props} />); });
const $ = sel => container.querySelector(sel);
const mouseDown = el => act(() => {
  el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
});
const key = k => act(() => {
  document.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
});

describe('useDismiss()', () => {
  it('closes on a mousedown outside the ref', () => {
    mount();
    expect($('#popup')).toBeTruthy();
    mouseDown($('#outside'));
    expect($('#popup')).toBeNull();
  });

  it('does NOT close on a mousedown inside the ref', () => {
    mount();
    mouseDown($('#inside'));
    expect($('#popup')).toBeTruthy();
  });

  it('closes on Escape — the behaviour every copy was missing', () => {
    mount();
    key('Escape');
    expect($('#popup')).toBeNull();
  });

  it('ignores keys other than Escape', () => {
    mount();
    key('a');
    key('Enter');
    expect($('#popup')).toBeTruthy();
  });

  it('does not fire while closed', () => {
    // ColumnsPopover attached its listener with no open-guard, so onClose ran
    // on every outside mousedown even when the popover was already shut.
    let calls = 0;
    mount({ startOpen: false, onDismiss: () => { calls += 1; } });
    mouseDown($('#outside'));
    key('Escape');
    expect(calls).toBe(0);
  });

  it('detaches its listeners on unmount', () => {
    let calls = 0;
    mount({ onDismiss: () => { calls += 1; } });
    act(() => root.render(null));
    mouseDown(document.body);
    key('Escape');
    expect(calls).toBe(0);
  });
});
