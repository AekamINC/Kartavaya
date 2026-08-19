/**
 * ModuleTabs · onCustomize / defaultTab — the additions of proposal 67, and
 * the guard that everything the strip already did survives them.
 *
 * The regressions worth stating: with `onCustomize` unset the component must
 * behave byte-for-byte as before (no More when everything fits); with it set,
 * More exists even with an empty tail but must NOT claim `+0`; and the
 * customise row lives BELOW a divider, never mixed into the tab rows.
 *
 * Rendered with react-dom directly — @testing-library/react is installed but
 * its @testing-library/dom peer is not (see moduleTabs.test.jsx).
 */
import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import ModuleTabs from '../ModuleTabs';
import CustomizeTabs from '../CustomizeTabs';

// CRM's real seventeen — the overflow shape the component was written for.
const CRM = [
  'today', 'clients', 'contacts', 'deals', 'kanban', 'pipeline',
  'follow-ups', 'labels', 'activities', 'reports', 'automations',
  'territories', 'fields', 'web-forms', 'approvals', 'documents', 'dedupe',
];
const SMALL = ['dashboard', 'orders', 'stock'];

let container = null;
let root = null;

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  container = null;
});

const mount = (props = {}) => {
  const onChange = vi.fn();
  act(() => root.render(
    <ModuleTabs tabs={props.tabs ?? SMALL} value={props.value ?? 'dashboard'} onChange={onChange} {...props} />,
  ));
  return onChange;
};

const $  = (s) => container.querySelector(s);
const $$ = (s) => [...container.querySelectorAll(s)];
const tabs = () => $$('[role="tab"]');
const more = () => $('.mt__more');
const click = (el) => act(() => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); });

describe('ModuleTabs · the always-there More', () => {
  it('still renders NO More when everything fits and there is no onCustomize', () => {
    mount();
    expect(more()).toBeNull();
  });

  it('renders More with an empty tail when onCustomize is set — and no count', () => {
    mount({ onCustomize: vi.fn() });
    expect(more()).toBeTruthy();
    // A `+0` would claim hidden content. The count node is absent, not zero.
    expect(more().textContent).toBe('More');
    expect(more().querySelector('.mt__n')).toBeNull();
  });

  it('keeps the true count when the tail is NOT empty', () => {
    mount({ tabs: CRM, value: 'today', onCustomize: vi.fn() });
    expect(more().textContent).toContain('+9');   // 17 − 8
  });

  it('heads an empty-tail popover with the total alone', () => {
    mount({ onCustomize: vi.fn() });
    click(more());
    expect($('.mt__pop-head').textContent).toBe('3 tabs in all');
  });

  it('keeps the two-part heading when the tail has rows', () => {
    mount({ tabs: CRM, value: 'today', onCustomize: vi.fn() });
    click(more());
    expect($('.mt__pop-head').textContent).toBe('9 more · 17 tabs in all');
    expect($$('.mt__pop-row:not(.mt__pop-row--cust)')).toHaveLength(9);
  });
});

describe('ModuleTabs · the customise row', () => {
  it('sits below a divider, styled as configuration rather than a tab', () => {
    mount({ tabs: CRM, value: 'today', onCustomize: vi.fn() });
    click(more());
    const cut = $('.mt__pop-cut');
    const row = $('.mt__pop-row--cust');
    expect(cut).toBeTruthy();
    expect(row).toBeTruthy();
    expect(row.textContent).toBe('Customise tabs…');
    expect(row.getAttribute('role')).toBe('menuitem');
    // The divider PRECEDES the row — order in the DOM is the order on screen.
    expect(cut.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('fires onCustomize and closes the popover', () => {
    const onCustomize = vi.fn();
    mount({ onCustomize });
    click(more());
    click($('.mt__pop-row--cust'));
    expect(onCustomize).toHaveBeenCalledTimes(1);
    expect($('.mt__pop')).toBeNull();
  });

  it('is absent without onCustomize even when a tail exists', () => {
    mount({ tabs: CRM, value: 'today' });
    click(more());
    expect($('.mt__pop-row--cust')).toBeNull();
    expect($('.mt__pop-cut')).toBeNull();
  });
});

describe('ModuleTabs · the default-tab star', () => {
  it('marks exactly the default tab, with "Opens here" for pointer and reader alike', () => {
    mount({ tabs: CRM, value: 'today', defaultTab: 'deals' });
    const stars = $$('.mt__star');
    expect(stars).toHaveLength(1);
    expect(stars[0].closest('[role="tab"]').textContent).toContain('deals');
    expect(stars[0].getAttribute('title')).toBe('Opens here');
    expect(stars[0].querySelector('.k-sr-only').textContent).toBe('Opens here');
  });

  it('marks nothing when defaultTab is not passed', () => {
    mount({ tabs: CRM, value: 'today' });
    expect($$('.mt__star')).toHaveLength(0);
  });

  it('renders the star on the POPOVER row when the default lives in the tail', () => {
    // `dedupe` is last of seventeen: no strip button, so without the popover
    // star the "Opens here" mark simply vanishes from the product.
    mount({ tabs: CRM, value: 'today', defaultTab: 'dedupe', onCustomize: vi.fn() });
    expect($$('.mt__star')).toHaveLength(0); // closed menu: nothing yet, nothing wrong
    click(more());
    const row = $$('.mt__pop-row').find((r) => r.textContent.includes('dedupe'));
    const star = row.querySelector('.mt__star');
    expect(star).toBeTruthy();
    expect(star.getAttribute('title')).toBe('Opens here');
    expect(star.querySelector('.k-sr-only').textContent).toBe('Opens here');
    // And only that row — the mark means one thing.
    expect($$('.mt__star')).toHaveLength(1);
  });
});

describe('ModuleTabs · the More popover is a real menu', () => {
  const key = (el, k) => act(() => {
    el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
  });

  it('moves focus to the first menuitem on open', () => {
    mount({ tabs: CRM, value: 'today', onCustomize: vi.fn() });
    click(more());
    expect(document.activeElement).toBe($$('[role="menuitem"]')[0]);
  });

  it('walks the items with ArrowDown/ArrowUp (wrapping) and jumps with Home/End', () => {
    mount({ tabs: CRM, value: 'today', onCustomize: vi.fn() });
    click(more());
    const items = $$('[role="menuitem"]');
    key(document.activeElement, 'ArrowDown');
    expect(document.activeElement).toBe(items[1]);
    key(document.activeElement, 'End');
    expect(document.activeElement).toBe(items[items.length - 1]);
    key(document.activeElement, 'ArrowDown'); // wraps forward
    expect(document.activeElement).toBe(items[0]);
    key(document.activeElement, 'ArrowUp');   // wraps back
    expect(document.activeElement).toBe(items[items.length - 1]);
    key(document.activeElement, 'Home');
    expect(document.activeElement).toBe(items[0]);
  });

  it('keeps the items out of the Tab order — the trigger is the one stop', () => {
    mount({ tabs: CRM, value: 'today', onCustomize: vi.fn() });
    click(more());
    for (const item of $$('[role="menuitem"]')) expect(item.tabIndex).toBe(-1);
  });

  it('Escape closes and returns focus to the trigger', () => {
    mount({ tabs: CRM, value: 'today', onCustomize: vi.fn() });
    click(more());
    expect(document.activeElement).not.toBe(more());
    act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); });
    expect($('.mt__pop')).toBeNull();
    expect(document.activeElement).toBe(more());
  });

  it('selecting a tail tab returns focus to the trigger too — the row it was on unmounts', () => {
    const onChange = mount({ tabs: CRM, value: 'today', onCustomize: vi.fn() });
    click(more());
    click($$('.mt__pop-row:not(.mt__pop-row--cust)').find((r) => r.textContent.includes('dedupe')));
    expect(onChange).toHaveBeenCalledWith('dedupe');
    expect(document.activeElement).toBe(more());
  });
});

describe('ModuleTabs + CustomizeTabs · keyboard focus across the sheet', () => {
  // The page wiring in miniature: the sheet opens from the popover menuitem,
  // which unmounts with the popover — so the More trigger must be what the
  // sheet's focus trap captures, and what it restores to on every close path.
  function Wired() {
    const [customize, setCustomize] = React.useState(false);
    return (
      <>
        <ModuleTabs
          tabs={CRM} value="today" onChange={() => {}} defaultTab="today"
          onCustomize={() => setCustomize(true)}
        />
        <CustomizeTabs
          open={customize} onClose={() => setCustomize(false)}
          tabs={CRM.map((id) => ({ id }))} defaultTab="today"
          standard={{ order: CRM, defaultTab: 'today' }}
          onSave={async () => true}
        />
      </>
    );
  }

  const openSheet = () => {
    click(more());
    click($('.mt__pop-row--cust'));
    expect($('[role="dialog"]')).toBeTruthy();
  };

  it('hands focus to the trigger as the sheet opens, so the trap has a live return target', () => {
    act(() => root.render(<Wired />));
    openSheet();
    // The menuitem that opened the sheet no longer exists; the captured
    // element must be the trigger, which is still on the page. (In the
    // browser the trap then moves focus INTO the sheet; jsdom has no layout,
    // so what is pinned here is the capture, via the restore below.)
    expect($('.mt__pop')).toBeNull();
  });

  it('returns focus to the More trigger when the sheet closes by Cancel', async () => {
    act(() => root.render(<Wired />));
    openSheet();
    const cancel = $$('button').find((b) => b.textContent.trim() === 'Cancel');
    await act(async () => { cancel.click(); });
    expect(document.activeElement).toBe(more());
  });

  it('returns focus to the More trigger when the sheet closes by Escape', async () => {
    act(() => root.render(<Wired />));
    openSheet();
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(document.activeElement).toBe(more());
  });
});

describe('ModuleTabs · everything it already did, with the new props set', () => {
  const props = () => ({ tabs: CRM, onCustomize: vi.fn(), defaultTab: 'today' });

  it('still promotes an active tail tab onto the strip', () => {
    mount({ ...props(), value: 'dedupe' });
    expect(tabs().some((t) => t.textContent.includes('dedupe'))).toBe(true);
    expect(tabs()).toHaveLength(8);
  });

  it('still reaches a tail tab through the menu', () => {
    const onChange = mount({ ...props(), value: 'today' });
    click(more());
    const row = $$('.mt__pop-row:not(.mt__pop-row--cust)').find((r) => r.textContent.includes('dedupe'));
    click(row);
    expect(onChange).toHaveBeenCalledWith('dedupe');
    expect($('.mt__pop')).toBeNull();
  });

  it('still closes on Escape', () => {
    mount({ ...props(), value: 'today' });
    click(more());
    expect($('.mt__pop')).toBeTruthy();
    act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); });
    expect($('.mt__pop')).toBeNull();
  });

  it('still closes on an outside pointer-down', () => {
    mount({ ...props(), value: 'today' });
    click(more());
    act(() => { document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); });
    expect($('.mt__pop')).toBeNull();
  });

  it('still roves tabindex — the active tab is the single stop', () => {
    mount({ ...props(), value: 'clients' });
    const active = tabs().find((t) => t.getAttribute('aria-selected') === 'true');
    expect(active.tabIndex).toBe(0);
    for (const t of tabs()) {
      if (t !== active) expect(t.tabIndex).toBe(-1);
    }
  });

  it('still counts More truthfully after the active swap-in', () => {
    mount({ ...props(), value: 'dedupe' });
    expect(more().textContent).toContain('+9'); // still 17 − 8, whoever is inline
  });
});
