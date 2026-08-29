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

  // ── EVERY DIRECTIVE, not just the hashes ───────────────────────────────────
  //
  // The hash was one of FOUR ways the hand-written `_headers` had drifted from
  // `vercel.json`, and on its own it is the least expensive of them. Measured
  // 2026-08-29, before this block existed:
  //
  //   · `Permissions-Policy: camera=()` where vercel.json says `camera=(self)`
  //     — the EXACT Pahchan defect fixed in d47adafc that same morning. The
  //     cutover would have switched the attendance camera off again, on
  //     Cloudflare only, hours after it was fixed on Vercel.
  //   · every Mappls host missing from script-src, style-src, style-src-elem
  //     and connect-src, so territory maps would not have drawn.
  //   · `worker-src 'self' blob:` absent entirely.
  //
  // A gate that checked only the hash would have passed all three. So the two
  // policies are compared DIRECTIVE BY DIRECTIVE, and the only differences
  // permitted are the two host swaps declared below — which are also the only
  // two the file's own header claims.
  const SWAPS = [
    ['https://va.vercel-scripts.com', 'https://static.cloudflareinsights.com'],
    ['https://vitals.vercel-insights.com', 'https://cloudflareinsights.com'],
  ];

  // ⚠ THE VALUES ARE PARSED, NOT REGEXED OUT OF THE RAW TEXT — and the first
  // version of this block WAS a regex over raw text, which promptly matched the
  // explanatory comment written above the very fix it was checking. That is a
  // named failure in this repository (`test_approvals_router_org_scope` strips
  // comments for the same reason). `_headers` documents `camera=()` as the
  // defect it used to carry, so a naive match reads the warning as the policy.
  //
  // So: vercel.json is parsed as JSON, and `_headers` has its `#` comment lines
  // removed before anything is matched.
  const headerValue = (key) => {
    const v = JSON.parse(vercel);
    for (const rule of v.headers || []) {
      for (const h of rule.headers || []) {
        if (h.key === key) return h.value;
      }
    }
    return null;
  };
  const cfBody = headers.replace(/^#.*$/gm, '');
  // ⚠ `\\s`, NOT `\s`. Inside a TEMPLATE LITERAL a `\s` collapses to a bare
  // `s`, so this read `^s+Content-Security-Policy:s*(.+)$`, matched nothing and
  // returned null — and every comparison below then skipped, leaving the check
  // reporting ok. Three mutations were run against that version (camera=(),
  // Mappls hosts deleted, worker-src deleted) and ALL THREE CAME BACK GREEN.
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

  const vPolicy = asDirectives(headerValue('Content-Security-Policy'));
  const cPolicy = asDirectives(cfValue('Content-Security-Policy'));
  const vPerm = headerValue('Permissions-Policy');
  const cPerm = cfValue('Permissions-Policy');

  // ⚠ NOT BEING ABLE TO READ A POLICY IS A FAILURE, NEVER A PASS.
  //
  // Silence is what let those three mutations through, and it is this
  // repository's most-repeated defect rather than a one-off:
  // `check-rendered-ids` reported "596 components, no id drawn" on a tree with
  // three client UUIDs on screen; `check-table-rows` reported "13 table classes,
  // all on var(--row-h)" with eleven screens off the token. A gate that
  // silently covers nothing is worse than no gate, because it reads as
  // coverage. So absence is loud here.
  for (const [what, got] of [
    ['vercel.json CSP', vPolicy], ['_headers CSP', cPolicy],
    ['vercel.json Permissions-Policy', vPerm], ['_headers Permissions-Policy', cPerm],
  ]) {
    if (!got) {
      bad++;
      console.error(`✗ could not read the ${what} — this check cannot do its job`);
    }
  }

  // ── EVERY DIRECTIVE, not only the hashes ───────────────────────────────────
  //
  // The hash was one of FOUR ways the hand-written `_headers` had drifted, and
  // on its own the least expensive. Measured 2026-08-29:
  //   · `Permissions-Policy: camera=()` where vercel.json says `camera=(self)`
  //     — the EXACT Pahchan defect fixed in d47adafc that same morning.
  //   · every Mappls host missing from script-src, style-src, style-src-elem
  //     and connect-src, so territory maps would not draw.
  //   · `worker-src 'self' blob:` absent entirely.
  // A gate checking only the hash passes all three.
  if (vPolicy && cPolicy) {
    for (const [from, to] of SWAPS) {
      for (const set of vPolicy.values()) {
        if (set.delete(from)) set.add(to);
      }
    }
    for (const d of [...new Set([...vPolicy.keys(), ...cPolicy.keys()])].sort()) {
      const a = vPolicy.get(d) || new Set();
      const b = cPolicy.get(d) || new Set();
      const missing = [...a].filter(x => !b.has(x));
      const extra = [...b].filter(x => !a.has(x));
      if (missing.length || extra.length) {
        bad++;
        console.error(`✗ CSP directive '${d}' differs between the two hosts`);
        if (missing.length) console.error(`  missing from _headers : ${missing.join(' ')}`);
        if (extra.length) console.error(`  extra in _headers     : ${extra.join(' ')}`);
      }
    }
  }

  if (vPerm && cPerm && vPerm !== cPerm) {
    bad++;
    console.error(`✗ Permissions-Policy differs between the two hosts`);
    console.error(`  vercel.json : ${vPerm}`);
    console.error(`  _headers    : ${cPerm}`);
    console.error(`  camera=() vs camera=(self) is one character and it is the`);
    console.error(`  difference between the attendance camera working and not.`);
  }

  // Cloudflare JOINS a header applied twice — its own docs, and the example
  // given there is `X-Robots-Tag: nosnippet, noindex`. So a Cache-Control on a narrower
  // path does NOT override the catch-all, it appends to it, and /assets/* ends
  // up uncacheable. The detach line is what makes the override real.
  const assetsBlock = headers.match(/^\/assets\/\*[^\n]*\n((?:[ \t]+[^\n]*\n?)*)/m)?.[1] || '';
  if (/Cache-Control:/i.test(assetsBlock) && !/^\s*!\s*Cache-Control\s*$/mi.test(assetsBlock)) {
    bad++;
    console.error(`✗ public/_headers sets Cache-Control on /assets/* without detaching it first`);
    console.error(`  Cloudflare JOINS a header applied twice — it does not override.`);
    console.error(`  /assets/* would serve "no-cache, no-store, must-revalidate, public,`);
    console.error(`  max-age=31536000, immutable" and re-download every asset, for ever.`);
    console.error(`  Fix: put a "! Cache-Control" line above it, per Cloudflare's detach syntax.`);
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
