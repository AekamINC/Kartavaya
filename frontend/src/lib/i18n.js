/**
 * i18n.js — the language primitives, with no React in them.
 *
 * These four functions used to live inside `components/CustomizePanel.jsx`,
 * behind an `import React`. That is the same mistake `lib/accent.js` was
 * extracted to fix: `scripts/check-accent-contrast.mjs` could not reach the
 * accent maths while it sat behind a React import, and one of the 24 pairs it
 * produces measured 1.96:1 with nobody able to run the check.
 *
 * The bilingual layer has exactly the same problem. `normalizeLanguage` is the
 * single decision that says which script a label renders in, and until now the
 * only way to ask it was to boot React. `lib/labels.js` is a plain data module,
 * a Node check can import this file, and a test can drive all four languages
 * without a provider.
 *
 * `CustomizePanel.jsx` re-exports `normalizeLanguage` from here, so every
 * existing `import { normalizeLanguage } from '../components/CustomizePanel'`
 * keeps resolving. There is one definition, in one place.
 */

/**
 * The four shipped interface languages.
 *
 * Standalone `hi` and `gu` were dropped 2026-07-25 (ledger §4). The prototype's
 * `LANGS` (SetCustomize.jsx:56) still lists six; the build is right and the
 * prototype is stale — 24 §"Two honest paths" recommendation (a) settles it the
 * build's way. Do not re-add them from the reference.
 */
export const LANGUAGES = Object.freeze(['en', 'en+sa', 'en+hi', 'en+gu']);

export const DEFAULT_LANGUAGE = 'en+sa';

const LANG_SET = new Set(LANGUAGES);

/* A value stored before the 2026-07-25 change must fall through to its
   bilingual equivalent rather than render the raw key — `data-language="hi"`
   matches no stylesheet rule and reads as a missing translation. */
const LANG_FALLBACK = { hi: 'en+hi', gu: 'en+gu' };

/** Fold any stored value onto one of the four. Never throws, never returns null. */
export function normalizeLanguage(lang) {
  if (LANG_SET.has(lang)) return lang;
  return LANG_FALLBACK[lang] || DEFAULT_LANGUAGE;
}

/**
 * The Indic field a language asks for — `null` under EN.
 *
 * `null` is the whole point of this module. Under EN the secondary label must
 * not be RENDERED, not merely hidden: `[data-language="en"]` names six class
 * names in two stylesheets, and the product renders Indic text under 82
 * distinct class names across 117 files. Five of the six are covered and 77
 * leak, so a user who chose English is reading three scripts. A display:none
 * rule has to know every class name anyone will ever add; a render decision
 * does not.
 */
const SECONDARY_FIELD = { en: null, 'en+sa': 'sa', 'en+hi': 'hi', 'en+gu': 'gu' };

export function secondaryField(lang) {
  return SECONDARY_FIELD[normalizeLanguage(lang)];
}

/** True when this language renders a second script at all. */
export function isBilingual(lang) {
  return secondaryField(lang) !== null;
}

/**
 * Devanagari (U+0900–U+097F) and Gujarati (U+0A80–U+0AFF).
 *
 * Exported because two different checks need the same definition of "Indic":
 * the EN assertion in `__tests__/bilingual.test.jsx`, and `labels.js`'s own
 * guard that a `gu` slot never holds Devanagari. That second one is a live bug
 * elsewhere in the tree — `lib/notifSound.js` lines 29-102 store 19 GUJARATI
 * strings under the key `hi`, so anything reading `.hi` and setting lang="hi"
 * is announcing Gujarati in a Hindi voice.
 */
export const DEVANAGARI_RE = /[ऀ-ॿ]/;
export const GUJARATI_RE   = /[઀-૿]/;
export const INDIC_RE      = /[ऀ-ॿ઀-૿]/;

export function hasDevanagari(s) { return DEVANAGARI_RE.test(String(s ?? '')); }
export function hasGujarati(s)   { return GUJARATI_RE.test(String(s ?? '')); }
export function hasIndic(s)      { return INDIC_RE.test(String(s ?? '')); }
