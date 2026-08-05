/**
 * The scoped palette and the bubble layout, pinned.
 *
 * ── SOURCE-CONTRACT, and read `test/source.ts` before adding to it ───────────
 *
 * These read `.tsx` files as TEXT. Node's type-stripping does not transform JSX,
 * so no screen in this app can be imported by `node --test` at all — every
 * decision that lives in a component body is reachable by reading or not at all.
 * What that buys is real but narrow: it pins a line-level decision so that
 * deleting it turns the suite red. It cannot prove that a bubble is on the right
 * of the screen, that a tail points at its author, or that `सहायक` rendered as
 * anything other than boxes. Those need a device.
 *
 * ── The two things being pinned ─────────────────────────────────────────────
 *
 * 1. THE SCOPE. Sanvaad and Sahayak are the only surfaces the owner approved a
 *    different ground for, and the mechanism has two halves that MUST travel
 *    together — `useSurfaceTheme()` for the screen's own render and
 *    `<SurfaceScope>` for everything under it. Half of it is the failure mode:
 *    five shared components call `useTheme()` for themselves, so a screen with
 *    the hook and no provider renders a Slate ground with cream message bodies
 *    and a cream-bordered composer.
 *
 * 2. THE BUBBLES. Proposal 09's anatomy, and specifically the two rules that are
 *    decided by DIFFERENT neighbours on an inverted list. Getting those backwards
 *    does not crash and does not look obviously wrong in a screenshot — it puts
 *    the tail on the wrong end of every burst — which makes it exactly the kind
 *    of thing worth a text assertion.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { readCode, readRaw, screenFiles, styleObjects } from '../../test/source.ts';

/** The surfaces on the scoped Slate / indigo palette. There are exactly three. */
const SCOPED_SCREENS = [
  'screens/MessagesScreen.tsx',
  'screens/ChatScreen.tsx',
  'screens/SahayakScreen.tsx',
];

// ── 1 · The scope ─────────────────────────────────────────────────────────────

test('every scoped screen uses BOTH halves of the scope', () => {
  for (const file of SCOPED_SCREENS) {
    const code = readCode(file);
    assert.match(
      code, /useSurfaceTheme\(\)/,
      `${file} does not call useSurfaceTheme() — its own render would be cream`,
    );
    assert.match(
      code, /<SurfaceScope>/,
      `${file} does not render <SurfaceScope>. MentionInput, RichText, ScreenState, `
      + 'SwipeRow and Refresher each call useTheme() for themselves, so without the '
      + 'provider they render the product\'s cream inside this screen\'s Slate ground.',
    );
  }
});

test('a scoped screen never calls useTheme() as well', () => {
  // Both in one file means two palettes on one screen, and which one an element
  // gets depends on which line its colour came from — the hardest possible
  // defect to see in a screenshot and the easiest to introduce by copying a
  // block from a neighbouring screen.
  for (const file of SCOPED_SCREENS) {
    const code = readCode(file);
    assert.doesNotMatch(
      code, /=\s*useTheme\(\)/,
      `${file} calls useTheme() as well as useSurfaceTheme() — one screen, two palettes`,
    );
  }
});

test('SurfaceScope is the OUTERMOST element the screen returns', () => {
  // A provider nested inside the root View leaves the root — the thing that
  // paints the ground — outside its own scope. Checked by finding the last
  // `return (` in the file's default export and requiring the next element to be
  // the provider.
  for (const file of SCOPED_SCREENS) {
    const code = readCode(file);
    const m = /return\s*\(\s*(?:\/\*[\s\S]*?\*\/\s*)?<([A-Za-z][\w.]*)/g;
    const opens = [...code.matchAll(m)].map(x => x[1]);
    assert.ok(
      opens.includes('SurfaceScope'),
      `${file}: no return opens with <SurfaceScope> — the ground would be painted `
      + 'outside the scope it belongs to',
    );
  }
});

test('the scope is not applied anywhere else in the app', () => {
  // "SCOPED TO SANVAAD + SAHAYAK ONLY. The rest of Kartavaya stays warm cream.
  // The owner first said whole product, then corrected to just Sahayak
  // internally. Do not let it leak." A fourth screen adopting it is a decision,
  // not an accident, and it should have to change this list to make it.
  const leaked = screenFiles()
    .filter(f => !SCOPED_SCREENS.includes(f))
    .filter(f => /useSurfaceTheme|SurfaceScope/.test(readCode(f)));
  assert.deepEqual(
    leaked, [],
    'the Slate palette has leaked outside Sanvaad and Sahayak: ' + leaked.join(', '),
  );
});

// ── 2 · The bubbles ───────────────────────────────────────────────────────────

const chat = () => readCode('screens/ChatScreen.tsx');

test('own messages go RIGHT and everyone else LEFT — one flip, one line', () => {
  const s = styleObjects(chat());
  assert.ok(s.msgRow, 'the message row style is gone');
  assert.match(s.msgRow, /flexDirection:\s*'row'/, 'msgRow is not a row');
  assert.ok(s.msgRowMine, 'msgRowMine is gone — nothing puts own messages on the right');
  assert.match(
    s.msgRowMine, /flexDirection:\s*'row-reverse'/,
    'msgRowMine no longer reverses the row, so own messages render on the left',
  );
});

test('the avatar column is aligned to the BOTTOM of the bubble', () => {
  // Centring it floats the face in the middle of a long message and the tail
  // then points at nothing.
  assert.match(styleObjects(chat()).msgRow, /alignItems:\s*'flex-end'/);
});

test('the bubble column is capped at 74%', () => {
  // Proposal 09: below ~70% short replies look stranded; above ~80% the side
  // stops reading as a side.
  const code = chat();
  assert.match(code, /const BUBBLE_MAX = '74%'/, 'the 74% cap is gone or was inlined');
  assert.match(styleObjects(code).msgCol, /maxWidth:\s*BUBBLE_MAX/, 'msgCol does not use the cap');
});

test('the run\'s two ends are decided by DIFFERENT neighbours', () => {
  // THE INVERTED-LIST RULE, and the reason this test exists. `index + 1` is the
  // OLDER message and `index - 1` is the NEWER one; the run's FIRST row (avatar,
  // name, tail) is decided by the older neighbour and its LAST row (timestamp)
  // by the newer one. Swapping them puts the tail on the wrong end of every
  // burst, which crashes nothing.
  const code = chat();
  assert.match(code, /const older\s*=\s*messages\[index \+ 1\]/, 'older is not index+1');
  assert.match(code, /const newer\s*=\s*messages\[index - 1\]/, 'newer is not index-1');
  assert.match(code, /const runStart\s*=\s*!sameSender\(older\)/, 'runStart is not derived from older');
  assert.match(code, /const runEnd\s*=\s*!sameSender\(newer\)/, 'runEnd is not derived from newer');
});

test('the tail is 5px, on the speaker\'s side, and only at the start of a run', () => {
  const code = chat();
  // Both sides present, and the two are not the same corner.
  assert.match(code, /borderBottomRightRadius:\s*5/, 'own bubbles have no tail');
  assert.match(code, /borderBottomLeftRadius:\s*5/, "other people's bubbles have no tail");
  // Suppressed mid-run, so a burst reads as one utterance.
  assert.match(
    code, /const tail\s*=\s*runStart\s*\n?\s*\?/,
    'the tail is no longer conditional on runStart — every message in a burst would keep one',
  );
});

test('the name is on the first bubble of a run and never on your own', () => {
  assert.match(
    chat(), /\{runStart && !mine && \(/,
    'the sender name is no longer gated on runStart && !mine — you know who you are',
  );
});

test('the timestamp is on the LAST bubble of a run', () => {
  // Five timestamps for one thought is noise.
  assert.match(chat(), /\{runEnd && \(/, 'the timestamp is no longer gated on runEnd');
});

test('the avatar is HIDDEN on continuations, not removed', () => {
  // Removed, the run loses its indent and every continuation shifts sideways.
  // RN has no `visibility`, so this is opacity — and the View must still be
  // rendered UNCONDITIONALLY for it to hold its 28 points.
  const code = chat();
  const s = styleObjects(code);
  assert.ok(s.avatarGhost, 'avatarGhost is gone');
  assert.match(s.avatarGhost, /opacity:\s*0/, 'avatarGhost no longer hides the avatar');
  assert.match(
    code, /!runStart && s\.avatarGhost/,
    'the ghost is not applied on continuations',
  );

  /**
   * AND IT IS NOT INSIDE A JSX CONDITIONAL.
   *
   * The first version of this check was a `doesNotMatch` against one spelling of
   * a guarded avatar, and the A/B run walked straight past it: wrapping the
   * element in `{runStart && <View …>}` kept every other assertion here green
   * while collapsing the indent of every continuation in the app. Matching one
   * spelling of a mistake only catches that spelling.
   *
   * So this reads STRUCTURE instead. Find the element that carries the ghost
   * style, walk back to the `<View` that opens it, and require the text between
   * the enclosing tag and that `<View` to be whitespace — no `&&`, no `?`, no
   * `{`. Any guard, written any way, lands in that gap.
   */
  const ghostAt = code.indexOf('!runStart && s.avatarGhost');
  assert.ok(ghostAt > 0, 'could not find the ghosted avatar');
  const openAt = code.lastIndexOf('<View', ghostAt);
  assert.ok(openAt > 0, 'the ghost style is not on a <View>');
  const before = code.slice(code.lastIndexOf('>', openAt) + 1, openAt);
  // Braces are stripped along with whitespace, because `readCode` replaces the
  // JSX comment that sits in this gap with a space and leaves its `{ }` behind.
  // A real guard leaves an EXPRESSION inside those braces — `{runStart &&`,
  // `{runStart ?`, `{!runStart ? null :` — so anything that survives this strip
  // is the guard.
  assert.equal(
    before.replace(/[{}\s]/g, ''), '',
    `the avatar is guarded by ${JSON.stringify(before.trim())} — it must render `
    + 'unconditionally and hide itself, or the run loses its indent on every '
    + 'continuation',
  );
});

test('THE TONAL ROW RULE — the message body is recoloured with its bubble', () => {
  // The frozen palette's one hard rule: "When a row goes --primary-container,
  // EVERY line in it must be recoloured, not just the title." Measuring the web
  // specimen caught three failures at 2.79, 2.83 and 3.4:1, all the same shape —
  // a line left on the page foreground while the row under it went tonal.
  //
  // Here the own bubble is a SOLID --primary fill, so leaving RichText on
  // `t.ink2` would put the page's dark ink on a saturated teal. RichText paints
  // every run it produces from this one prop, so it is the whole message.
  assert.match(
    chat(), /color=\{mine \? t\.onPrimary : t\.ink\}/,
    'the message body no longer flips its colour with the side of the bubble — '
    + 'own messages would render page ink on a solid primary fill',
  );
});

test('a system message gets no bubble and no side', () => {
  // "A module event has no author", so giving it a side attributes it to
  // somebody — and the avatar would be built from whichever user id happened to
  // trigger the event.
  const code = chat();
  assert.match(code, /const system\s*=\s*item\.type === 'system'/, 'system rows are not detected');
  assert.match(code, /const bubble\s*=\s*system \? null :/, 'a system row still gets a bubble');
  assert.match(styleObjects(code).systemText, /textAlign:\s*'center'/, 'system rows are not centred');
});

// ── 3 · The emoji picker ──────────────────────────────────────────────────────

test('the five quick reactions survive, with a door to the rest behind +', () => {
  // "The five stay — the module spec calls them content, not chrome — and a full
  // picker opens behind +."
  const code = chat();
  assert.match(code, /const QUICK_REACTIONS = \['👍', '✅', '🙏', '👀', '🎉'\]/);
  assert.match(code, /onMoreEmoji/, 'nothing opens the full picker');
  assert.match(code, /<EmojiPickerSheet/, 'the picker is not rendered');
});

test('the picker is a SEPARATE sheet from the action sheet', () => {
  // Two Modals stacked put a scrim over the panel on Android, so the action
  // sheet has to close before the picker opens. `act()` closes first; the
  // message is carried across in its own state because `actionFor` is null by
  // the time the picker mounts.
  const code = chat();
  assert.match(code, /const \[emojiFor, setEmojiFor\]/, 'the picker has no state of its own');
  assert.match(code, /onMoreEmoji=\{setEmojiFor\}/);
  assert.match(
    code, /onPress=\{\(\) => act\(\(\) => onMoreEmoji\(m\)\)\}/,
    'the + button does not close the action sheet before opening the picker',
  );
});

// ── 4 · Channel colour ────────────────────────────────────────────────────────

test('the channel tone is read through the resolver, never from a hex', () => {
  // The column stores a KEY, and the two module ramps are opposite temperatures
  // rather than one being a tint of the other — a stored hex can only ever be
  // right in one theme. Every consumer goes through `channelToneColor`, which is
  // also the only thing that knows a DM has no tile.
  for (const file of ['screens/MessagesScreen.tsx', 'screens/ChatScreen.tsx']) {
    const code = readCode(file);
    assert.match(code, /channelToneColor\(/, `${file} does not resolve a channel tone`);
    assert.match(code, /scheme/, `${file} does not read the scheme, so the tone cannot flip`);
  }
});

test('the tone goes on the glyph tile, and the row keeps its own border', () => {
  // Proposal 09 is emphatic: the row's border already carries selection, so
  // putting identity there would make the open channel lose its own colour at
  // exactly the moment you are looking at it.
  const code = readCode('screens/MessagesScreen.tsx');
  assert.match(
    code, /style=\{\[s\.icon, \{ backgroundColor: tone \? withAlpha\(tone, 0\.15\) : t\.surface3 \}\]\}/,
    'the glyph tile no longer carries the channel tone',
  );
  assert.doesNotMatch(
    code, /borderColor:\s*tone/,
    'the channel tone has moved onto the row border, where it collides with state',
  );
});

test('a null colour cannot reach a style — the migration is not applied', () => {
  // `ch.color` is null on every row today. The resolver returns null for that and
  // for a DM, and `backgroundColor: undefined` renders TRANSPARENT in RN rather
  // than throwing — an invisible channel that still occupies a row.
  const code = readCode('screens/MessagesScreen.tsx');
  assert.match(code, /tone \? withAlpha\(tone, 0\.15\) : t\.surface3/, 'no fallback fill');
  assert.match(code, /color=\{tone \?\? t\.ink2\}/, 'no fallback glyph colour');
});

// ── 5 · Devanagari on the new screen ──────────────────────────────────────────

test('Sahayak renders सहायक through the one face that has the glyphs', () => {
  // `screens/__tests__/devanagari.test.ts` sweeps this rule across every screen
  // and is the general guard. This is the specific one, because `सहायक` is the
  // product name on a brand-new surface and the failure — Tiro not being asked
  // for, the platform substituting per glyph — renders as tofu boxes on Android
  // and as a different typeface on iOS, neither of which throws.
  const code = readCode('screens/SahayakScreen.tsx');
  const s = styleObjects(code);
  for (const name of ['titleHi', 'heroTitleHi', 'heroSub', 'openerTitleHi']) {
    assert.ok(s[name], `the ${name} style is gone`);
    assert.match(s[name], /hindi\(\)/, `${name} does not name the Devanagari face`);
    assert.doesNotMatch(s[name], /fontWeight/, `${name} carries a weight — Tiro ships only 400`);
    assert.doesNotMatch(s[name], /letterSpacing:\s*(?!0)/, `${name} is tracked — this breaks the shirorekha`);
  }
});

test('the Latin and the Devanagari halves of the title are SIBLINGS, never nested', () => {
  // A nested <Text> inherits its parent's weight and tracking in React Native.
  // The Latin title is a 700 and the Devanagari must not be — so "Sahayak
  // सहायक" as one nested node would put synthetic bold on the Hindi while
  // passing every style-object check, because the offending properties are on
  // the OUTER style.
  const raw = readRaw('screens/SahayakScreen.tsx');
  const nested = /<Text[^>]*>[^<]*<Text[^>]*>[^<]*[ऀ-ॿ]/;
  assert.doesNotMatch(
    raw, nested,
    'a Devanagari <Text> is nested inside another <Text> — it will inherit the '
    + 'outer weight and tracking',
  );
});

test('the approved hero copy is present, verbatim', () => {
  // `19-sahayak-final.html`: `आपका सहायक — आपके काम का साथी`. Owner-approved
  // copy on an approved layout; it is not for an implementer to reword.
  assert.match(readRaw('screens/SahayakScreen.tsx'), /आपका सहायक — आपके काम का साथी/);
});

// ── 6 · Sahayak's honesty about what it is wired to ───────────────────────────

test('Sahayak sends nothing without a deliberate tap', () => {
  // Every question is a model call charged before it runs, and the phone is the
  // easiest place in the product to fire one by accident. The opener cards FILL
  // the composer.
  const code = readCode('screens/SahayakScreen.tsx');
  assert.match(
    code, /onPress=\{\(\) => setDraft\(o\.prompt\)\}/,
    'an opener card now sends instead of filling the composer',
  );
  assert.doesNotMatch(
    code, /onPress=\{\(\) => \{?\s*ask\.mutate/,
    'something asks the model directly from a card',
  );
});

test('Sahayak states what an answer cost', () => {
  assert.match(readCode('screens/SahayakScreen.tsx'), /credit\{item\.credits === 1 \? '' : 's'\}/);
});

test('Sahayak detects the friendly 200 that means everything failed', () => {
  // The endpoint refunds the credits and answers HTTP 200 with an apology in the
  // `message` field, so a total failure arrives looking exactly like an answer.
  const code = readCode('screens/SahayakScreen.tsx');
  assert.match(code, /looksLikeFailure\(answer\)/, 'the friendly 200 is rendered as a real answer');
});
