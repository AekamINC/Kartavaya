#!/usr/bin/env node
/**
 * check-component-parity.mjs — the component set, reference vs build.
 *
 * WHY THIS EXISTS
 * ---------------
 * `design-reference/Kartavaya Redesign/components.css` and
 * `frontend/src/styles/components.css` share a class vocabulary (`.btn`,
 * `.btn--fill`, `.fldx`, `.tgl`, `.cbx`, `.seg`, …) because the build is a port
 * of the reference. That makes them directly comparable rule by rule — and a
 * port is exactly the kind of thing that drifts silently, because nothing in
 * the build fails when a variant is missing or a radius is off by 2px.
 *
 * A previous run hand-typed four ratios into a report and got all four wrong.
 * So everything here is READ FROM THE FILES. Nothing is transcribed. The tables
 * this prints are meant to be pasted whole.
 *
 * WHAT IT CHECKS
 * --------------
 *   1. Class-root coverage      — roots the reference declares that the build does not.
 *   2. Modifier coverage        — `--x` variants per root, both directions.
 *   3. State coverage           — :hover / :focus-visible / :active / :disabled
 *                                 per root, both directions. A missing :disabled
 *                                 rule is a real, visible defect.
 *   4. Declaration drift        — for selectors present in both, which properties
 *                                 differ, with both values side by side.
 *   5. Token drift              — custom properties declared in both token layers
 *                                 whose literal value differs.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 * --------------------------------
 * It does not resolve `var()` or `calc()`. Two files can declare `--r-sm` from
 * different `--radius-base` and both say `calc(var(--radius-base) * .58)`; only
 * a browser knows the pixel. §5 catches the input drift, and the rendered probe
 * (`frontend/public/__ref/_probe.html`) catches the output. Neither alone is
 * enough, which is why both exist.
 *
 * Usage:
 *   cd frontend && node scripts/check-component-parity.mjs           # summary
 *   cd frontend && node scripts/check-component-parity.mjs --md      # markdown tables
 *   cd frontend && node scripts/check-component-parity.mjs --root X  # one class root
 *
 * Exits 0 always: this reports drift from a reference that the build is allowed
 * to diverge from deliberately. It is a lens, not a gate.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND = path.resolve(HERE, '..');
const REPO = path.resolve(FRONTEND, '..');
const REF_DIR = path.join(REPO, 'design-reference', 'Kartavaya Redesign');
const BUILD_STYLES = path.join(FRONTEND, 'src', 'styles');

if (!fs.existsSync(REF_DIR)) {
  console.error(`design-reference not found at ${REF_DIR}`);
  console.error('Are you on a branch cut from main? See swarm-reports/_COORDINATION.md §1.');
  process.exit(1);
}
if (!fs.existsSync(BUILD_STYLES)) {
  console.error(`src/styles not found at ${BUILD_STYLES} — run me from frontend/.`);
  process.exit(1);
}

const argv = process.argv.slice(2);
const MD = argv.includes('--md');
const ONLY_ROOT = (() => { const i = argv.indexOf('--root'); return i >= 0 ? argv[i + 1] : null; })();

/* ── CSS parsing ─────────────────────────────────────────────────────────────
   Deliberately small. It blanks comments IN PLACE (preserving newlines) so line
   numbers survive — the a11y branch's checker shifted every citation after a
   comment by collapsing them, and a report whose line numbers are wrong is
   worse than no report. */
function blankComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '));
}

function lineOf(src, idx) {
  let n = 1;
  for (let i = 0; i < idx; i++) if (src.charCodeAt(i) === 10) n++;
  return n;
}

/** Flatten a stylesheet into { selector, decls, file, line, atRule } records. */
function parseRules(css, file) {
  const src = blankComments(css);
  const out = [];
  const stack = [];          // open at-rule preludes
  let i = 0, buf = '', bufStart = 0;

  while (i < src.length) {
    const ch = src[i];
    if (ch === '{') {
      const prelude = buf.trim();
      if (prelude.startsWith('@')) {
        stack.push(prelude);
        buf = ''; i++; bufStart = i; continue;
      }
      // find matching close
      let depth = 1, j = i + 1;
      while (j < src.length && depth > 0) {
        if (src[j] === '{') depth++;
        else if (src[j] === '}') depth--;
        j++;
      }
      const body = src.slice(i + 1, j - 1);
      // nested blocks inside a style rule are not used in this codebase; if a
      // body contains '{' treat it as an at-rule container and recurse.
      if (body.includes('{')) {
        stack.push(prelude);
        const inner = parseRules(body, file);
        for (const r of inner) out.push({ ...r, atRule: [...stack].join(' && '), line: r.line + lineOf(src, i) - 1 });
        stack.pop();
      } else {
        for (const sel of splitSelectors(prelude)) {
          out.push({
            selector: sel,
            decls: parseDecls(body),
            file,
            line: lineOf(src, bufStart),
            atRule: stack.join(' && ') || null,
          });
        }
      }
      buf = ''; i = j; bufStart = i; continue;
    }
    if (ch === '}') { stack.pop(); buf = ''; i++; bufStart = i; continue; }
    if (ch === ';' && buf.trim().startsWith('@')) { buf = ''; i++; bufStart = i; continue; }
    if (!buf.trim()) bufStart = i;
    buf += ch; i++;
  }
  return out;
}

function splitSelectors(prelude) {
  const parts = [];
  let depth = 0, cur = '';
  for (const ch of prelude) {
    if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth--;
    if (ch === ',' && depth === 0) { parts.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts.filter(Boolean);
}

function parseDecls(body) {
  const map = new Map();
  let depth = 0, cur = '';
  const flush = () => {
    const d = cur.trim(); cur = '';
    if (!d) return;
    const c = d.indexOf(':');
    if (c < 0) return;
    const prop = d.slice(0, c).trim();
    const val = d.slice(c + 1).trim().replace(/\s+/g, ' ');
    if (prop) map.set(prop, val);
  };
  for (const ch of body) {
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    if (ch === ';' && depth === 0) { flush(); continue; }
    cur += ch;
  }
  flush();
  return map;
}

/* ── load both sides ─────────────────────────────────────────────────────── */
function load(files, dir) {
  const rules = [];
  for (const f of files) {
    const p = path.join(dir, f);
    if (!fs.existsSync(p)) continue;
    rules.push(...parseRules(fs.readFileSync(p, 'utf8'), f));
  }
  return rules;
}

// The reference component layer, in the order Component Inventory.html links it.
const REF_FILES = ['tokens.css', 'app.css', 'motion.css', 'components.css'];
// The build layer, in the order App.jsx / index.css actually load it.
const BUILD_FILES = [
  'layout.css', 'dark-theme.css', 'components.css', 'module.css', 'drawer.css',
  'animations.css', 'mobile-responsive.css', 'generate-report.css', 'sanvaad.css',
  'palette.css', 'boards.css', 'kartavaya-design.css', 'editorial.css', 'settings.css',
];

const refRules = load(REF_FILES, REF_DIR);
const buildRules = load(BUILD_FILES, BUILD_STYLES);

/* ── §1-3 · class roots, modifiers, states ───────────────────────────────── */
// A "root" is the first class in a selector's last compound that is not a
// modifier or a state — `.btn--fill:hover` → root `btn`, modifier `fill`,
// state `hover`.
const CLASS_RE = /\.(-?[A-Za-z_][\w-]*)/g;
const STATE_RE = /:(hover|focus-visible|focus-within|focus|active|disabled|checked|invalid|placeholder-shown|first-child|last-child|not)\b|\[(disabled|aria-[\w-]+|data-[\w-]+)/g;

function classify(selector) {
  const classes = [...selector.matchAll(CLASS_RE)].map(m => m[1]);
  if (!classes.length) return null;
  const roots = new Set(), mods = new Set();
  for (const c of classes) {
    const dd = c.indexOf('--');
    if (dd > 0) { roots.add(c.slice(0, dd)); mods.add(c); }
    else if (c.includes('__')) { roots.add(c.split('__')[0]); }
    else roots.add(c);
  }
  const states = new Set();
  for (const m of selector.matchAll(STATE_RE)) states.add(m[1] || m[2]);
  return { classes, roots: [...roots], mods: [...mods], states: [...states] };
}

function index(rules) {
  const byRoot = new Map();   // root -> { mods:Set, states:Set, selectors:Set, elements:Set, files:Set }
  const bySelector = new Map();
  for (const r of rules) {
    const c = classify(r.selector);
    if (!c) continue;
    const key = normSel(r.selector) + (r.atRule ? ` @${r.atRule}` : '');
    if (!bySelector.has(key)) bySelector.set(key, []);
    bySelector.get(key).push(r);
    for (const root of c.roots) {
      if (!byRoot.has(root)) byRoot.set(root, { mods: new Set(), states: new Set(), selectors: new Set(), elements: new Set(), files: new Set() });
      const e = byRoot.get(root);
      for (const m of c.mods) if (m.startsWith(root + '--')) e.mods.add(m.slice(root.length + 2));
      for (const s of c.states) e.states.add(s);
      e.selectors.add(r.selector);
      e.files.add(r.file);
      for (const cl of c.classes) if (cl.startsWith(root + '__')) e.elements.add(cl.slice(root.length + 2));
    }
  }
  return { byRoot, bySelector };
}

function normSel(s) {
  return s.replace(/\s+/g, ' ').replace(/\s*([>+~,])\s*/g, '$1').trim();
}

const REF = index(refRules);
const BUILD = index(buildRules);

/* ── §5 · token drift ────────────────────────────────────────────────────── */
function tokenLayer(rules, wantSelectors) {
  const out = new Map(); // "theme|name" -> value
  for (const r of rules) {
    // BUG THIS GUARD FIXES: without it, the reference's
    // `@media (prefers-reduced-motion) { :root { --dur-base: 0s } }` and
    // `@media (prefers-reduced-transparency) { :root { --glass-blur: 0px } }`
    // overwrote the unconditional values, and the report then accused the build
    // of five duration diffs and two glass diffs that do not exist. Caught by
    // the numbers disagreeing with the files, which is the only reason to keep
    // reading a checker's output instead of trusting it.
    if (r.atRule) continue;
    const sel = normSel(r.selector);
    const theme = wantSelectors(sel);
    if (!theme) continue;
    for (const [prop, val] of r.decls) {
      if (!prop.startsWith('--')) continue;
      out.set(`${theme}|${prop}`, val);
    }
  }
  return out;
}
const themeOf = sel => {
  if (/\[data-theme="dark"\]/.test(sel)) return 'dark';
  if (sel === ':root' || /\[data-theme="light"\]/.test(sel) || /^:root,/.test(sel) || sel.split(',').includes(':root')) return 'light';
  return null;
};
const refTokens = tokenLayer(parseRules(fs.readFileSync(path.join(REF_DIR, 'tokens.css'), 'utf8'), 'tokens.css'), themeOf);
const buildTokenFiles = ['kartavaya-design.css', 'dark-theme.css'];
const buildTokenRules = [];
for (const f of buildTokenFiles) {
  const p = path.join(BUILD_STYLES, f);
  if (fs.existsSync(p)) buildTokenRules.push(...parseRules(fs.readFileSync(p, 'utf8'), f));
}
const libTokens = path.join(FRONTEND, 'src', 'lib', 'tokens.css');
if (fs.existsSync(libTokens)) buildTokenRules.push(...parseRules(fs.readFileSync(libTokens, 'utf8'), 'lib/tokens.css'));
const bldTokens = tokenLayer(buildTokenRules, themeOf);

/* ── reporting ───────────────────────────────────────────────────────────── */
const roots = [...new Set([...REF.byRoot.keys(), ...BUILD.byRoot.keys()])].sort();
const IGNORE_ROOT = /^(cb|cbbar|ix|hi|spin|sr-only)$/;   // harness chrome, not product

// THE COMPONENT SET is what `components.css` declares. `app.css` on the
// reference side carries whole screens (`.bcol`, `.arch`, `.aidemo`), which are
// a sibling agent's surface and would drown this one in noise. Scoped here
// rather than by editing REF_FILES, because the screen sheets still have to be
// LOADED — they are where a component gets overridden, and an override that
// only exists on one side is exactly the drift worth finding.
const COMPONENT_SHEET = 'components.css';
const inComponentSet = root => REF.byRoot.get(root)?.files.has(COMPONENT_SHEET);

function setDiff(a, b) { return [...a].filter(x => !b.has(x)).sort(); }

const missingRoots = [], extraRoots = [], modDrift = [], stateDrift = [];
for (const root of roots) {
  if (IGNORE_ROOT.test(root)) continue;
  if (ONLY_ROOT && root !== ONLY_ROOT) continue;
  if (!ONLY_ROOT && REF.byRoot.has(root) && !inComponentSet(root)) continue;
  const r = REF.byRoot.get(root), b = BUILD.byRoot.get(root);
  if (r && !b) { missingRoots.push(root); continue; }
  if (!r && b) { extraRoots.push(root); continue; }
  const mMissing = setDiff(r.mods, b.mods), mExtra = setDiff(b.mods, r.mods);
  if (mMissing.length || mExtra.length) modDrift.push({ root, mMissing, mExtra });
  const sMissing = setDiff(r.states, b.states), sExtra = setDiff(b.states, r.states);
  if (sMissing.length || sExtra.length) stateDrift.push({ root, sMissing, sExtra });
}

// §4 declaration drift on shared selectors
const declDrift = [];
for (const [key, rRules] of REF.bySelector) {
  const bRules = BUILD.bySelector.get(key);
  if (!bRules) continue;
  const merge = list => { const m = new Map(); for (const r of list) for (const [k, v] of r.decls) m.set(k, v); return m; };
  const rd = merge(rRules), bd = merge(bRules);
  const props = [...new Set([...rd.keys(), ...bd.keys()])].sort();
  const diffs = [];
  for (const p of props) {
    const rv = rd.get(p), bv = bd.get(p);
    if (rv === bv) continue;
    diffs.push({ prop: p, ref: rv ?? '—', build: bv ?? '—' });
  }
  if (diffs.length) {
    const root = classify(rRules[0].selector)?.roots[0];
    if (ONLY_ROOT && root !== ONLY_ROOT) continue;
    if (IGNORE_ROOT.test(root || '')) continue;
    if (!ONLY_ROOT && !inComponentSet(root)) continue;
    declDrift.push({ selector: key, root, diffs, refAt: `${rRules[0].file}:${rRules[0].line}`, buildAt: `${bRules[0].file}:${bRules[0].line}` });
  }
}

// Three buckets, because they mean three different things and one merged list
// hides all of them: a token that DIFFERS is drift, a token the build LACKS is
// a hole every consumer paints transparent through, and a token the build ADDS
// is either an improvement (`--motion-scale`) or an unreviewed invention.
const tokenDrift = [], tokenMissing = [], tokenExtra = [];
for (const key of new Set([...refTokens.keys(), ...bldTokens.keys()])) {
  const [theme, name] = key.split('|');
  const rv = refTokens.get(key), bv = bldTokens.get(key);
  if (rv === bv) continue;
  if (rv === undefined) { tokenExtra.push({ theme, name, ref: '—', build: bv }); continue; }
  if (bv === undefined) { tokenMissing.push({ theme, name, ref: rv, build: '—' }); continue; }
  tokenDrift.push({ theme, name, ref: rv, build: bv });
}
const byTheme = (a, b) => a.theme.localeCompare(b.theme) || a.name.localeCompare(b.name);
tokenDrift.sort(byTheme); tokenMissing.sort(byTheme); tokenExtra.sort(byTheme);

/* ── output ──────────────────────────────────────────────────────────────── */
const esc = s => String(s).replace(/\|/g, '\\|');
function table(head, rows) {
  if (!rows.length) return '_none_\n';
  return `| ${head.join(' | ')} |\n|${head.map(() => '---').join('|')}|\n` +
    rows.map(r => `| ${r.map(esc).join(' | ')} |`).join('\n') + '\n';
}

const lines = [];
const P = s => lines.push(s);

P(`# Component parity — reference vs build`);
P(``);
P(`Generated by \`frontend/scripts/check-component-parity.mjs\`. Nothing here is typed by hand.`);
P(``);
P(`Reference: \`design-reference/Kartavaya Redesign/{${REF_FILES.join(',')}}\``);
P(`Build: \`frontend/src/styles/{${BUILD_FILES.join(',')}}\``);
P(``);
P(`Rules parsed — reference ${refRules.length}, build ${buildRules.length}. `
  + `Class roots — reference ${REF.byRoot.size}, build ${BUILD.byRoot.size}.`);
P(``);

P(`## 1 · Class roots the reference declares and the build does not`);
P(``);
P(table(['root', 'ref selectors', 'ref modifiers', 'ref elements'],
  missingRoots.map(r => {
    const e = REF.byRoot.get(r);
    return [`.${r}`, e.selectors.size, [...e.mods].sort().join(' ') || '—', [...e.elements].sort().join(' ') || '—'];
  })));

P(`## 2 · Modifier drift (shared roots)`);
P(``);
P(table(['root', 'in reference, missing from build', 'in build, not in reference'],
  modDrift.map(d => [`.${d.root}`, d.mMissing.map(m => `--${m}`).join(' ') || '—', d.mExtra.map(m => `--${m}`).join(' ') || '—'])));

P(`## 3 · State drift (shared roots)`);
P(``);
P(table(['root', 'states in reference, absent from build', 'states only in build'],
  stateDrift.map(d => [`.${d.root}`, d.sMissing.map(s => `:${s}`).join(' ') || '—', d.sExtra.map(s => `:${s}`).join(' ') || '—'])));

P(`## 4 · Declaration drift on selectors present in both`);
P(``);
P(`${declDrift.length} selectors differ.`);
P(``);
const byRootDrift = new Map();
for (const d of declDrift) {
  if (!byRootDrift.has(d.root)) byRootDrift.set(d.root, []);
  byRootDrift.get(d.root).push(d);
}
for (const [root, ds] of [...byRootDrift].sort()) {
  P(`### \`.${root}\``);
  P(``);
  P(table(['selector', 'property', 'reference', 'build'],
    ds.flatMap(d => d.diffs.map((x, i) => [i === 0 ? `\`${d.selector}\`` : '', x.prop, x.ref, x.build]))));
}

P(`## 5 · Token literal drift — declared in both, different value`);
P(``);
P(table(['theme', 'token', 'reference', 'build'],
  tokenDrift.map(t => [t.theme, `\`${t.name}\``, t.ref, t.build])));

P(`### 5b · Declared by the reference, absent from the build`);
P(``);
P(table(['theme', 'token', 'reference value'],
  tokenMissing.map(t => [t.theme, `\`${t.name}\``, t.ref])));

P(`### 5c · Build-only tokens (${tokenExtra.length})`);
P(``);
P('```');
P([...new Set(tokenExtra.map(t => t.name))].sort().join(' '));
P('```');

/* ── §7 · hard-coded radii ───────────────────────────────────────────────
   `00-tokens.md §96`, verbatim: "Never hard-code a radius. A literal
   `border-radius: 8px` breaks the Sharp and Pill settings in exactly that one
   place." The Corner radius control writes `--radius-base`, and every `--r-*`
   is a calc off it — a literal is a control that silently does nothing there.
   50% and 999px/9999px are NOT violations: a circle and a pill are shapes, not
   radii, and `--r-pill` is itself 999px. */
const RADIUS_LITERAL = /(^|[\s,])(\d+(?:\.\d+)?)px/;
const RADIUS_BASE = (() => {
  const m = /--radius-base:\s*(\d+(?:\.\d+)?)px/.exec(fs.readFileSync(path.join(BUILD_STYLES, 'kartavaya-design.css'), 'utf8'));
  return m ? parseFloat(m[1]) : 12;
})();
const radiusLiterals = [];
for (const r of buildRules) {
  for (const [prop, val] of r.decls) {
    if (!/^border(-[a-z]+)?-radius$/.test(prop)) continue;
    if (val.includes('var(') || val.includes('%')) continue;
    const m = val.match(RADIUS_LITERAL);
    if (!m) continue;
    const px = parseFloat(m[2]);
    if (px === 0) continue;                // a deliberate square corner
    // A literal >= 48px on a control that is at most ~40px tall is a PILL
    // written the long way. Still §96 — it should be `--r-pill` — but it is a
    // different failure from `8px`, which is a real corner the radius control
    // was supposed to move and cannot. Bucketed so the second list is not
    // buried under the first.
    radiusLiterals.push({ file: r.file, line: r.line, selector: r.selector, value: val, px, pill: px >= 48 });
  }
}
radiusLiterals.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);

const realRadii = radiusLiterals.filter(r => !r.pill);
const pillRadii = radiusLiterals.filter(r => r.pill);

P(`## 7 · Hard-coded radii — \`00-tokens.md §96\` violations`);
P(``);
P(`${radiusLiterals.length} declarations set a literal pixel radius: **${realRadii.length} real corners**`);
P(`and ${pillRadii.length} pills written the long way. \`50%\` is excluded — a circle is a shape.`);
P(``);
P(`Each real corner is a place where the Corner radius control (Sharp 4 /`);
P(`Default 10 / Pill 20) moves nothing.`);
P(``);
P(`Of the ${realRadii.length}: **${realRadii.filter(r => r.px >= 4).length} are >= 4px** — a corner a user would see move, and the`);
P(`ones worth converting. The remaining ${realRadii.filter(r => r.px < 4).length} are 1-3px hairline softening on dots,`);
P(`bars and ticks, where a token that scales to 20px under Pill would be wrong.`);
P(``);
P(table(['file:line', 'selector', 'value', 'nearest token'],
  realRadii.map(r => {
    // The ramp is .34 / .58 / 1 / 1.45 / 2.1 of --radius-base, and the base is
    // READ, not assumed: it moved 10 → 12 mid-run, and a hard-coded 10 here
    // would have named the wrong nearest token for all 83 rows.
    const ramp = [['--r-xs', 0.34], ['--r-sm', 0.58], ['--r-md', 1], ['--r-lg', 1.45], ['--r-xl', 2.1]]
      .map(([n, k]) => [n, Math.round(k * RADIUS_BASE * 100) / 100]);
    const near = ramp.reduce((a, b) => Math.abs(b[1] - r.px) < Math.abs(a[1] - r.px) ? b : a);
    return [`\`${r.file}:${r.line}\``, `\`${r.selector}\``, r.value, `\`${near[0]}\` (${near[1]}px, Δ${(r.px - near[1]).toFixed(1)})`];
  })));

P(`### 7b · Pills written as a literal — should be \`--r-pill\` (${pillRadii.length})`);
P(``);
P('```');
P(pillRadii.map(r => `${r.file}:${r.line} ${r.selector} → ${r.value}`).join('\n'));
P('```');

P(`## 6 · Class roots in the build with no reference counterpart`);
P(``);
P(`${extraRoots.length} roots. These are build inventions — not defects by`);
P(`themselves, but each is a component the reference never specified.`);
P(``);
P('```');
P(extraRoots.join(' '));
P('```');

const text = lines.join('\n');
if (MD) process.stdout.write(text);
else {
  console.log(`roots: ref ${REF.byRoot.size}, build ${BUILD.byRoot.size}`);
  console.log(`missing roots      : ${missingRoots.length}  ${missingRoots.slice(0, 12).map(r => '.' + r).join(' ')}${missingRoots.length > 12 ? ' …' : ''}`);
  console.log(`modifier drift     : ${modDrift.length} roots`);
  console.log(`state drift        : ${stateDrift.length} roots`);
  console.log(`declaration drift  : ${declDrift.length} selectors`);
  console.log(`token literal drift: ${tokenDrift.length} differ, ${tokenMissing.length} missing from build, ${tokenExtra.length} build-only`);
  console.log(`build-only roots   : ${extraRoots.length}`);
  console.log(`hard-coded radii   : ${radiusLiterals.filter(r => !r.pill).length} real corners + ${radiusLiterals.filter(r => r.pill).length} literal pills (00-tokens.md §96)`);
  console.log(`\nrun with --md for the full tables`);
}
