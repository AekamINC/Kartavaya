import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';

import Bilingual from '../components/Bilingual';
import { LABELS, label, resolve, toEntry, coverage, missingGujarati } from '../lib/labels';
import { LANGUAGES, normalizeLanguage, secondaryField, DEVANAGARI_RE, GUJARATI_RE, INDIC_RE } from '../lib/i18n';
import { NAV_FULL, NAV_CLIENT, MOBILE_NAV, EXTRA_ROUTES, ROUTE_META } from '../components/layout/navConfig';

/**
 * The finding, stated as a check.
 *
 * "EN" was a stylesheet decision naming six class names in two stylesheets,
 * against 202 Indic-bearing JSX elements under 82 distinct class names. Five
 * covered, seventy-seven leaking — a user who chose English was reading three
 * scripts. The fix is that the secondary node is not RENDERED under EN, and
 * this file is what makes that provable rather than asserted: every registry
 * key, and every legacy shape the migration has to survive, rendered under EN
 * with no codepoint in U+0900–U+097F or U+0A80–U+0AFF surviving.
 *
 * These tests deliberately render OFF-provider. `Bilingual` must not need one —
 * a label component that can take down an error boundary because a context is
 * missing is worse than one that falls back to the default pairing — and the
 * `lang` prop drives the language explicitly, so the assertions do not depend
 * on what happens to be in localStorage.
 */

const ALL_KEYS = Object.keys(LABELS);

/* The fifteen keyed shapes and the two non-object mechanisms measured across
   frontend/src, one specimen each. This list IS the census: if a sixteenth
   shape appears, it belongs here with the file that introduced it. */
const LEGACY_SHAPES = [
  ['{en, hi}          65 files', { en: 'Tasks', hi: 'कर्तव्य' }],
  ['{label, hi}       23 files', { label: 'Invoices', hi: 'बीजक' }],
  ['{en, hi, gu}      navConfig', { en: 'Boards', hi: 'फ़लक', gu: 'ફલક' }],
  ['{section,sans,gu} navConfig', { section: 'workspace', sans: 'कार्यक्षेत्र', gu: 'કાર્યક્ષેત્ર' }],
  ['{code, label, hi} platformRoles.js', { code: 'org_owner', label: 'Owner', hi: 'स्वामी' }],
  ['{label, hi, sub}  5 module pages', { label: 'Revenue', hi: 'राजस्व', sub: 'this month' }],
  ['{label, sans}     MyTasksView.jsx', { label: 'My Tasks', sans: 'मम कार्याणि' }],
  ['{title, sans}     TasksListPage.jsx', { title: 'Tasks', sans: 'कर्तव्य' }],
  ['{label, sanskrit} BillingLinesBlock.jsx', { label: 'Seats', sanskrit: 'स्थान' }],
  ['{name, hi}        onboarding/data.js', { name: 'Finance', hi: 'गणित' }],
  ['{name, _hindi}    KanbanView.jsx', { name: 'To do', _hindi: 'कार्य' }],
  ['{title, hi}       statutoryCalendar.js', { title: 'PF return', hi: 'भविष्य निधि' }],
  ['{mod, hi}         RecordCard.jsx', { mod: 'Sales', hi: 'विक्रय' }],
  ['{k, hi}           CatalogTab.jsx', { k: 'Skills', hi: 'कौशल' }],
  ['{module, hi}      dristi/_shared.jsx', { module: 'Analytics', hi: 'दृष्टि' }],
  ['middot string     48 occurrences', 'Revenue · राजस्व'],
  ['{label, hindi}    mobile SettingsScreen', { label: 'Account', hindi: 'खाता' }],
  ['{title, titleHi}  mobile TodayScreen', { title: 'Today', titleHi: 'आज' }],
];

const textOf = (ui) => render(ui).container.textContent;

describe('EN renders no second script — anywhere', () => {
  it('every registry key, rendered under EN, contains no Indic codepoint', () => {
    const leaks = ALL_KEYS.filter(k => INDIC_RE.test(textOf(<Bilingual k={k} lang="en" />)));
    // Named rather than counted: a failure should say WHICH label leaked.
    expect(leaks).toEqual([]);
  });

  it('every registry key resolves with secondary === null under EN', () => {
    const withSecondary = ALL_KEYS.filter(k => label(k, 'en').secondary !== null);
    expect(withSecondary).toEqual([]);
  });

  it('every legacy shape, rendered under EN, contains no Indic codepoint', () => {
    for (const [name, value] of LEGACY_SHAPES) {
      expect([name, INDIC_RE.test(textOf(<Bilingual value={value} lang="en" />))]).toEqual([name, false]);
    }
  });

  it('renders exactly one child node under EN — the secondary is absent, not hidden', () => {
    const { container } = render(<Bilingual k="tasks" lang="en" />);
    expect(container.querySelectorAll('.bi__in')).toHaveLength(0);
    expect(container.querySelectorAll('.bi__en')).toHaveLength(1);
    // The old mechanism: a node in the DOM, hidden by a class the stylesheet
    // had to already know about. Nothing to hide means nothing to miss.
    expect(container.textContent).toBe('Tasks');
  });
});

describe('the bilingual options do render a second script', () => {
  it('EN + हि pairs English with Devanagari and marks it lang="hi"', () => {
    const { container } = render(<Bilingual k="tasks" lang="en+hi" />);
    const secondary = container.querySelector('.bi__in');
    expect(container.querySelector('.bi__en').textContent).toBe('Tasks');
    expect(DEVANAGARI_RE.test(secondary.textContent)).toBe(true);
    expect(secondary.getAttribute('lang')).toBe('hi');
  });

  it('EN + ગુ pairs English with GUJARATI and never with Devanagari', () => {
    // The wrong-script bug, as a check. `lib/notifSound.js` stores 19 Gujarati
    // strings under the key `hi`; anything reading `.hi` and writing lang="hi"
    // announces Gujarati in a Hindi voice. A `gu` slot must never hold
    // Devanagari, and a missing `gu` must fall through to ENGLISH rather than
    // to `hi` — showing the wrong script is worse than showing one less.
    const guBearing = ALL_KEYS.filter(k => LABELS[k].gu);
    expect(guBearing.length).toBeGreaterThan(40);
    for (const k of guBearing) {
      const { secondary, script } = label(k, 'en+gu');
      expect([k, GUJARATI_RE.test(secondary)]).toEqual([k, true]);
      expect([k, DEVANAGARI_RE.test(secondary)]).toEqual([k, false]);
      expect(script).toBe('gu');
    }
    for (const k of missingGujarati()) {
      expect([k, label(k, 'en+gu').secondary]).toEqual([k, null]);
    }
  });

  it('the secondary is aria-hidden — the same label twice is not more information', () => {
    // 157 of the 202 live Indic sites carry lang=, only 24 carry aria-hidden,
    // so ~178 announce "Tasks कर्तव्य Tasks कर्तव्य" as focus moves.
    const { container } = render(<Bilingual k="tasks" lang="en+hi" />);
    expect(container.querySelector('.bi__in').getAttribute('aria-hidden')).toBe('true');
  });

  it('lang= names the script the string is actually in, not the setting', () => {
    // `app` has a real `sa`; `view.table` does not and falls through to `hi`.
    // The handover's own sketch hardcodes 'en+sa' → lang="sa", which mislabels
    // every fallthrough — and by its own rule those are the normal case.
    expect(label('app', 'en+sa').script).toBe('sa');
    expect(label('view.table', 'en+sa').script).toBe('hi');
    const { container } = render(<Bilingual k="view.table" lang="en+sa" />);
    expect(container.querySelector('.bi__in').getAttribute('lang')).toBe('hi');
  });

  it('EN + सं is currently byte-identical to EN + हि, and that is the measured debt', () => {
    // Two things are true at once and they are easy to confuse.
    //
    // The RESOLVER is correct: 24 §"`sa` is a closed set, not a translation
    // job" says roughly fifty strings get a Sanskrit form and everything else
    // falls through `sa → hi`, so agreement on most rows is specified.
    //
    // The DATA is empty: not one entry in this registry holds an `sa` value
    // that differs from its `hi`. `sa:` appears zero times in navConfig.js; the
    // nine section headings carry `sans`, which seeds both columns with the
    // same word. So two of the four shipped language options render identically
    // — including the DEFAULT, `en+sa`.
    //
    // That gap is not closable from here. Filling it needs a Sanskrit speaker,
    // and §24 works the example of why a dictionary is not enough: `फ़लक` is
    // Persian by way of Urdu, correct Hindi and wrong in the `sa` column, and
    // it arrived there by transliteration rather than choice.
    //
    // Pinned rather than skipped, so the day someone fills the column this test
    // fails and the person filling it has to come back here and say how many.
    const differ = ALL_KEYS.filter(k => label(k, 'en+sa').secondary !== label(k, 'en+hi').secondary);
    expect(differ).toEqual([]);
  });
});

describe('the registry', () => {
  it('returns the key on a miss rather than throwing', () => {
    // A missing label should render `vikray` — visibly wrong, easy to spot,
    // harmless — not crash the sidebar.
    expect(label('no-such-key', 'en+hi')).toEqual({ primary: 'no-such-key', secondary: null, script: null });
    expect(textOf(<Bilingual k="no-such-key" lang="en+hi" />)).toBe('no-such-key');
  });

  it('is seeded from navConfig, so Gujarati has exactly one source', () => {
    const navItems = [...NAV_FULL, ...NAV_CLIENT].flatMap(g => g.items);
    for (const it of navItems) {
      expect([it.en, Boolean(it.key)]).toEqual([it.en, true]);
      expect([it.key, LABELS[it.key]?.en]).toEqual([it.key, it.en]);
      expect([it.key, LABELS[it.key]?.gu]).toEqual([it.key, it.gu]);
    }
    for (const it of MOBILE_NAV) expect(LABELS[it.key]?.en).toBe(it.en);
    for (const r of EXTRA_ROUTES) expect(LABELS[r.key]?.en).toBe(r.en);
  });

  it('every nav key is unique per destination and reaches ROUTE_META', () => {
    const routed = [...NAV_FULL, ...NAV_CLIENT].flatMap(g => g.items);
    const byPath = new Map();
    for (const it of routed) byPath.set(it.to.split('?')[0], it.key);
    for (const [path, key] of byPath) expect([path, ROUTE_META[path]?.key]).toEqual([path, key]);
  });

  it('covers hi completely, and reports the Gujarati gap as a number', () => {
    const c = coverage();
    // hi is complete: every entry either has one or is deliberately English.
    expect(c.total).toBeGreaterThan(50);
    expect(c.hi).toBe(c.total);
    // gu is partial and that is the debt. Pinned so it cannot silently shrink;
    // raise this number when a Gujarati speaker fills more of the column.
    //
    // 45 distinct KEYS, not the 48 values the survey counted: MOBILE_NAV repeats
    // Today, Tasks and Messages from the sidebar, so three of the 48 are the
    // same three words written twice. Deduplicating them is a thing this
    // registry does that fifteen shapes could not.
    expect(c.gu).toBeGreaterThanOrEqual(45);
    expect(c.gu).toBeLessThan(c.total);
  });

  it('holds no Devanagari in a gu slot and no Gujarati in an hi slot', () => {
    const wrong = ALL_KEYS.filter(k =>
      (LABELS[k].gu && DEVANAGARI_RE.test(LABELS[k].gu)) ||
      (LABELS[k].hi && GUJARATI_RE.test(LABELS[k].hi)));
    expect(wrong).toEqual([]);
  });
});

describe('backward compatibility — the migration does not have to be one commit', () => {
  it('reads all eighteen measured shapes and mechanisms', () => {
    for (const [name, value] of LEGACY_SHAPES) {
      const { primary, secondary } = resolve(value, 'en+hi');
      expect([name, Boolean(primary)]).toEqual([name, true]);
      expect([name, INDIC_RE.test(primary)]).toEqual([name, false]);
      expect([name, Boolean(secondary)]).toEqual([name, true]);
    }
  });

  it('prefers `en` over `module`, which is an English key elsewhere', () => {
    // navConfig items carry BOTH, and `module: 'graha'` is a code, not a label.
    expect(resolve({ en: 'CRM', hi: 'ग्रह', module: 'graha' }, 'en').primary).toBe('CRM');
  });

  it('moves a Gujarati string out of an `hi` slot rather than announcing it as Hindi', () => {
    // lib/notifSound.js does exactly this, 19 times.
    const entry = toEntry({ label: 'Garba', hi: 'ગરબા' });
    expect(entry.hi).toBeUndefined();
    expect(entry.gu).toBe('ગરબા');
    expect(render(<Bilingual value={{ label: 'Garba', hi: 'ગરબા' }} lang="en+hi" />)
      .container.querySelector('.bi__in')).toBeNull();
    expect(render(<Bilingual value={{ label: 'Garba', hi: 'ગરબા' }} lang="en+gu" />)
      .container.querySelector('.bi__in').getAttribute('lang')).toBe('gu');
  });

  it('splits the middot form and drops the middot itself', () => {
    expect(resolve('Revenue · राजस्व', 'en+hi')).toEqual({ primary: 'Revenue', secondary: 'राजस्व', script: 'hi' });
    expect(textOf(<Bilingual value="Revenue · राजस्व" lang="en" />)).toBe('Revenue');
  });

  it('never repeats the same string twice', () => {
    // `{en: 'सम्मति', hi: 'सम्मति'}` renders once, not "सम्मति सम्मति".
    expect(resolve({ en: 'सम्मति', hi: 'सम्मति' }, 'en+hi').secondary).toBeNull();
  });

  it('degrades on a bare string and on nothing at all', () => {
    expect(resolve('Just English', 'en+hi').primary).toBe('Just English');
    expect(resolve(null, 'en+hi')).toEqual({ primary: '', secondary: null, script: null });
    expect(textOf(<Bilingual value={null} lang="en+hi" />)).toBe('');
  });
});

describe('language normalisation', () => {
  it('folds the two retired standalone options onto their bilingual pairs', () => {
    expect(normalizeLanguage('hi')).toBe('en+hi');
    expect(normalizeLanguage('gu')).toBe('en+gu');
  });

  it('folds anything unknown, including undefined, onto the default', () => {
    for (const v of [undefined, null, '', 'fr', 'en+ta', 42]) {
      expect(LANGUAGES).toContain(normalizeLanguage(v));
    }
  });

  it('EN is the only option with no secondary field', () => {
    expect(secondaryField('en')).toBeNull();
    for (const l of LANGUAGES.filter(l => l !== 'en')) expect(secondaryField(l)).not.toBeNull();
  });
});
