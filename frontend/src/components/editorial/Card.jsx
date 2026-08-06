import React from 'react';
import { useSecondary, Secondary } from '../Bilingual';

/**
 * ONE LABEL SHAPE — 68 sites, 5 with Devanagari.
 *
 * The comment below is right that this was the third of a pair and missed the
 * `lang` attribute. It missed the language SETTING too: `.k-card__sans` is not
 * one of the six class names `[data-language="en"]` knows about, so the five
 * that carry Devanagari carried it into English as well. Same one-line change
 * as the other eight label components — the value is decided, not styled.
 */
export default function Card({ title, sanskrit, right, children, noPad, style, onClick, ...rest }) {
  const baseStyle = noPad ? { padding: 0, overflow: 'hidden' } : undefined;
  const merged = style ? { ...baseStyle, ...style } : baseStyle;
  const { secondary, script } = useSecondary(sanskrit);
  return (
    <section className="k-card" style={merged} onClick={onClick} {...rest}>
      {(title || right) && (
        <header className="k-card__head">
          <div className="k-card__titles">
            {title && <h3 className="k-card__title">{title}</h3>}
            {/* lang="hi" is not decoration. editorial.css §Devanagari metrics
                keys BOTH guards off it — `letter-spacing: 0 !important` and the
                ×1.18 leading the शिरोरेखा needs — so a Devanagari run without it
                is unprotected and mis-led. `StatTile.jsx` and `PageHeader.jsx`
                already carry it; this was the third of the pair and missed it,
                which is every card sub-title on Today. */}
            {secondary && <Secondary className="k-card__sans" value={secondary} script={script} />}
          </div>
          {right && <div>{right}</div>}
        </header>
      )}
      <div className="k-card__body">{children}</div>
    </section>
  );
}
