# Bilingual Labels & Devanagari

## Prerequisites
- `00-tokens.md` — `--font-hindi`, `--font-indic`
- `09-customization.md` — tab 4 owns the language selector
- `23-accessibility.md` — `lang` attributes and duplicate announcements

## Files to modify
- `frontend/src/components/layout/Sidebar.jsx` — `{en, hi, gu}` per item
- `frontend/src/components/layout/Topbar.jsx` — `{en, hi}`, no `gu`
- `frontend/src/components/CommandPalette.jsx` — `{label, hi}`, no `gu`
- `frontend/src/pages/InboxPage.jsx` — `{label, sans}`, a fourth shape
- `frontend/index.html` — font loading

## Files to create
- `frontend/src/lib/labels.js`
- `frontend/src/components/ui/BiLabel.jsx`

## Estimated scope
- 2 new files, 5+ modified. The finding below may change the scope considerably.

---

## The language selector cannot do what it offers

`CustomizeSettingsPage.jsx` offers six languages: **EN · EN+SA · EN+HI · EN+GU · हिन्दी · ગુજરાતી**.

There is **no translation layer in the codebase.** No i18n library, no message catalogue, no `t()`. Every string is written inline in the component that renders it. What exists is a per-item bilingual label on navigation:

```js
// Sidebar.jsx
{ to: '/settings/notifications', icon: 'notifications', en: 'Notifications', hi: 'सूचना', gu: 'સૂચના' }
```

So the last two options — हिन्दी and ગુજરાતી as *interface languages* — deliver Hindi or Gujarati navigation labels and leave everything else in English: every page heading, button, table column header, empty state, validation message, error, date format, and all 8 notification kinds.

**A user who picks हिन्दी expecting a Hindi interface gets an English interface with Hindi menu items.** That is worse than not offering it, because it looks like a broken translation rather than an absent one.

Two honest paths:

**(a) Relabel the four EN+X options as what they are** — a bilingual navigation preference, not an interface language — and remove हिन्दी and ગુજરાતી until a catalogue exists. Small change, ships now, promises nothing false.

**(b) Commit to real localisation.** `react-i18next`, a catalogue per language, and a translation pass over roughly 158 page files. That is a project, not a task, and it needs a decision about who writes the Hindi — machine-translated financial and legal terminology in a compliance product is a liability, not a feature.

**My recommendation is (a) now and (b) planned separately.** The four bilingual options are genuinely good and are what the product's audience actually wants — a Devanagari cue beside an English label, not a Devanagari interface. Do not let the two unfulfillable options discredit the four that work.

This decision gates the scope of this file. Everything below assumes (a).

## Four shapes for one concept

```js
Sidebar.jsx        { en: 'Notifications', hi: 'सूचना', gu: 'સૂચના' }
Topbar.jsx         { en: 'Notifications', hi: 'सूचना' }
CommandPalette.jsx { label: 'Notifications', hi: 'सूचना' }
InboxPage.jsx      { label: 'NOTIF', sans: 'सूचना' }
```

Different key names for the same field, and **Gujarati exists in exactly one of the four**. So a Gujarati user gets Gujarati in the sidebar and Hindi in the palette, top bar and Inbox — three scripts on one screen, none of them chosen.

One registry, one shape, one accessor:

```js
// lib/labels.js
export const LABELS = {
  tasks:         { en: 'Tasks',         hi: 'कर्तव्य',  gu: 'કર્તવ્ય',  sa: 'कर्तव्य' },
  boards:        { en: 'Boards',        hi: 'फ़लक',     gu: 'ફલક',      sa: 'फलक' },
  notifications: { en: 'Notifications', hi: 'सूचना',    gu: 'સૂચના',    sa: 'सूचना' },
  // … one entry per nav item, module, notification kind and status
};

export function label(key, lang) {
  const L = LABELS[key];
  if (!L) return key;                       // never throw on a missing label
  switch (lang) {
    case 'en':    return { primary: L.en, secondary: null };
    case 'en+sa': return { primary: L.en, secondary: L.sa };
    case 'en+hi': return { primary: L.en, secondary: L.hi };
    case 'en+gu': return { primary: L.en, secondary: L.gu };
    default:      return { primary: L.en, secondary: L.hi };
  }
}
```

Returning the key on a miss matters: a missing label should render `vikray` — visibly wrong, easy to spot, harmless — not crash the sidebar.

### `sa` is a closed set, not a translation job

Only terms in a fixed list get a Sanskrit form: the fifteen module names, the six task statuses, the four approval states, the three priorities, and the dozen or so nav items — **roughly 50–60 strings, enumerated once and frozen.** Everything else falls back to `hi`. Sanskrit is not a UI language and cannot absorb "Upload failed, retry?"; treating `sa` as a language to be filled in across the product invites a translator to coin vocabulary that no user reads and nobody can review.

Two consequences for `labels.js`: `sa` is optional on every entry rather than required, and the resolver falls through `sa → hi → en` silently. A missing `sa` is the normal case, not an error.

**`boards` is the worked example of why the list needs a Sanskrit speaker, not a dictionary.** The table above has `hi: 'फ़लक'` — *falak*, which is Persian by way of Urdu, carrying the nuqta that marks it as a loanword. It is perfectly good Hindi and completely wrong in the `sa` column, where it currently sits as `फलक` with the nuqta dropped. Sanskrit `फलक` (*phalaka*) does exist and means a plank or slab, which is a defensible root for "board" — but it arrived by transliteration rather than choice, and that is the failure mode to catch across all sixty.

`sa` is **not a copy of `hi`** for every term. Several module names are already Sanskrit rather than Hindi (कर्तव्य, सम्मति, प्रमाण), so where they coincide the duplication is correct; where they don't, they need separate values from someone who knows the difference. Do not machine-fill this column.

## The component

```jsx
export function BiLabel({ k, className }) {
  const { primary, secondary } = label(k, usePrefs().language);
  const lang = { 'en+hi': 'hi', 'en+sa': 'sa', 'en+gu': 'gu' }[usePrefs().language] ?? 'hi';
  return (
    <span className={className}>
      <span className="bi__en">{primary}</span>
      {secondary && <span className="bi__in" lang={lang} aria-hidden="true">{secondary}</span>}
    </span>
  );
}
```

Two attributes carry the accessibility half, both from `23-accessibility.md`:

- **`lang`** — without it a screen reader reads Devanagari with the English voice and produces noise.
- **`aria-hidden="true"`** on the secondary — it is the same label in another script, not additional information. Without it every nav item announces twice: "Tasks कर्तव्य Tasks कर्तव्य".

## Hierarchy: English leads

`01-navigation.md` settled this and the design files follow it: English at `--t-body-sm`/500, Devanagari at 10px in `--side-fg-mute`, English first in DOM order so reading order matches visual weight.

```css
.bi__en{font-family:var(--font-ui);font-size:var(--t-body-sm);font-weight:500;color:var(--on-surface)}
.bi__in{font-family:var(--font-indic);font-size:10px;color:var(--on-surface-3);line-height:1.5}
```

### Which token, where

**`--font-indic` on any label that follows the user's language.** `--font-hindi` only where the Devanagari is a fixed decorative glyph that never changes with the language setting — the hero watermark in `05`, the auth panel watermark in `12`. Those are chosen characters, not translations, and switching them to Gujarati would be wrong.

Everything else — sidebar, breadcrumb, card titles, module headers, drawer labels, stat labels, weekday strip, palette rows, Pahchan chrome — is `--font-indic`.

**Why it matters:** `00-tokens.md` §11 switches it to Noto Sans Gujarati when the language is `gu` or `en+gu`; hardcoding `--font-hindi` renders Gujarati text in a Devanagari font, which falls back per-glyph and looks broken.

10px is small for Devanagari. Weight and case contrast carry the hierarchy, not the size gap — but if user testing says it is tight, **11px is the fallback, not 12px**: at 12px the secondary starts competing with the primary and the hierarchy inverts.

## Devanagari needs more leading than Latin

Devanagari has a headline (शिरोरेखा) above the baseline and conjuncts that descend below it. At Latin line-heights, matras and conjuncts on adjacent lines collide.

```css
[lang="hi"], [lang="sa"], .bi__in { line-height: calc(var(--line-height-base) * 1.18) }
[lang="gu"] { line-height: calc(var(--line-height-base) * 1.12) }
```

Gujarati needs less because it has no headline. Both derive from `--line-height-base` so the Line height control still applies.

Never set `letter-spacing` on Devanagari. Tracking breaks conjunct ligatures — क्ष and ज्ञ render as separate glyphs with a gap. The negative tracking on display type (`-.02em` to `-.034em`) must be scoped to Latin only:

```css
.k-display:not([lang]){letter-spacing:-.024em}
[lang="hi"],[lang="sa"],[lang="gu"]{letter-spacing:normal !important}
```

Also never `text-transform: uppercase` — Devanagari and Gujarati are unicase, so it does nothing to them while the Latin beside them changes, breaking the pair.

## Fonts

```html
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Tiro+Devanagari+Hindi&family=Noto+Sans+Gujarati:wght@400;500&display=swap">
```

`display=swap` on the Indic faces specifically. With `display=block` (the default for some loaders) the Devanagari labels are **invisible** for up to 3 seconds while the sidebar renders around them — a gap where a label should be, on every cold load.

The fallback chain matters more here than for Latin. `00-tokens.md` sets `"Tiro Devanagari Hindi", "Noto Serif Devanagari", serif`. If both fail, generic `serif` on Windows resolves to a font with no Devanagari coverage and the browser falls back per-glyph — mixed weights within one word. Add `"Nirmala UI"` (ships with Windows) and `"Kohinoor Devanagari"` (ships with macOS) before the generic:

```css
--font-hindi: "Tiro Devanagari Hindi", "Noto Serif Devanagari", "Nirmala UI", "Kohinoor Devanagari", serif;
--font-indic-gu: "Noto Sans Gujarati", "Shruti", "Gujarati Sangam MN", sans-serif;
```

## Numerals stay Western

₹, dates, invoice numbers, GSTIN and phone numbers use Western digits with `font-variant-numeric: tabular-nums`, in every language. Devanagari numerals (१२३) are not what Indian business documents use, and a GSTIN in Devanagari digits is not a valid GSTIN.

Indian digit grouping is not the same as Western: **₹5,01,500**, not ₹501,500. `Intl.NumberFormat('en-IN')` does this correctly; a hand-rolled thousands regex does not, and this appears on invoices, statements and every money figure in Ganit and Vetana.

## Dates

```js
new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })  // 25 Jul 2026
```

Day-first, always. `en-US` gives `Jul 25, 2026`, which an Indian user reads as ambiguous at best and as 7 December at worst when the day is under 13.

**Vikram Samvat is decorative and currently wrong.** `05-today-dashboard.md` records the defect: the month is a naive `+1` offset from the Gregorian month, and the year rolls on a lunar date rather than a fixed boundary. Show the year alone (approximately right, decorative) or drop it. A specific Hindu month that is wrong is worse than none, in front of the audience most likely to notice.

## Where Devanagari appears — and where it must not

**Yes:** sidebar nav, module headers, notification kinds, status chips, document titles, section headers in documents (`18-documents.md`), the greeting on Today.

### The landing page is an exception, and it is deliberate

`22-landing-page.md` uses Devanagari more freely than the rule above allows — beside module names a visitor has never seen, in the hero, and as ornament. That contradicts "a recognition cue on things the user already knows the meaning of", because a first-time visitor knows none of them.

Keep it. The two surfaces are doing different jobs. In the app, a Devanagari sub-label is **wayfinding** for someone who navigates the same eight items every day; a word they cannot decode is noise in a path they walk constantly. On the landing page it is **positioning** — it says this product was built for an Indian practice, by people who name things in Sanskrit, before a single feature is read. A visitor is not navigating, so nothing is slowed down by a word they skim past.

The exception is bounded to `Landing.jsx` / `Landing2.jsx` and does not extend to the marketing site's app screenshots, the auth screens, or onboarding — by the time someone signs in they are navigating, and the app rule applies.

**No:** validation messages, error text, empty-state explanations, tooltips, form field labels, table column headers, anything inside a data cell.

The rule is that Devanagari is a **recognition cue on things the user already knows the meaning of**. A user who cannot read the English label for a module they use daily is helped by "गणित". A user reading an error for the first time is not helped by having half of it in a script they may not read, and a bilingual error is longer, slower and harder to scan at the moment they are least patient.

## The CRM label is wrong on a public page

`navConfig.js` and the landing page both label CRM **ग्राह**. That word is *grāha* — seizing, or a crocodile. It is not a near-miss for the intended word; it is a different word, and it is live.

**Use ग्राहक** (*grāhak*, customer).

The reasoning is the naming pattern the rest of the product already follows. Every module name is a meaningful word for what the module does, not a transliteration of a brand: कर्तव्य duty, गणित arithmetic, मानव human, वेतन salary, विक्रय sale, प्रचार promotion, दृष्टि vision, सृजन creation, संवाद dialogue, पहचान identity. A CRM is where customers live, so the word is *customer*.

ग्रह (*graha*, planet or house) is the correct transliteration of the Latin "Graha" and is the wrong meaning — it would read as an astrology module. ग्राहक is the right meaning and is one syllable longer than the Latin name.

**That mismatch is acceptable and the label should change without the route.** `/graha`, the `graha` key and `/v1/graha/*` are internal identifiers that no user reads; renaming them is a migration with no user-visible benefit. The Devanagari sub-label is the thing a Hindi reader actually parses, and today it says the wrong word on a public marketing page.

If the Latin name is also open to change, **Grahak** makes the pair agree exactly, and is the better long-term answer.

*Checked: the string appears in `navConfig.js` and in the landing page module list. Both are user-facing; the route and API paths were not changed by this recommendation.*

## The Aekam platform surface has no Devanagari

`11-platform-admin.md`: the platform console is an internal operator tool, English only. The bilingual layer is a customer-facing affordance, and adding it there implies the console is a customer surface — which is precisely the confusion the violet accent exists to prevent.
