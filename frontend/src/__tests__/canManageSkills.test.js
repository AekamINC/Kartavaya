/**
 * `canManageSkills` — the gate that decides who is offered Create and Assign.
 *
 * The check it replaces was wrong in both directions at once, and both halves
 * were live on staging until today:
 *
 *   me.platform_roles.some(r => ['platform_admin','account_manager','sahayak_admin'].includes(r))
 *     || me?.org_role === 'owner' || me?.org_role === 'admin'
 *
 * TOO NARROW — it omitted platform_owner, platform_manager and platform_staff.
 * Six of the ten live platform accounts hold one of those, the API accepts all
 * three, and `platform_staff` exists specifically for authoring Sahayak skills.
 * Verified in a real browser: an account with the grant was shown "Creating
 * templates needs an admin grant".
 *
 * DEAD — `/auth/me` emits `org_roles` (plural, a list of objects) and never
 * `org_role`, so that branch could not be true for anybody. Confirmed by
 * reading the live session object on staging.
 *
 * These tests are about DRIFT as much as correctness. The set here mirrors
 * OPERATIONS_CONSOLE_ROLES in backend/middleware/role_tiers.py, and a UI narrower
 * than its server hides a button that works, while a UI wider than its server
 * shows one that 403s. Both are bugs; only one is visible in a screenshot.
 */
import { describe, it, expect } from 'vitest';
import { canManageSkills } from '../pages/admin/platformRoles';

const withRoles = (...platform_roles) => ({ user_id: 'u', platform_roles });

/** Verbatim from `OPERATIONS_CONSOLE_ROLES` (role_tiers.py). */
const SERVER_ACCEPTS = [
  'platform_owner',
  'platform_admin',
  'platform_manager',
  'platform_staff',
  'account_manager',
  'sahayak_admin',
];

/** Tier-1 codes the server does NOT accept on these routes. */
const SERVER_REFUSES = ['platform_support', 'account_finance'];

describe('canManageSkills', () => {
  it.each(SERVER_ACCEPTS)('admits %s, which the API accepts', role => {
    expect(canManageSkills(withRoles(role))).toBe(true);
  });

  it.each(SERVER_REFUSES)('refuses %s, which the API refuses', role => {
    expect(canManageSkills(withRoles(role))).toBe(false);
  });

  it('admits platform_owner — the lockout role_tiers.py warns about', () => {
    // `require_platform_role("platform_admin")` locks out `platform_owner`.
    // Invisible today because every god-mode account still holds the legacy
    // row; a total lockout the day those rows are renamed, which is exactly
    // the migration the tier model was designed for.
    expect(canManageSkills(withRoles('platform_owner'))).toBe(true);
  });

  it('admits platform_staff — the role that exists for this job', () => {
    // role_tiers.py:20-22 — "Sahayak, including authoring skills and publishing".
    expect(canManageSkills(withRoles('platform_staff'))).toBe(true);
  });

  it('reads platform_roles, not the org_role field that never existed', () => {
    // The shape /auth/me actually returns. Neither of these grants the button,
    // and before this fix neither did anything at all — the branch reading
    // `org_role` could not fire, because the key is `org_roles`.
    const orgAdmin = {
      user_id: 'u',
      role: 'member',
      org_roles: [{ org_id: 'o1', role_code: 'org_admin', org_name: 'QA Test Corp' }],
    };

    expect(canManageSkills(orgAdmin)).toBe(false);
  });

  it('is false for a user with no platform role at all', () => {
    expect(canManageSkills({ user_id: 'u' })).toBe(false);
    expect(canManageSkills({ user_id: 'u', platform_roles: [] })).toBe(false);
  });

  it('survives a missing or malformed user without throwing', () => {
    // `currentUser()` is JSON.parse(localStorage…) and can return null between
    // a sign-out and the redirect.
    expect(canManageSkills(null)).toBe(false);
    expect(canManageSkills(undefined)).toBe(false);
    expect(canManageSkills({ platform_roles: 'platform_admin' })).toBe(false);
  });

  it('admits a user holding several roles if any one qualifies', () => {
    expect(canManageSkills(withRoles('account_finance', 'platform_staff'))).toBe(true);
  });

  it('does not admit an unknown role code', () => {
    // The server fails closed for a code it has never heard of; so must this,
    // or the UI offers a button the API will refuse.
    expect(canManageSkills(withRoles('sahayak_author'))).toBe(false);
    expect(canManageSkills(withRoles('platform_god'))).toBe(false);
  });
});
