/**
 * The mark, on mobile — the port of `frontend/src/lib/brand.jsx`.
 *
 * ── WHY THIS IS A PORT AND NOT A DRAWING ────────────────────────────────────
 *
 * The owner opened the app and said: "login logo is not lotus at all its 'k'".
 * They were right — mobile had never had the mark. `components/Lotus.tsx` is an
 * animated *loader* built from border-radius Views, not the figure; the sign-in
 * screen rendered a bare क in a gradient crown; and `assets/` still carries the
 * old diamond.
 *
 * The web settled this over several rounds on 2026-08-07 and the decisions are
 * recorded in `decision_brand_mark`: full lotus with क in the eye from 32px up,
 * the half-lotus K below that and in the favicon, one component, seven sites.
 * Re-deriving any of that here would produce a second opinion, and two marks
 * that drift is exactly what `LotusK.jsx`'s docblock warns about when it records
 * the cost of the mark and the ornament becoming separate drawings.
 *
 * So every number below is COPIED, and these tests exist to prove it was copied
 * rather than re-invented. They are the only instrument available: Node's
 * type-stripping cannot import a `.tsx`, so a rendered comparison is impossible
 * — see `test/source.ts`.
 *
 * ── WHAT THESE CANNOT PROVE ──────────────────────────────────────────────────
 *
 * That the SVG renders, that `react-native-svg` is linked, or that the letter
 * lands inside the eye rather than through the ring. Those need a device, and
 * this whole series is still unverified at runtime.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { readCode } from '../../../test/source.ts';

/** The web's copy of the same figure — the source of truth for every number. */
function web(rel: string): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const root = join(here, '..', '..', '..', '..', '..', 'frontend', 'src');
  return readFileSync(join(root, rel), 'utf8');
}

// ── The geometry is copied, not re-derived ───────────────────────────────────

test('the four courses are the web COURSES, number for number', () => {
  // `[count, r0, r1, halfWidth, rotationOffset]`. A course that drifts by one
  // unit is a different flower, and nothing on either platform would say so.
  const rows = /export const COURSES[^=]*=\s*\[([\s\S]*?)\n\];/.exec(web('components/brand/Lotus.jsx'));
  assert.ok(rows, 'the web COURSES table has moved — this test is now blind');

  const nums = (s: string) => (s.match(/-?\d+(\.\d+)?/g) ?? []).join(',');
  const mine = /export const COURSES[^=]*=\s*\[([\s\S]*?)\n\];/.exec(readCode('components/brand/Lotus.tsx'));
  assert.ok(mine, 'mobile has no COURSES table');
  assert.equal(nums(mine[1]), nums(rows[1]),
    'the mobile courses no longer match the web figure');
});

test('the eye radius and the letter ratio are the web values', () => {
  const src = web('components/brand/Lotus.jsx');
  const eye = /export const EYE_R = ([\d.]+)/.exec(src)?.[1];
  const ka  = /export const KA_RATIO = ([\d.]+)/.exec(src)?.[1];
  assert.ok(eye && ka, 'the web constants have moved');

  const code = readCode('components/brand/Lotus.tsx');
  // EYE_R is r32 and NOT the r11 it started at: "the letter is sized first and
  // the drawing makes room". KA_RATIO is derived from it (0.246 * 0.82 / 0.72),
  // so shipping one without the other puts क through the ring.
  assert.match(code, new RegExp(`EYE_R = ${eye}\\b`), `EYE_R is not ${eye}`);
  assert.match(code, new RegExp(`KA_RATIO = ${ka}\\b`), `KA_RATIO is not ${ka}`);
});

test('the K is the web PATHS, character for character', () => {
  // Three strokes. Re-typing a cubic by hand is how two figures start to differ
  // in a way nobody can see and nobody can bisect.
  const src = web('components/brand/LotusK.jsx');
  const paths = [...src.matchAll(/d: '([^']+)'/g)].map(m => m[1]);
  assert.equal(paths.length, 3, 'the web K no longer has three paths');

  const code = readCode('components/brand/LotusK.tsx');
  for (const d of paths) {
    assert.ok(code.includes(d), `mobile is missing the web path ${d.slice(0, 18)}…`);
  }
});

test('the tight viewBoxes are copied, because they are what fills the chip', () => {
  // Owner, after two rounds: "chip needs to be fully filled with lotus." The fix
  // was never scaling the <svg> — the emptiness is INSIDE the coordinate space,
  // so the crop is the fix. A wrong box here reads as "the logo is too small"
  // and sends the next person scaling things that cannot help.
  const box = /export const TIGHT_BOX = '([^']+)'/.exec(web('components/brand/LotusK.jsx'))?.[1];
  assert.ok(box);
  assert.ok(readCode('components/brand/LotusK.tsx').includes(box),
    `the K's tight box is not '${box}'`);

  // The lotus crops arithmetically rather than as a literal: courses 1-2 stop at
  // r70, 3-4 at r120, plus half the pen so an outer stroke is not clipped.
  const code = readCode('components/brand/Lotus.tsx');
  assert.match(code, /n <= 2 \? 70 : 120/, 'the lotus crop radii are not the web ones');
  assert.match(code, /\(pen \|\| 1\.6\) \/ 2/, 'the lotus crop does not allow for the pen');
});

// ── The 32px switch, which is the whole decision ─────────────────────────────

test('the full lotus is used from 32 up and the K below', () => {
  // Owner, settled: "anything from 32px onwards used lotus and under only 'k'".
  // Measured, 32 is where a two-course rosette stops being a blob.
  const code = readCode('components/brand/KLogo.tsx');
  assert.match(code, /LOTUS_MIN_FIGURE = 32/, 'the switch is not at 32');
  assert.match(code, /inner >= LOTUS_MIN_FIGURE/,
    'the switch asks about the CHIP size, not the figure size');
});

test('the threshold is measured against the FIGURE, not the chip', () => {
  // "Writing it the other way round meant the threshold silently moved every
  // time the inset changed." The guard is that `inner` is computed from the pad
  // before it is compared.
  const code = readCode('components/brand/KLogo.tsx');
  const inner = code.indexOf('const inner');
  const cmp   = code.indexOf('inner >= LOTUS_MIN_FIGURE');
  assert.ok(inner !== -1 && cmp > inner, 'the figure size is not derived before the comparison');
  assert.doesNotMatch(code, /size >= LOTUS_MIN_FIGURE/,
    'the chip size is being compared to a figure threshold');
});

test('the course/pen ladder is the web ladder', () => {
  // Sixty petals in a 260 box is a smudge under ~96px, so the mark drops
  // COURSES rather than shrinking an unreadable figure, and widens the pen to
  // match. Only works because every course is the same stroke — "one pen".
  const code = readCode('components/brand/KLogo.tsx');
  for (const [px, courses, pen] of [[88, 4, 1.6], [64, 3, 2.4]] as const) {
    assert.match(code, new RegExp(`px >= ${px}[\\s\\S]{0,60}courses: ${courses}[^}]*pen: ${pen}`),
      `the ${px}px rung of the ladder does not match the web`);
  }
  assert.match(code, /courses: 2[^}]*pen: 3\.6/, 'the small rung does not match the web');
});

// ── The mark is never announced ──────────────────────────────────────────────

test('neither figure is exposed to a screen reader', () => {
  // "`aria-hidden` always. It carries no information." On this platform that is
  // `accessible={false}` — an SVG with no label still lands in the tree on
  // Android and reads as an unlabelled button next to the one thing on the
  // sign-in screen a user actually has to find.
  for (const f of ['Lotus', 'LotusK']) {
    assert.match(readCode(`components/brand/${f}.tsx`), /accessible=\{false\}/,
      `${f} is announced`);
  }
});

test('the letter in the eye is hidden too, and carries its language', () => {
  // क is decoration here — the wordmark beside it already says "Kartavaya". But
  // it still needs `lang`/the Indic face, or Android picks a fallback typeface
  // for a single glyph sitting inside the mark.
  const code = readCode('components/brand/KLogo.tsx');
  assert.match(code, /accessible=\{false\}/, 'the क is announced');
  assert.match(code, /hindi\(\)/, 'the क does not use the Indic face');
});

test('the क has no fontWeight', () => {
  // Tiro Devanagari Hindi ships one weight. A '700' is not a bolder Tiro —
  // Android synthesises a smeared fake bold and iOS falls back to the system
  // Devanagari face. This has bitten three screens already.
  assert.doesNotMatch(readCode('components/brand/KLogo.tsx'), /fontWeight/,
    'the mark sets a weight on Devanagari');
});

// ── It is actually used ──────────────────────────────────────────────────────

test('the sign-in screen renders the mark, not a bare letter', () => {
  // This is the whole reason the port happened. A test that only checked the
  // component existed would have passed on the day the owner complained.
  const code = readCode('screens/LoginScreen.tsx');
  assert.match(code, /KLogo/, 'the sign-in screen still draws its own letter');
});

// ── The launcher icon is drawn from the SAME numbers ─────────────────────────
//
// `assets/gen_icons.py` is a THIRD copy of this geometry, in a third language,
// and it has already drifted once: its own header records that it held the
// retired brand blue after the token layer had moved to teal, so "while
// app.json, the token layer and every in-app gradient had moved, the icon on the
// user's home screen was still the old blue". Nobody noticed because a PNG does
// not typecheck.
//
// These read the Python as text and compare it to the TypeScript. They cannot
// prove the PNG was regenerated — only a human looking at it can — but they can
// prove the script that regenerates it would draw the right figure.

const gen = () => {
  const here = dirname(fileURLToPath(import.meta.url));
  return readFileSync(join(here, '..', '..', '..', '..', 'assets', 'gen_icons.py'), 'utf8');
};

test('the icon generator draws the lotus, not a bare letter', () => {
  const py = gen();
  assert.match(py, /^COURSES = \[/m, 'gen_icons.py has no courses table');
  assert.match(py, /^EYE_R = /m, 'gen_icons.py does not know the eye');
});

test('the generator courses match the app courses', () => {
  const nums = (s: string) => (s.match(/-?\d+(\.\d+)?/g) ?? []).join(',');
  const py = /^COURSES = \[([\s\S]*?)^\]/m.exec(gen());
  const ts = /export const COURSES[^=]*=\s*\[([\s\S]*?)\n\];/.exec(readCode('components/brand/Lotus.tsx'));
  assert.ok(py && ts);
  assert.equal(nums(py[1]), nums(ts[1]),
    'the launcher icon would be drawn from a different flower');
});

test('the generator eye and letter ratio match the app', () => {
  const py = gen();
  const code = readCode('components/brand/Lotus.tsx');
  for (const name of ['EYE_R', 'KA_RATIO']) {
    const a = new RegExp(String.raw`^${name} = ([\d.]+)`, 'm').exec(py)?.[1];
    const b = new RegExp(String.raw`${name} = ([\d.]+)`).exec(code)?.[1];
    assert.ok(a && b, `${name} is missing from one side`);
    assert.equal(Number(a), Number(b), `${name} differs: python ${a}, app ${b}`);
  }
});

test('the generator gradient is the token gradient', () => {
  // The defect the file's own header records. `C_START/MID/END` are RGB triples
  // of `brand.gradient`, and nothing but this test connects them.
  const py = gen();
  const stops = /gradient:\s*\[([^\]]+)\]/.exec(readCode('theme/tokens.ts'))?.[1];
  assert.ok(stops, 'the token gradient has moved');
  const hexes = [...stops.matchAll(/'#([0-9a-fA-F]{6})'/g)].map(m => m[1].toLowerCase());
  assert.equal(hexes.length, 3);

  const names = ['C_START', 'C_MID', 'C_END'];
  hexes.forEach((hex, i) => {
    const rgb = [0, 2, 4].map(o => parseInt(hex.slice(o, o + 2), 16));
    const got = new RegExp(String.raw`^${names[i]}\s*=\s*\(\s*(\d+),\s*(\d+),\s*(\d+)`, 'm').exec(py);
    assert.ok(got, `${names[i]} is missing`);
    assert.deepEqual([1, 2, 3].map(n => Number(got[n])), rgb,
      `${names[i]} is not #${hex} — the icon would ship a colour the app does not use`);
  });
});
