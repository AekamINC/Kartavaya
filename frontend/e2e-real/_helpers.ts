/**
 * Shared machinery for the per-module CRUD suites.
 *
 * Extracted at Phase 1 because every module after it needs the same four
 * things, and the first version of this suite reimplemented them per file and
 * got them subtly wrong each time — a loose /Create/i that matched a list card,
 * a `request.get` that cannot read a data: URI, a tab click that misses
 * anything behind the More menu.
 *
 * THE RULE THIS FILE ENFORCES: a control that should exist and does not is a
 * FAILURE, never a skip. `full-journey.spec.ts` used
 * `test.skip(!opened, 'no affordance')`, and that is how the e-sign journey
 * reported green for weeks while the entire module returned 403 for the org.
 * Nothing here returns a boolean for the caller to shrug at.
 */
import { expect, Page } from '@playwright/test';
import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { DL_DIR } from './real.config';

export const API = process.env.E2E_API_URL || 'https://kartavya-staging.up.railway.app';
export const ORG = process.env.E2E_ORG_ID || '';

/**
 * The fence the sending suites stand behind, verified AT RUNTIME.
 *
 * `OUTBOUND_SUPPRESSED_ORGS` on the staging service is what stops this org's
 * ~1,600 seeded `@example.com` addresses from becoming real hard bounces now
 * that staging runs `OUTBOUND_MODE=live` — but it is a Railway variable, and a
 * cleared or typo'd variable is invisible to a spec that merely NAMES it in a
 * comment. One payroll re-run or one campaign send through the gap is ~60
 * bounces at the verified sender domain: an incident, not a test failure.
 *
 * So the deployed process attests its own state. `GET /api/health` (public,
 * unauthenticated) reports `outbound_mode` — the string the PROCESS booted
 * with, not what the dashboard says the var is — and `suppressed_orgs_digest`:
 * sha256 hex, first 16 chars, of the comma-joined sorted lowercase org ids on
 * the list, `"0"` for the empty set. A digest, never the ids, because the
 * endpoint is public and org ids obey the same names-not-ids rule as user ids;
 * this suite KNOWS its own org id, so it can hash the exact set it expects and
 * compare. The Python half of the contract is pinned in
 * `backend/tests/test_health_meta.py`.
 *
 * Passes when the mode is `dry` (nothing sends at all). In `live` mode it
 * REQUIRES the digest to attest exactly {the E2E org} — a missing field (a
 * deployed build older than the attestation), a `"0"`, or any other digest is
 * a FAILURE, never a skip, per this file's rule: on a run where the org is
 * deliberately unlisted so campaign-send can deliver, failing here first is
 * the point — that state must never be passed through silently.
 */
export async function assertOutboundFence(page: Page) {
  // The env-carried org when present (same var `ORG` reads), else the literal
  // staging E2E org — "E2E Test & Associates [TEST ORG]", the id the Railway
  // var carries and `backend/tests/test_outbound_suppressed_orgs.py` pins.
  const e2eOrg = (ORG || '64e7bea6-6abe-490c-a2a4-27a60c6be916').toLowerCase();
  const expected = createHash('sha256').update(e2eOrg).digest('hex').slice(0, 16);

  const res = await page.request.get(`${API}/api/health`);
  expect(res.status(), `GET /api/health → ${res.status()} — cannot verify the outbound fence, ` +
    'so nothing that sends may run').toBe(200);
  const meta = await res.json();

  const mode = String(meta.outbound_mode ?? '');
  const digest = String(meta.suppressed_orgs_digest ?? '');
  expect(mode && digest,
    'the deployed backend does not report outbound_mode/suppressed_orgs_digest — ' +
    'it predates the fence attestation, so whether the E2E org is shielded is ' +
    'UNKNOWABLE from here; deploy the meta fields before running anything that sends')
    .toBeTruthy();

  if (mode === 'dry') return;               // nothing sends at all — fence holds

  expect(digest,
    'staging is not shielding the e2e org — OUTBOUND_SUPPRESSED_ORGS is unset or ' +
    `wrong; sending would hard-bounce ~60 real mails. The live process reports ` +
    `outbound_mode='${mode}' and suppressed_orgs_digest='${digest}', but shielding ` +
    `exactly this org digests to '${expected}'. Fix the Railway variable (and ` +
    'REDEPLOY — a config edit is not a deployment) before running this spec')
    .toBe(expected);
}

/** A short run tag so records made by one run are findable and never collide. */
export const RUN = Math.random().toString(36).slice(2, 7);

export async function api(page: Page, method: 'get' | 'post' | 'patch' | 'put' | 'delete',
                          p: string, data?: any) {
  const token = await page.evaluate(() => localStorage.getItem('auth_token'));
  return page.request[method](API + p, {
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'X-Org-Id': ORG },
    ...(data ? { data } : {}),
  });
}

/** Same call, but the response must be OK and is returned parsed. */
export async function apiOk(page: Page, method: 'get' | 'post' | 'patch' | 'put' | 'delete',
                            p: string, data?: any) {
  const r = await api(page, method, p, data);
  expect(r.status(), `${method.toUpperCase()} ${p} → ${r.status()}: ${await r.text()}`)
    .toBeLessThan(400);
  return await r.json();
}

/**
 * Settle, but never fail on it. The shell polls notifications on a timer, so
 * `networkidle` can legitimately never arrive. Every caller asserts on a real
 * element straight after; that assertion is the gate.
 */
export async function settle(page: Page) {
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
}

/**
 * Switch module tab by its visible label, wherever it is.
 *
 * `ModuleTabs` shows the first N inline and pushes the rest behind a "More +N"
 * popover, and which ones depends on the viewport. A test that only looks in
 * the tablist silently misses half of Graha's seventeen. Tries inline first,
 * then the overflow menu, and fails naming the tab if it is in neither.
 */
export async function openTab(page: Page, label: string | RegExp) {
  const inline = page.getByRole('tab', { name: label });
  if (await inline.count()) {
    await inline.first().click();
    await settle(page);
    return;
  }
  const more = page.getByRole('button', { name: /^More/ });
  await expect(more, `tab "${label}" is neither inline nor behind a More menu`).toBeVisible();
  await more.click();
  const item = page.getByRole('menuitem', { name: label });
  await expect(item, `tab "${label}" is not in the More menu either`).toBeVisible();
  await item.click();
  await settle(page);
}

/**
 * Read a stored artefact, whichever way storage handed it back.
 *
 * `storage.upload_file` returns a presigned https URL when the org has R2 and a
 * base64 `data:` URI when it does not — and the E2E org has no R2, so it takes
 * the fallback for everything. `request.get` refuses a data: URL outright, so
 * handling only https would silently skip the path this org actually runs.
 */
export async function fetchArtefact(page: Page, url: string): Promise<Buffer> {
  if (url.startsWith('data:')) {
    const comma = url.indexOf(',');
    expect(comma, `malformed data URI: ${url.slice(0, 40)}`).toBeGreaterThan(0);
    return Buffer.from(url.slice(comma + 1), 'base64');
  }
  const res = await page.request.get(url);
  expect(res.status(), `artefact fetch failed: ${url.slice(0, 80)}`).toBe(200);
  return await res.body();
}

/**
 * Count PDF pages without adding a PDF library to the frontend.
 *
 * Cross-checks the page tree's `/Count` against the number of `/Type /Page`
 * objects, so a malformed count cannot quietly satisfy an assertion.
 */
export function pdfPageCount(buf: Buffer): number {
  const text = buf.toString('latin1');
  const counts = [...text.matchAll(/\/Count\s+(\d+)/g)].map(m => Number(m[1]));
  const pageObjs = (text.match(/\/Type\s*\/Page(?![s])/g) || []).length;
  const declared = counts.length ? Math.max(...counts) : 0;
  expect(declared, `the page tree declares ${declared} pages but ${pageObjs} page objects exist`)
    .toBe(pageObjs);
  return declared;
}

/**
 * Choose a real option from a select that is populated by a fetch.
 *
 * Forms mount with `<option value="">Select…</option>` alone and fill in when
 * their contacts/products/vendors arrive. Reading the options straight after
 * `settle()` caught the empty state and reported "no contacts to invoice" on an
 * org with two hundred of them — a false product finding, which is worse than a
 * flake. Polls for real options, then picks one.
 *
 * `label` is matched against the option text when given; otherwise the first
 * real option wins. Fails naming the select if nothing ever arrives, because a
 * genuinely empty picker IS a finding and must not be silently tolerated.
 */
export async function pickOption(select: any, what: string, label?: string | RegExp) {
  await expect
    .poll(async () => (await select.locator('option').count()), {
      message: `the ${what} picker never loaded any options`,
      timeout: 20_000,
    })
    .toBeGreaterThan(1);

  if (label == null) {
    const value = await select.locator('option').nth(1).getAttribute('value');
    await select.selectOption(value!);
    return value!;
  }
  const texts = await select.locator('option').allTextContents();
  const idx = texts.findIndex(t =>
    typeof label === 'string' ? t.includes(label) : label.test(t));
  expect(idx, `no ${what} option matching ${label}; saw: ${texts.slice(0, 8).join(' | ')}`)
    .toBeGreaterThan(0);
  const value = await select.locator('option').nth(idx).getAttribute('value');
  await select.selectOption(value!);
  return value!;
}

/**
 * Click something that writes, and return what the server actually stored.
 *
 * Looking the new record up in the list afterwards is unreliable and was
 * actively misleading: Ganit orders invoices by INVOICE DATE, and the seeded
 * data runs to Aug 2026, so a genuinely-created invoice was not in the first
 * page and the test reported "the invoice was not created" while the screen
 * said "Invoice created". Reading the write response says what happened.
 *
 * Fails with the response body when the write is rejected, so a 422 gap list
 * arrives in the failure message instead of a bare status code.
 */
export async function submitting(page: Page, urlPart: string | RegExp,
                                 act: () => Promise<void>, expectStatus?: number) {
  const match = (u: string) => typeof urlPart === 'string' ? u.includes(urlPart) : urlPart.test(u);
  const [res] = await Promise.all([
    page.waitForResponse(r => match(r.url()) && r.request().method() !== 'GET',
      { timeout: 45_000 }),
    act(),
  ]);
  const body = await res.text();
  if (expectStatus != null) {
    expect(res.status(), `${res.request().method()} ${res.url()} → ${res.status()}: ${body}`)
      .toBe(expectStatus);
  } else {
    // ANY 2xx. Demanding exactly 200 rejected a correct 201 Created from
    // `POST /pahchan/sites` and reported it as a failure — the site was made,
    // the status code was right, and the test was wrong. Callers that care
    // about a specific code (a 422 gate, a 409 refusal) still pass one.
    expect(res.status(), `${res.request().method()} ${res.url()} → ${res.status()}: ${body}`)
      .toBeGreaterThanOrEqual(200);
    expect(res.status(), `${res.request().method()} ${res.url()} → ${res.status()}: ${body}`)
      .toBeLessThan(300);
  }
  try { return JSON.parse(body); } catch { return {}; }
}

/** Assert a download happens, save it, and hand back the bytes. */
export async function download(page: Page, trigger: () => Promise<void>, name: string) {
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 45_000 }), trigger()]);
  const dest = path.join(DL_DIR, name);
  await dl.saveAs(dest);
  const buf = fs.readFileSync(dest);
  expect(buf.length, `${name} downloaded as an empty file`).toBeGreaterThan(100);
  return buf;
}

export async function shot(page: Page, name: string) {
  await page.screenshot({ path: path.join(DL_DIR, `${name}.png`), fullPage: true });
}

/**
 * A real multi-page PDF, built here so a test owns its own input rather than
 * depending on a fixture file that may or may not be what it claims.
 */
export function makePdf(pages: number): Buffer {
  const objs: string[] = [];
  const kids = Array.from({ length: pages }, (_, i) => `${3 + i * 2} 0 R`).join(' ');
  objs.push('<< /Type /Catalog /Pages 2 0 R >>');
  objs.push(`<< /Type /Pages /Kids [${kids}] /Count ${pages} >>`);
  for (let i = 0; i < pages; i++) {
    const stream = `BT /F1 24 Tf 72 720 Td (E2E source page ${i + 1}) Tj ET`;
    objs.push('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] ' +
      '/Resources << /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> >> >> ' +
      `/Contents ${4 + i * 2} 0 R >>`);
    objs.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  }
  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  objs.forEach((o, i) => { offsets.push(pdf.length); pdf += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = pdf.length;
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) pdf += `${String(off).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}

/** A tiny valid PNG, for receipt/logo/attachment uploads. */
export function makePng(): Buffer {
  return Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAIAQMAAAD+wSzIAAAABlBMVEX///+/v7' +
    '+jQ3Y5AAAADklEQVQI12P4AIX8EAgALgAD/aNpbtEAAAAASUVORK5CYII=', 'base64');
}

/**
 * Set a date on a `<DateInput>` the way a person does — open it and click the
 * day — for a `scope` that contains exactly one.
 *
 * `.locator('input').fill(iso)` stopped working when the native date input was
 * replaced: the native control is still in the DOM (form serialisation depends
 * on it) but it is clipped and out of the tab order, so Playwright refuses to
 * fill it, correctly. Driving the calendar is also the truer test — it is what
 * the user now does.
 */
export async function setDate(scope: any, labelText: string | RegExp, iso: string) {
  const label = scope.locator('label', { hasText: labelText }).first();
  await label.locator('.pk--dt button.pk__tr').first().click();
  const pop = label.locator('.pk__pop');
  await expect(pop).toBeVisible();

  const want = new Date(`${iso}T00:00:00`);
  const title = `${want.toLocaleString('en-GB', { month: 'long' })} ${want.getFullYear()}`;
  // The calendar opens on the selected month, or on today. Step forwards or
  // backwards until the heading is the month asked for — never more than a
  // year, so a wrong `iso` fails the test rather than spinning.
  for (let i = 0; i < 13; i++) {
    if ((await pop.locator('.pk__calt').innerText()).trim() === title) break;
    const shown = new Date(`${(await pop.locator('.pk__calt').innerText()).trim()} 1`);
    await pop.getByRole('button', { name: shown < want ? 'Next month' : 'Previous month' }).click();
  }
  expect((await pop.locator('.pk__calt').innerText()).trim(),
    `the calendar never reached ${title}`).toBe(title);

  await pop.locator(`.pk__d:not(.out)`, { hasText: new RegExp(`^${want.getDate()}$`) }).first().click();
  await expect(pop).toBeHidden();
}

// ══ TARGETING AN ORG, AND PROVING IT ═════════════════════════════════════════
//
// Added 2026-08-26 after a Phase-1 acceptance run wrote a vendor into the WRONG
// ORGANISATION and only the read-back's 403 revealed it.
//
// `.env.e2e` had drifted into a hybrid: `E2E_ORG_ID` named E2E Test &
// Associates while `E2E_ADMIN_TOKEN` belonged to an admin of Unicode Group who
// is not a member of E2E at all. The browser therefore drove as a Unicode user
// and the write landed in Unicode, while `api()`'s `X-Org-Id` header carried
// E2E's id and 403'd. The write had already happened by then.
//
// The deeper fault was in the fence: `assertOutboundFence` hashes the org id it
// reads from the ENVIRONMENT, so it attested that E2E was shielded — which was
// true, and irrelevant, because the session was in Unicode. **A fence that
// asserts about an org the session is not in is not a fence.** Everything below
// derives the org from the SESSION.

/** The org id the browser session is actually operating as. */
export async function activeOrgId(page: Page): Promise<string | null> {
  return await page.evaluate(() => localStorage.getItem('Kartavaya_active_org'));
}

/**
 * Point the session at one org and PROVE it took, before anything is written.
 *
 * Sets the same localStorage key the switcher writes (`orgContext.js:30`) and
 * reloads, because `setActiveOrg` treats the switch as a hard boundary. Then
 * confirms from the server — not from the key it just wrote, which would be
 * circular — that this user really is a member and the org resolves by name.
 */
export async function useOrg(page: Page, orgId: string, name: string | RegExp) {
  await page.goto('/');
  await page.evaluate((id) => localStorage.setItem('Kartavaya_active_org', id), orgId);
  await page.goto('/ganit');
  await settle(page);

  const got = await activeOrgId(page);
  expect(got, `the active-org key did not stick — wanted ${orgId.slice(0, 8)}…, got ${got}`)
    .toBe(orgId);

  // Server-side confirmation. A membership the server rejects is exactly the
  // state that produced the wrong-org write, and it must fail HERE, loudly,
  // before a single row is created — not on a read-back afterwards.
  const probe = await api(page, 'get', '/api/v1/org/members?limit=1');
  expect(probe.status(), `this account cannot act in ${String(name)} — ` +
    `GET /org/members → ${probe.status()}: ${await probe.text()}. The token in ` +
    '.env.e2e belongs to a different organisation; nothing may be written.')
    .toBeLessThan(400);

  // And the shell must SAY so, because that is what a person would check.
  await expect(page.getByText(name).first(),
    `the org switcher does not show ${String(name)} after switching to it`)
    .toBeVisible({ timeout: 20_000 });
}

/**
 * The outbound fence, bound to the org the SESSION is in rather than to an
 * environment variable. Same contract as `assertOutboundFence` otherwise.
 */
export async function assertOutboundFenceFor(page: Page, orgId: string) {
  const expected = createHash('sha256').update(orgId.toLowerCase()).digest('hex').slice(0, 16);
  const res = await page.request.get(`${API}/api/health`);
  expect(res.status(), `GET /api/health → ${res.status()} — cannot verify the outbound ` +
    'fence, so nothing that sends may run').toBe(200);
  const meta = await res.json();
  const mode = String(meta.outbound_mode ?? '');
  const digest = String(meta.suppressed_orgs_digest ?? '');

  expect(mode && digest, 'the deployed backend does not report outbound_mode/' +
    'suppressed_orgs_digest — whether THIS org is shielded is unknowable from here')
    .toBeTruthy();
  if (mode === 'dry') return;

  expect(digest, `staging is NOT shielding the org this session is operating in ` +
    `(${orgId.slice(0, 8)}…). The live process reports outbound_mode='${mode}' and ` +
    `suppressed_orgs_digest='${digest}', but shielding exactly this org digests to ` +
    `'${expected}'. Writing here could mail real people — fix ` +
    'OUTBOUND_SUPPRESSED_ORGS and REDEPLOY, or target an org that is on the list.')
    .toBe(expected);
}

/**
 * Choose a value from a `Picker`/`ServerPicker`, which is NOT a `<select>`.
 *
 * `pickOption` above drives a real `<select>` and times out here with "the
 * picker never loaded any options" — which reads as an empty picker and is not
 * one. The two Phase-1 fields that matter most, the invoice's Salesperson and
 * the expense's Client contact, are both `Picker mode="option"`: a
 * `<button aria-haspopup="listbox" aria-label=…>` trigger that opens a
 * `role="listbox"` of `role="option"` buttons (`Picker.jsx:190,263-269,326`).
 * `ExpensesTab.jsx:177-180` explains why they are not labelable elements — the
 * control is a button, so `ariaLabel` names it and wrapping it in a `<label>`
 * loses the accessible name.
 *
 * `ServerPicker` fetches its rows for whatever is typed, so the listbox can be
 * empty for a moment after it opens. Polls for a real row rather than reading
 * once, for the same reason `pickOption` does — a picker read too early
 * reported "no contacts to invoice" against an org holding hundreds, and a
 * false product finding is worse than a flake.
 *
 * Returns the chosen row's visible text, so a caller can assert on the NAME it
 * picked without ever touching an id.
 */
export async function pickFromPicker(
  scope: any, ariaLabel: string, what: string, match?: string | RegExp,
): Promise<string> {
  const trigger = scope.getByRole('button', { name: ariaLabel, exact: false }).first();
  await expect(trigger, `the ${what} picker (aria-label "${ariaLabel}") is not on the form`)
    .toBeVisible();
  await trigger.click();

  const page = scope.page ? scope.page() : scope;
  const listbox = page.locator('[role="listbox"]').last();
  await expect(listbox, `the ${what} picker did not open a listbox`).toBeVisible();

  const rows = listbox.locator('[role="option"]');
  await expect
    .poll(async () => await rows.count(),
      { message: `the ${what} picker never loaded a single option`, timeout: 20_000 })
    .toBeGreaterThan(0);

  let row = rows.first();
  if (match != null) {
    const texts = await rows.allTextContents();
    const idx = texts.findIndex(t =>
      typeof match === 'string' ? t.includes(match) : match.test(t));
    expect(idx, `no ${what} option matching ${String(match)}; saw: ` +
      texts.slice(0, 8).join(' | ')).toBeGreaterThanOrEqual(0);
    row = rows.nth(idx);
  }
  const chosen = (await row.textContent() || '').trim();
  await row.click();
  // The popup animates out; a caller that submits into the closing overlay
  // clicks the overlay instead of the button.
  await expect(listbox, `the ${what} picker did not close after choosing`)
    .toBeHidden({ timeout: 10_000 });
  return chosen;
}
