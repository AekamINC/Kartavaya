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
    // "All tabs · 17" over a list of NINE was the header's old wording, and it
    // was wrong twice: the menu holds only what did not fit, and the figure
    // beside it counts the whole module. A reader who trusted it looked for
    // seventeen rows.
    expect($('.mt__pop-head').textContent).toBe('9 more · 17 tabs in all');
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

/**
 * The sliding indicator.
 *
 * Before this, the 2px underline was `.mt__b.on::after` — drawn INSIDE the
 * selected button. A pseudo-element cannot leave its own box, so the underline
 * could only disappear from one tab and reappear under the next; animations.css
 * §9d said so and settled for growing it out of its own centre, noting that a
 * travelling bar "needs a single shared element and a ref per tab, which is JS
 * in ModuleTabs".
 *
 * jsdom performs no layout, so offsetLeft/offsetWidth are 0 for everything.
 * These stub them per element, which is enough to prove the half that actually
 * regresses: that the effect finds the RIGHT tab, writes its geometry, and runs
 * again when the selection changes. The transition itself is CSS and is asserted
 * by check-motion, not here.
 */
describe('ModuleTabs · the sliding indicator', () => {
  // Every tab is 100px wide and butted against the last, so tab n starts at
  // n * 100. Derived from the element's position among its siblings rather than
  // from read order — the effect reads only the ACTIVE tab, so a counter that
  // incremented per read would hand whichever tab happened to be selected the
  // offset 0 and the test would pass on every selection.
  const geometry = () => {
    Object.defineProperty(HTMLElement.prototype, 'offsetLeft', {
      configurable: true,
      get() {
        if (!this.classList?.contains('mt__b')) return 0;
        const sibs = [...(this.parentElement?.children || [])]
          .filter(e => e.classList.contains('mt__b'));
        return Math.max(0, sibs.indexOf(this)) * 100;
      },
    });
    Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
      configurable: true,
      get() { return this.classList?.contains('mt__b') ? 100 : 0; },
    });
    return () => {
      delete HTMLElement.prototype.offsetLeft;
      delete HTMLElement.prototype.offsetWidth;
    };
  };

  let restore;
  beforeEach(() => { restore = geometry(); });
  afterEach(() => { restore(); });

  const ind = () => $('.mt__ind');

  it('renders exactly one indicator, inside the tablist', () => {
    mount();
    expect($$('.mt__ind')).toHaveLength(1);
    // Inside `.mt`, because that element is the offsetParent the measurements
    // are expressed against. In `.mt__wrap` the numbers would be off by
    // whatever the strip is inset by.
    expect(ind().parentElement.getAttribute('role')).toBe('tablist');
  });

  it('is hidden from assistive tech and from the pointer', () => {
    mount();
    // It carries no text and means nothing to a screen reader — the selected
    // tab already says so with aria-selected.
    expect(ind().getAttribute('aria-hidden')).toBe('true');
    expect(ind().tagName).toBe('SPAN');
  });

  it('measures the ACTIVE tab, not the first one', () => {
    // 'deals' is 4th in CRM, so offsetLeft 300 with the stub above.
    mount('deals');
    expect(ind().style.getPropertyValue('--ind-x')).toBe('312px');   // 300 + 12
    expect(ind().style.getPropertyValue('--ind-w')).toBe('76px');    // 100 − 24
    expect(ind().style.getPropertyValue('--ind-o')).toBe('1');
  });

  it('moves when the selection changes — the whole point of one shared element', () => {
    mount('today');                       // 1st → offsetLeft 0
    expect(ind().style.getPropertyValue('--ind-x')).toBe('12px');
    mount('contacts');                    // 3rd → offsetLeft 200
    expect(ind().style.getPropertyValue('--ind-x')).toBe('212px');
  });

  it('stays hidden when no inline tab is selected', () => {
    // A tab that exists but sits behind More: it is promoted onto the strip by
    // the overflow logic, so pick one that is not in the tab set at all.
    mount('deals', ['clients', 'contacts']);
    expect(ind().style.getPropertyValue('--ind-o')).toBe('0');
  });

  it('is not captured by the More button when its menu is open', () => {
    mount('today');
    click(more());
    // `.mt__more` also takes `.on` while open. It lives in `.mt__ovf`, outside
    // the tablist, so the query the effect runs cannot reach it — the bar must
    // still be on the selected tab.
    expect(more().className).toContain('on');
    expect(ind().style.getPropertyValue('--ind-x')).toBe('12px');
  });
});
