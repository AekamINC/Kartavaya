import React from 'react';
import Picker from '../ui/Picker';
import { Avatar } from '../ui/Avatar';

/**
 * PersonField — the third ad-hoc picker, and the one with the worst dismiss
 * behaviour: it had no outside-click handler and no Escape at all, so once
 * opened the only way to close it was to choose somebody.
 *
 * Its avatar was a tinted circle carrying a single initial in `var(--k-primary)`
 * — the same colour for every person, which defeats the point of an avatar. The
 * shared `Avatar` hashes the name to one of six palette colours, so the same
 * person is the same colour on every screen.
 */
export default function PersonField({ field, value, onChange, readOnly }) {
  const members = field.config?.members || [];
  const current = members.find(m => m.user_id === value);

  if (readOnly) {
    return current ? (
      <span className="avrow">
        <Avatar name={current.display_name} size={24} />
        {current.display_name}
      </span>
    ) : <span className="fld__hint">Unassigned</span>;
  }

  return (
    <Picker
      mode="person"
      ariaLabel={field?.name || 'Assignee'}
      items={members.map(m => ({ id: m.user_id, name: m.display_name, meta: m.email }))}
      value={value ?? null}
      placeholder="Assign person…"
      onChange={onChange}
    />
  );
}
