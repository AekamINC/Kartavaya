/**
 * useTabPanelMotion — direction and remount.
 *
 * Both halves are easy to break by "tidying" and neither fails loudly:
 *
 *  · Move the `prev.current` write into an effect and the panel enters from the
 *    wrong side exactly once per switch — the version of this bug that looks
 *    random rather than wrong.
 *  · Drop the `key` and nothing animates at all after the first paint. A
 *    finished CSS animation only replays when `animation-name` changes or the
 *    element is new; toggling a class does not restart it.
 *
 * Rendered with react-dom directly — see pageHeader.test.jsx for why.
 */
import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import useTabPanelMotion from '../lib/tabPanelMotion';

const IDS = ['today', 'clients', 'contacts', 'deals'];

function Probe({ value }) {
  const m = useTabPanelMotion(IDS, value);
  return <div data-testid="panel" data-key={m.key} style={m.style} />;
}

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
  container = null;
});

const render = (value) => act(() => root.render(<Probe value={value} />));
const dx = () => container.querySelector('[data-testid="panel"]').style.getPropertyValue('--ix-dx');
const keyAttr = () => container.querySelector('[data-testid="panel"]').dataset.key;

describe('useTabPanelMotion', () => {
  it('enters from the right when moving to a later tab', () => {
    render('today');
    render('deals');
    expect(dx()).toBe('1');
  });

  it('enters from the left when moving to an earlier tab', () => {
    render('deals');
    render('today');
    expect(dx()).toBe('-1');
  });

  it('reverses again on the way back, rather than latching', () => {
    render('today');
    render('contacts');
    expect(dx()).toBe('1');
    render('clients');
    expect(dx()).toBe('-1');
    render('deals');
    expect(dx()).toBe('1');
  });

  it('treats the first render as forward, not as a jump from nowhere', () => {
    render('contacts');
    expect(dx()).toBe('1');
  });

  it('returns the active tab as the key, so the panel node is replaced', () => {
    render('today');
    expect(keyAttr()).toBe('today');
    render('clients');
    expect(keyAttr()).toBe('clients');
  });

  it('does not throw when the selected tab is not in the list', () => {
    // A tab set can shrink under a permission change while a removed tab is
    // still selected; index -1 would otherwise compare as "before everything"
    // and send every subsequent panel the wrong way.
    render('today');
    expect(() => render('a-tab-that-was-revoked')).not.toThrow();
    expect(dx()).toBe('1');
  });
});
