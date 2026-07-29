import React, { createContext } from 'react';

/**
 * ModuleAccess — names the module a subtree belongs to. F32.
 *
 * A tab component is handed no module code, so it cannot ask whether the caller
 * may write. Prop-drilling one through ten tab files per module is the same
 * edit in ten places, which is the per-screen fix `moduleAccess.js` exists to
 * avoid. This carries it once, from the page that already knows it.
 *
 *     <ModuleAccess module="ganit">
 *       <div className="mpage">…ten tabs…</div>
 *     </ModuleAccess>
 *
 * ── Why not derive it from the route ─────────────────────────────────────────
 *
 * `navConfig.ROUTE_META` already maps every module path to its code, so
 * `useLocation()` would need no provider at all — and that was the first cut of
 * this. It broke eleven existing tests: `ganitInvoiceDrawer.test.jsx` renders
 * `<InvoicesTab/>` with no Router, `useLocation` throws an invariant outside
 * one, and every future test of a gated component would have hit the same wall.
 * A page-level provider costs one line per module page and cannot throw.
 *
 * ── A missing provider FAILS OPEN, deliberately ──────────────────────────────
 *
 * No provider means `null`, which `useModuleWrite` reads as the third state
 * `moduleAccess.js` already defines — "no opinion" — and every control renders
 * exactly as it did before this existed. Fail-closed would be the wrong
 * direction: a page whose provider was forgotten would grey out every button
 * for its own org_admin, and the thing being protected is the user's trust, not
 * the data. `require_module` is the gate and refuses regardless; this only
 * decides whether the product offers an action it will refuse.
 */
export const ModuleAccessContext = createContext(null);

export default function ModuleAccess({ module, children }) {
  return (
    <ModuleAccessContext.Provider value={module || null}>
      {children}
    </ModuleAccessContext.Provider>
  );
}
