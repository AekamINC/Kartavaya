/**
 * sanvaadV2Layer — the four things about Messaging v2 that fail SILENTLY.
 *
 * Each block here exists because its subject breaks without a console warning,
 * a red build or a visible error:
 *
 *  1. THE CLASS CONTRACT. `styles/sanvaad.css` and `pages/sanvaad/**` were
 *     written in two separate runs against one class map. `check-classes`
 *     catches a class the pages render and the stylesheet lacks — but only for
 *     classes something already renders. A `.m2*` name that the stylesheet
 *     dropped and no page has reached yet is invisible until the page that
 *     needs it lands, which is the wrong moment to find out. This asserts all
 *     151 of them against the prototype directly.
 *
 *  2. THE KAMAL TILES. They are a data URI baked into CSS and a generator in
 *     JS. Nothing makes those two agree. Edit `kamal.js` and the stylesheet
 *     keeps painting the old figure; edit the stylesheet and the generator is a
 *     lie. Both render perfectly either way.
 *
 *  3. THEME PARITY OF THE TOKENS THIS LAYER ADDS. `check-tokens` pass 2 covers
 *     this generally; these three names are asserted by hand because a motif
 *     declared in one theme drops `background-image` entirely in the other and
 *     the log just looks plain.
 *
 *  4. THE TWO COMPONENTS' failure shapes — a record kind that renders half a
 *     card, a thread control that offers "0 replies", a card that puts a
 *     `<button>` inside a `<button>`.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { render, screen } from '@testing-library/react';
import React from 'react';

import { KAMAL_TILES, kamalTile } from '../components/brand/kamal';
import { COURSES, EYE_R, lobe } from '../components/brand/Lotus';
import RecordCard, { KINDS, KIND_IDS } from '../components/sanvaad/RecordCard';
import InlineThread from '../components/sanvaad/InlineThread';

/* `process.cwd()` and not `import.meta.url`: under vitest's jsdom environment
 * `import.meta.url` is an http:// URL and `readFileSync` refuses it. vitest runs
 * from `frontend/`, which is where `vitest.config.js` lives. */
const ROOT = process.cwd();
const CSS = readFileSync(resolve(ROOT, 'src/styles/sanvaad.css'), 'utf8');
const PROTO = readFileSync(
  resolve(ROOT, '../design-reference/Kartavaya Redesign/messaging.css'),
  'utf8'
);

/** Selector-position class names, comments removed. */
const classesIn = (css) =>
  new Set(
    [...css.replace(/\/\*[\s\S]*?\*\//g, ' ').matchAll(/\.(-?[A-Za-z_][\w-]*)/g)].map((m) => m[1])
  );

describe('sanvaad v2 · the class contract with pages/sanvaad', () => {
  const proto = classesIn(PROTO);
  const build = classesIn(CSS);

  it('defines every class messaging.css names', () => {
    const missing = [...proto].filter((c) => !build.has(c));
    expect(missing, `absent from sanvaad.css: ${missing.join(', ')}`).toEqual([]);
  });

  it('defines all 151 .m2* names, which is the contract itself', () => {
    const m2 = [...proto].filter((c) => c.startsWith('m2'));
    expect(m2.length).toBe(151);
    expect(m2.filter((c) => !build.has(c))).toEqual([]);
  });

  /**
   * Selector-level presence is not enough on its own: `.m2th__reply` survives a
   * deleted base rule purely because `.m2th__reply:hover` still names it, and
   * `check-classes` has the same blind spot. So this compares the RULE BLOCKS —
   * every selector messaging.css states, and every declaration inside it.
   *
   * `@media` blocks are removed from both sides first. The prototype drives
   * mobile off `.m2--mob` and keeps a five-rule query; the build carries the
   * full treatment on the 767px query, so the same selector legitimately
   * appears twice here with different values and a flat parse would read the
   * narrow-window override as the desktop rule.
   */
  const withoutAtRules = (css) => {
    const src = css.replace(/\/\*[\s\S]*?\*\//g, ' ');
    let out = '', i = 0;
    while (i < src.length) {
      const at = src.indexOf('@', i);
      if (at === -1) { out += src.slice(i); break; }
      out += src.slice(i, at);
      let j = src.indexOf('{', at), depth = 0;
      if (j === -1) { i = src.length; break; }
      for (; j < src.length; j++) {
        if (src[j] === '{') depth++;
        else if (src[j] === '}' && --depth === 0) { j++; break; }
      }
      i = j;
    }
    return out;
  };
  const norm = (s) => s.replace(/\s+/g, ' ').trim();
  /** A `-webkit-x: v` beside an identical `x: v` is the same declaration twice,
   *  for Safari. Dropped from both sides so it is not read as a difference. */
  const dropRedundantPrefixes = (decls) =>
    decls.filter((d) => !(d.startsWith('-webkit-') && decls.includes(d.slice(8))));
  const blocksOf = (css) => {
    const map = new Map();
    for (const m of withoutAtRules(css).matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const decls = dropRedundantPrefixes(m[2].split(';').map(norm).filter(Boolean));
      map.set(norm(m[1]), decls.sort().join('; '));
    }
    return map;
  };

  /**
   * The deviations, named one by one. Anything that differs and is NOT on this
   * list is drift, and the assertion below says so by selector.
   *   · `--wa-*`, `--sv-on-fill`, `--on-danger`: hexes moved into tokens.
   *   · the four dropped fallbacks: all four names are declared in both themes,
   *     and check-tokens' own docblock forbids a fallback on an `on-*` token.
   *   · `.men--me`: measured, see the comment on the rule.
   *   · `position: relative`, `backdrop-filter: none`, `line-clamp`: additions
   *     that state something the prototype states inline, in a token, or with a
   *     vendor prefix only.
   *   · `.m2dots i`: `calc(var(--ix) * 1s)` inside an infinite animation, which
   *     `e2e/theme-motion.test.jsx` refuses outright.
   *   · `.m2dots i:nth-child(2|3)`: the prototype writes the two stagger
   *     offsets as `.16s` and `.32s`. MOTION-SPEC.md §1 — "Never write a
   *     literal duration" — outranks the prototype on this exact point, and
   *     `scripts/check-motion.mjs` now fails the build on one. Both read
   *     `var(--dur-dot-stagger)` and `calc(var(--dur-dot-stagger) * 2)`, whose
   *     token is declared FIXED (kartavaya-design.css §5) because it offsets an
   *     infinite loop — so the resolved timing is byte-identical to the
   *     prototype's and only the spelling differs.
   */
  const DEVIATIONS = new Set([
    '.m2',
    '.m2c',
    '.m2row__av',
    '.m2row__av--wa',
    '.m2row__dot--off',
    '.m2row__mn',
    '.m2div--new .m2div__p',
    '.m2m__av',
    '.m2m__t .men',
    '.m2m__t .men--me',
    '.m2th__faces i',
    '.m2c__faces i',
    '.m2c__banner--warn',
    '[data-platform="win"] .m2c__hd',
    '.m2q__t',
    '.m2link__d',
    '.m2rec',
    '.m2ph image-slot',
    '[data-theme="dark"] .m2row__av--wa',
    '.m2dots i',
    '.m2dots i:nth-child(2)',
    '.m2dots i:nth-child(3)',
  ]);

  it('ports every rule block messaging.css states, declaration for declaration', () => {
    const P = blocksOf(PROTO);
    const B = blocksOf(CSS.slice(CSS.indexOf('/* ── § V2.0')));
    const drifted = [];
    for (const [sel, decls] of P) {
      if (DEVIATIONS.has(sel)) continue;
      if (!B.has(sel)) { drifted.push(`${sel} — no rule`); continue; }
      if (B.get(sel) !== decls) drifted.push(`${sel} — ${B.get(sel)}  ≠  ${decls}`);
    }
    expect(drifted, drifted.join('\n')).toEqual([]);
    // The deviation list is not allowed to rot into a blanket exemption. Every
    // entry must still be a selector the prototype states, AND must still
    // actually differ — an entry that has quietly come back into line is an
    // exemption nobody is spending, and the next real drift on that selector
    // would pass unnoticed.
    const stale = [...DEVIATIONS].filter((s) => !P.has(s) || B.get(s) === P.get(s));
    expect(stale, `deviations that no longer deviate: ${stale.join(', ')}`).toEqual([]);
  });

  it('carries the three keyframes the layer animates on', () => {
    for (const name of ['m2thIn', 'm2jumpIn', 'm2d']) {
      expect(CSS, `@keyframes ${name}`).toMatch(new RegExp(`@keyframes\\s+${name}\\b`));
    }
  });

  it('leaves no raw hex at a point of USE — every colour is a token', () => {
    const start = CSS.indexOf('/* ── § V2.0');
    expect(start, 'the § V2 section anchor moved').toBeGreaterThan(-1);
    const v2 = CSS.slice(start).replace(/\/\*[\s\S]*?\*\//g, ' ');
    // Inside a data: URI a hex is unavoidable — a data URI cannot read a custom
    // property, which is the whole reason there is one tile per theme.
    const withoutTiles = v2.replace(/url\("data:[^"]*"\)/g, 'url(TILE)');
    const hexes = [...withoutTiles.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map((m) => m[0]);
    // The one declaration site: --sv-on-fill. A token has to hold a literal
    // somewhere, and that somewhere is a declaration, not a rule.
    expect(hexes).toEqual(['#FFFFFF', '#0B6B33', '#6FE39B']);
  });
});

describe('sanvaad v2 · the tokens this layer adds', () => {
  /** Declarations of `name` inside a `[data-theme="<theme>"]` block. */
  const declaredIn = (theme, name) => {
    const re = new RegExp(
      `\\[data-theme="${theme}"\\][^{}]*\\{[^{}]*${name.replace(/-/g, '\\-')}\\s*:`,
      's'
    );
    return re.test(CSS.replace(/\/\*[\s\S]*?\*\//g, ' '));
  };

  it.each(['--wa-ink', '--motif-kamal', '--motif-kamal-lg'])(
    '%s is declared in BOTH themes, or the declaration using it is dropped in silence',
    (name) => {
      expect(declaredIn('light', name), `${name} missing in light`).toBe(true);
      expect(declaredIn('dark', name), `${name} missing in dark`).toBe(true);
    }
  );

  it('the kamal variant sets all four ground properties, small AND large', () => {
    const rule = /\[data-conv-pattern="kamal"\]\s*\{([^}]*)\}/.exec(CSS);
    expect(rule, 'no [data-conv-pattern="kamal"] rule').not.toBeNull();
    for (const prop of ['--conv-motif', '--conv-motif-size', '--conv-motif-lg', '--conv-motif-size-lg']) {
      expect(rule[1]).toContain(prop);
    }
  });
});

describe('sanvaad v2 · kamal is generated, and the stylesheet still matches', () => {
  it('bakes the exact output of kamal.js, all four tiles', () => {
    for (const theme of ['light', 'dark']) {
      for (const [name, value] of Object.entries(KAMAL_TILES[theme])) {
        expect(
          CSS.includes(value),
          `${theme} ${name} in sanvaad.css differs from kamal.js — regenerate it`
        ).toBe(true);
      }
    }
  });

  it('draws the ROSETTE COURSE ONLY, from Lotus.jsx, not a redrawing of it', () => {
    const [n, r0, r1, w] = COURSES[0];
    expect([n, r0, r1, w]).toEqual([10, 34, 70, 12]);
    const tile = kamalTile({ px: 44, ink: '#000000', opacity: '.1' });
    // The path in the tile is lobe() at the tile's own scale, character for
    // character. If anyone reimplements the curve here, this is what catches it.
    const k = (44 * (14 / 44)) / r1;
    expect(tile).toContain(lobe(r0 * k, r1 * k, w * k));
    // Ten lobes, and the eye.
    expect((tile.match(/href='%23kl'/g) || []).length).toBe(10);
    expect(tile).toContain(`circle r='${Number((EYE_R * k).toFixed(2))}'`);
    // The outer twenty-petal course is what makes the loader read as a MARK.
    // A mark that repeats is a watermark. It must not be in the ground.
    const outer = lobe(COURSES[2][1] * k, COURSES[2][2] * k, COURSES[2][3] * k);
    expect(tile).not.toContain(outer);
  });

  it('cannot grid up: off-axis, two rotations, half-drop rows', () => {
    const tile = kamalTile({ px: 44, ink: '#000000', opacity: '.1' });
    // Five rosettes: four corners (one lattice point, one rotation) and the
    // centre (the other lattice point, half a tile away on both axes).
    expect((tile.match(/href='%23kr'/g) || []).length).toBe(5);
    expect(tile).toContain("translate(22,22) rotate(31)");
    for (const corner of ['rotate(13)', 'translate(44,0) rotate(13)', 'translate(0,44) rotate(13)', 'translate(44,44) rotate(13)']) {
      expect(tile).toContain(corner);
    }
    // No rosette rotation may put a lobe on an axis: 10 lobes, 36 apart.
    for (const rot of [13, 31]) {
      for (let i = 0; i < 10; i++) {
        const a = ((rot + 36 * i) % 360 + 360) % 360;
        expect(a % 90, `a lobe lands on ${a} degrees`).not.toBe(0);
      }
    }
  });

  it('keeps ONE PEN at both sizes — which is why there are four tiles', () => {
    for (const px of [44, 96]) {
      const tile = kamalTile({ px, ink: '#000000', opacity: '.1' });
      expect((tile.match(/stroke-width='1'/g) || []).length).toBe(1);
      // One stroke colour and one opacity for the whole figure: no ramp inside.
      expect((tile.match(/stroke-opacity=/g) || []).length).toBe(1);
      expect(tile).toContain(`width='${px}' height='${px}'`);
    }
    // The large tile is a SEPARATE drawing, not the small one scaled — that is
    // the whole reason it exists.
    expect(KAMAL_TILES.light['--motif-kamal']).not.toBe(KAMAL_TILES.light['--motif-kamal-lg']);
  });

  it('bakes a different ink per theme, because a data URI cannot read a token', () => {
    expect(KAMAL_TILES.light['--motif-kamal']).toContain('%238C7F63');
    expect(KAMAL_TILES.dark['--motif-kamal']).toContain('%239FB0C4');
  });
});

describe('RecordCard · one component, five kinds', () => {
  const base = { reference: 'INV-2291', title: 'Saraswati Textiles Pvt Ltd' };

  it('knows exactly the five kinds 28 §4 names', () => {
    expect(KIND_IDS.sort()).toEqual(['ask', 'invoice', 'order', 'payment', 'task']);
  });

  it('renders the SAME tree for every kind — only the accent, name and glyph move', () => {
    const shapes = KIND_IDS.map((kind) => {
      const { container, unmount } = render(<RecordCard kind={kind} {...base} />);
      const el = container.querySelector('.m2rec');
      const shape = [...el.children].map((c) => c.className).join('|');
      unmount();
      return shape;
    });
    expect(new Set(shapes).size, `kinds diverged: ${shapes.join(' ≠ ')}`).toBe(1);
  });

  it('sets --rc per kind from a TOKEN, never a literal', () => {
    for (const kind of KIND_IDS) {
      const { container, unmount } = render(<RecordCard kind={kind} {...base} />);
      const style = container.querySelector('.m2rec').getAttribute('style');
      expect(style, kind).toContain(`--rc: ${KINDS[kind].tone}`);
      expect(style, `${kind} bakes a literal colour`).not.toMatch(/#[0-9a-fA-F]{3,6}/);
      unmount();
    }
  });

  it('renders nothing for a kind it does not understand', () => {
    const { container } = render(<RecordCard kind="credit_note" {...base} />);
    expect(container.querySelector('.m2rec')).toBeNull();
  });

  it('is a <button> only when it contains none', () => {
    const withActions = render(
      <RecordCard kind="invoice" {...base} actions={[{ label: 'Open in Ganit', onClick() {} }]} />
    );
    expect(withActions.container.querySelector('.m2rec').tagName).toBe('DIV');
    // and the action is a real control, not a span dressed as one
    expect(withActions.container.querySelectorAll('.m2rec__act button').length).toBe(1);
    withActions.unmount();

    const clickable = render(<RecordCard kind="invoice" {...base} onOpen={() => {}} />);
    expect(clickable.container.querySelector('.m2rec').tagName).toBe('BUTTON');
    // never a button inside a button
    expect(clickable.container.querySelectorAll('button button').length).toBe(0);
    clickable.unmount();
  });

  it('gives the progress bar a value a screen reader can read', () => {
    render(<RecordCard kind="task" {...base} percent={80} />);
    const bar = screen.getByRole('progressbar');
    expect(bar).toHaveAttribute('aria-valuenow', '80');
    expect(bar.querySelector('i').style.width).toBe('80%');
  });

  it('clamps a percentage that has drifted outside its track', () => {
    const { container, rerender } = render(<RecordCard kind="task" {...base} percent={140} />);
    expect(container.querySelector('.m2rec__bar i').style.width).toBe('100%');
    rerender(<RecordCard kind="task" {...base} percent={-20} />);
    expect(container.querySelector('.m2rec__bar i').style.width).toBe('0%');
  });

  it('repaints the strip for an approval, because a decision is a state', () => {
    const { container } = render(<RecordCard kind="ask" {...base} done="Approved by Rohan Mehta" />);
    expect(container.querySelector('.m2rec').className).toContain('m2rec--ask');
    expect(container.querySelector('.m2rec__done')).not.toBeNull();
  });
});

describe('InlineThread · replies in the log', () => {
  it('renders nothing at all when there are no replies', () => {
    const { container } = render(<InlineThread count={0} />);
    expect(container.firstChild).toBeNull();
  });

  it('states its expanded state, and only claims to control an open body', () => {
    const { container, rerender } = render(<InlineThread count={3} lastReplyAt="4:58 pm" />);
    const btn = container.querySelector('.m2th__open');
    expect(btn).toHaveAttribute('aria-expanded', 'false');
    expect(btn).not.toHaveAttribute('aria-controls');
    rerender(<InlineThread count={3} open><p>reply</p></InlineThread>);
    const open = container.querySelector('.m2th__open');
    expect(open).toHaveAttribute('aria-expanded', 'true');
    expect(open.getAttribute('aria-controls')).toBe(container.querySelector('.m2th__body').id);
  });

  it('counts in words, singular and plural', () => {
    const one = render(<InlineThread count={1} />);
    expect(one.container.textContent).toContain('1 reply');
    one.unmount();
    const many = render(<InlineThread count={7} />);
    expect(many.container.textContent).toContain('7 replies');
  });

  it('renders no face at all rather than inventing one', () => {
    const { container } = render(<InlineThread count={4} />);
    expect(container.querySelector('.m2th__faces')).toBeNull();
  });

  it('caps the stack at four and hides it from the accessible name', () => {
    const people = ['Anil Verma', 'Divya Nair', 'Rohan Mehta', 'Priya Shah', 'Meera Rao']
      .map((name, id) => ({ id, name }));
    const { container } = render(<InlineThread count={9} repliers={people} />);
    const stack = container.querySelector('.m2th__faces');
    expect(stack.children.length).toBe(4);
    expect(stack).toHaveAttribute('aria-hidden', 'true');
  });

  it('offers the reply control only inside an open thread, and only if it can act', () => {
    const closed = render(<InlineThread count={2} onReply={() => {}} />);
    expect(closed.container.querySelector('.m2th__reply')).toBeNull();
    closed.unmount();
    const open = render(<InlineThread count={2} open onReply={() => {}} />);
    expect(open.container.querySelector('.m2th__reply')).not.toBeNull();
    open.unmount();
    const readOnly = render(<InlineThread count={2} open />);
    expect(readOnly.container.querySelector('.m2th__reply')).toBeNull();
  });
});
