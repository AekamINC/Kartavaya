/**
 * The answer's grammar — and the divergence it was written to end.
 *
 * ── The defect ────────────────────────────────────────────────────────────────
 *
 * The phone rendered an assistant answer through `lib/richText.ts`, which is a
 * faithful port of SLACK's subset. The web renders the same answer through
 * `frontend/src/pages/sahayak/assistant/AnswerBody.jsx`, which reads COMMONMARK.
 * The two disagree about the most common markers a language model writes:
 *
 *     `*urgent*`    Slack: BOLD          CommonMark: ITALIC
 *     `**Total**`   Slack: literal `**`  CommonMark: BOLD
 *     `## Summary`  Slack: literal `##`  CommonMark: a heading
 *
 * Same answer, same bytes, three different readings depending on which screen
 * you were holding.
 *
 * ── The resolution these tests pin ────────────────────────────────────────────
 *
 * CommonMark won, because the AUTHOR is a model and every provider in the chain
 * emits CommonMark. Sanvaad keeps Slack, because there the author is a colleague
 * typing into a composer and the two surfaces already agree with each other. The
 * rule is per author, not per app — so the app now has two grammars ON PURPOSE,
 * and the tests below assert both that they differ and that each is the same on
 * both surfaces.
 *
 * These are REAL unit tests, not source reading: `parseAnswer` is in a `.ts`
 * file precisely so `node --test` can execute it. The renderer that turns these
 * tokens into React Native is in `screens/SahayakScreen.tsx` and cannot be
 * loaded here at all — `screens/__tests__/sahayakSurface.test.ts` covers what
 * can be reached by reading it.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';

import { parseAnswer, citableRefs, hrefHost, type AnsBlock, type AnsLeaf } from '../sahayak.ts';
import { parseRich } from '../../lib/richText.ts';
import { srcPath } from '../../test/source.ts';

/* ── Helpers ──────────────────────────────────────────────────────────────── */

/** Every leaf of a kind, flattened, in document order. */
function leavesOfKind(blocks: AnsBlock[], k: string): AnsLeaf[] {
  const out: AnsLeaf[] = [];
  const walk = (kids: AnsLeaf[]) => {
    for (const n of kids) {
      if (typeof n === 'string') continue;
      if (n.k === k) out.push(n);
      if (n.k === 'b' || n.k === 'i') walk(n.kids);
    }
  };
  for (const b of blocks) {
    if (b.k === 'p' || b.k === 'h') walk(b.kids);
    else if (b.k === 'ul') b.items.forEach(walk);
    else if (b.k === 'ol') b.items.forEach(it => walk(it.kids));
    else if (b.k === 'table') { b.head.forEach(walk); b.rows.forEach(r => r.forEach(walk)); }
  }
  return out;
}

/** The plain text of a token tree, markers gone. */
function textOf(blocks: AnsBlock[]): string {
  const leaf = (n: AnsLeaf): string => {
    if (typeof n === 'string') return n;
    switch (n.k) {
      case 'code': return n.text;
      case 'a':    return n.text;
      case 'cite': return `<${n.n}>`;
      default:     return n.kids.map(leaf).join('');
    }
  };
  return blocks.map(b => {
    if (b.k === 'pre') return b.text;
    if (b.k === 'hr') return '---';
    if (b.k === 'ul') return b.items.map(i => i.map(leaf).join('')).join('\n');
    if (b.k === 'ol') return b.items.map(i => `${i.num}. ${i.kids.map(leaf).join('')}`).join('\n');
    if (b.k === 'table') {
      return [b.head, ...b.rows].map(r => r.map(c => c.map(leaf).join('')).join(' | ')).join('\n');
    }
    return b.kids.map(leaf).join('');
  }).join('\n');
}

/* ── 1. The divergence, both halves ───────────────────────────────────────── */

test('THE DEFECT: a single asterisk is ITALIC here, and BOLD in Sanvaad', () => {
  // The two parsers must disagree, and this is the disagreement. If someone
  // "fixes the inconsistency" by pointing one at the other, one of these fails.
  const assistant = parseAnswer('That is *urgent* today.');
  assert.equal(leavesOfKind(assistant, 'i').length, 1, 'the assistant must read *x* as italic');
  assert.equal(leavesOfKind(assistant, 'b').length, 0, 'the assistant must NOT read *x* as bold');

  const colleague = parseRich('That is *urgent* today.');
  const bolds = JSON.stringify(colleague).match(/"k":"b"/g) ?? [];
  assert.equal(bolds.length, 1, 'Sanvaad must keep Slack: *x* is bold for a colleague');
});

test('THE DEFECT: **bold** was printed as literal asterisks on the phone', () => {
  // The old behaviour, still correct for Sanvaad — a single-asterisk rule cannot
  // open on an asterisk, so the pair is rejected and the characters survive.
  assert.match(JSON.stringify(parseRich('The **Total** is due.')), /\*\*Total\*\*/);

  // The new behaviour for an ANSWER.
  const b = leavesOfKind(parseAnswer('The **Total** is due.'), 'b');
  assert.equal(b.length, 1);
  assert.equal(textOf(parseAnswer('The **Total** is due.')), 'The Total is due.');
});

test('THE DEFECT: a heading was printed as literal hashes on the phone', () => {
  assert.match(JSON.stringify(parseRich('## Summary')), /## Summary/);

  const blocks = parseAnswer('## Summary\nBody.');
  assert.equal(blocks[0].k, 'h');
  assert.equal((blocks[0] as { level: number }).level, 2);
  assert.equal(textOf([blocks[0]]), 'Summary');
});

test('the WEB reads the same two markers the same way', () => {
  /**
   * A cross-side check, in the shape `api/__tests__/serverContract.test.ts`
   * uses: read the other side rather than pin a literal this repo chose.
   *
   * What must hold is narrow and is the thing that regressed: the web's
   * assistant treats a DOUBLE asterisk as the bold marker. Either a hand-rolled
   * rule that spells `\*\*`, or a markdown renderer that implements CommonMark
   * for it, satisfies that. A web that moved to Slack's single asterisk
   * satisfies neither, and this goes red — which is the point, because then the
   * phone and the web disagree again and only one of them would know.
   */
  const dir = path.resolve(srcPath('..'), '..', 'frontend', 'src', 'pages', 'sahayak', 'assistant');
  assert.ok(existsSync(dir), `the web assistant is not at ${dir} — this check has gone blind`);

  const sources = readdirSync(dir)
    .filter(f => f.endsWith('.jsx') || f.endsWith('.js'))
    .map(f => readFileSync(path.join(dir, f), 'utf8'))
    .join('\n');

  const handRolled = sources.includes('\\*\\*');
  const library = /from\s+['"](?:react-)?markdown|remark|marked|micromark/.test(sources);
  assert.ok(
    handRolled || library,
    'the web assistant no longer spells a double-asterisk bold rule and imports no '
    + 'markdown renderer. If it moved to Slack\'s grammar, the phone must move with '
    + 'it — an answer must read the same on both surfaces.',
  );
});

/* ── 2. The grammar itself ────────────────────────────────────────────────── */

test('the grammar is the WEB\'S, and no larger', () => {
  /**
   * A superset is a divergence too. `_x_` italic on a phone and literal
   * underscores in a browser is the same defect as `*x*` meaning two things,
   * only quieter — and it is the one a superset ships by accident.
   *
   * Each of these is CommonMark or GFM and each is absent from
   * `AnswerBody.jsx`, so each is absent here.
   */
  const b = parseAnswer('**b** and *i*');
  assert.equal(leavesOfKind(b, 'b').length, 1);
  assert.equal(leavesOfKind(b, 'i').length, 1);

  assert.equal(textOf(parseAnswer('_underscore_')), '_underscore_',
    '`_x_` is not italic on the web');
  assert.equal(textOf(parseAnswer('~~strike~~')), '~~strike~~',
    '`~~x~~` is not struck through on the web');
  assert.equal(parseAnswer('> quoted')[0].k, 'p',
    'a blockquote is not drawn on the web');
  assert.equal(leavesOfKind(parseAnswer('See https://x.example/a'), 'a').length, 0,
    'a bare URL is not linked on the web');
  assert.equal(parseAnswer('***')[0].k, 'p',
    '`***` is a rule in CommonMark and a paragraph on the web');
});

test('`2 * 3 * 4` reads the way a browser reads it, spaces and all', () => {
  /**
   * THIS ASSERTED THE OPPOSITE, AND THE OPPOSITE WAS A DIVERGENCE.
   *
   * CommonMark's flanking rule says an opener may not be followed by a space,
   * which would make this line arithmetic — and `AnswerBody.jsx` does not
   * implement it. Its alternative is a bare `\*[^*\n]+\*`, so a browser reads
   * `* 3 *` as emphasis and prints ` 3 ` in italics. The phone enforced the
   * rule the web has never had, so one multiplication in one answer rendered
   * two ways on two screens — the exact defect this grammar was written to end,
   * only pointing the other way.
   *
   * The web is the reference here and is not this agent's file to change, so
   * the phone matches it. If the web ever grows the flanking rule, this test is
   * the one that has to be turned back around.
   */
  const i = leavesOfKind(parseAnswer('2 * 3 * 4 = 24'), 'i') as { kids: AnsLeaf[] }[];
  assert.equal(i.length, 1, 'the phone is enforcing a rule the browser does not');
  assert.deepEqual(i[0].kids, [' 3 ']);

  // Padded markers go the same way, and for the same reason.
  const b = leavesOfKind(parseAnswer('** x **'), 'b') as { kids: AnsLeaf[] }[];
  assert.equal(b.length, 1);
  assert.deepEqual(b[0].kids, [' x ']);
});

test('`snake_case_name` is not italic', () => {
  assert.equal(leavesOfKind(parseAnswer('column snake_case_name here'), 'i').length, 0);
});

test('a stray asterisk from an unmatched pair does not open an italic run', () => {
  // `**x` — the bold rule finds no pair, and the italic rule must not read the
  // second asterisk as an opener.
  assert.equal(textOf(parseAnswer('**x and y')), '**x and y');
});

test('Devanagari bolds — `**ज़रूरी**।` is a bold word and a danda', () => {
  const blocks = parseAnswer('यह **ज़रूरी** है।');
  assert.equal(leavesOfKind(blocks, 'b').length, 1);
  assert.equal(textOf(blocks), 'यह ज़रूरी है।');
});

test('a code span starts first, so nothing inside one is re-read', () => {
  const blocks = parseAnswer('Use `**not bold**` and `[1]` here.', new Set([1]));
  assert.equal(leavesOfKind(blocks, 'b').length, 0);
  assert.equal(leavesOfKind(blocks, 'cite').length, 0);
  const code = leavesOfKind(blocks, 'code') as { text: string }[];
  assert.deepEqual(code.map(c => c.text), ['**not bold**', '[1]']);
});

test('a marker INSIDE emphasis is literal, because it is literal on the web', () => {
  /**
   * THE PASSES DECIDED BY RULE; THE WEB DECIDES BY POSITION.
   *
   * `inline()` is one leftmost-match alternation and pushes what it finds
   * between two `**` into a `<b>` as TEXT — so ``**`code`**`` is bold with two
   * literal backticks in it, `**[label](url)**` is bold with literal brackets,
   * and `**[1]**` is a bold `[1]` rather than a citation control. The phone ran
   * five ordered passes instead, with code at index 0 and bold at index 3, so
   * the code pass consumed the span before the bold rule ever saw the string:
   * the same answer showed a code span between two stray asterisks here and
   * bold text there. A model bolding a field name or a citation is ordinary
   * output; nothing adversarial was needed to reach this.
   */
  const code = leavesOfKind(parseAnswer('**`code`**'), 'b') as { kids: AnsLeaf[] }[];
  assert.equal(code.length, 1);
  assert.deepEqual(code[0].kids, ['`code`'], 'the backticks are characters inside the bold run');
  assert.equal(leavesOfKind(parseAnswer('**`code`**'), 'code').length, 0);

  const link = parseAnswer('**[label](https://a.tld)**');
  assert.deepEqual((leavesOfKind(link, 'b') as { kids: AnsLeaf[] }[])[0].kids,
    ['[label](https://a.tld)']);
  assert.equal(leavesOfKind(link, 'a').length, 0, 'a live link inside bold, where the web has none');

  const cite = parseAnswer('**[1]**', new Set([1]));
  assert.deepEqual((leavesOfKind(cite, 'b') as { kids: AnsLeaf[] }[])[0].kids, ['[1]']);
  assert.equal(leavesOfKind(cite, 'cite').length, 0,
    'a tappable chip between two pairs of asterisks, where the web prints bold [1]');
});

test('an ordered list keeps the number the model wrote, PER ITEM', () => {
  // Not `start + index`. A browser showing the same answer prints the literal
  // number on every line, so a list typed `1. / 1. / 1.` reads 1, 1, 1 there —
  // and renumbering it here would make the two surfaces disagree about one
  // list without either of them knowing.
  assert.equal(textOf(parseAnswer('3. third\n4. fourth')), '3. third\n4. fourth');
  assert.equal(textOf(parseAnswer('1. one\n1. two\n1. three')), '1. one\n1. two\n1. three');
  assert.equal(parseAnswer('3. third\n4. fourth')[0].k, 'ol');
});

test('a bullet needs its space, so a line that is only emphasis is not a list', () => {
  assert.equal(parseAnswer('*urgent*')[0].k, 'p');
  assert.equal(parseAnswer('- one\n- two')[0].k, 'ul');
});

test('a fence is verbatim and an unclosed one runs to the end', () => {
  const closed = parseAnswer('```sql\nSELECT **x**\n```');
  assert.equal(closed[0].k, 'pre');
  assert.equal((closed[0] as { text: string }).text, 'SELECT **x**');
  assert.equal((closed[0] as { lang: string | null }).lang, 'sql');

  // Mid-stream EVERY fence is unclosed for as long as the block is arriving.
  const open = parseAnswer('```\nhalf a block');
  assert.equal(open[0].k, 'pre');
  assert.equal((open[0] as { text: string }).text, 'half a block');
});

test('a table needs its delimiter row — pipes alone are a sentence', () => {
  const t = parseAnswer('| Client | Due |\n|---|---:|\n| Navrang | 12,000 |');
  assert.equal(t[0].k, 'table');
  assert.equal((t[0] as { rows: unknown[] }).rows.length, 1);
  assert.equal(textOf(t), 'Client | Due\nNavrang | 12,000');

  const notATable = parseAnswer('Sales | Marketing are two teams.');
  assert.equal(notATable[0].k, 'p');
});

test('a markdown link is a link and its target is allowlisted', () => {
  const ok = leavesOfKind(parseAnswer('See [the filing](https://x.example/a).'), 'a');
  assert.equal(ok.length, 1);
  assert.deepEqual(ok[0], { k: 'a', href: 'https://x.example/a', text: 'the filing' });

  // `Linking.openURL` places calls and opens the store. A label written by a
  // model can claim anything at all about where it goes.
  const bad = parseAnswer('Call [support](tel:+919999999999) now.');
  assert.equal(leavesOfKind(bad, 'a').length, 0);
  assert.match(textOf(bad), /\[support\]\(tel:/);

  const js = parseAnswer('[click](java\tscript:alert(1))');
  assert.equal(leavesOfKind(js, 'a').length, 0);
});

test('a link says where it goes, and the userinfo trick cannot hide it', () => {
  /**
   * THE LABEL IS THE MODEL'S and the model repeats what the web search returned,
   * so `[the Income Tax portal](…)` is attacker-choosable text over an
   * attacker-choosable target. A browser answers this with a status bar and then
   * an address bar; `Linking.openURL` hands the tap straight to another app, so
   * the first thing the reader sees is the page. The host is therefore drawn
   * beside the label, and it is derived HERE so it can be tested.
   *
   * The userinfo case is the one that decides whether this function helps or
   * hurts: `https://incometax.gov.in@evil.tld/` is a URL whose host is
   * `evil.tld`, and printing the characters after `//` would put the government
   * domain next to a link that opens someone else's site — an argument FOR the
   * link, made by the control that exists to expose it.
   */
  assert.equal(hrefHost('https://incometax.gov.in/portal?a=1#x'), 'incometax.gov.in');
  assert.equal(hrefHost('https://incometax.gov.in@evil.tld/pay'), 'evil.tld');
  assert.equal(hrefHost('https://user:p@ss@evil.tld/'), 'evil.tld', 'split on the LAST @');

  /**
   * A BACKSLASH BEFORE THE `@` PERFORMED THE SPOOF WITH THIS FUNCTION'S HELP.
   *
   * `\` is a separator to a browser, not a host character: for a special scheme
   * the WHATWG parser ends the authority there, so this URL opens `evil.tld`
   * and the rest is path. Reading it as one more authority character made the
   * `@` look like a userinfo split, and ` (incometax.gov.in)` was drawn beside
   * a link that went somewhere else — an argument FOR the link, made by the
   * control that exists to expose it.
   *
   * `new URL` is the reference rather than a literal chosen here: it is the
   * same parse Chrome performs on the `ACTION_VIEW` intent `Linking.openURL`
   * hands it, and it is what has to be agreed with.
   */
  const spoof = `https://evil.tld${String.fromCharCode(92)}@incometax.gov.in/`;
  assert.equal(hrefHost(spoof), new URL(spoof).host);
  assert.equal(hrefHost(spoof), 'evil.tld');
  assert.equal(hrefHost('http://EXAMPLE.COM:8443/x'), 'example.com');
  assert.equal(hrefHost('https://example.com./'), 'example.com', 'a trailing root dot');
  assert.equal(hrefHost('https://[2001:db8::1]:8443/x'), '[2001:db8::1]');

  // Anything the allowlist would refuse renders no destination rather than a
  // misleading one — there is no host to show for a scheme nothing may open.
  assert.equal(hrefHost('tel:+919999999999'), '');
  assert.equal(hrefHost('itms-apps://apps.apple.com/x'), '');
  assert.equal(hrefHost(''), '');

  // And it agrees with the parser: every link leaf has a host to show.
  const [link] = leavesOfKind(
    parseAnswer('See [the filing](https://x.example/a).'), 'a',
  ) as { href: string }[];
  assert.equal(hrefHost(link.href), 'x.example');
});

test('a bare URL survives as the characters the model typed', () => {
  // Not linked, because the web does not linkify one either. It reads the same
  // in both places, which is the whole rule — and it means a model that wants a
  // link has to write one, `[label](url)`, which it reliably does.
  const src = 'See https://x.example/a.';
  assert.equal(leavesOfKind(parseAnswer(src), 'a').length, 0);
  assert.equal(textOf(parseAnswer(src)), src);
});

/* ── 3. Citations ─────────────────────────────────────────────────────────── */

test('a [n] with a source behind it is a control; one without stays text', () => {
  const citable = new Set([1, 2]);
  const blocks = parseAnswer('Filed on time [1] but not [9].', citable);
  const cites = leavesOfKind(blocks, 'cite') as { n: number }[];
  assert.deepEqual(cites.map(c => c.n), [1]);
  assert.match(textOf(blocks), /\[9\]/, 'a marker with nothing behind it must stay literal');
});

test('NO citable set means NO citations — which is what streaming text gets', () => {
  // The invariant: `strip_invalid_refs` runs on the COMPLETE text, so every
  // marker in a partial answer is provisional. Drawing a chip on one is a
  // promise the final frame may not keep.
  assert.equal(leavesOfKind(parseAnswer('Filed on time [1].'), 'cite').length, 0);
  assert.equal(leavesOfKind(parseAnswer('Filed on time [1].', new Set()), 'cite').length, 0);
});

test('citableRefs reads a ref that arrived as a STRING', () => {
  // 75 of the 77 stored web sources carry the characters of the number, not the
  // number. A `typeof s.ref === 'number'` test throws away nearly every
  // citation this product has ever made.
  const refs = citableRefs([
    { ref: 1 },
    { ref: '2' as unknown as number, type: 'web' },
    { ref: undefined },
    { ref: 'x' as unknown as number },
  ]);
  assert.deepEqual([...refs].sort(), [1, 2]);
});

/* ── 4. Shape and cost ────────────────────────────────────────────────────── */

test('an empty or absent body is no blocks, not an empty paragraph', () => {
  assert.deepEqual(parseAnswer(''), []);
  assert.deepEqual(parseAnswer(null), []);
  assert.deepEqual(parseAnswer(undefined), []);
});

test('plain prose with no markers survives byte for byte, newlines included', () => {
  const src = 'Two invoices are unpaid.\nOne is overdue.';
  assert.equal(textOf(parseAnswer(src)), src);
});

test('a four-thousand character answer is a LINEAR parse', () => {
  // Every rule is a negated class under a single quantifier — never a lazy dot
  // with a lookaround. The alternative is an answer that freezes the JS thread
  // of whoever scrolls past it. The adversarial inputs are unbalanced markers,
  // which is where a backtracking parser dies.
  for (const unit of ['*a ', '**b ', '`c ', '[1] ', '_d ', '~~e ', '| f ']) {
    const src = unit.repeat(Math.ceil(4000 / unit.length));
    const started = Date.now();
    parseAnswer(src, new Set([1]));
    const ms = Date.now() - started;
    assert.ok(ms < 400, `parsing 4,000 characters of "${unit.trim()}" took ${ms}ms`);
  }
});
