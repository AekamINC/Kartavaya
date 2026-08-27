/**
 * Phase 6.1, redirected — the commission model needs SEEDING, not dropping.
 *
 * ── WHAT WAS ASKED, AND WHAT THE ANSWER TURNED OUT TO BE ────────────────────
 *
 * `docs/plans/PHASE-6-retire-duplicates.md` §6.1 lists commission among the
 * models this product built twice, and proposes retiring the dead half. Read
 * live on 2026-08-27, `railway run -e staging -s Kartavya`:
 *
 *     sales_commissions / _slabs / _assignments      0 / 0 / 0
 *     manav_commission_schemes                       2  — BOTH Unicode Group
 *     manav_commission_bands                         4  — the same two schemes
 *     manav_bonus_awards                             0
 *     manav_employees, E2E Test & Associates        83  — and no scheme at all
 *
 * So the live half works and **E2E Test & Associates has none of it**: 83
 * people on the register, zero arrangements between them. The owner's call was
 * to seed rather than to drop, and this is that. A feature that cannot be
 * driven end to end in the org every spec runs against is 🟡 by this project's
 * own definition, however much code stands behind it.
 *
 * THE DEAD THREE ARE NOT TOUCHED HERE, and seeding them was never an option:
 * their `user_id` is `uuid` where `public.users.user_id` is `text`, so the join
 * cannot be made at all. That is a fact about the schema, recorded rather than
 * acted on — dropping tables is the owner's decision and he has not made it.
 *
 * ── THE LADDER IS THE OWNER'S OWN ───────────────────────────────────────────
 *
 * "3% on 1lakh above and 4% 5 above 7.5% above 10lakh" — his words on
 * 2026-08-21, transcribed as OWNERS_LADDER in
 * `backend/tests/test_commission_slabs.py` and worked by hand there:
 * ₹12,00,000 of turnover pays ₹47,000, not ₹90,000, because each band pays on
 * ITS OWN slice. Seeding any other ladder would put a number in front of him
 * that he never chose, and the first screen he opens would be teaching him a
 * rate this product invented.
 *
 * ── E2E ONLY, AND THE SPEC PROVES IT BEFORE IT WRITES ───────────────────────
 *
 * A commission arrangement decides what a person is PAID. Unicode Group is a
 * real firm with real staff and already holds two schemes; a stray write there
 * would change somebody's pay. `useOrg` confirms the SESSION is in E2E from the
 * server — not from the environment variable, which is the check that failed
 * on 2026-08-26 and let a Phase-1 vendor land in the wrong organisation.
 *
 * ── IT DRIVES THE SCREEN, NOT THE ENDPOINT ──────────────────────────────────
 *
 * Every field below is filled the way a person fills it: the register, the
 * person, the form, the ladder editor, the button. The standing rule is that
 * seed data is entered through the product's own forms, and the reason is that
 * a POST proves the endpoint while a form proves the endpoint AND the screen
 * that is supposed to reach it — which is exactly the gap that shipped this
 * model with no screen at all.
 *
 * Run:
 *     node e2e-real/mint-state.mjs
 *     npx playwright test --config e2e-real/onefile.config.ts commission-seed
 */
import { test, expect, Page } from '@playwright/test';
import { GODMODE_STATE } from './real.config';
import { api, settle, shot, setDate, useOrg, pickOption, submitting, RUN } from './_helpers';

const ORG_ID = process.env.E2E_ORG_ID || '64e7bea6-6abe-490c-a2a4-27a60c6be916';

/**
 * The owner's ladder. `from_amount` is the floor the rate applies ABOVE, and
 * each rung runs to the next one's floor — the marginal reading he settled on.
 * Deliberately NOT sorted here: the spec types them into the editor in this
 * order to prove that row order never reaches the money.
 */
const ENTRY_ORDER = [
  { from: '1000000', rate: '7.5' },
  { from: '100000', rate: '3' },
  { from: '500000', rate: '4' },
];

/** The same three, as they must come back — lowest floor first. */
const OWNERS_LADDER = [
  { from_amount: 100000, rate_percent: 3 },
  { from_amount: 500000, rate_percent: 4 },
  { from_amount: 1000000, rate_percent: 7.5 },
];

/** In force from the start of the financial year the register lives in. */
const IN_FORCE_FROM = '2026-04-01';

test.use({ storageState: GODMODE_STATE });
test.describe.configure({ mode: 'serial' });

/** Open the Commission tab of Manav, in the org this spec is allowed to write to. */
async function openCommission(page: Page) {
  await useOrg(page, ORG_ID, /E2E/i);
  await page.goto('/manav');
  await settle(page);

  const tab = page.getByRole('tab', { name: /commission/i });
  await expect(tab, 'Manav has no Commission tab').toBeVisible({ timeout: 20_000 });
  await tab.click();
  await settle(page);

  // The tab's own sentence, so a silent render failure is not read as an empty
  // register. The intro states the marginal rule the whole model turns on.
  await expect(page.getByText(/Each rate pays on\s+its own slice/i)).toBeVisible();
}

test.describe('Phase 6.1 · the commission model gets its first rows in E2E', () => {
  test('a person on the register is put on the owner\'s ladder, through the screen',
    async ({ page }) => {
      await openCommission(page);

      // ── FIND SOMEBODY WITH NOTHING RECORDED ────────────────────────────────
      //
      // Opening a person is how a user checks — the roster deliberately does
      // NOT survey 83 people on tab open, because each answer costs an audit
      // row. Walking a few rows is the same thing a person does, and it makes
      // the spec re-runnable: on a second run the first few people already hold
      // an arrangement and it moves on rather than failing.
      const rows = page.locator('table tbody tr');
      await expect.poll(async () => await rows.count(), {
        message: 'the commission register never listed anybody',
        timeout: 30_000,
      }).toBeGreaterThan(0);

      const total = await rows.count();
      let name = '';
      let already = false;
      for (let i = 0; i < Math.min(total, 8); i++) {
        await rows.nth(i).getByRole('button', { name: 'Open' }).click();
        await settle(page);
        const title = page.locator('.k-detail__title');
        await expect(title).toBeVisible({ timeout: 15_000 });
        name = (await title.innerText()).trim();

        // WAIT FOR THE ANSWER, NOT FOR THE PANEL. The person's arrangements are
        // fetched after the header paints and render a skeleton meanwhile, so
        // reading straight after the title appears sees neither the Empty nor a
        // card — and "no Empty" would then be taken as "already has one" and
        // silently skip every person on the register. That is exactly how a
        // spec comes to report a seeded org as unseedable.
        const empty = page.getByText(/No commission arrangement recorded for/i);
        const cards = page.locator('.mn-sch');
        await expect.poll(
          async () => (await empty.count()) + (await cards.count()),
          {
            message: `the arrangements for ${name} never resolved to an answer`,
            timeout: 20_000,
          },
        ).toBeGreaterThan(0);

        // The zero this test exists to move. The Empty says it in the product's
        // own words — "there is simply no arrangement on file" — which is the
        // distinction the whole module was rebuilt around: nothing recorded is
        // not the same as recorded as nothing.
        if (await empty.count()) break;

        // ALREADY DONE, ON A SECOND RUN. The seeded person is at the top of the
        // register, so a re-run meets them first — and writing a second
        // arrangement for somebody else every time this spec runs would pile up
        // pay agreements in a live database as the price of re-running a test.
        // Recognising the ladder and verifying it is the correct answer here.
        if (await cards.locator('li.mn-lad__r').count() === OWNERS_LADDER.length) {
          already = true;
          break;
        }

        await page.getByRole('button', { name: /Back to the register/i }).click();
        await settle(page);
        name = '';
      }
      expect(name, 'the first eight people all hold an arrangement that is not the ' +
        'owner\'s ladder — the register may have been seeded some other way')
        .not.toBe('');

      // ── THE FORM ───────────────────────────────────────────────────────────
      //
      // Skipped entirely when the ladder is already on file. Everything below
      // the write still runs, so a re-run proves the screen renders the
      // arrangement — it just does not create a second one.
      if (!already) {
      await page.getByRole('button', { name: /\+ Record an arrangement/ }).first().click();
      await expect(page.getByText(/Record a commission arrangement/i)).toBeVisible();

      const form = page.locator('form.k-formpanel');

      // Person is fixed and DISABLED when the form is opened from a person's
      // page — assert that rather than choosing again, because a spec that
      // re-picks here could seed somebody other than the one it just proved
      // empty.
      const person = form.locator('label', { hasText: 'Person' }).locator('select');
      await expect(person).toBeDisabled();

      await setDate(form, 'In force from', IN_FORCE_FROM);
      // "Until" is left empty on purpose: the arrangement is still in force,
      // and the field is the first day it no longer applies, not the last day
      // it does.

      await form.getByText(/This person is on commission/i).click();

      await pickOption(form.locator('label', { hasText: 'Measured on' }).locator('select'),
        'basis', 'Turnover');
      await pickOption(form.locator('label', { hasText: 'Settles' }).locator('select'),
        'period', 'Every month');
      await pickOption(form.locator('label', { hasText: 'Whose revenue' }).locator('select'),
        'revenue scope', 'Their own revenue');

      // ── THE LADDER, TYPED OUT OF ORDER ─────────────────────────────────────
      const rungs = form.locator('li.mn-lad__ed');
      for (let i = 0; i < ENTRY_ORDER.length; i++) {
        if (i > 0) await form.getByRole('button', { name: /\+ Add a rate/ }).click();
        const rung = rungs.nth(i);
        await rung.locator('label', { hasText: 'From (₹)' }).locator('input')
          .fill(ENTRY_ORDER[i].from);
        await rung.locator('label', { hasText: 'Rate (%)' }).locator('input')
          .fill(ENTRY_ORDER[i].rate);
      }

      // The editor sorts for the preview even though the rows were typed
      // 7.5 / 3 / 4 — the derived upper edge is the whole point of there being
      // no second box, so it is asserted before the write rather than after.
      const preview = form.locator('.mn-lad__prev');
      await expect(preview).toContainText(/3% on/);
      await expect(preview).toContainText(/7\.5% above/);
      await expect(preview, 'the editor does not say that the lowest slice pays nothing')
        .toContainText(/nothing is due/i);

      await form.locator('textarea').fill(
        `Seeded ${RUN} for Phase 6.1 — the owner's ladder of 2026-08-21.`);

      // ── WRITE, AND READ WHAT THE SERVER STORED ─────────────────────────────
      const saved = await submitting(page, '/commission-schemes', async () => {
        await form.getByRole('button', { name: /Record arrangement/ }).click();
      });

      expect(saved.eligible, 'the scheme came back not on commission').toBe(true);
      expect(saved.basis).toBe('turnover');
      expect(saved.period).toBe('monthly');
      expect(saved.revenue_scope).toBe('own');
      expect(saved.effective_to, 'a still-in-force arrangement came back closed').toBeFalsy();

      // TYPED 7.5 / 3 / 4, STORED 3 / 4 / 7.5. `Scheme.__post_init__` sorts and
      // de-duplicates once, so what is stored is what was validated and the
      // payout cannot depend on which row was read first.
      const bands = (saved.bands || []).map((b: any) => ({
        from_amount: Number(b.from_amount), rate_percent: Number(b.rate_percent),
      }));
      expect(bands, 'the stored ladder is not the owner\'s, or is not in floor order')
        .toEqual(OWNERS_LADDER);
      }

      // ── AND IT IS ON THE SCREEN THE PERSON WOULD LOOK AT ───────────────────
      //
      // Recording returns to the PERSON, not to the register: `openFor` is
      // still set, so the panel that re-renders is the one the write was
      // started from. That is the right behaviour, and it is what makes this
      // assertion worth making — the ladder has to be legible on the screen
      // the write came from, not merely stored. `tick` is what forces the
      // re-read; without it this panel would show the state from before the
      // write, on the one screen that exists to show it.
      await settle(page);
      await expect(page.locator('.k-detail__title')).toHaveText(name);
      await expect(page.getByRole('heading', { name: /In force now/i })).toBeVisible();
      const card = page.locator('.mn-sch').first();
      await expect(card).toContainText('on commission');
      await expect(card).toContainText(/still in force/);
      await expect(card).toContainText(/Turnover/);

      const shown = card.locator('li.mn-lad__r');
      await expect(shown).toHaveCount(3);
      await expect(shown.nth(0)).toContainText('3%');
      await expect(shown.nth(1)).toContainText('4%');
      await expect(shown.nth(2)).toContainText('7.5%');
      // The top rung has no upper edge, and the screen has to say so in words
      // rather than leave a blank a reader fills in themselves.
      await expect(shown.nth(2)).toContainText(/everything above/i);

      await shot(page, `commission-seeded-${RUN}`);
    });

  test('the org now holds an arrangement, and the API agrees with the screen',
    async ({ page }) => {
      await openCommission(page);

      // Read it back from the server, in the org the SESSION is in. There is no
      // org-wide list route — a commission ladder is read per person, because
      // Manav is self-scoped and a bare list would hand one employee another
      // employee's rate — so this walks the register the same way the tab's own
      // "Check who is on commission" button does.
      const staff = await api(page, 'get', '/api/v1/manav/employees?limit=200');
      expect(staff.status(), `the employee register did not load: ${await staff.text()}`)
        .toBeLessThan(400);
      const people = ((await staff.json()).data ?? []) as Array<{ id: string; name: string }>;
      expect(people.length, 'E2E has nobody on the register').toBeGreaterThan(0);

      let found = 0;
      let ladder: Array<{ from_amount: number; rate_percent: number }> = [];
      for (const p of people.slice(0, 12)) {
        const r = await api(page, 'get', `/api/v1/manav/employees/${p.id}/commission-schemes`);
        if (r.status() >= 400) continue;
        const list = ((await r.json()).data ?? []) as any[];
        for (const s of list) {
          found++;
          if ((s.bands || []).length === OWNERS_LADDER.length && !ladder.length) {
            ladder = s.bands.map((b: any) => ({
              from_amount: Number(b.from_amount), rate_percent: Number(b.rate_percent),
            }));
          }
        }
      }

      expect(found, 'no commission arrangement is readable in E2E Test & Associates — ' +
        'the seeding test above did not leave a row').toBeGreaterThan(0);
      expect(ladder, 'the seeded arrangement does not read back as the owner\'s ladder')
        .toEqual(OWNERS_LADDER);
    });
});
