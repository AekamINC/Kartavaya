import React from 'react';
import Picker from '../ui/Picker';
import { STATUS_COLORS } from '../../lib/statusColors';

/**
 * StatusField — a custom field of type `status`.
 *
 * Two defects fixed here, both instances of patterns 02-common-components.md
 * names elsewhere:
 *
 * 1 · **A fifth status-colour map.** The defaults were `#94a3b8` / `#3b82f6` /
 *     `#ef4444` / `#22c55e` — hexes that flip with nothing, and a blue that is
 *     neither `--st-in-progress` nor any other token in the system.
 *     `lib/statusColors` is the single map (02 §"Status colours"); the four
 *     defaults read from it now, so the 00 §7 contrast fix reaches this field
 *     without this file changing again.
 *
 * 2 · **String-concatenated alpha.** The pill painted `opt.color + "22"` and
 *     `${opt.color}55` — the same expression as the `Badge` defect, and it
 *     produces an invalid colour the instant the value is a `var()` rather than
 *     a hex. `.k-statuschip` does the tint in CSS with `color-mix`, so a token
 *     and a user-stored hex both work.
 *
 * The bespoke dropdown is gone with it. It was one of the ad-hoc pickers 26 §4
 * replaces: its own z-index, no arrow keys, no mobile treatment, and a hover
 * state written in JavaScript as two inline handlers per row.
 */
const DEFAULT_OPTIONS = [
  { label: 'Not Started', color: STATUS_COLORS.todo },
  { label: 'In Progress', color: STATUS_COLORS.in_progress },
  { label: 'Blocked',     color: STATUS_COLORS.rejected },
  { label: 'Done',        color: STATUS_COLORS.done },
];

export default function StatusField({ field, value, onChange, readOnly }) {
  const options = field.config?.options || DEFAULT_OPTIONS;
  const current = options.find(o => o.label === value) || options[0];

  if (readOnly) {
    if (!current) return <span className="fld__hint">—</span>;
    return (
      <span className="k-statuschip" style={{ '--c': current.color }}>
        <span className="k-statuschip__dot" />
        {current.label}
      </span>
    );
  }

  return (
    <Picker
      mode="option"
      ariaLabel={field?.name || 'Status'}
      items={options.map(o => ({ id: o.label, label: o.label, color: o.color }))}
      value={current?.label}
      placeholder="Set status"
      onChange={onChange}
    />
  );
}
