/**
 * WindowBanner.jsx — the 24-hour window state, above the composer.
 *
 * Open: a quiet countdown, on `--s-low`. Closed: `--warn-container` with
 * `--on-warn-container`, because at that point the composer is about to change
 * shape under the user and they need to know why.
 */
import React, { useEffect, useState } from 'react';
import { SvIcons } from '../icons';
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
      <div className="m2c__banner m2c__banner--warn" role="status">
        {SvIcons.lock}
        <span className="wa__win-t">
          <b>This customer has not messaged you yet</b>, so only approved templates can be sent.
        </span>
      </div>
    );
  }

  if (state.open) {
    const remaining = formatRemaining(state.expiresAt - Date.now());
    return (
      <div className="m2c__banner m2c__banner--mute" role="status">
        {/* `ScreensVarta.jsx` marks the window state with `SI.clock2`. The
            banner is `--s-low` while the window is open and `--warn-container`
            when it is not, so the glyph is what makes the two scannable
            without reading the sentence. */}
        {SvIcons.clock}
        <span className="wa__win-t">
          24-hour window open · {remaining}. Free-form replies go through until then.
        </span>
      </div>
    );
  }

  return (
    <div className="m2c__banner m2c__banner--warn" role="status">
      {SvIcons.lock}
      <span className="wa__win-t">
        <b>The 24-hour window has closed.</b> Only an approved template can start the
        conversation again — a free-text reply would be rejected by WhatsApp, not by us.
      </span>
    </div>
  );
}
