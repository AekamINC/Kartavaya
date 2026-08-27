/**
 * Phase 7.0 acceptance — a PIN reaches the database, through the screens.
 *
 * ── WHAT THIS IS FOR ────────────────────────────────────────────────────────
 *
 * `docs/plans/PHASE-7-territory-and-address.md` §7.0 sets two acceptances and
 * both are counts moving off zero:
 *
 *   · a contact created through the web UI with pincode `395002` comes back
 *     from `GET /v1/graha/contacts/{id}` with `billing_address.pincode`
 *     = '395002' — a row where E2E Test & Associates has **0 of 235** today.
 *   · `jsonb_array_length(rules->'pincodes') > 0` moves off **0**.
 *
 * Measured live on 2026-08-27, both orgs:
 *
 *     graha_contacts, E2E          235 rows · 0 with a billing pincode
 *                                          · 0 with a shipping pincode
 *                                          · 0 with a territory_id
 *     graha_clients,  E2E           61 rows · 0 with a pincode
 *     graha_territories, E2E        17 rows · 0 with a PIN · 0 with a member
 *     graha_territories, Unicode     0 rows
 *
 * The code for all of this shipped in `1d8cc7b9`. Code with no row is 🟡 by
 * this project's own definition, and this spec is what makes it ✅.
 *
 * ── THE `{}` TRAP, WHICH IS WHY THE ASSERTIONS LOOK LIKE THIS ───────────────
 *
 * All 235 of E2E's contacts already satisfy `billing_address IS NOT NULL`.
 * Every one of them is literally `{}`. So "the column is populated" is true on
 * day zero and proves nothing; the only honest assertion is on a KEY carrying
 * the value that was typed. Every check below reads a key, never a null.
 *
 * ── WHY 395002, AND WHY GUJARAT ─────────────────────────────────────────────
 *
 * 395002 is Surat. E2E already carries a territory named `Gujarat`, so the PIN
 * and the patch agree with each other — which matters for the phase AFTER this
 * one: 7.1 routes a contact to a rep by matching its PIN against a territory's
 * list, and it needs a PIN that a territory actually claims to have anything to
 * match. Seeding a PIN into a territory nobody would put it in would make 7.1's
 * acceptance a tautology.
 *
 * ── E2E ONLY, AND PROVEN FROM THE SERVER BEFORE ANYTHING IS WRITTEN ─────────
 *
 * Staging and production share ONE Supabase database. Unicode Group is a real
 * firm with real customers, and 38 of its 54 contacts already carry a real
 * address — a stray write there would edit a live CRM record. `useOrg` asks the
 * SERVER which org the session is in rather than trusting `E2E_ORG_ID`, which
 * is the check whose absence let a Phase-1 vendor land in the wrong
 * organisation on 2026-08-26.
 *
 * ── IT DRIVES THE SCREENS, NOT THE ENDPOINTS ────────────────────────────────
 *
 * Every value below is typed the way a person types it. A POST proves the
 * endpoint; a form proves the endpoint AND the screen that is supposed to reach
 * it — and "the screen that is supposed to reach it" is the entire content of
 * Phase 7.0. All three faults it closed were reachable endpoints with no
 * caller: `billing_address` accepted since migration 023 with no field on the
 * form, `territory_id` on neither model, and `PATCH /territories/{id}` with
 * zero callers.
 *
 * ── RE-RUNNABLE ─────────────────────────────────────────────────────────────
 *
 * Both halves recognise their own previous run and VERIFY instead of writing
 * again. A spec that seeds a second copy every time it runs is a spec that
 * quietly inflates the count it is supposed to be proving.
 *
 * Run:
 *     node e2e-real/mint-state.mjs
 *     npx playwright test --config e2e-real/onefile.config.ts phase7-address
 */
import { test, expect, Page } from '@playwright/test';
import { GODMODE_STATE } from './real.config';
import { api, settle, shot, useOrg, openTab, pickOption, submitting } from './_helpers';

const ORG_ID = process.env.E2E_ORG_ID || '64e7bea6-6abe-490c-a2a4-27a60c6be916';

/** Surat. Six digits, first digit non-zero — every Indian PIN is. */
const PIN = '395002';
const CITY = 'Surat';
const STATE = 'Gujarat';

/** The territory that should claim it. E2E carries one by this name already. */
const TERRITORY = /gujarat/i;

/**
 * Stable, so a second run finds this row instead of making another. Named for
 * what it is rather than dressed up as a person: it is acceptance evidence
 * sitting in a test org, and `memory/feedback_keep_test_seed_data` is the
 * standing rule that such rows are kept, so it should say what it is to
 * whoever reads the register next.
 */
const CONTACT_NAME = 'Phase 7.0 Pincode Acceptance';

test.use({ storageState: GODMODE_STATE });
test.describe.configure({ mode: 'serial' });

/**
 * Graha, on the named tab, in the org this spec is allowed to write to.
 *
 * Through `openTab`, not `getByRole('tab')`. Graha has TWENTY tabs and the
 * strip only shows what fits — the rest live behind a "More +N" popover, and
 * which ones those are depends on the viewport and on the reader's own starred
 * tab prefs. A direct role query found nothing and reported "Graha has no
 * territories tab" about a tab that was one click away. `graha.spec.ts` records
 * the same constraint at the top of the file.
 */
async function openGraha(page: Page, tab: RegExp) {
  await useOrg(page, ORG_ID, /E2E/i);
  await page.goto('/graha');
  await settle(page);
  await openTab(page, tab);
}

/**
 * The control under a Graha field label.
 *
 * `getByLabel` is not reliable on these: a Graha field is
 * `<label class="gr__f"><span class="gr__fl">Territory</span><select/></label>`,
 * and the accessible name is computed from the whole label subtree — which for
 * a `<select>` includes every option's text. `getByLabel(/^territory$/i)`
 * therefore matched nothing and `pickOption` reported "never loaded any
 * options" about a picker that was on screen with its options in it. The text
 * inputs happened to work, which is worse than if none had: it looked like a
 * data problem rather than a selector problem.
 *
 * Walking the `.gr__fl` span is what the unit tests for these forms already do.
 */
function underLabel(scope: any, text: RegExp) {
  return scope.locator('label.gr__f')
    .filter({ has: scope.page().locator('span.gr__fl').filter({ hasText: text }) })
    .locator('input, select, textarea')
    .first();
}

/** Every territory this org holds, straight from the API. */
async function territories(page: Page) {
  const res = await api(page, 'get', '/api/v1/graha/territories');
  expect(res.status(), 'the territories endpoint refused').toBeLessThan(400);
  return (((await res.json()).data ?? []) as Array<{
    id: string; name: string; rules?: { pincodes?: string[] };
  }>);
}

test.describe('Phase 7.0 · a pincode reaches the database through the product', () => {
  test('a territory is given the PIN it covers, through the Edit form that had no caller',
    async ({ page }) => {
      await openGraha(page, /territor/i);

      const before = await territories(page);
      expect(before.length, 'E2E has no territories to edit').toBeGreaterThan(0);

      const target = before.find(t => TERRITORY.test(t.name));
      expect(target, `no territory named like ${TERRITORY}; saw: ` +
        before.map(t => t.name).join(' | ')).toBeTruthy();

      // Already seeded by an earlier run? Verify and stop — see the header.
      if ((target!.rules?.pincodes ?? []).includes(PIN)) {
        expect(target!.rules!.pincodes!.length).toBeGreaterThan(0);
        await shot(page, 'phase7-territory-already-seeded');
        return;
      }

      // ── THE EDIT CONTROL THAT DID NOT EXIST ────────────────────────────────
      //
      // `PATCH /v1/graha/territories/{id}` has been org-scoped, admin-gated and
      // member-validating since migration 023, and NOTHING CALLED IT. The only
      // way to correct a pincode list was to delete the territory, which also
      // discards its `round_robin_index` — so the next lead after a typo fix
      // went to whoever sits first in the array rather than to whoever was next.
      const row = page.locator('.gr__lrow', { hasText: target!.name }).first();
      await expect(row, 'the territory row did not render').toBeVisible({ timeout: 20_000 });
      await row.getByRole('button', { name: /^edit$/i }).click();
      await settle(page);

      const form = page.locator('form').first();
      await expect(form.getByText(/edit territory/i),
        'the form did not switch into edit mode').toBeVisible();

      // The name must already be in the box. The PATCH body REPLACES the row,
      // so a form that opened blank would blank the territory on save — which
      // is the failure mode worth testing for, not the happy path.
      await expect(form.locator('input').first()).toHaveValue(target!.name);

      // SCOPED TO THE PINCODES GROUP. The form has TWO buttons that say "Add" —
      // one adds a person to `assigned_users`, one adds a PIN to
      // `rules.pincodes` — so a form-wide `getByRole('button', {name: /^add$/})`
      // is a strict-mode violation, and the version of this spec that used one
      // failed with "resolved to 2 elements" rather than with anything about
      // pincodes. Two identical labels in one form is a real accessibility
      // smell, but renaming the buttons is a UI change and this is a test.
      const pins = form.locator('.gr__group', { hasText: /pincodes covered/i });
      await pins.getByLabel(/^pincodes$/i).fill(PIN);
      await pins.getByRole('button', { name: /^add$/i }).click();
      // The CHIP, by its class. `getByText(PIN, {exact: true})` does not match
      // it: a chip is the pincode AND its remove button, so its text content is
      // `395002×` and an exact match finds nothing. Dropping `exact` instead
      // would match every ancestor that contains the digits.
      await expect(pins.locator('.gr__tok', { hasText: PIN }),
        'the pincode chip was not added').toBeVisible();

      await submitting(page, '/graha/territories/', async () => {
        await form.getByRole('button', { name: /save changes/i }).click();
      });
      await settle(page);

      // ── THE COUNT, READ BACK FROM THE SERVER ───────────────────────────────
      const after = await territories(page);
      const saved = after.find(t => t.id === target!.id);
      expect(saved, 'the territory vanished from the list after saving').toBeTruthy();
      expect(saved!.rules?.pincodes ?? [],
        'the PIN did not survive the PATCH').toContain(PIN);
      expect(saved!.name, 'the PATCH blanked the name').toBe(target!.name);

      // The phase acceptance, stated as the phase states it.
      const withPins = after.filter(t => (t.rules?.pincodes ?? []).length > 0);
      expect(withPins.length,
        'no territory in E2E carries a PIN — the count is still at zero')
        .toBeGreaterThan(0);

      await shot(page, 'phase7-territory-has-a-pin');
    });

  test('a contact is created with an address and a territory, through the form that had no fields',
    async ({ page }) => {
      await openGraha(page, /contact/i);

      // Already seeded? Find it by name through the server's own search rather
      // than by scrolling — the list endpoint truncates at 200 and E2E holds
      // 235 contacts, so the row this spec wrote may simply not be on the page.
      const existing = await api(page, 'get',
        `/api/v1/graha/contacts?search=${encodeURIComponent(CONTACT_NAME)}`);
      const found = (((await existing.json()).data ?? []) as Array<{ id: string; name: string }>)
        .find(c => c.name === CONTACT_NAME);

      let contactId = found?.id;

      if (!contactId) {
        await page.getByRole('button', { name: /add contact/i }).click();
        await settle(page);
        const form = page.locator('form').first();

        await underLabel(form, /^name/i).fill(CONTACT_NAME);

        // ── THE FIVE FIELDS THAT DID NOT EXIST ─────────────────────────────
        //
        // `billing_address` has been a live jsonb column since migration 023
        // and `ContactCreate` has always accepted it. There was no way to type
        // into it. These are the keys `services/invoice_pdf.py:123` reads, so
        // an address entered here is one an invoice can print.
        await underLabel(form, /^city$/i).fill(CITY);
        await underLabel(form, /^state$/i).fill(STATE);
        await underLabel(form, /^pincode$/i).fill(PIN);
        await underLabel(form, /^address line 1$/i).fill('Plot 44, Pandesara GIDC');

        // And the column that was unreachable from every API path. The picker
        // shows NAMES; the id never appears as text.
        await pickOption(underLabel(form, /^territory$/i), 'territory', TERRITORY);

        const created = await submitting(page, '/graha/contacts', async () => {
          await form.getByRole('button', { name: /create contact/i }).click();
        });
        expect(created.id, 'the create response carried no id').toBeTruthy();
        contactId = created.id;
        await settle(page);
      }

      // ── READ IT BACK THE WAY THE PHASE ASKS ────────────────────────────────
      const res = await api(page, 'get', `/api/v1/graha/contacts/${contactId}`);
      expect(res.status(), 'the contact could not be read back').toBeLessThan(400);
      const body = await res.json();
      const c = body.contact ?? body;

      // The acceptance sentence, verbatim from the plan.
      expect(c.billing_address?.pincode,
        'billing_address.pincode is not what was typed — this is the whole phase')
        .toBe(PIN);
      expect(c.billing_address?.city).toBe(CITY);
      expect(c.billing_address?.state).toBe(STATE);

      // And the second column.
      expect(c.territory_id,
        'the contact carries no territory — territory_id is still unreachable')
        .toBeTruthy();
      // The NAME comes back too, so no screen has to render the id to show it.
      expect(c.territory_name, 'the detail endpoint returns no territory name')
        .toMatch(TERRITORY);

      await shot(page, 'phase7-contact-has-a-pincode');
    });

  test('the org-wide counts have moved off zero', async ({ page }) => {
    // Stated separately and read from the API, because the two tests above
    // prove their OWN row and this project's definition of ✅ is a count that
    // moved. A per-row assertion passes on a database where nothing else
    // changed, which is exactly what "code shipped" looked like the last five
    // times this ledger was rewritten.
    await useOrg(page, ORG_ID, /E2E/i);

    const terr = await territories(page);
    const withPins = terr.filter(t => (t.rules?.pincodes ?? []).length > 0);
    expect(withPins.length, 'jsonb_array_length(rules->pincodes) is still 0 org-wide')
      .toBeGreaterThan(0);

    const res = await api(page, 'get',
      `/api/v1/graha/contacts?search=${encodeURIComponent(CONTACT_NAME)}`);
    const rows = ((await res.json()).data ?? []) as Array<{ id: string; name: string }>;
    expect(rows.some(r => r.name === CONTACT_NAME),
      'the seeded contact is not findable through the list endpoint').toBe(true);

    // EXACTLY ONE. A spec that seeds a fresh copy on every run inflates the
    // count it exists to prove, and the inflation looks like progress.
    expect(rows.filter(r => r.name === CONTACT_NAME).length,
      'this spec has seeded more than one contact — it is not idempotent').toBe(1);
  });
});
