/**
 * check-contrast.mjs — measures WCAG contrast instead of estimating it.
 *
 * Two token-contrast bugs shipped in this codebase and BOTH were invisible to
 * check-tokens.mjs, because a token that resolves is not a token that is
 * legible:
 *
 *   · --on-surface-faint was specified as a literal #9DA096 and used as text in
 *     ~30 places. It measures 2.32:1 on --bg. check-tokens saw a declared token
 *     and passed it.
 *   · --primary is a FILL at 4.04:1. Used as body-text colour it fails AA by a
 *     margin too small to notice by eye — which is precisely why it needs a
 *     number, not a judgement.
 *
 * So this walks the DECLARED tokens, resolves the var() chains per theme, and
 * prints ratios. Three passes:
 *
 *   1. THEME PARITY — every token declared in one theme and not the other.
 *      A token that exists only in light renders as an empty string in dark and
 *      CSS drops the whole declaration. Same failure mode as an undefined
 *      token, except check-tokens.mjs cannot see it because the name IS
 *      declared, just not on the path the dark document takes.
 *
 *   2. MATRIX — the foreground ramp against the surface ramp, per theme.
 *      This is the table a designer reads. Reported, never failed on: plenty of
 *      pairs in the matrix are combinations nothing actually renders.
 *
 *   3. REAL PAIRS — rules that set `color` and a background in the SAME block,
 *      which is the only place a stylesheet states a pairing outright. This is
 *      the pass that fails the build, because every hit is a pairing that
 *      genuinely renders.
 *
 * Thresholds are WCAG 2.1: 4.5:1 body text, 3:1 large text (>=24px, or >=18.66px
 * at >=700 weight) and non-text UI. Large-text detection reads font-size and
 * font-weight out of the same rule.
 *
 * KNOWN LIMITS, stated so nobody reads a pass as more than it is:
 *   · A rule that sets only `color` is skipped — its background comes from an
 *     ancestor and no static pass can know which. The matrix is the backstop.
 *   · color-mix(in srgb, A p%, B) is computed in sRGB and IS premultiplied, so
 *     a translucent operand contributes in proportion to its alpha — matching
 *     the spec and the browser. (This line used to claim non-premultiplied; the
 *     comment was wrong and the code was right, which is the worse way round:
 *     an auditor who reads it distrusts a correct gate. Verified against 400
 *     pairs of the repo's own accent.js contrast() at delta 0.)
 *   · currentColor, gradients and images are skipped, not guessed.
 *
 * Usage: node scripts/check-contrast.mjs            (from frontend/)
 *        node scripts/check-contrast.mjs --matrix   (also print pass 2 in full)
 */
import { readFileSync, readdirSync, existsSync, writeFileSync } from 'fs';
import { join } from 'path';

const STYLE_DIR = 'src/styles';
const SHOW_MATRIX = process.argv.includes('--matrix');
/**
 * --md emits the matrix as markdown tables on stdout, so the report table is
 * GENERATED rather than transcribed. Hand-copying ratios into a document is how
 * a measured audit turns back into an estimated one — I typed four wrong values
 * into the report before this flag existed.
 */
const AS_MD = process.argv.includes('--md');

if (!existsSync(STYLE_DIR)) {
  console.error(`check-contrast: ${STYLE_DIR} not found — run from the frontend/ directory.`);
  process.exit(1);
}

/**
 * Blank out comments while PRESERVING line structure. Replacing a comment with
 * a single space shifts every line number after it, and a report that cites a
 * line nobody can open is worse than no report.
 */
const stripComments = (t) =>
  t.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));

/* ── Colour maths ───────────────────────────────────────────────────────── */

/** sRGB channel → linear. WCAG 2.1 relative luminance. */
const lin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const luminance = ([r, g, b]) =>
  0.2126 * lin(r / 255) + 0.7152 * lin(g / 255) + 0.0722 * lin(b / 255);

function contrast(fg, bg) {
  const a = luminance(fg) + 0.05;
  const b = luminance(bg) + 0.05;
  return a > b ? a / b : b / a;
}

/** Composite a possibly-translucent colour over an opaque backdrop. */
function over(fg, bg) {
  const a = fg[3] ?? 1;
  if (a >= 1) return fg.slice(0, 3);
  return [0, 1, 2].map((i) => fg[i] * a + bg[i] * (1 - a));
}

const NAMED = {
  white: [255, 255, 255], black: [0, 0, 0], transparent: [0, 0, 0, 0],
  red: [255, 0, 0], none: null, inherit: null, currentcolor: null,
};

/**
 * Parse one colour value to [r,g,b,a]. Returns null for anything not a flat
 * colour — gradients, images, currentColor — which is a skip, not a failure.
 */
function parseColor(raw, vars, depth = 0) {
  if (raw == null || depth > 12) return null;
  let v = String(raw).trim().replace(/\s*!important$/, '');
  if (!v) return null;

  const low = v.toLowerCase();
  if (low in NAMED) return NAMED[low];

  // var(--x) / var(--x, fallback)
  const varM = /^var\(\s*(--[\w-]+)\s*(?:,([\s\S]*))?\)$/.exec(v);
  if (varM) {
    const [, name, fallback] = varM;
    if (Object.prototype.hasOwnProperty.call(vars, name)) {
      const r = parseColor(vars[name], vars, depth + 1);
      if (r) return r;
    }
    return fallback ? parseColor(fallback, vars, depth + 1) : null;
  }

  // #RGB #RGBA #RRGGBB #RRGGBBAA
  const hex = /^#([0-9a-f]{3,8})$/i.exec(v);
  if (hex) {
    const h = hex[1];
    const ex = (s) => parseInt(s.length === 1 ? s + s : s, 16);
    if (h.length === 3 || h.length === 4)
      return [ex(h[0]), ex(h[1]), ex(h[2]), h.length === 4 ? ex(h[3]) / 255 : 1];
    if (h.length === 6 || h.length === 8)
      return [
        ex(h.slice(0, 2)), ex(h.slice(2, 4)), ex(h.slice(4, 6)),
        h.length === 8 ? ex(h.slice(6, 8)) / 255 : 1,
      ];
    return null;
  }

  // rgb()/rgba(), comma or space separated
  const rgbM = /^rgba?\(([\s\S]*)\)$/i.exec(v);
  if (rgbM) {
    const parts = rgbM[1].split(/[,/]/).flatMap((p) => p.trim().split(/\s+/)).filter(Boolean);
    if (parts.length < 3) return null;
    const n = (p) => (p.endsWith('%') ? (parseFloat(p) / 100) * 255 : parseFloat(p));
    const a = parts[3] == null ? 1 : parts[3].endsWith('%') ? parseFloat(parts[3]) / 100 : parseFloat(parts[3]);
    const c = [n(parts[0]), n(parts[1]), n(parts[2]), a];
    return c.slice(0, 3).some(Number.isNaN) ? null : c;
  }

  // A bare "R, G, B" triplet — --glass-tint and --side-ink are stored that way.
  const triplet = /^(\d+)\s*,\s*(\d+)\s*,\s*(\d+)$/.exec(v);
  if (triplet) return [+triplet[1], +triplet[2], +triplet[3], 1];

  // color-mix(in <space>, A [p%], B [q%])
  const mixM = /^color-mix\(\s*in\s+[\w-]+\s*,([\s\S]*)\)$/i.exec(v);
  if (mixM) {
    const args = splitTop(mixM[1]);
    if (args.length !== 2) return null;
    /**
     * The percentage may be a TOKEN, not a literal: this codebase writes
     * `color-mix(in srgb, var(--ok) var(--tint-mid), transparent)` in twelve
     * rules that also state a `color`, which is exactly the shape pass 3
     * exists to measure.
     *
     * Matching only a trailing literal `%` left the whole component as
     * `var(--ok) var(--tint-mid)`, which is not a colour, so parseColor
     * returned null, so the color-mix returned null, so `bgRes` was null and
     * the rule hit `continue`. Those twelve rules were not passing this gate —
     * they were never REACHED by it, which reads identically in a green
     * report. Five of them measure 4.13–4.37:1 in light and were invisible
     * for as long as this regex has been here.
     *
     * Resolving the token first is enough; --tint-* and --focus-mix are plain
     * percentages declared per theme.
     */
    const asPct = (tok) => {
      let t = tok.trim();
      const m = /^var\(\s*(--[\w-]+)\s*(?:,([\s\S]*))?\)$/.exec(t);
      if (m) {
        const [, name, fallback] = m;
        if (Object.prototype.hasOwnProperty.call(vars, name)) t = String(vars[name]).trim();
        else if (fallback != null) t = String(fallback).trim();
        else return null;
      }
      return /^-?[\d.]+%$/.test(t) ? parseFloat(t) / 100 : null;
    };
    const side = (s) => {
      const str = s.trim();
      const lit = /(-?[\d.]+)%\s*$/.exec(str);
      if (lit) {
        return { color: parseColor(str.slice(0, lit.index).trim(), vars, depth + 1),
                 pct: parseFloat(lit[1]) / 100 };
      }
      // trailing var() that resolves to a percentage
      const tail = /\s(var\(\s*--[\w-]+\s*(?:,[^()]*(?:\([^()]*\)[^()]*)*)?\))\s*$/.exec(str);
      if (tail) {
        const p = asPct(tail[1]);
        if (p != null) {
          return { color: parseColor(str.slice(0, tail.index).trim(), vars, depth + 1), pct: p };
        }
      }
      return { color: parseColor(str, vars, depth + 1), pct: null };
    };
    const A = side(args[0]);
    const B = side(args[1]);
    if (!A.color || !B.color) return null;
    let pa = A.pct, pb = B.pct;
    if (pa == null && pb == null) { pa = 0.5; pb = 0.5; }
    else if (pa == null) pa = 1 - pb;
    else if (pb == null) pb = 1 - pa;
    const sum = pa + pb;
    if (sum <= 0) return null;
    pa /= sum; pb /= sum;
    const aA = A.color[3] ?? 1;
    const aB = B.color[3] ?? 1;
    const alpha = aA * pa + aB * pb;
    // Browsers mix premultiplied then un-premultiply; with transparent as one
    // operand this is what makes `color-mix(X 8%, transparent)` an 8% X.
    const ch = [0, 1, 2].map((i) =>
      alpha === 0 ? 0 : (A.color[i] * aA * pa + B.color[i] * aB * pb) / alpha);
    return [...ch, alpha];
  }

  return null;
}

/** Split on top-level commas only, so nested fn(a, b) survives. */
function splitTop(s) {
  const out = [];
  let depth = 0, cur = '';
  for (const ch of s) {
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

/* ── Parse the stylesheets into rules ───────────────────────────────────── */

/**
 * Flatten every rule to { selector, body, file, line }. @media/@supports are
 * descended into so rules inside them are seen; their conditions are not
 * evaluated, which is fine — a token declared inside a media query still needs
 * to be legible when that query matches.
 */
function parseRules(css, file) {
  const rules = [];
  let i = 0;
  const lineAt = (idx) => css.slice(0, idx).split('\n').length;

  function block(end) {
    while (i < end) {
      const braceOpen = css.indexOf('{', i);
      if (braceOpen === -1 || braceOpen >= end) return;
      const selector = css.slice(i, braceOpen).trim().replace(/\s+/g, ' ');
      // find matching close
      let depth = 1, j = braceOpen + 1;
      while (j < css.length && depth > 0) {
        if (css[j] === '{') depth++;
        else if (css[j] === '}') depth--;
        j++;
      }
      const body = css.slice(braceOpen + 1, j - 1);
      if (/^@(media|supports|layer|container)/.test(selector)) {
        const save = i;
        i = braceOpen + 1;
        block(j - 1);
        i = j;
        void save;
      } else {
        if (selector && !selector.startsWith('@')) {
          rules.push({ selector, body, file, line: lineAt(braceOpen) });
        }
        i = j;
      }
    }
  }
  block(css.length);
  return rules;
}

const files = readdirSync(STYLE_DIR).filter((f) => f.endsWith('.css')).sort();
const allRules = [];
for (const f of files) {
  const css = stripComments(readFileSync(join(STYLE_DIR, f), 'utf8'));
  allRules.push(...parseRules(css, f));
}

/** Declarations out of a rule body, last-wins (CSS cascade within a block). */
function decls(body) {
  const out = {};
  let depth = 0, cur = '';
  const flush = () => {
    const c = cur.indexOf(':');
    if (c > 0) {
      const prop = cur.slice(0, c).trim();
      const val = cur.slice(c + 1).trim();
      if (prop && !prop.includes('{')) out[prop] = val;
    }
    cur = '';
  };
  for (const ch of body) {
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    if (ch === ';' && depth === 0) { flush(); continue; }
    cur += ch;
  }
  flush();
  return out;
}

/* ── Pass 1 · Build the per-theme token maps ────────────────────────────── */

/**
 * Which themes a selector applies in. A SELECTOR LIST is the subtlety: the
 * codebase writes `:root, [data-theme="light"] { ... }`, and `:root` matches
 * the html element whether or not it carries data-theme="dark". So that block
 * applies in BOTH themes — the `[data-theme="light"]` half only raises
 * specificity. Treating the list as light-only was this script's own first bug
 * and it manufactured nine parity failures against tokens that are fine
 * (--st-done and friends, which alias --ok/--warn/--danger and flip with them).
 *
 * Rule: split on top-level commas; if ANY part is theme-agnostic the block is
 * universal. Only a list where EVERY part demands one theme is theme-scoped.
 */
function selectorThemes(sel) {
  const parts = splitTop(sel).map((s) => s.trim()).filter(Boolean);
  let anyUniversal = false, anyDark = false, anyLight = false;
  for (const p of parts) {
    const d = /\[data-theme=["']?dark["']?\]/.test(p);
    const l = /\[data-theme=["']?light["']?\]/.test(p);
    if (d) anyDark = true;
    else if (l) anyLight = true;
    else if (/(^|\s|>)(:root|html|body)(?![\w-])/.test(p) || p === '*') anyUniversal = true;
  }
  if (anyUniversal) return { light: true, dark: true, universal: true };
  if (anyDark && !anyLight) return { light: false, dark: true };
  if (anyLight && !anyDark) return { light: true, dark: false };
  if (anyDark && anyLight) return { light: true, dark: true };
  return null;   // not a token-declaring root block
}

const light = {};
const dark = {};
/** Where each token was last set, per theme, and whether from a scoped block. */
const seen = { light: new Map(), dark: new Map() };

for (const r of allRules) {
  const t = selectorThemes(r.selector);
  if (!t) continue;
  for (const [prop, val] of Object.entries(decls(r.body))) {
    if (!prop.startsWith('--')) continue;
    const where = { at: `${r.file}:${r.line}`, universal: !!t.universal };
    if (t.light) { light[prop] = val; seen.light.set(prop, where); }
    if (t.dark) { dark[prop] = val; seen.dark.set(prop, where); }
  }
}

/**
 * A token set ONLY from a theme-scoped block is undeclared in the other theme:
 * var() returns the guaranteed-invalid value and the whole declaration is
 * dropped. Same end state as an undefined token, but check-tokens.mjs passes it
 * because the NAME is declared — just not on the path the other theme takes.
 */
const parityFails = [];
for (const theme of ['light', 'dark']) {
  const other = theme === 'light' ? 'dark' : 'light';
  for (const [prop, where] of seen[theme]) {
    if (where.universal) continue;
    if (!seen[other].has(prop)) {
      parityFails.push({ token: prop, declaredIn: theme, at: where.at });
    }
  }
}

/* ── Pass 2 · The matrix ────────────────────────────────────────────────── */

const FOREGROUNDS = [
  '--on-surface', '--on-surface-2', '--on-surface-3', '--on-surface-faint',
  '--on-surface-disabled', '--primary', '--primary-text', '--primary-hover',
  // A fixed brand literal that does NOT flip by theme, so it is measured in
  // both. It reaches `color:` in editorial.css via the --k-primary alias.
  '--primary-vivid',
  '--secondary', '--tertiary', '--ok', '--warn', '--danger', '--outline',
  '--st-todo', '--st-in-progress', '--st-in-review', '--pr-medium',
  '--m-graha', '--m-ganit', '--m-manav', '--m-vikray', '--m-vetana',
  '--m-dristi', '--m-prachar', '--m-esign', '--m-sanvaad', '--m-hub',
  '--m-srijan', '--m-pahchan', '--m-boards', '--m-approvals', '--m-reports',
];
const BACKGROUNDS = ['--bg', '--surface', '--s-low', '--s-container', '--s-high', '--s-highest'];
/** Pairs the system states explicitly: a container and its `on-` half. */
const ON_PAIRS = [
  ['--on-primary', '--primary'], ['--on-primary-container', '--primary-container'],
  ['--on-secondary-container', '--secondary-container'],
  ['--on-tertiary-container', '--tertiary-container'],
  ['--on-ok-container', '--ok-container'], ['--on-warn-container', '--warn-container'],
  ['--on-danger-container', '--danger-container'], ['--on-danger', '--danger'],
  // --ok is a FILL that inverts, so it needs its own ink the same way --danger
  // does. Measured here so the pair cannot drift apart unnoticed.
  ['--on-ok', '--ok'],
];

const themes = { light, dark };
const matrix = [];
for (const [tname, vars] of Object.entries(themes)) {
  for (const bgName of BACKGROUNDS) {
    const bg = parseColor(`var(${bgName})`, vars);
    if (!bg) continue;
    for (const fgName of FOREGROUNDS) {
      const fgRaw = parseColor(`var(${fgName})`, vars);
      if (!fgRaw) continue;
      const fg = over(fgRaw, bg.slice(0, 3));
      matrix.push({ theme: tname, fg: fgName, bg: bgName, ratio: contrast(fg, bg.slice(0, 3)) });
    }
  }
  for (const [fgName, bgName] of ON_PAIRS) {
    const bg = parseColor(`var(${bgName})`, vars);
    const fgRaw = parseColor(`var(${fgName})`, vars);
    if (!bg || !fgRaw) continue;
    matrix.push({
      theme: tname, fg: fgName, bg: bgName, onPair: true,
      ratio: contrast(over(fgRaw, bg.slice(0, 3)), bg.slice(0, 3)),
    });
  }
}

/* ── Pass 3 · Real pairs stated in one rule ─────────────────────────────── */

const BG_PROPS = ['background', 'background-color'];

/** WCAG large text: >=24px, or >=18.66px at weight >=700. */
function isLargeText(d) {
  const fsRaw = d['font-size'];
  const fwRaw = d['font-weight'];
  if (!fsRaw) return false;
  const px = /(-?[\d.]+)px/.exec(fsRaw);
  if (!px) return false;
  const size = parseFloat(px[1]);
  const weight = fwRaw && /^\d+$/.test(fwRaw.trim()) ? parseInt(fwRaw, 10)
    : /bold/.test(fwRaw || '') ? 700 : 400;
  return size >= 24 || (size >= 18.66 && weight >= 700);
}

/**
 * WCAG 1.4.3 exempts "inactive user interface components" from the contrast
 * minimum outright. --on-surface-disabled exists FOR that exemption and is
 * documented as inactive-controls-only, so a disabled control measuring 2.3:1
 * is the token working as designed, not a defect. Bucketed separately rather
 * than silently dropped — the exemption should be visible, not assumed.
 */
const isDisabledState = (sel) =>
  /:disabled|\[disabled\]|\[aria-disabled=["']?true["']?\]|\.is-disabled|\.disabled(?![\w-])|:not\(\.on\)/.test(sel);

/**
 * What a translucent element is actually sitting ON.
 *
 * Compositing everything over --bg was this script's second wrong assumption:
 * it flagged fourteen sidebar rules at ~1.1:1, because the sidebar is an
 * INVERTED surface — near-black in both themes — and white-on-white is only a
 * failure if you believe the ground is cream. The sidebar is where a15-link nav
 * lives, so measuring it wrongly is worse than not measuring it.
 *
 * Ordered; first match wins. SKIP means the ground genuinely is not knowable
 * statically and no number should be invented for it.
 */
const SKIP = Symbol('unknown backdrop');
const BACKDROPS = [
  // The accent sidebar paints in the user's chosen accent, resolved at runtime.
  [/\[data-sidebar-bg=["']?accent["']?\]/, SKIP],
  // Sidebar, admin rail and the legacy .k-sidebar: --side-ink, both themes.
  [/(^|[\s,>])\.(side|adm)__|(^|[\s,>])\.k-sidebar/, 'rgb(var(--side-ink))'],
  // Anything painting on the scrim is over an unknown page.
  [/\.scrim|\.overlay/, SKIP],
];
function backdropFor(sel) {
  for (const [re, ground] of BACKDROPS) if (re.test(sel)) return ground;
  return 'var(--bg)';
}

const realFails = [];
const exempted = [];
for (const r of allRules) {
  const d = decls(r.body);
  const fgRaw = d.color;
  const bgRaw = BG_PROPS.map((p) => d[p]).find(Boolean);
  if (!fgRaw || !bgRaw) continue;
  // A background shorthand carrying more than a colour (image, gradient,
  // position) is not a flat backdrop — skip rather than guess.
  if (/url\(|gradient/i.test(bgRaw)) continue;

  const backdropExpr = backdropFor(r.selector);
  if (backdropExpr === SKIP) continue;

  for (const [tname, vars] of Object.entries(themes)) {
    const bgRes = parseColor(bgRaw, vars);
    const fg = parseColor(fgRaw, vars);
    if (!bgRes || !fg) continue;
    // A TRANSLUCENT background — `color-mix(var(--c) 14%, transparent)`, the
    // standard tint here — is not a reason to skip. Skipping it is how the
    // module-header icon tint went unmeasured. Composite it over the surface
    // the element actually sits on, per BACKDROPS.
    const ground = parseColor(backdropExpr, vars);
    if (!ground) continue;
    const bg = over(bgRes, ground.slice(0, 3));
    const assumed = (bgRes[3] ?? 1) < 1;
    const ratio = contrast(over(fg, bg), bg);
    const large = isLargeText(d);
    const need = large ? 3 : 4.5;
    if (ratio + 1e-9 < need) {
      const row = {
        theme: tname, selector: r.selector, at: `${r.file}:${r.line}`,
        fg: fgRaw, bg: bgRaw, ratio, need, large, assumed,
      };
      (isDisabledState(r.selector) ? exempted : realFails).push(row);
    }
  }
}

/* ── Report ─────────────────────────────────────────────────────────────── */

const f2 = (n) => n.toFixed(2).padStart(5);
let failed = false;

if (AS_MD) {
  const hex = (c) => c ? '#' + c.slice(0, 3).map((n) => Math.round(n).toString(16).padStart(2, '0')).join('').toUpperCase() : '?';
  for (const [tname, vars] of Object.entries(themes)) {
    console.log(`\n#### ${tname.toUpperCase()}\n`);
    console.log(`| foreground | resolved | ${BACKGROUNDS.map((b) => `\`${b}\``).join(' | ')} |`);
    console.log(`|---|---|${BACKGROUNDS.map(() => '---').join('|')}|`);
    for (const fgName of FOREGROUNDS) {
      const fgRaw = parseColor(`var(${fgName})`, vars);
      if (!fgRaw) continue;
      const cells = BACKGROUNDS.map((bgName) => {
        const bg = parseColor(`var(${bgName})`, vars);
        if (!bg) return '—';
        const r = contrast(over(fgRaw, bg.slice(0, 3)), bg.slice(0, 3));
        return r < 4.5 ? `**${r.toFixed(2)}**` : r.toFixed(2);
      });
      console.log(`| \`${fgName}\` | ${hex(fgRaw)} | ${cells.join(' | ')} |`);
    }
    console.log(`\n| on-pair | ratio |`);
    console.log(`|---|---|`);
    for (const [fgName, bgName] of ON_PAIRS) {
      const bg = parseColor(`var(${bgName})`, vars);
      const fg = parseColor(`var(${fgName})`, vars);
      if (!bg || !fg) continue;
      const r = contrast(over(fg, bg.slice(0, 3)), bg.slice(0, 3));
      console.log(`| \`${fgName}\` on \`${bgName}\` | ${r < 4.5 ? `**${r.toFixed(2)}**` : r.toFixed(2)} |`);
    }
  }
  process.exit(0);
}

console.log(`check-contrast: ${files.length} stylesheets, ${allRules.length} rules, ` +
  `${Object.keys(light).length} light tokens, ${Object.keys(dark).length} dark tokens\n`);

console.log('── 1 · Theme parity ────────────────────────────────────────────');
if (!parityFails.length) console.log('   every theme-qualified token is declared in both themes\n');
else {
  failed = true;
  for (const p of parityFails)
    console.log(`   MISSING IN ${p.declaredIn === 'dark' ? 'LIGHT' : 'DARK '}  ${p.token}  (only ${p.at})`);
  console.log('');
}

console.log('── 2 · Token matrix ────────────────────────────────────────────');
const below = matrix.filter((m) => m.ratio < 4.5);
const belowUI = matrix.filter((m) => m.ratio < 3);
console.log(`   ${matrix.length} pairs measured · ${below.length} below 4.5:1 (body text) · ` +
  `${belowUI.length} below 3:1 (UI)`);
console.log(`   NOTE: reported, not failed — many are pairings nothing renders.`);
for (const m of (SHOW_MATRIX ? matrix : matrix.filter((x) => x.onPair || x.ratio < 3))
  .sort((a, b) => a.ratio - b.ratio)) {
  const tag = m.ratio >= 4.5 ? 'AA  ' : m.ratio >= 3 ? 'large' : 'FAIL ';
  console.log(`   ${m.theme.padEnd(5)} ${f2(m.ratio)}:1  ${tag}  ${m.fg} on ${m.bg}`);
}
console.log('');

console.log('── 3 · Pairs stated in a single rule ───────────────────────────');
if (exempted.length) {
  console.log(`   ${exempted.length} below threshold but EXEMPT under WCAG 1.4.3 (inactive controls):`);
  for (const r of exempted.sort((a, b) => a.ratio - b.ratio))
    console.log(`     ${r.theme.padEnd(5)} ${f2(r.ratio)}:1  ${r.selector}  (${r.at})`);
  console.log('');
}
if (!realFails.length) console.log('   every co-located colour/background pair clears its threshold\n');
else {
  failed = true;
  for (const r of realFails.sort((a, b) => a.ratio - b.ratio)) {
    console.log(`   ${r.theme.padEnd(5)} ${f2(r.ratio)}:1  need ${r.need}:1${r.large ? ' (large)' : ''}` +
      `${r.assumed ? '  [translucent bg composited over --bg]' : ''}`);
    console.log(`          ${r.selector}`);
    console.log(`          ${r.at} · color: ${r.fg} · background: ${r.bg}`);
  }
  console.log('');
}

/* ── Baseline ──────────────────────────────────────────────────────────────
 * This gate has existed, caught real failures, and run NOWHERE: `npm run
 * check` invokes check-tokens and check-classes, `.github/workflows/ci.yml`
 * runs the same two, and neither has ever called this file. That is why five
 * failing pairs sat unreported long enough to be signed off twice.
 *
 * It cannot simply be wired in, because the failures it finds today are a
 * DESIGN decision — chips coloured with a tint of their own foreground, whose
 * only remedy either darkens the label or destroys the colour coding. Blocking
 * on those would mean a red build with no correct fix available.
 *
 * So: the known set is frozen in `contrast-baseline.json` and anything NEW
 * fails. A pair that gets WORSE also fails, because "already failing" must not
 * become a place to hide a regression. Regenerate deliberately with
 * `--update-baseline`, never as a reflex — the file is the record of what was
 * accepted and why, and shrinking it is the direction of travel.
 */
const BASELINE_PATH = new URL('./contrast-baseline.json', import.meta.url);
const keyOf = (r) => `${r.at}|${r.selector}|${r.theme}`;

let baseline = {};
try {
  baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8')).pairs || {};
} catch { /* absent on first run — every failure is then new, which is correct */ }

if (process.argv.includes('--update-baseline')) {
  const pairs = {};
  for (const r of realFails.sort((a, b) => keyOf(a).localeCompare(keyOf(b)))) {
    pairs[keyOf(r)] = { ratio: Number(r.ratio.toFixed(2)), need: r.need };
  }
  writeFileSync(BASELINE_PATH, JSON.stringify({
    note: 'Known-failing pairs, accepted deliberately. NEW failures and REGRESSIONS still fail the gate. Shrink this file; do not grow it.',
    generated: new Date().toISOString().slice(0, 10),
    pairs,
  }, null, 2) + '\n');
  console.log(`check-contrast: baseline written — ${Object.keys(pairs).length} known pairs`);
  process.exit(0);
}

const isNew = [];
const worse = [];
for (const r of realFails) {
  const known = baseline[keyOf(r)];
  if (!known) isNew.push(r);
  // 0.01 of slack: the ratio is printed to two places, so an unchanged pair can
  // differ in the last digit without anything having actually moved.
  else if (r.ratio < known.ratio - 0.01) worse.push({ r, was: known.ratio });
}

const knownCount = realFails.length - isNew.length;
if (knownCount) {
  console.log(`   ${knownCount} known-failing pair(s) held at baseline — see scripts/contrast-baseline.json\n`);
}
for (const { r, was } of worse) {
  console.error(`   REGRESSION  ${r.selector} (${r.theme}) was ${f2(was)}:1, now ${f2(r.ratio)}:1`);
}
for (const r of isNew) {
  console.error(`   NEW FAILURE ${r.selector} (${r.theme}) ${f2(r.ratio)}:1, needs ${r.need}:1  — ${r.at}`);
}

if (isNew.length || worse.length) {
  console.error(`\ncheck-contrast: FAILED — ${isNew.length} new, ${worse.length} regressed`);
  process.exit(1);
}
console.log('check-contrast: no new failures and no regressions');
process.exit(0);
console.log('check-contrast: OK');
