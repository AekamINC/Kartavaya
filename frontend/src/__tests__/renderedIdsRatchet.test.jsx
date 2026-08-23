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

  it('reports nothing from the legitimate uses', () => {
    expect(out).not.toContain('Innocents.jsx');
  });
});
