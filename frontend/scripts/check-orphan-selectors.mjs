/**
 * check-orphan-selectors.mjs — a selector declared in src/styles/** with ZERO
 * consumers anywhere in src/**\/*.{jsx,js} FAILS the build.
 *
 * WHY THIS EXISTS
 * ---------------
 * A design prototype's CSS shipped complete while the pages meant to consume it
 * did not. Around twenty prototype selectors were declared with no consumer at
 * all, and the build stayed green the whole time. `check-classes` already
 * computes that set, but it prints it as a courtesy line and exits 0 — so the
 * gap was reported ~950 times and read zero times. `.sh__fb`, `.sh-ev` and
 * `.sh-src__w` are three of the specimens; all three are in this file's
 * baseline, which is where they belong: named, not counted.
 *
 * HOW IT DIFFERS FROM check-classes
 * ---------------------------------
 * check-classes is the MISSING-RULE gate: a class in markup with no CSS rule.
 * It reads only `className={…}` / `className="…"`, which is right for its job
 * and wrong for this one. In the unused direction that reader is far too narrow:
 *
 *     const cls = ['pk__pop', closing ? 'is-closing' : ''] …   ← Picker.jsx:117
 *     el.classList.add('msg--new');                            ← ChatPane.jsx:476
 *     { id: 'dark', cls: 'sbg__pv--dark' }                     ← SidebarBgCards.jsx:13
 *
 * None of those sit inside a `className` attribute, so check-classes calls
 * `.pk__pop`, `.msg--new` and `.sbg__pv--dark` unused. They are not. Its 953-entry
 * list is mostly that error, plus `.woff2` / `.w3` / `.googleapis` / `.css` — which
 * are fragments of `url()` values and `@import`, never selectors at all.
 *
 * A gate cannot be built on a list like that, so this script re-derives both
 * sides properly:
 *
 *   DECLARED  A brace-tracking scan that only reads SELECTOR positions. Strings
 *             and url() payloads are blanked first, and declaration blocks are
 *             skipped, so `url('/fonts/x.woff2')` no longer yields `.woff2`.
 *             Inside @media/@supports/@container/@layer/@scope we are back in
 *             selector context; inside @font-face/@keyframes/@property we are
 *             not.
 *   CONSUMED  EVERY string literal and template chunk in the file, not just the
 *             ones in a className attribute. This is deliberately generous: the
 *             cost of over-matching is one orphan we fail to catch, and the cost
 *             of under-matching is a false accusation that gets the whole gate
 *             switched off. We take the first.
 *
 * THE PREFIX TRAP
 * ---------------
 * Runtime-composed names (`btn--${v}`, `'k-inboxkind--' + kind`) have no literal
 * consumer, so a stem must absolve the names built from it. check-classes
 * records the stem of EVERY interpolation, which is too much: SourcesPanel
 * writes `` `sh-src${hot ? ' on' : ''}` ``, so `sh-src` becomes a stem and
 * `.sh-src__w` — a genuine orphan, one of the three specimens — is absolved by
 * it. Here a stem only counts when it ends in `-` or `_`, the actual composition
 * convention in this codebase. `sh-src` does not qualify; `btn--` does.
 *
 * THE BASELINE
 * ------------
 * The tree is not clean, so the currently-orphaned selectors are held in
 * scripts/orphan-selectors-baseline.json — the same device as
 * scripts/contrast-baseline.json. It is a NAMED LIST with each selector's file
 * and line, never a count, so that deleting one is a reviewable act. Matching is
 * by name only; file and line are documentation and are allowed to drift as
 * other people edit CSS.
 *
 * A NEW orphan fails. A held one does not. An entry that is no longer orphaned
 * is printed as resolved-please-remove but does NOT fail, because the fix will
 * usually land in someone else's commit and should not break their build.
 *
 * Usage: node scripts/check-orphan-selectors.mjs
 *        ORPHAN_WRITE_BASELINE=1 node scripts/check-orphan-selectors.mjs   (regenerate)
 */
import { readFileSync, writeFileSync, readdirSync, existsSync, statSync } from 'fs';
import { join, extname, relative } from 'path';

const STYLE_DIR = 'src/styles';
const SRC_DIR = 'src';
const BASELINE = 'scripts/orphan-selectors-baseline.json';

/**
 * Names that never appear in source as a whole literal. Prefix match.
 * Kept deliberately short — every entry here is a hole in the gate.
 *
 *   is-/on/off/…  state flags toggled from JS or composed as ` on`
 *   k-theme-      written by applyPrefs onto <html>, from a computed string
 *   sr-only       Tailwind-generated utility, see TAILWIND below
 */
const DYNAMIC = ['is-', 'k-theme-', 'kv-theme-', 'data-'];

/** Selectors that style third-party or generated markup, which has no literal here. */
const EXTERNAL = [
  'ProseMirror', 'ql-', 'rbd-', 'recharts', 'react-',
  'leaflet', 'swiper', 'DayPicker',
];

/**
 * Tailwind is in the build, so its utilities are generated at build time and
 * never authored in src/styles — but a handful ARE authored there as overrides.
 * Anything matching a utility shape is skipped rather than reported, for the
 * same reason check-classes skips them: the alternative is a flood that gets the
 * check switched off.
 *
 * ── TIGHTENED 2026-08-06, because this was a hole with no floor ─────────────
 *
 * The test used to be `cls === p || cls.startsWith(p)`, a bare prefix match.
 * Measured on the tree at the time, that absolved ELEVEN selectors that are not
 * Tailwind utilities at all — `.content-wrapper`, `.content-wrapper--dashboard`,
 * `--kanban`, `--list`, `--form`, `.grid-auto`, `.grid-2`, `.grid-3`, `.grid-4`,
 * `.table-container` and `.spin--lg` — caught by `content-`, `grid`, `table` and
 * `spin-`. Worse than the eleven: it made whole NAME-SPACES permanently
 * invisible. Any future orphan called `table*`, `text-*`, `bg-*`, `grid*`,
 * `flex*`, `border*`, `w-*`, `h-*`, `top-*` or `transition*` would have been
 * absolved before the gate ever saw it, and the gate would have reported
 * nothing while the CSS rotted.
 *
 * So the test now asks for a utility SHAPE:
 *
 *   · a bare keyword (`flex`, `grid`, `hidden`, `border`) matches ONLY exactly.
 *     `grid-auto` is not `grid`.
 *   · a dashed prefix matches only when what follows it looks like a Tailwind
 *     VALUE — a number, a fraction, an arbitrary `[…]`, a scale step, or one of
 *     the keyword values the framework actually emits. `text-center` passes;
 *     `content-wrapper` does not.
 *   · a variant (`hover:`) or an arbitrary value (`w-[3px]`) passes as before.
 *
 * Nothing is silently absolved by the tightening: every selector that stops
 * being exempt is held in the baseline BY NAME, which is the whole point —
 * eleven reviewable lines instead of eleven invisible ones.
 */
const TAILWIND_PREFIXES = [
  'flex', 'inline-flex', 'grid', 'inline-grid', 'block', 'inline-block', 'inline',
  'hidden', 'table', 'contents', 'relative', 'absolute', 'fixed', 'sticky', 'static',
  'items-', 'justify-', 'self-', 'content-', 'place-', 'order-', 'flex-', 'grow', 'shrink',
  'basis-', 'gap-', 'space-', 'divide-',
  'p-', 'px-', 'py-', 'pt-', 'pr-', 'pb-', 'pl-',
  'm-', 'mx-', 'my-', 'mt-', 'mr-', 'mb-', 'ml-',
  'w-', 'h-', 'min-w-', 'min-h-', 'max-w-', 'max-h-', 'size-',
  'text-', 'font-', 'leading-', 'tracking-', 'align-', 'whitespace-', 'break-', 'truncate',
  'uppercase', 'lowercase', 'capitalize', 'underline', 'line-through', 'no-underline',
  'bg-', 'border', 'border-', 'rounded', 'rounded-', 'outline-', 'ring-', 'shadow', 'shadow-',
  'opacity-', 'z-', 'overflow-', 'cursor-', 'select-', 'pointer-events-',
  'transition', 'transition-', 'duration-', 'ease-', 'animate-', 'transform', 'scale-',
  'rotate-', 'translate-', 'list-', 'appearance-', 'resize', 'sr-only', 'not-sr-only',
  'top-', 'right-', 'bottom-', 'left-', 'inset-', 'aspect-', 'object-', 'fill-', 'stroke-',
  'fade-in', 'fade-out', 'zoom-in', 'zoom-out', 'slide-in-', 'slide-out-', 'spin-', 'pulse',
];
/**
 * What may follow a dashed Tailwind prefix. Deliberately a closed list plus the
 * numeric/arbitrary shapes — an open one ("any lowercase word") is what let
 * `content-wrapper` through, and a keyword the framework does not emit is
 * better reported and held than absolved.
 */
const TW_VALUE_WORDS = new Set([
  'px', 'auto', 'full', 'screen', 'min', 'max', 'fit', 'none', 'normal', 'default',
  'xs', 'sm', 'base', 'md', 'lg', 'xl', '2xl', '3xl', '4xl', '5xl', '6xl', '7xl',
  'start', 'end', 'center', 'between', 'around', 'evenly', 'stretch', 'baseline',
  'left', 'right', 'top', 'bottom', 'middle', 'first', 'last',
  'wrap', 'nowrap', 'reverse', 'col', 'row', 'initial',
  'solid', 'dashed', 'dotted', 'double', 'hidden', 'visible', 'scroll', 'clip',
  'both', 'all', 'current', 'transparent', 'inherit', 'white', 'black',
  'pointer', 'text', 'move', 'wait', 'grab', 'in', 'out', 'linear',
  'contain', 'cover', 'fill', 'sans', 'serif', 'mono', 'bold', 'medium', 'light',
  'thin', 'semibold', 'extrabold', 'tight', 'snug', 'relaxed', 'loose', 'wide',
  'wider', 'widest', 'tighter', 'pre', 'nowrap', 'words', 'squares', 'disc',
  'decimal', 'inside', 'outside', 'x', 'y',
]);

/** `4`, `0.5`, `1/2`, `-2` — the numeric scale, including fractions and negatives. */
const TW_NUMERIC = /^-?\d+(\.\d+)?(\/\d+)?$/;
/** `red-500`, `slate-50` — a named palette entry with its scale step. */
const TW_PALETTE = /^[a-z]+-\d{2,3}$/;

const isTailwindValue = (rest) =>
  rest.startsWith('[') ||
  TW_NUMERIC.test(rest) ||
  TW_PALETTE.test(rest) ||
  TW_VALUE_WORDS.has(rest);

const isTailwind = (cls) =>
  cls.includes(':') ||
  cls.includes('[') ||
  TAILWIND_PREFIXES.some((p) =>
    p.endsWith('-')
      // BOTH halves, and the first one is not optional. Without `startsWith`
      // this absolves everything: `p-` is two characters, so `.on1.slice(2)` is
      // `"1"`, which is a perfectly good Tailwind numeric value — and 69
      // unrelated selectors silently stopped being orphans. Caught by the
      // baseline, which is the point of holding one.
      ? cls.startsWith(p) && cls.length > p.length && isTailwindValue(cls.slice(p.length))
      : cls === p);

/** Conditional group at-rules: their block contains RULES, so selector context resumes. */
const GROUP_AT_RULES = /^@(media|supports|container|layer|scope|document)\b/i;

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

/** Replace comment bodies with spaces, preserving offsets so line numbers survive. */
function blankBlockComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
}

/**
 * Blank the CONTENTS of quoted strings and url() payloads, preserving length.
 * This is what stops `url('/fonts/HarabaraMais.woff2')` from declaring `.woff2`
 * and `@import url('…fonts.googleapis.com/css2…')` from declaring `.googleapis`
 * and `.css` — four of the artifacts that made check-classes' unused list
 * untrustworthy.
 */
function blankCssStrings(text) {
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
      // `indexOf(')')` was wrong, and wrong in the worst direction: it stopped
      // at the FIRST close paren, which an inline SVG data URI supplies inside
      // its own payload —
      //
      //   url("data:image/svg+xml,…fill='rgb(0,0,0)'…")
      //                                        ^ scanning stopped here
      //
      // The rest of the payload was then scanned as CSS, its stray apostrophe
      // opened a quote that never closed, and EVERY RULE AFTER IT IN THE FILE
      // was blanked. The checker saw a shorter file, found no orphans in the
      // part it could no longer see, and reported success. That is how 677
      // selectors went missing at once.
      //
      // Two shapes, handled separately, because they END differently: a quoted
      // payload ends at its matching quote (parens inside are just bytes), and
      // an unquoted one ends at a BALANCED close paren.
      out += 'url(';
      let j = i + 4;
      while (j < text.length && /\s/.test(text[j])) { out += text[j]; j++; }
      const quote = text[j];
      if (quote === '"' || quote === "'") {
        out += quote;
        j++;
        while (j < text.length && text[j] !== quote) {
          if (text[j] === '\\') { out += '  '; j += 2; continue; }
          out += text[j] === '\n' ? '\n' : ' ';
          j++;
        }
        if (j < text.length) { out += quote; j++; }
        while (j < text.length && text[j] !== ')') {
          out += text[j] === '\n' ? '\n' : ' ';
          j++;
        }
      } else {
        let depth = 1;
        while (j < text.length) {
          if (text[j] === '(') depth++;
          else if (text[j] === ')') { depth--; if (depth === 0) break; }
          out += text[j] === '\n' ? '\n' : ' ';
          j++;
        }
      }
      if (j < text.length) { out += ')'; j++; }
      i = j;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/**
 * Every class in a SELECTOR position, with the line it was declared on.
 * Returns Map<class, {file, line}> keeping the first sighting.
 */
function declaredIn(file) {
  const raw = readFileSync(file, 'utf8');
  const text = blankCssStrings(blankBlockComments(raw));

  const found = new Map();
  // stack entry `true` = the block we are inside contains rules (selector
  // context); `false` = it contains declarations (skip).
  const stack = [];
  let inSelectorCtx = true;
  let prelude = '';
  let preludeStart = 0;

  const lineAt = (idx) => {
    let n = 1;
    for (let j = 0; j < idx && j < text.length; j++) if (text[j] === '\n') n++;
    return n;
  };

  const harvest = (sel, startIdx) => {
    for (const m of sel.matchAll(/\.(-?[A-Za-z_][\w-]*)/g)) {
      const cls = m[1];
      if (found.has(cls)) continue;
      found.set(cls, { file: posix(relative('.', file)), line: lineAt(startIdx + m.index) });
    }
  };

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '{') {
      const p = prelude.trim();
      if (inSelectorCtx && p && !p.startsWith('@')) harvest(prelude, preludeStart);
      const nowSelectorCtx = p.startsWith('@') ? GROUP_AT_RULES.test(p) : false;
      stack.push(inSelectorCtx);
      inSelectorCtx = nowSelectorCtx;
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

/** A class name, not a fragment of the expression it came out of. */
const isPlausibleClass = (s) => /^-?[A-Za-z_][\w-]*$/.test(s);

/**
 * A real lexer, not a regex, because the regex version was WRONG and the tree
 * proved it. Thirteen selectors were falsely accused on the first run, from
 * four call sites:
 *
 *     className={`wg${className ? ` ${className}` : ''}`}      WriteGate.jsx:70
 *     className={`vko__row${flag ? ` vko__row--${flag.tone}` : ''}`}
 *     className={`mk__v${tone ? ` mk__v--${tone}` : ''}`}
 *     className={`dmet__f${i.tone ? ` dmet__f--${i.tone}` : ''}`}
 *
 * These are NESTED template literals. Any ``/`([^`]*)`/`` stops at the INNER
 * opening backtick, so the captured chunk is `wg${className ?` — an unbalanced
 * `${` that survives interpolation-stripping and fails the plausible-class test.
 * `.wg`, `.vko__row`, `.mk__v` and `.dmet__f` are all consumed on the very line
 * that defeated the reader. Nesting is not parseable by regex, so it is scanned.
 *
 * The scanner tracks '…', "…", `…`, `${ … }` re-entry, and comments. Comments are
 * handled HERE rather than pre-stripped because a pre-strip cannot tell a real
 * `/*` from one inside a string, and this file's whole value is not accusing
 * innocent selectors.
 *
 * Emits every string body and every template chunk; the caller splits them on
 * whitespace. Deliberately generous — see the header.
 */
/**
 * Keywords after which a `/` opens a REGEX, not a division. Without this the
 * scanner desynced and falsely accused 36 selectors across TimeReportPage.jsx
 * and DataRunsTab.jsx, both of which contain:
 *
 *     `"${String(v).replace(/"/g, '""')}"`          TimeReportPage.jsx:39
 *
 * Read `/"/g` as division and the very next character is a `"` that opens a
 * phantom string, which closes on the first quote inside `'""'` — and every
 * literal for the rest of the FILE is then misaligned. `.trp-mem__av`,
 * `.k-tfilters` and `.sr-detail__head` are all consumed in plain
 * `className="…"` attributes; they were reported only because the reader lost
 * its place three-quarters of the file earlier.
 */
const REGEX_KEYWORDS = new Set([
  'return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void',
  'case', 'do', 'else', 'yield', 'await', 'throw',
]);

function scanLiterals(text, onLiteral, onStem, onDesync) {
  const stack = [];                       // {kind:'tpl'} | {kind:'expr', depth:number}
  let i = 0;
  let buf = '';                           // current template chunk
  let lastSig = null;                     // last significant char in code context

  /** Is a `/` here the start of a regex literal rather than a division? */
  const regexAllowed = (at) => {
    if (lastSig === null) return true;
    if (/["'`)\]]/.test(lastSig)) return false;     // end of a value → division
    if (!/[\w$]/.test(lastSig)) return true;        // after an operator or punctuation
    let j = at - 1;
    while (j >= 0 && /\s/.test(text[j])) j--;
    let end = j + 1;
    while (j >= 0 && /[\w$]/.test(text[j])) j--;
    return REGEX_KEYWORDS.has(text.slice(j + 1, end));
  };

  /** Skip a regex literal, respecting escapes and `[…]` character classes. */
  const skipRegex = (at) => {
    let j = at + 1;
    let inClass = false;
    while (j < text.length) {
      const ch = text[j];
      if (ch === '\\') { j += 2; continue; }
      if (ch === '\n') return at + 1;               // not a regex after all; bail
      if (ch === '[') inClass = true;
      else if (ch === ']') inClass = false;
      else if (ch === '/' && !inClass) { j++; break; }
      j++;
    }
    while (j < text.length && /[a-z]/.test(text[j])) j++;   // flags
    return j;
  };

  const flushTpl = (interpFollows) => {
    onLiteral(buf);
    if (interpFollows) {
      // The chunk immediately before `${` is a composition stem ONLY when it
      // ends in `-` or `_`. See THE PREFIX TRAP in the header: `sh-src${…}` must
      // NOT absolve `.sh-src__w`.
      const tail = buf.split(/\s+/).pop() || '';
      if (/[\w][-_]+$/.test(tail)) onStem(tail);
    }
    buf = '';
  };

  while (i < text.length) {
    const top = stack[stack.length - 1];
    const c = text[i];

    if (top && top.kind === 'tpl') {
      if (c === '\\') { i += 2; continue; }
      if (c === '`') { flushTpl(false); stack.pop(); i++; continue; }
      if (c === '$' && text[i + 1] === '{') {
        flushTpl(true);
        stack.push({ kind: 'expr', depth: 1 });
        i += 2;
        continue;
      }
      buf += c;
      i++;
      continue;
    }

    // Code context — top level, or inside a `${ … }` expression.
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
        if (text[i] === '\n') break;        // unterminated; bail rather than run away
        s += text[i];
        i++;
      }
      i++;
      onLiteral(s);
      // `'k-inboxkind--' + kind` — a quoted string ending in `-`/`_` is a
      // concatenation stem, not a class that ever renders bare.
      const tail = s.trim().split(/\s+/).pop() || '';
      if (/[\w][-_]+$/.test(tail)) onStem(tail);
      lastSig = c;
      continue;
    }
    if (c === '`') { stack.push({ kind: 'tpl' }); buf = ''; i++; continue; }
    if (c === '{' && top && top.kind === 'expr') { top.depth++; i++; lastSig = c; continue; }
    if (c === '}' && top && top.kind === 'expr') {
      top.depth--;
      if (top.depth === 0) { stack.pop(); buf = ''; lastSig = '`'; }  // resume the template
      else lastSig = c;
      i++;
      continue;
    }
    if (!/\s/.test(c)) lastSig = c;
    i++;
  }

  // The scanner ended mid-string or mid-template, so it lost its place somewhere
  // and every literal after that point is suspect. Say so loudly instead of
  // turning a parse failure into an accusation against a selector.
  if (stack.length) onDesync();
}

/**
 * Consumers. Every string literal and template chunk in the file — not just the
 * ones inside a `className` attribute. See the header: the patterns that defeat
 * check-classes (`const cls = [...]`, `classList.add`, `{ cls: '…' }`) all live
 * outside that attribute.
 */
function consumedIn(file, used, stems, desynced) {
  const text = readFileSync(file, 'utf8');
  const take = (raw) => {
    for (const cls of raw.split(/\s+/)) if (cls && isPlausibleClass(cls)) used.add(cls);
  };
  scanLiterals(text, take, (stem) => stems.add(stem), () => {
    // Fail SAFE, not silent: a file we could not lex contributes every
    // class-shaped token it contains, so nothing in it can be called an orphan,
    // and the file is named at the end of the run so the lexer can be fixed.
    desynced.push(posix(relative('.', file)));
    for (const tok of text.split(/[^\w-]+/)) if (tok && isPlausibleClass(tok)) used.add(tok);
  });
}

// ── run ─────────────────────────────────────────────────────────────────────
if (!existsSync(STYLE_DIR)) {
  console.error(`check-orphan-selectors: ${STYLE_DIR} not found — run from the frontend/ directory.`);
  process.exit(1);
}

const declared = new Map();
for (const f of walk(STYLE_DIR, ['.css'])) {
  for (const [cls, where] of declaredIn(f)) if (!declared.has(cls)) declared.set(cls, where);
}

const used = new Set();
const stems = new Set();
const jsFiles = walk(SRC_DIR, ['.jsx', '.js']).filter(
  (f) => !posix(f).includes('__tests__') && !posix(f).includes('/e2e/')
);
const desynced = [];
for (const f of jsFiles) consumedIn(f, used, stems, desynced);

const stemList = [...stems];
const absolved = (cls) =>
  used.has(cls) ||
  DYNAMIC.some((p) => cls === p || cls.startsWith(p)) ||
  EXTERNAL.some((p) => cls.startsWith(p)) ||
  isTailwind(cls) ||
  stemList.some((p) => cls.length > p.length && cls.startsWith(p));

const orphans = [...declared]
  .filter(([cls]) => !absolved(cls))
  .map(([cls, where]) => ({ selector: cls, ...where }))
  .sort((a, b) => a.selector.localeCompare(b.selector));

// `--write` as well as the env var. `ORPHAN_WRITE_BASELINE=1 node …` is not a
// command a Windows shell runs, and this repo is developed on Windows — an
// npm script that only works on one platform is a script nobody uses.
if (process.env.ORPHAN_WRITE_BASELINE === '1' || process.argv.includes('--write')) {
  const held = {};
  for (const o of orphans) held[o.selector] = { file: o.file, line: o.line };
  writeFileSync(
    BASELINE,
    JSON.stringify(
      {
        note:
          'Selectors declared in src/styles/** with ZERO consumers in src/**/*.{jsx,js}, accepted ' +
          'deliberately because the tree was already dirty when the gate went up. NEW orphans fail. ' +
          'This is a named list on purpose: deleting an entry is a reviewable act, and a count would ' +
          'let one orphan be swapped for another. Shrink this file; do not grow it. Either wire the ' +
          'selector up to the page that was supposed to consume it, or delete the rule — and if you ' +
          'delete, convert the JSX first, because check-classes fails on a class used but not declared. ' +
          'GREW ONCE, ON PURPOSE, 2026-08-06: isTailwind stopped absolving on a bare prefix and now ' +
          'asks for a utility SHAPE, which made eleven selectors visible that the gate had never been ' +
          'able to see — content-wrapper and its four modifiers, grid-auto, grid-2/3/4, table-container ' +
          'and spin--lg. They are not new rot; they are old rot the exemption was hiding, and they are ' +
          'held by name so somebody can decide about them.',
        generated: new Date().toISOString().slice(0, 10),
        held,
      },
      null,
      2
    ) + '\n'
  );
  console.log(`check-orphan-selectors: wrote ${orphans.length} held selectors to ${BASELINE}`);
  process.exit(0);
}

let held = {};
if (existsSync(BASELINE)) held = JSON.parse(readFileSync(BASELINE, 'utf8')).held || {};

const fresh = orphans.filter((o) => !(o.selector in held));
const resolved = Object.keys(held).filter((cls) => !orphans.some((o) => o.selector === cls));

for (const o of fresh) {
  console.error(
    `ORPHAN SELECTOR  .${o.selector}  — declared at ${o.file}:${o.line}, consumed nowhere in src/`
  );
}

if (resolved.length) {
  console.log(
    `\ncheck-orphan-selectors: ${resolved.length} baseline entr${resolved.length === 1 ? 'y is' : 'ies are'} ` +
    `no longer orphaned — remove from ${BASELINE}:`
  );
  console.log('  ' + resolved.sort().map((c) => `.${c}`).join(', '));
}

if (desynced.length) {
  console.log(
    `\ncheck-orphan-selectors: the lexer lost its place in ${desynced.length} file(s); each was ` +
    `re-read permissively so no selector is accused on their account. Fix scanLiterals:\n  ` +
    desynced.join('\n  ')
  );
}

console.log(
  `\ncheck-orphan-selectors: ${declared.size} selectors declared, ` +
  `${orphans.length} with no consumer, ${Object.keys(held).length} held at baseline, ` +
  `${fresh.length} new.`
);

if (fresh.length) {
  console.error(
    '\ncheck-orphan-selectors: a selector nothing consumes is CSS that shipped without its page.\n' +
    'Wire it to the markup it was written for, or delete the rule. If neither is right today, add it\n' +
    `to ${BASELINE} by name with its file and line — and say in the PR why it is allowed to stay.`
  );
  process.exit(1);
}
