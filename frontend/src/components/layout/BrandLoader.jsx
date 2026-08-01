import React from 'react';
import Lotus from '../brand/Lotus';
import '../../styles/components.css';

/**
 * BrandLoader — the waiting state: क in the eye of a lotus that draws itself.
 *
 * It replaces the word "Loading…" at 13px and 50% opacity in an empty page.
 * Measured in the APK on a cold start, that text is on screen for about two
 * seconds between the Android splash dismissing and the first route painting —
 * long enough to read, and all it says is that nothing has happened yet.
 *
 * क is the letter on the launcher icon: the first letter of कर्तव्य, and of
 * Kartavaya. Anything else here would mean the loading screen and the home
 * screen showed two different products as far as the person holding the phone
 * is concerned.
 *
 * See Lotus for the drawing and why it is the one it is. The pace here is the
 * BRISK setting of the three that were tried: a 3.2s cycle, drawing in about
 * 1.3s. A route change or a table refresh usually resolves inside two seconds,
 * and a slower cycle would still be mid-assembly when the content arrived — the
 * person would never see the figure complete, only ever a fragment of it.
 *
 * The lotus holds at full for a third of the cycle then UNDRAWS from the same
 * end rather than fading. A fade leaves a grey ghost frame; undrawing keeps
 * every visible frame crisp, and neither end of the loop is ever blank — which
 * matters because a loading indicator that goes momentarily invisible is
 * indistinguishable from one that has died.
 */
export default function BrandLoader({ label = 'Loading' }) {
  return (
    <div className="bl" role="status" aria-live="polite">
      <div className="bl__mark">
        <Lotus size={168} />
        <span className="bl__ka" lang="hi" aria-hidden="true">क</span>
      </div>
      {/* Announced, never drawn. A screen reader user gets the word; everyone
          else gets the mark, which needs no caption. */}
      <span className="sr-only">{label}</span>
    </div>
  );
}
