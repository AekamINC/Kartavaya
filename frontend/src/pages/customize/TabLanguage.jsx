import React from 'react';
import { useCustomize, normalizeLanguage } from '../../components/CustomizePanel';

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
  { label: 'EN + सं', hi: 'with Sanskrit terms', value: 'en+sa' },
  { label: 'EN + हि', hi: 'with Hindi',          value: 'en+hi' },
  { label: 'EN + ગુ', hi: 'with Gujarati',       value: 'en+gu' },
];

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
    </div>
  );
}
