/**
 * Phase 7.5 acceptance — a territory's pincodes are DRAWN, on a real basemap.
 *
 * ── Why this is a real-browser spec and not a unit test ─────────────────────
 *
 * `territoryMapBuckets.test.jsx` already proves the four buckets are kept apart
 * in jsdom with the SDK mocked. It cannot prove the one thing 7.5 is actually
 * for: that a Mappls basemap loads and a polygon appears on it. That depends on
 * a credential, a domain whitelist, a CSP and a third-party script — four
 * things no unit test can see, and every one of which was broken at some point
 * on 2026-08-27.
 *
 * It is also the only honest way to test a browser SDK's DOMAIN VALIDATION.
 * Every server-side probe run that day refused our own whitelisted domains and
 * a control domain we do not own *identically*, which read as "the whitelist is
 * broken" when the whitelist was fine and the probe was invalid. Only a page on
 * the real origin can answer this.
 *
 * ── What it asserts, and what it deliberately does not ──────────────────────
 *
 * It asserts the SDK global exists, the map container is on the page, the
 * "Powered by Mappls" credit is rendered (a LICENCE condition — their terms say
 * it may "in no instance" be removed or hidden), and the GODL boundary credit
 * came from the endpoint. It does NOT assert a pixel count or a canvas size:
 * tiles are a third party's and a flaky assertion on somebody else's rendering
 * would eventually be deleted rather than fixed.
 *
 * READ-ONLY. Nothing is written. A display phase has no business creating rows
 * in a database production shares.
 */
import { test, expect } from '@playwright/test';
import { GODMODE_STATE } from './real.config';
import { settle, openTab, shot } from './_helpers';

test.use({ storageState: GODMODE_STATE });
test.describe.configure({ mode: 'serial' });

/* There was a third test here that hand-rolled an authenticated fetch to
   `/api/v1/maps/token` and asserted the host. It was deleted rather than fixed:
   it re-implemented the app's own auth (and got it wrong), and it proved
   nothing the test below does not. `window.mappls` becoming an object IS the
   end-to-end proof — the endpoint answered, served a key, the SDK URL was the
   right host, Mappls accepted the key AND the origin, and the script executed.
   A test that restates a stronger test's premise only adds ways to go red. */

test('a territory draws its pincode shapes, credited', async ({ page }) => {
  await page.goto('/graha');
  await settle(page);
  await openTab(page, 'Territories');

  // Every saved territory carries a Map toggle. Before 7.5 the map rendered
  // only inside the create/edit form, so a saved shape could be seen while
  // creating it and never again.
  const mapButtons = page.getByRole('button', { name: /^Map$/ });
  await expect(mapButtons.first(), 'no territory offers a Map control').toBeVisible();
  await mapButtons.first().click();

  const holder = page.locator('.terr__map');
  await expect(holder, 'the map container never mounted').toBeVisible({ timeout: 30_000 });

  // The SDK actually executed on this origin — the assertion that the whole
  // credential and whitelist chain is intact.
  await expect
    .poll(() => page.evaluate(() => typeof (window as any).mappls),
          { timeout: 30_000, message: 'the Mappls SDK never loaded on this origin' })
    .toBe('object');

  // A licence condition, not a nicety: "Powered by Mappls" must be clearly
  // presented and may in no instance be removed or hidden.
  const brand = page.locator('.terr__mapbrand');
  await expect(brand, 'the Mappls credit is missing from a page showing their basemap')
    .toBeVisible();
  await expect(brand).toHaveText(/Mappls/);

  // The GODL credit for the government boundary data — a DIFFERENT obligation,
  // for a different thing, and served from the geometry response rather than
  // hardcoded so it cannot drift from the dataset it names.
  await expect(page.locator('.terr__mapcredit')).toContainText(/Government of India|GODL/);

  // And the coverage sentence, which must be legible whether or not tiles drew.
  await expect(page.locator('.terr__coverline').first()).toContainText(/pincode/i);

  await shot(page, 'phase75-territory-map');
});

test('an outage is never reported as "no boundary exists"', async ({ page }) => {
  // The distinction that costs money: `unavailable` (our object store did not
  // answer) must never be rendered as `unmatched` (the government published no
  // boundary), because the second sends an admin to edit a territory that was
  // never wrong — changing the routing that decides who gets paid for a lead.
  await page.route('**/territories/*/geometry', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        type: 'FeatureCollection', features: [], territory_name: 'Outage probe',
        claimed: 2, matched: 0, unmatched: [], unavailable: ['395002', '110001'],
        invalid: [], vintage: 'datagov-2025-05',
        attribution: 'Boundaries © Government of India (data.gov.in) — GODL-India',
      }),
    });
  });

  await page.goto('/graha');
  await settle(page);
  await openTab(page, 'Territories');
  await page.getByRole('button', { name: /^Map$/ }).first().click();

  const panel = page.locator('.terr__mapwrap');
  await expect(panel).toContainText(/unreachable|could not be looked up/i);
  await expect(panel).not.toContainText(/no boundary has been published/i);
});
