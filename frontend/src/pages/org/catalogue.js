/**
 * catalogue.js — the modules an org grant may name.
 *
 * ── The list is twelve, and used to be eight ────────────────────────────────
 * This file previously carried eight codes and a header saying that offering
 * any of the other four "produces a 400 on save". That was true when it was
 * written and is now STALE: `backend/routers/org_members.py` was changed in
 * 40124fb to import the set from `middleware/role_tiers.py` —
 *
 *     from middleware.role_tiers import (
 *         ALL_MODULES, SENSITIVE_MODULES, DEFAULT_GRANT_LEVEL, valid_levels_for,
 *     )
 *
 * — with the note "The local list held EIGHT codes where role_tiers holds
 * twelve, so a grant naming esign, samvada, varta or pahchan was rejected with
 * 400 by the only endpoint that can create one — four modules unreachable
 * through the UI that exists to reach them." The backend half of that fix
 * shipped; this file is the other half. It is now the same twelve.
 *
 * `kartavya` is deliberately NOT here. It has Tier-4 levels in `levels.js`
 * (no viewer, no approver) because core PM access is levelled, but it is not in
 * `role_tiers.ALL_MODULES`, so a grant naming it is a 400. Core PM is reached by
 * org membership, not by a grant row.
 *
 * ── Two spellings of one module, and why `subCode` exists ───────────────────
 * The grant endpoint validates against `role_tiers.ALL_MODULES`, which spells
 * messaging `samvada`. `staging.module_subscriptions` — the table that says what
 * the org is actually paying for — spells the same module `sanvaad`, and so does
 * `navConfig.js`. Verified against the live database: module_subscriptions holds
 * `sanvaad`, never `samvada`.
 *
 * So a grant must be written as `samvada` and a subscription must be read as
 * `sanvaad`, and matching one against the other by string equality silently
 * fails. `subCode` carries the entitlement spelling where it differs. This is a
 * workaround for a backend inconsistency, not a design — the real fix is one
 * spelling, server-side, and it is in the report.
 *
 * Colours come from `lib/moduleColors.js` as token references, so a module keeps
 * its identity in both themes without this file knowing which theme is active.
 */
import { moduleColor } from '../../lib/moduleColors';

/**
 * `sensitive` is the lock tag, not the permission. It mirrors
 * `role_tiers.SENSITIVE_MODULES` exactly — Vetana, Ganit and Manav — because
 * that is the set the server withholds when a member is added without an
 * explicit grant list. Enforcement is server-side; the tag exists so an admin
 * handing out access can see what they are handing out.
 *
 * `pahchan` is NOT tagged, even though it holds face captures and locations. The
 * tag would be a lie about the default: the server hands Pahchan out with the
 * rest unless it is named. Widening it here without widening
 * `role_tiers.SENSITIVE_MODULES` would show a lock on a door that is open — see
 * the report.
 */
export const ORG_MODULES = [
  { code: 'graha',   label: 'Graha',   hi: 'ग्राहक', en: 'CRM',        blurb: 'Contacts, deals and pipelines.' },
  { code: 'vikray',  label: 'Vikray',  hi: 'विक्रय', en: 'Sales',      blurb: 'Orders, quotes and price lists.' },
  { code: 'ganit',   label: 'Ganit',   hi: 'गणित',  en: 'Invoicing',  blurb: 'Invoices, ledgers and period close.', sensitive: true },
  { code: 'vetana',  label: 'Vetana',  hi: 'वेतन',  en: 'Payroll',    blurb: 'Salary structures and payroll runs.', sensitive: true },
  { code: 'manav',   label: 'Manav',   hi: 'मानव',  en: 'HRMS',       blurb: 'Employee records, leave and assets.', sensitive: true },
  { code: 'prachar', label: 'Prachar', hi: 'प्रचार', en: 'Marketing',  blurb: 'Campaigns, posts and channels.' },
  { code: 'dristi',  label: 'Dristi',  hi: 'दृष्टि', en: 'Analytics',  blurb: 'Dashboards and saved reports.' },
  { code: 'srijan',  label: 'Srijan',  hi: 'सृजन',  en: 'AI Hub',     blurb: 'Assistant, knowledge base and skills.' },
  { code: 'samvada', label: 'Sanvaad', hi: 'संवाद',  en: 'Messaging',  blurb: 'Internal threads, mentions and files.', subCode: 'sanvaad', colorKey: 'sanvaad' },
  { code: 'esign',   label: 'E-Sign',  hi: 'प्रमाण', en: 'Signatures', blurb: 'Documents out for signature.' },
  { code: 'varta',   label: 'Varta',   hi: 'वार्ता', en: 'WhatsApp',   blurb: 'Templates and outbound conversations.' },
  { code: 'pahchan', label: 'Pahchan', hi: 'पहचान', en: 'Attendance', blurb: 'Punches, selfies and the review register.' },
];

export const moduleByCode = code => ORG_MODULES.find(m => m.code === code) || null;

const titleCase = code => String(code || '').replace(/\b\w/g, c => c.toUpperCase());

export const moduleLabel = code => moduleByCode(code)?.label || titleCase(code);

/**
 * Accent for a grant code.
 *
 * Two departures from calling `moduleColor` directly, both of which this file
 * has to make because it is the only caller that uses the result as TEXT:
 *
 *  1 · `colorKey`, because `lib/moduleColors.js` is keyed on the nav's spelling
 *      (`sanvaad`), not the grant's (`samvada`).
 *  2 · the fallback. `moduleColor` falls back to `var(--primary)`, which is a
 *      FILL at 4.04:1 and is not a text colour (00 §12). `--m-varta` does not
 *      exist yet, so Varta would have taken that fallback and painted its
 *      initial and its chip label in it. `--on-surface-3` is a declared text
 *      step and is the honest "no identity colour yet".
 */
export function orgModuleColor(code) {
  const key = moduleByCode(code)?.colorKey || code;
  const c = moduleColor(key);
  return c === 'var(--primary)' ? 'var(--on-surface-3)' : c;
}

/**
 * The code `staging.module_subscriptions` uses for this module. Same as the
 * grant code for eleven of the twelve; see the header for the twelfth.
 */
export const subscriptionCode = code => moduleByCode(code)?.subCode || code;

/**
 * Is this module active on the org's subscription? Accepts either spelling in
 * the list, because the list comes straight off the API.
 */
export const isModuleActive = (code, activeCodes = []) =>
  activeCodes.includes(code) || activeCodes.includes(subscriptionCode(code));

/**
 * A card entry for any module code, including one this catalogue does not know.
 *
 * An unknown code gets a title-cased name and no blurb rather than being
 * dropped — a module a customer is paying for that renders as nothing is the
 * worst way to be incomplete.
 */
export const moduleEntry = code => moduleByCode(code) || { code, label: titleCase(code), hi: '', en: '', blurb: '' };
