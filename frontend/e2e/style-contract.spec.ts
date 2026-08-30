/**
 * VISUAL REGRESSION, WITHOUT PIXELS — the design system's computed contract.
 *
 * ── Why not screenshots ─────────────────────────────────────────────────────
 *
 * `scripts/visual-baseline.mjs` already exists and its header explains, at
 * length, why its PNGs are gitignored and why it is not in CI: a pixel baseline
 * is only comparable against a run on the same platform, because font
 * rasterisation, subpixel hinting and font substitution all differ between
 * Windows and the Linux container CI runs in. "A Windows-authored PNG does not
 * fail occasionally on Linux, it fails on every glyph every time."
 *
 * That reasoning is correct and this file does not argue with it. It takes the
 * other road: capture what the CASCADE RESOLVED TO rather than what the
 * rasteriser drew. `getComputedStyle` returns `rgb(238, 233, 220)` and `66px`
 * identically on every platform, because those numbers come from the stylesheet
 * and the layout engine, not from a font renderer. So the baseline can be
 * committed, read in a diff, and enforced on every run.
 *
 * (One of the two reasons visual-baseline gives for staying out of CI has also
 * simply expired: "it needs @playwright/test … neither is in
 * frontend/package.json". `@playwright/test` is a declared devDependency as of
 * the cross-browser work. The platform argument still stands; the dependency
 * one does not.)
 *
 * ── The incidents this is shaped around ─────────────────────────────────────
 *
 * Three regressions in this repo's own history were invisible to every test and
 * would each have been caught here:
 *
 *   · THE `.side` RULE. A delete-by-selector script ate an unrelated CSS rule
 *     via a comment. `incident_side_rule_deleted` is now a standing rule that
 *     CSS is never edited by string-matching — but nothing MEASURED the loss.
 *   · THE BLANK DROPDOWNS. A stale bare `.ch { width: 100% }` in sanvaad.css
 *     collided with a picker's chevron class and squeezed every label to zero
 *     width. The values were in the DOM and correctly coloured; only a layout
 *     engine could see it.
 *   · THE CSP THEME FLASH. One sha256 in vercel.json drifted, the inline
 *     bootstrap never ran, and `data-theme` was never applied — wrong-theme
 *     flash on every load, green build, nothing in the logs.
 *
 * All three are "a resolved value changed and nobody noticed". That is exactly
 * what a computed-style snapshot is.
 *
 * ── Chromium only, on purpose ───────────────────────────────────────────────
 *
 * The whole point is a single committed set of numbers. Engines resolve a few
 * properties differently — shorthand serialisation, default border colour — so
 * a cross-engine baseline would need three files to say one thing. Engine
 * differences are the cross-browser suite's job.
 *
 * Re-record deliberately, in the same commit as the design change:
 *     PW_BROWSERS=chromium npx playwright test --config playwright.config.ts \
 *       style-contract --update-style-contract
 */
import { test, expect, Page } from '@playwright/test';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const BASELINE = new URL('../scripts/style-contract-baseline.json', import.meta.url);
const UPDATE = process.argv.includes('--update-style-contract') || !!process.env.UPDATE_STYLE_CONTRACT;

/**
 * The properties worth pinning.
 *
 * Deliberately NOT everything `getComputedStyle` returns — that is ~340
 * properties per element, most of them initial values that can never change,
 * and a diff nobody reads is a diff nobody acts on. These are the ones the
 * design system actually asserts: the row rhythm, the palette, the type scale.
 */
const PROPS = [
  'color', 'backgroundColor', 'fontSize', 'fontWeight', 'lineHeight',
  'minHeight', 'height', 'paddingTop', 'paddingLeft', 'borderRadius',
  'borderBottomWidth', 'borderBottomColor', 'gap', 'letterSpacing', 'textTransform',
];

/**
 * Surfaces and the elements on them that carry the contract.
 *
 * Every selector here is one a documented incident or a standing rule already
 * names — `--row-h` on `.k-trow`, the tonal `.k-stat` ground, the module header
 * the drawer-picker bug lived under.
 */
const SURFACES: { path: string; selectors: string[] }[] = [
  { path: '/dashboard', selectors: ['.kv__side', '.k-stat', '.kv__main', 'button'] },
  { path: '/tasks', selectors: ['.k-trow', '.k-searchpill', '.kv__main', 'button'] },
  { path: '/ganit', selectors: ['.mh', '.mt__b', '.mt__b.on', 'button'] },
  { path: '/graha', selectors: ['.mh', '.mt__b', 'button'] },
];

/**
 * A MINIMAL TASK FIXTURE, because `.k-trow` is the single most important
 * selector here and an empty list does not render one.
 *
 * `--row-h` is the contract every table in this product sits on (CLAUDE.md:
 * "every table sits on the `--row-h` token, 66px default"), and it is enforced
 * statically by `check-table-rows.mjs`. This is the rendered half of that rule,
 * and it needs a row to exist. The first run of this file reported
 * `/tasks .k-trow` as "matched NOTHING" for exactly this reason — which the
 * anti-vacuity check caught rather than passing over.
 *
 * A BARE ARRAY, for the reason `design-geometry.spec.ts` records beside its own
 * fixture: several pages read `r.data` directly and the enveloped form leaves
 * every list empty.
 */
const TEAMS = [{ team_id: 'team1', name: 'Fixture Project', color: '#5BD9CC' }];
const TASKS = [{
  task_id: 'task_fixture_0001', title: 'Fixture task', status: 'todo',
  priority: 'medium', position: 0, team_id: 'team1', assignees: [],
  due_date: '2026-08-20T06:00:00Z',
}];

const EMPTY: unknown[] = [];

async function harness(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem(
      'Kartavaya_user',
      JSON.stringify({ user_id: 'user_e2e', name: 'E2E User', email: 'e2e@example.com', role: 'org_admin' }),
    );
    localStorage.setItem('auth_token', 'e2e-stub-token');
  });
  await page.route('**/api/**', (route) => {
    const url = route.request().url();
    const json = (body: unknown) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.includes('/auth/me')) {
      return json({ user_id: 'user_e2e', name: 'E2E User', email: 'e2e@example.com', role: 'org_admin', org_id: 'org1' });
    }
    if (url.includes('/tasks')) return json(TASKS);
    if (url.includes('/teams')) return json(TEAMS);
    return json(EMPTY);
  });
}

test.describe('@style the design system resolves to the values it is supposed to', () => {
  /**
   * ⚠ THE PROJECT, NOT THE ENGINE. This was `browserName !== 'chromium'`, and
   * that has a hole: THREE of the seven projects run on chromium —
   * `chromium`, `android-chrome` (Pixel 7) and `android-tablet` (Galaxy Tab).
   * `browserName` is `chromium` for all three, so the skip let the phone and
   * the tablet through and they failed against baselines recorded at 1280x720.
   * Eleven entries reached `playwright-baseline.json` before it was noticed —
   * a baseline quietly absorbing a scoping bug, which is the one thing a
   * baseline must never be allowed to do.
   */
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium', "one committed set of numbers, recorded at the desktop viewport; engine and viewport differences are the cross-browser suite's job");
  });

  test('every pinned selector resolves to its recorded computed style', async ({ page }) => {
    await harness(page);
    const captured: Record<string, Record<string, string>> = {};
    const missing: string[] = [];

    for (const { path, selectors } of SURFACES) {
      await page.goto(path, { waitUntil: 'domcontentloaded' });
      await page.locator('main, [role="main"], .kv__main').first().waitFor({ state: 'attached', timeout: 20_000 });
      // Let the theme bootstrap and any late stylesheet settle. The CSP flash
      // incident was precisely a late-applied `data-theme`, so reading too
      // early would record the pre-theme values as correct.
      // 1200ms: `useSkeletonGate` holds a table for DELAY(120) + MIN_VISIBLE(220)
      // before the real rows replace the skeleton, and the theme bootstrap lands
      // late — the CSP flash incident was precisely a late-applied `data-theme`,
      // so reading early would record the PRE-THEME palette as correct.
      await page.waitForTimeout(1200);

      for (const sel of selectors) {
        const style = await page.evaluate(
          ([s, props]) => {
            const el = document.querySelector(s as string);
            if (!el) return null;
            const cs = getComputedStyle(el);
            const out: Record<string, string> = {};
            for (const p of props as string[]) out[p] = cs[p as keyof CSSStyleDeclaration] as string;
            return out;
          },
          [sel, PROPS] as const,
        );
        const key = `${path} ${sel}`;
        if (!style) {
          missing.push(key);
          continue;
        }
        captured[key] = style;
      }
    }

    // ANTI-VACUITY, and it is the whole safety of this file. A selector that
    // stops matching yields no entry, and "no entry" would silently compare
    // clean forever — the `.side` incident in a new costume. A selector that
    // has genuinely gone must be REMOVED from SURFACES in the same commit that
    // removes it from the product, so the intent is in the diff.
    expect(
      missing,
      `${missing.length} pinned selector(s) matched NOTHING:\n  ${missing.join('\n  ')}\n\n` +
        'A missing element is not a passing style check. Either the page did not render, or the ' +
        'class was deleted or renamed — which is the `.side` incident exactly: a rule went away ' +
        'and every test stayed green. If the removal is intended, delete the selector from ' +
        'SURFACES in this file in the same commit.',
    ).toEqual([]);

    expect(Object.keys(captured).length, 'captured nothing at all').toBeGreaterThan(8);

    if (UPDATE) {
      writeFileSync(
        BASELINE,
        `${JSON.stringify(
          {
            _comment:
              'Computed style contract. Platform-independent (resolved cascade values, not pixels). ' +
              'Re-record ONLY in the same commit as a deliberate design change — see e2e/style-contract.spec.ts.',
            _recorded: new Date().toISOString().slice(0, 10),
            styles: captured,
          },
          null,
          2,
        )}\n`,
      );
      // eslint-disable-next-line no-console
      console.log(`[style] recorded ${Object.keys(captured).length} selector(s) to scripts/style-contract-baseline.json`);
      return;
    }

    expect(
      existsSync(BASELINE),
      'no style-contract baseline — record one with --update-style-contract',
    ).toBe(true);

    const { styles: baseline } = JSON.parse(readFileSync(BASELINE, 'utf8'));
    const drift: string[] = [];

    for (const [key, now] of Object.entries(captured)) {
      const was = baseline[key];
      if (!was) {
        drift.push(`${key} :: NEW selector, not in the baseline`);
        continue;
      }
      for (const p of PROPS) {
        if (was[p] !== now[p]) drift.push(`${key} :: ${p}: ${was[p]} -> ${now[p]}`);
      }
    }
    for (const key of Object.keys(baseline)) {
      if (!(key in captured)) drift.push(`${key} :: GONE from the capture`);
    }

    expect(
      drift,
      `${drift.length} computed style value(s) changed:\n  ${drift.join('\n  ')}\n\n` +
        'These are resolved cascade values, so this is not a rendering difference — a rule ' +
        'changed, was overridden, or was deleted. If the change is deliberate, re-record with ' +
        '--update-style-contract IN THE SAME COMMIT, so the diff shows the old and new numbers ' +
        'side by side and somebody can agree with them.',
    ).toEqual([]);
  });
});
