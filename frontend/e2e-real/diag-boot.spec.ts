/**
 * DIAGNOSTIC — why does the app boot in a normal browser and not under Playwright?
 *
 * Temporary. Prints what the page reports rather than asserting anything, so it
 * cannot itself fail for a second reason and hide the first.
 */
import { test } from '@playwright/test';
import { lane, signInAs } from './_lanes';

const LANE = lane('unicode');

test('diag — what the browser reports on /dashboard', async ({ page }) => {
  test.setTimeout(3 * 60_000);

  const console_: string[] = [];
  const failed: string[] = [];
  const responses: string[] = [];

  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') {
      console_.push(`[${m.type()}] ${m.text().slice(0, 300)}`);
    }
  });
  page.on('requestfailed', (r) => {
    failed.push(`${r.method()} ${r.url().slice(0, 140)} — ${r.failure()?.errorText}`);
  });
  page.on('response', async (r) => {
    const u = r.url();
    if (!/\.css(\?|$)/.test(u)) return;
    const h = r.headers();
    responses.push(
      `CSS ${r.status()} ct=${h['content-type']} cf=${h['cf-cache-status'] || '-'} `
      + `age=${h['age'] || '-'} sw=${r.fromServiceWorker()} type=${r.request().resourceType()} `
      + `frame=${r.frame()?.url().slice(0, 60)} url=${u.slice(-40)}`);
  });

  try {
    await signInAs(page, LANE);
  } catch (e: any) {
    console.log(`\n  signInAs threw: ${String(e?.message).slice(0, 300)}`);
  }

  const state = await page.evaluate(() => ({
    url: location.href,
    splash: /Loading Kartavaya/.test(document.body.innerText),
    rootKids: document.getElementById('root')?.children.length ?? null,
    sheets: document.styleSheets.length,
    bodyFont: getComputedStyle(document.body).fontFamily.split(',')[0],
    inlineScripts: [...document.querySelectorAll('script:not([src])')].map((s) => s.textContent!.length),
    moduleScripts: [...document.querySelectorAll('script[src]')].map((s) => (s as HTMLScriptElement).src.slice(-40)),
  })).catch((e) => ({ error: String(e).slice(0, 200) }));

  // Does the API still accept this lane's token? Status only — never the token.
  const api = await page.evaluate(async () => {
    const t = localStorage.getItem('auth_token');
    if (!t) return { tokenPresent: false };
    const out: any = { tokenPresent: true, tokenLen: t.length };
    for (const p of ['/api/v1/auth/me', '/api/v1/graha/contacts?limit=1']) {
      try {
        const r = await fetch('https://api.kartavaya.com' + p, {
          headers: { Authorization: 'Bearer ' + t },
        });
        out[p] = r.status;
        if (!r.ok) out[p + ' body'] = (await r.text()).slice(0, 160);
      } catch (e: any) { out[p] = 'threw: ' + String(e.message).slice(0, 80); }
    }
    return out;
  }).catch((e) => ({ error: String(e).slice(0, 200) }));

  await page.waitForTimeout(6000);

  // ⚠ ASKED FROM INSIDE THE PAGE, which is the only client whose answer matters.
  // curl from this machine gets text/css for the same URL every time.
  const asset = await page.evaluate(async () => {
    const href = [...document.querySelectorAll('link[rel=stylesheet]')]
      .map((l) => (l as HTMLLinkElement).href);
    const out: any = { linked: href.map((h) => h.slice(-30)) };
    for (const h of href) {
      try {
        const r = await fetch(h, { cache: 'reload' });
        out[h.slice(-30)] = `${r.status} ${r.headers.get('content-type')}`;
      } catch (e: any) { out[h.slice(-30)] = 'threw ' + String(e.message).slice(0, 60); }
    }
    return out;
  }).catch((e) => ({ error: String(e).slice(0, 160) }));

  const csp = await page.evaluate(async () => {
    const r = await fetch(location.origin + '/', { cache: 'no-store' });
    return (r.headers.get('content-security-policy') || '(none)').slice(0, 400);
  }).catch(() => '(could not read)');

  console.log('\n════ DIAG ════');
  console.log('state      :', JSON.stringify(state, null, 2));
  console.log('api        :', JSON.stringify(api));
  console.log('asset      :', JSON.stringify(asset, null, 2));
  console.log('csp seen by the page:', csp);
  console.log('\nconsole errors/warnings:');
  console.log(console_.length ? console_.map((s) => '  ' + s).join('\n') : '  (none)');
  console.log('\nfailed requests:');
  console.log(failed.length ? failed.map((s) => '  ' + s).join('\n') : '  (none)');
  console.log('\ndocument/asset responses:');
  console.log(responses.length ? responses.map((s) => '  ' + s).join('\n') : '  (none)');
  console.log('══════════════\n');
});
