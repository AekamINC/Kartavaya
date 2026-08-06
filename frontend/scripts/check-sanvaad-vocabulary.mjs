/**
 * check-sanvaad-vocabulary.mjs — the two-directional gate on the Sanvaad rewrite.
 *
 * WHY THIS EXISTS
 * ---------------
 * `styles/sanvaad.css` is TWO stylesheets in one file. Everything above the
 * `§ V2 · MESSAGING v2` banner is the pre-rewrite layer (`.sv`, `.ch`, `.msg`,
 * `.cmp`, `.svd`, `.emo`, `.wa`); everything at or below it is the port of the
 * design prototype (`messaging.css` / `Msg2.jsx`). The banner's own docblock
 * says the split is temporary — "the old layer is dead the moment
 * `pages/sanvaad/**` stops naming it" — and the rewrite was reported finished
 * while roughly half the page still named the old layer and roughly a third of
 * the new layer had never been rendered at all.
 *
 * Nothing in the build could see that. `check-classes` fails only on a class
 * with NO rule, which an additive conversion never produces: keep both layers
 * and every class resolves. `check-orphan-selectors` does look for rules with
 * no class, but it holds a 506-entry baseline for the whole tree, so a Sanvaad
 * selector that was never wired is one line in a list that is not read, and its
 * CSS reader has a bug (below) that made 159 of the m2 selectors invisible to
 * it in the first place.
 *
 * So this gate asks the two questions that actually decide whether the
 * conversion is finished, and it asks them about ONE file:
 *
 *   ORPHAN   a selector declared in the § V2 layer that nothing in src/**
 *            renders. CSS that shipped without its page.
 *   RESIDUE  a selector declared ABOVE the banner that something in src/**
 *            still renders. A page that never left the old layer.
 *
 * Both are held by NAME in scripts/sanvaad-vocabulary-baseline.json, and both
 * are SHRINK-ONLY: a new entry fails, and an entry that no longer applies is
 * printed as resolved-please-remove. Held by name and not by count on purpose —
 * a count lets one orphan be swapped for another, which is exactly how the
 * rewrite came to be reported as done.
 *
 * THE `url()` BUG THIS FILE DOES NOT REPRODUCE
 * --------------------------------------------
 * `check-orphan-selectors.mjs` blanks a `url(` payload by scanning to the first
 * `)`. sanvaad.css declares four `--motif-kamal*` tokens whose value is a
 * QUOTED `data:image/svg+xml` URI, and those URIs contain `rotate(36)` and a
 * hundred single quotes. The first `)` lands inside the SVG, the scanner
 * resumes in the middle of a quoted string, and from that point every remaining
 * line of the file reads as string content. Measured: that reader finds 158
 * selectors in sanvaad.css and stops at line 2205 — it has never seen a single
 * `.m2*` rule, all of which start at 2384. The fix is three lines (below): if
 * the payload opens with a quote, let the QUOTE branch consume it.
 *
 * Usage: node scripts/check-sanvaad-vocabulary.mjs
 *        node scripts/check-sanvaad-vocabulary.mjs --write     (regenerate baseline)
 */
import { readFileSync, writeFileSync, readdirSync, existsSync, statSync } from 'fs';
import { join, extname, relative } from 'path';

const CSS = 'src/styles/sanvaad.css';
const SRC_DIR = 'src';
const BASELINE = 'scripts/sanvaad-vocabulary-baseline.json';
const BANNER = '§ V2 · MESSAGING v2';

/**
 * Names in this file that are not a Sanvaad vocabulary decision at all, so
 * neither question is meaningful about them.
 *
 *   is-/data-  state flags composed at runtime
 *   k-         the global design system, declared here only as a descendant
 */
const NOT_OURS = (cls) =>
  cls.startsWith('is-') || cls.startsWith('data-') || cls.startsWith('k-');

// ── CSS reader ──────────────────────────────────────────────────────────────

const blankComments = (t) => t.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));

/** Blank string and url() payloads, preserving offsets so line numbers survive. */
function blankStrings(text) {
  let out = '';
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === '"' || c === "'") {
      out += c;
      i++;
      while (i < text.length && text[i] !== c) {
        if (text[i] === '\\') { out += '  '; i += 2; continue; }
        out += text[i] === '\n' ? '\n' : ' ';
        i++;
      }
      if (i < text.length) { out += c; i++; }
      continue;
    }
    if (text.startsWith('url(', i)) {
      // A QUOTED payload is left to the branch above. See THE url() BUG in the
      // header: `url("data:…%3Crotate(36)…")` has a `)` inside the string, and
      // scanning to the first one desyncs the reader for the rest of the file.
      let j = i + 4;
      while (j < text.length && /\s/.test(text[j])) j++;
      if (text[j] === '"' || text[j] === "'") { out += text.slice(i, j); i = j; continue; }
      const close = text.indexOf(')', i);
      const end = close === -1 ? text.length : close;
      out += 'url(' + text.slice(i + 4, end).replace(/[^\n]/g, ' ');
      if (close !== -1) out += ')';
      i = close === -1 ? text.length : close + 1;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/** Conditional group at-rules: their block contains RULES, so selector context resumes. */
const GROUP_AT_RULES = /^@(media|supports|container|layer|scope|document)\b/i;

/**
 * Map<class, {first, v2}> — `first` is the line of the first SELECTOR-position
 * sighting, `v2` is true when the class appears in ANY selector at or below the
 * banner. The second flag exists because a handful of names are shared
 * vocabulary rather than a layer: `.on`, `.mine`, `.hi`, `.more`, `.loud`,
 * `.seen` and `.men` are declared bare above the banner AND used in compounds
 * below it (`.m2row.on`, `.m2rx__b.mine`, `.m2tabs .hi`). First sighting alone
 * files all seven as legacy, and they are not — a state flag the new layer
 * styles is not a page that failed to convert.
 */
function declaredIn(file, bannerLine) {
  const raw = readFileSync(file, 'utf8');
  const text = blankStrings(blankComments(raw));

  // Line index once, not per match: the naive version is O(n²) on a 2900-line file.
  const nlAt = [];
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') nlAt.push(i);
  const lineAt = (idx) => {
    let lo = 0;
    let hi = nlAt.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (nlAt[mid] < idx) lo = mid + 1; else hi = mid; }
    return lo + 1;
  };

  const found = new Map();
  const stack = [];
  let inSelectorCtx = true;
  let prelude = '';
  let preludeStart = 0;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '{') {
      const p = prelude.trim();
      if (inSelectorCtx && p && !p.startsWith('@')) {
        for (const m of prelude.matchAll(/\.(-?[A-Za-z_][\w-]*)/g)) {
          const at = lineAt(preludeStart + m.index);
          if (!found.has(m[1])) found.set(m[1], { first: at, v2: false });
          if (at >= bannerLine) found.get(m[1]).v2 = true;
        }
      }
      stack.push(inSelectorCtx);
      inSelectorCtx = p.startsWith('@') ? GROUP_AT_RULES.test(p) : false;
      prelude = '';
      preludeStart = i + 1;
    } else if (c === '}') {
      inSelectorCtx = stack.length ? stack.pop() : true;
      prelude = '';
      preludeStart = i + 1;
    } else if (c === ';') {
      prelude = '';
      preludeStart = i + 1;
    } else {
      if (!prelude) preludeStart = i;
      prelude += c;
    }
  }
  return found;
}

// ── consumers ───────────────────────────────────────────────────────────────

function walk(dir, exts, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, exts, out);
    else if (exts.includes(extname(entry))) out.push(full);
  }
  return out;
}

const posix = (p) => p.replace(/\\/g, '/');
const isPlausibleClass = (s) => /^-?[A-Za-z_][\w-]*$/.test(s);

/**
 * Keywords after which a `/` opens a REGEX, not a division. Same list and same
 * reason as check-orphan-selectors: read `/"/g` as division and the scanner
 * desyncs for the rest of the file.
 */
const REGEX_KEYWORDS = new Set([
  'return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void',
  'case', 'do', 'else', 'yield', 'await', 'throw',
]);

/**
 * A real lexer, not a regex, and the RESIDUE direction is why it has to be.
 *
 * The naive `/(["'])(.*?)\1/` reader treats the apostrophe in a prose comment
 * as an opening quote, so `// … reach one worker's broadcast, which is …`
 * hands back `s broadcast, which is` as a string and every word in it as a
 * class. Measured on this tree, that alone accused `.ch`, `.msg`, `.wa`, `.rx`,
 * `.seen`, `.mine`, `.more`, `.loud` and `.hi` of being live legacy residue in
 * files that render none of them — nine of about twenty names, in a list whose
 * whole job is to be believed.
 *
 * Tracks '…', "…", `…`, `${ … }` re-entry, line and block comments, and regex
 * literals. Emits every string body and template chunk; the caller splits.
 */
function scanLiterals(text, onLiteral, onStem, onDesync) {
  const stack = [];
  let i = 0;
  let buf = '';
  let lastSig = null;

  const regexAllowed = (at) => {
    if (lastSig === null) return true;
    if (/["'`)\]]/.test(lastSig)) return false;
    if (!/[\w$]/.test(lastSig)) return true;
    let j = at - 1;
    while (j >= 0 && /\s/.test(text[j])) j--;
    const end = j + 1;
    while (j >= 0 && /[\w$]/.test(text[j])) j--;
    return REGEX_KEYWORDS.has(text.slice(j + 1, end));
  };

  const skipRegex = (at) => {
    let j = at + 1;
    let inClass = false;
    while (j < text.length) {
      const ch = text[j];
      if (ch === '\\') { j += 2; continue; }
      if (ch === '\n') return at + 1;
      if (ch === '[') inClass = true;
      else if (ch === ']') inClass = false;
      else if (ch === '/' && !inClass) { j++; break; }
      j++;
    }
    while (j < text.length && /[a-z]/.test(text[j])) j++;
    return j;
  };

  // A literal ending in `-` or `_` is a composition stem (`m2row__dot--`), not
  // a class that ever renders bare. A stem NOT ending in a separator would
  // absolve half its namespace — check-orphan-selectors calls that the prefix
  // trap and it is the reason `.sh-src__w` went unseen.
  const noteStem = (s) => {
    const tail = s.trim().split(/\s+/).pop() || '';
    if (/[\w][-_]+$/.test(tail)) onStem(tail);
  };

  while (i < text.length) {
    const top = stack[stack.length - 1];
    const c = text[i];

    if (top && top.kind === 'tpl') {
      if (c === '\\') { i += 2; continue; }
      if (c === '`') { onLiteral(buf); stack.pop(); buf = ''; i++; continue; }
      if (c === '$' && text[i + 1] === '{') {
        onLiteral(buf);
        noteStem(buf);
        buf = '';
        stack.push({ kind: 'expr', depth: 1 });
        i += 2;
        continue;
      }
      buf += c;
      i++;
      continue;
    }

    if (c === '/' && text[i + 1] === '/') {
      const nl = text.indexOf('\n', i);
      i = nl === -1 ? text.length : nl;
      continue;
    }
    if (c === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      i = end === -1 ? text.length : end + 2;
      continue;
    }
    if (c === '/' && regexAllowed(i)) { i = skipRegex(i); lastSig = '/'; continue; }
    if (c === "'" || c === '"') {
      let s = '';
      i++;
      while (i < text.length && text[i] !== c) {
        if (text[i] === '\\') { i += 2; continue; }
        if (text[i] === '\n') break;
        s += text[i];
        i++;
      }
      i++;
      onLiteral(s);
      noteStem(s);
      lastSig = c;
      continue;
    }
    if (c === '`') { stack.push({ kind: 'tpl' }); buf = ''; i++; continue; }
    if (c === '{' && top && top.kind === 'expr') { top.depth++; i++; lastSig = c; continue; }
    if (c === '}' && top && top.kind === 'expr') {
      top.depth--;
      if (top.depth === 0) { stack.pop(); buf = ''; lastSig = '`'; }
      else lastSig = c;
      i++;
      continue;
    }
    if (!/\s/.test(c)) lastSig = c;
    i++;
  }

  if (stack.length) onDesync();
}

/** Every class-shaped token of every string literal and template chunk. */
function consumersOf(files) {
  const map = new Map(); // class -> Set<file>
  const stems = new Set();
  const desynced = [];
  for (const f of files) {
    const text = readFileSync(f, 'utf8');
    const rel = posix(relative('.', f));
    const take = (raw) => {
      for (const tok of raw.split(/[^\w-]+/)) {
        if (!tok || !isPlausibleClass(tok)) continue;
        if (!map.has(tok)) map.set(tok, new Set());
        map.get(tok).add(rel);
      }
    };
    scanLiterals(text, take, (s) => stems.add(s), () => {
      // Fail SAFE, not silent: a file we could not lex contributes every
      // class-shaped token it contains, so no ORPHAN is accused on its account.
      // It is named at the end of the run so the lexer can be fixed.
      desynced.push(rel);
      take(text);
    });
  }
  return { map, stems: [...stems], desynced };
}

// ── run ─────────────────────────────────────────────────────────────────────

if (!existsSync(CSS)) {
  console.error(`check-sanvaad-vocabulary: ${CSS} not found — run from the frontend/ directory.`);
  process.exit(1);
}

const bannerLine =
  readFileSync(CSS, 'utf8').split('\n').findIndex((l) => l.includes(BANNER)) + 1;
if (!bannerLine) {
  console.error(
    `check-sanvaad-vocabulary: the "${BANNER}" banner is gone from ${CSS}.\n` +
    'This gate splits the file on that line. If the two layers were merged on purpose,\n' +
    'delete this script and say so; do not leave it pointing at a line that moved.'
  );
  process.exit(1);
}

const declared = declaredIn(CSS, bannerLine);
const jsFiles = walk(SRC_DIR, ['.jsx', '.js']).filter(
  (f) => !posix(f).includes('__tests__') && !posix(f).includes('/e2e/')
);
const { map: used, stems, desynced } = consumersOf(jsFiles);
const consumed = (cls) =>
  used.has(cls) || stems.some((p) => cls.length > p.length && cls.startsWith(p));

/**
 * The pages this vocabulary belongs to. ORPHAN asks about the whole tree,
 * because a prototype selector wired up from anywhere is wired up. RESIDUE asks
 * only about these, because a `.msg` in `pages/sahayak/SahayakTab.jsx` is not
 * this stylesheet's `.msg` — sahayak has its own `sh-*` and `hb-msg*` layers —
 * and a gate that accuses another module's markup gets switched off.
 */
const OWNED = (file) =>
  file.startsWith('src/pages/sanvaad/') || file.startsWith('src/components/sanvaad/');

const orphans = [];
const residue = [];
for (const [cls, where] of declared) {
  if (NOT_OURS(cls)) continue;
  // Position decides, EXCEPT that a name carrying the layer's own prefix is
  // prototype wherever it was declared. `.m2div__p` is first named in the
  // Devanagari inherit-list at the top of the file, 2100 lines above the
  // banner; position alone files the prototype's own divider as legacy residue.
  if (where.first >= bannerLine || cls.startsWith('m2')) {
    if (!consumed(cls)) orphans.push({ selector: cls, line: where.first });
    continue;
  }
  // Shared state flag, not a layer — see declaredIn. The SHAPE test matters:
  // without it the V2 bridge rules `.m2cp .cmp__ta:focus` and
  // `.m2cp__foot .cmp__fmt` would absolve `.cmp__ta` and `.cmp__fmt`, and any
  // future legacy name could be absolved by writing one more bridge rule. A
  // flag has no `__` element and no `--` modifier; `.on`, `.mine`, `.seen`,
  // `.hi`, `.more`, `.loud` and `.men` qualify, block names never do.
  if (where.v2 && !cls.includes('__') && !cls.includes('--')) continue;
  const seen = [...(used.get(cls) || [])].filter(OWNED).sort();
  if (seen.length) residue.push({ selector: cls, line: where.first, seen });
}
orphans.sort((a, b) => a.selector.localeCompare(b.selector));
residue.sort((a, b) => a.selector.localeCompare(b.selector));

if (process.argv.includes('--write') || process.env.SANVAAD_WRITE_BASELINE === '1') {
  const held = { orphan: {}, residue: {} };
  for (const o of orphans) held.orphan[o.selector] = { line: o.line };
  for (const r of residue) held.residue[r.selector] = { line: r.line, seen: r.seen };
  writeFileSync(
    BASELINE,
    JSON.stringify(
      {
        note:
          'Sanvaad vocabulary debt, held BY NAME so that removing an entry is a reviewable act. ' +
          '"orphan" = a § V2 prototype selector nothing in src/** renders. "residue" = a pre-V2 ' +
          'selector something in src/** still renders. Both lists SHRINK ONLY: a new entry fails ' +
          'the build. To clear a residue entry, convert the JSX FIRST and then delete the rule — ' +
          'never the other way round, because check-classes treats a class with no rule as fatal ' +
          'while treating a rule with no class as a report.',
        banner: `${CSS}:${bannerLine}`,
        generated: new Date().toISOString().slice(0, 10),
        held,
      },
      null,
      2
    ) + '\n'
  );
  console.log(
    `check-sanvaad-vocabulary: wrote ${orphans.length} orphan and ${residue.length} residue ` +
    `entries to ${BASELINE}`
  );
  process.exit(0);
}

let held = { orphan: {}, residue: {} };
if (existsSync(BASELINE)) {
  const parsed = JSON.parse(readFileSync(BASELINE, 'utf8')).held || {};
  held = { orphan: parsed.orphan || {}, residue: parsed.residue || {} };
}

const freshOrphans = orphans.filter((o) => !(o.selector in held.orphan));
const freshResidue = residue.filter((r) => !(r.selector in held.residue));
const goneOrphans = Object.keys(held.orphan).filter((c) => !orphans.some((o) => o.selector === c));
const goneResidue = Object.keys(held.residue).filter((c) => !residue.some((r) => r.selector === c));

for (const o of freshOrphans) {
  console.error(
    `PROTOTYPE ORPHAN  .${o.selector}  — declared at ${CSS}:${o.line}, rendered nowhere in src/`
  );
}
for (const r of freshResidue) {
  console.error(
    `LEGACY RESIDUE    .${r.selector}  — pre-V2 rule at ${CSS}:${r.line}, still rendered by ` +
    r.seen.join(', ')
  );
}

if (goneOrphans.length || goneResidue.length) {
  console.log(
    `\ncheck-sanvaad-vocabulary: ${goneOrphans.length + goneResidue.length} baseline ` +
    `entr${goneOrphans.length + goneResidue.length === 1 ? 'y is' : 'ies are'} clear — ` +
    `remove from ${BASELINE}:`
  );
  if (goneOrphans.length) console.log('  orphan:  ' + goneOrphans.sort().map((c) => `.${c}`).join(', '));
  if (goneResidue.length) console.log('  residue: ' + goneResidue.sort().map((c) => `.${c}`).join(', '));
}

if (desynced.length) {
  console.log(
    `\ncheck-sanvaad-vocabulary: the lexer lost its place in ${desynced.length} file(s); each was ` +
    `re-read permissively so no selector is accused on their account. Fix scanLiterals:\n  ` +
    desynced.join('\n  ')
  );
}

console.log(
  `\ncheck-sanvaad-vocabulary: banner at line ${bannerLine}; ` +
  `${[...declared].filter(([, w]) => w.first >= bannerLine).length} prototype selectors, ` +
  `${[...declared].filter(([, w]) => w.first < bannerLine).length} pre-V2 selectors. ` +
  `${orphans.length} orphan (${freshOrphans.length} new), ` +
  `${residue.length} residue (${freshResidue.length} new).`
);

if (freshOrphans.length || freshResidue.length) {
  console.error(
    '\ncheck-sanvaad-vocabulary: the § V2 rewrite is the ONLY vocabulary this module is meant to\n' +
    'have. A prototype selector with no consumer is CSS that shipped without its page; a pre-V2\n' +
    'selector with a consumer is a page that never left the old layer. Wire it, convert it, or\n' +
    `delete it. If none of the three is right today, add it to ${BASELINE} by name — and say in\n` +
    'the PR why it is allowed to stay.'
  );
  process.exit(1);
}
