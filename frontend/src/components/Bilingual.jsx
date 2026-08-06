import React from 'react';
import { useLanguage } from './CustomizePanel';
import { resolve, secondaryOf } from '../lib/labels';

/**
 * Bilingual — one label pair, rendered.
 *
 * ── The finding this exists to close ─────────────────────────────────────────
 *
 * "EN" was a stylesheet decision. Two copies of the same block — editorial.css
 * 3431-3444 and kartavaya-design.css 1543-1551 — hide SIX class names under
 * `[data-language="en"]`, plus a seventh scoped inside `.k-today` in today.css.
 * Measured against the tree: 202 JSX elements render Indic text across 117
 * files under 82 distinct class names. Two of the six named classes (`.k-hi`,
 * `.k-wday__hi`) have no call site at all — `.k-wday__hi` is a typo for the
 * `.k-week__hi` that WeekStrip actually emits, which is why today.css carries a
 * scoped patch for it. FIVE class names are covered. SEVENTY-SEVEN leak.
 *
 * So a user who chose English is reading three scripts, and no amount of care
 * fixes it in CSS: the rule has to know every class name anyone will ever add,
 * and the person adding the 83rd will not know the rule exists.
 *
 * Here, under `en`, the secondary node is NOT RENDERED. There is no CSS
 * involved, so there is nothing to leak through. `__tests__/bilingual.test.jsx`
 * states that as an assertion — no codepoint in U+0900–U+097F or U+0A80–U+0AFF
 * survives an EN render, across every registry key and every legacy shape.
 *
 * ── Accessibility ───────────────────────────────────────────────────────────
 *
 * Measured on the same 202 sites: 157 carry `lang=`, only 24 carry
 * `aria-hidden`. So ~178 announce the label twice — "Tasks कर्तव्य Tasks
 * कर्तव्य" as focus moves. Both attributes are unconditional here (23 §…,
 * 24 §"The component").
 *
 * `lang` comes from `resolve()`'s `script`, not from the language setting.
 * §24's own sketch hardcodes `'en+sa' → lang="sa"`, which mislabels every entry
 * whose `sa` is absent and whose `hi` was substituted — and by §24's own rule
 * ("a missing `sa` is the normal case") that is most of them.
 *
 * ── Usage ───────────────────────────────────────────────────────────────────
 *
 *   <Bilingual k="tasks" />                       registry key — preferred
 *   <Bilingual value={{ label: 'Invoices', hi: 'बीजक' }} />   any legacy shape
 *   <Bilingual value="Revenue · राजस्व" />         the middot string form
 *   <Bilingual k="graha" as="h1" className="k-pageh__t" />
 *   <Bilingual k="tasks" lang="en" />             explicit override, for previews
 *
 * `value` accepts all fifteen measured object shapes and both non-object forms,
 * so a call site migrates by handing over the object it already has. It does
 * not have to reach a registry key in the same commit.
 */
/**
 * The label pair, resolved against the ACTIVE language — for a caller that
 * renders it itself.
 *
 * `<Bilingual>` emits `.bi > .bi__en + .bi__in`. That is the right markup for a
 * label that is one object, and the wrong markup for the five components that
 * place the two runs independently — see the block at the foot of
 * `lib/labels.js`. Those want the decision without the DOM.
 */
export function useLabel(value, lang) {
  const active = useLanguage();
  return resolve(value, lang || active);
}

/**
 * `{secondary, script}` for a component that already holds the English in a
 * different prop. `{null, null}` under EN, which is what makes the secondary
 * absent rather than hidden.
 */
export function useSecondary(value, lang) {
  const active = useLanguage();
  return secondaryOf(value, lang || active);
}

/**
 * Secondary — the second-script run ALONE, in the element the call site already
 * had.
 *
 * ── Why this and not `<Bilingual>` ──────────────────────────────────────────
 *
 * `<Bilingual>` owns both runs and emits `.bi > .bi__en + .bi__in`. That is the
 * right markup when the label is one object, and the wrong markup for the
 * ~90 sites in this build that are shaped like
 *
 *     Collected <Secondary className="hi-mute" value="वसूला" />
 *     <Secondary className="dr__lbl-hi" value={hi} />
 *     <Secondary className="mt__hi" value={t.hi} />
 *
 * — where the English is a sibling text node the surrounding CSS already
 * positions, and the class on the Indic span is what places it (`.k-stat__lbl`
 * pushes its Devanagari to the trailing edge, `.mh__t` uses `order`). Wrapping
 * both runs in `.bi` collapses those layouts, which is exactly the reasoning at
 * the foot of `lib/labels.js` for `secondaryOf` existing at all.
 *
 * So this component changes NOTHING about the markup except whether it exists:
 * same tag, same className, and the two attributes every one of those sites
 * should have had —
 *
 *   `lang`        from the script the string is actually IN, never from the
 *                 language setting and never from the prop's name. 24 of the
 *                 measured sites had no `lang` at all, so `[lang="hi"]`'s
 *                 zero-tracking and leading rules never fired on them and the
 *                 conjuncts pulled apart under the parent's letter-spacing.
 *   `aria-hidden` because the same word in a second script is not more
 *                 information. Without it every one of these announces twice.
 *
 * Under EN it returns `null`: the node is ABSENT, not hidden. That is the whole
 * finding — `[data-language="en"]` names six class names, and a rule that has to
 * know every class name anyone will ever add cannot be right for long.
 */
export function Secondary({ value, k, lang, script: decided, as: Tag = 'span', className, children, ...rest }) {
  const active = useLanguage();
  /* `script` supplied means the caller has ALREADY asked `secondaryOf` — it
     resolved the pair itself, usually because it needed the `secondary` for a
     `&&` guard or to compute something else, and `value` is the answer rather
     than the question. Re-resolving it here would be right about the string and
     WRONG about the script: `secondaryOf('कर्तव्य')` reads the codepoints and
     answers `hi`, which silently rewrites a correctly-resolved `lang="sa"` on
     every entry that fell through `sa → hi`, and by lib/labels.js's own rule a
     missing `sa` is the normal case. So a decided script is taken, not
     re-derived. */
  const resolved = decided !== undefined
    ? { secondary: value, script: decided }
    : secondaryOf(value !== undefined ? value : k, lang || active);
  const { secondary, script } = resolved;
  if (!secondary) return null;
  return (
    <Tag className={className} lang={script} aria-hidden="true" {...rest}>
      {children ? children(secondary) : secondary}
    </Tag>
  );
}

export default function Bilingual({
  k,
  value,
  lang,
  as: Tag = 'span',
  className,
  enClassName = 'bi__en',
  inClassName = 'bi__in',
  ...rest
}) {
  const active = useLanguage();
  const { primary, secondary, script } = resolve(value !== undefined ? value : k, lang || active);

  return (
    <Tag className={className ? `bi ${className}` : 'bi'} {...rest}>
      <span className={enClassName}>{primary}</span>
      {/* `lang` so a screen reader that does read this uses the right voice;
          `aria-hidden` because it is the SAME label in a second script, not
          additional information. `script` can be `'unknown'` only when the
          caller supplied Indic text with no English beside it — that value
          never reaches this branch, because it comes back as the primary. */}
      {secondary ? (
        <span className={inClassName} lang={script} aria-hidden="true">{secondary}</span>
      ) : null}
    </Tag>
  );
}
