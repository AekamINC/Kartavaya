/**
 * WindowBanner.jsx — the 24-hour window state, above the composer.
 *
 * Open: a quiet countdown, on `--s-low`. Closed: `--warn-container` with
 * `--on-warn-container`, because at that point the composer is about to change
 * shape under the user and they need to know why.
 */
import React, { useEffect, useState } from 'react';
import { formatRemaining } from './waWindow';

/** A 24-hour countdown does not need a second hand. */
const TICK_MS = 60000;

export default function WindowBanner({ state }) {
  const [, bump] = useState(0);
  useEffect(() => {
    const iv = setInterval(() => bump(n => n + 1), TICK_MS);
    return () => clearInterval(iv);
  }, []);

  if (!state.everInbound) {
    return (
      <div className="wa__win" role="status">
        <span className="wa__win-t">
          This customer has not messaged you yet, so only approved templates can be sent.
        </span>
      </div>
    );
  }

  if (state.open) {
    const remaining = formatRemaining(state.expiresAt - Date.now());
    return (
      <div className="wa__win wa__win--open" role="status">
        <span className="wa__win-t">
          24-hour window open · {remaining}. Free-form replies go through until then.
        </span>
      </div>
    );
  }

  return (
    <div className="wa__win" role="status">
      <span className="wa__win-t">
        The 24-hour window has closed. Meta only delivers approved templates until the customer
        writes again.
      </span>
    </div>
  );
}
