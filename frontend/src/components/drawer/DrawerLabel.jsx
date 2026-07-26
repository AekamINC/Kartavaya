import React from 'react';

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
 */
export default function DrawerLabel({ children, hi, count, className = '', ...rest }) {
  return (
    <span className={`dr__lbl ${className}`.trim()} {...rest}>
      {children}
      {count !== undefined && count !== null && ` (${count})`}
      {/* The Devanagari is the same label in a second script, not additional
          information, so it is hidden from the accessibility tree (23
          §Devanagari). Without this every drawer section announces twice —
          "Priority प्राथमिकता Priority प्राथमिकता" as focus crosses it — and
          the second half is read with the English voice. */}
      {hi && <> <span className="dr__lbl-hi" aria-hidden="true">{hi}</span></>}
    </span>
  );
}

export { DrawerLabel as Lbl };
