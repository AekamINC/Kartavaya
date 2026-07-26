/**
 * gen-tokens.mjs — generate mobile/src/theme/tokens.ts from the web stylesheets.
 *
 * From `design-handover/17-mobile-app.md`, which is emphatic about why this is
 * generated rather than transcribed: React Native has no CSS custom properties,
 * so tokens.ts must hold literal values, which makes it the one file in the
 * system that cannot alias and therefore the one guaranteed to go stale. It
 * already had — it shipped carrying `ok: '#16803F'`, `warn: '#A66207'` and
 * `onSurface3: '#74786F'` after all three were darkened for contrast.
 *
 * Two things it does that a transcription does not: it RESOLVES var() aliases to
 * literals — three of the six statuses and six of the eight approval/priority
 * tokens are aliases by design — and it THROWS on an undefined token rather
 * than emitting an empty string, which is the failure that put --font-indic and
 * fifteen semantic aliases into the handover undeclared.
 *
 * DIVERGENCE FROM THE SCRIPT IN `17`. It reads a single
 * `frontend/src/styles/tokens.css` and takes the first `:root` and first
 * `[data-theme="dark"]` block with a regex. Neither holds here:
 *
 *   · There is no styles/tokens.css. The tokens live in `lib/tokens.css` plus
 *     `styles/kartavaya-design.css`, with more in dark-theme.css and module.css.
 *   · kartavaya-design.css alone has EIGHT `:root` blocks and TWO dark blocks.
 *     A first-match regex would have captured about a tenth of the palette and
 *     silently emitted a tokens.ts that looked plausible.
 *   · Cascade order decides the winner. kartavaya-design.css is imported after
 *     the barrel, so its `:root` overrides lib/tokens.css. Reading files in the
 *     wrong order produces the wrong palette with no error.
 *
 * So: files in cascade order, every matching block, brace-matched rather than
 * regex-matched.
 *
 * Usage: cd mobile && npm run tokens
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';

const FRONTEND = join('..', 'frontend', 'src');

/**
 * Cascade order, mirroring App.jsx: App.css, then styles/index.css (whose barrel
 * pulls lib/tokens.css first), then kartavaya-design, editorial, settings.
 * Later files override earlier ones, exactly as the browser resolves them.
 * Keep this list in step with App.jsx and styles/index.css.
 */
const SHEETS = [
  'lib/tokens.css',
  'styles/layout.css',
  'styles/modern-components.css',
  'styles/dark-theme.css',
  'styles/components.css',
  'styles/module.css',
  'styles/kartavaya-design.css',
  'styles/editorial.css',
  'styles/settings.css',
];

const LIGHT_SELECTORS = [':root', '[data-theme="light"]'];
const DARK_SELECTORS = ['[data-theme="dark"]'];

/** Strip comments so a commented-out token is not read as declared. */
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, ' ');

/**
 * Every top-level rule as { selector, body }, brace-matched so nested at-rules
 * and color-mix() parentheses cannot end a block early.
 */
function rules(css) {
  const out = [];
  let i = 0;
  while (i < css.length) {
    const open = css.indexOf('{', i);
    if (open === -1) break;
    const selector = css.slice(i, open).trim();
    let depth = 1;
    let j = open + 1;
    while (j < css.length && depth > 0) {
      if (css[j] === '{') depth++;
      else if (css[j] === '}') depth--;
      j++;
    }
    out.push({ selector, body: css.slice(open + 1, j - 1) });
    i = j;
  }
  return out;
}

/** Does this selector list target the theme we are collecting? */
const targets = (selector, wanted) =>
  selector
    .split(',')
    .map((s) => s.trim())
    .some((s) => wanted.includes(s));

function collect(wanted) {
  const decls = {};
  for (const rel of SHEETS) {
    const path = join(FRONTEND, rel);
    if (!existsSync(path)) continue;   // barrel members are optional
    const css = stripComments(readFileSync(path, 'utf8').replace(/^﻿/, ''));
    for (const { selector, body } of rules(css)) {
      if (!targets(selector, wanted)) continue;
      for (const [, k, v] of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
        decls[k.trim()] = v.trim();   // later file wins, matching the cascade
      }
    }
  }
  return decls;
}

const lightRaw = collect(LIGHT_SELECTORS);
const darkRaw = { ...lightRaw, ...collect(DARK_SELECTORS) };

const camel = (k) => k.replace(/^--/, '').replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase());

/**
 * Resolve `var(--x)` to a literal. Only whole-value aliases are followed; a
 * value that merely mentions var() inside color-mix() cannot become an RN
 * colour and is dropped by the filter below.
 */
function resolve(all, value, depth = 0) {
  if (depth > 8) throw new Error(`circular var(): ${value}`);
  const m = value.match(/^var\(\s*(--[\w-]+)\s*\)$/);
  if (!m) return value;
  if (!(m[1] in all)) throw new Error(`undefined token: ${m[1]} (referenced by an alias)`);
  return resolve(all, all[m[1]], depth + 1);
}

/**
 * RN understands #hex, rgb() and rgba(). Not color-mix, not gradients, not lengths.
 *
 * The `var(` test is not redundant with resolve(). resolve() only follows a value
 * that is ENTIRELY `var(--x)`; a var() nested inside a function is left alone.
 * `--side-bg: rgb(var(--side-ink))` — the channel-triple pattern, where the token
 * holds `28 26 20` rather than a colour — therefore reached this filter with its
 * var() intact, matched `^rgba?\(`, and was emitted as
 * `sideBg: 'rgb(var(--side-ink))'`. React Native cannot parse that: the style is
 * dropped and the element renders transparent, silently. It is not a colour, so
 * it is filtered out here alongside color-mix(), rather than shipped as one.
 */
const isColour = (v) =>
  !/\bvar\(/i.test(v) && (/^#[0-9a-f]{3,8}$/i.test(v) || /^rgba?\(/i.test(v));

function palette(raw) {
  const out = {};
  for (const [k, v] of Object.entries(raw)) {
    let resolved;
    try {
      resolved = resolve(raw, v);
    } catch (err) {
      // An undefined alias is a real defect — the whole point of this script.
      console.error(`gen-tokens: ${err.message}`);
      process.exit(1);
    }
    if (!isColour(resolved)) continue;
    out[camel(k)] = resolved;
  }
  return out;
}

const light = palette(lightRaw);
const dark = palette(darkRaw);

if (Object.keys(light).length < 30) {
  console.error(
    `gen-tokens: only ${Object.keys(light).length} light colours found. ` +
    `That is too few to be right — check SHEETS against App.jsx and styles/index.css.`
  );
  process.exit(1);
}

const fmt = (o) =>
  Object.entries(o)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `  ${k}: '${v}',`)
    .join('\n');

const banner = `// GENERATED by scripts/gen-tokens.mjs from the frontend stylesheets.
// Do NOT edit by hand — run \`npm run tokens\` after any token change on the web.
//
// 17-mobile-app.md: React Native has no custom properties, so the mobile palette
// holds literals, which makes it the one place in the system that cannot alias
// and therefore the one guaranteed to go stale. It did, twice — shipping
// ok: '#16803F', warn: '#A66207' and onSurface3: '#74786F' after all three were
// darkened for contrast. Generating it removes that failure mode entirely.
//
// Names are the CSS token names in camelCase. tokens.ts maps them onto the
// mobile API (ok -> success, warn -> approval, danger -> error, and so on) so
// that renaming a CSS token surfaces as a TypeScript error there rather than a
// silently missing colour here.
//
// Two things RN gets wrong easily, per 17: primaryHover reverses direction by
// theme, so a Pressable style that subtracts luminance is wrong in one mode; and
// primaryContainer is lighter than primary in light but darker in dark, so any
// primaryContainer background carrying primary text must be checked in both.
`;

const outPath = join('src', 'theme', 'palette.generated.ts');
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(
  outPath,
  `${banner}
export const lightPalette = {
${fmt(light)}
} as const;

export const darkPalette = {
${fmt(dark)}
} as const;

export type GeneratedPalette = typeof lightPalette;
export type GeneratedTokenName = keyof GeneratedPalette;
`
);

console.log(
  `gen-tokens: ${Object.keys(light).length} light, ${Object.keys(dark).length} dark → ${outPath}`
);
