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
            {/* Optional count, as a distinct node rather than folded into the
                label string. 07-pahchan.md asks for the latter specifically:
                the register needs "All 12" and "Needs a look 6", and baking the
                number into the label makes it untranslatable. Rendered inside
                the button so it is part of the radio's accessible name — a
                reviewer using a screen reader needs to hear the count too. */}
            {o.count != null && <span className="seg__n">{o.count}</span>}
          </button>
        );
      })}
    </div>
  );
}
