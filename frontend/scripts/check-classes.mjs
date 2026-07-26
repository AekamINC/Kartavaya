/**
 * check-classes.mjs — every className in JSX asserted against every selector in
 * CSS, reported in both directions.
 *
 * From `design-handover/25-qa-acceptance.md` §1, which specifies the behaviour
 * but not the script. The two failures it exists to catch:
 *
 *   · A class used in markup with no CSS rule renders unstyled. `btn--pri` was
 *     demonstrated in the component inventory and defined in no stylesheet, so
 *     primary and secondary buttons were visually identical. `.btn--ghost`,
 *     `.two--wide` and `.note` were the same bug.
 *   · A rule with no user is dead weight the next person preserves out of
 *     caution, because they cannot prove it is unused.
 *
 * The two are not equally severe, so they exit differently:
 *   MISSING RULE  → fails the build. It is a visible defect.
 *   UNUSED RULE   → reported only. Dead CSS costs bytes and confidence, not
 *                   correctness, and a false positive here is easy to hit.
 *
 * Honest limits. This reads static strings; it cannot resolve a class assembled
 * at runtime. Rather than weaken the match — which would let real misses through
 * — genuinely dynamic names are allow-listed below, and any class built by
 * interpolation is skipped with its static prefix recorded. If you add a
 * computed class, add its prefix to DYNAMIC.
 *
 * Usage: node scripts/check-classes.mjs
 */
import { readFileSync, readdirSync, existsSync, statSync } from 'fs';
import { join, extname } from 'path';

const STYLE_DIR = 'src/styles';
const SRC_DIR = 'src';

/**
 * Classes whose full name never appears in source. Prefix match.
 * `is-*` and `on` are state flags toggled from JS; the rest are library or
 * runtime-composed names.
 */
const DYNAMIC = [
  'is-', 'on', 'off', 'active', 'open', 'sr-only',
  'k-theme-', 'data-', 'v-', 'ix-',
];

/** Selectors that exist for third-party or generated markup. */
const EXTERNAL = ['ProseMirror', 'ql-', 'rbd-', 'recharts', 'react-'];

/**
 * Tailwind is in the build (`tailwindcss` in package.json, `postcss.config.cjs`),
 * so its utilities are generated at build time and never appear in
 * src/styles/*.css. Without this, the check reported 45 phantom misses across
 * Breadcrumbs, Tooltip and EmptyState — three files that render correctly.
 *
 * This is the one place the check trades precision for usefulness: a real miss
 * whose name happens to look like a Tailwind utility will be allowed through.
 * The alternative was 45 false positives, which gets the whole check switched
 * off. The proper fix is to finish migrating these three components off Tailwind
 * — START-HERE names it as one of three token vocabularies still to converge —
 * and then delete this list.
 */
const TAILWIND = [
  'flex', 'inline-flex', 'grid', 'inline-grid', 'block', 'inline-block', 'inline',
  'hidden', 'table', 'contents', 'relative', 'absolute', 'fixed', 'sticky', 'static',
  'items-', 'justify-', 'self-', 'content-', 'place-', 'order-', 'flex-', 'grow', 'shrink',
  'basis-', 'gap-', 'space-', 'divide-',
  'p-', 'px-', 'py-', 'pt-', 'pr-', 'pb-', 'pl-',
  'm-', 'mx-', 'my-', 'mt-', 'mr-', 'mb-', 'ml-', 'mx-auto',
  'w-', 'h-', 'min-w-', 'min-h-', 'max-w-', 'max-h-', 'size-',
  'text-', 'font-', 'leading-', 'tracking-', 'align-', 'whitespace-', 'break-', 'truncate',
  'uppercase', 'lowercase', 'capitalize', 'underline', 'line-through', 'no-underline',
  'bg-', 'border', 'border-', 'rounded', 'rounded-', 'outline-', 'ring-', 'shadow', 'shadow-',
  'opacity-', 'z-', 'overflow-', 'cursor-', 'select-', 'pointer-events-',
  'transition', 'transition-', 'duration-', 'ease-', 'animate-', 'transform', 'scale-',
  'rotate-', 'translate-', 'list-', 'appearance-', 'resize', 'sr-only', 'not-sr-only',
  'top-', 'right-', 'bottom-', 'left-', 'inset-', 'aspect-', 'object-', 'fill-', 'stroke-',
  // tailwindcss-animate
  'fade-in', 'fade-out', 'zoom-in', 'zoom-out', 'slide-in-', 'slide-out-', 'spin-', 'pulse',
];

/** Tailwind variants carry a colon (`hover:text-accent`, `md:flex`). */
const isTailwind = (cls) =>
  cls.includes(':') || cls.includes('[') || TAILWIND.some((p) => cls === p || cls.startsWith(p));

function walk(dir, exts, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, exts, out);
    else if (exts.includes(extname(entry))) out.push(full);
  }
  return out;
}

function stripComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

/**
 * A CSS class, not a fragment of the expression it was extracted from. Guards
 * against operators and leftovers that survive interpolation-stripping.
 */
function isPlausibleClass(s) {
  return /^-?[A-Za-z_][\w-]*$/.test(s);
}

if (!existsSync(STYLE_DIR)) {
  console.error(`check-classes: ${STYLE_DIR} not found — run from the frontend/ directory.`);
  process.exit(1);
}

const css = stripComments(
  readdirSync(STYLE_DIR)
    .filter((f) => f.endsWith('.css'))
    .map((f) => readFileSync(join(STYLE_DIR, f), 'utf8'))
    .join('\n')
);

// Every .foo in a selector position. Excludes decimals in values (`.5rem`) by
// requiring the first character after the dot to be a letter, _ or -.
const defined = new Set([...css.matchAll(/\.(-?[A-Za-z_][\w-]*)/g)].map((m) => m[1]));

const jsxFiles = walk(SRC_DIR, ['.jsx', '.js']).filter((f) => !f.includes('__tests__'));
const used = new Map();          // class -> first file that uses it
const dynamicPrefixes = new Set();

for (const file of jsxFiles) {
  const text = stripComments(readFileSync(file, 'utf8'));

  // className="a b c"  |  className='a b'
  for (const m of text.matchAll(/className\s*=\s*["']([^"']+)["']/g)) {
    for (const cls of m[1].split(/\s+/).filter(Boolean)) {
      if (!used.has(cls)) used.set(cls, file);
    }
  }

  // className={...} — static literals and template chunks. Interpolations are
  // cut out BEFORE splitting, otherwise the expression inside `${…}` is read as
  // a list of class names and the report fills with `.===` and `.?`.
  for (const m of text.matchAll(/className\s*=\s*\{([^}]*(?:\{[^}]*\}[^}]*)*)\}/g)) {
    const expr = m[1];

    // Template literals: record the fragment immediately before each `${` as a
    // dynamic prefix (`k-due--done${flush…}` means `.k-due--done` plus suffixes
    // built at runtime), then drop the interpolation.
    for (const tpl of expr.matchAll(/`([^`]*)`/g)) {
      const raw = tpl[1];
      for (const seg of raw.matchAll(/([\w-]*)\$\{/g)) {
        if (seg[1]) dynamicPrefixes.add(seg[1]);
      }
      for (const cls of raw.replace(/\$\{[^}]*\}/g, ' ').split(/\s+/).filter(Boolean)) {
        if (isPlausibleClass(cls) && !used.has(cls)) used.set(cls, file);
      }
    }

    // Plain quoted strings inside the expression (ternary branches, clsx args).
    //
    // Two kinds of string in here are not class names, and both produced noise:
    //
    //   · Comparison operands. `className={'gr__export-btn--pdf' + (busy ===
    //     'pdf' ? ' is-busy' : '')}` contains 'pdf' as a value being compared,
    //     not a class. Stripped before extraction.
    //   · Concatenation prefixes. `'k-inboxkind--' + Object.keys(…)` builds the
    //     name at runtime; the stem never renders bare. A quoted string ending
    //     in `-` is recorded as a prefix instead of a class.
    //
    // Template interpolation is handled above, but `+` concatenation is just as
    // common here, so this cannot key off `${` alone.
    const noComparisons = expr.replace(/[!=]==?\s*["'][^"']*["']/g, ' ');
    if (!noComparisons.includes('${')) {
      for (const lit of noComparisons.matchAll(/["']([^"']*)["']/g)) {
        const raw = lit[1];
        if (/[\w]-+$/.test(raw.trimEnd())) {
          dynamicPrefixes.add(raw.trim().split(/\s+/).pop());
        }
        for (const cls of raw.split(/\s+/).filter(Boolean)) {
          if (isPlausibleClass(cls) && !used.has(cls)) used.set(cls, file);
        }
      }
    }
  }
}

const allowed = (cls) =>
  DYNAMIC.some((p) => cls === p || cls.startsWith(p)) ||
  EXTERNAL.some((p) => cls.startsWith(p)) ||
  isTailwind(cls) ||
  [...dynamicPrefixes].some((p) => cls.startsWith(p));

// A recorded dynamic prefix is the stem of a runtime-composed name
// (`k-inboxkind--${kind}`), not a class in its own right — it has no rule
// because nothing ever renders it bare.
const missing = [...used].filter(
  ([cls]) => !defined.has(cls) && !allowed(cls) && !dynamicPrefixes.has(cls)
);
const unused = [...defined].filter(
  (cls) => !used.has(cls) && !allowed(cls) && ![...dynamicPrefixes].some((p) => cls.startsWith(p))
);

for (const [cls, file] of missing) {
  console.error(`MISSING RULE  .${cls}  — used in ${file.replace(/\\/g, '/')}`);
}

// The unused direction is real signal but not yet trustworthy enough to print
// by default: `.woff2`, `.w3`, `.googleapis` and `.css` are fragments of url()
// values and @font-face src, not selectors, and many k-* entries are composed
// at runtime in ways the static scan cannot follow. Printing 482 entries with
// obvious artifacts in them teaches people to skim past the 15 that matter.
// Opt in with CHECK_CLASSES_UNUSED=1 when doing a deliberate dead-CSS sweep.
if (unused.length) {
  if (process.env.CHECK_CLASSES_UNUSED === '1') {
    console.log(`\ncheck-classes: ${unused.length} selectors with no static user (reported, not fatal):`);
    console.log('  ' + unused.sort().join(', '));
  } else {
    console.log(
      `\ncheck-classes: ${unused.length} selectors have no static user. ` +
      `Set CHECK_CLASSES_UNUSED=1 to list them (expect url()/@font-face artifacts).`
    );
  }
}

console.log(
  `\ncheck-classes: ${defined.size} selectors defined, ${used.size} classes used, ` +
  `${missing.length} missing a rule.`
);

if (missing.length) {
  console.error(
    '\ncheck-classes: a class with no rule renders unstyled. Add the rule, or remove the class.'
  );
  // Blocking. This was report-only for exactly one commit, while the 15
  // pre-existing misses it found were cleared; it reported zero immediately
  // after, so the gate went up rather than becoming a warning people scroll past.
  process.exit(1);
}
