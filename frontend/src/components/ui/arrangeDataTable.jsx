import React from 'react';
import { createPortal } from 'react-dom';
import { Table, TableHead, TableBody, HeadCell } from './Table';
import useColumnPrefs from '../../hooks/useColumnPrefs';
import { ColumnsButton } from './CustomizeColumns';
import { useColumnsSlot } from './columnsSlot';

/**
 * arrangeDataTable — how the ~70 `<DataTable>` call sites become arrangeable
 * without ~70 edits, and the argument for why it is done THIS way.
 *
 * ── THE PROBLEM, STATED EXACTLY ────────────────────────────────────────────
 *
 * `<DataTable columns={…}>` renders its HEADERS from the `columns` array. Its
 * BODY comes from each page's own children:
 *
 *     <DataTable columns={['Name', 'Email', 'Type']}>
 *       {rows.map(r => <tr key={r.id}><Td>{r.name}</Td><Td>{r.email}</Td><Td>{r.type}</Td></tr>)}
 *     </DataTable>
 *
 * Nothing anywhere says the second `<Td>` is the Email column. It is the Email
 * column because it is second. So a naive `arrange` prop that reordered only
 * `columns` would leave every body row in shipped order under a rearranged
 * header — silently, on ~70 tables, showing each person's email under the
 * heading "Type". A wrong value under a confident label is worse than a
 * missing feature, and it is the exact failure a "just add a prop" version
 * produces.
 *
 * ── THE TWO CANDIDATE FIXES ────────────────────────────────────────────────
 *
 * (a) Opt each page in individually: give every `<Td>` a column id and switch
 *     the body to `cols.cells({…})`, as the three worked examples do. Correct,
 *     and about seventy files of mechanical edits — each one an opportunity to
 *     mistype an id, which fails as a BLANK cell rather than as an error.
 *
 * (b) Make `DataTable` know which cell is which column WITHOUT being told:
 *     the fact the header list already relies on. Position IS the identity
 *     here — cell *i* of every row is column *i* of `columns`, and the pages
 *     depend on that so completely that they never wrote it down. An
 *     arrangement is a permutation of base indices, so the same permutation
 *     applied to each row's children keeps the header and the body in step by
 *     construction.
 *
 * (b) is chosen, and the reason is not the file count. It is that (a) makes
 *     head/body agreement a thing seventy files each promise separately, while
 *     (b) makes it a thing one function cannot get wrong for one and right for
 *     another. The three hand-written opt-ins keep `cells()` because they
 *     genuinely need it — their rows carry conditional cells and per-cell
 *     classes — and this covers the rest.
 *
 * ── WHERE POSITION IS NOT THE IDENTITY, AND WHAT HAPPENS THEN ──────────────
 *
 * A row whose cell count does not equal the base column count is NOT a row
 * this can permute, and every one of these is real in the tree:
 *
 *   · `<tr><td colSpan={5}>Nothing yet</td></tr>` — an inline empty state;
 *   · a row with a conditional cell (`{canEdit && <Td/>}`), where the count
 *     changes per row and per user;
 *   · a sub-header or group row spanning the table.
 *
 * Such a row is passed through UNTOUCHED, and its `colSpan` is retargeted to
 * the visible count so a spanning row still spans. Passing it through is the
 * conservative answer: a row that spans is not lying about which column it is
 * in, whereas a row we guessed a permutation for would be.
 *
 * ── COLUMN IDS ─────────────────────────────────────────────────────────────
 *
 * The id is the row's identity in the database for ever, so it is derived from
 * the LABEL (slugged), not from the index — a label is what the page is about
 * and it survives a column being inserted before it. Two columns with the same
 * slug, and the blank-label action columns that several tables end with, fall
 * back to a positional `c{i}`; those are marked `fixed` as well, because an
 * action column that a stale arrangement could hide leaves a table you cannot
 * act on. A page that wants a stable id for a blank column passes `id`
 * explicitly on the column object, and should.
 */

/** `'Daily budget'` → `'daily_budget'`. Empty for a blank or symbol-only label. */
export function slugColumnId(label) {
  return String(label ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/**
 * The page's `columns` prop → the `useColumnPrefs` base declaration.
 *
 * Pure and exported so the spec can state the id rules without a DOM. The
 * order of this list is the POSITIONAL order the body rows are written in,
 * which is what makes the permutation below meaningful.
 */
export function baseColumnsFrom(columns) {
  const seen = new Set();
  return (columns || []).map((c, i) => {
    const col = c && typeof c === 'object' ? c : { label: c };
    const label = col.label ?? '';
    let id = col.id || slugColumnId(label);
    // A blank label is an actions column at ~15 sites. It gets a positional id
    // and is pinned: hiding it is how a table loses its only verb.
    const blank = !id;
    if (blank || seen.has(id)) id = `c${i}`;
    seen.add(id);
    return {
      ...col,
      id,
      // The sheet lists columns by name; a blank one needs something to be
      // called or the row is an unlabelled checkbox. `blank` is what keeps
      // that name OUT of the header — see the render below. Caught by
      // `arrangeDataTable.test.jsx` before it shipped: without the flag, the
      // ~15 tables that end in an unlabelled actions column would all have
      // grown a visible "Actions" heading they never had.
      label: label || 'Actions',
      blank,
      num: col.align === 'right',
      fixed: col.fixed ?? blank,
    };
  });
}

/**
 * Reorder one row's cells by `order` — an array of base indices, in the
 * arranged order, with the hidden ones already removed.
 *
 * Returns the row unchanged when its cell count does not match `width` (the
 * base column count), which is the mismatch case documented above.
 */
export function arrangeRow(row, order, width, visibleCount) {
  if (!React.isValidElement(row)) return row;
  // A fragment holding rows — `<>{a}{b}</>` — is a shape several tabs use for
  // a row plus its expanded detail row. Recurse rather than treating the
  // fragment as one row with two cells.
  if (row.type === React.Fragment) {
    return React.cloneElement(row, undefined,
      React.Children.map(row.props.children, (c) => arrangeRow(c, order, width, visibleCount)));
  }
  const cells = React.Children.toArray(row.props?.children);
  if (cells.length !== width) {
    // Not a positional row. Retarget any full-width span so a spanning row
    // still spans after columns were hidden, and leave everything else alone.
    if (cells.length === 1 && React.isValidElement(cells[0])
        && Number(cells[0].props?.colSpan) === width) {
      return React.cloneElement(row, undefined,
        React.cloneElement(cells[0], { colSpan: visibleCount }));
    }
    return row;
  }
  return React.cloneElement(row, undefined, order.map((i) => cells[i]));
}

/**
 * The arranged rendering. A separate COMPONENT rather than a branch inside
 * `DataTable`, because `useColumnPrefs` is a hook: a `DataTable` that called
 * it only when `arrange` was set would change its own hook count the first
 * time a page passed the prop conditionally. Two components cannot.
 *
 * `Wrap` lets the three `DataTable` copies (the barrel, dristi, prachar) share
 * this while keeping their own table shells if they ever diverge — today all
 * three render the same `.tbl__wrap > table.tbl`, so all three pass nothing.
 */
export function ArrangedDataTable({ arrange, columns, children, label = 'Columns' }) {
  const base = React.useMemo(() => baseColumnsFrom(columns), [columns]);
  const cols = useColumnPrefs(arrange, base);
  const slot = useColumnsSlot();

  // The permutation, as base indices. `columns` is already in base order, so
  // an id → index map is all that is needed and it is the ONLY place the two
  // orders are related.
  const index = React.useMemo(() => {
    const m = new Map(base.map((c, i) => [c.id, i]));
    return cols.columns.map((c) => m.get(c.id)).filter((i) => i != null);
  }, [base, cols.columns]);

  const body = React.useMemo(
    () => React.Children.map(children, (r) => arrangeRow(r, index, base.length, index.length)),
    [children, index, base.length],
  );

  const button = <ColumnsButton cols={cols} label={label} />;

  return (
    <>
      {/* Most of the tables this reaches have no `TableToolbar` — they are a
          bare `<DataTable>` inside a Section or a Panel — so the control needs
          a line of its own. It is trailing-aligned and unframed: it belongs to
          the table under it, and a bar with a border would read as a second
          header above the header.

          Four tables DO have a toolbar (`manav/NoticesTab` twice, `DscTab`,
          `UdinTab`) and were showing that line directly under it: two rows of
          chrome for one table. Where the page has paired the two with
          `ArrangedTableSection`, the button goes into the toolbar instead — the
          same element, the same hook instance, a different parent. */}
      {slot
        ? createPortal(button, slot)
        : <div className="tbl__abar">{button}</div>}
      <Table>
        <TableHead>
          {cols.columns.map((c) => (
            <HeadCell
              key={c.id}
              num={c.num}
              className={c.className || ''}
              width={c.width}
              onResize={(w) => cols.setWidth(c.id, w)}
            >
              {/* A blank-label column stays blank to the eye and gains a name
                  to a screen reader, which is strictly better than the empty
                  `<th>` it replaces: the actions column was previously
                  announced as nothing at all. The visible header must not
                  change — the name exists for the customise sheet, and the
                  sheet is not the table. */}
              {c.blank ? <span className="k-sr-only">{c.label}</span> : c.label}
            </HeadCell>
          ))}
        </TableHead>
        <TableBody>{body}</TableBody>
      </Table>
    </>
  );
}

export default ArrangedDataTable;
