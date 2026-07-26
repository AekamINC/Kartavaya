import React from 'react';
import { FONTS } from '../CustomizePanel';

/**
 * TypePreview — heading, body and button together.
 *
 * The old preview was one line: a `--font-display` span at weight 500 plus a
 * pangram. It could not show the UI font, the line height, or how a heading
 * sits above body copy — which is the entire content of a type decision, and
 * three of the four things this tab controls.
 *
 * The four values ride on the card as custom properties so the preview follows
 * state directly. It reads the pending choice rather than the applied one, so
 * the card is correct even mid-change.
 */
export default function TypePreview({ font, uiFont, fontSize, lineHeight }) {
  const d = FONTS.find(f => f.id === font)   || FONTS[0];
  const u = FONTS.find(f => f.id === uiFont) || FONTS.find(f => f.id === 'inter') || FONTS[0];

  return (
    <div
      className="tpv"
      style={{
        '--pv-d': d.value,
        '--pv-u': u.value,
        '--pv-fs': `${fontSize || 14}px`,
        '--pv-lh': String(lineHeight || 1.5),
      }}
    >
      <h4>The quarterly review is ready</h4>
      <p>
        Body copy renders in your interface font at the size and line height you
        picked. Headings use the display face. Because the two are independent,
        choosing a serif here does not turn every label, table cell and button
        serif as well.
      </p>
      <button className="tpv__b" type="button" tabIndex={-1}>Open report</button>
    </div>
  );
}
