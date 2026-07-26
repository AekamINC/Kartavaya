import React from 'react';

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
          {hi && <span className="k-section__title-hi">{hi}</span>}
        </h3>
        {right && <div>{right}</div>}
      </div>
      {children}
    </section>
  );
}

export function Badge({ text, color }) {
  const c = color || '#6E7B91';
  return (
    <span className="k-badge" style={{ background: `${c}18`, color: c }}>
      {text}
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

export function Empty({ icon = '📋', title, sub, cta, onCta }) {
  return (
    <div className="k-empty">
      <div className="k-empty__icon">{icon}</div>
      <p className="k-empty__title">{title}</p>
      {sub && <p className="k-empty__sub">{sub}</p>}
      {cta && <button className="k-empty__cta" onClick={onCta}>{cta}</button>}
    </div>
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
