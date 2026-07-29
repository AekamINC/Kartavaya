/**
 * moduleAccess.js — the caller's LEVEL on a module, and what follows from it.
 *
 * F32: write affordances rendered from the module's page shell rather than from
 * the caller's level. A `ganit: viewer` was handed the full Create Invoice form
 * and composed an ₹88,500 invoice before being refused on submit; a member with
 * NO grants was offered `Run payroll`, and pressing it walked them through the
 * payroll tab, a month picker and a confirmation modal to a `Process and email`
 * button that mails a payslip PDF to every employee.
 *
 * The API refused all of it — the gate is sound and its messages are good. What
 * was wrong is that the product invited the action, accepted the effort, and
 * refused at the last step.
 *
 * **The client could not have done better, because it had nothing to consult.**
 * `/auth/me` sent `module_grants[]` — module CODES — which answers reach, not
 * depth. `useSanvaadAccess.js` says exactly this in its header and works around
 * it with a bespoke `GET /v1/messaging/me`. `auth_router.py::_module_levels`
 * now answers it for every module, mirroring `require_module` gate for gate, and
 * this file is the one place that reads it.
 *
 * ── The three states, and why the difference is load-bearing ─────────────────
 *
 *   object   these levels and no others. An EMPTY object is a real answer:
 *            "granted nothing", and every write is refused.
 *   absent   NO OPINION — an org_owner/org_admin, whose reach is the
 *            subscription rather than a grant row, or a user with no org. Every
 *            write stays enabled.
 *
 * `module_levels && ...` is what keeps those apart, the same discipline
 * `navConfig.js` applies to `module_grants`. Treating a missing signal as "no
 * levels" would disable every write button in the product for administrators.
 */

const VIEWER = 'viewer';
const EDITOR = 'editor';
const APPROVER = 'approver';
const ADMIN = 'admin';

/** The ladder, weakest first — `role_tiers.LEVELS`. */
export const LEVELS = [VIEWER, EDITOR, APPROVER, ADMIN];

/**
 * Modules where APPROVER and ADMIN are deliberately NOT a hierarchy.
 *
 * `role_tiers.SEPARATED_DUTY_MODULES`. Holding `admin` on payroll means you
 * configure it, not that you may release money against it — so `admin` must not
 * light up an Approve button here. A user who needs both holds both, visibly.
 */
const SEPARATED_DUTY = new Set(['vetana', 'ganit']);

/**
 * Surface ids that are not grant codes.
 *
 * `moduleColors.js` keys a module page's IDENTITY — its colour, its label —
 * and it carries two entries for Srijan, because it is two surfaces:
 * `hub` is the agency console at `/hub`, `srijan` the org's own at `/hub/org`.
 * `org_member_modules` knows only ONE of those names, `srijan`, which is what
 * `navConfig` maps both routes to.
 *
 * `ModuleHeader` takes a single `module` prop and spends it twice — on
 * `moduleColor()` and on `canWriteModule()`. For nine modules the colour id and
 * the grant code are the same string and the conflation is invisible. For the
 * three Hub pages, which pass `module="hub"`, it is not: a member holding
 * `srijan: editor` was asked about a code no grant row can ever contain, and
 * `levelSatisfies(undefined, …)` is false, so the page's primary action was
 * greyed out for the very user entitled to it.
 *
 * That is the F32 failure in reverse and the worse direction of the two —
 * refusing someone who holds the grant, rather than inviting someone who does
 * not. Translating here rather than at the three call sites keeps the next
 * page that passes a colour id from reintroducing it.
 */
const GRANT_CODE = { hub: 'srijan' };

/** The grant code a surface id maps to. Identity for all nine plain modules. */
export function grantCode(code) {
  return GRANT_CODE[code] || code;
}

/** The caller's level on `code`, or `null` when the server expressed no opinion. */
export function moduleLevel(user, code) {
  const levels = user?.module_levels;
  if (!levels || typeof levels !== 'object') return null;
  const held = levels[grantCode(code)];
  return LEVELS.includes(held) ? held : null;
}

/**
 * Mirror of `role_tiers.level_satisfies`.
 *
 * A level the ladder does not know reads as NOT satisfying, which is the same
 * direction `require_module` fails in — advertising a write the API refuses is
 * the bug this file exists to end.
 */
export function levelSatisfies(held, required, code) {
  if (!held || !LEVELS.includes(held) || !LEVELS.includes(required)) return false;
  if (SEPARATED_DUTY.has(code) && required === APPROVER) return held === APPROVER;
  return LEVELS.indexOf(held) >= LEVELS.indexOf(required);
}

/**
 * May this user write to `code`?
 *
 * `require_module` decides the rung by HTTP VERB rather than per route — every
 * non-read request needs EDITOR — so one boolean answers every write control on
 * a module page. That is why this fix is central rather than per screen.
 */
export function canWriteModule(user, code) {
  const levels = user?.module_levels;
  if (!levels || typeof levels !== 'object') return true;   // no opinion
  const grant = grantCode(code);
  return levelSatisfies(levels[grant], EDITOR, grant);
}

/** May this user APPROVE on `code`? Separated-duty aware. */
export function canApproveModule(user, code) {
  const levels = user?.module_levels;
  if (!levels || typeof levels !== 'object') return true;
  const grant = grantCode(code);
  return levelSatisfies(levels[grant], APPROVER, grant);
}

/**
 * Why a write is refused, in the words the API itself uses.
 *
 * The two cases are deliberately different sentences, because the user's next
 * step differs and the server already distinguishes them
 * (`middleware/subscription.py`):
 *
 *   level  you hold the module at the wrong rung -> ask for a promotion
 *   grant  you do not hold the module at all     -> ask for access
 *
 * One generic "forbidden" would turn both into the same support ticket. Session
 * A recorded this distinction as one of the better things in the product; the
 * button should not throw it away by going quiet instead.
 */
export function writeDenialReason(user, code, label = 'change it') {
  const levels = user?.module_levels;
  if (!levels || typeof levels !== 'object') return null;
  // The GRANT code, not the surface id — the sentence names the thing the
  // reader has to go and ask an admin for, and no admin can grant "hub".
  const grant = grantCode(code);
  const held = levels[grant];
  if (!held) {
    return `You don't have access to the ${grant} module. Ask your org admin to grant it.`;
  }
  const shown = held.charAt(0).toUpperCase() + held.slice(1);
  return `Your ${grant} access is ${shown}: you can read it, but not ${label}. `
       + 'Ask an org admin for Editor.';
}
