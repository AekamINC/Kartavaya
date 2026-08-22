/**
 * check-class-collisions.mjs — one class name, two different intents, is a bug.
 *
 * WHY THIS EXISTS
 * ---------------
 * The owner reported that every dropdown in the task drawer showed no value.
 * The value was in the DOM and correctly coloured; the label span was simply
 * ZERO PIXELS WIDE. Measured in a real browser, the chevron beside it was
 * 141px of a 165px button — an 11px icon, thirteen times its size.
 *
 * `Picker.jsx` rendered the chevron as `<svg class="ch">`, and `components.css`
 * said `.pk__tr .ch { flex: none }` — a CHILD of the picker button, no width.
 * Meanwhile `sanvaad.css` said:
 *
 *     .ch { display: flex; width: 100%; padding: 9px 13px; ... }
 *
 * — a BLOCK, for a channel row that no longer exists (that component moved to
 * `m2row` and its CSS was left behind). Two sheets, two meanings, one global
 * name. Nothing in the picker's rules contested `width`, so the stale block
 * rule won it. Three shared components used that class, so this broke every
 * picker and every table sort header in the product at once.
 *
 * WHAT IT DETECTS
 * ---------------
 * A class declared as a BLOCK in one stylesheet (`.name { }` — nothing to its
 * left) and as a CHILD in another (`.owner .name { }`). Those are two claims
 * about what the name means, and they cannot both hold.
 *
 * This is deliberately NOT "two sheets mention the class". `.bd` is a block in
 * boards.css and only ever a block, so it is silent — testing intent rather
 * than co-occurrence is what keeps the signal usable.
 *
 * Namespaced names are skipped: `bsh__grab` has one plausible owner however
 * many sheets mention it. The prefix IS the namespace, and that convention
 * working is not a finding.
 *
 * BASELINE
 * --------
 * Pre-existing conflicts go in KNOWN, named rather than counted, so this gates
 * what is added from today. Removing an entry is the fix.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'src');
const STYLES = path.join(SRC, 'styles');

/** `bsh__grab`, `k-btn` and anything long enough to be deliberate. */
const isNamespaced = (cls) =>
  cls.includes('__') || cls.includes('--') || cls.startsWith('k-') || cls.length > 6;

/** Conflicts that predate this gate. Each named, so each can be argued about. */
const KNOWN = new Set([
  // 'name'
]);

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

/** Strip comments and strings so a selector scan cannot read their contents.
 *  A comment once cost this repo an unrelated rule; selectors are read from
 *  scrubbed text only. */
function scrub(css) {
  return css
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''");
}

const BLOCK = /^\.([A-Za-z_][\w-]*)(?:[:.][\w-()]+)*$/;
const CHILD = /[\s>+~]\.([A-Za-z_][\w-]*)(?:[:.][\w-()]+)*$/;

const asBlock = new Map();   // class -> Set(sheet)
const asChild = new Map();   // class -> Set(sheet)
const add = (map, cls, sheet) => {
  if (!map.has(cls)) map.set(cls, new Set());
  map.get(cls).add(sheet);
};

for (const file of walk(STYLES)) {
  if (!file.endsWith('.css')) continue;
  const sheet = path.basename(file);
  const css = scrub(fs.readFileSync(file, 'utf8'));

  // Selector positions only: the text before a `{` at brace depth 0.
  let depth = 0;
  let buf = '';
  for (const chunk of css.split(/([{}])/)) {
    if (chunk === '{') {
      if (depth === 0) {
        for (const sel of buf.split(',')) {
          const s = sel.trim();
          if (!s || s.startsWith('@')) continue;
          const b = s.match(BLOCK);
          if (b) { add(asBlock, b[1], sheet); continue; }
          const c = s.match(CHILD);
          if (c) add(asChild, c[1], sheet);
        }
      }
      depth++;
      buf = '';
    } else if (chunk === '}') {
      depth = Math.max(0, depth - 1);
      buf = '';
    } else if (depth === 0) {
      buf = chunk;
    }
  }
}

/** Which component renders it, for the error message. */
const renderedBy = new Map();
for (const file of walk(path.join(SRC, 'components'))) {
  if (!/\.(jsx|js)$/.test(file)) continue;
  const src = fs.readFileSync(file, 'utf8');
  for (const m of src.matchAll(/className\s*=\s*"([^"]+)"/g)) {
    for (const cls of m[1].split(/\s+/).filter(Boolean)) {
      if (!renderedBy.has(cls)) renderedBy.set(cls, path.relative(ROOT, file));
    }
  }
}

/**
 * DIRECTION MATTERS, and it is the whole difference between a convention and
 * a bug.
 *
 *   HEALTHY   `.btn` is a BLOCK in components.css and a CHILD in ganit.css:
 *             a shared component that a page scopes. That is the design system
 *             working, and there are dozens of them.
 *
 *   BROKEN    `.ch` was a BLOCK in sanvaad.css and a CHILD in components.css:
 *             a PAGE claimed a bare global name that a SHARED component was
 *             already using as a part. The page rule then applied inside a
 *             component that had never heard of it.
 *
 * So the finding is a block declared in a page sheet whose name a shared sheet
 * treats as a child.
 */
const SHARED_SHEETS = new Set([
  'components.css', 'brand.css', 'editorial.css', 'base.css', 'tokens.css',
  'utilities.css', 'animations.css', 'mobile-responsive.css',
]);

const hits = [];
for (const [cls, blockSheets] of asBlock) {
  if (isNamespaced(cls) || KNOWN.has(cls)) continue;
  const kidSheets = asChild.get(cls);
  if (!kidSheets) continue;
  // One sheet doing both is an author being consistent with themselves.
  const elsewhere = [...kidSheets].filter((s) => !blockSheets.has(s));
  if (elsewhere.length === 0) continue;
  // The block must be claimed by a PAGE, and used as a part by a SHARED sheet.
  const blockIsPageOnly = [...blockSheets].every((s) => !SHARED_SHEETS.has(s));
  const childIsShared = elsewhere.some((s) => SHARED_SHEETS.has(s));
  if (!blockIsPageOnly || !childIsShared) continue;
  hits.push({
    cls,
    blockIn: [...blockSheets].sort().join(', '),
    childIn: elsewhere.sort().join(', '),
    user: renderedBy.get(cls) || '(no literal className found)',
  });
}

if (hits.length === 0) {
  console.log(
    `check-class-collisions: ${asBlock.size} block names, ${asChild.size} ` +
    'child names, 0 claimed as both.');
  process.exit(0);
}

console.error('\ncheck-class-collisions: a class is a BLOCK in one stylesheet and a');
console.error('CHILD of something else in another. Both cannot be true, and whichever');
console.error('sets a property the other does not contest wins in silence.\n');
for (const h of hits) {
  console.error(`  .${h.cls}`);
  console.error(`      a BLOCK in   src/styles/${h.blockIn}`);
  console.error(`      a CHILD in   src/styles/${h.childIn}`);
  console.error(`      rendered by  ${h.user}`);
  console.error('      fix: namespace one of them. Do NOT delete a rule by selector');
  console.error('           match — that is how the .side rule was lost once.\n');
}
process.exit(1);
