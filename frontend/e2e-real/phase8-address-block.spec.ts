/**
 * Phase 8.0 acceptance — the way out to a map is built from the record.
 *
 * ── WHAT THIS PROVES, AND WHAT IT DELIBERATELY DOES NOT ─────────────────────
 *
 * `docs/plans/PHASE-8-maps-across-modules.md` §8.0 asks for two things: the
 * same component on five pages, and a render test asserting the href is built
 * from the record with an addressless record rendering NOTHING. The render
 * tests exist and pass (`components/ui/__tests__/addressBlock.test.jsx`, 29).
 *
 * What a unit test cannot prove is that the component is WIRED — that the page
 * a customer opens actually mounts it, against the shape the server actually
 * sends. Every fault Phase 8.0 was written to fix was of that kind: a live
 * column with no screen reading it. So this opens a real client in the deployed
 * app and reads the anchor.
 *
 * ── READ-ONLY, AND THAT IS ENFORCED BY WHAT IT DOES ─────────────────────────
 *
 * Nothing here writes. It opens a list, opens a record, and reads an `href`.
 * The only state it changes is the org the session is looking at, which
 * `useOrg` does for every spec in this directory. Staging and production share
 * ONE Supabase database, so a display-only acceptance has no business creating
 * anything to look at.
 *
 * ── WHY E2E AND NOT UNICODE ─────────────────────────────────────────────────
 *
 * The plan says "clicking it on a real Unicode client". Unicode Group is a real
 * firm; E2E Test & Associates has 61 clients whose addresses are just as real a
 * test of the code — `line1` on 48, `city` on 43, `state_code` on 30, and a
 * pincode on NONE of them, which is the more interesting shape anyway: it
 * exercises the branch where the address is partial. The two malformed Unicode
 * rows the plan names (`Navrang Polymers`, 43 keys; `INC UK`, `pincode
 * 'NW1 245'`) are already covered by unit tests built from their real stored
 * values, which is a better place for them than a live page that has to be
 * scrolled to.
 *
 * Run:
 *     node e2e-real/mint-state.mjs
 *     npx playwright test --config e2e-real/onefile.config.ts phase8-address
 */
import { test, expect } from '@playwright/test';
import { GODMODE_STATE } from './real.config';
import { api, settle, shot, useOrg, openTab } from './_helpers';

const ORG_ID = process.env.E2E_ORG_ID || '64e7bea6-6abe-490c-a2a4-27a60c6be916';

/** The keys `services/invoice_pdf.py:123` reads, in the order it reads them. */
const ADDRESS_KEYS = ['line1', 'line2', 'city', 'state', 'pincode', 'country'];

test.use({ storageState: GODMODE_STATE });
test.describe.configure({ mode: 'serial' });

test.describe('Phase 8.0 · the map link is built from the record', () => {
  test('a client with a stored address offers Open in Maps, and the href is that address',
    async ({ page }) => {
      await useOrg(page, ORG_ID, /E2E/i);

      // Find a client that HAS something to render, from the API rather than by
      // scrolling: the list endpoint truncates at 200 and this org holds 61
      // clients whose addresses vary in how much they carry.
      const res = await api(page, 'get', '/api/v1/graha/clients');
      expect(res.status()).toBeLessThan(400);
      const clients = (((await res.json()).data ?? []) as Array<{
        id: string; name: string; address?: Record<string, unknown>;
      }>);
      expect(clients.length, 'E2E has no clients at all').toBeGreaterThan(0);

      const usable = (a?: Record<string, unknown>) =>
        !!a && typeof a === 'object' && ADDRESS_KEYS
          .some(k => String(a[k] ?? '').trim().length > 0);

      const target = clients.find(c => usable(c.address));
      expect(target,
        'no E2E client carries any of the six address keys — 8.0 has nothing ' +
        'to render here and this acceptance cannot be run against this org')
        .toBeTruthy();

      await page.goto('/graha');
      await settle(page);
      await openTab(page, /clients/i);

      // Open the record. The name is what a person clicks.
      await page.getByText(target!.name, { exact: true }).first().click();
      await settle(page);

      const link = page.getByRole('link', { name: /open in maps/i }).first();
      await expect(link,
        'the client detail shows no Open in Maps link — AddressBlock is not ' +
        'mounted on this page, or it decided the address was empty')
        .toBeVisible({ timeout: 20_000 });

      const href = await link.getAttribute('href');
      expect(href, 'the link has no href').toBeTruthy();

      // ── THE ASSERTION THAT MATTERS ─────────────────────────────────────────
      //
      // Not "a link exists" — a link to `?query=` also exists, and it opens
      // Google Maps on the READER's own location, which looks exactly like the
      // product having found the client's premises. The href must carry this
      // record's own values.
      expect(href!, 'the link is not a Google Maps URL')
        .toContain('https://www.google.com/maps/search/?api=1&query=');
      const query = decodeURIComponent(href!.split('query=')[1] || '');
      expect(query.trim().length,
        'the query is EMPTY — this link would open the reader\'s own location ' +
        'and present it as the customer\'s address')
        .toBeGreaterThan(0);

      // Every stored value must appear in the query, and nothing may be
      // invented: the component reads known keys by name, so a value in the URL
      // that is not in the record means it guessed.
      const stored = ADDRESS_KEYS
        .map(k => String(target!.address?.[k] ?? '').trim())
        .filter(Boolean);
      for (const value of stored) {
        expect(query, `"${value}" is stored on this client and is not in the map link`)
          .toContain(value);
      }

      // `state_code` is a GST code ("24" Gujarat, "27" Maharashtra) and must
      // NEVER be printed where a state name belongs. E2E is the org that proves
      // this: 30 of its clients carry `state_code` and NONE carries `state`.
      const code = String(target!.address?.state_code ?? '').trim();
      if (code && !stored.length) {
        expect(query, 'the raw GST state code was printed as if it were a state')
          .not.toBe(code);
      }

      await shot(page, 'phase8-client-open-in-maps');
    });

  test('a contact with nothing stored offers NO link at all', async ({ page }) => {
    // ── THE HALF THAT IS EASY TO GET WRONG, ON THE BEST FIXTURE IN THE DB ────
    //
    // Every E2E client carries an address, so the empty branch cannot be shown
    // there. Contacts are the opposite, and are the reason this branch matters:
    // all 235 satisfy `billing_address IS NOT NULL` and every one is an empty
    // object. A component that renders a disabled control, an em-dash, or a
    // link to an empty `query=` has failed this phase even though it "handled"
    // the empty case — an empty query opens Google Maps on the READER's own
    // location and presents it as the customer's premises.
    await useOrg(page, ORG_ID, /E2E/i);

    const res = await api(page, 'get', '/api/v1/graha/contacts');
    const contacts = (((await res.json()).data ?? []) as Array<{
      id: string; name: string; billing_address?: Record<string, unknown>;
    }>);
    const empty = contacts.find(c => !ADDRESS_KEYS
      .some(k => String(c.billing_address?.[k] ?? '').trim().length > 0));
    expect(empty,
      'no E2E contact has an empty address any more — if the whole register '
      + 'has been filled in, point this test at another org rather than '
      + 'deleting it: the empty branch is the dangerous one').toBeTruthy();

    await page.goto('/graha');
    await settle(page);
    await openTab(page, /contact/i);
    await page.getByText(empty!.name, { exact: true }).first().click();
    await settle(page);

    // The panel must have RENDERED, or "no link" is trivially true because
    // nothing is on screen at all.
    await expect(page.getByText(/Lead Score:/i),
      'the contact detail did not open').toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('link', { name: /open in maps/i }),
      `${empty!.name} has no usable address and still offers a map link`)
      .toHaveCount(0);

    await shot(page, 'phase8-contact-no-address-no-link');
  });

  test('the contact 7.0 gave an address to DOES offer one', async ({ page }) => {
    // The same page, the same component, the other branch — which is what makes
    // the test above mean anything. If the contact detail simply never mounted
    // `AddressBlock`, "no link on an empty contact" would pass for the wrong
    // reason, and that is exactly the failure Phase 8.0 exists to fix: a live
    // column with no screen reading it. (It was true here for a few hours: the
    // component was wired into five surfaces and this one was missed.)
    await useOrg(page, ORG_ID, /E2E/i);

    const res = await api(page, 'get',
      '/api/v1/graha/contacts?search=' + encodeURIComponent('Phase 7.0 Pincode Acceptance'));
    const rows = (((await res.json()).data ?? []) as Array<{ id: string; name: string }>);
    const seeded = rows.find(r => r.name === 'Phase 7.0 Pincode Acceptance');
    expect(seeded, 'the Phase 7.0 acceptance contact is gone').toBeTruthy();

    await page.goto('/graha');
    await settle(page);
    await openTab(page, /contact/i);
    await page.getByText(seeded!.name, { exact: true }).first().click();
    await settle(page);

    const link = page.getByRole('link', { name: /open in maps/i }).first();
    await expect(link, 'the contact detail does not mount AddressBlock at all')
      .toBeVisible({ timeout: 20_000 });
    const href = await link.getAttribute('href');
    const query = decodeURIComponent((href || '').split('query=')[1] || '');
    // Its stored address, typed through the form by the 7.0 acceptance.
    expect(query).toContain('395002');
    expect(query).toContain('Surat');

    await shot(page, 'phase8-contact-with-address-has-a-link');
  });

});
