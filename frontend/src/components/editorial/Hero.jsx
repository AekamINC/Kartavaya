import React from 'react';
import WeekStrip from './WeekStrip';

/**
 * Today's hero — 05-today-dashboard.md §1 (Hero) and §5.
 *
 * The `dateLine` array API is kept deliberately: the line mixes scripts
 * ("MONDAY · सोमवार · 26 July 2026 · विक्रम संवत् 2083") and each segment needs
 * its own font and casing, which a formatted string cannot express. Segments
 * marked `hindi` take `--font-indic` and opt out of the uppercase tracking.
 *
 * The separator dots are gone; §1 gives the row a 9px gap and lets the script
 * change do the separating, which is one fewer glyph competing with the date.
 */
export default function Hero({ name, dateLine, lede, weekDates, dotsByDay, todayIdx }) {
  return (
    <section className="k-hero">
      {/* opacity .03 — §1: above about .05 the watermark competes with the lede
          sitting on top of it. Fixed decorative Devanagari, so --font-hindi
          rather than --font-indic: it does not follow the user's language. */}
      <div className="k-hero__watermark" lang="hi" aria-hidden="true">कर्तव्य</div>
      <div className="k-hero__inner">
        {dateLine && (
          <div className="k-hero__meta">
            {dateLine.map((seg, i) => (
              /* `seg.hindi` already says the segment is Devanagari — गुरुवार and
                 विक्रम संवत् — so it carries lang="hi" too. Without it neither
                 editorial.css guard fires and the samvat line takes Latin
                 leading and whatever tracking the meta row inherits. */
              <span
                key={seg.label ?? i}
                className={seg.hindi ? 'k-hero__samvat' : 'k-hero__date'}
                lang={seg.hindi ? 'hi' : undefined}
              >
                {seg.label}
              </span>
            ))}
          </div>
        )}
        <h1 className="k-hero__h1">
          <span className="k-hero__greet" lang="hi">नमस्ते,</span>
          <span className="k-hero__name"> {name}.</span>
        </h1>
        {lede && <p className="k-hero__lede">{lede}</p>}
        <WeekStrip weekDates={weekDates} dotsByDay={dotsByDay} todayIdx={todayIdx} />
      </div>
    </section>
  );
}
