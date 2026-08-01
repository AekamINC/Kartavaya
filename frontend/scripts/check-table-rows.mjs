/**
 * check-table-rows — every table in the product uses the same row height.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 *
 * Row height was raised once and swept by hand. The sweep found `.tbl`,
 * `.k-modtable`, `.omt`, `.amx` and `.gr__tbl` because those were the families
 * a particular grep happened to match, and missed the rest — so the payroll
 * breakdown, the pivot and three Vikray tables kept a hand-written padding and
 * stayed visibly tighter than everything around them. That was reported from a
 * screenshot, which is the expensive way to find it.
 *
 * A grep finds what you thought of. This starts from the JSX instead: every
 * `<table className=…>` that ships, then asks whether that class has a CSS rule
 * putting its cells on `var(--row-h)`. A new table added next month fails here
 * on the first run rather than on someone's screen.
 *
 * ── Opting out ──────────────────────────────────────────────────────────────
 *
 * A table that genuinely should not follow the token names itself in EXEMPT
 * below, with the reason. The access matrix is the real case: it is a grid of
 * checkmarks read across and down, not a list of records, and a 66px row pushes
 * its far columns off screen.
 *
 * Run: node scripts/check-table-rows.mjs
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const SRC = new URL('../src', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

/** class -> why it is allowed to set its own row height. */
const EXEMPT = {
  amx: 'access matrix — a grid of checkmarks, not a list of records; a 66px row pushes its far columns off screen',
};

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

const files = walk(SRC);
const jsx = files.filter(f => /\.(jsx?|tsx?)$/.test(f) && !/__tests__/.test(f));
const css = files.filter(f => extname(f) === '.css');

/* Every class that appears on a <table>. Template literals are included: the
   conditional half is dropped and the static prefix kept, which is what
   `<table className={`tbl ${x}`}>` actually ships. */
/* Keyed by the WHOLE class list, not by each class. `<table className="tbl
   vk-stk">` inherits the token from `.tbl`; checking each name separately
   reported `.vk-stk` as broken when the table on screen was fine. A table
   passes if ANY of its classes puts cells on the token. */
const tables = new Map(); // "cls cls" -> Set(file)
for (const f of jsx) {
  const text = readFileSync(f, 'utf8');
  for (const m of text.matchAll(/<table[^>]*className=\{?[`"']([^`"'{]+)/g)) {
    const list = m[1].trim().split(/\s+/).filter(c => c && !c.startsWith('$'));
    if (!list.length) continue;
    const key = list.join(' ');
    if (!tables.has(key)) tables.set(key, new Set());
    tables.get(key).add(f.slice(SRC.length + 1));
  }
}

const allCss = css.map(f => readFileSync(f, 'utf8')).join('\n');

/* Rules are PARSED, not pattern-matched.
   The first version of this used one regex over the whole stylesheet and it was
   wrong in both directions: `[^{]*` ran across rule boundaries, so it paired a
   selector with a later rule's declarations, and a bare `height:` also matched
   `max-height:`. It reported `.gr__tbl overrides cell height with var(--row-h)`
   — the token, named as an override of itself — and `calc(100vh - 280px)` from
   an unrelated `.tbl__wrap` rule. A check that lies is worse than no check. */
const RULES = [];
for (const text of css.map(f => readFileSync(f, 'utf8'))) {
  const body = text.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const m of body.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const decls = {};
    for (const d of m[2].split(';')) {
      const i = d.indexOf(':');
      if (i < 0) continue;
      decls[d.slice(0, i).trim().toLowerCase()] = d.slice(i + 1).trim();
    }
    for (const sel of m[1].split(',')) {
      const s = sel.trim().replace(/\s+/g, ' ');
      if (s) RULES.push({ sel: s, decls });
    }
  }
}

/** Rules whose selector targets a td/th inside `.cls`. */
const cellRules = cls => RULES.filter(r =>
  new RegExp(`(^|[\\s>+~])\\.${cls.replace(/[-[\]{}()*+?.,\\^$|#]/g, '\\$&')}([\\s.:[>+~]|$)`).test(r.sel)
  && /\b(td|th)\b/.test(r.sel));

/** Does some rule put THIS class's cells on the row token? */
function usesToken(cls) {
  return cellRules(cls).some(r => /var\(--row-h\)/.test(r.decls.height || ''));
}

/* A class that sets a cell height to something OTHER than the token. This is
   the failure that actually shipped: `.vk-tg td { height: auto }` silently
   undid the token its own table inherited from `.tbl`. Inheriting the right
   value and then overriding it looks correct in every grep. */
function overridesToken(cls) {
  for (const r of cellRules(cls)) {
    const h = r.decls.height;
    // `thead th` is allowed its own, shorter height — a header is not a row.
    if (!h || /var\(--row-h\)/.test(h) || /\bthead\b|\bth\b(?!.*\btd\b)/.test(r.sel)) continue;
    return `${h}  (${r.sel})`;
  }
  return null;
}

const missing = [];
for (const [key, where] of [...tables].sort()) {
  const list = key.split(' ');
  if (list.some(c => EXEMPT[c])) continue;
  if (!list.some(usesToken)) { missing.push({ key, where: [...where], why: 'no class puts its cells on var(--row-h)' }); continue; }
  for (const c of list) {
    const bad = overridesToken(c);
    if (bad) { missing.push({ key, where: [...where], why: `.${c} overrides cell height with \`${bad}\`` }); break; }
  }
}

if (missing.length) {
  console.error('Tables not on var(--row-h):\n');
  for (const m of missing) {
    console.error(`  <table class="${m.key}">  — ${m.why}`);
    for (const w of m.where) console.error(`      ${w}`);
  }
  console.error(`\n${missing.length} table${missing.length > 1 ? 's' : ''} set their own row height.`);
  console.error('Put their cells on `height: var(--row-h)`, or add them to EXEMPT with a reason.');
  process.exit(1);
}

console.log(`${tables.size} table classes checked, all on var(--row-h)` +
  (Object.keys(EXEMPT).length ? ` (${Object.keys(EXEMPT).length} exempt)` : ''));
