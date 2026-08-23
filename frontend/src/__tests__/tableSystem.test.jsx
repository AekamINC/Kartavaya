/**
 * ONE TABLE SYSTEM.
 *
 * ── What this is guarding ───────────────────────────────────────────────────
 *
 * The audit reported "two table systems side by side". There were four generic
 * ones — `.tbl` (14 `<table>` literals), `.k-modtable` (54 sites, nearly all of
 * them reached through `<DataTable>` in `editorial/ModuleUI.jsx`), `.gr__tbl`
 * (11, Graha) and `.k-trow` (the div-grid task list) — plus `.omt` in the org
 * settings. They did not diverge on everything. They diverged on five things,
 * and every one of the eleven audit lines about tables is one of those five
 * seen from a different page:
 *
 *   · the container frame        — declared only for `.tbv`, so eight
 *                                  Ganit/Vikray/Manav tables had no edge
 *   · zebra striping             — absent from every table in the build
 *   · the selected-row tint      — right on `.tbl`, absent on `.k-trow`
 *   · the row hover colour       — THREE distinct computed values
 *   · the row separator weight   — `--rule-soft`, an exact alias of `--rule`,
 *                                  at 1/0.55 = 1.82× the reference
 *
 * A comment saying "one table system" is not a check. This is. It walks the
 * shipped stylesheets, finds every rule that styles a table row, and fails if
 * two of them disagree about hover, about the separator, or about the head
 * boundary. The next person who adds `.foo tbody tr:hover { background: … }`
 * finds out here rather than in a screenshot six weeks later.
 *
 * ── Why it discovers rather than lists ──────────────────────────────────────
 *
 * A hardcoded list of four prefixes is a list of the four somebody thought of.
 * `.k-modtable` — the LARGEST of the systems — is invisible to a grep of the
 * module pages, because Prachar has zero `<table>` literals of its own: they
 * all come out of one shared component. So the systems are derived from the CSS
 * itself: a table system is any class whose CELLS are put on `var(--row-h)`.
 * That is the same signal `scripts/check-table-rows.mjs` enforces, so a table
 * cannot be in the product, pass that gate, and be invisible to this one.
 *
 * The div-grid rows cannot be found that way — they have no `<td>` — so they
 * are named, with the rule for what belongs on the list. `.docrow` (E-Sign) and
 * `.aut-multi` also carry `min-height: var(--row-h)` and are NOT here: they are
 * row lists, not tables. When E-Sign's document list becomes the five-column
 * table the reference specifies (`ScreensMore.jsx:337`), `.docrow` joins.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, extname, resolve, dirname } from 'node:path';

/* `import.meta.url` is not a file: URL under the vitest transform, so the
   stylesheet root is found by walking up from the working directory instead. */
const SRC = (() => {
  let dir = resolve(process.cwd());
  for (let i = 0; i < 6; i += 1) {
    if (existsSync(join(dir, 'src', 'styles', 'components.css'))) return join(dir, 'src');
    dir = dirname(dir);
  }
  throw new Error('src/styles not found from ' + process.cwd());
})();

/** Div-grid table systems: a row that is a `<div>`/`<button>` grid, not a
 *  `<tr>`. Nothing here can be discovered from `td`/`th` rules. */
const DIV_GRID_SYSTEMS = ['k-trow'];

/** The values the prototype states. Quoted from the reference stylesheet, which
 *  is the specification — `design-reference/Kartavaya Redesign/app.css`. */
const REFERENCE = {
  rule: '1px solid color-mix(in srgb, var(--outline-variant) 55%, transparent)', // app.css:183
  headRule: '1px solid var(--outline-variant)',                                  // app.css:182
  zebra: 'color-mix(in srgb, var(--s-low) 50%, transparent)',                    // app.css:184
  hover: 'var(--s-container)',                                                   // app.css:185
  on: 'var(--primary-container)',                                                // app.css:186
};

// ── Parse ────────────────────────────────────────────────────────────────────
// Same shape as check-table-rows.mjs: strip comments, then match innermost
// declaration blocks only. `[^{}]+\{[^{}]*\}` cannot match an at-rule wrapper,
// because the wrapper's body contains a `{` the declaration group excludes — so
// `@media … { .a { … } }` yields `.a` with the right body. Selector lists are
// split on commas and each branch carries the same declarations, which is what
// makes a grouped rule count once per system rather than once per rule.
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

const RULES = [];
for (const file of walk(SRC).filter(f => extname(f) === '.css')) {
  const body = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const rel = file.slice(SRC.length + 1).replace(/\\/g, '/');
  for (const block of body.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const decls = {};
    for (const d of block[2].split(';')) {
      const i = d.indexOf(':');
      if (i < 0) continue;
      decls[d.slice(0, i).trim().toLowerCase()] = d.slice(i + 1).trim().replace(/\s+/g, ' ');
    }
    for (const sel of block[1].split(',')) {
      const s = sel.trim().replace(/\s+/g, ' ');
      if (s) RULES.push({ sel: s, decls, file: rel });
    }
  }
}

const targets = (sel, cls) =>
  new RegExp(`\\.${cls.replace(/[-[\]{}()*+?.,\\^$|#]/g, '\\$&')}(?![\\w-])`).test(sel);

/** Every class whose cells are on the row token — i.e. every `<table>` system
 *  that ships. */
const TABLE_SYSTEMS = [...new Set(
  RULES.filter(r => /var\(--row-h/.test(r.decls.height || '') && /\b(td|th)\b/.test(r.sel))
    .flatMap(r => [...r.sel.matchAll(/\.([a-zA-Z_][\w-]*)/g)].map(m => m[1])),
)].sort();

const SYSTEMS = [...TABLE_SYSTEMS, ...DIV_GRID_SYSTEMS];

/** Rules that style a ROW of some system. A rule about a cell's contents
 *  (`.k-trow__title`) or about a descendant control (`.k-trow__actions`) is not
 *  a row rule — `(?![\w-])` is what keeps BEM children out. */
const rowRules = RULES.filter(r => SYSTEMS.some(s => targets(r.sel, s)));

/** A separator declaration that actually draws a line. `0` and `none` are the
 *  last-row resets, which are correct and are not a second opinion. */
const drawsALine = v => v && !/^(0|none|0px)$/.test(v.trim());

const bg = d => d.background || d['background-color'];

/** A row-state background, not something painted on a descendant of the row.
 *  Only the LAST compound of the selector counts: `.k-trow:hover` is the row,
 *  `.k-trow:hover .k-trow__actions` is the hover-revealed action tray — which
 *  restates the row's background as a gradient mask and would otherwise read as
 *  a second opinion about it. The frozen first column at ≤767 does count: a
 *  sticky cell must be opaque, so it has to repeat every row state or the
 *  pinned cell is the one part of a striped row that is not striped. */
const lastCompound = sel => sel.split(/\s*[ >+~]\s*/).filter(Boolean).pop() || '';
const isRowState = (sel) => {
  const tail = lastCompound(sel);
  if (DIV_GRID_SYSTEMS.some(s => targets(tail, s))) return true;
  if (/^tr\b|^tbody\b/.test(tail)) return true;
  return /^td\b/.test(tail) && /first-child/.test(tail) && /\btr\b|\btbody\b/.test(sel);
};

describe('one table system', () => {
  it('finds every table system that ships, including the one behind <DataTable>', () => {
    // If this fails, a table system was added or renamed. That is fine — but it
    // has to be conscious, because everything below is measured against it.
    //
    // `gr__tbl` and `k-modtable` were both here and are both DELETED, not
    // renamed. Graha's eleven tables render `.tbl__wrap > table.tbl` and
    // graha.css declares no table rule at all; `DataTable`/`Td` in
    // `editorial/ModuleUI.jsx` now render through `components/ui/Table.jsx` —
    // the same move `pages/dristi/_shared.jsx` and `pages/prachar/_shared.jsx`
    // made for their own tabs — so editorial.css declares no `.k-modtable` rule
    // either and none of the ~50 call sites changed.
    //
    // Tokenising their five row properties had left each of them agreeing with
    // `.tbl` about every row STATE and still disagreeing about the frame, the
    // head typography and the gutters. That is the argument for removing a
    // system rather than converging one, and it is why this list is allowed to
    // SHRINK and never to grow.
    //
    // `.omt` and `.gn-coll` are the remainder, and both are class names rather
    // than systems: every value each of them states is `.tbl`'s (org.css
    // §Member table, ganit.css §Collections). Each stays until its markup
    // renders `.tbl__wrap > table.tbl`, at which point the entry and that
    // stylesheet block go together.
    //
    // `.gn-coll` is the entry that earned this assertion. It landed in
    // 9880c0d3/ade0f349 — after the 4 → 1 convergence — and joined none of the
    // contract, so this line failed here and five more failed below, for a
    // table nobody had decided to make a third system. It is converged now
    // (ganit.css §Collections for the separator and the head boundary,
    // components.css §10 for the three row states) and it is NAMED, because a
    // system that ships unnamed is the failure mode this whole file exists to
    // catch. Growing this list is allowed exactly once per convergence and is
    // never the way to make a failure go away: the values are checked below,
    // and an unconverged system cannot pass them by being listed here.
    expect(TABLE_SYSTEMS).toEqual(['gn-coll', 'omt', 'tbl']);
  });

  it('declares ONE row hover colour', () => {
    const found = rowRules
      .filter(r => /:hover/.test(r.sel) && bg(r.decls) && isRowState(r.sel))
      .map(r => ({ where: `${r.file}  ${r.sel}`, value: bg(r.decls) }));

    expect(found.length).toBeGreaterThan(0);           // the check must have teeth
    const distinct = [...new Set(found.map(f => f.value))];
    expect(distinct, found.map(f => `${f.where} => ${f.value}`).join('\n')).toHaveLength(1);
  });

  it('declares ONE row separator weight', () => {
    const found = rowRules
      .filter(r => drawsALine(r.decls['border-bottom']) && !/\bthead\b|\bth\b/.test(r.sel))
      .map(r => ({ where: `${r.file}  ${r.sel}`, value: r.decls['border-bottom'] }));

    expect(found.length).toBeGreaterThan(0);
    const distinct = [...new Set(found.map(f => f.value))];
    expect(distinct, found.map(f => `${f.where} => ${f.value}`).join('\n')).toHaveLength(1);
  });

  it('declares ONE head boundary weight', () => {
    // A head rule is a boundary, not a row separator, so it is full strength —
    // but it is still one value. `.k-modtable` drew it at 2px, twice the
    // reference, across all 54 sites `<DataTable>` reaches.
    const found = rowRules
      .filter(r => drawsALine(r.decls['border-bottom']) && /\bthead\b|\bth\b/.test(r.sel))
      .map(r => ({ where: `${r.file}  ${r.sel}`, value: r.decls['border-bottom'] }));

    expect(found.length).toBeGreaterThan(0);
    const distinct = [...new Set(found.map(f => f.value))];
    expect(distinct, found.map(f => `${f.where} => ${f.value}`).join('\n')).toHaveLength(1);
  });

  it('never reaches for --rule-soft on a table row', () => {
    // The systemic cause, named. `--rule-soft` is declared as
    // `var(--outline-variant)` in BOTH kartavaya-design.css and
    // surface-theme.css — an exact alias of `--rule`. Three of the four systems
    // drew their separator with it, so a name that promises a softer line
    // delivered the same one at 1.82× the reference weight. It cannot simply be
    // softened: ~40 rules use it as a BACKGROUND.
    const offenders = rowRules
      .filter(r => /var\(--rule-soft\)/.test(r.decls['border-bottom'] || ''))
      .map(r => `${r.file}  ${r.sel}`);
    expect(offenders, offenders.join('\n')).toEqual([]);
  });
});

describe('the values are the prototype\'s, not whichever of ours looked closest', () => {
  const root = RULES.filter(r => /(^|\s|>)(:root|html|body)(?![\w-])/.test(r.sel));
  const token = name => root.map(r => r.decls[name]).find(Boolean);

  it('separator is --outline-variant at 55%, not at full strength', () => {
    expect(token('--tbl-rule')).toBe(REFERENCE.rule);
  });

  it('head boundary is full-strength --outline-variant', () => {
    expect(token('--tbl-head-rule')).toBe(REFERENCE.headRule);
  });

  it('zebra is --s-low at 50%', () => {
    // Absent from EVERY table before this: `nth-child(even|odd)` appeared twice
    // in all of src/styles, both in landing.css on `.lfeat`.
    expect(token('--tbl-row-zebra')).toBe(REFERENCE.zebra);
  });

  it('hover is --s-container', () => {
    // Not `--s-low`, which is what `.tbl` used and what `--bg-raised` resolves
    // to, so Ganit and Graha were the same wrong colour spelled two ways.
    expect(token('--tbl-row-hover')).toBe(REFERENCE.hover);
  });

  it('selection is --primary-container', () => {
    expect(token('--tbl-row-on')).toBe(REFERENCE.on);
  });
});

describe('the five things the systems diverged on are declared for all of them', () => {
  const declaresFor = (system, pred) => rowRules.some(r => targets(r.sel, system) && pred(r));

  /* No exemptions. `.omt` used to be one — "its rows are not clickable, so a
     hover tint is a behaviour change" — and that argument does not survive
     zebra: striping is a READING aid, not an interaction, and the reference
     stripes every table (app.css:184). The org members table was the one table
     in the product with no stripes, which is not a decision anybody made. The
     three states are now declared for it from the shared tokens in
     components.css §10, without touching `pages/org/**`. */
  const stateful = SYSTEMS;

  it.each(stateful)('%s strips its rows', (system) => {
    expect(declaresFor(system, r => /:nth-child\(even\)/.test(r.sel) && bg(r.decls))).toBe(true);
  });

  it.each(stateful)('%s hovers', (system) => {
    expect(declaresFor(system, r => /:hover/.test(r.sel) && bg(r.decls) && isRowState(r.sel))).toBe(true);
  });

  it.each(stateful)('%s has a selected-row tint', (system) => {
    // The audit's line 6: `.k-trow` had no `.on` RULE anywhere, so the task
    // table could not have shown a selection even once the JSX applies one.
    expect(declaresFor(system, r => /\.on(?![\w-])|--on(?![\w-])/.test(r.sel) && bg(r.decls))).toBe(true);
  });
});

describe('the frame', () => {
  it('is on .tbl__wrap, never on .tbl', () => {
    // The name collision: the reference\'s `.tbl` is the frame DIV, this
    // build\'s `.tbl` is the `<table>` element and `.tbl__wrap` is the div. A
    // border on the table would draw a second box inside the first, and a
    // radius on a `border-collapse: collapse` table does nothing anyway.
    const wrap = RULES.find(r => r.sel === '.tbl__wrap' && r.decls.border);
    expect(wrap, '.tbl__wrap has no frame').toBeTruthy();
    expect(wrap.decls.border).toBe('1px solid var(--outline-variant)');
    expect(wrap.decls.background).toBe('var(--surface)');
    expect(wrap.decls['border-radius']).toBe('var(--r-lg)');

    const framedTable = RULES.filter(r => r.sel === '.tbl' && (r.decls.border || r.decls['border-radius']));
    expect(framedTable.map(r => r.file), 'the frame belongs on .tbl__wrap').toEqual([]);
  });

  it('is dropped inside a card, where the card is already the frame', () => {
    // `AdminCostDashboardPage` nests four `<Table>`s in `<Card><CardBody flush>`,
    // and AdminBillingPage, billing/OutboundLog and org/TabBilling do the same.
    // Without this reset, promoting the frame from `.tbv` to `.tbl__wrap` draws
    // a box inside a box on every one of them.
    const reset = RULES.find(r => r.sel === '.card__body .tbl__wrap');
    expect(reset, 'no card-body reset for the table frame').toBeTruthy();
    expect(reset.decls.border).toBe('0');
  });

  it('declares the frame exactly once', () => {
    // It used to live at `boards.css` scoped to `.tbv`, which is why 13 of the
    // 14 `.tbl` consumers had no frame: the rule that fixed the table VIEW
    // never reached the table.
    const framers = RULES.filter(r =>
      targets(r.sel, 'tbl__wrap') && r.decls['border-radius'] && r.decls.border && r.decls.border !== '0');
    expect(framers.map(r => `${r.file}  ${r.sel}`)).toEqual(['styles/components.css  .tbl__wrap']);
  });

  it('does not declare the reference\'s div-grid vocabulary', () => {
    // `.tbl__row`, `.tbl__c`, `.tbl__head` and friends are the reference's
    // grid-cell names. A semantic `<table>` has `<tr>` and `<td>`; declaring
    // them here would be the collision made permanent.
    const forbidden = ['tbl__row', 'tbl__c', 'tbl__head', 'tbl__scroll', 'tbl__t', 'tbl__s', 'tbl__group'];
    const declared = forbidden.filter(c => RULES.some(r => targets(r.sel, c)));
    expect(declared, declared.join(', ')).toEqual([]);
  });
});

describe('a phone reaches every column of every table', () => {
  // The parser flattens at-rules away, so the media condition is not on the
  // rule. What is checkable — and what actually broke — is that the width floor
  // and the frozen first column name all three `<table>` systems rather than
  // only `.tbl`. Before this, `.k-modtable` (54 sites) and `.gr__tbl` (11) had
  // neither on a phone: 65 of the build's 79 table sites escaped the fix. Both
  // are gone with their systems, and everything that used to be them inherits
  // these by being `.tbl` — which is the point of having moved. `.omt` is still
  // its own class, so it is still named.
  it.each(['tbl', 'omt', 'gn-coll'])('%s freezes its first column', (system) => {
    const frozen = RULES.some(r =>
      targets(r.sel, system) && /first-child/.test(r.sel) && r.decls.position === 'sticky');
    expect(frozen).toBe(true);
  });

  it('gives every table a width floor, by wrapper rather than by class', () => {
    // The general selector is what makes a table added next month inherit this.
    const floors = RULES.filter(r => r.decls['min-width'] === '640px').map(r => r.sel);
    expect(floors.some(s => /:has\(> table\)/.test(s)), floors.join('\n')).toBe(true);
  });
});
