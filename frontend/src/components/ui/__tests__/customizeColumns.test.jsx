/**
 * CustomizeColumns — the sheet, the two rules that follow from hiding being
 * real, and the payload it posts.
 *
 * jsdom cannot perform a real pointer drag, so reorder is exercised through
 * the ↑/↓ buttons. Both paths mutate the same draft array; what is under test
 * is the DRAFT CONTRACT (order + visibility + width + the Save payload), not
 * @hello-pangea/dnd's hit-testing — the same reasoning customizeTabs.test.jsx
 * and kanbanTab.test.jsx give.
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

import { ToastProvider } from '../toast';
import CustomizeColumns, { DragRow } from '../CustomizeColumns';

const ALL = [
  { id: 'name', label: 'Name', fixed: true, hidden: false, width: null },
  { id: 'email', label: 'Email', hidden: false, width: null },
  { id: 'phone', label: 'Phone', hidden: true, width: 180 },
];
const STANDARD = ALL.map(c => ({ ...c, hidden: false, width: null }));

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
  localStorage.clear();
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.innerHTML = '';
});

function open(props = {}) {
  const onSave = props.onSave ?? vi.fn().mockResolvedValue(true);
  act(() => root.render(
    <ToastProvider>
      <CustomizeColumns
        open
        onClose={props.onClose ?? vi.fn()}
        all={props.all ?? ALL}
        standard={props.standard ?? STANDARD}
        onSave={onSave}
        onReset={props.onReset}
      />
    </ToastProvider>,
  ));
  return { onSave };
}

/** The sheet renders through <Modal>, which portals — so query the document,
 *  not the container. */
const rows = () => [...document.querySelectorAll('.kcols__row')];
const labels = () => rows().map(r => r.querySelector('.kcols__lab').textContent);
const ticks = () => rows().map(r => r.querySelector('.kcols__show input'));
const byLabel = (re) => [...document.querySelectorAll('button')]
  .find(b => re.test(b.getAttribute('aria-label') || b.textContent || ''));
const click = (el) => act(() => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); });

describe('CustomizeColumns', () => {
  it('lists every column, hidden ones included', () => {
    // The hidden ones have to be here or there is no way to get them back.
    open();
    expect(labels()).toEqual(['Name', 'Email', 'Phone']);
    expect(ticks().map(t => t.checked)).toEqual([true, true, false]);
  });

  it('reorders with the ↑/↓ buttons and posts the new order', async () => {
    const { onSave } = open();
    await click(rows()[2].querySelectorAll('.kcols__mv')[0]); // Phone up
    expect(labels()).toEqual(['Name', 'Phone', 'Email']);
    await click(byLabel(/^Save$|Save/));
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0][0].columns.map(c => c.id))
      .toEqual(['name', 'phone', 'email']);
  });

  it('the edge buttons are aria-disabled, never disabled', () => {
    // They hit their edge WHILE FOCUSED — repeat-pressing ↑ walks a row to the
    // top — and a disabled element drops keyboard focus to <body>. This is
    // CustomizeTabs' fix, repeated rather than rediscovered.
    open();
    const up = rows()[0].querySelectorAll('.kcols__mv')[0];
    const down = rows()[2].querySelectorAll('.kcols__mv')[1];
    expect(up.getAttribute('aria-disabled')).toBe('true');
    expect(up.disabled).toBe(false);
    expect(down.getAttribute('aria-disabled')).toBe('true');
    expect(down.disabled).toBe(false);
  });

  it('every control is reachable by keyboard', () => {
    // Grip, tick, width and both arrows are real focusable elements — the drag
    // handle is not the only route to a reorder.
    open();
    const row = rows()[1];
    expect(row.querySelector('.kcols__grip').tagName).toBe('BUTTON');
    expect(row.querySelector('.kcols__show input').type).toBe('checkbox');
    expect(row.querySelector('.kcols__wi').tagName).toBe('INPUT');
    expect(row.querySelectorAll('.kcols__mv')).toHaveLength(2);
    // The grip announces the grammar rather than assuming it is known.
    expect(row.querySelector('.kcols__grip').getAttribute('aria-label'))
      .toMatch(/Space picks it up/);
  });

  it('a fixed column cannot be hidden', async () => {
    open();
    const nameTick = ticks()[0];
    expect(nameTick.disabled).toBe(true);
    expect(nameTick.title).toMatch(/identifies the row/);
  });

  it('the LAST visible column cannot be unticked', async () => {
    // An arrangement that hides everything renders a table whose own
    // "Columns…" button is inside the table it emptied. The server refuses
    // that body with a 422; refusing the click is what stops the user meeting
    // it.
    open({
      all: [
        { id: 'a', label: 'A', hidden: false, width: null },
        { id: 'b', label: 'B', hidden: true, width: null },
      ],
      standard: null,
    });
    const first = ticks()[0];
    expect(first.disabled).toBe(true);
    expect(first.title).toMatch(/at least one column/);
  });

  it('hides a column and posts it hidden', async () => {
    const { onSave } = open();
    // A real click on the tick — React derives the checkbox's change event
    // from the click, so pre-setting `.checked` would leave it toggling back.
    await click(ticks()[1]);
    expect(ticks()[1].checked).toBe(false);
    await click(byLabel(/Save/));
    expect(onSave.mock.calls[0][0].columns.find(c => c.id === 'email').hidden).toBe(true);
  });

  it('"Reset to standard" rearranges the DRAFT and does not save', async () => {
    const { onSave } = open();
    await click(rows()[2].querySelectorAll('.kcols__mv')[0]);
    expect(labels()).toEqual(['Name', 'Phone', 'Email']);
    await click(byLabel(/Reset to standard/));
    expect(labels()).toEqual(['Name', 'Email', 'Phone']);
    expect(onSave).not.toHaveBeenCalled();
    // …and it un-hides, because "standard" is every column visible.
    expect(ticks().map(t => t.checked)).toEqual([true, true, true]);
  });

  it('"Forget my layout" is a SECOND verb, only when a reset is offered', async () => {
    // Different consequences: one rearranges what you are looking at, the
    // other deletes a row and may surface a team default underneath.
    open();
    expect(byLabel(/Forget my layout/)).toBeUndefined();
    const onReset = vi.fn().mockResolvedValue(true);
    open({ onReset });
    await click(byLabel(/Forget my layout/));
    expect(onReset).toHaveBeenCalledTimes(1);
  });

  it('stays open when the save fails, over the unsaved arrangement', async () => {
    const onClose = vi.fn();
    open({ onSave: vi.fn().mockResolvedValue(false), onClose });
    await click(byLabel(/Save/));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('offers the team default to an org admin and to nobody else', () => {
    asUser('org_member');
    open();
    expect(document.querySelector('.kcols__team')).toBe(null);
    act(() => root.unmount());
    root = createRoot(container);
    asUser('org_admin');
    open();
    expect(document.querySelector('.kcols__team')).not.toBe(null);
  });

  it('renders no id anywhere on screen', () => {
    // The names-not-ids rule. Column ids are not user ids, but the sheet is a
    // list of rows about a table and the temptation to label them by key is
    // exactly how a screen starts showing keys.
    open();
    expect(document.body.textContent).not.toMatch(/\bemail\b/);
    expect(document.body.textContent).toMatch(/Email/);
  });
});

describe('DragRow', () => {
  it('portals to document.body while dragging, and not otherwise', () => {
    // `.modal__panel` carries a backdrop-filter, and a filtered element is a
    // CONTAINING BLOCK for position:fixed descendants — the dnd clone is
    // fixed-positioned, so rendered inside the panel it offsets from the
    // pointer by the panel's own top-left.
    const provided = { innerRef: () => {}, draggableProps: {} };
    act(() => root.render(
      <DragRow provided={provided} snapshot={{ isDragging: false }}>x</DragRow>,
    ));
    expect(container.querySelector('.kcols__row')).not.toBe(null);
    act(() => root.render(
      <DragRow provided={provided} snapshot={{ isDragging: true }}>x</DragRow>,
    ));
    expect(container.querySelector('.kcols__row')).toBe(null);
    expect(document.body.querySelector('.kcols__row.is-dragging')).not.toBe(null);
  });
});
