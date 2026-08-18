/**
 * Dristi · the blended client report (A5/A6) against the DEPLOYED staging app.
 *
 * What this proves that the unit suites cannot: the tab door opens off the
 * real catalogue, the picker holds the seeded org's real clients, the report
 * draws real figures beside the two STATED absences (no ad account is
 * connected in the e2e org — the absence copy is the assertion), and a CSV
 * actually downloads carrying the client's NAME, never its id.
 *
 * Read-only throughout: the page is SELECTs and the download is a GET.
 */
import { test, expect } from '@playwright/test';
import { OWNER_STATE, DL_DIR } from './real.config';
import * as fs from 'fs';
import * as path from 'path';

test.use({ storageState: OWNER_STATE });

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

test('the client report blends CRM, money and stated absences', async ({ page }) => {
  // Before goto: the tab strip measures itself on mount, so the width has to
  // be set before the page decides what fits.
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto('/dristi');

  // The door is gated on the catalogue listing graha metrics — for the seeded
  // owner it must appear, either as a tab or behind "More +N" (the strip caps
  // at its measured fit; ten tabs overflow on most widths).
  const tab = page.getByRole('tab', { name: /clients/i });
  const overflow = page.getByRole('button', { name: /More \+\d/ });
  await expect(tab.or(overflow).first()).toBeVisible({ timeout: 20_000 });
  if (await tab.isVisible()) {
    await tab.click();
  } else {
    // The overflow rows are role="menuitem" — a bare button locator here once
    // matched the SIDEBAR's clients entry and expanded the wrong thing.
    await overflow.click();
    await page.getByRole('menuitem', { name: /clients/i }).click();
  }

  // Picker filled from the real org — pick the first non-placeholder client.
  const picker = page.getByRole('combobox', { name: 'Client' }).first();
  await expect(picker).toBeVisible();
  await expect
    .poll(async () => picker.locator('option').count(), { timeout: 15_000 })
    .toBeGreaterThan(1);
  const name = (await picker.locator('option').nth(1).textContent()) || '';
  await picker.selectOption({ index: 1 });

  // The report arrives: money tiles plus BOTH spine absences stated in the
  // server's own words (nothing is connected in the e2e org).
  await expect(page.getByText('Invoiced', { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/No Meta ads account is connected/)).toBeVisible();
  await expect(page.getByText(/No Google Analytics is connected/)).toBeVisible();

  // Names, never ids — over the whole rendered page.
  const body = (await page.locator('.dpage').textContent()) || '';
  expect(body).not.toMatch(UUID);

  // The CSV download carries the client's name in its filename, not a uuid.
  const [dl] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: /download as csv/i }).click(),
  ]);
  expect(dl.suggestedFilename()).toMatch(/^client-report_/);
  expect(dl.suggestedFilename()).not.toMatch(UUID);
  const file = path.join(DL_DIR, dl.suggestedFilename());
  await dl.saveAs(file);
  const csv = fs.readFileSync(file, 'utf8');
  expect(csv).toContain(name.trim());
  expect(csv).toContain('not connected');
});
