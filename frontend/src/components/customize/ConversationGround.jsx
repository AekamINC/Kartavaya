import React from 'react';
import {
  CONV_PATTERNS,
  CONV_GROUNDS,
  DEFAULT_CONV_PATTERN,
  DEFAULT_CONV_GROUND,
} from '../../lib/convGround';

/**
 * The two Customization controls for the conversation ground (28 §6, 29 §5).
 *
 * Modelled on SidebarBgCards, deliberately and to the letter: same
 * radiogroup/radio/aria-checked shape, same `.xxx__c.on` selected state. `Seg`
 * is NOT reused — it renders text-only pills, and five swatches whose whole job
 * is to show a texture cannot be five words.
 *
 * Each preview paints THE REAL TILE — `background-image: var(--motif-mandala)` and
 * the real background-size, not a drawing of one. A preview that approximates
 * the thing it previews is how a texture ships at the wrong scale. The pattern
 * cards paint on the CURRENT ground and the ground cards paint under the
 * CURRENT motif, so the two controls read as one surface being assembled.
 *
 * Class rules live in `styles/settings.css` beside `.sbg`, not in a file next
 * to this component: check-classes.mjs reads only the top level of
 * src/styles/*.css, so a rule in a nested directory is invisible to that gate
 * and a class with no rule would ship unstyled and unreported.
 */

export function ConvPatternCards({ value = DEFAULT_CONV_PATTERN, onChange }) {
  return (
    <div className="cvp" role="radiogroup" aria-label="Conversation pattern">
      {CONV_PATTERNS.map((o) => {
        const on = value === o.id;
        return (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={on}
            className={`cvp__c${on ? ' on' : ''}`}
            onClick={() => onChange(o.id)}
          >
            <span
              className="cvp__pv"
              aria-hidden="true"
              style={o.motif ? { backgroundImage: o.motif, backgroundSize: o.size } : undefined}
            />
            <span className="cvp__n">{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}

export function ConvGroundCards({ value = DEFAULT_CONV_GROUND, onChange }) {
  return (
    <div className="cvg" role="radiogroup" aria-label="Conversation ground">
      {CONV_GROUNDS.map((o) => {
        const on = value === o.id;
        return (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={on}
            className={`cvg__c${on ? ' on' : ''}`}
            onClick={() => onChange(o.id)}
          >
            <span className={`cvg__pv cvg__pv--${o.id}`} aria-hidden="true" />
            <span className="cvg__n">{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}
