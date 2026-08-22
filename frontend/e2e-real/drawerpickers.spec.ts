/**
 * The task drawer's dropdowns show their value.
 *
 * The owner reported every dropdown blank. The values were in the DOM and
 * correctly coloured; the chevron beside them was 141px of a 165px button and
 * squeezed each label to ZERO WIDTH. Cause: `sanvaad.css` declared a bare
 * `.ch { width: 100% }` for a channel row that no longer exists, while
 * `components.css` used `.ch` as the picker's chevron — one global name, two
 * meanings, and the stale block rule won the width.
 *
 * A jsdom test cannot catch this: jsdom does no layout, so every width is 0
 * there whether the bug is present or not. It has to be measured in a browser
 * against the deployed bundle, which is what this does.
 */
import { test, expect } from '@playwright/test';
import { OWNER_STATE } from './real.config';

test.use({ storageState: OWNER_STATE });

test('every dropdown in the task drawer shows its value', async ({ page }) => {
  await page.goto('/tasks');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2000);

  await page.locator('.k-trow').first().click({ timeout: 20_000 });
  await page.waitForSelector('.dr__props', { timeout: 20_000 });
  await page.waitForTimeout(800);

  const pickers = await page.evaluate(() =>
    Array.from(document.querySelectorAll('.dr__props .pk')).map((pk) => {
      const tr = pk.querySelector('.pk__tr') as HTMLElement | null;
      const lbl = pk.querySelector('.pk__lbl') as HTMLElement | null;
      const chev = pk.querySelector('svg') as SVGElement | null;
      return {
        field: tr?.getAttribute('aria-label') || '(unlabelled)',
        text: (lbl?.textContent || '').trim(),
        labelWidth: lbl ? Math.round(lbl.getBoundingClientRect().width) : 0,
        chevronWidth: chev ? Math.round(chev.getBoundingClientRect().width) : 0,
      };
    }));

  console.log(JSON.stringify(pickers, null, 1));
  expect(pickers.length, 'no pickers found in the drawer').toBeGreaterThan(3);

  for (const p of pickers) {
    // A picker always renders text — the selected value or its placeholder.
    // Zero width with text present is precisely the reported defect.
    expect(p.text, `${p.field} rendered no text at all`).not.toBe('');
    expect(p.labelWidth,
      `${p.field} shows "${p.text}" but its label is ${p.labelWidth}px wide — ` +
      'a width rule is reaching the chevron again')
      .toBeGreaterThan(10);
    expect(p.chevronWidth,
      `${p.field}'s chevron is ${p.chevronWidth}px; it is an 11px icon`)
      .toBeLessThan(24);
  }
});
