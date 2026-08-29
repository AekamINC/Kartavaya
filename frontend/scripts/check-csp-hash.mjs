/**
 * check-csp-hash — the inline bootstrap script in index.html must be allowed
 * by the CSP in vercel.json AND by the one in public/_headers.
 *
 * TWO HOSTS, ONE RULE. `vercel.json` is live today; `public/_headers` is the
 * Cloudflare Pages half, inert until a Pages project serves this build. Both
 * are checked here and their hash sets must be identical — see the second
 * block below for what that cost when only one of them was covered.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 *
 * index.html carries ONE inline <script>. It runs before first paint and sets
 * three attributes on <html>:
 *
 *     data-theme          light / dark
 *     data-conv-pattern   } Sanvaad + Sahayak ground, so they don't paint the
 *     data-conv-ground    } default and snap to the user's choice at mount
 *     data-platform       win / mac / other — the sidebar, topbar and bottom
 *                         bar take flat ink on Windows because backdrop-filter
 *                         on a large always-visible surface is unreliable there
 *
 * `script-src 'self'` does NOT permit an inline script; it is allowed only by
 * its own sha256, hardcoded in vercel.json. Edit the script and the hash no
 * longer matches — the browser silently refuses to execute it, every load, for
 * every user. Nothing fails to build and nothing 500s. What you get is a frame
 * of the wrong theme, and on Windows a frame of blurred sidebar that snaps
 * solid: exactly the first-paint jump the script was written to prevent.
 *
 * That is what happened. Found 2026-08-26 by reading the console of the
 * deployed site rather than the source — the two hashes had drifted apart and
 * the bootstrap had been dead on staging for as long as the mismatch stood.
 *
 * Vite copies the inline script through verbatim (verified: the sha256 of
 * index.html's script equals the sha256 of the one served by
 * staging.kartavaya.com), so hashing the source file is sound and this check
 * needs no build step.
 *
 * Run: node scripts/check-csp-hash.mjs   (wired into `npm run check`)
 */
import { readFileSync, existsSync } from 'fs';
import { createHash } from 'crypto';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(root, 'index.html'), 'utf8');
const vercel = readFileSync(join(root, 'vercel.json'), 'utf8');

const inline = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]);
const allowed = new Set([...vercel.matchAll(/'sha256-([A-Za-z0-9+/=]+)'/g)].map(m => m[1]));

const sha = (s) => createHash('sha256').update(s, 'utf8').digest('base64');

let bad = 0;
for (const [i, body] of inline.entries()) {
  const h = sha(body);
  if (!allowed.has(h)) {
    bad++;
    console.error(`✗ inline <script> #${i} in index.html is NOT allowed by the CSP in vercel.json`);
    console.error(`  computed : 'sha256-${h}'`);
    console.error(`  vercel.json allows: ${[...allowed].map(a => `'sha256-${a}'`).join(', ') || '(none)'}`);
    console.error(`  Fix: replace the stale hash in vercel.json's Content-Security-Policy with the computed one.`);
    console.error(`  Do NOT add a comment to vercel.json to explain it — a "//" key kills the deploy with no logs.`);
  }
}

// An allowed hash matching no script is dead weight, and usually means someone
// edited the script and ADDED a hash rather than replacing the stale one.
const live = new Set(inline.map(sha));
for (const a of allowed) {
  if (!live.has(a)) {
    bad++;
    console.error(`✗ vercel.json allows 'sha256-${a}', which matches no inline script in index.html`);
    console.error(`  A stale allowance is not harmless: it hides the mismatch this check exists to catch.`);
  }
}

// ── THE SECOND HOST, which this gate did not cover and had to ────────────────
//
// `public/_headers` is the Cloudflare Pages half of the same CSP
// (docs/CLOUDFLARE-MIGRATION.md W2). It is INERT ON VERCEL — Vite copies
// `public/*` into `dist/` verbatim and Vercel ignores a file by that name — so
// it has shipped since 2026-08-16 with nothing reading it.
//
// MEASURED 2026-08-29: its script-src carried
// 'sha256-4pEVfXQ1F7eho+kcMi5Ain6DIWMGHPGjtPExuWptQ+I=', which matched no
// inline script in index.html — and, checked against the file as it stood on
// the day `_headers` was committed, had never matched one. Not drift. Wrong
// from the first line.
//
// The consequence is the reason this gate exists at all, arriving on a day
// nobody would be looking for it: the FIRST Cloudflare Pages deploy would
// silently refuse the pre-paint bootstrap — wrong-theme flash every load, and
// on Windows a frame of blurred sidebar — with a green build, no logs, and
// `docs/CLOUDFLARE-MIGRATION.md` recording that step as "✅ live header set
// reproduced". `frontend/scripts/` contained zero references to `_headers`, so
// `npm run check` passed and would have passed on cutover morning.
//
// This lives HERE rather than in a `check-cloudflare-headers.mjs` of its own on
// purpose. `docs/incident-side-rule-deleted` and the drawer-403 incident are
// both the same lesson: one rule in three files drifts, and the copy nobody
// runs is the one that is wrong. One gate, both hosts.
const headersPath = join(root, 'public', '_headers');
if (existsSync(headersPath)) {
  const headers = readFileSync(headersPath, 'utf8');
  const cfAllowed = new Set([...headers.matchAll(/'sha256-([A-Za-z0-9+/=]+)'/g)].map(m => m[1]));

  for (const [i, body] of inline.entries()) {
    const h = sha(body);
    if (!cfAllowed.has(h)) {
      bad++;
      console.error(`✗ inline <script> #${i} in index.html is NOT allowed by the CSP in public/_headers`);
      console.error(`  computed : 'sha256-${h}'`);
      console.error(`  _headers allows: ${[...cfAllowed].map(a => `'sha256-${a}'`).join(', ') || '(none)'}`);
      console.error(`  This file is inert on Vercel and live on Cloudflare Pages, so the failure`);
      console.error(`  it causes arrives on cutover day and looks like the migration broke the app.`);
    }
  }

  // The two hash SETS must be identical, not merely both satisfied. `_headers`
  // is allowed to differ from vercel.json in exactly three declared ways — the
  // corrected staging hostname, the Cloudflare analytics pair, and the inverted
  // rule order — and none of them is a script hash. Comparing the sets, rather
  // than checking each file against index.html separately, is what makes a NEW
  // hash added to one file and not the other a failure here instead of a white
  // screen there.
  const onlyVercel = [...allowed].filter(a => !cfAllowed.has(a));
  const onlyCf = [...cfAllowed].filter(a => !allowed.has(a));
  for (const a of onlyVercel) {
    bad++;
    console.error(`✗ 'sha256-${a}' is allowed in vercel.json but NOT in public/_headers`);
  }
  for (const a of onlyCf) {
    bad++;
    console.error(`✗ 'sha256-${a}' is allowed in public/_headers but NOT in vercel.json`);
  }
  if (onlyVercel.length || onlyCf.length) {
    console.error(`  The two hosts must allow the SAME scripts. They may differ in hosts and`);
    console.error(`  in rule order — see the header of public/_headers — never in hashes.`);
  }
} else {
  // Absence is reported, not passed over. A gate that silently covers nothing
  // when its input disappears is `check-rendered-ids` counting zero components:
  // green, and blind.
  console.warn(`check-csp-hash: note — public/_headers not found, so the Cloudflare CSP was NOT checked`);
}

if (bad) {
  console.error(`\ncheck-csp-hash: ${bad} problem(s). The pre-paint bootstrap would be blocked in the browser.`);
  process.exit(1);
}
console.log(`check-csp-hash: ok — ${inline.length} inline script(s), allowed by BOTH vercel.json and public/_headers`);
