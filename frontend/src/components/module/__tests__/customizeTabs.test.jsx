/**
 * CustomizeTabs — the sheet, its one-star invariant, and the payload it posts.
 *
 * jsdom cannot perform a real pointer drag, so reorder is exercised through
 * the ↑/↓ buttons. Both paths mutate the same draft array; what is under test
 * is the DRAFT CONTRACT (order + exactly one star + the Save payload), not
 * @hello-pangea/dnd's hit-testing — the same reasoning as kanbanTab.test.jsx.
 *
 * Rendered with react-dom directly — @testing-library/react is installed but
 * its @testing-library/dom peer is not (see moduleTabs.test.jsx).
 */
import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../../../lib/api', async (importOriginal) => ({
  ...(await importOriginal()),
  api: { get: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

import { api } from '../../../lib/api';
import { ToastProvider } from '../../ui/toast';
import CustomizeTabs, { DragRow } from '../CustomizeTabs';
import useTabPrefs, { _resetTabPrefsCache } from '../useTabPrefs';

const TABS = [
  { id: 'invoices' }, { id: 'products' }, { id: 'expenses' },
  { id: 'stats', label: 'GST filing' },
];
const STANDARD = { order: ['invoices', 'products', 'expenses', 'stats'], defaultTab: 'invoices' };

/** The admin predicate reads `Kartavaya_user` through navContext — the same
 *  row the sidebar reads. No UUIDs: ids here are opaque test strings and the
 *  sheet renders none of them. */
const asUser = (roleCode) => localStorage.setItem('Kartavaya_user', JSON.stringify({
  org: { id: 'org-a', name: 'Test & Co' },
  org_roles: roleCode ? [{ org_id: 'org-a', role_code: roleCode, org_name: 'Test & Co' }] : [],
}));

let container = null;
let root = null;

beforeEach(() => {
  vi.clearAllMocks();
  _resetTabPrefsCache();
  localStorage.clear();
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

const $  = (s) => container.querySelector(s);
const $$ = (s) => [...container.querySelectorAll(s)];
const settle = async (rounds = 4) => {
  for (let i = 0; i < rounds; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => { await Promise.resolve(); });
  }
};
const click = async (el) => { await act(async () => { el.click(); }); await settle(); };
const btn = (label) => $$('button').find((b) => b.textContent.trim() === label);
const rowLabels = () => $$('.ktabs__row .ktabs__en').map((el) => el.textContent);
const starOf = (i) => $$('.ktabs__star')[i];

const mount = (props = {}) => act(() => root.render(
  <CustomizeTabs
    open
    onClose={props.onClose ?? vi.fn()}
    tabs={props.tabs ?? TABS}
    defaultTab={props.defaultTab ?? 'invoices'}
    standard={props.standard ?? STANDARD}
    onSave={props.onSave ?? vi.fn().mockResolvedValue(true)}
  />,
));

describe('CustomizeTabs · the rows', () => {
  it('renders one row per tab, in the given order, with the page\'s own labels', () => {
    asUser('org_member');
    mount();
    expect($$('.ktabs__row')).toHaveLength(4);
    expect(rowLabels()).toEqual(['invoices', 'products', 'expenses', 'GST filing']);
  });

  it('sets the Devanagari beside the English, lang-tagged', () => {
    asUser('org_member');
    mount();
    const hi = $('.ktabs__row .ktabs__hi');
    expect(hi.textContent).toBe('बीजक');     // TAB_HI.invoices
    expect(hi.getAttribute('lang')).toBe('hi');
  });

  it('is a real dialog — the house Modal, not a bespoke veil', () => {
    asUser('org_member');
    mount();
    const dlg = $('[role="dialog"]');
    expect(dlg).toBeTruthy();
    expect(dlg.getAttribute('aria-modal')).toBe('true');
    expect($('.modal__title').textContent).toBe('Customise tabs');
  });
});

describe('CustomizeTabs · exactly one star', () => {
  it('opens with the star on the default tab and nowhere else', () => {
    asUser('org_member');
    mount({ defaultTab: 'expenses' });
    const pressed = $$('.ktabs__star[aria-pressed="true"]');
    expect(pressed).toHaveLength(1);
    expect(pressed[0].closest('.ktabs__row').textContent).toContain('expenses');
  });

  it('MOVES the star on press — never a second one', async () => {
    asUser('org_member');
    mount({ defaultTab: 'invoices' });
    await click(starOf(1)); // products
    const pressed = $$('.ktabs__star[aria-pressed="true"]');
    expect(pressed).toHaveLength(1);
    expect(pressed[0].closest('.ktabs__row').textContent).toContain('products');
  });

  it('pressing the pressed star is a no-op — a module cannot open on nothing', async () => {
    asUser('org_member');
    mount({ defaultTab: 'invoices' });
    await click(starOf(0));
    expect($$('.ktabs__star[aria-pressed="true"]')).toHaveLength(1);
  });
});

describe('CustomizeTabs · reorder without a pointer', () => {
  it('moves a row down and back up with the arrow buttons', async () => {
    asUser('org_member');
    mount();
    const down = $$('.ktabs__mv').find((b) => b.getAttribute('aria-label') === 'Move invoices down');
    await click(down);
    expect(rowLabels()).toEqual(['products', 'invoices', 'expenses', 'GST filing']);
    const up = $$('.ktabs__mv').find((b) => b.getAttribute('aria-label') === 'Move invoices up');
    await click(up);
    expect(rowLabels()).toEqual(['invoices', 'products', 'expenses', 'GST filing']);
  });

  it('marks the edge buttons aria-disabled — never disabled, which would drop focus to <body>', async () => {
    asUser('org_member');
    mount();
    const up0 = $$('.ktabs__mv').find((b) => b.getAttribute('aria-label') === 'Move invoices up');
    const dn3 = $$('.ktabs__mv').find((b) => b.getAttribute('aria-label') === 'Move GST filing down');
    // `disabled` on the focused button is what stranded keyboard users: the
    // edge state must stay focusable, announced through aria-disabled.
    expect(up0.disabled).toBe(false);
    expect(dn3.disabled).toBe(false);
    expect(up0.getAttribute('aria-disabled')).toBe('true');
    expect(dn3.getAttribute('aria-disabled')).toBe('true');
    // A middle row carries no aria-disabled at all.
    const mid = $$('.ktabs__mv').find((b) => b.getAttribute('aria-label') === 'Move products up');
    expect(mid.getAttribute('aria-disabled')).toBeNull();
  });

  it('pressing past the edge is a no-op that keeps focus on the button', async () => {
    asUser('org_member');
    mount();
    const up0 = $$('.ktabs__mv').find((b) => b.getAttribute('aria-label') === 'Move invoices up');
    act(() => up0.focus());
    await click(up0);
    expect(rowLabels()).toEqual(['invoices', 'products', 'expenses', 'GST filing']);
    expect(document.activeElement).toBe(up0);
  });

  it('a row walked to the top keeps focus on the ↑ that carried it there', async () => {
    asUser('org_member');
    mount();
    const up = $$('.ktabs__mv').find((b) => b.getAttribute('aria-label') === 'Move products up');
    act(() => up.focus());
    await click(up); // products reaches index 0 — the button becomes an edge
    expect(rowLabels()).toEqual(['products', 'invoices', 'expenses', 'GST filing']);
    expect(up.getAttribute('aria-disabled')).toBe('true');
    expect(document.activeElement).toBe(up);
  });

  it('gives every drag grip its keyboard grammar in words', () => {
    asUser('org_member');
    mount();
    const grip = $('.ktabs__grip');
    expect(grip.getAttribute('aria-label')).toContain('Space picks it up');
  });
});

describe('CustomizeTabs · save, cancel, reset', () => {
  it('saves the draft as {order, defaultTab, forTeam} and closes', async () => {
    asUser('org_member');
    const onSave = vi.fn().mockResolvedValue(true);
    const onClose = vi.fn();
    mount({ onSave, onClose });
    await click($$('.ktabs__mv').find((b) => b.getAttribute('aria-label') === 'Move invoices down'));
    await click(starOf(1)); // invoices, now second
    await click(btn('Save'));
    expect(onSave).toHaveBeenCalledWith({
      order: ['products', 'invoices', 'expenses', 'stats'],
      defaultTab: 'invoices',
      forTeam: false,
    });
    expect(onClose).toHaveBeenCalled();
  });

  it('stays open over unsaved work when the save fails', async () => {
    asUser('org_member');
    const onSave = vi.fn().mockResolvedValue(false);
    const onClose = vi.fn();
    mount({ onSave, onClose });
    await click(btn('Save'));
    expect(onSave).toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('Cancel closes without saving', async () => {
    asUser('org_member');
    const onSave = vi.fn();
    const onClose = vi.fn();
    mount({ onSave, onClose });
    await click(btn('Cancel'));
    expect(onClose).toHaveBeenCalled();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('Reset to standard resets the DRAFT only — Save is still required, and the sheet stays open', async () => {
    asUser('org_member');
    const onSave = vi.fn().mockResolvedValue(true);
    const onClose = vi.fn();
    // The sheet opens on a saved arrangement (tabs prop in the user's order).
    mount({
      onSave,
      onClose,
      tabs: [{ id: 'expenses' }, { id: 'invoices' }, { id: 'products' }, { id: 'stats', label: 'GST filing' }],
      defaultTab: 'expenses',
    });
    await click(btn('Reset to standard'));
    // The rows and the star show the standard arrangement...
    expect(rowLabels()).toEqual(['invoices', 'products', 'expenses', 'GST filing']);
    expect($$('.ktabs__star[aria-pressed="true"]')[0].closest('.ktabs__row').textContent).toContain('invoices');
    // ...but NOTHING has been committed and the sheet is still open.
    expect(onSave).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    await click(btn('Save'));
    expect(onSave).toHaveBeenCalledWith({
      order: ['invoices', 'products', 'expenses', 'stats'],
      defaultTab: 'invoices',
      forTeam: false,
    });
  });

  it('Cancel after a reset discards it — the server was never involved', async () => {
    asUser('org_member');
    const onSave = vi.fn();
    const onClose = vi.fn();
    mount({ onSave, onClose, defaultTab: 'expenses' });
    await click(btn('Reset to standard'));
    await click(btn('Cancel'));
    expect(onClose).toHaveBeenCalled();
    expect(onSave).not.toHaveBeenCalled();
  });
});

describe('CustomizeTabs · the dragging row escapes the panel', () => {
  it('portals the row to document.body only while dragging', async () => {
    // `.modal__panel` carries a backdrop-filter, which makes it a containing
    // block for position:fixed — the dnd clone is fixed-positioned, so left
    // inside the panel it trails the pointer by the panel's own offset. jsdom
    // cannot lift a real drag, so the portal decision is pinned directly.
    const provided = { innerRef: () => {}, draggableProps: {} };
    await act(() => root.render(
      <DragRow provided={provided} snapshot={{ isDragging: false }}>at rest</DragRow>,
    ));
    expect($('.ktabs__row')).toBeTruthy();
    expect([...document.body.children].some((el) => el.classList?.contains('ktabs__row'))).toBe(false);
    await act(() => root.render(
      <DragRow provided={provided} snapshot={{ isDragging: true }}>lifted</DragRow>,
    ));
    // Out of the panel's subtree, straight under <body>, dressed the same.
    expect($('.ktabs__row')).toBeNull();
    const lifted = [...document.body.children].find((el) => el.classList?.contains('ktabs__row'));
    expect(lifted).toBeTruthy();
    expect(lifted.className).toContain('is-dragging');
  });
});

describe('CustomizeTabs · the team default is an admin affordance', () => {
  it('hides the checkbox from an org member', () => {
    asUser('org_member');
    mount();
    expect($('.ktabs__team')).toBeNull();
  });

  it('hides it from a user with no org at all', () => {
    asUser(null);
    mount();
    expect($('.ktabs__team')).toBeNull();
  });

  it('shows it to an org admin, and Save carries forTeam: true when ticked', async () => {
    asUser('org_admin');
    const onSave = vi.fn().mockResolvedValue(true);
    mount({ onSave });
    const box = $('.ktabs__team input[type="checkbox"]');
    expect(box).toBeTruthy();
    await act(async () => { box.click(); });
    await click(btn('Save'));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ forTeam: true }));
  });

  it('shows it to an org owner — owner outranks admin, same door', () => {
    asUser('org_owner');
    mount();
    expect($('.ktabs__team')).toBeTruthy();
  });

  it('judges the ACTIVE org\'s role, not any role anywhere', () => {
    // Admin of another org, plain member of the active one — the same tenancy
    // discipline navConfig documents. The checkbox must not render.
    localStorage.setItem('Kartavaya_user', JSON.stringify({
      org: { id: 'org-a', name: 'Active & Co' },
      org_roles: [
        { org_id: 'org-a', role_code: 'org_member', org_name: 'Active & Co' },
        { org_id: 'org-b', role_code: 'org_admin', org_name: 'Other & Co' },
      ],
    }));
    mount();
    expect($('.ktabs__team')).toBeNull();
  });
});

describe('CustomizeTabs + useTabPrefs · the wire payload', () => {
  function Harness() {
    const prefs = useTabPrefs('ganit', ['invoices', 'products', 'expenses'], { fallback: 'invoices' });
    return (
      <CustomizeTabs
        open
        onClose={() => {}}
        tabs={prefs.order.map((id) => ({ id }))}
        defaultTab={prefs.defaultTab}
        standard={prefs.standard}
        onSave={prefs.save}
      />
    );
  }

  it('a reorder + restar lands on the wire as PUT /v1/me/tab-prefs/<module> {order, default_tab}', async () => {
    asUser('org_member');
    api.get.mockResolvedValue({ data: {} });
    api.put.mockResolvedValue({});
    await act(() => root.render(<ToastProvider><Harness /></ToastProvider>));
    await settle();
    await click($$('.ktabs__mv').find((b) => b.getAttribute('aria-label') === 'Move invoices down'));
    await click($$('.ktabs__star')[0]); // products, now first
    await click(btn('Save'));
    expect(api.put).toHaveBeenCalledTimes(1);
    expect(api.put).toHaveBeenCalledWith('/v1/me/tab-prefs/ganit', {
      order: ['products', 'invoices', 'expenses'],
      default_tab: 'products',
    });
  });

  it('the sheet\'s Reset touches no server row — the DELETE belongs to the hook alone', async () => {
    asUser('org_member');
    // Warm copy = saved order, so the FIRST paint (which seeds the sheet's
    // draft — it opens on mount here) already holds the user's arrangement.
    localStorage.setItem('ktabs:ganit', JSON.stringify({ order: ['expenses', 'invoices', 'products'], default_tab: 'expenses' }));
    api.get.mockResolvedValue({ data: { ganit: { order: ['expenses', 'invoices', 'products'], default_tab: 'expenses' } } });
    api.delete.mockResolvedValue({});
    await act(() => root.render(<ToastProvider><Harness /></ToastProvider>));
    await settle();
    expect(rowLabels()).toEqual(['expenses', 'invoices', 'products']);
    await click(btn('Reset to standard'));
    // Draft back to the shipped arrangement; the saved row is untouched.
    expect(rowLabels()).toEqual(['invoices', 'products', 'expenses']);
    expect(api.delete).not.toHaveBeenCalled();
    expect(api.put).not.toHaveBeenCalled();
  });
});
