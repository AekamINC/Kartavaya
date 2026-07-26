import React from 'react';

/**
 * NumberField.
 *
 * Off inline styles and onto `.fldx--amt`, which is one of the four fixed-width
 * modifiers 26 §3 allows: money has a known value length, is mono, and is
 * right-aligned so a column of it lines up on the decimal. `tabular-nums` on the
 * read-only view for the same reason — proportional digits make a total appear
 * to shift as it updates.
 */
export default function NumberField({ field, value, onChange, readOnly }) {
  const { prefix, suffix, min, max, step = 1 } = field.config || {};

  if (readOnly) {
    if (value === null || value === undefined) return <span className="fld__hint">—</span>;
    return <span className="num">{prefix}{value}{suffix}</span>;
  }

  return (
    <span className="numfld fldx--amt">
      {prefix && <span className="numfld__fix">{prefix}</span>}
      <input
        type="number"
        className="fldx__in"
        value={value ?? ''}
        onChange={e => onChange(e.target.value === '' ? null : Number(e.target.value))}
        min={min} max={max} step={step}
        aria-label={field?.name || 'Number'}
      />
      {suffix && <span className="numfld__fix">{suffix}</span>}
    </span>
  );
}
