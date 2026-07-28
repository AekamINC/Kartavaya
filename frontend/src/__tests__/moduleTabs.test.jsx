/**
 * ModuleTabs — the overflow menu the design has and the build did not.
 *
 * `design-reference/Kartavaya Redesign/Data.jsx`'s TabBar opens with the comment
 * "Keeps every tab. First `max` inline, the rest in a More popover", and every
 * module screen in the runnable mockups renders through it.
 *
 * The build did not. It put all of them in an `overflow-x: auto` strip with
 * `scrollbar-width: none`. CRM declares SEVENTEEN tabs — the same seventeen the
 * reference declares — so eleven were in the DOM and out of the product,
 * reachable only by dragging a bar with no scrollbar. Nine module pages render
 * this component, which is why it presented as a different bug on each of them.
 *
 * These assert behaviour rather than styling, because behaviour is the half that
 * regresses silently: raise `max`, drop the count, or stop promoting the active
 * tab, and the strip still looks correct while hiding things again.
 *
 * Rendered with react-dom directly — @testing-library/react is installed but its
 * @testing-library/dom peer is not, so importing it throws. Same reason as
 * `pageHeader.test.jsx`.
 */

import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import ModuleTabs from '../components/module/ModuleTabs';
import { TAB_HI } from '../components/module/tabLabels';

// CRM's real tab set, verbatim from GrahaPage.jsx and identical to the
// reference's MODULE_TABS.graha.
const CRM = [
  'today', 'clients', 'contacts', 'deals', 'kanban', 'pipeline',
  'follow-ups', 'labels', 'activities', 'reports', 'automations',
  'territories', 'fields', 'web-forms', 'approvals', 'documents', 'dedupe',
];

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

const mount = (value = 'today', tabs = CRM) => {
  const onChange = vi.fn();
  act(() => root.render(
    <ModuleTabs tabs={tabs} value={value} onChange={onChange} />,
  ));
  return onChange;
};

const $  = (s) => container.querySelector(s);
const $$ = (s) => [...container.querySelectorAll(s)];
const tabs = () => $$('[role="tab"]');
const more = () => $('.mt__more');
const click = (el) => act(() => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); });

describe('ModuleTabs · overflow', () => {
  // The inline cap is 8, raised from 6. At 6, four of the nine module pages
  // pushed leaves into the menu that fit on the strip — Dristi hid `Dashboards`
  // and `Pivot` behind "More +2" on a 1600px viewport with room to spare. A tab
  // behind a menu is materially less discoverable than one on the strip, which
  // is the whole reason this component exists.
  it('shows eight inline and puts the rest behind More', () => {
    mount();
    expect(tabs()).toHaveLength(8);
    expect(more()).toBeTruthy();
  });

  it('says how many it is hiding — the difference between a menu and lost content', () => {
    mount();
    expect(more().textContent).toContain('+9');    // 17 − 8
  });

  it('lists every hidden tab, and counts the whole set', () => {
    mount();
    click(more());
    expect($('.mt__pop-head').textContent).toBe('All tabs · 17');
    expect($$('.mt__pop-row')).toHaveLength(9);
  });

  it('shows every tab inline when the module has 8 or fewer, with no More', () => {
    // Dristi's real shape: 8 leaves. Before the cap moved, two of them were
    // behind a menu on a viewport with room for all eight.
    mount('overview', CRM.slice(0, 8));
    expect(tabs()).toHaveLength(8);
    expect(more()).toBeFalsy();
  });

  it('reaches a tab that exists only in the menu', () => {
    const onChange = mount();
    click(more());
    const row = $$('.mt__pop-row').find(r => r.textContent.includes('dedupe'));
    click(row);
    expect(onChange).toHaveBeenCalledWith('dedupe');
  });

  it('never hides the ACTIVE tab', () => {
    // `dedupe` is last of seventeen. Choosing it must not collapse it straight
    // back behind More the instant it becomes current.
    mount('dedupe');
    expect(tabs().some(t => t.textContent.includes('dedupe'))).toBe(true);
    expect(tabs()).toHaveLength(8);
  });

  it('closes on Escape — the trigger sits inside a tablist', () => {
    mount();
    click(more());
    expect($('.mt__pop')).toBeTruthy();
    act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); });
    expect($('.mt__pop')).toBeNull();
  });

  it('renders no More button when everything fits', () => {
    mount('dashboard', ['dashboard', 'orders', 'stock']);
    expect(tabs()).toHaveLength(3);
    expect(more()).toBeNull();
  });
});

describe('ModuleTabs · bilingual labels', () => {
  it('sets the Devanagari name beside the English one', () => {
    mount();
    expect(TAB_HI.today).toBe('आज');
    expect($('.mt__hi').textContent).toBe('आज');
  });

  it('marks Devanagari with lang="hi" so the font and tracking rules apply', () => {
    // Without it, `[lang="hi"] { letter-spacing: 0 !important }` never fires and
    // Devanagari inherits Latin tracking, which breaks the conjuncts.
    mount();
    expect($('.mt__hi[lang="hi"]')).toBeTruthy();
  });

  it('reads a hyphenated id as words', () => {
    mount('follow-ups');
    expect(tabs().some(t => t.textContent.includes('follow ups'))).toBe(true);
  });

  it('falls back to English alone rather than a placeholder', () => {
    mount('made-up', ['made-up']);
    expect($('[role="tab"]').textContent).toContain('made up');
    expect($('.mt__hi')).toBeNull();
  });
});
