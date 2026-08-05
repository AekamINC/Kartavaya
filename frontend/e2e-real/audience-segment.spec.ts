/**
 * Prachar · audience segmentation — the filter that existed and could not be set.
 *
 * ── Why this is its own file ────────────────────────────────────────────────
 * It sits beside `reach.spec.ts` and INHERITS ITS FORBIDDEN LIST. Nothing here
 * may call `POST /prachar/campaigns/{id}/send` — that endpoint belongs to
 * `campaign-send.spec.ts` and to no other file. Nothing here fills "Send at":
 * a `scheduled` campaign fails reach.spec.ts's safety gate for the whole suite
 * and is one timer away from a real send. Everything this file creates is a
 * draft, named `Segment E2E ${RUN}`, and the last test proves it.
 *
 * It is separate from `reach.spec.ts` for the reason campaign-send is: the
 * campaigns this file makes carry a FILTER, and a campaign carrying a filter
 * must never be one `campaign-send.spec.ts` will later send. Different names,
 * different file, no overlap.
 *
 * ── What it does not do ─────────────────────────────────────────────────────
 * It does not touch `prachar_unsubscribes`. The 225 suppressions in this org
 * are what makes it safe to run a marketing suite against at all, and a test
 * that narrowed them to make an assertion pass would be removing the safety
 * rather than testing the feature.
 *
 * It does not seed `graha_contacts.tags` or `graha_scoring_rules` so that the
 * `tag` and `min_score` filters can match something. Both are empty in every
 * org, the UI deliberately ships no control for either, and the honest test is
 * that the backend accepts the key, refuses the wrong TYPE of it, and does not
 * 500 — which is what `min_score` is asserted on below.
 *
 * It never asserts an absolute count. The org's contact total moves between
 * runs; what is stable is that a discriminating filter reaches strictly fewer
 * people than no filter at all, and more than nobody.
 */
import { test, expect, Page } from '@playwright/test';
import { OWNER_STATE } from './real.config';
import { api, apiOk, settle, openTab, shot, submitting, RUN } from './_helpers';

test.use({ storageState: OWNER_STATE });
test.describe.configure({ mode: 'serial' });

const CUSTOMERS = `Segment E2E ${RUN} customers`;
const EVERYONE = `Segment E2E ${RUN} everyone`;
const RENAMED = `Segment E2E ${RUN} customers renamed`;

/** The campaign form panel, and the audience block inside it. */
const form = (page: Page) => page.locator('.k-formpanel').first();
const aud = (page: Page) => page.locator('.pr__aud');

/**
 * The stored filter, whichever way the driver handed it back.
 *
 * `audience_filter` is JSONB and `db.py` registers a decoder for it — but that
 * registration is allowed to fail under PgBouncer and degrade to raw text, and
 * a test that assumed one shape would then report "the filter was not saved"
 * about a filter that was saved perfectly.
 */
function asFilter(v: any): Record<string, any> {
  if (!v) return {};
  if (typeof v === 'string') { try { return JSON.parse(v) || {}; } catch { return {}; } }
  return typeof v === 'object' ? v : {};
}

/** Open the campaigns tab with the create form showing. */
async function openForm(page: Page) {
  await page.goto('/prachar');
  await settle(page);
  await openTab(page, 'campaigns');
  const open = page.getByRole('button', { name: /\+ Schedule/ }).first();
  await expect(open, 'the campaigns tab offers no way to create one').toBeVisible();
  await open.click();
  await settle(page);
  await expect(form(page), 'the campaign form did not open').toBeVisible();
}

/** Fill the message half of the form. "Send at" is left EMPTY, always. */
async function fillMessage(page: Page, name: string) {
  const f = form(page);
  await f.getByLabel('Campaign name').fill(name);
  await f.getByLabel('Subject line').first().fill(`Segment E2E subject ${RUN}`);
  await f.getByLabel('Body').fill('Draft body written by the segmentation suite. Never sent.');
}

let customerId = '';
let everyoneId = '';


// ══ THE CONTROL EXISTS, AND WHAT IT SETS IS STORED ═══════════════════════════

test('a segment chosen in the form is what the campaign is saved with', async ({ page }) => {
  await openForm(page);

  // The audience block is the whole point of this change: before it, the form
  // had no control at all and `audience_filter` was hard-coded to `{}`.
  await expect(aud(page), 'the campaign form has no audience control').toBeVisible();
  await fillMessage(page, CUSTOMERS);

  // "Everyone" is the default and it is a button, not a blank. Choosing a
  // segment is an explicit act.
  await aud(page).getByRole('button', { name: 'A segment' }).click();
  await aud(page).getByLabel('Contact type').selectOption('customer');

  const made = await submitting(page, '/prachar/campaigns',
    () => form(page).getByRole('button', { name: 'Create campaign' }).first().click());
  customerId = made?.id || made?.campaign?.id;
  expect(customerId, 'the campaign was not created').toBeTruthy();

  expect(asFilter(made.audience_filter).type,
    'the form sent a segment and the server stored something else')
    .toBe('customer');

  // Read back through the route the product reads it through, not only out of
  // the write response.
  const got = await apiOk(page, 'get', `/api/v1/prachar/campaigns/${customerId}`);
  expect(asFilter(got.audience_filter),
    'the stored audience filter is empty — the campaign targets the whole org')
    .toEqual({ type: 'customer' });

  await shot(page, `segment-created-${RUN}`);
});


// ══ THE REGRESSION THAT MATTERS ══════════════════════════════════════════════

test('editing only the name leaves the segment alone', async ({ page }) => {
  // This is the defect, not a hypothetical: `save()` sent one payload for both
  // create and edit and hard-coded `audience_filter: {}` into it, so renaming a
  // campaign silently widened it to the entire organisation. Nothing on screen
  // said so and the next send went to everyone.
  expect(customerId, 'the previous test did not create a campaign').toBeTruthy();

  await page.goto('/prachar');
  await settle(page);
  await openTab(page, 'campaigns');

  // List view, because a draft with no date is not on the calendar grid.
  await page.getByRole('group', { name: 'Calendar view' })
    .getByRole('button', { name: 'List' }).click();
  await settle(page);

  await page.getByRole('button', { name: CUSTOMERS, exact: true }).first().click();
  await settle(page);

  // `Edit`, exactly — `Send now` is its neighbour in the same action row.
  await page.getByRole('button', { name: 'Edit', exact: true }).first().click();
  await settle(page);
  await expect(form(page), 'the edit form did not open').toBeVisible();

  // The filter reads back into the control. A form that opened blank would
  // save blank, which is the bug in a different costume.
  await expect(aud(page).getByLabel('Contact type'),
    'the saved segment did not load into the form')
    .toHaveValue('customer');

  await form(page).getByLabel('Campaign name').fill(RENAMED);
  await submitting(page, '/prachar/campaigns',
    () => form(page).getByRole('button', { name: 'Save campaign' }).first().click());

  const after = await apiOk(page, 'get', `/api/v1/prachar/campaigns/${customerId}`);
  expect(after.name, 'the rename did not save').toBe(RENAMED);
  expect(asFilter(after.audience_filter),
    'renaming the campaign wiped its audience filter — it now targets everyone')
    .toEqual({ type: 'customer' });
});


// ══ THE FILTER ACTUALLY NARROWS ══════════════════════════════════════════════

test('a segment reaches strictly fewer people than everyone, and not nobody',
  async ({ page }) => {
    // Created through the UI, on the default. "Everyone" is still the default
    // — anything else would change what an existing campaign does — so this is
    // also the assertion that the default was not accidentally narrowed.
    await openForm(page);
    await fillMessage(page, EVERYONE);
    const made = await submitting(page, '/prachar/campaigns',
      () => form(page).getByRole('button', { name: 'Create campaign' }).first().click());
    everyoneId = made?.id || made?.campaign?.id;
    expect(everyoneId, 'the unfiltered campaign was not created').toBeTruthy();
    expect(asFilter(made.audience_filter),
      'the default is no longer "everyone" — existing campaigns would change reach')
      .toEqual({});

    const all = await apiOk(page, 'get', `/api/v1/prachar/campaigns/${everyoneId}/audience`);
    const some = await apiOk(page, 'get', `/api/v1/prachar/campaigns/${customerId}/audience`);

    // Never an absolute number: the org's contact total moves between runs.
    expect(Number(some.count),
      'the customer segment resolved nobody — this org has no customer contacts, ' +
      'which is a fixture gap rather than a product defect')
      .toBeGreaterThan(0);
    expect(Number(some.count),
      'the filtered campaign reaches as many people as the unfiltered one — ' +
      'the filter is stored but not applied')
      .toBeLessThan(Number(all.count));

    // And it narrows to the right thing. `/audience` aliases `contact_type AS
    // type`, so `type` is the field to read.
    const wrong = (some.contacts || []).filter((p: any) => p.type !== 'customer');
    expect(wrong.map((p: any) => `${p.name}:${p.type}`),
      'the customer segment resolved contacts that are not customers').toEqual([]);
  });


// ══ NOBODY IS A LEGITIMATE ANSWER, AND IT SAYS SO ════════════════════════════

test('a filter matching nobody says so instead of implying a send', async ({ page }) => {
  await openForm(page);
  await aud(page).getByRole('button', { name: 'A segment' }).click();

  // A company nothing can match. No SQL, no fixture change — a string.
  const nothing = `zzz-${RUN}-no-such-company`;
  await aud(page).getByLabel('Company').fill(nothing);

  await expect(aud(page).getByText(/Nothing matches this filter/i),
    'a filter that reaches nobody renders no warning — the operator would press ' +
    'Send on an empty audience').toBeVisible({ timeout: 20_000 });

  // The same question asked of the API, so a passing UI assertion cannot be a
  // stale render. `/audience/preview` is a READ — the send endpoint is never
  // called from this file.
  const p = await apiOk(page, 'post', '/api/v1/prachar/audience/preview',
    { audience_filter: { company: nothing } });
  expect(Number(p.count), 'a filter matching nothing reported a non-zero audience').toBe(0);

  // Nothing is created. Leaving the form is the whole cleanup.
  await form(page).getByRole('button', { name: 'Cancel' }).first().click();
  await settle(page);
});


// ══ THE VALIDATOR — a refusal is cheap, a 500 in /send is not ════════════════

test('min_score is accepted as a number and refused as a string', async ({ page }) => {
  // `lead_score` is 0 on every row in every org, so this matches nobody and is
  // MEANT to. What is being tested is that a whole number reaches the query as
  // an integer: asyncpg raises DataError on `"50"`, and that error surfaces as
  // a 500 inside `/send` — the one place a 500 costs something.
  const ok = await apiOk(page, 'post', '/api/v1/prachar/campaigns', {
    name: `Segment E2E ${RUN} score`,
    subject: `Segment E2E subject ${RUN}`,
    body_html: 'Draft body written by the segmentation suite. Never sent.',
    channel: 'email',
    audience_filter: { min_score: 50 },
  });
  const scoreId = ok.id;
  expect(scoreId, 'the campaign with a numeric min_score was not created').toBeTruthy();

  const preview = await api(page, 'get', `/api/v1/prachar/campaigns/${scoreId}/audience`);
  expect(preview.status(),
    `resolving a min_score audience failed: ${await preview.text()}`).toBe(200);

  const bad = await api(page, 'post', '/api/v1/prachar/campaigns', {
    name: `Segment E2E ${RUN} score string`,
    subject: `Segment E2E subject ${RUN}`,
    body_html: 'Draft body written by the segmentation suite. Never sent.',
    channel: 'email',
    audience_filter: { min_score: '50' },
  });
  expect(bad.status(),
    `a string min_score was not refused up front — it reaches asyncpg instead: ${await bad.text()}`)
    .toBe(400);
});

test('an audience key nobody implemented is refused, not ignored', async ({ page }) => {
  // Silently dropping an unknown key is how a marketer builds a segment that
  // does nothing and believes it did something.
  const r = await api(page, 'post', '/api/v1/prachar/campaigns', {
    name: `Segment E2E ${RUN} typo`,
    subject: `Segment E2E subject ${RUN}`,
    body_html: 'Draft body written by the segmentation suite. Never sent.',
    channel: 'email',
    audience_filter: { typo: 1 },
  });
  expect(r.status(),
    `an unknown audience key was accepted, so the segment silently did nothing: ${await r.text()}`)
    .toBe(400);
});


// ══ THE GATE, LAST — nothing this file made can go out ═══════════════════════

test('every campaign this spec created is still a draft', async ({ page }) => {
  const list = await apiOk(page, 'get', '/api/v1/prachar/campaigns?limit=200');
  const mine = ((list.data ?? list) as any[])
    .filter((c: any) => String(c.name || '').startsWith(`Segment E2E ${RUN}`));
  expect(mine.length, 'this spec created nothing at all').toBeGreaterThan(0);

  const armed = mine.filter((c: any) =>
    ['scheduled', 'sending', 'sent'].includes(String(c.status).toLowerCase()));
  expect(armed.map((c: any) => `${c.name}:${c.status}`),
    'a segmentation campaign left this suite in a state that can still reach people')
    .toEqual([]);
});
