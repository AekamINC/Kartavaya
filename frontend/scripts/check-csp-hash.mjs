/**
 * check-csp-hash — the shipped CSP in `public/_headers` must actually allow the
 * inline bootstrap in index.html, and must still carry the directives that four
 * separate incidents were caused by losing.
 *
 * ── 2026-08-30: VERCEL IS GONE, AND THIS GATE CHANGED SHAPE ─────────────────
 *
 * This used to check TWO files and require their hash sets to be identical:
 * `vercel.json` (live) and `public/_headers` (the Cloudflare half, then inert).
 * All four hosts now answer `Server: cloudflare` with no `x-vercel-*` header at
 * all, so `vercel.json` served nothing and was deleted — but it could not simply
 * be deleted, because THIS FILE READ IT UNCONDITIONALLY (`readFileSync`, no
 * existence check), and it is gate #1 of a 20-gate `&&` chain. Removing the file
 * without this rewrite would have thrown ENOENT and taken `npm run check` down
 * entirely.
 *
 * ⚠ AND DELETING IT NAIVELY WOULD HAVE COST MORE THAN THE FILE. The two-host
 * comparison is what caught, on 2026-08-29:
 *
 *   · `Permissions-Policy: camera=()` where the policy needs `camera=(self)`
 *     — the EXACT Pahchan defect fixed in d47adafc that same morning. The
 *     cutover would have switched the attendance camera off again.
 *   · every Mappls host missing from script-src, style-src, style-src-elem and
 *     connect-src, so territory maps would not have drawn.
 *   · `worker-src 'self' blob:` absent entirely.
 *   · a script hash that had NEVER matched — not drift, wrong from the first
 *     line.
 *
 * With one host there is no second file to disagree with, so the comparison is
 * replaced by an EXPLICIT REQUIRED SET pinned below. That is strictly better
 * than what it replaces: the old check proved the two files agreed, which two
 * files can do while both being wrong. This one states what must be true.
 *
 * ── Why the hash half exists ────────────────────────────────────────────────
 *
 * index.html carries ONE inline <script>. It runs before first paint and sets
 * `data-theme`, `data-conv-pattern`, `data-conv-ground` and `data-platform` on
 * <html>. `script-src 'self'` does NOT permit an inline script; it is allowed
 * only by its own sha256. Edit the script and the hash no longer matches — the
 * browser silently refuses to execute it, every load, for every user. Nothing
 * fails to build and nothing 500s. What you get is a frame of the wrong theme,
 * and on Windows a frame of blurred sidebar that snaps solid.
 *
 * Found 2026-08-26 by reading the console of the deployed site rather than the
 * source. Vite copies the inline script through verbatim, so hashing the source
 * is sound and this needs no build step.
 *
 * ⚠ A SECOND inline script appears in production and is NOT ours: Cloudflare
 * injects `__CF$cv$…`, which carries a per-request token and therefore hashes
 * differently on every single load. It can never be allowed by hash and its
 * console error is expected. Verified 2026-08-30 — production /login serves two
 * inline scripts, ours at the allowed hash and Cloudflare's at a varying one.
 * Do not chase it, and do NOT add 'unsafe-inline' to silence it.
 *
 * Run: node scripts/check-csp-hash.mjs   (gate #1 of `npm run check`)
 */
import { readFileSync, existsSync } from 'fs';
import { createHash } from 'crypto';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(root, 'index.html'), 'utf8');

const inline = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]);
const sha = (s) => createHash('sha256').update(s, 'utf8').digest('base64');

let bad = 0;

// ── The directives that must survive, each one an incident ───────────────────
//
// Pinned HERE rather than in a second file on purpose. `docs/incident-side-rule-
// deleted` and the drawer-403 incident are the same lesson: one rule in three
// files drifts, and the copy nobody runs is the one that is wrong.
const MAPPLS = ['https://sdk.mappls.com', 'https://apis.mappls.com'];
const REQUIRED_SOURCES = {
  'script-src': ["'self'", ...MAPPLS],
  'style-src': ["'self'", "'unsafe-inline'", ...MAPPLS],
  'style-src-elem': ["'self'", "'unsafe-inline'", ...MAPPLS],
  // Territory maps fetch tiles; without these the map draws nothing and throws
  // no error a user could report.
  'connect-src': ["'self'", 'https://api.kartavaya.com', ...MAPPLS],
  // Absent entirely on 2026-08-29. The PDF and image workers need it.
  'worker-src': ["'self'", 'blob:'],
  'object-src': ["'none'"],
  'frame-ancestors': ["'none'"],
  'default-src': ["'self'"],
};
//: One character between the attendance camera working and not.
const REQUIRED_PERMISSIONS = ['geolocation=(self)', 'microphone=()', 'camera=(self)'];

const headersPath = join(root, 'public', '_headers');

// ⚠ ABSENCE IS A FAILURE, NEVER A PASS. This is the repository's most-repeated
// defect: `check-rendered-ids` reported "596 components, no id drawn" on a tree
// with three client UUIDs on screen; `check-table-rows` reported "13 table
// classes, all on var(--row-h)" with eleven screens off the token. A gate that
// silently covers nothing reads as coverage. `_headers` IS the shipped policy
// now — there is no second file to fall back to — so its absence is fatal.
if (!existsSync(headersPath)) {
  console.error('✗ public/_headers is missing. It is the ONLY shipped CSP now that Vercel is gone,');
  console.error('  so this gate cannot verify anything and the deployed site would carry no policy.');
  process.exit(1);
}

const headers = readFileSync(headersPath, 'utf8');

// ⚠ COMMENTS ARE STRIPPED BEFORE ANYTHING IS MATCHED, and the first version of
// this block was a regex over raw text that promptly matched the explanatory
// comment above the very fix it was checking. `_headers` documents `camera=()`
// as the defect it used to carry, so a naive match reads the warning as policy.
const cfBody = headers.replace(/^#.*$/gm, '');

// ⚠ `\\s`, NOT `\s`. Inside a template literal `\s` collapses to a bare `s`, so
// an earlier version read `^s+Content-Security-Policy:s*(.+)$`, matched nothing,
// returned null, and every comparison below silently skipped. Three mutations
// were run against that version and ALL THREE CAME BACK GREEN.
const cfValue = (key) => {
  const m = cfBody.match(new RegExp(`^\\s+${key}:\\s*(.+)$`, 'm'));
  return m ? m[1].trim() : null;
};

const asDirectives = (policy) => {
  if (!policy) return null;
  const out = new Map();
  for (const part of policy.split(';')) {
    const bits = part.trim().split(/\s+/).filter(Boolean);
    if (bits.length) out.set(bits[0], new Set(bits.slice(1)));
  }
  return out;
};

const csp = cfValue('Content-Security-Policy');
const perm = cfValue('Permissions-Policy');
const policy = asDirectives(csp);

for (const [what, got] of [['Content-Security-Policy', csp], ['Permissions-Policy', perm]]) {
  if (!got) {
    bad++;
    console.error(`✗ could not read ${what} from public/_headers — this check cannot do its job`);
  }
}

// ── 1 · the inline bootstrap must be allowed ─────────────────────────────────
if (policy) {
  const allowed = new Set(
    [...(policy.get('script-src') || [])]
      .map(s => s.match(/^'sha256-([A-Za-z0-9+/=]+)'$/)?.[1])
      .filter(Boolean),
  );
  for (const [i, body] of inline.entries()) {
    const h = sha(body);
    if (!allowed.has(h)) {
      bad++;
      console.error(`✗ inline <script> #${i} in index.html is NOT allowed by public/_headers`);
      console.error(`  computed : 'sha256-${h}'`);
      console.error(`  allowed  : ${[...allowed].map(a => `'sha256-${a}'`).join(', ') || '(none)'}`);
      console.error(`  The pre-paint bootstrap would be refused in every browser, every load:`);
      console.error(`  a frame of the wrong theme, and on Windows a blurred sidebar that snaps solid.`);
    }
  }
  // A stale allowance usually means someone edited the script and ADDED a hash
  // rather than replacing it — which hides the mismatch this gate exists to catch.
  const live = new Set(inline.map(sha));
  for (const a of allowed) {
    if (!live.has(a)) {
      bad++;
      console.error(`✗ public/_headers allows 'sha256-${a}', which matches no inline script in index.html`);
      console.error(`  A stale allowance is not harmless: it hides the next mismatch.`);
    }
  }
}

// ── 2 · every directive an incident was caused by losing ─────────────────────
if (policy) {
  for (const [directive, required] of Object.entries(REQUIRED_SOURCES)) {
    const got = policy.get(directive);
    if (!got) {
      bad++;
      console.error(`✗ CSP directive '${directive}' is MISSING from public/_headers`);
      continue;
    }
    const missing = required.filter(x => !got.has(x));
    if (missing.length) {
      bad++;
      console.error(`✗ CSP '${directive}' is missing: ${missing.join(' ')}`);
      if (missing.some(m => m.includes('mappls'))) {
        console.error(`  Territory maps draw NOTHING without these, and throw no error a user could report.`);
      }
    }
  }
}

// ── 3 · the camera, which is one character ───────────────────────────────────
if (perm) {
  const missing = REQUIRED_PERMISSIONS.filter(p => !perm.replace(/\s+/g, '').includes(p.replace(/\s+/g, '')));
  if (missing.length) {
    bad++;
    console.error(`✗ Permissions-Policy is missing: ${missing.join(', ')}`);
    console.error(`  got: ${perm}`);
    console.error(`  camera=() vs camera=(self) is one character and it is the difference`);
    console.error(`  between the Pahchan attendance camera working and not (d47adafc).`);
  }
}

// ── 4 · Cloudflare JOINS a repeated header, it does not override ─────────────
//
// Its own docs give `X-Robots-Tag: nosnippet, noindex` as the example. So a
// Cache-Control on a narrower path APPENDS to the catch-all, and /assets/* ends
// up uncacheable. The detach line is what makes the override real.
const assetsBlock = headers.match(/^\/assets\/\*[^\n]*\n((?:[ \t]+[^\n]*\n?)*)/m)?.[1] || '';
if (/Cache-Control:/i.test(assetsBlock) && !/^\s*!\s*Cache-Control\s*$/mi.test(assetsBlock)) {
  bad++;
  console.error(`✗ public/_headers sets Cache-Control on /assets/* without detaching it first`);
  console.error(`  Cloudflare JOINS a header applied twice — it does not override.`);
  console.error(`  /assets/* would re-download every asset, for ever.`);
  console.error(`  Fix: put a "! Cache-Control" line above it, per Cloudflare's detach syntax.`);
}

// ── 5 · vercel.json must stay gone ───────────────────────────────────────────
//
// Not tidiness. A file that looks like configuration and is served by nothing is
// how a rule comes to be maintained in the copy nobody reads — and this one
// carried a full CSP, so re-adding it recreates two sources of truth for the
// policy that decides whether the app boots.
if (existsSync(join(root, 'vercel.json'))) {
  bad++;
  console.error(`✗ frontend/vercel.json is back. Vercel serves nothing — all four hosts answer`);
  console.error(`  "Server: cloudflare" with no x-vercel-* header. public/_headers is the shipped`);
  console.error(`  policy; a second copy is a rule maintained where nobody reads it.`);
}

if (bad) {
  console.error(`\ncheck-csp-hash: ${bad} problem(s).`);
  process.exit(1);
}
console.log(
  `check-csp-hash: ok — ${inline.length} inline script(s) allowed by public/_headers, ` +
  `all required directives present`,
);
