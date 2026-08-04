/**
 * The eight behaviours that make `richText.ts` worth porting rather than
 * rewriting.
 *
 * `frontend/` and `mobile/` are separate packages with no shared module, so the
 * parser is shared in RULES and not in code. These pin the rules. When the web
 * parser changes, one of these fails and somebody has to decide, which is the
 * only mechanism there is to stop the two drifting.
 *
 * They are real tests, not source-contract reads: `richText.ts` is a `.ts` with
 * no imports at all, so `node --test` can load and call it.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { parseRich, safeHref, splitMentions, type Block, type Leaf } from '../richText.ts';

/** Flatten a leaf tree to the text a reader would see. */
function flat(kids: Leaf[]): string {
  return kids.map(n => {
    if (typeof n === 'string') return n;
    switch (n.k) {
      case 'code': return n.text;
      case 'a':    return n.text;
      case 'mn':   return n.mention;
      default:     return flat(n.kids);
    }
  }).join('');
}

/** Every leaf of kind `k` anywhere in a block's inline tree. */
function leavesOf(kids: Leaf[], k: string): Exclude<Leaf, string>[] {
  const out: Exclude<Leaf, string>[] = [];
  for (const n of kids) {
    if (typeof n === 'string') continue;
    if (n.k === k) out.push(n);
    if (n.k === 'b' || n.k === 'i' || n.k === 's') out.push(...leavesOf(n.kids, k));
  }
  return out;
}

const p = (body: string, names: string[] = [], meName: string | null = null): Block => {
  const blocks = parseRich(body, { names, meName });
  assert.equal(blocks.length, 1, `expected one block from ${JSON.stringify(body)}`);
  return blocks[0];
};

const kids = (b: Block): Leaf[] => {
  assert.ok(b.k === 'p' || b.k === 'quote', `block ${b.k} has no inline kids`);
  return (b as { kids: Leaf[] }).kids;
};

// ── Inline markers ────────────────────────────────────────────────────────────

test('*bold* bolds, with ONE asterisk — the subset is Slack, not CommonMark', () => {
  const b = leavesOf(kids(p('this is *urgent* now')), 'b');
  assert.equal(b.length, 1);
  assert.equal(flat((b[0] as { kids: Leaf[] }).kids), 'urgent');
});

test('2 * 3 * 4 is arithmetic, not bold', () => {
  // The false positive that makes people stop trusting a formatter. `guardOk`
  // refuses an inner run that opens or closes on whitespace.
  const b = p('2 * 3 * 4');
  assert.deepEqual(leavesOf(kids(b), 'b'), []);
  assert.equal(flat(kids(b)), '2 * 3 * 4');
});

test('snake_case_name is not italic', () => {
  const b = p('call snake_case_name please');
  assert.deepEqual(leavesOf(kids(b), 'i'), []);
  assert.equal(flat(kids(b)), 'call snake_case_name please');
});

test('a code span is verbatim — `*x*` is literal and `@Keval` is not a mention', () => {
  const stars = leavesOf(kids(p('try `*x*` here')), 'code');
  assert.equal(stars.length, 1);
  assert.equal((stars[0] as { text: string }).text, '*x*');
  assert.deepEqual(leavesOf(kids(p('try `*x*` here')), 'b'), []);

  const at = p('type `@Keval` to mention', ['Keval']);
  assert.deepEqual(leavesOf(kids(at), 'mn'), []);
  assert.equal((leavesOf(kids(at), 'code')[0] as { text: string }).text, '@Keval');
});

test('THE DEVANAGARI CLOSING SET — *ज़रूरी*। bolds', () => {
  // `।` is how a Hindi sentence ends. A closing set that only knows `.` renders
  // the whole thing as literal asterisks for exactly the users the bilingual
  // work is for.
  const b = leavesOf(kids(p('*ज़रूरी*।')), 'b');
  assert.equal(b.length, 1, 'the danda must be an acceptable closing context');
  assert.equal(flat((b[0] as { kids: Leaf[] }).kids), 'ज़रूरी');
});

test('markers nest downward but never into themselves', () => {
  const b = leavesOf(kids(p('*bold _and_ both*')), 'b');
  assert.equal(b.length, 1);
  assert.equal(leavesOf((b[0] as { kids: Leaf[] }).kids, 'i').length, 1);
});

// ── Blocks ────────────────────────────────────────────────────────────────────

test('an unclosed fence runs to the end of the message', () => {
  // Somebody pasting a stack trace and forgetting the closing fence gets a code
  // block. Collapsing back to literal text looks like the parser broke.
  const blocks = parseRich('```\nTraceback:\n  line 2\n  line 3');
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].k, 'pre');
  assert.equal((blocks[0] as { text: string }).text, 'Traceback:\n  line 2\n  line 3');
});

test('a fence keeps its language tag out of the body', () => {
  const blocks = parseRich('```sql\nSELECT 1;\n```');
  assert.equal(blocks[0].k, 'pre');
  assert.equal((blocks[0] as { lang: string | null }).lang, 'sql');
  assert.equal((blocks[0] as { text: string }).text, 'SELECT 1;');
});

test('an ordered list keeps the number it was typed with', () => {
  const blocks = parseRich('3. three\n4. four\n5. five');
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].k, 'ol');
  assert.equal((blocks[0] as { start: number }).start, 3);
  assert.equal((blocks[0] as { items: Leaf[][] }).items.length, 3);
});

test('*bold* alone on a line is not a one-item bullet list', () => {
  // `UL_RE` requires the space after the marker for exactly this reason.
  assert.equal(p('*urgent*').k, 'p');
});

test('consecutive quote lines merge into one block', () => {
  const blocks = parseRich('> one\n> two');
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].k, 'quote');
  assert.equal(flat(kids(blocks[0])), 'one\ntwo');
});

test('a plain multi-line message is ONE p block with its newlines intact', () => {
  // React Native's <Text> lays out `\n` itself, which is why `p` needs no
  // wrapper and why nothing regresses for the 95% of messages that are plain.
  const b = p('line one\nline two');
  assert.equal(b.k, 'p');
  assert.equal(flat(kids(b)), 'line one\nline two');
});

test('an empty or null body is no blocks at all', () => {
  assert.deepEqual(parseRich(''), []);
  assert.deepEqual(parseRich(null), []);
  assert.deepEqual(parseRich(undefined), []);
});

// ── Links ─────────────────────────────────────────────────────────────────────

test('https://x.com. does not link the full stop', () => {
  const a = leavesOf(kids(p('see https://x.com. thanks')), 'a');
  assert.equal(a.length, 1);
  assert.equal((a[0] as { href: string }).href, 'https://x.com');
  assert.equal((a[0] as { text: string }).text, 'https://x.com');
  assert.equal(flat(kids(p('see https://x.com. thanks'))), 'see https://x.com. thanks');
});

test('safeHref is an ALLOWLIST — a tab inside the scheme does not get past it', () => {
  assert.equal(safeHref('java\tscript:alert(1)'), null);
  assert.equal(safeHref('javascript:alert(1)'), null);
  assert.equal(safeHref('//evil.tld'), null);
  assert.equal(safeHref('tel:+919876543210'), null);
  assert.equal(safeHref('itms-apps://apps.apple.com'), null);
  assert.equal(safeHref('data:text/html,<script>'), null);
  assert.equal(safeHref(null), null);
  assert.equal(safeHref(undefined), null);
  assert.equal(safeHref('https://kartavaya.com/x'), 'https://kartavaya.com/x');
  assert.equal(safeHref('http://kartavaya.com'), 'http://kartavaya.com');
});

// ── Mentions ──────────────────────────────────────────────────────────────────

test('user@example.com does not light up its domain', () => {
  assert.deepEqual(splitMentions('mail user@example.com now'), ['mail user@example.com now']);
  assert.deepEqual(leavesOf(kids(p('mail user@example.com now')), 'mn'), []);
});

test('a known display name matches longest-first, spaces and all', () => {
  const parts = splitMentions('ping @Keval Shah about it', ['Keval', 'Keval Shah']);
  const mention = parts.find(x => typeof x !== 'string') as { name: string } | undefined;
  assert.ok(mention, 'no mention found');
  assert.equal(mention!.name, 'Keval Shah', 'a colleague called Keval must not shadow Keval Shah');
});

test('the me tone is set by name, case-insensitively', () => {
  const mine = leavesOf(kids(p('@Keval Shah please look', ['Keval Shah'], 'keval shah')), 'mn');
  assert.equal(mine.length, 1);
  assert.equal((mine[0] as { me: boolean }).me, true);

  const theirs = leavesOf(kids(p('@Aanya please look', ['Aanya'], 'Keval Shah')), 'mn');
  assert.equal((theirs[0] as { me: boolean }).me, false);
});

test('an unknown handle still renders as a mention', () => {
  const mn = leavesOf(kids(p('@aanya are you there')), 'mn');
  assert.equal(mn.length, 1);
  assert.equal((mn[0] as { mention: string }).mention, '@aanya');
});

// ── Shape ─────────────────────────────────────────────────────────────────────

test('a long message is a linear parse, not a backtracking one', () => {
  // Every marker regex is a negated class under a single quantifier. If one is
  // ever replaced by a lazy dot with a lookaround, this stops returning.
  const body = `${'word '.repeat(800)}*emphasis* ${'more '.repeat(800)}`;
  const started = Date.now();
  const blocks = parseRich(body);
  assert.equal(blocks.length, 1);
  assert.ok(leavesOf(kids(blocks[0]), 'b').length === 1);
  assert.ok(Date.now() - started < 1000, 'a 8 000-character body should parse in well under a second');
});
