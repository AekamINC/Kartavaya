/* ── The module table adapter ──────────────────────────────────────────────
 *
 * `DataTable` and `Td` keep the names and the exact prop shape that
 * `components/editorial/ModuleUI.jsx` exports, and render the UNIFIED table
 * instead: `.tbl__wrap > table.tbl`, which is what `components/ui/Table.jsx`
 * emits and what `components.css` §10 calls the one table system. A module
 * adopts it by changing one import line, and none of its call sites move.
 *
 * WHY NOT SIMPLY KEEP `<DataTable>` FROM THE BARREL: `.k-modtable` is not the
 * reference's table and never was. Its head is 11px at .08em tracking on `--bg`
 * against the reference's 10px at .14em on `--s-low` (app.css:182); its cells
 * are a flat 12px against 16px outer / 7px between; and its wrapper is a
 * classless `style={{ overflowX: 'auto' }}` div, so those tables floated on the
 * page ground with no edge at all. Those three things are decided in a shared
 * component that six other modules also use, so they could not be fixed from
 * the stylesheet.
 *
 * WHY AN ADAPTER RATHER THAN AN EDIT TO THAT SHARED COMPONENT: changing
 * `ModuleUI.DataTable` moves Manav, Vetana, Pahchan, Hub and Ganit in the same
 * commit. When they follow, this file is deleted and every importer goes back
 * to the barrel — ONE deletion, which is the point of it living here.
 *
 * WHY HERE AND NOT IN A PAGE PACKAGE: Dristi and Prachar each held a copy of
 * these two functions until 2026-09-03, cross-referenced in both directions
 * with a note explaining that neither could import the other — correctly, since
 * a module that imports another module's page code acquires that module's
 * render-time dependencies with it. Neither note considered the third option.
 * `components/ui/` is neutral, both packages already import `Table` and
 * `arrangeDataTable` from it, and the coupling both notes refused does not
 * exist here.
 */
import React from 'react';
import { Table, TableHead, TableBody, HeadCell, Cell } from './Table';
import ArrangedDataTable from './arrangeDataTable';

export function DataTable({ columns, children, arrange }) {
  /* ARRANGEABLE — see `components/ui/arrangeDataTable.jsx`. `arrange` is
     the table key and is the entire opt-in; every other prop is unchanged.
     This adapter delegates rather than re-implementing, which is the one
     place it deliberately does NOT copy the barrel: three copies of a
     head/body permutation is three chances for a body to end up under the
     wrong heading. */
  if (arrange) return <ArrangedDataTable arrange={arrange} columns={columns}>{children}</ArrangedDataTable>;
  return (
    <Table>
      <TableHead>
        {columns.map((c, i) => {
          const col = c && typeof c === 'object' ? c : { label: c };
          const key = col.label || `col-${i}`;
          /* `.tbl__num` carries the right edge AND the mono/tabular figures, so
             the header sits over its column rather than beside it. `align` is
             the only value ModuleUI accepted and the only one used. */
          return (
            <HeadCell key={key} num={col.align === 'right'} className={col.className || ''}>
              {col.label}
            </HeadCell>
          );
        })}
      </TableHead>
      <TableBody>{children}</TableBody>
    </Table>
  );
}

/**
 * A cell. `align="right"` and `mono` both mean the same thing in this build —
 * every call site passes them together, because a right-aligned column of
 * figures that is not tabular drifts by digit width — so both map to
 * `.tbl__num`, which states them once.
 *
 * `bold` was `style={{ fontWeight: 600 }}` written into the markup. It is
 * `.tbl__b` now (components.css §10).
 */
export function Td({ align, mono, bold, className, children, ...rest }) {
  const cls = [bold ? 'tbl__b' : '', className || ''].filter(Boolean).join(' ');
  return (
    <Cell num={align === 'right' || Boolean(mono)} className={cls} {...rest}>
      {children}
    </Cell>
  );
}
