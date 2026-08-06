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
    blurb: 'CRM, sales, marketing, Sahayak, analytics and messaging.',
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
    code: 'sahayak_admin',
    label: 'Sahayak admin',
    hi: 'सहायक',
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

/* ── Console reach ───────────────────────────────────────────────────────────
 *
 * The three sets below mirror the guards the server actually applies, so a
 * console page can refuse in words rather than in four spinners resolving into
 * four 403 toasts. "A control that 403s is worse than an absent one" — and the
 * sidebar offers all four console entries to anyone holding any platform role,
 * so the refusal has to happen on the page.
 *
 * They are NOT the enforcement. `require_platform_role` is, and it fails closed
 * for a code this file has never heard of.
 */

const has = (roles, set) => Array.isArray(roles) && roles.some(r => set.includes(r));

/**
 * Who may open the console at all — `/admin` (accounts, invites, R2 folder map)
 * and the write half of `/admin/orgs`.
 *
 * Mirrors `CONSOLE_ROLES` in `routers/admin_orgs.py` and `invite_router.py`:
 * god mode + manager + staff + the legacy `account_manager`. `account_finance`
 * is deliberately NOT in it — finance reads the org LIST
 * (`CONSOLE_ROLES_WITH_FINANCE` on `GET /v1/admin/orgs`) and the billing and
 * cost consoles, but not the account and invite surfaces.
 */
const CONSOLE = [...GOD_MODE, 'platform_manager', 'platform_staff', 'account_manager'];
export const canOpenConsole = roles => has(roles, CONSOLE);

/**
 * Who may act on a customer's subscription, plans, invoices and payments.
 *
 * Mirrors `BILLING_CONSOLE_ROLES` in `middleware/role_tiers.py`. `platform_staff`
 * is deliberately absent — its operating set excludes finance — so without this
 * gate a staff operator reaches `/admin/billing` from the sidebar, sees a fully
 * populated page, and every button on it 403s.
 */
const BILLING = [...GOD_MODE, 'platform_manager', 'account_manager', 'account_finance'];
export const canManageBilling = roles => has(roles, BILLING);

/** The org LIST is `CONSOLE_ROLES_WITH_FINANCE`; only that endpoint is wider. */
export const canListOrgs = roles => canOpenConsole(roles) || has(roles, ['account_finance']);

/**
 * Who may CREATE a skill template and ASSIGN skills to an org or a client.
 *
 * Mirrors `OPERATIONS_CONSOLE_ROLES` in `middleware/role_tiers.py`, which is
 * the guard on `create_skill_template`, `assign_skill`, `assign_skill_to_org`
 * and both remove routes.
 *
 * The check this replaces was wrong in both directions at once:
 *
 *     me.platform_roles.some(r => ['platform_admin','account_manager','sahayak_admin'].includes(r))
 *       || me?.org_role === 'owner' || me?.org_role === 'admin'
 *
 *   · TOO NARROW. It omitted `platform_owner`, `platform_manager` and
 *     `platform_staff` — six of the ten live platform accounts, all of which
 *     the API accepts. `platform_staff` exists SPECIFICALLY for "Sahayak,
 *     including authoring skills and publishing" (`role_tiers.py:20-22`) and
 *     was refused the button. It also repeated the exact trap
 *     `role_tiers.py:153` warns about: naming `platform_admin` without
 *     `platform_owner` locks out every god-mode account the day those legacy
 *     rows are renamed.
 *   · TOO WIDE, and simultaneously dead. `/auth/me` emits `org_roles` — PLURAL,
 *     a list of {org_id, role_code, org_name} — and never `org_role`, so that
 *     branch could never be true for anybody. Had it worked it would have been
 *     wrong anyway: the server accepts no org-tier role here, so an org admin
 *     would have been shown a button that 403s on submit. The copy beside it
 *     told them they needed "an org owner, an org admin or a Sahayak admin",
 *     naming two roles the server refuses.
 *
 * `account_manager` is kept because the server still lists it, legacy and
 * inert though it is. Removing it here would make this narrower than the guard
 * again, which is the whole failure being fixed.
 */
const SKILLS = [
  ...GOD_MODE, 'platform_manager', 'platform_staff', 'account_manager', 'sahayak_admin',
];
export const canManageSkills = user => has(user?.platform_roles, SKILLS);
