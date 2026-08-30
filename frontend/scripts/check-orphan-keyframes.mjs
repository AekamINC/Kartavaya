/**
 * check-orphan-keyframes.mjs — a `@keyframes` name is DECLARED and USED, or the
 * build fails; and an `animation` that names a keyframe nobody declared fails
 * harder.
 *
 * ── WHY THIS EXISTS ────────────────────────────────────────────────────────
 *
 * `animations.css` §2 declares `@keyframes ixFadeUp`, and the reconciled motion
 * table in that same file's header names it as the list-stagger primitive:
 *
 *     | list stagger  | ixFadeUp  --dur-base, 38ms step, capped at 11 steps |
 *
 * When this gate was written it had ZERO call sites across the whole frontend.
 * It had been specified, built, and documented in a table of MEASURED readings,
 * and had never once run: the stagger the table described was a stagger the app
 * did not have.
 *
 * Nothing caught it, and nothing could have. `check-orphan-selectors` is the
 * gate for a declared-and-unconsumed rule, and it deliberately does NOT read
 * inside `@keyframes` blocks — a `from`/`to`/`50%` is not a selector, and
 * treating it as one is how that script's ancestor produced a 953-entry list
 * nobody could act on. So an orphaned RULE is caught and an orphaned ANIMATION
 * is not, which is the hole this file closes.
 *
 * ── THE TWO DIRECTIONS, AND WHY B IS THE EXPENSIVE ONE ─────────────────────
 *
 * A. DECLARED, NEVER REFERENCED. `@keyframes x` with no `animation` /
 *    `animation-name` naming it, in CSS or in a JSX/JS style object. This is
 *    dead weight and a lie in the documentation, which is what `ixFadeUp` was.
 *
 * B. REFERENCED, NEVER DECLARED. `animation: ixShimmer 1.7s …` where no
 *    `@keyframes ixShimmer` exists anywhere. This is the direction that reaches
 *    a user. CSS does not warn, does not fall back and does not drop the rest
 *    of the declaration — the element simply holds its start state forever. A
 *    skeleton pinned at its first frame looks like a skeleton that is loading,
 *    so the surface reads as "still fetching" rather than as broken, and the
 *    only way to find it is to know what it was supposed to look like.
 *    `.skeleton::after` in animations.css is the specimen, and 28 files apply
 *    that class: the shimmer has been inert since it was written.
 *
 * ── SCOPE: THE SAME FILES check-motion READS ───────────────────────────────
 *
 * `stylesheets()` is IMPORTED from check-motion.mjs rather than re-derived, so
 * the two gates cannot disagree about what "the tree" means. A second copy of
 * `DIRS` is a second answer to that question and only one of them stays right.
 * (Importing it is safe: check-motion guards its CLI behind an `argv[1]` test
 * precisely so a module import does not call `process.exit`.)
 *
 * `sources()` is not exported there, so it is reproduced below — the ONE piece
 * of duplication in this file, marked at its definition. If check-motion's
 * copy changes, change this one.
 *
 * Both sides of the pair are read from BOTH sets. A `@keyframes` block can live
 * inside a component's own `<style>` — `NotifToast` has one — and an animation
 * can be written in a JSX style object, so a scanner that took declarations from
 * CSS and references from everywhere would invent a fault in each direction.
 *
 * ── HOW A NAME IS FOUND IN AN `animation` SHORTHAND ────────────────────────
 *
 * The name can sit anywhere among duration, easing, delay, fill-mode,
 * iteration-count, direction and play-state — `animation: dmFade var(--dur-base)
 * var(--ease-enter) both` puts it first and `animation: 1s linear both dmSpin`
 * puts it last, and both are correct CSS. Taking the first token is wrong about
 * half the tree.
 *
 * So the value is SUBTRACTED instead: functions (`var()`, `calc()`,
 * `cubic-bezier()`, `steps()`, `linear()`) are removed with their whole
 * balanced payload, then times, bare numbers, `!important` and every keyword
 * the shorthand can legally carry are dropped. What remains is the custom-ident,
 * and there is normally exactly one per comma-separated animation.
 *
 * ── WHERE IT REFUSES TO GUESS ──────────────────────────────────────────────
 *
 * Direction B fires only on a part that yielded a candidate ident and where NOT
 * ONE of those candidates is declared. Everything else is silence:
 *
 * · A part whose name is hidden behind a `var()` or a `${…}` interpolation
 *   yields no candidate at all, so it is skipped. Note what this deliberately
 *   does NOT do: it does not skip a part merely because it CONTAINS a `var()`.
 *   Almost every animation in this tree does — `animation: dmFade
 *   var(--dur-base) var(--ease-enter) both` is the house style, MOTION-SPEC §1
 *   requires it, and suppressing on the presence of a var would have switched
 *   direction B off for the entire codebase. It was written that way first and
 *   `ixShimmer`, the one live defect in the tree, went unreported.
 * · A part that yields several candidate idents of which at least one IS a
 *   declared keyframe. That means one leftover token is a shorthand keyword
 *   this script has not been taught, not that the animation is broken.
 *
 * Direction A is generous in the same places for the same reason, and by the
 * same mechanism: every candidate ident in a part counts as a reference, so an
 * unrecognised keyword absolves rather than accuses. A gate that reports one
 * false positive gets ignored, and a gate that is ignored gets deleted.
 *
 * One limit is stated rather than papered over: a name parked in a CUSTOM
 * PROPERTY (`--x: someName 1s`) is neither a reference nor a fault here, because
 * a `--x` declaration is skipped whole — the same door check-motion leaves open
 * for a literal that needs a name. Measured across every stylesheet in the tree
 * on the day this landed, no keyframe name is held that way, so the door is
 * currently shut; if one ever is, its keyframes will read as orphaned and the
 * baseline is where that gets recorded and argued about.
 *
 * ── THE BASELINE ───────────────────────────────────────────────────────────
 *
 * `scripts/orphan-keyframes-baseline.json`, the same device as
 * `scripts/orphan-selectors-baseline.json` and `scripts/contrast-baseline.json`:
 * a NAMED list, never a count, so removing an entry is a reviewable act and one
 * exception cannot be swapped for another. NEW findings fail; held ones do not.
 * An entry that no longer applies is printed as resolved-please-remove and does
 * NOT fail, because the fix usually lands in somebody else's commit. Matching is
 * by NAME only; the file and line beside each entry are documentation and are
 * allowed to drift as other people edit CSS — the same rule the orphan-selector
 * baseline states, for the same reason.
 *
 * Usage: node scripts/check-orphan-keyframes.mjs
 *        node scripts/check-orphan-keyframes.mjs --write   (regenerate baseline)
 */
import { readFileSync, writeFileSync, readdirSync, existsSync, statSync } from 'fs';
import { join, extname, relative } from 'path';
import { stylesheets } from './check-motion.mjs';

const BASELINE = 'scripts/orphan-keyframes-baseline.json';

const posix = (p) => p.replace(/\\/g, '/');

/**
 * Blank comments out while PRESERVING newlines, so a reported line number is the
 * line the reader will find in their editor. Same helper, same reason, as
 * check-motion.mjs `blankComments` — and it is load-bearing here beyond line
 * numbers: `animations.css` discusses `@keyframes dmPop`, `@keyframes modalIn`
 * and `@keyframes fadeIn` in prose, and a scanner that reads comments would
 * count those as declarations and then report three orphans that do not exist.
 */
function blankComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
}

/**
 * DUPLICATED FROM check-motion.mjs, where it is not exported. Every `.jsx`/`.js`
 * under `src/`, except the tests. Keep the two in step.
 */
function sources(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '__tests__') continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) sources(p, out);
    else if (['.jsx', '.js'].includes(extname(name))) out.push(p);
  }
  return out;
}

/**
 * `@keyframes name {`, `@-webkit-keyframes name {`, quoted or bare.
 *
 * The trailing `{` is not decoration. Without it this matches PROSE — Button.jsx
 * §1 explains a spinner by writing "`@keyframes dmSpin`) with zero JSX writing
 * the class", and overlay-motion.test.jsx prints `@keyframes ${k.name}` in a
 * failure message. A prose mention counted as a declaration is a hole in
 * direction B and, worse, an invented orphan in direction A: a name that exists
 * only in a sentence can never be referenced by anything.
 */
const KEYFRAMES = /@(?:-[a-z]+-)?keyframes\s+(?:"([^"]*)"|'([^']*)'|(-?[A-Za-z_][\w-]*))\s*\{/g;

/** The properties whose value names a keyframe. Vendor prefixes included. */
const ANIMATION_PROP = /^(?:-(?:webkit|moz|ms|o)-)?animation(?:-name)?$/;
/** The same, spelled the way a JSX style object spells it. */
const ANIMATION_PROP_JSX = /^(?:Webkit|Moz|ms|O)?[Aa]nimation(?:Name)?$/;

/**
 * Every keyword the `animation` shorthand can carry that is NOT the name, plus
 * the CSS-wide keywords. `none` is here twice over — it is the fill-mode value
 * and the `animation-name` "no animation" value — and it is the reason
 * `animation-name: none` (animations.css §3 measures exactly that on
 * `.mt__b.on::after`) does not get reported as a missing keyframe.
 */
const SHORTHAND_KEYWORDS = new Set([
  // timing-function keywords. `linear()` is a function and is stripped before this.
  'linear', 'ease', 'ease-in', 'ease-out', 'ease-in-out', 'step-start', 'step-end',
  // iteration-count
  'infinite',
  // direction
  'normal', 'reverse', 'alternate', 'alternate-reverse',
  // fill-mode
  'none', 'forwards', 'backwards', 'both',
  // play-state
  'running', 'paused',
  // timeline / range keywords that may appear on the modern shorthand
  'auto', 'cover', 'contain', 'entry', 'exit', 'entry-crossing', 'exit-crossing',
  // CSS-wide
  'inherit', 'initial', 'unset', 'revert', 'revert-layer',
]);

/** `1s`, `.15s`, `220ms` — a duration or a delay. */
const TIME = /^[+-]?(\d+(\.\d+)?|\.\d+)(e[+-]?\d+)?(ms|s)$/i;
/** A bare number is the iteration-count; a percentage is a range offset. */
const NUMBER = /^[+-]?(\d+(\.\d+)?|\.\d+)(e[+-]?\d+)?%?$/;
/** A custom-ident, and nothing that merely looks like one. */
const IDENT = /^-?[A-Za-z_][\w-]*$/;

/**
 * Stands in for a `${…}` template interpolation. Deliberately made of word
 * characters so it FUSES with whatever follows it — `${DWELL_MS}ms` becomes one
 * unreadable token rather than a readable `ms` that would then be mistaken for
 * a keyframe called "ms".
 */
const INTERP = '__KF_INTERP__';

/** Split on commas that are not inside parentheses: `cubic-bezier(.2,.8,.2,1)`. */
function splitTopLevel(value) {
  const parts = [];
  let depth = 0;
  let cur = '';
  for (const ch of value) {
    if (ch === '(') depth++;
    else if (ch === ')') depth = Math.max(0, depth - 1);
    if (ch === ',' && depth === 0) { parts.push(cur); cur = ''; continue; }
    cur += ch;
  }
  parts.push(cur);
  return parts;
}

/**
 * Remove every `fn(…)` — `var()`, `calc()`, `cubic-bezier()`, `steps()`,
 * `linear()` — with its whole balanced payload. What survives is the part's
 * plain tokens, and a part whose name was inside one of those functions
 * therefore survives as nothing, which is how the caller knows not to judge it.
 *
 * The identifier is read as a WHOLE WORD first. Matching `[-\w]+\(` at every
 * offset instead would strip `ubic-bezier(…)` when the scan happened to be
 * standing on the `c`, leaving a stray `c` behind — and a one-letter leftover
 * is exactly the shape this script would then report as a missing keyframe.
 */
function stripFunctions(value) {
  let out = '';
  let i = 0;
  while (i < value.length) {
    if (/[-\w]/.test(value[i])) {
      let j = i;
      while (j < value.length && /[-\w]/.test(value[j])) j++;
      const word = value.slice(i, j);
      if (value[j] === '(') {
        let depth = 0;
        let k = j;
        for (; k < value.length; k++) {
          if (value[k] === '(') depth++;
          else if (value[k] === ')') { depth--; if (depth === 0) { k++; break; } }
        }
        out += ' ';
        i = k;
        continue;
      }
      out += word;
      i = j;
      continue;
    }
    out += value[i];
    i++;
  }
  return out;
}

/**
 * The candidate keyframe name(s) in ONE comma-separated animation.
 *
 * A part that resolves to no candidate is a part whose name this script could
 * not see — it was behind a `var()` or a `${…}` — and the caller drops it.
 * That is the whole of the refuses-to-guess rule; see the header for why it is
 * NOT "contains a var()".
 */
export function namesInAnimationPart(part) {
  const text = stripFunctions(part.replace(/!\s*important/gi, ' '));
  const names = [];
  for (const tok of text.split(/\s+/)) {
    const t = tok.trim();
    if (!t) continue;
    if (t.includes(INTERP)) continue;
    if (TIME.test(t) || NUMBER.test(t)) continue;
    if (SHORTHAND_KEYWORDS.has(t.toLowerCase())) continue;
    if (!IDENT.test(t)) continue;
    names.push(t);
  }
  return { names };
}

/** `animation-name` carries names and CSS-wide keywords, nothing else. */
function namesInNameList(value) {
  const text = stripFunctions(value.replace(/!\s*important/gi, ' '));
  const names = [];
  for (const part of splitTopLevel(text)) {
    const t = part.trim();
    if (!t || t.includes(INTERP)) continue;
    if (SHORTHAND_KEYWORDS.has(t.toLowerCase())) continue;
    if (!IDENT.test(t)) continue;
    names.push(t);
  }
  return { names };
}

/**
 * One property/value pair, wherever it was written. Pushes into `refs` (every
 * candidate, generously — direction A) and into `parts`, which the missing pass
 * then filters down to the parts where nothing was declared.
 *
 * Shared by the stylesheet scan and the JSX scan so the two cannot drift, the
 * same reason check-motion.mjs shares `checkValue`.
 */
function collect({ prop, value, file, line, root, isNameList, refs, parts }) {
  const groups = isNameList ? [namesInNameList(value)] : splitTopLevel(value).map(namesInAnimationPart);
  for (const g of groups) {
    for (const n of g.names) refs.add(n);
    if (!g.names.length) continue;
    parts.push({
      file: posix(relative(root, file)),
      line,
      prop,
      names: g.names,
      text: value.trim().replace(/\s+/g, ' ').slice(0, 96),
    });
  }
}

/**
 * The scan, exported whole so a test can assert the SAME implementation the
 * build gates on. A test carrying its own copy of the rule proves that two
 * regexes agree, not that the tree is clean.
 */
export function scanKeyframes(root = '.') {
  /** name -> {file, line} of the first `@keyframes` declaring it. */
  const declared = new Map();
  /** every name any animation value could plausibly be asking for. */
  const refs = new Set();
  /** every animation part whose name this script could read, for the missing pass. */
  const parts = [];

  for (const file of stylesheets(root)) {
    const text = blankComments(readFileSync(file, 'utf8'));
    const lineAt = (idx) => text.slice(0, idx).split('\n').length;

    for (const m of text.matchAll(KEYFRAMES)) {
      const name = m[1] ?? m[2] ?? m[3];
      if (!name || !IDENT.test(name)) continue;
      if (!declared.has(name)) {
        declared.set(name, { file: posix(relative(root, file)), line: lineAt(m.index) });
      }
    }

    // Declarations only: `prop: value` up to the next `;`, `{` or `}` — the same
    // reader check-motion.mjs uses, and it is correct inside `@keyframes` blocks
    // too, where `from { … }` contributes ordinary declarations and nothing that
    // matches ANIMATION_PROP.
    for (const m of text.matchAll(/(^|[;{}])\s*([-\w]+)\s*:\s*([^;{}]*)/g)) {
      const prop = m[2];
      const value = m[3];
      if (!value.trim()) continue;
      if (prop.startsWith('--')) continue;     // a token declaration, not an animation
      if (!ANIMATION_PROP.test(prop)) continue;
      const at = m.index + m[0].indexOf(prop);
      collect({
        prop, value, file, root, line: lineAt(at),
        isNameList: /-name$/.test(prop), refs, parts,
      });
    }
  }

  // Keyframes are not declared only in stylesheets. `NotifToast` ships a
  // `<style>` block inside the component, because the toast's progress bar is
  // driven off the same JS timer that dismisses the toast and the two have to be
  // written together. `@keyframes k-toast-progress` lives there and nowhere
  // else — and the first version of this gate, which read declarations out of
  // `.css` files only, reported the toast's own animation as naming a keyframe
  // that does not exist. That is the false accusation the header says gets a
  // gate switched off, produced on the very first run.
  for (const file of sources(join(root, 'src'))) {
    const text = blankComments(readFileSync(file, 'utf8'));
    for (const m of text.matchAll(KEYFRAMES)) {
      const name = m[1] ?? m[2] ?? m[3];
      if (!name || !IDENT.test(name)) continue;
      if (!declared.has(name)) {
        declared.set(name, {
          file: posix(relative(root, file)),
          line: text.slice(0, m.index).split('\n').length,
        });
      }
    }
  }

  for (const r of scanJsxAnimationRefs(root)) {
    for (const n of r.names) refs.add(n);
    if (r.names.length) parts.push(r.part);
  }

  return { declared, refs, parts };
}

/**
 * The JSX half — `style={{ animation: '…' }}` and `style={{ animationName: '…' }}`.
 *
 * The property list is `ANIMATION_PROP_JSX` and the value is whatever string or
 * template literal follows it. A value built from an expression with no quoted
 * part (`style={{ animation: x }}`) is not readable here and is not pretended to
 * be: this is a lint, and the honest limit is stated rather than papered over
 * with a looser match that would report the wrong line — the same call
 * check-motion.mjs makes about the same construct.
 *
 * Exported so a test can call the JSX half on its own.
 */
export function scanJsxAnimationRefs(root = '.') {
  const out = [];
  const PAIR = /(?:^|[{,\s])(\w+)\s*:\s*(`[^`]*`|'[^']*'|"[^"]*")/g;
  for (const file of sources(join(root, 'src'))) {
    const text = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
    for (const m of text.matchAll(PAIR)) {
      const prop = m[1];
      if (!ANIMATION_PROP_JSX.test(prop)) continue;
      const written = m[2].slice(1, -1);
      const raw = written.replace(/\$\{[^{}]*\}/g, INTERP);
      if (!raw.trim()) continue;
      const line = text.slice(0, m.index + m[0].indexOf(prop)).split('\n').length;
      const isNameList = /Name$/.test(prop);
      const groups = isNameList ? [namesInNameList(raw)] : splitTopLevel(raw).map(namesInAnimationPart);
      for (const g of groups) {
        out.push({
          names: g.names,
          part: {
            file: posix(relative(root, file)),
            line, prop,
            names: g.names,
            // The value AS WRITTEN, `${…}` and all. Echoing the substituted form
            // back at the reader would show them a line that is not in their file.
            text: written.trim().replace(/\s+/g, ' ').slice(0, 96),
          },
        });
      }
    }
  }
  return out;
}

/** The two findings lists, from one scan. */
export function findKeyframeFaults(root = '.') {
  const { declared, refs, parts } = scanKeyframes(root);

  const orphans = [...declared]
    .filter(([name]) => !refs.has(name))
    .map(([name, where]) => ({ name, ...where }))
    .sort((a, b) => a.name.localeCompare(b.name));

  // Only when NOT ONE candidate in the part is declared. See the header: a part
  // with a real name plus an unrecognised keyword is a gap in this script's
  // keyword list, not a broken animation, and must not be reported as one.
  const missing = parts
    .filter((p) => !p.names.some((n) => declared.has(n)))
    .sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);

  return { declared, orphans, missing };
}

/* ── CLI ──────────────────────────────────────────────────────────────────
   Guarded so importing this module from a test does not call process.exit and
   take the whole vitest worker down with it. */
if (process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('scripts/check-orphan-keyframes.mjs')) main();

function main() {
if (!existsSync('src/styles')) {
  console.error('check-orphan-keyframes: src/styles not found — run from the frontend/ directory.');
  process.exit(1);
}
const files = stylesheets('.');
if (!files.length) {
  console.error('check-orphan-keyframes: no stylesheets found — check-motion.mjs DIRS reads nothing.');
  process.exit(1);
}

const { declared, orphans, missing } = findKeyframeFaults('.');

// `--write` as well as the env var. `X=1 node …` is not a command a Windows
// shell runs, and this repo is developed on Windows — an npm script that only
// works on one platform is a script nobody uses. Same call as
// check-orphan-selectors.mjs.
if (process.env.KEYFRAME_WRITE_BASELINE === '1' || process.argv.includes('--write')) {
  const heldOrphans = {};
  for (const o of orphans) heldOrphans[o.name] = { file: o.file, line: o.line };
  const heldMissing = {};
  for (const m of missing) {
    for (const n of m.names) heldMissing[n] = { file: m.file, line: m.line, prop: m.prop };
  }
  writeFileSync(
    BASELINE,
    JSON.stringify(
      {
        note:
          'Keyframe faults accepted deliberately because the tree was already dirty when the gate ' +
          'went up. NEW faults fail. Named lists on purpose: deleting an entry is a reviewable act, ' +
          'and a count would let one fault be swapped for another. Shrink this file; do not grow it. ' +
          'Matching is by NAME; the file and line beside each entry are documentation and may drift. ' +
          'heldOrphans = @keyframes declared and never named by any animation — either wire it to the ' +
          'surface it was written for, or delete the block. heldMissing = an animation naming a ' +
          'keyframe that does not exist — this one is a LIVE DEFECT wherever it appears, because the ' +
          'element holds its start state forever with nothing in the console; hold it only long enough ' +
          'to fix it. THE TWO FOUNDING ENTRIES, both found by the first clean run: `pulse` is declared ' +
          'in index.css beside fadeIn and slideInR, but unlike those two it was never given the ' +
          '.anim-* rule that would apply it, and no Tailwind animate-pulse utility is used anywhere ' +
          'either — it is held rather than deleted because index.css is not this change\'s file. ' +
          '`ixShimmer` is the expensive one: .skeleton::after in animations.css names it and no ' +
          '@keyframes ixShimmer has ever existed, so every skeleton in the build — 28 files apply ' +
          'that class — has been frozen on its first frame, which is indistinguishable from a ' +
          'skeleton that is still loading. It is held ONLY so this gate can land; it wants deleting ' +
          'from the baseline and fixing in the same week.',
        generated: new Date().toISOString().slice(0, 10),
        heldOrphans,
        heldMissing,
      },
      null,
      2
    ) + '\n'
  );
  console.log(
    `check-orphan-keyframes: wrote ${Object.keys(heldOrphans).length} orphan(s) and ` +
    `${Object.keys(heldMissing).length} missing-keyframe name(s) to ${BASELINE}`
  );
  process.exit(0);
}

let held = { heldOrphans: {}, heldMissing: {} };
if (existsSync(BASELINE)) {
  const parsed = JSON.parse(readFileSync(BASELINE, 'utf8'));
  held = { heldOrphans: parsed.heldOrphans || {}, heldMissing: parsed.heldMissing || {} };
}

const freshOrphans = orphans.filter((o) => !(o.name in held.heldOrphans));
const freshMissing = missing.filter((m) => !m.names.every((n) => n in held.heldMissing));

for (const m of freshMissing) {
  console.error(`MISSING KEYFRAMES  ${m.file}:${m.line}  ${m.prop}`);
  console.error(
    `    names \`${m.names.join(', ')}\` — no @keyframes by that name exists in any stylesheet.\n` +
    '    The rule does not fall back and nothing logs: the element holds its first frame forever.'
  );
  console.error(`    ${m.text}`);
}

for (const o of freshOrphans) {
  console.error(
    `ORPHAN KEYFRAMES  @keyframes ${o.name}  — declared at ${o.file}:${o.line}, ` +
    'named by no animation anywhere in src/'
  );
}

const resolvedOrphans = Object.keys(held.heldOrphans).filter((n) => !orphans.some((o) => o.name === n));
const stillMissing = new Set(missing.flatMap((m) => m.names));
const resolvedMissing = Object.keys(held.heldMissing).filter((n) => !stillMissing.has(n));
if (resolvedOrphans.length || resolvedMissing.length) {
  console.log(`\ncheck-orphan-keyframes: baseline entries that no longer apply — remove from ${BASELINE}:`);
  if (resolvedOrphans.length) console.log('  heldOrphans:  ' + resolvedOrphans.sort().join(', '));
  if (resolvedMissing.length) console.log('  heldMissing:  ' + resolvedMissing.sort().join(', '));
}

console.log(
  `\ncheck-orphan-keyframes: ${files.length} stylesheet(s), ${declared.size} @keyframes declared, ` +
  `${orphans.length} with no animation naming them (${Object.keys(held.heldOrphans).length} held, ` +
  `${freshOrphans.length} new), ${missing.length} animation(s) naming a keyframe that does not exist ` +
  `(${Object.keys(held.heldMissing).length} held, ${freshMissing.length} new).`
);

if (freshOrphans.length || freshMissing.length) {
  console.error(
    '\ncheck-orphan-keyframes: an animation and its keyframes are one thing in two halves, and\n' +
    'neither half fails loudly without the other. A declared-and-unnamed @keyframes is a motion\n' +
    'the app was specified to have and does not; an animation naming nothing is a surface frozen\n' +
    `on its first frame. Fix the pair, or hold it by name in ${BASELINE} and say in the PR why.`
  );
  process.exit(1);
}
}
