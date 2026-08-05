/**
 * The extensive full-product E2E: invite → accept → onboarding → RBAC → every
 * module — with every piece of data entered AS A REAL USER through the
 * product's own forms. No SQL.
 *
 * Side-effect rules: invited emails go to AWS's SES simulator
 * (success+…@simulator.amazonses.com — accepts and discards, no bounce),
 * nothing WhatsApp-shaped is sent, no AI generation runs, no danger-zone
 * actions. Everything stays inside the E2E test org.
 *
 * ── NO `test.skip` ON A MISSING AFFORDANCE ──────────────────────────────────
 * `_helpers.ts` opens with that rule and names this file as where it was
 * learned. It carried nine `test.skip(!thing, 'no affordance')` calls, each
 * turning "the product has no way to do this" into a green tick. All nine were
 * examined against the deployed app on 5 Aug 2026:
 *
 *  · Five guarded controls that ship today, some of which the selectors had
 *    never actually found — the e-sign one opened the create form only by
 *    accident, through a `:has-text("New")` fallback, and then created nothing.
 *    They assert now, and fail by name when the control is gone.
 *  · One waited for an invite token believed to live only in an email. It does
 *    not: the invite's own create response returns `invite_link` to its
 *    creator, so the browser that sent the invitation is already holding the
 *    token. The accept journey therefore ran, for the first time — AND IT
 *    FAILS. `POST /auth/accept-invite` 500s for everybody; the step that now
 *    fails carries the traceback and what it leaves half-written. Three tests
 *    had been skipping past a dead onboarding path.
 *  · Two guarded a SUBJECT the run had not created — a pending approval, an
 *    unpaid invoice. A journey that needs a subject now makes one, or names
 *    what the org is missing and fails.
 *  · One is a genuine dependency on the step before it, and is the only skip
 *    left. It says which step, and it reads THIS run's artefact rather than
 *    whatever an earlier run left on disk.
 *
 * That last point is not hypothetical. The RBAC check used to gate on
 * `fs.existsSync` of a fixed path in the temp directory, and on 5 Aug it passed
 * against a session file written on 3 Aug — whose token belonged to the ORG
 * OWNER, not to any member. A green tick on the sentence "the plain member
 * cannot reach admin", produced without a member.
 *
 * WHAT A RUN COSTS: one invitation, and — for as long as accept-invite half
 * lands — one new org_member row for an account nobody can sign into from the
 * link. `max_users` on this org is NULL (unlimited), so it cannot wedge the
 * suite, but the member list grows by one per run and wants pruning. One task
 * is also raised and approved.
 */
import { test, expect, Page, BrowserContext } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { OWNER_STATE, DL_DIR } from './real.config';
import { submitting, pickOption, openTab } from './_helpers';

const API = process.env.E2E_API_URL || 'https://kartavya-staging.up.railway.app';
const RUN = Date.now() % 1000000;
// AWS SES simulator: accepts and discards, never bounces, reaches no human.
// A fresh address per run is not decoration — the members screen adds an
// EXISTING account straight to the org and only invites an unknown one, so a
// reused address stops producing an invite after its first run.
const INVITE_EMAIL = `success+e2e${RUN}@simulator.amazonses.com`;
const MEMBER_PASSWORD = process.env.E2E_MEMBER_PASSWORD || `E2e-member-${RUN}!x`;
// The e-sign document is created and never sent, so this address receives
// nothing; it is the simulator anyway, in case a later step ever does send.
const SIGNER_EMAIL = `success+e2esign${RUN}@simulator.amazonses.com`;
const TEAM = process.env.E2E_TEAM_ID || '';


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

/**
 * Click the first visible candidate, and FAIL naming what is missing.
 *
 * This used to return a boolean for the caller to shrug at, and every shrug
 * was a skip. A list of candidates is still right where a label has several
 * plausible spellings; tolerating an empty list never was.
 */
async function mustClick(page: Page, selectors: string[], what: string) {
  for (const sel of selectors) {
    const loc = page.locator(sel).first();
    if (await loc.count() && await loc.isVisible().catch(() => false)) {
      await loc.click();
      return;
    }
  }
  expect(null, `${what} — none of: ${selectors.join(' | ')}`).toBeTruthy();
}

/**
 * The one place a missing control is genuinely not a finding: walking an
 * onboarding wizard whose length the test cannot know. Running out of "Next"
 * is how the walk ENDS, not how it fails.
 */
async function clickOptional(page: Page, selectors: string[]): Promise<boolean> {
  for (const sel of selectors) {
    const loc = page.locator(sel).first();
    if (await loc.count() && await loc.isVisible().catch(() => false)) {
      await loc.click();
      return true;
    }
  }
  return false;
}

let inviteToken = '';
/**
 * Set by the accept journey, and only by it: the path holding THIS run's
 * member session.
 *
 * Deliberately not a fixed filename tested with `fs.existsSync`. That file
 * outlives the run that wrote it, so the RBAC check below read a two-day-old
 * session and passed — and that session belonged to the org owner.
 */
let memberState = '';

// ─────────────────────────────────────────────── invite → accept → onboarding
test.describe.serial('invite, accept, onboarding', () => {
  test.use({ storageState: OWNER_STATE });

  test('owner invites a member through the UI', async ({ page }) => {
    // The member/invite surface is /settings/roles (navConfig: "Roles & access").
    // Navigated by URL: sidebar section headers intercept clicks on their items.
    await page.goto('/settings/roles');
    await settle(page);
    await shot(page, 'roles-access');

    const box = page.locator('#add-email');
    await expect(box, 'an invite email field exists on Roles & access').toBeVisible({ timeout: 15_000 });
    await box.fill(INVITE_EMAIL);
    // Addressed by id, and org_member chosen explicitly. `select` + `.first()`
    // is one DOM change away from being somebody's row control on a screen
    // whose whole job is roles — and the RBAC step below only means anything if
    // this person arrives as the LEAST privileged thing the form can make.
    await page.locator('#add-role').selectOption('org_member');

    // "Add or invite" posts to `/org/members` first and, per its own comment,
    // falls back to `POST /v1/org/invites` on a 404. That fallback is dead code
    // against this backend: `add_member` stopped answering 404 for an unknown
    // address — "adding somebody who has no account IS an invitation" — and
    // issues the invite itself, 200, through the same `issue_invite` path. So
    // BOTH are armed, and whichever answers is the one that made the invitation.
    const inPath = (r: any, name: string) =>
      new RegExp(`/org/${name}$`).test(new URL(r.url()).pathname) && r.request().method() === 'POST';
    const viaMembers = page.waitForResponse(r => inPath(r, 'members'), { timeout: 30_000 })
      .catch(() => null);
    const viaInvites = page.waitForResponse(r => inPath(r, 'invites'), { timeout: 30_000 })
      .catch(() => null);
    await page.getByRole('button', { name: 'Add or invite' }).click();
    const first = await viaMembers;
    const created = first && first.status() === 200 ? first : await viaInvites;
    expect(created,
      `inviting ${INVITE_EMAIL} produced no successful POST to /org/members or ` +
      `/v1/org/invites (members answered ${first ? first.status() : 'nothing'})`).toBeTruthy();
    expect(created!.status(),
      `${created!.url()} → ${created!.status()}: ${await created!.text()}`).toBe(200);
    await settle(page);
    await shot(page, 'invite-sent');

    // THE TOKEN. It was previously hunted for in the invites LIST, which has no
    // column to leak one from — deliberately, and `org_invites.py` says why: a
    // listing that carried tokens was "a page of live credentials". The same
    // docstring says where it does live: "returned exactly once, to its
    // creator". That is this response, which the owner's own browser just
    // received. Nothing here is out of band.
    //
    // Two things about that response the SCREEN gets wrong, reported rather
    // than asserted, because neither is this suite's claim to make: it drops
    // `invite_link`, so an owner whose invitation email bounces has no way to
    // copy the link the server handed them; and it toasts "added as org member"
    // off a reply whose own `status` field says "invited" and whose `message`
    // says they join only when they accept.
    const body = await created!.json();
    const link = body?.invite_link || '';
    inviteToken = link ? (new URL(link).searchParams.get('token') || '') : '';
    expect(inviteToken,
      `the invite response carried no usable link (status=${body?.status}, ` +
      `invite_link=${JSON.stringify(link)})`).toBeTruthy();

    // The invite row itself is the assertion that the UI flow worked: it shows
    // up in the "Invited" list on the page.
    await expect(page.locator('text=/Invited · \\d+/').first()).toBeVisible({ timeout: 15_000 });
  });

  test('the invitee accepts and lands in the product', async ({ browser }) => {
    const ctx: BrowserContext = await browser.newContext();
    const page = await ctx.newPage();
    // A request that never gets a readable answer produces no `response` event
    // at all, so without this the failure reads "the button sent nothing" —
    // which is wrong, and sent the first investigation looking at the form.
    let netFailure = '';
    page.on('requestfailed', r => {
      if (r.url().includes('/auth/accept-invite')) netFailure = r.failure()?.errorText || 'request failed';
    });
    await page.goto(`/accept-invite?token=${inviteToken}`);
    await settle(page);
    await shot(page, 'accept-invite');

    // The page previews the invitation before drawing a form for it, so a dead
    // token renders a screen with no fields at all. Asserting the field exists
    // therefore also asserts the token was live.
    const name = page.locator('#inv-name');
    await expect(name,
      'the invite link drew no account form — the token was refused by the preview')
      .toBeVisible({ timeout: 15_000 });
    await name.fill('E2E Invited Member');
    await page.locator('#inv-password').fill(MEMBER_PASSWORD);
    await page.locator('#inv-confirm').fill(MEMBER_PASSWORD);

    /**
     * WHAT THIS STEP FOUND, 5 Aug 2026, on its first run in this file's life.
     *
     * `POST /api/auth/accept-invite` 500s, every time, for everybody. The
     * traceback in the staging deploy log ends at `auth_router.accept_invite`
     * on the project_assignments sync:
     *
     *   asyncpg.exceptions.AmbiguousParameterError:
     *     inconsistent types deduced for parameter $1
     *
     * `$1` is the new user_id twice over — inserted into
     * `project_assignments.user_id` (character varying) and compared against
     * `team_members.user_id` (text) in the same statement — so Postgres deduces
     * two types for one parameter and refuses to plan it. The identical defect
     * is documented at length over in `_approve_task_mark_done`, where the fix
     * was `$1::text` on BOTH uses.
     *
     * It reaches the browser as a CORS error, which is why it can hide: the 500
     * is raised past `CORSMiddleware`, so the error response carries no
     * Access-Control-Allow-Origin, the browser refuses to expose it, and the
     * page shows "Could not reach the server". Nothing on the screen or in the
     * network panel says "500".
     *
     * And it half-lands. Every statement before it is already committed on its
     * own connection: the account exists, the org role is granted, the invite
     * is consumed. So the person who clicked the link has an account they were
     * never signed in to, no project assignment — the row the comment there
     * says they need "so the user can create/view tasks" — and a screen telling
     * them the server is down. The link, pressed again, says "already
     * activated. Please sign in."
     *
     * This is a FAILURE and stays one until it is fixed. Nine skips are how it
     * went unseen; a tenth would be no better.
     */
    const accept = page.waitForResponse(
      r => r.url().includes('/auth/accept-invite') && r.request().method() === 'POST',
      { timeout: 45_000 },
    ).catch(() => null);
    await page.getByRole('button', { name: /Accept & create account/i }).click();
    const res = await accept;
    expect(res,
      'POST /auth/accept-invite produced no response the browser could read' +
      (netFailure ? ` — the request failed with ${netFailure}` : '') +
      '. Nobody can accept an invitation.').toBeTruthy();
    expect(res!.status(),
      `POST /auth/accept-invite → ${res!.status()}: ${await res!.text()}`).toBe(200);
    await settle(page);

    // Onboarding wizard, walked as far as it goes; every step is either
    // completed or skipped through its own controls. Running out of controls is
    // the end of the wizard, which is why this is the file's one tolerant click.
    for (let step = 0; step < 8; step++) {
      if (!/onboarding/.test(page.url())) break;
      const advanced = await clickOptional(page,
        ['button:has-text("Continue")', 'button:has-text("Next")', '.ob__next',
         'button:has-text("Skip")', 'button:has-text("Finish")', 'button:has-text("Done")']);
      if (!advanced) break;
      await settle(page);
    }
    await shot(page, 'invitee-landed');

    const authed = await page.evaluate(() => !!localStorage.getItem('auth_token'));
    expect(authed, 'invitee holds a session').toBeTruthy();
    // Run-scoped filename. A shared one is an artefact the next run inherits.
    memberState = path.join(DL_DIR, `member-state-${RUN}.json`);
    await ctx.storageState({ path: memberState });
    await ctx.close();
  });

  test('RBAC: the plain member cannot reach admin, and write controls are gated', async ({ browser }) => {
    // The file's only skip, and it names its cause: this needs the session the
    // step above creates. In a serial block a FAILED accept already stops this
    // test, so the sole way to arrive here without one is to have run this test
    // on its own — which is a thing to say, not a thing to pass.
    test.skip(!memberState,
      'the accept journey did not run in this process, so there is no member session — run the whole file');

    const ctx = await browser.newContext({ storageState: memberState });
    const page = await ctx.newPage();

    // A signed-out browser cannot prove anything about RBAC — every gated
    // surface refuses it. The old assertion accepted the sign-in screen as
    // evidence, so an expired session read as a passing access check.
    await page.goto('/dashboard');
    await settle(page);
    const authed = await page.evaluate(() => !!localStorage.getItem('auth_token'));
    expect(authed, 'the member session is gone; nothing below would mean anything').toBeTruthy();

    await page.goto('/admin');
    await settle(page);
    // AdminShell renders `[data-testid="admin-shell"]` for a platform operator
    // and sends everybody else to /dashboard, so both halves are checkable.
    await expect(page,
      'the member was bounced to sign-in rather than refused — the session died mid-test')
      .not.toHaveURL(/\/login/);
    await expect(page.locator('[data-testid="admin-shell"]'),
      'the Aekam platform console rendered for a plain org member').toHaveCount(0);
    await expect(page, 'the member is still sitting on /admin').not.toHaveURL(/\/admin/);
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
    await mustClick(page,
      ['button:has-text("Create Client")', 'button:has-text("Save Client")',
       'button:has-text("Create")', 'button:has-text("Save")'],
      'the client form offers nothing to save with');
    await expect(page.locator(`text=${clientName}`).first()).toBeVisible({ timeout: 20_000 });
    await shot(page, 'graha-client');
  });

  test('Graha: creates a contact through the form', async ({ page }) => {
    await page.goto('/graha');
    await settle(page);
    // Seventeen tabs, so "contacts" may be inline or behind "More +N" depending
    // on the viewport; `openTab` tries both and fails naming the tab.
    await openTab(page, /contacts/i);
    // Was `test.skip(!opened, 'contact create affordance not found')`. The
    // control is `+ Add Contact` and it is on the tab panel — a create button
    // that has gone missing is the finding, not a reason to stop looking.
    await page.getByRole('tabpanel').getByRole('button', { name: '+ Add Contact' }).click();
    await settle(page);

    const contactName = `Realuser Contact ${RUN}`;
    await page.getByRole('textbox', { name: /^name/i }).first().fill(contactName);
    await page.getByRole('textbox', { name: /^email/i }).first().fill(`realuser${RUN}@example.com`);
    await page.getByRole('textbox', { name: /phone/i }).first().fill('+91 9876500000');
    // The write response, not the screen: this journey's claim is that a user
    // can CREATE a contact, and only the server can confirm that.
    const made = await submitting(page, '/graha/contacts',
      () => page.getByRole('button', { name: /^create contact$/i }).click());
    expect(made?.id || made?.contact?.id, 'the contact was not created').toBeTruthy();
    await expect(page.locator(`text=${contactName}`).first()).toBeVisible({ timeout: 20_000 });
    await shot(page, 'graha-contact');
  });

  test('Ganit: records a payment on an unpaid invoice', async ({ page }) => {
    // Was `test.skip(!unpaid, 'no unpaid invoice available')` over a scan of the
    // whole ledger. The screen has the same filter the API does, so the subject
    // is chosen the way a person chooses it — and an org with nothing owing to
    // it is a seed that cannot support a receivables journey, which is worth
    // saying out loud rather than passing quietly.
    await page.goto('/ganit');
    await settle(page);
    await page.locator('.gn-bar').getByLabel('Status').selectOption('unpaid');
    await settle(page);
    const rows = page.locator('.gn-tbl__row');
    await expect(rows.first(),
      'the E2E org has no unpaid invoice, so "Record payment" has nothing to act on')
      .toBeVisible({ timeout: 20_000 });

    const number = (await rows.first().locator('.gn-tbl__id').innerText()).trim();
    const listed = await (await api(page, 'get', '/api/v1/ganit/invoices?payment_status=unpaid')).json();
    const row = (listed.data ?? listed).find((r: any) => r.invoice_number === number);
    expect(row,
      `the screen lists ${number} under the unpaid filter but the API's unpaid list does not`)
      .toBeTruthy();

    // Half the balance, so the arithmetic below is exact and the invoice stays
    // partly paid rather than tipping into "paid" and changing what the next
    // journey can find.
    const before = Number(row.balance_due);
    const amount = Math.max(1, Math.round(before / 2));

    await rows.first().click();
    await page.getByRole('button', { name: 'Record payment' }).click();
    const payForm = page.locator('form.gn-form--accent');
    await expect(payForm, 'the drawer offers no payment form').toBeVisible();
    await payForm.getByLabel(/^Amount/).fill(String(amount));
    await payForm.getByLabel(/^Reference/).fill(`E2E-UTR-${RUN}`);
    await submitting(page, '/payments',
      () => payForm.getByRole('button', { name: 'Record', exact: true }).click());
    await settle(page);

    const { invoice } = await (await api(page, 'get', `/api/v1/ganit/invoices/${row.id}`)).json();
    expect(Number(invoice.balance_due), 'the payment did not reduce the balance')
      .toBeCloseTo(Math.max(before - amount, 0), 2);
    await shot(page, 'ganit-payment');
  });

  test('Ganit: an unpaid invoice offers Edit, whatever its doc_status', async ({ page }) => {
    // The dead end this pins: `doc_status` DEFAULTS to 'final', Edit used to
    // require 'draft', so the control was hidden from every invoice the product
    // creates by default — while the PDF refusal told the reader to use it.
    // Owner's rule: any unpaid invoice can be amended and resent.
    //
    // The old subject-picker could not test that. `GET /invoices` does not
    // SELECT `doc_status`, so `r.doc_status !== 'draft'` was `undefined !==
    // 'draft'` — true for every row — and the test could just as well have
    // landed on a draft, where Edit is not in question. The status is on the
    // detail, so the detail is what decides.
    await page.goto('/ganit');
    await settle(page);
    const listed = await (await api(page, 'get', '/api/v1/ganit/invoices?payment_status=unpaid')).json();
    const unpaid: any[] = listed.data ?? listed;
    expect(unpaid.length,
      'the E2E org has no unpaid invoice, so the amend-an-unpaid-invoice rule cannot be checked')
      .toBeGreaterThan(0);

    let subject: any = null;
    for (const candidate of unpaid.slice(0, 8)) {
      const { invoice } = await (await api(page, 'get', `/api/v1/ganit/invoices/${candidate.id}`)).json();
      if (invoice?.doc_status && invoice.doc_status !== 'draft') { subject = invoice; break; }
    }
    expect(subject,
      'none of the first eight unpaid invoices is anything but a draft, so the rule ' +
      'this test exists for — a FINAL unpaid invoice is still editable — has no subject')
      .toBeTruthy();

    await page.locator('.gn-bar').getByLabel('Status').selectOption('unpaid');
    await settle(page);
    await page.locator('.gn-tbl__row', { hasText: subject.invoice_number }).first().click();
    await expect(page.getByRole('button', { name: /^edit$/i }).first(),
      `invoice ${subject.invoice_number} is unpaid and doc_status=${subject.doc_status}, ` +
      'and the drawer offers no Edit')
      .toBeVisible({ timeout: 15_000 });
    await shot(page, 'invoice-edit-available');
  });

  test('Sanvaad: creates a channel and posts in it', async ({ page }) => {
    await page.goto('/sanvaad');
    await settle(page);
    await page.getByRole('button', { name: /^new channel$/i }).click();
    const chName = `e2e-realuser-${RUN}`;
    const nameBox = page.getByRole('textbox').filter({ hasNot: page.locator('[type="checkbox"]') }).first();
    await expect(nameBox).toBeVisible({ timeout: 10_000 });
    await nameBox.fill(chName);
    await mustClick(page,
      ['button:has-text("Create channel")', 'button:has-text("Create")', 'button[type="submit"]'],
      'the new-channel form offers nothing to save with');
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
    await openTab(page, /orders/i);
    // Was `test.skip(!opened, 'order create affordance not found')` over a list
    // of guessed spellings. The button is "+ New order" and it is on the tab
    // panel; the module header carries a second one, which is why this is
    // scoped rather than global.
    await page.getByRole('tabpanel').getByRole('button', { name: '+ New order' }).click();
    const f = page.locator('form.vk-form');
    await expect(f, 'the order form did not open').toBeVisible({ timeout: 15_000 });

    // Every cell by aria-label, never by position: counting `input[type=number]`
    // once put a rate into the GST box and produced a plausible-looking ₹1 line.
    await pickOption(f.getByLabel('Customer'), 'customer');
    await f.getByLabel('Order date').fill(new Date().toISOString().slice(0, 10));
    await f.getByLabel('Line 1 description').fill(`Realuser order line ${RUN}`);
    await f.getByLabel('Line 1 HSN code').fill('998311');
    await f.getByLabel('Line 1 quantity').fill('3');
    await f.getByLabel('Line 1 rate').fill('2500');

    const made = await submitting(page, '/vikray/orders',
      () => f.getByRole('button', { name: 'Create order' }).click());
    expect(made?.id || made?.order?.id, 'the order was not created').toBeTruthy();
    await shot(page, 'vikray-order');
  });

  test('Approvals: raises a request on its own task and decides it with a note', async ({ page }) => {
    // Was `test.skip(!(await approve.count()), 'no pending approval visible')` —
    // a queue that happens to be empty read as a pass, and a queue that happened
    // NOT to be empty was decided with somebody else's work. It also decided
    // nothing: pressing Approve on a task-level row opens a dialog, and the old
    // test screenshotted the dialog and passed.
    //
    // A journey that needs a subject makes one. `public.tasks` is the SHARED
    // table — the one production uses, scoped by team, not by org — so this is
    // pinned to the E2E team the way `corepm.spec.ts` pins every write.
    expect(TEAM,
      'E2E_TEAM_ID is not set — this journey writes to the SHARED tasks table and ' +
      'must be scoped to the test team').toBeTruthy();

    const title = `Realuser approval subject ${RUN}`;
    await page.goto('/tasks');
    await settle(page);
    await page.getByRole('button', { name: 'New task' }).first().click();
    const titleBox = page.getByLabel('Task title');
    await expect(titleBox, 'the new-task modal has no title field').toBeVisible({ timeout: 15_000 });
    await titleBox.fill(title);
    // Not optional: `request_approval` refuses a task with no team outright —
    // "Cannot request approval for personal tasks".
    await page.locator('select[aria-labelledby="ntm-lbl-project"]').selectOption(TEAM);
    const dialog = page.locator('[role="dialog"], .k-modal').filter({ hasText: /task/i }).first();
    const made = await submitting(page, /\/tasks$/,
      () => dialog.getByRole('button', { name: /^(Create|Add|Save)/ }).last().click());
    const taskId = made?.task_id || made?.id || made?.task?.task_id;
    expect(taskId, 'the task was not created').toBeTruthy();

    // Find it as a person would, through the list's own search.
    await page.reload();
    await settle(page);
    await page.getByPlaceholder('Search…').fill(title);
    const row = page.locator('.k-trow', { hasText: title }).first();
    await expect(row, 'the task just created is not in the list').toBeVisible({ timeout: 15_000 });
    await row.click();

    const approval = page.locator('.dr__ap');
    await expect(approval,
      'the drawer of a task WITH a project offers no approval section at all')
      .toBeVisible({ timeout: 15_000 });
    await approval.getByRole('button', { name: 'Send for approval' }).click();
    await approval.getByRole('textbox', { name: 'Notes for the approver' })
      .fill(`Raised by the E2E journey ${RUN}`);
    await submitting(page, '/request-approval',
      () => approval.getByRole('button', { name: 'Send for approval' }).click());
    await settle(page);

    // Decide it. A task-level request lands under "Work approvals", which is
    // not the tab the page opens on — the default is "Task requests", and a
    // test that never switched would have found an empty queue and called it
    // "no pending approval visible".
    await page.goto('/approvals');
    await settle(page);
    await page.getByRole('tab', { name: /Work approvals/ }).click();
    const queued = page.locator('.apv-row', { hasText: title }).first();
    await expect(queued,
      'the request raised a moment ago is not in the work-approvals queue')
      .toBeVisible({ timeout: 20_000 });
    await queued.getByRole('button', { name: 'Approve' }).click();

    const modal = page.getByTestId('approve-modal');
    await expect(modal, 'Approve opened no dialog, so nothing could be decided').toBeVisible();
    const note = `Approved by the E2E journey ${RUN}`;
    await modal.locator('#apv-approve-note').fill(note);
    await submitting(page, '/review',
      () => modal.getByRole('button', { name: /^Approve &/ }).click());
    await settle(page);

    // The decision, read back from the record rather than from the screen that
    // made it. Approving is the half that used to 500 — `approved_by` and
    // `completed_by_user_id` are different column types and one parameter fed
    // both — so "the button was pressed" has never been the same claim as
    // "the task was approved".
    const task = await (await api(page, 'get', `/api/tasks/${taskId}`)).json();
    expect(task.approval_status, 'the approval was confirmed but the task is not approved')
      .toBe('approved');
    expect(task.approval_notes, 'the approver\'s note was not kept').toBe(note);
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
      const started = await clickOptional(page, ['button:has-text("Start")', 'button:has-text("Start timer")']);
      if (started) {
        await page.waitForTimeout(1500);
        await clickOptional(page, ['button:has-text("Stop")']);
      }
    }
    await shot(page, 'time-entry');
  });

  test('E-sign: creates a document draft with a real file upload', async ({ page }) => {
    // The journey the whole "a skip is not a pass" rule was learned on: this
    // reported green for weeks while the module 403'd for the org. It was still
    // hollow after that. `[role="tab"]:has-text("Create")` never matched — the
    // tab is called "New document" — so the form was reached only by the
    // `:has-text("New")` fallback further down the list, the title and signer
    // fields were filled only `if (await …count())`, and the submit failed
    // validation silently. "No crash" was the whole assertion.
    const pdf = path.join(DL_DIR, 'e2e-esign.pdf');
    fs.writeFileSync(pdf, Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]>>endobj\nxref\n0 4\ntrailer<</Size 4/Root 1 0 R>>\n%%EOF'));

    await page.goto('/esign');
    await settle(page);
    await page.getByRole('tab', { name: 'New document' }).click();
    await settle(page);

    const title = `Realuser engagement letter ${RUN}`;
    await page.getByLabel(/^Title/i).fill(title);
    await page.locator('input[type="file"]').first().setInputFiles(pdf);
    // Both signer fields, because the form refuses to submit without them and
    // a refused submit is what the old version could not tell from a success.
    await page.getByLabel(/Signer 1 name/i).fill('E2E Signer');
    await page.getByLabel(/Signer 1 email/i).fill(SIGNER_EMAIL);

    // Two requests: create the document, then attach the PDF to it. Waiting for
    // the create alone reads the row while the upload is still in flight, and
    // `file_key = 'pending'` then looks like a lost file.
    const [createRes, uploadRes] = await Promise.all([
      page.waitForResponse(r => /\/esign\/documents$/.test(new URL(r.url()).pathname)
        && r.request().method() === 'POST', { timeout: 45_000 }),
      page.waitForResponse(r => r.url().includes('/upload')
        && r.request().method() === 'POST', { timeout: 45_000 }),
      page.getByRole('button', { name: 'Create document' }).click(),
    ]);
    expect(createRes.status(), `the document was not created: ${await createRes.text()}`).toBe(200);
    expect(uploadRes.status(), `the PDF did not upload: ${await uploadRes.text()}`).toBe(200);
    const docId = (await createRes.json())?.id;
    expect(docId, 'the create call returned no document').toBeTruthy();

    // A draft, and deliberately left one — sending is a separate press, and
    // this journey has no business emailing anybody.
    const back = await (await api(page, 'get', `/api/v1/esign/documents/${docId}`)).json();
    expect(back.document?.title, 'the created document has the wrong title').toBe(title);
    expect(back.document?.file_key, 'the uploaded PDF was not attached').not.toBe('pending');
    await shot(page, 'esign-draft');
  });

  test('Customize: switches theme as a user and it sticks', async ({ page }) => {
    await page.goto('/settings/customize');
    await settle(page);
    // Was `test.skip(!(await dark.count()), 'no theme control found …')`. It is
    // a radiogroup labelled "Theme mode" holding Light/Dark/System — addressed
    // by role so a second "Dark" elsewhere on the tab (the sidebar background
    // cards use the same word) cannot answer for it.
    const mode = page.getByRole('radiogroup', { name: 'Theme mode' });
    await expect(mode, 'the Appearance tab offers no theme mode control').toBeVisible({ timeout: 15_000 });
    await mode.getByRole('radio', { name: 'Dark' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark', { timeout: 10_000 });
    await shot(page, 'dark-theme');
    // Put it back, and check it went back: the preference is the owner's, and a
    // journey that leaves the account in dark mode has changed the product for
    // the next person to open it.
    await mode.getByRole('radio', { name: 'Light' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light', { timeout: 10_000 });
  });
});
