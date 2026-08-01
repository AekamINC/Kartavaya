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
        {/*
            DEVANAGARI FIRST, and at full size.

            This rendered `{title}` then `{sa}` — English as the headline in the
            44px display serif, Devanagari beside it at 0.7em. The design source
            is the other way round and it is not a detail: `Data.jsx:32` is
            `<span ph__hi>{hi}</span><span ph__en>{en}</span>`, and `app.css:144`
            sets `.ph__hi` to 1em while `.ph__en` is .56em, uppercase, muted and
            in the UI face.

            So the Hindi word IS the page title — कर्तव्य TASKS, ग्रह CRM — and
            the English is a small companion label. We had it inverted, in one
            shared component, on all twenty pages that use it. That single
            inversion is most of why the live pages did not read like the
            design files.
        */}
        <h1 className="k-pageh__h1">
          {/* lang marks the script change for screen readers and font matching;
              without it a reader pronounces Devanagari with English rules.

              `hi`, not `sa`. The prop is named `sanskrit` but not one of the 53
              values actually passed to it across the app is a Sanskrit-only
              form. Several are impossible in Sanskrit: फ़ोल्डर and डेटा are
              English loanwords carrying a nuqta, खाते is the Hindi oblique of an
              Arabic loan, संस्थाएँ / परियोजनाएँ / भूमिकाएँ take the Hindi
              feminine plural -एँ (Sanskrit is -आः), and दल की गतिविधि,
              आपके हाथ में, अन्य पर निर्भर and योजना बदलें use Hindi
              postpositions and imperatives. Genuine Sanskrit in this product is
              the Gītā citations and the यथारुचि epigraph, which are separate
              components and keep lang="sa".
              No visual change: [lang="hi"] and [lang="sa"] carry the same
              leading and tracking rules. This only fixes the voice a screen
              reader uses. */}
          {sa && <span className="k-pageh__sans" lang="hi">{sa}</span>}
          <span className="k-pageh__en">{title}</span>
        </h1>
        {text && <p className="k-pageh__lede">{text}</p>}
      </div>
      {right && <div className="k-pageh__right">{right}</div>}
    </header>
  );
}
