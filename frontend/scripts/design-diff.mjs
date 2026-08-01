/**
 * design-diff — what the build says versus what the design source says.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 *
 * "Pixel perfect" was the instruction and screenshots were the method, which is
 * how a whole-product defect survived: the design's page header sets
 * `.ph__hi { font-size: 1em }` and `.ph__en { font-size: .56em }` — the
 * Devanagari IS the title — and the build shipped the inverse on 33 of 42
 * pages. Nobody spots a 1em/0.56em swap by eye. It is obvious in a diff.
 *
 * The design source is CSS. So compare CSS to CSS, and stop guessing.
 *
 * ── What it compares ────────────────────────────────────────────────────────
 *
 * Both sides are parsed into `selector -> { property: value }`. For every
 * selector the reference defines, three things can be true:
 *
 *   MISSING    the reference styles it, the build has no rule at all
 *   DIFFERENT  both style it, and at least one declaration disagrees
 *   MATCH      every declaration the reference sets, the build sets the same
 *
 * Only declarations the REFERENCE sets are compared. The build is allowed to
 * add its own — dark-mode overrides, focus rings, reduced-motion branches —
 * and adding is not drift. Contradicting is.
 *
 * ── What it deliberately ignores ────────────────────────────────────────────
 *
 * Values are normalised before comparison, because these are not differences:
 *
 *   · whitespace, and `0.5em` vs `.5em`
 *   · colour case, `#FFF` vs `#fff`
 *   · a var() the build resolves to the same literal the reference hardcodes —
 *     the build uses tokens by design, so `var(--primary)` matching `#04837A`
 *     is CORRECT and must not be reported as drift. The token table is loaded
 *     and used to resolve both sides before comparing.
 *
 * Selectors are compared by NAME. Where the build deliberately renamed a
 * component the pair is declared in RENAMES below, so the comparison follows
 * the rename instead of reporting the old name missing and the new name
 * unmatched.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname, basename } from 'node:path';

const ROOT = new URL('../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const REF = join(ROOT, 'design-reference', 'Kartavaya Redesign');
const SRC = join(ROOT, 'frontend', 'src', 'styles');

/**
 * Components the build renamed on purpose.
 *
 * The build prefixes its own components `k-`; the reference does not. Where a
 * rule was carried across under a new name, saying so here keeps the diff
 * honest — otherwise every renamed component reads as both "missing" and
 * "extra", which buries the real drift in noise.
 */
const RENAMES = {
  'ph': 'k-pageh',
  'ph__kick': 'k-pageh__kicker',
  'ph__hi': 'k-pageh__sans',
  'ph__en': 'k-pageh__en',
  'ph__h1': 'k-pageh__h1',
  'ph__lede': 'k-pageh__lede',
  'ph__txt': 'k-pageh__txt',
  'ph__act': 'k-pageh__right',
};

// Declarations that are presentation plumbing, not design intent.
const IGNORE_PROPS = new Set([
  'content', '-webkit-font-smoothing', '-moz-osx-font-smoothing',
  'box-sizing', 'appearance', '-webkit-appearance',
]);

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (extname(p) === '.css') out.push(p);
  }
  return out;
}

/**
 * A deliberately small CSS reader.
 *
 * It strips comments and at-rule PRELUDES while keeping their bodies, so rules
 * inside `@media` are compared alongside the rest. That is a simplification:
 * a rule that exists only inside a breakpoint is treated as if it were
 * top-level. It suits this job — the question here is "does the build set this
 * property to this value anywhere" — and it is recorded so nobody reads more
 * precision into the output than it has.
 */
function parse(text) {
  const out = new Map();
  const clean = text.replace(/\/\*[\s\S]*?\*\//g, '');
  const body = clean.replace(/@[a-z-]+[^{;]*\{/gi, '').replace(/\}\s*\}/g, '}');
  for (const m of body.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const decls = {};
    for (const d of m[2].split(';')) {
      const i = d.indexOf(':');
      if (i < 0) continue;
      const prop = d.slice(0, i).trim().toLowerCase();
      if (!prop || IGNORE_PROPS.has(prop)) continue;
      decls[prop] = d.slice(i + 1).trim();
    }
    if (!Object.keys(decls).length) continue;
    for (const sel of m[1].split(',')) {
      const key = sel.trim().replace(/\s+/g, ' ');
      if (!key) continue;
      const prev = out.get(key) || {};
      out.set(key, { ...prev, ...decls });
    }
  }
  return out;
}

/** Build a token table so `var(--x)` on one side can meet a literal on the other. */
function tokens(maps) {
  const t = new Map();
  for (const m of maps) {
    for (const decls of m.values()) {
      for (const [k, v] of Object.entries(decls)) {
        if (k.startsWith('--')) t.set(k, v.trim());
      }
    }
  }
  return t;
}

function resolve(value, t, depth = 0) {
  if (depth > 4) return value;
  return value.replace(/var\(\s*(--[\w-]+)\s*(?:,[^)]*)?\)/g, (whole, name) =>
    t.has(name) ? resolve(t.get(name), t, depth + 1) : whole);
}

function norm(value, t) {
  return resolve(value, t)
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/(^|[\s(,])0?\.(\d)/g, '$1.$2')   // 0.5 -> .5
    .replace(/\s*([,()])\s*/g, '$1')
    .replace(/;$/, '')
    .trim();
}

// Map a reference selector onto the build's naming.
function rename(sel) {
  return sel.replace(/\.([\w-]+)/g, (whole, cls) =>
    RENAMES[cls] ? '.' + RENAMES[cls] : whole);
}

const refFiles = walk(REF);
const srcFiles = walk(SRC);
const refMaps = refFiles.map(f => parse(readFileSync(f, 'utf8')));
const srcMaps = srcFiles.map(f => parse(readFileSync(f, 'utf8')));

const T = tokens([...refMaps, ...srcMaps]);

/*
 * PROVENANCE MATTERS, and merging destroyed it.
 *
 * The first version folded all twelve reference stylesheets into one map, so a
 * selector defined in two files silently took the last one. `.tag` is defined
 * in both `app.css` and `mobile.css` with different values, and the merge
 * reported the mobile one — border-radius 3px against a canonical pill. Acting
 * on that would have changed a component used in sixteen places to match a
 * rule meant for a phone mock.
 *
 * So each file keeps its own map, and `app.css` wins when a selector appears
 * in more than one: it is the desktop application sheet and the others are
 * context-specific (mobile frame, landing page, onboarding, auth). Where a
 * lower-priority file disagrees, that is recorded rather than lost.
 */
const PRIORITY = ['app.css', 'components.css', 'settings.css', 'auth.css',
                  'pahchan.css', 'onboarding.css', 'landing.css', 'mobile.css',
                  'motion.css', 'blueprint.css', 'tokens.css', 'brand.css'];
// `basename`, not a hand-rolled split: this runs on Windows, where the paths
// come back with backslashes and a `/`-only split returns the whole path.
const rank = f => {
  const i = PRIORITY.indexOf(basename(f));
  return i < 0 ? PRIORITY.length : i;
};
const order = refFiles.map((f, i) => [rank(f), i]).sort((a, b) => b[0] - a[0]);

const ref = new Map();
const refFrom = new Map();
// Lowest priority first, so the highest-priority file overwrites last.
for (const [, i] of order) {
  const short = basename(refFiles[i]);
  for (const [k, v] of refMaps[i]) {
    ref.set(k, { ...(ref.get(k) || {}), ...v });
    for (const prop of Object.keys(v)) refFrom.set(k + '|' + prop, short);
  }
}
const src = new Map();
for (const m of srcMaps) for (const [k, v] of m) src.set(k, { ...(src.get(k) || {}), ...v });

const missing = [];
const different = [];
let matched = 0, compared = 0;

for (const [sel, refDecls] of ref) {
  if (!sel.startsWith('.')) continue;              // only component classes
  if (Object.keys(refDecls).every(p => p.startsWith('--'))) continue;
  const want = rename(sel);
  const got = src.get(want) || src.get(sel);
  if (!got) { missing.push(want); continue; }

  const deltas = [];
  for (const [prop, rv] of Object.entries(refDecls)) {
    if (prop.startsWith('--')) continue;
    compared++;
    const sv = got[prop];
    if (sv === undefined) { deltas.push(`${prop}: MISSING (want ${rv})   [${refFrom.get(sel + '|' + prop) || '?'}]`); continue; }
    if (norm(rv, T) !== norm(sv, T)) {
      const from = refFrom.get(sel + '|' + prop) || '?';
      deltas.push(`${prop}: ${sv}  ->  ${rv}   [${from}]`);
    }
    else matched++;
  }
  if (deltas.length) different.push({ sel: want, deltas });
}

const total = missing.length + different.length;
console.log(`reference selectors examined : ${ref.size}`);
console.log(`declarations compared        : ${compared}`);
console.log(`  agreeing                   : ${matched}  (${(matched / compared * 100).toFixed(1)}%)`);
console.log(`  disagreeing                : ${compared - matched}`);
console.log('');
console.log(`selectors with no rule at all: ${missing.length}`);
console.log(`selectors that disagree      : ${different.length}`);
console.log('');

different.sort((a, b) => b.deltas.length - a.deltas.length);
console.log('WORST OFFENDERS (build value -> design value):');
for (const d of different.slice(0, 20)) {
  console.log(`\n  ${d.sel}   [${d.deltas.length}]`);
  for (const x of d.deltas.slice(0, 6)) console.log(`      ${x}`);
}
