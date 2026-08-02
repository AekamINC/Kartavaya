/**
 * Authoring a data-first skill, in a real browser.
 *
 * The unit tests prove the dispatcher resolves its handlers and that the
 * context layer degrades honestly. Neither can tell you that the person
 * building a skill can actually reach any of it — and until this work, they
 * could not: `StepEditor` offered `agent_type`, `platform` and
 * `prompt_template` and nothing else, so the only way to author a step that
 * reads the org's own records was to write the row by hand.
 *
 * ── The regression this exists to catch ─────────────────────────────────────
 *
 * `CreateTab` computed its valid steps as `form.steps.filter(s =>
 * s.prompt_template.trim())`. A data step has no `prompt_template` at all, so
 * the first render after switching a step to Data threw
 * `Cannot read properties of undefined (reading 'trim')` and took the whole tab
 * down. That is a white screen, not a bad message, and no amount of backend
 * testing sees it. `assertRendered` below is the assertion that matters most in
 * this file; everything else is detail.
 *
 * ── Why stubbed responses answer the question honestly ──────────────────────
 *
 * Every decision under test is made on the client from data the server hands
 * over: which step kinds exist, which functions may be chosen, which of them
 * write, and what the payload looks like on submit. `/skills/capabilities` is
 * the contract between the two, and stubbing it is how this file pins the
 * SHAPE the editor depends on — if the endpoint's shape changes, these fail.
 *
 * What it does NOT prove: that the server accepts the payload. That is
 * `test_skill_dispatch_and_context.py` and the validator in `create_skill_template`,
 * which reject an unknown function, an unconfirmed write and an unknown context
 * source. Neither half covers the other.
 */
import { test, expect, Page } from '@playwright/test';

const CLIENT_ID = '11111111-1111-1111-1111-111111111111';
const SKILLS_PATH = `/hub/clients/${CLIENT_ID}/skills`;

/** Shaped exactly as `describe_skill_functions()` builds it. */
const CAPABILITIES = {
  skill_functions: [
    { name: 'aggregate_kpis', available: true, kind: 'read', writes: false, needs: [], defaults: { period: '30d' } },
    { name: 'find_overdue_invoices', available: true, kind: 'read', writes: false, needs: [], defaults: {} },
    { name: 'get_team_workload', available: true, kind: 'read', writes: false, needs: ['team_id'], defaults: {} },
    { name: 'score_deals', available: true, kind: 'detect', writes: false, needs: [], defaults: {} },
    { name: 'generate_due_invoices', available: true, kind: 'act', writes: true, needs: [], defaults: {} },
  ],
  context_sources: [
    { key: 'receivables', label: 'Overdue customer invoices', kind: 'simple' },
    { key: 'kpis', label: 'Business KPIs', kind: 'simple' },
    { key: 'knowledge', label: 'From your documents', kind: 'rich' },
  ],
  unimplemented: ['vetana_trigger_payroll'],
};

const EMPTY = { data: [], total: 0, limit: 0, truncated: false };

/** The user `canManage` admits — an org admin. See `HubSkillsPage`. */
const USER = {
  user_id: 'user_e2e',
  name: 'E2E Admin',
  email: 'e2e@example.com',
  role: 'admin',
  org_role: 'admin',
  platform_roles: ['platform_admin'],
};

async function stubApi(page: Page, opts: { capabilities?: unknown } = {}) {
  await page.route('**/api/**', route => {
    const url = route.request().url();
    const json = (body: unknown) => route.fulfill({
      status: 200, contentType: 'application/json', body: JSON.stringify(body),
    });

    // `Protected.jsx` overwrites localStorage with whatever /auth/me returns
    // before anything renders, so a blanket stub here erases the role and the
    // Create tab renders its "needs an admin grant" notice instead of the form.
    if (url.includes('/auth/me')) return json(USER);

    if (url.includes('/skills/capabilities')) {
      if (opts.capabilities === null) {
        return route.fulfill({
          status: 500, contentType: 'application/json',
          body: JSON.stringify({ detail: 'capabilities are down' }),
        });
      }
      return json(opts.capabilities ?? CAPABILITIES);
    }

    if (url.includes('/hub/org/credits')) {
      return json({ org_balance: { balance: 100, plan_credits: 1000, used: 0 }, credit_costs: { email: 2, social_media: 2, blog: 5 } });
    }
    if (url.match(/\/hub\/clients\/[^/]+$/)) return json({ client: { id: CLIENT_ID, name: 'Acme Ltd' } });

    return json(EMPTY);
  });
}

async function signIn(page: Page) {
  await page.addInitScript(user => {
    localStorage.setItem('Kartavaya_user', JSON.stringify(user));
    localStorage.setItem('auth_token', 'e2e-stub-token');
  }, USER);
}

/** Did the page render, or did a boundary catch a throw? */
async function assertRendered(page: Page, where: string) {
  const body = (await page.locator('body').innerText()).trim();
  expect(body.length, `${where}: rendered an empty page`).toBeGreaterThan(0);
  for (const boom of ['Something went wrong', 'is not defined', 'Cannot read properties']) {
    expect(body, `${where}: ${boom}`).not.toContain(boom);
  }
}

async function openCreateTab(page: Page) {
  await page.goto(SKILLS_PATH);
  await page.locator('#mt-tab-create').waitFor({ state: 'visible' });
  await page.locator('#mt-tab-create').click();
  await page.locator('.sk-steps').waitFor({ state: 'visible' });
}

test.describe('Skill packs · authoring a data step', () => {
  test('a step can be switched to Data without taking the tab down', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));

    await stubApi(page);
    await signIn(page);
    await openCreateTab(page);

    // The editor offers both kinds. Before this work there was only one.
    const step = page.locator('.sk-step').first();
    await expect(step.getByRole('button', { name: 'AI step' })).toBeVisible();
    await expect(step.getByRole('button', { name: 'Data step' })).toBeVisible();

    await step.getByRole('button', { name: 'Data step' }).click();

    // The exact crash: `prompt_template.trim()` on a step that has no prompt.
    await assertRendered(page, 'after switching to a data step');
    expect(errors, 'switching to a data step threw').toEqual([]);

    // And the data controls replaced the AI ones rather than joining them.
    await expect(step.getByLabel(/What to read/)).toBeVisible();
    await expect(step.getByLabel('Prompt template')).toHaveCount(0);
  });

  test('the function list is grouped and comes from the server', async ({ page }) => {
    await stubApi(page);
    await signIn(page);
    await openCreateTab(page);

    const step = page.locator('.sk-step').first();
    await step.getByRole('button', { name: 'Data step' }).click();
    const select = step.getByLabel(/What to read/);

    // Grouped read / detect / act, so "this one writes" is visible before it is
    // chosen rather than only after.
    await expect(select.locator('optgroup[label="Read your data"]')).toHaveCount(1);
    await expect(select.locator('optgroup[label="Score and detect"]')).toHaveCount(1);
    await expect(select.locator('optgroup[label="Take action (writes data)"]')).toHaveCount(1);

    // Names are the registry's, rendered with underscores as spaces.
    await expect(select.locator('option', { hasText: 'aggregate kpis' })).toHaveCount(1);
  });

  test('a write function demands an explicit confirmation', async ({ page }) => {
    await stubApi(page);
    await signIn(page);
    await openCreateTab(page);

    const step = page.locator('.sk-step').first();
    await step.getByRole('button', { name: 'Data step' }).click();

    // A read function asks for nothing extra.
    await step.getByLabel(/What to read/).selectOption('aggregate_kpis');
    await expect(step.locator('.sk-check')).toHaveCount(0);

    // A write one does. `generate_due_invoices` reaches money.
    await step.getByLabel(/What to read/).selectOption('generate_due_invoices');
    const confirm = step.locator('.sk-check input[type="checkbox"]');
    await expect(confirm).toBeVisible();
    await expect(confirm).not.toBeChecked();
    await expect(step.locator('.sk-check')).toContainText('changes data');
  });

  test('a function with required params asks for them while you are looking', async ({ page }) => {
    await stubApi(page);
    await signIn(page);
    await openCreateTab(page);

    const step = page.locator('.sk-step').first();
    await step.getByRole('button', { name: 'Data step' }).click();

    await step.getByLabel(/What to read/).selectOption('aggregate_kpis');
    await expect(step.getByLabel('team id')).toHaveCount(0);

    // `get_team_workload(pool, team_id)` — no default, so the run would fail
    // with a message nobody reads until the run.
    await step.getByLabel(/What to read/).selectOption('get_team_workload');
    await expect(step.getByLabel('team id')).toBeVisible();
  });

  test('an AI step can be grounded in the org\'s own data', async ({ page }) => {
    await stubApi(page);
    await signIn(page);
    await openCreateTab(page);

    const step = page.locator('.sk-step').first();
    const chip = step.getByRole('button', { name: 'Overdue customer invoices' });

    await expect(chip).toBeVisible();
    await expect(chip).toHaveAttribute('aria-pressed', 'false');
    await chip.click();
    await expect(chip).toHaveAttribute('aria-pressed', 'true');

    // Grounding belongs to AI steps: a data step IS the data.
    await step.getByRole('button', { name: 'Data step' }).click();
    await expect(step.getByRole('button', { name: 'Overdue customer invoices' })).toHaveCount(0);
  });

  test('the submitted template carries the data step and the context', async ({ page }) => {
    await stubApi(page);
    await signIn(page);
    await openCreateTab(page);

    let posted: any = null;
    await page.route('**/skills/templates', route => {
      if (route.request().method() !== 'POST') return route.fallback();
      posted = JSON.parse(route.request().postData() || '{}');
      return route.fulfill({
        status: 200, contentType: 'application/json', body: JSON.stringify({ id: 'new' }),
      });
    });

    await page.getByLabel(/Template name/).fill('Monday Morning Brief');

    // Step 1 reads. Step 2 writes the summary, grounded in the same source.
    const first = page.locator('.sk-step').first();
    await first.getByRole('button', { name: 'Data step' }).click();
    await first.getByLabel(/What to read/).selectOption('find_overdue_invoices');

    await page.getByRole('button', { name: 'Add a step' }).click();
    const second = page.locator('.sk-step').nth(1);
    await second.getByLabel('Prompt template').fill('Write the brief from the figures above.');
    await second.getByRole('button', { name: 'Overdue customer invoices' }).click();

    await page.getByRole('button', { name: 'Create template' }).click();
    await expect.poll(() => posted, { message: 'no POST was made' }).not.toBeNull();

    expect(posted.steps).toHaveLength(2);
    // The data step survived the `valid` filter that used to drop it.
    expect(posted.steps[0].skill_function).toBe('find_overdue_invoices');
    expect(posted.steps[0].prompt_template).toBeUndefined();
    expect(posted.steps[1].agent_type).toBeTruthy();
    expect(posted.steps[1].context).toEqual(['receivables']);
  });

  test('the editor still works when capabilities cannot be loaded', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));

    await stubApi(page, { capabilities: null });
    await signIn(page);
    await openCreateTab(page);

    // Says what is missing rather than rendering an empty picker, and AI steps
    // — which need nothing from that endpoint — keep working.
    await expect(page.locator('.note--warn')).toContainText('did not load');
    await expect(page.locator('.sk-step').first().getByLabel('Prompt template')).toBeVisible();

    await assertRendered(page, 'with capabilities unavailable');
    expect(errors).toEqual([]);
  });
});
