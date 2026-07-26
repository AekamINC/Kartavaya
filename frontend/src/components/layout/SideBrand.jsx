/**
 * SideBrand.jsx — the mark plus the wordmark at the top of the sidebar.
 *
 * Extracted per 01-navigation.md §3. It also retires `KMark`, which drew the
 * mark as an inline
 *   linear-gradient(135deg, #0082c6, #03a1b6 55%, #05b7aa)
 * — the legacy blue→teal. 00 §9 retires #0082c6 outright; it survived here
 * because it was a hardcoded gradient rather than a token, so no sweep for
 * `var(--…)` could find it. The real asset ships in public/.
 */
import React from 'react';

export default function SideBrand({ rail = false }) {
  return (
    <div className="side__brand">
      <img
        className="side__mark"
        src="/kartavaya-mark.png"
        width={rail ? 28 : 32}
        height={rail ? 28 : 32}
        alt=""
        aria-hidden="true"
      />
      {!rail && (
        <div className="side__wm">
          {/* The English name is the accessible name of the brand; the
              Devanagari beneath is the same word in a second script, so it is
              hidden from assistive tech for the same reason the nav sub-labels
              are — announcing both reads the brand twice. */}
          <div className="side__wm-en">Kartavaya</div>
          <div className="side__wm-hi" lang="hi" aria-hidden="true">कर्तव्य</div>
          <div className="side__wm-sub">by Aekam Inc</div>
        </div>
      )}
    </div>
  );
}
