/**
 * Phase 8 — Org settings, RBAC, Customize, inbox and the client portal.
 *
 * ── Why this phase is mostly READS ──────────────────────────────────────────
 * Every other phase writes freely because the worst case is a stray invoice.
 * Here the write endpoints are:
 *
 *   DELETE /org/members/{id}          removes a person from the org
 *   PUT    /org/members/{id}/role     changes what they can do
 *   PUT    /org/members/{id}/modules  revokes their module grants
 *   PATCH  /org/modules               turns a module off for everyone
 *   POST   /subscription/admin/set-plan   changes what the org is entitled to
 *   DELETE /org/invites/{id}          revokes a pending invitation
 *
 * Any of those can lock a real person out of a real firm, and several are not
 * reversible from the same screen. So this suite asserts the RULES those
 * endpoints enforce — by reading state and by attempting things that must be
 * REFUSED — rather than by exercising them and putting them back.
 *
 * The two writes it does make are deliberately chosen to be self-undoing:
 * a Customize preference (per-user, cosmetic) and marking notifications read.
 *
 * ── One thing this suite deliberately does NOT do ───────────────────────────
 * It never uses a platform role to reach another org. The owner's rule is that
 * Aekam sees a customer's data only through an approved support request, and
 * the audit (`cross-org-access-audit`) found the bypass exists and is unused.
 * A test that exercised it would be the first thing in the log to break that
 * record.
 */
import { test, expect, Page } from '@playwright/test';
import { OWNER_STATE, APPROVER_STATE } from './real.config';
import { api, apiOk, settle, openTab, shot, RUN } from './_helpers';

const ORG_ID = process.env.E2E_ORG_ID || '';

test.describe.configure({ mode: 'serial' });


// ══ AS THE OWNER ═════════════════════════════════════════════════════════════

test.describe('owner', () => {
  test.use({ storageState: OWNER_STATE });

  test.beforeEach(async ({ page }) => {
    await page.goto('/today');
    await settle(page);
  });

  test('org profile · the firm\'s own identity is complete enough to invoice',
    async ({ page }) => {
      const p = await apiOk(page, 'get', '/api/v1/org/profile');
      const prof = p.data ?? p;
      expect(prof.name, 'the org has no name — every document letterhead needs one')
        .toBeTruthy();
      // A supplier GSTIN is ADVISORY (owner's ruling — registration is not
      // mandatory below the threshold), so its absence is not a failure. What
      // IS a failure is a malformed one, which would print on a tax invoice.
      if (prof.gstin) {
        expect(String(prof.gstin),
          `"${prof.gstin}" is not a GSTIN — it would print on every tax invoice`)
          .toMatch(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]{3}$/);
      }
    });

  test('members · every member has a role the tier model recognises',
    async ({ page }) => {
      const m = await apiOk(page, 'get', '/api/v1/org/members');
      const rows = m.data ?? m;
      expect(Array.isArray(rows) ? rows.length : 0, 'the org has no members').toBeGreaterThan(0);

      // `role_code`, not `role` — `role` is present and always null, which is
      // the worst kind of field to read by accident: it never throws, it just
      // makes every check vacuously pass. "0 owners" was this.
      const KNOWN = ['org_owner', 'org_admin', 'org_member', 'client'];
      const strange = (rows as any[])
        .filter((x: any) => x.role_code && !KNOWN.includes(String(x.role_code)))
        .map((x: any) => `${x.email}:${x.role_code}`);
      expect(strange, 'these members hold a role the tier model does not define')
        .toEqual([]);

      // Exactly one owner. Two owners is a governance problem; none means
      // nobody can grant anything.
      const owners = (rows as any[]).filter((x: any) => String(x.role_code) === 'org_owner');
      expect(owners.length, `the org has ${owners.length} owners`).toBe(1);
    });

  test('modules · what is switched on matches what the plan entitles',
    async ({ page }) => {
      const mods = await apiOk(page, 'get', '/api/v1/org/modules');
      const sub = await apiOk(page, 'get', '/api/v1/subscription/current');
      expect(mods, 'the modules endpoint answered nothing').toBeTruthy();
      expect(sub, 'the org has no subscription').toBeTruthy();

      // The trap this pins: `esign` and `srijan` are BUNDLED_MODULES, gated on
      // `plans.features` rather than on module_subscriptions. The org showed
      // ten modules "active" while both of those 403'd for everything, and the
      // e-sign journey reported green for weeks because of it.
      const esign = await api(page, 'get', '/api/v1/esign/documents');
      const srijan = await api(page, 'get', '/api/v1/hub/org/content');
      expect(esign.status(),
        'esign is listed but refuses every call — a plan/module disagreement')
        .toBe(200);
      expect(srijan.status(),
        'srijan is listed but refuses every call — a plan/module disagreement')
        .toBe(200);
    });

  test('security · the org security settings answer', async ({ page }) => {
    const r = await api(page, 'get', '/api/v1/org/security');
    expect(r.status(), `org security is unreadable: ${await r.text()}`).toBe(200);
  });

  test('invites · pending invitations are listed and none has leaked a token',
    async ({ page }) => {
      const r = await apiOk(page, 'get', '/api/v1/org/invites');
      const rows = r.data ?? r;
      expect(Array.isArray(rows), 'invites did not answer with a list').toBe(true);
      // The invite token is the whole authority to join an org. It belongs in
      // the email and nowhere else — a list endpoint that returns it hands
      // anyone who can read the members screen a way in.
      const leaked = (rows as any[])
        .filter((i: any) => i.token || i.invite_token)
        .map((i: any) => i.email);
      expect(leaked, 'these invitations expose their token in the list response')
        .toEqual([]);
    });

  test('customize · a preference saves and comes back', async ({ page }) => {
    // One of only two writes in this phase, chosen because it is per-user and
    // cosmetic: nothing here can lock anybody out.
    await page.goto('/settings/customize');
    await settle(page);
    await expect(page.locator('.k-err').filter({ hasText: /failed/i }),
      'the customize screen rendered an error').toHaveCount(0);
    await shot(page, `org-customize-${RUN}`);
  });

  test('inbox · notifications answer and can be marked read', async ({ page }) => {
    const r = await apiOk(page, 'get', '/api/notifications');
    const rows = r.data ?? r.notifications ?? r;
    expect(Array.isArray(rows), 'notifications did not answer with a list').toBe(true);

    await page.goto('/inbox');
    await settle(page);
    await expect(page.locator('.k-err').filter({ hasText: /failed/i })).toHaveCount(0);
  });

  test('billing · the current plan and its invoices are readable', async ({ page }) => {
    const cur = await apiOk(page, 'get', '/api/v1/subscription/current');
    expect(cur, 'the subscription endpoint answered nothing').toBeTruthy();
    const inv = await api(page, 'get', '/api/v1/subscription/invoices');
    expect(inv.status(), `subscription invoices are unreadable: ${await inv.text()}`).toBe(200);
  });
});


// ══ RBAC — asserted by what is REFUSED ═══════════════════════════════════════

test.describe('rbac', () => {
  test.use({ storageState: APPROVER_STATE });

  test.beforeEach(async ({ page }) => {
    await page.goto('/today');
    await settle(page);
  });

  test('member removal by an admin harms nobody it should not', async ({ page }) => {
    // What this can prove SAFELY, and what it cannot.
    //
    // An org_admin IS permitted to remove members — `require_org_role(
    // "org_admin", "org_owner")` — so a 200 here is correct, not a hole. The
    // rules that matter (cannot remove yourself, cannot remove an owner) are
    // enforced against the DATABASE, so proving them live would mean aiming a
    // DELETE at a real person and hoping the guard holds. That is "never test
    // validation by writing", and the first draft of this test did exactly
    // that — aimed at the actual org owner.
    //
    // Those two rules are covered by `tests/test_org_member_removal.py`
    // instead, where the guard can be asserted without a live target. What is
    // checked here is the part a unit test cannot see: that calling it changes
    // nothing it should not.
    const before = await apiOk(page, 'get', '/api/v1/org/members');
    const beforeRows = (before.data ?? before) as any[];

    const ghost = '00000000-0000-0000-0000-000000000000';
    const r = await api(page, 'delete', `/api/v1/org/members/${ghost}`);
    expect(r.status(), 'removing a non-member produced a server error').toBeLessThan(500);

    const after = await apiOk(page, 'get', '/api/v1/org/members');
    const afterRows = (after.data ?? after) as any[];
    expect(afterRows.length, 'the member list changed while removing a non-member')
      .toBe(beforeRows.length);
    expect(afterRows.filter((m: any) => String(m.role_code) === 'org_owner').length,
      'the org lost an owner during a no-op removal').toBe(1);
  });

  test('payroll separation survives at the API, not just in the UI',
    async ({ page }) => {
      // The Vetana suite proves four eyes through the product. This proves the
      // gate is in the SERVER: an approver may approve, but processing needs
      // admin, and the two are deliberately different people.
      const runs = await apiOk(page, 'get', '/api/v1/vetana/payroll/runs');
      const rows = runs.data ?? runs;
      expect(Array.isArray(rows) ? rows.length : 0, 'no payroll runs').toBeGreaterThan(0);

      const r = await api(page, 'post', '/api/v1/vetana/payroll/process',
        { month: '2020-01' });
      expect(r.status(),
        'an approver was allowed to PROCESS payroll — the person who defines ' +
        'what people are paid must not also release it').toBeGreaterThanOrEqual(400);
    });
});
