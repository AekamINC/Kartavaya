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
 * 1. THE ABSENCE OF THE SCOPE. This section used to ENFORCE a scoped Slate /
 *    indigo ground on these three screens. It is inverted, and the reason is
 *    the design source rather than a change of taste:
 *
 *      · `frontend/src/styles/surface-theme.css` was DELETED on 2026-08-07
 *        (`ffe94285`) after the owner's "prototype tokens.css follow latest one,
 *        scrap my slate approved". Mobile never followed, so the phone rendered
 *        Slate while the web rendered cream.
 *      · Measured in `design-reference/Kartavaya Redesign/`: ZERO occurrences of
 *        "slate" across every .css and .jsx in the bundle. `sahayak.css`
 *        declares no colour at all (0 literals in 160 lines); `messaging.css`
 *        has 14 and every one is an overlay, a WhatsApp brand green, or the
 *        warm-brown shadow `rgba(28, 24, 16, .1)` — which is mixed for a cream
 *        ground and could not have come from a Slate one.
 *
 *    So the approved mobile design IS the base warm tokens. This section now
 *    fails if the scope comes back, because the comments that argued for it
 *    outlived it and are the obvious way for it to return.
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

/**
 * The three screens that CARRIED the scoped Slate / indigo palette until
 * 2026-08-07. They are named here rather than dropped because they are the
 * three the scope would come back to — every comment arguing for it was written
 * in these files.
 */
const FORMERLY_SCOPED_SCREENS = [
  'screens/MessagesScreen.tsx',
  'screens/ChatScreen.tsx',
  'screens/SahayakScreen.tsx',
];

// ── 1 · The scope is gone, and stays gone ─────────────────────────────────────

test('no screen in the app reaches for the scoped palette', () => {
  // Not a list of three — the WHOLE screen tree. The web deleted its stylesheet
  // outright rather than leaving it unreferenced, on the reasoning that an
  // opt-in nobody opts into is a loaded gun; the same argument applies here, so
  // `theme/surface.ts`, `useSurfaceTheme` and `SurfaceScope` are all deleted and
  // this asserts that no caller survived them.
  const holdouts = screenFiles()
    .filter(f => /useSurfaceTheme|SurfaceScope/.test(readCode(f)));
  assert.deepEqual(
    holdouts, [],
    'the Slate scope is still applied in: ' + holdouts.join(', ')
    + '. The reference bundle contains zero Slate; Sanvaad and Sahayak are the '
    + 'base warm tokens on the phone exactly as they are on the web.',
  );
});

test('the three formerly-scoped screens read the ordinary theme', () => {
  // The failure this catches is a half-removal: the scope taken off the tree
  // while the screen's own render still calls a hook that no longer exists, or
  // is left calling nothing at all and falls back to the context default —
  // which is `tokens.dark`, so a light-mode user gets a dark Sanvaad.
  for (const file of FORMERLY_SCOPED_SCREENS) {
    const code = readCode(file);
    assert.match(
      code, /=\s*useTheme\(\)/,
      `${file} does not call useTheme() — it would render on the context default, `
      + 'which is tokens.dark regardless of the user\'s preference',
    );
  }
});

test('nothing imports the deleted surface module', () => {
  // `theme/surface.ts` is deleted. A stale import is a typecheck failure rather
  // than a silent one, but this names the reason in the suite so the next reader
  // does not restore the file to make the error go away.
  const importers = screenFiles()
    .filter(f => /from\s+'[^']*theme\/surface'/.test(readRaw(f)));
  assert.deepEqual(
    importers, [],
    'these still import theme/surface, which no longer exists: ' + importers.join(', '),
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

test('Sahayak takes the server verdict for whether it answered', () => {
  // REPLACED 2026-08-07. This used to require `looksLikeFailure(answer)` — a
  // string heuristic over the prose, because the old route
  // (`/clients/{id}/chat/sessions/{id}/send`) returned the same status, shape
  // and keys whether it had answered or apologised, so guessing was the only
  // option. The screen now posts to `POST /v1/hub/chat`, which returns
  // `answered` outright. A heuristic kept alongside a fact is a second opinion
  // that will one day disagree with it.
  const code = readCode('screens/SahayakScreen.tsx');
  assert.match(code, /answer\.answered === false/, 'the server verdict is not read');
  assert.doesNotMatch(
    code, /looksLikeFailure\(answer\)/,
    'still guessing failure from the prose when the server states it',
  );
});

test('Sahayak asks the route that returns the whole answer', () => {
  // The old route returns five keys — message, sources, model, cost_usd,
  // credits_charged — so the phone ran an assistant with no work steps, no
  // figures, no evidence and no refusal block, and on a planner miss it
  // answered ungrounded claiming it had no access to records it can read.
  const code = readCode('api/sahayak.ts');
  assert.match(code, /'\/v1\/hub\/chat'/, 'the phone is not on the answer route');
  assert.doesNotMatch(
    code, /chat\/sessions\/\$\{sessionId\}\/send/,
    'the old five-key send route is still wired',
  );
});

test('Sahayak lets the SERVER open the conversation', () => {
  // Creating the session first put an empty "New chat" in the customer's org
  // every time a question was refused — a write, into a tenant the caller was
  // about to be refused from, for a question shaped like a read.
  const code = readCode('screens/SahayakScreen.tsx');
  assert.doesNotMatch(
    code, /createSession\(clientId\)/,
    'the screen still creates a session before asking',
  );
});

test('Sahayak draws every block the answer contract returns', () => {
  // 29 §2: the work steps, the attributable figures, the evidence table and the
  // refusal. The API has returned all four since 2026-08-06 and the phone drew
  // none of them.
  const code = readCode('screens/SahayakScreen.tsx');
  for (const block of ['<Work rows=', '<Figs figs=', '<EvidenceTable ev=', '<Refusal text=']) {
    assert.ok(code.includes(block), `${block} is not rendered`);
  }
});

test('the refusal block is titled by KIND, not with one fixed string', () => {
  // An `unrecognised` answer withheld nothing. Heading that block "what it
  // would not tell you" tells the reader something was hidden from them —
  // a second false impression on the exact reply this was built to fix.
  const code = readCode('screens/SahayakScreen.tsx');
  assert.match(code, /kind === 'unrecognised'/);
  assert.match(code, /Nothing of yours was read for this/);
});

test('a figure with no source is dropped rather than shown bare', () => {
  // A number with no provenance is the one thing worse than not answering.
  assert.match(
    readCode('screens/SahayakScreen.tsx'),
    /filter\(f => f && f\.value != null && f\.src\)/,
  );
});

test('the thread has a readable measure on a tablet', () => {
  // Without this the thread ran the full width of a 1200dp window — a ~140
  // character line the eye cannot track back to the start of the next.
  const code = readCode('screens/SahayakScreen.tsx');
  assert.match(code, /MAX_MEASURE/);
  assert.match(code, /useWindowClass\(devicePlatform\(\)\)/);
  // Capped, NOT centred: the standing rule is fluid and left-aligned. Asserted
  // on the THREAD's own container — other things on this screen (the thinking
  // lotus) legitimately centre, and a file-wide check catches those instead.
  assert.match(code, /contentContainerStyle=\{\[s\.scroll, wide && \{ maxWidth: measure \}\]\}/);
});
