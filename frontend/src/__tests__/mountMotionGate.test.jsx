/**
 * check-mount-motion.mjs — the gate's own tests.
 *
 * A gate nobody has watched fail is a gate nobody should trust. The defect it
 * exists for is invisible by construction: a `transition: width` that never
 * runs looks exactly like one that does, in the source and in a screenshot of
 * the settled page. So the only evidence the check works is a fixture it
 * rejects and a fixture it accepts.
 *
 * These drive the real `scan`/`findFaults` exported by the script — not a copy
 * of the logic — against stylesheets written into a temp directory laid out the
 * way `stylesheets()` expects (`src/styles` at the root it is handed).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { findFaults, scan } from '../../scripts/check-mount-motion.mjs';

let root;
const write = (name, css) => writeFileSync(join(root, 'src/styles', name), css);

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'mount-motion-'));
  mkdirSync(join(root, 'src/styles'), { recursive: true });
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe('check-mount-motion · what it rejects', () => {
  it('reports a sized transition with no animation anywhere', () => {
    write('a.css', '.bar__f { height: 100%; transition: width var(--dur-slow) var(--ease-fill); }');
    const faults = findFaults(root);
    expect(faults.map((f) => f.selector)).toContain('.bar__f');
  });

  it('reports a height transition too, not only width', () => {
    write('a.css', '.col__b { transition: height var(--dur-slow); }');
    expect(findFaults(root).map((f) => f.selector)).toContain('.col__b');
  });

  it('carries the line number of the transition, not the rule', () => {
    write('a.css', '.x {\n  color: red;\n  transition: width 1s;\n}');
    expect(findFaults(root).find((f) => f.selector === '.x').line).toBe(3);
  });
});

describe('check-mount-motion · what it accepts', () => {
  it('accepts a fill whose animation is declared in ANOTHER stylesheet', () => {
    // This is the shape the real fix takes: one shared block in animations.css
    // covering thirteen files. If the gate demanded the animation in the same
    // rule, the fix would fail its own check.
    write('a.css', '.bar__f { transition: width var(--dur-slow); }');
    write('b.css', '.bar__f { animation: ixGrowX var(--dur-slow) var(--ease-fill) backwards; }');
    expect(findFaults(root).map((f) => f.selector)).not.toContain('.bar__f');
  });

  it('expands :is() lists before matching — the whole sweep depends on it', () => {
    write('a.css', '.p { transition: width 1s; }\n.q { transition: width 1s; }');
    write('b.css', ':is(.p, .q) { animation: ixGrowX 1s; }');
    const sel = findFaults(root).map((f) => f.selector);
    expect(sel).not.toContain('.p');
    expect(sel).not.toContain('.q');
  });

  it('does not count `animation: none` as covering anything', () => {
    // A reduced-motion block switches the animation OFF. Reading that as
    // "this selector has an animation" would let the gate pass on a fill whose
    // only animation declaration is the one that disables it.
    write('a.css', '.r { transition: width 1s; }');
    write('b.css', '@media (prefers-reduced-motion: reduce) { .r { animation: none; } }');
    expect(findFaults(root).map((f) => f.selector)).toContain('.r');
  });

  it('ignores max-width, min-height and line-height', () => {
    write('a.css', '.s { transition: max-width 1s, min-height 1s, line-height 1s; }');
    write('b.css', '');
    expect(findFaults(root).map((f) => f.selector)).not.toContain('.s');
  });

  it('does not read from/to inside @keyframes as selectors', () => {
    write('a.css', '@keyframes k { from { transition: width 1s; } }');
    write('b.css', '');
    expect(findFaults(root)).toHaveLength(0);
  });
});

describe('check-mount-motion · the live tree', () => {
  it('every finding in the repo is held in the baseline', async () => {
    // The gate is wired into `npm run check`, so this is belt and braces — but
    // it fails HERE, in a test with a name, rather than as an exit code.
    const baseline = (await import('../../scripts/mount-motion-baseline.json', { with: { type: 'json' } })).default;
    const unheld = findFaults('.').filter((f) => !baseline.held[f.key]);
    expect(unheld.map((f) => f.key)).toEqual([]);
  });

  it('the two growth primitives are actually referenced', () => {
    const { animated } = scan('.');
    // Spot-check one fill from each axis. If the shared block in animations.css
    // is ever deleted or renamed these go quiet, and the gate above would
    // report thirteen new faults rather than none.
    expect(animated.has('.anx-duo__b')).toBe(true);
    expect(animated.has('.omtr__f')).toBe(true);
  });
});
