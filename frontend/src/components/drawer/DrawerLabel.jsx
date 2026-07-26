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
      {hi && <> <span className="dr__lbl-hi">{hi}</span></>}
    </span>
  );
}

export { DrawerLabel as Lbl };
