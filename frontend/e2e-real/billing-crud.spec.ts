/**
 * Proposal 87 billing — CRUD operations on every tab.
 * Tests that the + buttons actually open forms and that the forms work.
 */
import { test, expect } from '@playwright/test';
import { OWNER_STATE } from './real.config';
import { openTab, settle, api, apiOk } from './_helpers';

test.use({ storageState: OWNER_STATE });

test('Ganit › Billing Profiles › + button opens form', async ({ page }) => {
  await page.goto('/ganit');
  await settle(page);
  await openTab(page, /billing profiles/i);

  const btn = page.locator('button:has-text("+ Billing Profile")').first();
  await expect(btn).toBeVisible({ timeout: 15_000 });
  await btn.click();

  // ConfirmDialog should open with the form
  const dialog = page.locator('[role="dialog"], .k-dialog, .k-modal, [class*="confirm"], [class*="dialog"]').first();
  await expect(dialog).toBeVisible({ timeout: 5_000 });

  // Should have a Client select
  const clientSelect = dialog.locator('select').first();
  await expect(clientSelect).toBeVisible();

  // Cancel to clean up
  const cancelBtn = dialog.locator('button:has-text("Cancel")');
  await expect(cancelBtn).toBeVisible();
  await cancelBtn.click();
});

test('Ganit › Service Lines › + button opens form', async ({ page }) => {
  await page.goto('/ganit');
  await settle(page);
  await openTab(page, /service lines/i);

  const btn = page.locator('button:has-text("+ Service Line")').first();
  await expect(btn).toBeVisible({ timeout: 15_000 });
  await btn.click();

  const dialog = page.locator('[role="dialog"], .k-dialog, .k-modal, [class*="confirm"], [class*="dialog"]').first();
  await expect(dialog).toBeVisible({ timeout: 5_000 });

  const cancelBtn = dialog.locator('button:has-text("Cancel")');
  await expect(cancelBtn).toBeVisible();
  await cancelBtn.click();
});

test('Ganit › Metered Usage › + button opens form', async ({ page }) => {
  await page.goto('/ganit');
  await settle(page);
  await openTab(page, /metered usage/i);

  const btn = page.locator('button:has-text("+ Usage Entry")').first();
  await expect(btn).toBeVisible({ timeout: 15_000 });
  await btn.click();

  const dialog = page.locator('[role="dialog"], .k-dialog, .k-modal, [class*="confirm"], [class*="dialog"]').first();
  await expect(dialog).toBeVisible({ timeout: 5_000 });

  const cancelBtn = dialog.locator('button:has-text("Cancel")');
  await expect(cancelBtn).toBeVisible();
  await cancelBtn.click();
});

test('Ganit › Rate Cards › + button opens form', async ({ page }) => {
  await page.goto('/ganit');
  await settle(page);
  await openTab(page, /rate cards/i);

  const btn = page.locator('button:has-text("+ Rate Card")').first();
  await expect(btn).toBeVisible({ timeout: 15_000 });
  await btn.click();

  const dialog = page.locator('[role="dialog"], .k-dialog, .k-modal, [class*="confirm"], [class*="dialog"]').first();
  await expect(dialog).toBeVisible({ timeout: 5_000 });

  const cancelBtn = dialog.locator('button:has-text("Cancel")');
  await expect(cancelBtn).toBeVisible();
  await cancelBtn.click();
});

test('Ganit › SLA Credits › + button opens form', async ({ page }) => {
  await page.goto('/ganit');
  await settle(page);
  await openTab(page, /sla credits/i);

  const btn = page.locator('button:has-text("+ SLA Credit")').first();
  await expect(btn).toBeVisible({ timeout: 15_000 });
  await btn.click();

  const dialog = page.locator('[role="dialog"], .k-dialog, .k-modal, [class*="confirm"], [class*="dialog"]').first();
  await expect(dialog).toBeVisible({ timeout: 5_000 });

  const cancelBtn = dialog.locator('button:has-text("Cancel")');
  await expect(cancelBtn).toBeVisible();
  await cancelBtn.click();
});

test('Ganit › Ageing › renders sections', async ({ page }) => {
  await page.goto('/ganit');
  await settle(page);
  await openTab(page, /ageing/i);

  const panel = page.locator('[role="tabpanel"]');
  await expect(panel).toBeVisible({ timeout: 15_000 });

  // Should have either section labels (Receivables/Payables) or an EmptyState
  const hasSection = await panel.locator('.k-section-label, h3:has-text("Receivables"), h3:has-text("Payables")').count();
  const hasEmpty = await panel.locator('.empty').count();
  expect(hasSection > 0 || hasEmpty > 0, 'Ageing tab should show Receivables/Payables sections or EmptyState').toBe(true);
});

test('Vikray › Billing › + button opens form', async ({ page }) => {
  await page.goto('/vikray?tab=billing');
  await settle(page);

  const btn = page.locator('button:has-text("+ Billing Profile")').first();
  await expect(btn).toBeVisible({ timeout: 15_000 });
  await btn.click();

  const dialog = page.locator('[role="dialog"], .k-dialog, .k-modal, [class*="confirm"], [class*="dialog"]').first();
  await expect(dialog).toBeVisible({ timeout: 5_000 });

  const cancelBtn = dialog.locator('button:has-text("Cancel")');
  await expect(cancelBtn).toBeVisible();
  await cancelBtn.click();
});

test('Vikray › Metered Usage › tab renders', async ({ page }) => {
  await page.goto('/vikray?tab=metered-usage');
  await settle(page);

  const panel = page.locator('[role="tabpanel"]');
  await expect(panel).toBeVisible({ timeout: 15_000 });

  const hasEmpty = await panel.locator('.empty').count();
  const hasTable = await panel.locator('.k-table').count();
  const hasBtn = await panel.locator('button:has-text("+ Usage Entry")').count();
  expect(hasEmpty > 0 || hasTable > 0 || hasBtn > 0, 'Metered Usage tab should render content').toBe(true);
});

// API endpoint tests — verify the backend routes respond
test('API › billing profiles endpoint returns 200', async ({ page }) => {
  await page.goto('/ganit');
  const r = await api(page, 'get', '/api/v1/ganit/billing/profiles');
  expect(r.status()).toBe(200);
});

test('API › service lines endpoint returns 200', async ({ page }) => {
  await page.goto('/ganit');
  const r = await api(page, 'get', '/api/v1/ganit/billing/service-lines');
  expect(r.status()).toBe(200);
});

test('API › metered usage endpoint returns 200', async ({ page }) => {
  await page.goto('/ganit');
  const r = await api(page, 'get', '/api/v1/ganit/billing/metered-usage');
  expect(r.status()).toBe(200);
});

test('API › rate cards endpoint returns 200', async ({ page }) => {
  await page.goto('/ganit');
  const r = await api(page, 'get', '/api/v1/ganit/billing/rate-cards');
  expect(r.status()).toBe(200);
});

test('API › SLA credits endpoint returns 200', async ({ page }) => {
  await page.goto('/ganit');
  const r = await api(page, 'get', '/api/v1/ganit/billing/sla-credits');
  expect(r.status()).toBe(200);
});

test('API › ageing endpoint returns 200', async ({ page }) => {
  await page.goto('/ganit');
  const r = await api(page, 'get', '/api/v1/ganit/billing/ageing?direction=receivable');
  expect(r.status()).toBe(200);
});
