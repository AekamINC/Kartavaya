import React from 'react';
import EmptyState from '../ui/EmptyState';
import { Announced } from '../ui/Skeleton';
import { Table, TableHead, HeadCell, Cell } from '../ui/Table';
import ArrangedDataTable from '../ui/arrangeDataTable';
import { useSecondary, Secondary } from '../Bilingual';

export function TabBar({ tabs, active, onChange }) {
  return (
    <div className="k-tabbar">
      {tabs.map(t => (
        <button key={t} onClick={() => onChange(t)}
          className={`k-tabbar__btn${active === t ? ' k-tabbar__btn--active' : ''}`}>
          {t}
        </button>
      ))}
    </div>
  );
}

/**
 * ONE LABEL SHAPE — and this is the densest site in the product: 35 call sites
 * across 16 files, and EVERY ONE of them passes Devanagari. `.k-section__title-hi`
 * is not among the six class names `[data-language="en"]` names, so all 35
 * section headings on the module pages rendered in two scripts under English.
 */
export function Section({ title, hi, right, children }) {
  const { secondary, script } = useSecondary(hi);
  return (
    <section className="k-section">
      <div className="k-section__head">
        <h3 className="k-section__title">
          {title}
          {/* lang="hi": .k-section__title-hi already carries --font-hindi, but
              without a lang the [lang="hi"] leading and zero-tracking rules
              never fired, and the parent .k-section__title tracks at .08em —
              which pulls Devanagari conjuncts apart. */}
          {secondary && <Secondary className="k-section__title-hi" value={secondary} script={script} />}
        </h3>
        {right && <div>{right}</div>}
      </div>
      {children}
    </section>
  );
}

/**
 * Badge — 02-common-components.md §"Badge produces an invalid colour".
 *
 * Two defects fixed, both verified against this file rather than quoted:
 *
 * 1 · `background: \`${c}18\`` was a hex-alpha suffix, which worked only while
 *     `statusColors.js` held hexes. It now holds custom-property references, so
 *     that expression evaluated to the string `"var(--st-done)18"` — not a
 *     colour, and silently dropped, leaving the badge with no background at
 *     all. Confirmed live at `VikrayPage.jsx:231` and `:414` (order status, fed
 *     from the token map) and at `:239` / `:480`, which pass `var(--ok)` and
 *     `var(--danger)` directly. `mixAlpha` exists for exactly this.
 *
 * 2 · **Not in the handover, found while fixing the first.** `DristiPage`
 *     calls `<Badge color={…}>{value}</Badge>` in five places, but the props
 *     were `{ text, color }` only — so children were discarded and five badges
 *     rendered as empty pills. `children` is now accepted as the text.
 *
 * It now renders as a `StatusChip`, which 02 names as the pattern to copy and
 * which 02 §1 measured: `--c` text on a 10% tint of itself over `--surface` is
 * 6.4:1 for `in_progress` and 6.0:1 for `done`, and the dot carries the
 * identity so the colour is not the only signal. `k-badge` is left in the
 * stylesheet for the two call sites that use it as a plain count.
 */
export function Badge({ text, color, children }) {
  const label = text ?? children;
  return (
    <span className="k-statuschip" style={{ '--c': color || 'var(--on-surface-3)' }}>
      <span className="k-statuschip__dot" />
      {label}
    </span>
  );
}

export function Shimmer({ count = 4, label = 'Loading…' }) {
  // ANNOUNCES ITSELF — the fourth copy of this shape, and the same reason as
  // the three `Shim`s in the module `_shared.jsx` files: Suite 20.06 found 7 of
  // 10 sampled screens drawing a loading state that said nothing to a screen
  // reader. `Announced` no-ops inside an explicit `SkeletonRegion`, so a screen
  // that already wraps this does not begin saying it twice.
  return (
    <Announced label={label}>
      <div className="k-shimmer" aria-hidden="true">
        {Array.from({ length: count }, (_, i) => (
          <div key={i} className="k-shimmer__tile" />
        ))}
      </div>
    </Announced>
  );
}

/**
 * Empty — now a thin pass-through to `ui/EmptyState`.
 *
 * 02 §"Two empty states, neither ready" says to port `EmptyState` onto tokens
 * and delete this one. The port is done; deleting the component outright would
 * mean editing the fourteen module pages that call it, so it forwards instead —
 * one implementation, no page touched, and the emoji default goes.
 *
 * `icon="📋"` is passed by nineteen call sites. `EmptyState` maps an unknown
 * icon string to its `generic` SVG glyph, so those render a real illustration
 * rather than an emoji: 07 §175 is explicit that the design system has none.
 */
export function Empty({ icon, title, sub, cta, onCta }) {
  return (
    <EmptyState
      icon={icon}
      illustration="generic"
      title={title}
      description={sub}
      action={cta}
      onAction={onCta}
    />
  );
}

export function BackButton({ onClick, label = 'Back' }) {
  return (
    <button className="k-backbtn" onClick={onClick}>
      ← {label}
    </button>
  );
}

/**
 * A card that opens a record when it is given `onClick`, and a plain container
 * when it is not.
 *
 * The clickable case was a `<div onClick>`: not focusable, no role, so the
 * payroll runs, payslips and salary structures it carries in `vetana/*` were
 * openable with a mouse and by no other means. `OrderRows` records the same
 * finding for the same class — "a real <button> per row is also the only
 * version of 'click the row to open it' that a keyboard reaches".
 *
 * Rendering a `<button>` only when there IS a handler matters: a button with
 * nothing to do is a focus stop that answers nothing, which is the same defect
 * pointed the other way. `.k-modcard` already lays out as flex, and the reset
 * for the button case rides beside it in editorial.css.
 */
export function ModCard({ children, onClick, label }) {
  if (!onClick) return <div className="k-modcard">{children}</div>;
  return (
    <button type="button" className="k-modcard k-modcard--btn" onClick={onClick} aria-label={label}>
      {children}
    </button>
  );
}

/**
 * ONE TABLE SYSTEM — and this is the last of the four.
 *
 * This function used to render `.k-modtable` inside a classless
 * `style={{ overflowX: 'auto' }}` div, and it is the single largest table
 * population in the product: ~50 `<DataTable>` call sites across the six
 * modules that did not get their own `_shared.jsx` adapter. `.k-modtable` had
 * its own head typography (11px/.08em on `--bg`), its own gutters (12px each
 * side, so 24px between columns against the reference's 14px) and its own
 * hover transition (`calc(.1s * var(--ix))`, a rung that is not on the ladder
 * and an implicit `ease` that is not one of the six easings).
 *
 * Dristi and Prachar closed the same gap by re-declaring `DataTable`/`Td` over
 * `components/ui/Table.jsx` in their own `_shared.jsx`, precisely so their tabs
 * changed by one import line each. Six modules still reach this barrel, and
 * they cannot be moved that way without editing thirty-odd files — so the
 * barrel itself moves instead. Every call site keeps its props; what changes is
 * that the markup underneath is `.tbl__wrap > table.tbl`, which is what
 * `moduleTables.test.jsx` asserts for the three modules that went first and what
 * `tableSystem.test.jsx` now discovers for the whole tree.
 *
 * `.k-modtable` is DELETED, not aliased — editorial.css declares no table rule
 * for it at all, the same way `.gr__tbl` went.
 */
export function DataTable({ columns, children, arrange }) {
  /* ARRANGEABLE, with one prop and no other edit to the call site.
     `arrange` is the table key — `'manav.assets'` — and passing it is the
     whole opt-in: the headers, the widths and the body cells all come out of
     one permutation, so they cannot drift apart the way a prop that reordered
     only the headers would have made them.
     Why a different COMPONENT rather than a branch here: `useColumnPrefs` is a
     hook. See `ui/arrangeDataTable.jsx`, which also carries the argument for
     permuting positionally instead of editing seventy pages. */
  if (arrange) return <ArrangedDataTable arrange={arrange} columns={columns}>{children}</ArrangedDataTable>;
  return (
    <Table>
      <TableHead>
        {columns.map((c, i) => {
          const col = c && typeof c === 'object' ? c : { label: c };
          return (
            <HeadCell
              key={col.label || `col-${i}`}
              num={col.align === 'right'}
              // A column may carry a className so a responsive rule can hide
              // the header and its cells together. The register needs this:
              // 07-pahchan.md drops .rv__loc and .rv__v below 900px, and a
              // hidden cell under a visible header is a shifted table.
              className={col.className || ''}
            >
              {col.label}
            </HeadCell>
          );
        })}
      </TableHead>
      <tbody>{children}</tbody>
    </Table>
  );
}

/**
 * `align="right"` now also means mono tabular figures, which is the same
 * mapping `pages/dristi/_shared.jsx` and `pages/prachar/_shared.jsx` already
 * ship: `.tbl__num` is the one cell class that right-aligns, and it carries the
 * figures with it. A column of rupees that lines up on the decimal is the point
 * of a right-aligned column; two spellings of it were not.
 */
export function Td({ align, mono, bold, color, className, children }) {
  const cls = [bold ? 'tbl__b' : '', className || ''].filter(Boolean).join(' ');
  return (
    <Cell
      num={align === 'right' || Boolean(mono)}
      // Needed by any table with per-column responsive behaviour, and by
      // 07-pahchan.md §179's requirement that a loading skeleton SHARE the real
      // row's cell rules rather than mirror them — which is only possible if the
      // real cells carry classes to share.
      className={cls}
      style={color ? { color } : undefined}
    >
      {children}
    </Cell>
  );
}
