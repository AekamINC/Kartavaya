import React from 'react';
import Picker from '../ui/Picker';

/**
 * DropdownField — the second of the four ad-hoc pickers 26 §4 replaces.
 *
 * It had its own outside-click effect, its own `z-index: 100`, no arrow-key
 * support, no mobile treatment, and a hover state implemented as
 * `onMouseEnter={e => e.currentTarget.style.background = …}` — a style write per
 * row per pointer move, invisible to the theme and to dark mode.
 *
 * The unified Picker brings all of that, plus a search box that appears only
 * above six options: a dropdown of four with a search field over it is a
 * control apologising for itself.
 *
 * The "Clear" row is gone in favour of re-picking the selected value, which the
 * Picker treats as a toggle in `multi` and as a no-op here. Where a field must
 * be clearable, add an explicit null option — a Clear row styled as muted text
 * at the top of a list is indistinguishable from a disabled first option.
 */
export default function DropdownField({ field, value, onChange, readOnly }) {
  const options = field.config?.options || [];

  if (readOnly) {
    return value
      ? <span className="chip">{value}</span>
      : <span className="fld__hint">—</span>;
  }

  return (
    <Picker
      mode="option"
      ariaLabel={field?.name || 'Select'}
      items={options.map(o => ({ id: o, label: o }))}
      value={value ?? null}
      placeholder="Select…"
      onChange={onChange}
    />
  );
}
