/**
 * Establishes the browser storage states the journeys run as.
 *
 * ── Two ways in, and why both exist ─────────────────────────────────────────
 *
 * A PASSWORD gets signed in through the real login form. That is the preferred
 * path and it is not sentiment: the login form is a shipped surface with its own
 * validation, 2FA branch and error states, and if every state were seeded
 * programmatically nothing in the suite would ever exercise it.
 *
 * A TOKEN seeds the same storage directly. It exists because several accounts
 * have a working bearer token and no usable password — measured 2026-08-30
 * against production — and a suite that cannot run as those accounts is a suite
 * that skips the org lanes entirely. `_lanes.ts` already drives its API work
 * from the same tokens, so this only brings the BROWSER half up to parity.
 *
 * ⚠ The token path skips the login form and everything the form does. It must
 * stay the exception. If an account has a password, use it.
 *
 * ── What "signed in" means to this app ──────────────────────────────────────
 *
 * `lib/api.js` reads `auth_token` from localStorage for the Authorization
 * header, `lib/auth.js` reads `Kartavaya_user` for the current user, and
 * `Protected.jsx` gates on `auth_token` being present. So both keys are
 * required — a token alone leaves the app authenticated to the API but with no
 * user object, and pages that read `.email` off it break in a way that looks
 * like a product bug rather than a fixture bug.
 *
 * The user object is fetched from `GET /api/auth/me` rather than hand-built, so
 * the fixture cannot drift from the shape a real login produces.
 *
 * ⚠ A real login also sets an httpOnly cookie. The token path cannot produce
 * one, so anything depending on that cookie rather than the bearer header will
 * behave differently here. The assertion at the end of `tokenLogin` is what
 * turns that from a silent difference into a failed setup.
 */
import fs from 'node:fs';
import { test as setup, expect, Page, APIRequestContext, request } from '@playwright/test';
import { OWNER_STATE, APPROVER_STATE, GODMODE_STATE } from './real.config';

const API = (process.env.E2E_API_URL || 'https://api.kartavaya.com').replace(/\/+$/, '');

/** Signed-in landing routes. Kept in one place so both paths assert the same thing. */
const SIGNED_IN = /\/(dashboard|boards|tasks|projects)/;

async function uiLogin(page: Page, email: string, password: string, statePath: string) {
  await page.goto('/login');
  const emailBox = page.locator('#au-email, input[type="email"], input[name="email"]').first();
  const passBox = page.locator('#au-password, input[type="password"], input[name="password"]').first();
  await expect(emailBox).toBeVisible();
  await emailBox.fill(email);
  await passBox.fill(password);
  await page.locator('button[type="submit"], button:has-text("Sign in"), button:has-text("Log in"), button:has-text("Login")').first().click();
  await page.waitForURL(SIGNED_IN, { timeout: 45_000 });
  await page.context().storageState({ path: statePath });
}

async function tokenLogin(page: Page, token: string, statePath: string, label: string) {
  // Resolve the user through the API first. A dead or expired token must fail
  // HERE, with its own message, rather than as a mystery redirect later.
  const api: APIRequestContext = await request.newContext();
  const res = await api.get(`${API}/api/auth/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(
    res.ok(),
    `${label}: the token was rejected by ${API}/api/auth/me (HTTP ${res.status()}). ` +
    'It is expired or revoked — mint a new one; no browser trick can rescue it.',
  ).toBeTruthy();
  const user = await res.json();
  await api.dispose();

  // localStorage is per-origin, so the origin has to exist before it can be
  // written. `/login` is the cheapest page that is certain not to redirect.
  await page.goto('/login');
  await page.evaluate(
    ([t, u]) => {
      localStorage.setItem('auth_token', t as string);
      localStorage.setItem('Kartavaya_user', JSON.stringify(u));
    },
    [token, user] as const,
  );

  await page.goto('/dashboard');
  await page.waitForURL(SIGNED_IN, { timeout: 45_000 });
  // Landing on the URL is not proof — an unauthenticated app can sit on /login.
  // Assert the app actually kept the session it was handed.
  const stored = await page.evaluate(() => localStorage.getItem('auth_token'));
  expect(
    stored,
    `${label}: the app discarded the seeded token, so it never considered the session valid`,
  ).toBe(token);
  await page.context().storageState({ path: statePath });
}

/**
 * One account. `password` wins when both are present.
 *
 * A missing credential FAILS rather than skips. A skipped setup produces an
 * empty state file, and every spec using it then fails somewhere far away with
 * a redirect to /login — which reads as a product defect and has cost this
 * project days before.
 */
async function signIn(
  page: Page,
  label: string,
  statePath: string,
  { email, password, token }: { email?: string; password?: string; token?: string },
) {
  // Delete any state left by an earlier run FIRST. Found 2026-08-30: owner.json
  // on this machine was two days old and belonged to a different account than
  // its name claimed, so fifty-five specs had been running as the wrong user.
  // A stale file that happens to still work is the worst case — it produces a
  // green run that proves something nobody asked about.
  try { fs.rmSync(statePath, { force: true }); } catch { /* nothing to remove */ }

  if (email && password) return uiLogin(page, email, password, statePath);
  if (token) return tokenLogin(page, token, statePath, label);
  throw new Error(
    `${label}: no credential. Set a password (preferred — it exercises the real ` +
    `login form) or a bearer token in .env.e2e. Nothing else in the suite can ` +
    `run as this account.`,
  );
}

setup('owner signs in', async ({ page }) => {
  await signIn(page, 'OWNER', OWNER_STATE, {
    email: process.env.E2E_OWNER_EMAIL,
    password: process.env.E2E_OWNER_PASSWORD,
    token: process.env.E2E_OWNER_TOKEN,
  });
});

setup('approver signs in', async ({ page }) => {
  await signIn(page, 'APPROVER', APPROVER_STATE, {
    email: process.env.E2E_APPROVER_EMAIL,
    password: process.env.E2E_APPROVER_PASSWORD,
    token: process.env.E2E_APPROVER_TOKEN,
  });
});

/**
 * ⚠ Nothing created this before, while nineteen specs used it — they were
 * reading whatever `godmode.json` happened to be left on the machine, or
 * failing on a file that was never written.
 */
setup('godmode signs in', async ({ page }) => {
  await signIn(page, 'GODMODE', GODMODE_STATE, {
    email: process.env.E2E_GODMODE_EMAIL,
    password: process.env.E2E_GODMODE_PASSWORD,
    token: process.env.E2E_GODMODE_TOKEN,
  });
});
