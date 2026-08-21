/**
 * THE COLUMNS THE AUDIT FOUND MISSING — and the two ways a "fixed" column lies.
 *
 * Three findings live here, and every one of them is the same class of defect:
 * a table that is missing the column its readers came for. They are cheap to
 * fix and cheap to lose again, because nothing renders differently when a
 * column quietly disappears — the table still looks like a table.
 *
 *   1 · **Ganit invoices had no Place of supply and no taxable/GST split.**
 *       The two India-specific columns, and the ones a CA firm scans an invoice
 *       ledger for. The reference's own invoice table
 *       (`ScreensBiz.jsx:35-36`) is
 *       `No. · Party · Place of supply · Taxable · GST · Status`.
 *   2 · **Board Table view had no Assignees column** and carried a `Created by`
 *       that no prototype table anywhere has. Assignees is the one column every
 *       prototype task table DOES have (`ScreensWork.jsx:63`).
 *   3 · **Board Table view was read-only except for custom fields.**
 *       `IxViews.jsx` §10.3's own "today" line: "Every edit goes through the
 *       drawer. The table is read-only, which is why people export to Excel."
 *
 * ── The two lies a column can tell, both asserted below ───────────────────
 *
 * **A column that renders a field the API never sends.** This is the failure
 * mode the brief for this work named in as many words: "Check the API returns
 * them before adding the columns … rather than rendering blanks." A blank
 * column passes every rendering test ever written for it — the header is there,
 * the cells are there, the cells are empty — so the assertion has to be made
 * against the SERVER, not against the DOM. `reads the backend SELECT` below
 * opens `backend/routers/ganit.py` and reads the query. That is unusual for a
 * frontend test and it is the only assertion that can catch this: the component
 * cannot tell a field the server omits from a field the server sent as empty.
 *
 * **A blank rendered as `—`.** `ganit_invoices.place_of_supply` is
 * `TEXT DEFAULT ''` (migration 018:125) and every invoice this build GENERATES
 * leaves it empty, so the empty case is the common case rather than an edge.
 * An em dash in that cell reads as "not applicable" — but a missing place of
 * supply is a GSTR-1 blocker (`services/gst_period.py:364` flags it as
 * `place_of_supply_missing`), which is the opposite of not applicable. The
 * cell has to say so.
 *
 * Rendered with react-dom directly rather than @testing-library/react: its
 * @testing-library/dom peer is not installed, so importing it throws. Same
 * constraint `ganitErrorStates.test.jsx` and `vikrayTabStates.test.jsx` record.
 */
import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const get = vi.fn();
const patch = vi.fn();
const put = vi.fn();

vi.mock('../lib/api', () => ({
  api: {
    get: (...a) => get(...a),
    post: vi.fn(() => Promise.resolve({ data: {} })),
    patch: (...a) => patch(...a),
    put: (...a) => put(...a),
    delete: vi.fn(() => Promise.resolve({ data: {} })),
  },
  // `rows` re-implemented exactly as `lib/api` defines it: the tab unwraps
  // through it, and a mock returning the raw body would exercise a different
  // unwrapping than production does.
  rows: (r) => {
    const b = r?.data;
    if (Array.isArray(b)) return b;
    if (Array.isArray(b?.data)) return b.data;
    return [];
  },
  body: (r) => r?.data ?? {},
}));

const { ToastProvider } = await import('../components/ui');
const { default: InvoicesTab } = await import('../pages/ganit/InvoicesTab');
const { default: TableView } = await import('../components/views/TableView');

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../../..');
const readRepo = rel => readFileSync(path.join(REPO, rel), 'utf8');

let container = null;
let root = null;

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  // Fake timers because the save/fail tints are held by a `setTimeout` in the
  // component. Left real, those callbacks land after the test has returned and
  // React logs "an update was not wrapped in act(…)" for every one of them —
  // noise that would bury a real failure in this file.
  vi.useFakeTimers();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  get.mockReset();
  patch.mockReset();
  put.mockReset();
});

afterEach(() => {
  act(() => { vi.runOnlyPendingTimers(); });
  act(() => root.unmount());
  vi.useRealTimers();
  container.remove();
  container = null;
  globalThis.IS_REACT_ACT_ENVIRONMENT = false;
});

const settle = async (rounds = 6) => {
  for (let i = 0; i < rounds; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => { await Promise.resolve(); });
  }
  // Release the tint timers the commit above scheduled.
  await act(async () => { vi.runOnlyPendingTimers(); });
};

async function mount(node) {
  await act(async () => { root.render(<ToastProvider>{node}</ToastProvider>); });
  await settle();
}

/** The header labels of the first table on the page, in order. */
const headers = () =>
  [...container.querySelectorAll('table thead th')].map(th => th.textContent.trim());

// ───────────────────────────────────────────────────────────────────────────
// 1 · Ganit invoices
// ───────────────────────────────────────────────────────────────────────────

/** One intra-state invoice with a stated place of supply, one without. */
const INVOICES = [
  {
    id: 'i1',
    invoice_number: 'INV-2601',
    invoice_type: 'tax_invoice',
    invoice_date: '2026-07-04',
    contact_name: 'Wipro Consumer',
    place_of_supply: 'Maharashtra (27)',
    is_igst: false,
    subtotal: 100000,
    cgst: 9000,
    sgst: 9000,
    igst: 0,
    total: 118000,
    amount_paid: 0,
    balance_due: 118000,
    payment_status: 'unpaid',
  },
  {
    id: 'i2',
    invoice_number: 'INV-2602',
    invoice_type: 'tax_invoice',
    invoice_date: '2026-07-05',
    contact_name: 'Nirmal Exports',
    // The generated-invoice case: the column exists and holds ''.
    place_of_supply: '',
    is_igst: true,
    subtotal: 50000,
    cgst: 0,
    sgst: 0,
    igst: 9000,
    total: 59000,
    amount_paid: 59000,
    balance_due: 0,
    payment_status: 'paid',
  },
];

describe('Ganit invoices · the two India-specific columns', () => {
  it('renders Place of supply, Taxable and GST as columns', async () => {
    get.mockResolvedValue({ data: { data: INVOICES } });
    await mount(<InvoicesTab />);

    const h = headers();
    expect(h).toContain('Place of supply');
    expect(h).toContain('Taxable');
    expect(h).toContain('GST');
    // The receivables columns the build already had are NOT displaced by them.
    expect(h).toContain('Total');
    expect(h).toContain('Paid');
    expect(h).toContain('Due');
  });

  it('sums the three GST heads into one figure per row', async () => {
    get.mockResolvedValue({ data: { data: INVOICES } });
    await mount(<InvoicesTab />);

    const cells = [...container.querySelectorAll('tbody tr')]
      .map(tr => [...tr.querySelectorAll('td')].map(td => td.textContent.trim()));

    // Row 1 is intra-state: 9,000 CGST + 9,000 SGST = 18,000, and the taxable
    // value is the subtotal, NOT the total.
    expect(cells[0].join(' | ')).toContain('1,00,000');
    expect(cells[0].join(' | ')).toContain('18,000');
    // Row 2 is inter-state: the same figure has to come out of `igst` alone.
    expect(cells[1].join(' | ')).toContain('9,000');
  });

  it('states a missing place of supply rather than dashing it', async () => {
    get.mockResolvedValue({ data: { data: INVOICES } });
    await mount(<InvoicesTab />);

    const rowsOut = [...container.querySelectorAll('tbody tr')];
    expect(rowsOut[0].textContent).toContain('Maharashtra (27)');

    // THE POINT. An em dash here would read as "not applicable"; a missing
    // place of supply is a GSTR-1 blocker.
    const missing = rowsOut[1].querySelector('.gn-tbl__missing');
    expect(missing).toBeTruthy();
    expect(missing.textContent.trim()).toBe('Not set');
    expect(missing.textContent).not.toContain('—');
  });

  it('carries the supply nature on every row', async () => {
    get.mockResolvedValue({ data: { data: INVOICES } });
    await mount(<InvoicesTab />);

    const rowsOut = [...container.querySelectorAll('tbody tr')];
    expect(rowsOut[0].textContent).toContain('C+S');
    expect(rowsOut[1].textContent).toContain('IGST');
  });

  it('reads is_igst rather than deriving it from a zero GST figure', async () => {
    // A nil-rated, exempt or zero-rated EXPORT line has igst = 0 and is still
    // an inter-state supply, so a derived `igst > 0` would label it C+S and
    // put it in the wrong GSTR-1 table. The stored flag is the only answer.
    get.mockResolvedValue({
      data: { data: [{ ...INVOICES[1], id: 'i3', igst: 0, total: 50000, is_igst: true }] },
    });
    await mount(<InvoicesTab />);

    const row = container.querySelector('tbody tr');
    expect(row.textContent).toContain('IGST');
    expect(row.textContent).not.toContain('C+S');
  });

  it('reads the backend SELECT, so the columns cannot be blanks', () => {
    // The one assertion the DOM cannot make. A column bound to a field the
    // list endpoint never selects renders empty cells and passes every test
    // above that does not supply the field by hand.
    const src = readRepo('backend/routers/ganit.py');
    const listQuery = src.slice(
      src.indexOf('async def list_invoices'),
      src.indexOf('@router.post("/invoices")'),
    );
    expect(listQuery).toContain('async def list_invoices');
    expect(listQuery).toContain('i.place_of_supply');
    expect(listQuery).toContain('i.is_igst');
    expect(listQuery).toContain('i.subtotal');
    expect(listQuery).toContain('i.cgst');
    expect(listQuery).toContain('i.sgst');
    expect(listQuery).toContain('i.igst');
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 2 · Board Table view — the Assignees column
// ───────────────────────────────────────────────────────────────────────────

const COLUMNS = [
  { column_id: 'c1', name: 'To do', color: '#888888' },
  { column_id: 'c2', name: 'Doing', color: '#4444ff' },
];

const MEMBERS = [
  { user_id: 'u1', full_name: 'Aanya Mehta' },
  { user_id: 'u2', full_name: 'Rohan Iyer' },
];

const task = over => ({
  task_id: 't1',
  title: 'Reconcile input tax credit',
  column_id: 'c1',
  priority: 'high',
  status: 'todo',
  due_at: null,
  assignee_user_ids: ['u1'],
  assignee_names: ['Aanya Mehta'],
  ...over,
});

const mountTable = (tasks, extra = {}) => mount(
  <TableView
    tasks={tasks}
    columns={COLUMNS}
    teamMembers={MEMBERS}
    fieldDefs={[]}
    fieldValueMap={{}}
    boardId="b1"
    onTasksChange={() => {}}
    sort={null}
    onSort={() => {}}
    {...extra}
  />,
);

describe('Board Table view · Assignees, and no Created by', () => {
  it('has an Assignees column and does not have Created by', async () => {
    await mountTable([task()]);

    const h = headers();
    expect(h.some(t => t.startsWith('Assignees'))).toBe(true);
    // No prototype table anywhere carries this. `ScreensWork.jsx:63` is
    // Task · Project · Assignees · Due · Status.
    expect(h.some(t => /created by/i.test(t))).toBe(false);
  });

  it('names a single assignee and says Unassigned rather than nothing', async () => {
    await mountTable([task(), task({ task_id: 't2', assignee_user_ids: [], assignee_names: [] })]);

    const rowsOut = [...container.querySelectorAll('tbody tr')];
    expect(rowsOut[0].textContent).toContain('Aanya Mehta');
    // An empty cell is indistinguishable from a cell that failed to render.
    expect(rowsOut[1].textContent).toContain('Unassigned');
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 3 · Board Table view — inline cell edit
// ───────────────────────────────────────────────────────────────────────────

/** Every `.tb__cell` in the first body row, keyed by the column it sits in. */
const cellButtons = () => {
  const tr = container.querySelector('tbody tr');
  return [...tr.querySelectorAll('button.tb__cell')];
};

const click = el => act(() => {
  el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
});

const change = (el, value) => act(async () => {
  // React 19 reads the value off the node, and assigning `.value` directly is
  // swallowed by its value tracker — the setter has to be called on the
  // prototype so the tracker sees a change and lets `onChange` through.
  const proto = Object.getPrototypeOf(el);
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
  el.dispatchEvent(new Event('change', { bubbles: true }));
  // `commitCell` is async. Its continuation — the optimistic revert, the
  // status merge, the toast — lands on a later microtask, and outside this
  // `act` scope every one of those is an unwrapped update.
  for (let i = 0; i < 6; i += 1) await Promise.resolve();
});

describe('Board Table view · inline cell edit', () => {
  it('turns the priority cell into a control and PATCHes one id', async () => {
    patch.mockResolvedValue({ data: { results: [{ task_id: 't1', ok: true, status: 'todo' }] } });
    const seen = [];
    await mount(
      <TableView
        tasks={[task()]}
        columns={COLUMNS}
        teamMembers={MEMBERS}
        fieldDefs={[]}
        fieldValueMap={{}}
        boardId="b1"
        onTasksChange={fn => seen.push(typeof fn === 'function' ? fn([task()]) : fn)}
        sort={null}
        onSort={() => {}}
      />,
    );

    // Column · Priority · Assignees · Due — four editable cells, and the title
    // is deliberately not one of them.
    const cells = cellButtons();
    expect(cells.length).toBe(4);

    const priorityCell = cells[1];
    expect(priorityCell.textContent).toContain('High');
    await click(priorityCell);

    const control = container.querySelector('tbody select.tb__edit');
    expect(control).toBeTruthy();
    expect(control.getAttribute('aria-label')).toContain('Priority');

    await change(control, 'low');
    await settle();

    // The write path that already exists, with ONE id — not a new endpoint.
    expect(patch).toHaveBeenCalledTimes(1);
    const [url, payload] = patch.mock.calls[0];
    expect(url).toBe('/v1/tasks/bulk');
    expect(payload.task_ids).toEqual(['t1']);
    expect(payload.patch).toEqual({ priority: 'low' });
    // Optimistic: the table was told before the server answered.
    expect(seen[0][0].priority).toBe('low');
  });

  it('reverts the cell when the server refuses on a 200', async () => {
    // `PATCH /v1/tasks/bulk` answers 200 for a partially-applied batch and
    // reports each id in `results`. Reading only the HTTP status would paint a
    // denied edit as saved — which is the whole reason this route is used.
    patch.mockResolvedValue({
      data: { results: [{ task_id: 't1', ok: false, error: 'not permitted' }] },
    });
    const applied = [];
    const start = task();
    await mount(
      <TableView
        tasks={[start]}
        columns={COLUMNS}
        teamMembers={MEMBERS}
        fieldDefs={[]}
        fieldValueMap={{}}
        boardId="b1"
        onTasksChange={fn => applied.push(fn([start]))}
        sort={null}
        onSort={() => {}}
      />,
    );

    await click(cellButtons()[1]);
    await change(container.querySelector('tbody select.tb__edit'), 'low');
    await settle();

    // Two writes: the optimistic one, then the restore.
    expect(applied.length).toBe(2);
    expect(applied[0][0].priority).toBe('low');
    expect(applied[1][0].priority).toBe('high');
    expect(container.textContent).toContain('Could not save that change');
  });

  it('does not offer a one-pick assignee editor on a row with two people', async () => {
    // `assignee_user_ids` is a list and a `<select>` can only REPLACE it. On a
    // row with two people a single click would silently drop one, which is a
    // write nobody asked for — so that cell is not an editor at all.
    await mountTable([task({
      assignee_user_ids: ['u1', 'u2'],
      assignee_names: ['Aanya Mehta', 'Rohan Iyer'],
    })]);

    // Column · Priority · Due are still triggers; Assignees is not.
    expect(cellButtons().length).toBe(3);
    expect(container.querySelector('tbody .tb__asg')).toBeTruthy();
    expect(container.querySelector('button.tb__cell .tb__asg')).toBeFalsy();
  });

  it('does not offer a column editor when no columns are loaded', async () => {
    await mountTable([task()], { columns: [] });

    expect(container.querySelector('tbody .tb__none')).toBeTruthy();
    expect(container.querySelector('button.tb__cell .tb__none')).toBeFalsy();
  });

  it('leaves a non-editable cell able to open the drawer', async () => {
    // A `disabled` <button> swallows the click OUTRIGHT — it does not fire and
    // it does not bubble — so a cell that merely cannot be edited inline would
    // also stop opening the record. That is worse than the read-only cell it
    // replaced, and it is why `CellTrigger` renders no wrapper at all rather
    // than a disabled one. Asserted structurally: nothing sits between the
    // avatar stack and the <td> whose click the row is listening for.
    await mountTable([task({
      assignee_user_ids: ['u1', 'u2'],
      assignee_names: ['Aanya Mehta', 'Rohan Iyer'],
    })]);

    const stack = container.querySelector('tbody .tb__asg');
    expect(stack.closest('button')).toBeNull();
    expect(stack.closest('td')).toBeTruthy();
  });

  it('sends assignee as the wire field and shows the name straight away', async () => {
    patch.mockResolvedValue({ data: { results: [{ task_id: 't1', ok: true }] } });
    const applied = [];
    const start = task({ assignee_user_ids: [], assignee_names: [] });
    await mount(
      <TableView
        tasks={[start]}
        columns={COLUMNS}
        teamMembers={MEMBERS}
        fieldDefs={[]}
        fieldValueMap={{}}
        boardId="b1"
        onTasksChange={fn => applied.push(fn([start]))}
        sort={null}
        onSort={() => {}}
      />,
    );

    await click(cellButtons()[2]);
    await change(container.querySelector('tbody select.tb__edit'), 'u2');
    await settle();

    // `assignee_names` is a DISPLAY field; `BulkTaskPatch` is `extra="forbid"`
    // and would reject it. It must not be on the wire, and it must be in the
    // local merge or the row would show the old name beside the new id.
    expect(patch.mock.calls[0][1].patch).toEqual({ assignee_user_ids: ['u2'] });
    expect(applied[0][0].assignee_names).toEqual(['Rohan Iyer']);
  });

  it('takes the server status over the one it asked for', async () => {
    // Moving into a column flagged `is_done` forces `done`. The route says so
    // in its answer; a naive local merge would leave the row on `todo` and
    // disagree with the same card dragged on the Kanban board.
    patch.mockResolvedValue({ data: { results: [{ task_id: 't1', ok: true, status: 'done' }] } });
    const applied = [];
    const start = task();
    await mount(
      <TableView
        tasks={[start]}
        columns={COLUMNS}
        teamMembers={MEMBERS}
        fieldDefs={[]}
        fieldValueMap={{}}
        boardId="b1"
        onTasksChange={fn => applied.push(fn([start]))}
        sort={null}
        onSort={() => {}}
      />,
    );

    await click(cellButtons()[0]);
    await change(container.querySelector('tbody select.tb__edit'), 'c2');
    await settle();

    expect(patch.mock.calls[0][1].patch).toEqual({ column_id: 'c2' });
    expect(applied[applied.length - 1][0].status).toBe('done');
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 4 · Vikray opens on the tab its own header comment names
// ───────────────────────────────────────────────────────────────────────────

describe('Vikray · the landing tab', () => {
  it('opens on pipeline, as the reference screen does', () => {
    // Asserted against the SOURCE rather than by mounting the page: the page
    // fires a dashboard request on mount and the six tab components between
    // them reach a dozen endpoints, so a mount test here would be measuring
    // the mocks. What is being fixed is one initial value.
    //
    // Tab prefs (proposal 67, 2026-08-19) moved where that value lives: a
    // person's starred default now outranks it, and the reference's landing
    // tab survives as the FALLBACK the hook is handed. The pin follows the
    // value to its new home — deleting the fallback, or quietly changing it
    // to 'dashboard', still fails here.
    const src = readRepo('frontend/src/pages/VikrayPage.jsx');
    expect(src).toMatch(/useTabPrefs\('vikray', TABS, \{ fallback: 'pipeline' \}\)/);

    // And the WIRING, not just the argument: the hook's output must actually
    // drive the landing tab. A fallback pinned above is inert the moment the
    // page stops consuming `prefs.defaultTab` — a rewrite to
    // `picked ?? 'dashboard'` would keep the line above green while landing
    // every visit on the dashboard again.
    //
    // REPOINTED 2026-08-21, and the reason is the point. This asserted the
    // literal `const tab = picked ?? prefs.defaultTab`, and the open tab has
    // since moved into the URL so that a deal or order opened from a bookmark
    // has the right list underneath it. The landing behaviour is unchanged —
    // a visit with no `?tab=` still resolves to the hook's fallback — but the
    // line the pin named is gone.
    //
    // So it now pins the PROPERTY rather than the spelling: `prefs.defaultTab`
    // must be what the page falls back to when the URL names no tab. A rewrite
    // to `: 'dashboard'` still fails here, which is the whole job. Matching a
    // line of source was always the weaker form of this test; it just took a
    // legitimate refactor to show it.
    expect(src, 'the page no longer falls back to the starred default')
      .toMatch(/urlTab\s*:\s*prefs\.defaultTab/);
    expect(src, 'the landing tab is hardcoded rather than coming from prefs')
      .not.toMatch(/:\s*'dashboard'\s*;/);

    // And the reference it is copied from, so this cannot be "corrected" back
    // without the correction disagreeing with the prototype in the same run.
    const ref = readRepo('design-reference/Kartavaya Redesign/ScreensBiz.jsx');
    const screen = ref.slice(ref.indexOf('function ScreenVikray'));
    expect(screen.slice(0, 400)).toContain("React.useState('pipeline')");
  });
});
