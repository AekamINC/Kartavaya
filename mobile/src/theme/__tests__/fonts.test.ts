/**
 * `theme/fonts.ts`, run for real.
 *
 * Not a source-contract test — the module is imported and its functions are
 * called. Only the three `@expo-google-fonts/*` packages and `react-native` are
 * stubbed, and neither contributes to the values asserted here.
 *
 * This is the load-bearing half of the Devanagari rule. `hindi()` is the only
 * supported way to put a family on Hindi text, and the reason it is a function
 * rather than a constant is that it must be impossible to get a weight out of
 * it. `screens/__tests__/devanagari.test.ts` checks the call sites; this checks
 * the thing they call.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { FAMILY, hindi, display, F } from '../fonts.ts';

test('hindi() returns the Devanagari face and NOTHING else', () => {
  // The whole contract in one assertion: exactly one key. Any weight, tracking
  // or transform added here would land on every Hindi string in the app.
  assert.deepEqual(hindi(), { fontFamily: FAMILY.devanagari });
  assert.deepEqual(Object.keys(hindi()), ['fontFamily']);
});

test('hindi() NEVER returns a fontWeight — there is no bold Tiro to resolve to', () => {
  for (const size of [undefined, 10, 12, 14, 24]) {
    const style = hindi(size);
    assert.equal(
      style.fontWeight, undefined,
      `hindi(${size}) emitted a fontWeight. Tiro ships one weight (400); anything `
      + 'else is synthesised on Android and falls back to the system face on iOS.',
    );
  }
});

test('hindi() never emits tracking or a transform', () => {
  for (const size of [undefined, 11, 13]) {
    const style = hindi(size) as Record<string, unknown>;
    assert.equal(style.letterSpacing, undefined, 'tracking is applied after shaping and breaks the shirorekha');
    assert.equal(style.textTransform, undefined, 'Devanagari is unicameral');
  }
});

test('passing a size is the intended way to emphasise Hindi', () => {
  // Emphasis is carried by size and colour, because weight is unavailable.
  assert.deepEqual(hindi(16), { fontFamily: FAMILY.devanagari, fontSize: 16 });
});

test('the Devanagari face is distinct from every Latin face', () => {
  // Newsreader and Space Mono have zero Devanagari coverage; naming one for
  // Hindi text produces tofu on Android and a silent system swap on iOS.
  const latin: string[] = [FAMILY.display, FAMILY.displayItalic, FAMILY.displaySemi, FAMILY.mono];
  assert.ok(!latin.includes(FAMILY.devanagari));
  assert.equal(new Set(Object.values(FAMILY)).size, Object.values(FAMILY).length,
    'two families share a registered name, so one will silently win');
});

test('display() only ever asks for a weight that is actually loaded', () => {
  // 400 and 600 are the two Newsreader files bundled. Any other weight would be
  // synthesised from the 400 — the same class of defect as bolding Devanagari.
  assert.deepEqual(display(400), { fontFamily: FAMILY.display, fontWeight: '400' });
  assert.deepEqual(display(600), { fontFamily: FAMILY.displaySemi, fontWeight: '600' });
  assert.deepEqual(display(), { fontFamily: FAMILY.display, fontWeight: '400' });
});

test('display(italic) uses the italic file rather than a synthesised slant', () => {
  const style = display(400, true);
  assert.equal(style.fontFamily, FAMILY.displayItalic);
  assert.equal(style.fontWeight, '400');
  assert.equal((style as Record<string, unknown>).fontStyle, undefined,
    'fontStyle: italic on top of the italic file would double-slant it');
});

test('display() never returns the Devanagari face', () => {
  for (const weight of [400, 600] as const) {
    for (const italic of [false, true]) {
      assert.notEqual(display(weight, italic).fontFamily, FAMILY.devanagari);
    }
  }
});

test('the F presets agree with the functions', () => {
  // Two ways to spell the same thing is two ways to drift.
  assert.equal(F.hindi.fontFamily, FAMILY.devanagari);
  assert.equal(F.hindi.fontWeight, undefined, 'the Hindi preset must carry no weight either');
  assert.equal(F.titleSerif.fontFamily, FAMILY.display);
  assert.equal(F.displaySerif.fontFamily, FAMILY.displayItalic);
  assert.equal(F.mono.fontFamily, FAMILY.mono);
});

test('no preset puts a Latin face on Devanagari or vice versa', () => {
  const latinPresets = [F.displaySerif, F.titleSerif, F.mono];
  for (const preset of latinPresets) {
    assert.notEqual(preset.fontFamily, FAMILY.devanagari);
  }
  assert.equal(F.hindi.fontFamily, FAMILY.devanagari);
});
