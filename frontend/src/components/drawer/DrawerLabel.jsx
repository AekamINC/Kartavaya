import React from 'react';
import { useSecondary } from '../Bilingual';

/**
 * The drawer's section label — English above the control, with the Devanagari
 * apposition beside it.
 *
 * It exists because the pair was hand-written seven times across the drawer,
 * each time as `<span style={lbl}>` plus a second inline object for the Hindi,
 * and the two copies had already drifted (10px vs 11px, `--ink-3` vs
 * `--ink-faint`). One component, one class pair: `.dr__lbl` / `.dr__lbl-hi`.
 *
 * The Devanagari uses `--font-indic`, not `--font-hindi`: `--font-indic`
 * follows the user's language and becomes Gujarati under `gu` / `en+gu`, while
 * `--font-hindi` is for fixed decorative Devanagari only (02, 24).
 *
 * ── THE ELEVENTH SHARED LABEL COMPONENT ─────────────────────────────────────
 *
 * Ten were converted to `useSecondary` and this one was not, because the check
 * that found the ten could not see it: `labelShape.test.jsx`'s old `SITE` regex
 * required a `lang=` attribute, and this span had none. So the component that
 * sits beside the ten, is used twelve times across `TaskDrawer`, `DrawerMeta`,
 * `DrawerSubtasks`, `DrawerComments` and `DrawerApproval`, and accounts for the
 * largest single class in the leak census (`dr__lbl-hi`, 25 sites) went
 * unmeasured — and rendered `Priority प्राथमिकता` to a user who chose English.
 *
 * The missing `lang` was itself the second half of the defect: without it the
 * `[lang="hi"]` leading and zero-tracking rules never fired, so the conjuncts
 * pulled apart under `.dr__lbl`'s own letter-spacing. `useSecondary` gives both
 * back — the decision AND the script the string is actually in.
 */
export default function DrawerLabel({ children, hi, count, className = '', ...rest }) {
  const { secondary, script } = useSecondary(hi);
  return (
    <span className={`dr__lbl ${className}`.trim()} {...rest}>
      {children}
      {count !== undefined && count !== null && ` (${count})`}
      {/* The separating space lives INSIDE the guard. Outside it, EN rendered a
          trailing space on every drawer label — invisible, and the reason to be
          careful is that "absent" has to mean absent.

          The Devanagari is the same label in a second script, not additional
          information, so it is hidden from the accessibility tree (23
          §Devanagari). Without this every drawer section announces twice —
          "Priority प्राथमिकता Priority प्राथमिकता" as focus crosses it — and
          the second half is read with the English voice. */}
      {secondary && <> <span className="dr__lbl-hi" lang={script} aria-hidden="true">{secondary}</span></>}
    </span>
  );
}

export { DrawerLabel as Lbl };
