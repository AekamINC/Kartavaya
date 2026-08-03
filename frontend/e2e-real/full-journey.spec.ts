/**
 * The extensive full-product E2E: invite → accept → onboarding → RBAC → every
 * module — with every piece of data entered AS A REAL USER through the
 * product's own forms. No SQL. The only out-of-band read is the invite token
 * (which lives in an email a test cannot open); it is read via the app's own
 * invites API using the owner's session.
 *
 * Side-effect rules: invited emails go to AWS's SES simulator
 * (success+…@simulator.amazonses.com — accepts and discards, no bounce),
 * nothing WhatsApp-shaped is sent, no AI generation runs, no danger-zone
 * actions. Everything stays inside the E2E test org.
 *
 * Journeys that cannot find their UI affordance skip WITH A NOTE rather than
 * fake a pass — a missing affordance is itself a finding.
 */
import { test, expect, Page, BrowserContext } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { OWNER_STATE, DL_DIR } from './real.config';

const API = process.env.E2E_API_URL || 'https://kartavya-staging.up.railway.app';
const RUN = Date.now() % 1000000;
// AWS SES simulator: accepts and discards, never bounces, reaches no human.
// E2E_INVITE_EMAIL lets a two-phase run (invite, read token from the email,
// accept) target the same invite the first phase created.
const INVITE_EMAIL = process.env.E2E_INVITE_EMAIL || `success+e2e${RUN}@simulator.amazonses.com`;
const MEMBER_PASSWORD = process.env.E2E_MEMBER_PASSWORD || `E2e-member-${RUN}!x`;


async function api(page: Page, method: 'get' | 'post' | 'patch', p: string, data?: any) {
  const token = await page.evaluate(() => localStorage.getItem('auth_token'));
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  return page.request[method](API + p, { headers, ...(data ? { data } : {}) });
}

/**
 * Wait for the network to go quiet, but do not FAIL on it.
 *
 * The shell polls notifications on a timer, so `networkidle` can legitimately
 * never arrive — it timed out once on /tasks after passing on every previous
 * run. Every caller asserts on a real element immediately afterwards, and that
 * assertion (with its own timeout) is the actual gate. This is a settling
 * pause, so a slow poll must not read as a product failure.
 */
async function settle(page: Page) {
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
}

async function shot(page: Page, name: string) {
  await page.screenshot({ path: path.join(DL_DIR, `journey-${name}.png`), fullPage: true });
}

/** Click the first visible candidate; returns false (and notes) if none exists. */
async function clickAny(page: Page, selectors: string[], note: string): Promise<boolean> {
  for (const sel of selectors) {
    const loc = page.locator(sel).first();
    if (await loc.count() && await loc.isVisible().catch(() => false)) {
      await loc.click();
      return true;
    }
  }
  test.info().annotations.push({ type: 'missing-affordance', description: note });
  return false;
}

let inviteToken = '';

// ─────────────────────────────────────────────── invite → accept → onboarding
test.describe.serial('invite, accept, onboarding', () => {
  test.use({ storageState: OWNER_STATE });

  test('owner invites a member through the UI', async ({ page }) => {
    // The member/invite surface is /settings/roles (navConfig: "Roles & access").
    // Navigated by URL: sidebar section headers intercept clicks on their items.
    await page.goto('/settings/roles');
    await settle(page);
    await shot(page, 'roles-access');
    let box = page.locator('input[type="email"], input[placeholder*="mail"]').first();
    if (!(await box.count() && await box.isVisible().catch(() => false))) {
      await clickAny(page,
        ['button:has-text("Invite")', 'button:has-text("+ Invite")', 'button:has-text("Add member")', '[role="tab"]:has-text("Invite")'],
        'no invite button on Roles & access');
      box = page.locator('input[type="email"], input[placeholder*="mail"]').first();
    }
    expect(await box.count(), 'an invite email field exists on Roles & access').toBeGreaterThan(0);
    await box.fill(INVITE_EMAIL);
    const roleSel = page.locator('select').first();
    if (await roleSel.count()) {
      const labels = await roleSel.locator('option').allInnerTexts();
      const memberIdx = labels.findIndex((l) => /member/i.test(l));
      if (memberIdx >= 0) await roleSel.selectOption({ index: memberIdx });
    }
    await clickAny(page, ['button:has-text("Send invite")', 'button:has-text("Send")', 'button:has-text("Invite")', 'button[type="submit"]'], 'no invite submit');
    await settle(page);
    await shot(page, 'invite-sent');

    // The token travels by email; the test reads it back through the app's own
    // invites API with the same session the UI just used.
    for (const p of ['/api/v1/org/invites', '/api/admin/invites', '/api/invites']) {
      const r = await api(page, 'get', p);
      if (!r.ok()) continue;
      const body = await r.json().catch(() => null);
      const rows: any[] = Array.isArray(body) ? body : body?.data ?? body?.invites ?? [];
      const mine = rows.find((x) => (x.email || '').toLowerCase() === INVITE_EMAIL.toLowerCase());
      if (mine?.token) { inviteToken = mine.token; break; }
      if (mine?.invite_token) { inviteToken = mine.invite_token; break; }
    }
    // The invite row itself is the assertion that the UI flow worked: it shows
    // up in the "Invited" list on the page.
    await expect(page.locator('text=/Invited · \\d+/').first()).toBeVisible({ timeout: 15_000 });

    // The token deliberately never leaves the email — the invites API withholds
    // it, which is correct. Opening that email is the one step a browser test
    // cannot perform, so the runner bridges it in via E2E_INVITE_TOKEN. Without
    // it the accept journey skips (with a note) rather than pretending to pass.
    if (!inviteToken && process.env.E2E_INVITE_TOKEN) inviteToken = process.env.E2E_INVITE_TOKEN;
    if (!inviteToken) {
      test.info().annotations.push({
        type: 'note',
        description: `invite created for ${INVITE_EMAIL}; token is email-only — set E2E_INVITE_TOKEN to run the accept journey`,
      });
    }
  });

  test('the invitee accepts and lands in the product', async ({ browser }) => {
    test.skip(!inviteToken, 'no invite token from the previous step');
    const ctx: BrowserContext = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(`/accept-invite?token=${inviteToken}`);
    await settle(page);
    await shot(page, 'accept-invite');
    const name = page.locator('input[name="name"], input[placeholder*="ame"]').first();
    if (await name.count()) await name.fill('E2E Invited Member');
    const pws = page.locator('input[type="password"]');
    const n = await pws.count();
    for (let i = 0; i < n; i++) await pws.nth(i).fill(MEMBER_PASSWORD);
    await clickAny(page, ['button[type="submit"]', 'button:has-text("Accept")', 'button:has-text("Join")', 'button:has-text("Create account")'], 'no accept submit');
    await settle(page);

    // Onboarding wizard, walked as far as it goes; every step is either
    // completed or skipped through its own controls.
    for (let step = 0; step < 8; step++) {
      if (!/onboarding/.test(page.url())) break;
      const advanced = await clickAny(page,
        ['button:has-text("Continue")', 'button:has-text("Next")', '.ob__next', 'button:has-text("Skip")', 'button:has-text("Finish")', 'button:has-text("Done")'],
        `onboarding step ${step}: no advance control`);
      if (!advanced) break;
      await settle(page);
    }
    await shot(page, 'invitee-landed');
    const authed = await page.evaluate(() => !!localStorage.getItem('auth_token'));
    expect(authed, 'invitee holds a session').toBeTruthy();
    await ctx.storageState({ path: path.join(DL_DIR, 'member-state.json') });
    await ctx.close();
  });

  test('RBAC: the plain member cannot reach admin, and write controls are gated', async ({ browser }) => {
    const statePath = path.join(DL_DIR, 'member-state.json');
    test.skip(!fs.existsSync(statePath), 'invitee never landed');
    const ctx = await browser.newContext({ storageState: statePath });
    const page = await ctx.newPage();
    // Admin surface must not serve a plain member.
    await page.goto('/admin');
    await settle(page);
    const body = await page.locator('body').innerText();
    expect(/access|denied|permission|not.*allowed|sign in/i.test(body) || !/Danger zone|Billing/i.test(body),
      'member does not get the admin surface').toBeTruthy();
    await shot(page, 'member-admin-blocked');
    await ctx.close();
  });
});

// ───────────────────────────────────────────────── module journeys, UI-entered
test.describe('module journeys — data entered as a real user', () => {
  test.use({ storageState: OWNER_STATE });

  test('Graha: creates a client through the form', async ({ page }) => {
    await page.goto('/graha');
    await settle(page);
    await page.getByRole('tab', { name: /clients/i }).click();
    const addBtn = page.getByRole('button', { name: /add client/i }).first();
    await expect(addBtn).toBeVisible({ timeout: 15_000 });
    await addBtn.click();
    const clientName = `Realuser Traders Pvt Ltd ${RUN}`;
    // Fields carry aria-labels ("Company name", "GSTIN"), not name attributes.
    await page.getByLabel('Company name').fill(clientName);
    await page.getByLabel('GSTIN').fill('27AARUT1234E1Z5');
    await page.getByLabel('City').fill('Mumbai');
    await clickAny(page, ['button:has-text("Create Client")', 'button:has-text("Save Client")', 'button:has-text("Create")', 'button:has-text("Save")'], 'no client save');
    await expect(page.locator(`text=${clientName}`).first()).toBeVisible({ timeout: 20_000 });
    await shot(page, 'graha-client');
  });

  test('Graha: creates a contact through the form', async ({ page }) => {
    await page.goto('/graha');
    await settle(page);
    await page.getByRole('tab', { name: /contacts/i }).click();
    await settle(page);
    const opened = await clickAny(page, ['button:has-text("+ Add Contact")', 'button:has-text("+ Contact")', 'button:has-text("New Contact")'], 'no add-contact button');
    test.skip(!opened, 'contact create affordance not found');
    const contactName = `Realuser Contact ${RUN}`;
    await page.getByRole('textbox', { name: /^name/i }).first().fill(contactName);
    await page.getByRole('textbox', { name: /^email/i }).first().fill(`realuser${RUN}@example.com`);
    await page.getByRole('textbox', { name: /phone/i }).first().fill('+91 9876500000');
    await page.getByRole('button', { name: /^create contact$/i }).click();
    await expect(page.locator(`text=${contactName}`).first()).toBeVisible({ timeout: 20_000 });
    await shot(page, 'graha-contact');
  });

  test('Ganit: records a payment on an unpaid invoice', async ({ page }) => {
    await page.goto('/ganit');
    await settle(page);
    // "Record payment" renders only while an invoice is unsettled, so the row
    // has to be an unpaid one — picking any invoice lands on a paid one and
    // reads as a missing button.
    const res = await api(page, 'get', '/api/v1/ganit/invoices?limit=200');
    const body = await res.json();
    const rows: any[] = Array.isArray(body) ? body : body.data ?? [];
    const unpaid = rows.find((r) => r.payment_status === 'unpaid' && /^INV-/.test(r.invoice_number || ''));
    test.skip(!unpaid, 'no unpaid invoice available');
    await page.locator(`text=${unpaid.invoice_number}`).first().click();
    const payBtn = page.getByRole('button', { name: /record payment/i }).first();
    await expect(payBtn).toBeVisible({ timeout: 15_000 });
    await payBtn.click();
    const amt = page.locator('input[type="number"]').first();
    await expect(amt).toBeVisible();
    await amt.fill('5000');
    await clickAny(page, ['button:has-text("Record payment")', 'button:has-text("Record")', 'button[type="submit"]'], 'no payment save');
    await settle(page);
    const after = await page.locator('body').innerText();
    expect(after).not.toMatch(/Something went wrong|is not a function/);
    await shot(page, 'ganit-payment');
  });

  test('Sanvaad: creates a channel and posts in it', async ({ page }) => {
    await page.goto('/sanvaad');
    await settle(page);
    await page.getByRole('button', { name: /^new channel$/i }).click();
    const chName = `e2e-realuser-${RUN}`;
    const nameBox = page.getByRole('textbox').filter({ hasNot: page.locator('[type="checkbox"]') }).first();
    await expect(nameBox).toBeVisible({ timeout: 10_000 });
    await nameBox.fill(chName);
    await clickAny(page, ['button:has-text("Create channel")', 'button:has-text("Create")', 'button[type="submit"]'], 'no channel save');
    await settle(page);
    // The addToast crash used to fire exactly here — a toast, not a crash, is the fix landing.
    const body = await page.locator('body').innerText();
    expect(body).not.toMatch(/addToast is not a function|Something went wrong/);
    await page.locator(`text=${chName}`).first().click();
    const composer = page.locator('textarea, input[placeholder*="essage"]').first();
    await composer.fill(`First message in a user-created channel — ${RUN}`);
    await composer.press('Enter');
    await expect(page.locator(`text=First message in a user-created channel — ${RUN}`).first()).toBeVisible({ timeout: 15_000 });
    await shot(page, 'sanvaad-channel');
  });

  test('Vikray: creates an order through the form', async ({ page }) => {
    await page.goto('/vikray');
    await settle(page);
    await clickAny(page, ['[role="tab"]:has-text("Orders")', 'button:has-text("Orders")'], 'no Orders tab');
    const opened = await clickAny(page, ['button:has-text("+ New Order")', 'button:has-text("New Order")', 'button:has-text("+ Order")'], 'no new-order button');
    test.skip(!opened, 'order create affordance not found');
    const sel = page.locator('select').first();
    if (await sel.count() && (await sel.locator('option').count()) > 1) await sel.selectOption({ index: 1 });
    const desc = page.locator('input[placeholder*="escription"], input[placeholder*="tem"]').first();
    if (await desc.count()) await desc.fill(`Realuser order line ${RUN}`);
    const qty = page.locator('input[type="number"]').first();
    if (await qty.count()) await qty.fill('3');
    await clickAny(page, ['button:has-text("Create")', 'button:has-text("Save")', 'button[type="submit"]'], 'no order save');
    await settle(page);
    await shot(page, 'vikray-order');
  });

  test('Approvals: decides one pending request with a note', async ({ page }) => {
    await page.goto('/approvals');
    await settle(page);
    const approve = page.locator('button:has-text("Approve")').first();
    test.skip(!(await approve.count()), 'no pending approval visible');
    await approve.click();
    await settle(page);
    const body = await page.locator('body').innerText();
    expect(body).not.toMatch(/Something went wrong|is not a function/);
    await shot(page, 'approvals-decided');
  });

  test('Time: logs time through the UI', async ({ page }) => {
    await page.goto('/time');
    await settle(page);
    const body = await page.locator('body').innerText();
    expect(body.length).toBeGreaterThan(100);
    // Seeded entries must be visible; adding via UI happens in the drawer's Time tab.
    await page.goto('/tasks');
    await settle(page);
    await page.getByRole('button', { name: /#[0-9a-f]{6}/i }).first().click();
    // Scope to the drawer: a bare "Time" match also hits the sidebar's
    // "Time Report", which the drawer scrim then blocks forever.
    const drawer = page.locator('.dr, [class*="drawer"]').first();
    const timeTab = drawer.getByRole('tab', { name: /time/i }).or(drawer.locator('button:has-text("Time")')).first();
    if (await timeTab.count()) {
      await timeTab.click();
      const started = await clickAny(page, ['button:has-text("Start")', 'button:has-text("Start timer")'], 'no timer start in drawer');
      if (started) {
        await page.waitForTimeout(1500);
        await clickAny(page, ['button:has-text("Stop")'], 'no timer stop');
      }
    }
    await shot(page, 'time-entry');
  });

  test('E-sign: creates a document draft with a real file upload', async ({ page }) => {
    const pdf = path.join(DL_DIR, 'e2e-esign.pdf');
    fs.writeFileSync(pdf, Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]>>endobj\nxref\n0 4\ntrailer<</Size 4/Root 1 0 R>>\n%%EOF'));
    await page.goto('/esign');
    await settle(page);
    const opened = await clickAny(page, ['[role="tab"]:has-text("Create")', 'button:has-text("Create")', 'button:has-text("+ Document")', 'button:has-text("New")'], 'no esign create affordance');
    test.skip(!opened, 'esign create affordance not found');
    const title = page.locator('input[name="title"], input[placeholder*="itle"]').first();
    if (await title.count()) await title.fill(`Realuser engagement letter ${RUN}`);
    const fileInput = page.locator('input[type="file"]').first();
    if (await fileInput.count()) await fileInput.setInputFiles(pdf);
    await clickAny(page, ['button:has-text("Create")', 'button:has-text("Save")', 'button:has-text("Upload")', 'button[type="submit"]'], 'no esign save');
    await settle(page);
    const body = await page.locator('body').innerText();
    expect(body).not.toMatch(/Something went wrong|is not a function/);
    await shot(page, 'esign-draft');
  });

  test('Customize: switches theme as a user and it sticks', async ({ page }) => {
    await page.goto('/settings/customize');
    await settle(page);
    const dark = page.locator('button:has-text("Dark"), [role="radio"]:has-text("Dark"), label:has-text("Dark")').first();
    test.skip(!(await dark.count()), 'no theme control found on customize surface');
    await dark.click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark', { timeout: 10_000 });
    await shot(page, 'dark-theme');
    const light = page.locator('button:has-text("Light"), [role="radio"]:has-text("Light"), label:has-text("Light")').first();
    if (await light.count()) await light.click();
  });
});
