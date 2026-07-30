/**
 * check-write-gates.mjs — every `canWrite` reads a `canWrite` that exists.
 *
 * F32 gating is applied per component: a component that owns a write control
 * calls `useModuleWrite()` and spends the answer on `disabled` and `title`. The
 * failure this catches is the one that actually happened while applying it
 * across nine modules — the hook declared in a tab, the button living in a
 * sibling component further down the same FILE:
 *
 *     export default function PayslipsTab() {
 *       const { canWrite, reason: denial } = useModuleWrite({ … });   // here
 *       …
 *     }
 *     function PayslipDetail() {                                      // not here
 *       <button disabled={busy || !canWrite}>Mark disbursed</button>  // ReferenceError
 *     }
 *
 * It builds clean — the JSX is valid and the identifier is only resolved when
 * that component renders — so `vite build` cannot see it. It is a white screen
 * on whichever drawer or dialog the reviewer did not happen to open. One
 * instance shipped as far as the test suite, and was caught only because a
 * single e2e test rendered that one drawer; the other twelve had no test
 * covering them at all.
 *
 * So this asserts scope statically rather than relying on a test existing for
 * every component that carries a write control.
 *
 * ── What it checks ──────────────────────────────────────────────────────────
 *
 * For each file, every top-level `function Name(…)` is a scope. A `canWrite`
 * USED in a scope that does not DECLARE one is an error. Both declaration
 * forms count — `useModuleWrite()`'s destructure, and the older
 * `const canWrite = canWriteModule(user, code)` that `InvoicesTab` still uses.
 *
 * Honest limits. This is line-based and knows only top-level functions, which
 * is the shape every file in `pages/` uses. It cannot see a `canWrite` closed
 * over by an arrow component assigned to a const, and it does not try: the
 * failure it exists to catch is the sibling-function one, and a cleverer parse
 * that produced false positives would be turned off within a week.
 *
 * Usage: node scripts/check-write-gates.mjs
 */
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, extname, relative } from 'path';
import { fileURLToPath } from 'url';

// `fileURLToPath`, NOT `.pathname`. On Windows a file URL's pathname keeps a
// leading slash — `/D:/Projects/…/src` — which `join` then resolves against the
// working directory, so the very first `readdirSync` asked for
// `D:\D:\Projects\…\src` and the whole check died ENOENT. `npm run check` was
// therefore red on the owner's own platform from the moment this script joined
// it. POSIX never saw it because there the two forms are identical.
const ROOT = fileURLToPath(new URL('../src', import.meta.url));

/** Opens a new top-level scope. */
const FN = /^(?:export default )?function (\w+)/;
/** Brings `canWrite` (and its `denial`) into scope. */
const DECL = /const \{ canWrite\b|const canWrite\s*=/;
/**
 * Spends it. Matches the three shapes the gating actually uses.
 *
 * `\b` is load-bearing: without it `!canWriteModule(user, code)` — which is
 * what `ModuleHeader` and `InvoicesTab` call — matches `!canWrite` and reports
 * itself as an undeclared use.
 */
const USE = /!canWrite\b|\bcanWrite \?|\bcanWrite &&/;

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (['.jsx', '.js'].includes(extname(p))) out.push(p);
  }
  return out;
}

const errors = [];
let files = 0;
let gated = 0;

for (const file of walk(ROOT)) {
  const lines = readFileSync(file, 'utf8').split('\n');
  if (!lines.some(l => l.includes('canWrite'))) continue;
  files++;

  // Attribute every line to the top-level function that owns it. `null` is
  // module scope — a `canWrite` there would be a genuine free variable.
  let scope = null;
  const declared = new Set();
  const used = new Map();

  for (const line of lines) {
    const fn = FN.exec(line);
    if (fn) scope = fn[1];
    if (DECL.test(line)) declared.add(scope);
    if (USE.test(line) && !used.has(scope)) used.set(scope, line.trim().slice(0, 60));
  }
  gated += declared.size;

  for (const [where, sample] of used) {
    if (declared.has(where)) continue;
    errors.push({
      // `relative`, not a string replace on `${ROOT}/` — the separator is a
      // backslash on Windows, so the replace matched nothing and every finding
      // printed its full absolute path.
      file: relative(ROOT, file).split('\\').join('/'),
      scope: where ?? '(module scope)',
      sample,
    });
  }
}

for (const e of errors) {
  console.error(`OUT OF SCOPE  ${e.file} — \`${e.scope}\` uses canWrite but never declares it`);
  console.error(`              ${e.sample}`);
}

console.log(
  `\ncheck-write-gates: ${gated} gated scope(s) across ${files} files, ` +
  `${errors.length} using a canWrite they do not declare.`
);

if (errors.length) {
  console.error(
    '\ncheck-write-gates: this is a ReferenceError at render, not a build error —\n' +
    'the component white-screens the first time someone opens it. Call\n' +
    '`useModuleWrite()` inside the component that owns the control.'
  );
  process.exit(1);
}
