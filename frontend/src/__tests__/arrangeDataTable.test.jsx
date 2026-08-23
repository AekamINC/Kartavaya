/**
 * `<DataTable arrange>` — the head/body permutation that ~56 tables now depend
 * on, and the two shapes that must NOT be permuted.
 *
 * ── Why this file is the one that matters ──────────────────────────────────
 *
 * Every other opt-in in this programme names its cells: `cols.cells({ name:
 * …, email: … })`, so a mistake shows up as a blank cell. `<DataTable>` has no
 * names. Its body comes from each page's own `<Td>` children and cell *i* is
 * column *i* because it always has been — the pages depend on that so
 * completely that not one of them wrote it down. So the failure mode here is
 * not a blank cell. It is every person's email address rendered under the
 * heading "Type", on ~56 tables, silently, and with the numbers still adding
 * up. A wrong value under a confident label is worse than a missing feature.
 *
 * Which is why the assertions below are about PAIRS — heading text against the
 * cell under it — rather than about either list on its own. A test that
 * checked the headers reordered would have passed against the naive version
 * this replaced, and that version was wrong on every row.
 *
 * Rendered with react-dom directly: @testing-library/react is installed but its
 * @testing-library/dom peer is not, so importing it throws. Same reason as
 * `useColumnPrefs.test.jsx`.
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
import { _resetColumnPrefsCache } from '../hooks/useColumnPrefs';
import { DataTable, Td } from '../components/editorial/ModuleUI';
import TableToolbar, { ArrangedTableSection } from '../components/ui/TableToolbar';
import { baseColumnsFrom, slugColumnId } from '../components/ui/arrangeDataTable';

const COLUMNS = ['Name', 'Email', { label: 'Score', align: 'right' }, { label: '' }];

let container = null;
let root = null;

const mount = (node) => act(() => root.render(<ToastProvider>{node}</ToastProvider>));
const flush = async () => { await act(async () => { await Promise.resolve(); }); };

/** The heading text of each rendered column, in screen order. */
const heads = () => [...container.querySelectorAll('thead th')]
  .map(th => th.textContent.trim());
/** The first body row's cell text, in screen order. */
const cells = () => [...container.querySelectorAll('tbody tr:first-child td')]
  .map(td => td.textContent.trim());
/** What a reader actually sees: heading → value, paired. This is the assertion
 *  that has teeth; either list alone can be right while the table lies. */
const pairs = () => heads().map((h, i) => `${h}=${cells()[i]}`);

/** The slice of `useTableView` that `TableToolbar` reads. Enough to render;
 *  this file is not testing the toolbar. */
const VIEW = {
  query: '', onSearch: () => {}, from: 1, to: 1, matched: 1, loaded: 1,
  filters: [], filterOptions: {}, picked: {}, onFilter: () => {},
  clearFilters: () => {}, activeFilters: 0,
  page: 1, setPage: () => {}, pageCount: 1, pageSize: 25, onPageSize: () => {},
  truncated: false, total: 1,
};

function Fixture({ arrange = 'test.people', columns = COLUMNS }) {
  return (
    <DataTable columns={columns} arrange={arrange}>
      <tr>
        <Td>Asha</Td><Td>asha@x.in</Td><Td align="right">7</Td><Td>edit</Td>
      </tr>
    </DataTable>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  _resetColumnPrefsCache();
  localStorage.clear();
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  api.get.mockResolvedValue({ data: {} });
  api.put.mockResolvedValue({ data: {} });
  api.delete.mockResolvedValue({ data: {} });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

// ── the id derivation ───────────────────────────────────────────────────────

describe('column ids come from the LABEL, not the index', () => {
  it('slugs a label', () => {
    expect(slugColumnId('Daily budget')).toBe('daily_budget');
    expect(slugColumnId('Reply due')).toBe('reply_due');
  });

  it('is empty for a blank or symbol-only label, which is the fallback signal', () => {
    expect(slugColumnId('')).toBe('');
    expect(slugColumnId('—')).toBe('');
    expect(slugColumnId(undefined)).toBe('');
  });

  it('survives a column being INSERTED before it, which an index id would not', () => {
    // The whole reason ids are not positional: a saved arrangement is read for
    // ever, and inserting a column at the front must not silently re-point
    // every saved id at its neighbour.
    const before = baseColumnsFrom(['Name', 'Email']).map(c => c.id);
    const after = baseColumnsFrom(['Code', 'Name', 'Email']).map(c => c.id);
    expect(before).toEqual(['name', 'email']);
    expect(after).toEqual(['code', 'name', 'email']);
  });

  it('gives a blank-label column a positional id AND pins it', () => {
    // ~15 tables end with an unlabelled actions column. It gets `c{i}` because
    // there is nothing to slug, and `fixed` because hiding it is how a table
    // loses its only verb.
    const out = baseColumnsFrom(COLUMNS);
    expect(out.map(c => c.id)).toEqual(['name', 'email', 'score', 'c3']);
    expect(out[3].fixed).toBe(true);
    // It still needs a NAME in the sheet, or the user is offered an unlabelled
    // checkbox.
    expect(out[3].label).toBe('Actions');
    // …and `blank` is what keeps that name out of the rendered header.
    expect(out[3].blank).toBe(true);
  });

  it('renders a blank-label header BLANK, with the name only for a reader', async () => {
    // The regression this caught before it shipped: giving the sheet a name
    // for the unlabelled actions column also printed "Actions" into the
    // header of the ~15 tables that end in one. It is sr-only instead, which
    // is better than the empty `<th>` it replaces — that announced nothing.
    mount(<Fixture />);
    await flush();
    const last = container.querySelectorAll('thead th')[3];
    expect(last.querySelector('.k-sr-only')?.textContent).toBe('Actions');
    expect(last.childNodes[0].nodeType).toBe(Node.ELEMENT_NODE);
  });

  it('disambiguates two columns that slug to the same id', () => {
    const out = baseColumnsFrom(['Amount', 'Amount']);
    expect(out.map(c => c.id)).toEqual(['amount', 'c1']);
  });

  it('an explicit id on the column object wins over the slug', () => {
    expect(baseColumnsFrom([{ label: '', id: 'actions' }])[0].id).toBe('actions');
  });

  it('carries align="right" through as the num flag', () => {
    expect(baseColumnsFrom(COLUMNS)[2].num).toBe(true);
  });
});

// ── the permutation ─────────────────────────────────────────────────────────

describe('the body follows the head, which is the whole point', () => {
  it('renders shipped order when nothing is saved', async () => {
    mount(<Fixture />);
    await flush();
    expect(pairs()).toEqual(['Name=Asha', 'Email=asha@x.in', 'Score=7', 'Actions=edit']);
  });

  it('REORDERS the cells with the headers, not the headers alone', async () => {
    // The defect this exists to prevent: a naive `arrange` moved the headings
    // and left the body in shipped order, so Email rendered under "Score".
    api.get.mockResolvedValue({
      data: { 'test.people': { columns: [{ id: 'score' }, { id: 'name' }, { id: 'email' }, { id: 'c3' }] } },
    });
    mount(<Fixture />);
    await flush();
    expect(pairs()).toEqual(['Score=7', 'Name=Asha', 'Email=asha@x.in', 'Actions=edit']);
  });

  it('drops a hidden column from BOTH the head and every row', async () => {
    api.get.mockResolvedValue({
      data: { 'test.people': { columns: [{ id: 'name' }, { id: 'email', hidden: true }, { id: 'score' }, { id: 'c3' }] } },
    });
    mount(<Fixture />);
    await flush();
    expect(heads()).toHaveLength(3);
    expect(cells()).toHaveLength(3);
    expect(pairs()).toEqual(['Name=Asha', 'Score=7', 'Actions=edit']);
  });

  it('cannot hide the pinned actions column, whatever the saved row says', async () => {
    api.get.mockResolvedValue({
      data: { 'test.people': { columns: [{ id: 'name' }, { id: 'c3', hidden: true }] } },
    });
    mount(<Fixture />);
    await flush();
    expect(cells()).toContain('edit');
  });

  it('applies a saved WIDTH to the header cell', async () => {
    api.get.mockResolvedValue({
      data: { 'test.people': { columns: [{ id: 'name', width: 260 }] } },
    });
    mount(<Fixture />);
    await flush();
    expect(container.querySelector('thead th').style.width).toBe('260px');
  });

  it('grows a resize divider on every header, and it is a real button', async () => {
    // Keyboard accessibility here was fixed BY HAND (5cb76413, React Aria
    // rejected). A divider that is not focusable is that fix regressing.
    mount(<Fixture />);
    await flush();
    const grips = container.querySelectorAll('thead .tbl__grip');
    expect(grips).toHaveLength(4);
    expect(grips[0].tagName).toBe('BUTTON');
    expect(grips[0].getAttribute('role')).toBe('separator');
  });

  it('offers the sheet, with the hidden count on it', async () => {
    api.get.mockResolvedValue({
      data: { 'test.people': { columns: [{ id: 'name' }, { id: 'email', hidden: true }, { id: 'score' }, { id: 'c3' }] } },
    });
    mount(<Fixture />);
    await flush();
    const btn = container.querySelector('.kcols__btn');
    expect(btn).toBeTruthy();
    expect(btn.textContent).toContain('1 hidden');
  });
});

// ── the shapes that must NOT be permuted ────────────────────────────────────

describe('a row whose cells are not one-per-column is passed through', () => {
  it('leaves a colSpan empty-state row alone, and retargets the span', async () => {
    // `<tr><td colSpan={4}>Nothing yet</td></tr>` is an inline empty state at
    // several sites. It has one cell for four columns; permuting it would
    // index off the end. Hiding a column must still leave it spanning.
    api.get.mockResolvedValue({
      data: { 'test.people': { columns: [{ id: 'name' }, { id: 'email', hidden: true }, { id: 'score' }, { id: 'c3' }] } },
    });
    mount(
      <DataTable columns={COLUMNS} arrange="test.people">
        <tr><td colSpan={4}>Nothing yet</td></tr>
      </DataTable>,
    );
    await flush();
    const td = container.querySelector('tbody td');
    expect(td.textContent).toBe('Nothing yet');
    expect(td.getAttribute('colspan')).toBe('3');
  });

  it('leaves a row with a CONDITIONAL cell alone rather than guessing', async () => {
    // `{canEdit && <Td/>}` makes the count vary per row and per user. A
    // permutation we cannot justify is worse than shipped order, because
    // shipped order is at least what the page meant.
    api.get.mockResolvedValue({
      data: { 'test.people': { columns: [{ id: 'score' }, { id: 'name' }, { id: 'email' }, { id: 'c3' }] } },
    });
    mount(
      <DataTable columns={COLUMNS} arrange="test.people">
        <tr><Td>Asha</Td><Td>asha@x.in</Td><Td>7</Td></tr>
      </DataTable>,
    );
    await flush();
    expect(cells()).toEqual(['Asha', 'asha@x.in', '7']);
  });

  it('recurses into a fragment holding two rows', async () => {
    // `<>{row}{detailRow}</>` is how several tabs render a row plus its
    // expansion. Treating the fragment as one row with two cells would permute
    // nothing and pass through everything.
    api.get.mockResolvedValue({
      data: { 'test.people': { columns: [{ id: 'score' }, { id: 'name' }, { id: 'email' }, { id: 'c3' }] } },
    });
    mount(
      <DataTable columns={COLUMNS} arrange="test.people">
        <React.Fragment key="a">
          <tr><Td>Asha</Td><Td>asha@x.in</Td><Td>7</Td><Td>edit</Td></tr>
          <tr><td colSpan={4}>detail</td></tr>
        </React.Fragment>
      </DataTable>,
    );
    await flush();
    expect(pairs()).toEqual(['Score=7', 'Name=Asha', 'Email=asha@x.in', 'Actions=edit']);
    expect(container.querySelectorAll('tbody tr')).toHaveLength(2);
  });
});

// ── one row of chrome ───────────────────────────────────────────────────────

describe('a table that already has a toolbar does not grow a second line', () => {
  it('renders its own bar when there is no toolbar to join', async () => {
    mount(<Fixture />);
    await flush();
    expect(container.querySelector('.tbl__abar .kcols__btn')).toBeTruthy();
  });

  it('portals the control INTO the toolbar when the page pairs them', async () => {
    // `manav/NoticesTab` (twice), `DscTab` and `UdinTab` render a
    // `<TableToolbar>` immediately above the table, so the table's own bar was
    // a second row of chrome holding one button.
    mount(
      <ArrangedTableSection>
        <TableToolbar view={VIEW} label="notices" showSearch={false} />
        <Fixture />
      </ArrangedTableSection>,
    );
    await flush();
    // In the toolbar…
    expect(container.querySelector('.tv .tv__cols .kcols__btn')).toBeTruthy();
    // …and NOT also on a line of its own. This is the assertion that fails if
    // somebody later renders the button in both places "to be safe".
    expect(container.querySelector('.tbl__abar')).toBeNull();
    // Exactly one control, so the sheet cannot be opened from two buttons
    // reading two different hook instances.
    expect(container.querySelectorAll('.kcols__btn')).toHaveLength(1);
  });

  it('still shows the hidden count from inside the toolbar', async () => {
    // The button is the SAME element with the same hook behind it — only its
    // parent changed. If the portal ever became a second `useColumnPrefs`
    // call, this count would read 0 while the table rendered three columns.
    api.get.mockResolvedValue({
      data: { 'test.people': { columns: [{ id: 'name' }, { id: 'email', hidden: true }, { id: 'score' }, { id: 'c3' }] } },
    });
    mount(
      <ArrangedTableSection>
        <TableToolbar view={VIEW} label="notices" showSearch={false} />
        <Fixture />
      </ArrangedTableSection>,
    );
    await flush();
    expect(container.querySelector('.tv__cols .kcols__btn').textContent)
      .toContain('1 hidden');
    expect(heads()).toHaveLength(3);
  });

  it('leaves a toolbar with no arrangeable table exactly as it was', async () => {
    mount(
      <ArrangedTableSection>
        <TableToolbar view={VIEW} label="notices" showSearch={false} />
      </ArrangedTableSection>,
    );
    await flush();
    // The span exists and is empty; nothing else about the toolbar moves.
    expect(container.querySelector('.tv__cols')).toBeTruthy();
    expect(container.querySelector('.kcols__btn')).toBeNull();
  });
});

// ── the opt-in is opt-in ────────────────────────────────────────────────────

describe('without arrange, nothing changes at all', () => {
  it('renders the shipped columns and asks the server for nothing', async () => {
    mount(
      <DataTable columns={COLUMNS}>
        <tr><Td>Asha</Td><Td>asha@x.in</Td><Td align="right">7</Td><Td>edit</Td></tr>
      </DataTable>,
    );
    await flush();
    // The blank header is EMPTY here, not sr-only: the un-arranged path is the
    // original code and is untouched by this work. That difference is the
    // measure of the blast radius — a table that has not opted in renders
    // byte-for-byte what it rendered before.
    expect(pairs()).toEqual(['Name=Asha', 'Email=asha@x.in', 'Score=7', '=edit']);
    // No hook, so no fetch, and no toolbar row appears over the tables that
    // have not opted in.
    expect(api.get).not.toHaveBeenCalled();
    expect(container.querySelector('.tbl__abar')).toBeNull();
    expect(container.querySelector('.tbl__grip')).toBeNull();
  });
});
