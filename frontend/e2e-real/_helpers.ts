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
import * as fs from 'fs';
import * as path from 'path';
import { DL_DIR } from './real.config';

export const API = process.env.E2E_API_URL || 'https://kartavya-staging.up.railway.app';
export const ORG = process.env.E2E_ORG_ID || '';

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
