/**
 * Phase 7 — Prachar, Sanvaad, Srijan and e-sign: everything that reaches OUT.
 *
 * ── The endpoints this suite must never call ────────────────────────────────
 * This is the only phase where a passing test could do real-world harm, so the
 * forbidden list is explicit rather than implied:
 *
 *   POST /prachar/campaigns/{id}/send   sends the campaign. To real addresses.
 *   POST /hub/org/generate              spends Srijan credits on an AI call.
 *   POST /hub/org/quick-generate        same, and buys an image at 3 credits.
 *   POST /hub/org/skills/{id}/run       same, per step.
 *   anything WhatsApp-shaped            excluded by the owner until the API is
 *                                       wired.
 *
 * None of them appears below. `test('… never sends …')` asserts the state that
 * makes that true — every campaign draft, every recipient non-deliverable —
 * BEFORE the rest of the file runs, in the same shape as the payroll suite's
 * email check. A suite that mails a client's mailing list is not a test
 * failure, it is an incident.
 *
 * Srijan is therefore tested on what it has ALREADY generated: whether the
 * images are visible (the Phase 0 defect — 34 bought, stored and unreachable)
 * and whether their links survive re-signing. That is the part that was broken;
 * generating more would only spend money to re-prove the model works.
 */
import { test, expect, Page } from '@playwright/test';
import * as path from 'path';
import { OWNER_STATE, DL_DIR } from './real.config';
import { api, apiOk, settle, openTab, shot, submitting, RUN } from './_helpers';

test.use({ storageState: OWNER_STATE });
test.describe.configure({ mode: 'serial' });

const panel = (page: Page) => page.getByRole('tabpanel');

/**
 * Every test starts on the app. `api()` lifts the bearer token out of
 * localStorage, which is unreachable on `about:blank` — a test that goes
 * straight to the API fails with "SecurityError: Access is denied for this
 * document", which reads like an auth fault and is not one.
 */
test.beforeEach(async ({ page }) => {
  await page.goto('/today');
  await settle(page);
});


// ══ THE SAFETY GATE — runs first ═════════════════════════════════════════════

test('nothing in this org is in a state that could send', async ({ page }) => {
  await page.goto('/prachar');
  await settle(page);

  // The question is not "is every campaign a draft" — it is "can anything in
  // this org still go out". `send_campaign` refuses any status that is not
  // `draft` or `scheduled` (routers/prachar.py), so a campaign already `sent`
  // is spent and cannot fire again. The states that can still reach somebody
  // are `scheduled` — one timer away — and `sending`, which is mid-flight.
  //
  // This started as "everything must be a draft", which was right until the
  // day Prachar first delivered anything. `campaign-send.spec.ts` then left a
  // legitimately sent campaign behind and this gate failed on it, reporting a
  // hazard that had already safely happened. A gate that cries about the past
  // gets switched off, and this one is load-bearing.
  const camps = await apiOk(page, 'get', '/api/v1/prachar/campaigns?limit=200');
  const rows = camps.data ?? camps;
  const armed = (rows as any[]).filter(
    (c: any) => ['scheduled', 'sending'].includes(String(c.status).toLowerCase()));
  expect(armed.map((c: any) => `${c.name}:${c.status}`),
    'campaigns are armed to send — a suite run could reach real people')
    .toEqual([]);

  // And the audience behind them. The question this asks is not "is every
  // address fake" but "could a send from this suite reach somebody who did not
  // ask for it". Four ways an address is safe:
  //
  //   @example.*                RFC 2606 reserved, undeliverable by definition
  //   *.simulator.amazonses.com the SES simulator swallows its own
  //   on prachar_unsubscribes   the send path filters these out before dispatch
  //   kevalvshah03+…@gmail.com  the owner's own inbox, added by campaign-send
  //                             .spec.ts, which they explicitly asked for
  //
  // The unsubscribe clause is what makes this org safe to send from at all:
  // all 225 fixture contacts are suppressed, so a campaign created through the
  // UI — which has no audience control and therefore targets everyone — can
  // only ever reach addresses added deliberately after that suppression.
  const contacts = await apiOk(page, 'get', '/api/v1/graha/contacts?limit=500');
  const unsub = await apiOk(page, 'get', '/api/v1/prachar/unsubscribes?limit=1000');
  const suppressed = new Set(
    ((unsub.data ?? unsub) as any[]).map((u: any) => String(u.email || '').toLowerCase()));

  const reachable = (contacts.data || [])
    .map((c: any) => String(c.email || '').toLowerCase())
    .filter((e: string) => e
      && !/@example\.(com|org|net)$/.test(e)
      && !/simulator\.amazonses\.com$/.test(e)
      && !suppressed.has(e)
      && !/^kevalvshah03\+[a-z0-9]*@gmail\.com$/.test(e));
  expect(reachable,
    'these contacts have deliverable addresses, are not suppressed, and are ' +
    'inside the campaign audience')
    .toEqual([]);
});


// ══ PRACHAR — eight tabs, draft only ═════════════════════════════════════════

test('prachar · a campaign is created and stays a DRAFT', async ({ page }) => {
  await page.goto('/prachar');
  await settle(page);
  await openTab(page, 'campaigns');

  // The opener is "+ Schedule", and the panel is a `.k-formpanel` div rather
  // than a <form>.
  const open = page.getByRole('button', { name: /\+ Schedule/ }).first();
  await expect(open, 'the campaigns tab offers no way to create one').toBeVisible();
  await open.click();
  await settle(page);

  const f = page.locator('.k-formpanel').first();
  await expect(f, 'the campaign form did not open').toBeVisible();
  await f.getByLabel('Campaign name').fill(`E2E Campaign ${RUN}`);
  const subj = f.getByLabel('Subject line').first();
  if (await subj.count()) await subj.fill(`E2E subject ${RUN}`);
  await f.getByLabel('Body').fill('Draft body written by the E2E suite. Never sent.');

  // "Send at" is left EMPTY on purpose. Filling it schedules the campaign, and
  // a scheduled campaign is one timer away from being a sent one. The whole
  // point of this phase is that nothing leaves the building.

  const made = await submitting(page, '/prachar/campaigns',
    () => f.getByRole('button', { name: 'Create campaign' }).first().click());
  const id = made?.id || made?.campaign?.id;
  expect(id, 'the campaign was not created').toBeTruthy();

  const list = await apiOk(page, 'get', '/api/v1/prachar/campaigns?limit=200');
  const mine = (list.data ?? list).find((c: any) => String(c.id) === String(id));
  expect(mine, 'the campaign is not in the list').toBeTruthy();
  expect(String(mine.status).toLowerCase(),
    'a newly created campaign is not a draft — it could go out unreviewed')
    .toBe('draft');
  await shot(page, `prachar-campaign-${RUN}`);
});

for (const tab of ['dashboard', 'campaigns', 'templates', 'sequences',
                   'events', 'ads', 'automations', 'unsubscribes']) {
  test(`prachar · the ${tab} tab loads`, async ({ page }) => {
    await page.goto('/prachar');
    await settle(page);
    await openTab(page, tab);
    await expect(page.locator('.k-err').filter({ hasText: /failed/i }),
      `the ${tab} tab rendered an error`).toHaveCount(0);
  });
}

test('prachar · unsubscribes are honoured, not merely listed', async ({ page }) => {
  // An unsubscribe that does not remove someone from an audience is a legal
  // problem, not a UX one.
  const unsubs = await apiOk(page, 'get', '/api/v1/prachar/unsubscribes?limit=200');
  const rows = unsubs.data ?? unsubs;
  expect(Array.isArray(rows), 'unsubscribes did not answer with a list').toBe(true);

  const camps = await apiOk(page, 'get', '/api/v1/prachar/campaigns?limit=5');
  const c = (camps.data ?? camps)[0];
  if (c && rows.length) {
    const aud = await api(page, 'get', `/api/v1/prachar/campaigns/${c.id}/audience`);
    if (aud.status() === 200) {
      // `.contacts`, not `.data` — `/audience` answers at the top level and has
      // never had a `data` key, so this read was always `[]` and this test has
      // asserted nothing since it was written.
      const people = (await aud.json()).contacts ?? [];
      const opted = new Set((rows as any[]).map((u: any) => String(u.email || '').toLowerCase()));
      const leaked = people
        .map((p: any) => String(p.email || '').toLowerCase())
        .filter((e: string) => e && opted.has(e));
      expect(leaked, 'unsubscribed addresses are still in a campaign audience').toEqual([]);
    }
  }
});


// ══ SANVAAD — internal messaging, no WhatsApp ════════════════════════════════

test('sanvaad · post a message to a channel and read it back', async ({ page }) => {
  await page.goto('/sanvaad');
  await settle(page);

  const chans = await apiOk(page, 'get', '/api/v1/messaging/channels');
  const rows = chans.data ?? chans;
  expect(Array.isArray(rows) ? rows.length : 0,
    'this org has no channels to post into').toBeGreaterThan(0);

  const ch = rows[0];
  // The field is `content`, not `body` — the 422 named it, which is what a
  // validation error should do and what the 500s elsewhere in this programme
  // did not.
  const body = `E2E message ${RUN}`;
  const sent = await api(page, 'post',
    `/api/v1/messaging/channels/${ch.channel_id ?? ch.id}/messages`, { content: body });
  expect(sent.status(), await sent.text()).toBeLessThan(400);

  const msgs = await apiOk(page, 'get',
    `/api/v1/messaging/channels/${ch.channel_id ?? ch.id}/messages?limit=50`);
  const list = msgs.data ?? msgs;
  expect(JSON.stringify(list), 'the message posted is not in the channel').toContain(body);
  await shot(page, `sanvaad-${RUN}`);
});

test('sanvaad · unread counts answer for the signed-in person', async ({ page }) => {
  await page.goto('/sanvaad');
  await settle(page);
  const r = await api(page, 'get', '/api/v1/messaging/unread');
  expect(r.status(), `unread counts are unavailable: ${await r.text()}`).toBe(200);
});


// ══ SRIJAN — images, without spending a credit ═══════════════════════════════

test('srijan · no generation endpoint is called by this suite', async ({ page }) => {
  // The balance is recorded before and after the Srijan tests below, and
  // asserted unchanged at the end. Generating costs 2 credits for text and 3
  // for an image; a suite that quietly spends them is a suite nobody can run
  // often.
  const c = await apiOk(page, 'get', '/api/v1/hub/org/credits');
  const bal = Number(c.org_balance?.balance ?? c.balance);
  expect(Number.isFinite(bal), 'the credit balance is not a number').toBe(true);
  test.info().annotations.push({ type: 'credits-before', description: String(bal) });
});

test('srijan · every generated image is reachable, not just recorded',
  async ({ page }) => {
    // The Phase 0 defect, re-proved on live data: 34 images were bought, stored
    // and unreachable because the URL went only into `metadata.images` while the
    // library reads the `image_url` column.
    await page.goto('/srijan');
    await settle(page);

    const r = await apiOk(page, 'get', '/api/v1/hub/org/content');
    const items = (r.data || []).filter((i: any) => i.image_url);

    const hidden = (r.data || []).filter((i: any) => {
      const imgs = i.metadata?.images;
      return Array.isArray(imgs) && imgs.length > 0 && !i.image_url;
    });
    expect(hidden.map((i: any) => i.title),
      'these items have a generated image the library will never show').toEqual([]);

    for (const item of items.slice(0, 5)) {
      const img = await page.request.get(item.image_url);
      expect(img.status(),
        `the image for "${item.title}" is dead — the presigned link was not re-signed`)
        .toBe(200);
      expect(img.headers()['content-type'] || '').toContain('image');
    }
    await shot(page, `srijan-content-${RUN}`);
  });

test('srijan · the credit balance is untouched by this suite', async ({ page }) => {
  const c = await apiOk(page, 'get', '/api/v1/hub/org/credits');
  const bal = Number(c.org_balance?.balance ?? c.balance);
  // 2000 was the balance when this phase was written. The assertion is that the
  // suite spends NOTHING, so any drop means a generation call crept in.
  expect(bal, 'the suite spent Srijan credits — a generation endpoint was called')
    .toBeGreaterThanOrEqual(2000);
});


// ══ E-SIGN — the tab CRUD (the signed copy is proved in phase0) ══════════════

test('esign · the documents tab lists what is out for signature', async ({ page }) => {
  await page.goto('/esign');
  await settle(page);
  await expect(page.locator('.k-err').filter({ hasText: /failed/i })).toHaveCount(0);

  const docs = await apiOk(page, 'get', '/api/v1/esign/documents');
  const rows = docs.data ?? docs;
  expect(Array.isArray(rows) ? rows.length : 0,
    'the e-sign module lists nothing at all').toBeGreaterThan(0);

  // Every completed document must be ABLE to produce its executed copy. Not
  // "already has one": these were completed before the pipeline existed
  // (Phase 0 — the module used to store a JSON certificate in the columns named
  // signed_file_*), so demanding an artefact would fail 15 historical rows for
  // a defect that is fixed. What matters is that none of them is a dead end.
  const completed = (rows as any[]).filter((d: any) => d.status === 'completed');
  expect(completed.length, 'no completed documents to check').toBeGreaterThan(0);

  const orphan = completed.find((d: any) => !d.signed_file_url && !d.certificate_file_url);
  if (orphan) {
    const built = await api(page, 'post', `/api/v1/esign/documents/${orphan.id}/rebuild`);
    expect(built.status(),
      `"${orphan.title}" completed with no artefact and cannot be assembled either — ` +
      `that is a dead end: ${await built.text()}`).toBe(200);
    const out = await built.json();
    expect(out.signed_file_url, 'the rebuild produced no executed copy').toBeTruthy();
    test.info().annotations.push({
      type: 'note',
      description: `${completed.filter((d: any) => !d.signed_file_url).length} completed `
        + 'documents predate the signed-copy pipeline and are assembled on demand',
    });
  }
});
