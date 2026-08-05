/**
 * The scoped palette, checked against the stylesheet it was transcribed from.
 *
 * ── Why this test exists at all ──────────────────────────────────────────────
 *
 * `theme/palette.generated.ts` opens by explaining that the mobile palette is
 * "the one place in the system that cannot alias and therefore the one
 * guaranteed to go stale. It did, twice." The answer there was to GENERATE it
 * from the web stylesheets.
 *
 * `theme/surface.ts` cannot be generated the same way — `npm run tokens` reads
 * `:root` blocks and this palette deliberately lives in a private
 * `--k-scoped-*` layer specifically so that the web's own gates do NOT see it as
 * a product token (see `surface-theme.css` §1, and its note on
 * `check-contrast.mjs` re-measuring the entire product against indigo when the
 * layering is collapsed). So it is a hand transcription of nineteen literals,
 * which is the exact failure mode that file already paid for twice.
 *
 * This closes it. The CSS is parsed and compared value by value. If the owner
 * changes a hex on the web and nobody changes it here, this goes red.
 *
 * ── What it does NOT prove ───────────────────────────────────────────────────
 *
 * Nothing about contrast. `surface-theme.css` states plainly that its own
 * measured ratios are NOT enforced by `npm run check` — they were taken out of
 * band because the gate has no model of scope — and there is no mobile
 * equivalent of that gate at all. It also proves nothing about what renders:
 * `node --test` cannot load a `.tsx` file, so no screen in this app is
 * reachable. What it proves is that the two files agree, which is the one
 * failure a transcription actually has.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

import { srcPath } from '../../test/source.ts';
import { SCOPED, surfaceTokens } from '../surface.ts';
import { tokens } from '../tokens.ts';
import { darkPalette } from '../palette.generated.ts';

/**
 * The web stylesheet.
 *
 * Reached by walking up from `mobile/src` rather than from the working
 * directory, so the suite runs the same from `mobile/` and from the repo root —
 * the same reasoning `test/source.ts` gives for `findSrc()`.
 *
 * READ ONLY. Nothing in this suite writes outside `mobile/`.
 */
const CSS = path.resolve(srcPath('.'), '..', '..', 'frontend', 'src', 'styles', 'surface-theme.css');

function css(): string {
  assert.ok(
    existsSync(CSS),
    `frontend/src/styles/surface-theme.css is missing at ${CSS}. `
    + 'That file is the source of truth for these nineteen values; without it '
    + 'theme/surface.ts is an unchecked hand transcription. If the stylesheet '
    + 'moved, move this path with it — do not delete the test.',
  );
  return readFileSync(CSS, 'utf8');
}

/**
 * The `--k-scoped-*` declarations inside one `[data-theme="…"]` block.
 *
 * Brace-matched from the selector rather than regexed over the whole file: §2
 * and §3 both declare properties on `.k-surface-theme` and several of them read
 * `var(--k-scoped-…)`, so a file-wide match would collect the CONSUMERS
 * alongside the declarations and compare a token against its own reference.
 */
function scopedBlock(theme: 'light' | 'dark'): Record<string, string> {
  const src = css();
  const selector = `[data-theme="${theme}"] {`;
  const start = src.indexOf(selector);
  assert.notEqual(start, -1, `no [data-theme="${theme}"] block in surface-theme.css`);

  let depth = 0;
  let end = src.indexOf('{', start);
  for (let i = end; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
  }
  const body = src.slice(src.indexOf('{', start) + 1, end);

  const out: Record<string, string> = {};
  const re = /--k-scoped-([a-z0-9-]+)\s*:\s*([^;]+);/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) out[m[1]] = m[2].trim();
  return out;
}

/** `on-primary-container` → `onPrimaryContainer`. */
const camel = (kebab: string) =>
  kebab.replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase());

/**
 * One `--k-scoped-*` value, with a reference to another one resolved.
 *
 * Dark's `--k-scoped-primary-text` is written `var(--k-scoped-primary)` rather
 * than as a repeated literal, deliberately — the CSS says so — so a comparison
 * that did not follow it would report a mismatch against the string "var(…)".
 */
function resolve(block: Record<string, string>, key: string): string {
  const raw = block[key];
  if (raw === undefined) return raw;
  const ref = /^var\(\s*--k-scoped-([a-z0-9-]+)\s*\)$/.exec(raw);
  return ref ? block[ref[1]] : raw;
}

/** The CSS name for each field of `ScopedPalette`, minus `glass`. */
const FIELDS: Array<[keyof typeof SCOPED.light, string]> = [
  ['bg', 'bg'],
  ['surface', 'surface'],
  ['sLow', 's-low'],
  ['sContainer', 's-container'],
  ['sHigh', 's-high'],
  ['sHighest', 's-highest'],
  ['outline', 'outline'],
  ['outlineVariant', 'outline-variant'],
  ['onSurface', 'on-surface'],
  ['onSurface2', 'on-surface-2'],
  ['onSurface3', 'on-surface-3'],
  ['onSurfaceDisabled', 'on-surface-disabled'],
  ['primary', 'primary'],
  ['primaryHover', 'primary-hover'],
  ['primaryText', 'primary-text'],
  ['primaryContainer', 'primary-container'],
  ['onPrimary', 'on-primary'],
  ['onPrimaryContainer', 'on-primary-container'],
];

// ── The transcription ─────────────────────────────────────────────────────────

for (const theme of ['light', 'dark'] as const) {
  test(`${theme}: every scoped value equals the web stylesheet's`, () => {
    const block = scopedBlock(theme);
    for (const [field, cssName] of FIELDS) {
      const expected = resolve(block, cssName);
      assert.ok(
        expected,
        `--k-scoped-${cssName} is missing from the ${theme} block. Either the `
        + 'stylesheet dropped it or this map names it wrongly.',
      );
      assert.equal(
        (SCOPED[theme][field] as string).toUpperCase(),
        expected.toUpperCase(),
        `theme/surface.ts ${theme}.${field} is ${SCOPED[theme][field]} but `
        + `--k-scoped-${cssName} is ${expected}. The stylesheet is the source of `
        + 'truth — copy it across, do not change the CSS to match this file.',
      );
    }
  });

  test(`${theme}: the glass tint is the stylesheet's triplet at the bar's alpha`, () => {
    // The web keeps this as a bare `R, G, B` because its consumers write
    // `rgba(var(--glass-tint), var(--glass-alpha))`. RN needs the finished
    // string, so the alpha is baked — but the CHANNELS still have to match, and
    // that is the half that can drift.
    const triplet = scopedBlock(theme)['glass-tint'];
    const nums = triplet.split(',').map(x => x.trim());
    assert.equal(nums.length, 3, `--k-scoped-glass-tint is "${triplet}", expected three channels`);
    assert.equal(
      SCOPED[theme].glass,
      `rgba(${nums.join(',')},0.78)`,
      `${theme} glass tint disagrees with --k-scoped-glass-tint`,
    );
  });
}

test('the stylesheet declares every value in BOTH themes', () => {
  // `surface-theme.css` §1 makes the light selector `[data-theme="light"]`
  // ALONE — not `:root, [data-theme="light"]` — precisely so a token declared in
  // one theme and forgotten in the other is a failure rather than a silent
  // half-theme. That property is worth asserting from this side too: the CSS
  // gate that would catch it (`check-contrast`'s theme-parity pass) skips
  // universal blocks, which is the hole that decision was closing.
  const light = scopedBlock('light');
  const dark  = scopedBlock('dark');
  assert.deepEqual(
    Object.keys(light).sort(), Object.keys(dark).sort(),
    'the light and dark --k-scoped-* blocks declare different tokens',
  );
});

// ── The dark ink ramp ─────────────────────────────────────────────────────────

test('the dark foreground ramp is still Kartavaya\'s own, verbatim', () => {
  // The frozen palette's first rule: "Text colours are Kartavaya's own,
  // verbatim. There is no second foreground ramp." In dark that means these
  // three are copies of the generated palette's, and `surface.ts` restates them
  // as literals only so the transcription check above can see them.
  //
  // If the product's dark ink ever moves, this fails and names the file to
  // change. Without it the copy would quietly become a SECOND ramp — which is
  // the exact thing the palette forbids.
  assert.equal(SCOPED.dark.onSurface,  darkPalette.onSurface);
  assert.equal(SCOPED.dark.onSurface2, darkPalette.onSurface2);
  assert.equal(SCOPED.dark.onSurface3, darkPalette.onSurface3);
});

// ── The substitution ──────────────────────────────────────────────────────────

test('the scoped token set has exactly the keys the cream one has', () => {
  // A screen moves between `useTheme` and `useSurfaceTheme` by changing one
  // line, which is only true while the two shapes are identical. A missing key
  // is `undefined` at a call site, and `backgroundColor: undefined` renders
  // transparent rather than throwing.
  const cream = Object.keys(surfaceTokens.light).sort();
  const dark  = Object.keys(surfaceTokens.dark).sort();
  assert.deepEqual(cream, dark, 'the two scoped themes have different keys');
  assert.ok(cream.length > 30, `expected the full token set, found ${cream.length} keys`);
});

test('every ground, surface and primary token carries the SCOPED value', () => {
  // The substitution itself. Spelled out per token rather than asserted in bulk,
  // because the failure this catches is one line being forgotten in
  // `scopeTokens` — and a bulk assertion over "did anything change" passes
  // happily with sixteen of seventeen done.
  for (const theme of ['light', 'dark'] as const) {
    const k = SCOPED[theme];
    const t = surfaceTokens[theme];
    const pairs: Array<[string, string, string]> = [
      ['bg', t.bg, k.bg],
      ['surface', t.surface, k.surface],
      ['surfaceLow', t.surfaceLow, k.sLow],
      ['surfaceHigh', t.surfaceHigh, k.sHigh],
      ['surface1', t.surface1, k.surface],
      ['surface2', t.surface2, k.sLow],
      ['surface3', t.surface3, k.sContainer],
      ['surface4', t.surface4, k.sHigh],
      ['surface5', t.surface5, k.sHighest],
      ['ink', t.ink, k.onSurface],
      ['ink2', t.ink2, k.onSurface2],
      ['ink3', t.ink3, k.onSurface3],
      ['ink4', t.ink4, k.onSurface3],
      ['inkDisabled', t.inkDisabled, k.onSurfaceDisabled],
      ['onSurface', t.onSurface, k.onSurface],
      ['onSurfaceVar', t.onSurfaceVar, k.onSurface2],
      ['onSurfaceVar2', t.onSurfaceVar2, k.onSurface3],
      ['onSurfaceFaint', t.onSurfaceFaint, k.onSurface3],
      ['primary', t.primary, k.primary],
      ['primaryHover', t.primaryHover, k.primaryHover],
      ['primaryText', t.primaryText, k.primaryText],
      ['primaryContainer', t.primaryContainer, k.primaryContainer],
      ['onPrimary', t.onPrimary, k.onPrimary],
      ['onPrimaryContainer', t.onPrimaryContainer, k.onPrimaryContainer],
      ['outline', t.outline, k.outline],
      ['outlineVar', t.outlineVar, k.outlineVariant],
      ['tabBg', t.tabBg, k.glass],
      // The brand ramp, re-pointed at the primary family exactly as
      // surface-theme.css §3 does. Left alone it is the product-wide #05b7aa,
      // which is a different teal from this scope's primary in both themes.
      ['teal', t.teal, k.primary],
      ['mid', t.mid, k.primary],
      ['blue', t.blue, k.primary],
    ];
    for (const [name, got, want] of pairs) {
      assert.equal(got, want, `${theme}: scoped token "${name}" was not substituted`);
    }
    assert.deepEqual(t.gradient,  [k.primaryHover, k.primary, k.primary], `${theme}: gradient`);
    assert.deepEqual(t.gradient2, [k.primaryHover, k.primary], `${theme}: gradient2`);
  }
});

test('the semantic set is NOT touched — meanings are not ground', () => {
  // "Status, approval and priority, the semantic set (--ok / --warn / --danger
  // and their containers) … are NOT touched. They are meanings, not ground."
  // The spread in `scopeTokens` is what makes this true by construction; this is
  // what notices somebody adding one of them to the override list.
  for (const theme of ['light', 'dark'] as const) {
    for (const key of [
      'success', 'successBg', 'onSuccess', 'onSuccessContainer',
      'error', 'errorBg', 'onError', 'onErrorContainer',
      'approval', 'approvalBg', 'onApprovalContainer',
      'secondaryContainer', 'onSecondaryContainer',
      'tertiaryContainer', 'onTertiaryContainer',
      'purple', 'purpleContainer',
    ] as const) {
      assert.equal(
        surfaceTokens[theme][key], tokens[theme][key],
        `${theme}: "${key}" was re-coloured by the scope. It is a meaning, not ground.`,
      );
    }
  }
});
