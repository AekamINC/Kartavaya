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

/**
 * Open a contact's detail panel BY NAME, through the search box.
 *
 * Not by clicking the name in the table. E2E holds 236 contacts, the table
 * paginates, and the row this spec wants is chosen from the API's own ordering
 * — so `getByText(name).click()` looked for a row that was very often on
 * another page and failed with "the contact detail did not open", which reads
 * like the panel is broken rather than like the row was never on screen.
 *
 * The search is SERVER-side and reaches past the 200 rows the list endpoint
 * returns, which is the whole reason this tab has one.
 */
async function openContact(page: import('@playwright/test').Page, name: string) {
  const search = page.locator('input.gr__search');
  await expect(search, 'the contact search box is gone').toBeVisible({ timeout: 20_000 });
  await search.fill(name);
  // THE SEARCH IS SERVER-SIDE AND DOES NOT FIRE ON TYPING. There is a Filter
  // button beside the box and `load()` hangs off it. Filling the input alone
  // left the table showing all 200 rows, and the row this then clicked was
  // whichever one happened to match first — which is how a test looking for
  // KEVAL SHAH opened `Phase 7.1 Round-Robin Acceptance` and then reported the
  // 7.1 contact's map link as a bug in the empty branch.
  await page.getByRole('button', { name: /^filter$/i }).click();
  await settle(page);

  const row = page.locator('tr.gr__tr--click', { hasText: name }).first();
  await expect(row, `no row for "${name}" after searching for it`)
    .toBeVisible({ timeout: 20_000 });
  await row.click();
  await settle(page);

  // AND CONFIRM WHICH RECORD OPENED. Without this the whole spec is an
  // assertion about a page it never checked the identity of — the failure above
  // was invisible for three runs precisely because nothing read the title.
  await expect(page.locator('.gr__dname'),
    `the detail that opened is not "${name}"`)
    .toHaveText(name, { timeout: 20_000 });
}

/** The keys `services/invoice_pdf.py:123` reads, in the order it reads them. */
const ADDRESS_KEYS = ['line1', 'line2', 'city', 'state', 'pincode', 'country'];

test.use({ storageState: GODMODE_STATE });
test.describe.configure({ mode: 'serial' });

/**
 * Graha, on the named tab.
 *
 * The wait for the tab strip is NOT belt-and-braces. `settle` returns when the
 * network is quiet, and Graha's twenty tabs are measured and split between the
 * strip and a "More +N" popover AFTER that — so `openTab` called too early sees
 * neither an inline tab nor a More button and reports
 * "tab /clients/i is neither inline nor behind a More menu" about a tab that
 * renders a moment later. It passed once and failed the next run on exactly
 * that race.
 */
async function openGraha(page: import('@playwright/test').Page, tab: RegExp) {
  await useOrg(page, ORG_ID, /E2E/i);
  await page.goto('/graha');
  await settle(page);
  await expect
    .poll(async () => (await page.getByRole('tab').count())
      + (await page.getByRole('button', { name: /^More/ }).count()), {
      message: 'the Graha tab strip never rendered',
      timeout: 30_000,
    })
    .toBeGreaterThan(0);
  await openTab(page, tab);
}

test.describe('Phase 8.0 · the map link is built from the record', () => {
  test('a client with a stored address offers Open in Maps, and the href is that address',
    async ({ page }) => {
      // THE ORG FIRST, before a single read. Moving `useOrg` into `openGraha`
      // left this `api()` call running against whatever org the session
      // happened to be in — which is the precise hazard this file's header is
      // about, arrived at by tidying rather than by deciding.
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

      await openGraha(page, /clients/i);

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

    // ── THE LIST DOES NOT CARRY `billing_address` ──────────────────────────
    //
    // `GET /contacts` returns a row shape for a TABLE — name, company, email,
    // type — and the address is not in it. The first version of this test
    // filtered the list on `c.billing_address?.[k]`, which is `undefined` for
    // every row, so EVERY contact looked empty and it picked the first one:
    // `Phase 7.1 Round-Robin Acceptance`, which carries 395002. The failure
    // message read "…has no usable address and still offers a map link" about
    // a contact whose address is fine — a test accusing the product of its own
    // bug, which is the most expensive kind.
    //
    // So each candidate is READ BACK from the detail endpoint, which is where
    // `billing_address` actually lives, and the first genuinely empty one wins.
    const res = await api(page, 'get', '/api/v1/graha/contacts');
    const contacts = (((await res.json()).data ?? []) as Array<{
      id: string; name: string;
    }>);
    expect(contacts.length, 'E2E has no contacts at all').toBeGreaterThan(0);

    let empty: { id: string; name: string } | undefined;
    for (const candidate of contacts.slice(0, 25)) {
      const one = await api(page, 'get', `/api/v1/graha/contacts/${candidate.id}`);
      if (one.status() >= 400) continue;
      const payload = await one.json();
      const record = payload.contact ?? payload;
      const addr = (record.billing_address ?? {}) as Record<string, unknown>;
      if (!ADDRESS_KEYS.some(k => String(addr[k] ?? '').trim().length > 0)) {
        empty = candidate;
        break;
      }
    }
    expect(empty,
      'none of the first 25 E2E contacts has an empty address — if the whole '
      + 'register has been filled in, point this test at another org rather '
      + 'than deleting it: the empty branch is the dangerous one').toBeTruthy();

    await openGraha(page, /contact/i);
    await openContact(page, empty!.name);

    // The panel must have RENDERED, or "no link" is trivially true because
    // nothing is on screen at all.
    await expect(page.getByText(/Lead Score:/i),
      'the contact detail did not open').toBeVisible({ timeout: 20_000 });
    // Report the HREF on failure, not just the count. "still offers a map link"
    // does not say WHICH record the link is for, and the first time this fired
    // the answer mattered: the contact's own address is `{}`, so a link at all
    // means something else on the page drew it.
    const links = page.getByRole('link', { name: /open in maps/i });
    const hrefs = await links.evaluateAll(
      (els) => els.map(e => (e as HTMLAnchorElement).href));
    expect(hrefs,
      `${empty!.name} has an EMPTY billing_address and the page still offers ` +
      `${hrefs.length} map link(s): ${hrefs.join(' | ')}`)
      .toEqual([]);

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

    await openGraha(page, /contact/i);
    await openContact(page, seeded!.name);

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
