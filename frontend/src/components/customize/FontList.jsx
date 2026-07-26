import React from 'react';

/**
 * FontList — one row per face, rendered IN that face.
 *
 * This replaces a <select>, which renders every option in the system UI font
 * and so asks you to choose a typeface from a list that shows no typefaces.
 * `--f` carries the stack to both the `Aa` specimen and the name.
 *
 * All nine display and six UI families are already loaded up front in
 * index.html, so no row falls back to the system font on first paint.
 */
export default function FontList({ fonts, value, onChange, label }) {
  return (
    <div className="fnt" role="radiogroup" aria-label={label}>
      {fonts.map(f => {
        const on = value === f.id;
        return (
          <button
            key={f.id}
            type="button"
            role="radio"
            aria-checked={on}
            className={`fnt__r${on ? ' on' : ''}`}
            onClick={() => onChange(f.id)}
            style={{ '--f': f.value }}
          >
            <span className="fnt__aa" aria-hidden="true">Aa</span>
            <span>
              <span className="fnt__n">{f.label}</span>
              <span className="fnt__d" style={{ display: 'block' }}>{f.sub}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
