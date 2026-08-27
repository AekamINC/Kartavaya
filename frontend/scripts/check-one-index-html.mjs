/**
 * check-one-index-html — nothing may shadow the Vite entry from `publicDir`.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 *
 * `frontend/public/index.html` sat beside the real one until 2026-08-27. It was
 * a Create-React-App leftover: a complete HTML document with `<div id="root">`,
 * **no script tag**, the OLD brand colour `#0082c6`, no `viewport-fit=cover`,
 * no manifest link, and none of the pre-paint theme bootstrap that
 * `check-csp-hash` exists to protect.
 *
 * Vite copies everything in `publicDir` to the output root and then writes the
 * built `index.html` over it, so the root file wins — verified empirically on
 * 2026-08-27 by building and reading `dist/index.html`, which carries the
 * module script and the bootstrap. Today it is harmless.
 *
 * IT IS THE FAILURE MODE THAT IS NOT HARMLESS. A file whose only protection is
 * the order of two build steps is a blank white page one Vite upgrade away, and
 * it would arrive the way this project's worst deploys always do: nothing fails
 * to build, nothing 500s, and the site serves a document with no bundle in it.
 * `vercel.json`'s `"//"` key killed a deploy with no logs; the CSP hash drifted
 * and the bootstrap was dead on staging for days. Same species.
 *
 * The second reason is duller and just as real: two files named index.html, one
 * carrying the wrong theme colour, is a thing a person edits by accident.
 *
 * ── WHY THIS DOES NOT WALK THE TREE ─────────────────────────────────────────
 *
 * The first draft recursed from the frontend root and reported five files. Not
 * one was the bug: `android/app/src/main/assets/public/index.html` is the
 * Capacitor wrapper's own entry, its sibling under `android/app/build/` is a
 * Gradle intermediate, and `build/`, `__measure/` and `__verify/` are output
 * and scratch directories. A check that has to maintain a list of five
 * exemptions to say one true thing is a check that will be silenced the first
 * time it is inconvenient.
 *
 * The invariant is narrow, so the check is narrow: `publicDir` is the ONLY
 * directory whose contents land at the output root beside the entry, so it is
 * the only place a shadowing index.html can come from.
 *
 * Run: node scripts/check-one-index-html.mjs   (wired into `npm run check`)
 */
import { existsSync, readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// `publicDir` is Vite's default unless vite.config sets otherwise. Read it
// rather than assume, so renaming the directory does not silently retire this.
let publicDir = 'public';
try {
  const cfg = readFileSync(join(root, 'vite.config.js'), 'utf8');
  const m = cfg.match(/publicDir\s*:\s*['"]([^'"]+)['"]/);
  if (m) publicDir = m[1];
} catch { /* no config, or not readable — the default stands */ }

const entry = join(root, 'index.html');
if (!existsSync(entry)) {
  console.error('check-one-index-html: no index.html at the frontend root — ' +
                'Vite has no entry and the build cannot produce a page.');
  process.exit(1);
}

const shadow = join(root, publicDir, 'index.html');
if (existsSync(shadow)) {
  console.error(
    `check-one-index-html: ${publicDir}/index.html shadows the Vite entry.\n\n` +
    `Everything in ${publicDir}/ is copied to the output root. The built entry\n` +
    'is written over it afterwards, so the root file wins TODAY — by build-step\n' +
    'ordering and nothing else. If that ordering ever changes, the site serves a\n' +
    'page with no script tag: green build, no logs, blank screen.\n\n' +
    `Delete ${publicDir}/index.html. If it is genuinely needed, say why in this\n` +
    'file and exempt it deliberately.',
  );
  process.exit(1);
}

console.log(`check-one-index-html: one entry at the root, nothing shadowing it from ${publicDir}/.`);
