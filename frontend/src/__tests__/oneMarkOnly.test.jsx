/**
 * There must be exactly ONE drawing of the mark.
 *
 * On 2026-08-07 the logo was changed and the owner reported, twice, that it had
 * not changed. Both times they were right, and both times the cause was the
 * same: the mark was drawn in more than one place and only one of them had been
 * edited.
 *
 *   lib/brand.jsx        KLogo — an inline diamond.        Fixed first.
 *   SideBrand.jsx        <img src="/kartavaya-mark.png">   Found on report one.
 *   AuthShell.jsx        a SECOND inline diamond.          Found on report two.
 *
 * Each fix looked complete because the tests written alongside it passed — they
 * were about the component that HAD been changed. Nothing asked "is this the
 * only one?", so this file does.
 *
 * It reads source rather than rendering, because the failure is structural: a
 * fourth copy would render perfectly well and simply be the wrong shape.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { resolve, join } from 'path';

const SRC = resolve(process.cwd(), 'src');

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === '__tests__' || name === 'node_modules') continue;
      out.push(...walk(p));
    } else if (/\.(jsx?|tsx?)$/.test(name)) {
      out.push(p);
    }
  }
  return out;
}

const FILES = walk(SRC).map(p => ({ p: p.slice(SRC.length + 1).replace(/\\/g, '/'), s: readFileSync(p, 'utf8') }));

/** Source with block and line comments stripped — a mark discussed is not a mark drawn. */
const code = s => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');

describe('the mark is drawn in exactly one place', () => {
  it('has one component that emits the figure', () => {
    // `LotusK` owns the paths. Anything else emitting them is a copy.
    const owners = FILES.filter(f => /export const PATHS/.test(code(f.s)));
    expect(owners.map(f => f.p)).toEqual(['components/brand/LotusK.jsx']);
  });

  it('never inlines the mark\'s path data outside that component', () => {
    // The spine is the one segment unique to this figure and cheap to spot.
    const SPINE = 'M6.5 3.5V20.5';
    const offenders = FILES
      .filter(f => f.p !== 'components/brand/LotusK.jsx')
      .filter(f => code(f.s).includes(SPINE))
      .map(f => f.p);
    expect(
      offenders,
      'these files draw the mark themselves instead of rendering LotusK. That is '
      + 'how the logo changed three times without changing on screen.',
    ).toEqual([]);
  });

  it('leaves no trace of the diamond it replaced', () => {
    // Both retired copies drew a rhombus through the middle of their viewbox.
    const DIAMONDS = [/M4 11L11 4L18 11L11 18L4 11Z/, /M8 18L18 8L28 18L18 28L8 18Z/];
    const offenders = FILES
      .filter(f => DIAMONDS.some(re => re.test(code(f.s))))
      .map(f => f.p);
    expect(offenders, 'the old diamond mark is still drawn here').toEqual([]);
  });

  it('paints no raster mark anywhere in the app', () => {
    // An <img> cannot follow the accent or the theme, and has to be re-exported
    // by hand every time the drawing changes — which is why the sidebar sat on
    // the old logo through a change that claimed to be everywhere.
    const offenders = FILES
      .filter(f => /kartavaya-mark\.png|favicon\.png/.test(code(f.s)))
      .map(f => f.p);
    expect(offenders, 'a component still points at a raster mark').toEqual([]);
  });

  it('renders the mark large enough to read on every surface', () => {
    // The owner: "logo needs to be bigger i cant [see] anything pretty much."
    // 28px was the marketing nav and the footer; inside a chip that left the
    // figure about 17px.
    const sizes = [];
    for (const f of FILES) {
      for (const m of code(f.s).matchAll(/<KLogo\s+size=\{(\d+)\}/g)) {
        sizes.push({ file: f.p, size: Number(m[1]) });
      }
    }
    expect(sizes.length, 'no KLogo call sites found at all').toBeGreaterThan(4);
    const small = sizes.filter(s => s.size < 40);
    expect(
      small.map(s => `${s.file} @ ${s.size}px`),
      'a mark under 40px leaves the figure under 28px inside its chip',
    ).toEqual([]);
  });
});
