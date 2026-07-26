import React from 'react';

/**
 * SidebarBgCards — dark / light / accent, applied via data-sidebar-bg on <html>.
 *
 * Each card previews the real thing: the same background the rule sets in
 * settings.css paint, with an active row so the light variant visibly proves it
 * flips the active item to --primary-container. Without that flip the active
 * row is a pale wash on a pale background and the current page stops being
 * identifiable.
 */
const OPTIONS = [
  { id: 'dark',   label: 'Dark',   cls: 'sbg__pv--dark' },
  { id: 'light',  label: 'Light',  cls: 'sbg__pv--light' },
  { id: 'accent', label: 'Accent', cls: 'sbg__pv--accent' },
];

export default function SidebarBgCards({ value = 'dark', onChange }) {
  return (
    <div className="sbg" role="radiogroup" aria-label="Sidebar background">
      {OPTIONS.map(o => {
        const on = value === o.id;
        return (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={on}
            className={`sbg__c${on ? ' on' : ''}`}
            onClick={() => onChange(o.id)}
          >
            <span className={`sbg__pv ${o.cls}`} aria-hidden="true">
              <i /><i className="on" /><i /><i />
            </span>
            <span className="sbg__n">{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}
