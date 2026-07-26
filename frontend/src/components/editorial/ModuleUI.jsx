import React from 'react';
import EmptyState from '../ui/EmptyState';

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

export function Section({ title, hi, right, children }) {
  return (
    <section className="k-section">
      <div className="k-section__head">
        <h3 className="k-section__title">
          {title}
          {/* lang="hi": .k-section__title-hi already carries --font-hindi, but
              without a lang the [lang="hi"] leading and zero-tracking rules
              never fired, and the parent .k-section__title tracks at .08em —
              which pulls Devanagari conjuncts apart. */}
          {hi && <span className="k-section__title-hi" lang="hi">{hi}</span>}
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

export function Shimmer({ count = 4 }) {
  return (
    <div className="k-shimmer">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="k-shimmer__tile" />
      ))}
    </div>
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

export function ModCard({ children, onClick }) {
  return (
    <div className="k-modcard" onClick={onClick}>
      {children}
    </div>
  );
}

export function DataTable({ columns, children }) {
  return (
    <div style={{ overflowX: 'auto' }}>
      <table className="k-modtable">
        <thead>
          <tr>
            {columns.map((c, i) => (
              <th
                key={typeof c === 'string' ? c || `col-${i}` : c.label || `col-${i}`}
                data-align={typeof c === 'object' && c.align === 'right' ? 'right' : undefined}
                // A column may carry a className so a responsive rule can hide
                // the header and its cells together. The register needs this:
                // 07-pahchan.md drops .rv__loc and .rv__v below 900px, and a
                // hidden cell under a visible header is a shifted table.
                className={typeof c === 'object' ? c.className : undefined}
              >
                {typeof c === 'string' ? c : c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export function Td({ align, mono, bold, color, className, children }) {
  return (
    <td
      data-align={align}
      // Needed by any table with per-column responsive behaviour, and by
      // 07-pahchan.md §179's requirement that a loading skeleton SHARE the real
      // row's cell rules rather than mirror them — which is only possible if the
      // real cells carry classes to share.
      className={className}
      style={{
        fontFamily: mono ? 'var(--font-mono)' : undefined,
        fontVariantNumeric: mono ? 'tabular-nums' : undefined,
        fontWeight: bold ? 600 : undefined,
        color: color || undefined,
      }}
    >
      {children}
    </td>
  );
}
