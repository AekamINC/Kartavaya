/**
 * Channel colour: the vocabulary, and the fallback that has to work before the
 * migration exists.
 *
 * ── The state the app is actually in ────────────────────────────────────────
 *
 * MIGRATION 100 IS NOT APPLIED. `samvada_channels.color` does not exist in the
 * database as this ships, so `ch.color` is null on every row the rail renders —
 * which means the ONLY code path exercised in production today is the fallback.
 * That is the opposite of the usual situation, where the fallback is the rarely
 * taken branch, and it is why these tests spend most of their length on it.
 *
 * ── What is checked against what ────────────────────────────────────────────
 *
 * The tone vocabulary now exists in FIVE places: the CHECK constraint and the
 * backfill array in `100_channel_colour.sql`, `CHANNEL_TONES` in
 * `routers/messaging.py`, `CHANNEL_TONES` in `api/messages.ts`, and
 * `MODULE_TONES` in `theme/tokens.ts`. The backend's `test_channel_colour.py`
 * reads its three; this reads the migration and compares the mobile two against
 * it, so the client cannot drift from the column it renders.
 *
 * These are real unit tests, not source-contract reads: everything under test
 * here is a `.ts` module with no JSX, so `node --test` reaches it directly.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

import { srcPath } from '../../test/source.ts';
import { CHANNEL_TONES } from '../../api/messages.ts';
import { MODULE_TONES } from '../tokens.ts';
import { channelToneKey, channelToneColor, derivedChannelTone } from '../channelTone.ts';

const MIGRATION = path.resolve(
  srcPath('.'), '..', '..', 'backend', 'migrations', '100_channel_colour.sql',
);

// ── The vocabulary ────────────────────────────────────────────────────────────

test('the eight tone keys are the migration\'s CHECK constraint, in order', () => {
  assert.ok(
    existsSync(MIGRATION),
    `backend/migrations/100_channel_colour.sql is missing at ${MIGRATION}. It is `
    + 'the source of truth for what this column may hold.',
  );
  /**
   * COMMENTS ARE STRIPPED FIRST, and this is not defensive tidying — the first
   * version of this test matched the migration's own PROSE.
   *
   * `100_channel_colour.sql` explains itself at line 306 with
   *
   *     --         CHECK (color IS NULL OR color IN (…)) NOT VALID;
   *
   * which appears in the file BEFORE the real statement and matches the same
   * pattern. `exec` returns the first match, so the test read the ellipsis,
   * extracted zero tone keys, and would have gone green against a constraint
   * that had been deleted outright.
   *
   * This repository has been bitten by that exact shape three times — a check
   * satisfied by the commentary describing it — and `test/source.ts` strips
   * comments before every assertion for the same reason. SQL uses `--`, so it
   * needs its own strip rather than that helper.
   */
  const sql = readFileSync(MIGRATION, 'utf8')
    .split('\n')
    .filter(line => !line.trimStart().startsWith('--'))
    .join('\n');

  // The constraint spans two lines in the file, so the list is collected from
  // the whole `IN ( … )` rather than line by line.
  const m = /CHECK\s*\(\s*color IS NULL OR color IN \(([^)]+)\)/.exec(sql);
  assert.ok(m, 'no `CHECK (color IS NULL OR color IN (…))` found in migration 100');
  const fromSql = [...m![1].matchAll(/'([a-z]+)'/g)].map(x => x[1]);
  assert.ok(
    fromSql.length > 0,
    'the CHECK matched but carried no quoted tone keys — this is the comment, '
    + 'not the constraint. Check the comment strip above.',
  );

  assert.deepEqual(
    [...CHANNEL_TONES], fromSql,
    'api/messages.ts CHANNEL_TONES disagrees with migration 100\'s constraint. '
    + 'ORDER MATTERS as well as membership — derivedChannelTone indexes into the '
    + 'tuple, so reordering it silently reassigns the fallback colour of every '
    + 'channel in every org that has not had the migration applied.',
  );
});

test('every tone key resolves to a colour in BOTH themes', () => {
  // A key with no entry in MODULE_TONES is `undefined`, and
  // `backgroundColor: undefined` renders TRANSPARENT in React Native rather than
  // throwing — an invisible channel that still occupies a row, which is the
  // exact failure migration 100 spends four paragraphs preventing on the server
  // side.
  for (const tone of CHANNEL_TONES) {
    for (const scheme of ['light', 'dark'] as const) {
      const c = MODULE_TONES[scheme][tone];
      assert.ok(c, `MODULE_TONES.${scheme} has no entry for "${tone}"`);
      assert.match(c, /^#[0-9a-f]{6}$/i, `${scheme} "${tone}" is "${c}", expected a hex`);
    }
  }
});

test('light and dark are DIFFERENT colours — dark is not a tint of light', () => {
  // module.css's own rule, and the whole reason the column stores a key rather
  // than a hex: "a light-theme tint cannot be reused in dark — it comes out the
  // wrong hue, not merely the wrong luminance". A map that accidentally pointed
  // both themes at the same generated palette would pass every other test here
  // and paint a near-black chip on the indigo ground.
  for (const tone of CHANNEL_TONES) {
    assert.notEqual(
      MODULE_TONES.light[tone], MODULE_TONES.dark[tone],
      `"${tone}" is the same colour in both themes`,
    );
  }
});

// ── The stored value wins ─────────────────────────────────────────────────────

test('a stored tone is used exactly as stored', () => {
  // The owner's requirement was "assigned … and it stays, no changes everytime",
  // with the third clause — editable later — being the entire reason there is a
  // column rather than a hash.
  assert.equal(channelToneKey('any-id', 'vikray', 'public'), 'vikray');
  assert.equal(channelToneKey('any-id', 'graha', 'private'), 'graha');
});

test('a value outside the vocabulary falls through to the derived tone', () => {
  // Three shapes that can genuinely be in the column or on the wire: a hex
  // somebody wrote by hand, a tone retired from the list, and an empty string.
  // None of them may reach MODULE_TONES, because none of them is a key.
  for (const bad of ['#2F6690', 'nonsense', '', 'SANVAAD']) {
    const key = channelToneKey('abc-123', bad, 'public');
    assert.ok(
      key && (CHANNEL_TONES as readonly string[]).includes(key),
      `"${bad}" produced "${key}", which is not a tone key`,
    );
    assert.equal(key, derivedChannelTone('abc-123'), `"${bad}" did not fall through`);
  }
});

// ── Null, which is the state the app is in today ──────────────────────────────

test('null and undefined both fall through — the column does not exist yet', () => {
  // The server guarantees the KEY is present and null (`_channel_row` calls
  // `d.setdefault("color", None)`), but a row restored from the MMKV cache was
  // written before the field existed and genuinely lacks it. Both arrive here.
  const derived = derivedChannelTone('channel-one');
  assert.equal(channelToneKey('channel-one', null, 'public'), derived);
  assert.equal(channelToneKey('channel-one', undefined, 'public'), derived);
});

test('a DM has NO tone, stored or derived', () => {
  // Not an omission: the rail renders a DM as the other person, so there is no
  // tile to colour — and deriving one would put back exactly what migration
  // 100's backfill deliberately leaves out. An org with nine DMs would otherwise
  // have every named channel colliding while eight tones sat invisible in
  // private conversations.
  assert.equal(channelToneKey('dm-id', null, 'dm'), null);
  assert.equal(channelToneColor('light', 'dm-id', null, 'dm'), null);
  // Even if the server one day stored one on a DM row, the rail still has
  // nowhere to draw it.
  assert.equal(channelToneKey('dm-id', 'graha', 'dm'), null);
});

test('an unknown channel type still gets a tone', () => {
  // `channel` is undefined until the channels query answers, and permanently for
  // a room the rail does not list. `dm` is a thing we KNOW; undefined is a thing
  // we are unsure of, and the unsure case must not lose its colour.
  const derived = derivedChannelTone('x-1');
  assert.equal(channelToneKey('x-1', null, undefined), derived);
  assert.equal(channelToneKey('x-1', null, 'something-new'), derived);
});

test('an empty channel id yields null rather than a crash or a fixed colour', () => {
  // `failureStates.test.jsx` on the web mounts the channel list with `[]` for
  // exactly this: "colour lookup must tolerate a missing id rather than throw".
  // Returning a tone for '' would paint every id-less row the same colour, which
  // reads as those rows being related.
  assert.equal(channelToneKey('', null, 'public'), null);
  assert.equal(channelToneColor('dark', '', null, 'public'), null);
});

// ── The fallback's own properties ─────────────────────────────────────────────

test('the derived tone is STABLE for one id', () => {
  // The whole point. A colour that changed between renders would be worse than
  // no colour: it would teach the reader a mapping and then break it.
  const id = '9f2b1c44-1111-4222-8333-abcdefabcdef';
  const first = derivedChannelTone(id);
  for (let i = 0; i < 50; i++) assert.equal(derivedChannelTone(id), first);
});

test('the derived tone is always a real key — never undefined off the end', () => {
  // `<<` coerces to int32, so the hash is routinely NEGATIVE, and `%` in
  // JavaScript keeps the sign of its left operand: `-9 % 8` is `-1`, which
  // indexes off the FRONT of the tuple and yields undefined. That is a channel
  // with no colour and no error. Exercised over ids long enough to overflow.
  const ids = [
    '', 'a', 'zz', '0', '-', '…',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    'ffffffff-ffff-ffff-ffff-ffffffffffff',
    'a'.repeat(200),
    'ग्रह',   // Devanagari — ids arrive from route params
  ];
  for (let i = 0; i < 400; i++) ids.push(`ch-${i}-${(i * 7919).toString(36)}`);
  for (const id of ids) {
    const tone = derivedChannelTone(id);
    assert.ok(
      (CHANNEL_TONES as readonly string[]).includes(tone),
      `derivedChannelTone(${JSON.stringify(id.slice(0, 24))}) = ${String(tone)}`,
    );
  }
});

/**
 * A deterministic uuid-v4-shaped generator.
 *
 * THE IDS THIS IS TESTED AGAINST MATTER, and getting them wrong reported a bug
 * that was not there. The first version built ids from a fixed template with a
 * counter in hex — `00000001-4a2b-4c3d-9e1f-000000000001` — and the spread test
 * failed at four of eight tones, which looked exactly like a broken hash.
 *
 * It was not the hash, and the measurement is worth keeping because it is
 * counter-intuitive: on those same 8,000 templated ids, FNV-1a — the hash this
 * module now uses, chosen for its avalanche — does WORSE, landing on two buckets
 * rather than four. The pathology is in the input. Any set of ids sharing a
 * rigid template starves a bucket chooser of the entropy it needs.
 *
 * Real channel ids are `gen_random_uuid()`, i.e. 122 random bits. Measured over
 * 8,000 of those, FNV-1a fills all eight buckets to within 5% of even. So the
 * test generates ids of the shape the database actually produces rather than of
 * a shape it never does.
 *
 * mulberry32 rather than `Math.random`: a probabilistic assertion that draws
 * fresh numbers is a test that fails for one person, once, and is never
 * reproduced. Seeded, this either always passes or always fails.
 */
function seededUuids(count: number): string[] {
  let s = 0x9e3779b9;
  const rnd = () => {
    s |= 0; s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const hex = '0123456789abcdef';
  const out: string[] = [];
  for (let n = 0; n < count; n++) {
    let o = '';
    for (let i = 0; i < 32; i++) o += hex[Math.floor(rnd() * 16)];
    // Version 4, variant 8 — the shape `gen_random_uuid()` emits.
    out.push(`${o.slice(0, 8)}-${o.slice(8, 12)}-4${o.slice(13, 16)}-8${o.slice(17, 20)}-${o.slice(20, 32)}`);
  }
  return out;
}

test('the derived tone SPREADS — it is a colour code, not a decoration', () => {
  // Proposal 09's whole claim is "you navigate by colour, not by reading the
  // list". A hash that piled 800 ids onto three tones would satisfy every test
  // above and defeat the feature.
  //
  // The bar is deliberately loose. This is a hash of uuids, not a shuffle, so
  // perfectly even buckets are not expected; what is being caught is a hash that
  // has COLLAPSED — the shape you get from taking the first character, or from a
  // modulo that has gone wrong. A quarter of even is far below anything a
  // working hash produces here (measured: 81 against an expected 100) and far
  // above what a broken one does (0).
  const seen = new Map<string, number>();
  for (const id of seededUuids(800)) {
    const tone = derivedChannelTone(id);
    seen.set(tone, (seen.get(tone) ?? 0) + 1);
  }
  assert.equal(seen.size, CHANNEL_TONES.length, `only ${seen.size} of the eight tones were used`);
  for (const [tone, n] of seen) {
    assert.ok(n > 800 / 8 / 4, `"${tone}" got ${n} of 800 — the spread has collapsed`);
  }
});

test('the fallback agrees with the WEB\'s, channel for channel', () => {
  /**
   * THE SAME RAIL IS RENDERED ON BOTH SURFACES.
   *
   * Migration 100 is applied by hand, and until it is, EVERY channel's colour on
   * both the phone and the laptop comes from this fallback. Two different hashes
   * would mean the same channel is amber on a laptop and violet on the phone for
   * the whole of that window — which destroys the one property the colour exists
   * to have. A colour you cannot carry between screens is not an identity.
   *
   * That divergence was real and was caught here rather than by looking: this
   * module first reused `theme/tokens.ts`'s `h * 31 + c`, and
   * `frontend/src/pages/sanvaad/channelTone.js` had independently chosen FNV-1a.
   * Both were defensible alone; together they were two rails.
   *
   * The web file is read and its hash EVALUATED rather than re-typed, so this
   * cannot pass against a stale copy of what the web used to do.
   */
  const webFile = path.resolve(
    srcPath('.'), '..', '..', 'frontend', 'src', 'pages', 'sanvaad', 'channelTone.js',
  );
  if (!existsSync(webFile)) {
    // Not a silent skip: the surface this agrees with has moved or gone, and
    // that is exactly when the agreement stops being checked.
    assert.fail(
      `frontend/src/pages/sanvaad/channelTone.js is missing at ${webFile}. The `
      + 'mobile fallback is deliberately identical to it; if the web file moved, '
      + 'move this path — the two rails must not be allowed to diverge unwatched.',
    );
  }
  const web = readFileSync(webFile, 'utf8');

  // The eight, in order, as the web declares them.
  // `Object.freeze([…])` on the web, a bare `[…] as const` here — so the match
  // reaches past an optional call wrapper rather than assuming either spelling.
  const tonesBlock = /CHANNEL_TONES\s*=\s*(?:Object\.freeze\()?\[([\s\S]*?)\]/.exec(web);
  assert.ok(tonesBlock, 'no CHANNEL_TONES array in the web module');
  const webTones = [...tonesBlock![1].matchAll(/'([a-z]+)'/g)].map(x => x[1]);
  assert.deepEqual(
    webTones, [...CHANNEL_TONES],
    'the web and mobile tone tuples differ — same eight, or the rails disagree',
  );

  const fn = /function hash32\(s\)\s*\{[\s\S]*?\n\}/.exec(web);
  assert.ok(fn, 'no hash32 in the web module — has the fallback been rewritten?');
  // eslint-disable-next-line no-new-func -- reading the sibling implementation
  // is the whole point; nothing here is user input and nothing reaches a network.
  const webHash = new Function(`${fn![0]}; return hash32;`)() as (s: string) => number;

  for (const id of seededUuids(2000)) {
    assert.equal(
      derivedChannelTone(id), webTones[webHash(id) % webTones.length],
      `the phone and the web disagree about channel ${id}`,
    );
  }
});

// ── Resolution ────────────────────────────────────────────────────────────────

test('the resolved colour follows the theme', () => {
  const id = 'c0ffee00-0000-4000-8000-000000000001';
  const key = derivedChannelTone(id);
  assert.equal(channelToneColor('light', id, null, 'public'), MODULE_TONES.light[key]);
  assert.equal(channelToneColor('dark',  id, null, 'public'), MODULE_TONES.dark[key]);
  assert.notEqual(
    channelToneColor('light', id, null, 'public'),
    channelToneColor('dark',  id, null, 'public'),
  );
});
