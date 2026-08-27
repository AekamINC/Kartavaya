/*
 * The ratchet's own ratchet.
 *
 * `check-rendered-ids.mjs` missed two live defects — `graha/ApprovalsTab.jsx`
 * drew `{r.requested_by?.slice(0, 12) || '—'}`, a truncated `users.user_id`, in
 * a table cell, and `vikray/TargetsTab.jsx` fell back to a raw
 * `{t.salesperson_id}` when the name did not resolve. Both are fixed in source,
 * which means the source no longer demonstrates anything: a check whose only
 * evidence is "it passes" is indistinguishable from a check that does nothing.
 *
 * So the two renders live on in `fixtures/rendered-ids/Offenders.jsx`, verbatim
 * from the commits that shipped them, and this asserts the check FAILS on them.
 * `Innocents.jsx` beside it holds every legitimate id use — `key`, `href`,
 * `data-*`, `title`, `aria-*`, map lookups, props, and the `created_by_name`
 * family — and this asserts the check stays silent on all of it, because the
 * false positive is the failure mode that gets a gate deleted.
 *
 * Running the real script as a subprocess, not importing its internals: the
 * exit code IS the contract, and a test of `offends()` in isolation would have
 * passed throughout the whole period the check was blind, since the blindness
 * was in `interpolations()` and in the vocabulary, not in the predicate.
 */
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'child_process';
import { resolve } from 'path';

// Paths off `process.cwd()`, not `import.meta.url`. The environment is jsdom,
// so `import.meta.url` is an `http://localhost:3000/...` URL and
// `fileURLToPath` throws "The URL must be of scheme file" before a single test
// runs. Vitest's root is `frontend/`, which is also where `npm run check`
// invokes the script from.
const SCRIPT = resolve(process.cwd(), 'scripts/check-rendered-ids.mjs');
const FIXTURES = resolve(process.cwd(), 'src/__tests__/fixtures/rendered-ids');

function run(root) {
  try {
    return { code: 0, out: execFileSync('node', [SCRIPT, root], { encoding: 'utf8' }) };
  } catch (e) {
    return { code: e.status, out: `${e.stdout || ''}${e.stderr || ''}` };
  }
}

describe('check-rendered-ids', () => {
  const { code, out } = run(FIXTURES);

  it('fails on the fixture tree', () => {
    expect(code).toBe(1);
  });

  // Named one by one rather than by count: a count assertion passes for the
  // wrong four findings, and each of these is a distinct way an id reaches the
  // screen.
  it('catches the truncated actor id from graha/ApprovalsTab.jsx', () => {
    // `requested_by` was not in the vocabulary at all, and `?.` was read as
    // control flow. Either miss alone was enough.
    expect(out).toContain("renders `r.requested_by?.slice(0, 12) || '—'`");
  });

  it('catches the id inside the fallback arm from vikray/TargetsTab.jsx', () => {
    // The OUTER expression holds a JSX tag and is correctly ignored; the id is
    // in the span's child, which the scanner used to jump straight over.
    expect(out).toContain('renders `t.salesperson_id`');
  });

  it('catches an id laundered through String()', () => {
    expect(out).toContain('renders `String(r.created_by)`');
  });

  it('catches an id laundered through a template literal', () => {
    // The literal's own backticks sit inside the report's backticks, so the
    // needle is the interpolation itself rather than the whole `renders …`
    // phrase — three backticks in a row is a needle nobody can read.
    expect(out).toContain('${r.updated_by}');
  });

  // ── The `assigned_to` pair, added 2026-08-27 ──────────────────────────────
  //
  // Both were LIVE when these were written, and both are the second outing of
  // the same class of miss: the vocabulary knew `_id`/`_by`/`uid`/`uuid`, and
  // this product's assignee column is a `_to`. `requested_by` above taught that
  // exact lesson once already.

  it('catches a truncated assigned_to on the rep-performance report', () => {
    // Identical in shape to `requested_by` at the top of this file. It was
    // missed for ONE reason: the name. `graha/ReportsTab.jsx` drew twelve
    // characters of a `users.user_id` on the one report whose own endpoint
    // comment says "these figures sit against a person".
    expect(out).toContain("renders `r.assigned_to?.slice(0, 12) || '—'`");
  });

  it('catches an id drawn from the ARM of a ternary, not its condition', () => {
    // `graha/ContactsTab.jsx` wore three coats: an unknown column name, a
    // truncation hidden in a template literal, and a `?` that put the whole
    // expression into `NOT_A_RENDER`.
    //
    // The fix is `splitTernary`, and the reason it is a split rather than
    // simply deleting `?` from `NOT_A_RENDER` is measured: deleting it produced
    // 15 findings across the app and EVERY ONE was a false positive of the
    // shape `{editId ? 'Edit' : 'New'}`, where the id is the condition and both
    // arms are string literals. The condition is not drawn. The arms are.
    expect(out).toContain('${c.assigned_to.substring(0, 8)}');
  });

  it('does NOT fire on an id used as a ternary CONDITION', () => {
    // The other half of the same change, and the half that keeps the check
    // usable. `{editId ? 'Edit territory' : 'New territory'}` reads an id to
    // choose between two literals; nothing about the id reaches the screen.
    // Asserted against the real tree rather than a fixture, because that is
    // where the fifteen were found.
    const app = run(resolve(process.cwd(), 'src'));
    expect(app.code).toBe(0);
    expect(app.out).not.toContain('TerritoriesTab.jsx');
    expect(app.out).not.toContain('ItLadderSection.jsx');
  });

  it('reports nothing from the legitimate uses', () => {
    expect(out).not.toContain('Innocents.jsx');
  });
});
