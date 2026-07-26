import React from 'react';
import { PickerDate } from '../ui/Picker';
import { relDue } from '../ui/DueChip';

/**
 * DateField — the fourth ad-hoc picker, and a fourth due-date format.
 *
 * The read-only view had its own relative-date ladder ("Today", "Tomorrow",
 * "In 3 days", `toLocaleDateString()`), which is the same logic `DueChip`
 * owns — and its bare fallback used the BROWSER's locale, so a US-locale
 * browser rendered a date one way here and the en-IN way two components over.
 * `relDue` is that logic, once.
 *
 * The editable view was `<input type="date">`, whose popup is the browser's:
 * a different language, a different first day of week and a different theme on
 * every machine, and on desktop Safari no popup at all.
 *
 * The value on the wire stays an ISO string; the Picker works in `Date`, so the
 * conversion happens here rather than leaking either representation.
 */
export default function DateField({ field, value, onChange, readOnly }) {
  if (readOnly) {
    if (!value) return <span className="fld__hint">No date</span>;
    const { label, tone } = relDue(value);
    return <span className={`k-due k-due--${tone}`}>{label}</span>;
  }

  return (
    <PickerDate
      ariaLabel={field?.name || 'Date'}
      value={value || null}
      placeholder="No date"
      onChange={(d) => onChange(d ? d.toISOString() : null)}
    />
  );
}
