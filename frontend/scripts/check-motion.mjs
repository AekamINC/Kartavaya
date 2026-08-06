/**
 * check-motion.mjs — a duration or an easing is a TOKEN, or the build fails.
 *
 * MOTION-SPEC.md §1, first line: "Never write a literal duration. Every value
 * below is a token, which is what makes the catalogue's 4x slow-motion toggle
 * possible — it scales `--ix` at the root and every animation in the app
 * follows." §2 says the same for easing.
 *
 * That instruction has been in the handover since the start and the tree still
 * carried thirteen `cubic-bezier()` literals outside a token declaration when
 * this file was written. Not because anyone disagreed with it — because
 * nothing measured it. Every one of them was added by someone who had read the
 * spec, in a rule that looked like the rule above it. A convention nobody can
 * violate accidentally does not need a script; this one plainly did.
 *
 * ── WHAT IT FAILS ON ──────────────────────────────────────────────────────
 *
 * 1. `cubic-bezier(…)` or `steps(…)` in any declaration whose property is not
 *    a custom property. There is no legitimate case: a curve used once is a
 *    curve that wants a name (see `--ease-shake`, `--ease-lotus`, `--ease-fill`
 *    in kartavaya-design.css §5, each of which the spec names as a literal and
 *    each of which is now a token BECAUSE of this rule).
 *
 * 2. A bare time literal — `220ms`, `.15s` — in `animation`, `transition` or
 *    any of their longhands, outside a custom-property declaration. This is
 *    the defect that actually reaches a user: a duration written as a literal
 *    does not multiply by `--ix`, so it ignores BOTH reduced-motion paths at
 *    once. The Animations = Reduced preference does nothing to it and neither
 *    does the OS setting.
 *
 * 3. A KEYWORD easing — `ease`, `ease-in`, `ease-out`, `ease-in-out` — in the
 *    same properties. Nine of these shipped against twelve declared easing
 *    tokens, and `ease` is the one nobody writes on purpose: it is what a
 *    two-value `transition: opacity .15s` means, so it arrives by omission.
 *    `linear` is NOT in this rule — it carries no shape to get wrong and is
 *    correct for a spinner or a determinate progress bar.
 *
 * 4. Rules 1-3 again, in JSX/JS `style={{ … }}` objects.
 *
 *    This is the half that measured NOTHING for as long as the script existed.
 *    `scanMotionLiterals` read `.css` files only, and `motionTokens.test.jsx`
 *    §1 calls this same function — so both were blind to the same five sites,
 *    and every one of them was the exact defect rule 2 exists for:
 *    `transition: 'width 0.25s ease'` in an inline style scales with nothing.
 *    It ignores the OS reduced-motion setting AND the in-app preference,
 *    which is worse than the stylesheet case rather than a lesser version of
 *    it, because no `@media (prefers-reduced-motion)` block can reach it
 *    either. The value has to be `var(--dur-…)`, which an inline style resolves
 *    against the element's own cascade exactly like a stylesheet does.
 *
 * ── WHAT IT DELIBERATELY ALLOWS, AND WHY EACH IS NOT A LOOPHOLE ───────────
 *
 * · Anything inside a `--x: …` declaration. That is the definition of a token
 *   and is where the literals are supposed to be.
 *
 * 2b. A literal inside `calc(… var(--ix) …)`, in a property that is not a
 *    custom property. `calc(150ms * var(--ix))` is not rule 2's bug — it does
 *    scale, so it follows the OS setting and the in-app preference exactly like
 *    `var(--dur-base)` does. It is the lesser problem of a value off the
 *    five-rung ramp, and this script used to REPORT it and not gate it, on the
 *    grounds that the sweep was 64 sites across four stylesheets and each
 *    nearest rung was a judgement about feel.
 *
 *    That is a reason to do the sweep once, not a reason to leave the ladder
 *    unenforceable forever. The sweep is done — all 64 are on a rung, each one
 *    the nearest of the five — so the exemption is gone with it, and no
 *    exemption list replaced it. The two durations the ramp genuinely cannot
 *    express (`--dur-shake`'s 420ms, `--dur-lotus`'s fixed 3.2s) are custom
 *    properties, which rule 2 has always skipped by definition; that is the
 *    door for a value that needs one, and it is the only one.
 *
 * · A literal on a declaration containing `infinite`. This is not a
 *   concession, it is the OPPOSITE rule and it is mandatory:
 *   animations.css's header states it and theme-motion.test.jsx enforces it —
 *   "at `--ix: .001` a `calc(2s * var(--ix))` loop becomes a 2ms loop that
 *   never ends, a strobe delivered to the user who just asked for less
 *   motion". An infinite animation must hold a FIXED period and let
 *   `--motion-scale` take its amplitude instead. Gating literals here would
 *   have pushed every loading spinner in the build into the exact failure mode
 *   the other checker exists to catch. `--dur-lotus: 3.2s` is still a token,
 *   because naming it costs nothing and it is the one loop long enough that
 *   somebody will want to tune it.
 *
 * · Zero. `0s` and `0ms` are the same duration whatever `--ix` is.
 *
 * · `linear`. Correct for a spinner and for a determinate progress bar, and it
 *   carries no shape to get wrong. The other four keywords are rule 3.
 *
 * · An INTERPOLATED duration in JSX — `` `${DWELL_MS}ms linear forwards` ``.
 *   `NotifToast` drives the toast's progress bar off the same JS timer that
 *   dismisses the toast; if the bar and the timer disagree the bar lies. That
 *   is the same class as the documented `infinite` exemption — a period that
 *   must be FIXED because something outside CSS depends on its value — and it
 *   falls out of the rule for free rather than needing an entry in a list,
 *   because `${…}ms` has no digit for the literal pattern to match.
 *
 * Usage: node scripts/check-motion.mjs
 */
import { readFileSync, readdirSync, existsSync, statSync } from 'fs';
import { join, extname } from 'path';

const DIRS = ['src/styles', 'src/lib', 'src'];

/** Only the top level of each directory; `src/styles`, `src/lib` and `src`
 *  itself are named explicitly rather than walked, which is the same set
 *  check-tokens.mjs reads. */
function cssIn(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith('.css'))
    .map((e) => join(dir, e.name));
}

export function stylesheets(root = '.') {
  return [...new Set(DIRS.map((d) => join(root, d)).flatMap(cssIn))].sort();
}

/**
 * Blank comments out while PRESERVING newlines, so a reported line number is
 * the line the reader will find in their editor. Every miscounted line is a
 * reader who concludes the checker is broken and stops reading it — which is
 * the failure mode `25 §1` warns about for the whole family of these scripts.
 */
function blankComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
}

/** The properties where a time literal is a duration rather than a coincidence. */
const TIMED = /^(animation|transition)(-duration|-delay|-timing-function)?$/;

/** The same set, spelled the way a JSX style object spells it. */
const TIMED_JSX = /^(animation|transition)(Duration|Delay|TimingFunction)?$|^Webkit(Animation|Transition)/;

/**
 * A keyword easing inside a timed property. `linear` is deliberately absent —
 * see the header. The lookbehind is what keeps `var(--ease-standard)` out: the
 * `ease` in a token name is always preceded by `-`.
 */
const KEYWORD_EASE = /(?<![\w-])(ease-in-out|ease-out|ease-in|ease)(?![\w-])/g;

/**
 * The three rules against one property/value pair, wherever it was written.
 *
 * Shared by the stylesheet scan and the JSX scan so the two cannot drift — the
 * whole reason the JSX half was missing is that nothing shared this code.
 */
function checkValue({ prop, value, file, line, timed, findings }) {
  const curve = value.match(/\b(cubic-bezier|steps)\s*\(/);
  if (curve) {
    findings.push({
      file, line, prop,
      why: `raw \`${curve[1]}()\` — declare it in kartavaya-design.css §5 and reference the token`,
      text: value.trim().replace(/\s+/g, ' ').slice(0, 96),
    });
  }

  if (!timed) return;
  if (/\binfinite\b/.test(value)) return;     // must be fixed — see the header

  // A literal inside `calc(… var(--ix) …)` is a DIFFERENT defect from a bare
  // one, so it gets its own sentence — but it is a defect, and it is no longer
  // merely reported. See the header, rule 2b.
  const scaled = new Set();
  for (const c of value.matchAll(/calc\(([^()]|\([^()]*\))*\)/g)) {
    if (!/var\(\s*--ix\s*\)/.test(c[0])) continue;
    for (const t of c[0].matchAll(/(?<![\w.-])(\d*\.?\d+)(ms|s)(?![\w-])/g)) scaled.add(t.index + c.index);
  }
  for (const t of value.matchAll(/(?<![\w.-])(\d*\.?\d+)(ms|s)(?![\w-])/g)) {
    if (Number(t[1]) === 0) continue;         // 0s is 0s at every --ix
    findings.push({
      file, line, prop,
      why: scaled.has(t.index)
        ? `off-ladder duration \`${t[0]}\` — it scales with --ix but is not one of the five rungs; use var(--dur-instant|fast|base|slow|xslow)`
        : `raw duration \`${t[0]}\` — it does not scale with --ix, so neither reduced-motion path reaches it`,
      text: value.trim().replace(/\s+/g, ' ').slice(0, 96),
    });
  }

  for (const k of value.matchAll(KEYWORD_EASE)) {
    findings.push({
      file, line, prop,
      why: `keyword easing \`${k[1]}\` — the system has twelve named curves; use var(--ease-…)`,
      text: value.trim().replace(/\s+/g, ' ').slice(0, 96),
    });
  }
}

/**
 * The scan, exported so `__tests__/motionTokens.test.jsx` asserts the SAME
 * implementation the build gates on. A test with its own copy of the rule
 * proves that two regexes agree, not that the tree is clean.
 */
export function scanMotionLiterals(root = '.') {
  const findings = [];
  for (const file of stylesheets(root)) {
    const text = blankComments(readFileSync(file, 'utf8'));
    // Declarations only: `prop: value` up to the next `;`, `{` or `}`. A
    // selector like `.a:hover {` cannot match, because the value group stops at
    // `{` and leaves nothing behind — and `@media (max-width: 767px)` is
    // excluded for the same reason its own `)` sits before any terminator we
    // accept.
    for (const m of text.matchAll(/(^|[;{}])\s*([-\w]+)\s*:\s*([^;{}]*)/g)) {
      const prop = m[2];
      const value = m[3];
      if (!value.trim()) continue;
      if (prop.startsWith('--')) continue;        // the token declaration itself
      const at = m.index + m[0].indexOf(prop);
      const line = text.slice(0, at).split('\n').length;
      checkValue({ prop, value, file, line, timed: TIMED.test(prop), findings });
    }
  }
  findings.push(...scanJsxMotionLiterals(root));
  return findings;
}

/** Every `.jsx`/`.js` under `src/`, except the tests. */
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
 * Rule 4 — the same three rules against JSX `style={{ … }}` values.
 *
 * The property list is `TIMED_JSX`, and the value is whatever string literal or
 * template literal follows it. A value built from an expression with no quoted
 * part (`style={{ transition: x }}`) is not readable here and is not pretended
 * to be: this is a lint, and the honest limit is stated rather than papered
 * over with a looser match that would report the wrong line.
 *
 * Exported so a test can call the JSX half on its own.
 */
export function scanJsxMotionLiterals(root = '.') {
  const findings = [];
  const PAIR = /(?:^|[{,\s])(\w+)\s*:\s*(`[^`]*`|'[^']*'|"[^"]*")/g;
  for (const file of sources(join(root, 'src'))) {
    const text = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
    for (const m of text.matchAll(PAIR)) {
      const prop = m[1];
      if (!TIMED_JSX.test(prop)) continue;
      const value = m[2].slice(1, -1);
      if (!value.trim()) continue;
      const line = text.slice(0, m.index + m[0].indexOf(prop)).split('\n').length;
      checkValue({ prop, value, file, line, timed: true, findings });
    }
  }
  return findings;
}

/* ── CLI ──────────────────────────────────────────────────────────────────
   Guarded so importing this module from a test does not call process.exit and
   take the whole vitest worker down with it. */
if (process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('scripts/check-motion.mjs')) main();

function main() {
if (!existsSync('src/styles')) {
  console.error('check-motion: src/styles not found — run from the frontend/ directory.');
  process.exit(1);
}
const files = stylesheets('.');
if (!files.length) {
  console.error(`check-motion: no .css files in ${DIRS.join(', ')}.`);
  process.exit(1);
}
const findings = scanMotionLiterals('.');

for (const f of findings) {
  console.error(`${f.file}:${f.line}  ${f.prop}`);
  console.error(`    ${f.why}`);
  console.error(`    ${f.text}`);
}

if (findings.length) {
  console.error(
    `\ncheck-motion: ${findings.length} raw motion literal(s) outside a token declaration.\n` +
    'MOTION-SPEC.md §1: "Never write a literal duration." §2 says the same for easing.\n' +
    'Fix: declare the value once in kartavaya-design.css §5 and use var(--…) here.'
  );
  process.exit(1);
}

console.log(`check-motion: ${files.length} stylesheet(s), 0 raw easing or duration literals outside a token declaration`);
}
