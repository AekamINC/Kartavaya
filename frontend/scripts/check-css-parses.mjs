/**
 * check-css-parses — every stylesheet parses, and a comment stays a comment.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 *
 * `npm run check` exits 0 on unparseable CSS. That is written down in
 * `CLAUDE.md` as a standing trap — "run `npm run build` before pushing style
 * changes" — and a trap you have to remember is one that gets forgotten. Eleven
 * gates ran on every push and not one of them read a stylesheet as CSS.
 *
 * On 2026-08-27 the build turned up what that hole was hiding:
 *
 *     components.css:1779   `pages/(star)/_shared.jsx` reach for this.
 *
 * A path glob inside a comment. The slash-star-slash spelled a comment
 * TERMINATOR, so the comment ended four words early and the rest of the
 * sentence was parsed as CSS. esbuild recovered by discarding tokens until it
 * found something readable — `.tbl__b` survived, verified in the built bundle,
 * so nothing was actually lost. But `incident_side_rule_deleted` records this
 * project losing a real rule to a comment once already, and the difference
 * between "recovered" and "ate the next rule" is which characters follow.
 *
 * ── What it does ────────────────────────────────────────────────────────────
 *
 * Parses each stylesheet with esbuild — already a dependency, and the same
 * parser the production build uses, so a warning here is a warning there.
 * Anything not in BASELINE fails the gate.
 *
 * It reads each file ON ITS OWN rather than the bundle. That is deliberate: a
 * bundled warning reports a line number in a concatenation nobody can open,
 * which is why the two warnings below sat in build output being scrolled past.
 *
 * Run: node scripts/check-css-parses.mjs   (wired into `npm run check`)
 */
import { readdirSync, statSync, readFileSync } from 'fs';
import { transform } from 'esbuild';
import { fileURLToPath } from 'url';
import { dirname, join, relative } from 'path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Known warnings, each with the reason it is allowed to stand. NOT a general
 * amnesty: the rule is the file AND the warning text, so a NEW warning in one
 * of these files still fails.
 */
const BASELINE = [
  {
    file: 'src/index.css',
    match: /All "@import" rules must come first/,
    why:
      'The `@import` follows the three `@tailwind` directives. Tailwind '
      + 'expands those before any CSS parser sees the file, so in the stylesheet '
      + 'the browser actually receives the `@import` IS first. esbuild is '
      + 'reading the pre-Tailwind source. Moving the import above `@tailwind '
      + 'base` is what would break it.',
  },
  {
    file: 'src/styles/brand.css',
    match: /All "@import" rules must come first/,
    why:
      'REAL, and inert — flagged rather than fixed because fixing it would '
      + 'CHANGE the product. The `@import` of Nunito sits after an `@font-face` '
      + 'block, so per spec it is invalid and browsers drop it: Nunito has never '
      + 'loaded. It does not matter today because `--font-ui` is declared twice '
      + "— `brand.css` says Nunito, `kartavaya-design.css:61` says Inter, and "
      + '`lib/tokens.css` states in writing that kartavaya-design owns that '
      + 'token. Inter is loaded three ways over and is what renders. Hoisting '
      + 'the import would start downloading a font nothing uses; deleting it, '
      + 'or the duplicate token, is a design decision and belongs to the owner.',
  },
];

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist' || name.startsWith('.')) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (name.endsWith('.css')) out.push(full);
  }
  return out;
}

const files = walk(join(root, 'src')).sort();
if (files.length < 5) {
  console.error(`check-css-parses: only ${files.length} stylesheet(s) found under src/ — `
    + 'the layout has changed and this check is reading almost nothing.');
  process.exit(1);
}

const unexplained = [];
let baselined = 0;

for (const file of files) {
  const rel = relative(root, file).replace(/\\/g, '/');
  // esbuild's JS API, not the CLI. Two earlier versions of this gate reported
  // "56 stylesheets parse" having read NOTHING, and each failed differently:
  //   · `execFileSync` returns only stdout, and esbuild writes warnings to
  //     stderr while exiting 0, so every file read as an empty string.
  //   · `spawnSync('npx.cmd', …)` without a shell fails with EINVAL on
  //     Windows, so esbuild never ran at all and `stderr` was null.
  // Both printed a green tick over an unread file, which is worse than having
  // no gate — it is the exact shape of the three checks found armed in name
  // only on 2026-08-27. The API returns a structured `warnings` array, has no
  // subprocess and no platform-specific null device, and cannot silently
  // succeed: if esbuild is missing, the import throws.
  let warnings = [];
  try {
    ({ warnings } = await transform(readFileSync(file, 'utf8'),
      { loader: 'css', minify: true }));
  } catch (e) {
    // A parse ERROR, as opposed to a warning. Report it in the same list.
    warnings = (e.errors || []).length ? e.errors
      : [{ text: String(e.message || e), location: null }];
  }
  if (!warnings.length) continue;
  const out = warnings
    .map(w => `${w.text}${w.location ? `  (line ${w.location.line})` : ''}`)
    .join('\n');

  const excused = BASELINE.find(b => b.file === rel && b.match.test(out));
  if (excused) { baselined++; continue; }
  unexplained.push(`  ${rel}\n${out.trim().split('\n').map(l => '    ' + l).join('\n')}`);
}

if (unexplained.length) {
  console.error(
    'check-css-parses: these stylesheets do not parse cleanly:\n\n'
    + unexplained.join('\n\n')
    + '\n\nA CSS parser that cannot read a rule DISCARDS it, silently, and the\n'
    + 'gate suite exits 0 on unparseable CSS — which is why this check exists.\n'
    + 'The usual cause is a comment that ends early: a path glob containing a\n'
    + 'star-slash spells a comment terminator. Fix the stylesheet, or add an\n'
    + 'entry to BASELINE in this file WITH THE REASON.',
  );
  process.exit(1);
}

console.log(`check-css-parses: ${files.length} stylesheet(s) parse; `
  + `${baselined} known warning(s) held at baseline.`);
