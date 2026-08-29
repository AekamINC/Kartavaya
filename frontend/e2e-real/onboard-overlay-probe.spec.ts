/**
 * Proposal 93 · Stage 4 (§14) · PROBE — does the onboarding checklist swallow
 * clicks on a brand-new organisation?
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 *
 * The UK replay of wave 1 turned SIX of Suite 02's tests red, and all six failed
 * the same way: the control was "visible, enabled and stable", and then
 *
 *     <div class="k-onboard__head"> from
 *     <div class="k-onboard" role="complementary" aria-label="Onboarding checklist">
 *     subtree intercepts pointer events
 *
 * That is Playwright's ACTIONABILITY log, and an actionability log is a claim,
 * not a measurement — §0: "never infer an outcome from a return value". A human
 * with a mouse is not Playwright, and a panel that merely OVERLAPS a control is
 * not the same as one that COVERS its click point.
 *
 * So this probe asks the browser the only question that settles it, the same way
 * the DateInput-inside-a-modal finding was settled: put the pointer on the
 * control's centre and ask `document.elementFromPoint` what is actually there.
 *
 * ── What it is READ-ONLY about ──────────────────────────────────────────────
 *
 * It navigates, opens menus, and measures geometry. It fills no form, saves
 * nothing, and clicks no control that writes. Safe to run on a live org.
 *
 * Run:
 *   cd frontend
 *   E2E_LANE=uk   npx playwright test --config e2e-real/probe.config.ts
 *   E2E_LANE=unicode npx playwright test --config e2e-real/probe.config.ts
 */
import { test, expect, Page } from '@playwright/test';
import { activeLane, signInAs } from './_lanes';

const LANE = activeLane();

type Hit = {
  what: string;
  present: boolean;
  box?: { x: number; y: number; w: number; h: number };
  atCentre?: string;
  covered?: boolean;
};

/** What is REALLY at the centre of this element, according to the browser. */
async function whatIsAtTheCentre(page: Page, selector: string, what: string): Promise<Hit> {
  const loc = page.locator(selector).first();
  if ((await loc.count()) === 0) return { what, present: false };
  const box = await loc.boundingBox();
  if (!box) return { what, present: false };

  const cx = Math.round(box.x + box.width / 2);
  const cy = Math.round(box.y + box.height / 2);

  const result = await page.evaluate(([x, y]) => {
    const el = document.elementFromPoint(x as number, y as number);
    if (!el) return { desc: '<nothing>', inOnboard: false };
    const desc =
      el.tagName.toLowerCase() +
      (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).join('.') : '');
    // Does the thing under the pointer live inside the onboarding checklist?
    const inOnboard = Boolean(el.closest('.k-onboard, .k-onboard-pill'));
    return { desc, inOnboard };
  }, [cx, cy]);

  return {
    what,
    present: true,
    box: { x: Math.round(box.x), y: Math.round(box.y), w: Math.round(box.width), h: Math.round(box.height) },
    atCentre: result.desc,
    covered: result.inOnboard,
  };
}

test('does the onboarding checklist cover real controls?', async ({ page }) => {
  test.setTimeout(4 * 60_000);
  await signInAs(page, LANE);

  const hits: Hit[] = [];
  const vp = page.viewportSize();

  // ── The panel itself ──────────────────────────────────────────────────────
  await page.goto('/dashboard');
  await page.waitForTimeout(2500);
  const onboard = page.locator('.k-onboard');
  const onboardPresent = (await onboard.count()) > 0;
  const onboardBox = onboardPresent ? await onboard.boundingBox() : null;

  console.log(`\n${'='.repeat(78)}`);
  console.log(`ONBOARDING OVERLAY PROBE  ·  lane ${LANE.org} (${LANE.orgId})`);
  console.log(`viewport ${vp?.width}x${vp?.height}`);
  console.log(`${'='.repeat(78)}`);
  console.log(
    `.k-onboard rendered : ${onboardPresent}` +
    (onboardBox
      ? `  box x${Math.round(onboardBox.x)} y${Math.round(onboardBox.y)} ` +
        `${Math.round(onboardBox.width)}x${Math.round(onboardBox.height)}`
      : ''),
  );

  // ── 02.12b's control: "+ Add Document" on the storage tab ─────────────────
  await page.goto('/settings/organisation');
  await page.waitForTimeout(1500);
  const storageTab = page.getByRole('tab', { name: /storage/i }).first();
  if ((await storageTab.count()) > 0) {
    await storageTab.click().catch(() => {});
    await page.waitForTimeout(2000);
    hits.push(await whatIsAtTheCentre(page, 'button:has-text("Add Document")', '02.12b  + Add Document'));
  }

  // ── 02.10 / 02.11 / 02.14's control: a member row's action menu ───────────
  const membersTab = page.getByRole('tab', { name: /members/i }).first();
  if ((await membersTab.count()) > 0) {
    await membersTab.click().catch(() => {});
    await page.waitForTimeout(2000);
    const rowBtn = page.locator('.omt tbody tr button').last();
    if ((await rowBtn.count()) > 0) {
      await rowBtn.click({ timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(1200);
      hits.push(await whatIsAtTheCentre(page, '[role="menu"] [role="menuitem"]', '02.10  member row menuitem (first)'));
      hits.push(await whatIsAtTheCentre(page, '[role="menu"] [role="menuitem"]:last-child', '02.11  member row menuitem (last)'));
      await page.keyboard.press('Escape').catch(() => {});
    }
  }

  // ── 02.6's control: Ganit's overflow menu, the ONLY route to numbering ────
  await page.goto('/ganit');
  await page.waitForTimeout(2500);
  const more = page.getByRole('button', { name: /^More/ }).first();
  if ((await more.count()) > 0) {
    await more.click({ timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(1200);
    hits.push(await whatIsAtTheCentre(page, '[role="menu"] [role="menuitem"]:last-child', '02.6   ganit overflow menuitem (last)'));
  }

  console.log(`\n${'-'.repeat(78)}`);
  for (const h of hits) {
    if (!h.present) { console.log(`  ${h.what.padEnd(38)} NOT PRESENT`); continue; }
    const flag = h.covered ? 'COVERED BY .k-onboard' : 'reachable';
    console.log(
      `  ${h.what.padEnd(38)} ${flag}\n` +
      `  ${''.padEnd(38)}   box ${h.box!.x},${h.box!.y} ${h.box!.w}x${h.box!.h}\n` +
      `  ${''.padEnd(38)}   elementFromPoint(centre) -> ${h.atCentre}`,
    );
  }
  const covered = hits.filter((h) => h.covered);
  console.log(`\n  controls probed: ${hits.filter((h) => h.present).length}`);
  console.log(`  covered by the onboarding checklist: ${covered.length}`);
  console.log(`${'='.repeat(78)}\n`);

  // The probe REPORTS; it does not decide. Its job is to hand back a
  // measurement the report can quote, on both lanes, from the same code.
  expect(true).toBeTruthy();
});
