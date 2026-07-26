/**
 * catalogue.js — the modules an org grant may name.
 *
 * These eight, and only these eight, are what `PUT /v1/org/members/{id}/modules`
 * validates against (`backend/routers/org_members.py` ALL_MODULES). The tier
 * table in `middleware/role_tiers.py` knows twelve — it adds `samvada`, `esign`,
 * `varta` and `pahchan` — so offering one of those four here produces a 400 on
 * save. The narrower list is the honest one until the endpoint widens.
 *
 * Colours come from `lib/moduleColors.js` as token references, so a module keeps
 * its identity in both themes without this file knowing which theme is active.
 */
import { moduleColor } from '../../lib/moduleColors';

/**
 * `sensitive` is the lock tag, not the permission. Vetana, Ganit and Manav hold
 * salaries, the org's finances and personnel files; they default to no access
 * and every grant on them is deliberate. Enforcement is server-side — the tag
 * exists so an admin handing out access can see what they are handing out.
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
];

export const moduleByCode = code => ORG_MODULES.find(m => m.code === code) || null;

const titleCase = code => String(code || '').replace(/\b\w/g, c => c.toUpperCase());

export const moduleLabel = code => moduleByCode(code)?.label || titleCase(code);

export const orgModuleColor = code => moduleColor(code);

/**
 * A card entry for any module code, including one this catalogue does not know.
 *
 * `staging.module_subscriptions` can hold `esign`, `varta` and `pahchan` —
 * `role_tiers.ALL_MODULES` lists twelve to this file's eight — and a module a
 * customer is paying for that renders as nothing is the worst way to be
 * incomplete. An unknown code gets a title-cased name and no blurb rather than
 * being dropped.
 */
export const moduleEntry = code => moduleByCode(code) || { code, label: titleCase(code), hi: '', en: '', blurb: '' };
