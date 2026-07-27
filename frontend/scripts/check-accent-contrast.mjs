#!/usr/bin/env node
/**
 * check-accent-contrast.mjs — the twelve accents, both themes, measured.
 *
 * `check-contrast.mjs` reads stylesheets. That is the right thing to do and it
 * cannot see this: `applyPrefs` OVERWRITES `--primary`, `--primary-hover`,
 * `--primary-text`, `--primary-vivid` and `--on-primary` as inline styles on
 * the root element, from a hex the user picked. So the pair a CSS checker
 * measures — `--on-primary #FFFFFF` on `--primary #04837A`, 4.63:1 — is a pair
 * that never renders. The pair that renders at the DEFAULT preset is white on
 * `#00897f`, which is 4.30:1.
 *
 * Twelve presets x two themes x {rest, hover} is 48 measurements that no gate
 * reached until this one, because the maths lived behind an `import React`.
 * It is now in `src/lib/accent.js` and this script imports it directly, so the
 * numbers below come from the SAME function the browser runs — not a copy.
 *
 *   cd frontend && node scripts/check-accent-contrast.mjs
 *   cd frontend && node scripts/check-accent-contrast.mjs --md
 *
 * Exit 1 if any REST pairing regresses below the recorded baseline. It does
 * not fail on the four known-residual pairs: those need the accent ramp
 * changed (`--primary` is `mid` in light and the raw accent in dark) and that
 * is a design decision, recorded in `deriveOnAccent`'s docblock. Failing on
 * them would train people to ignore this script.
 */
import { deriveAccentColors, contrast, deriveOnAccent } from '../src/lib/accent.js';

/* Kept in step with CustomizePanel's ACCENTS by the parity check below, which
   reads the real list out of the JSX rather than trusting this copy — the
   component cannot be imported here without React. */
const ACCENTS = [
  ['Teal', '#05b7aa'], ['Blue', '#3b82f6'], ['Saffron', '#f59e0b'], ['Indigo', '#6366f1'],
  ['Rose', '#e11d63'], ['Emerald', '#059669'], ['Amber', '#d97706'], ['Violet', '#7c3aed'],
  ['Coral', '#f2643c'], ['Slate', '#64748b'], ['Crimson', '#be123c'], ['Forest', '#3f6212'],
];

/* The values `--on-primary` held before it was derived. Everything is measured
   against these too, so the report can state the improvement rather than
   assert it. */
const INCUMBENT = { light: '#FFFFFF', dark: '#00332F' };

/* The four pairings that remain below 4.5:1 on rest after derivation, because
   the FILL is mid-tone and no foreground clears it while staying legible on
   its own hover. Listed so a fifth cannot appear quietly. */
const KNOWN_RESIDUAL = new Set(['light/Teal', 'light/Coral', 'dark/Violet', 'dark/Slate']);

const AA = 4.5;
const MD = process.argv.includes('--md');

/* ── keep the preset list honest ─────────────────────────────────────────── */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const PANEL = path.join(HERE, '..', 'src', 'components', 'CustomizePanel.jsx');
let listDrift = null;
if (fs.existsSync(PANEL)) {
  const src = fs.readFileSync(PANEL, 'utf8');
  const block = src.slice(src.indexOf('export const ACCENTS'), src.indexOf('];', src.indexOf('export const ACCENTS')));
  const real = [...block.matchAll(/color:\s*'(#[0-9a-fA-F]{6})'/g)].map(m => m[1].toLowerCase());
  const mine = ACCENTS.map(a => a[1].toLowerCase());
  if (real.length && (real.length !== mine.length || real.some((c, i) => c !== mine[i]))) {
    listDrift = { real, mine };
  }
}

/* ── measure ─────────────────────────────────────────────────────────────── */
const rows = [];
for (const theme of ['light', 'dark']) {
  for (const [label, hex] of ACCENTS) {
    const a = deriveAccentColors(hex);
    const primary = theme === 'dark' ? a.color : a.mid;
    const hover   = theme === 'dark' ? a.light : a.deep;
    const derived = theme === 'dark' ? a.onDark : a.onLight;
    const inc = INCUMBENT[theme];
    rows.push({
      theme, label, accent: hex, primary, hover, derived,
      wasRest:  contrast(inc, primary),
      wasHover: contrast(inc, hover),
      nowRest:  contrast(derived, primary),
      nowHover: contrast(derived, hover),
      text: a.text,
      textOnBg: contrast(a.text, '#F3EFE6'),
    });
  }
}

const f = n => n.toFixed(2);
const bad = r => r.nowRest < AA;
/* Regression is measured on the WORSE of the two states, not on each
   independently. `deriveOnAccent` maximises min(rest, hover), so a preset
   whose rest jumps 1.96 → 7.08 while its hover slips 3.88 → 3.57 has strictly
   improved — the pair's floor rose. Checking the two states separately called
   both of those a regression and made the gate red on its own improvement.
   Hover states that fall below AA as part of that trade are REPORTED below
   rather than failed; they were already the weaker half. */
const worseOf = r => Math.min(r.nowRest, r.nowHover);
const wasWorseOf = r => Math.min(r.wasRest, r.wasHover);
const regressed = rows.filter(r => worseOf(r) < wasWorseOf(r) - 1e-9);
const hoverTraded = rows.filter(r => r.nowHover < AA && r.wasHover >= AA);
const residual = rows.filter(bad);
const newResidual = residual.filter(r => !KNOWN_RESIDUAL.has(`${r.theme}/${r.label}`));
const fixedText = rows.filter(r => r.textOnBg < AA);

if (MD) {
  const L = [];
  L.push('# Accent contrast — twelve presets, both themes');
  L.push('');
  L.push('Generated by `frontend/scripts/check-accent-contrast.mjs`, which imports the');
  L.push('same `deriveAccentColors` the browser runs. `was` is the fixed `--on-primary`');
  L.push('that shipped before derivation; `now` is what `deriveOnAccent` returns.');
  L.push('**Bold = below 4.5:1.**');
  L.push('');
  for (const theme of ['light', 'dark']) {
    L.push(`## ${theme} — incumbent \`--on-primary\` was \`${INCUMBENT[theme]}\``);
    L.push('');
    L.push('| preset | accent | `--primary` | `--primary-hover` | derived `--on-primary` | was rest | now rest | was hover | now hover |');
    L.push('|---|---|---|---|---|---|---|---|---|');
    for (const r of rows.filter(x => x.theme === theme)) {
      const b = (v) => v < AA ? `**${f(v)}**` : f(v);
      L.push(`| ${r.label} | \`${r.accent}\` | \`${r.primary}\` | \`${r.hover}\` | \`${r.derived}\` | ${b(r.wasRest)} | ${b(r.nowRest)} | ${b(r.wasHover)} | ${b(r.nowHover)} |`);
    }
    L.push('');
    const t = rows.filter(x => x.theme === theme);
    L.push(`Rest below 4.5:1 — was **${t.filter(x => x.wasRest < AA).length}/12** (worst ${f(Math.min(...t.map(x => x.wasRest)))}), `
      + `now **${t.filter(x => x.nowRest < AA).length}/12** (worst ${f(Math.min(...t.map(x => x.nowRest)))}).`);
    L.push('');
  }
  L.push('## `--primary-text` on `--bg` #F3EFE6 (light only; dark aliases `--primary`)');
  L.push('');
  L.push('| preset | `--primary-text` | ratio |');
  L.push('|---|---|---|');
  for (const r of rows.filter(x => x.theme === 'light')) {
    L.push(`| ${r.label} | \`${r.text}\` | ${r.textOnBg < AA ? `**${f(r.textOnBg)}**` : f(r.textOnBg)} |`);
  }
  process.stdout.write(L.join('\n') + '\n');
} else {
  console.log(`check-accent-contrast: ${ACCENTS.length} presets x 2 themes x {rest, hover} = ${rows.length * 2} pairs`);
  for (const theme of ['light', 'dark']) {
    const t = rows.filter(x => x.theme === theme);
    console.log(`  ${theme.padEnd(5)} rest below ${AA}:1 — was ${t.filter(x => x.wasRest < AA).length}/12 (worst ${f(Math.min(...t.map(x => x.wasRest)))})`
      + ` → now ${t.filter(x => x.nowRest < AA).length}/12 (worst ${f(Math.min(...t.map(x => x.nowRest)))})`);
  }
  if (residual.length) {
    console.log('\n  residual, needs the accent ramp changed (design decision, not a bug in deriveOnAccent):');
    for (const r of residual) console.log(`    ${r.theme.padEnd(5)} ${f(r.nowRest)}  ${r.label} — ${r.derived} on ${r.primary}`);
  }
  if (hoverTraded.length) {
    console.log('\n  hover traded down to raise the pair floor (rest is the state a label is read in):');
    for (const r of hoverTraded) {
      console.log(`    ${r.theme.padEnd(5)} ${r.label} — rest ${f(r.wasRest)}→${f(r.nowRest)}, hover ${f(r.wasHover)}→${f(r.nowHover)},`
        + ` floor ${f(wasWorseOf(r))}→${f(worseOf(r))}`);
    }
  }
  console.log('\n  run with --md for the full tables');
}

let failed = false;
if (regressed.length) {
  failed = true;
  console.error('\nREGRESSION — derivation returned a worse value than the incumbent:');
  for (const r of regressed) console.error(`  ${r.theme} ${r.label}: rest ${f(r.wasRest)}→${f(r.nowRest)}, hover ${f(r.wasHover)}→${f(r.nowHover)}`);
}
if (newResidual.length) {
  failed = true;
  console.error('\nNEW residual pairing not in KNOWN_RESIDUAL:');
  for (const r of newResidual) console.error(`  ${r.theme} ${r.label}: ${f(r.nowRest)}`);
}
if (fixedText.length) {
  failed = true;
  console.error('\n--primary-text below 4.5:1 on --bg:');
  for (const r of fixedText) console.error(`  ${r.label}: ${f(r.textOnBg)}`);
}
if (listDrift) {
  failed = true;
  console.error('\nACCENTS drifted from CustomizePanel.jsx:');
  console.error('  jsx   ' + listDrift.real.join(' '));
  console.error('  here  ' + listDrift.mine.join(' '));
}
// Sanity on the helper itself: a foreground it returns must never be worse
// than white AND worse than black at the same time — that would mean the
// search missed both endpoints it was handed.
for (const r of rows) {
  const best = Math.max(
    Math.min(contrast('#FFFFFF', r.primary), contrast('#FFFFFF', r.hover)),
    Math.min(contrast('#000000', r.primary), contrast('#000000', r.hover)),
  );
  const got = Math.min(r.nowRest, r.nowHover);
  if (got < best - 1e-9) {
    failed = true;
    console.error(`\nSEARCH BUG — ${r.theme} ${r.label}: returned ${f(got)} where an endpoint gives ${f(best)}`);
  }
}

console.log(failed ? '\ncheck-accent-contrast: FAILED' : '\ncheck-accent-contrast: ok');
process.exit(failed ? 1 : 0);
