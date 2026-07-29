/**
 * useModuleWrite — "may the caller write to the module this page belongs to?"
 *
 * F32, second half. `b9174f0` gave the client a level to consult
 * (`/auth/me` → `module_levels`) and gated the ONE control every module page
 * routes through `ModuleHeader`'s `actions` slot. That covered the two reported
 * instances (`+ Invoice`, `Run payroll`) and nothing else: the sweep catalogued
 * **16 write controls on Ganit alone**, and all but the header's were still
 * rendered from the page shell.
 *
 * Gating the other fifteen one at a time — then again for every other module —
 * is the per-screen fix `moduleAccess.js` exists to avoid. What was missing is
 * not the answer but a way for a TAB to ask the question. `ModuleAccess`
 * carries the module code down from the page; this reads it and answers.
 *
 * ── The three states are `moduleAccess.js`'s, unchanged ──────────────────────
 *
 *   canWrite true   the caller holds editor or better, OR the server expressed
 *                   no opinion (org_owner/org_admin/platform staff), OR there
 *                   is no `ModuleAccess` above. Renders exactly as before —
 *                   this hook is inert for administrators.
 *   canWrite false  the server placed this caller below editor. The only state
 *                   that changes anything.
 *
 * ── Two shapes of caller, one answer ────────────────────────────────────────
 *
 * A control this codebase owns takes `disabled` and `title` directly, which is
 * what `InvoicesTab` does and what native semantics prefer — a real `disabled`
 * button is announced as disabled, an `inert` wrapper around one is silently
 * unreachable instead:
 *
 *     const { canWrite, reason } = useModuleWrite({ label: 'create invoices' });
 *     <button disabled={!canWrite} title={reason || undefined}>
 *
 * `WriteGate` wraps the arbitrary-JSX case, where there is no prop to set.
 * Both read this hook, so the two cannot disagree about the answer.
 *
 * @param {object} [opts]
 * @param {string} [opts.module] module code, when a component knows better
 *   than the context — a drawer rendered outside its page, say. Explicit wins.
 * @param {string} [opts.label] verb for the denial sentence — "create
 *   invoices" yields "…you can read it, but not create invoices."
 */
import { useContext } from 'react';
import { currentUser } from '../lib/auth';
import { ModuleAccessContext } from '../components/module/ModuleAccess';
import { canWriteModule, writeDenialReason } from '../lib/moduleAccess';

export default function useModuleWrite({ module: explicit, label } = {}) {
  const fromContext = useContext(ModuleAccessContext);
  const user = currentUser();
  const module = explicit || fromContext || null;

  // No module in scope means nothing to gate. See `ModuleAccess` — this is the
  // fail-open branch, and it is the one that keeps a forgotten provider from
  // greying out an administrator's whole page.
  if (!module) return { module: null, canWrite: true, reason: null };

  const canWrite = canWriteModule(user, module);
  return {
    module,
    canWrite,
    reason: canWrite ? null : writeDenialReason(user, module, label),
  };
}
