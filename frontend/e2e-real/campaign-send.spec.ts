/**
 * Phase 10 — Prachar actually SENDS. To real inboxes, on the owner's instruction.
 *
 * ── Why this file is separate from reach.spec.ts ────────────────────────────
 * `reach.spec.ts` puts `POST /prachar/campaigns/{id}/send` on a forbidden list
 * and proves the module only as far as a draft. That was the right default: the
 * E2E org holds 225 fixture contacts and a send would have posted 225 messages
 * to @example.com, which is 225 hard bounces against the sending domain's
 * reputation. Nothing about that tests the product; it only damages the sender.
 *
 * The owner then asked for a real send to addresses they own. So this file
 * exists, it is the ONLY file allowed to call the send endpoint, and it earns
 * that by making the blast radius exactly three inboxes.
 *
 * ── How the blast radius is made three ──────────────────────────────────────
 * The campaign form has no audience control. `audience_filter` is hard-coded to
 * `{}` in CampaignsTab.jsx, and `_resolve_audience` reads that as "every active
 * contact in the org with an email address". A campaign created the way a user
 * creates one therefore targets EVERYONE. That is a product finding in its own
 * right, and it is also the constraint this test has to work inside.
 *
 * The send path does honour unsubscribes, so all 225 fixture addresses were
 * suppressed in `prachar_unsubscribes` before this file was written. That is
 * not a trick to make a test pass — it is the correct permanent state for a
 * test org, and it means no future send from this org can ever reach a fixture
 * address either. The three addresses below are added AFTER that suppression,
 * so they are the only eligible recipients.
 *
 * The first test asserts that invariant and fails the file if it does not hold.
 *
 * ── The three addresses ─────────────────────────────────────────────────────
 * Gmail's `+tag` aliases, all owned by the person who asked for this test, all
 * landing in one inbox they can check. No other real address is reachable from
 * this org.
 */
import { test, expect, Page } from '@playwright/test';
import { OWNER_STATE } from './real.config';
import { api, apiOk, settle, openTab, shot, submitting, RUN } from './_helpers';

test.use({ storageState: OWNER_STATE });
test.describe.configure({ mode: 'serial' });

/**
 * The owner's own inbox, three ways. Nothing else in this org is deliverable.
 *
 * These addresses are STABLE across runs, not suffixed with the run id. A
 * unique address per run would leave a new deliverable contact behind every
 * time, and by the third run the campaign would be mailing nine addresses
 * while the test still asserted three. The audience is a fixture, so it is
 * created once and reused — the contact step below is idempotent.
 */
const BASE = 'kevalvshah03';
const RECIPIENTS = [
  { tag: 'prachar1', name: 'Prachar Send Test One' },
  { tag: 'prachar2', name: 'Prachar Send Test Two' },
  { tag: 'prachar3', name: 'Prachar Send Test Three' },
].map((r) => ({ ...r, email: `${BASE}+${r.tag}@gmail.com` }));

const CAMPAIGN = `Live Send Test ${RUN}`;
const SUBJECT = `Kartavaya campaign test ${RUN} — please confirm receipt`;

let campaignId = '';

test.beforeEach(async ({ page }) => {
  await page.goto('/today');
  await settle(page);
});


// ══ THE GUARD — this file does not run unless the org is safe to send from ═══

test('every pre-existing contact in this org is unmailable', async ({ page }) => {
  const r = await apiOk(page, 'get', '/api/v1/graha/contacts?limit=500');
  const contacts = (r.data ?? r) as any[];
  expect(contacts.length, 'the contacts endpoint returned nothing').toBeGreaterThan(0);

  const unsub = await apiOk(page, 'get', '/api/v1/prachar/unsubscribes?limit=1000');
  const suppressed = new Set(
    ((unsub.data ?? unsub) as any[]).map((u: any) => String(u.email || '').toLowerCase()));

  // Deliverable = has an address, is not RFC-2606 reserved, is not suppressed,
  // and is not one of the owner's own `+tag` aliases. The alias pattern is
  // matched rather than the three literals, so a stray address left behind by
  // an earlier draft of this file is still recognised as the owner's own and
  // not reported as somebody else's inbox.
  const exposed = contacts
    .map((c: any) => String(c.email || '').toLowerCase())
    .filter((e: string) => e
      && !/@example\.(com|org|net)$/.test(e)
      && !/simulator\.amazonses\.com$/.test(e)
      && !suppressed.has(e)
      && !new RegExp(`^${BASE}\\+[a-z0-9]*@gmail\\.com$`).test(e));

  expect(exposed,
    'these addresses would receive the test campaign and do not belong to the ' +
    'person who asked for it — suppress them before sending anything').toEqual([]);
});


// ══ THE AUDIENCE — created the way a user creates it ═════════════════════════

test('three contacts are added through the CRM form', async ({ page }) => {
  await page.goto('/graha');
  await settle(page);
  await openTab(page, 'contacts');

  const already = new Set(
    (((await apiOk(page, 'get', '/api/v1/graha/contacts?limit=500')).data ?? []) as any[])
      .map((c: any) => String(c.email || '').toLowerCase()));

  for (const r of RECIPIENTS) {
    if (already.has(r.email.toLowerCase())) continue;   // fixture already there
    await page.getByRole('button', { name: '+ Add Contact' }).first().click();
    const f = page.locator('form.gr__panel').first();
    await expect(f, 'the new-contact form did not open').toBeVisible();

    await f.getByLabel('Name *').fill(r.name);
    await f.getByLabel('Email').fill(r.email);
    // `getByLabel('Company')` is ambiguous — the form has both "Company" and
    // "Client / Company", and the second is a <select>. Ask for the textbox.
    await f.getByRole('textbox', { name: 'Company', exact: true })
      .fill('Aekam Inc (owner test inbox)');

    const made = await submitting(page, '/graha/contacts',
      () => f.getByRole('button', { name: 'Create Contact' }).click());
    expect(made, `the contact for ${r.email} was not created`).toBeTruthy();
    await settle(page);
  }

  const list = await apiOk(page, 'get', '/api/v1/graha/contacts?limit=500');
  const emails = new Set(((list.data ?? list) as any[])
    .map((c: any) => String(c.email || '').toLowerCase()));
  for (const r of RECIPIENTS) {
    expect(emails.has(r.email.toLowerCase()),
      `${r.email} is not in the CRM after the form said it saved`).toBe(true);
  }
  await shot(page, `send-contacts-${RUN}`);
});


// ══ THE CAMPAIGN ═════════════════════════════════════════════════════════════

test('a campaign is written in the product\'s own form', async ({ page }) => {
  await page.goto('/prachar');
  await settle(page);
  await openTab(page, 'campaigns');

  await page.getByRole('button', { name: /\+ Schedule/ }).first().click();
  await settle(page);

  const f = page.locator('.k-formpanel').first();
  await expect(f, 'the campaign form did not open').toBeVisible();
  await f.getByLabel('Campaign name').fill(CAMPAIGN);
  await f.getByLabel('Subject line').first().fill(SUBJECT);
  await f.getByLabel('Body').fill(
    `<p>This is a live delivery test of the Kartavaya marketing module.</p>` +
    `<p>Run ${RUN}. Sent to {{email}} for {{name}}.</p>` +
    `<p>If this arrived, Prachar can send.</p>`);

  // "Send at" stays empty — this campaign is sent by hand, in the next test,
  // so the send is an act and not a timer.
  const made = await submitting(page, '/prachar/campaigns',
    () => f.getByRole('button', { name: 'Create campaign' }).first().click());
  campaignId = made?.id || made?.campaign?.id;
  expect(campaignId, 'the campaign was not created').toBeTruthy();

  const list = await apiOk(page, 'get', '/api/v1/prachar/campaigns?limit=200');
  const mine = ((list.data ?? list) as any[]).find((c: any) => String(c.id) === String(campaignId));
  expect(String(mine.status).toLowerCase(),
    'a new campaign is not a draft').toBe('draft');
});

test('the audience preview resolves to exactly the three owner addresses',
  async ({ page }) => {
    // This is the assertion that makes the send safe, so it runs BEFORE the
    // send and the send does not happen if it fails. `count` is the number the
    // confirm dialog will quote to the user, so it is also the number the
    // product itself believes it is about to mail.
    const aud = await apiOk(page, 'get',
      `/api/v1/prachar/campaigns/${campaignId}/audience`);
    expect(Number(aud.count), 'the audience preview resolved nobody at all')
      .toBeGreaterThan(0);

    // `aud.contacts` is only the first 50 rows by name — `preview_audience`
    // slices, and the three fixtures sort past that. So eligibility is computed
    // from the FULL contact list, which is what `_resolve_audience` reads, and
    // the preview is used only to prove the endpoint answers.
    const all = await apiOk(page, 'get', '/api/v1/graha/contacts?limit=500');
    const unsub = await apiOk(page, 'get', '/api/v1/prachar/unsubscribes?limit=1000');
    const suppressed = new Set(
      ((unsub.data ?? unsub) as any[]).map((u: any) => String(u.email || '').toLowerCase()));

    const eligible = ((all.data ?? all) as any[])
      .filter((c: any) => c.is_active !== false)
      .map((c: any) => String(c.email || '').toLowerCase())
      .filter((e: string) => e && !suppressed.has(e));

    expect(new Set(eligible),
      'the eligible audience is not exactly the three owner-owned addresses')
      .toEqual(new Set(RECIPIENTS.map((r) => r.email.toLowerCase())));
  });


// ══ THE SEND ═════════════════════════════════════════════════════════════════

test('Send now delivers to all three and the campaign closes as sent',
  async ({ page }) => {
    await page.goto('/prachar');
    await settle(page);
    await openTab(page, 'campaigns');

    // Playwright DISMISSES dialogs by default, so without this handler the
    // confirm() returns false and "Send now" silently does nothing — the test
    // would then fail on a timeout and read like a broken button.
    page.on('dialog', (d) => d.accept());

    await page.getByText(CAMPAIGN).first().click();
    await settle(page);

    const send = page.getByRole('button', { name: /Send now/ }).first();
    await expect(send, 'the campaign detail offers no Send now button').toBeVisible();

    const posted = await submitting(page, `/campaigns/${campaignId}/send`,
      () => send.click());
    expect(posted, 'the send endpoint returned nothing').toBeTruthy();
    expect(Number(posted.recipients ?? posted.total_recipients ?? 0),
      `the product thought it was mailing ${posted.recipients} people, not 3`).toBe(3);

    // Dispatch is a background task, so the row is 'sending' when the API
    // answers and 'sent' once every address has been handed to the provider.
    let status = '';
    for (let i = 0; i < 30 && status !== 'sent'; i++) {
      await page.waitForTimeout(2000);
      const list = await apiOk(page, 'get', '/api/v1/prachar/campaigns?limit=200');
      const row = ((list.data ?? list) as any[])
        .find((c: any) => String(c.id) === String(campaignId));
      status = String(row?.status || '').toLowerCase();
    }
    expect(status, 'the campaign never left "sending" — the dispatcher stalled')
      .toBe('sent');

    await page.reload();
    await settle(page);
    await shot(page, `send-result-${RUN}`);
  });
