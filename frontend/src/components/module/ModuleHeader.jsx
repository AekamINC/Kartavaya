import React from 'react';
import { moduleColor } from '../../lib/moduleColors';
import { currentUser } from '../../lib/auth';
import { canWriteModule, writeDenialReason } from '../../lib/moduleAccess';

/**
 * ModuleHeader — the shared module page header (13-module-pages.md §1).
 *
 * English carries the hierarchy at 25px display, Hindi accompanies at 15px —
 * the same weighting rule as the sidebar, and DOM order matches visual weight
 * so the reading order does too.
 *
 * `module` is a moduleColors id; it sets --c, which the icon tint derives from.
 *
 * ── Why the actions slot consults the caller's level (F32) ───────────────────
 *
 * Every module page routes its primary write action through this one `actions`
 * prop — `+ Invoice` on Ganit, `Run payroll` on Vetana, `+ New deal` on Graha —
 * so gating it here fixes the page-header half of F32 for all nine modules at
 * once rather than nine times.
 *
 * Measured live on staging: a `ganit: viewer` was offered `+ Invoice` enabled,
 * and a member with NO grant was offered `Run payroll` enabled, which on click
 * led through a month picker to a confirmation modal for `Process and email` —
 * a button that mails a payslip PDF to every employee. The API refused
 * throughout; the UI advertised it throughout.
 *
 * **Disabled, not hidden.** The owner's note in session A: "a greyed `Run
 * payroll` reading 'needs editor on Vetana' teaches the model; a hidden button
 * teaches nothing, and an enabled one that fails teaches distrust." That is
 * also why the tooltip is the API's own sentence rather than a paraphrase — the
 * user reads the same reason whether they hover the button or press it.
 *
 * `inert` rather than `disabled`: `actions` is arbitrary JSX the caller owns,
 * and this component cannot reach into it to add a prop. `inert` takes the
 * whole subtree out of the tab order and stops pointer events, whatever it
 * contains, which is the property actually needed.
 *
 * A page with no `module` (the Srijan hub, admin consoles) is unaffected: with
 * nothing to check, the actions render exactly as before.
 */
export default function ModuleHeader({ module, en, hi, sub, icon, actions, kick }) {
  const user = currentUser();
  // Only gate when there IS a module to gate on. `canWriteModule` returns true
  // for "no opinion" (org_admin, org_owner, platform staff), so this is false
  // only for a member the server has actually placed below editor.
  const locked = !!module && !!actions && !canWriteModule(user, module);
  const reason = locked ? writeDenialReason(user, module) : null;

  return (
    <header className="mh" style={{ '--c': moduleColor(module) }}>
      {icon && <div className="mh__ic" aria-hidden="true">{icon}</div>}
      <div>
        {/* Section kicker — `REVENUE · राजस्व`. Every module screen in the
            rendered reference opens with one (`Data.jsx:27`, `PH`'s `kick`),
            naming the sidebar section the page belongs to. It is the only thing
            on the page that says where you are in the nav once the sidebar is
            collapsed, and the build had no equivalent. */}
        {kick && <div className="mh__kick">{kick}</div>}
        <div className="mh__t">
          <h1 className="mh__en">{en}</h1>
          {/* Same label, second script — tagged for the right voice, hidden from
              the accessibility tree so the heading is not announced twice. */}
          {hi && <span className="mh__hi" lang="hi" aria-hidden="true">{hi}</span>}
        </div>
        {sub && <div className="mh__sub">{sub}</div>}
      </div>
      {actions && (
        <div className={`mh__act${locked ? ' mh__act--locked' : ''}`} title={reason || undefined}>
          {/* The reason is announced once, to the group, rather than left to a
              title attribute a screen reader may never surface. */}
          {locked && <span className="k-sr-only">{reason}</span>}
          {/* `inert={true}`, not `inert=""`. React 19 treats `inert` as a
              BOOLEAN prop, so the empty string is falsy and the attribute is
              dropped entirely — measured live: the header action rendered
              greyed but stayed clickable. React 18 wanted the string; this
              project is on 19. */}
          <div className="mh__actin" inert={locked || undefined} aria-hidden={locked || undefined}>
            {actions}
          </div>
        </div>
      )}
    </header>
  );
}
