import React from 'react';

/**
 * ModuleTabs — the shared module tab bar (13-module-pages.md §1).
 *
 * `tabs` is [{ id, label, count? }]. Implements the tablist roles the previous
 * inline markup omitted: the tab strip was a row of plain buttons with no
 * relationship to the panel they switch, so a screen reader announced eleven
 * unrelated buttons rather than a tab set.
 */
export default function ModuleTabs({ tabs, value, onChange, label = 'Sections' }) {
  return (
    <div className="mt" role="tablist" aria-label={label}>
      {tabs.map(t => {
        const id = typeof t === 'string' ? t : t.id;
        const text = typeof t === 'string' ? t : t.label;
        const count = typeof t === 'string' ? undefined : t.count;
        const on = id === value;
        return (
          <button
            key={id}
            role="tab"
            id={`mt-tab-${id}`}
            aria-selected={on}
            aria-controls={`mt-panel-${id}`}
            tabIndex={on ? 0 : -1}
            className={`mt__b${on ? ' on' : ''}`}
            onClick={() => onChange(id)}
          >
            {text}
            {count != null && <span className="mt__n">{count}</span>}
          </button>
        );
      })}
    </div>
  );
}
