import React from 'react';
import { useCustomize, normalizeLanguage } from '../../components/CustomizePanel';
import Bilingual from '../../components/Bilingual';

/**
 * TabLanguage — the four bilingual pairings.
 *
 * Standalone हिन्दी and ગુજરાતી were dropped as interface languages (ledger §4,
 * decided 2026-07-25) and normalizeLanguage() now folds them into their
 * bilingual equivalents. The picker still offered both, which made them a lie:
 * clicking हिन्दी stored `hi`, lit the button, and then rendered en+hi — the
 * setting appeared to work and did something else.
 *
 * The active check runs through normalizeLanguage() rather than comparing the
 * raw stored value, so an account that saved `hi` before the change shows
 * EN + हि selected, which is what it is actually getting.
 */
const OPTIONS = [
  { label: 'EN',      hi: 'English only',        value: 'en' },
  // "where we have them", not "with Sanskrit terms". `sa` is a closed set of
  // roughly fifty strings (24 §"`sa` is a closed set, not a translation job")
  // and everything else falls through to Hindi BY DESIGN, so this option and
  // EN + हि agree on most rows. The old copy promised a Sanskrit interface and
  // delivered a mostly-Hindi one, which reads as a broken setting rather than a
  // documented fallback.
  { label: 'EN + सं', hi: 'Sanskrit where we have it, else Hindi', value: 'en+sa' },
  { label: 'EN + हि', hi: 'with Hindi',          value: 'en+hi' },
  { label: 'EN + ગુ', hi: 'with Gujarati',       value: 'en+gu' },
];

/* The preview is not decoration: EN is the option most likely to be chosen and
   least likely to be verified, because the person choosing it cannot read the
   thing that is supposed to disappear. Four real labels, resolved through the
   same `lib/labels.js` the sidebar will use, show what the setting does before
   it is applied to the whole app. `boards` and `today` have Gujarati; `view.table`
   and `status.in_review` do not, so EN + ગુ visibly renders those two in English
   alone — which is the honest answer, and the reason the gap is worth seeing. */
const PREVIEW_KEYS = ['today', 'boards', 'view.table', 'status.in_review'];

export default function TabLanguage() {
  const { prefs, setPrefs } = useCustomize();
  const active = normalizeLanguage(prefs.language);

  return (
    <div className="st__group">
      <div className="sr sr--col">
        <div className="sr__l">
          <div className="sr__t">Interface language</div>
          <div className="sr__d">
            The second script appears alongside English labels, not instead of them.
          </div>
        </div>
        <div
          role="radiogroup"
          aria-label="Interface language"
          style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 9 }}
        >
          {OPTIONS.map(o => {
            const on = active === o.value;
            return (
              <button
                key={o.value}
                type="button"
                role="radio"
                aria-checked={on}
                className={`sbg__c${on ? ' on' : ''}`}
                onClick={() => setPrefs({ language: o.value })}
                style={{ padding: '11px 14px', textAlign: 'left' }}
              >
                <div style={{ fontSize: 13.5, fontWeight: on ? 600 : 500, color: 'var(--on-surface)' }}>
                  {o.label}
                </div>
                <div className="sr__d" style={{ marginTop: 1 }}>{o.hi}</div>
              </button>
            );
          })}
        </div>
      </div>

      <div className="sr sr--col">
        <div className="sr__l">
          <div className="sr__t">Preview</div>
          <div className="sr__d">
            Four labels as they will render. Under EN the second script is not drawn
            at all — it is not hidden, so nothing can leak through.
          </div>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14 }}>
          {PREVIEW_KEYS.map(k => <Bilingual key={k} k={k} lang={active} />)}
        </div>
      </div>
    </div>
  );
}
