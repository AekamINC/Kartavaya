/**
 * Devanagari typography, and the two words that were swapped.
 *
 * ── The rules, which these tests encode rather than re-decide ─────────────────
 *
 * Tiro Devanagari Hindi ships exactly one weight, 400. There is no bold Tiro, so
 * `fontWeight: '700'` on Hindi text does not produce a heavier Tiro: Android
 * synthesises a smeared fake bold, iOS falls back to the system Devanagari face.
 * Either way the Hindi renders in a weight and often a typeface nobody chose,
 * next to Latin that renders correctly.
 *
 * `letterSpacing` is the worse one and the easier to miss. React Native applies
 * tracking AFTER shaping, so it inserts space between glyphs that are required
 * to JOIN — the shirorekha along the top of a word breaks into segments and
 * conjuncts come apart. `BiLabel.tsx` documents this at length.
 *
 * `textTransform: 'uppercase'` has no meaning in Devanagari — the script is
 * unicameral — and on some engines it still perturbs the run.
 *
 * So: weight 400 or absent, letterSpacing 0 or absent, textTransform 'none' or
 * absent. Explicit neutralising values are allowed and are in fact the preferred
 * form where a Hindi style sits next to a tracked Latin kicker.
 *
 * ── The `सहायक` defect ────────────────────────────────────────────────────────
 *
 * `SahayakContentScreen`'s `scopeKicker` carried `fontWeight: '700'` alongside a
 * `hindi()` spread. Spreading `hindi()` after a weight does not remove one —
 * `hindi()` returns only a family — so the '700' survived.
 *
 * ── SOURCE-CONTRACT ───────────────────────────────────────────────────────────
 *
 * These read `.tsx` files as text, because JSX cannot be loaded by `node --test`
 * at all. They prove the style objects are correct. They CANNOT prove what the
 * glyphs look like: whether Tiro actually rendered, whether a fallback kicked
 * in, or whether the shirorekha is intact needs a device and a screenshot.
 * `theme/__tests__/fonts.test.ts` covers `hindi()` itself for real.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  readCode, readRaw, screenFiles, styleObjects, namesDevanagariFace, DEVANAGARI,
} from '../../test/source.ts';
import { toPair, HAS_GUJARATI_FACE, gujaratiPending, type Label } from '../../theme/labels.ts';

/** Everywhere Devanagari can appear, not just `screens/`. */
function allViewFiles(): string[] {
  return [
    ...screenFiles(),
    'nav/BottomBar.tsx',
    'components/TaskCard.tsx',
    'components/NewTaskSheet.tsx',
    'theme/BiLabel.tsx',
  ];
}

function safeCode(rel: string): string | null {
  try { return readCode(rel); } catch { return null; }
}

/**
 * Does the component `name`, defined in `code`, split a bilingual label into two
 * runs?
 *
 * Two forms count, and both are in the tree today:
 *   · it delegates to `BiLabel` (`MeScreen`'s `SettingsRow`), or
 *   · it splits on the separator itself (`SettingsScreen`'s `SectionHeader`,
 *     which is where this was first solved correctly).
 *
 * Checked against the implementation rather than allowlisted by name, so a
 * wrapper added later that forwards the whole string to one <Text> is still
 * caught.
 */
function splitsBilingual(code: string, name: string): boolean {
  // `function X(` and `const X = (` / `const X = ({` both appear in the tree.
  const decl = new RegExp(`(?:function\\s+${name}\\s*\\(|(?:const|let)\\s+${name}\\s*(?::[^=]*)?=\\s*(?:\\([^)]*\\)|[\\w$]+)\\s*(?::[^=>]*)?=>)`);
  const m = decl.exec(code);
  if (!m) return false;

  // The body brace is the first `{` AFTER the parameter list closes. Taking the
  // first `{` outright lands inside a destructured parameter — which is how
  // `SectionHeader({ label, t, desc })` looked like an empty component.
  let i = m.index + m[0].length;
  if (m[0].endsWith('(')) {
    let paren = 1;
    for (; i < code.length && paren > 0; i++) {
      if (code[i] === '(') paren++;
      else if (code[i] === ')') paren--;
    }
  }
  const open = code.indexOf('{', i);
  if (open === -1) return false;

  let depth = 0;
  let j = open;
  for (; j < code.length; j++) {
    if (code[j] === '{') depth++;
    else if (code[j] === '}') { depth--; if (depth === 0) { j++; break; } }
  }
  const body = code.slice(open, j);
  return /<BiLabel|splitBilingual\(|\.split\(\s*['"`]·['"`]\s*\)/.test(body);
}

// ── The typography rules ──────────────────────────────────────────────────────

test('no style that names the Devanagari face carries a synthetic weight', () => {
  let checked = 0;
  for (const file of allViewFiles()) {
    const code = safeCode(file);
    if (!code) continue;
    for (const [name, style] of Object.entries(styleObjects(code))) {
      if (!namesDevanagariFace(style)) continue;
      checked++;
      const m = /fontWeight:\s*['"]?(\d+|bold|normal)['"]?/.exec(style);
      if (!m) continue;
      assert.ok(
        m[1] === '400' || m[1] === 'normal',
        `${file} → ${name} sets fontWeight ${m[1]} on Devanagari. Tiro ships only 400; `
        + 'this is synthetic bold on Android and a system-face fallback on iOS.',
      );
    }
  }
  assert.ok(checked >= 25, `expected the sweep to find the Devanagari styles, found ${checked}`);
});

test('no Devanagari style is letter-spaced — tracking breaks the shirorekha', () => {
  for (const file of allViewFiles()) {
    const code = safeCode(file);
    if (!code) continue;
    for (const [name, style] of Object.entries(styleObjects(code))) {
      if (!namesDevanagariFace(style)) continue;
      const m = /letterSpacing:\s*(-?[\d.]+)/.exec(style);
      if (!m) continue;
      assert.equal(
        parseFloat(m[1]), 0,
        `${file} → ${name} sets letterSpacing ${m[1]} on Devanagari. RN tracks after `
        + 'shaping, so this splits the shirorekha and pulls conjuncts apart.',
      );
    }
  }
});

test('no Devanagari style is uppercased — the script is unicameral', () => {
  for (const file of allViewFiles()) {
    const code = safeCode(file);
    if (!code) continue;
    for (const [name, style] of Object.entries(styleObjects(code))) {
      if (!namesDevanagariFace(style)) continue;
      const m = /textTransform:\s*['"](\w+)['"]/.exec(style);
      if (!m) continue;
      assert.equal(
        m[1], 'none',
        `${file} → ${name} sets textTransform: '${m[1]}' on Devanagari`,
      );
    }
  }
});

test('THE सहायक DEFECT — SahayakContentScreen scopeKicker carries no weight at all', () => {
  const style = styleObjects(readCode('screens/modules/SahayakContentScreen.tsx')).scopeKicker;
  assert.ok(style, 'scopeKicker style not found — was it renamed?');
  assert.ok(namesDevanagariFace(style), 'scopeKicker must name the Devanagari face');
  assert.doesNotMatch(
    style, /fontWeight/,
    'scopeKicker regained a fontWeight. Spreading hindi() after one does not remove it.',
  );
  assert.doesNotMatch(style, /letterSpacing:\s*(?!0)/, 'scopeKicker regained tracking');
});

test('every Devanagari text node gets its family from a Tiro-bearing style', () => {
  // Without a named family the platform picks its own Devanagari fallback, so
  // the Hindi on a screen renders in a face nobody chose. Nested <Text> is
  // handled by checking the innermost element that actually holds the glyphs.
  const offenders: string[] = [];

  for (const file of allViewFiles()) {
    const code = safeCode(file);
    if (!code) continue;
    const styles = styleObjects(code);

    const re = /<Text([^>]*)>([^<]*)<\/Text>/g; // innermost only: no nested tags
    let m: RegExpExecArray | null;
    while ((m = re.exec(code)) !== null) {
      if (!DEVANAGARI.test(m[2])) continue;
      const attrs = m[1];
      const keys = [...attrs.matchAll(/s\.([A-Za-z_$][\w$]*)/g)].map(x => x[1]);
      const viaStyle = keys.some(k => styles[k] && namesDevanagariFace(styles[k]));
      const viaInline = /hindi\(|FAMILY\.devanagari/.test(attrs);
      if (!viaStyle && !viaInline) {
        offenders.push(`${file}: "${m[2].trim().slice(0, 24)}" via [${keys.join(', ') || 'no style'}]`);
      }
    }
  }

  assert.deepEqual(offenders, [], 'Devanagari rendered without the Tiro face:\n' + offenders.join('\n'));
});

test('a bilingual "LATIN · देवनागरी" string is always split by BiLabel', () => {
  // The stronger form of the rule above, and it does not depend on parsing JSX
  // attributes — which is how the `USE A TEMPLATE · टेम्पलेट` label hid: its
  // TouchableOpacity had a `>` inside an attribute and the element regex could
  // not see past it.
  //
  // One <Text> holding both scripts means whatever style it carries lands on
  // BOTH, and these labels are uppercase tracked kickers. BiLabel exists to make
  // that unrepresentable; this asserts nothing has gone around it.
  const offenders: string[] = [];
  const bilingual = /['"`]([A-Za-z][A-Za-z ?'’]*)\s·\s([ऀ-ॿ][ऀ-ॿ\s]*)['"`]/g;

  for (const file of [...allViewFiles(), 'components/AttachmentSourceSheet.tsx']) {
    const code = safeCode(file);
    if (!code) continue;

    // JSX text children too, not just quoted literals.
    const candidates = [
      ...[...code.matchAll(bilingual)].map(m => ({ text: m[0], index: m.index! })),
      ...[...code.matchAll(/>\s*([A-Za-z][A-Za-z ?'’]*\s·\s[ऀ-ॿ][ऀ-ॿ\s]*)\s*</g)]
        .map(m => ({ text: m[1], index: m.index! })),
    ];

    for (const c of candidates) {
      // Walk back to the opening tag that encloses this string.
      const before = code.slice(Math.max(0, c.index - 600), c.index);
      const lastTag = /<([A-Za-z][\w.]*)[^<]*$/.exec(before);
      const owner = lastTag ? lastTag[1] : '(none)';
      if (owner === 'BiLabel') continue;
      // A local wrapper is fine PROVIDED it actually splits the two runs. That
      // is checked against its body rather than allowlisted by name, so a new
      // wrapper that forwards the string to one <Text> still fails here.
      if (splitsBilingual(code, owner)) continue;
      offenders.push(`${file}: <${owner}> holds "${c.text.trim().slice(0, 40)}"`);
    }
  }

  assert.deepEqual(
    offenders, [],
    `bilingual labels not split into two runs:\n  ${offenders.join('\n  ')}`,
  );
});

// ── The two words ─────────────────────────────────────────────────────────────

const SANVAAD = 'संवाद';   // Messages / conversation
const SANDESH = 'सन्देश';  // Inbox / a message received

test('Messages is संवाद everywhere it is labelled', () => {
  // Settled against the reference at Mobile.jsx:13 / :235.
  const sites: Array<[string, string]> = [
    ['nav/BottomBar.tsx', 'the tab bar'],
    ['screens/MessagesScreen.tsx', 'the Messages screen title'],
    ['screens/ChatScreen.tsx', 'the chat header'],
  ];
  for (const [file, where] of sites) {
    const code = readCode(file);
    assert.ok(code.includes(SANVAAD), `${where} (${file}) does not say ${SANVAAD}`);
  }
});

test('Messages is NEVER labelled सन्देश — that is the Inbox word', () => {
  // The defect: Messages carried सन्देश, so two different destinations in the
  // same tab bar read as the same thing to a Hindi speaker.
  for (const file of ['nav/BottomBar.tsx', 'screens/MessagesScreen.tsx', 'screens/ChatScreen.tsx']) {
    const code = readCode(file);
    assert.ok(
      !code.includes(SANDESH),
      `${file} labels Messages ${SANDESH}, which is Inbox. Messages is ${SANVAAD}.`,
    );
  }
});

test('the tab bar maps each destination to its own Hindi word', () => {
  const code = readCode('nav/BottomBar.tsx');

  const messages = /Messages\s*:\s*\{[^}]*hi:\s*'([^']+)'/.exec(code);
  assert.ok(messages, 'no Messages entry found in the tab bar labels');
  assert.equal(messages![1], SANVAAD, 'Messages must be संवाद');

  // Whatever Inbox is called, it must not collide with Messages.
  const inbox = /Inbox\s*:\s*\{[^}]*hi:\s*'([^']+)'/.exec(code);
  if (inbox) {
    assert.notEqual(inbox[1], messages![1], 'Inbox and Messages must not share a Hindi label');
  }
});

test('no two tab destinations share a Hindi label', () => {
  const code = readCode('nav/BottomBar.tsx');
  const seen = new Map<string, string>();
  const re = /([A-Za-z]+)\s*:\s*\{\s*en:\s*'[^']*',\s*hi:\s*'([^']+)'\s*\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code)) !== null) {
    const prev = seen.get(m[2]);
    assert.ok(!prev, `${prev} and ${m[1]} are both labelled ${m[2]}`);
    seen.set(m[2], m[1]);
  }
  assert.ok(seen.size >= 3, `expected several labelled tabs, found ${seen.size}`);
});

// ── ONE LABEL SHAPE ──────────────────────────────────────────────────────────
//
// The typography rules above say how a Devanagari run must be STYLED. These say
// how a label must be SHAPED, which is the half that was still open: the app
// wrote labels three ways — 15 middot strings, 24 `{ en, hi }` object pairs and
// a scatter of bare `<Text>` literals — and `BiLabel`, the component that exists
// to make the tracking defect unrepresentable, could only read one of the three.
// So two thirds of the labels in the app were rendered by hand, correctly, by
// authors who happened to remember the rule.
//
// `theme/labels.ts` is now the one definition and `toPair` the one accessor.

test('toPair reads all three mechanisms', () => {
  // The middot form the 15 kickers use.
  assert.deepEqual(toPair('NEW TASK · नया कार्य'), { en: 'NEW TASK', indic: 'नया कार्य', script: 'hi' });
  // The object form the 24 nav entries use — unreachable from BiLabel before.
  assert.deepEqual(toPair({ en: 'Tasks', hi: 'कर्तव्य' }), { en: 'Tasks', indic: 'कर्तव्य', script: 'hi' });
  // Latin alone, which is why this is safe to use on every kicker.
  assert.deepEqual(toPair('SYNC'), { en: 'SYNC' });
  assert.deepEqual(toPair({ en: 'Sync' }), { en: 'Sync' });
  // Nothing at all, rather than a crash in a label.
  assert.deepEqual(toPair(null), { en: '' });
});

test('the script is read off the codepoints, never off the position', () => {
  // A middot string is written by hand and its second half is not guaranteed
  // Indic. `'A · B'` is not a bilingual label and must not be split into one —
  // the Latin half would land in the Devanagari <Text> and be drawn in Tiro.
  const plain = toPair('Total · net of tax');
  assert.equal(plain.indic, undefined);
  assert.equal(plain.en, 'Total · net of tax');
});

test('BiLabel has ONE definition of what a label is', () => {
  // `splitBilingual` used to hold its own copy of the separator logic, so the
  // object form was unreachable from it and a `gu` value would have been drawn
  // in a face with no Gujarati glyphs. Asserted against the source because
  // node --test cannot load a .tsx file at all.
  const code = readCode('theme/BiLabel.tsx');
  assert.match(code, /from '\.\/labels'/, 'BiLabel must take its shape from theme/labels.ts');
  assert.match(code, /toPair\(/, 'splitBilingual must delegate to toPair');
  assert.doesNotMatch(
    code, /const SEP = /,
    'BiLabel declared its own separator again. There is one, in theme/labels.ts.',
  );
});

// ── The Gujarati slot: present, empty, and honestly so ───────────────────────

test('THIS APP SHIPS NO GUJARATI FACE — so a gu value is carried, not drawn', () => {
  // The rule and its reason together, because either alone reads as an
  // oversight. Tiro Devanagari Hindi has zero Gujarati coverage, exactly as
  // Newsreader has zero Devanagari coverage — the defect fonts.ts already
  // documents, one script over. Handing ગુજરાતી to hindi() would put every
  // glyph through the platform fallback chain in a family nobody chose.
  const pkg = JSON.parse(readRaw('../package.json')) as {
    dependencies: Record<string, string>;
  };
  const gujaratiFace = Object.keys(pkg.dependencies)
    .filter(d => /gujarati/i.test(d));
  assert.deepEqual(
    gujaratiFace, [],
    'A Gujarati face is now bundled. Set HAS_GUJARATI_FACE = true in theme/labels.ts, '
    + 'give guRun() a real implementation, and change this test to assert the new behaviour.',
  );
  assert.equal(HAS_GUJARATI_FACE, false);

  // The slot EXISTS — a caller can express EN+GU — and resolves to no Indic run
  // rather than to the Devanagari. Showing one script less is a smaller lie
  // than showing the wrong one; substituting is the notifSound.js bug.
  const gu: Label = { en: 'Tasks', gu: 'કાર્ય' };
  assert.deepEqual(toPair(gu), { en: 'Tasks' });
  assert.deepEqual(gujaratiPending([gu]), [gu], 'a gu that cannot be drawn is countable');

  // And a Gujarati middot string is the same case, so neither mechanism can
  // reach the Devanagari face by a different door.
  assert.deepEqual(toPair('TASKS · કાર્ય'), { en: 'TASKS' });
});

test('no surface in this app carries a Gujarati label — the slot is empty, and that is the finding', () => {
  // The web app has 45 Gujarati strings and all of them sit in one file. This
  // app has none. The one Gujarati string in mobile/src is inside a placeholder
  // NAMING the languages Sahayak answers in, which is copy rather than a label —
  // exempted by file, so a Gujarati LABEL added anywhere else fails here and the
  // person adding it has to come back and say how the face is going to be found.
  const GUJARATI = /[઀-૿]/;
  const EXEMPT = new Set(['screens/SahayakScreen.tsx']);
  const found: string[] = [];

  for (const file of allViewFiles()) {
    if (EXEMPT.has(file)) continue;
    const code = safeCode(file);
    if (code && GUJARATI.test(code)) found.push(file);
  }

  assert.deepEqual(
    found, [],
    'Gujarati text appeared in a view file. This app bundles no Gujarati face — '
    + 'see theme/labels.ts before adding the string.',
  );
});

test('the nav lists are typed as the one shape, not a fourth spelling of the pair', () => {
  // Both files declared `{ en: string; hi: string }` inline. Two inline
  // declarations of one idea is how they drift, and it is why neither could be
  // handed to BiLabel.
  const bar = readCode('nav/BottomBar.tsx');
  assert.match(bar, /Record<string, Label>/, 'BottomBar LABELS must be typed Label');
  assert.match(bar, /toPair\(/, 'BottomBar must resolve its label through toPair');

  // `Dest` USED TO BE DECLARED IN MoreScreen. It moved to `nav/destinations.ts`
  // as `Destination` when the rail and the drawer needed the same nineteen rows
  // (31-tablet.md §2: "the same destination list, the same order, the same
  // badges"). The rule this test enforces did not change — the type still has to
  // extend `Label` — so the assertion follows the type to its new home rather
  // than being deleted, which is what "the shape moved" would otherwise cost.
  const dest = readCode('nav/destinations.ts');
  assert.match(
    dest, /interface Destination extends Label/,
    'Destination must extend Label — one label shape for the whole app',
  );

  const more = readCode('screens/MoreScreen.tsx');
  assert.match(
    more, /from '\.\.\/nav\/destinations'/,
    'MoreScreen must read the shared destination list, not redeclare its own',
  );
  assert.match(more, /toPair\(/, 'MoreScreen must resolve its tile label through toPair');
});
