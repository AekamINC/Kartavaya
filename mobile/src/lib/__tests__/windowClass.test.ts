/**
 * The window ladder, checked against the real devices rather than against itself.
 *
 * `design-handover/31-tablet.md` §1 publishes a table of six tablets with the
 * class each lands in, in each orientation, and a claim about the one that
 * cannot split. That table is the fixture below. A breakpoint test that only
 * asserts `599 → compact, 600 → medium` proves the comparison operators work and
 * nothing else; this one fails if an iPad mini stops being able to show a list
 * beside a detail, which is the thing anybody actually cares about.
 *
 * Every width here is points (iPadOS) or dp (Android). Physical pixels never
 * appear in a breakpoint and must never appear in this file.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  windowClass, navWidth, contentWidth, sideBySide, listWidth, gridColumns,
  stacksSupportingPane, SIDE_BY_SIDE_FLOOR,
  type Platform, type WindowClass,
} from '../windowClass.ts';

/** §1's table, verbatim. `[name, platform, portraitW, portraitH]`. */
const DEVICES: [string, Platform, number, number][] = [
  ['7-inch Android',  'android', 600,  960],
  ['iPad mini 8.3"',  'ipados',  744,  1133],
  ['11-inch Android', 'android', 800,  1280],
  ['iPad Air 11"',    'ipados',  820,  1180],
  ['13-inch Android', 'android', 960,  1540],
  ['iPad Pro 13"',    'ipados',  1032, 1376],
];

/** §1's Navigation/Panes columns: `[portraitClass, landscapeClass]`. */
const EXPECTED: Record<string, [WindowClass, WindowClass]> = {
  '7-inch Android':  ['medium',   'expanded'],
  'iPad mini 8.3"':  ['medium',   'expanded'],
  '11-inch Android': ['medium',   'large'],
  'iPad Air 11"':    ['medium',   'expanded'],
  '13-inch Android': ['expanded', 'large'],
  'iPad Pro 13"':    ['expanded', 'large'],
};

// ── The ladder ────────────────────────────────────────────────────────────────

test('every device in the spec table lands in the class the table says', () => {
  for (const [name, , w, h] of DEVICES) {
    const [portrait, landscape] = EXPECTED[name];
    assert.equal(windowClass(w), portrait, `${name} portrait (${w}pt)`);
    assert.equal(windowClass(h), landscape, `${name} landscape (${h}pt)`);
  }
});

test('the four boundaries are closed at the bottom, open at the top', () => {
  assert.equal(windowClass(599), 'compact');
  assert.equal(windowClass(600), 'medium');
  assert.equal(windowClass(839), 'medium');
  assert.equal(windowClass(840), 'expanded');
  assert.equal(windowClass(1199), 'expanded');
  assert.equal(windowClass(1200), 'large');
});

test('Slide Over is compact on the largest iPad Apple sells', () => {
  // "Slide Over is exactly 320pt on every iPad", §6. This is the whole reason
  // the ladder reads the window: the compact layout has to be reachable on a
  // 13-inch device, and a layout keyed to the model would never get there.
  assert.equal(windowClass(320), 'compact');
  assert.equal(navWidth(windowClass(320), 'ipados'), 0);

  // A half Split View on an iPad Pro 13" in landscape: (1376 - 6) / 2.
  assert.equal(windowClass(685), 'medium');
});

// ── Navigation width ──────────────────────────────────────────────────────────

test('compact has no rail — it has a bottom bar', () => {
  // The prototype omits this case because `TApp` returns early before reading
  // the value. Extracted as a function, the omission would subtract 72 points
  // from a phone that has no rail at all.
  assert.equal(navWidth('compact', 'ipados'), 0);
  assert.equal(navWidth('compact', 'android'), 0);
});

test('the rail is 72 on iPadOS and 80 on Android, and the drawer is 280 on both', () => {
  // §7: iPadOS has a tinted glyph and no indicator; Android has a Material pill
  // behind it, which is what the extra 8 points are for.
  assert.equal(navWidth('medium', 'ipados'), 72);
  assert.equal(navWidth('medium', 'android'), 80);
  assert.equal(navWidth('expanded', 'ipados'), 72);
  assert.equal(navWidth('expanded', 'android'), 80);
  assert.equal(navWidth('large', 'ipados'), 280);
  assert.equal(navWidth('large', 'android'), 280);
});

// ── The split rule ────────────────────────────────────────────────────────────

test('the 7-inch Android in portrait is the ONE device that cannot split', () => {
  // §1: "every tablet in this table has enough content width to run
  // list-and-detail side by side in BOTH orientations — except the 7-inch
  // Android in portrait, which has 520dp." That number is checked, not trusted.
  assert.equal(contentWidth(600, 'android'), 520);
  assert.equal(sideBySide(520), false);

  const cannotSplit = DEVICES
    .filter(([, os, w]) => !sideBySide(contentWidth(w, os)))
    .map(([name]) => name);
  assert.deepEqual(cannotSplit, ['7-inch Android']);
});

test('every device splits in landscape, including the 7-inch', () => {
  for (const [name, os, , h] of DEVICES) {
    assert.ok(
      sideBySide(contentWidth(h, os)),
      `${name} landscape (${h}pt) does not reach the ${SIDE_BY_SIDE_FLOOR}dp floor`,
    );
  }
});

test('portrait is not a phone held sideways — five of six split upright', () => {
  // The rule the prototype says was the bug when it was tied to the width class:
  // an iPad Pro held upright has more content than most laptops give a mail
  // client, and stacking it would be a decision made by the wrong variable.
  const splits = DEVICES
    .filter(([, os, w]) => sideBySide(contentWidth(w, os)))
    .map(([name]) => name);
  assert.equal(splits.length, 5);
  assert.ok(splits.includes('iPad Pro 13"'));
  assert.ok(splits.includes('iPad mini 8.3"'));
});

test('two panes are never offered below the floor', () => {
  assert.equal(sideBySide(659), false);
  assert.equal(sideBySide(660), true);
});

// ── The leading pane ──────────────────────────────────────────────────────────

test('the list pane is 38% of content, clamped to 280–400', () => {
  // iPad Pro 13" landscape: 1376 - 280 (drawer) = 1096; 38% = 417 → clamped 400.
  assert.equal(listWidth(1376, 'ipados'), 400);
  // iPad mini portrait: 744 - 72 = 672; 38% = 255 → clamped up to 280.
  assert.equal(listWidth(744, 'ipados'), 280);
  // 13-inch Android landscape: 1540 - 280 = 1260; 38% = 479 → clamped 400.
  assert.equal(listWidth(1540, 'android'), 400);
});

test('the clamp never lets the list outgrow the thing it opens', () => {
  for (const [name, os, w, h] of DEVICES) {
    for (const width of [w, h]) {
      const list = listWidth(width, os);
      assert.ok(list >= 280 && list <= 400, `${name} at ${width}pt gave ${list}`);
      const detail = contentWidth(width, os) - list;
      if (sideBySide(contentWidth(width, os))) {
        assert.ok(
          detail > list,
          `${name} at ${width}pt: the detail (${detail}) is not wider than the list (${list})`,
        );
      }
    }
  }
});

// ── Card flow ─────────────────────────────────────────────────────────────────

test('cards flow two abreast above 640 of content and three above 1040', () => {
  assert.equal(gridColumns(639), 1);
  assert.equal(gridColumns(640), 2);
  assert.equal(gridColumns(1039), 2);
  assert.equal(gridColumns(1040), 3);
});

test('no device renders a single column of cards wider than 640', () => {
  // §10 acceptance 6, and the spec's own note that portrait is where this fails.
  for (const [name, os, w, h] of DEVICES) {
    for (const width of [w, h]) {
      const content = contentWidth(width, os);
      if (content > 640) {
        assert.ok(
          gridColumns(content) > 1,
          `${name} at ${width}pt has ${content}dp of content in one column`,
        );
      }
    }
  }
});

// ── Stacking ──────────────────────────────────────────────────────────────────

test('the supporting pane stacks only on a tall window', () => {
  // Height decides it, because what a supporting pane needs is room BELOW the
  // queue rather than beside it.
  assert.equal(stacksSupportingPane(1032, 1376), true);   // iPad Pro portrait
  assert.equal(stacksSupportingPane(1376, 1032), false);  // …landscape: wider than tall
  assert.equal(stacksSupportingPane(600, 960), true);     // 7-inch portrait
  assert.equal(stacksSupportingPane(744, 899), false);    // tall, but under 900
});
