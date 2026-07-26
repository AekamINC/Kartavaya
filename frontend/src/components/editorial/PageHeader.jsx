import React from 'react';

/**
 * PageHeader — kicker, title, Devanagari term, lede.
 *
 * The signature was `{ kicker, title, sanskrit, lede, right }` with no rest
 * spread, and 12 of the 38 call sites passed `subtitle` and/or `sans` instead.
 * React does not complain about an extra prop on a function component, so those
 * pages rendered a bare title and dropped the rest on the floor — silently, in
 * production, since 11 files. `SanvaadPage` lost both its subtitle AND its
 * Devanagari.
 *
 * Two things change here. Every call site is corrected to the canonical names,
 * and the legacy names are accepted as aliases so that this failure mode cannot
 * come back: a wrong prop now renders in the right place instead of vanishing.
 * In dev it also warns, so the alias is a safety net rather than a second
 * supported spelling.
 */

const ALIASES = { sans: 'sanskrit', subtitle: 'lede' };

export default function PageHeader({ kicker, title, sanskrit, lede, right, ...rest }) {
  // Aliases resolve only when the canonical prop is absent, so a call site that
  // passes both keeps the canonical value.
  const sa   = sanskrit ?? rest.sans;
  const text = lede ?? rest.subtitle;

  if (import.meta.env?.DEV) {
    for (const [wrong, right_] of Object.entries(ALIASES)) {
      if (rest[wrong] !== undefined) {
        console.warn(
          `PageHeader: "${wrong}" is not a prop — use "${right_}". ` +
          `Rendered anyway (title: ${JSON.stringify(title)}).`
        );
      }
    }
  }

  return (
    <header className="k-pageh">
      <div className="k-pageh__txt">
        {kicker && <div className="k-pageh__kicker">{kicker}</div>}
        <h1 className="k-pageh__h1">
          {title}
          {/* lang marks the script change for screen readers and font matching;
              without it a reader pronounces Devanagari with English rules. */}
          {sa && <span className="k-pageh__sans" lang="sa">{sa}</span>}
        </h1>
        {text && <p className="k-pageh__lede">{text}</p>}
      </div>
      {right && <div className="k-pageh__right">{right}</div>}
    </header>
  );
}
