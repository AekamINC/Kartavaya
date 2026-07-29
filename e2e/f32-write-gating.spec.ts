/**
 * F32, in a real browser — what a viewer actually SEES.
 *
 * `NEXT-SESSION.md`: "Sign in as the role → open the page → click the control →
 * watch what happens. A status code is evidence only where there is no control
 * to click." The unit tests assert the hook's answer; they cannot tell you that
 * the button greyed out, that the tooltip carries the API's sentence, that a
 * click does nothing, or that the page rendered at all.
 *
 * ── Why this runs against stubbed API responses ─────────────────────────────
 *
 * F32 is decided entirely on the client: `module_levels` arrives in
 * `localStorage.Kartavaya_user`, `ModuleAccess` publishes the route's module,
 * and every write control reads `useModuleWrite`. No request participates in
 * that decision, so a stubbed backend answers the question honestly — this is
 * not a case where the fixture could flatter the result.
 *
 * What it therefore does NOT prove: that the API refuses what it should. That
 * was already established live in session B (a `ganit: viewer` composed a
 * ₹88,500 invoice and was refused on submit) and is the half that was never
 * broken. This covers the half that was.
 *
 * ── The white-screen check is the one that earns its keep ───────────────────
 *
 * Gating is per component, and thirteen times during this work the hook was
 * declared in a tab while the button lived in a sibling component in the same
 * file — valid JSX, clean build, `ReferenceError` the first time that drawer
 * renders. `check-write-gates.mjs` catches that statically now; this catches
 * whatever it cannot see, by loading every module page as a viewer and failing
 * on a caught error boundary or an empty root.
 */
import { test, expect, Page } from '@playwright/test';

/** Every module route, with the grant code `ROUTE_META` maps it to. */
const MODULES = [
  { path: '/ganit', code: 'ganit' },
  { path: '/graha', code: 'graha' },
  { path: '/vikray', code: 'vikray' },
  { path: '/manav', code: 'manav' },
  { path: '/vetana', code: 'vetana' },
  { path: '/prachar', code: 'prachar' },
  { path: '/pahchan', code: 'pahchan' },
  { path: '/dristi', code: 'dristi' },
  { path: '/esign', code: 'esign' },
  { path: '/hub/org', code: 'srijan' },
];

/**
 * An empty-but-well-shaped answer for anything the app asks for.
 *
 * Every list route in this codebase answers either a bare array or
 * `{data: []}`, and `rows()` accepts both; the `_listed` envelope adds
 * total/limit/truncated. Returning all of those keys at once means no screen
 * has to be special-cased here, and an empty list still renders the toolbar
 * and the empty state — which is where half the F32 instances live.
 */
const EMPTY = { data: [], total: 0, limit: 0, truncated: false };

/**
 * `/auth/me` must answer with the SEEDED user, not the empty envelope.
 *
 * `Protected.jsx:91` overwrites `localStorage.Kartavaya_user` with whatever
 * `/auth/me` returns, before anything renders. A blanket stub therefore erases
 * `module_levels` on load, every control reverts to the "no opinion" state, and
 * the run reports twelve F32 misses that are entirely the harness's doing —
 * which is exactly what the first version of this file did. The seeded user is
 * the fixture; the stub has to keep it.
 */
async function stubApi(page: Page, moduleLevels?: Record<string, string>) {
  await page.route('**/api/**', route => {
    const url = route.request().url();
    if (url.includes('/auth/me')) {
      const user: Record<string, unknown> = {
        user_id: 'user_e2e', name: 'E2E User', email: 'e2e@example.com', role: 'member',
      };
      if (moduleLevels) {
        user.module_levels = moduleLevels;
        user.module_grants = Object.keys(moduleLevels);
      }
      return route.fulfill({
        status: 200, contentType: 'application/json', body: JSON.stringify(user),
      });
    }
    return route.fulfill({
      status: 200, contentType: 'application/json', body: JSON.stringify(EMPTY),
    });
  });
}

/** Seed the session the way `currentUser()` reads it. */
async function signIn(page: Page, moduleLevels?: Record<string, string>) {
  await page.addInitScript(([levels]) => {
    const user: Record<string, unknown> = {
      user_id: 'user_e2e', name: 'E2E User', email: 'e2e@example.com', role: 'member',
    };
    // `undefined` means the key is ABSENT — the "no opinion" state an org_admin
    // gets. It is not the same as an empty object, and the difference is the
    // thing most likely to regress.
    if (levels) user.module_levels = levels;
    if (levels) user.module_grants = Object.keys(levels);
    localStorage.setItem('Kartavaya_user', JSON.stringify(user));
    localStorage.setItem('auth_token', 'e2e-stub-token');
  }, [moduleLevels ?? null] as const);
}

/** Did the page actually render, or did a boundary catch a throw? */
async function assertRendered(page: Page, where: string) {
  const body = (await page.locator('body').innerText()).trim();
  expect(body.length, `${where}: rendered an empty page`).toBeGreaterThan(0);
  for (const boom of ['Something went wrong', 'is not defined', 'Cannot read properties']) {
    expect(body, `${where}: ${boom}`).not.toContain(boom);
  }
}

/**
 * The module page's own root, per page. NOT `main` — the shell's Topbar lives
 * inside it, and its `New task` button is a workspace action that no module
 * grant gates. Scanning the whole shell reported that as an F32 miss, which is
 * exactly backwards: greying it out for a Ganit viewer would be the bug.
 */
const PAGE_ROOTS = '.mpage, .mn-page, .vt-page, .pr__page, .ph__page, .dpage, .docpane, .sr-page, .hb-page';

/**
 * Every write-ish button inside the module page, and whether it is REACHABLE.
 *
 * Two mechanisms, both correct, and a check that knows only one reports the
 * other as a miss. Where we own the control it takes `disabled`, which a screen
 * reader announces. `ModuleHeader` cannot: `actions` is arbitrary JSX passed in
 * by the page, so it wraps the subtree in `inert` instead — which is what
 * actually stops the click. Asserting `disabled` alone failed on all six header
 * actions that are, in fact, gated.
 *
 * The reason travels with whichever element carries it: the button's own
 * `title`, or the wrapper's.
 */
async function writeControls(page: Page) {
  return page.$$eval(`:is(${PAGE_ROOTS}) button`, els => els
    .filter(b => /k-btn--primary|btn--fill|k-btn--danger|btn--danger/.test(b.className))
    .map(b => {
      const inert = b.closest('[inert]');
      const titled = b.getAttribute('title') ? b : b.closest('[title]');
      return {
        label: (b.textContent || '').trim().slice(0, 40),
        disabled: (b as HTMLButtonElement).disabled || !!inert,
        title: titled?.getAttribute('title') || '',
      };
    }));
}

test.describe('F32 · every module page renders for a viewer', () => {
  for (const m of MODULES) {
    test(`${m.path} renders and gates its writes for ${m.code}: viewer`, async ({ page }) => {
      const errors: string[] = [];
      page.on('pageerror', e => errors.push(e.message));

      await stubApi(page, { [m.code]: 'viewer' });
      await signIn(page, { [m.code]: 'viewer' });
      await page.goto(m.path);
      // Wait on the DOM, not the clock. `Protected` verifies against /auth/me
      // before it renders anything, so the module header appearing is the
      // signal that the gated tree exists — a fixed 900ms raced it and
      // reported a correctly-gated Prachar button as reachable.
      await page.waitForSelector('.mh', { state: 'attached', timeout: 15_000 });
      await page.waitForSelector(`:is(${PAGE_ROOTS}) button`, { state: 'attached', timeout: 15_000 });
      await page.waitForTimeout(400);

      await assertRendered(page, m.path);
      expect(errors, `${m.path} threw: ${errors.join(' | ')}`).toEqual([]);

      // Every write control on screen must be disabled and must say why.
      // Navigation dressed as a primary button. These change what you are
      // LOOKING at, issue no write, and greying them out for a viewer would be
      // the over-gating failure rather than the fix.
      const READ_ONLY = /Browse the catalog|View yesterday|Back to today|Show all|Show every|Clear|Export|Download|Filter/i;
      const controls = (await writeControls(page)).filter(c => !READ_ONLY.test(c.label));
      for (const c of controls) {
        expect(c.disabled, `${m.path} · "${c.label}" is still reachable for a viewer`).toBe(true);
        expect(c.title, `${m.path} · "${c.label}" is disabled with no reason`).toMatch(/Editor|access/);
      }
    });
  }
});

test.describe('F32 · an administrator keeps every button', () => {
  for (const m of MODULES) {
    test(`${m.path} is untouched when the server has no opinion`, async ({ page }) => {
      const errors: string[] = [];
      page.on('pageerror', e => errors.push(e.message));

      await stubApi(page);
      await signIn(page);                       // module_levels ABSENT
      await page.goto(m.path);
      // Wait on the DOM, not the clock. `Protected` verifies against /auth/me
      // before it renders anything, so the module header appearing is the
      // signal that the gated tree exists — a fixed 900ms raced it and
      // reported a correctly-gated Prachar button as reachable.
      await page.waitForSelector('.mh', { state: 'attached', timeout: 15_000 });
      await page.waitForSelector(`:is(${PAGE_ROOTS}) button`, { state: 'attached', timeout: 15_000 });
      await page.waitForTimeout(400);

      await assertRendered(page, m.path);
      expect(errors, `${m.path} threw: ${errors.join(' | ')}`).toEqual([]);

      // The regression that would be worse than the bug.
      const disabledByGate = (await writeControls(page))
        .filter(c => c.disabled && /Editor|access/.test(c.title));
      expect(disabledByGate, `${m.path} greyed out controls for an admin`).toEqual([]);
    });
  }
});

test.describe('F32 · the two instances the sweep measured live', () => {
  test('a ganit viewer is NOT handed the Create Invoice form', async ({ page }) => {
    await stubApi(page, { ganit: 'viewer' });
    await signIn(page, { ganit: 'viewer' });
    await page.goto('/ganit');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(900);

    const invoice = page.locator('button', { hasText: /^\+ Invoice$/ }).first();
    await expect(invoice).toBeVisible();          // disabled, NOT hidden
    // The header wraps its action in an inert container rather than setting
    // `disabled` on JSX it does not own, so assert unreachability, not the
    // attribute: `inert` is what actually stops the click.
    const reachable = await invoice.evaluate(
      el => !el.closest('[inert]') && !(el as HTMLButtonElement).disabled,
    );
    expect(reachable, '"+ Invoice" is still clickable for a viewer').toBe(false);
  });

  test('a member with NO grant is not walked toward Process and email', async ({ page }) => {
    await stubApi(page, {});
    await signIn(page, {});                       // granted nothing
    await page.goto('/vetana');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(900);

    const run = page.locator('button', { hasText: /Run payroll/ }).first();
    if (await run.count()) {
      const reachable = await run.evaluate(
        el => !el.closest('[inert]') && !(el as HTMLButtonElement).disabled,
      );
      expect(reachable, '"Run payroll" is still clickable for a grantless member').toBe(false);
    }

    // And the button at the end of that chain, reached directly.
    const process = page.locator('button', { hasText: /Process payroll/ }).first();
    if (await process.count()) {
      await expect(process).toBeDisabled();
    }
  });
});
