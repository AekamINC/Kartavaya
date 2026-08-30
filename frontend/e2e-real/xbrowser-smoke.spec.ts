/**
 * Suite 23 — CROSS-BROWSER AND CROSS-PLATFORM, against the deployed app.
 *
 * ── The gap this closes ─────────────────────────────────────────────────────
 *
 * Every other spec in this directory runs in one project: Desktop Chrome, at
 * 1280×720. So the answer to "does Kartavaya work in Safari?" and "does it work
 * on a phone?" was, until this file, unknown — not "no", not "yes", UNKNOWN,
 * with a green suite over the top of it. `frontend/playwright.matrix.ts` is the
 * long version of why that matters.
 *
 * ── This spec WRITES NOTHING, and that is what makes it affordable ──────────
 *
 * Staging and production share one Supabase database. Running the real journeys
 * across seven projects would be seven passes of real rows against real
 * customer data, which is not a thing to do casually. So this file stops at the
 * public, unauthenticated `/login` page: it navigates, it measures, it reads.
 * It never types a credential, never submits a form, never calls an API. The
 * whole cross-platform question is answerable from the boot path, because
 * everything it can catch — a refused fingerprint, an engine that will not run
 * the bundle, a layout that overflows a phone — happens before sign-in.
 *
 * ── The five things it measures, and why each one is invisible elsewhere ────
 *
 * 1. IS THE APP EVEN SERVED TO THIS ENGINE.
 *    `real.config.ts` records, at length, that Vercel bot mitigation answered
 *    every Playwright request with "403: Forbidden" and `x-vercel-mitigated:
 *    deny` until the suite was switched to `channel: 'chrome'` — the real
 *    Chrome binary — because the bundled headless shell's FINGERPRINT is what
 *    was refused, not its user agent. Firefox and WebKit have no such channel
 *    to fall back to. Whether mitigation lets them through was an open question
 *    written into that comment and answered by nothing. This test answers it
 *    on every run, and prints the header either way.
 *
 * 2. DOES THE BUNDLE RUN.
 *    Safari lags Chrome on language and API support. A single unsupported
 *    syntax or method in a vendored dependency takes the whole bundle down at
 *    parse time, and the symptom is a blank page — no 500, no failed request,
 *    nothing a status-code check would see. Only an engine can catch it.
 *
 * 3. NO HORIZONTAL OVERFLOW.
 *    The stylesheets carry 19 `max-width: 767px` rules, plus `(hover: none)`
 *    and `(pointer: coarse)` branches, so the responsive design is real and
 *    intended. Nothing measured it. jsdom performs NO LAYOUT, so every vitest
 *    width is 0 whether the bug is present or not — the same reasoning that
 *    put `drawerpickers.spec.ts` in a real browser after a chevron squeezed
 *    every dropdown label to zero width. A page wider than the phone it is on
 *    is that class of defect, at a viewport nothing had ever used.
 *
 * 4. TOUCH TARGETS, RENDERED.
 *    `scripts/check-touch-targets.mjs` scans CSS for declarations under 44px.
 *    Its own header admits it cannot see "legitimate ways to reach 44px" —
 *    padding, line-height, a pseudo-element overlay — so it reasons about
 *    source, not about pixels. It also runs in neither `npm run check` nor CI.
 *    This measures the rendered rectangle of the controls a person actually
 *    taps, on a real phone viewport, where the answer is not inferred.
 *
 * 5. NO CONSOLE ERRORS ON BOOT.
 *    The cheapest engine-difference detector there is, and it costs one
 *    listener.
 *
 * ── Running it ──────────────────────────────────────────────────────────────
 *
 *     cd frontend
 *     npx playwright install firefox webkit          # once
 *     PW_BROWSERS=all npx playwright test --config e2e-real/real.config.ts \
 *       --project=xbrowser-chromium --project=xbrowser-firefox ...
 *
 * or simply, since the xbrowser projects exist ONLY when PW_BROWSERS is set:
 *
 *     PW_BROWSERS=all npx playwright test --config e2e-real/real.config.ts \
 *       --grep "@xbrowser"
 */
import { test, expect, Page } from '@playwright/test';

/** Controls a person taps on the sign-in page. Same selectors auth.setup uses. */
const EMAIL = '#au-email, input[type="email"], input[name="email"]';
const PASSWORD = '#au-password, input[type="password"], input[name="password"]';
const SUBMIT =
  'button[type="submit"], button:has-text("Sign in"), button:has-text("Log in"), button:has-text("Login")';

/** WCAG 2.5.5 / iOS HIG, and the number check-touch-targets.mjs enforces in CSS. */
const MIN_TAP = 44;

/**
 * Console errors that are about the ENVIRONMENT, not the product.
 *
 * Deliberately short. The temptation with a new console assertion is to widen
 * the filter until it passes, and a filter wide enough to pass is a filter that
 * catches nothing — so anything added here needs a reason written beside it.
 */
const IGNORED_CONSOLE = [
  // No favicon on the login route in some builds; not a product fault and not
  // engine-specific.
  /favicon\.ico/i,
  // Third-party analytics/beacons blocked by the browser's own protections
  // differ per engine by design (Safari's ITP is stricter than Chrome's).
  /ERR_BLOCKED_BY_CLIENT/i,
];

/**
 * KNOWN DEFECTS — real faults, recorded rather than hidden.
 *
 * Same contract as `scripts/contrast-baseline.json` and
 * `scripts/vitest-baseline.json`: what was already broken when the gate landed
 * is listed BY NAME with the reason, so the gate can go green over a known
 * state while any NEW console error still fails the run. The list may shrink.
 * It may not grow without a defect number and a sentence.
 *
 * Each entry is still PRINTED on every run — a baseline you cannot see is a
 * baseline that stops being a to-do list and becomes a permanent exemption.
 */
const KNOWN_DEFECTS: { re: RegExp; why: string }[] = [
  // Empty by design: the one entry this list ever held (Vercel Analytics
  // requesting /_vercel/insights/script.js against the Cloudflare Pages SPA
  // fallback) was fixed on 2026-08-30 by dropping `@vercel/analytics`.
];

function watchConsole(page: Page) {
  const errors: string[] = [];
  const known: string[] = [];
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const text = m.text();
    if (IGNORED_CONSOLE.some((re) => re.test(text))) return;
    const hit = KNOWN_DEFECTS.find((d) => d.re.test(text));
    if (hit) {
      known.push(text);
      return;
    }
    errors.push(text);
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  return { errors, known };
}

test.describe('@xbrowser sign-in page, every engine and viewport', () => {
  test('is served, boots, fits its viewport and is tappable', async ({ page }, testInfo) => {
    const { errors, known } = watchConsole(page);

    // ── 1. Served, not mitigated ────────────────────────────────────────────
    const res = await page.goto('/login', { waitUntil: 'domcontentloaded' });
    expect(res, '/login produced no response at all').not.toBeNull();

    const status = res!.status();
    const mitigated = res!.headers()['x-vercel-mitigated'] ?? '(absent)';
    // Printed on pass as well as fail: this line is the running answer to the
    // open question in real.config.ts about non-Chrome fingerprints.
    // eslint-disable-next-line no-console
    console.log(
      `[xbrowser] ${testInfo.project.name}: HTTP ${status}, x-vercel-mitigated: ${mitigated}`,
    );

    expect(
      status,
      `/login answered ${status} to ${testInfo.project.name} (x-vercel-mitigated: ${mitigated}). ` +
        'A 403 with `deny` here is Vercel bot mitigation refusing this engine\'s ' +
        'fingerprint, NOT a product failure — real.config.ts records the same fault ' +
        'for headless chromium and the `channel: "chrome"` workaround. Firefox and ' +
        'WebKit have no equivalent channel, so the remedy is an allow rule on the ' +
        'Vercel side for this suite.',
    ).toBeLessThan(400);

    // ── 2. The bundle runs ──────────────────────────────────────────────────
    const email = page.locator(EMAIL).first();
    await expect(
      email,
      `no email field rendered in ${testInfo.project.name}. The document was served ` +
        '(status above), so this is the bundle failing to boot in this engine — the ' +
        'blank-page failure mode a status check cannot see. Read the console errors ' +
        'reported at the end of this test.',
    ).toBeVisible({ timeout: 20_000 });
    await expect(page.locator(PASSWORD).first()).toBeVisible();
    await expect(page.locator(SUBMIT).first()).toBeVisible();

    // ── 3. It fits ──────────────────────────────────────────────────────────
    const fit = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      inner: window.innerWidth,
    }));
    // 1px of slack: sub-pixel layout rounding differs between engines and a
    // half-pixel is not a horizontal scrollbar.
    expect(
      fit.scrollWidth,
      `the sign-in page is ${fit.scrollWidth}px wide inside a ${fit.clientWidth}px ` +
        `viewport in ${testInfo.project.name} — it scrolls sideways, which is the ` +
        'responsive defect no jsdom test can see because jsdom performs no layout',
    ).toBeLessThanOrEqual(fit.clientWidth + 1);

    // ── 4. Tappable, where a finger is the pointer ──────────────────────────
    const coarse = await page.evaluate(() => window.matchMedia('(pointer: coarse)').matches);
    if (coarse) {
      for (const [label, sel] of [
        ['email field', EMAIL],
        ['password field', PASSWORD],
        ['submit button', SUBMIT],
      ] as const) {
        const box = await page.locator(sel).first().boundingBox();
        expect(box, `${label} has no box to tap`).not.toBeNull();
        expect(
          Math.round(box!.height),
          `${label} renders ${Math.round(box!.width)}×${Math.round(box!.height)}px on ` +
            `${testInfo.project.name}, under the ${MIN_TAP}px minimum that ` +
            'design-handover/15-mobile-web.md sets with "no exceptions". This is the ' +
            'RENDERED rectangle — check-touch-targets.mjs reads CSS declarations and ' +
            'says in its own header that it cannot see padding or overlays, so the two ' +
            'checks disagreeing means the source-level one was guessing.',
        ).toBeGreaterThanOrEqual(MIN_TAP);
      }
    }

    // ── 5. Quiet console ────────────────────────────────────────────────────
    //
    // Known defects are printed, never swallowed. If this list is empty on a
    // run, the defect is fixed and its KNOWN_DEFECTS entry should be deleted —
    // that is what keeps the baseline shrinking instead of calcifying.
    for (const k of known) {
      const why = KNOWN_DEFECTS.find((d) => d.re.test(k))!.why;
      // eslint-disable-next-line no-console
      console.log(`[xbrowser] ${testInfo.project.name}: KNOWN DEFECT — ${k}\n            ${why}`);
    }

    expect(
      errors,
      `${errors.length} NEW console error(s) on the sign-in page in ` +
        `${testInfo.project.name}:\n  ${errors.join('\n  ')}\n` +
        '(Known defects are listed in KNOWN_DEFECTS at the top of this file and are ' +
        'not counted here. Do not add to that list to make this pass — a new console ' +
        'error in one engine and not another is exactly what this spec exists to find.)',
    ).toEqual([]);
  });
});
