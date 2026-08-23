/**
 * useColumnPrefs — the reconcile contract, the three storage layers, and the
 * resolution ladder as the client sees it.
 *
 * The reconcile rules are the part that regresses silently: a saved
 * arrangement is WRITTEN once and READ for ever, so the page's column set will
 * drift under it — columns renamed, dropped, shipped later — and every drift
 * has to degrade to something sensible rather than to a crash, a stolen slot,
 * or a table with no columns in it.
 *
 * Rendered with react-dom directly — @testing-library/react is installed but
 * its @testing-library/dom peer is not, so importing it throws. Same reason as
 * `useTabPrefs.test.jsx` and `moduleTabs.test.jsx`.
 *
 * Only the transport is mocked; `body()` comes from the real module because
 * envelope-vs-bare unwrapping is part of what is under test.
 */
import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../lib/api', async (importOriginal) => ({
  ...(await importOriginal()),
  api: { get: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

import { api } from '../lib/api';
import { ToastProvider } from '../components/ui/toast';
import useColumnPrefs, {
  reconcileColumnPrefs, toWire, clampWidth, MIN_WIDTH, MAX_WIDTH,
  _resetColumnPrefsCache,
} from '../hooks/useColumnPrefs';

const BASE = [
  { id: 'name', label: 'Name', fixed: true },
  { id: 'email', label: 'Email' },
  { id: 'phone', label: 'Phone' },
  { id: 'source', label: 'Source' },
];

let container = null;
let root = null;
/** The latest hook return, captured by the probe on every render. */
const h = {};

function Probe({ tableKey = 'graha.contacts', base = BASE }) {
  Object.assign(h, useColumnPrefs(tableKey, base));
  return (
    <table>
      <thead><tr><th data-t="order">{h.columns.map(c => c.id).join(',')}</th></tr></thead>
      <tbody>
        <tr data-t="row">{h.cells({
          name: <td>N</td>, email: <td>E</td>, phone: <td>P</td>, source: <td>S</td>,
        })}</tr>
      </tbody>
    </table>
  );
}

function mount(props = {}) {
  act(() => root.render(
    <ToastProvider><Probe {...props} /></ToastProvider>,
  ));
}

const text = (t) => container.querySelector(`[data-t="${t}"]`)?.textContent;
const flush = async () => { await act(async () => { await Promise.resolve(); }); };

beforeEach(() => {
  vi.clearAllMocks();
  _resetColumnPrefsCache();
  localStorage.clear();
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  // A quiet server by default; tests that care override per-case.
  api.get.mockResolvedValue({ data: {} });
  api.put.mockResolvedValue({ data: {} });
  api.delete.mockResolvedValue({ data: {} });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

// ── the reconcile contract, stated without a DOM ────────────────────────────

describe('reconcileColumnPrefs', () => {
  it('nothing saved is the page\'s own columns, all visible', () => {
    const out = reconcileColumnPrefs(BASE, null);
    expect(out.map(c => c.id)).toEqual(['name', 'email', 'phone', 'source']);
    expect(out.every(c => !c.hidden)).toBe(true);
  });

  it('applies the saved ORDER', () => {
    const out = reconcileColumnPrefs(BASE, {
      columns: [{ id: 'source' }, { id: 'name' }, { id: 'email' }, { id: 'phone' }],
    });
    expect(out.map(c => c.id)).toEqual(['source', 'name', 'email', 'phone']);
  });

  it('applies the saved VISIBILITY and WIDTH', () => {
    const out = reconcileColumnPrefs(BASE, {
      columns: [{ id: 'name' }, { id: 'email', hidden: true }, { id: 'phone', width: 220 }],
    });
    expect(out.find(c => c.id === 'email').hidden).toBe(true);
    expect(out.find(c => c.id === 'phone').width).toBe(220);
  });

  it('DROPS a saved id the page no longer ships — nothing, never an error', () => {
    // The compatibility promise, client half. This is what buys the server the
    // right to validate a grammar rather than a per-table catalogue.
    const out = reconcileColumnPrefs(BASE, {
      columns: [{ id: 'a_column_we_deleted' }, { id: 'name' }, { id: 'email' }],
    });
    expect(out.map(c => c.id)).toEqual(['name', 'email', 'phone', 'source']);
  });

  it('APPENDS a column shipped after the row was saved, visible, at the end', () => {
    const saved = { columns: [{ id: 'source' }, { id: 'name' }] };
    const later = [...BASE, { id: 'gstin', label: 'GSTIN' }];
    const out = reconcileColumnPrefs(later, saved);
    expect(out.map(c => c.id)).toEqual(['source', 'name', 'email', 'phone', 'gstin']);
    expect(out.find(c => c.id === 'gstin').hidden).toBe(false);
  });

  it('never lets a stale row hide a column the page declared fixed', () => {
    const out = reconcileColumnPrefs(BASE, {
      columns: [{ id: 'name', hidden: true }, { id: 'email' }],
    });
    expect(out.find(c => c.id === 'name').hidden).toBe(false);
  });

  it('refuses an arrangement that hides everything, whole', () => {
    // The reader's half of the server's 422. A row written before that rule —
    // or by hand — must not empty the table it is meant to arrange.
    const out = reconcileColumnPrefs(
      [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }],
      { columns: [{ id: 'a', hidden: true }, { id: 'b', hidden: true }] },
    );
    expect(out.every(c => !c.hidden)).toBe(true);
  });

  it('drops a duplicate id rather than rendering the column twice', () => {
    const out = reconcileColumnPrefs(BASE, {
      columns: [{ id: 'email' }, { id: 'email' }, { id: 'name' }],
    });
    expect(out.map(c => c.id)).toEqual(['email', 'name', 'phone', 'source']);
  });

  it('clamps a saved width into the bounds the API will accept', () => {
    const out = reconcileColumnPrefs(BASE, {
      columns: [{ id: 'name', width: 5 }, { id: 'email', width: 99999 }],
    });
    expect(out.find(c => c.id === 'name').width).toBe(MIN_WIDTH);
    expect(out.find(c => c.id === 'email').width).toBe(MAX_WIDTH);
  });

  it('survives garbage without throwing', () => {
    for (const junk of [undefined, null, 7, 'x', { columns: 'no' }, { columns: [null, 3, {}] }]) {
      expect(reconcileColumnPrefs(BASE, junk).map(c => c.id))
        .toEqual(['name', 'email', 'phone', 'source']);
    }
  });
});

describe('toWire', () => {
  it('sends the three facts and nothing the page put on its own objects', () => {
    // `label` and any render function are frontend CODE. Storing them would
    // freeze this month's copy in a database row.
    expect(toWire([{ id: 'name', label: 'Name', fixed: true, hidden: false, width: 200 }]))
      .toEqual([{ id: 'name', hidden: false, width: 200 }]);
  });
});

describe('clampWidth', () => {
  it('rounds, clamps, and answers null for a non-number', () => {
    expect(clampWidth('220.4')).toBe(220);
    expect(clampWidth(0)).toBe(MIN_WIDTH);
    expect(clampWidth(1e9)).toBe(MAX_WIDTH);
    expect(clampWidth('abc')).toBe(null);
  });
});

// ── the ladder, as the client sees it ───────────────────────────────────────

describe('the resolution ladder', () => {
  it('the page\'s built-in order is the floor when nothing is saved', async () => {
    mount();
    await flush();
    expect(text('order')).toBe('name,email,phone,source');
  });

  it('a server arrangement beats the built-in order', async () => {
    // The server has ALREADY resolved personal over org before it answers
    // (routers/column_prefs.py), so the client never sees two candidates and
    // cannot disagree with another surface about which one won.
    api.get.mockResolvedValue({
      data: {
        'graha.contacts': {
          columns: [{ id: 'source' }, { id: 'name' }], source: 'org',
        },
      },
    });
    mount();
    await flush();
    expect(text('order')).toBe('source,name,email,phone');
  });

  it('a personal arrangement is what the server sends when one exists', async () => {
    api.get.mockResolvedValue({
      data: {
        'graha.contacts': {
          columns: [{ id: 'phone' }, { id: 'name' }], source: 'personal',
        },
      },
    });
    mount();
    await flush();
    expect(text('order')).toBe('phone,name,email,source');
  });

  it('the warm copy paints first, and the server wins on arrival', async () => {
    localStorage.setItem('kcols:graha.contacts', JSON.stringify({
      columns: [{ id: 'email' }, { id: 'name' }],
    }));
    api.get.mockResolvedValue({
      data: { 'graha.contacts': { columns: [{ id: 'source' }, { id: 'name' }] } },
    });
    mount();
    // First paint, before the GET lands: already in the user's arrangement.
    expect(text('order')).toBe('email,name,phone,source');
    await flush();
    expect(text('order')).toBe('source,name,email,phone');
  });

  it('a server that has no row for this table CLEARS a stale warm entry', async () => {
    localStorage.setItem('kcols:graha.contacts', JSON.stringify({
      columns: [{ id: 'email' }, { id: 'name' }],
    }));
    api.get.mockResolvedValue({ data: {} });
    mount();
    await flush();
    expect(text('order')).toBe('name,email,phone,source');
    expect(localStorage.getItem('kcols:graha.contacts')).toBe(null);
  });

  it('a failed GET leaves the warm copy carrying the session', async () => {
    localStorage.setItem('kcols:graha.contacts', JSON.stringify({
      columns: [{ id: 'source' }, { id: 'name' }],
    }));
    api.get.mockRejectedValue(new Error('offline'));
    mount();
    await flush();
    expect(text('order')).toBe('source,name,email,phone');
  });

  it('makes ONE request for the whole app, not one per table', async () => {
    api.get.mockResolvedValue({ data: {} });
    act(() => root.render(
      <ToastProvider>
        <Probe tableKey="graha.contacts" />
        <Probe tableKey="ganit.invoices" base={[{ id: 'name', label: 'N' }]} />
      </ToastProvider>,
    ));
    await flush();
    expect(api.get).toHaveBeenCalledTimes(1);
  });
});

// ── cells() — the mechanical opt-in ─────────────────────────────────────────

describe('cells()', () => {
  it('renders the page\'s cells in the arranged order', async () => {
    api.get.mockResolvedValue({
      data: { 'graha.contacts': { columns: [{ id: 'source' }, { id: 'phone' }] } },
    });
    mount();
    await flush();
    expect(text('row')).toBe('SPNE');
  });

  it('drops a hidden column\'s cell, so the row still matches the header', async () => {
    api.get.mockResolvedValue({
      data: {
        'graha.contacts': {
          columns: [{ id: 'name' }, { id: 'email', hidden: true },
                    { id: 'phone' }, { id: 'source', hidden: true }],
        },
      },
    });
    mount();
    await flush();
    expect(text('order')).toBe('name,phone');
    expect(text('row')).toBe('NP');
    expect(container.querySelectorAll('[data-t="row"] td')).toHaveLength(2);
  });

  it('renders an empty cell for a column the page gave no node for', async () => {
    // A missing cell would shift every column after it. An empty one does not.
    const Bare = () => {
      const cols = useColumnPrefs('graha.contacts', BASE);
      return <table><tbody><tr data-t="row">{cols.cells({ name: <td>N</td> })}</tr></tbody></table>;
    };
    act(() => root.render(<ToastProvider><Bare /></ToastProvider>));
    await flush();
    expect(container.querySelectorAll('[data-t="row"] td')).toHaveLength(4);
  });
});

// ── the div-grid half ───────────────────────────────────────────────────────

describe('defaultHidden — the shipped default, not a saved one', () => {
  const WITH_DEFAULTS = [
    { id: 'task', label: 'Task', fixed: true },
    { id: 'due', label: 'Due' },
    { id: 'category', label: 'Category', defaultHidden: true },
  ];

  it('ships hidden, and is still offered in the sheet', () => {
    const out = reconcileColumnPrefs(WITH_DEFAULTS, null);
    expect(out.map(c => c.id)).toEqual(['task', 'due', 'category']);
    expect(out.find(c => c.id === 'category').hidden).toBe(true);
    // `all` includes it — the whole point is that the user can turn it back on.
    expect(out).toHaveLength(3);
  });

  it('a saved row that shows it WINS — the flag is a default, not a rule', () => {
    const out = reconcileColumnPrefs(WITH_DEFAULTS, {
      columns: [{ id: 'category' }, { id: 'task' }, { id: 'due' }],
    });
    expect(out.map(c => c.id)).toEqual(['category', 'task', 'due']);
    expect(out.every(c => !c.hidden)).toBe(true);
  });

  it('a column shipped later WITHOUT the flag still appends visible', () => {
    // The ships-later promise is not weakened by defaultHidden existing: it
    // only steps aside where the page said something.
    const out = reconcileColumnPrefs(WITH_DEFAULTS, { columns: [{ id: 'task' }] });
    expect(out.map(c => [c.id, c.hidden])).toEqual([
      ['task', false], ['due', false], ['category', true],
    ]);
  });

  it('never wins over fixed — a page cannot both pin and hide a column', () => {
    const out = reconcileColumnPrefs(
      [{ id: 'a', label: 'A', fixed: true, defaultHidden: true }], null);
    expect(out[0].hidden).toBe(false);
  });

  it('is ignored WHOLE if honouring it would leave no columns at all', () => {
    const out = reconcileColumnPrefs(
      [{ id: 'a', label: 'A', defaultHidden: true },
       { id: 'b', label: 'B', defaultHidden: true }], null);
    expect(out.every(c => !c.hidden)).toBe(true);
  });
});

describe('gridCells() and gridTemplate — the .k-trow half', () => {
  const GRID_BASE = [
    { id: 'task', label: 'Task', width: 340, fixed: true },
    { id: 'due', label: 'Due', width: 150 },
    { id: 'status', label: 'Status' },
  ];

  /** The div-grid probe. Deliberately renders NO table element: the point of
   *  the second function is that it manufactures `<div>`, and a `<td>` inside
   *  a `<div>` grid is the breakage it exists to prevent. */
  function GridProbe() {
    const cols = useColumnPrefs('tasks.list', GRID_BASE);
    return (
      <div data-t="head" data-template={cols.gridTemplate}>
        <div data-t="row">{cols.gridCells({
          task: <div className="k-trow__cell">T</div>,
          due: <div className="k-trow__cell">D</div>,
          status: <div className="k-trow__cell">S</div>,
        })}</div>
      </div>
    );
  }
  const mountGrid = () => act(() => root.render(
    <ToastProvider><GridProbe /></ToastProvider>));

  it('manufactures DIVs, never <td> — a table cell outside a table is the bug', async () => {
    mountGrid();
    await flush();
    const row = container.querySelector('[data-t="row"]');
    expect(row.querySelectorAll('td')).toHaveLength(0);
    expect(row.children).toHaveLength(3);
    expect(row.textContent).toBe('TDS');
  });

  it('applies the saved order and drops the hidden ones, like cells() does', async () => {
    api.get.mockResolvedValue({
      data: { 'tasks.list': { columns: [{ id: 'status' }, { id: 'task' }, { id: 'due', hidden: true }] } },
    });
    mountGrid();
    await flush();
    expect(container.querySelector('[data-t="row"]').textContent).toBe('ST');
  });

  it('renders an empty div for a column with no node, so tracks stay aligned', async () => {
    const Bare = () => {
      const cols = useColumnPrefs('tasks.list', GRID_BASE);
      return <div data-t="row">{cols.gridCells({ task: <div>T</div> })}</div>;
    };
    act(() => root.render(<ToastProvider><Bare /></ToastProvider>));
    await flush();
    // Three tracks, three children — a skipped cell would pull every later
    // cell one track left, under the wrong heading.
    expect(container.querySelector('[data-t="row"]').children).toHaveLength(3);
  });

  it('gridTemplate is the track list, with minmax(0,1fr) for an unset width', async () => {
    // `auto` would size to CONTENT, so one long task title would widen its
    // track and slide that row out of line with the header. `minmax(0, …)`
    // rather than bare `1fr` because a track default min-width is `auto`,
    // which refuses to shrink below its content.
    mountGrid();
    await flush();
    expect(container.querySelector('[data-t="head"]').dataset.template)
      .toBe('340px 150px minmax(0, 1fr)');
  });

  it('gridTemplate follows the arrangement, not the declaration order', async () => {
    api.get.mockResolvedValue({
      data: { 'tasks.list': { columns: [{ id: 'due', width: 200 }, { id: 'task' }, { id: 'status', hidden: true }] } },
    });
    mountGrid();
    await flush();
    expect(container.querySelector('[data-t="head"]').dataset.template)
      .toBe('200px 340px');
  });

  it('reads the SAME rows as cells() — one preferences model, two renderings', async () => {
    // The whole point of `gridCells` living on this hook rather than in a
    // second one: a saved arrangement written from a `<table>` applies to a
    // div grid on the same key, and there is only one thing to invalidate.
    api.get.mockResolvedValue({
      data: { 'tasks.list': { columns: [{ id: 'status' }, { id: 'due' }, { id: 'task' }] } },
    });
    const Both = () => {
      const cols = useColumnPrefs('tasks.list', GRID_BASE);
      return (
        <>
          <div data-t="grid">{cols.gridCells({ task: <div>T</div>, due: <div>D</div>, status: <div>S</div> })}</div>
          <table><tbody><tr data-t="tbl">{cols.cells({ task: <td>T</td>, due: <td>D</td>, status: <td>S</td> })}</tr></tbody></table>
        </>
      );
    };
    act(() => root.render(<ToastProvider><Both /></ToastProvider>));
    await flush();
    expect(text('grid')).toBe('SDT');
    expect(text('tbl')).toBe('SDT');
    expect(api.get).toHaveBeenCalledTimes(1);
  });
});

// ── visibility somebody else owns ───────────────────────────────────────────

describe("visibility: 'external' — order and width only", () => {
  const EXT = [
    { id: 'title', label: 'Title', fixed: true },
    { id: 'due', label: 'Due' },
    { id: 'f_abc', label: 'Estimate' },
  ];

  it('ignores a saved hidden flag entirely, so nothing can disappear here', () => {
    // The page decides what exists by what it passes. A row written before the
    // mode existed — or by a hand-edited body — must not be able to hide a
    // column the board's own Fields control says is showing.
    const out = reconcileColumnPrefs(
      EXT, { columns: [{ id: 'due', hidden: true }, { id: 'title' }] },
      { visibility: 'external' },
    );
    expect(out.map(c => c.id)).toEqual(['due', 'title', 'f_abc']);
    expect(out.every(c => !c.hidden)).toBe(true);
  });

  it('still applies the saved ORDER and WIDTH, which is the point', () => {
    const out = reconcileColumnPrefs(
      EXT, { columns: [{ id: 'f_abc', width: 260 }, { id: 'title' }, { id: 'due' }] },
      { visibility: 'external' },
    );
    expect(out.map(c => c.id)).toEqual(['f_abc', 'title', 'due']);
    expect(out[0].width).toBe(260);
  });

  it('tells the sheet not to offer a switch that does nothing', async () => {
    const Probe2 = () => {
      const cols = useColumnPrefs('board.table.b1', EXT, { visibility: 'external' });
      return <i data-t="owns">{String(cols.ownsVisibility)}</i>;
    };
    act(() => root.render(<ToastProvider><Probe2 /></ToastProvider>));
    await flush();
    expect(text('owns')).toBe('false');
  });
});

describe('a write carries the columns it is not currently rendering', () => {
  it('does not erase a saved position for a column the page stopped passing', async () => {
    // TableView's case: hide a custom field in BoardToolbar, then drag any
    // other column. Without this, the width PUT is built from what is on
    // screen — so the hidden field's saved POSITION is silently erased, and
    // turning it back on returns it to the end of the table rather than where
    // the user had put it. Arrangement work lost by using another control.
    api.get.mockResolvedValue({
      data: {
        'board.table.b1': {
          columns: [{ id: 'title' }, { id: 'f_gone', width: 300 }, { id: 'due' }],
        },
      },
    });
    const NowShowing = [{ id: 'title', label: 'Title' }, { id: 'due', label: 'Due' }];
    const Probe3 = () => {
      Object.assign(h, useColumnPrefs('board.table.b1', NowShowing, { visibility: 'external' }));
      return <i data-t="order">{h.columns.map(c => c.id).join(',')}</i>;
    };
    act(() => root.render(<ToastProvider><Probe3 /></ToastProvider>));
    await flush();
    // Not rendered — the page did not pass it.
    expect(text('order')).toBe('title,due');

    await act(async () => { await h.setWidth('title', 200); });
    const sent = api.put.mock.calls.at(-1)[1].columns;
    // …but still on the wire, at its saved width, so it comes back where it was.
    expect(sent.map(c => c.id)).toEqual(['title', 'due', 'f_gone']);
    expect(sent.find(c => c.id === 'f_gone').width).toBe(300);
  });
});

// ── the migration ───────────────────────────────────────────────────────────

describe('seedWidths — widths a user already dragged are moved, never dropped', () => {
  const BOARD = [
    { id: 'title', label: 'Title' },
    { id: 'due', label: 'Due' },
    { id: 'f_abc', label: 'Estimate' },
  ];

  /** Mounts the hook with a migration source, capturing the return. */
  function mountSeed({ seed, onSeeded } = {}) {
    const Probe4 = () => {
      Object.assign(h, useColumnPrefs('board.table.b1', BOARD, {
        visibility: 'external',
        seedWidths: seed,
        onSeeded,
      }));
      return <i data-t="w">{h.columns.map(c => c.width ?? '-').join(',')}</i>;
    };
    act(() => root.render(<ToastProvider><Probe4 /></ToastProvider>));
  }

  it('PUTs the local widths to the server when there is no row', async () => {
    mountSeed({ seed: () => ({ title: 260, f_abc: 140 }) });
    await flush();
    await flush();

    expect(api.put).toHaveBeenCalledTimes(1);
    const [url, body] = api.put.mock.calls[0];
    expect(url).toBe('/v1/me/column-prefs/board.table.b1');
    // The FULL arrangement in base order. A column the old store had no width
    // for keeps null — "whatever the table decides" — rather than inheriting
    // some other column's number.
    expect(body.columns).toEqual([
      { id: 'title', hidden: false, width: 260 },
      { id: 'due', hidden: false, width: null },
      { id: 'f_abc', hidden: false, width: 140 },
    ]);
    // And they are on screen immediately, not after a reload.
    expect(text('w')).toBe('260,-,140');
  });

  it('calls onSeeded only AFTER the PUT lands, so a failure loses nothing', async () => {
    const onSeeded = vi.fn();
    let resolve;
    api.put.mockImplementation(() => new Promise((r) => { resolve = r; }));
    mountSeed({ seed: () => ({ title: 260 }), onSeeded });
    await flush();
    await flush();
    expect(api.put).toHaveBeenCalled();
    // The old store must still be there while the request is in flight.
    expect(onSeeded).not.toHaveBeenCalled();
    await act(async () => { resolve({ data: {} }); });
    expect(onSeeded).toHaveBeenCalledTimes(1);
  });

  it('a failed seed does not retire the old store, and can retry', async () => {
    const onSeeded = vi.fn();
    api.put.mockRejectedValue(new Error('offline'));
    mountSeed({ seed: () => ({ title: 260 }), onSeeded });
    await flush();
    await flush();
    expect(api.put).toHaveBeenCalled();
    expect(onSeeded).not.toHaveBeenCalled();
  });

  it('a SECOND load does not re-seed — the server row now exists', async () => {
    // The condition on the whole migration: it runs on an absence, and after
    // it has run there is no absence. Re-seeding would overwrite whatever the
    // user did after migrating with the stale local copy, on every load.
    api.get.mockResolvedValue({
      data: { 'board.table.b1': { columns: [{ id: 'due', width: 90 }, { id: 'title' }] } },
    });
    mountSeed({ seed: () => ({ title: 260 }) });
    await flush();
    await flush();
    expect(api.put).not.toHaveBeenCalled();
    // The server's arrangement is what renders, not the local widths.
    expect(h.columns.map(c => c.id)).toEqual(['due', 'title', 'f_abc']);
  });

  it('never seeds before the server has answered', async () => {
    // `saved` is null both before the answer and when the answer is "no row".
    // Seeding on the first is how a real arrangement gets overwritten by a
    // stale local one on every page load.
    let land;
    api.get.mockImplementation(() => new Promise((r) => { land = r; }));
    mountSeed({ seed: () => ({ title: 260 }) });
    await flush();
    expect(api.put).not.toHaveBeenCalled();
    await act(async () => { land({ data: {} }); });
    await flush();
    expect(api.put).toHaveBeenCalledTimes(1);
  });

  it('does nothing when there is nothing to migrate', async () => {
    mountSeed({ seed: () => null });
    await flush();
    await flush();
    expect(api.put).not.toHaveBeenCalled();
  });
});


// ── the writes ──────────────────────────────────────────────────────────────

describe('save, setWidth and reset', () => {
  it('PUTs the arrangement to the caller\'s own row', async () => {
    mount();
    await flush();
    await act(async () => {
      await h.save({ columns: [{ id: 'email', hidden: false, width: 200 }, { id: 'name' }] });
    });
    expect(api.put).toHaveBeenCalledWith('/v1/me/column-prefs/graha.contacts', {
      columns: [{ id: 'email', hidden: false, width: 200 },
                { id: 'name', hidden: false, width: null }],
    });
  });

  it('writes the ORG row FIRST when both are asked for', async () => {
    // useTabPrefs' rule, for its reason: personal-then-org left the server's
    // personal row ahead of everything on screen when the second PUT failed.
    mount();
    await flush();
    await act(async () => {
      await h.save({ columns: [{ id: 'name' }], forTeam: true });
    });
    expect(api.put.mock.calls.map(c => c[0])).toEqual([
      '/v1/org/column-prefs/graha.contacts',
      '/v1/me/column-prefs/graha.contacts',
    ]);
  });

  it('a failed personal PUT changes nothing locally and answers false', async () => {
    mount();
    await flush();
    api.put.mockRejectedValueOnce({ response: { data: { detail: 'nope' } } });
    let ok;
    await act(async () => { ok = await h.save({ columns: [{ id: 'source' }] }); });
    expect(ok).toBe(false);
    expect(text('order')).toBe('name,email,phone,source');
  });

  it('setWidth persists one column\'s width without a toast', async () => {
    mount();
    await flush();
    await act(async () => { await h.setWidth('email', 240); });
    const [, payload] = api.put.mock.calls.at(-1);
    expect(payload.columns.find(c => c.id === 'email').width).toBe(240);
    // …and it survives a reload, because it went to the warm copy too.
    expect(JSON.parse(localStorage.getItem('kcols:graha.contacts'))
      .columns.find(c => c.id === 'email').width).toBe(240);
  });

  it('setWidth(null) returns a column to automatic width', async () => {
    mount();
    await flush();
    await act(async () => { await h.setWidth('email', null); });
    const [, payload] = api.put.mock.calls.at(-1);
    expect(payload.columns.find(c => c.id === 'email').width).toBe(null);
  });

  it('reset DELETEs the personal row and re-reads rather than guessing', async () => {
    // Removing the personal layer may surface an ORG default underneath, which
    // is not the shipped order — so the cache is invalidated and re-fetched.
    api.get.mockResolvedValueOnce({
      data: { 'graha.contacts': { columns: [{ id: 'phone' }], source: 'personal' } },
    });
    mount();
    await flush();
    expect(text('order')).toBe('phone,name,email,source');

    api.get.mockResolvedValueOnce({
      data: { 'graha.contacts': { columns: [{ id: 'source' }], source: 'org' } },
    });
    await act(async () => { await h.reset(); });
    await flush();
    expect(api.delete).toHaveBeenCalledWith('/v1/me/column-prefs/graha.contacts');
    expect(text('order')).toBe('source,name,email,phone');
  });
});
