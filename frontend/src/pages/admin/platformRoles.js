/**
 * platformRoles.js — the Tier-1 role vocabulary, for the console UI only.
 *
 * 11-platform-admin.md §3 asks for `lib/platformRoles.js`. It lives here rather
 * than in lib/ because this batch owns `pages/admin/**` and not `lib/**`; the
 * move is a one-line re-export whenever lib/ is opened.
 *
 * THE SOURCE OF TRUTH IS `backend/middleware/role_tiers.py`. This file is a
 * transcription for labelling and for choosing what to render — it must never
 * be the thing that decides access. The server does that, and it fails closed
 * for a role it does not recognise.
 *
 * What the RBAC landing changed, and what the console was still showing:
 *
 *   · `platform_owner` is the new god-mode code. `platform_admin` is a LEGACY
 *     ALIAS kept because the database still holds those rows and the CHECK
 *     constraint still admits them — it is retired by deleting rows, not code.
 *   · `platform_manager` and `platform_staff` are new and were offered nowhere.
 *   · `account_manager` is SUPERSEDED and now reaches NOTHING. It was the
 *     second option in the console's assign dropdown, so the obvious way to
 *     grant an Aekam colleague access was to grant them a role that does not
 *     work. It stays listed — the rows exist and have to be revocable — but it
 *     is marked, and it cannot be selected for a new grant.
 */

/** God mode. `platform_admin` is the legacy spelling of `platform_owner`. */
export const GOD_MODE = ['platform_owner', 'platform_admin'];

export const PLATFORM_ROLES = [
  {
    code: 'platform_owner',
    label: 'Platform owner',
    hi: 'स्वामी',
    blurb: 'God mode. Every module, every org. Four people.',
    tone: 'danger',
  },
  {
    code: 'platform_manager',
    label: 'Platform manager',
    hi: 'प्रबंधक',
    blurb: 'Every module except HR and Payroll.',
    tone: 'warn',
  },
  {
    code: 'platform_staff',
    label: 'Platform staff',
    hi: 'कर्मचारी',
    blurb: 'CRM, sales, marketing, Srijan, analytics and messaging.',
    tone: 'ok',
  },
  {
    code: 'account_finance',
    label: 'Account / finance',
    hi: 'वित्त',
    blurb: 'Billing and cost. No operational module in any customer org.',
    tone: 'neutral',
  },
  {
    code: 'srijan_admin',
    label: 'Srijan admin',
    hi: 'सृजन',
    blurb: 'AI configuration. No operational module in any customer org.',
    tone: 'neutral',
  },
  {
    code: 'platform_support',
    label: 'Platform support',
    hi: 'सहायता',
    blurb: 'Approval-gated, time-boxed. Grants nothing until the approval flow ships.',
    tone: 'neutral',
    inert: true,
  },
  {
    code: 'platform_admin',
    label: 'Platform admin (legacy)',
    hi: 'प्रशासक',
    blurb: 'Legacy spelling of platform owner. Retired by deleting rows, not code.',
    tone: 'danger',
    legacy: true,
  },
  {
    code: 'account_manager',
    label: 'Account manager (superseded)',
    hi: 'खाता प्रबंधक',
    blurb: 'Superseded by platform manager. Reaches nothing. Revoke and re-grant.',
    tone: 'neutral',
    legacy: true,
    inert: true,
  },
];

/** Only these may be chosen for a NEW grant. Legacy codes are revoke-only. */
export const ASSIGNABLE_ROLES = PLATFORM_ROLES.filter(r => !r.legacy);

const BY_CODE = Object.fromEntries(PLATFORM_ROLES.map(r => [r.code, r]));

export const roleMeta = code =>
  BY_CODE[code] || { code, label: String(code || '').replace(/_/g, ' '), blurb: '', tone: 'neutral' };

const TONE_COLOR = {
  danger: 'var(--danger)',
  warn: 'var(--warn)',
  ok: 'var(--ok)',
  neutral: 'var(--on-surface-3)',
};

/** A real colour, never `var(--info)` — color-mix() with an undefined custom
 *  property voids the declaration silently and Tag loses its pill (02 §1). */
export const roleColor = code => TONE_COLOR[roleMeta(code).tone] || TONE_COLOR.neutral;

export const isGodMode = roles =>
  Array.isArray(roles) && roles.some(r => GOD_MODE.includes(r));

/**
 * Who may see platform cost, margin and markup.
 *
 * 11 §1: "platform cost, margin and markup fields do not belong in any tenant
 * response, export, PDF or support-agent view", and §3 narrows it further to
 * admin and finance. This mirrors the server, which guards
 * /platform-analytics, /cost-summary and /provider-costs on exactly
 * ("platform_admin", "account_finance").
 *
 * A UI guard is NOT the enforcement — 11 is explicit that it must be done at
 * the serializer. This exists so an operator who will be refused does not have
 * to discover it through a 403 on a page they were invited to open.
 */
export const canSeeCost = roles =>
  Array.isArray(roles) && roles.some(r => GOD_MODE.includes(r) || r === 'account_finance');

/** Suspending, deleting and transferring an org moved OFF org_owner onto Aekam
 *  platform staff. The server guards /deactivate on god mode alone. */
export const canSuspendOrg = isGodMode;
