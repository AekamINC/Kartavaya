/**
 * DAY ONE — what a brand-new customer actually sees, captured before it is gone.
 *
 * The orgs were emptied hours ago and hold NO active module subscriptions, which
 * is exactly the state a new customer is handed. Suite 02 will enable all 14
 * modules, and the moment it does this evidence is unreproducible without
 * another wipe.
 *
 * The question is narrow and it is the one the owner said he cared most about:
 * when a module is not active, does the SCREEN say so in words a person can act
 * on — or does that sentence exist only in a 403 body nobody reads?
 *
 * Read-only. Navigates, reads text, screenshots. Writes nothing.
 */
import { test } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const OUT = path.join(os.tmpdir(), 'kartavya-dayone');

const ROUTES = [
  ['dashboard', '/dashboard'],
  ['graha', '/graha'],
  ['ganit', '/ganit'],
  ['manav', '/manav'],
  ['vetana', '/vetana'],
  ['sanvaad', '/sanvaad'],
  ['dristi', '/dristi'],
  ['hub-org', '/hub/org'],
];

test('day one: does the screen say the module is inactive?', async ({ page }) => {
  test.setTimeout(6 * 60_000);
  const email = process.env.E2E_APPROVER_EMAIL;
  const password = process.env.E2E_APPROVER_PASSWORD;
  test.skip(!email || !password, 'approver credentials not in .env.e2e');

  fs.mkdirSync(OUT, { recursive: true });

  await page.goto('/login');
  await page.locator('#au-email, input[type="email"]').first().fill(email!);
  await page.locator('#au-password, input[type="password"]').first().fill(password!);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForURL(/\/(dashboard|boards|tasks|projects)/, { timeout: 45_000 });

  console.log('\n================ DAY-ONE CAPTURE ================');
  console.log(`screenshots -> ${OUT}\n`);

  for (const [name, route] of ROUTES) {
    let n403 = 0;
    const onResp = (r: any) => { if (r.status() === 403) n403++; };
    page.on('response', onResp);

    await page.goto(route, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3500);
    page.off('response', onResp);

    const body = ((await page.locator('body').innerText().catch(() => '')) || '').replace(/\s+/g, ' ').trim();

    // Does the SCREEN carry the actionable sentence, or only the 403 body?
    const saysInactive = /not active|activate it|contact your administrator|no access|ask your org admin/i.test(body);
    // Does it at least say there is nothing yet, in words?
    const saysEmpty = /no |nothing|empty|get started|add your first|create your first|yet\b/i.test(body);

    await page.screenshot({ path: path.join(OUT, `dayone-${name}.png`), fullPage: false });

    console.log(
      `${name.padEnd(10)} 403s=${String(n403).padEnd(3)} ` +
      `screen-says-inactive=${saysInactive ? 'YES' : 'NO '} ` +
      `screen-says-empty=${saysEmpty ? 'YES' : 'NO '} ` +
      `chars=${body.length}`
    );
    // The first line of visible copy is what the customer actually reads.
    console.log(`   first 180 chars: ${body.slice(0, 180)}`);
  }
  console.log('\n=================================================\n');
});
