import React from 'react';

/**
 * Seg — segmented control, token-styled.
 *
 * The version in CustomizePanel.jsx was styled with an inline style object
 * against --bg-soft / --surface-2 / --ink / --ink-3, two of which were
 * undefined. Same control, moved onto .seg in settings.css so it themes with
 * everything else and can be focused visibly.
 */
export default function Seg({ options, value, onChange, label }) {
  return (
    <div className="seg" role="radiogroup" aria-label={label}>
      {options.map(o => {
        const on = value === o.value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            className={`seg__b${on ? ' on' : ''}`}
            onClick={() => onChange(o.value)}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
