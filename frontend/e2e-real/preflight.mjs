#!/usr/bin/env node
/**
 * Is the deployed app actually BOOTABLE right now?
 *
 * ── WHY THIS EXISTS ────────────────────────────────────────────────────────
 * Two full suite runs on 2026-08-31 were thrown away because the app was mid
 * deploy. Suite 20 went 15/1 -> 3/13 and suite 18 13/1 -> 7/7, and every one of
 * those "failures" was `net::ERR_ABORTED`, a stuck "Loading Kartavaya" splash,
 * or a stylesheet served as text/html. Nothing was wrong with the product.
 *
 * The first guard tried was stamping the bundle hash before and after the run.
 * ⚠ THAT IS NECESSARY AND NOT SUFFICIENT: it came back STABLE across a run in
 * which every test still failed. Cloudflare Pages does not flip a deploy
 * atomically across edge nodes, so `index.html`, `/assets/*` and `_headers` can
 * each be a different generation for a while — and one curl from this machine
 * can hit an already-settled node while the browser hits a stale one.
 *
 * So this checks the thing that actually kills the app: the CSP in the SERVED
 * headers must admit the inline pre-paint bootstrap in the SERVED index.html.
 * When they disagree the browser silently refuses the script, React never
 * mounts, and every selector in every suite times out against a splash screen.
 *
 * `check-csp-hash.mjs` pins the same pair at BUILD time, against the repo. This
 * is its runtime twin: same invariant, asked of production.
 *
 * ⚠ Cloudflare injects its own `__CF$cv$` inline script whose hash changes on
 * every request. It is EXPECTED to be unlisted and must never be admitted with
 * 'unsafe-inline' (CLAUDE.md). Only the bootstrap is required to match, so this
 * asks whether AT LEAST ONE inline script is allowed rather than all of them.
 *
 *   node e2e-real/preflight.mjs [--host https://app.kartavaya.com] [--wait 300]
 *
 * Exit 0 = safe to run suites. Exit 1 = a run started now proves nothing.
 */
import { createHash } from 'node:crypto';

const arg = (k, d) => {
  const i = process.argv.indexOf(k);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : d;
};
const HOST = arg('--host', 'https://app.kartavaya.com').replace(/\/$/, '');
const WAIT_S = Number(arg('--wait', '0'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const sha256 = (s) => createHash('sha256').update(s, 'utf8').digest('base64');

async function probe() {
  const res = await fetch(`${HOST}/`, { cache: 'no-store' });
  const html = await res.text();
  const csp = res.headers.get('content-security-policy') || '';
  if (!csp) return { ok: false, why: 'no Content-Security-Policy header was served at all' };

  const allowed = new Set([...csp.matchAll(/'sha256-([A-Za-z0-9+/=]+)'/g)].map((m) => m[1]));
  if (!allowed.size) return { ok: false, why: 'the served CSP lists no sha256 hash' };

  // Inline scripts only — anything with src= is covered by 'self'.
  const inline = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)]
    .map((m) => m[1]);
  if (!inline.length) return { ok: false, why: 'the served index.html carries no inline script' };

  const matched = inline.filter((b) => allowed.has(sha256(b)));
  if (!matched.length) {
    return {
      ok: false,
      why: `NONE of the ${inline.length} inline script(s) in the served index.html is admitted by `
         + `the served CSP. The pre-paint bootstrap is being refused, so React never mounts and `
         + `every suite will time out against a "Loading Kartavaya" splash.\n`
         + `        served CSP allows : ${[...allowed].map((h) => `sha256-${h}`).join(', ')}\n`
         + `        page actually has : ${inline.map((b) => `sha256-${sha256(b)} (${b.length} chars)`).join('\n                            ')}`,
    };
  }

  // The assets index.html points at must be real files, not the SPA catch-all.
  // A Pages soft-404 answers 200 with text/html, which is why the status alone
  // proves nothing here (see docs/STATUS.md on the catch-all).
  const assets = [...html.matchAll(/\/assets\/[A-Za-z0-9_.-]+\.(?:js|css)/g)].map((m) => m[0]);
  for (const path of [...new Set(assets)].slice(0, 8)) {
    const a = await fetch(`${HOST}${path}`, { cache: 'no-store' });
    const ct = (a.headers.get('content-type') || '').toLowerCase();
    const want = path.endsWith('.css') ? 'css' : 'javascript';
    if (!a.ok || !ct.includes(want)) {
      return { ok: false, why: `${path} answered ${a.status} as "${ct}" — the deploy is still `
        + `propagating and this asset is being served the SPA fallback` };
    }
  }
  return { ok: true, assets: assets.length, bootstrap: matched.length };
}

/* ⚠ `process.exitCode` AND A `break`, NEVER `process.exit()` IN THIS LOOP.
   `process.exit()` here aborts Node on Windows with
   `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)` and the shell sees
   **127 instead of 1** — a gate that cannot report its own verdict. Found by
   mutation-testing this file against a host with no CSP, which is the only way
   it could have shown up: the happy path exits 0 and never trips it. */
const deadline = Date.now() + WAIT_S * 1000;
for (let attempt = 1; ; attempt += 1) {
  let r;
  try {
    r = await probe();
  } catch (e) {
    r = { ok: false, why: `${e.message}` };
  }
  if (r.ok) {
    console.log(`preflight: ok — bootstrap admitted by the served CSP, ${r.assets} asset(s) real`);
    process.exitCode = 0;
    break;
  }
  if (Date.now() >= deadline) {
    console.error(`\npreflight FAILED after ${attempt} attempt(s):\n  ${r.why}\n`);
    console.error('  A suite run started now would report the product as broken when it is the');
    console.error('  deploy. Wait for it to settle, or pass --wait <seconds> to poll.\n');
    process.exitCode = 1;
    break;
  }
  console.log(`preflight: not ready (${r.why.split('\n')[0]}) — retrying in 15s`);
  await sleep(15_000);
}
