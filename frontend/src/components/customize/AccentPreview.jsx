import React from 'react';

/**
 * AccentPreview — every surface the accent actually lands on.
 *
 * A row of bare swatches tells you the hue and nothing else. What matters is
 * whether the colour still works as a button background under white label text,
 * as a link on the page background, and as a 5px active bar in the sidebar —
 * so the preview shows those, live, from the tokens applyPrefs has already set.
 */
export default function AccentPreview() {
  return (
    <div className="accpv" aria-hidden="true">
      <div className="accpv__side">
        <i /><i className="on" /><i /><i />
      </div>

      <button className="k-btn k-btn--primary k-btn--sm" tabIndex={-1}>Filled</button>
      <button className="k-btn k-btn--ghost k-btn--sm" tabIndex={-1}>Ghost</button>
      <span className="accpv__link">A link</span>

      <span
        className="k-statuschip"
        style={{ '--c': 'var(--primary)' }}
      >
        <span className="k-statuschip__dot" />
        In progress
      </span>

      <div className="accpv__meter"><b /></div>
    </div>
  );
}
