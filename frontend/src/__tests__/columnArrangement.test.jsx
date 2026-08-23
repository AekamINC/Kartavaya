/**
 * WHICH TABLES ARE ARRANGEABLE — discovered from the source, not listed by
 * hand, for exactly the reason `tableSystem.test.jsx` gives: a hardcoded list
 * is a list of the ones somebody thought of, and `.gn-coll` had already proved
 * that a table can ship without joining a contract nobody could fail to
 * notice.
 *
 * There are two ways in, and this file's job is to know both:
 *
 *   `useColumnPrefs('key', COLUMNS)`  a hand-written table, cells named by id
 *   `<DataTable arrange="key">`       the ~56 barrel/adapter tables, cells
 *                                     permuted positionally
 *
 * The invariant that actually costs something if it breaks is UNIQUENESS. The
 * key is the row's identity in `user_column_prefs` for ever. Two tables
 * sharing one key do not fail — they silently share an arrangement, so hiding
 * a column on the Employees table hides the third column of the Assets table,
 * and the only symptom is a user saying the app "sometimes forgets". Four
 * agents added keys concurrently in the session that wrote this; this is what
 * makes that safe.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, extname, resolve, dirname } from 'node:path';

const SRC = (() => {
  let dir = resolve(process.cwd());
  for (let i = 0; i < 6; i += 1) {
    if (existsSync(join(dir, 'src', 'hooks', 'useColumnPrefs.js'))) return join(dir, 'src');
    dir = dirname(dir);
  }
  throw new Error('src not found from ' + process.cwd());
})();

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

const FILES = walk(SRC)
  .filter(f => ['.jsx', '.js'].includes(extname(f)))
  // A test's own fixtures are not the product. `test.people` in
  // `arrangeDataTable.test.jsx` is a made-up key and must not be counted as a
  // table, nor collide with one.
  .filter(f => !/__tests__|\.test\.jsx?$/.test(f.replace(/\\/g, '/')))
  .map(f => ({
    file: f.slice(SRC.length + 1).replace(/\\/g, '/'),
    /* COMMENTS STRIPPED, and this is not tidiness — it is the difference
       between a check and a false alarm. `useColumnPrefs.js`'s own header
       shows `useColumnPrefs('graha.contacts', …)` as the worked example, and
       `TasksListPage.jsx` names the localStorage key it no longer uses in the
       comment explaining why it no longer uses it. Both read as live code to a
       regex, so the first run of this file reported a key collision between a
       page and the hook's own documentation. A check that fires on prose is a
       check people learn to ignore. */
    text: readFileSync(f, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^[ \t]*\/\/.*$/gm, ''),
  }));

/**
 * Every arrangement key that ships, with where it was declared.
 *
 * PARAMETERISED KEYS are a third form and they had to be learned rather than
 * exempted. `views/TableView.jsx` builds `board.table.${boardKey}` because its
 * custom-field columns differ per board — one arrangement across every board
 * would be an order over a column set most of them do not have. A regex for
 * quoted literals cannot see that key at all, so it would have passed this
 * file by being INVISIBLE to it, which is the worst way for anything to pass a
 * check.
 *
 * They are matched as template literals and recorded by their STATIC PREFIX,
 * with `param: true`. The prefix is what has to be unique and well formed; the
 * hole is a board id at runtime and is the server's business, not this file's.
 */
const LITERAL = /useColumnPrefs\(\s*'([^']+)'/g;
const ARRANGE = /arrange=["']([^"']+)["']/g;
/**
 * The CONVENTION for a parameterised key, and it is a convention precisely
 * because the first version of this was not.
 *
 * That version matched any template literal ending in a dot before its hole,
 * inside any file that mentioned the hook. It immediately reported
 * `kv.table.widths` — the LOCALSTORAGE key `TableView` reads to migrate its
 * old widths from — as an arrangement key, and duly complained that it was not
 * `module.thing`. A check that guesses which strings are keys will keep
 * finding strings that are not.
 *
 * So a parameterised key is DECLARED: an exported arrow function whose name
 * ends in `TableKey`, returning a template literal with one trailing hole.
 * `boardTableKey` in `views/TableView.jsx` is the only one today. Naming it is
 * also what makes it greppable by a person, which a key built inline in the
 * middle of a component is not.
 */
const TEMPLATE = /export const \w*TableKey = [^=]*=>\s*`([a-z][a-zA-Z0-9_.-]*\.)\$\{[^}]+\}`/g;

const KEYS = FILES.flatMap(({ file, text }) => [
  ...[...text.matchAll(LITERAL)].map(m => ({ key: m[1], file, via: 'hook' })),
  ...[...text.matchAll(ARRANGE)].map(m => ({ key: m[1], file, via: 'DataTable' })),
  ...[...text.matchAll(TEMPLATE)]
    .map(m => ({ key: m[1].replace(/\.$/, ''), file, via: 'hook', param: true })),
]);

describe('the arrangement keys', () => {
  it('exist at all — the check must have teeth', () => {
    // If this drops to a handful, the opt-in work was reverted rather than the
    // check being wrong.
    expect(KEYS.length).toBeGreaterThan(60);
  });

  it('are UNIQUE — two tables on one key silently share an arrangement', () => {
    const seen = new Map();
    const clashes = [];
    for (const k of KEYS) {
      if (seen.has(k.key)) clashes.push(`${k.key}  ${seen.get(k.key)}  +  ${k.file}`);
      else seen.set(k.key, k.file);
    }
    expect(clashes, clashes.join('\n')).toEqual([]);
  });

  it('match the grammar the SERVER enforces, not a looser one of our own', () => {
    /* `routers/column_prefs.py`:
         TABLE_KEY = ^[a-z][a-z0-9]*(\.[a-z0-9_-]+){1,2}$
       Copied rather than approximated, and that is the whole value of this
       test over a prettier one. The first segment admits NO underscore
       server-side, so a check that allowed `my_module.thing` would pass here
       and 422 in the browser — where the only symptom is that a table quietly
       never saves. Two or three segments, because a parameterised key is
       `module.table.<board>`. */
    const SERVER = /^[a-z][a-z0-9]*(\.[a-z0-9_-]+){1,2}$/;
    const bad = KEYS
      // A parameterised key is checked with a stand-in for its hole: the
      // suffix is a board id at runtime and cannot be read out of source.
      .filter(k => !SERVER.test(k.param ? `${k.key}.x` : k.key))
      .map(k => `${k.key}  (${k.file})`);
    expect(bad, bad.join('\n')).toEqual([]);
  });

  it('read as `module.thing` to a person, which the server does not enforce', () => {
    // Deliberately narrower than the server. The server refuses what would
    // turn this table into a key-value store; this refuses what would turn a
    // database row into a puzzle.
    const bad = KEYS
      .filter(k => !/^[a-z][a-z0-9]*\.[a-z][a-z0-9_]*$/.test(k.key))
      .map(k => `${k.key}  (${k.file})`);
    expect(bad, bad.join('\n')).toEqual([]);
  });

  it('finds the parameterised one, so it cannot pass by being invisible', () => {
    const board = KEYS.find(k => k.param);
    expect(board, 'no parameterised key found — did TableView stop building one?')
      .toBeTruthy();
    expect(board.key).toBe('board.table');
  });

  it('never end in a bare number — a key has to say WHICH table it is', () => {
    // `graha.reports_1` / `_2` names nothing: the next person cannot tell which
    // of three tables on the page a saved row belongs to, and renaming it later
    // abandons every arrangement stored under it.
    const numbered = KEYS.filter(k => /_\d+$/.test(k.key)).map(k => `${k.key}  (${k.file})`);
    expect(numbered, numbered.join('\n')).toEqual([]);
  });
});

describe('every table system reaches the same hook', () => {
  const has = (file) => FILES.find(f => f.file === file);
  const opted = (file) => {
    const f = has(file);
    expect(f, `${file} is gone — update this list rather than deleting the check`).toBeTruthy();
    return /useColumnPrefs\(|arrange=/.test(f.text);
  };

  /* One representative per system, named because these are the four SHAPES —
     not a census. A regression in the shared hook, in `cells()`, in the
     `DataTable` permutation or in the div-grid half shows up as one of these
     four going false, and each one is a different mechanism. */
  it('.tbl, by name — a hand-written table using cells()', () => {
    expect(opted('pages/graha/ContactsTab.jsx')).toBe(true);
    expect(opted('pages/ganit/InvoicesTab.jsx')).toBe(true);
  });

  it('.omt — the org members table, the one hand-rolled <table> markup', () => {
    expect(opted('pages/org/MemberTable.jsx')).toBe(true);
  });

  it('.gn-coll — Ganit collections, the table that shipped outside the contract', () => {
    expect(opted('pages/ganit/CollectionsTab.jsx')).toBe(true);
  });

  it('.k-trow — the div grid, which needed a second primitive to join', () => {
    const f = has('pages/TasksListPage.jsx');
    expect(/useColumnPrefs\(/.test(f.text)).toBe(true);
    // Specifically the div-grid half. If this page ever reads `cells()` it is
    // manufacturing `<td>` inside a `<div>` grid, which the browser keeps and
    // CSS lays out as a track nobody declared.
    expect(/cols\.gridCells\(/.test(f.text)).toBe(true);
    expect(/cols\.gridTemplate/.test(f.text)).toBe(true);
  });

  it('the board table view — order and width, visibility left to the toolbar', () => {
    const f = has('components/views/TableView.jsx');
    expect(/useColumnPrefs\(/.test(f.text)).toBe(true);
    // Its custom-field columns differ per board, so the key is built per board
    // rather than shared. `boardTableKey` is the declared builder the key
    // scanner above knows how to read.
    expect(/export const boardTableKey/.test(f.text)).toBe(true);
    // Visibility is NOT this hook's — `shownFields` comes from `BoardToolbar`,
    // which the Kanban board reads too. Hiding a field must mean the same
    // thing in both views, so the arrangement declines to have an opinion.
    expect(/visibility: 'external'/.test(f.text)).toBe(true);
    // And the widths a user already dragged are migrated, not discarded.
    expect(/seedWidths/.test(f.text)).toBe(true);
  });

  it('the board table view no longer keeps its widths on one device', () => {
    const f = has('components/views/TableView.jsx');
    // `kv.table.widths.<board>` survives in exactly one place — the migration
    // that reads it once and then retires it. It must not be read as the
    // authority anywhere.
    expect(/useColumnResize/.test(f.text)).toBe(false);
    expect(/legacyWidthKey/.test(f.text)).toBe(true);
  });

  it('the old localStorage widths hook is gone from the tree entirely', () => {
    // It was the model this workstream replaced. Leaving it exported is how a
    // future table quietly opts back into per-device widths.
    const users = FILES.filter(f => /useColumnResize/.test(f.text)).map(f => f.file);
    expect(users, users.join('\n')).toEqual([]);
  });

  it('the task list no longer keeps a preferences model of its own', () => {
    // It had three: a `visible` Set in React state, widths in
    // `localStorage['kv.taskslist.widths']`, and no order at all. The whole
    // point of the div-grid primitive is that there is ONE model.
    const f = has('pages/TasksListPage.jsx');
    expect(/kv\.taskslist\.widths/.test(f.text)).toBe(false);
    expect(/useColumnResize/.test(f.text)).toBe(false);
    expect(/DEFAULT_VISIBLE/.test(f.text)).toBe(false);
  });
});
