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
 *   4. `src/lib` is scanned as well as `src/styles`. It was not, and
 *      `src/lib/tokens.css` — the legacy compatibility layer, ~90 declarations
 *      and ~40 references — was therefore invisible to this script in BOTH
 *      directions. Its declarations did not count, so anything in src/styles
 *      relying on a name it owns would have been reported undefined; and its
 *      own `var()` references were never checked at all, so it could reference
 *      a token that does not exist and the build would stay green. That is the
 *      exact failure mode this script exists to catch, in the one file whose
 *      entire job is aliasing one token layer onto another.
 *
 * ── PASS 2 · THEME PARITY, AND WHY IT IS HERE RATHER THAN IN check-contrast ──
 *
 * There are TWO ways to reference a token that resolves to nothing, and pass 1
 * only catches the first:
 *
 *   · the name is declared nowhere            → pass 1, above
 *   · the name is declared in ONE theme only  → pass 2, below
 *
 * The second has the identical end state — var() yields the guaranteed-invalid
 * value and the browser drops the whole declaration — but pass 1 cannot see it,
 * because the NAME is declared, just not on the path the other theme takes.
 *
 * check-contrast.mjs computes exactly this list and prints it. MEASURED
 * 2026-08-06: it does not fail on it. Deleting `--shadow-bubble` from the dark
 * block made it print `MISSING IN DARK  --shadow-bubble` and exit 0 — the
 * `failed = true` it sets at that point is never read again, and the final exit
 * considers only new/regressed contrast pairs. So the half of bug-class 4 that
 * a reviewer is most likely to hit (add a token, forget the dark block) was
 * reported into a wall of contrast output and gated by nothing.
 *
 * Rather than change a script this run does not own, the gate goes here, where
 * it belongs anyway: this file is the one that exists to make an unresolvable
 * var() a build failure. It reported ZERO on a clean tree at the moment it was
 * added, so it went up as a gate rather than as a warning people scroll past.
 *
 * The universal-selector rule is copied from check-contrast's selectorThemes()
 * and for the same reason it documents: the codebase writes
 * `:root, [data-theme="light"] { … }`, and `:root` matches <html> in BOTH
 * themes — the `[data-theme="light"]` half only raises specificity. Reading
 * that list as light-only manufactures nine failures against tokens that are
 * fine. A block is theme-scoped only when EVERY part of its selector list
 * demands a theme.
 *
 * Usage: node scripts/check-tokens.mjs
 */
import { readFileSync, readdirSync, existsSync, statSync } from 'fs';
import { join, extname } from 'path';

/** Every directory that may declare a token. Order is irrelevant: custom
 *  properties resolve at computed-value time, not parse time. */
const STYLE_DIRS = ['src/styles', 'src/lib'];
const STYLE_DIR = STYLE_DIRS[0];
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

const cssFiles = STYLE_DIRS.filter((d) => existsSync(d)).flatMap((d) =>
  readdirSync(d).filter((f) => f.endsWith('.css')).map((f) => join(d, f))
);
if (!cssFiles.length) {
  console.error(`check-tokens: no .css files in ${STYLE_DIRS.join(', ')}.`);
  process.exit(1);
}
const css = stripComments(cssFiles.map((f) => readFileSync(f, 'utf8')).join('\n'));

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

/* ── Pass 2 · theme parity ────────────────────────────────────────────────
 * Innermost declaration blocks only. `[^{}]+\{[^{}]*\}` cannot match an
 * at-rule wrapper, because the wrapper's body contains a `{` that the
 * declaration group excludes — so `@media … { .a { … } }` yields `.a` with the
 * right body, and the at-rule's condition is skipped rather than mis-parsed.
 * Verified there is no CSS nesting in these directories (`grep '^\s*&'` over
 * src/styles and src/lib: no matches), which is what makes that safe.
 */
const themed = { light: new Map(), dark: new Map() };
/** Declared from a block that applies in both themes — a token here always has
 *  a value on both paths, whatever the theme-scoped blocks add on top. */
const universalTokens = new Set();

for (const file of cssFiles) {
  const text = stripComments(readFileSync(file, 'utf8'));
  for (const block of text.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const parts = block[1].split(',').map((s) => s.trim()).filter(Boolean);
    let universal = false, anyDark = false, anyLight = false;
    for (const p of parts) {
      if (/\[data-theme=["']?dark["']?\]/.test(p)) anyDark = true;
      else if (/\[data-theme=["']?light["']?\]/.test(p)) anyLight = true;
      else if (/(^|\s|>)(:root|html|body)(?![\w-])/.test(p) || p === '*') universal = true;
    }
    const props = [...block[2].matchAll(/(--[\w-]+)\s*:/g)].map((d) => d[1]);
    if (!props.length) continue;
    if (universal || (anyDark && anyLight)) {
      for (const prop of props) universalTokens.add(prop);
      continue;
    }
    // Theme-agnostic and not a root block: `.k-surface-theme { --s-low: … }`
    // and friends. They cannot be a ONE-THEME declaration, so they are not this
    // pass's business — the scoped map is complete or it is not, in both themes
    // alike.
    if (!anyDark && !anyLight) continue;
    const theme = anyDark ? 'dark' : 'light';
    for (const prop of props) {
      if (!themed[theme].has(prop)) themed[theme].set(prop, file.replace(/\\/g, '/'));
    }
  }
}

const parity = [];
for (const theme of ['light', 'dark']) {
  const other = theme === 'light' ? 'dark' : 'light';
  for (const [token, file] of themed[theme]) {
    if (themed[other].has(token)) continue;
    // A universal declaration elsewhere already gives the other theme a value.
    if (universalTokens.has(token)) continue;
    parity.push({ token, theme, other, file });
  }
}

for (const p of parity) {
  console.error(
    `MISSING IN ${p.other.toUpperCase().padEnd(5)}  ${p.token}  — declared only in ${p.theme} (${p.file})`
  );
}
if (parity.length) {
  console.error(
    `\ncheck-tokens: ${parity.length} token(s) declared in one theme only. In the other theme ` +
    `var() resolves to nothing and the whole declaration is dropped — same end state as an ` +
    `undefined token, silently. Declare the missing half.`
  );
  process.exit(1);
}

console.log(
  `check-tokens: ${declared.size} declared, ${referenced.size} referenced, 0 missing; ` +
  `${themed.light.size} light-only / ${themed.dark.size} dark-only declarations, 0 unpaired`
);
