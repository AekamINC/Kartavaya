/**
 * Proposal 93 · Suite 00 / Suite 20 — the cold-start navigation audit.
 *
 * ── What this is for ────────────────────────────────────────────────────────
 *
 * §1 of proposal 93: "every defect this product has shipped in the classes above
 * was invisible to the database — a component that rendered a map and drew
 * nothing for eighteen days; a screen that displayed six wrong numbers. Not one
 * of those would fail a row-count check."
 *
 * So this asserts nothing about rows. It opens every module in the nav, in menu
 * order, as a signed-in person who has read nothing, and asks the only question
 * a first-week customer actually asks: **did the screen break?**
 *
 * ── Why it is READ-ONLY, deliberately ───────────────────────────────────────
 *
 * Staging and production share one Supabase database. This suite navigates and
 * observes; it fills no form and clicks no control that writes. It is therefore
 * safe to run before the R1 freeze, which is the whole point — it is the one
 * suite that needs neither the wipe nor the reseed to be worth running, and §1
 * says to run it FIRST because whatever it finds must be fixed before the other
 * 22 suites are worth writing.
 *
 * ── What counts as a failure ────────────────────────────────────────────────
 *
 * Not "the page had no data" — an empty org is the expected state for most of
 * these and an empty state IS the product working. The failures are:
 *
 *   uncaught console errors      §1: "zero uncaught errors across the whole run"
 *   a spinner that never resolves
 *   a blank page, indistinguishable from a broken one
 *   an error toast / error boundary
 *   a hard navigation away (a route that silently bounces)
 *
 * ⚠ Console noise is filtered to genuine page errors. A failed favicon or a
 * third-party warning is not a defect and treating it as one is how a suite
 * gets ignored.
 *
 * Run:
 *   npx playwright test --config e2e-real/coldstart.config.ts
 */
import { test, expect, Page, ConsoleMessage } from '@playwright/test';

/** Top-level destinations, in nav order. Params-only routes are excluded — they
 *  need an id, and inventing one tests the 404 path rather than the screen. */
const ROUTES: Array<[string, string]> = [
  ['dashboard', '/dashboard'],
  ['boards', '/boards'],
  ['projects', '/projects'],
  ['tasks', '/tasks'],
  ['teams', '/teams'],
  ['inbox', '/inbox'],
  ['approvals', '/approvals'],
  ['templates', '/templates'],
  ['activity', '/activity'],
  ['time', '/time'],
  ['reports', '/reports'],
  ['graha (CRM)', '/graha'],
  ['ganit (books)', '/ganit'],
  ['kray (procurement)', '/kray'],
  ['manav (HR)', '/manav'],
  ['vetana (payroll)', '/vetana'],
  ['pahchan (attendance)', '/pahchan'],
  ['vikray (sales)', '/vikray'],
  ['prachar (marketing)', '/prachar'],
  ['dristi (reports)', '/dristi'],
  ['sanvaad (chat)', '/sanvaad'],
  ['esign', '/esign'],
  ['hub', '/hub'],
  ['hub/clients', '/hub/clients'],
  ['hub/org', '/hub/org'],
  ['settings/organisation', '/settings/organisation'],
  ['settings/roles', '/settings/roles'],
  ['settings/categories', '/settings/categories'],
  ['settings/customize', '/settings/customize'],
  ['settings/connectors', '/settings/connectors'],
  ['settings/automations', '/settings/automations'],
];

/** Console lines that are not defects. Kept deliberately short — every entry
 *  here is a thing this suite will never catch again, so each one is a decision. */
const IGNORE = [
  /favicon/i,
  /Download the React DevTools/i,
  /\[vite\]/i,
  /Failed to load resource.*401/i,   // an unauthorised probe is its own assertion, not a console defect
];

function interesting(m: ConsoleMessage): boolean {
  if (m.type() !== 'error') return false;
  const t = m.text();
  return !IGNORE.some((r) => r.test(t));
}

async function login(page: Page) {
  const email = process.env.E2E_APPROVER_EMAIL;
  const password = process.env.E2E_APPROVER_PASSWORD;
  test.skip(!email || !password, 'E2E_APPROVER_EMAIL / _PASSWORD not in .env.e2e');

  await page.goto('/login');
  const emailBox = page.locator('#au-email, input[type="email"], input[name="email"]').first();
  const passBox = page.locator('#au-password, input[type="password"], input[name="password"]').first();
  await expect(emailBox).toBeVisible({ timeout: 30_000 });
  await emailBox.fill(email!);
  await passBox.fill(password!);
  await page
    .locator('button[type="submit"], button:has-text("Sign in"), button:has-text("Log in")')
    .first()
    .click();
  await page.waitForURL(/\/(dashboard|boards|tasks|projects)/, { timeout: 45_000 });
}

test.describe('Suite 00 — cold-start navigation audit', () => {
  test('every module renders without breaking', async ({ page }) => {
    test.setTimeout(10 * 60_000);

    const errors: string[] = [];
    const pageErrors: string[] = [];
    page.on('console', (m) => { if (interesting(m)) errors.push(`${page.url()} :: ${m.text()}`); });
    page.on('pageerror', (e) => pageErrors.push(`${page.url()} :: ${e.message}`));

    await login(page);

    const rows: Array<Record<string, string>> = [];

    for (const [name, path] of ROUTES) {
      const before = errors.length + pageErrors.length;
      let verdict = 'ok';
      let detail = '';

      try {
        await page.goto(path, { waitUntil: 'domcontentloaded', timeout: 45_000 });
        // Give the screen a fair chance to resolve its first paint of data.
        await page.waitForTimeout(2500);

        const landed = new URL(page.url()).pathname;
        if (landed !== path && !landed.startsWith(path)) {
          verdict = 'REDIRECTED';
          detail = `-> ${landed}`;
        }

        // A spinner still on screen after the settle window is the "never
        // resolves" case §1 names. Checked by role and by the app's own classes.
        const spinner = page.locator(
          '[role="progressbar"], .k-spinner, .spinner, [aria-busy="true"]'
        );
        const spinning = await spinner.count().catch(() => 0);

        const bodyText = ((await page.locator('body').innerText().catch(() => '')) || '').trim();

        if (bodyText.length < 40 && spinning === 0) {
          verdict = 'BLANK';
          detail = `body text ${bodyText.length} chars`;
        } else if (spinning > 0 && bodyText.length < 200) {
          verdict = 'SPINNER-STUCK';
          detail = `${spinning} spinner(s), body ${bodyText.length} chars`;
        }

        // An error boundary or failure note is a break even when the page has
        // text — but it is detected STRUCTURALLY, by the component the app
        // actually renders on failure, not by scanning prose.
        //
        // ⚠ THIS WAS A TEST BUG ON ITS FIRST RUN, and it is the exact fault the
        // programme exists to catch. The original check matched the free text
        // /…|try again/i and flagged `/hub/org` as broken. It is not: "Try
        // again" is the REGENERATE button on a SUCCESSFUL Sahayak answer
        // (`hub/ChatTab.jsx:160`). Proved by probe — `.hb-err` count was 0, and
        // there was no failing request and no console error on the page.
        // Had the string match been kept and the product "fixed" to satisfy it,
        // a working feature would have been changed to please a broken test.
        //
        // ⚠ AND IT WAS TOO LOOSE A SECOND TIME. The first structural version
        // counted `.hb-err, .note--warn` and flagged /manav and /vetana. Reading
        // what those notes SAY settled it — both are correct advisory banners,
        // not failures:
        //   manav  "61 of the 73 employees shown have no login linked…"
        //   vetana "13 of 73 active employees have no salary structure…"
        // `.note--warn` is the shared warning skin; `ErrorNote` is
        // `note note--warn hb-err`, so **`.hb-err` is the only precise marker**
        // and `.note--warn` on its own is the product working well.
        const errNotes = await page.locator('.hb-err').count().catch(() => 0);
        // Phrases that are never legitimate UI copy. "Try again" and "failed to
        // load" are excluded deliberately: both appear as ordinary controls and
        // captions on healthy screens.
        const errText = /something went wrong|unexpected error|an error occurred/i;
        if (errNotes > 0 || errText.test(bodyText)) {
          verdict = verdict === 'ok' ? 'ERROR-STATE' : verdict;
          detail = (detail + ' ' + (errNotes ? `${errNotes} error note(s)` : bodyText.match(errText)?.[0] ?? '')).trim();
        }
      } catch (e: any) {
        verdict = 'THREW';
        detail = String(e?.message ?? e).slice(0, 160);
      }

      const newErrors = errors.length + pageErrors.length - before;
      rows.push({
        route: name,
        path,
        verdict,
        consoleErrors: String(newErrors),
        detail,
      });
    }

    // The report is the deliverable — printed whole, so a partial run is
    // visibly partial rather than silently truncated.
    console.log('\n================ COLD-START NAVIGATION AUDIT ================');
    for (const r of rows) {
      const flag = r.verdict === 'ok' && r.consoleErrors === '0' ? '  ' : '!!';
      console.log(
        `${flag} ${r.route.padEnd(24)} ${r.verdict.padEnd(14)} console=${r.consoleErrors.padEnd(3)} ${r.detail}`
      );
    }
    console.log(`\nroutes: ${rows.length}`);
    console.log(`broken: ${rows.filter((r) => r.verdict !== 'ok').length}`);
    console.log(`routes with console errors: ${rows.filter((r) => r.consoleErrors !== '0').length}`);

    if (pageErrors.length) {
      console.log('\n---- uncaught page errors ----');
      for (const e of pageErrors.slice(0, 40)) console.log('  ' + e);
    }
    if (errors.length) {
      console.log('\n---- console errors ----');
      for (const e of errors.slice(0, 60)) console.log('  ' + e);
    }
    console.log('=============================================================\n');

    // §1: "zero uncaught console errors across the whole run".
    expect(
      rows.filter((r) => r.verdict !== 'ok').map((r) => `${r.route}: ${r.verdict} ${r.detail}`)
    ).toEqual([]);
    expect(pageErrors).toEqual([]);
  });
});
