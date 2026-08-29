// The org's own extra fields, rendered onto a form.
//
// The Custom Fields tab has been able to DEFINE fields since migration 023,
// and `custom_data` has existed on the contact and deal rows just as long. No
// form ever rendered them, so a field you created was invisible everywhere and
// the tab did nothing — which is what the owner reported on 2026-08-09.
//
// One component for every entity, because the alternative is a copy per form
// and five copies of "what does field_type 'select' look like". The caller owns
// the value object and hands it back on change; this file owns nothing but the
// rendering.
//
//   <CustomFieldInputs
//     entity="contact"
//     value={form.custom_data}
//     onChange={cd => setForm({ ...form, custom_data: cd })}
//     field={field}            // the form's own label+control wrapper
//   />
//
// `field` is passed in rather than imported so the fields sit in whichever
// layout the host form uses — Graha's tabs each have their own.
import React, { useEffect, useState } from 'react';
import { api, rows } from '../../lib/api';
import DateInput from '../../components/ui/DateInput';

/** The five records a user fills in by hand. Kept in step with the CHECK in
 *  migration 131 and with `create_custom_field`. */
export const CUSTOM_FIELD_ENTITIES = [
  { id: 'contact',   label: 'Contact' },
  { id: 'deal',      label: 'Deal' },
  { id: 'client',    label: 'Client' },
  { id: 'activity',  label: 'Activity' },
  { id: 'follow_up', label: 'Follow-up' },
];

/**
 * Definitions for one entity, fetched once per mount.
 *
 * Exported because a form usually needs to know whether there are any before
 * it draws a section heading — and because the same definitions drive both the
 * create panel and the edit panel of a tab, which would otherwise fetch twice.
 */
/**
 * A stored `field_type` mapped to a REAL HTML input type.
 *
 * `phone` is the reason this exists: it is not an input type, and passing it
 * through produced `<input type="phone">`, which every browser silently treats
 * as `text` — so it looked right and quietly cost the numeric keypad on the one
 * device where a phone number is typed most.
 *
 * Explicit rather than a pass-through: an unrecognised type falls to `text`,
 * which is what the browser did anyway, so a new field type added later cannot
 * become an invalid attribute by default.
 */
const HTML_INPUT_TYPE = {
  text: 'text',
  url: 'url',
  email: 'email',
  phone: 'tel',
};

export function useCustomFields(entity) {
  const [fields, setFields] = useState([]);
  useEffect(() => {
    let alive = true;
    // Failing is not fatal and must not be loud: the standard fields are the
    // form, these are an addition to it. A 403 here is ordinary — the list is
    // behind the graha gate and a client user does not hold it.
    api.get(`/v1/graha/custom-fields?entity_type=${encodeURIComponent(entity)}`)
      .then(r => { if (alive) setFields(rows(r)); })
      .catch(() => {});
    return () => { alive = false; };
  }, [entity]);
  return fields;
}

export default function CustomFieldInputs({ entity, value, onChange, field, disabled }) {
  const fields = useCustomFields(entity);
  if (!fields.length) return null;

  const cd = value || {};
  // Keyed by the field's ID, never by its name. A field can be renamed, and a
  // name-keyed store would orphan every value already saved under the old one.
  const set = (id, v) => onChange?.({ ...cd, [id]: v });

  const wrap = field || ((label, node) => (
    <label className="gr__f"><span className="gr__fl">{label}</span>{node}</label>
  ));

  return fields.map(f => {
    const v = cd[f.id] ?? '';
    const label = f.is_required ? `${f.field_name} *` : f.field_name;
    let node;

    switch (f.field_type) {
      case 'checkbox':
        node = (
          /* No class. The Custom Fields tab's own `is_required` checkbox is a
             bare input too — there is no checkbox component in this vocabulary,
             and inventing a `.k-check` here would be a class with no rule. */
          <input
            type="checkbox"
            checked={!!v}
            disabled={disabled}
            onChange={e => set(f.id, e.target.checked)}
          />
        );
        break;
      case 'select':
        node = (
          <select className="k-input" value={v} disabled={disabled}
            required={f.is_required}
            onChange={e => set(f.id, e.target.value)}>
            <option value="">— Select —</option>
            {(f.options || []).map(o => <option key={o} value={o}>{o}</option>)}
          </select>
        );
        break;
      case 'date':
        // The app's own picker, not `<input type="date">` — see DateInput.jsx.
        node = (
          <DateInput className="k-input" type="date" value={v} disabled={disabled}
            aria-label={f.field_name}
            onChange={e => set(f.id, e.target.value)} />
        );
        break;
      case 'number':
        node = (
          <input className="k-input" type="number" value={v} disabled={disabled}
            required={f.is_required}
            onChange={e => set(f.id, e.target.value === '' ? '' : Number(e.target.value))} />
        );
        break;
      default:
        // text · url · email · phone all differ only by the input type, which
        // is what gives a phone its numeric keypad and an email its validation.
        //
        // ⚠ AND THE PHONE ONE WAS NOT GETTING IT. This read
        // `type={f.field_type === 'text' ? 'text' : f.field_type}`, so a field
        // whose stored type is `phone` rendered `<input type="phone">` — WHICH
        // IS NOT AN HTML INPUT TYPE. The browser falls back to `text`, so it
        // renders fine and looks correct, and a phone number gets no numeric
        // keypad on the device where that matters most. The comment above
        // promised exactly the behaviour the line below prevented.
        //
        // Found by Suite 04, 2026-08-29. The map is explicit rather than a
        // pass-through so a new `field_type` cannot silently become an invalid
        // attribute again: anything unrecognised is `text`, which is the safe
        // default and what the browser was doing anyway.
        node = (
          <input
            className="k-input"
            type={HTML_INPUT_TYPE[f.field_type] || 'text'}
            value={v}
            disabled={disabled}
            required={f.is_required}
            onChange={e => set(f.id, e.target.value)}
          />
        );
    }
    return <React.Fragment key={f.id}>{wrap(label, node)}</React.Fragment>;
  });
}
