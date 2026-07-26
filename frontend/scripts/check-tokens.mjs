/**
 * check-tokens.mjs — every var(--x) asserted against every --x declared.
 *
 * From `design-handover/25-qa-acceptance.md` §1. Eight defects in the design
 * phase were this one bug: a token referenced everywhere and declared nowhere.
 * An unresolved var() returns an empty string and CSS drops the whole
 * declaration — no console warning, no visible error, just a component missing
 * its shadow, its status colour, or its Devanagari font.
 *
 * A fallback is reported separately and still fails. `var(--x, #fff)` converts a
 * loud failure into a silent wrong colour, which is worse: --on-warn-container
 * stayed undefined for weeks while light mode looked fine, purely on its
 * fallback. Never give an on-* token a fallback.
 *
 * TWO DEVIATIONS FROM THE SCRIPT AS WRITTEN IN `25`, both because it reported
 * 28 failures on a clean tree — and `25` §1 is itself the file that warns a
 * broken instrument is worse than none:
 *
 *   1. The declaration regex was anchored with `^`, so it only saw the FIRST
 *      declaration on a line. This codebase packs the ramps onto single lines
 *      (`--sp-1: 4px;  --sp-2: 8px;  …`, and `--warn: …;  --warn-container: …;`),
 *      so --sp-2..8, --pad-card, --pad-page and the three *-container tokens all
 *      read as undefined while being declared one column to the right. Dropping
 *      the anchor is safe: `var(--x)` and `var(--x, y)` have no colon after the
 *      name, so a reference can never match a declaration pattern.
 *
 *   2. Tokens set inline from JSX — `style={{ '--c': colour }}` — are declared
 *      in JavaScript, not CSS. StatusChip, AccentGrid, TypePreview and others
 *      drive per-instance colour that way, which is the correct pattern for a
 *      value that varies per element. A CSS-only scan cannot see them, so this
 *      also reads .jsx/.js for quoted custom-property keys.
 *
 *   3. Comments are stripped first. Both remaining "undefined" reports after
 *      fixing 1 and 2 were prose: kartavaya-design.css documents a past sweep
 *      for `var(--x)`, and Tag.jsx's docblock warns against `var(--info)` by
 *      naming it. A checker that fails on its own documentation teaches people
 *      to stop writing documentation.
 *
 * Usage: node scripts/check-tokens.mjs
 */
import { readFileSync, readdirSync, existsSync, statSync } from 'fs';
import { join, extname } from 'path';

const STYLE_DIR = 'src/styles';
const SRC_DIR = 'src';

if (!existsSync(STYLE_DIR)) {
  console.error(`check-tokens: ${STYLE_DIR} not found — run from the frontend/ directory.`);
  process.exit(1);
}

/**
 * Strip comments so prose about a token is not mistaken for a use of it.
 * Line comments only when `//` is not preceded by `:`, which leaves `https://`
 * and other protocol-relative URLs intact.
 */
function stripComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

const cssFiles = readdirSync(STYLE_DIR).filter((f) => f.endsWith('.css'));
if (!cssFiles.length) {
  console.error(`check-tokens: no .css files in ${STYLE_DIR}.`);
  process.exit(1);
}
const css = stripComments(cssFiles.map((f) => readFileSync(join(STYLE_DIR, f), 'utf8')).join('\n'));

/** Every .jsx/.js under src/, so inline custom properties are visible. */
function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '__tests__') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (['.jsx', '.js'].includes(extname(entry))) out.push(full);
  }
  return out;
}
const script = stripComments(walk(SRC_DIR).map((f) => readFileSync(f, 'utf8')).join('\n'));

// No `^` anchor — see deviation 1. A reference never has a colon after the name.
const declared = new Set([...css.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]));

// Inline from JSX: { '--c': x } or { "--pv-fs": y }. See deviation 2.
for (const m of script.matchAll(/['"](--[\w-]+)['"]\s*:/g)) declared.add(m[1]);

const referenced = new Map();
for (const m of css.matchAll(/var\(\s*(--[\w-]+)\s*(,|\))/g)) {
  const key = m[1];
  const hasFallback = m[2] === ',';
  // Masked only if EVERY reference carries a fallback. One bare reference is
  // enough to make it a hard failure.
  const cur = referenced.get(key) || { fallback: true };
  referenced.set(key, { fallback: cur.fallback && hasFallback });
}
// References from inline styles count too — they fail the same way.
for (const m of script.matchAll(/var\(\s*(--[\w-]+)\s*(,|\))/g)) {
  const key = m[1];
  const hasFallback = m[2] === ',';
  const cur = referenced.get(key) || { fallback: true };
  referenced.set(key, { fallback: cur.fallback && hasFallback });
}

const missing = [...referenced].filter(([k]) => !declared.has(k));
const hidden = missing.filter(([, v]) => v.fallback);
const hard = missing.filter(([, v]) => !v.fallback);

for (const [k] of hard) console.error(`UNDEFINED  ${k}`);
for (const [k] of hidden) console.error(`UNDEFINED (masked by fallback)  ${k}`);

if (missing.length) {
  console.error(
    `\ncheck-tokens: ${hard.length} undefined, ${hidden.length} masked by a fallback. ` +
    `Declare them in src/styles, or delete the reference.`
  );
  process.exit(1);
}

console.log(`check-tokens: ${declared.size} declared, ${referenced.size} referenced, 0 missing`);
