import React from 'react';
import useModuleWrite from '../../hooks/useModuleWrite';

/**
 * WriteGate — wrap a write control in the caller's level. F32.
 *
 * `ModuleHeader` has gated its `actions` slot since `b9174f0`, which covered
 * the one primary control per module page. This is the same treatment made
 * available to the other fifteen on Ganit, and to every tab on every module,
 * without each one re-deriving the answer or re-implementing the affordance.
 *
 *     <WriteGate label="create invoices"><button>+ Invoice</button></WriteGate>
 *
 * The module code comes from the `ModuleAccess` above it, so a tab passes
 * nothing. `module` is accepted for the cases where the context does not say.
 *
 * ── Renders NOTHING of its own when the caller may write ─────────────────────
 *
 * The early `return children` is the load-bearing line. `canWrite` is true for
 * every org_owner, org_admin and platform user — the overwhelming majority of
 * renders — and for them this component must be indistinguishable from not
 * being there at all. A wrapper element that is merely styled to be neutral
 * still lands in flex and grid layouts, still becomes a table cell's child,
 * still breaks a `:first-child` selector. Emitting no node cannot.
 *
 * That is why the locked branch is free to use a real box: it is the rare path,
 * and it needs one for the tooltip to have something to hover and the filter
 * something to apply to.
 *
 * ── Disabled, not hidden ─────────────────────────────────────────────────────
 *
 * The owner's rule from session A, unchanged from `ModuleHeader`: "a greyed
 * `Run payroll` reading 'needs editor on Vetana' teaches the model; a hidden
 * button teaches nothing, and an enabled one that fails teaches distrust." The
 * tooltip is the API's own sentence, so hovering and pressing say the same
 * thing.
 *
 * `inert` rather than `disabled` because `children` is arbitrary JSX this
 * component cannot reach into to add a prop — it takes the whole subtree out of
 * the tab order and stops pointer events whatever it contains.
 *
 * **Prefer `disabled` where you own the control.** A real `<button disabled>`
 * is announced as disabled by a screen reader; an `inert` wrapper around an
 * enabled button is silently unreachable instead, which is worse. Reach for
 * `useModuleWrite` directly and set the prop — this component is for the JSX
 * you cannot reach into. `ModuleHeader` keeps its own copy of this markup for
 * the same reason it always has: `.mh__act` carries the header's layout as well
 * as the gate, and both read `canWriteModule`, so the answer is shared even
 * though the markup is not.
 *
 * `inert={locked || undefined}`, never `inert=""`. React 19 treats `inert` as a
 * BOOLEAN prop, so an empty string is falsy and the attribute is dropped —
 * measured live on staging, the control rendered greyed and stayed clickable.
 *
 * @param {string} [label] verb for the denial sentence — "create invoices"
 *   yields "…you can read it, but not create invoices." Defaults to
 *   "change it".
 * @param {string} [module] override when the route does not name the module.
 */
export default function WriteGate({ children, label, module, className }) {
  const { canWrite, reason } = useModuleWrite({ module, label });

  // No wrapper, no class, no DOM. See above — this is the common path.
  if (canWrite) return children;

  return (
    /* `.wg` carries the locked look with no `--locked` modifier beside it: this
       element is only ever in the document when the caller may NOT write, so a
       base/state split would describe a state that cannot exist. */
    <span className={`wg${className ? ` ${className}` : ''}`} title={reason || undefined}>
      {/* Announced once, to the group, rather than left to a title attribute a
          screen reader may never surface. */}
      <span className="k-sr-only">{reason}</span>
      <span className="wg__in" inert={true} aria-hidden={true}>
        {children}
      </span>
    </span>
  );
}
