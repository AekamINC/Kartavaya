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

/* ══════════════════════════════════════════════════════════════════════════
   The call sites, which is where this actually broke
   ══════════════════════════════════════════════════════════════════════════

   Every test above passed while all six module pages were broken, because the
   bug was not in the hook — it was in how they consumed it. Each did:

       const motion = useTabPanelMotion(…);   <div className="ix-panel" {...motion}>

   React 19 refuses a `key` inside a spread: it logs and DROPS it. So the panel
   was reconciled in place, the enter animation never restarted, and the hook's
   entire purpose was silently defeated on every page that used it.

   Nothing caught it. Not these tests, not check-tokens, not check-classes, not
   `vite build` — a dropped key is a console warning, not a build error. So the
   guard has to read the source. It is a blunt instrument on purpose: the next
   module page will be written by copying an existing one, and this fails the
   moment that copy spreads the key. */
import fs from 'node:fs';
import path from 'node:path';

const PAGES = path.resolve(__dirname, '../pages');

describe('useTabPanelMotion · call sites', () => {
  const callers = fs.readdirSync(PAGES)
    .filter(f => f.endsWith('.jsx'))
    .map(f => [f, fs.readFileSync(path.join(PAGES, f), 'utf8')])
    .filter(([, src]) => src.includes('useTabPanelMotion('));

  it('finds the module pages, so an empty list cannot pass vacuously', () => {
    expect(callers.length).toBeGreaterThanOrEqual(6);
  });

  it.each(callers.map(([f]) => f))('%s destructures `key` instead of spreading it', (file) => {
    const src = callers.find(([f]) => f === file)[1];

    // Whatever the object is named, it must not be assigned whole from the hook
    // and then spread — that is the shape that drops the key.
    const assigned = src.match(/const\s+(\w+)\s*=\s*useTabPanelMotion\(/);
    expect(
      assigned,
      `${file} assigns the hook result whole (\`${assigned?.[1]}\`) — destructure ` +
      '`{ key: panelKey, ...motion }` so the key is passed explicitly.',
    ).toBeNull();

    expect(src).toMatch(/const\s*\{\s*key\s*:\s*\w+\s*,\s*\.\.\.\w+\s*\}\s*=\s*useTabPanelMotion\(/);
    expect(src, `${file} spreads motion without a sibling key=`).toMatch(/key=\{\w+\}/);
  });
});
