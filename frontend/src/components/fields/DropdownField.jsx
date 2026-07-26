import React, { useState, useRef, useCallback } from 'react';
import { useDismiss } from '../../hooks/useDismiss';

export default function DropdownField({ field, value, onChange, readOnly }) {
  const options = field.config?.options || [];
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  // Outside-click AND Escape — this used to be outside-click only.
  useDismiss(open, ref, useCallback(() => setOpen(false), []));

  if (readOnly) {
    return value
      ? <span style={{ fontSize: 12, background: "var(--bg-soft)", padding: "2px 10px", borderRadius: 99, border: "1px solid var(--rule)", color: "var(--ink-2)" }}>{value}</span>
      : <span style={{ color: "var(--ink-faint)", fontSize: 12 }}>—</span>;
  }

  return (
    <div ref={ref} style={{ position: "relative", display: "inline-block" }}>
      <button
        onClick={() => setOpen(o => !o)}
        className="k-btn k-btn--ghost k-btn--sm"
        style={{ fontWeight: 400, color: value ? "var(--ink)" : "var(--ink-3)" }}
      >
        {value || "Select…"} <span style={{ fontSize: 10 }}>▾</span>
      </button>
      {open && (
        <div style={{
          position: "absolute", top: "100%", left: 0, zIndex: 100, marginTop: 4,
          background: "var(--surface)", border: "1px solid var(--rule)",
          borderRadius: "var(--r-md)", boxShadow: "var(--shadow-md)",
          minWidth: 160, overflow: "hidden",
        }}>
          <div onClick={() => { onChange(null); setOpen(false); }}
            style={{ padding: "7px 12px", cursor: "pointer", color: "var(--ink-faint)", fontSize: 13 }}
            onMouseEnter={e => e.currentTarget.style.background = "var(--bg-soft)"}
            onMouseLeave={e => e.currentTarget.style.background = "transparent"}
          >Clear</div>
          {options.map(opt => (
            <div key={opt}
              onClick={() => { onChange(opt); setOpen(false); }}
              style={{
                padding: "7px 12px", cursor: "pointer", fontSize: 13,
                fontWeight: opt === value ? 600 : 400,
                background: opt === value ? "color-mix(in srgb, var(--k-primary) 10%, transparent)" : "transparent",
                color: "var(--ink)",
              }}
              onMouseEnter={e => { if (opt !== value) e.currentTarget.style.background = "var(--bg-soft)"; }}
              onMouseLeave={e => { if (opt !== value) e.currentTarget.style.background = "transparent"; }}
            >{opt}</div>
          ))}
        </div>
      )}
    </div>
  );
}
