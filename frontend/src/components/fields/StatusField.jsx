import React, { useState, useRef, useCallback } from 'react';
import { useDismiss } from '../../hooks/useDismiss';

const DEFAULT_OPTIONS = [
  { label: "Not Started", color: "#94a3b8" },
  { label: "In Progress", color: "#3b82f6" },
  { label: "Blocked",     color: "#ef4444" },
  { label: "Done",        color: "#22c55e" },
];

export default function StatusField({ field, value, onChange, readOnly }) {
  const options = field.config?.options || DEFAULT_OPTIONS;
  const current = options.find(o => o.label === value) || options[0];
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  // Outside-click AND Escape — this used to be outside-click only.
  useDismiss(open, ref, useCallback(() => setOpen(false), []));

  const pill = (opt, onClick) => (
    <span
      key={opt.label}
      onClick={onClick}
      style={{
        display: "inline-flex", alignItems: "center", gap: 5,
        background: opt.color + "22", color: opt.color,
        border: `1px solid ${opt.color}55`,
        borderRadius: 99, padding: "2px 10px",
        fontSize: 11, fontWeight: 600,
        cursor: readOnly ? "default" : "pointer",
        whiteSpace: "nowrap",
      }}
    >
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: opt.color, display: "inline-block" }} />
      {opt.label}
    </span>
  );

  if (readOnly) return pill(current, undefined);

  return (
    <div ref={ref} style={{ position: "relative", display: "inline-block" }}>
      {pill(current, () => setOpen(o => !o))}
      {open && (
        <div style={{
          position: "absolute", top: "100%", left: 0, zIndex: 100, marginTop: 4,
          background: "var(--surface)", border: "1px solid var(--rule)",
          borderRadius: "var(--r-md)", boxShadow: "var(--shadow-md)",
          display: "flex", flexDirection: "column", gap: 2, padding: 6, minWidth: 160,
        }}>
          {options.map(opt => (
            <div key={opt.label}
              onClick={() => { onChange(opt.label); setOpen(false); }}
              style={{ padding: "5px 8px", borderRadius: "var(--r-sm)", cursor: "pointer" }}
              onMouseEnter={e => e.currentTarget.style.background = "var(--bg-soft)"}
              onMouseLeave={e => e.currentTarget.style.background = "transparent"}
            >
              {pill(opt, undefined)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
