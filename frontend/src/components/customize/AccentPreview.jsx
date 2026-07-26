import React from 'react';
import { Button, Tag } from '../ui';

/**
 * AccentPreview — every surface the accent actually lands on.
 *
 * A row of bare swatches tells you the hue and nothing else. What matters is
 * whether the colour still works as a fill under --on-primary label text, as a
 * tonal background under --on-primary-container, as a link on the page, and as
 * a 5px active bar in the sidebar — so the preview shows those, live, off the
 * tokens applyPrefs has already written.
 *
 * The link and the tag take --primary-text, not --primary. --primary is 4.04:1
 * on --bg at the default teal and is a fill, never text (00 §12); the whole
 * reason applyPrefs derives a separate --primary-text per accent is that the
 * other eleven presets are otherwise unmeasured. A preview that painted accent
 * text in the fill colour would advertise the exact mistake the token exists to
 * prevent — and it would look fine, which is the worse half.
 */
export default function AccentPreview() {
  return (
    <div className="accpv" aria-hidden="true">
      <div className="accpv__side">
        <i /><i className="on" /><i /><i />
      </div>

      <Button variant="fill"  size="sm" tabIndex={-1}>Filled</Button>
      <Button variant="tonal" size="sm" tabIndex={-1}>Tonal</Button>
      <Button variant="out"   size="sm" tabIndex={-1}>Outline</Button>

      <span className="accpv__link">A link</span>

      <Tag color="var(--primary-text)">ACTIVE</Tag>

      {/* 09 §1 also lists "a selected chip". It is not here: .chip.on paints
          --secondary-container (02 §1), so it does not move with the accent,
          and a preview of "every place the accent lands" that includes a
          surface the accent does not reach teaches the wrong thing. The
          accent's selected state is the .on row in FontList and SoundGrid,
          which is --primary-container and is visible one tab away. */}
      <div className="accpv__meter"><b /></div>
    </div>
  );
}
