/**
 * THE MODULES ARE ON THE UNIFIED TABLE.
 *
 * ── What this guards that tableSystem.test.jsx cannot ───────────────────────
 *
 * `tableSystem.test.jsx` reads the STYLESHEETS. It proves that whatever table
 * systems exist agree with each other about hover, zebra, the separator, the
 * head boundary and the frame. It cannot see which system a PAGE reaches for —
 * so a module could render a perfectly-converged `.k-modtable` and that file
 * would stay green while the page still showed the wrong head, the wrong
 * gutters and no frame at all.
 *
 * That is the gap this closes, for the three modules of this package: Graha
 * (eleven `<table>` literals), Dristi (ten, four of them hand-rolled in
 * PivotTab) and Prachar (nineteen, every one of them through `<DataTable>`).
 *
 * ── Why the assertions are about SOURCE, not about a render ─────────────────
 *
 * Rendering a Graha tab requires an org, a session, a router, nine API routes
 * and a toast provider. A test that mounts all that to discover a class name is
 * a test that breaks whenever any of those move, and it would still only cover
 * the branch that happened to render. Reading the JSX covers every branch,
 * including the ones behind an error state or an empty list — and the ones
 * behind an empty list are exactly where a stale class survives longest,
 * because nobody sees them.
 *
 * The trade is that a class assembled at runtime is invisible here. That is why
 * the FIRST test is a census: it fails if the number of `<table>` elements in a
 * module changes at all, so a table added tomorrow cannot quietly not be
 * checked by the tests below.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve, dirname, extname } from 'node:path';

const SRC = (() => {
  let dir = resolve(process.cwd());
  for (let i = 0; i < 6; i += 1) {
    if (existsSync(join(dir, 'src', 'styles', 'components.css'))) return join(dir, 'src');
    dir = dirname(dir);
  }
  throw new Error('src not found from ' + process.cwd());
})();

const MODULES = ['graha', 'dristi', 'prachar'];

function files(dir) {
  const out = [];
  const walk = (d) => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (['.jsx', '.js'].includes(extname(p))) out.push(p);
    }
  };
  walk(dir);
  return out;
}

/** Every source file of the three modules, plus the route file above each. */
const SOURCES = MODULES.flatMap((m) => {
  const dir = join(SRC, 'pages', m);
  const list = files(dir)
    /* `__tests__` under a module directory describes the module; it does not
       ship it, and a fixture is allowed to write whatever markup it likes. */
    .filter((p) => !p.replace(/\\/g, '/').includes('/__tests__/'));
  return list.map((p) => ({
    module: m,
    file: p.slice(SRC.length + 1).replace(/\\/g, '/'),
    text: readFileSync(p, 'utf8'),
  }));
});

/** `<table className="…">` — the opening tag and the class list it carries. */
const TABLES = SOURCES.flatMap((s) =>
  [...s.text.matchAll(/<table\b([^>]*)>/g)].map((m) => ({
    ...s,
    attrs: m[1],
    classes: (/className="([^"]*)"/.exec(m[1]) || [, ''])[1].split(/\s+/).filter(Boolean),
  })),
);

const line = (t) => `${t.file}  <table class="${t.classes.join(' ')}">`;

describe('every table these modules render is the unified one', () => {
  it('counts the tables, so a new one cannot skip the checks below', () => {
    // Graha 11 (Activities 1, Approvals 2, Clients 1, Contacts 1, Dedupe 2,
    // Documents 1, Reports 3), Dristi 2 (both in PivotTab — the other eight are
    // <DataTable>, counted by the adapter test below), Prachar 0 literals.
    const byModule = Object.fromEntries(
      MODULES.map((m) => [m, TABLES.filter((t) => t.module === m).length]),
    );
    expect(byModule).toEqual({ graha: 11, dristi: 2, prachar: 0 });
  });

  it('names .tbl on the <table> and never a module table system', () => {
    const wrong = TABLES.filter((t) => !t.classes.includes('tbl')).map(line);
    expect(wrong, wrong.join('\n')).toEqual([]);
  });

  it('has no `.gr__tbl` or `.k-modtable` left anywhere in the three modules', () => {
    // The two systems these modules used to render. `.gr__tbl` no longer exists
    // in any stylesheet, so a leftover here renders an UNSTYLED table rather
    // than a differently-styled one — check-classes would catch that, but only
    // after the class had already been reintroduced somewhere it has a rule.
    const dead = SOURCES.flatMap((s) =>
      [...s.text.matchAll(/className=[^\n]*?\b(gr__tbl|gr__tblwrap|k-modtable)\b/g)]
        .map((m) => `${s.file}  ${m[1]}`),
    );
    expect(dead, dead.join('\n')).toEqual([]);
  });

  it('wraps every table in .tbl__wrap, which is where the frame is', () => {
    // The audit's complaint about these modules was not the table — it was that
    // 30 of them had no container edge, because the frame was declared on
    // `.tbv` in boards.css and the wrapper here was either `.gr__tblwrap`
    // (whose `--bare` variant removed it on 7 of 11) or a classless
    // `style={{ overflowX: 'auto' }}` div. `.tbl__wrap` is the only element in
    // this build that plays both the reference's `.tbl` and its `.tbl__scroll`.
    const unwrapped = TABLES.filter((t) => {
      const before = t.text.slice(0, t.text.indexOf(t.attrs));
      const open = before.lastIndexOf('<div');
      return open < 0 || !/className="[^"]*\btbl__wrap\b/.test(before.slice(open));
    }).map(line);
    expect(unwrapped, unwrapped.join('\n')).toEqual([]);
  });

  it('never re-opens the escape hatches the old wrapper had', () => {
    // `--bare` (no frame) and `--raised` (a head strip, which `.tbl th` now
    // draws for every table) and `--sm` (a fifth font size, for three report
    // tables). A shared system exists to stop exactly these.
    const hatches = SOURCES.flatMap((s) =>
      [...s.text.matchAll(/\btbl(?:__wrap)?--(bare|raised|sm)\b/g)].map((m) => `${s.file}  ${m[0]}`),
    );
    expect(hatches, hatches.join('\n')).toEqual([]);
  });
});

describe('Dristi and Prachar reach the unified table through the shared adapter', () => {
  const adapters = MODULES.filter((m) => m !== 'graha').map((m) => ({
    module: m,
    file: `pages/${m}/_shared.jsx`,
    text: SOURCES.find((s) => s.file === `pages/${m}/_shared.jsx`).text,
  }));

  it.each(adapters.map((a) => a.module))(
    '%s/_shared.jsx re-exports DataTable and Td and declares neither',
    (module) => {
      const a = adapters.find((x) => x.module === module);
      expect(a.text).toMatch(
        /export\s*\{[^}]*\bDataTable\b[^}]*\}\s*from\s*'\.\.\/\.\.\/components\/ui\/moduleTable'/,
      );
      expect(a.text).toMatch(
        /export\s*\{[^}]*\bTd\b[^}]*\}\s*from\s*'\.\.\/\.\.\/components\/ui\/moduleTable'/,
      );
      /* THE HALF THAT MATTERS. Both files held their own copy of these two
         functions until 2026-09-03, byte-identical, each with a note saying the
         other package's page code could not be imported — which was true, and
         is why neither considered the third home both already imported from.
         A re-declaration here puts the copies back. */
      expect(a.text).not.toMatch(/export function DataTable\(/);
      expect(a.text).not.toMatch(/export function Td\(/);
    },
  );

  it('the shared adapter is the one that renders the unified table', () => {
    // Anti-vacuity for the two assertions above: they check where these modules
    // get `DataTable` from, and would both stay green if that module rendered
    // anything at all. This is the assertion about what it actually renders.
    const shared = readFileSync(join(SRC, 'components', 'ui', 'moduleTable.jsx'), 'utf8');
    expect(shared).toMatch(/from '\.\/Table'/);
    expect(shared).toMatch(/export function DataTable\(/);
    expect(shared).toMatch(/export function Td\(/);
  });

  it('leaves no tab importing DataTable or Td from the editorial barrel', () => {
    // This is the whole migration, in one assertion: the barrel's `DataTable`
    // renders `.k-modtable` inside a classless div, so a single tab that still
    // imports it puts one page of each module back on the old system while
    // every other page moved. Nineteen Prachar tables and eight Dristi ones sit
    // behind this import.
    const stale = SOURCES.filter((s) =>
      /import\s*\{[^}]*\b(DataTable|Td)\b[^}]*\}\s*from\s*'\.\.\/\.\.\/components\/editorial'/.test(s.text),
    ).map((s) => s.file);
    expect(stale, stale.join('\n')).toEqual([]);
  });

  it('every tab that uses <DataTable> imports it from ./_shared', () => {
    // `_shared.jsx` is the adapter itself; its prose names `<DataTable>`.
    const users = SOURCES.filter(
      (s) => /<DataTable\b/.test(s.text) && !s.file.endsWith('/_shared.jsx'),
    );
    expect(users.length).toBeGreaterThan(0);
    const bad = users
      .filter((s) => !/import\s*\{[^}]*\bDataTable\b[^}]*\}\s*from\s*'\.\/_shared'/.test(s.text))
      .map((s) => s.file);
    expect(bad, bad.join('\n')).toEqual([]);
  });
});

describe('the cell vocabulary survives .tbl\'s own specificity', () => {
  /* Parse the stylesheets the same way tableSystem.test.jsx does. */
  const RULES = [];
  const walkCss = (dir) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walkCss(p);
      else if (extname(p) === '.css') {
        const body = readFileSync(p, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
        for (const block of body.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
          const decls = {};
          for (const d of block[2].split(';')) {
            const i = d.indexOf(':');
            if (i > 0) decls[d.slice(0, i).trim().toLowerCase()] = d.slice(i + 1).trim();
          }
          for (const sel of block[1].split(',')) {
            const s = sel.trim().replace(/\s+/g, ' ');
            if (s) RULES.push({ sel: s, decls, file: p.slice(SRC.length + 1).replace(/\\/g, '/') });
          }
        }
      }
    }
  };
  walkCss(join(SRC, 'styles'));

  /** Properties `.tbl th, .tbl td` states itself, at (0,1,1). */
  const CLAIMED = Object.keys(
    RULES.find((r) => r.sel === '.tbl td' && r.decls['text-align'])?.decls
    ?? RULES.find((r) => r.sel === '.tbl th')?.decls
    ?? {},
  );

  it('.tbl states text-align on its cells, which is what makes this necessary', () => {
    // If this ever stops being true the rest of this block is dead weight and
    // should go — but while it IS true, a (0,1,0) class cannot change a cell's
    // alignment or padding no matter which stylesheet loads last.
    expect(CLAIMED).toContain('text-align');
    expect(CLAIMED).toContain('padding');
  });

  it('.tbl__num actually right-aligns', () => {
    // It did not, for as long as it has existed: `.tbl__num` is (0,1,0) and
    // `.tbl th, .tbl td { text-align: left }` is (0,1,1), so every numeric
    // column in the build — ganit/BankTab's Amount, the four in
    // ganit/ExpensesTab, and now the 46 Dristi and Prachar cells that reach it
    // through `<Td align="right">` — rendered LEFT-aligned. The mono and the
    // tabular figures landed, which is why it looked deliberate.
    const right = RULES.filter(
      (r) => /\.tbl__num\b/.test(r.sel) && r.decls['text-align'] === 'right',
    );
    expect(right.length, 'nothing right-aligns .tbl__num').toBeGreaterThan(0);
    // …and it has to be stated at (0,2,1) or better, i.e. qualified by `.tbl`
    // AND an element, or it loses again.
    const wins = right.some((r) => /\.tbl\b/.test(r.sel) && /\b(td|th)\b/.test(r.sel));
    expect(wins, right.map((r) => `${r.file}  ${r.sel}`).join('\n')).toBe(true);
  });

  it.each(['gr__td--mid', 'gr__none'])(
    '.%s carries its element, so it outranks .tbl td',
    (cls) => {
      const rules = RULES.filter((r) => new RegExp(`\\.${cls}(?![\\w-])`).test(r.sel));
      expect(rules.length, `.${cls} has no rule`).toBeGreaterThan(0);
      const qualified = rules.every((r) => /\b(td|th)\./.test(r.sel));
      expect(qualified, rules.map((r) => `${r.file}  ${r.sel}`).join('\n')).toBe(true);
    },
  );

  it('the module cell classes that DO win are the ones that claim nothing .tbl claims', () => {
    // The other six `.gr__td--*` are left bare on purpose — adding `td` to a
    // rule that only sets `color` would be noise pretending to be rigour. This
    // fails if one of them grows a property `.tbl` also states.
    const bare = RULES.filter((r) => /^\.gr__td--/.test(r.sel));
    expect(bare.length).toBeGreaterThan(0);
    const collisions = bare
      .filter((r) => Object.keys(r.decls).some((p) => CLAIMED.includes(p)))
      .map((r) => `${r.file}  ${r.sel}  {${Object.keys(r.decls).join(', ')}}`);
    expect(collisions, collisions.join('\n')).toEqual([]);
  });
});

describe('the frame is drawn once per table, in these modules too', () => {
  it('is reset inside Dristi\'s card body, where the card is already the frame', () => {
    // Every Dristi table is inside `<Panel>` → `.dcard`, which is bordered. The
    // reference does the same: ScreensThin.jsx puts the pivot in `<Card flush>`
    // and the table carries no frame of its own.
    const files = readdirSync(join(SRC, 'styles'))
      .filter((f) => extname(f) === '.css')
      .map((f) => readFileSync(join(SRC, 'styles', f), 'utf8'));
    expect(files.some((t) => /\.dcard__b \.tbl__wrap/.test(t))).toBe(true);
  });

  it('is NOT reset for Prachar, whose tables sit on the page ground', () => {
    // The opposite failure, and the one the audit actually reported: nineteen
    // Prachar tables with no container edge. Nothing may quietly re-flatten
    // them — a `.pr__*` ancestor reset here would do it to all nineteen.
    const prachar = readFileSync(join(SRC, 'styles', 'prachar.css'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '');
    const resets = [...prachar.matchAll(/([^{}]*\.tbl__wrap[^{}]*)\{([^{}]*)\}/g)]
      .filter((m) => /border\s*:\s*(0|none)/.test(m[2]))
      .map((m) => m[1].trim());
    expect(resets, resets.join('\n')).toEqual([]);
  });
});
