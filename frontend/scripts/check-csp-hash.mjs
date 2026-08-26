/**
 * check-csp-hash — the inline bootstrap script in index.html must be allowed
 * by the CSP in vercel.json.
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
import { readFileSync } from 'fs';
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

if (bad) {
  console.error(`\ncheck-csp-hash: ${bad} problem(s). The pre-paint bootstrap would be blocked in the browser.`);
  process.exit(1);
}
console.log(`check-csp-hash: ok — ${inline.length} inline script(s), each allowed by the CSP`);
