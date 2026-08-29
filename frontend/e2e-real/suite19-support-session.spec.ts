/**
 * Proposal 93 · SUITE 19.3 — raising a support session request, as the operator.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT THIS UNBLOCKS, AND WHY THE CUSTOMER LANE CANNOT DO IT
 * ═══════════════════════════════════════════════════════════════════════════
 * 02.17 drives the CUSTOMER's half of the support-access lifecycle — approve,
 * decline, revoke. It cannot manufacture its own precondition: `_lanes.ts`
 * rule 1 forbids a write suite from borrowing a platform credential, and there
 * is deliberately no customer-side control to invite support in.
 *
 * So the support side raises it, exactly as 19.0 set the plans that unblocked
 * modules. This suite leaves ONE PENDING REQUEST on Unicode Group, and 02.17
 * finds it and decides it.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⚠ 19.3a IS A REGRESSION TEST FOR A REAL OUTAGE, NOT A NAVIGATION WARM-UP
 * ═══════════════════════════════════════════════════════════════════════════
 * On 2026-08-29 this suite could not be written, because the account it runs as
 * COULD NOT REACH THE SCREEN. The feature was unreachable end to end by anybody
 * in the system, and the two halves sat in different layers:
 *
 *   · the SERVER admits only `platform_support` to raise a request
 *     (`support_sessions._may_request`), refusing every other platform role;
 *   · the BROWSER admitted every role EXCEPT `platform_support` —
 *     `Protected.jsx:304` bounces `/admin/*` on `ADMIN_SURFACE_ROLES`, and that
 *     list was re-typed by hand from three of the four console role sets.
 *
 * `/admin/support` redirected to `/dashboard` with NOT ONE request to
 * `/v1/support-sessions/*`, which is what proves it was the client gate rather
 * than an API refusal. Both support tables held zero rows for their entire life
 * — the consequence, not a coincidence beside it.
 *
 * Fixed in `95f9b07e` by deriving `ADMIN_SURFACE_ROLES` from `ADMIN_NAV` so the
 * two agree by construction. 19.3a is the browser-level guard on that fix: unit
 * tests pin the role lists, and only a real navigation proves the door opens.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE GUARD — and it reads the BODY, not the URL
 * ═══════════════════════════════════════════════════════════════════════════
 * 19.0 and 19.2 assert that no write NAMES Aekam Inc in its path, because a
 * console write to `/v1/admin/orgs/<org_id>/…` carries its subject in the URL.
 *
 * ⚠ THIS ONE DOES NOT. `POST /v1/support-sessions` has no org in its path — the
 * subject is `org_id` in the JSON body. A path-only guard would pass this suite
 * unconditionally while proving nothing, which is exactly the vacuous assertion
 * 02.3 shipped. So `watchRequestBodies()` reads `postData()` and asserts the
 * subject positively (the body names Unicode) as well as negatively (no body
 * names Aekam).
 *
 * ⚠ NO `assertOrg()`, for the reason 19.0 gives: a platform session resolves to
 * Aekam Inc via `platform_bypass`, so that check fails BY DESIGN here.
 *
 * ⚠ AND THIS SUITE'S CREDENTIAL IS NOT GOD MODE. `platform_support` holds
 * `frozenset()` — zero access anywhere until a customer approves. It is the
 * weakest credential in the programme, which is why it is the one the server
 * lets raise a request at all.
 *
 * Run:
 *   cd frontend
 *   npx playwright test --config e2e-real/admin.config.ts --grep "19.3"
 */
import { test, expect, Page, Request } from '@playwright/test';
import { ORG as ORG_IDS } from './_lanes';

const API_BASE = process.env.E2E_API_URL || 'https://kartavaya-staging.up.railway.app';
const SUPPORT = process.env.E2E_SUPPORT_TOKEN;
const SUPPORT_EMAIL = process.env.E2E_SUPPORT_EMAIL || 'kevalvshah03+support@gmail.com';

/** The subject. Unicode is the reference lane every suite is authored against. */
const SUBJECT = { name: 'Unicode Group', id: ORG_IDS.UNICODE };

/**
 * What is asked for, and why these two.
 *
 * `graha` and `ganit` are both in `SUPPORT_MODULES` and both OUTSIDE
 * `SUPPORT_READ_ONLY` (`prachar`, `varta`, `sanvaad`), so the `viewer` level
 * asserted below is this suite's choice rather than a cap the form applied —
 * a read-only module would have made the assertion pass for the wrong reason.
 *
 * ⚠ `vetana`, `manav` and `pahchan` are ABSENT from the catalogue by design:
 * salary, statutory identifiers and face templates are the records a support
 * ticket never needs. 19.3c asserts that absence, because a decision that is
 * only a comment is a decision that gets reverted.
 */
const ASK_MODULES = ['graha', 'ganit'];
const MODULE_LABELS: Record<string, string> = { graha: 'Graha · CRM', ganit: 'Ganit · Accounts' };
const NEVER_REQUESTABLE = ['Vetana', 'Manav', 'Pahchan'];

/** `pss_reason_is_substantive` is a database CHECK: `length(btrim(reason)) >= 12`. */
const REASON_MIN = 12;

type Wire = { method: string; status: number; path: string; body: string }[];

/**
 * Record every write WITH ITS BODY, and refuse any that names Aekam Inc.
 *
 * §12 guarantees Aekam Inc is untouched. A platform session resolves to it by
 * default, so a console write must name its subject — and here "names" means
 * the JSON body, which is why this helper exists rather than 19.2's.
 */
function watchRequestBodies(page: Page): Wire {
  const wire: Wire = [];
  page.on('response', async (r) => {
    const req: Request = r.request();
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method())) return;
    if (!/\/api\//.test(r.url())) return;
    const path = new URL(r.url()).pathname;
    const body = req.postData() || '';
    wire.push({ method: req.method(), status: r.status(), path, body });

    expect(
      path.includes(ORG_IDS.AEKAM) || body.includes(ORG_IDS.AEKAM),
      `\n  ⚠ REFUSING — this write names Aekam Inc:\n     ${req.method()} ${path}\n` +
        `     body: ${body.slice(0, 300)}\n` +
        '     §12 guarantees that org is untouched. A platform session resolves\n' +
        '     to Aekam by default, so a console write must name its subject —\n' +
        '     and this endpoint names it in the BODY, not the path.\n',
    ).toBeFalsy();
  });
  return wire;
}

async function signInAsSupport(page: Page) {
  expect(
    SUPPORT,
    'BLOCKED — E2E_SUPPORT_TOKEN is not set. 19.3 runs as `platform_support`, ' +
      'which is the ONLY role the server lets raise a support request.',
  ).toBeTruthy();
  await page.goto('/login');
  await page.evaluate((t) => localStorage.setItem('auth_token', t!), SUPPORT);
}

/** The operator's own sessions, read from the server. Reads only — see rule 1. */
async function mySessions(page: Page) {
  const res = await page.request.get(`${API_BASE}/api/v1/support-sessions?scope=mine`, {
    headers: { Authorization: `Bearer ${SUPPORT}` },
  });
  expect(res.ok(), `GET /support-sessions?scope=mine -> ${res.status()}`).toBeTruthy();
  const body = await res.json();
  const rows = body?.data ?? body ?? [];
  return (Array.isArray(rows) ? rows : []) as any[];
}

/** A request nobody has answered yet: approved, denied and revoked all absent. */
const isPending = (s: any) => !s.approved_at && !s.denied_at && !s.revoked_at;

test.describe('Suite 19.3 — support sessions · the operator raises the ask', () => {
  test('19.3a the support account REACHES its own console — the door that was shut', async ({
    page,
  }) => {
    // ═══════════════════════════════════════════════════════════════════════
    // This exact navigation redirected to /dashboard before `95f9b07e`, and
    // the whole feature was unusable because of it. Asserting the landing URL
    // FIRST and the heading second: a heading assertion alone would fail with
    // "element not found", which reads as a broken page rather than as a
    // bounce, and those need different fixes.
    // ═══════════════════════════════════════════════════════════════════════
    // 93 §1: zero uncaught console errors, collected per screen. Attached
    // BEFORE the navigation — a listener added afterwards observes nothing and
    // reports a clean console it never watched.
    const consoleErrors: string[] = [];
    const failedRequests: string[] = [];
    page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
    page.on('response', (r) => {
      if (r.status() >= 400 && /\/api\//.test(r.url())) {
        failedRequests.push(`${r.status()} ${new URL(r.url()).pathname}`);
      }
    });

    await signInAsSupport(page);
    await page.goto('/admin/support');

    // Give the client-side guard time to bounce, if it is going to.
    await page.waitForLoadState('networkidle').catch(() => {});

    expect(
      new URL(page.url()).pathname,
      '\n  ⚠ BOUNCED. The `platform_support` account was redirected away from\n' +
        '     its own console. This is the 2026-08-29 outage returning:\n' +
        '     `Protected.jsx` gates /admin/* on ADMIN_SURFACE_ROLES, which must\n' +
        '     be DERIVED from ADMIN_NAV rather than re-typed from three of the\n' +
        '     four console role sets.\n',
    ).toBe('/admin/support');

    await expect(
      page.getByRole('heading', { name: 'Support sessions', level: 1 }),
    ).toBeVisible({ timeout: 30_000 });

    // The sentence that IS the feature, per `08-rbac-screens.md`. Asserted
    // because it is the thing an operator reads at the moment they use it.
    await expect(page.getByText(/Not a membership\. Time-boxed, written/)).toBeVisible();

    // ⚠ AND IT MUST NOT BE DORMANT. `isDormant` is computed from the error
    // response rather than hardcoded, so this empty state appearing would mean
    // the routes stopped answering — not that there are no sessions yet.
    await expect(page.getByText('Support sessions are not enabled yet')).toHaveCount(0);

    // ── AND THE ONLY SCREEN THIS ROLE HAS MUST BE CLEAN ───────────────────
    //
    // `platform_support` holds exactly one console row, so this is the whole
    // of its surface — a permanent failed request here is a permanent hole in
    // §1's "zero uncaught console errors across the whole run".
    //
    // ⚠ `AdminShell` used to fetch the Organisations count badge for EVERY
    // operator it admitted, and `/v1/admin/orgs` is gated on CONSOLE_ROLES —
    // so this role 403'd on every page load, for a number its only screen
    // never draws. Fixed by fetching the badge only for operators who hold
    // that row. This assertion is what stops it coming back.
    expect(
      failedRequests,
      `\n  ⚠ failed API requests on the support console: ${failedRequests.join(', ')}\n`,
    ).toEqual([]);
    expect(
      consoleErrors,
      `\n  ⚠ console errors on the support console: ${consoleErrors.join(' | ')}\n`,
    ).toEqual([]);

    // Exactly ONE row in the rail. Admitting this role to the /admin prefix
    // must not hand it a console of screens that each refuse it.
    const rows = page.getByRole('navigation', { name: 'Platform admin' }).getByRole('button');
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText('Support sessions');

    console.log(`\n[19.3a] ${SUPPORT_EMAIL} reached /admin/support — the door is open\n`);
  });

  test('19.3b the ask is raised on Unicode Group through the real form', async ({ page }) => {
    const wire = watchRequestBodies(page);
    await signInAsSupport(page);
    await page.goto('/admin/support');
    await expect(
      page.getByRole('heading', { name: 'Support sessions', level: 1 }),
    ).toBeVisible({ timeout: 30_000 });

    // ── §6 IDEMPOTENCE, and it is enforced by the database ────────────────
    // There is a one-pending-per-org index. A second run has nothing to create,
    // so it VERIFIES the pending row instead of creating a duplicate — and a
    // suite that made a second copy of everything on re-run is a defect in the
    // suite, not proof of anything.
    const before = await mySessions(page);
    const already = before.find((s) => s.org_id === SUBJECT.id && isPending(s));

    if (already) {
      console.log(
        `\n[19.3b] ${SUBJECT.name} already has a pending ask (${already.ref}) — ` +
          'verifying rather than duplicating (§6)\n',
      );
    } else {
      // The form is offered only when the picker answered. If the button is
      // absent, `GET /organisations` refused — which is the 403 that means this
      // account is not `platform_support`, and is a different failure from the
      // form being broken.
      const openForm = page.getByRole('button', { name: 'Request access' });
      await expect(
        openForm,
        'The "Request access" button is absent. The org picker did not answer, ' +
          'so the form is not offered — check that this credential holds ' +
          'platform_support, because every other role gets 403 there.',
      ).toBeVisible({ timeout: 30_000 });
      await openForm.click();

      // Organisation, by ID. `<option value={o.id}>`, and the id is what the
      // body must carry — selecting by visible name would pass on an org whose
      // name merely matches.
      await page.locator('#ss-org').selectOption(SUBJECT.id);

      // The reason the owner reads before deciding. Comfortably over the CHECK's
      // floor of 12 characters — a short one is a 500 from the far side of the
      // stack, which `requestBlockers` exists to stop reaching the server.
      const reason =
        'Proposal 93 Suite 19.3 — raising the ask so 02.17 has a real pending ' +
        'request to decide. No access is granted by this.';
      expect(reason.trim().length).toBeGreaterThanOrEqual(REASON_MIN);
      await page.locator('#ss-reason').fill(reason);

      // ⚠ `role`-less `<button aria-pressed>`, NOT a checkbox — `.adm-mod`.
      // 02.3 looped over `input[type="checkbox"]` against a product that
      // renders buttons, so the loop ran zero times and passed forever. Count
      // first, then assert the toggle actually took.
      const modBtns = page.locator('.adm-mods .adm-mod');
      const modCount = await modBtns.count();
      expect(modCount, 'the module picker rendered no options at all').toBeGreaterThan(0);

      for (const code of ASK_MODULES) {
        const btn = modBtns.filter({ hasText: MODULE_LABELS[code] }).first();
        await expect(btn, `no module button for ${code}`).toBeVisible();
        if ((await btn.getAttribute('aria-pressed')) !== 'true') await btn.click();
        await expect(btn).toHaveAttribute('aria-pressed', 'true');
      }

      await page.locator('#ss-level').selectOption('viewer');
      await page.locator('#ss-ttl').selectOption('2');

      // Send, and wait for the response rather than for the toast — a toast is
      // what the screen SAYS, and the status is what happened.
      const submit = page.getByRole('button', { name: 'Send the request' });
      await expect(submit).toBeEnabled();
      const [res] = await Promise.all([
        page.waitForResponse(
          (r) =>
            r.url().includes('/v1/support-sessions') &&
            r.request().method() === 'POST',
          { timeout: 30_000 },
        ),
        submit.click(),
      ]);
      expect(
        res.status(),
        `POST /v1/support-sessions -> ${res.status()}: ${await res.text()}`,
      ).toBeLessThan(400);

      // The product's own words. A plain string, never a RegExp built from
      // data — an email's `+` is a quantifier and that cost a session once.
      await expect(
        page.locator('.tst__t, .tst__s').getByText('Request sent.', { exact: false }),
      ).toBeVisible({ timeout: 20_000 });
    }

    // ── THE ROW IS THE EVIDENCE, read back from the server ────────────────
    const after = await mySessions(page);
    const mine = after.filter((s) => s.org_id === SUBJECT.id && isPending(s));

    expect(
      mine.length,
      `${SUBJECT.name} has no pending support request after the form was driven. ` +
        '02.17 has nothing to decide.',
    ).toBe(1);

    const row = mine[0];
    expect(row.access_level, 'the level did not bind to the row').toBe('viewer');
    for (const code of ASK_MODULES) {
      expect(row.modules || [], `${code} is not on the raised request`).toContain(code);
    }

    // GRANTS NOTHING — RBAC-SPEC:105. The single most important assertion here:
    // a request that opened access would be the feature inverted.
    expect(row.approved_at, 'a raised request must grant NOTHING until the customer approves').toBeFalsy();

    // And the screen must show it as awaiting the customer, not as access.
    await page.reload();
    await expect(page.getByText(row.ref, { exact: false }).first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('Awaiting the customer').first()).toBeVisible();

    // ── Every write named the subject; none named Aekam ───────────────────
    const posts = wire.filter((w) => w.path.endsWith('/v1/support-sessions'));
    for (const w of posts) {
      expect(w.body, 'a support request did not name Unicode Group in its body').toContain(
        SUBJECT.id,
      );
      expect(w.body, 'a support request named Aekam Inc').not.toContain(ORG_IDS.AEKAM);
    }

    console.log(
      `\n[19.3b] ${SUBJECT.name}: ${row.ref} pending, modules ${(row.modules || []).join(', ')}, ` +
        `level ${row.access_level}, approved_at ${row.approved_at ?? 'null'}` +
        `\n[19.3b] ${posts.length} POST(s), every one naming ${SUBJECT.id}, none naming Aekam\n`,
    );
  });

  test('19.3c payroll, HR and attendance cannot be asked for at all', async ({ page }) => {
    // ═══════════════════════════════════════════════════════════════════════
    // A DECISION THAT IS ONLY A COMMENT IS A DECISION THAT GETS REVERTED.
    //
    // `SUPPORT_MODULES` omits `vetana`, `manav` and `pahchan` deliberately:
    // salary, statutory identifiers and face templates are the three sets of
    // records a support ticket never needs and a customer cannot un-see once an
    // outsider has read them. The form's own hint says so out loud.
    //
    // This asserts the absence from the RENDERED picker, so the day somebody
    // widens the catalogue this goes red and the widening is deliberate.
    // ═══════════════════════════════════════════════════════════════════════
    await signInAsSupport(page);
    await page.goto('/admin/support');
    await expect(
      page.getByRole('heading', { name: 'Support sessions', level: 1 }),
    ).toBeVisible({ timeout: 30_000 });

    await page.getByRole('button', { name: 'Request access' }).click();

    const modBtns = page.locator('.adm-mods .adm-mod');
    const n = await modBtns.count();
    // Count BEFORE asserting absence — "none of these are present" is vacuously
    // true of an empty picker, and that is precisely how 02.3 passed forever.
    expect(n, 'the module picker rendered nothing, so absence proves nothing').toBeGreaterThan(0);

    const rendered = (await modBtns.allInnerTexts()).join(' | ');
    for (const banned of NEVER_REQUESTABLE) {
      expect(
        rendered,
        `${banned} is offered in the support module picker. Salary, statutory ` +
          'identifiers and face templates are not things a support ticket needs.',
      ).not.toContain(banned);
    }

    // And the screen says WHY, rather than leaving the operator to notice a gap.
    await expect(
      page.getByText(/Payroll, HR records and attendance cannot be requested/i),
    ).toBeVisible();

    console.log(`\n[19.3c] ${n} modules offered; payroll, HR and attendance are not among them\n`);
  });
});
