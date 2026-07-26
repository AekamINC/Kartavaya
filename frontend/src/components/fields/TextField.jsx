import React, { useState } from 'react';

/**
 * TextField — click-to-edit.
 *
 * Two things changed. The placeholder read "Click to edit…", which is not what
 * the field contains and is wrong for every keyboard user; the affordance is
 * now the dashed underline plus a real `<button>`, so Enter and Space work and
 * a screen reader announces it as editable rather than as the literal words.
 *
 * And the empty state is `—` in both modes. "Click to edit…" in an empty cell
 * is indistinguishable from a value, so a table of empty fields read as a table
 * of identical entries.
 */
export default function TextField({ field, value, onChange, readOnly }) {
  const multiline = field.config?.multiline || false;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value || '');

  const commit = () => { onChange(draft); setEditing(false); };

  if (readOnly) {
    return <span className={value ? 'txtfld' : 'fld__hint'}>{value || '—'}</span>;
  }

  if (!editing) {
    return (
      <button
        type="button"
        className={`txtfld txtfld--edit${value ? '' : ' is-empty'}`}
        onClick={() => { setDraft(value || ''); setEditing(true); }}
      >
        {value || `Set ${field?.name || 'value'}`}
      </button>
    );
  }

  return multiline ? (
    <textarea
      rows={3} value={draft} autoFocus className="fldx__in"
      aria-label={field?.name || 'Text'}
      onChange={e => setDraft(e.target.value)}
      onBlur={commit}
    />
  ) : (
    <input
      type="text" value={draft} autoFocus className="fldx__in"
      aria-label={field?.name || 'Text'}
      onChange={e => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false); }}
    />
  );
}
