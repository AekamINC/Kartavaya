import React from 'react';
import { ACCENTS, deriveAccentColors } from '../CustomizePanel';

/**
 * AccentGrid — 12 presets plus a custom swatch.
 *
 * Each cell paints a gradient of the accent's three derived stops, so the cell
 * shows what the accent actually becomes rather than one flat hex. `--c`, `--m`
 * and `--d` are set per cell from deriveAccentColors(), which is the same
 * function applyPrefs uses — a custom colour therefore behaves exactly like a
 * preset instead of being a second code path.
 */
export default function AccentGrid({ accent, customAccent, onPick, onCustom }) {
  const activeColor =
    customAccent || (ACCENTS.find(a => a.id === accent) || ACCENTS[0]).color;

  return (
    <div className="acc" role="radiogroup" aria-label="Accent colour">
      {ACCENTS.map(a => {
        const d  = deriveAccentColors(a.color);
        const on = !customAccent && accent === a.id;
        return (
          <button
            key={a.id}
            type="button"
            role="radio"
            aria-checked={on}
            className={`acc__c${on ? ' on' : ''}`}
            onClick={() => onPick(a.id)}
            style={{ '--c': d.color, '--m': d.mid, '--d': d.deep }}
          >
            <span className="acc__sw" />
            {/* Label below the swatch, not painted on it: it used to be 8px
                #fff with a text-shadow, which is below any legibility floor and
                fails contrast on saffron regardless of the shadow. */}
            <span className="acc__n">{a.label}</span>
          </button>
        );
      })}

      {/* Not a radio: the swatch is a colour input, and role="radio" on a
          wrapper whose real control is an <input type="color"> would announce a
          choice the user cannot make with Space. It sits in the group as a
          labelled control instead. */}
      <div className={`acc__c acc__cust${customAccent ? ' on' : ''}`}>
        <input
          type="color"
          className="acc__hex"
          value={activeColor}
          onChange={e => onCustom(e.target.value)}
          aria-label="Custom accent colour"
        />
        <span className="acc__n">Custom</span>
      </div>
    </div>
  );
}
